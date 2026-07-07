 const SUPABASE_URL = 'https://gkmvglzjrsneqkrlvohp.supabase.co';
 const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrbXZnbHpqcnNuZXFrcmx2b2hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2OTU0NTMsImV4cCI6MjA5MDI3MTQ1M30.bcGB06-v9xmJmgkY-4KbnHPgi13qP7_ng-BJHifd0UY';
 const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ══════════════════════════════════
// MAINTENANCE BANNER — Supabase synced
// ══════════════════════════════════

async function toggleMaintenance() {
  const banner = document.getElementById('maintenance-banner');
  const isCurrentlyOn = banner && banner.style.display === 'flex';
  const newState = !isCurrentlyOn;

  // Save to Supabase so all devices see the change
  await db.from('system_settings')
    .upsert({ key: 'maintenance_mode', value: String(newState), updated_at: new Date().toISOString() });

  applyMaintenanceState(newState);
  toast(newState ? '🔧 Maintenance banner ON — all devices notified' : '✅ Maintenance banner OFF — all devices updated');
}

function applyMaintenanceState(isOn) {
  const banner = document.getElementById('maintenance-banner');
  const label = document.getElementById('maintenance-status-label');
  const btn = document.getElementById('maintenance-toggle-btn');

  if (banner) {
    // Explicitly set both display and flex properties to avoid conflicts
    banner.style.cssText = banner.style.cssText
      .replace(/display\s*:\s*[^;]+;?/g, '')
      .trim();
    banner.style.display = isOn ? 'flex' : 'none';
    const main = document.querySelector('.main');
    if (main) main.style.paddingTop = isOn ? '44px' : '';
  }
  if (label) {
    label.textContent = isOn ? 'ON' : 'OFF';
    label.style.color = isOn ? 'var(--danger)' : 'var(--text3)';
  }
  if (btn) {
    btn.style.borderColor = isOn ? 'var(--danger)' : 'var(--border)';
    btn.style.background = isOn ? 'var(--danger-light)' : 'var(--surface2)';
    btn.style.color = isOn ? 'var(--danger)' : 'var(--text2)';
  }
}

// ══════════════════════════════════
// ONE-TIME BILL PAYMENT DATE MIGRATION
// ══════════════════════════════════
async function migrateBillPaymentDates() {
  toast('🔄 Scanning bill payments for date mismatches…');

  // 1. Find all expense rows of type 'bill' where exp_date month ≠ bill_month_key
  const { data: billExpenses, error: expErr } = await db.from('expenses')
    .select('*')
    .eq('expense_type', 'bill');

  if (expErr) { toast('Error fetching expenses: ' + expErr.message); return; }

  const mismatched = (billExpenses || []).filter(e => {
    if (!e.exp_date || !e.bill_id) return false;
    const expMonth = e.exp_date.slice(0, 7);
    const recordedMonth = e.bill_month_key || '';
    return expMonth !== recordedMonth && recordedMonth !== '';
  });

  if (!mismatched.length) {
    toast('✅ No mismatched bill payments found — all dates are correct.');
    return;
  }

  toast(`Found ${mismatched.length} mismatched payment(s) — fixing…`);

  let fixed = 0;
  let errors = 0;

  for (const exp of mismatched) {
    const correctMonthKey = exp.exp_date.slice(0, 7);   // e.g. "2025-05"
    const wrongMonthKey   = exp.bill_month_key;          // e.g. "2025-06"
    const billId          = exp.bill_id;
    const amount          = parseFloat(exp.amount || 0);

    try {
      // ── A. Remove this payment from the WRONG month record ──
      const { data: wrongRec } = await db.from('bill_month_records')
        .select('*').eq('bill_id', billId).eq('month_key', wrongMonthKey).maybeSingle();

      if (wrongRec) {
        const entries = (() => { try { return JSON.parse(wrongRec.payment_entries || '[]'); } catch { return []; } })();
        // Remove matching entry by amount + approximate date proximity
        const updatedEntries = entries.filter(e => {
          // Remove the first entry that matches this expense's amount
          if (parseFloat(e.amount) === amount && !e._migrated) {
            e._migrated = true; // mark so we only remove once
            return false;
          }
          return true;
        });
        const newPaid = updatedEntries.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
        const isFullyPaid = newPaid >= parseFloat(wrongRec.amount_due || 0) - 0.005;
        await db.from('bill_month_records').update({
          amount_paid: newPaid,
          is_fully_paid: isFullyPaid,
          payment_entries: JSON.stringify(updatedEntries)
        }).eq('id', wrongRec.id);
      }

      // ── B. Get or create the CORRECT month record ──
      let { data: correctRec } = await db.from('bill_month_records')
        .select('*').eq('bill_id', billId).eq('month_key', correctMonthKey).maybeSingle();

      if (!correctRec) {
        const { data: billDef } = await db.from('recurring_bills')
          .select('default_amount').eq('id', billId).maybeSingle();
        const newRec = {
          id: uid(), bill_id: billId, month_key: correctMonthKey,
          amount_due: parseFloat(billDef?.default_amount || 0),
          amount_paid: 0, is_fully_paid: false,
          payment_entries: '[]', created_at: new Date().toISOString()
        };
        await db.from('bill_month_records').insert(newRec);
        correctRec = newRec;
      }

      // ── C. Add the payment entry to the CORRECT month record ──
      const correctEntries = (() => { try { return JSON.parse(correctRec.payment_entries || '[]'); } catch { return []; } })();
      correctEntries.push({
        id: uid(), amount,
        date: exp.exp_date,
        by: exp.paid_by || '',
        note: exp.receipt_ref || `Migrated from ${fmtMonthKey(wrongMonthKey)}`
      });
      const newCorrectPaid = correctEntries.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
      const newIsFullyPaid = newCorrectPaid >= parseFloat(correctRec.amount_due || 0) - 0.005;
      await db.from('bill_month_records').update({
        amount_paid: newCorrectPaid,
        is_fully_paid: newIsFullyPaid,
        payment_entries: JSON.stringify(correctEntries)
      }).eq('id', correctRec.id);

      // ── D. Update the expense row's bill_month_key to match exp_date ──
      await db.from('expenses').update({
        bill_month_key: correctMonthKey,
        description: exp.description?.replace(fmtMonthKey(wrongMonthKey), fmtMonthKey(correctMonthKey)) || exp.description,
        notes: `Bill payment — ${fmtMonthKey(correctMonthKey)}`
      }).eq('id', exp.id);

      fixed++;
    } catch (err) {
      console.error('Migration error for expense', exp.id, err);
      errors++;
    }
  }

  toast(`✅ Migration complete — ${fixed} payment(s) moved to correct month${errors ? `, ${errors} error(s) — check console` : ''}.`);
  renderBillsSection();
  renderExpensesPanel();
  renderPaymentsPage();
}

async function fetchMaintenanceState() {
  try {
    const { data, error } = await db.from('system_settings')
      .select('value')
      .eq('key', 'maintenance_mode')
      .maybeSingle();
    // Default to OFF if no record found or any error
    const isOn = !error && data?.value === 'true';
    applyMaintenanceState(isOn);
  } catch {
    // On any failure, ensure banner stays hidden
    applyMaintenanceState(false);
  }
}

// Poll every 15 seconds so all devices stay in sync
let _maintenancePollInterval = null;

function startMaintenancePoller() {
  // Only run after user is authenticated
  if (!currentUser) return;
  // Clear any existing interval to avoid duplicates
  if (_maintenancePollInterval) clearInterval(_maintenancePollInterval);
  fetchMaintenanceState(); // immediate check on login
  _maintenancePollInterval = setInterval(fetchMaintenanceState, 15000);
}

// Subscribe to real-time changes if Supabase real-time is enabled
function subscribeMaintenanceRealtime() {
  if (!currentUser) return;
  db.channel('system_settings_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'system_settings', filter: 'key=eq.maintenance_mode' },
      (payload) => {
        const isOn = payload.new?.value === 'true';
        applyMaintenanceState(isOn);
      }
    )
    .subscribe();
}
  
// ══════════════════════════════════
// DATA LAYER — localStorage
// ══════════════════════════════════
const USERS = [
  { email: 'hello@harmonylivinghouse.com', password: 'harmony2026', name: 'Penninah Nyandia' },
  { email: 'josegithaigajose6218@gmail.com', password: 'staff2026', name: 'Githaiga Njoroge' }
];

let currentUser = null;
let currentResidentId = null;
let viewingNoteId = null;
let weeklyChart = null;
let residentChart = null;

Chart.defaults.animation = false;
Chart.defaults.animations = {};
Chart.defaults.transitions = {};

function getData(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function setData(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// Debounce utility — prevents expensive calls on every keystroke
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
const debouncedRenderAllNotes     = debounce(renderAllNotes, 280);
const debouncedRenderAllIncidents = debounce(renderAllIncidents, 280);
const debouncedRenderResidents    = debounce(renderResidentTable, 280);
const debouncedRenderPayments     = debounce(renderPaymentsPage, 280);
const debouncedRenderExpenses     = debounce(renderExpensesPanel, 280);

async function getResidents() {
  const { data } = await db.from('residents').select('*').order('created_at', { ascending: false });
  return data || [];
}
async function getNotes() {
  const { data } = await db.from('notes').select('*').order('note_date', { ascending: false });
  return data || [];
}
async function saveResident(res) {
  await db.from('residents').upsert(res);
}
async function saveNoteToDb(note) {
  await db.from('notes').upsert(note);
}
async function deleteResidentFromDb(id) {
  await db.from('residents').delete().eq('id', id);
  await db.from('notes').delete().eq('resident_id', id);
}
async function deleteNoteFromDb(id) {
  await db.from('notes').delete().eq('id', id);
}
async function getIncidentReports(residentId) {
  const q = db.from('incident_reports').select('*').order('incident_date', { ascending: false });
  if (residentId) q.eq('resident_id', residentId);
  const { data } = await q;
  return data || [];
}
async function saveIncidentReport(report) {
  await db.from('incident_reports').upsert(report);
}
async function deleteIncidentReportFromDb(id) {
  await db.from('incident_reports').delete().eq('id', id);
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ── MULTI-DIAGNOSIS HELPERS ──
function addDiagnosisRow(containerId, value) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:6px;';
  row.innerHTML = `
    <input type="text" value="${(value||'').replace(/"/g,'&quot;')}" placeholder="e.g. Alcohol use disorder"
      style="flex:1;padding:7px 11px;border:1.5px solid var(--border);border-radius:6px;
             font-family:inherit;font-size:13.5px;color:var(--text);background:var(--surface);"
      oninput="this.style.borderColor='var(--accent2)'"
      onblur="this.style.borderColor='var(--border)'">
    <button type="button" onclick="this.parentElement.remove()"
      style="width:28px;height:28px;border-radius:50%;border:none;background:var(--danger-light);
             color:var(--danger);font-size:16px;line-height:1;cursor:pointer;flex-shrink:0;
             display:flex;align-items:center;justify-content:center;font-weight:700;"
      title="Remove">×</button>`;
  container.appendChild(row);
  row.querySelector('input').focus();
}

function getDiagnoses(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return '';
  return Array.from(container.querySelectorAll('input'))
    .map(i => i.value.trim()).filter(Boolean).join('; ');
}

function setDiagnoses(containerId, diagnosisStr) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (!diagnosisStr) { addDiagnosisRow(containerId); return; }
  // Support both '; ' and ', ' as separators (legacy single-field data)
  const parts = diagnosisStr.split(/;\s*/).filter(Boolean);
  parts.forEach(d => addDiagnosisRow(containerId, d));
}

async function migrateVitalsRecorder() {
  const { data, error } = await db.from('vitals')
    .update({ recorded_by: 'Peninnah Nyandia' })
    .ilike('recorded_by', '%Githaiga%');
  if (!error) toast('Vitals recorder names updated to Peninnah Nyandia');
  else toast('Migration error: ' + error.message);
}

// ══════════════════════════════════
// AUTH
// ══════════════════════════════════
function doLogin() {
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pass = document.getElementById('login-password').value;
  const user = USERS.find(u => u.email === email && u.password === pass);
  if (!user) {
    document.getElementById('auth-error').style.display = 'block';
    return;
  }
  currentUser = user;
  localStorage.setItem('hlh_session', JSON.stringify(user));
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  initApp();
}

function doLogout() {
  localStorage.removeItem('hlh_session');
  currentUser = null;
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

// Emergency contacts page fix — directly inject content on click
// contacts listener cleared

function checkSession() {
  const s = localStorage.getItem('hlh_session');
  if (s) {
    try {
      currentUser = JSON.parse(s);
      document.getElementById('auth-screen').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      initApp();
      const lastPage = localStorage.getItem('hlh_last_page');
      if (lastPage && lastPage !== 'profile') {
        showPage(lastPage);
      }
    } catch {}
  }
}

function initApp() {
  const name = currentUser.name;
  document.getElementById('sidebar-name').textContent = name;
  document.getElementById('sidebar-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  // Apply saved theme
  const savedTheme = localStorage.getItem('hlh_theme') || 'light';
  if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  refreshDashboard();
  renderResidentTable();
  populateResidentFilter();
  startNotifScheduler();
  startMaintenancePoller();
  subscribeMaintenanceRealtime();
  seedExistingStaff();
}

async function seedExistingStaff() {
  // Staff data is managed entirely in Supabase — just load it into memory
  await loadDynamicStaffFromSupabase();
}

async function loadDynamicStaffFromSupabase() {
  const { data: dynamicStaff } = await db.from('staff_members')
    .select('name, salary_amount, salary_freq, salary_start_month')
    .eq('is_active', true);

  if (dynamicStaff && dynamicStaff.length) {
    const knownSeeds = new Set(['penninah nyandia','githaiga njoroge','james','alvan','ketty','joseph']);
    const currentCfg = getSalaryConfig();
    let changed = false;

    dynamicStaff.forEach(s => {
      if (!s.name) return;
      const nameLower = s.name.toLowerCase();
      const firstName = s.name.split(' ')[0];
      const firstLower = firstName.toLowerCase();

      // Skip the four hardcoded caregivers and login staff
      if (knownSeeds.has(nameLower) || knownSeeds.has(firstLower)) return;
      if (!s.salary_amount) return;

      if (!currentCfg[firstLower] || currentCfg[firstLower].amount !== parseFloat(s.salary_amount)) {
        currentCfg[firstLower] = {
          amount: parseFloat(s.salary_amount),
          freq: s.salary_freq || 'monthly',
          name: s.name,
          start_month: s.salary_start_month || null
        };
        changed = true;
      }

      // Register in KNOWN_STAFF and STAFF_COLORS if missing
      if (!KNOWN_STAFF.includes(firstName)) {
        KNOWN_STAFF.push(firstName);
        STAFF_COLORS[firstName] = { bg:'#f4f6f9', border:'#8a9ab0', text:'#4a5568', dot:'#8a9ab0' };
      }
    });

    if (changed) {
      localStorage.setItem(SALARY_CONFIG_KEY, JSON.stringify(currentCfg));
    }
  }
}

// Login on Enter key
document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// ══════════════════════════════════
// NAVIGATION
// ══════════════════════════════════
const pageTitles = { dashboard: 'Dashboard', residents: 'Residents', profile: 'Resident Profile', notes: 'All Notes', analytics: 'Analytics', incidents: 'All Incident Reports', payments: 'Financials — Income & Expenses', staffdocs: 'Staff Documents', contacts: 'Quick Contacts', alerts: '🔔 Alerts & Automated Notifications' };

async function showPage(name) {
  if (name !== 'profile') localStorage.setItem('hlh_last_page', name);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  const nav = document.getElementById('nav-' + name);
  if (nav) nav.classList.add('active');
  document.getElementById('topbar-title').textContent = pageTitles[name] || name;
  if (name === 'dashboard') refreshDashboard();
  if (name === 'notes') { await populateResidentFilter(); renderAllNotes(); }
  if (name === 'analytics') renderAnalytics();
  if (name === 'residents') renderResidentTable();
  if (name === 'incidents') { await populateResidentFilter(); renderAllIncidents(); document.querySelector('.main').scrollTo({ top: 0, behavior: 'instant' }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  if (name === 'payments') {
    await populateResidentFilter();
    renderPaymentsPage();
    renderExpensesPanel();
    const savedTab = localStorage.getItem('hlh_fin_tab') || 'income';
    switchFinTab(savedTab);
  }
  if (name === 'staffdocs') { initStaffDocsPage(); }
  if (name === 'alerts') { renderAlertsPage(); }
  if (name === 'contacts') { setTimeout(function(){ loadContactsPage(); }, 0); }
}
// ══════════════════════════════════
// DASHBOARD
// ══════════════════════════════════
async function refreshDashboard() {
  const residents = await getResidents();
  const notes = await getNotes();
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weekNotes = notes.filter(n => new Date(n.created_at).getTime() > weekAgo);
  const flagged = notes.filter(n => n.flag === 'concern' || n.flag === 'critical');

  document.getElementById('stat-residents').textContent = residents.length;
  document.getElementById('stat-notes').textContent = notes.length;
  document.getElementById('stat-week').textContent = weekNotes.length;
  document.getElementById('stat-flags').textContent = flagged.length;

  // Financial summary on dashboard
  const { data: dashPayments } = await db.from('payments').select('amount, pay_date');
  const { data: dashExpenses } = await db.from('expenses').select('amount, exp_date, expense_type');
  const { data: dashBillRecs } = await db.from('bill_month_records').select('amount_paid, month_key');
  const thisMonthKey = new Date().toISOString().slice(0, 7);

  const totalIncome = (dashPayments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const monthIncome = (dashPayments || []).filter(p => p.pay_date && p.pay_date.startsWith(thisMonthKey)).reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  const totalExpBase = (dashExpenses || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const billAlreadyCounted = (dashExpenses || []).filter(e => e.expense_type === 'bill').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const billRecordsTotal = (dashBillRecs || []).reduce((s, r) => s + parseFloat(r.amount_paid || 0), 0);
  const totalExpenses = totalExpBase + Math.max(0, billRecordsTotal - billAlreadyCounted);

  const monthExpBase = (dashExpenses || []).filter(e => e.exp_date && e.exp_date.startsWith(thisMonthKey)).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const billAlreadyThisMonth = (dashExpenses || []).filter(e => e.expense_type === 'bill' && e.exp_date && e.exp_date.startsWith(thisMonthKey)).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const billRecsThisMonth = (dashBillRecs || []).filter(r => r.month_key === thisMonthKey).reduce((s, r) => s + parseFloat(r.amount_paid || 0), 0);
  const monthExpenses = monthExpBase + Math.max(0, billRecsThisMonth - billAlreadyThisMonth);

  const netMonth = monthIncome - monthExpenses;

  const fmt = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

  // Income card
  const dashIncomeEl = document.getElementById('dash-stat-income');
  const dashIncomeCard = document.getElementById('dash-fin-income-card');
  if (dashIncomeEl) { dashIncomeEl.textContent = fmt(totalIncome); dashIncomeEl.style.color = '#1e7e34'; }
  if (dashIncomeCard) { dashIncomeCard.style.background = '#e8f5e9'; dashIncomeCard.style.borderColor = '#a5d6a7'; }
  const dashIncomeSub = document.getElementById('dash-stat-income-sub');
  if (dashIncomeSub) dashIncomeSub.textContent = (dashPayments||[]).length + ' payment' + ((dashPayments||[]).length !== 1 ? 's' : '') + ' recorded';

  // Expenses card
  const dashExpEl = document.getElementById('dash-stat-expenses');
  const dashExpCard = document.getElementById('dash-fin-expenses-card');
  if (dashExpEl) { dashExpEl.textContent = fmt(totalExpenses); dashExpEl.style.color = '#c0392b'; }
  if (dashExpCard) { dashExpCard.style.background = '#fdf0ef'; dashExpCard.style.borderColor = '#f5c0bb'; }

  // Net this month card
  const dashNetEl = document.getElementById('dash-stat-net');
  const dashNetCard = document.getElementById('dash-fin-net-card');
  const dashNetIcon = document.getElementById('dash-fin-net-icon');
  if (dashNetEl) {
    dashNetEl.textContent = fmt(netMonth);
    dashNetEl.style.color = netMonth < 0 ? '#c0392b' : netMonth > 0 ? '#1e7e34' : 'var(--text)';
  }
  if (dashNetCard) {
    dashNetCard.style.background = netMonth < 0 ? '#fdf0ef' : netMonth > 0 ? '#e8f5e9' : '';
    dashNetCard.style.borderColor = netMonth < 0 ? '#f5c0bb' : netMonth > 0 ? '#a5d6a7' : '';
  }
  if (dashNetIcon) {
    dashNetIcon.style.background = netMonth < 0 ? '#fdf0ef' : netMonth > 0 ? '#e8f5e9' : '#e8f0fe';
    dashNetIcon.style.color = netMonth < 0 ? '#c0392b' : netMonth > 0 ? '#1e7e34' : '#1a73e8';
  }
  const dashNetSub = document.getElementById('dash-stat-net-sub');
  if (dashNetSub) dashNetSub.textContent = netMonth < 0 ? '⚠️ Running at a loss' : netMonth > 0 ? '✅ Running at a profit' : 'Break even';

  // Month income card
  const dashMonthIncEl = document.getElementById('dash-stat-month-income');
  if (dashMonthIncEl) {
    dashMonthIncEl.textContent = fmt(monthIncome);
    dashMonthIncEl.style.color = monthIncome > 0 ? '#d68910' : 'var(--text)';
  }
  const dashMonthSub = document.getElementById('dash-stat-month-income-sub');
  if (dashMonthSub) dashMonthSub.textContent = new Date().toLocaleDateString('en-US', {month:'long', year:'numeric'});

  const recent = [...notes].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  const tbody = document.getElementById('recent-notes-table');
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:32px;">No notes yet. Add a resident and start documenting!</td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(n => {
    const res = residents.find(r => r.id === n.resident_id);
    const preview = (n.behavior_notes || n.incident_desc || n.plan || '—').slice(0, 50) + '…';
    return `<tr>
      <td><span class="resident-name" onclick="openProfile('${n.resident_id}')">${res ? res.name : 'Unknown'}</span></td>
      <td>${fmtDate(n.note_date)}</td>
      <td>${n.created_by}</td>
      <td style="color:var(--text2);font-size:13px;">${preview}</td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════
// RESIDENTS
// ══════════════════════════════════
function calcAge(dob) {
  if (!dob) return '—';
  const b = new Date(dob), now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) age--;
  return age;
}

function fmtDate(d, relative) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  if (relative) {
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((today - dt) / 86400000);
    if (diff === 0) return '📅 Today';
    if (diff === 1) return '📅 Yesterday';
    if (diff <= 6) return `📅 ${diff} days ago`;
  }
  return dt.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

async function renderResidentTable() {
  const q = (document.getElementById('resident-search')?.value || '').toLowerCase();
  const allResidents = await getResidents();
  const residents = allResidents.filter(r => r.name.toLowerCase().includes(q));
  const notes = await getNotes();
  const { data: allIncidents } = await db.from('incident_reports').select('resident_id');
  const incidents = allIncidents || [];
  const tbody = document.getElementById('residents-table');
  if (!residents.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px;">No residents found. Add your first resident!</td></tr>';
    return;
  }
  tbody.innerHTML = residents.map(r => {
    const noteCount = notes.filter(n => n.resident_id === r.id).length;
    const incidentCount = incidents.filter(i => i.resident_id === r.id).length;
    const statusMap = {
      active: { label: 'Active', cls: 'status-active' },
      hospitalized: { label: 'Hospitalized', cls: 'status-hospitalized' },
      onleave: { label: 'On Leave', cls: 'status-onleave' },
      discharged: { label: 'Discharged', cls: 'status-discharged' },
    };
    const st = statusMap[r.status || 'active'] || statusMap.active;
    return `<tr>
      <td>
        <span class="resident-name" onclick="openProfile('${r.id}')">${r.name}</span>
        <span class="badge ${st.cls}" style="margin-left:6px;font-size:10px;">${st.label}</span>
      </td>
      <td>${fmtDate(r.dob)}</td>
      <td>${calcAge(r.dob)}</td>
      <td>${r.admitted_date ? fmtDate(r.admitted_date) : '<span style="color:var(--text3);font-style:italic;font-size:12px;">Not set</span>'}</td>
      <td style="color:var(--text3);font-size:12px;">${fmtDate(r.created_at?.split('T')[0])}</td>
      <td><span class="badge badge-green">${noteCount} note${noteCount !== 1 ? 's' : ''}</span></td>
      <td><span class="badge badge-red">${incidentCount} report${incidentCount !== 1 ? 's' : ''}</span></td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn-secondary btn-sm" onclick="openProfile('${r.id}')">View</button>
        <button class="btn btn-danger btn-sm" onclick="deleteResident('${r.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function openAddResident() {
  ['res-name','res-dob','res-admitted','res-room','res-contact','res-contact2','res-contact3','res-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  setDiagnoses('res-diagnosis-list', '');
  document.getElementById('res-admitted').value = new Date().toISOString().split('T')[0];
  openModal('modal-resident');
}

async function handleSaveResident() {
  const name = document.getElementById('res-name').value.trim();
  const dob = document.getElementById('res-dob').value;
  if (!name || !dob) { toast('Please fill in Name and Date of Birth'); return; }
  const admittedRaw = document.getElementById('res-admitted').value;
  const res = {
    id: uid(), name: name, dob: dob,
    admitted_date: admittedRaw || new Date().toISOString().split('T')[0],
    room: document.getElementById('res-room').value.trim(),
    diagnosis: getDiagnoses('res-diagnosis-list'),
    emergency_contact: document.getElementById('res-contact').value.trim(),
    emergency_contact2: document.getElementById('res-contact2').value.trim(),
    emergency_contact3: document.getElementById('res-contact3').value.trim(),
    resident_phone: document.getElementById('res-phone').value.trim(),
    created_at: new Date().toISOString(),
    created_by: currentUser.name
  };
  await saveResident(res);
  closeModal('modal-resident');
  toast('Resident added successfully');
  openProfile(res.id);
}
  
async function deleteResident(id) {
  if (!confirm('Delete this resident and all their notes? This cannot be undone.')) return;
  await deleteResidentFromDb(id);
  renderResidentTable();
  toast('Resident deleted');
}

async function openEditResident(id) {
  const residents = await getResidents();
  const r = residents.find(x => x.id === id);
  if (!r) return;
  document.getElementById('edit-res-id').value = id;
  document.getElementById('edit-res-name').value = r.name || '';
  document.getElementById('edit-res-dob').value = r.dob || '';
  document.getElementById('edit-res-admitted').value = r.admitted_date || r.created_at?.split('T')[0] || '';
  document.getElementById('edit-res-room').value = r.room || '';
  setDiagnoses('edit-res-diagnosis-list', r.diagnosis || '');
  document.getElementById('edit-res-phone').value = r.resident_phone || '';
  document.getElementById('edit-res-contact').value = r.emergency_contact || '';
  document.getElementById('edit-res-contact2').value = r.emergency_contact2 || '';
  document.getElementById('edit-res-contact3').value = r.emergency_contact3 || '';
  openModal('modal-edit-resident');
}

async function handleUpdateResident() {
  const id = document.getElementById('edit-res-id').value;
  const name = document.getElementById('edit-res-name').value.trim();
  const dob = document.getElementById('edit-res-dob').value;
  if (!name || !dob) { toast('Please fill in Name and Date of Birth'); return; }

  const { error } = await db.from('residents').update({
    name,
    dob,
    admitted_date: document.getElementById('edit-res-admitted').value || dob,
    room: document.getElementById('edit-res-room').value.trim(),
    diagnosis: getDiagnoses('edit-res-diagnosis-list'),
    resident_phone: document.getElementById('edit-res-phone').value.trim(),
    emergency_contact: document.getElementById('edit-res-contact').value.trim(),
    emergency_contact2: document.getElementById('edit-res-contact2').value.trim(),
    emergency_contact3: document.getElementById('edit-res-contact3').value.trim(),
  }).eq('id', id);

  if (error) { toast('Error saving: ' + error.message); return; }

  closeModal('modal-edit-resident');
  toast('✅ Resident updated — all pages refreshed');

  // Refresh every part of the app that shows resident data
  await Promise.all([
    openProfile(id),          // re-renders profile header, contacts, tabs
    renderResidentTable(),    // residents page
    refreshDashboard(),       // dashboard recent notes + stats
    populateResidentFilter(), // notes page filter dropdown
    renderAllNotes(),         // all notes page (resident name references)
    renderAllIncidents(),     // all incidents page (resident name references)
    renderPaymentsPage(),     // payments page (resident name references)
  ]);
}

function calcDaysAdmitted(res) {
  if (res.status === 'discharged') return null;
  const raw = res.admitted_date || res.created_at?.split('T')[0];
  if (!raw) return null;
  const start = new Date(raw + 'T00:00:00');
  const now = new Date();
  const diff = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return diff;
}

// ══════════════════════════════════
// PROFILE
// ══════════════════════════════════
async function openProfile(id) {
  const residents = await getResidents();
  const res = residents.find(r => r.id === id);
  if (!res) return;
  currentResidentId = id;
  document.getElementById('profile-name').textContent = res.name;
  document.getElementById('profile-avatar').textContent = res.name.charAt(0).toUpperCase();
  document.getElementById('profile-dob').textContent = 'DOB: ' + fmtDate(res.dob);
  document.getElementById('profile-age').textContent = 'Age: ' + calcAge(res.dob);
  const admittedDisplay = res.admitted_date ? fmtDate(res.admitted_date) : fmtDate(res.created_at?.split('T')[0]);
  document.getElementById('profile-admitted').textContent = 'Admitted: ' + admittedDisplay;
  const recordAddedEl = document.getElementById('profile-record-added');
  if (recordAddedEl) recordAddedEl.textContent = 'Record added: ' + fmtDate(res.created_at?.split('T')[0]);
  document.getElementById('profile-diagnosis').textContent = res.diagnosis ? '· ' + res.diagnosis : '';
  document.getElementById('profile-status-select').value = res.status || 'active';
  showResidentPhoto(res.photo || null);
  checkBirthday(res);

  // Days admitted counter
  const daysEl = document.getElementById('profile-days-admitted');
  const days = calcDaysAdmitted(res);
  if (daysEl) {
    if (days !== null) {
      daysEl.innerHTML = `<span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.6);">Days in Facility</span><br><span style="font-size:22px;font-weight:700;color:#fff;">${days}</span>`;
      daysEl.style.display = 'block';
    } else {
      daysEl.innerHTML = `<span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.6);">Status</span><br><span style="font-size:14px;font-weight:700;color:#f5c6c2;">Discharged</span>`;
      daysEl.style.display = 'block';
    }
  }

  // Emergency contacts panel
  const ecEl = document.getElementById('profile-emergency-contacts');
  if (ecEl) {
    const contacts = [
      res.resident_phone ? { label: "Resident's Phone", val: res.resident_phone, icon: '📱' } : null,
      res.emergency_contact ? { label: 'Emergency Contact 1', val: res.emergency_contact, icon: '🚨' } : null,
      res.emergency_contact2 ? { label: 'Emergency Contact 2', val: res.emergency_contact2, icon: '🚨' } : null,
      res.emergency_contact3 ? { label: 'Emergency Contact 3', val: res.emergency_contact3, icon: '🚨' } : null,
    ].filter(Boolean);
    if (contacts.length) {
      ecEl.innerHTML = contacts.map(c => {
        // Extract first phone-like number for tel: link
        const phoneMatch = c.val.match(/[\d\-\(\)\s\+]{7,}/);
        const phoneHref = phoneMatch ? `href="tel:${phoneMatch[0].replace(/\D/g,'')}"` : '';
        return `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:16px;">${c.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;">${c.label}</div>
            <div style="font-size:13.5px;font-weight:600;color:var(--text);word-break:break-word;">${c.val}</div>
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0;">
            ${phoneHref ? `<a ${phoneHref} style="background:#e8f0fe;color:#1a73e8;border-radius:6px;padding:4px 9px;font-size:11px;font-weight:700;text-decoration:none;" title="Call">📞 Call</a>` : ''}
            <button onclick="navigator.clipboard.writeText('${c.val.replace(/'/g,"\\'")}').then(()=>toast('📋 Copied to clipboard'))" style="background:var(--surface2);color:var(--text2);border:1px solid var(--border);border-radius:6px;padding:4px 9px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;" title="Copy">Copy</button>
          </div>
        </div>`;
      }).join('');
      ecEl.style.display = 'block';
    } else {
      ecEl.innerHTML = `<div style="font-size:13px;color:var(--text3);font-style:italic;padding:8px 0;">No contacts recorded. <button class="btn btn-secondary btn-sm" style="margin-left:6px;" onclick="openEditResident('${id}')">Add now</button></div>`;
      ecEl.style.display = 'block';
    }
  }

  switchProfileTab('notes');
  renderProfileNotes();
  showPage('profile');
}

async function renderProfileNotes() {
  const allNotes = await getNotes();
  const notes = allNotes.filter(n => n.resident_id === currentResidentId)
    .sort((a,b) => new Date(b.note_date) - new Date(a.note_date));
  const container = document.getElementById('profile-notes-list');
  if (!notes.length) {
    container.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      <h4>No Progress Notes Yet</h4>
      <p>Add the first note for this resident using the button above.</p>
    </div>`;
    return;
  }
  container.innerHTML = notes.map(n => {
    const flagBadge = n.flag === 'critical' ? '<span class="badge badge-red">Critical</span>' : n.flag === 'concern' ? '<span class="badge badge-warn">Concern</span>' : '<span class="badge badge-green">Routine</span>';
    const preview = (n.behavior_notes || n.incident_desc || n.plan || 'No description').slice(0, 100);
    return `<div class="note-card" onclick="viewNote('${n.id}')">
      <div class="note-card-header">
        <div>
          <div class="note-date">${fmtDate(n.note_date, true)} &middot; ${n.shift || ''} Shift</div>
          <div class="note-staff">By ${n.created_by} &middot; ${flagBadge}</div>
        </div>
        <div class="note-actions" onclick="event.stopPropagation()">
          <button class="btn btn-secondary btn-sm" onclick="editNote('${n.id}', true)">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteNote('${n.id}')">Delete</button>
        </div>
      </div>
      <div class="note-preview">${preview}${preview.length >= 100 ? '…' : ''}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════
// NOTES CRUD
// ══════════════════════════════════
const NOTE_DRAFT_KEY = 'hlh_note_draft';

function openAddNote() {
  document.getElementById('note-modal-title').textContent = 'Add Progress Note';
  document.getElementById('note-edit-id').value = '';
  document.getElementById('note-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('note-time').value = new Date().toTimeString().slice(0,5);
  document.getElementById('note-staff').value = currentUser.name;
  document.getElementById('note-flag').value = 'routine';
  document.getElementById('note-shift').value = '';
  document.getElementById('note-resident-field').style.display = 'none';

  // Restore draft if one exists for this resident
  const draft = (() => { try { return JSON.parse(localStorage.getItem(NOTE_DRAFT_KEY)); } catch { return null; } })();
  const ta = document.getElementById('note-behavior-notes');
  if (draft && draft.residentId === currentResidentId && draft.text) {
    ta.value = draft.text;
    const banner = document.createElement('div');
    banner.id = 'note-draft-banner';
    banner.style.cssText = 'background:#fff3cd;border:1px solid #ffe08a;border-radius:6px;padding:8px 12px;font-size:12px;color:#856404;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    banner.innerHTML = `⚠️ <strong>Unsaved draft restored</strong> from your last session. <button onclick="document.getElementById('note-behavior-notes').value='';localStorage.removeItem('${NOTE_DRAFT_KEY}');this.parentElement.remove();" style="background:none;border:none;cursor:pointer;color:#856404;font-weight:700;font-family:inherit;font-size:12px;">✕ Discard</button>`;
    const modalBody = document.querySelector('#modal-note .modal-body');
    const existingBanner = document.getElementById('note-draft-banner');
    if (!existingBanner && modalBody) modalBody.prepend(banner);
  } else {
    ta.value = '';
  }
  // Auto-save as user types
  ta.oninput = () => {
    if (ta.value.trim()) {
      localStorage.setItem(NOTE_DRAFT_KEY, JSON.stringify({ residentId: currentResidentId, text: ta.value, ts: Date.now() }));
    } else {
      localStorage.removeItem(NOTE_DRAFT_KEY);
    }
  };
  openModal('modal-note');
}

async function openAddNoteGlobal() {
  document.getElementById('note-modal-title').textContent = 'Add Progress Note';
  document.getElementById('note-edit-id').value = '';
  document.getElementById('note-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('note-time').value = new Date().toTimeString().slice(0,5);
  document.getElementById('note-staff').value = currentUser.name;
  document.getElementById('note-flag').value = 'routine';
  document.getElementById('note-shift').value = '';
  document.getElementById('note-behavior-notes').value = '';
  const resField = document.getElementById('note-resident-field');
  resField.style.display = 'block';
  const sel = document.getElementById('note-resident-id');
  sel.innerHTML = '<option value="">— Select Resident —</option>';
  const residents = await getResidents();
  residents.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.name;
    sel.appendChild(opt);
  });
  openModal('modal-note');
}

async function editNote(id, fromGlobal) {
  const allNotes = await getNotes();
  const note = allNotes.find(n => n.id === id);
  if (!note) return;
  document.getElementById('note-modal-title').textContent = 'Edit Progress Note';
  document.getElementById('note-edit-id').value = id;
  document.getElementById('note-date').value = note.note_date;
  document.getElementById('note-time').value = note.note_time || '';
  document.getElementById('note-staff').value = note.created_by;
  document.getElementById('note-shift').value = note.shift || '';
  document.getElementById('note-flag').value = note.flag || 'routine';
  document.getElementById('note-behavior-notes').value = note.behavior_notes || '';
  const resField = document.getElementById('note-resident-field');
  if (fromGlobal) {
    resField.style.display = 'block';
    const sel = document.getElementById('note-resident-id');
    sel.innerHTML = '<option value="">— Select Resident —</option>';
    const residents = await getResidents();
    residents.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id; opt.textContent = r.name;
      if (r.id === note.resident_id) opt.selected = true;
      sel.appendChild(opt);
    });
  } else {
    resField.style.display = 'none';
  }
  closeModal('modal-view-note');
  openModal('modal-note');
}

async function saveNote() {
  const noteDate = document.getElementById('note-date').value;
  const staffName = document.getElementById('note-staff').value.trim();
  if (!noteDate || !staffName) { toast('Please fill in Date and Staff Name'); return; }
  const editId = document.getElementById('note-edit-id').value;
  const residentField = document.getElementById('note-resident-field');
  const isGlobal = residentField && residentField.style.display !== 'none';
  const selectedResidentId = isGlobal ? document.getElementById('note-resident-id').value : currentResidentId;
  if (isGlobal && !selectedResidentId) { toast('Please select a resident'); return; }
  const noteData = {
    id: editId || uid(),
    resident_id: selectedResidentId,
    note_date: noteDate,
    note_time: document.getElementById('note-time').value,
    created_by: staffName,
    shift: document.getElementById('note-shift').value,
    flag: document.getElementById('note-flag').value,
    behavior_notes: document.getElementById('note-behavior-notes').value.trim(),
    created_at: new Date().toISOString()
  };
  await saveNoteToDb(noteData);
  localStorage.removeItem(NOTE_DRAFT_KEY);
  closeModal('modal-note');
  toast(editId ? 'Note updated' : '✅ Note saved');
  renderProfileNotes();
}
  
async function deleteNote(id) {
  if (!confirm('Delete this progress note?')) return;
  await deleteNoteFromDb(id);
  renderProfileNotes();
  closeModal('modal-view-note');
  toast('Note deleted');
}

// ══════════════════════════════════
async function viewNote(id) {
  const allNotes = await getNotes();
  const note = allNotes.find(n => n.id === id);
  const allResidents = await getResidents();
  const res = allResidents.find(r => r.id === note.resident_id);
  if (!note) return;
  viewingNoteId = id;
  const flagColor = note.flag === 'critical' ? 'badge-red' : note.flag === 'concern' ? 'badge-warn' : 'badge-green';
  const flagLabel = note.flag === 'critical' ? 'Critical' : note.flag === 'concern' ? 'Concern' : 'Routine';
  const fv = (val) => val ? `<div class="field-value" style="white-space:pre-wrap;line-height:1.8;">${val}</div>` : `<div class="field-value empty">Not recorded</div>`;

  document.getElementById('note-view-body').innerHTML = `
    <div style="background:var(--accent-light);border-radius:var(--radius);padding:16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-weight:700;font-size:17px;">${res ? res.name : 'Unknown Resident'}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:4px;">
          ${fmtDate(note.note_date)} 
          ${note.note_time ? 'at ' + note.note_time : ''} &middot; 
          ${note.shift || 'Unspecified'} Shift &middot; 
          By ${note.created_by}
        </div>
      </div>
      <span class="badge ${flagColor}" style="font-size:13px;padding:5px 12px;">${flagLabel}</span>
    </div>

    <div class="note-section">
      <div class="note-section-title">Progress Notes</div>
      <div class="note-field">${fv(note.behavior_notes)}</div>
    </div>
  `;

  const isOnNotesPage = document.getElementById('page-notes').classList.contains('active');
  document.getElementById('note-view-footer').innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal('modal-view-note')">Close</button>
    <button class="btn btn-secondary" onclick="editNote('${id}', ${isOnNotesPage})">Edit</button>
    <button class="btn btn-danger" onclick="deleteNote('${id}')">Delete</button>
  `;
  openModal('modal-view-note');
}

// ══════════════════════════════════
// PRINT / PDF
// ══════════════════════════════════
function printNote() {
  const noteBodyEl = document.getElementById('note-view-body');
  if (!noteBodyEl) return;

  const nameEl = noteBodyEl.querySelector('[style*="font-weight:700"]');
  const residentName = nameEl ? nameEl.textContent.trim() : 'Unknown Resident';
  const metaEl = noteBodyEl.querySelector('[style*="font-size:13px"]');
  const metaText = metaEl ? metaEl.textContent.trim() : '';
  const noteTextEl = noteBodyEl.querySelector('.field-value');
  const noteText = noteTextEl ? noteTextEl.textContent.trim() : '';

  const now = new Date();
  const dateTime = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });

  const win = window.open('', '_blank', 'width=850,height=1000');
  win.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Progress Notes — ${residentName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', Times, serif;
    background: #fff;
    color: #000;
    padding: 48px 60px;
    width: 816px;
    margin: 0 auto;
  }
  .header { text-align: center; margin-bottom: 20px; }
  .header img { width: 80px; height: 80px; object-fit: contain; display: block; margin: 0 auto 10px; }
  .org-name { font-size: 15px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
  .org-address { font-size: 11.5px; color: #444; margin-bottom: 10px; }
  .doc-title { font-size: 14px; font-weight: bold; text-decoration: underline; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 16px; }
  .meta-row { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; padding-bottom: 10px; border-bottom: 1.5px solid #000; }
  .meta-row span strong { font-weight: bold; }
  .note-body { font-size: 12.5px; line-height: 1.9; margin-top: 20px; white-space: pre-wrap; color: #111; }
  .sig-block { margin-top: 48px; }
  .sig-line { display: inline-block; border-bottom: 1px solid #000; width: 220px; margin-right: 8px; }
  .sig-label { font-size: 10.5px; color: #555; margin-top: 4px; }
  @media print {
    body { padding: 36px 48px; }
    @page { size: letter; margin: 0.6in; }
  }
</style>
</head><body>
<div class="header">
  <img src="harmony_living_house_logo.png" alt="Logo">
  <div class="org-name">Harmony Living House Adult Family LLC</div>
  <div class="org-address">120 Newaukum Village Dr &nbsp;|&nbsp; Chehalis, WA 98532</div>
  <div class="doc-title">Progress Notes</div>
</div>
<div class="meta-row">
  <span><strong>Resident Name:</strong> ${residentName}</span>
  <span><strong>Printed:</strong> ${dateTime} (PT)</span>
</div>
<div class="meta-row" style="border-bottom:none;padding-bottom:0;margin-bottom:0;">
  <span><strong>Note Details:</strong> ${metaText}</span>
</div>
<div class="note-body">${noteText}</div>
<div class="sig-block">
  <div class="sig-line"></div>
  <div class="sig-label">Staff Signature</div>
</div>
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.addEventListener('afterprint', () => { win.close(); window.focus(); });
  }, 700);
}

async function exportPDF() {
  const allNotes = await getNotes();
  const note = allNotes.find(n => n.id === viewingNoteId);
  if (!note) return;
  const allResidents = await getResidents();
  const res = allResidents.find(r => r.id === note.resident_id);
  const residentName = res ? res.name : 'Unknown Resident';
  const now = new Date();
  const dateTime = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
  const noteText = (note.behavior_notes || '').trim();
  const noteDetails = `${note.note_date ? fmtDate(note.note_date) : ''}${note.note_time ? ' at ' + note.note_time : ''}${note.shift ? ' · ' + note.shift + ' Shift' : ''} · By ${note.created_by || ''}`;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const pageW = 612;
  const pageH = 792;
  const marginL = 60;
  const marginR = 60;
  const usableW = pageW - marginL - marginR;
  const lineH = 19;

  const wrapText = (text, maxChars) => {
    const result = [];
    text.split('\n').forEach(para => {
      const trimmed = para.trim();
      if (!trimmed) { result.push(''); return; }
      const words = trimmed.split(' ');
      let cur = '';
      words.forEach(word => {
        const test = cur ? cur + ' ' + word : word;
        if (test.length > maxChars) { result.push(cur); cur = word; }
        else cur = test;
      });
      if (cur) result.push(cur);
    });
    return result;
  };

  const drawDocument = (logoDataUrl) => {
    let y = 40;

    if (logoDataUrl) {
      const logoSize = 80;
      doc.addImage(logoDataUrl, 'PNG', (pageW - logoSize) / 2, y, logoSize, logoSize);
      y += logoSize + 10;
    }

    doc.setFont('times', 'bold');
    doc.setFontSize(16);
    doc.text('HARMONY LIVING HOUSE ADULT FAMILY LLC', pageW / 2, y, { align: 'center' });
    y += 20;

    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.text('120 Newaukum Village Dr  |  Chehalis, WA 98532', pageW / 2, y, { align: 'center' });
    y += 18;

    doc.setFont('times', 'bold');
    doc.setFontSize(13);
    const titleText = 'PROGRESS NOTES';
    const titleW = doc.getTextWidth(titleText);
    doc.text(titleText, pageW / 2, y, { align: 'center' });
    doc.setLineWidth(0.8);
    doc.line((pageW - titleW) / 2, y + 2, (pageW + titleW) / 2, y + 2);
    y += 22;

    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.text(`Resident Name: ${residentName}`, marginL, y);
    doc.text(`Printed: ${dateTime} (PT)`, pageW - marginR, y, { align: 'right' });
    y += 16;

    doc.setFontSize(10.5);
    doc.text(`Note Details: ${noteDetails}`, marginL, y);
    y += 14;

    doc.setLineWidth(1);
    doc.line(marginL, y, pageW - marginR, y);
    y += 20;

    doc.setFont('times', 'normal');
    doc.setFontSize(11.5);
    const noteLines = wrapText(noteText, 88);
    noteLines.forEach(line => {
      if (y + lineH > pageH - 80) { doc.addPage(); y = 40; }
      if (line) doc.text(line, marginL, y);
      y += lineH;
    });

    y += 36;
    if (y + 40 > pageH - 20) { doc.addPage(); y = 40; }
    doc.setLineWidth(0.5);
    doc.line(marginL, y, marginL + 220, y);
    doc.setFontSize(9.5);
    doc.text('Staff Signature', marginL, y + 13);

    const safeName = residentName.replace(/\s+/g, '_');
    doc.save(`ProgressNotes_${safeName}_${note.note_date}.pdf`);
    setTimeout(() => window.focus(), 300);
  };

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    drawDocument(canvas.toDataURL('image/png'));
  };
  img.onerror = () => drawDocument(null);
  img.src = 'harmony_living_house_logo.png';
}
// ══════════════════════════════════
// ALL NOTES PAGE
// ══════════════════════════════════
async function populateResidentFilter() {
  const residents = await getResidents();

  // Rebuild every resident dropdown across all pages simultaneously
  const dropdownIds = [
    'notes-resident-filter',
    'incidents-resident-filter',
    'pay-resident-filter',
    'pay-resident-id',
  ];

  dropdownIds.forEach(dropdownId => {
    const sel = document.getElementById(dropdownId);
    if (!sel) return;
    const cur = sel.value;
    const isPaymentSelect = dropdownId === 'pay-resident-id';
    sel.innerHTML = isPaymentSelect
      ? '<option value="">— Select Resident —</option>'
      : '<option value="">All Residents</option>';
    residents.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      sel.appendChild(opt);
    });
    // Restore previous selection if the resident still exists
    if (residents.find(r => r.id === cur)) sel.value = cur;
  });
}

async function renderAllNotes() {
  const q = (document.getElementById('notes-search')?.value || '').toLowerCase();
  const dateF = document.getElementById('notes-date-filter')?.value;
  const resF = document.getElementById('notes-resident-filter')?.value;
  const residents = await getResidents();
  const allNotes = await getNotes();
  let notes = allNotes.sort((a,b) => new Date(b.note_date) - new Date(a.note_date));
  if (q) notes = notes.filter(n => JSON.stringify(n).toLowerCase().includes(q));
  if (dateF) notes = notes.filter(n => n.note_date === dateF);
  if (resF) notes = notes.filter(n => n.resident_id === resF);
  const container = document.getElementById('all-notes-list');
  if (!notes.length) {
    container.innerHTML = `<div class="empty-state"><h4>No notes found</h4><p>Try adjusting your search filters.</p></div>`;
    return;
  }
  container.innerHTML = notes.map(n => {
    const res = residents.find(r => r.id === n.resident_id);
    const flagBadge = n.flag === 'critical' ? '<span class="badge badge-red">Critical</span>' : n.flag === 'concern' ? '<span class="badge badge-warn">Concern</span>' : '<span class="badge badge-green">Routine</span>';
    const preview = (n.behavior_notes || n.incident_desc || n.plan || '—').slice(0, 120);
    return `<div class="note-card" onclick="viewNote('${n.id}')">
      <div class="note-card-header">
        <div>
          <div class="note-date">${res ? `<span style="cursor:pointer;color:var(--text);text-decoration:underline dotted;" onclick="event.stopPropagation();openProfile('${n.resident_id}')">${res.name}</span> &middot; ` : ''}${fmtDate(n.note_date)}</div>
          <div class="note-staff">By ${n.created_by} &middot; ${n.shift || ''} shift &middot; ${flagBadge}</div>
        </div>
      </div>
      <div class="note-preview">${preview}${preview.length >= 120 ? '…' : ''}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════
// ALL INCIDENTS PAGE
// ══════════════════════════════════
async function renderAllIncidents() {
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.querySelector('.main').scrollTo({ top: 0, behavior: 'instant' });
  const q = (document.getElementById('incidents-search')?.value || '').toLowerCase();
  const dateF = document.getElementById('incidents-date-filter')?.value;
  const resF = document.getElementById('incidents-resident-filter')?.value;
  const residents = await getResidents();
  const { data: allReports } = await db.from('incident_reports').select('*').order('incident_date', { ascending: false });
  let reports = allReports || [];
  if (q) reports = reports.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  if (dateF) reports = reports.filter(r => r.incident_date === dateF);
  if (resF) reports = reports.filter(r => r.resident_id === resF);
  // Note: dropdown is now always populated by populateResidentFilter()
  const container = document.getElementById('all-incidents-list');
  if (!reports.length) {
    container.innerHTML = `<div class="empty-state"><h4>No incident reports found</h4><p>Try adjusting your search filters.</p></div>`;
    return;
  }
  container.innerHTML = reports.map(r => {
    const res = residents.find(x => x.id === r.resident_id);
    const natures = [r.nature_injury&&'Injury', r.nature_missing&&'Missing', r.nature_death&&'Death', r.nature_fire&&'Fire/Disaster', r.nature_fall&&'Fall'].filter(Boolean).join(', ') || 'Unspecified';
    const preview = (r.description || '—').slice(0, 120);
    return `<div class="note-card">
      <div class="note-card-header">
        <div style="cursor:pointer;flex:1;" onclick="openProfileAndViewIncident('${r.resident_id}','${r.id}')">
          <div class="note-date">${res ? `<span style="cursor:pointer;color:var(--text);text-decoration:underline dotted;">${res.name}</span> &middot; ` : ''}${fmtDate(r.incident_date)}</div>
          <div class="note-staff">Nature: ${natures} · Prepared by ${r.prepared_by}</div>
        </div>
        <div class="note-actions" onclick="event.stopPropagation()">
          <button class="btn btn-secondary btn-sm" onclick="editIncidentReport('${r.id}', true)">Edit</button>
        </div>
      </div>
      <div class="note-preview" style="cursor:pointer;" onclick="openProfileAndViewIncident('${r.resident_id}','${r.id}')">${preview}${preview.length >= 120 ? '…' : ''}</div>
    </div>`;
  }).join('');
}

async function openProfileAndViewIncident(residentId, incidentId) {
  await openProfile(residentId);
  viewingIncidentId = incidentId;
  viewIncidentReport(incidentId);
}

// ══════════════════════════════════
// TIMELINE
async function showTimeline() {
  const allNotes = await getNotes();
  const notes = allNotes.filter(n => n.resident_id === currentResidentId)
    .sort((a,b) => new Date(a.note_date) - new Date(b.note_date));
  const icons = { routine: '📋', concern: '⚠️', critical: '🚨' };
  document.getElementById('timeline-list').innerHTML = notes.map(n => `
    <div class="timeline-item">
      <div class="timeline-dot">${icons[n.flag] || '📋'}</div>
      <div class="timeline-content" onclick="viewNote('${n.id}')" style="cursor:pointer;">
        <div class="timeline-date">${fmtDate(n.note_date)}</div>
        <div class="timeline-staff">By ${n.created_by} &middot; ${n.shift || ''} shift</div>
        <div class="timeline-text">${(n.behavior_notes || n.incident_desc || n.plan || '—').slice(0,120)}</div>
      </div>
    </div>
  `).join('') || '<p style="color:var(--text3);text-align:center;padding:32px;">No notes to display.</p>';
  openModal('modal-timeline');
}

// ══════════════════════════════════
// ANALYTICS
// ══════════════════════════════════
let incidentChart = null;

async function calPrevMonth() {
  calCurrentDate.setMonth(calCurrentDate.getMonth() - 1);
  const notes = await getNotes();
  const { data: incidents } = await db.from('incident_reports').select('*');
  renderCalendar(notes, incidents || []);
}

async function calNextMonth() {
  calCurrentDate.setMonth(calCurrentDate.getMonth() + 1);
  const notes = await getNotes();
  const { data: incidents } = await db.from('incident_reports').select('*');
  renderCalendar(notes, incidents || []);
}

async function renderAnalytics() {
  const notes = await getNotes();
  const residents = await getResidents();
  const { data: allIncidents } = await db.from('incident_reports').select('*');
  const incidents = allIncidents || [];

  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  // ── SUMMARY STATS ROW 1 ──
  const notesThisMonth = notes.filter(n => n.note_date && n.note_date.startsWith(thisMonth)).length;
  const avgNotes = residents.length ? (notes.length / residents.length).toFixed(1) : 0;
  const incThisMonth = incidents.filter(i => i.incident_date && i.incident_date.startsWith(thisMonth)).length;
  const incTotal = incidents.length;

  document.getElementById('an-month').textContent = notesThisMonth;
  document.getElementById('an-avg').textContent = avgNotes;
  document.getElementById('an-inc-month').textContent = incThisMonth;
  document.getElementById('an-inc-total').textContent = incTotal;

  // ── SUMMARY STATS ROW 2 ──
  const staffMap = {};
  notes.forEach(n => {
    if (!n.created_by) return;
    if (!staffMap[n.created_by]) staffMap[n.created_by] = { count: 0, flags: 0, last: '' };
    staffMap[n.created_by].count++;
    if (n.flag === 'concern' || n.flag === 'critical') staffMap[n.created_by].flags++;
    if (!staffMap[n.created_by].last || n.note_date > staffMap[n.created_by].last)
      staffMap[n.created_by].last = n.note_date;
  });

  const topStaffEntry = Object.entries(staffMap).sort((a,b) => b[1].count - a[1].count)[0];
  if (topStaffEntry) {
    document.getElementById('an-top-staff').textContent = topStaffEntry[0].split(' ')[0];
    document.getElementById('an-top-staff-count').textContent = `${topStaffEntry[1].count} notes documented`;
  }

  const resNoteMap = residents.map(r => ({ name: r.name.split(' ')[0], full: r.name, count: notes.filter(n => n.resident_id === r.id).length }));
  const topRes = resNoteMap.sort((a,b) => b.count - a.count)[0];
  if (topRes) {
    document.getElementById('an-top-resident').textContent = topRes.name;
    document.getElementById('an-top-resident-count').textContent = `${topRes.count} progress notes`;
  }

  const sortedByDate = [...notes].filter(n => n.note_date).sort((a,b) => b.note_date.localeCompare(a.note_date));
  document.getElementById('an-last-note').textContent = sortedByDate[0] ? fmtDate(sortedByDate[0].note_date) : '—';

  const flagged = notes.filter(n => n.flag === 'concern' || n.flag === 'critical');
  const critical = notes.filter(n => n.flag === 'critical').length;
  const concern = notes.filter(n => n.flag === 'concern').length;
  document.getElementById('an-flags').textContent = flagged.length;
  document.getElementById('an-flags-sub').textContent = `${critical} critical · ${concern} concern`;

  // ── WEEKLY CHART ──
  const weeks = [];
  const weekLabels = [];
  for (let i = 7; i >= 0; i--) {
    const end = new Date(); end.setDate(end.getDate() - i * 7);
    const start = new Date(end); start.setDate(end.getDate() - 6);
    weekLabels.push(start.toLocaleDateString('en-US', { month:'short', day:'numeric' }));
    weeks.push(notes.filter(n => {
      if (!n.note_date) return false;
      const nd = new Date(n.note_date + 'T00:00:00');
      return nd >= start && nd <= end;
    }).length);
  }
  if (weeklyChart) { weeklyChart.destroy(); weeklyChart = null; }
  const ctx1 = document.getElementById('chart-weekly').getContext('2d');
  weeklyChart = new Chart(ctx1, {
    type: 'bar',
    data: { labels: weekLabels, datasets: [{ label: 'Notes', data: weeks, backgroundColor: '#b8860b', borderRadius: 5, borderSkipped: false }] },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
    }
  });

  // ── RESIDENT DOUGHNUT ──
  const resData = resNoteMap.sort((a,b) => b.count - a.count);
  if (residentChart) { residentChart.destroy(); residentChart = null; }
  const ctx2 = document.getElementById('chart-resident').getContext('2d');
  residentChart = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: resData.map(r => r.name),
      datasets: [{ data: resData.map(r => r.count), backgroundColor: ['#b8860b','#2c6e6a','#3d8c87','#5aada9','#7dc5c2','#d4a017','#a0d8d6'], borderWidth: 2 }]
    },
    options: { responsive: true, animation: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } } } }
  });

 // ── CALENDAR ──
  await renderCalendar(notes, incidents);

  // ── STAFF TABLE ──
  const tbody = document.getElementById('staff-table');
  const entries = Object.entries(staffMap);
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:32px;">No data yet</td></tr>';
    return;
  }
  tbody.innerHTML = entries.sort((a,b) => b[1].count - a[1].count).map(([name, d]) =>
    `<tr>
      <td style="font-weight:600;">${name}</td>
      <td>${d.count}</td>
      <td>${d.flags > 0 ? `<span class="badge badge-warn">${d.flags} flagged</span>` : '<span style="color:var(--text3);">None</span>'}</td>
      <td>${fmtDate(d.last)}</td>
    </tr>`
  ).join('');
}

// ══════════════════════════════════
// INCIDENT REPORTS
// ══════════════════════════════════
let viewingIncidentId = null;

function openAddIncidentReport() {
  document.getElementById('incident-modal-title').textContent = 'Add Incident Report';
  document.getElementById('ir-edit-id').value = '';
  document.getElementById('ir-resident-field').style.display = 'none';
  resetBodyMap();
  // Reset all fields
  ['ir-name','ir-location','ir-description','ir-emergency',
   'ir-w1-name','ir-w1-phone','ir-w2-name','ir-w2-phone',
   'ir-e1-name','ir-e1-phone','ir-e2-name','ir-e2-phone',
   'ir-physician-name','ir-hospital-name','ir-notif-other',
   'ir-prevention','ir-prepared-by','ir-i-other'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['ir-dob','ir-physician-date','ir-physician-time','ir-hospital-date','ir-hospital-time'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('ir-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ir-time').value = new Date().toTimeString().slice(0,5);
  document.getElementById('ir-prepared-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ir-prepared-by').value = currentUser.name;
  document.getElementById('ir-sex').value = '';
  ['ir-n-injury','ir-n-missing','ir-n-death','ir-n-fire','ir-n-fall',
   'ir-i-laceration','ir-i-hematoma','ir-i-abrasion','ir-i-burn','ir-i-non-apparent',
   'ir-notif-hcp','ir-notif-cm','ir-notif-rr','ir-notif-nok','ir-notif-le','ir-notif-dshs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  document.querySelectorAll('input[name="ir-physician"]').forEach(r => r.checked = false);
  document.querySelectorAll('input[name="ir-hospital"]').forEach(r => r.checked = false);
  openModal('modal-incident');
}

async function openAddIncidentGlobal() {
  const resField = document.getElementById('ir-resident-field');
  resField.style.display = 'block';
  const sel = document.getElementById('ir-resident-id');
  sel.innerHTML = '<option value="">— Select Resident —</option>';
  const residents = await getResidents();
  residents.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.name;
    sel.appendChild(opt);
  });
  sel.onchange = () => {
    const res = residents.find(r => r.id === sel.value);
    if (res) document.getElementById('ir-name').value = res.name;
  };
  document.getElementById('incident-modal-title').textContent = 'Add Incident Report';
  document.getElementById('ir-edit-id').value = '';
  resetBodyMap();
  ['ir-name','ir-location','ir-description','ir-emergency',
   'ir-w1-name','ir-w1-phone','ir-w2-name','ir-w2-phone',
   'ir-e1-name','ir-e1-phone','ir-e2-name','ir-e2-phone',
   'ir-physician-name','ir-hospital-name','ir-notif-other',
   'ir-prevention','ir-prepared-by','ir-i-other'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['ir-dob','ir-physician-date','ir-physician-time','ir-hospital-date','ir-hospital-time'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('ir-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ir-time').value = new Date().toTimeString().slice(0,5);
  document.getElementById('ir-prepared-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ir-prepared-by').value = currentUser.name;
  document.getElementById('ir-sex').value = '';
  ['ir-n-injury','ir-n-missing','ir-n-death','ir-n-fire','ir-n-fall',
   'ir-i-laceration','ir-i-hematoma','ir-i-abrasion','ir-i-burn','ir-i-non-apparent',
   'ir-notif-hcp','ir-notif-cm','ir-notif-rr','ir-notif-nok','ir-notif-le','ir-notif-dshs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  document.querySelectorAll('input[name="ir-physician"]').forEach(r => r.checked = false);
  document.querySelectorAll('input[name="ir-hospital"]').forEach(r => r.checked = false);
  openModal('modal-incident');
}

async function editIncidentReport(id, fromGlobal) {
  let r;
  if (fromGlobal) {
    const { data } = await db.from('incident_reports').select('*').eq('id', id).single();
    r = data;
  } else {
    const reports = await getIncidentReports(currentResidentId);
    r = reports.find(x => x.id === id);
  }
  if (!r) return;
  document.getElementById('incident-modal-title').textContent = 'Edit Incident Report';
  document.getElementById('ir-edit-id').value = id;
  document.getElementById('ir-name').value = r.resident_name || '';
  document.getElementById('ir-dob').value = r.dob || '';
  document.getElementById('ir-sex').value = r.sex || '';
  document.getElementById('ir-n-injury').checked = !!r.nature_injury;
  document.getElementById('ir-n-missing').checked = !!r.nature_missing;
  document.getElementById('ir-n-death').checked = !!r.nature_death;
  document.getElementById('ir-n-fire').checked = !!r.nature_fire;
  document.getElementById('ir-n-fall').checked = !!r.nature_fall;
  document.getElementById('ir-date').value = r.incident_date || '';
  document.getElementById('ir-time').value = r.incident_time || '';
  document.getElementById('ir-location').value = r.incident_location || '';
  document.getElementById('ir-description').value = r.description || '';
  document.getElementById('ir-i-laceration').checked = !!r.injury_laceration;
  document.getElementById('ir-i-hematoma').checked = !!r.injury_hematoma;
  document.getElementById('ir-i-abrasion').checked = !!r.injury_abrasion;
  document.getElementById('ir-i-burn').checked = !!r.injury_burn;
  document.getElementById('ir-i-non-apparent').checked = !!r.injury_non_apparent;
  document.getElementById('ir-i-other').value = r.injury_other || '';
  document.getElementById('ir-emergency').value = r.emergency_treatment || '';
  document.getElementById('ir-w1-name').value = r.witness1_name || '';
  document.getElementById('ir-w1-phone').value = r.witness1_phone || '';
  document.getElementById('ir-w2-name').value = r.witness2_name || '';
  document.getElementById('ir-w2-phone').value = r.witness2_phone || '';
  document.getElementById('ir-e1-name').value = r.employee1_name || '';
  document.getElementById('ir-e1-phone').value = r.employee1_phone || '';
  document.getElementById('ir-e2-name').value = r.employee2_name || '';
  document.getElementById('ir-e2-phone').value = r.employee2_phone || '';
  if (r.treated_physician === true) document.getElementById('ir-physician-yes').checked = true;
  else if (r.treated_physician === false) document.getElementById('ir-physician-no').checked = true;
  document.getElementById('ir-physician-name').value = r.physician_name || '';
  document.getElementById('ir-physician-date').value = r.physician_date || '';
  document.getElementById('ir-physician-time').value = r.physician_time || '';
  if (r.hospital_admission === true) document.getElementById('ir-hospital-yes').checked = true;
  else if (r.hospital_admission === false) document.getElementById('ir-hospital-no').checked = true;
  document.getElementById('ir-hospital-name').value = r.hospital_name || '';
  document.getElementById('ir-hospital-date').value = r.hospital_date || '';
  document.getElementById('ir-hospital-time').value = r.hospital_time || '';
  document.getElementById('ir-notif-hcp').checked = !!r.notified_health_care;
  document.getElementById('ir-notif-cm').checked = !!r.notified_case_manager;
  document.getElementById('ir-notif-rr').checked = !!r.notified_resident_rep;
  document.getElementById('ir-notif-nok').checked = !!r.notified_next_of_kin;
  document.getElementById('ir-notif-le').checked = !!r.notified_law_enforcement;
  document.getElementById('ir-notif-dshs').checked = !!r.notified_dshs;
  document.getElementById('ir-notif-other').value = r.notified_other || '';
  document.getElementById('ir-prevention').value = r.prevention_action || '';
  document.getElementById('ir-prepared-by').value = r.prepared_by || '';
  document.getElementById('ir-prepared-date').value = r.prepared_date || '';
  const irResField = document.getElementById('ir-resident-field');
  if (fromGlobal) {
    irResField.style.display = 'block';
    const sel = document.getElementById('ir-resident-id');
    sel.innerHTML = '<option value="">— Select Resident —</option>';
    const residents = await getResidents();
    residents.forEach(res => {
      const opt = document.createElement('option');
      opt.value = res.id; opt.textContent = res.name;
      if (res.id === r.resident_id) opt.selected = true;
      sel.appendChild(opt);
    });
  } else {
    irResField.style.display = 'none';
  }
  closeModal('modal-view-incident');
  openModal('modal-incident');
}

async function saveIncidentReportForm() {
  const name = document.getElementById('ir-name').value.trim();
  const date = document.getElementById('ir-date').value;
  if (!name || !date) { toast('Please fill in Resident Name and Incident Date'); return; }
  const editId = document.getElementById('ir-edit-id').value;
  const physicianYes = document.getElementById('ir-physician-yes').checked;
  const physicianNo = document.getElementById('ir-physician-no').checked;
  const hospitalYes = document.getElementById('ir-hospital-yes').checked;
  const hospitalNo = document.getElementById('ir-hospital-no').checked;
  const irResField = document.getElementById('ir-resident-field');
  const isGlobalIR = irResField && irResField.style.display !== 'none';
  const irResidentId = isGlobalIR ? document.getElementById('ir-resident-id').value : currentResidentId;
  if (isGlobalIR && !irResidentId) { toast('Please select a resident'); return; }
  const report = {
    id: editId || uid(),
    resident_id: irResidentId,
    resident_name: name,
    dob: document.getElementById('ir-dob').value,
    sex: document.getElementById('ir-sex').value,
    nature_injury: document.getElementById('ir-n-injury').checked,
    nature_missing: document.getElementById('ir-n-missing').checked,
    nature_death: document.getElementById('ir-n-death').checked,
    nature_fire: document.getElementById('ir-n-fire').checked,
    nature_fall: document.getElementById('ir-n-fall').checked,
    incident_date: date,
    incident_time: document.getElementById('ir-time').value,
    incident_location: document.getElementById('ir-location').value.trim(),
    description: document.getElementById('ir-description').value.trim(),
    injury_laceration: document.getElementById('ir-i-laceration').checked,
    injury_hematoma: document.getElementById('ir-i-hematoma').checked,
    injury_abrasion: document.getElementById('ir-i-abrasion').checked,
    injury_burn: document.getElementById('ir-i-burn').checked,
    injury_non_apparent: document.getElementById('ir-i-non-apparent').checked,
    injury_other: document.getElementById('ir-i-other').value.trim(),
    emergency_treatment: document.getElementById('ir-emergency').value.trim(),
    witness1_name: document.getElementById('ir-w1-name').value.trim(),
    witness1_phone: document.getElementById('ir-w1-phone').value.trim(),
    witness2_name: document.getElementById('ir-w2-name').value.trim(),
    witness2_phone: document.getElementById('ir-w2-phone').value.trim(),
    employee1_name: document.getElementById('ir-e1-name').value.trim(),
    employee1_phone: document.getElementById('ir-e1-phone').value.trim(),
    employee2_name: document.getElementById('ir-e2-name').value.trim(),
    employee2_phone: document.getElementById('ir-e2-phone').value.trim(),
    treated_physician: physicianYes ? true : physicianNo ? false : null,
    physician_name: document.getElementById('ir-physician-name').value.trim(),
    physician_date: document.getElementById('ir-physician-date').value,
    physician_time: document.getElementById('ir-physician-time').value,
    hospital_admission: hospitalYes ? true : hospitalNo ? false : null,
    hospital_name: document.getElementById('ir-hospital-name').value.trim(),
    hospital_date: document.getElementById('ir-hospital-date').value,
    hospital_time: document.getElementById('ir-hospital-time').value,
    notified_health_care: document.getElementById('ir-notif-hcp').checked,
    notified_case_manager: document.getElementById('ir-notif-cm').checked,
    notified_resident_rep: document.getElementById('ir-notif-rr').checked,
    notified_next_of_kin: document.getElementById('ir-notif-nok').checked,
    notified_law_enforcement: document.getElementById('ir-notif-le').checked,
    notified_dshs: document.getElementById('ir-notif-dshs').checked,
    notified_other: document.getElementById('ir-notif-other').value.trim(),
    prevention_action: document.getElementById('ir-prevention').value.trim(),
    prepared_by: document.getElementById('ir-prepared-by').value.trim(),
    prepared_date: document.getElementById('ir-prepared-date').value,
    body_regions: getBodyRegionsText(),
    created_at: new Date().toISOString()
  };
  await saveIncidentReport(report);
  closeModal('modal-incident');
  toast(editId ? 'Incident report updated' : 'Incident report saved');
  renderProfileIncidents();
}

async function renderProfileIncidents() {
  const reports = await getIncidentReports(currentResidentId);
  const container = document.getElementById('profile-incidents-list');
  if (!reports.length) {
    container.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <h4>No Incident Reports Yet</h4>
      <p>Use the Incident Report button above to file a report.</p>
    </div>`;
    return;
  }
  container.innerHTML = reports.map(r => {
    const natures = [r.nature_injury&&'Injury', r.nature_missing&&'Missing', r.nature_death&&'Death', r.nature_fire&&'Fire/Disaster', r.nature_fall&&'Fall'].filter(Boolean).join(', ') || 'Unspecified';
    const preview = (r.description || '—').slice(0, 100);
    return `<div class="note-card" onclick="viewIncidentReport('${r.id}')">
      <div class="note-card-header">
        <div>
          <div class="note-date">${fmtDate(r.incident_date)} ${r.incident_time ? '· ' + r.incident_time : ''}</div>
          <div class="note-staff">Nature: ${natures} · Prepared by ${r.prepared_by}</div>
        </div>
        <div class="note-actions" onclick="event.stopPropagation()">
          <button class="btn btn-secondary btn-sm" onclick="editIncidentReport('${r.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteIncidentReport('${r.id}')">Delete</button>
        </div>
      </div>
      <div class="note-preview">${preview}${preview.length >= 100 ? '…' : ''}</div>
    </div>`;
  }).join('');
}

async function deleteIncidentReport(id) {
  if (!confirm('Delete this incident report? This cannot be undone.')) return;
  await deleteIncidentReportFromDb(id);
  renderProfileIncidents();
  closeModal('modal-view-incident');
  toast('Incident report deleted');
}

function cb(val) { return val ? '☑' : '☐'; }
function yn(val) { if (val === true) return 'Yes'; if (val === false) return 'No'; return '—'; }

async function viewIncidentReport(id) {
  const reports = await getIncidentReports(currentResidentId);
  const r = reports.find(x => x.id === id);
  if (!r) return;
  viewingIncidentId = id;
  const fv = (val) => val ? `<span style="color:var(--text)">${val}</span>` : `<span style="color:var(--text3);font-style:italic;">Not recorded</span>`;

  document.getElementById('incident-view-body').innerHTML = `
    <div style="background:var(--danger-light);border-radius:var(--radius);padding:16px;margin-bottom:20px;">
      <div style="font-weight:700;font-size:17px;">${r.resident_name}</div>
      <div style="font-size:13px;color:var(--text2);margin-top:4px;">
        ${fmtDate(r.incident_date)} ${r.incident_time ? 'at ' + r.incident_time : ''} · ${r.incident_location || 'Location not recorded'}
      </div>
    </div>

    <div class="note-section">
      <div class="note-section-title">Basic Information</div>
      <div class="note-grid">
        <div class="note-field"><div class="field-label">DOB</div>${fv(fmtDate(r.dob))}</div>
        <div class="note-field"><div class="field-label">Sex</div>${fv(r.sex)}</div>
      </div>
    </div>

    <div class="note-section">
      <div class="note-section-title">Nature of Incident</div>
      <div style="font-size:13.5px;display:flex;flex-wrap:wrap;gap:12px;">
        <span>${cb(r.nature_injury)} Resident/Staff Injury</span>
        <span>${cb(r.nature_missing)} Resident Missing</span>
        <span>${cb(r.nature_death)} Death of Resident</span>
        <span>${cb(r.nature_fire)} Fire/Natural Disaster</span>
        <span>${cb(r.nature_fall)} Fall</span>
      </div>
    </div>

    <div class="note-section">
      <div class="note-section-title">Description of Incident</div>
      <div class="note-field"><div class="field-value" style="white-space:pre-wrap;line-height:1.8;">${r.description || '<span style="color:var(--text3);font-style:italic;">Not recorded</span>'}</div></div>
    </div>

    <div class="note-section">
      <div class="note-section-title">Type of Injury</div>
      <div style="font-size:13.5px;display:flex;flex-wrap:wrap;gap:12px;margin-bottom:8px;">
        <span>${cb(r.injury_laceration)} Laceration (cut)</span>
        <span>${cb(r.injury_hematoma)} Hematoma (bruise)</span>
        <span>${cb(r.injury_abrasion)} Abrasion (scrape)</span>
        <span>${cb(r.injury_burn)} Burn</span>
        <span>${cb(r.injury_non_apparent)} Non-Apparent</span>
      </div>
      ${r.injury_other ? `<div class="note-field"><div class="field-label">Other</div>${fv(r.injury_other)}</div>` : ''}
      <div class="note-field"><div class="field-label">Emergency Treatment Given</div>${fv(r.emergency_treatment)}</div>
      ${r.body_regions ? `<div class="note-field"><div class="field-label">Body Regions Affected</div><div class="field-value">${r.body_regions}</div></div>` : ''}
    </div>

    <div class="note-section">
      <div class="note-section-title">Witnesses &amp; Employees</div>
      <div class="note-grid">
        <div class="note-field"><div class="field-label">Witness 1</div>${fv(r.witness1_name)} ${r.witness1_phone ? '· ' + r.witness1_phone : ''}</div>
        <div class="note-field"><div class="field-label">Witness 2</div>${fv(r.witness2_name)} ${r.witness2_phone ? '· ' + r.witness2_phone : ''}</div>
        <div class="note-field"><div class="field-label">Employee 1</div>${fv(r.employee1_name)} ${r.employee1_phone ? '· ' + r.employee1_phone : ''}</div>
        <div class="note-field"><div class="field-label">Employee 2</div>${fv(r.employee2_name)} ${r.employee2_phone ? '· ' + r.employee2_phone : ''}</div>
      </div>
    </div>

    <div class="note-section">
      <div class="note-section-title">Medical Treatment</div>
      <div class="note-grid">
        <div class="note-field"><div class="field-label">Treated by Physician</div>${fv(yn(r.treated_physician))} ${r.physician_name ? '· ' + r.physician_name : ''} ${r.physician_date ? '· ' + fmtDate(r.physician_date) : ''} ${r.physician_time ? r.physician_time : ''}</div>
        <div class="note-field"><div class="field-label">Hospital Admission</div>${fv(yn(r.hospital_admission))} ${r.hospital_name ? '· ' + r.hospital_name : ''} ${r.hospital_date ? '· ' + fmtDate(r.hospital_date) : ''} ${r.hospital_time ? r.hospital_time : ''}</div>
      </div>
    </div>

    <div class="note-section">
      <div class="note-section-title">Individuals Notified</div>
      <div style="font-size:13.5px;display:flex;flex-wrap:wrap;gap:12px;margin-bottom:8px;">
        <span>${cb(r.notified_health_care)} Health Care Provider</span>
        <span>${cb(r.notified_case_manager)} Case Manager</span>
        <span>${cb(r.notified_resident_rep)} Resident Representative</span>
        <span>${cb(r.notified_next_of_kin)} Next-of-Kin</span>
        <span>${cb(r.notified_law_enforcement)} Law Enforcement</span>
        <span>${cb(r.notified_dshs)} DSHS Hotline</span>
      </div>
      ${r.notified_other ? `<div class="note-field"><div class="field-label">Other</div>${fv(r.notified_other)}</div>` : ''}
    </div>

    <div class="note-section">
      <div class="note-section-title">Prevention &amp; Preparation</div>
      <div class="note-field"><div class="field-label">Action to Prevent Reoccurrence</div><div class="field-value" style="white-space:pre-wrap;line-height:1.8;">${r.prevention_action || '<span style="color:var(--text3);font-style:italic;">Not recorded</span>'}</div></div>
      <div class="note-grid" style="margin-top:10px;">
        <div class="note-field"><div class="field-label">Prepared By</div>${fv(r.prepared_by)}</div>
        <div class="note-field"><div class="field-label">Date Prepared</div>${fv(fmtDate(r.prepared_date))}</div>
      </div>
    </div>
  `;

  document.getElementById('incident-view-footer').innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal('modal-view-incident')">Close</button>
    <button class="btn btn-secondary" onclick="editIncidentReport('${id}')">Edit</button>
    <button class="btn btn-danger" onclick="deleteIncidentReport('${id}')">Delete</button>
  `;
  openModal('modal-view-incident');
}

function buildIncidentHTML(r) {
  // Washington State timezone for printed date
  const now = new Date();
  const printedAt = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
  void printedAt; // used in template below
  const chk = (val) => val ? '&#9745;' : '&#9744;';
  const yesNo = (val) => val === true ? 'Yes' : val === false ? 'No' : '';
  const blank = (label, val, width) => `<span style="display:inline-block;min-width:${width||120}px;border-bottom:1px solid #000;margin:0 4px;font-size:11px;">${val||''}</span>`;
  const descText = (r.description || '').trim();
  const preventText = (r.prevention_action || '').trim();

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Incident Report — ${r.resident_name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', Times, serif; background: #fff; color: #000; padding: 36px 48px; width: 816px; margin: 0 auto; font-size: 11.5px; }
  .header { text-align: center; margin-bottom: 14px; }
  .header img { width: 70px; height: 70px; object-fit: contain; display: block; margin: 0 auto 6px; }
  .org-name { font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px; }
  .doc-title { font-size: 14px; font-weight: bold; text-decoration: underline; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px; }
  .field-row { margin-bottom: 10px; font-size: 11.5px; }
  .underline { display: inline-block; border-bottom: 1px solid #000; min-width: 140px; margin: 0 3px; font-size: 11px; padding: 0 2px; }
  .check-row { display: flex; flex-wrap: wrap; gap: 18px 32px; margin: 6px 0; font-size: 11.5px; }
  .check-item { display: inline-flex; align-items: center; gap: 4px; }
  .section { margin: 12px 0 6px; font-weight: bold; font-size: 11.5px; }
  .desc-box { border: 1px solid #000; padding: 6px 8px; font-size: 11px; line-height: 1.8; white-space: pre-wrap; word-wrap: break-word; }
  .sig-line { border-bottom: 1px solid #000; display: inline-block; min-width: 180px; margin: 0 4px; }
  @media print { body { padding: 24px 36px; } @page { size: letter; margin: 0.5in; } }
</style></head><body>
<div class="header">
  <img src="harmony_living_house_logo.png" alt="Logo">
  <div class="org-name">Harmony Living House Adult Family LLC</div>
  <div class="doc-title">Incident Report</div>
</div>

<div class="field-row">
  <strong>Name of Resident/Staff involved in Incidents:</strong>
  <span class="underline">${r.resident_name||''}</span>
  <strong>DOB:</strong><span class="underline" style="min-width:90px;">${r.dob ? new Date(r.dob+'T00:00:00').toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'}) : ''}</span>
  <strong>Sex:</strong><span class="underline" style="min-width:80px;">${r.sex||''}</span>
</div>

<div class="section">Nature of Incident:</div>
<div class="check-row">
  <span class="check-item">${chk(r.nature_injury)} Resident/Staff Injury</span>
  <span class="check-item">${chk(r.nature_missing)} Resident Missing</span>
  <span class="check-item">${chk(r.nature_death)} Death of Resident</span>
  <span class="check-item">${chk(r.nature_fire)} Fire/Natural Disaster</span>
  <span class="check-item">${chk(r.nature_fall)} Fall</span>
</div>

<div class="field-row" style="margin-top:10px;">
  <strong>Date Incident Occurred:</strong><span class="underline">${r.incident_date ? new Date(r.incident_date+'T00:00:00').toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'}) : ''}</span>
  <strong>Time:</strong><span class="underline" style="min-width:90px;">${r.incident_time||''}</span>
  <strong>Location:</strong><span class="underline" style="min-width:160px;">${r.incident_location||''}</span>
</div>

<div class="section" style="margin-top:10px;">Description of Incident <span style="font-weight:normal;font-size:10.5px;">(use specific behavioral terms and include actions taken by providers/staff):</span></div>
<div class="desc-box">${descText || '&nbsp;'}</div>

<div class="section" style="margin-top:14px;">TYPE OF INJURY:</div>
<div class="check-row">
  <span class="check-item">${chk(r.injury_laceration)} Laceration(cut)</span>
  <span class="check-item">${chk(r.injury_hematoma)} Hematoma(bruise)</span>
  <span class="check-item">${chk(r.injury_abrasion)} Abrasion (scrape)</span>
  <span class="check-item">${chk(r.injury_burn)} Burn</span>
  <span class="check-item">${chk(r.injury_non_apparent)} Non-Apparent</span>
  <span class="check-item">Other (specify): <span class="underline" style="min-width:120px;">${r.injury_other||''}</span></span>
</div>

<div class="field-row" style="margin-top:10px;">
  <strong>Emergency Treatment Given (if any):</strong><span class="underline" style="min-width:300px;">${r.emergency_treatment||''}</span>
</div>
${r.body_regions ? `<div class="field-row"><strong>Body Regions Affected:</strong> ${r.body_regions}</div>` : ''}

<div style="margin:10px 0 4px;"><strong>Witness(es)</strong> &nbsp;&nbsp;&nbsp; <strong>Phone</strong> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>Employee(s) Involved</strong> &nbsp;&nbsp;&nbsp; <strong>Phone</strong></div>
<div style="border:1px solid #000;padding:4px 6px;min-height:22px;font-size:11px;margin-bottom:2px;">${r.witness1_name||''} &nbsp;&nbsp; ${r.witness1_phone||''} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${r.employee1_name||''} &nbsp;&nbsp; ${r.employee1_phone||''}</div>
<div style="border:1px solid #000;border-top:none;padding:4px 6px;min-height:22px;font-size:11px;margin-bottom:8px;">${r.witness2_name||''} &nbsp;&nbsp; ${r.witness2_phone||''} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${r.employee2_name||''} &nbsp;&nbsp; ${r.employee2_phone||''}</div>

<div class="field-row">
  <strong>Treated by Physician:</strong>
  <span class="check-item">${chk(r.treated_physician===true)} Yes</span> &nbsp;
  <span class="check-item">${chk(r.treated_physician===false)} No</span> &nbsp;
  <strong>Name</strong><span class="underline" style="min-width:140px;">${r.physician_name||''}</span>
  <strong>Date</strong><span class="underline" style="min-width:80px;">${r.physician_date ? new Date(r.physician_date+'T00:00:00').toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'}) : ''}</span>
  <strong>Time</strong><span class="underline" style="min-width:70px;">${r.physician_time||''}</span>
</div>

<div class="field-row">
  <strong>Hospital Admission:</strong>
  <span class="check-item">${chk(r.hospital_admission===true)} Yes</span> &nbsp;
  <span class="check-item">${chk(r.hospital_admission===false)} No</span> &nbsp;
  <strong>Name</strong><span class="underline" style="min-width:140px;">${r.hospital_name||''}</span>
  <strong>Date</strong><span class="underline" style="min-width:80px;">${r.hospital_date ? new Date(r.hospital_date+'T00:00:00').toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'}) : ''}</span>
  <strong>Time</strong><span class="underline" style="min-width:70px;">${r.hospital_time||''}</span>
</div>

<div class="section">Individual Notified <span style="font-weight:normal;font-size:10.5px;">(Indicate date and time notified):</span></div>
<div class="check-row">
  <span class="check-item">${chk(r.notified_health_care)} Health Care Provider</span>
  <span class="check-item">${chk(r.notified_case_manager)} Case Manager</span>
  <span class="check-item">${chk(r.notified_resident_rep)} Resident Representative</span>
  <span class="check-item">${chk(r.notified_next_of_kin)} Next-of-Kin</span>
  <span class="check-item">${chk(r.notified_law_enforcement)} Law Enforcement</span>
  <span class="check-item">${chk(r.notified_dshs)} DSHS Hotline</span>
  ${r.notified_other ? `<span class="check-item">Other: <span class="underline">${r.notified_other}</span></span>` : ''}
</div>

<div class="section" style="margin-top:12px;">Action to be taken to prevent the reoccurrence of the incident:</div>
<div class="desc-box" style="margin-bottom:8px;">${preventText || '&nbsp;'}</div>

<div class="field-row" style="margin-top:14px;">
  <strong>Prepared By: Print Name/Title:</strong><span class="underline" style="min-width:160px;">${r.prepared_by||''}</span>
  <strong>Signature:</strong><span class="underline" style="min-width:140px;"></span>
  <strong>Date:</strong><span class="underline" style="min-width:90px;">${r.prepared_date ? new Date(r.prepared_date+'T00:00:00').toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'}) : ''}</span>
</div>
</body></html>`;
}

async function printIncidentReport() {
  const reports = await getIncidentReports(currentResidentId);
  const r = reports.find(x => x.id === viewingIncidentId);
  if (!r) return;
  const win = window.open('', '_blank', 'width=900,height=1100');
  win.document.write(buildIncidentHTML(r));
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.addEventListener('afterprint', () => { win.close(); window.focus(); });
  }, 700);
}

async function exportIncidentPDF() {
  const reports = await getIncidentReports(currentResidentId);
  const r = reports.find(x => x.id === viewingIncidentId);
  if (!r) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const html = buildIncidentHTML(r);
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:816px;background:#fff;';
  container.innerHTML = html.replace(/<html>[\s\S]*?<body[^>]*>/i,'').replace(/<\/body>[\s\S]*?<\/html>/i,'');
  document.body.appendChild(container);
  doc.html(container, {
    callback: (d) => {
      document.body.removeChild(container);
      const safeName = r.resident_name.replace(/\s+/g,'_');
      d.save(`IncidentReport_${safeName}_${r.incident_date}.pdf`);
      setTimeout(() => window.focus(), 300);
    },
    x: 36, y: 20, width: 540, windowWidth: 816
  });
}

// ══════════════════════════════════
// MODAL HELPERS
// ══════════════════════════════════
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal-overlay.open');
    if (open) open.classList.remove('open');
  }
});

// ══════════════════════════════════
// TOAST
// ══════════════════════════════════
let toastTimer;
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('hlh_theme', next);
  const btn = document.getElementById('dark-mode-btn');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.style.display = 'none', 2800);
}

// ══════════════════════════════════
// PROFILE TABS
// ══════════════════════════════════
function switchProfileTab(tab) {
  ['notes','vitals','medications','adl','appointments','incidents'].forEach(t => {
    document.getElementById('profile-tab-' + t).style.display = t === tab ? 'block' : 'none';
    document.getElementById('ptab-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'vitals') renderVitals();
  if (tab === 'medications') renderMedications();
  if (tab === 'incidents') renderProfileIncidents();
  if (tab === 'adl') renderADL();
  if (tab === 'appointments') renderAppointments();
}

// ══════════════════════════════════
// RESIDENT PHOTO
// ══════════════════════════════════
function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    // Save to supabase residents table
    await db.from('residents').update({ photo: dataUrl }).eq('id', currentResidentId);
    showResidentPhoto(dataUrl);
    toast('Photo updated');
  };
  reader.readAsDataURL(file);
}

function showResidentPhoto(dataUrl) {
  const img = document.getElementById('profile-photo-img');
  const avatar = document.getElementById('profile-avatar');
  if (dataUrl) {
    img.src = dataUrl;
    img.style.display = 'block';
    avatar.style.display = 'none';
  } else {
    img.style.display = 'none';
    avatar.style.display = 'flex';
  }
}

// ══════════════════════════════════
// RESIDENT STATUS
// ══════════════════════════════════
async function saveResidentStatus() {
  const status = document.getElementById('profile-status-select').value;
  const { error } = await db.from('residents').update({ status }).eq('id', currentResidentId);
  if (error) { toast('Error saving status: ' + error.message); return; }
  toast('✅ Status updated');

  // Re-render all pages that reflect resident status
  await Promise.all([
    renderResidentTable(),
    refreshDashboard(),
    renderPaymentsPage(),
  ]);

  // Re-render the days counter on the profile immediately
  const residents = await getResidents();
  const res = residents.find(r => r.id === currentResidentId);
  if (!res) return;
  const daysEl = document.getElementById('profile-days-admitted');
  if (daysEl) {
    const days = calcDaysAdmitted(res);
    if (days !== null) {
      daysEl.innerHTML = `<span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.6);">Days in Facility</span><br><span style="font-size:22px;font-weight:700;color:#fff;">${days}</span>`;
    } else {
      daysEl.innerHTML = `<span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.6);">Status</span><br><span style="font-size:14px;font-weight:700;color:#f5c6c2;">Discharged</span>`;
    }
  }
}

// ══════════════════════════════════
// BIRTHDAY ALERTS
// ══════════════════════════════════
function checkBirthday(res) {
  if (!res.dob) return;
  const today = new Date();
  const dob = new Date(res.dob + 'T00:00:00');
  const thisYearBday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
  const diff = Math.round((thisYearBday - today) / (1000 * 60 * 60 * 24));
  const banner = document.getElementById('birthday-banner');
  const bannerText = document.getElementById('birthday-banner-text');
  if (diff === 0) {
    banner.style.display = 'flex';
    bannerText.textContent = `Today is ${res.name.split(' ')[0]}'s birthday! 🎉 Wishing them a wonderful day.`;
  } else if (diff > 0 && diff <= 7) {
    banner.style.display = 'flex';
    bannerText.textContent = `${res.name.split(' ')[0]}'s birthday is in ${diff} day${diff > 1 ? 's' : ''}!`;
  } else {
    banner.style.display = 'none';
  }
}

// ══════════════════════════════════
// VITALS
// ══════════════════════════════════
async function getVitals(residentId) {
  const { data } = await db.from('vitals').select('*').eq('resident_id', residentId).order('vitals_date', { ascending: false });
  return data || [];
}

async function renderVitals() {
  const vitals = await getVitals(currentResidentId);
  const tbody = document.getElementById('vitals-tbody');
  if (!vitals.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px;">No vitals recorded yet. Add the first entry above.</td></tr>';
    return;
  }
  tbody.innerHTML = vitals.map(v => `
    <tr>
      <td style="font-weight:600;">${fmtDate(v.vitals_date)}</td>
      <td>${v.bp || '—'}</td>
      <td>${v.temp || '—'}</td>
      <td>${v.pulse || '—'}</td>
      <td>${v.rr || '—'}</td>
      <td>${v.o2_sat || '—'}</td>
      <td>${v.weight || '—'}</td>
      <td>${v.recorded_by || '—'}</td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn-danger btn-sm" onclick="deleteVitals('${v.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

function openAddVitals() {
  document.getElementById('vitals-edit-id').value = '';
  document.getElementById('vitals-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('vitals-by').value = currentUser.name;
  ['vitals-bp','vitals-temp','vitals-pulse','vitals-rr','vitals-o2','vitals-weight'].forEach(id => {
    document.getElementById(id).value = '';
  });
  openModal('modal-vitals');
}

async function saveVitals() {
  const date = document.getElementById('vitals-date').value;
  const by = document.getElementById('vitals-by').value.trim();
  if (!date || !by) { toast('Please fill in Date and Recorded By'); return; }
  const entry = {
    id: uid(),
    resident_id: currentResidentId,
    vitals_date: date,
    bp: document.getElementById('vitals-bp').value.trim(),
    temp: document.getElementById('vitals-temp').value.trim(),
    pulse: document.getElementById('vitals-pulse').value.trim(),
    rr: document.getElementById('vitals-rr').value.trim(),
    o2_sat: document.getElementById('vitals-o2').value.trim(),
    weight: document.getElementById('vitals-weight').value.trim(),
    recorded_by: by,
    created_at: new Date().toISOString()
  };
  await db.from('vitals').insert(entry);
  closeModal('modal-vitals');
  toast('Vitals saved');
  renderVitals();
}

async function deleteVitals(id) {
  if (!confirm('Delete this vitals entry?')) return;
  await db.from('vitals').delete().eq('id', id);
  renderVitals();
  toast('Vitals entry deleted');
}

async function printVitalsSheet() {
  const residents = await getResidents();
  const res = residents.find(r => r.id === currentResidentId);
  const vitals = await getVitals(currentResidentId);
  const resName = res ? res.name : '';
  const dob = res ? fmtDate(res.dob) : '';

  const win = window.open('', '_blank', 'width=1100,height=850');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Vitals Sheet — ${resName}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Times New Roman',Times,serif; background:#fff; color:#000; padding:28px 36px; width:1050px; margin:0 auto; }
  .header { text-align:center; margin-bottom:16px; }
  .header img { width:70px; height:70px; object-fit:contain; display:block; margin:0 auto 8px; }
  .org { font-size:15px; font-weight:bold; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:2px; }
  .addr { font-size:11px; margin-bottom:6px; font-style:italic; }
  .title { font-size:16px; font-weight:bold; text-decoration:underline; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:14px; }
  table { width:100%; border-collapse:collapse; }
  th { background:#b8860b; color:#fff; border:1px solid #8a6408; padding:7px 5px; font-size:11.5px; font-weight:bold; text-align:center; letter-spacing:0.02em; }
  td { border:1px solid #000; padding:4px 5px; font-size:13px; height:26px; font-family:'Times New Roman',Times,serif; }
  .divider-col { background:#5a4000; border:2px solid #5a4000; width:10px; padding:0; }
  th.divider-col { background:#5a4000; border:2px solid #3a2800; }
  .footer { margin-top:18px; font-size:12px; }
  .footer-line { border-bottom:1px solid #000; display:inline-block; min-width:280px; margin-left:6px; }
  @media print { body { padding:18px 24px; } @page { size:landscape; margin:0.4in; } }
</style></head><body>
<div class="header">
  <img src="harmony_living_house_logo.png" alt="Logo">
  <div class="org">Harmony Living House Adult Family LLC</div>
  <div class="addr">120 Newaukum Village Dr &nbsp;|&nbsp; Chehalis, WA 98532</div>
  <div class="title">Vitals Sheet</div>
</div>
<table>
  <thead>
    <tr>
      <th style="min-width:90px;">Date</th>
      <th>BP<br><span style="font-weight:normal;font-size:10px;">(mmHg)</span></th>
      <th>Temp<br><span style="font-weight:normal;font-size:10px;">(°F)</span></th>
      <th>Pulse<br><span style="font-weight:normal;font-size:10px;">(bpm)</span></th>
      <th>RR<br><span style="font-weight:normal;font-size:10px;">(breaths/min)</span></th>
      <th>O2 Sat<br><span style="font-weight:normal;font-size:10px;">(%)</span></th>
      <th>Weight<br><span style="font-weight:normal;font-size:10px;">(lbs)</span></th>
      <th class="divider-col"></th>
      <th style="min-width:90px;">Date</th>
      <th>BP<br><span style="font-weight:normal;font-size:10px;">(mmHg)</span></th>
      <th>Temp<br><span style="font-weight:normal;font-size:10px;">(°F)</span></th>
      <th>Pulse<br><span style="font-weight:normal;font-size:10px;">(bpm)</span></th>
      <th>RR<br><span style="font-weight:normal;font-size:10px;">(breaths/min)</span></th>
      <th>O2 Sat<br><span style="font-weight:normal;font-size:10px;">(%)</span></th>
      <th>Weight<br><span style="font-weight:normal;font-size:10px;">(lbs)</span></th>
    </tr>
  </thead>
  <tbody>
    ${Array.from({ length: 15 }, (_, i) => {
      const v = vitals[i] || null;
      const v2 = vitals[i + 15] || null;
      const col = (val) => `<td style="font-size:14px;">${val || ''}</td>`;
      return `<tr>
        ${col(v ? fmtDate(v.vitals_date) : '')}
        ${col(v ? v.bp : '')}${col(v ? v.temp : '')}${col(v ? v.pulse : '')}${col(v ? v.rr : '')}${col(v ? v.o2_sat : '')}${col(v ? v.weight : '')}
        <td class="divider-col"></td>
        ${col(v2 ? fmtDate(v2.vitals_date) : '')}
        ${col(v2 ? v2.bp : '')}${col(v2 ? v2.temp : '')}${col(v2 ? v2.pulse : '')}${col(v2 ? v2.rr : '')}${col(v2 ? v2.o2_sat : '')}${col(v2 ? v2.weight : '')}
      </tr>`;
    }).join('')}
  </tbody>
</table>
<div class="footer" style="margin-top:20px;">
  <div style="margin-bottom:10px;font-size:13px;"><strong>Resident's Name:</strong> <span class="footer-line" style="font-size:13px;">${resName}</span></div>
  <div style="font-size:13px;"><strong>Date of Birth:</strong> <span class="footer-line" style="min-width:160px;font-size:13px;">${dob}</span></div>
</div>
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.addEventListener('afterprint', () => { win.close(); window.focus(); });
  }, 700);
}

// ══════════════════════════════════
// MEDICATIONS
// ══════════════════════════════════
async function getMedications(residentId) {
  const { data } = await db.from('medications').select('*').eq('resident_id', residentId).order('created_at', { ascending: false });
  return data || [];
}

async function renderMedications() {
  const meds = await getMedications(currentResidentId);
  const container = document.getElementById('medications-list');
  if (!meds.length) {
    container.innerHTML = `<div class="empty-state">
      <div style="font-size:48px;margin-bottom:12px;">💊</div>
      <h4>No Medications Recorded</h4>
      <p>Add the first medication for this resident using the button above.</p>
    </div>`;
    return;
  }
  const statusColors = { active: 'badge-green', discontinued: 'badge-red', onhold: 'badge-warn' };
  container.innerHTML = meds.map(m => `
    <div class="med-card">
      <div class="med-icon">💊</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div class="med-name">${m.name}</div>
          <span class="badge ${statusColors[m.status] || 'badge-green'}" style="text-transform:capitalize;">${m.status || 'Active'}</span>
        </div>
        <div class="med-detail">
          <strong>Dosage:</strong> ${m.dosage || '—'} &nbsp;·&nbsp;
          <strong>Frequency:</strong> ${m.frequency || '—'} &nbsp;·&nbsp;
          <strong>Route:</strong> ${m.route || '—'}<br>
          ${m.physician ? `<strong>Physician:</strong> ${m.physician} &nbsp;·&nbsp; ` : ''}
          ${m.start_date ? `<strong>Started:</strong> ${fmtDate(m.start_date)}` : ''}
          ${m.end_date ? ` &nbsp;·&nbsp; <strong>End:</strong> ${fmtDate(m.end_date)}` : ''}
          ${m.notes ? `<br><strong>Notes:</strong> ${m.notes}` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" onclick="editMedication('${m.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteMedication('${m.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function openAddMedication() {
  document.getElementById('med-modal-title').textContent = 'Add Medication';
  document.getElementById('med-edit-id').value = '';
  ['med-name','med-dosage','med-physician','med-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('med-frequency').value = '';
  document.getElementById('med-route').value = '';
  document.getElementById('med-status').value = 'active';
  document.getElementById('med-start').value = new Date().toISOString().split('T')[0];
  document.getElementById('med-end').value = '';
  openModal('modal-medication');
}

async function editMedication(id) {
  const meds = await getMedications(currentResidentId);
  const m = meds.find(x => x.id === id);
  if (!m) return;
  document.getElementById('med-modal-title').textContent = 'Edit Medication';
  document.getElementById('med-edit-id').value = id;
  document.getElementById('med-name').value = m.name || '';
  document.getElementById('med-dosage').value = m.dosage || '';
  document.getElementById('med-frequency').value = m.frequency || '';
  document.getElementById('med-route').value = m.route || '';
  document.getElementById('med-physician').value = m.physician || '';
  document.getElementById('med-start').value = m.start_date || '';
  document.getElementById('med-end').value = m.end_date || '';
  document.getElementById('med-status').value = m.status || 'active';
  document.getElementById('med-notes').value = m.notes || '';
  openModal('modal-medication');
}

async function saveMedication() {
  const name = document.getElementById('med-name').value.trim();
  const dosage = document.getElementById('med-dosage').value.trim();
  if (!name || !dosage) { toast('Please fill in Medication Name and Dosage'); return; }
  const editId = document.getElementById('med-edit-id').value;
  const med = {
    id: editId || uid(),
    resident_id: currentResidentId,
    name, dosage,
    frequency: document.getElementById('med-frequency').value,
    route: document.getElementById('med-route').value,
    physician: document.getElementById('med-physician').value.trim(),
    start_date: document.getElementById('med-start').value,
    end_date: document.getElementById('med-end').value,
    status: document.getElementById('med-status').value,
    notes: document.getElementById('med-notes').value.trim(),
    created_at: new Date().toISOString()
  };
  await db.from('medications').upsert(med);
  closeModal('modal-medication');
  toast(editId ? 'Medication updated' : 'Medication added');
  renderMedications();
}

async function deleteMedication(id) {
  if (!confirm('Delete this medication record?')) return;
  await db.from('medications').delete().eq('id', id);
  renderMedications();
  toast('Medication deleted');
}

// ══════════════════════════════════
// BODY MAP
// ══════════════════════════════════
let selectedBodyRegions = {};

function toggleBodyRegion(el) {
  const region = el.getAttribute('data-region');
  const label = el.getAttribute('data-label');
  if (selectedBodyRegions[region]) {
    delete selectedBodyRegions[region];
    el.classList.remove('selected');
  } else {
    selectedBodyRegions[region] = label;
    el.classList.add('selected');
  }
  updateBodyMapLegend();
}

function updateBodyMapLegend() {
  const legend = document.getElementById('ir-body-legend');
  const entries = Object.entries(selectedBodyRegions);
  if (!entries.length) {
    legend.innerHTML = '<span style="color:var(--text3);font-style:italic;background:none;border:none;">None selected</span>';
    return;
  }
  legend.innerHTML = entries.map(([num, label]) =>
    `<span onclick="deselectRegion('${num}')" title="Click to deselect">#${num} ${label}</span>`
  ).join('');
}

function deselectRegion(num) {
  delete selectedBodyRegions[num];
  document.querySelectorAll(`.body-region[data-region="${num}"]`).forEach(el => el.classList.remove('selected'));
  updateBodyMapLegend();
}

function resetBodyMap() {
  selectedBodyRegions = {};
  document.querySelectorAll('.body-region.selected').forEach(el => el.classList.remove('selected'));
  updateBodyMapLegend();
}

function getBodyRegionsText() {
  const entries = Object.entries(selectedBodyRegions);
  if (!entries.length) return '';
  return entries.map(([num, label]) => `#${num} ${label}`).join(', ');
}

// ══════════════════════════════════
// CALENDAR VIEW (Analytics)
// ══════════════════════════════════
let calCurrentDate = new Date();
let calPopup = null;

async function renderCalendar(notes, incidents) {
  const year = calCurrentDate.getFullYear();
  const month = calCurrentDate.getMonth();
  const today = new Date();

  const monthName = calCurrentDate.toLocaleDateString('en-US', { month:'long', year:'numeric' });
  document.getElementById('cal-month-label').textContent = monthName;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Build note/incident lookup by date string
  const notesByDate = {};
  notes.forEach(n => {
    if (!n.note_date) return;
    if (!notesByDate[n.note_date]) notesByDate[n.note_date] = [];
    notesByDate[n.note_date].push(n);
  });
  const incidentsByDate = {};
  incidents.forEach(i => {
    if (!i.incident_date) return;
    if (!incidentsByDate[i.incident_date]) incidentsByDate[i.incident_date] = [];
    incidentsByDate[i.incident_date].push(i);
  });

  const grid = document.getElementById('cal-days-grid');
  grid.innerHTML = '';

  // Leading days from prev month
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = document.createElement('div');
    d.className = 'cal-day other-month';
    d.innerHTML = `<div class="cal-day-num">${daysInPrevMonth - i}</div>`;
    grid.appendChild(d);
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const dayNotes = notesByDate[dateStr] || [];
    const dayIncidents = incidentsByDate[dateStr] || [];

    const d = document.createElement('div');
    d.className = 'cal-day' + (isToday ? ' today' : '');
    d.innerHTML = `
      <div class="cal-day-num">${day}</div>
      <div>
        ${dayNotes.slice(0,3).map(() => `<span class="cal-dot cal-dot-note"></span>`).join('')}
        ${dayIncidents.slice(0,3).map(() => `<span class="cal-dot cal-dot-incident"></span>`).join('')}
      </div>
      ${dayNotes.length > 0 ? `<div style="font-size:9px;color:var(--accent);margin-top:2px;">${dayNotes.length} note${dayNotes.length>1?'s':''}</div>` : ''}
      ${dayIncidents.length > 0 ? `<div style="font-size:9px;color:var(--danger);">${dayIncidents.length} incident${dayIncidents.length>1?'s':''}</div>` : ''}
    `;

    if (dayNotes.length || dayIncidents.length) {
      d.onclick = (e) => showCalPopup(e, dateStr, dayNotes, dayIncidents);
    }
    grid.appendChild(d);
  }

  // Trailing days
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  for (let i = 1; i <= totalCells - firstDay - daysInMonth; i++) {
    const d = document.createElement('div');
    d.className = 'cal-day other-month';
    d.innerHTML = `<div class="cal-day-num">${i}</div>`;
    grid.appendChild(d);
  }
}

function showCalPopup(event, dateStr, notes, incidents) {
  if (calPopup) calPopup.remove();
  calPopup = document.createElement('div');
  calPopup.className = 'cal-day-popup';
  calPopup.innerHTML = `
    <div class="cal-popup-title">📅 ${fmtDate(dateStr)}</div>
    ${notes.map(n => `<div class="cal-popup-item">📋 <strong>${n.created_by}</strong> — ${(n.behavior_notes||'').slice(0,60)}${(n.behavior_notes||'').length>60?'…':''}</div>`).join('')}
    ${incidents.map(i => `<div class="cal-popup-item" style="color:var(--danger);">⚠️ <strong>Incident</strong> — ${(i.description||'').slice(0,60)}${(i.description||'').length>60?'…':''}</div>`).join('')}
    <div style="margin-top:10px;text-align:right;"><button class="btn btn-secondary btn-sm" onclick="document.querySelector('.cal-day-popup').remove()">Close</button></div>
  `;
  document.body.appendChild(calPopup);
  const rect = event.currentTarget.getBoundingClientRect();
  calPopup.style.top = (rect.bottom + window.scrollY + 8) + 'px';
  calPopup.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
  event.stopPropagation();
  setTimeout(() => document.addEventListener('click', () => { if(calPopup) { calPopup.remove(); calPopup = null; } }, { once: true }), 100);
}

  function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getAllSundaysSince(startDateStr) {
  const sundays = [];
  const start = new Date(startDateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);

  let cursor = new Date(start);
  const dayOfWeek = cursor.getDay();
  if (dayOfWeek !== 0) cursor.setDate(cursor.getDate() + (7 - dayOfWeek));

  while (cursor <= today) {
    sundays.push(toLocalDateStr(cursor));   // ← was cursor.toISOString().split('T')[0]
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 7);
  }
  return sundays;
} 

// ══════════════════════════════════
// DAILY NOTIFICATIONS
// ══════════════════════════════════

const NOTIF_KEY = 'hlh_notif_permission';
const NOTIF_LAST_KEY = 'hlh_notif_last';

const SHORTCUT_KEY = 'hlh_shortcut_nudge_done';

const notifQuotes = [
  { quote: "Small moments, big impact.", sub: "Every note you write protects someone who cannot speak for themselves." },
  { quote: "You are someone's safety net.", sub: "Your documentation today is their voice tomorrow." },
  { quote: "Consistency is an act of love.", sub: "A few minutes of updates can change everything for your residents." },
  { quote: "Details matter. You matter.", sub: "Your notes are more powerful than you know." },
  { quote: "Great care lives in the records.", sub: "Keep the story going — your residents deserve it." },
  { quote: "You showed up. Now let the notes show it.", sub: "Documenting your care is part of giving it." },
  { quote: "Behind every great resident outcome is a diligent caregiver.", sub: "That's you. Let's get those notes in." },
  { quote: "Your presence is a gift. Your notes are its proof.", sub: "Time to update — it only takes a moment." },
  { quote: "Every entry is a step toward better care.", sub: "You're doing something meaningful. Keep going." },
  { quote: "Compassion documented is compassion multiplied.", sub: "Let's make sure today's care is on the record." },
  { quote: "Your work doesn't go unnoticed.", sub: "Let the records reflect the heart you pour into this work." },
  { quote: "A moment to document. A lifetime of impact.", sub: "Your residents are lucky to have someone so dedicated." },
  { quote: "Care without a record is a story half told.", sub: "Let's complete the chapter — time to update." },
  { quote: "You make a difference every single day.", sub: "Now let's make sure the notes say so too." },
  { quote: "The best caregivers never skip the details.", sub: "And you never do either. Time to log in." },
];

function getDailyQuote() {
  const idx = Math.floor(Date.now() / (1000 * 60 * 60 * 12)) % notifQuotes.length;
  return notifQuotes[idx];
}

function getShiftLabel() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';
}

function shouldFireNotif() {
  const last = localStorage.getItem(NOTIF_LAST_KEY);
  if (!last) return true;
  const now = new Date();
  const lastDate = new Date(parseInt(last));
  const sameDay = now.toDateString() === lastDate.toDateString();
  if (!sameDay) return true;
  // Fire once in AM (before noon) and once in PM (after noon)
  const nowAM = now.getHours() < 12;
  const lastAM = lastDate.getHours() < 12;
  return nowAM !== lastAM;
}

function markNotifFired() {
  localStorage.setItem(NOTIF_LAST_KEY, Date.now().toString());
}

function fireSystemNotif() {
  if (Notification.permission !== 'granted') return;
  if (!shouldFireNotif()) return;
  const { quote, sub } = getDailyQuote();
  const greeting = getShiftLabel();
  const n = new Notification(`${greeting}, ${currentUser ? currentUser.name.split(' ')[0] : 'there'} 🌿`, {
    body: `"${quote}"\n\n${sub}\n\n— Time to update Harmony Living House records`,
    icon: 'harmony_living_house_logo.png',
    badge: 'harmony_living_house_logo.png',
    tag: 'hlh-daily',
    requireInteraction: false,
  });
  n.onclick = () => { window.focus(); n.close(); };
  markNotifFired();
}

async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  const stored = localStorage.getItem(NOTIF_KEY);
  if (stored === 'granted') { fireSystemNotif(); return; }
  if (stored === 'denied') return;
  if (Notification.permission === 'granted') {
    localStorage.setItem(NOTIF_KEY, 'granted');
    fireSystemNotif();
    return;
  }
  // Show our beautiful in-app prompt first
  showNotifPrompt();
}

function showNotifPrompt() {
  const { quote } = getDailyQuote();
  const greeting = getShiftLabel();
  const name = currentUser ? currentUser.name.split(' ')[0] : 'there';

  const overlay = document.createElement('div');
  overlay.id = 'notif-prompt-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:rgba(10,10,10,0.55);
    display:flex;align-items:center;justify-content:center;
    backdrop-filter:blur(4px);
    animation:fadeIn 0.3s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background:#fff;border-radius:20px;
      width:420px;max-width:90vw;
      box-shadow:0 24px 64px rgba(0,0,0,0.25);
      overflow:hidden;
      animation:slideUp 0.3s ease;
    ">
      <!-- Gold header bar -->
      <div style="
        background:linear-gradient(135deg,#1a1a1a 0%,#b8860b 100%);
        padding:28px 28px 20px;
        text-align:center;
      ">
        <img src="harmony_living_house_logo.png"
          style="width:72px;height:72px;object-fit:contain;
                 background:#fff;border-radius:50%;
                 padding:6px;box-shadow:0 4px 16px rgba(0,0,0,0.3);
                 margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;">
        <div style="font-size:13px;font-weight:700;letter-spacing:0.12em;
                    text-transform:uppercase;color:rgba(255,255,255,0.6);
                    margin-bottom:4px;">Harmony Living House</div>
        <div style="font-family:'Georgia',serif;font-size:20px;
                    font-weight:700;color:#fff;line-height:1.3;">
          ${greeting}, ${name} 👋
        </div>
      </div>

      <!-- Body -->
      <div style="padding:28px;">
        <div style="
          background:#fdf6e3;border-left:3px solid #b8860b;
          border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px;
        ">
          <div style="font-size:13px;font-weight:700;color:#b8860b;
                      margin-bottom:4px;font-family:'Georgia',serif;">
            ❝ ${quote} ❞
          </div>
          <div style="font-size:12px;color:#4a5568;line-height:1.6;">
            Stay on top of your residents' care — enable daily reminders so you never miss an update.
          </div>
        </div>

        <div style="font-size:13.5px;color:#1a2332;line-height:1.7;margin-bottom:22px;">
          Allow <strong>Harmony Living House</strong> to send you gentle morning &amp; evening reminders to keep your records current. You'll only be asked once.
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="notif-allow" style="
            background:linear-gradient(135deg,#b8860b,#d4a017);
            color:#fff;border:none;border-radius:10px;
            padding:13px;font-size:14px;font-weight:700;
            cursor:pointer;font-family:inherit;
            letter-spacing:0.02em;
            box-shadow:0 4px 14px rgba(184,134,11,0.35);
            transition:opacity 0.15s;
          ">
            🔔 &nbsp; Yes, remind me daily
          </button>
          <button id="notif-deny" style="
            background:#f0f2f5;color:#8a9ab0;border:none;
            border-radius:10px;padding:11px;font-size:13px;
            cursor:pointer;font-family:inherit;
          ">
            No thanks
          </button>
        </div>

        <div style="text-align:center;margin-top:14px;
                    font-size:11px;color:#aab0bb;line-height:1.5;">
          Reminders fire at your morning &amp; evening shift times.<br>
          You can turn them off in your browser settings anytime.
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('notif-allow').onclick = async () => {
    document.body.removeChild(overlay);
    const result = await Notification.requestPermission();
    localStorage.setItem(NOTIF_KEY, result);
    if (result === 'granted') {
      fireSystemNotif();
      toast('🔔 Daily reminders enabled! We\'ll nudge you every morning & evening.');
    }
  };

  document.getElementById('notif-deny').onclick = () => {
    localStorage.setItem(NOTIF_KEY, 'denied');
    document.body.removeChild(overlay);
  };
}

// Schedule checks every 30 minutes for AM/PM boundary crossing
function showShortcutNudge() {
  if (localStorage.getItem(SHORTCUT_KEY)) return;
  if (Notification.permission !== 'granted') return;

  const name = currentUser ? currentUser.name.split(' ')[0] : 'there';

  const overlay = document.createElement('div');
  overlay.id = 'shortcut-prompt-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:rgba(10,10,10,0.55);
    display:flex;align-items:center;justify-content:center;
    backdrop-filter:blur(4px);
    animation:fadeIn 0.3s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background:#fff;border-radius:20px;
      width:420px;max-width:90vw;
      box-shadow:0 24px 64px rgba(0,0,0,0.25);
      overflow:hidden;
      animation:slideUp 0.3s ease;
    ">
      <div style="
        background:linear-gradient(135deg,#1a1a1a 0%,#b8860b 100%);
        padding:28px 28px 20px;
        text-align:center;
      ">
        <img src="harmony_living_house_logo.png"
          style="width:72px;height:72px;object-fit:contain;
                 background:#fff;border-radius:50%;
                 padding:6px;box-shadow:0 4px 16px rgba(0,0,0,0.3);
                 margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;">
        <div style="font-size:13px;font-weight:700;letter-spacing:0.12em;
                    text-transform:uppercase;color:rgba(255,255,255,0.6);
                    margin-bottom:4px;">One quick tip, ${name}</div>
        <div style="font-family:'Georgia',serif;font-size:19px;
                    font-weight:700;color:#fff;line-height:1.3;">
          Pin this portal to your desktop 📌
        </div>
      </div>

      <div style="padding:28px;">
        <div style="
          background:#fdf6e3;border-left:3px solid #b8860b;
          border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px;
        ">
          <div style="font-size:13px;font-weight:700;color:#b8860b;
                      margin-bottom:4px;font-family:'Georgia',serif;">
            ❝ Your tools should be at your fingertips. ❞
          </div>
          <div style="font-size:12px;color:#4a5568;line-height:1.6;">
            Add Harmony Living House Admin as a shortcut so you can open it instantly — no searching, no typing.
          </div>
        </div>

        <div style="font-size:13px;color:#1a2332;line-height:1.85;margin-bottom:22px;">
          <strong>On Chrome / Edge:</strong><br>
          Click the <strong>⋮</strong> menu at the top right of your browser →
          <em>"Save and share"</em> or <em>"More tools"</em> →
          <strong>"Create shortcut"</strong> → tick "Open as window" → click <strong>Create</strong>.<br><br>
          <strong>On Safari (Mac):</strong><br>
          Click <strong>File</strong> → <strong>"Add to Dock"</strong>.<br><br>
          The Harmony Living House logo will appear as the shortcut icon on your desktop or taskbar.
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="shortcut-done" style="
            background:linear-gradient(135deg,#b8860b,#d4a017);
            color:#fff;border:none;border-radius:10px;
            padding:13px;font-size:14px;font-weight:700;
            cursor:pointer;font-family:inherit;
            letter-spacing:0.02em;
            box-shadow:0 4px 14px rgba(184,134,11,0.35);
          ">
            ✅ &nbsp; Got it, I'll add it now
          </button>
          <button id="shortcut-later" style="
            background:#f0f2f5;color:#8a9ab0;border:none;
            border-radius:10px;padding:11px;font-size:13px;
            cursor:pointer;font-family:inherit;
          ">
            Remind me next time
          </button>
        </div>

        <div style="text-align:center;margin-top:14px;
                    font-size:11px;color:#aab0bb;line-height:1.5;">
          This message will only show once after it's confirmed.
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('shortcut-done').onclick = () => {
    localStorage.setItem(SHORTCUT_KEY, 'true');
    document.body.removeChild(overlay);
    toast('🏠 Perfect! Look for the Harmony Living House icon on your desktop.');
  };

  document.getElementById('shortcut-later').onclick = () => {
    document.body.removeChild(overlay);
  };
}

// Schedule checks every 30 minutes for AM/PM boundary crossing
function startNotifScheduler() {
  if (!('Notification' in window)) return;
  // Initial fire
  setTimeout(() => requestNotifPermission(), 2500);
  // Show shortcut nudge 6 seconds after login — after notif prompt clears
  setTimeout(() => showShortcutNudge(), 6000);
  // Re-check every 30 mins
  setInterval(() => {
    if (currentUser && Notification.permission === 'granted' && shouldFireNotif()) {
      fireSystemNotif();
    }
  }, 30 * 60 * 1000);
}

// ══════════════════════════════════
// ADL — Activities of Daily Living
// ══════════════════════════════════

let adlState = {};

function adlTick(btn) {
  const field = btn.getAttribute('data-field');
  const val   = btn.getAttribute('data-val');
  const cls   = btn.getAttribute('data-cls');
  btn.closest('.adl-pills').querySelectorAll('.adl-pill')
    .forEach(b => b.classList.remove('p-green','p-amber','p-red'));
  if (adlState[field] === val) {
    delete adlState[field];
  } else {
    btn.classList.add(cls);
    adlState[field] = val;
  }
}

function adlRestore(data) {
  adlState = {};
  document.querySelectorAll('.adl-pill').forEach(b => b.classList.remove('p-green','p-amber','p-red'));
  if (!data) return;
  ['shower','oral','dressing','breakfast','lunch','dinner','fluids','snacks',
   'mood','sleep','meds_taken','bowel','fall_risk','mobility','continence','activities','pain'
  ].forEach(f => {
    if (!data[f]) return;
    const btn = document.querySelector(`.adl-pill[data-field="${f}"][data-val="${data[f]}"]`);
    if (btn) { adlState[f] = data[f]; btn.classList.add(btn.getAttribute('data-cls')); }
  });
}

function adlDisplayVal(val) {
  const map = {
    done:'Done', assisted:'Assisted', refused:'Refused', na:'N/A',
    all:'All', most:'Most', little:'Little',
    good:'Good', fair:'Fair', poor:'Poor', yes:'Yes', no:'No',
    calm:'Calm', happy:'Happy', anxious:'Anxious', withdrawn:'Withdrawn',
    agitated:'Agitated', confused:'Confused',
    all:'All taken', partial:'Partial', not_due:'Not due',
    continent:'Continent', occasional:'Occasional', incontinent:'Incontinent',
    low:'Low', moderate:'Moderate', high:'High',
    independent:'Independent', device:'Device', bedbound:'Bedbound',
    joined:'Joined', none:'None', mild:'Mild', severe:'Severe',
    wheelchair:'Wheelchair', taken:'Taken', restless:'Restless',
  };
  return map[val] || val;
}

function adlFlagCss(val) {
  const red   = ['refused','agitated','confused','poor','high','incontinent','severe','bedbound'];
  const amber = ['little','fair','anxious','withdrawn','restless','partial','moderate',
                 'device','occasional','no','mild','assisted','not_due'];
  if (red.includes(val))   return 'background:#fdf0ef;color:#c0392b;border-color:#f5c0bb;font-weight:700;';
  if (amber.includes(val)) return 'background:#fff3cd;color:#856404;border-color:#ffe08a;font-weight:700;';
  return 'background:#e6f4ea;color:#1e7e34;border-color:#a8d5b0;';
}

async function renderADL() {
  const { data: entries } = await db.from('adl_entries').select('*')
    .eq('resident_id', currentResidentId).order('adl_date', { ascending: false });
  const container = document.getElementById('profile-adl-list');
  if (!entries || !entries.length) {
    container.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px;">🏠</div><h4>No Daily Logs Yet</h4><p>Use the "Log ADL Entry" button above to record today's daily activities.</p></div>`;
    return;
  }
  const fields = [
    {k:'shower',l:'Shower'},{k:'oral',l:'Oral hygiene'},{k:'dressing',l:'Dressed'},
    {k:'breakfast',l:'Breakfast'},{k:'lunch',l:'Lunch'},{k:'dinner',l:'Dinner'},
    {k:'fluids',l:'Fluids'},{k:'snacks',l:'Snacks'},
    {k:'mood',l:'Mood'},{k:'sleep',l:'Sleep'},{k:'meds_taken',l:'Meds'},
    {k:'bowel',l:'Bowel'},{k:'fall_risk',l:'Fall risk'},{k:'mobility',l:'Mobility'},
    {k:'continence',l:'Continence'},{k:'activities',l:'Activities'},{k:'pain',l:'Pain'},
  ];
  container.innerHTML = entries.map(e => {
    const pills = fields.filter(d => e[d.k]).map(d => {
      const css = adlFlagCss(e[d.k]);
      return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;border:1px solid;margin:2px;${css}">${d.l}: ${adlDisplayVal(e[d.k])}</span>`;
    }).join('');
    return `<div class="note-card" style="cursor:default;">
      <div class="note-card-header">
        <div>
          <div class="note-date">${fmtDate(e.adl_date)}${e.shift ? ' · ' + e.shift + ' Shift' : ''}</div>
          <div class="note-staff">By ${e.documented_by}</div>
        </div>
        <div class="note-actions">
          <button class="btn btn-secondary btn-sm" onclick="editADL('${e.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteADL('${e.id}')">Delete</button>
        </div>
      </div>
      <div style="margin-top:10px;line-height:1.9;">${pills || '<span style="color:var(--text3);font-style:italic;font-size:13px;">No responses recorded</span>'}</div>
      ${e.notes ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:13px;color:var(--text2);">${e.notes}</div>` : ''}
    </div>`;
  }).join('');
}

function openAddADL() {
  document.getElementById('adl-modal-title').textContent = 'Daily Log';
  document.getElementById('adl-edit-id').value = '';
  document.getElementById('adl-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('adl-by').value = currentUser.name;
  document.getElementById('adl-shift').value = '';
  document.getElementById('adl-notes').value = '';
  adlRestore(null);
  openModal('modal-adl');
}

async function editADL(id) {
  const { data: e } = await db.from('adl_entries').select('*').eq('id', id).single();
  if (!e) return;
  document.getElementById('adl-modal-title').textContent = 'Edit Daily Log';
  document.getElementById('adl-edit-id').value = id;
  document.getElementById('adl-date').value = e.adl_date || '';
  document.getElementById('adl-shift').value = e.shift || '';
  document.getElementById('adl-by').value = e.documented_by || '';
  document.getElementById('adl-notes').value = e.notes || '';
  adlRestore(e);
  openModal('modal-adl');
}

async function saveADL() {
  const date = document.getElementById('adl-date').value;
  const by   = document.getElementById('adl-by').value.trim();
  if (!date || !by) { toast('Please fill in Date and your name'); return; }
  const editId = document.getElementById('adl-edit-id').value;
  const entry = {
    id: editId || uid(),
    resident_id: currentResidentId,
    adl_date: date,
    shift: document.getElementById('adl-shift').value,
    documented_by: by,
    shower:     adlState.shower     || null,
    oral:       adlState.oral       || null,
    dressing:   adlState.dressing   || null,
    breakfast:  adlState.breakfast  || null,
    lunch:      adlState.lunch      || null,
    dinner:     adlState.dinner     || null,
    fluids:     adlState.fluids     || null,
    snacks:     adlState.snacks     || null,
    mood:       adlState.mood       || null,
    sleep:      adlState.sleep      || null,
    meds_taken: adlState.meds_taken || null,
    bowel:      adlState.bowel      || null,
    fall_risk:  adlState.fall_risk  || null,
    mobility:   adlState.mobility   || null,
    continence: adlState.continence || null,
    activities: adlState.activities || null,
    pain:       adlState.pain       || null,
    notes:      document.getElementById('adl-notes').value.trim(),
    created_at: new Date().toISOString()
  };
  await db.from('adl_entries').upsert(entry);
  closeModal('modal-adl');
  toast(editId ? 'Daily log updated' : 'Daily log saved');
  renderADL();
}

async function deleteADL(id) {
  if (!confirm('Delete this daily log entry?')) return;
  await db.from('adl_entries').delete().eq('id', id);
  renderADL();
  toast('Entry deleted');
}

// ══════════════════════════════════
// APPOINTMENTS
// ══════════════════════════════════
async function renderAppointments() {
  const { data: appts } = await db.from('appointments').select('*').eq('resident_id', currentResidentId).order('appt_date', { ascending: false });
  const container = document.getElementById('profile-appointments-list');
  if (!appts || !appts.length) {
    container.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px;">📅</div><h4>No Appointments Yet</h4><p>Add doctor appointments using the button above. You can add as many as needed.</p></div>`;
    return;
  }
  const statusColors = { upcoming: 'badge-warn', completed: 'badge-green', cancelled: 'badge-red', rescheduled: 'badge-warn' };
  const transportLabels = { yes_arranged:'Transport arranged', yes_needed:'Transport needed', no:'Own transport', telehealth:'Telehealth' };
  container.innerHTML = appts.map(a => {
    const isPast = a.appt_date && new Date(a.appt_date + 'T23:59:59') < new Date() && a.status === 'upcoming';
    return `<div class="note-card" style="cursor:default;${isPast?'border-left:3px solid var(--warn);':''}">
      <div class="note-card-header">
        <div>
          <div class="note-date">${fmtDate(a.appt_date)} ${a.appt_time ? 'at ' + a.appt_time : ''}</div>
          <div class="note-staff">${a.doctor} ${a.appt_type ? '· ' + a.appt_type : ''} &nbsp; <span class="badge ${statusColors[a.status]||'badge-green'}" style="text-transform:capitalize;">${a.status||'Upcoming'}</span></div>
        </div>
        <div class="note-actions">
          <button class="btn btn-secondary btn-sm" onclick="editAppointment('${a.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteAppointment('${a.id}')">Delete</button>
        </div>
      </div>
      ${a.reason ? `<div class="note-preview" style="margin-top:6px;"><strong>Reason:</strong> ${a.reason}</div>` : ''}
      ${a.location ? `<div class="note-preview"><strong>Location:</strong> ${a.location}</div>` : ''}
      ${a.transport ? `<div class="note-preview"><strong>Transport:</strong> ${transportLabels[a.transport]||a.transport}</div>` : ''}
      ${a.notes ? `<div class="note-preview"><strong>Notes:</strong> ${a.notes}</div>` : ''}
    </div>`;
  }).join('');
}

function openAddAppointment() {
  document.getElementById('appt-modal-title').textContent = 'Add Doctor Appointment';
  document.getElementById('appt-edit-id').value = '';
  document.getElementById('appt-date').value = '';
  document.getElementById('appt-time').value = '';
  document.getElementById('appt-doctor').value = '';
  document.getElementById('appt-type').value = '';
  document.getElementById('appt-status').value = 'upcoming';
  document.getElementById('appt-location').value = '';
  document.getElementById('appt-reason').value = '';
  document.getElementById('appt-transport').value = '';
  document.getElementById('appt-notes').value = '';
  openModal('modal-appointment');
}

async function editAppointment(id) {
  const { data: a } = await db.from('appointments').select('*').eq('id', id).single();
  if (!a) return;
  document.getElementById('appt-modal-title').textContent = 'Edit Appointment';
  document.getElementById('appt-edit-id').value = id;
  document.getElementById('appt-date').value = a.appt_date || '';
  document.getElementById('appt-time').value = a.appt_time || '';
  document.getElementById('appt-doctor').value = a.doctor || '';
  document.getElementById('appt-type').value = a.appt_type || '';
  document.getElementById('appt-status').value = a.status || 'upcoming';
  document.getElementById('appt-location').value = a.location || '';
  document.getElementById('appt-reason').value = a.reason || '';
  document.getElementById('appt-transport').value = a.transport || '';
  document.getElementById('appt-notes').value = a.notes || '';
  openModal('modal-appointment');
}

async function saveAppointment() {
  const date = document.getElementById('appt-date').value;
  const doctor = document.getElementById('appt-doctor').value.trim();
  if (!date || !doctor) { toast('Please fill in Appointment Date and Doctor Name'); return; }
  const editId = document.getElementById('appt-edit-id').value;
  const appt = {
    id: editId || uid(),
    resident_id: currentResidentId,
    appt_date: date,
    appt_time: document.getElementById('appt-time').value,
    doctor,
    appt_type: document.getElementById('appt-type').value,
    status: document.getElementById('appt-status').value,
    location: document.getElementById('appt-location').value.trim(),
    reason: document.getElementById('appt-reason').value.trim(),
    transport: document.getElementById('appt-transport').value,
    notes: document.getElementById('appt-notes').value.trim(),
    created_at: new Date().toISOString()
  };
  await db.from('appointments').upsert(appt);
  closeModal('modal-appointment');
  toast(editId ? 'Appointment updated' : 'Appointment added');
  renderAppointments();
}

async function deleteAppointment(id) {
  if (!confirm('Delete this appointment?')) return;
  await db.from('appointments').delete().eq('id', id);
  renderAppointments();
  toast('Appointment deleted');
}

// ══════════════════════════════════
// PAYMENTS TRACKER
// ══════════════════════════════════
function genReceiptNum() {
  const now = new Date();
  const yr = now.getFullYear();
  const mo = String(now.getMonth()+1).padStart(2,'0');
  const rand = Math.floor(Math.random()*9000)+1000;
  return `HLH-${yr}${mo}-${rand}`;
}

// ══════════════════════════════════
// BILLS & UTILITIES ENGINE
// ══════════════════════════════════

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const BILL_ICONS = {
  'Rent / Housing': '🏠', 'Power / Electricity': '⚡', 'Water': '💧',
  'Trash / Garbage': '🗑️', 'Phone': '📱', 'Internet': '🌐',
  'Insurance': '🛡️', 'Gas / Heating': '🔥', 'Cable / Streaming': '📺', 'Other': '📋',
};

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPreviousMonthKey() {
  const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMonthKey(mk) {
  if (!mk) return '';
  const [y, m] = mk.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

async function getBills() {
  const { data } = await db.from('recurring_bills').select('*').eq('is_active', true).order('created_at', { ascending: true });
  return data || [];
}

async function getBillMonthRecords(monthKey) {
  const { data } = await db.from('bill_month_records').select('*').eq('month_key', monthKey);
  return data || [];
}

async function renderBillsSection() {
  const bills = await getBills();
  const currentMK = getCurrentMonthKey();
  const prevMK = getPreviousMonthKey();
  const grid = document.getElementById('bills-grid');
  const emptyEl = document.getElementById('bills-empty');
  const overdueSection = document.getElementById('bills-overdue-section');
  const monthLabel = document.getElementById('bills-month-label');
  const summaryBadge = document.getElementById('bills-summary-badge');
  if (!grid) return;

  if (!bills.length) {
    grid.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    if (overdueSection) overdueSection.style.display = 'none';
    if (monthLabel) monthLabel.textContent = '';
    if (summaryBadge) summaryBadge.textContent = '';
    return;
  }

  grid.style.display = 'grid';
  if (emptyEl) emptyEl.style.display = 'none';

  const [currentRecords, prevRecords] = await Promise.all([
    getBillMonthRecords(currentMK),
    getBillMonthRecords(prevMK),
  ]);

  const currentMap = {}, prevMap = {};
  currentRecords.forEach(r => { currentMap[r.bill_id] = r; });
  prevRecords.forEach(r => { prevMap[r.bill_id] = r; });

  if (monthLabel) monthLabel.textContent = fmtMonthKey(currentMK);

  const paidCount = bills.filter(b => currentMap[b.id]?.is_fully_paid).length;
  const partialCount = bills.filter(b => !currentMap[b.id]?.is_fully_paid && parseFloat(currentMap[b.id]?.amount_paid || 0) > 0).length;
  const unpaidCount = bills.length - paidCount - partialCount;

  if (summaryBadge) {
    summaryBadge.innerHTML =
      `<span style="color:#1e7e34;font-weight:700;">${paidCount} paid</span>` +
      (partialCount ? `&nbsp;·&nbsp;<span style="color:#d68910;">${partialCount} partial</span>` : '') +
      (unpaidCount ? `&nbsp;·&nbsp;<span style="color:var(--text3);">${unpaidCount} unpaid</span>` : '');
  }

  // ── Overdue from previous month ──
  const overdueItems = bills.filter(b => {
    const pr = prevMap[b.id];
    return pr && !pr.is_fully_paid && parseFloat(pr.amount_due || 0) > 0;
  });

  if (overdueSection) {
    if (overdueItems.length) {
      overdueSection.style.display = 'block';
      overdueSection.innerHTML = `
        <div style="background:linear-gradient(135deg,#7b1a1a,#c0392b);border-radius:10px;padding:14px 18px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <span style="font-size:18px;">⚠️</span>
            <span style="color:#fff;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;">Overdue from ${fmtMonthKey(prevMK)}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${overdueItems.map(b => {
              const pr = prevMap[b.id];
              const due = parseFloat(pr.amount_due || b.default_amount || 0);
              const paid = parseFloat(pr.amount_paid || 0);
              const rem = due - paid;
              const pct = due > 0 ? Math.min(100, Math.round(paid / due * 100)) : 0;
              const icon = BILL_ICONS[b.category] || '📋';
              return `<div style="background:rgba(255,255,255,0.12);border-radius:8px;padding:11px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                  <span style="font-size:22px;">${icon}</span>
                  <div style="min-width:0;">
                    <div style="color:#fff;font-weight:700;font-size:13px;">${b.name}</div>
                    <div style="color:rgba(255,255,255,0.65);font-size:11.5px;margin-top:2px;">
                      Paid: <strong>$${paid.toFixed(2)}</strong> of $${due.toFixed(2)}
                      &nbsp;·&nbsp; <strong style="color:#f5b8b8;">$${rem.toFixed(2)} still owed</strong>
                    </div>
                    <div style="background:rgba(255,255,255,0.2);border-radius:20px;height:4px;overflow:hidden;margin-top:5px;max-width:160px;">
                      <div style="width:${pct}%;background:#fff;height:100%;border-radius:20px;"></div>
                    </div>
                  </div>
                </div>
                <button onclick="openBillPayment('${b.id}','${prevMK}')"
                  style="background:rgba(255,255,255,0.22);color:#fff;border:1px solid rgba(255,255,255,0.45);border-radius:7px;padding:8px 14px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">
                  Settle Overdue →
                </button>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    } else {
      overdueSection.style.display = 'none';
    }
  }

  // ── Current month bill cards ──
  const today = new Date();
  grid.innerHTML = bills.map(b => {
    const rec = currentMap[b.id];
    const amountDue = rec ? parseFloat(rec.amount_due) : parseFloat(b.default_amount || 0);
    const amountPaid = rec ? parseFloat(rec.amount_paid || 0) : 0;
    const isFullyPaid = rec ? rec.is_fully_paid : false;
    const remaining = Math.max(0, amountDue - amountPaid);
    const pct = amountDue > 0 ? Math.min(100, Math.round(amountPaid / amountDue * 100)) : 0;
    const isPartial = amountPaid > 0 && !isFullyPaid;
    const icon = BILL_ICONS[b.category] || '📋';
    const dueDate = b.due_day ? new Date(today.getFullYear(), today.getMonth(), b.due_day) : null;
    const isPastDue = dueDate && today > dueDate && !isFullyPaid;

    let statusText, statusBg, statusColor, borderColor, cardBg, barColor;
    if (isFullyPaid) {
      statusText = '✅ PAID'; statusBg = '#e6f4ea'; statusColor = '#1e7e34';
      borderColor = '#a8d5b0'; cardBg = '#f8fdf9'; barColor = '#1e7e34';
    } else if (isPartial) {
      statusText = '⏳ PARTIAL'; statusBg = '#fff3cd'; statusColor = '#856404';
      borderColor = '#ffe08a'; cardBg = '#fffef5'; barColor = '#d68910';
    } else if (isPastDue) {
      statusText = '🔴 OVERDUE'; statusBg = '#fdf0ef'; statusColor = '#c0392b';
      borderColor = '#f5c0bb'; cardBg = '#fff9f9'; barColor = '#c0392b';
    } else {
      statusText = 'UNPAID'; statusBg = 'var(--surface2)'; statusColor = 'var(--text3)';
      borderColor = 'var(--border)'; cardBg = '#fff'; barColor = '#e0e0e0';
    }

    const entries = (() => { try { return JSON.parse(rec?.payment_entries || '[]'); } catch { return []; } })();

    const historyHtml = entries.length ? `
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid ${borderColor};">
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">This month</div>
        ${entries.map(e => `
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);padding:2px 0;">
            <span>${fmtDate(e.date)}${e.note ? ' · ' + e.note : ''}</span>
            <span style="font-weight:700;color:#1e7e34;">+$${parseFloat(e.amount).toFixed(2)}</span>
          </div>`).join('')}
      </div>` : '';

    const payBtnLabel = isPartial ? '+ Add Payment' : isPastDue ? '🔴 Pay Overdue' : '💳 Pay';
    const payBtnBg = isPastDue && !isPartial ? '#c0392b' : 'var(--accent)';

    return `
      <div style="border:1.5px solid ${borderColor};border-radius:12px;overflow:hidden;background:${cardBg};
                  transition:box-shadow 0.15s,transform 0.15s;"
           onmouseover="this.style.boxShadow='0 6px 20px rgba(0,0,0,0.1)';this.style.transform='translateY(-2px)'"
           onmouseout="this.style.boxShadow='';this.style.transform=''">

        <!-- Card header -->
        <div style="padding:13px 14px 10px;border-bottom:1px solid ${borderColor};">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:9px;">
            <div style="display:flex;align-items:center;gap:9px;flex:1;min-width:0;">
              <span style="font-size:26px;flex-shrink:0;">${icon}</span>
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:13.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b.name}</div>
                <div style="font-size:11px;color:var(--text3);margin-top:1px;">${b.category}${b.due_day ? ' &middot; Due ' + ordinal(b.due_day) : ''}</div>
              </div>
            </div>
            <span style="background:${statusBg};color:${statusColor};border-radius:20px;padding:3px 9px;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0;">${statusText}</span>
          </div>

          <!-- Amount -->
          <div style="margin-bottom:5px;">
            ${amountDue > 0
              ? `<span style="font-size:22px;font-weight:800;color:var(--text);">$${amountPaid.toFixed(2)}</span><span style="font-size:12px;color:var(--text3);"> / $${amountDue.toFixed(2)}</span>`
              : `<span style="font-size:13px;color:var(--text3);font-style:italic;">No amount set — tap $ to set</span>`}
          </div>
          ${isPartial ? `<div style="font-size:11.5px;color:#c0392b;font-weight:700;margin-bottom:5px;">$${remaining.toFixed(2)} remaining</div>` : ''}

          <!-- Progress bar -->
          <div style="background:#e8e8e8;border-radius:20px;height:6px;overflow:hidden;">
            <div style="width:${pct}%;background:${barColor};height:100%;border-radius:20px;transition:width 0.4s;"></div>
          </div>
          ${pct > 0 && pct < 100 ? `<div style="font-size:10px;color:var(--text3);text-align:right;margin-top:2px;">${pct}%</div>` : ''}
        </div>

        <!-- Card body -->
        <div style="padding:10px 14px 13px;">
          ${historyHtml}

          <!-- Action buttons -->
          <div style="display:flex;gap:6px;margin-top:${entries.length ? '10px' : '4px'};">
            ${!isFullyPaid
              ? `<button onclick="openBillPayment('${b.id}','${currentMK}')"
                  style="flex:1;background:${payBtnBg};color:#fff;border:none;border-radius:7px;padding:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">
                  ${payBtnLabel}
                </button>`
              : `<button onclick="openBillPayment('${b.id}','${currentMK}')"
                  style="flex:1;background:none;border:1px dashed #a8d5b0;border-radius:7px;padding:8px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;color:#1e7e34;">
                  + Add Another Payment
                </button>`}
            <button onclick="openSetBillAmount('${b.id}','${currentMK}',${amountDue})"
              style="background:var(--surface2);color:var(--text2);border:1px solid var(--border);border-radius:7px;padding:9px 11px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;"
              title="Adjust amount due this month">$</button>
            <button onclick="openEditBill('${b.id}')"
              style="background:var(--surface2);color:var(--text2);border:1px solid var(--border);border-radius:7px;padding:9px 11px;font-size:12px;cursor:pointer;font-family:inherit;"
              title="Edit bill">✏️</button>
          </div>
          <button onclick="deleteBill('${b.id}')"
            style="margin-top:6px;width:100%;background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;font-family:inherit;padding:3px;">
            Remove bill
          </button>
        </div>
      </div>`;
  }).join('');
}

function openAddExpenseBill() {
  openAddExpense();
  setTimeout(() => setExpenseType('bill'), 50);
}

async function populateBillSelect() {
  const sel = document.getElementById('exp-bill-select');
  if (!sel) return;
  const bills = await getBills();
  sel.innerHTML = '<option value="">— Select a Bill —</option>';
  bills.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${BILL_ICONS[b.category] || '📋'} ${b.name} (${b.category})`;
    sel.appendChild(opt);
  });
}

async function loadBillPaymentDetails() {
  const billId = document.getElementById('exp-bill-select').value;
  const summaryEl = document.getElementById('exp-bill-summary');
  if (!billId) { if (summaryEl) summaryEl.style.display = 'none'; return; }
  const currentMK = getCurrentMonthKey();
  let { data: rec } = await db.from('bill_month_records').select('*').eq('bill_id', billId).eq('month_key', currentMK).maybeSingle();
  const { data: b } = await db.from('recurring_bills').select('*').eq('id', billId).single();
  if (!b) return;
  const amtDue = rec ? parseFloat(rec.amount_due || 0) : parseFloat(b.default_amount || 0);
  const amtPaid = rec ? parseFloat(rec.amount_paid || 0) : 0;
  const remaining = Math.max(0, amtDue - amtPaid);
  document.getElementById('exp-bill-due-display').textContent = '$' + amtDue.toFixed(2);
  document.getElementById('exp-bill-paid-display').textContent = '$' + amtPaid.toFixed(2);
  document.getElementById('exp-bill-remaining-display').textContent = '$' + remaining.toFixed(2);
  document.getElementById('exp-bill-payment-amount').value = remaining > 0 ? remaining.toFixed(2) : '';
  if (summaryEl) summaryEl.style.display = 'block';
}

function openAddBill() {
  document.getElementById('bill-modal-title').textContent = 'Add Recurring Bill';
  document.getElementById('bill-edit-id').value = '';
  document.getElementById('bill-name').value = '';
  document.getElementById('bill-category').value = '';
  document.getElementById('bill-due-day').value = '';
  document.getElementById('bill-default-amount').value = '';
  document.getElementById('bill-notes').value = '';
  openModal('modal-bill');
}

async function openEditBill(id) {
  const { data: b } = await db.from('recurring_bills').select('*').eq('id', id).single();
  if (!b) return;
  document.getElementById('bill-modal-title').textContent = 'Edit Bill';
  document.getElementById('bill-edit-id').value = id;
  document.getElementById('bill-name').value = b.name || '';
  document.getElementById('bill-category').value = b.category || '';
  document.getElementById('bill-due-day').value = b.due_day || '';
  document.getElementById('bill-default-amount').value = b.default_amount || '';
  document.getElementById('bill-notes').value = b.notes || '';
  openModal('modal-bill');
}

async function saveBill() {
  const name = document.getElementById('bill-name').value.trim();
  const category = document.getElementById('bill-category').value;
  if (!name || !category) { toast('Please fill in Bill Name and Category'); return; }
  const editId = document.getElementById('bill-edit-id').value;
  const bill = {
    id: editId || uid(), name, category,
    due_day: parseInt(document.getElementById('bill-due-day').value) || null,
    default_amount: parseFloat(document.getElementById('bill-default-amount').value) || 0,
    notes: document.getElementById('bill-notes').value.trim(),
    is_active: true,
  };
  if (!editId) bill.created_at = new Date().toISOString();
  const { error } = await db.from('recurring_bills').upsert(bill);
  if (error) { toast('Error: ' + error.message); return; }
  closeModal('modal-bill');
  toast(editId ? '✅ Bill updated' : '✅ Bill added');
  renderBillsSection();
}

async function deleteBill(id) {
  if (!confirm('Remove this bill from tracking?\nAll payment history will be kept for your records.')) return;
  await db.from('recurring_bills').update({ is_active: false }).eq('id', id);
  toast('Bill removed from tracking');
  renderBillsSection();
}

async function openBillPayment(billId, monthKey) {
  const { data: b } = await db.from('recurring_bills').select('*').eq('id', billId).single();
  if (!b) return;

  let { data: rec } = await db.from('bill_month_records').select('*').eq('bill_id', billId).eq('month_key', monthKey).maybeSingle();
  if (!rec) {
    const newRec = {
      id: uid(), bill_id: billId, month_key: monthKey,
      amount_due: parseFloat(b.default_amount || 0), amount_paid: 0,
      is_fully_paid: false, payment_entries: '[]', created_at: new Date().toISOString()
    };
    const { error } = await db.from('bill_month_records').insert(newRec);
    if (error) { toast('Error: ' + error.message); return; }
    rec = newRec;
  }

  const amtDue = parseFloat(rec.amount_due || 0);
  const amtPaid = parseFloat(rec.amount_paid || 0);
  const remaining = Math.max(0, amtDue - amtPaid);

  document.getElementById('billpay-bill-id').value = billId;
  document.getElementById('billpay-month-key').value = monthKey;
  document.getElementById('billpay-rec-id').value = rec.id;
  document.getElementById('billpay-modal-title').textContent = `💳 ${b.name} — ${fmtMonthKey(monthKey)}`;
  document.getElementById('billpay-amount-due').textContent = `$${amtDue.toFixed(2)}`;
  document.getElementById('billpay-amount-paid').textContent = `$${amtPaid.toFixed(2)}`;
  document.getElementById('billpay-remaining').textContent = `$${remaining.toFixed(2)}`;
  document.getElementById('billpay-amount').value = remaining > 0 ? remaining.toFixed(2) : '';
  document.getElementById('billpay-paid-by').value = currentUser ? currentUser.name : '';
  document.getElementById('billpay-note').value = '';
  document.getElementById('billpay-date').value = toLocalDateStr(new Date());

  const entries = (() => { try { return JSON.parse(rec.payment_entries || '[]'); } catch { return []; } })();
  const histEl = document.getElementById('billpay-history');
  histEl.innerHTML = entries.length ? `
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Payment History — ${fmtMonthKey(monthKey)}</div>
    ${entries.map(e => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span style="color:var(--text2);">${fmtDate(e.date)}${e.note ? ' · ' + e.note : ''}${e.by ? ' · by ' + e.by : ''}</span>
        <span style="font-weight:700;color:#1e7e34;flex-shrink:0;">+$${parseFloat(e.amount).toFixed(2)}</span>
      </div>`).join('')}
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding-top:8px;color:var(--text);">
      <span>Total paid</span><span style="color:#1e7e34;">$${amtPaid.toFixed(2)} of $${amtDue.toFixed(2)}</span>
    </div>` :
    `<div style="font-size:12px;color:var(--text3);font-style:italic;text-align:center;padding:10px 0;">No payments recorded for ${fmtMonthKey(monthKey)} yet.</div>`;

  openModal('modal-bill-payment');
}

async function saveBillPayment() {
  const billId = document.getElementById('billpay-bill-id').value;
  const amount = parseFloat(document.getElementById('billpay-amount').value);
  const payDate = document.getElementById('billpay-date').value;
  if (!amount || amount <= 0) { toast('Please enter a valid payment amount'); return; }

  // Derive month_key from the actual payment date entered, not the current month
  const monthKey = payDate ? payDate.slice(0, 7) : getCurrentMonthKey();

  // Look up or create the record for THAT month (not necessarily current)
  let { data: rec } = await db.from('bill_month_records')
    .select('*').eq('bill_id', billId).eq('month_key', monthKey).maybeSingle();

  if (!rec) {
    const { data: b } = await db.from('recurring_bills').select('*').eq('id', billId).single();
    const newRec = {
      id: uid(), bill_id: billId, month_key: monthKey,
      amount_due: parseFloat(b?.default_amount || 0), amount_paid: 0,
      is_fully_paid: false, payment_entries: '[]', created_at: new Date().toISOString()
    };
    const { error } = await db.from('bill_month_records').insert(newRec);
    if (error) { toast('Error: ' + error.message); return; }
    rec = newRec;
  }
  const recId = rec.id;

  const entries = (() => { try { return JSON.parse(rec.payment_entries || '[]'); } catch { return []; } })();
  entries.push({
    id: uid(), amount,
    date: document.getElementById('billpay-date').value || toLocalDateStr(new Date()),
    by: document.getElementById('billpay-paid-by').value.trim(),
    note: document.getElementById('billpay-note').value.trim()
  });

  const newAmountPaid = parseFloat(rec.amount_paid || 0) + amount;
  const isFullyPaid = newAmountPaid >= parseFloat(rec.amount_due || 0) - 0.005;

  const { error } = await db.from('bill_month_records').update({
    amount_paid: newAmountPaid,
    is_fully_paid: isFullyPaid,
    payment_entries: JSON.stringify(entries)
  }).eq('id', recId);

  if (error) { toast('Error saving: ' + error.message); return; }

  // Also record as an expense so it appears in total expenses — use payDate for exp_date
  const { data: billData } = await db.from('recurring_bills').select('name, category').eq('id', billId).single();
  const expenseRecord = {
    id: uid(),
    expense_type: 'bill',
    exp_date: payDate || toLocalDateStr(new Date()),
    amount: parseFloat(amount).toFixed(2),
    category: billData?.category || 'Utilities',
    description: `${billData?.name || 'Bill'} — ${fmtMonthKey(monthKey)}`,
    vendor: billData?.name || '',
    method: null,
    paid_by: document.getElementById('billpay-paid-by').value.trim(),
    receipt_ref: document.getElementById('billpay-note').value.trim(),
    notes: `Bill payment — ${fmtMonthKey(monthKey)}`,
    wage_staff: null,
    bill_id: billId,
    bill_month_key: monthKey,
    created_at: new Date().toISOString()
  };
  await db.from('expenses').insert(expenseRecord);

  const remaining = Math.max(0, parseFloat(rec.amount_due || 0) - newAmountPaid);
  closeModal('modal-bill-payment');
  toast(isFullyPaid
    ? `✅ ${fmtMonthKey(monthKey)} bill fully paid!`
    : `✅ $${amount.toFixed(2)} recorded for ${fmtMonthKey(monthKey)} — $${remaining.toFixed(2)} remaining`);
  renderBillsSection();
  renderExpensesPanel();
  renderPaymentsPage();
}

async function openSetBillAmount(billId, monthKey, currentAmountDue) {
  const newAmt = prompt(
    `Set the exact amount due for ${fmtMonthKey(monthKey)}:\n(This month's bill — leave unchanged if same as default)`,
    parseFloat(currentAmountDue || 0).toFixed(2)
  );
  if (newAmt === null || newAmt.trim() === '') return;
  const parsed = parseFloat(newAmt);
  if (isNaN(parsed) || parsed < 0) { toast('Please enter a valid dollar amount'); return; }

  const { data: existing } = await db.from('bill_month_records').select('id').eq('bill_id', billId).eq('month_key', monthKey).maybeSingle();
  if (existing) {
    await db.from('bill_month_records').update({ amount_due: parsed }).eq('id', existing.id);
  } else {
    await db.from('bill_month_records').insert({
      id: uid(), bill_id: billId, month_key: monthKey,
      amount_due: parsed, amount_paid: 0, is_fully_paid: false,
      payment_entries: '[]', created_at: new Date().toISOString()
    });
  }
  toast(`✅ Amount due set to $${parsed.toFixed(2)} for ${fmtMonthKey(monthKey)}`);
  renderBillsSection();
}

function switchFinTab(tab) {
  const isIncome = tab === 'income';

  const incomeBtn = document.getElementById('fin-tab-income');
  const expensesBtn = document.getElementById('fin-tab-expenses');
  const incomeSection = document.getElementById('fin-section-income');
  const expensesSection = document.getElementById('fin-section-expenses');

  if (incomeBtn) {
    incomeBtn.style.background = isIncome
      ? 'linear-gradient(135deg,#1a3d1a,#1e7e34)' : 'transparent';
    incomeBtn.style.color = isIncome ? '#fff' : 'var(--text3)';
  }
  if (expensesBtn) {
    expensesBtn.style.background = !isIncome
      ? 'linear-gradient(135deg,#6b1a1a,#c0392b)' : 'transparent';
    expensesBtn.style.color = !isIncome ? '#fff' : 'var(--text3)';
  }
  if (incomeSection) incomeSection.style.display = isIncome ? 'block' : 'none';
  if (expensesSection) expensesSection.style.display = !isIncome ? 'block' : 'none';

  localStorage.setItem('hlh_fin_tab', tab);
  if (!isIncome) { renderExpensesPanel(); }
}

async function renderPaymentsPage() {
  const residents = await getResidents();
  const q = (document.getElementById('pay-search')?.value || '').toLowerCase();
  const dateF = document.getElementById('pay-date-filter')?.value;
  const resF = document.getElementById('pay-resident-filter')?.value;
  const { data: allPayments } = await db.from('payments').select('*').order('pay_date', { ascending: false });
  let payments = allPayments || [];
  if (q) payments = payments.filter(p => JSON.stringify(p).toLowerCase().includes(q));
  if (dateF) payments = payments.filter(p => p.pay_date === dateF);
  if (resF) payments = payments.filter(p => p.resident_id === resF);
  const total = (allPayments||[]).reduce((s,p) => s + parseFloat(p.amount||0), 0);
  const thisMonth = new Date().toISOString().slice(0,7);
  const monthTotal = (allPayments||[]).filter(p => p.pay_date && p.pay_date.startsWith(thisMonth)).reduce((s,p) => s + parseFloat(p.amount||0), 0);
  const uniquePayers = new Set((allPayments||[]).map(p => p.resident_id)).size;
  const incomeEl = document.getElementById('pay-stat-total');
  const incomeCard = incomeEl ? incomeEl.closest('.stat-card') : null;
  if (incomeEl) incomeEl.textContent = '$' + total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  if (incomeCard) {
    incomeCard.style.transition = 'background 0.4s, border-color 0.4s';
    incomeCard.style.background = total > 0 ? '#e8f5e9' : '';
    incomeCard.style.borderColor = total > 0 ? '#a5d6a7' : '';
    const incomeVal = incomeCard.querySelector('.value');
    if (incomeVal) incomeVal.style.color = total > 0 ? '#1e7e34' : 'var(--text)';
  }
  const payMonthEl = document.getElementById('pay-stat-month');
  if (payMonthEl) payMonthEl.textContent = '$' + monthTotal.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const monthIncomeCardEl = document.getElementById('pay-stat-month-income-card');
  if (monthIncomeCardEl) monthIncomeCardEl.textContent = '$' + monthTotal.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const monthExpCardEl = document.getElementById('pay-stat-month-exp-card');
  if (monthExpCardEl) {
    const { data: _expForCard } = await db.from('expenses').select('amount, exp_date');
    const _thisMonth = new Date().toISOString().slice(0,7);
    const _monthExp = (_expForCard||[]).filter(e => e.exp_date && e.exp_date.startsWith(_thisMonth)).reduce((s,e) => s + parseFloat(e.amount||0), 0);
    monthExpCardEl.textContent = '$' + _monthExp.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  const payCountEl = document.getElementById('pay-stat-count');
  if (payCountEl) payCountEl.textContent = (allPayments||[]).length;
  // Net this month = income this month minus expenses this month
  const { data: allExpForNet } = await db.from('expenses').select('amount, exp_date, expense_type');
  const expMonthTotal = (allExpForNet||[]).filter(e => e.exp_date && e.exp_date.startsWith(thisMonth)).reduce((s,e) => s + parseFloat(e.amount||0), 0);

  // Also count any bill payments in bill_month_records not yet dual-written as expense rows
  const { data: billRecsForNet } = await db.from('bill_month_records').select('amount_paid, month_key');
  const billPaidThisMonthForNet = (billRecsForNet||[]).filter(r => r.month_key === new Date().toISOString().slice(0,7)).reduce((s,r) => s + parseFloat(r.amount_paid||0), 0);
  const billAlreadyInExpForNet = (allExpForNet||[]).filter(e => e.expense_type === 'bill' && e.exp_date && e.exp_date.startsWith(thisMonth)).reduce((s,e) => s + parseFloat(e.amount||0), 0);
  const billGapForNet = Math.max(0, billPaidThisMonthForNet - billAlreadyInExpForNet);

  const netMonth = monthTotal - expMonthTotal - billGapForNet;
  const netEl = document.getElementById('pay-stat-net-month');
  const netStatCard = netEl ? netEl.closest('.stat-card') : null;
  if (netEl) {
    netEl.textContent = (netMonth < 0 ? '-$' : '$') + Math.abs(netMonth).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    netEl.style.color = netMonth < 0 ? '#c0392b' : '#1e7e34';
  }
  if (netStatCard) {
    netStatCard.style.transition = 'background 0.4s, border-color 0.4s';
    if (netMonth < 0) {
      netStatCard.style.background = '#fdf0ef';
      netStatCard.style.borderColor = '#f5c0bb';
    } else if (netMonth > 0) {
      netStatCard.style.background = '#e8f5e9';
      netStatCard.style.borderColor = '#a5d6a7';
    } else {
      netStatCard.style.background = '';
      netStatCard.style.borderColor = '';
    }
  }
  renderExpensesPanel();
  const container = document.getElementById('payments-list');
  if (!payments.length) {
    container.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px;">💳</div><h4>No Payments Recorded</h4><p>Record the first payment using the button above.</p></div>`;
    return;
  }
  container.innerHTML = payments.map(p => {
    const res = residents.find(r => r.id === p.resident_id);
    const amt = parseFloat(p.amount||0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    return `<div class="note-card" style="cursor:default;">
      <div class="note-card-header">
        <div>
          <div class="note-date" style="display:flex;align-items:center;gap:12px;">
            <span>${res ? res.name : 'Unknown'}</span>
            <span style="font-size:18px;font-weight:700;color:#1e7e34;">$${amt}</span>
          </div>
          <div class="note-staff">${fmtDate(p.pay_date)} · ${p.method||'—'} · ${p.period||''} · Receipt: ${p.receipt_num||'—'}</div>
        </div>
        <div class="note-actions">
          <button class="btn btn-secondary btn-sm" onclick="printReceipt('${p.id}')">🖨️ Receipt</button>
          <button class="btn btn-danger btn-sm" onclick="deletePayment('${p.id}')">Delete</button>
        </div>
      </div>
      ${p.classification ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px;">${p.classification.split(',').map(tag => {
        const tagColors = {
          'Medicaid':'background:#e8f0fe;color:#1a73e8;border:1px solid #b0c8f8;',
          'Medicare':'background:#e3f2fd;color:#0d47a1;border:1px solid #90caf9;',
          'Client Responsible Amount':'background:#fdf6e3;color:#b8860b;border:1px solid #f0c040;',
          'Medicaid Spend-Down':'background:#f3e5f5;color:#6a1b9a;border:1px solid #ce93d8;',
          'SSI / SSA Benefit':'background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;',
          'Private Pay':'background:#fdf0ef;color:#c0392b;border:1px solid #f5c0bb;',
          'DSHS / State Contracted Rate':'background:#e0f2f1;color:#00695c;border:1px solid #80cbc4;',
          'VA Benefits':'background:#e8eaf6;color:#1565c0;border:1px solid #9fa8da;',
          'Long-Term Care Insurance':'background:#ede7f6;color:#4a148c;border:1px solid #ce93d8;',
          'Other Government Assistance':'background:#f1f8e9;color:#558b2f;border:1px solid #aed581;',
        };
        const s = tagColors[tag.trim()] || 'background:var(--surface2);color:var(--text2);border:1px solid var(--border);';
        return `<span style="padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;${s}">${tag.trim()}</span>`;
      }).join('')}</div>` : ''}
      ${p.notes ? `<div class="note-preview">${p.notes}</div>` : ''}
      ${p.received_by ? `<div class="note-preview" style="font-size:12px;color:var(--text3);">Received by: ${p.received_by}</div>` : ''}
    </div>`;
  }).join('');
}

// ══════════════════════════════════
// MONTHLY FINANCIAL SUMMARY
// ══════════════════════════════════

const FINANCIALS_START = { year: 2026, month: 5 }; // May 2026

function getAvailableMonths() {
  const months = [];
  const now = new Date();
  let y = FINANCIALS_START.year;
  let m = FINANCIALS_START.month;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    months.push({ year: y, month: m, key: `${y}-${String(m).padStart(2,'0')}` });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months.reverse(); // most recent first
}

let activeSummaryMonth = null;

async function openMonthlySummary() {
  const months = getAvailableMonths();
  const pillsEl = document.getElementById('month-selector-pills');
  const monthNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  pillsEl.innerHTML = months.map(m => `
    <button onclick="selectSummaryMonth('${m.key}')" id="pill-${m.key}"
      style="padding:6px 14px;border-radius:20px;border:1.5px solid var(--border);
             background:var(--surface);color:var(--text2);font-family:inherit;
             font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s;">
      ${monthNames[m.month]} ${m.year}
    </button>`).join('');
  // Default to current month
  const now = new Date();
  const defaultKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  openModal('modal-monthly-summary');
  await selectSummaryMonth(defaultKey);
}

async function selectSummaryMonth(monthKey) {
  activeSummaryMonth = monthKey;
  // Update pill styles
  document.querySelectorAll('[id^="pill-"]').forEach(btn => {
    const isActive = btn.id === `pill-${monthKey}`;
    btn.style.background = isActive ? 'linear-gradient(135deg,#1a1a1a,#b8860b)' : 'var(--surface)';
    btn.style.color = isActive ? '#fff' : 'var(--text2)';
    btn.style.borderColor = isActive ? '#b8860b' : 'var(--border)';
  });
  const contentEl = document.getElementById('monthly-summary-content');
  contentEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px;">Loading ${monthKey}…</div>`;

  const [y, m] = monthKey.split('-').map(Number);
  const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthLabel = `${monthNames[m]} ${y}`;

  // Fetch data using proper last-day-of-month calculation
  const [my, mm] = monthKey.split('-').map(Number);
  const monthStart = `${monthKey}-01`;
  const lastDay = new Date(my, mm, 0).getDate();
  const monthEnd = `${monthKey}-${String(lastDay).padStart(2,'0')}`;
  const { data: payments } = await db.from('payments').select('*').gte('pay_date', monthStart).lte('pay_date', monthEnd).order('pay_date');
  const { data: expenses } = await db.from('expenses').select('*').gte('exp_date', monthStart).lte('exp_date', monthEnd).order('exp_date');
  const { data: billRecs } = await db.from('bill_month_records').select('*').eq('month_key', monthKey);
  const residents = await getResidents();

  const pList = payments || [];
  const eList = expenses || [];
  const bList = billRecs || [];

  const totalIncome = pList.reduce((s,p) => s + parseFloat(p.amount||0), 0);

  // General + wage expenses (exclude bill-type rows to avoid double-count)
  const nonBillExpenses = eList
    .filter(e => e.expense_type !== 'bill')
    .reduce((s,e) => s + parseFloat(e.amount||0), 0);

  // Bills: use bill_month_records as the authoritative source for this month
  const billsTotal = bList.reduce((s,r) => s + parseFloat(r.amount_paid||0), 0);

  const totalExpenses = nonBillExpenses + billsTotal;
  const netProfit = totalIncome - totalExpenses;

  // Category breakdown for expenses (non-bill rows)
  const byCat = {};
  eList.filter(e => e.expense_type !== 'bill').forEach(e => {
    const cat = e.category || 'Other';
    if (!byCat[cat]) byCat[cat] = 0;
    byCat[cat] += parseFloat(e.amount||0);
  });

  // Add bill_month_records into category breakdown by fetching bill names
  const { data: allBillDefs } = await db.from('recurring_bills').select('id, name, category');
  const billDefMap = {};
  (allBillDefs || []).forEach(b => { billDefMap[b.id] = b; });
  bList.forEach(r => {
    if (!r.amount_paid || parseFloat(r.amount_paid) <= 0) return;
    const bill = billDefMap[r.bill_id];
    const cat = bill?.category || 'Utilities';
    if (!byCat[cat]) byCat[cat] = 0;
    byCat[cat] += parseFloat(r.amount_paid);
  });

  // Income by resident
  const byRes = {};
  pList.forEach(p => {
    const res = residents.find(r => r.id === p.resident_id);
    const name = res ? res.name : 'Unknown';
    if (!byRes[name]) byRes[name] = 0;
    byRes[name] += parseFloat(p.amount||0);
  });

  const fmt = (n) => '$' + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const netColor = netProfit >= 0 ? '#1e7e34' : '#c0392b';
  const netBg = netProfit >= 0 ? '#e8f5e9' : '#fdf0ef';
  const netLabel = netProfit >= 0 ? '✅ Net Profit' : '⚠️ Net Loss';

  contentEl.innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <div style="font-family:'DM Serif Display',serif;font-size:20px;color:var(--text);">${monthLabel}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px;">Financial Summary · Harmony Living House Adult Family LLC</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button onclick="printMonthlyDetailedReport('${monthKey}')" style="background:var(--surface2);color:var(--text2);border:1.5px solid var(--border);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">🖨️ Print Income Report</button>
        <button onclick="printMonthlyExpenseReport('${monthKey}')" style="background:var(--surface2);color:var(--text2);border:1.5px solid var(--border);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">🖨️ Print Expense Report</button>
      </div>
    </div>

    <!-- 3 KPI cards -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:22px;">
      <div style="background:#e8f5e9;border:1.5px solid #a8d5b0;border-radius:12px;padding:18px 20px;">
        <div style="font-size:11px;font-weight:700;color:#1e7e34;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Total Income</div>
        <div style="font-size:28px;font-weight:800;color:#1e7e34;">${fmt(totalIncome)}</div>
        <div style="font-size:12px;color:#1e7e34;margin-top:3px;">${pList.length} payment${pList.length!==1?'s':''} received</div>
      </div>
      <div style="background:#fdf0ef;border:1.5px solid #f5c0bb;border-radius:12px;padding:18px 20px;">
        <div style="font-size:11px;font-weight:700;color:#c0392b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Total Expenses</div>
        <div style="font-size:28px;font-weight:800;color:#c0392b;">${fmt(totalExpenses)}</div>
        <div style="font-size:12px;color:#c0392b;margin-top:3px;">${eList.length} expense record${eList.length!==1?'s':''}</div>
      </div>
      <div style="background:${netBg};border:1.5px solid ${netColor}40;border-radius:12px;padding:18px 20px;">
        <div style="font-size:11px;font-weight:700;color:${netColor};text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">${netLabel}</div>
        <div style="font-size:28px;font-weight:800;color:${netColor};">${netProfit < 0 ? '-' : ''}${fmt(netProfit)}</div>
        <div style="font-size:12px;color:${netColor};margin-top:3px;">Income minus expenses</div>
      </div>
    </div>

    <!-- Two column breakdown -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:20px;">

      <!-- Income by resident -->
      <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;">
        <div style="background:#1e7e34;padding:11px 16px;">
          <div style="color:#fff;font-weight:700;font-size:13px;">💰 Income by Resident</div>
        </div>
        <div style="padding:0;">
          ${Object.keys(byRes).length ? Object.entries(byRes).sort((a,b)=>b[1]-a[1]).map(([name,amt]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px;">
              <span style="color:var(--text);font-weight:500;">${name}</span>
              <span style="font-weight:700;color:#1e7e34;">${fmt(amt)}</span>
            </div>`).join('') + `
            <div style="display:flex;justify-content:space-between;padding:10px 14px;font-size:13px;background:var(--surface2);">
              <span style="font-weight:700;color:var(--text);">Total</span>
              <span style="font-weight:800;color:#1e7e34;">${fmt(totalIncome)}</span>
            </div>`
          : '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px;font-style:italic;">No income recorded this month</div>'}
        </div>
      </div>

      <!-- Expenses by category -->
      <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;">
        <div style="background:#c0392b;padding:11px 16px;">
          <div style="color:#fff;font-weight:700;font-size:13px;">🧾 Expenses by Category</div>
        </div>
        <div style="padding:0;">
          ${Object.keys(byCat).length ? Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px;">
              <span style="color:var(--text);font-weight:500;">${cat}</span>
              <span style="font-weight:700;color:#c0392b;">${fmt(amt)}</span>
            </div>`).join('') + `
            <div style="display:flex;justify-content:space-between;padding:10px 14px;font-size:13px;background:var(--surface2);">
              <span style="font-weight:700;color:var(--text);">Total</span>
              <span style="font-weight:800;color:#c0392b;">${fmt(totalExpenses)}</span>
            </div>`
          : '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px;font-style:italic;">No expenses recorded this month</div>'}
        </div>
      </div>
    </div>

    <!-- Individual payment rows -->
    ${pList.length ? `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:18px;">
      <div style="background:#1a3d1a;padding:11px 16px;"><div style="color:#fff;font-weight:700;font-size:13px;">📋 Payment Details — ${monthLabel}</div></div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#1a3d1a;">
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Date</th>
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Resident</th>
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Method</th>
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Source</th>
              <th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${pList.map((p,i) => {
              const res = residents.find(r => r.id === p.resident_id);
              return `<tr>
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);">${fmtDate(p.pay_date)}</td>
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);font-weight:600;">${res ? res.name : '—'}</td>
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text2);">${p.method||'—'}</td>
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text2);font-size:11px;">${p.classification||'—'}</td>
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:#1e7e34;">${fmt(parseFloat(p.amount||0))}</td>
              </tr>`;
            }).join('')}
            <tr style="background:var(--surface2);">
              <td colspan="4" style="padding:10px 12px;font-weight:700;font-size:13px;">Total Income</td>
              <td style="padding:10px 12px;text-align:right;font-weight:800;font-size:14px;color:#1e7e34;">${fmt(totalIncome)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- Individual expense rows -->
    ${(eList.length || bList.some(r => parseFloat(r.amount_paid||0) > 0)) ? `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <div style="background:#6b1a1a;padding:11px 16px;"><div style="color:#fff;font-weight:700;font-size:13px;">🧾 Expense Details — ${monthLabel}</div></div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#6b1a1a;">
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Date</th>
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Category</th>
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Description</th>
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Paid By</th>
              <th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${eList.filter(e => e.expense_type !== 'bill').map(e => `<tr>
              <td style="padding:9px 12px;border-bottom:1px solid var(--border);">${fmtDate(e.exp_date)}</td>
              <td style="padding:9px 12px;border-bottom:1px solid var(--border);"><span style="background:var(--danger-light);color:var(--danger);border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700;">${e.category||'Other'}</span></td>
              <td style="padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text2);">${e.description||'—'}</td>
              <td style="padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text3);">${e.paid_by||'—'}</td>
              <td style="padding:9px 12px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:#c0392b;">${fmt(parseFloat(e.amount||0))}</td>
            </tr>`).join('')}
            ${bList.filter(r => parseFloat(r.amount_paid||0) > 0).map(r => {
              const bill = billDefMap[r.bill_id];
              const entries = (() => { try { return JSON.parse(r.payment_entries||'[]'); } catch { return []; } })();
              return entries.map(entry => `<tr style="background:#f8f5ff;">
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);">${fmtDate(entry.date||r.month_key+'-01')}</td>
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);"><span style="background:#e8f0fe;color:#1a73e8;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700;">🏠 ${bill?.category||'Utilities'}</span></td>
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text2);">${bill?.name||'Bill'} — ${fmtMonthKey(r.month_key)}${entry.note ? ' · ' + entry.note : ''}</td>
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text3);">${entry.by||'—'}</td>
                <td style="padding:9px 12px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:#c0392b;">${fmt(parseFloat(entry.amount||0))}</td>
              </tr>`).join('');
            }).join('')}
            <tr style="background:var(--surface2);">
              <td colspan="4" style="padding:10px 12px;font-weight:700;font-size:13px;">Total Expenses</td>
              <td style="padding:10px 12px;text-align:right;font-weight:800;font-size:14px;color:#c0392b;">${fmt(totalExpenses)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>` : ''}

    ${!pList.length && !eList.length && !bList.some(r => parseFloat(r.amount_paid||0) > 0) ? `<div style="text-align:center;padding:48px;color:var(--text3);font-size:14px;"><div style="font-size:40px;margin-bottom:12px;">📭</div><div style="font-weight:600;margin-bottom:6px;">No financial records for ${monthLabel}</div><div style="font-size:12px;">Payments and expenses recorded in this month will appear here.</div></div>` : ''}
  `;
}

async function printMonthlySummaryReport() {
  if (activeSummaryMonth) await printMonthlyDetailedReport(activeSummaryMonth);
}

async function printMonthlyDetailedReport(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthLabel = `${monthNames[m]} ${y}`;
  const [_py, _pm] = monthKey.split('-').map(Number);
  const { data: payments } = await db.from('payments').select('*').gte('pay_date', `${monthKey}-01`).lte('pay_date', `${monthKey}-${String(new Date(_py, _pm, 0).getDate()).padStart(2,'0')}`).order('pay_date');
  const residents = await getResidents();
  const pList = payments || [];
  const total = pList.reduce((s,p) => s + parseFloat(p.amount||0), 0);
  const fmt2 = (n) => '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

  const rows = pList.map((p,i) => {
    const res = residents.find(r => r.id === p.resident_id);
    return `<tr>
      <td>${i+1}</td>
      <td>${fmtDate(p.pay_date)}</td>
      <td>${res ? res.name : '—'}</td>
      <td>${p.method||'—'}</td>
      <td>${p.period||'—'}</td>
      <td>${p.classification||'—'}</td>
      <td>${p.received_by||'—'}</td>
      <td>${p.receipt_num||'—'}</td>
      <td style="text-align:right;font-weight:bold;">${fmt2(parseFloat(p.amount||0))}</td>
    </tr>`;
  }).join('');

  const html = `${buildReportHeader(`Income Register — ${monthLabel}`, `All payments received during ${monthLabel}`)}
    <table>
      <thead><tr><th>#</th><th>Date</th><th>Resident</th><th>Method</th><th>Period</th><th>Source</th><th>Received By</th><th>Receipt</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row"><td colspan="8" style="text-align:right;">TOTAL INCOME — ${monthLabel.toUpperCase()}</td><td style="text-align:right;">${fmt2(total)}</td></tr></tfoot>
    </table>
    <div class="footer-note">Harmony Living House Adult Family LLC · 120 Newaukum Village Dr, Chehalis, WA 98532 · WAC 388-76 / RCW 70.128</div>`;
  openReportWindow(html, `Income Report — ${monthLabel}`);
}

async function printMonthlyExpenseReport(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthLabel = `${monthNames[m]} ${y}`;
  const [_ey, _em] = monthKey.split('-').map(Number);
  const { data: expenses } = await db.from('expenses').select('*').gte('exp_date', `${monthKey}-01`).lte('exp_date', `${monthKey}-${String(new Date(_ey, _em, 0).getDate()).padStart(2,'0')}`).order('exp_date');
  const eList = expenses || [];
  const total = eList.reduce((s,e) => s + parseFloat(e.amount||0), 0);
  const fmt2 = (n) => '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

  const rows = eList.map((e,i) => `<tr>
    <td>${i+1}</td>
    <td>${fmtDate(e.exp_date)}</td>
    <td>${e.category||'—'}</td>
    <td>${e.description||'—'}</td>
    <td>${e.vendor||'—'}</td>
    <td>${e.method||'—'}</td>
    <td>${e.paid_by||'—'}</td>
    <td style="text-align:right;font-weight:bold;">${fmt2(parseFloat(e.amount||0))}</td>
  </tr>`).join('');

  const html = `${buildReportHeader(`Expense Register — ${monthLabel}`, `All expenses recorded during ${monthLabel}`)}
    <table>
      <thead><tr><th>#</th><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Method</th><th>Paid By</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row"><td colspan="7" style="text-align:right;">TOTAL EXPENSES — ${monthLabel.toUpperCase()}</td><td style="text-align:right;">${fmt2(total)}</td></tr></tfoot>
    </table>
    <div class="footer-note">Harmony Living House Adult Family LLC · 120 Newaukum Village Dr, Chehalis, WA 98532 · WAC 388-76 / RCW 70.128</div>`;
  openReportWindow(html, `Expense Report — ${monthLabel}`);
}

async function openAddPayment() {
  const residents = await getResidents();
  const sel = document.getElementById('pay-resident-id');
  sel.innerHTML = '<option value="">— Select Resident —</option>';
  residents.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.name;
    sel.appendChild(opt);
  });
  document.getElementById('payment-modal-title').textContent = 'Record Payment';
  document.getElementById('pay-edit-id').value = '';
  document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('pay-amount').value = '';
  document.getElementById('pay-method').value = '';
  document.getElementById('pay-period').value = '';
  document.getElementById('pay-notes').value = '';
  document.getElementById('pay-classification').value = '';
  document.querySelectorAll('.pay-tag').forEach(btn => {
    btn.style.opacity = '1';
    btn.style.transform = 'scale(1)';
    btn.dataset.selected = '';
    btn.style.boxShadow = '';
  });
  document.getElementById('pay-received-by').value = currentUser.name;
  document.getElementById('pay-receipt-num').value = genReceiptNum();
  openModal('modal-payment');
}

async function savePayment() {
  const resId = document.getElementById('pay-resident-id').value;
  const date = document.getElementById('pay-date').value;
  const amount = document.getElementById('pay-amount').value;
  if (!resId || !date || !amount) { toast('Please fill in Resident, Date, and Amount'); return; }
  const editId = document.getElementById('pay-edit-id').value;
  const payment = {
    id: editId || uid(),
    resident_id: resId,
    pay_date: date,
    amount: parseFloat(amount).toFixed(2),
    method: document.getElementById('pay-method').value,
    period: document.getElementById('pay-period').value,
    notes: document.getElementById('pay-notes').value.trim(),
    classification: document.getElementById('pay-classification').value || null,
    received_by: document.getElementById('pay-received-by').value.trim(),
    receipt_num: document.getElementById('pay-receipt-num').value.trim() || genReceiptNum(),
    created_at: new Date().toISOString()
  };
  await db.from('payments').upsert(payment);
  closeModal('modal-payment');
  toast('✅ Payment saved — click 🖨️ Receipt to print');
  renderPaymentsPage();
}

async function deletePayment(id) {
  if (!confirm('Delete this payment record? This cannot be undone.')) return;
  await db.from('payments').delete().eq('id', id);
  renderPaymentsPage();
  toast('Payment deleted');
}

async function printReceipt(id) {
  const { data: p } = await db.from('payments').select('*').eq('id', id).single();
  if (!p) return;
  const residents = await getResidents();
  const res = residents.find(r => r.id === p.resident_id);
  const resName = res ? res.name : 'Unknown Resident';
  const resAddr = res ? (res.room ? 'Room: ' + res.room : '') : '';
  const amt = parseFloat(p.amount||0);
  const amtStr = amt.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const amtWords = numberToWords(amt);
  const now = new Date();
  const printedAt = now.toLocaleDateString('en-US', { timeZone:'America/Los_Angeles', month:'long', day:'numeric', year:'numeric' });

  const win = window.open('', '_blank', 'width=700,height=900');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Receipt ${p.receipt_num}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Times New Roman',Times,serif; background:#fff; color:#000; padding:40px 50px; width:650px; margin:0 auto; }
  .header { text-align:center; border-bottom:2px solid #b8860b; padding-bottom:16px; margin-bottom:20px; }
  .header img { width:80px; height:80px; object-fit:contain; display:block; margin:0 auto 10px; }
  .org-name { font-size:15px; font-weight:bold; text-transform:uppercase; letter-spacing:0.05em; color:#1a1a1a; }
  .org-sub { font-size:11px; color:#555; margin-top:3px; }
  .receipt-title { margin:20px 0 4px; font-size:20px; font-weight:bold; text-transform:uppercase; letter-spacing:0.08em; text-align:center; color:#b8860b; }
  .receipt-num { text-align:center; font-size:12px; color:#555; margin-bottom:20px; }
  .section { margin-bottom:14px; }
  .row { display:flex; justify-content:space-between; border-bottom:0.5px solid #ddd; padding:7px 0; font-size:12px; }
  .row .lbl { color:#444; }
  .row .val { font-weight:bold; text-align:right; }
  .amount-box { background:#f8f4e8; border:2px solid #b8860b; border-radius:6px; padding:14px 18px; margin:18px 0; text-align:center; }
  .amount-fig { font-size:28px; font-weight:bold; color:#b8860b; letter-spacing:0.04em; }
  .amount-words { font-size:11.5px; color:#555; margin-top:4px; font-style:italic; }
  .footer { margin-top:28px; border-top:1px solid #000; padding-top:16px; }
  .sig-row { display:flex; justify-content:space-between; margin-top:24px; }
  .sig-block { text-align:center; }
  .sig-line { border-bottom:1px solid #000; width:180px; display:inline-block; margin-bottom:4px; }
  .sig-label { font-size:10px; color:#555; }
  .legal { margin-top:18px; font-size:9.5px; color:#888; text-align:center; line-height:1.6; border-top:0.5px solid #ccc; padding-top:10px; }
  @media print { body { padding:28px 36px; } @page { size:letter; margin:0.6in; } }
</style></head><body>
<div class="header">
  <img src="harmony_living_house_logo.png" alt="Harmony Living House Logo">
  <div class="org-name">Harmony Living House Adult Family LLC</div>
  <div class="org-sub">120 Newaukum Village Dr &nbsp;·&nbsp; Chehalis, WA 98532</div>
  <div class="org-sub">Washington State Licensed Adult Family Home</div>
</div>

<div class="receipt-title">Official Payment Receipt</div>
<div class="receipt-num">Receipt No: <strong>${p.receipt_num}</strong></div>

<div class="section">
  <div class="row"><span class="lbl">Resident Name</span><span class="val">${resName}</span></div>
  ${resAddr ? `<div class="row"><span class="lbl">Room / Unit</span><span class="val">${resAddr}</span></div>` : ''}
  <div class="row"><span class="lbl">Payment Date</span><span class="val">${fmtDate(p.pay_date)}</span></div>
  <div class="row"><span class="lbl">Payment Period</span><span class="val">${p.period||'—'}</span></div>
  <div class="row"><span class="lbl">Payment Method</span><span class="val">${p.method||'—'}</span></div>
  ${p.classification ? `<div class="row"><span class="lbl">Payment Classification</span><span class="val" style="max-width:300px;text-align:right;">${p.classification}</span></div>` : ''}
  ${p.notes ? `<div class="row"><span class="lbl">Description</span><span class="val" style="max-width:300px;text-align:right;">${p.notes}</span></div>` : ''}
</div>

<div class="amount-box">
  <div class="amount-fig">$${amtStr}</div>
  <div class="amount-words">Dollars: ${amtWords}</div>
</div>

<div class="section">
  <div class="row"><span class="lbl">Received By</span><span class="val">${p.received_by||'—'}</span></div>
  <div class="row"><span class="lbl">Date Issued</span><span class="val">${printedAt}</span></div>
</div>

<div class="footer">
  <div class="sig-row">
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-label">Authorized Signature</div>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-label">Resident / Representative Signature</div>
    </div>
  </div>
</div>

<div class="legal">
  This receipt is an official record of payment to Harmony Living House Adult Family LLC.<br>
  Please retain this document for your records. This receipt confirms payment only and does not constitute a contract.<br>
  For questions regarding this payment, contact the facility administrator at 120 Newaukum Village Dr, Chehalis, WA 98532.
</div>
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.addEventListener('afterprint', () => { win.close(); window.focus(); });
  }, 700);
}

function numberToWords(n) {
  if (!n || n === 0) return 'Zero Dollars and Zero Cents';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
                'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
                'Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

  function hw(num) {
    if (num === 0) return '';
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num/10)] + (num%10 ? ' ' + ones[num%10] : '');
    return ones[Math.floor(num/100)] + ' Hundred' + (num%100 ? ' and ' + hw(num%100) : '');
  }

  function fullNumber(num) {
    if (num === 0) return 'Zero';
    let result = '';
    if (num >= 1000000) {
      result += hw(Math.floor(num/1000000)) + ' Million ';
      num = num % 1000000;
    }
    if (num >= 1000) {
      result += hw(Math.floor(num/1000)) + ' Thousand ';
      num = num % 1000;
    }
    if (num >= 100) {
      result += ones[Math.floor(num/100)] + ' Hundred';
      num = num % 100;
      if (num > 0) result += ' and ';
    }
    if (num > 0) result += hw(num);
    return result.trim();
  }

  const dollars = Math.floor(n);
  const cents = Math.round((n - dollars) * 100);

  const dollarWords = fullNumber(dollars);
  const centWords = fullNumber(cents);

  const dollarPart = dollarWords + (dollars === 1 ? ' Dollar' : ' Dollars');
  const centPart = centWords + (cents === 1 ? ' Cent' : ' Cents');

  if (cents === 0) return dollarPart + ' and Zero Cents';
  return dollarPart + ' and ' + centPart;
}

// ══════════════════════════════════
// FINANCIAL REPORTS — SHARED HELPERS
// ══════════════════════════════════
function buildReportHeader(title, subtitle) {
  const now = new Date();
  const printedAt = now.toLocaleDateString('en-US', { timeZone:'America/Los_Angeles', month:'long', day:'numeric', year:'numeric' });
  return `
    <div class="rpt-header">
      <img src="harmony_living_house_logo.png" alt="Logo">
      <div class="rpt-org">Harmony Living House Adult Family LLC</div>
      <div class="rpt-addr">120 Newaukum Village Dr &nbsp;·&nbsp; Chehalis, WA 98532 &nbsp;·&nbsp; Licensed Adult Family Home — Washington State</div>
      <div class="rpt-title">${title}</div>
      ${subtitle ? `<div class="rpt-subtitle">${subtitle}</div>` : ''}
      <div class="rpt-printed">Printed: ${printedAt} &nbsp;·&nbsp; WAC 388-76 / RCW 70.128 Compliant Financial Record</div>
    </div>`;
}

function reportBaseStyles() {
  return `<style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Times New Roman',Times,serif; background:#fff; color:#000; padding:36px 48px; width:816px; margin:0 auto; font-size:11.5px; }
    .rpt-header { text-align:center; border-bottom:2.5px solid #b8860b; padding-bottom:14px; margin-bottom:18px; }
    .rpt-header img { width:72px; height:72px; object-fit:contain; display:block; margin:0 auto 8px; }
    .rpt-org { font-size:15px; font-weight:bold; text-transform:uppercase; letter-spacing:0.04em; }
    .rpt-addr { font-size:10px; color:#555; margin-top:2px; }
    .rpt-title { font-size:16px; font-weight:bold; text-decoration:underline; text-transform:uppercase; letter-spacing:0.06em; margin:8px 0 3px; }
    .rpt-subtitle { font-size:12px; color:#444; margin-bottom:3px; }
    .rpt-printed { font-size:9.5px; color:#888; font-style:italic; }
    .rpt-meta { display:flex; justify-content:space-between; font-size:11px; margin-bottom:12px; padding:6px 0; border-bottom:1px solid #ccc; }
    table { width:100%; border-collapse:collapse; margin-bottom:14px; }
    th { background:#b8860b; color:#fff; padding:6px 8px; font-size:10.5px; font-weight:bold; text-align:left; border:1px solid #8a6408; }
    td { padding:5px 8px; font-size:11px; border:1px solid #ccc; vertical-align:top; }
    tr:nth-child(even) td { background:#fdfaf3; }
    .total-row td { font-weight:bold; background:#f0ead8 !important; border-top:2px solid #b8860b; font-size:11.5px; }
    .section-hdr { font-size:12px; font-weight:bold; background:#1a1a1a; color:#fff; padding:5px 8px; margin:14px 0 6px; letter-spacing:0.04em; text-transform:uppercase; }
    .summary-box { border:1.5px solid #b8860b; border-radius:4px; padding:10px 14px; margin:12px 0; }
    .summary-row { display:flex; justify-content:space-between; font-size:11.5px; padding:4px 0; border-bottom:0.5px solid #e0d8c8; }
    .summary-row:last-child { border-bottom:none; font-weight:bold; font-size:13px; }
    .summary-label { color:#444; }
    .summary-val { font-weight:bold; }
    .net-positive { color:#1e7e34; }
    .net-negative { color:#c0392b; }
    .footer-note { margin-top:18px; font-size:9.5px; color:#777; border-top:0.5px solid #ccc; padding-top:10px; line-height:1.6; }
    .sig-block { display:flex; justify-content:space-between; margin-top:28px; }
    .sig-item { text-align:center; }
    .sig-line { border-bottom:1px solid #000; width:200px; display:inline-block; margin-bottom:3px; }
    .sig-label { font-size:9.5px; color:#555; }
    @media print { body { padding:24px 36px; } @page { size:letter; margin:0.5in; } }
  </style>`;
}

function openReportWindow(html, title) {
  const win = window.open('', '_blank', 'width=900,height=1100');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>${reportBaseStyles()}</head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.addEventListener('afterprint', () => { win.close(); window.focus(); });
  }, 700);
}

async function exportReportAsPDF(html, filename) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'letter' });
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:816px;background:#fff;font-family:Times New Roman,serif;';
  container.innerHTML = html;
  document.body.appendChild(container);
  doc.html(container, {
    callback: (d) => {
      document.body.removeChild(container);
      d.save(filename);
      setTimeout(() => window.focus(), 300);
    },
    x: 36, y: 20, width: 540, windowWidth: 816
  });
}

function getDateRangeLabel(records, dateField) {
  const dates = records.map(r => r[dateField]).filter(Boolean).sort();
  if (!dates.length) return 'All Dates';
  if (dates[0] === dates[dates.length-1]) return fmtDate(dates[0]);
  return fmtDate(dates[0]) + ' — ' + fmtDate(dates[dates.length-1]);
}

// ── INCOME REGISTER (print) ──
async function printIncomeReport() {
  const residents = await getResidents();
  const { data: allPayments } = await db.from('payments').select('*').order('pay_date', { ascending: true });
  const payments = allPayments || [];
  const total = payments.reduce((s,p) => s + parseFloat(p.amount||0), 0);
  const dateRange = getDateRangeLabel(payments, 'pay_date');
  const now = new Date();
  const period = now.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const byResident = {};
  payments.forEach(p => {
    const rName = (residents.find(r=>r.id===p.resident_id)||{}).name || 'Unknown';
    if (!byResident[rName]) byResident[rName] = [];
    byResident[rName].push(p);
  });
  let rows = payments.map((p,i) => {
    const rName = (residents.find(r=>r.id===p.resident_id)||{}).name || 'Unknown';
    return `<tr>
      <td>${i+1}</td><td>${fmtDate(p.pay_date)}</td><td>${rName}</td>
      <td>${p.method||'—'}</td><td>${p.period||'—'}</td>
      <td>${p.notes||'—'}</td><td>${p.received_by||'—'}</td><td>${p.receipt_num||'—'}</td>
      <td style="text-align:right;font-weight:bold;">$${parseFloat(p.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
    </tr>`;
  }).join('');
  const html = `
    ${buildReportHeader('Income Register — Payments Received', `Date Range: ${dateRange}`)}
    <div class="rpt-meta"><span><strong>Facility:</strong> Harmony Living House Adult Family LLC</span><span><strong>Generated:</strong> ${period}</span></div>
    <table>
      <thead><tr><th>#</th><th>Date</th><th>Resident</th><th>Method</th><th>Period</th><th>Description</th><th>Received By</th><th>Receipt No.</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row"><td colspan="8" style="text-align:right;">TOTAL INCOME RECEIVED</td><td style="text-align:right;">$${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr></tfoot>
    </table>
    <div class="summary-box">
      <div class="section-hdr" style="margin:0 0 8px;">Income by Resident</div>
      ${Object.entries(byResident).map(([name,pList])=>{
        const sub=pList.reduce((s,p)=>s+parseFloat(p.amount||0),0);
        return `<div class="summary-row"><span>${name} (${pList.length})</span><span class="net-positive">$${sub.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
      }).join('')}
      <div class="summary-row"><span><strong>GRAND TOTAL</strong></span><span class="net-positive"><strong>$${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></span></div>
    </div>
    <div class="footer-note">Maintained per RCW 70.128.130(15) &amp; WAC 388-76. Retain 5+ years. Harmony Living House Adult Family LLC · 120 Newaukum Village Dr, Chehalis, WA 98532</div>`;
  openReportWindow(html, 'Income Register — Harmony Living House');
}

async function printExpenseReport() {
  const { data: allExpenses } = await db.from('expenses').select('*').order('exp_date', { ascending: true });
  const expenses = allExpenses || [];
  const total = expenses.reduce((s,e) => s + parseFloat(e.amount||0), 0);
  const dateRange = getDateRangeLabel(expenses, 'exp_date');
  const now = new Date();
  const period = now.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const byCat = {};
  expenses.forEach(e => {
    if (!byCat[e.category]) byCat[e.category] = [];
    byCat[e.category].push(e);
  });
  let rows = expenses.map((e,i) => `<tr>
    <td>${i+1}</td><td>${fmtDate(e.exp_date)}</td><td>${e.category}</td>
    <td>${e.description}</td><td>${e.vendor||'—'}</td><td>${e.method||'—'}</td>
    <td>${e.paid_by||'—'}</td><td>${e.receipt_ref||'—'}</td>
    <td style="text-align:right;font-weight:bold;">$${parseFloat(e.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
  </tr>`).join('');
  const html = `
    ${buildReportHeader('Expense Register — Facility Operating Costs', `Date Range: ${dateRange}`)}
    <div class="rpt-meta"><span><strong>Facility:</strong> Harmony Living House Adult Family LLC</span><span><strong>Generated:</strong> ${period}</span></div>
    <table>
      <thead><tr><th>#</th><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Method</th><th>Paid By</th><th>Ref No.</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row"><td colspan="8" style="text-align:right;">TOTAL EXPENSES</td><td style="text-align:right;">$${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr></tfoot>
    </table>
    <div class="summary-box">
      <div class="section-hdr" style="margin:0 0 8px;">Expenses by Category</div>
      ${Object.entries(byCat).sort((a,b)=>b[1].reduce((s,e)=>s+parseFloat(e.amount||0),0)-a[1].reduce((s,e)=>s+parseFloat(e.amount||0),0)).map(([cat,eList])=>{
        const sub=eList.reduce((s,e)=>s+parseFloat(e.amount||0),0);
        return `<div class="summary-row"><span>${cat} (${eList.length})</span><span class="net-negative">$${sub.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
      }).join('')}
      <div class="summary-row"><span><strong>TOTAL EXPENSES</strong></span><span class="net-negative"><strong>$${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></span></div>
    </div>
    <div class="footer-note">Maintained per RCW 70.128.130(15) &amp; WAC 388-76. Retain 5+ years. Harmony Living House Adult Family LLC · 120 Newaukum Village Dr, Chehalis, WA 98532</div>`;
  openReportWindow(html, 'Expense Register — Harmony Living House');
}

async function printPLSummary() {
  const residents = await getResidents();
  const { data: allPayments } = await db.from('payments').select('*').order('pay_date', { ascending: true });
  const { data: allExpenses } = await db.from('expenses').select('*').order('exp_date', { ascending: true });
  const payments = allPayments || [];
  const expenses = allExpenses || [];
  const now = new Date();
  const thisYear = now.getFullYear();
  const period = `Fiscal Year ${thisYear} (January – ${now.toLocaleDateString('en-US',{month:'long'})} ${thisYear})`;
  const months = Array.from({length:12},(_,i)=>i);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthlyRows = months.map(m => {
    const mStr = `${thisYear}-${String(m+1).padStart(2,'0')}`;
    const inc = payments.filter(p=>p.pay_date&&p.pay_date.startsWith(mStr)).reduce((s,p)=>s+parseFloat(p.amount||0),0);
    const exp = expenses.filter(e=>e.exp_date&&e.exp_date.startsWith(mStr)).reduce((s,e)=>s+parseFloat(e.amount||0),0);
    const net = inc - exp;
    const hasTx = inc > 0 || exp > 0;
    return `<tr${!hasTx?' style="opacity:0.4;"':''}>
      <td style="font-weight:bold;">${monthNames[m]} ${thisYear}</td>
      <td style="text-align:right;color:#1e7e34;">$${inc.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right;color:#c0392b;">$${exp.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right;font-weight:bold;color:${net>=0?'#1e7e34':'#c0392b'}">${net<0?'-$':'$'}${Math.abs(net).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
    </tr>`;
  }).join('');
  const totalInc = payments.reduce((s,p)=>s+parseFloat(p.amount||0),0);
  const totalExp = expenses.reduce((s,e)=>s+parseFloat(e.amount||0),0);
  const netTotal = totalInc - totalExp;
  const byCat = {};
  expenses.forEach(e => { if (!byCat[e.category]) byCat[e.category]=0; byCat[e.category]+=parseFloat(e.amount||0); });
  const byRes = {};
  payments.forEach(p => { const n=(residents.find(r=>r.id===p.resident_id)||{}).name||'Unknown'; if(!byRes[n])byRes[n]=0; byRes[n]+=parseFloat(p.amount||0); });
  const html = `
    ${buildReportHeader('Financial Summary — Profit & Loss Statement', period)}
    <div class="rpt-meta"><span><strong>Facility:</strong> Harmony Living House Adult Family LLC</span><span><strong>Prepared:</strong> ${now.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</span></div>
    <div class="section-hdr">Monthly Profit &amp; Loss — ${thisYear}</div>
    <table>
      <thead><tr><th>Month</th><th style="text-align:right;">Income</th><th style="text-align:right;">Expenses</th><th style="text-align:right;">Net</th></tr></thead>
      <tbody>${monthlyRows}</tbody>
      <tfoot><tr class="total-row">
        <td>YEAR TOTAL</td>
        <td style="text-align:right;color:#1e7e34;">$${totalInc.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td style="text-align:right;color:#c0392b;">$${totalExp.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td style="text-align:right;color:${netTotal>=0?'#1e7e34':'#c0392b'}">${netTotal<0?'-$':'$'}${Math.abs(netTotal).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      </tr></tfoot>
    </table>
    <div class="summary-box" style="background:#f8f4e8;border:2px solid #b8860b;">
      <div class="summary-row"><span>Total Income</span><span class="net-positive">$${totalInc.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
      <div class="summary-row"><span>Total Expenses</span><span class="net-negative">($${totalExp.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})})</span></div>
      <div class="summary-row"><span><strong>NET INCOME</strong></span><span style="color:${netTotal>=0?'#1e7e34':'#c0392b'};font-size:15px;"><strong>${netTotal<0?'-$':'$'}${Math.abs(netTotal).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></span></div>
    </div>
    <div class="footer-note">Prepared per RCW 70.128.130(15) &amp; WAC 388-76. Harmony Living House Adult Family LLC · 120 Newaukum Village Dr, Chehalis, WA 98532</div>`;
  openReportWindow(html, 'P&L Summary — Harmony Living House');
}

// ══════════════════════════════════
// EXPENSES
// ══════════════════════════════════
let currentExpenseType = 'general';

function setExpenseType(type) {
  currentExpenseType = type;
  const isWage = type === 'wage';
  const isBill = type === 'bill';
  const isGeneral = type === 'general';
  // Toggle button styles
  const btnG = document.getElementById('exp-type-btn-general');
  const btnW = document.getElementById('exp-type-btn-wage');
  const btnB = document.getElementById('exp-type-btn-bill');
  if (btnG) { btnG.style.background = isGeneral ? 'var(--accent)' : 'var(--surface2)'; btnG.style.color = isGeneral ? '#fff' : 'var(--text2)'; }
  if (btnW) { btnW.style.background = isWage ? '#1a1a1a' : 'var(--surface2)'; btnW.style.color = isWage ? '#fff' : 'var(--text2)'; }
  if (btnB) { btnB.style.background = isBill ? 'linear-gradient(135deg,#0f2027,#2c5364)' : 'var(--surface2)'; btnB.style.color = isBill ? '#fff' : 'var(--text2)'; }
  // Toggle field visibility
  const gFields = document.getElementById('exp-general-fields');
  const wFields = document.getElementById('exp-wage-fields');
  const bFields = document.getElementById('exp-bill-fields');
  if (gFields) gFields.style.display = isGeneral ? 'contents' : 'none';
  if (wFields) wFields.style.display = isWage ? 'block' : 'none';
  if (bFields) bFields.style.display = isBill ? 'block' : 'none';
  if (isBill) {
    populateBillSelect();
    document.getElementById('exp-bill-summary').style.display = 'none';
    document.getElementById('exp-bill-payment-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('exp-bill-payment-by').value = currentUser ? currentUser.name : '';
    document.getElementById('exp-bill-payment-amount').value = '';
    document.getElementById('exp-bill-payment-note').value = '';
  }
}

function calcWageTotal() { /* removed — hours/rate fields no longer used */ }

function openAddExpense() {
  document.getElementById('expense-modal-title').textContent = 'Add Expense';
  document.getElementById('exp-edit-id').value = '';
  document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
  // General fields
  const amtG = document.getElementById('exp-amount-general');
  if (amtG) { amtG.value = ''; delete amtG.dataset.manualOverride; }
  document.getElementById('exp-category').value = '';
  document.getElementById('exp-description').value = '';
  document.getElementById('exp-vendor').value = '';
  document.getElementById('exp-method').value = '';
  document.getElementById('exp-paid-by').value = currentUser ? currentUser.name : '';
  document.getElementById('exp-receipt').value = '';
  document.getElementById('exp-notes').value = '';
  // Wage fields
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-wage-staff').value = '';
  document.getElementById('exp-wage-other-name').value = '';
  document.getElementById('exp-wage-other-wrap').style.display = 'none';
  document.getElementById('exp-wage-period-start').value = '';
  document.getElementById('exp-wage-period-end').value = '';
  document.getElementById('exp-wage-method').value = '';
  document.getElementById('exp-wage-paid-by').value = currentUser ? currentUser.name : '';
  document.getElementById('exp-wage-ref').value = '';
  document.getElementById('exp-wage-notes').value = '';
  setExpenseType('general');

  // Wire up "Other" staff toggle + balance panel
  const staffSel = document.getElementById('exp-wage-staff');
  staffSel.onchange = () => {
    document.getElementById('exp-wage-other-wrap').style.display = staffSel.value === 'Other' ? 'block' : 'none';
    renderWageBalancePanel(staffSel.value);
    const startLabel = document.getElementById('wage-period-start-label');
    const endLabel = document.getElementById('wage-period-end-label');
    if (startLabel) startLabel.textContent = staffSel.value === 'Ketty' ? 'Sunday Date *' : 'Pay Period Start *';
    if (endLabel) endLabel.style.display = staffSel.value === 'Ketty' ? 'none' : '';
    // Auto-fill end date for Ketty = same as start
    if (staffSel.value === 'Ketty') {
    document.getElementById('exp-wage-period-start').onchange = () => {
    document.getElementById('exp-wage-period-end').value = document.getElementById('exp-wage-period-start').value;
  };
}
  };
  // Also re-render panel when period dates change
  document.getElementById('exp-wage-period-start').onchange = () => renderWageBalancePanel(document.getElementById('exp-wage-staff').value);
  document.getElementById('exp-wage-period-end').onchange = () => renderWageBalancePanel(document.getElementById('exp-wage-staff').value);
  document.getElementById('wage-balance-panel').style.display = 'none';
  // Prevent auto-calc override when user manually types amount
  const amtWage = document.getElementById('exp-amount');
  amtWage.oninput = () => { amtWage.dataset.manualOverride = '1'; };

  openModal('modal-expense');
}

async function editExpense(id) {
  const { data: e } = await db.from('expenses').select('*').eq('id', id).single();
  if (!e) return;
  document.getElementById('expense-modal-title').textContent = 'Edit Expense';
  document.getElementById('exp-edit-id').value = id;
  document.getElementById('exp-date').value = e.exp_date || '';

  const isWage = e.expense_type === 'wage';
  setExpenseType(isWage ? 'wage' : 'general');

  if (isWage) {
    const staffNames = ['James','Alvan','Ketty','Joseph'];
    const staffSel = document.getElementById('exp-wage-staff');
    if (staffNames.includes(e.wage_staff)) { staffSel.value = e.wage_staff; }
    else { staffSel.value = 'Other'; document.getElementById('exp-wage-other-name').value = e.wage_staff || ''; document.getElementById('exp-wage-other-wrap').style.display = 'block'; }
    staffSel.onchange = () => { document.getElementById('exp-wage-other-wrap').style.display = staffSel.value === 'Other' ? 'block' : 'none'; };
    document.getElementById('exp-wage-period-start').value = e.wage_period_start || '';
    document.getElementById('exp-amount').value = e.amount || '';
    document.getElementById('exp-amount').dataset.manualOverride = '1';
    document.getElementById('exp-amount').oninput = () => { document.getElementById('exp-amount').dataset.manualOverride = '1'; };
    document.getElementById('exp-amount').oninput = () => { document.getElementById('exp-amount').dataset.manualOverride = '1'; };
    document.getElementById('exp-wage-method').value = e.method || '';
    document.getElementById('exp-wage-paid-by').value = e.paid_by || '';
    document.getElementById('exp-wage-ref').value = e.receipt_ref || '';
    document.getElementById('exp-wage-notes').value = e.notes || '';
  } else {
    document.getElementById('exp-amount-general').value = e.amount || '';
    document.getElementById('exp-category').value = e.category || '';
    document.getElementById('exp-description').value = e.description || '';
    document.getElementById('exp-vendor').value = e.vendor || '';
    document.getElementById('exp-method').value = e.method || '';
    document.getElementById('exp-paid-by').value = e.paid_by || '';
    document.getElementById('exp-receipt').value = e.receipt_ref || '';
    document.getElementById('exp-notes').value = e.notes || '';
  }
  openModal('modal-expense');
}

async function saveExpense() {
  const date = document.getElementById('exp-date').value;
  const editId = document.getElementById('exp-edit-id').value;
  const isBill = currentExpenseType === 'bill';
  const isWage = currentExpenseType === 'wage';

  // ── BILL PAYMENT SAVE ──
  if (isBill) {
    const billId = document.getElementById('exp-bill-select').value;
    const amount = parseFloat(document.getElementById('exp-bill-payment-amount').value);
    const payDate = document.getElementById('exp-bill-payment-date').value;
    if (!billId) { toast('Please select a bill'); return; }
    if (!amount || amount <= 0) { toast('Please enter a valid payment amount'); return; }
    if (!payDate) { toast('Please enter the payment date'); return; }
    const billPayDate = document.getElementById('exp-bill-payment-date').value || toLocalDateStr(new Date());
    const currentMK = billPayDate.slice(0, 7);
    const { data: b } = await db.from('recurring_bills').select('*').eq('id', billId).single();
    if (!b) { toast('Bill not found'); return; }
    let { data: rec } = await db.from('bill_month_records').select('*').eq('bill_id', billId).eq('month_key', currentMK).maybeSingle();
    if (!rec) {
      const newRec = {
        id: uid(), bill_id: billId, month_key: currentMK,
        amount_due: parseFloat(b.default_amount || 0), amount_paid: 0,
        is_fully_paid: false, payment_entries: '[]', created_at: new Date().toISOString()
      };
      await db.from('bill_month_records').insert(newRec);
      rec = newRec;
    }
    const entries = (() => { try { return JSON.parse(rec.payment_entries || '[]'); } catch { return []; } })();
    entries.push({
      id: uid(), amount,
      date: payDate,
      by: document.getElementById('exp-bill-payment-by').value.trim(),
      note: document.getElementById('exp-bill-payment-note').value.trim()
    });
    const newAmountPaid = parseFloat(rec.amount_paid || 0) + amount;
    const isFullyPaid = newAmountPaid >= parseFloat(rec.amount_due || 0) - 0.005;
    const { error } = await db.from('bill_month_records').update({
      amount_paid: newAmountPaid,
      is_fully_paid: isFullyPaid,
      payment_entries: JSON.stringify(entries)
    }).eq('id', rec.id);
    if (error) { toast('Error saving payment: ' + error.message); return; }

    // Record as expense so it counts in totals — use actual payment date for correct month
    const expenseRecord = {
      id: uid(),
      expense_type: 'bill',
      exp_date: billPayDate,
      amount: parseFloat(amount).toFixed(2),
      category: b.category || 'Utilities',
      description: `${b.name} — ${fmtMonthKey(currentMK)}`,
      vendor: b.name || '',
      method: null,
      paid_by: document.getElementById('exp-bill-payment-by').value.trim(),
      receipt_ref: document.getElementById('exp-bill-payment-note').value.trim(),
      notes: `Bill payment — ${fmtMonthKey(currentMK)}`,
      wage_staff: null,
      bill_id: billId,
      bill_month_key: currentMK,
      created_at: new Date().toISOString()
    };
    await db.from('expenses').insert(expenseRecord);

    closeModal('modal-expense');
    toast(isFullyPaid ? `✅ ${b.name} fully paid for ${fmtMonthKey(currentMK)}!` : `✅ $${amount.toFixed(2)} recorded for ${b.name} — ${fmtMonthKey(currentMK)}`);
    renderExpensesPanel();
    renderPaymentsPage();
    return;
  }

  if (isWage) {
    const staffSel = document.getElementById('exp-wage-staff').value;
    const staffName = staffSel === 'Other' ? document.getElementById('exp-wage-other-name').value.trim() : staffSel;
    const amount = document.getElementById('exp-amount').value;
    const periodStart = document.getElementById('exp-wage-period-start').value;
    const periodEnd = document.getElementById('exp-wage-period-end').value;
    if (!date || !staffName || !amount || !periodStart || !periodEnd) {
      toast('Please fill in Date, Staff Member, Pay Period and Amount'); return;
    }
    const periodLabel = fmtDate(periodStart) + ' – ' + fmtDate(periodEnd);
    const expense = {
      id: editId || uid(),
      expense_type: 'wage',
      exp_date: date,
      amount: parseFloat(amount).toFixed(2),
      category: 'Staff Wages',
      description: `Wages — ${staffName} (${periodLabel})`,
      wage_staff: staffName,
      wage_period_start: periodStart,
      wage_period_end: periodEnd,
      wage_hours: null,
      wage_rate: null,
      method: document.getElementById('exp-wage-method').value,
      paid_by: document.getElementById('exp-wage-paid-by').value.trim(),
      receipt_ref: document.getElementById('exp-wage-ref').value.trim(),
      notes: document.getElementById('exp-wage-notes').value.trim(),
      vendor: null,
      created_at: new Date().toISOString()
    };
    const { error } = await db.from('expenses').upsert(expense);
    if (error) { toast('Error saving wage: ' + error.message); return; }
    const _expectedAmt = staffCfg && staffCfg.amount ? parseFloat(staffCfg.amount) : 0;
    const _paidAmt = parseFloat(amount);
    const _excess = _expectedAmt > 0 ? _paidAmt - _expectedAmt : 0;
    if (_excess > 0.005) {
      const _pStart = new Date(periodStart + 'T00:00:00');
      const _nextDate = new Date(_pStart.getFullYear(), _pStart.getMonth() + 1, 1);
      const _nextMK = _nextDate.toISOString().slice(0,7);
      const _nextStart = _nextMK + '-01';
      const _lastDay = new Date(_nextDate.getFullYear(), _nextDate.getMonth() + 1, 0).getDate();
      const _nextEnd = _nextMK + '-' + String(_lastDay).padStart(2,'0');
      await db.from('expenses').insert({
        id: uid(), expense_type: 'wage', exp_date: _nextStart,
        amount: _excess.toFixed(2), category: 'Staff Wages',
        description: 'Wages — ' + staffName + ' (forwarded overpayment from ' + fmtDate(periodStart) + ')',
        wage_staff: staffName, wage_period_start: _nextStart, wage_period_end: _nextEnd,
        wage_hours: null, wage_rate: null,
        method: document.getElementById('exp-wage-method').value,
        paid_by: document.getElementById('exp-wage-paid-by').value.trim(),
        receipt_ref: 'Forwarded from ' + fmtDate(periodStart),
        notes: 'Auto-forwarded overpayment of $' + _excess.toFixed(2),
        vendor: null, created_at: new Date().toISOString()
      });
      toast('Wage saved — $' + _excess.toFixed(2) + ' overpayment forwarded to next month');
    }
  } else {
    const amount = document.getElementById('exp-amount-general').value;
    const category = document.getElementById('exp-category').value;
    const description = document.getElementById('exp-description').value.trim();
    if (!date || !amount || !category || !description) {
      toast('Please fill in Date, Amount, Category and Description'); return;
    }
    const expense = {
      id: editId || uid(),
      expense_type: 'general',
      exp_date: date,
      amount: parseFloat(amount).toFixed(2),
      category,
      description,
      vendor: document.getElementById('exp-vendor').value.trim(),
      method: document.getElementById('exp-method').value,
      paid_by: document.getElementById('exp-paid-by').value.trim(),
      receipt_ref: document.getElementById('exp-receipt').value.trim(),
      notes: document.getElementById('exp-notes').value.trim(),
      wage_staff: null,
      created_at: new Date().toISOString()
    };
    const { error } = await db.from('expenses').upsert(expense);
    if (error) { toast('Error saving expense: ' + error.message); return; }
  }

  closeModal('modal-expense');
  toast(editId ? (isWage ? 'Wage record updated' : 'Expense updated') : (isWage ? '✅ Wage payment recorded' : '✅ Expense saved'));
  renderExpensesPanel();
  renderPaymentsPage();
}

async function deleteExpense(id) {
  if (!confirm('Delete this record? This cannot be undone.')) return;
  await db.from('expenses').delete().eq('id', id);
  renderExpensesPanel();
  renderPaymentsPage();
  toast('Record deleted');
}

const EXP_CATEGORY_ICONS = {
  'Food & Groceries': '🛒',
  'Household Supplies': '🧹',
  'Personal Care Supplies': '🧴',
  'Medications & Medical': '💊',
  'Medical Equipment': '🩺',
  'Staff Wages': '👤',
  'Staff Training': '📚',
  'Utilities': '💡',
  'Maintenance & Repairs': '🔧',
  'Transportation': '🚗',
  'Insurance': '🛡️',
  'Licensing & Compliance': '📋',
  'Office & Admin': '🗂️',
  'Other': '📦',
};

// STAFF_COLORS defined in salary config section below

async function renderExpensesPanel() {
  const q = (document.getElementById('exp-search')?.value || '').toLowerCase();
  const dateF = document.getElementById('exp-date-filter')?.value;
  const catF = document.getElementById('exp-cat-filter')?.value;

  const { data: allExpenses } = await db.from('expenses').select('*').order('exp_date', { ascending: false });
  let expenses = allExpenses || [];

  const thisMonth = new Date().toISOString().slice(0, 7);
  const currentMK = getCurrentMonthKey();

  // Sum all expenses rows (general + wage + bill payments already dual-written)
  const totalExpFromRows = expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const monthExpFromRows = expenses.filter(e => e.exp_date && e.exp_date.startsWith(thisMonth)).reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  // Also pull bill_month_records to catch any bill payments not yet in expenses table
  const { data: allBillRecs } = await db.from('bill_month_records').select('amount_paid, month_key');
  const billRecs = allBillRecs || [];

  const billAlreadyCounted = expenses.filter(e => e.expense_type === 'bill').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const billAlreadyCountedThisMonth = expenses.filter(e => e.expense_type === 'bill' && e.exp_date && e.exp_date.startsWith(thisMonth)).reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  const billRecordsTotal = billRecs.reduce((s, r) => s + parseFloat(r.amount_paid || 0), 0);
  const billRecordsThisMonth = billRecs.filter(r => r.month_key === currentMK).reduce((s, r) => s + parseFloat(r.amount_paid || 0), 0);

  // Gap = payments in bill_month_records not yet reflected as expense rows (legacy data)
  const billGap = Math.max(0, billRecordsTotal - billAlreadyCounted);
  const billGapThisMonth = Math.max(0, billRecordsThisMonth - billAlreadyCountedThisMonth);

  const totalExp = totalExpFromRows + billGap;
  const monthExp = monthExpFromRows + billGapThisMonth;

  const expStatEl = document.getElementById('pay-stat-expenses');
  const expStatCard = expStatEl ? expStatEl.closest('.stat-card') : null;
  if (expStatEl) expStatEl.textContent = '$' + totalExp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (expStatCard) {
    expStatCard.style.transition = 'background 0.4s, border-color 0.4s';
    expStatCard.style.background = totalExp > 0 ? '#fdf0ef' : '';
    expStatCard.style.borderColor = totalExp > 0 ? '#f5c0bb' : '';
    const expVal = expStatCard.querySelector('.value');
    if (expVal) expVal.style.color = totalExp > 0 ? '#c0392b' : 'var(--text)';
  }
  const expMonthEl = document.getElementById('exp-stat-month');
  if (expMonthEl) expMonthEl.textContent = '$' + monthExp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (q) expenses = expenses.filter(e => JSON.stringify(e).toLowerCase().includes(q));
  if (dateF) expenses = expenses.filter(e => e.exp_date === dateF);
  if (catF) expenses = expenses.filter(e => e.category === catF);

  const expCountEl = document.getElementById('exp-stat-count');
  if (expCountEl) expCountEl.textContent = expenses.length;
  renderWageBalanceStrip();

  const container = document.getElementById('expenses-list');
  if (!container) return;

  if (!expenses.length) {
    container.innerHTML = `<div class="empty-state"><div style="font-size:40px;margin-bottom:10px;">🧾</div><h4>No Expenses Recorded</h4><p>Add facility expenses using the button above.</p></div>`;
    return;
  }

  // Separate wages, bill payments, and general expenses
  const wages = expenses.filter(e => e.expense_type === 'wage' || e.category === 'Staff Wages');
  const general = expenses.filter(e => e.expense_type !== 'wage' && e.category !== 'Staff Wages' && e.expense_type !== 'bill');

  let html = '';

  // ── STAFF WAGES SECTION ──
  if (wages.length) {
    const wageTotal = wages.reduce((s,e) => s + parseFloat(e.amount||0), 0);
    html += `
      <div style="margin-bottom:8px;margin-top:4px;">
        <div onclick="toggleExpenseSection('wages')" id="wages-section-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(90deg,#1a1a1a,#2d2d2d);border-radius:8px;cursor:pointer;user-select:none;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:16px;">👤</span>
            <span style="color:#fff;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Staff Wages</span>
            <span style="color:rgba(255,255,255,0.65);font-size:11px;">${wages.length} payment${wages.length!==1?'s':''} &nbsp;·&nbsp; -$${wageTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
          </div>
          <span id="wages-section-chevron" style="color:#f5c842;font-size:16px;transition:transform 0.2s;display:inline-block;">▼</span>
        </div>
        <div id="wages-section-body" style="display:none;"><div style="border:1px solid #2d2d2d;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">
          ${wages.map(e => {
            const amt = parseFloat(e.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
            const staffName = e.wage_staff || 'Staff';
            const colors = STAFF_COLORS[staffName] || { bg:'#f4f6f9', border:'#8a9ab0', text:'#4a5568', dot:'#8a9ab0' };
            const periodLabel = e.wage_period_start && e.wage_period_end
              ? fmtDate(e.wage_period_start) + ' – ' + fmtDate(e.wage_period_end) : '';
            const hoursInfo = e.wage_hours ? `${e.wage_hours} hrs` + (e.wage_rate ? ` @ $${parseFloat(e.wage_rate).toFixed(2)}/hr` : '') : '';
            return `<div style="padding:12px 14px;border-bottom:1px solid #e8e8e8;background:#fff;display:flex;align-items:center;gap:12px;">
              <!-- Staff colour dot + name badge -->
              <div style="flex-shrink:0;text-align:center;min-width:64px;">
                <div style="width:40px;height:40px;border-radius:50%;background:${colors.bg};border:2px solid ${colors.border};display:flex;align-items:center;justify-content:center;margin:0 auto 3px;font-size:15px;font-weight:800;color:${colors.text};">${staffName.charAt(0)}</div>
                <div style="font-size:10px;font-weight:700;color:${colors.text};">${staffName}</div>
              </div>
              <!-- Details -->
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">
                  <span style="font-weight:700;font-size:13.5px;color:#1a2332;">Wage Payment</span>
                  <span style="background:${colors.bg};color:${colors.text};border:1px solid ${colors.border};border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700;">${staffName}</span>
                  ${e.method ? `<span style="background:var(--surface2);color:var(--text2);border-radius:20px;padding:2px 8px;font-size:11px;">${e.method}</span>` : ''}
                </div>
                <div style="font-size:12px;color:var(--text2);line-height:1.7;">
                  ${fmtDate(e.exp_date)}
                  ${periodLabel ? `&nbsp;·&nbsp; Period: <strong>${periodLabel}</strong>` : ''}
                  ${hoursInfo ? `&nbsp;·&nbsp; ${hoursInfo}` : ''}
                </div>
                ${e.notes ? `<div style="font-size:11.5px;color:var(--text3);margin-top:2px;">${e.notes}</div>` : ''}
                ${e.paid_by ? `<div style="font-size:11px;color:var(--text3);">Authorized by: ${e.paid_by}${e.receipt_ref ? ' · Ref: ' + e.receipt_ref : ''}</div>` : ''}
              </div>
              <!-- Amount + actions -->
              <div style="flex-shrink:0;text-align:right;">
                <div style="font-size:17px;font-weight:800;color:var(--danger);">-$${amt}</div>
                <div style="display:flex;gap:4px;margin-top:6px;justify-content:flex-end;">
                  <button class="btn btn-secondary btn-sm" style="font-size:11px;padding:4px 10px;" onclick="editExpense('${e.id}')">Edit</button>
                  <button class="btn btn-danger btn-sm" style="font-size:11px;padding:4px 10px;" onclick="deleteExpense('${e.id}')">Delete</button>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div></div>
      </div>`;
  }

  // ── BILLS & UTILITIES COLLAPSIBLE SECTION ──
  html += `<div id="bills-inline-section" style="margin-top:${wages.length?'14px':'4px'};margin-bottom:14px;">
    <div onclick="toggleExpenseSection('bills')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(90deg,#0f2027,#2c5364);border-radius:8px;cursor:pointer;user-select:none;" id="bills-section-header">
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <span style="font-size:16px;">🏠</span>
        <span style="color:#fff;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Bills &amp; Utilities</span>
        <span id="bills-section-summary" style="color:rgba(255,255,255,0.65);font-size:11px;margin-left:4px;"></span>
      </div>
      <span id="bills-section-chevron" style="color:#fff;font-size:16px;transition:transform 0.2s;display:inline-block;">▼</span>
    </div>
    <div id="bills-inline-grid" style="border:1px solid #2c5364;border-top:none;border-radius:0 0 8px 8px;padding:14px;background:#fff;display:none;">
      <div style="color:var(--text3);font-size:13px;font-style:italic;text-align:center;padding:10px 0;">Loading bills…</div>
    </div>
  </div>`;

  // ── GENERAL EXPENSES COLLAPSIBLE SECTION ──
  if (general.length) {
    const genTotal = general.reduce((s,e) => s + parseFloat(e.amount||0), 0);
    html += `
      <div style="margin-top:4px;">
        <div onclick="toggleExpenseSection('general')" id="general-section-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(90deg,#5a1a1a,#8b2020);border-radius:8px;cursor:pointer;user-select:none;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:16px;">🧾</span>
            <span style="color:#fff;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Groceries &amp; General</span>
            <span style="color:rgba(255,255,255,0.65);font-size:11px;">${general.length} item${general.length!==1?'s':''} &nbsp;·&nbsp; -$${genTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
          </div>
          <span id="general-section-chevron" style="color:#fff;font-size:16px;transition:transform 0.2s;display:inline-block;">▼</span>
        </div>
        <div id="general-section-body" style="display:none;">
        <div style="border:1px solid #8b2020;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">
          ${general.map(e => {
            const amt = parseFloat(e.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
            const icon = EXP_CATEGORY_ICONS[e.category] || '📦';
            return `<div style="padding:11px 14px;border-bottom:1px solid #f0e0e0;background:#fff;display:flex;align-items:center;gap:10px;">
              <span style="font-size:22px;flex-shrink:0;">${icon}</span>
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px;">
                  <span style="font-weight:700;font-size:13.5px;color:#1a2332;">${e.description}</span>
                  <span style="background:var(--danger-light);color:var(--danger);border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700;">${e.category}</span>
                  ${e.vendor ? `<span style="background:var(--surface2);color:var(--text2);border-radius:20px;padding:2px 8px;font-size:11px;">${e.vendor}</span>` : ''}
                </div>
                <div style="font-size:12px;color:var(--text2);">${fmtDate(e.exp_date)}${e.method ? ' · ' + e.method : ''}</div>
                ${e.notes ? `<div style="font-size:11.5px;color:var(--text3);margin-top:1px;">${e.notes}</div>` : ''}
                ${e.paid_by ? `<div style="font-size:11px;color:var(--text3);">Paid by: ${e.paid_by}${e.receipt_ref ? ' · Ref: ' + e.receipt_ref : ''}</div>` : ''}
              </div>
              <div style="flex-shrink:0;text-align:right;">
                <div style="font-size:16px;font-weight:800;color:var(--danger);">-$${amt}</div>
                <div style="display:flex;gap:4px;margin-top:6px;justify-content:flex-end;">
                  <button class="btn btn-secondary btn-sm" style="font-size:11px;padding:4px 10px;" onclick="editExpense('${e.id}')">Edit</button>
                  <button class="btn btn-danger btn-sm" style="font-size:11px;padding:4px 10px;" onclick="deleteExpense('${e.id}')">Delete</button>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
  // Render bills inline after the DOM is updated
  renderBillsInline();
}

const _expSectionState = { wages: false, bills: false, general: false };

function toggleExpenseSection(section) {
  _expSectionState[section] = !_expSectionState[section];
  const isOpen = _expSectionState[section];
  const bodyMap = { wages: 'wages-section-body', bills: 'bills-inline-grid', general: 'general-section-body' };
  const chevronMap = { wages: 'wages-section-chevron', bills: 'bills-section-chevron', general: 'general-section-chevron' };
  const body = document.getElementById(bodyMap[section]);
  const chevron = document.getElementById(chevronMap[section]);
  if (body) body.style.display = isOpen ? 'block' : 'none';
  if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
  if (section === 'bills' && isOpen) renderBillsInline();
}

async function renderBillsInline() {
  const inlineGrid = document.getElementById('bills-inline-grid');
  if (!inlineGrid) return;
  const bills = await getBills();
  const currentMK = getCurrentMonthKey();
  const currentRecords = await getBillMonthRecords(currentMK);
  const currentMap = {};
  currentRecords.forEach(r => { currentMap[r.bill_id] = r; });

  const summaryEl = document.getElementById('bills-section-summary');
  if (!bills.length) {
    inlineGrid.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">
      No bills added yet. <button onclick="openAddExpenseBill()" style="color:var(--accent);background:none;border:none;cursor:pointer;font-weight:700;font-family:inherit;">Add your first bill →</button>
    </div>`;
    if (summaryEl) summaryEl.textContent = '0 bills';
    return;
  }

  const currentRecordsForSummary = await getBillMonthRecords(getCurrentMonthKey());
  const currentMapForSummary = {};
  currentRecordsForSummary.forEach(r => { currentMapForSummary[r.bill_id] = r; });
  const totalDue = bills.reduce((s,b) => s + parseFloat((currentMapForSummary[b.id]?.amount_due) || b.default_amount || 0), 0);
  const paidCount = bills.filter(b => currentMapForSummary[b.id]?.is_fully_paid).length;
  if (summaryEl) summaryEl.textContent = `${bills.length} bill${bills.length!==1?'s':''} · ${paidCount}/${bills.length} paid · $${totalDue.toFixed(2)} due`;

  const today = new Date();
  inlineGrid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">
    ${bills.map(b => {
      const rec = currentMap[b.id];
      const amountDue = rec ? parseFloat(rec.amount_due) : parseFloat(b.default_amount || 0);
      const amountPaid = rec ? parseFloat(rec.amount_paid || 0) : 0;
      const isFullyPaid = rec ? rec.is_fully_paid : false;
      const remaining = Math.max(0, amountDue - amountPaid);
      const pct = amountDue > 0 ? Math.min(100, Math.round(amountPaid / amountDue * 100)) : 0;
      const isPartial = amountPaid > 0 && !isFullyPaid;
      const dueDate = b.due_day ? new Date(today.getFullYear(), today.getMonth(), b.due_day) : null;
      const isPastDue = dueDate && today > dueDate && !isFullyPaid;
      const icon = BILL_ICONS[b.category] || '📋';

      let borderColor, barColor, statusText, statusBg, statusColor;
      if (isFullyPaid) { borderColor='#a8d5b0'; barColor='#1e7e34'; statusText='✅ PAID'; statusBg='#e6f4ea'; statusColor='#1e7e34'; }
      else if (isPartial) { borderColor='#ffe08a'; barColor='#d68910'; statusText='⏳ PARTIAL'; statusBg='#fff3cd'; statusColor='#856404'; }
      else if (isPastDue) { borderColor='#f5c0bb'; barColor='#c0392b'; statusText='🔴 OVERDUE'; statusBg='#fdf0ef'; statusColor='#c0392b'; }
      else { borderColor='var(--border)'; barColor='#e0e0e0'; statusText='UNPAID'; statusBg='var(--surface2)'; statusColor='var(--text3)'; }

      return `<div style="border:1.5px solid ${borderColor};border-radius:10px;padding:12px 13px;background:#fff;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:7px;">
            <span style="font-size:22px;">${icon}</span>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--text);">${b.name}</div>
              <div style="font-size:10px;color:var(--text3);">${b.category}${b.due_day ? ' · Due ' + ordinal(b.due_day) : ''}</div>
            </div>
          </div>
          <span style="background:${statusBg};color:${statusColor};border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;white-space:nowrap;">${statusText}</span>
        </div>
        <div style="margin-bottom:4px;">
          ${amountDue > 0
            ? `<span style="font-size:18px;font-weight:800;color:var(--text);">$${amountPaid.toFixed(2)}</span><span style="font-size:11px;color:var(--text3);"> / $${amountDue.toFixed(2)}</span>`
            : `<span style="font-size:12px;color:var(--text3);font-style:italic;">No amount set</span>`}
        </div>
        ${isPartial ? `<div style="font-size:11px;color:#c0392b;font-weight:700;margin-bottom:4px;">$${remaining.toFixed(2)} remaining</div>` : ''}
        <div style="background:#e8e8e8;border-radius:20px;height:5px;overflow:hidden;margin-bottom:8px;">
          <div style="width:${pct}%;background:${barColor};height:100%;border-radius:20px;"></div>
        </div>
        <div style="display:flex;gap:5px;">
          ${!isFullyPaid
            ? `<button onclick="openBillPayment('${b.id}','${currentMK}')" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:6px;padding:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">💳 Pay</button>`
            : `<button onclick="openBillPayment('${b.id}','${currentMK}')" style="flex:1;background:none;border:1px dashed #a8d5b0;border-radius:6px;padding:6px;font-size:11px;cursor:pointer;font-family:inherit;color:#1e7e34;">+ Add Payment</button>`}
          <button onclick="openSetBillAmount('${b.id}','${currentMK}',${amountDue})" style="background:var(--surface2);color:var(--text2);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;" title="Set amount">$</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ══════════════════════════════════
// STAFF DOCUMENTS PAGE
// ══════════════════════════════════

const ORI_CHECKLIST_ITEMS = [
  { section: true, text: '1.  THE CARE STRUCTURE OF OUR AFH, (MED LOCK UP, EMERGENCY KIT, ETC)' },
  { section: true, text: '2.  TRAINEE TO UNDERSTAND THE CLASSIFICATION OF RESIDENTS WE CARE FOR' },
  { section: true, text: '3.  FIRE AND LIFE SAFETY TRAINING' },
  { item: true, text: 'A. Emergency communications ( including phone system, and emergency contacts)' },
  { item: true, text: 'B. Evacuation Plan location and location of fire alarms, fire extinguishers.' },
  { item: true, text: 'C. Ways to handle resident injuries and falls or other accidents.' },
  { item: true, text: 'D. Potential Risks to residents or staff by: aggressive behavior, mental health break' },
  { item: true, text: 'E. The location of home policies and procedures' },
  { item: true, text: 'F. New Trainee has participated in 1 fire drill' },
  { item: true, text: 'G. How and when to contact Hospice, and handling Hospice patient emergency.' },
  { section: true, text: '4. Communication Skills and Information, Including:' },
  { item: true, text: 'A. Trainee can demonstrate methods for supporting effective communications among resident/guardians, staff, and family members.' },
  { item: true, text: 'B. Trainee can demonstrate the ability to use verbal and non-verbal communication' },
  { item: true, text: 'C. Trainee knows where and when to do written communications, or documentation required by the job, such as' },
  { item: true, text: 'D. Expectations about the privacy of the Residents and no communication about the residents or the operations of the AFH outside of the workplace' },
  { item: true, text: 'E. Whom to contact about problems and concerns.' },
  { item: true, text: 'F. Trainee able to demonstrate where to locate the Patient Care Plan and how to use it to care for the Resident\'s Needs.' },
  { section: true, text: '5. Training Requirements for our Adult Family Home' },
  { item: true, text: 'A. Handling money left by families' },
  { item: true, text: 'B. Mandated Reporting' },
  { item: true, text: 'C. Fall Prevention' },
  { section: true, text: '6. Universal Precautions and Infection Control, Including:' },
  { item: true, text: 'A. Proper hand washing techniques' },
  { item: true, text: 'B. Protection of blood and other body fluids form exposure to others' },
  { item: true, text: 'C. Appropriate disposal of sharps and contaminated/hazardous articles' },
  { item: true, text: 'D. Reporting exposure to contaminated articles, blood, or other body fluids' },
  { item: true, text: 'E. What staff should do if they are ill?' },
  { section: true, text: '7. Resident Rights, Including:' },
  { item: true, text: 'A. The residents right to confidentiality of their information from others' },
  { item: true, text: 'B. The resident\'s right to participate in making decisions about care, and to refuse care' },
  { item: true, text: 'C. Staff\'s duty to protect and promote the rights of each resident, and to assist the resident to exercise his or her rights' },
  { item: true, text: 'D. How and to whom staff should report any concerns they may have about a resident\'s decision concerning that resident\'s care.' },
  { item: true, text: 'E. Staff on duty clearly understands how to do mandated reporting and clearly understands what abuse looks like, abandonment, neglect, or exploitation.' },
  { item: true, text: 'F. Staff knows how to contact support for residents such as Ombudsmen' },
  { item: true, text: 'G. Staff can show where the complaint lines, hot lines, and resident grievance procedures can be located.' },
  { section: true, text: '8. Medication Administration, Documentation' },
  { item: true, text: 'A. Staff knows where the medication records are and how they are used' },
  { item: true, text: 'B. Delegation training in place and the purpose of Delegation training' },
  { item: true, text: 'C. Staff knows how to report missed doses of medications' },
  { item: true, text: 'D. Staff knows how to note Dr. Orders' },
  { item: true, text: 'E. Staff knows how to receive a Dr. Order' },
  { item: true, text: 'F. Staff knows how to order a new medication or refill a medication from Pharmacy' },
  { item: true, text: 'G. Staff understands how to waste outdated or discontinued medications' },
  { item: true, text: 'H. Staff understands how to document and report patients concerns or symptoms related to medications.' },
  { section: true, text: '9. Training and requirement to stay employed at our AFH' },
  { item: true, text: 'A. Yearly renewal of you DOH registration or License' },
  { item: true, text: 'B. Yearly 12 hours of Continuing Education' },
  { item: true, text: 'C. Every 2 years CPR and First Aid' },
  { item: true, text: 'D. TB Testing or screening' },
  { item: true, text: 'E. Core classes, Fundamentals or 72-hour training, dementia, mental health, Delegation, HIV or other core classes for specific work as Resident manager or other specific training needed such as Diabetic care.' },
  { section: true, text: '10. Skin care and Equipment Orientation' },
  { item: true, text: 'A. Demonstrates ability to use Hoyer and other specialty equipment' },
  { item: true, text: 'B. Demonstrates knowledge of cleaning and caring for equipment' },
  { item: true, text: 'C. Demonstrates ability to report repair concerns of equipment' },
  { item: true, text: 'D. Demonstrates ability to use electric beds and in room equipment' },
  { item: true, text: 'E. Able to position resident off of bony areas to protect skin' },
  { item: true, text: 'F. Understands how to document and report skin issues and concerns' },
  { section: true, text: '11. Staff file set up ( things that need to be processed and in staff file)' },
  { item: true, text: 'A. Application on file with 3 checked references' },
  { item: true, text: 'B. Background Check' },
  { item: true, text: 'C. SS Card and Picture ID' },
  { item: true, text: 'D. I 9 filled out' },
  { item: true, text: 'E. W-2 or 1099 self-employed status' },
  { item: true, text: 'F. CPR card current and verified' },
  { item: true, text: 'G. All Educational Certifications as outlined in 9 E' },
  { item: true, text: 'H. DOH Current verification' },
  { item: true, text: 'I. TB 2 step verification or booster TB Test' },
];

function initStaffDocsPage() {
  buildOrientationChecklist();
  loadOrientationDraft();
  loadCredentialsDraft();
  renderSavedStaffDocs();
  initCBHSForm();
  // Default to staff category on page load
  switchDocCategory('staff');
}

// ══════════════════════════════════
// CBHS SUPPORTIVE SUPERVISION TRACKING FORM
// ══════════════════════════════════

let cbhsEntries = [];

async function initCBHSForm() {
  // Populate resident dropdown
  const residents = await getResidents();
  const sel = document.getElementById('cbhs-resident-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Resident —</option>';
  residents.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    sel.appendChild(opt);
  });
  // Load saved draft
  const raw = localStorage.getItem('hlh_cbhs_draft');
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (d.clientName) document.getElementById('cbhs-client-name').value = d.clientName;
      if (d.dob) document.getElementById('cbhs-client-dob').value = d.dob;
      if (d.tier) {
        const radio = document.querySelector(`input[name="cbhs-tier"][value="${d.tier}"]`);
        if (radio) radio.checked = true;
      }
      cbhsEntries = d.entries || [];
    } catch { cbhsEntries = []; }
  }
  if (!cbhsEntries.length) cbhsEntries = [blankCBHSEntry(), blankCBHSEntry()];
  renderCBHSEntries();
}

async function onCBHSResidentSelect(id) {
  if (!id) return;
  const residents = await getResidents();
  const r = residents.find(x => x.id === id);
  if (!r) return;
  document.getElementById('cbhs-client-name').value = r.name || '';
  if (r.dob) document.getElementById('cbhs-client-dob').value = r.dob;
}

function blankCBHSEntry() {
  return { date: '', time: '', staff: '', summary: '', signature: '' };
}

function addCBHSEntry() {
  cbhsEntries.push(blankCBHSEntry());
  renderCBHSEntries();
}

function removeCBHSEntry(idx) {
  if (cbhsEntries.length <= 1) { toast('At least one entry is required'); return; }
  cbhsEntries.splice(idx, 1);
  renderCBHSEntries();
}

function renderCBHSEntries() {
  const container = document.getElementById('cbhs-entries-container');
  if (!container) return;
  container.innerHTML = cbhsEntries.map((e, i) => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:14px;background:#fff;position:relative;">
      <div style="position:absolute;top:10px;right:12px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;">Entry ${i+1}</span>
        <button onclick="removeCBHSEntry(${i})" style="background:var(--danger-light);color:var(--danger);border:none;border-radius:5px;padding:3px 8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="field" style="margin:0;">
          <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:5px;">Date</label>
          <input type="date" value="${e.date}" onchange="cbhsEntries[${i}].date=this.value" style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:inherit;font-size:13px;">
        </div>
        <div class="field" style="margin:0;">
          <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:5px;">Time or Duration of Services</label>
          <input type="text" value="${e.time}" placeholder="e.g. 8–10 a.m. or 2 hours" onchange="cbhsEntries[${i}].time=this.value" style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:inherit;font-size:13px;">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px;">
        <div>
          <div class="field" style="margin:0 0 12px;">
            <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:5px;">Name(s) of Staff Who Provided Services</label>
            <textarea rows="3" onchange="cbhsEntries[${i}].staff=this.value" style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:inherit;font-size:13px;resize:vertical;">${e.staff}</textarea>
          </div>
          <div class="field" style="margin:0;">
            <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:5px;">Signature</label>
            <input type="text" value="${e.signature}" placeholder="Printed name / signature" onchange="cbhsEntries[${i}].signature=this.value" style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:inherit;font-size:13px;">
          </div>
        </div>
        <div class="field" style="margin:0;">
          <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:5px;">Summary of Services</label>
          <textarea rows="6" placeholder="Describe behavior(s) exhibited or prevented, interventions used (monitoring, redirection, diversion, cueing)…" onchange="cbhsEntries[${i}].summary=this.value" style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:inherit;font-size:13px;resize:vertical;">${e.summary}</textarea>
        </div>
      </div>
    </div>`).join('');
}

function getCBHSFormData() {
  const tier = document.querySelector('input[name="cbhs-tier"]:checked')?.value || '';
  return {
    clientName: document.getElementById('cbhs-client-name')?.value || '',
    dob: document.getElementById('cbhs-client-dob')?.value || '',
    tier,
    entries: cbhsEntries,
  };
}

function clearCBHSForm() {
  if (!confirm('Clear all CBHS form data?')) return;
  localStorage.removeItem('hlh_cbhs_draft');
  document.getElementById('cbhs-client-name').value = '';
  document.getElementById('cbhs-client-dob').value = '';
  document.getElementById('cbhs-resident-select').value = '';
  document.querySelectorAll('input[name="cbhs-tier"]').forEach(r => r.checked = false);
  cbhsEntries = [blankCBHSEntry(), blankCBHSEntry()];
  renderCBHSEntries();
  toast('Form cleared');
}

function printCBHSForm() {
  const d = getCBHSFormData();
  // Save draft before printing
  localStorage.setItem('hlh_cbhs_draft', JSON.stringify(d));

  const fmtDate = (v) => {
    if (!v) return '';
    return new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  };

  // Split entries across pages: page 1 = 2, page 2 = 3, page 3 = remainder
  const allEntries = d.entries;
  const page1Entries = allEntries.slice(0, 2);
  const page2Entries = allEntries.slice(2, 5);
  const page3Entries = allEntries.slice(5, 7);

  function entryBlock(e) {
    return `
      <div class="entry-block">
        <div class="entry-left">
          <div class="entry-label-bold">Date</div>
          <div class="entry-line">${e.date ? fmtDate(e.date) : ''}</div>
          <div class="entry-label">Time or duration of services</div>
          <div class="entry-line">${e.time || ''}</div>
          <div class="entry-label">Name(s) of staff who provided services</div>
          <div class="entry-staff-box">${(e.staff || '').replace(/\n/g,'<br>')}</div>
          <div class="entry-label">Signature</div>
          <div class="entry-line">${e.signature || ''}</div>
        </div>
        <div class="entry-right">
          <div class="entry-label">Summary of services</div>
          <div class="entry-summary-box">${(e.summary || '').replace(/\n/g,'<br>')}</div>
        </div>
      </div>`;
  }

  function blankEntryBlock() {
    return entryBlock(blankCBHSEntry());
  }

  const tierBoxes = ['Tier 1 (.5-2)','Tier 2 (2.1-6)','Tier 3 (6.1-10)','Tier 4 (10.1-15)','Tier 5 (15.1-20)','Tier 6 (20.1-24)'].map(t =>
    `<span class="tier-box">${d.tier === t ? '&#9745;' : '&#9744;'} ${t}</span>`
  ).join('');

  const win = window.open('', '_blank', 'width=900,height=1200');
  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>HCA 13-0126 CBHS Supervision Tracking</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; background:#fff; color:#000; }
  .page { width:8.5in; min-height:11in; padding:0.55in 0.6in; page-break-after:always; position:relative; }
  .page:last-child { page-break-after:auto; }

  /* Page 1 header */
  .form-title { font-size:22pt; font-weight:bold; line-height:1.15; margin-bottom:4px; }
  .hca-logo-row { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; }
  .hca-authority { text-align:right; font-size:9pt; line-height:1.3; font-weight:bold; border:2px solid #000; padding:4px 8px; max-width:160px; }
  .hca-authority .ws { font-size:8pt; font-weight:normal; }
  .org-label { font-weight:bold; font-size:9.5pt; margin-bottom:2px; }
  .instructions-title { font-weight:bold; font-size:10pt; margin-bottom:3px; }
  .instructions-text { font-size:9pt; line-height:1.5; margin-bottom:10px; }

  /* Section headers */
  .section-hdr { background:#000; color:#fff; display:flex; align-items:center; gap:10px; padding:5px 10px; margin-bottom:10px; }
  .section-num { background:#fff; color:#000; border-radius:50%; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; font-weight:900; font-size:11pt; flex-shrink:0; }
  .section-title { font-weight:bold; font-size:11pt; }

  /* Client fields */
  .client-row { display:flex; gap:20px; margin-bottom:8px; }
  .client-field { flex:1; }
  .client-field label { font-size:9pt; display:block; margin-bottom:1px; }
  .client-field .val { border-bottom:1px solid #000; min-height:18px; font-size:10pt; padding:1px 2px; }
  .tier-row { margin-bottom:10px; font-size:9pt; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .tier-row label { font-size:9pt; }
  .tier-box { white-space:nowrap; font-size:9pt; }

  /* Attestation */
  .attestation { font-size:8.5pt; line-height:1.55; margin-bottom:6px; }
  .fill-instruction { font-size:8.5pt; line-height:1.55; margin-bottom:10px; }
  .fill-instruction strong { font-weight:bold; }

  /* Entry blocks */
  .entry-block { display:flex; gap:16px; margin-bottom:16px; }
  .entry-left { width:220px; flex-shrink:0; }
  .entry-right { flex:1; }
  .entry-label { font-size:8.5pt; margin-bottom:1px; }
  .entry-label-bold { font-size:9pt; font-weight:bold; margin-bottom:1px; }
  .entry-line { border-bottom:1px solid #000; min-height:16px; margin-bottom:7px; font-size:10pt; padding:1px 2px; }
  .entry-staff-box { border:1px solid #000; height:60px; padding:4px; margin-bottom:4px; font-size:10pt; line-height:1.5; }
  .entry-summary-box { border:1px solid #000; height:140px; padding:4px; font-size:10pt; line-height:1.6; word-wrap:break-word; }

  /* Footer */
  .page-footer { position:absolute; bottom:0.3in; left:0.6in; right:0.6in; display:flex; justify-content:space-between; font-size:8.5pt; }

  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    @page { size:letter; margin:0; }
    .page { padding:0.5in 0.55in; }
  }
</style>
</head><body>

<!-- ════ PAGE 1 ════ -->
<div class="page">
  <div class="hca-logo-row">
    <div>
      <div class="form-title">CBHS Supportive Supervision<br>services tracking form</div>
      <div class="org-label">Community Behavioral Health Supports (CBHS)</div>
    </div>
    <div class="hca-authority">
      <div class="ws">Washington State</div>
      <div>Health Care <strong>Authority</strong></div>
    </div>
  </div>

  <div class="instructions-title">Instructions</div>
  <div class="instructions-text">Use one form per individual to indicate the number of behavioral health supportive supervision hours provided. This does not include time spent assisting with or performing activities of daily living.</div>

  <div class="section-hdr">
    <span class="section-num">1</span>
    <span class="section-title">Client information</span>
  </div>

  <div class="client-row">
    <div class="client-field" style="flex:2;"><label>First and last name</label><div class="val">${d.clientName}</div></div>
    <div class="client-field"><label>Date of birth</label><div class="val">${fmtDate(d.dob)}</div></div>
  </div>
  <div class="tier-row"><label>Authorized tier</label> ${tierBoxes}</div>

  <div class="section-hdr">
    <span class="section-num">2</span>
    <span class="section-title">Summary of services and signature</span>
  </div>

  <div class="attestation">By signing I attest this information is true, accurate, and complete. I understand any falsification, omission, or concealment of material fact may subject me or the represented organization to further corrective actions.</div>
  <div class="fill-instruction"><strong>Fill out the fields below with:</strong> Date, time or duration of services you provided (e.g. "8 – 10 a.m." or "2 hours"), summary of behavior(s) exhibited (or prevented) that led to intervention and the intervention(s) leveraged by staff (e.g. monitoring, redirection, diversion, and/or cueing), names of staff, and signature.</div>

  ${page1Entries.map(e => entryBlock(e)).join('')}
  ${page1Entries.length < 2 ? Array(2 - page1Entries.length).fill(0).map(() => blankEntryBlock()).join('') : ''}

  <div class="page-footer"><span>HCA 13-0126 (2/25)</span><span>Page 1 of 3</span></div>
</div>

<!-- ════ PAGE 2 ════ -->
<div class="page">
  ${page2Entries.map(e => entryBlock(e)).join('')}
  ${page2Entries.length < 3 ? Array(3 - page2Entries.length).fill(0).map(() => blankEntryBlock()).join('') : ''}
  <div class="page-footer"><span>HCA 13-0126 (2/25)</span><span>Page 2 of 3</span></div>
</div>

<!-- ════ PAGE 3 ════ -->
<div class="page">
  ${page3Entries.map(e => entryBlock(e)).join('')}
  ${page3Entries.length < 2 ? Array(2 - page3Entries.length).fill(0).map(() => blankEntryBlock()).join('') : ''}
  <div class="page-footer"><span>HCA 13-0126 (2/25)</span><span>Page 3 of 3</span></div>
</div>

</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.addEventListener('afterprint', () => { win.close(); window.focus(); });
  }, 700);
}

function switchStaffDocTab(tab) {
  // legacy — no-op since tabs are now hidden panels
}

// ══════════════════════════════════
// SIGNIFICANT CHANGE ASSESSMENT
// ══════════════════════════════════
async function openSigChangeModal() {
  const residents = await getResidents();
  const sel = document.getElementById('sc-resident-select');
  sel.innerHTML = '<option value="">— Select Resident —</option>';
  residents.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.name;
    sel.appendChild(opt);
  });
  document.getElementById('sc-submitter').value = currentUser ? currentUser.name : '';
  openModal('modal-doc-sig-change');
}

async function onSCResidentSelect(id) {
  if (!id) return;
  const residents = await getResidents();
  const r = residents.find(x => x.id === id);
  if (!r) return;
  // Auto-fill from resident profile — name used in description area hint
  document.getElementById('sc-submitter').value = currentUser ? currentUser.name : '';
}

function getSCFormData() {
  return {
    residentId: document.getElementById('sc-resident-select').value,
    residentName: document.getElementById('sc-resident-select').options[document.getElementById('sc-resident-select').selectedIndex]?.text || '',
    ddaId: document.getElementById('sc-dda-id').value.trim(),
    hcsId: document.getElementById('sc-hcs-id').value.trim(),
    providerName: document.getElementById('sc-provider-name').value.trim(),
    providerPhone: document.getElementById('sc-provider-phone').value.trim(),
    medAppt: document.getElementById('sc-med-appt').value,
    mhAppt: document.getElementById('sc-mh-appt').value,
    medReview: document.getElementById('sc-med-review').value,
    medProvider: document.getElementById('sc-med-provider').value.trim(),
    medPhone: document.getElementById('sc-med-phone').value.trim(),
    dMedical: document.getElementById('sc-d-medical').checked,
    dEating: document.getElementById('sc-d-eating').checked,
    dPsych: document.getElementById('sc-d-psych').checked,
    dHygiene: document.getElementById('sc-d-hygiene').checked,
    dMobility: document.getElementById('sc-d-mobility').checked,
    dSleep: document.getElementById('sc-d-sleep').checked,
    dToileting: document.getElementById('sc-d-toileting').checked,
    dOther: document.getElementById('sc-d-other').checked,
    dOtherText: document.getElementById('sc-d-other-text').value.trim(),
    description: document.getElementById('sc-description').value.trim(),
    submitter: document.getElementById('sc-submitter').value.trim(),
    caseManager: document.getElementById('sc-case-manager').value.trim(),
    dshsReceived: document.getElementById('sc-dshs-received').value,
    dshsContacted: document.getElementById('sc-dshs-contacted').value.trim(),
    dshsAssessmentDate: document.getElementById('sc-dshs-assessment-date').value,
    dshsCompletedBy: document.getElementById('sc-dshs-completed-by').value.trim(),
    rateChangeYes: document.getElementById('sc-rate-yes').checked,
    rateChangeNo: document.getElementById('sc-rate-no').checked,
    rateEffective: document.getElementById('sc-rate-effective').value,
  };
}

function setSCFormData(d) {
  if (!d) return;
  document.getElementById('sc-dda-id').value = d.ddaId || '';
  document.getElementById('sc-hcs-id').value = d.hcsId || '';
  document.getElementById('sc-provider-name').value = d.providerName || 'Harmony Living House Adult Family LLC';
  document.getElementById('sc-provider-phone').value = d.providerPhone || '';
  document.getElementById('sc-med-appt').value = d.medAppt || '';
  document.getElementById('sc-mh-appt').value = d.mhAppt || '';
  document.getElementById('sc-med-review').value = d.medReview || '';
  document.getElementById('sc-med-provider').value = d.medProvider || '';
  document.getElementById('sc-med-phone').value = d.medPhone || '';
  document.getElementById('sc-d-medical').checked = !!d.dMedical;
  document.getElementById('sc-d-eating').checked = !!d.dEating;
  document.getElementById('sc-d-psych').checked = !!d.dPsych;
  document.getElementById('sc-d-hygiene').checked = !!d.dHygiene;
  document.getElementById('sc-d-mobility').checked = !!d.dMobility;
  document.getElementById('sc-d-sleep').checked = !!d.dSleep;
  document.getElementById('sc-d-toileting').checked = !!d.dToileting;
  document.getElementById('sc-d-other').checked = !!d.dOther;
  document.getElementById('sc-d-other-text').value = d.dOtherText || '';
  document.getElementById('sc-description').value = d.description || '';
  document.getElementById('sc-submitter').value = d.submitter || '';
  document.getElementById('sc-case-manager').value = d.caseManager || '';
  document.getElementById('sc-dshs-received').value = d.dshsReceived || '';
  document.getElementById('sc-dshs-contacted').value = d.dshsContacted || '';
  document.getElementById('sc-dshs-assessment-date').value = d.dshsAssessmentDate || '';
  document.getElementById('sc-dshs-completed-by').value = d.dshsCompletedBy || '';
  if (d.rateChangeYes) document.getElementById('sc-rate-yes').checked = true;
  if (d.rateChangeNo) document.getElementById('sc-rate-no').checked = true;
  document.getElementById('sc-rate-effective').value = d.rateEffective || '';
}

function clearSigChangeForm() {
  if (!confirm('Clear all form data?')) return;
  document.getElementById('sc-resident-select').value = '';
  setSCFormData({});
  toast('Form cleared');
}

async function saveSigChangeToSupabase() {
  const d = getSCFormData();
  if (!d.residentId) { toast('Please select a resident before saving'); return; }
  const record = {
    id: uid(),
    resident_id: d.residentId,
    resident_name: d.residentName,
    form_data: JSON.stringify(d),
    created_at: new Date().toISOString(),
    created_by: currentUser ? currentUser.name : ''
  };
  const { error } = await db.from('sig_change_requests').insert(record);
  if (error) { toast('Error saving: ' + error.message); return; }
  toast('✅ Significant Change Request saved!');
  renderSavedSigChangeList();
}

async function openSavedSigChangeList() {
  const wrap = document.getElementById('saved-sig-change-list-wrap');
  if (!wrap) return;
  const isHidden = wrap.style.display === 'none' || wrap.style.display === '';
  if (isHidden) {
    wrap.style.display = 'block';
    await renderSavedSigChangeList();
    setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  } else {
    wrap.style.display = 'none';
  }
}

async function renderSavedSigChangeList() {
  const container = document.getElementById('saved-sig-change-list');
  if (!container) return;
  const { data, error } = await db.from('sig_change_requests').select('*').order('created_at', { ascending: false });
  if (error) {
    container.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:10px;">Error loading records. Run this SQL in Supabase:<br><br>
    <code style="background:#f4f6f9;padding:8px 12px;display:inline-block;border-radius:6px;font-size:11px;">
    CREATE TABLE IF NOT EXISTS sig_change_requests (id TEXT PRIMARY KEY, resident_id TEXT, resident_name TEXT, form_data JSONB, created_at TIMESTAMPTZ DEFAULT NOW(), created_by TEXT);
    </code></div>`;
    return;
  }
  if (!data || !data.length) {
    container.innerHTML = '<div style="color:var(--text3);font-style:italic;font-size:13px;padding:10px;">No saved requests yet.</div>';
    return;
  }
  container.innerHTML = data.map(r => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-weight:700;font-size:14px;color:#2c6e9f;">${r.resident_name || 'Unknown Resident'}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:3px;">
          Saved: ${fmtDate(r.created_at?.split('T')[0])} &nbsp;·&nbsp; By: ${r.created_by || '—'}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" onclick="loadSigChangeRecord('${r.id}')">✏️ Load &amp; Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="printSigChangeRecord('${r.id}')">🖨️ Print</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSigChangeRecord('${r.id}')">Delete</button>
      </div>
    </div>`).join('');
}

async function loadSigChangeRecord(id) {
  const { data: r } = await db.from('sig_change_requests').select('*').eq('id', id).single();
  if (!r) return;
  await openSigChangeModal();
  const d = typeof r.form_data === 'string' ? JSON.parse(r.form_data) : r.form_data;
  // Re-select resident in dropdown
  const sel = document.getElementById('sc-resident-select');
  if (d.residentId) {
    for (let opt of sel.options) { if (opt.value === d.residentId) { opt.selected = true; break; } }
  }
  setSCFormData(d);
  toast('Record loaded — edit and save again to update');
}

async function printSigChangeRecord(id) {
  const { data: r } = await db.from('sig_change_requests').select('*').eq('id', id).single();
  if (!r) return;
  const d = typeof r.form_data === 'string' ? JSON.parse(r.form_data) : r.form_data;
  printSigChangeFormFromData(d);
}

async function deleteSigChangeRecord(id) {
  if (!confirm('Delete this saved request?')) return;
  await db.from('sig_change_requests').delete().eq('id', id);
  toast('Deleted');
  renderSavedSigChangeList();
}

function printSigChangeForm() {
  const d = getSCFormData();
  printSigChangeFormFromData(d);
}

function printSigChangeFormFromData(d) {
  const fmtD = (v) => v ? new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' }) : '';
  const blank = (val, minW) => `<span style="display:inline-block;border-bottom:1px solid #000;min-width:${minW||120}px;padding:0 3px;font-size:11px;vertical-align:bottom;">${val||''}</span>`;
  const chk = (checked) => checked ? '&#9745;' : '&#9744;';

  const win = window.open('', '_blank', 'width=900,height:1100');
  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>AFH Resident Significant Change Assessment Request</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Times New Roman',Times,serif; background:#fff; color:#000;
         padding:28px 32px; width:816px; margin:0 auto; font-size:11.5px; }
  table { width:100%; border-collapse:collapse; }
  td, th { border:1px solid #000; padding:5px 7px; vertical-align:top; font-size:11.5px; }
  .bold { font-weight:bold; }
  .center { text-align:center; }
  .small { font-size:10px; }
  .dshs-section { background:#d9d9d9; }
  @media print { body { padding:20px 28px; } @page { size:letter; margin:0.5in; } }
</style>
</head><body>

<!-- HEADER ROW with DSHS logo -->
<table style="margin-bottom:0;">
  <tr>
    <td style="border:none;width:90px;vertical-align:middle;padding:0;">
      <img src="https://www.dshs.wa.gov/sites/default/files/DSHSlogo.png" alt="DSHS" style="width:80px;height:auto;display:block;">
    </td>
    <td colspan="2" style="border:none;vertical-align:middle;text-align:center;padding:4px 8px;">
      <div style="font-size:14px;font-weight:bold;">Adult Family Home (AFH) Resident</div>
      <div style="font-size:14px;font-weight:bold;">Significant Change Assessment Request</div>
    </td>
  </tr>
</table>

<!-- Notice row -->
<table style="margin-bottom:0;">
  <tr>
    <td colspan="3" style="font-size:11px;line-height:1.6;">
      The 30-day clock will not begin until all of the required information below is <strong>completed</strong> and submitted electronically to DSHS with the Negotiated Care Plan.
    </td>
  </tr>
</table>

<!-- Row 1: Resident name, DDA ID, HCS ID -->
<table style="margin-bottom:0;">
  <tr>
    <td style="width:40%;"><span class="bold">RESIDENT'S NAME</span><br>${blank(d.residentName, 200)}</td>
    <td style="width:30%;"><span class="bold">DDA / ADSA ID NUMBER</span><br>${blank(d.ddaId, 120)}</td>
    <td style="width:30%;"><span class="bold">HCS ACES ID NUMBER</span><br>${blank(d.hcsId, 120)}</td>
  </tr>
</table>

<!-- Row 2: AFH Provider -->
<table style="margin-bottom:0;">
  <tr>
    <td style="width:60%;"><span class="bold">AFH PROVIDER'S NAME</span><br>${blank(d.providerName, 260)}</td>
    <td style="width:40%;"><span class="bold">PHONE NUMBER (WITH AREA CODE)</span><br>${blank(d.providerPhone, 160)}</td>
  </tr>
</table>

<!-- Row 3: Most recent appointments -->
<table style="margin-bottom:0;">
  <tr>
    <td colspan="2">
      <span class="bold">Date of most recent:</span><br>
      Medical appointment: &nbsp;${blank(fmtD(d.medAppt), 130)} &nbsp;&nbsp;
      Mental Health appointment (if applicable): &nbsp;${blank(fmtD(d.mhAppt), 130)} &nbsp;&nbsp;
      Medication Review (if applicable): &nbsp;${blank(fmtD(d.medReview), 130)}
    </td>
  </tr>
</table>

<!-- Row 4: Medical provider -->
<table style="margin-bottom:0;">
  <tr>
    <td style="width:60%;"><span class="bold">MEDICAL PROVIDER'S NAME</span><br>${blank(d.medProvider, 260)}</td>
    <td style="width:40%;"><span class="bold">PHONE NUMBER (WITH AREA CODE)</span><br>${blank(d.medPhone, 160)}</td>
  </tr>
</table>

<!-- Row 5: Domains checkboxes -->
<table style="margin-bottom:0;">
  <tr>
    <td colspan="2" style="line-height:2;">
      <span class="bold">Select the resident's support acuity domain that has changed (select all that apply):</span><br>
      <table style="border:none;width:100%;">
        <tr>
          <td style="border:none;padding:2px 4px;width:50%;">${chk(d.dMedical)} Medical / Behavioral diagnosis</td>
          <td style="border:none;padding:2px 4px;width:50%;">${chk(d.dEating)} Eating</td>
        </tr>
        <tr>
          <td style="border:none;padding:2px 4px;">${chk(d.dPsych)} Psych / Social (behavior)</td>
          <td style="border:none;padding:2px 4px;">${chk(d.dHygiene)} Hygiene</td>
        </tr>
        <tr>
          <td style="border:none;padding:2px 4px;">${chk(d.dMobility)} Mobility</td>
          <td style="border:none;padding:2px 4px;">${chk(d.dSleep)} Sleep</td>
        </tr>
        <tr>
          <td style="border:none;padding:2px 4px;">${chk(d.dToileting)} Toileting</td>
          <td style="border:none;padding:2px 4px;">${chk(d.dOther)} Other (please specify): ${blank(d.dOtherText, 140)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- Row 6: Description -->
<table style="margin-bottom:0;">
  <tr>
    <td colspan="2" style="min-height:120px;">
      <span class="bold">Provide a <u>detailed</u> description of when and how the resident's needs changed for <u>each</u> area selected above:</span><br>
      <div style="min-height:100px;padding-top:6px;line-height:1.8;white-space:pre-wrap;">${d.description || ''}</div>
    </td>
  </tr>
</table>

<!-- Row 7: Submitter + Case Manager -->
<table style="margin-bottom:0;">
  <tr>
    <td style="width:50%;"><span class="bold">NAME OF PERSON SUBMITTING REQUEST</span><br>${blank(d.submitter, 220)}</td>
    <td style="width:50%;"><span class="bold">NAME OF RESIDENT'S DSHS CASE MANAGER OR SOCIAL WORKER</span><br>${blank(d.caseManager, 220)}</td>
  </tr>
</table>

<!-- Row 8: DSHS Use Only -->
<table style="margin-bottom:0;">
  <tr>
    <td class="dshs-section" style="line-height:2.1;">
      <span class="bold">For DSHS Use Only</span><br>
      Date DSHS received <strong>complete</strong> written request from AFH provider: ${blank(fmtD(d.dshsReceived), 140)}<br>
      Date(s) the AFH provider was contacted to schedule assessment: ${blank(d.dshsContacted, 200)}<br>
      Date assessment completed: ${blank(fmtD(d.dshsAssessmentDate), 130)} ; Completed by: ${blank(d.dshsCompletedBy, 160)}<br>
      Assessment resulted in a change in the resident's daily rate? &nbsp;
      ${chk(d.rateChangeYes)} Yes &nbsp;&nbsp; ${chk(d.rateChangeNo)} No &nbsp;&nbsp;
      If "Yes," what is the new daily rate effective date? ${blank(fmtD(d.rateEffective), 130)}
    </td>
  </tr>
</table>

<!-- Row 9: Copies -->
<table>
  <tr>
    <td style="font-size:11px;">Copies: &nbsp; DSHS Client File; AFH Provider</td>
  </tr>
</table>

<br>
<div style="text-align:center;font-size:11px;font-weight:bold;margin-top:6px;">
  AFH RESIDENT SIGNIFICANT CHANGE ASSESSMENT REQUEST
</div>
<div style="text-align:center;font-size:10px;margin-top:4px;">
  DSHS 15-558 (REV. 06/2021)
</div>

</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.addEventListener('afterprint', () => { win.close(); window.focus(); });
  }, 700);
}

// ── DOCUMENT HUB ──
function switchDocCategory(cat) {
  const isStaff = cat === 'staff';
  document.getElementById('docsection-staff').style.display = isStaff ? 'block' : 'none';
  document.getElementById('docsection-resident').style.display = !isStaff ? 'block' : 'none';

  const staffBtn = document.getElementById('doccat-staff');
  const resBtn = document.getElementById('doccat-resident');

  if (staffBtn) {
    staffBtn.style.background = isStaff
      ? 'linear-gradient(135deg,#1a1a1a,#b8860b)' : 'var(--surface)';
    staffBtn.style.color = isStaff ? '#fff' : 'var(--text)';
    staffBtn.style.borderColor = isStaff ? 'var(--accent2)' : 'var(--border)';
    staffBtn.style.boxShadow = isStaff ? '0 4px 16px rgba(184,134,11,0.25)' : 'var(--shadow)';
    const sub = staffBtn.querySelector('div:last-child');
    if (sub) sub.style.color = isStaff ? 'rgba(255,255,255,0.65)' : 'var(--text3)';
  }
  if (resBtn) {
    resBtn.style.background = !isStaff
      ? 'linear-gradient(135deg,#003366,#0056b3)' : 'var(--surface)';
    resBtn.style.color = !isStaff ? '#fff' : 'var(--text)';
    resBtn.style.borderColor = !isStaff ? '#0056b3' : 'var(--border)';
    resBtn.style.boxShadow = !isStaff ? '0 4px 16px rgba(0,86,179,0.25)' : 'var(--shadow)';
    const sub = resBtn.querySelector('div:last-child');
    if (sub) sub.style.color = !isStaff ? 'rgba(255,255,255,0.65)' : 'var(--text3)';
  }
}

function openDocModal(type) {
  if (type === 'orientation') openModal('modal-doc-orientation');
  else if (type === 'credentials') openModal('modal-doc-credentials');
  else if (type === 'cbhs') openModal('modal-doc-cbhs');
  else if (type === 'sig-change') openSigChangeModal();
}

function buildOrientationChecklist() {
  const tbody = document.getElementById('ori-checklist-tbody');
  if (!tbody || tbody.children.length > 0) return;
  ORI_CHECKLIST_ITEMS.forEach((item, idx) => {
    const tr = document.createElement('tr');
    if (item.section) {
      tr.innerHTML = `
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:center;background:#d0d0d0;">
          <input type="checkbox" id="ori-chk-${idx}" style="width:16px;height:16px;accent-color:#b8860b;cursor:pointer;">
        </td>
        <td style="border:1px solid #ccc;padding:8px 10px;background:#d8d8d8;font-weight:700;font-size:13px;">${item.text}</td>`;
    } else {
      tr.innerHTML = `
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:center;background:#fff;">
          <input type="checkbox" id="ori-chk-${idx}" style="width:16px;height:16px;accent-color:#b8860b;cursor:pointer;">
        </td>
        <td style="border:1px solid #ccc;padding:7px 10px;font-size:13px;">${item.text}</td>`;
    }
    tbody.appendChild(tr);
  });
}

// ── DRAFT SAVE/LOAD ──
function saveOrientationDraft() {
  const checks = ORI_CHECKLIST_ITEMS.map((_,i) => {
    const el = document.getElementById('ori-chk-' + i);
    return el ? el.checked : false;
  });
  const data = {
    name: document.getElementById('ori-trainee-name').value,
    hireDate: document.getElementById('ori-hire-date').value,
    date1: document.getElementById('ori-date1').value,
    date2: document.getElementById('ori-date2').value,
    date3: document.getElementById('ori-date3').value,
    trainerSig: document.getElementById('ori-trainer-sig').value,
    traineeSig: document.getElementById('ori-trainee-sig').value,
    hours: document.getElementById('ori-hours').value,
    lastDay: document.getElementById('ori-last-day').value,
    notes: document.getElementById('ori-notes').value,
    checks,
  };
  localStorage.setItem('hlh_ori_draft', JSON.stringify(data));
  // Also persist to saved records list
  saveToStaffDocsList('orientation', data);
  toast('✅ Orientation draft saved');
}

function loadOrientationDraft() {
  const raw = localStorage.getItem('hlh_ori_draft');
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    document.getElementById('ori-trainee-name').value = d.name || '';
    document.getElementById('ori-hire-date').value = d.hireDate || '';
    document.getElementById('ori-date1').value = d.date1 || '';
    document.getElementById('ori-date2').value = d.date2 || '';
    document.getElementById('ori-date3').value = d.date3 || '';
    document.getElementById('ori-trainer-sig').value = d.trainerSig || '';
    document.getElementById('ori-trainee-sig').value = d.traineeSig || '';
    document.getElementById('ori-hours').value = d.hours || '';
    document.getElementById('ori-last-day').value = d.lastDay || '';
    document.getElementById('ori-notes').value = d.notes || '';
    if (d.checks) {
      d.checks.forEach((v, i) => {
        const el = document.getElementById('ori-chk-' + i);
        if (el) el.checked = v;
      });
    }
  } catch {}
}

function clearOrientationForm() {
  if (!confirm('Clear all orientation form data?')) return;
  localStorage.removeItem('hlh_ori_draft');
  ['ori-trainee-name','ori-hire-date','ori-date1','ori-date2','ori-date3','ori-trainer-sig','ori-trainee-sig','ori-hours','ori-last-day','ori-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ORI_CHECKLIST_ITEMS.forEach((_,i) => {
    const el = document.getElementById('ori-chk-' + i);
    if (el) el.checked = false;
  });
  toast('Form cleared');
}

function saveCredentialsDraft() {
  const ids = ['cred-staff-name','cred-dob','cred-hire-date','cred-ori-date1','cred-ori-date2','cred-ori-date3',
    'cred-fingerprint','cred-tb-step1','cred-tb-step2','cred-tb-xray','cred-na-training',
    'cred-70hr-core','cred-70hr-pop','cred-ori-5hr','cred-nurse-core','cred-nurse-diabetes',
    'cred-spec-dementia','cred-spec-mh','cred-spec-dd',
    'cred-bg-exp1','cred-bg-exp2','cred-bg-exp3','cred-bg-exp4',
    'cred-cpr-exp1','cred-cpr-exp2','cred-cpr-exp3','cred-cpr-exp4',
    'cred-doh-exp1','cred-doh-exp2','cred-doh-exp3','cred-doh-exp4',
    'cred-nar-exp1','cred-nar-exp2','cred-nar-exp3','cred-nar-exp4',
    'cred-nac-exp1','cred-nac-exp2','cred-nac-exp3','cred-nac-exp4',
    'cred-hcac-exp1','cred-hcac-exp2','cred-hcac-exp3','cred-hcac-exp4',
    'cred-food-exp1','cred-food-exp2','cred-food-exp3','cred-food-exp4',
    'cred-ce-from1','cred-ce-from2','cred-ce-from3','cred-ce-from4',
    'cred-ce-to1','cred-ce-to2','cred-ce-to3','cred-ce-to4','cred-last-day'];
  const data = {};
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  data['cred-hcac-yes'] = document.getElementById('cred-hcac-yes')?.checked;
  data['cred-hcac-no'] = document.getElementById('cred-hcac-no')?.checked;
  localStorage.setItem('hlh_cred_draft', JSON.stringify(data));
  saveToStaffDocsList('credentials', data);
  toast('✅ Credentials draft saved');
}

function loadCredentialsDraft() {
  const raw = localStorage.getItem('hlh_cred_draft');
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    Object.entries(d).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val || '';
    });
  } catch {}
}

function clearCredentialsForm() {
  if (!confirm('Clear all credentials form data?')) return;
  localStorage.removeItem('hlh_cred_draft');
  document.querySelectorAll('[id^="cred-"]').forEach(el => {
    if (el.type === 'checkbox') el.checked = false;
    else el.value = '';
  });
  toast('Form cleared');
}

// ── ORIENTATION PRINT / PDF ──
function buildOrientationHTML() {
  const fmtD = (v) => v ? new Date(v + 'T00:00:00').toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}) : '';
  const checks = ORI_CHECKLIST_ITEMS.map((_,i) => {
    const el = document.getElementById('ori-chk-' + i);
    return el ? el.checked : false;
  });

  let tableRows = ORI_CHECKLIST_ITEMS.map((item, idx) => {
    const chk = checks[idx] ? '&#9745;' : '&#9744;';
    if (item.section) {
      return `<tr>
        <td style="border:1px solid #999;padding:5px 6px;text-align:center;background:#d0d0d0;font-size:13px;">${chk}</td>
        <td style="border:1px solid #999;padding:7px 10px;background:#d0d0d0;font-weight:bold;font-size:12px;">${item.text}</td>
      </tr>`;
    }
    return `<tr>
      <td style="border:1px solid #999;padding:5px 6px;text-align:center;font-size:14px;">${chk}</td>
      <td style="border:1px solid #999;padding:6px 10px;font-size:11.5px;">${item.text}</td>
    </tr>`;
  }).join('');

  const oriDates = [
    document.getElementById('ori-date1').value,
    document.getElementById('ori-date2').value,
    document.getElementById('ori-date3').value,
  ].filter(Boolean).map(fmtD).join(', &nbsp; ');

  const notesVal = document.getElementById('ori-notes').value || '';
  const noteLines = notesVal ? notesVal.split('\n').join('<br>') : '';

  return `
    <div style="text-align:center;margin-bottom:14px;">
      <img src="harmony_living_house_logo.png" alt="Logo" style="width:80px;height:80px;object-fit:contain;display:block;margin:0 auto 6px;">
      <div style="font-size:18px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;">Harmony Living House Adult Family LLC</div>
      <div style="font-size:13px;">120 Newaukum Village Dr</div>
      <div style="font-size:13px;margin-bottom:14px;">Chehalis, WA 98532</div>
    </div>

    <div style="margin-bottom:10px;font-size:12.5px;line-height:2.1;">
      <div>Trainee Name: <span style="display:inline-block;border-bottom:1px solid #000;min-width:280px;padding:0 4px;">${document.getElementById('ori-trainee-name').value}</span></div>
      <div>Trainee Date of Hire: <span style="display:inline-block;border-bottom:1px solid #000;min-width:130px;padding:0 4px;">${fmtD(document.getElementById('ori-hire-date').value)}</span> &nbsp;&nbsp; Trainee Orientation Date (s): <span style="display:inline-block;border-bottom:1px solid #000;min-width:240px;padding:0 4px;">${oriDates}</span></div>
      <div>Signature of Trainer: <span style="display:inline-block;border-bottom:1px solid #000;min-width:220px;padding:0 4px;">${document.getElementById('ori-trainer-sig').value}</span></div>
      <div>Signature of Trainee: <span style="display:inline-block;border-bottom:1px solid #000;min-width:220px;padding:0 4px;">${document.getElementById('ori-trainee-sig').value}</span></div>
      <div>No. of Hours of Training: <span style="display:inline-block;border-bottom:1px solid #000;min-width:140px;padding:0 4px;">${document.getElementById('ori-hours').value}</span></div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr>
          <th style="width:80px;background:#000;color:#fff;padding:7px 8px;border:1px solid #333;text-align:center;font-size:11px;">Check<br>When<br>complete</th>
          <th style="background:#000;color:#fff;padding:7px 10px;border:1px solid #333;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">The Following Topics Have Been Covered In This Orientation</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <div style="font-size:12.5px;margin-bottom:10px;font-weight:bold;">LAST DAY OF WORK: <span style="display:inline-block;border-bottom:1px solid #000;min-width:160px;padding:0 4px;font-weight:normal;">${fmtD(document.getElementById('ori-last-day').value)}</span></div>

    <div style="font-size:12.5px;margin-bottom:6px;font-weight:bold;">Notes or requests for this Trainee:</div>
    <div style="min-height:80px;border-bottom:1px solid #000;padding:4px 0;font-size:12px;line-height:1.8;">${noteLines}</div>
    <div style="border-bottom:1px solid #000;margin-top:8px;min-height:20px;"></div>
    <div style="border-bottom:1px solid #000;margin-top:8px;min-height:20px;"></div>
  `;
}

function printOrientationForm() {
  const html = buildOrientationHTML();
  const win = window.open('', '_blank', 'width=900,height:1200');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Staff Orientation Checklist</title>
  <style>* { box-sizing:border-box; margin:0; padding:0; } body { font-family:'Times New Roman',Times,serif; background:#fff; color:#000; padding:36px 48px; width:816px; margin:0 auto; }
  @media print { body { padding:24px 36px; } @page { size:letter; margin:0.5in; } }</style>
  </head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.addEventListener('afterprint', () => { win.close(); window.focus(); }); }, 700);
}

function exportOrientationPDF() {
  const html = buildOrientationHTML();
  const win = window.open('', '_blank', 'width=900,height=1200');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Staff Orientation Checklist</title>
  <style>* { box-sizing:border-box; margin:0; padding:0; } body { font-family:'Times New Roman',Times,serif; background:#fff; color:#000; padding:36px 48px; width:816px; margin:0 auto; }
  @media print { body { padding:24px 36px; } @page { size:letter; margin:0.5in; } }</style>
  </head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.addEventListener('afterprint', () => { win.close(); window.focus(); }); }, 700);
}

// ── CREDENTIALS PRINT / PDF ──
function buildCredentialsHTML() {
  const fmtD = (id) => {
    const el = document.getElementById(id);
    if (!el || !el.value) return '';
    return new Date(el.value + 'T00:00:00').toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'});
  };
  const val = (id) => { const el = document.getElementById(id); return el ? (el.value||'') : ''; };
  const chkd = (id) => { const el = document.getElementById(id); return el && el.checked; };

  const hcacYes = chkd('cred-hcac-yes') ? '&#9745;' : '&#9744;';
  const hcacNo = chkd('cred-hcac-no') ? '&#9745;' : '&#9744;';

  const oriDates = ['cred-ori-date1','cred-ori-date2','cred-ori-date3'].map(fmtD).filter(Boolean).join(', &nbsp;');

  const t1rows = [
    ['Fingerprint Background Check Result', 'cred-fingerprint'],
    ['TB Test: &nbsp;&nbsp; <strong>Step 1</strong>', 'cred-tb-step1'],
    ['<span style="padding-left:48px;"><strong>Step 2</strong></span>', 'cred-tb-step2'],
    ['Chest X-Ray or TB Annual Questionnaire', 'cred-tb-xray'],
    ['Nursing Assistant Training', 'cred-na-training'],
    ['70 Hours Basic Training: &nbsp;&nbsp; <strong>Core Basic</strong>', 'cred-70hr-core'],
    ['<span style="padding-left:48px;"><strong>Population Specific</strong></span>', 'cred-70hr-pop'],
    [null, null], // HCA-C row handled separately
    ['Orientation and Training (5 Hours)', 'cred-ori-5hr'],
    ['Nurse Delegation Core Training', 'cred-nurse-core'],
    ['Nurse Delegation: Special Focus on Diabetes', 'cred-nurse-diabetes'],
    ['Specialty Training: &nbsp;&nbsp; <strong>Dementia</strong>', 'cred-spec-dementia'],
    ['<span style="padding-left:48px;"><strong>Mental Health</strong></span>', 'cred-spec-mh'],
    ['<span style="padding-left:48px;"><strong>Developmental Disability</strong></span>', 'cred-spec-dd'],
  ];

  let section1Rows = '';
  t1rows.forEach((row, idx) => {
    if (row[0] === null) {
      // HCA-C exempt row
      section1Rows += `<tr><td style="border:1px solid #999;padding:6px 10px;font-size:11.5px;">Exempt From HCA-C (Employment Verification) &nbsp;&nbsp; ${hcacYes} YES &nbsp; ${hcacNo} NO</td><td style="border:1px solid #999;padding:4px 8px;"></td></tr>`;
    } else {
      section1Rows += `<tr><td style="border:1px solid #999;padding:6px 10px;font-size:11.5px;">${row[0]}</td><td style="border:1px solid #999;padding:6px 10px;font-size:11.5px;text-align:center;">${fmtD(row[1])}</td></tr>`;
    }
  });

  const exp2rows = [
    ['Name and DOB Background Check Result <span style="font-size:10px;">(Valid 2 Years)</span>', ['cred-bg-exp1','cred-bg-exp2','cred-bg-exp3','cred-bg-exp4']],
    ['CPR/First Aid <span style="font-size:10px;">(Usually Valid for 2 Yrs)</span>', ['cred-cpr-exp1','cred-cpr-exp2','cred-cpr-exp3','cred-cpr-exp4']],
    ['Department of Health: <span style="font-size:10px;">Expires on Bday</span>', ['cred-doh-exp1','cred-doh-exp2','cred-doh-exp3','cred-doh-exp4']],
    ['<span style="padding-left:48px;">NAR</span>', ['cred-nar-exp1','cred-nar-exp2','cred-nar-exp3','cred-nar-exp4']],
    ['<span style="padding-left:48px;">NAC</span>', ['cred-nac-exp1','cred-nac-exp2','cred-nac-exp3','cred-nac-exp4']],
    ['<span style="padding-left:48px;">HCA-C</span>', ['cred-hcac-exp1','cred-hcac-exp2','cred-hcac-exp3','cred-hcac-exp4']],
    ['Food Safety/Food Worker\'s Permit', ['cred-food-exp1','cred-food-exp2','cred-food-exp3','cred-food-exp4']],
  ];

  let section2Rows = exp2rows.map(([label, ids]) =>
    `<tr><td style="border:1px solid #999;padding:6px 10px;font-size:11.5px;">${label}</td>${ids.map(id=>`<td style="border:1px solid #999;padding:5px 8px;font-size:11px;text-align:center;">${fmtD(id)}</td>`).join('')}</tr>`
  ).join('');

  // CE rows with blue background
  section2Rows += `
    <tr style="background:#d0e8f8;"><td style="border:1px solid #999;padding:6px 10px;font-size:11.5px;font-weight:bold;" colspan="5">Continuing Education</td></tr>
    <tr style="background:#d0e8f8;"><td style="border:1px solid #999;padding:6px 10px;font-size:11.5px;">From Birthday</td>${['cred-ce-from1','cred-ce-from2','cred-ce-from3','cred-ce-from4'].map(id=>`<td style="border:1px solid #999;padding:5px 8px;font-size:11px;text-align:center;background:#d0e8f8;">${fmtD(id)}</td>`).join('')}</tr>
    <tr style="background:#d0e8f8;"><td style="border:1px solid #999;padding:6px 10px;font-size:11.5px;">To Birthday</td>${['cred-ce-to1','cred-ce-to2','cred-ce-to3','cred-ce-to4'].map(id=>`<td style="border:1px solid #999;padding:5px 8px;font-size:11px;text-align:center;background:#d0e8f8;">${fmtD(id)}</td>`).join('')}</tr>
  `;

  return `
    <div style="text-align:center;margin-bottom:16px;">
      <img src="harmony_living_house_logo.png" alt="Logo" style="width:80px;height:80px;object-fit:contain;display:block;margin:0 auto 6px;">
      <div style="font-size:18px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;">Harmony Living House Adult Family LLC</div>
      <div style="font-size:13px;">120 Newaukum Village Dr</div>
      <div style="font-size:13px;margin-bottom:12px;">Chehalis, WA 98532</div>
      <div style="font-size:15px;font-weight:bold;margin-bottom:14px;">Caregiver Credentials Checklist</div>
    </div>

    <div style="font-size:12.5px;line-height:2.1;margin-bottom:14px;">
      <div>Staff Name: <span style="display:inline-block;border-bottom:1px solid #000;min-width:220px;padding:0 4px;">${val('cred-staff-name')}</span> &nbsp;&nbsp;&nbsp; DOB: <span style="display:inline-block;border-bottom:1px solid #000;min-width:140px;padding:0 4px;">${fmtD('cred-dob')}</span></div>
      <div>Hire Date: <span style="display:inline-block;border-bottom:1px solid #000;min-width:140px;padding:0 4px;">${fmtD('cred-hire-date')}</span> &nbsp;&nbsp;&nbsp; Orientation Date/s: <span style="display:inline-block;border-bottom:1px solid #000;min-width:240px;padding:0 4px;">${oriDates}</span></div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
      <thead>
        <tr>
          <th style="background:#000;color:#fff;padding:7px 10px;border:1px solid #333;text-align:left;font-size:11px;width:65%;"></th>
          <th style="background:#000;color:#fff;padding:7px 10px;border:1px solid #333;text-align:center;font-size:11px;">Date of Completion</th>
        </tr>
      </thead>
      <tbody>${section1Rows}</tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
      <thead>
        <tr>
          <th style="background:#000;color:#fff;padding:7px 10px;border:1px solid #333;text-align:left;font-size:11px;"></th>
          <th style="background:#000;color:#fff;padding:7px 10px;border:1px solid #333;text-align:center;font-size:11px;">EXPIRES</th>
          <th style="background:#000;color:#fff;padding:7px 10px;border:1px solid #333;text-align:center;font-size:11px;">EXPIRES</th>
          <th style="background:#000;color:#fff;padding:7px 10px;border:1px solid #333;text-align:center;font-size:11px;">EXPIRES</th>
          <th style="background:#000;color:#fff;padding:7px 10px;border:1px solid #333;text-align:center;font-size:11px;">EXPIRES</th>
        </tr>
      </thead>
      <tbody>${section2Rows}</tbody>
    </table>

    <div style="font-size:12.5px;font-weight:bold;margin-top:10px;">Last Day of Employment: <span style="display:inline-block;border-bottom:1px solid #000;min-width:180px;padding:0 4px;font-weight:normal;">${fmtD('cred-last-day')}</span></div>
  `;
}

function printCredentialsForm() {
  const html = buildCredentialsHTML();
  const win = window.open('', '_blank', 'width:900,height=1200');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Caregiver Credentials Checklist</title>
  <style>* { box-sizing:border-box; margin:0; padding:0; } body { font-family:'Times New Roman',Times,serif; background:#fff; color:#000; padding:36px 48px; width:816px; margin:0 auto; }
  @media print { body { padding:24px 36px; } @page { size:letter; margin:0.5in; } }</style>
  </head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.addEventListener('afterprint', () => { win.close(); window.focus(); }); }, 700);
}

async function exportCredentialsPDF() {
  const html = buildCredentialsHTML();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'letter' });
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:816px;background:#fff;font-family:Times New Roman,serif;font-size:12px;';
  container.innerHTML = html;
  document.body.appendChild(container);
  const name = (document.getElementById('cred-staff-name').value || 'Staff').replace(/\s+/g,'_');
  doc.html(container, {
    callback: (d) => { document.body.removeChild(container); d.save(`CredentialsChecklist_${name}_${new Date().toISOString().split('T')[0]}.pdf`); setTimeout(() => window.focus(), 300); },
    x:36, y:20, width:540, windowWidth:816
  });
}

// ══════════════════════════════════
// STAFF DOCS — SUPABASE SAVE / LIST
// ══════════════════════════════════

async function saveOrientationToSupabase() {
  const name = document.getElementById('ori-trainee-name').value.trim();
  if (!name) { toast('Please enter the trainee name before saving'); return; }
  const checks = ORI_CHECKLIST_ITEMS.map((_,i) => {
    const el = document.getElementById('ori-chk-' + i);
    return el ? el.checked : false;
  });
  const record = {
    id: uid(),
    trainee_name: name,
    hire_date: document.getElementById('ori-hire-date').value,
    ori_date1: document.getElementById('ori-date1').value,
    ori_date2: document.getElementById('ori-date2').value,
    ori_date3: document.getElementById('ori-date3').value,
    trainer_sig: document.getElementById('ori-trainer-sig').value,
    trainee_sig: document.getElementById('ori-trainee-sig').value,
    hours: document.getElementById('ori-hours').value,
    last_day: document.getElementById('ori-last-day').value,
    notes: document.getElementById('ori-notes').value,
    checks: JSON.stringify(checks),
    created_at: new Date().toISOString(),
    created_by: currentUser ? currentUser.name : ''
  };
  const { error } = await db.from('staff_orientations').insert(record);
  if (error) { toast('Error saving: ' + error.message); return; }
  toast('✅ Orientation checklist saved!');
  loadSavedOrientations();
}

async function loadSavedOrientations() {
  const wrap = document.getElementById('saved-orientations-list-wrap');
  const container = document.getElementById('saved-orientations-list');
  if (!wrap || !container) return;
  const { data, error } = await db.from('staff_orientations').select('*').order('created_at', { ascending: false });
  if (error) { toast('Error loading: ' + error.message); return; }
  wrap.style.display = 'block';
  if (!data || !data.length) {
    container.innerHTML = '<div style="color:var(--text3);font-style:italic;font-size:13px;padding:10px 0;">No saved checklists yet.</div>';
    return;
  }
  container.innerHTML = data.map(r => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-weight:700;font-size:14px;color:var(--accent);">${r.trainee_name}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:3px;">
          Hire Date: ${r.hire_date ? fmtDate(r.hire_date) : '—'} &nbsp;·&nbsp;
          Saved: ${fmtDate(r.created_at?.split('T')[0])} &nbsp;·&nbsp;
          By: ${r.created_by || '—'}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" onclick="loadOrientationRecord('${r.id}')">✏️ Edit / View</button>
        <button class="btn btn-secondary btn-sm" onclick="printOrientationRecord('${r.id}')">🖨️ Print</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSavedOrientation('${r.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function openSavedOrientationsList() {
  const wrap = document.getElementById('saved-orientations-list-wrap');
  if (!wrap) return;
  const isHidden = wrap.style.display === 'none' || wrap.style.display === '';
  if (isHidden) {
    wrap.style.display = 'block';
    loadSavedOrientations();
    setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  } else {
    wrap.style.display = 'none';
  }
}

async function loadOrientationRecord(id) {
  const { data: r } = await db.from('staff_orientations').select('*').eq('id', id).single();
  if (!r) return;
  document.getElementById('ori-trainee-name').value = r.trainee_name || '';
  document.getElementById('ori-hire-date').value = r.hire_date || '';
  document.getElementById('ori-date1').value = r.ori_date1 || '';
  document.getElementById('ori-date2').value = r.ori_date2 || '';
  document.getElementById('ori-date3').value = r.ori_date3 || '';
  document.getElementById('ori-trainer-sig').value = r.trainer_sig || '';
  document.getElementById('ori-trainee-sig').value = r.trainee_sig || '';
  document.getElementById('ori-hours').value = r.hours || '';
  document.getElementById('ori-last-day').value = r.last_day || '';
  document.getElementById('ori-notes').value = r.notes || '';
  try {
    const checks = JSON.parse(r.checks || '[]');
    checks.forEach((v, i) => { const el = document.getElementById('ori-chk-' + i); if (el) el.checked = v; });
  } catch {}
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('Record loaded — edit and save again to update');
}

async function printOrientationRecord(id) {
  const { data: r } = await db.from('staff_orientations').select('*').eq('id', id).single();
  if (!r) return;
  // Load into form, build HTML, then print
  await loadOrientationRecord(id);
  setTimeout(() => { printOrientationForm(); }, 300);
}

async function deleteSavedOrientation(id) {
  if (!confirm('Delete this saved orientation checklist?')) return;
  await db.from('staff_orientations').delete().eq('id', id);
  toast('Deleted');
  loadSavedOrientations();
}

async function saveCredentialsToSupabase() {
  const name = document.getElementById('cred-staff-name').value.trim();
  if (!name) { toast('Please enter the staff name before saving'); return; }
  const ids = ['cred-staff-name','cred-dob','cred-hire-date','cred-ori-date1','cred-ori-date2','cred-ori-date3',
    'cred-fingerprint','cred-tb-step1','cred-tb-step2','cred-tb-xray','cred-na-training',
    'cred-70hr-core','cred-70hr-pop','cred-ori-5hr','cred-nurse-core','cred-nurse-diabetes',
    'cred-spec-dementia','cred-spec-mh','cred-spec-dd',
    'cred-bg-exp1','cred-bg-exp2','cred-bg-exp3','cred-bg-exp4',
    'cred-cpr-exp1','cred-cpr-exp2','cred-cpr-exp3','cred-cpr-exp4',
    'cred-doh-exp1','cred-doh-exp2','cred-doh-exp3','cred-doh-exp4',
    'cred-nar-exp1','cred-nar-exp2','cred-nar-exp3','cred-nar-exp4',
    'cred-nac-exp1','cred-nac-exp2','cred-nac-exp3','cred-nac-exp4',
    'cred-hcac-exp1','cred-hcac-exp2','cred-hcac-exp3','cred-hcac-exp4',
    'cred-food-exp1','cred-food-exp2','cred-food-exp3','cred-food-exp4',
    'cred-ce-from1','cred-ce-from2','cred-ce-from3','cred-ce-from4',
    'cred-ce-to1','cred-ce-to2','cred-ce-to3','cred-ce-to4','cred-last-day'];
  const fieldData = {};
  ids.forEach(id => { const el = document.getElementById(id); if (el) fieldData[id] = el.value; });
  fieldData['cred-hcac-yes'] = document.getElementById('cred-hcac-yes')?.checked;
  fieldData['cred-hcac-no'] = document.getElementById('cred-hcac-no')?.checked;
  const record = {
    id: uid(),
    staff_name: name,
    field_data: JSON.stringify(fieldData),
    created_at: new Date().toISOString(),
    created_by: currentUser ? currentUser.name : ''
  };
  const { error } = await db.from('staff_credentials').insert(record);
  if (error) { toast('Error saving: ' + error.message); return; }
  toast('✅ Credentials checklist saved!');
  loadSavedCredentials();
}

async function loadSavedCredentials() {
  const wrap = document.getElementById('saved-credentials-list-wrap');
  const container = document.getElementById('saved-credentials-list');
  if (!wrap || !container) return;
  const { data, error } = await db.from('staff_credentials').select('*').order('created_at', { ascending: false });
  if (error) { toast('Error loading: ' + error.message); return; }
  wrap.style.display = 'block';
  if (!data || !data.length) {
    container.innerHTML = '<div style="color:var(--text3);font-style:italic;font-size:13px;padding:10px 0;">No saved credentials checklists yet.</div>';
    return;
  }
  container.innerHTML = data.map(r => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-weight:700;font-size:14px;color:#1a73e8;">${r.staff_name}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:3px;">
          Saved: ${fmtDate(r.created_at?.split('T')[0])} &nbsp;·&nbsp;
          By: ${r.created_by || '—'}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" onclick="loadCredentialsRecord('${r.id}')">✏️ Edit / View</button>
        <button class="btn btn-secondary btn-sm" onclick="printCredentialsRecord('${r.id}')">🖨️ Print</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSavedCredentials('${r.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function openSavedCredentialsList() {
  const wrap = document.getElementById('saved-credentials-list-wrap');
  if (!wrap) return;
  const isHidden = wrap.style.display === 'none' || wrap.style.display === '';
  if (isHidden) {
    wrap.style.display = 'block';
    loadSavedCredentials();
    setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  } else {
    wrap.style.display = 'none';
  }
}

async function loadCredentialsRecord(id) {
  const { data: r } = await db.from('staff_credentials').select('*').eq('id', id).single();
  if (!r) return;
  try {
    const d = JSON.parse(r.field_data || '{}');
    Object.entries(d).forEach(([fid, val]) => {
      const el = document.getElementById(fid);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val || '';
    });
  } catch {}
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('Record loaded — edit and save again to update');
}

async function printCredentialsRecord(id) {
  await loadCredentialsRecord(id);
  setTimeout(() => { printCredentialsForm(); }, 300);
}

async function deleteSavedCredentials(id) {
  if (!confirm('Delete this saved credentials checklist?')) return;
  await db.from('staff_credentials').delete().eq('id', id);
  toast('Deleted');
  loadSavedCredentials();
}

// ══════════════════════════════════
// STAFF SALARY CONFIG & BALANCE
// ══════════════════════════════════

const SALARY_CONFIG_KEY = 'hlh_salary_config';
const KNOWN_STAFF = ['James', 'Alvan', 'Ketty', 'Joseph'];

const STAFF_COLORS = {
  'James':  { bg:'#e8f0fe', border:'#1a73e8', text:'#1a73e8', dot:'#1a73e8' },
  'Alvan':  { bg:'#f3e8fd', border:'#7c3aed', text:'#7c3aed', dot:'#7c3aed' },
  'Ketty':  { bg:'#fce4ec', border:'#e91e63', text:'#e91e63', dot:'#e91e63' },
  'Joseph': { bg:'#e6f4ea', border:'#1e7e34', text:'#1e7e34', dot:'#1e7e34' },
};

function getSalaryConfig() {
  try { return JSON.parse(localStorage.getItem(SALARY_CONFIG_KEY)) || {}; } catch { return {}; }
}

function openSalaryConfig() {
  const cfg = getSalaryConfig();
  KNOWN_STAFF.forEach(name => {
    const key = name.toLowerCase();
    const amtEl = document.getElementById('salary-' + key + '-amount');
    const freqEl = document.getElementById('salary-' + key + '-freq');
    if (amtEl) amtEl.value = cfg[key]?.amount || '';
    if (freqEl) freqEl.value = cfg[key]?.freq || 'monthly';
  });
  openModal('modal-salary-config');
}

function saveSalaryConfig() {
  const cfg = getSalaryConfig(); // start from existing so dynamic staff aren't wiped
  // Save the four hardcoded staff inputs
  ['James','Alvan','Joseph','Ketty'].forEach(name => {
    const key = name.toLowerCase();
    const amtEl = document.getElementById('salary-' + key + '-amount');
    const freqEl = document.getElementById('salary-' + key + '-freq');
    if (!amtEl) return;
    const amount = parseFloat(amtEl.value || 0);
    const freq = freqEl?.value || 'monthly';
    if (amount > 0) cfg[key] = { amount, freq, name };
  });
  // Save any dynamically added staff cards in the modal
  document.querySelectorAll('[id^="salary-card-"]').forEach(card => {
    const key = card.id.replace('salary-card-', '');
    const amtEl = document.getElementById('salary-' + key + '-amount');
    const freqEl = document.getElementById('salary-' + key + '-freq');
    if (!amtEl) return;
    const amount = parseFloat(amtEl.value || 0);
    const freq = freqEl?.value || 'monthly';
    const existingName = cfg[key]?.name || key;
    if (amount > 0) cfg[key] = { amount, freq, name: existingName };
  });
  localStorage.setItem(SALARY_CONFIG_KEY, JSON.stringify(cfg));
  closeModal('modal-salary-config');
  toast('✅ Salary settings saved');
  renderExpensesPanel();
}

// Returns all wage payments for a staff member, optionally filtered by overlap with a period
async function getWagePayments(staffName, periodStart, periodEnd) {
  const { data } = await db.from('expenses')
    .select('*')
    .eq('expense_type', 'wage')
    .eq('wage_staff', staffName)
    .order('wage_period_start', { ascending: true });
  if (!data) return [];
  if (!periodStart || !periodEnd) return data;
  // Return payments whose period overlaps with the requested window
  return data.filter(p => {
    if (!p.wage_period_start || !p.wage_period_end) return false;
    return p.wage_period_start <= periodEnd && p.wage_period_end >= periodStart;
  });
}

// Compute outstanding balance for a staff member across ALL time
// Returns array of { period, expected, paid, balance } objects
async function computeStaffBalance(staffName) {
  const cfg = getSalaryConfig();
  const key = staffName.toLowerCase();
  const staffCfg = cfg[key];
  if (!staffCfg || !staffCfg.amount) return null;

  const { data: allPayments } = await db.from('expenses')
    .select('*')
    .eq('expense_type', 'wage')
    .eq('wage_staff', staffName)
    .order('wage_period_start', { ascending: true });

  if (!allPayments || !allPayments.length) return { staffCfg, payments: [], totalExpected: 0, totalPaid: 0, totalOwed: 0 };

  // Group payments by period label
  const byPeriod = {};
  allPayments.forEach(p => {
    const key = (p.wage_period_start || '') + '_' + (p.wage_period_end || '');
    if (!byPeriod[key]) byPeriod[key] = { start: p.wage_period_start, end: p.wage_period_end, payments: [] };
    byPeriod[key].payments.push(p);
  });

  const periods = Object.values(byPeriod).map(pg => {
    const paid = pg.payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const expected = staffCfg.amount;
    return { start: pg.start, end: pg.end, expected, paid, balance: expected - paid, payments: pg.payments };
  });

  const totalPaid = periods.reduce((s, p) => s + p.paid, 0);
  const totalExpected = periods.reduce((s, p) => s + p.expected, 0);
  const totalOwed = periods.reduce((s, p) => s + Math.max(0, p.balance), 0);

  return { staffCfg, periods, totalPaid, totalExpected, totalOwed };
}

async function renderWageBalancePanel(staffName) {
  const panel = document.getElementById('wage-balance-panel');
  if (!panel) return;
  if (!staffName || staffName === '' || staffName === 'Other') {
    panel.style.display = 'none';
    return;
  }

  const cfg = getSalaryConfig();
  const key = staffName.toLowerCase();
  const staffCfg = cfg[key];
  const colors = STAFF_COLORS[staffName] || { bg:'#f4f6f9', border:'#8a9ab0', text:'#4a5568' };

  // Get selected period from form
  const periodStart = document.getElementById('exp-wage-period-start')?.value;
  const periodEnd = document.getElementById('exp-wage-period-end')?.value;

  // Fetch all wage payments for this staff
  const { data: allPayments } = await db.from('expenses')
    .select('*')
    .eq('expense_type', 'wage')
    .eq('wage_staff', staffName)
    .order('wage_period_start', { ascending: true });

  const payments = allPayments || [];

  // ── Compute overall balance across all past periods ──
  let overallOwed = 0;
  let overdueRows = '';
  if (staffCfg && staffCfg.amount) {
    const byPeriod = {};
    payments.forEach(p => {
      const pk = (p.wage_period_start||'') + '_' + (p.wage_period_end||'');
      if (!byPeriod[pk]) byPeriod[pk] = { start: p.wage_period_start, end: p.wage_period_end, paid: 0 };
      byPeriod[pk].paid += parseFloat(p.amount || 0);
    });
    Object.values(byPeriod).forEach(pg => {
      const bal = staffCfg.amount - pg.paid;
      if (bal > 0.005) {
        overallOwed += bal;
        overdueRows += `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(0,0,0,0.06);">
          <span style="color:#555;">${fmtDate(pg.start)} – ${fmtDate(pg.end)}</span>
          <span style="display:flex;gap:10px;">
            <span style="color:#888;">Paid: <strong>$${pg.paid.toFixed(2)}</strong></span>
            <span style="color:#c0392b;font-weight:600;">Still owed: $${bal.toFixed(2)}</span>
          </span>
        </div>`;
      }
    });
  }

  // ── Compute for the currently selected period in the form ──
  let currentPeriodHtml = '';
  if (periodStart && periodEnd && staffCfg && staffCfg.amount) {
    const periodPayments = payments.filter(p =>
      p.wage_period_start && p.wage_period_end &&
      p.wage_period_start <= periodEnd && p.wage_period_end >= periodStart
    );
    const paidThisPeriod = periodPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const remainingThisPeriod = staffCfg.amount - paidThisPeriod;
    const pct = Math.min(100, Math.round((paidThisPeriod / staffCfg.amount) * 100));
    const barColor = pct >= 100 ? '#1e7e34' : pct >= 50 ? '#d68910' : '#c0392b';

    currentPeriodHtml = `
      <div style="padding:10px 14px;background:#fffdf5;border-bottom:1px solid rgba(0,0,0,0.07);">
        <div style="font-size:11px;font-weight:700;color:#8a6408;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Selected Period: ${fmtDate(periodStart)} – ${fmtDate(periodEnd)}</div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px;">
          <span>Expected: <strong>$${staffCfg.amount.toFixed(2)}</strong></span>
          <span>Paid so far: <strong style="color:#1e7e34;">$${paidThisPeriod.toFixed(2)}</strong></span>
          <span style="color:${remainingThisPeriod > 0.005 ? '#c0392b' : '#1e7e34'};font-weight:700;">${remainingThisPeriod > 0.005 ? 'Still owed: $' + remainingThisPeriod.toFixed(2) : '✅ Fully paid'}</span>
        </div>
        <div style="background:#e0e0e0;border-radius:20px;height:7px;overflow:hidden;">
          <div style="width:${pct}%;background:${barColor};height:100%;border-radius:20px;transition:width 0.3s;"></div>
        </div>
        <div style="font-size:10.5px;color:#999;margin-top:3px;text-align:right;">${pct}% paid</div>
      </div>`;
  } else if (!staffCfg || !staffCfg.amount) {
    currentPeriodHtml = `<div style="padding:10px 14px;background:#fff8e1;font-size:12px;color:#8a6408;border-bottom:1px solid rgba(0,0,0,0.07);">
      ⚠️ No salary configured for ${staffName}. <button onclick="closeModal('modal-expense');openSalaryConfig()" style="background:none;border:none;cursor:pointer;color:var(--accent);font-weight:700;font-family:inherit;font-size:12px;">Set up salary →</button>
    </div>`;
  }

  // ── Outstanding from past periods ──
  let overdueHtml = '';
  if (overallOwed > 0.005) {
    overdueHtml = `
      <div style="padding:10px 14px;background:#fdf0ef;">
        <div style="font-size:11px;font-weight:700;color:#c0392b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">⚠️ Outstanding from Past Periods — Total Owed: $${overallOwed.toFixed(2)}</div>
        ${overdueRows}
      </div>`;
  } else if (payments.length > 0 && staffCfg?.amount) {
    overdueHtml = `<div style="padding:8px 14px;background:#e6f4ea;font-size:12px;color:#1e7e34;font-weight:600;">✅ No outstanding balance from previous periods</div>`;
  }

  panel.innerHTML = `
    <div style="padding:9px 14px;background:${colors.bg};border-bottom:1px solid ${colors.border}20;display:flex;align-items:center;gap:8px;">
      <div style="width:28px;height:28px;border-radius:50%;background:${colors.bg};border:2px solid ${colors.border};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:${colors.text};">${staffName.charAt(0)}</div>
      <div style="font-weight:700;font-size:13px;color:${colors.text};">${staffName} — Wage Balance Tracker</div>
      ${staffCfg?.amount ? `<span style="margin-left:auto;font-size:12px;color:${colors.text};opacity:0.8;">Expected per period: $${staffCfg.amount.toFixed(2)}</span>` : ''}
    </div>
    ${currentPeriodHtml}
    ${overdueHtml}`;
  panel.style.display = 'block';
}

// ── Frequency helpers ──
function getFrequencyLabel(freq) {
  return { monthly:'Monthly', biweekly:'Bi-weekly', weekly:'Weekly', sunday_only:'Sunday Only' }[freq] || 'Monthly';
}

// Returns the current period window for a given frequency
function getCurrentPeriodForFreq(freq) {
  const now = new Date();
  let start, end;
  if (freq === 'sunday_only') {
  // Find the most recent Sunday
  const day = now.getDay(); // 0 = Sunday
  const diffToSun = day === 0 ? 0 : -(day);
  start = new Date(now); start.setDate(now.getDate() + diffToSun); start.setHours(0,0,0,0);
  end = new Date(start); // same day
  return {
    start: start.toISOString().split('T')[0],
    end:   start.toISOString().split('T')[0]
  };
}
  if (freq === 'weekly') {
    // Week starts Monday
    const day = now.getDay(); // 0=Sun
    const diffToMon = (day === 0) ? -6 : 1 - day;
    start = new Date(now); start.setDate(now.getDate() + diffToMon); start.setHours(0,0,0,0);
    end = new Date(start); end.setDate(start.getDate() + 6);
  } else if (freq === 'biweekly') {
    // Bi-weekly anchored to Jan 1 of current year
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const daysSince = Math.floor((now - yearStart) / 86400000);
    const periodNum = Math.floor(daysSince / 14);
    start = new Date(yearStart); start.setDate(1 + periodNum * 14);
    end = new Date(start); end.setDate(start.getDate() + 13);
  } else {
    // Monthly
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0]
  };
}

// Generate all expected periods from the earliest payment date up to today
function generateExpectedPeriods(freq, earliestDateStr) {
  const periods = [];
  const now = new Date(); now.setHours(0,0,0,0);
  if (!earliestDateStr) return periods;

  // Financial tracking started May 1 2026 — never count anything before this as overdue
  const TRACKING_START = '2026-05-01';
  const effectiveStart = earliestDateStr < TRACKING_START ? TRACKING_START : earliestDateStr;
let cursor = new Date(effectiveStart + 'T00:00:00');
  if (freq === 'weekly') {
    const day = cursor.getDay();
    const diffToMon = (day === 0) ? -6 : 1 - day;
    cursor.setDate(cursor.getDate() + diffToMon);
  } else if (freq === 'biweekly') {
    const yearStart = new Date(cursor.getFullYear(), 0, 1);
    const daysSince = Math.floor((cursor - yearStart) / 86400000);
    const periodNum = Math.floor(daysSince / 14);
    cursor = new Date(yearStart); cursor.setDate(1 + periodNum * 14);
  } else {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  }

  let safety = 0;
  while (cursor <= now && safety < 500) {
    safety++;
    let periodEnd;
    if (freq === 'sunday_only') {
      periodEnd = new Date(cursor); // same day — each Sunday is its own period
    } else
    if (freq === 'weekly') {
      periodEnd = new Date(cursor); periodEnd.setDate(cursor.getDate() + 6);
    } else if (freq === 'biweekly') {
      periodEnd = new Date(cursor); periodEnd.setDate(cursor.getDate() + 13);
    } else {
      periodEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    }
    const pEnd = periodEnd > now ? now : periodEnd;
    periods.push({
      start: cursor.toISOString().split('T')[0],
      end:   pEnd.toISOString().split('T')[0],
      fullEnd: periodEnd.toISOString().split('T')[0],
      isPast: periodEnd < now
    });
    // Advance cursor
    const next = new Date(periodEnd); next.setDate(next.getDate() + 1);
    cursor = next;
  }
  return periods;
}

// Track selected month for wage balance strip
let _wageStripMonth = null;

function _getWageMonths() {
  const months = [];
  const start = new Date(2026, 4, 1); // May 2026
  const now = new Date();
  let y = 2026, m = 5; // May = month 5
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    months.push(`${y}-${String(m).padStart(2,'0')}`);
    m++; if (m > 13) { m = 1; y++; }
  }
  return months.reverse(); // most recent first
}


// ══════════════════════════════════
// STAFF WAGE MODAL
// ══════════════════════════════════
let _swModalStaff = null;
let _swModalFullName = null;

async function openStaffWageModal(firstName, fullName, focusMonth) {
  _swModalStaff = firstName;
  _swModalFullName = fullName || firstName;

  const { data: dbStaff } = await db.from('staff_members')
    .select('name, salary_amount, salary_freq, salary_start_month')
    .eq('name', fullName).maybeSingle();

  const amount = dbStaff ? parseFloat(dbStaff.salary_amount || 0) : 0;
  const startMonth = dbStaff ? (dbStaff.salary_start_month || '2026-05-01') : '2026-05-01';
  const colors = STAFF_COLORS[firstName] || { bg:'#f4f6f9', border:'#8a9ab0', text:'#4a5568' };

  const { data: allPayments } = await db.from('expenses')
    .select('*').eq('expense_type', 'wage').eq('wage_staff', firstName)
    .order('wage_period_start', { ascending: true });
  const payments = allPayments || [];

  const allMonths = _getWageMonths().filter(mk => mk >= startMonth.slice(0,7)).reverse();
  const today = new Date().toISOString().split('T')[0];
  const mn = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let rows = '';
  let totalOwed = 0;

  for (const mk of allMonths) {
    const [my, mm] = mk.split('-').map(Number);
    const mStart = mk + '-01';
    const mEnd = mk + '-' + String(new Date(my, mm, 0).getDate()).padStart(2,'0');
    if (mStart > today) continue;

    const mPayments = payments.filter(p => {
      if (!p.wage_period_start) return false;
      return (p.wage_period_start >= mStart && p.wage_period_start <= mEnd) ||
             (p.wage_period_start < mStart && p.wage_period_end && p.wage_period_end >= mStart);
    });
    const mPaid = mPayments.reduce((s,p) => s + parseFloat(p.amount||0), 0);
    const mOwed = Math.max(0, amount - mPaid);
    const isPast = mEnd < today;
    const isOverdue = isPast && mOwed > 0.005;
    const isFullyPaid = mOwed <= 0.005;
    const isFocus = mk === focusMonth;
    if (isPast && mOwed > 0.005) totalOwed += mOwed;
    const pct = amount > 0 ? Math.min(100, Math.round((mPaid / amount) * 100)) : 0;
    const barColor = pct >= 100 ? '#1e7e34' : pct >= 50 ? '#d68910' : '#c0392b';

    rows += '<div id="swrow-' + mk + '" style="border:1.5px solid ' + (isFocus ? '#c0392b' : isOverdue ? '#f5c0bb' : '#e8edf2') + ';border-radius:8px;padding:12px 14px;margin-bottom:8px;background:' + (isFocus ? '#fff5f5' : '#fff') + ';">';
    rows += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
    rows += '<div style="font-weight:700;font-size:13px;color:#1a2332;">' + mn[mm] + ' ' + my + '</div>';
    rows += '<div style="display:flex;align-items:center;gap:8px;">';
    rows += '<span style="font-size:11px;color:#888;">Paid: <strong style="color:#1e7e34;">$' + mPaid.toFixed(2) + '</strong> / $' + amount.toFixed(2) + '</span>';
    if (isFullyPaid) {
      rows += '<span style="background:#e6f4ea;color:#1e7e34;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;">Paid</span>';
    } else {
      rows += '<span style="background:' + (isOverdue ? '#fdf0ef' : '#fff3cd') + ';color:' + (isOverdue ? '#c0392b' : '#856404') + ';border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;">' + (isOverdue ? 'Overdue' : 'Owed') + ' $' + mOwed.toFixed(2) + '</span>';
      rows += '<button onclick="openSwPayForm(\'' + mk + '\', ' + mOwed.toFixed(2) + ')" style="background:' + (isOverdue ? '#c0392b' : 'var(--accent)') + ';color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Pay</button>';
    }
    rows += '</div></div>';
    rows += '<div style="background:#e8e8e8;border-radius:20px;height:5px;overflow:hidden;">';
    rows += '<div style="width:' + pct + '%;background:' + barColor + ';height:100%;border-radius:20px;"></div></div>';

    if (mPayments.length > 0) {
      rows += '<div style="margin-top:8px;display:flex;flex-direction:column;gap:3px;">';
      mPayments.forEach(function(p) {
        rows += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#888;padding:2px 0;">';
        rows += '<span>' + fmtDate(p.exp_date) + (p.method ? ' · ' + p.method : '') + (p.paid_by ? ' by ' + p.paid_by : '') + '</span>';
        rows += '<span style="color:#1e7e34;font-weight:600;">+$' + parseFloat(p.amount||0).toFixed(2) + '</span></div>';
      });
      rows += '</div>';
    }

    rows += '<div id="swpayform-' + mk + '" style="display:none;margin-top:10px;background:#f8f9fb;border:1px solid #e0e4ea;border-radius:8px;padding:12px;">';
    rows += '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Record Payment — ' + mn[mm] + ' ' + my + '</div>';
    rows += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">';
    rows += '<div><label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:3px;">Amount</label><input type="number" id="swamt-' + mk + '" value="' + mOwed.toFixed(2) + '" style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;box-sizing:border-box;"></div>';
    rows += '<div><label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:3px;">Date Paid</label><input type="date" id="swdate-' + mk + '" value="' + today + '" style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;box-sizing:border-box;"></div>';
    rows += '<div><label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:3px;">Method</label><select id="swmethod-' + mk + '" style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;"><option>Cash</option><option>Check</option><option>Bank Transfer</option><option>Zelle</option><option>Other</option></select></div>';
    rows += '<div><label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:3px;">Paid By</label><input type="text" id="swby-' + mk + '" placeholder="Name" style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;box-sizing:border-box;"></div>';
    rows += '</div>';
    rows += '<div style="display:flex;gap:8px;">';
    rows += '<button onclick="submitSwPayment('' + mk + '', '' + mStart + '', '' + mEnd + '', ' + amount.toFixed(2) + ')" style="background:var(--accent);color:#fff;border:none;border-radius:7px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Save Payment</button>';
    rows += '<button onclick="document.getElementById('swpayform-' + mk + '').style.display='none'" style="background:var(--surface2);color:var(--text2);border:1px solid var(--border);border-radius:7px;padding:8px 14px;font-size:12px;cursor:pointer;font-family:inherit;">Cancel</button>';
    rows += '</div></div>';
    rows += '</div>';
  }

  const modalEl = document.getElementById('modal-staff-wage');
  if (!modalEl) return;
  document.getElementById('sw-modal-title').textContent = firstName + ' — Wage History';
  document.getElementById('sw-modal-subtitle').textContent = (fullName || firstName) + ' · $' + amount.toFixed(2) + '/month';
  const owedEl = document.getElementById('sw-total-owed');
  owedEl.textContent = totalOwed > 0.005 ? 'Total Outstanding: $' + totalOwed.toFixed(2) : 'All payments up to date';
  owedEl.style.color = totalOwed > 0.005 ? '#c0392b' : '#1e7e34';
  document.getElementById('sw-modal-body').innerHTML = rows || '<div style="text-align:center;padding:40px;color:var(--text3);">No wage history found.</div>';
  openModal('modal-staff-wage');
  if (focusMonth) {
    setTimeout(function() {
      const el = document.getElementById('swrow-' + focusMonth);
      if (el) { el.scrollIntoView({ behavior:'smooth', block:'center' }); openSwPayForm(focusMonth, 0); }
    }, 300);
  }
}

function openSwPayForm(mk, owed) {
  document.querySelectorAll('[id^="swpayform-"]').forEach(function(el) { el.style.display = 'none'; });
  const form = document.getElementById('swpayform-' + mk);
  if (form) form.style.display = 'block';
}

async function submitSwPayment(mk, mStart, mEnd, expectedAmount) {
  const paidAmt = parseFloat(document.getElementById('swamt-' + mk)?.value || 0);
  const payDate = document.getElementById('swdate-' + mk)?.value || new Date().toISOString().split('T')[0];
  const method = document.getElementById('swmethod-' + mk)?.value || 'Cash';
  const paidBy = document.getElementById('swby-' + mk)?.value?.trim() || '';
  if (!paidAmt || paidAmt <= 0) { toast('Please enter a valid amount'); return; }

  const { data: existing } = await db.from('expenses').select('amount')
    .eq('expense_type', 'wage').eq('wage_staff', _swModalStaff)
    .gte('wage_period_start', mStart).lte('wage_period_start', mEnd);
  const alreadyPaid = (existing || []).reduce(function(s,p) { return s + parseFloat(p.amount||0); }, 0);
  const remainingOwed = Math.max(0, expectedAmount - alreadyPaid);
  const excess = paidAmt - remainingOwed;

  const { error } = await db.from('expenses').insert({
    id: uid(), expense_type: 'wage', exp_date: payDate,
    amount: paidAmt.toFixed(2), category: 'Staff Wages',
    description: 'Wages — ' + _swModalStaff + ' (' + fmtDate(mStart) + ' to ' + fmtDate(mEnd) + ')',
    wage_staff: _swModalStaff, wage_period_start: mStart, wage_period_end: mEnd,
    wage_hours: null, wage_rate: null, method: method, paid_by: paidBy,
    receipt_ref: '', notes: '', vendor: null, created_at: new Date().toISOString()
  });
  if (error) { toast('Error: ' + error.message); return; }

  if (excess > 0.005) {
    const parts = mk.split('-');
    const nextDate = new Date(parseInt(parts[0]), parseInt(parts[1]), 1);
    const nextMK = nextDate.toISOString().slice(0,7);
    const nextStart = nextMK + '-01';
    const nextEnd = nextMK + '-' + String(new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate()).padStart(2,'0');
    await db.from('expenses').insert({
      id: uid(), expense_type: 'wage', exp_date: nextStart,
      amount: excess.toFixed(2), category: 'Staff Wages',
      description: 'Wages — ' + _swModalStaff + ' (forwarded from ' + mk + ')',
      wage_staff: _swModalStaff, wage_period_start: nextStart, wage_period_end: nextEnd,
      wage_hours: null, wage_rate: null, method: method, paid_by: paidBy,
      receipt_ref: 'Forwarded from ' + mk,
      notes: 'Auto-forwarded $' + excess.toFixed(2) + ' overpayment',
      vendor: null, created_at: new Date().toISOString()
    });
    toast('Saved — $' + excess.toFixed(2) + ' forwarded to ' + nextMK);
  } else {
    toast('Payment of $' + paidAmt.toFixed(2) + ' recorded');
  }
  closeModal('modal-staff-wage');
  renderWageBalanceStrip();
  renderExpensesPanel();
}

async function renderWageBalanceStrip() {
  const strip = document.getElementById('wage-balance-strip');
  if (!strip) { console.log('WAGE STRIP: element not found'); return; }

  const { data: dbStaff } = await db.from('staff_members')
    .select('name, salary_amount, salary_freq, salary_start_month')
    .eq('is_active', true);

  if (!dbStaff || !dbStaff.length) { strip.style.display = 'none'; return; }

  const today = new Date().toISOString().split('T')[0];
  const allMonths = _getWageMonths();
  if (!_wageStripMonth || !allMonths.includes(_wageStripMonth)) {
    _wageStripMonth = allMonths[0];
  }

  const staffRows = dbStaff.filter(s => {
    if (!s.name || !s.salary_amount || parseFloat(s.salary_amount) <= 0) return false;
    const startMonth = s.salary_start_month || '2026-05-01';
    const staffStartMK = startMonth.slice(0, 7);
    return _wageStripMonth >= staffStartMK;
  });

  if (!staffRows.length) { strip.style.display = 'none'; return; }

  const [selY, selM] = _wageStripMonth.split('-').map(Number);
  const monthStart = `${_wageStripMonth}-01`;
  const lastDay = new Date(selY, selM, 0).getDate();
  const monthEnd = `${_wageStripMonth}-${String(lastDay).padStart(2,'0')}`;

  const mn = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthDropdown = `<select onchange="_wageStripMonth=this.value;renderWageBalanceStrip()"
    style="font-size:11px;font-weight:700;color:var(--text);background:var(--surface);border:1.5px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer;font-family:inherit;">
    ${allMonths.map(mk => {
      const [my, mm] = mk.split('-').map(Number);
      return `<option value="${mk}" ${mk === _wageStripMonth ? 'selected' : ''}>${mn[mm]} ${my}</option>`;
    }).join('')}
  </select>`;

  let cards = '';
  let anyOverdue = false;
  let overdueAlertHtml = '';

  for (const s of staffRows) {
    const firstName = s.name.split(' ')[0];
    const key = firstName.toLowerCase();
    const amount = parseFloat(s.salary_amount);
    const freq = s.salary_freq || 'monthly';
    const startMonth = s.salary_start_month || '2026-05-01';
    const isKetty = firstName.toLowerCase() === 'ketty';
    const colors = STAFF_COLORS[firstName] || { bg:'#f4f6f9', border:'#8a9ab0', text:'#4a5568', dot:'#8a9ab0' };

    const { data: allPayments } = await db.from('expenses')
      .select('amount, wage_period_start, wage_period_end, exp_date')
      .eq('expense_type', 'wage')
      .eq('wage_staff', firstName)
      .order('wage_period_start', { ascending: true });
    const payments = allPayments || [];

    // ── KETTY: Sunday-based card ──
    if (isKetty) {
      // Count Sundays in the selected month
      const [sY, sM] = _wageStripMonth.split('-').map(Number);
      const sundaysInMonth = [];
      const d = new Date(sY, sM - 1, 1);
      while (d.getMonth() === sM - 1) {
        if (d.getDay() === 0) sundaysInMonth.push(new Date(d).toISOString().split('T')[0]);
        d.setDate(d.getDate() + 1);
      }
      const totalSundays = sundaysInMonth.length;

      // How many Sundays were paid this month
      const sundaysPaid = sundaysInMonth.filter(sun =>
        payments.some(p => p.wage_period_start === sun)
      );
      const paidCount = sundaysPaid.length;
      const unpaidCount = totalSundays - paidCount;
      const paidAmt = sundaysPaid.reduce((sum, sun) => {
        const p = payments.find(p => p.wage_period_start === sun);
        return sum + (p ? parseFloat(p.amount || 0) : 0);
      }, 0);
      const expectedAmt = amount * totalSundays;
      const isPastMonth = monthEnd < today;
      const isOverdue = isPastMonth && unpaidCount > 0;
      if (isOverdue) anyOverdue = true;
      const pct = totalSundays > 0 ? Math.min(100, Math.round((paidCount / totalSundays) * 100)) : 0;
      const barColor = pct >= 100 ? '#1e7e34' : pct >= 50 ? '#d68910' : '#c0392b';

      // Check past months for Ketty overdue Sundays
      const allMonthsAsc = [...allMonths].reverse();
      let kettyOverdue = [];
      for (const mk of allMonthsAsc) {
        const [my, mm] = mk.split('-').map(Number);
        const mStart = `${mk}-01`;
        const mEnd = `${mk}-${String(new Date(my, mm, 0).getDate()).padStart(2,'0')}`;
        if (mEnd >= today) continue;
        if (mStart < startMonth) continue;
        const mSundays = getAllSundaysSince(mStart).filter(sun => sun >= mStart && sun <= mEnd);
        const mPaidSundays = mSundays.filter(sun => payments.some(p => p.wage_period_start === sun));
        const mUnpaid = mSundays.length - mPaidSundays.length;
        const mOwed = mUnpaid * amount;
        if (mOwed > 0.005) {
          kettyOverdue.push({ mk, owed: mOwed, unpaid: mUnpaid, total: mSundays.length });
          anyOverdue = true;
        }
      }

      cards += `
        <div onclick="openStaffWageModal('${firstName}', '${s.name}')" style="cursor:pointer;background:#fff;border:1.5px solid ${isOverdue ? '#f5c0bb' : colors.border};border-radius:8px;padding:10px 13px;min-width:0;transition:box-shadow 0.2s;" onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,0.12)'" onmouseout="this.style.boxShadow=''">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <div style="width:32px;height:32px;border-radius:50%;background:${colors.bg};border:2px solid ${colors.border};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:${colors.text};flex-shrink:0;">${firstName.charAt(0)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;color:#1a2332;">${firstName}</div>
              <div style="font-size:10px;color:${colors.text};font-weight:600;">Sunday Only · $${amount.toFixed(2)}/Sunday</div>
            </div>
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;
              ${pct>=100 ? 'color:#1e7e34;background:#e6f4ea;' : isOverdue ? 'color:#c0392b;background:#fdf0ef;' : 'color:#856404;background:#fff3cd;'}">
              ${pct>=100 ? '✅ All Paid' : isOverdue ? `⚠️ ${unpaidCount} unpaid` : `${unpaidCount} pending`}
            </span>
          </div>
          <div style="font-size:11px;color:#888;margin-bottom:4px;">
            ${totalSundays} Sunday${totalSundays!==1?'s':''} this month &nbsp;·&nbsp;
            <strong style="color:#1e7e34;">${paidCount} paid</strong> &nbsp;·&nbsp;
            <strong style="color:${unpaidCount>0?'#c0392b':'#1e7e34'}">${unpaidCount} unpaid</strong>
          </div>
          <div style="font-size:11px;color:#888;margin-bottom:5px;">
            Paid: <strong style="color:#1e7e34;">$${paidAmt.toFixed(2)}</strong> of $${expectedAmt.toFixed(2)}
          </div>
          <div style="background:#e8e8e8;border-radius:20px;height:6px;overflow:hidden;margin-bottom:3px;">
            <div style="width:${pct}%;background:${barColor};height:100%;border-radius:20px;transition:width 0.4s;"></div>
          </div>
          <div style="font-size:10px;color:#aaa;text-align:right;">${pct}% paid</div>
          ${kettyOverdue.length > 0 ? `
            <div style="margin-top:6px;background:#fdf0ef;border:1px solid #f5c0bb;border-radius:6px;padding:4px 8px;font-size:10px;color:#c0392b;font-weight:700;">
              ⚠️ ${kettyOverdue.length} past month${kettyOverdue.length!==1?'s':''} with unpaid Sundays
            </div>` : ''}
        </div>`;

      if (kettyOverdue.length) {
        overdueAlertHtml += `
          <div style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
              <div style="width:22px;height:22px;border-radius:50%;background:${colors.bg};border:2px solid ${colors.border};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:${colors.text};flex-shrink:0;">${firstName.charAt(0)}</div>
              <span style="font-weight:700;font-size:13px;color:${colors.text};">${firstName}</span>
              <span style="margin-left:auto;font-size:12px;font-weight:700;color:#c0392b;">
                Total overdue: $${kettyOverdue.reduce((s,o)=>s+o.owed,0).toFixed(2)}
              </span>
            </div>
            ${kettyOverdue.map(o => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px 5px 30px;font-size:11.5px;border-bottom:1px solid #fde8e5;">
                <span style="color:#555;">${mn[parseInt(o.mk.split('-')[1])]} ${o.mk.split('-')[0]}</span>
                <span style="display:flex;gap:12px;">
                  <span style="color:#888;">${o.total} Sundays · ${o.unpaid} unpaid</span>
                  <span style="color:#c0392b;font-weight:700;">Owed: $${o.owed.toFixed(2)}</span>
                </span>
              </div>`).join('')}
          </div>`;
      }
      continue; // skip the regular card rendering below
    }

    // ── REGULAR monthly staff card ──
    // Payments overlapping the selected month
    const monthPayments = payments.filter(p => {
      if (!p.wage_period_start) return false;
      const startInMonth = p.wage_period_start >= monthStart && p.wage_period_start <= monthEnd;
      const spanIntoMonth = p.wage_period_start < monthStart && p.wage_period_end && p.wage_period_end >= monthStart;
      return startInMonth || spanIntoMonth;
    });

    const paidThisMonth = monthPayments.reduce((sum,p) => sum + parseFloat(p.amount||0), 0);
    const balance = Math.max(0, amount - paidThisMonth);
    const pct = Math.min(100, Math.round((paidThisMonth / amount) * 100));
    const barColor = pct >= 100 ? '#1e7e34' : pct >= 50 ? '#d68910' : '#c0392b';
    const isFullyPaid = balance <= 0.005;
    const isPastMonth = monthEnd < today;
    const isOverdue = isPastMonth && !isFullyPaid;
    if (isOverdue) anyOverdue = true;

    // Check all past months for overdue balances
    const allMonthsAsc = [...allMonths].reverse();
    let staffOverdue = [];
    for (const mk of allMonthsAsc) {
      const [my, mm] = mk.split('-').map(Number);
      const mStart = `${mk}-01`;
      const mEnd = `${mk}-${String(new Date(my, mm, 0).getDate()).padStart(2,'0')}`;
      if (mEnd >= today) continue;
      if (mStart < startMonth) continue;
      const mPayments = payments.filter(p => {
        if (!p.wage_period_start) return false;
        const startIn = p.wage_period_start >= mStart && p.wage_period_start <= mEnd;
        const spanIn = p.wage_period_start < mStart && p.wage_period_end && p.wage_period_end >= mStart;
        return startIn || spanIn;
      });
      const mPaid = mPayments.reduce((sum,p) => sum + parseFloat(p.amount||0), 0);
      const mOwed = amount - mPaid;
      if (mOwed > 0.005) {
        staffOverdue.push({ mk, mStart, mEnd, paid: mPaid, owed: mOwed });
        anyOverdue = true;
      }
    }

    cards += `
      <div onclick="openStaffWageModal('${firstName}', '${s.name}')" style="cursor:pointer;background:#fff;border:1.5px solid ${isOverdue ? '#f5c0bb' : colors.border};border-radius:8px;padding:10px 13px;min-width:0;transition:box-shadow 0.2s;" onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,0.12)'" onmouseout="this.style.boxShadow=''">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="width:32px;height:32px;border-radius:50%;background:${colors.bg};border:2px solid ${colors.border};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:${colors.text};flex-shrink:0;">${firstName.charAt(0)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;color:#1a2332;">${firstName}</div>
            <div style="font-size:10px;color:${colors.text};font-weight:600;">Monthly · $${amount.toFixed(2)}/month</div>
          </div>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;
            ${isFullyPaid ? 'color:#1e7e34;background:#e6f4ea;' : isOverdue ? 'color:#c0392b;background:#fdf0ef;' : 'color:#856404;background:#fff3cd;'}">
            ${isFullyPaid ? '✅ Paid' : isOverdue ? `⚠️ Overdue $${balance.toFixed(2)}` : `Owed $${balance.toFixed(2)}`}
          </span>
        </div>
        <div style="font-size:11px;color:#888;margin-bottom:5px;">
          Paid: <strong style="color:#1e7e34;">$${paidThisMonth.toFixed(2)}</strong> of $${amount.toFixed(2)}
        </div>
        <div style="background:#e8e8e8;border-radius:20px;height:6px;overflow:hidden;margin-bottom:3px;">
          <div style="width:${pct}%;background:${barColor};height:100%;border-radius:20px;transition:width 0.4s;"></div>
        </div>
        <div style="font-size:10px;color:#aaa;text-align:right;">${pct}% paid</div>
        ${staffOverdue.length > 0 ? `
          <div style="margin-top:6px;background:#fdf0ef;border:1px solid #f5c0bb;border-radius:6px;padding:4px 8px;font-size:10px;color:#c0392b;font-weight:700;">
            ⚠️ ${staffOverdue.length} past month${staffOverdue.length!==1?'s':''} overdue · $${staffOverdue.reduce((s,o)=>s+o.owed,0).toFixed(2)} total
          </div>` : ''}
      </div>`;

    if (staffOverdue.length) {
      overdueAlertHtml += `
        <div style="margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
            <div style="width:22px;height:22px;border-radius:50%;background:${colors.bg};border:2px solid ${colors.border};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:${colors.text};flex-shrink:0;">${firstName.charAt(0)}</div>
            <span style="font-weight:700;font-size:13px;color:${colors.text};">${firstName}</span>
            <span style="margin-left:auto;font-size:12px;font-weight:700;color:#c0392b;">
              Total overdue: $${staffOverdue.reduce((s,o)=>s+o.owed,0).toFixed(2)}
            </span>
          </div>
          ${staffOverdue.map(o => `
            <div onclick="openStaffWageModal('${firstName}', '${s.name}', '${o.mk}')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:5px 8px 5px 30px;font-size:11.5px;border-bottom:1px solid #fde8e5;transition:background 0.15s;" onmouseover="this.style.background='#fde8e5'" onmouseout="this.style.background=''">
              <span style="color:#555;">${mn[parseInt(o.mk.split('-')[1])]} ${o.mk.split('-')[0]}</span>
              <span style="display:flex;gap:12px;align-items:center;">
                <span style="color:#888;">Paid: <strong style="color:#1e7e34;">$${o.paid.toFixed(2)}</strong></span>
                <span style="color:#c0392b;font-weight:700;">Owed: $${o.owed.toFixed(2)}</span>
                <span style="background:#c0392b;color:#fff;border-radius:5px;padding:2px 8px;font-size:10px;font-weight:700;">Pay</span>
              </span>
            </div>`).join('')}
        </div>`;
    }
  }

  const overdueBanner = anyOverdue ? `
    <div style="margin-bottom:12px;background:#fff5f5;border:1.5px solid #f5c0bb;border-radius:10px;overflow:hidden;">
      <div style="background:linear-gradient(90deg,#7b1a1a,#c0392b);padding:9px 14px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">⚠️</span>
        <span style="color:#fff;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Overdue Wage Payments</span>
        <span style="color:rgba(255,255,255,0.7);font-size:11px;margin-left:4px;">— past months with unpaid balances</span>
      </div>
      <div style="padding:12px 14px;">${overdueAlertHtml}</div>
    </div>` : '';

  strip.innerHTML = `
    ${overdueBanner}
    <div style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;">👤 Staff Wage Balances</div>
        ${monthDropdown}
      </div>
      <button onclick="openSalaryConfig()" style="font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;font-family:inherit;font-weight:700;">Edit Setup ⚙️</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:14px;">${cards}</div>`;
  strip.style.display = 'block';
}

// ══════════════════════════════════
// VOICE TO NOTE ENGINE
// ══════════════════════════════════
(function() {
  // ── Feature detection ──
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  let activeRecognition = null;
  let activeBtn = null;
  let activeInterimEl = null;
  let activeTextareaId = null;
  let micPermissionGranted = false;

  // ── Mark buttons as unsupported if API unavailable ──
  function markUnsupported(btnId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.classList.add('unsupported');
    btn.title = 'Voice input not supported in this browser. Please type your notes.';
    btn.onclick = () => showVoiceUnsupportedToast();
  }

  function showVoiceUnsupportedToast() {
    toast('🎙️ Voice input isn\'t supported in this browser. Please type your notes directly.');
  }

  if (!SpeechRecognition) {
    // Defer marking until modals open since buttons may not exist yet
    const observer = new MutationObserver(() => {
      ['voice-btn-notes','voice-btn-incident'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('unsupported')) markUnsupported(id);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.toggleVoice = () => showVoiceUnsupportedToast();
    return;
  }

  // ── Stop any active recording ──
  function stopRecording() {
    if (activeRecognition) {
      try { activeRecognition.stop(); } catch(e) {}
      activeRecognition = null;
    }
    if (activeBtn) {
      activeBtn.classList.remove('recording');
    }
    if (activeInterimEl) {
      activeInterimEl.classList.remove('visible');
      activeInterimEl.textContent = '';
    }
    activeBtn = null;
    activeInterimEl = null;
    activeTextareaId = null;
  }

  // ── Main toggle function ──
  window.toggleVoice = async function(textareaId, btnId, interimId) {
    const btn = document.getElementById(btnId);
    const textarea = document.getElementById(textareaId);
    const interimEl = document.getElementById(interimId);

    if (!btn || !textarea) return;

    // If already recording this field — stop
    if (activeTextareaId === textareaId && activeRecognition) {
      stopRecording();
      toast('🎙️ Recording stopped.');
      return;
    }

    // If recording a different field — stop that first
    if (activeRecognition) stopRecording();

    // ── Request microphone permission explicitly first ──
    if (!micPermissionGranted) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop()); // We only needed the permission check
        micPermissionGranted = true;
      } catch (err) {
        // Permission denied or no mic
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          showMicDeniedPrompt(textareaId);
        } else if (err.name === 'NotFoundError') {
          toast('🎙️ No microphone found. Please type your notes instead.');
        } else {
          toast('🎙️ Microphone unavailable. Please type your notes instead.');
        }
        return;
      }
    }

    // ── Start recognition ──
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    activeRecognition = recognition;
    activeBtn = btn;
    activeInterimEl = interimEl;
    activeTextareaId = textareaId;

    let finalTranscript = textarea.value;
    // Add a space if textarea already has content and doesn't end in space/newline
    if (finalTranscript && !/[\s\n]$/.test(finalTranscript)) {
      finalTranscript += ' ';
    }

    btn.classList.add('recording');
    if (interimEl) {
      interimEl.textContent = 'Listening…';
      interimEl.classList.add('visible');
    }
    toast('🎙️ Recording… Speak now. Click the button again to stop.');

    // ── Punctuation helpers ──
    const SENTENCE_ENDERS = /[.!?]$/;

    // Spoken punctuation words → symbols
    const PUNCT_WORDS = [
      [/\b(full stop|period)\b/gi, '.'],
      [/\bcomma\b/gi, ','],
      [/\bquestion mark\b/gi, '?'],
      [/\bexclamation mark\b/gi, '!'],
      [/\bcolon\b/gi, ':'],
      [/\bsemicolon\b/gi, ';'],
      [/\bnew line\b/gi, '\n'],
      [/\bnew paragraph\b/gi, '\n\n'],
      [/\bdash\b/gi, ' — '],
      [/\bhyphen\b/gi, '-'],
      [/\bopen (bracket|parenthesis)\b/gi, '('],
      [/\bclose (bracket|parenthesis)\b/gi, ')'],
      [/\bopen quote\b/gi, '"'],
      [/\bclose quote\b/gi, '"'],
    ];

    // Patterns that strongly suggest the end of a sentence
    const SENTENCE_END_PHRASES = [
      /\b(therefore|however|moreover|furthermore|additionally|consequently|subsequently|nevertheless|nonetheless|in addition|as a result|in conclusion|to summarize|for example|for instance|in summary|on the other hand|at this time|at this point|following this|after that|prior to this|during this time|upon assessment|upon observation|resident (was|is|appears|stated|reported|complained|denied|refused|agreed|requested|indicated|demonstrated|exhibited|showed|responded|remained|continued|began|started|stopped|refused))\b/i,
      /\b(staff (was|is|did|provided|administered|observed|noted|documented|notified|contacted|assisted|helped|encouraged|reminded|redirected|monitored|checked|assessed|completed|initiated|discontinued))\b/i,
    ];

    function applyPunctuationWords(text) {
      let t = text;
      PUNCT_WORDS.forEach(([rx, sym]) => { t = t.replace(rx, sym); });
      return t;
    }

    function capitalizeSentences(text) {
      // Capitalize first letter after . ! ? \n
      return text.replace(/(^|[.!?\n]\s*)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
    }

    function smartPunctuate(raw) {
      let text = applyPunctuationWords(raw.trim());

      // Already ends with punctuation — just capitalize and return
      if (SENTENCE_ENDERS.test(text)) {
        return capitalizeSentences(text) + ' ';
      }

      // Split into clause-like fragments on natural pauses
      // We look for conjunctions / transition words to insert commas
      text = text.replace(/\s+(and then|but then|so then|and also|but also|or else)\s+/gi, ', $1 ');

      // Insert comma before common conjunctions if no punct precedes them
      text = text.replace(/([^,;:.!?\n])\s+(but|yet|so|for|nor|although|though|whereas|while|unless|until|since|because|if|when|as|that|which|who|whom)\s+/gi, '$1, $2 ');

      // End the sentence with a period
      text = text.replace(/[,;]?\s*$/, '') + '.';

      return capitalizeSentences(text) + ' ';
    }

    function mergeWithExisting(existing, newChunk) {
      const trimmed = existing.trimEnd();
      if (!trimmed) {
        // First entry — just capitalize
        return capitalizeSentences(newChunk);
      }
      // If existing ends with sentence-ending punct, new chunk starts fresh capitalized sentence
      if (SENTENCE_ENDERS.test(trimmed)) {
        return trimmed + ' ' + capitalizeSentences(newChunk);
      }
      // Existing ends with comma or nothing — append lowercase continuation
      const lower = newChunk.charAt(0).toLowerCase() + newChunk.slice(1);
      return trimmed + ' ' + lower;
    }

    
      recognition.onresult = (event) => {
    let interim = '';
    let newFinal = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinal += t;
        } else {
          interim += t;
        }
      }
      if (newFinal) {
        const punctuated = smartPunctuate(newFinal);
        finalTranscript = mergeWithExisting(finalTranscript, punctuated);
        textarea.value = finalTranscript;
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
        // Scroll textarea to bottom so admin sees latest text
        textarea.scrollTop = textarea.scrollHeight;
      }
      if (interimEl) {
        const interimDisplay = interim ? applyPunctuationWords(interim) : '';
        interimEl.textContent = interimDisplay ? '…' + interimDisplay : 'Listening…';
      }
    };

    recognition.onerror = (event) => {
      const errMap = {
        'network':        '🌐 Network error — voice recognition needs internet. Please type your notes.',
        'not-allowed':    '🎙️ Microphone permission denied. Please allow microphone access and try again.',
        'no-speech':      '🎙️ No speech detected. Tap again to try, or type your notes.',
        'audio-capture':  '🎙️ No microphone found. Please type your notes.',
        'service-not-available': '🌐 Voice service unavailable right now. Please type your notes.',
        'aborted':        null, // User stopped intentionally — no toast needed
      };
      stopRecording();
      const msg = errMap[event.error];
      if (msg) {
        toast(msg);
        // For network/service errors, offer the type fallback prompt
        if (event.error === 'network' || event.error === 'service-not-available') {
          setTimeout(() => showTypeFallbackPrompt(textareaId), 1200);
        }
      }
    };

    recognition.onend = () => {
      // Only clean up UI — don't overwrite transcript
      if (activeTextareaId === textareaId) {
        stopRecording();
      }
    };

    try {
      recognition.start();
    } catch(e) {
      stopRecording();
      toast('🎙️ Could not start voice recording. Please type your notes.');
    }
  };

  // ── Mic denied prompt ──
  function showMicDeniedPrompt(textareaId) {
    const existing = document.getElementById('voice-denied-prompt');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'voice-denied-prompt';
    overlay.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);`;
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:32px 28px;max-width:400px;width:90%;box-shadow:0 24px 64px rgba(0,0,0,0.25);text-align:center;">
        <div style="font-size:40px;margin-bottom:12px;">🎙️</div>
        <div style="font-size:16px;font-weight:700;color:#1a2332;margin-bottom:10px;">Microphone Access Denied</div>
        <div style="font-size:13px;color:#4a5568;line-height:1.7;margin-bottom:22px;">
          Voice-to-note needs microphone access to work.<br><br>
          To enable it: click the 🔒 or 🎙️ icon in your browser's address bar → allow microphone → refresh the page.<br><br>
          <strong>For now, you can type your notes directly in the text field.</strong>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button onclick="document.getElementById('voice-denied-prompt').remove();document.getElementById('${textareaId}').focus();"
            style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:10px 22px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">
            ✏️ I'll type instead
          </button>
          <button onclick="document.getElementById('voice-denied-prompt').remove();"
            style="background:var(--surface2);color:var(--text2);border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">
            Dismiss
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ── Network/service fallback prompt ──
  function showTypeFallbackPrompt(textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;
    // Just focus the textarea — the toast already explained the issue
    textarea.focus();
    // Add a soft glow to draw attention to the field
    textarea.style.transition = 'box-shadow 0.3s';
    textarea.style.boxShadow = '0 0 0 3px rgba(184,134,11,0.4)';
    setTimeout(() => { textarea.style.boxShadow = ''; }, 2500);
  }

  // ── Stop recording when modals close ──
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay') || e.target.classList.contains('btn-close')) {
      if (activeRecognition) {
        stopRecording();
      }
    }
  });

  // ── Stop recording on page hide (tab switch etc) ──
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeRecognition) stopRecording();
  });

})();

// ── Back-to-top visibility ──
(function() {
  function handleScroll() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;
    const scrollY = (document.querySelector('.main') || document.documentElement).scrollTop || window.scrollY;
    btn.style.display = scrollY > 400 ? 'flex' : 'none';
    btn.style.opacity = scrollY > 400 ? '1' : '0';
  }
  document.querySelector('.main')?.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('scroll', handleScroll, { passive: true });
})();

// ══════════════════════════════════
// PAYMENT CLASSIFICATION TAGS
// ══════════════════════════════════
function togglePayTag(btn) {
  const isSelected = btn.dataset.selected === 'true';
  btn.dataset.selected = isSelected ? '' : 'true';
  if (btn.dataset.selected === 'true') {
    btn.style.opacity = '1';
    btn.style.transform = 'scale(1.05)';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.18)';
    btn.style.fontWeight = '800';
  } else {
    btn.style.opacity = '0.6';
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = '';
    btn.style.fontWeight = '700';
  }
  const selected = [...document.querySelectorAll('.pay-tag')]
    .filter(b => b.dataset.selected === 'true')
    .map(b => b.dataset.value);
  document.getElementById('pay-classification').value = selected.join(',');
}

// ══════════════════════════════════
// ALERTS & AUTOMATED NOTIFICATIONS
// ══════════════════════════════════

const ALERT_EMAIL = 'hello@harmonylivinghouse.com';
const ALERT_LOG_TABLE = 'alert_log';
const ALERT_THROTTLE_HOURS = 6; // Min hours between same alert type emails

// ── Supabase Edge Function URL ──
const ALERT_EDGE_FN_URL = 'https://gkmvglzjrsneqkrlvohp.supabase.co/functions/v1/send-alert';

function getAlertConfig() {
  try { return JSON.parse(localStorage.getItem('hlh_alert_config')) || {}; } catch { return {}; }
}

function saveAlertConfig() {
  const cfg = {
    email: document.getElementById('alert-email-config')?.value?.trim() || ALERT_EMAIL,
    notesIntervalHours: parseInt(document.getElementById('alert-notes-interval')?.value || '48'),
    vitalsIntervalHours: parseInt(document.getElementById('alert-vitals-interval')?.value || '48'),
  };
  localStorage.setItem('hlh_alert_config', JSON.stringify(cfg));
  toast('✅ Alert configuration saved');
}

// ── Ensure alert_log table exists ──
async function ensureAlertLogTable() {
  // Try to insert a test record — if the table doesn't exist, Supabase returns an error
  // We rely on the user creating this table via Supabase SQL editor (instructions shown in UI)
}

// ── Check if an alert of this type was sent recently (throttle) ──
async function wasAlertSentRecently(alertType) {
  const cutoff = new Date(Date.now() - ALERT_THROTTLE_HOURS * 60 * 60 * 1000).toISOString();

  const { data } = await db.from(ALERT_LOG_TABLE)
    .select('id')
    .eq('alert_type', alertType)
    .gte('sent_at', cutoff)
    .limit(1);

  return data && data.length > 0;
}

// ── Log a sent alert ──
async function logAlert(alertType, subject, body, recipientEmail) {
  await db.from(ALERT_LOG_TABLE).insert({
    id: uid(),
    alert_type: alertType,
    subject,
    body_preview: body.slice(0, 300),
    recipient: recipientEmail || ALERT_EMAIL,
    sent_at: new Date().toISOString(),
    sent_by: currentUser ? currentUser.name : 'System'
  });
}

// ── Send email via Supabase Edge Function ──
async function sendAlertEmail(alertType, subject, htmlBody, forceEmail = false) {
  const cfg = getAlertConfig();
  const recipient = cfg.email || ALERT_EMAIL;

  // Always log alerts in-app
  await logAlert(
    alertType,
    subject,
    htmlBody.replace(/<[^>]+>/g, ''),
    recipient
  );

  await loadAlertLog();

  // If no Edge Function configured, keep alerts in-app only
  if (!ALERT_EDGE_FN_URL && !forceEmail) {
    return { success: true, method: 'in-app-only' };
  }

  try {
    const res = await fetch(ALERT_EDGE_FN_URL, {
      method: 'POST',
      headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY
    },
      body: JSON.stringify({
        to: recipient,
        subject,
        html: htmlBody
      })
    });

    if (!res.ok && forceEmail) {
      throw new Error(`HTTP ${res.status}`);
    } else if (!res.ok) {
      return { success: false, method: 'edge-function-silenced' };
    }

    return {
      success: true,
      method: 'edge-function'
    };

  } catch (err) {
    console.error('Alert email failed:', err);

    return {
      success: false,
      error: err.message
    };
  }
}

function buildAlertEmailHtml(title, intro, items, color) {
  const itemRows = items.map(item => `<tr><td style="padding:10px 16px;border-bottom:1px solid #f0e8d0;font-size:13px;color:#333;line-height:1.6;">${item}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f1eb;font-family:Georgia,serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;padding:30px 0;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
      <tr><td style="background:linear-gradient(135deg,#1a1a1a,${color});padding:28px 32px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:22px;color:#fff;font-weight:bold;">Harmony Living House</div>
        <div style="color:rgba(255,255,255,0.65);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">Adult Family LLC — Alert System</div>
      </td></tr>
      <tr><td style="background:${color};padding:12px 32px;"><div style="color:#fff;font-size:16px;font-weight:bold;">${title}</div></td></tr>
      <tr><td style="padding:20px 32px 10px;font-size:13px;color:#555;line-height:1.7;">${intro}</td></tr>
      <tr><td style="padding:0 32px 10px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8dfc8;border-radius:8px;overflow:hidden;"><tbody>${itemRows}</tbody></table>
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #f0e8d0;background:#faf7f2;">
        <div style="font-size:11px;color:#999;line-height:1.6;">Generated by Harmony Living House Admin Portal · 120 Newaukum Village Dr, Chehalis, WA 98532<br>
        <em>Sent: ${new Date().toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'long',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})} PT</em></div>
      </td></tr>
    </table></td></tr></table></body></html>`;
}

async function checkAppointmentAlerts(sendEmail) {
  const bodyEl = document.getElementById('alert-appt-body');
  const badgeEl = document.getElementById('alert-appt-badge');
  const residents = await getResidents();
  const today = new Date(); today.setHours(0,0,0,0);
  const { data: appts } = await db.from('appointments').select('*').eq('status','upcoming').order('appt_date');
  const upcoming = (appts || []).filter(a => {
    if (!a.appt_date) return false;
    const d = new Date(a.appt_date + 'T00:00:00');
    const daysAway = Math.round((d - today) / 86400000);
    return daysAway >= 0 && daysAway <= 3;
  });
  if (!upcoming.length) {
    if (badgeEl) badgeEl.textContent = '✅ All Clear';
    if (bodyEl) bodyEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:16px;color:#1e7e34;font-size:13px;font-weight:600;"><span style="font-size:22px;">✅</span> No appointments in the next 3 days.</div>`;
    return;
  }
  if (badgeEl) { badgeEl.textContent = `⚠️ ${upcoming.length} upcoming`; badgeEl.style.background = 'rgba(255,80,80,0.3)'; }
  const rows = upcoming.map(a => {
    const res = residents.find(r => r.id === a.resident_id);
    const daysAway = Math.round((new Date(a.appt_date + 'T00:00:00') - today) / 86400000);
    const label = daysAway === 0 ? '🔴 TODAY' : daysAway === 1 ? '🟠 Tomorrow' : `🟡 In ${daysAway} days`;
    return {
      html: `<div style="padding:10px 12px;border-bottom:1px solid var(--border);font-size:13px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;"><strong>${res ? res.name : 'Unknown'}</strong><span style="font-size:11px;font-weight:700;color:${daysAway===0?'#c0392b':daysAway===1?'#d68910':'#856404'};">${label}</span></div><div style="color:var(--text2);">${a.doctor}${a.appt_type ? ' · ' + a.appt_type : ''}</div><div style="color:var(--text3);font-size:12px;">${fmtDate(a.appt_date)}${a.appt_time ? ' at ' + a.appt_time : ''}${a.location ? ' · ' + a.location : ''}</div>${a.reason ? `<div style="color:var(--text3);font-size:12px;">Reason: ${a.reason}</div>` : ''}</div>`,
      emailLine: `<strong>${res ? res.name : 'Unknown'}</strong> — ${a.doctor}${a.appt_type ? ' (' + a.appt_type + ')' : ''} on ${fmtDate(a.appt_date)}${a.appt_time ? ' at ' + a.appt_time : ''} (${label.replace(/[🔴🟠🟡]/g,'').trim()})${a.location ? ' · ' + a.location : ''}`
    };
  });
  if (bodyEl) bodyEl.innerHTML = rows.map(r => r.html).join('');
  if (sendEmail) {
    const alreadySent = await wasAlertSentRecently('appointments');
    if (!alreadySent) {
      const html = buildAlertEmailHtml('📅 Upcoming Doctor Appointments', `There are <strong>${upcoming.length}</strong> appointment${upcoming.length>1?'s':''} coming up in the next 3 days:`, rows.map(r => r.emailLine), '#1a73e8');
      await sendAlertEmail('appointments', `[HLH Alert] ${upcoming.length} Upcoming Appointment${upcoming.length>1?'s':''}`, html);
      toast(`📧 Appointment alert logged (${upcoming.length} upcoming)`);
    }
  }
}

async function checkNotesAlerts(sendEmail) {
  const bodyEl = document.getElementById('alert-notes-body');
  const badgeEl = document.getElementById('alert-notes-badge');
  const cfg = getAlertConfig();
  const intervalHours = cfg.notesIntervalHours || 48;
  const cutoffMs = intervalHours * 60 * 60 * 1000;
  const residents = await getResidents();
  const activeResidents = residents.filter(r => !r.status || r.status === 'active' || r.status === 'hospitalized');
  const allNotes = await getNotes();
  const now = Date.now();
  const overdue = activeResidents.filter(res => {
    const resNotes = allNotes.filter(n => n.resident_id === res.id);
    if (!resNotes.length) return true;
    const latest = Math.max(...resNotes.map(n => new Date(n.note_date + 'T23:59:59').getTime()));
    return (now - latest) > cutoffMs;
  }).map(res => {
    const resNotes = allNotes.filter(n => n.resident_id === res.id);
    const latest = resNotes.length ? new Date(Math.max(...resNotes.map(n => new Date(n.note_date + 'T23:59:59').getTime()))) : null;
    const hoursAgo = latest ? Math.round((now - latest.getTime()) / 3600000) : null;
    return { res, hoursAgo, latest };
  });
  if (!overdue.length) {
    if (badgeEl) badgeEl.textContent = '✅ All Up-to-date';
    if (bodyEl) bodyEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:16px;color:#1e7e34;font-size:13px;font-weight:600;"><span style="font-size:22px;">✅</span> All active residents have recent progress notes.</div>`;
    return;
  }
  if (badgeEl) { badgeEl.textContent = `⚠️ ${overdue.length} overdue`; badgeEl.style.background = 'rgba(255,80,80,0.3)'; }
  if (bodyEl) bodyEl.innerHTML = overdue.map(({ res, hoursAgo, latest }) => `<div style="padding:10px 12px;border-bottom:1px solid var(--border);font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px;"><div><div style="font-weight:700;color:var(--text);">${res.name}</div><div style="color:var(--text3);font-size:12px;">${latest ? `Last note: ${fmtDate(latest.toISOString().split('T')[0])} (${hoursAgo}h ago)` : 'No notes on record'}</div></div><button onclick="currentResidentId='${res.id}';openProfile('${res.id}').then(()=>{switchProfileTab('notes');openAddNote();});" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">+ Add Note</button></div>`).join('');
  if (sendEmail) {
    const alreadySent = await wasAlertSentRecently('progress_notes');
    if (!alreadySent) {
      const html = buildAlertEmailHtml(`📋 Progress Notes Overdue (${intervalHours}h+)`, `The following <strong>${overdue.length}</strong> resident${overdue.length>1?'s have':' has'} not had a progress note in the last <strong>${intervalHours} hours</strong>:`, overdue.map(({ res, hoursAgo, latest }) => `<strong>${res.name}</strong> — ${latest ? `Last note ${hoursAgo} hours ago (${fmtDate(latest.toISOString().split('T')[0])})` : 'No notes on record ever'}`), '#7c3aed');
      await sendAlertEmail('progress_notes', `[HLH Alert] ${overdue.length} Resident${overdue.length>1?'s':''} Need Progress Note Updates`, html);
      toast(`📧 Progress notes alert logged (${overdue.length} overdue)`);
    }
  }
}

async function checkVitalsAlerts(sendEmail) {
  const bodyEl = document.getElementById('alert-vitals-body');
  const badgeEl = document.getElementById('alert-vitals-badge');
  const cfg = getAlertConfig();
  const intervalHours = cfg.vitalsIntervalHours || 48;
  const cutoffMs = intervalHours * 60 * 60 * 1000;
  const residents = await getResidents();
  const activeResidents = residents.filter(r => !r.status || r.status === 'active');
  const now = Date.now();
  const overdueVitals = [];
  for (const res of activeResidents) {
    const { data: vitals } = await db.from('vitals').select('vitals_date').eq('resident_id', res.id).order('vitals_date', { ascending: false }).limit(1);
    const latest = vitals && vitals.length ? new Date(vitals[0].vitals_date + 'T23:59:59') : null;
    const hoursAgo = latest ? Math.round((now - latest.getTime()) / 3600000) : null;
    if (!latest || (now - latest.getTime()) > cutoffMs) overdueVitals.push({ res, hoursAgo, latest });
  }
  if (!overdueVitals.length) {
    if (badgeEl) badgeEl.textContent = '✅ All Up-to-date';
    if (bodyEl) bodyEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:16px;color:#1e7e34;font-size:13px;font-weight:600;"><span style="font-size:22px;">✅</span> All active residents have recent vitals recorded.</div>`;
    return;
  }
  if (badgeEl) { badgeEl.textContent = `⚠️ ${overdueVitals.length} overdue`; badgeEl.style.background = 'rgba(255,80,80,0.3)'; }
  if (bodyEl) bodyEl.innerHTML = overdueVitals.map(({ res, hoursAgo, latest }) => `<div style="padding:10px 12px;border-bottom:1px solid var(--border);font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px;"><div><div style="font-weight:700;color:var(--text);">${res.name}</div><div style="color:var(--text3);font-size:12px;">${latest ? `Last vitals: ${fmtDate(latest.toISOString().split('T')[0])} (${hoursAgo}h ago)` : 'No vitals on record'}</div></div><button onclick="openProfile('${res.id}').then(()=>switchProfileTab('vitals'));" style="background:#c0392b;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">+ Add Vitals</button></div>`).join('');
  if (sendEmail) {
    const alreadySent = await wasAlertSentRecently('vitals');
    if (!alreadySent) {
      const html = buildAlertEmailHtml(`❤️ Vitals Updates Overdue (${intervalHours}h+)`, `The following <strong>${overdueVitals.length}</strong> resident${overdueVitals.length>1?'s have':' has'} not had vitals recorded in the last <strong>${intervalHours} hours</strong>:`, overdueVitals.map(({ res, hoursAgo, latest }) => `<strong>${res.name}</strong> — ${latest ? `Last recorded ${hoursAgo}h ago (${fmtDate(latest.toISOString().split('T')[0])})` : 'No vitals on record'}`), '#c0392b');
      await sendAlertEmail('vitals', `[HLH Alert] ${overdueVitals.length} Resident${overdueVitals.length>1?'s':''} Need Vitals Updates`, html);
      toast(`📧 Vitals alert logged (${overdueVitals.length} overdue)`);
    }
  }
}

async function checkPaymentAlerts(sendEmail) {
  const bodyEl = document.getElementById('alert-exp-body');
  const badgeEl = document.getElementById('alert-exp-badge');
  // Pull salary config live from Supabase so all staff including Vivian are checked
  const { data: payAlertStaff } = await db.from('staff_members')
    .select('name, salary_amount, salary_freq, salary_start_month')
    .eq('is_active', true);
  const cfg2 = {};
  (payAlertStaff || []).forEach(s => {
    if (!s.name || !s.salary_amount || parseFloat(s.salary_amount) <= 0) return;
    const key = s.name.split(' ')[0].toLowerCase();
    cfg2[key] = {
      amount: parseFloat(s.salary_amount),
      freq: s.salary_freq || 'monthly',
      name: s.name,
      start_month: s.salary_start_month || '2026-05-01'
    };
  });
  const currentMK = getCurrentMonthKey();
  const today = new Date().toISOString().split('T')[0];
  const overdueItems = [];
  const bills = await getBills();
  const billRecs = await getBillMonthRecords(currentMK);
  const billRecMap = {};
  billRecs.forEach(r => { billRecMap[r.bill_id] = r; });
  bills.forEach(b => {
    const rec = billRecMap[b.id];
    const amtDue = rec ? parseFloat(rec.amount_due) : parseFloat(b.default_amount || 0);
    const amtPaid = rec ? parseFloat(rec.amount_paid || 0) : 0;
    const dueDate = b.due_day ? new Date(new Date().getFullYear(), new Date().getMonth(), b.due_day).toISOString().split('T')[0] : null;
    const isPastDue = dueDate && today > dueDate;
    if (!rec?.is_fully_paid && isPastDue && amtDue > 0) {
      overdueItems.push({ label: `🏠 ${b.name}`, detail: `$${(amtDue - amtPaid).toFixed(2)} remaining (due ${ordinal(b.due_day)} of month)` });
    }
  });
  const allTrackedStaff = Object.values(cfg2).map(v => v.name);
  for (const staffName of allTrackedStaff) {
    const key = staffName.split(' ')[0].toLowerCase();
    const staffCfg = cfg2[key];
    if (!staffCfg || !staffCfg.amount || staffCfg.freq === 'sunday_only') continue;
    const { data: allPayments } = await db.from('expenses').select('amount, wage_period_start, wage_period_end').eq('expense_type','wage').eq('wage_staff', staffName);
    const payments = allPayments || [];
    const earliest = payments.length ? payments.reduce((min,p) => (!p.wage_period_start || p.wage_period_start > min) ? min : p.wage_period_start, payments[0].wage_period_start) : null;
    // Use the later of: earliest recorded payment, configured start month, or global floor
    const staffFloor = staffCfg?.start_month || '2026-05-01';
    const effectiveEarliest = staffFloor; // always start from configured start month, never before
    generateExpectedPeriods(staffCfg.freq || 'monthly', effectiveEarliest).forEach(period => {
      if (period.fullEnd >= today || period.start < staffFloor) return;
      const paid = payments.filter(p => p.wage_period_start && p.wage_period_end && p.wage_period_start <= period.end && p.wage_period_end >= period.start).reduce((s,p) => s + parseFloat(p.amount||0), 0);
      const owed = staffCfg.amount - paid;
      if (owed > 0.005) overdueItems.push({ label: `👤 ${staffName} Wages`, detail: `$${owed.toFixed(2)} owed for ${fmtDate(period.start)} – ${fmtDate(period.end)}` });
    });
  }
  if (!overdueItems.length) {
    if (badgeEl) badgeEl.textContent = '✅ All Clear';
    if (bodyEl) bodyEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:16px;color:#1e7e34;font-size:13px;font-weight:600;"><span style="font-size:22px;">✅</span> No overdue bills or unpaid wages detected.</div>`;
    return;
  }
  if (badgeEl) { badgeEl.textContent = `⚠️ ${overdueItems.length} overdue`; badgeEl.style.background = 'rgba(255,80,80,0.3)'; }
  if (bodyEl) bodyEl.innerHTML = overdueItems.map(item => `<div style="padding:10px 12px;border-bottom:1px solid var(--border);font-size:13px;"><div style="font-weight:700;color:var(--text);">${item.label}</div><div style="color:#c0392b;font-size:12px;font-weight:600;">${item.detail}</div></div>`).join('');
  if (sendEmail) {
    const alreadySent = await wasAlertSentRecently('overdue_payments');
    if (!alreadySent) {
      const html = buildAlertEmailHtml('💰 Overdue Payments Detected', `The following <strong>${overdueItems.length}</strong> payment${overdueItems.length>1?'s':''} require immediate attention:`, overdueItems.map(i => `<strong>${i.label}</strong> — ${i.detail}`), '#d68910');
      await sendAlertEmail('overdue_payments', `[HLH Alert] ${overdueItems.length} Overdue Payment${overdueItems.length>1?'s':''} Require Attention`, html);
      toast(`📧 Overdue payments alert logged (${overdueItems.length} items)`);
    }
  }
}

async function loadAlertLog() {
  const container = document.getElementById('alert-log-list');
  if (!container) return;
  const { data, error } = await db.from(ALERT_LOG_TABLE).select('*').order('sent_at', { ascending: false }).limit(50);
  if (error) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--danger);font-size:13px;">⚠️ Alert log table not found. Run this SQL in your Supabase SQL editor:<br><br><code style="background:#f4f6f9;padding:10px;display:inline-block;border-radius:6px;font-size:11px;text-align:left;">CREATE TABLE IF NOT EXISTS alert_log (id TEXT PRIMARY KEY, alert_type TEXT, subject TEXT, body_preview TEXT, recipient TEXT, sent_at TIMESTAMPTZ DEFAULT NOW(), sent_by TEXT);</code><br><br><button onclick="loadAlertLog()" class="btn btn-secondary btn-sm" style="margin-top:8px;">Retry</button></div>`;
    return;
  }
  if (!data || !data.length) {
    container.innerHTML = `<div style="text-align:center;color:var(--text3);padding:32px;font-size:13px;">No alerts logged yet. Run a check to populate this log.</div>`;
    return;
  }
  const typeIcons = { appointments:'📅', progress_notes:'📋', vitals:'❤️', overdue_payments:'💰', test:'🧪' };
  const typeColors = { appointments:'#1a73e8', progress_notes:'#7c3aed', vitals:'#c0392b', overdue_payments:'#d68910', test:'#1e7e34' };
  container.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr>
      <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Type</th>
      <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Subject</th>
      <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Recipient</th>
      <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Sent At</th>
      <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">By</th>
    </tr></thead><tbody>
    ${data.map(log => {
      const ic = typeIcons[log.alert_type] || '🔔';
      const col = typeColors[log.alert_type] || '#b8860b';
      const sentAt = new Date(log.sent_at).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      return `<tr><td style="padding:10px 14px;border-bottom:1px solid var(--border);"><span style="background:${col}15;color:${col};border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">${ic} ${(log.alert_type||'').replace(/_/g,' ')}</span></td><td style="padding:10px 14px;border-bottom:1px solid var(--border);color:var(--text);">${log.subject}</td><td style="padding:10px 14px;border-bottom:1px solid var(--border);color:var(--text2);">${log.recipient}</td><td style="padding:10px 14px;border-bottom:1px solid var(--border);color:var(--text3);">${sentAt} PT</td><td style="padding:10px 14px;border-bottom:1px solid var(--border);color:var(--text3);">${log.sent_by||'—'}</td></tr>`;
    }).join('')}
    </tbody></table>`;
}

function openManualAlertModal() {
  const cfg = getAlertConfig();
  document.getElementById('manual-alert-to').value = cfg.email || ALERT_EMAIL;
  document.getElementById('manual-alert-subject').value = '';
  document.getElementById('manual-alert-body').value = '';
  document.getElementById('manual-alert-type').value = 'manual';
  openModal('modal-manual-alert');
}

async function sendManualAlert() {
  const to = document.getElementById('manual-alert-to').value.trim();
  const subject = document.getElementById('manual-alert-subject').value.trim();
  const body = document.getElementById('manual-alert-body').value.trim();
  const alertType = document.getElementById('manual-alert-type').value;
  if (!subject || !body) { toast('Please fill in Subject and Message'); return; }
  const html = buildAlertEmailHtml(
    subject,
    body.replace(/\n/g, '<br>'),
    [],
    '#b8860b'
  );
  toast('Sending…');
  const result = await sendAlertEmail(alertType, subject, html, true);
  closeModal('modal-manual-alert');
  await loadAlertLog();
  toast(result.success ? '✅ Alert sent successfully!' : '⚠️ Logged but email delivery failed — check Edge Function logs');
}

async function sendTestEmail() {
  const cfg = getAlertConfig();
  const recipient = cfg.email || ALERT_EMAIL;
  const html = buildAlertEmailHtml('🧪 Test Alert — System Working', 'This is a test alert from your Harmony Living House Admin Portal. Your alert system is configured correctly.', ['✅ Appointment alerts: <strong>Enabled</strong> — fires for appointments within 3 days','✅ Progress notes: <strong>Enabled</strong> — fires if no note in 48h','✅ Vitals reminders: <strong>Enabled</strong> — fires if vitals not updated in 48h','✅ Overdue payments: <strong>Enabled</strong> — fires when bills or wages are past due'], '#b8860b');
  await logAlert('test', `[HLH Test] Alert System Test — ${new Date().toLocaleTimeString()}`, 'Test alert logged successfully.', recipient);
  await loadAlertLog();
  toast('✅ Test alert logged. Check the Email Log below.');
  if (ALERT_EDGE_FN_URL) {
    const result = await sendAlertEmail('test', '[HLH Test] Alert System Test', html, true);
    toast(result.success ? '📧 Test email sent via Edge Function!' : '⚠️ Email delivery failed — check Edge Function setup.');
  }
}

async function runAllAlertChecks(sendEmails) {
  toast('🔄 Running all alert checks…');
  await Promise.all([
    checkAppointmentAlerts(sendEmails),
    checkNotesAlerts(sendEmails),
    checkVitalsAlerts(sendEmails),
    checkPaymentAlerts(sendEmails),
  ]);
  await loadAlertLog();
  const strip = document.getElementById('alerts-status-strip');
  const txt = document.getElementById('alerts-status-text');
  if (strip && txt) {
    strip.style.display = 'flex';
    txt.textContent = `All checks completed at ${new Date().toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit'})} PT`;
  }
}

async function renderAlertsPage() {
  await runAllAlertChecks(true);
}

// ══════════════════════════════════
// DYNAMIC QUICK CONTACTS
// ══════════════════════════════════

let selectedContactColor = '#1a4a8a:#2563eb';

function selectContactColor(btn) {
  document.querySelectorAll('.nc-color-btn').forEach(b => b.style.border = '2px solid transparent');
  btn.style.border = '3px solid var(--text)';
  selectedContactColor = btn.getAttribute('data-color');
  document.getElementById('nc-color').value = selectedContactColor;
}

function openAddContact() {
  ['nc-name','nc-title','nc-org','nc-phone','nc-fax','nc-email1','nc-email2','nc-address','nc-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  selectedContactColor = '#1a4a8a:#2563eb';
  const colorEl = document.getElementById('nc-color');
  if (colorEl) colorEl.value = selectedContactColor;
  document.querySelectorAll('.nc-color-btn').forEach(b => b.style.border = '2px solid transparent');
  const firstBtn = document.querySelector('.nc-color-btn');
  if (firstBtn) firstBtn.style.border = '3px solid var(--text)';
  openModal('modal-add-contact');
}

async function saveNewContact() {
  const name = document.getElementById('nc-name').value.trim();
  if (!name) { toast('Please enter a contact name'); return; }
  const contact = {
    id: uid(), name,
    title: document.getElementById('nc-title').value.trim(),
    org: document.getElementById('nc-org').value.trim(),
    phone: document.getElementById('nc-phone').value.trim(),
    fax: document.getElementById('nc-fax').value.trim(),
    email1: document.getElementById('nc-email1').value.trim(),
    email2: document.getElementById('nc-email2').value.trim(),
    address: document.getElementById('nc-address').value.trim(),
    notes: document.getElementById('nc-notes').value.trim(),
    color: document.getElementById('nc-color').value || '#1a4a8a:#2563eb',
    created_at: new Date().toISOString(),
    created_by: currentUser ? currentUser.name : ''
  };
  const { error } = await db.from('quick_contacts').insert(contact);
  if (error) { toast('Error saving contact: ' + error.message); return; }
  closeModal('modal-add-contact');
  toast('Contact saved!');
  loadContactsPage();
}

async function deleteQuickContact(id) {
  if (!confirm('Remove this contact?')) return;
  await db.from('quick_contacts').delete().eq('id', id);
  toast('Contact removed');
  loadContactsPage();
}

async function loadContactsPage() {
  // Always get root fresh
  const root = document.getElementById('contacts-root');
  if (!root) {
    console.warn('contacts-root missing, retrying in 100ms');
    setTimeout(loadContactsPage, 100);
    return;
  }

  // Clear and show loading
  root.style.cssText = 'min-height:400px;width:100%;display:block;';
  root.innerHTML = '';

  // Fetch data
  const { data, error } = await db.from('quick_contacts')
    .select('*')
    .order('created_at', { ascending: true });

  // Build HTML using only string concatenation — zero template literals
  var html = '';

  // Page header
  html += '<div style="display:flex;justify-content:space-between;align-items:center;';
  html += 'margin-bottom:24px;flex-wrap:wrap;gap:10px;">';
  html += '<div>';
  html += '<div style="font-size:18px;font-weight:700;color:var(--text);">Quick Contacts</div>';
  html += '<div style="font-size:13px;color:var(--text3);margin-top:3px;">Key contacts for Harmony Living House</div>';
  html += '</div>';
  html += '<button onclick="openAddContact()" style="background:var(--accent);color:#fff;border:none;';
  html += 'border-radius:8px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer;';
  html += 'font-family:inherit;">+ Add Contact</button>';
  html += '</div>';

  // Error state
  if (error) {
    html += '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;';
    html += 'padding:20px;font-size:13px;color:#b91c1c;">';
    html += '<strong>Error loading contacts:</strong> ' + error.message;
    html += '</div>';
    root.innerHTML = html;
    return;
  }

  // Empty state
  if (!data || data.length === 0) {
    html += '<div style="text-align:center;padding:60px 24px;">';
    html += '<div style="font-size:52px;margin-bottom:16px;">📞</div>';
    html += '<div style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:8px;">';
    html += 'No Contacts Yet</div>';
    html += '<div style="font-size:13px;color:var(--text3);margin-bottom:20px;">';
    html += 'Add doctors, case managers and other key contacts.</div>';
    html += '<button onclick="openAddContact()" style="background:var(--accent);color:#fff;';
    html += 'border:none;border-radius:8px;padding:10px 22px;font-size:13px;font-weight:700;';
    html += 'cursor:pointer;font-family:inherit;">+ Add First Contact</button>';
    html += '</div>';
    root.innerHTML = html;
    return;
  }

  // Contacts grid
  html += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px;">';

  for (var i = 0; i < data.length; i++) {
    var c = data[i];
    var colorStr = c.color || '#1a4a8a:#2563eb';
    var colorArr = colorStr.split(':');
    var c1 = colorArr[0] || '#1a4a8a';
    var c2 = colorArr[1] || colorArr[0] || '#2563eb';
    var nameStr = c.name || '';
    var nameWords = nameStr.split(' ');
    var init = '';
    if (nameWords[0]) init += nameWords[0][0];
    if (nameWords[1]) init += nameWords[1][0];
    init = init.toUpperCase();

    // Card
    html += '<div style="background:var(--surface);border:1px solid var(--border);';
    html += 'border-radius:12px;overflow:hidden;box-shadow:var(--shadow);">';

    // Card top bar
    html += '<div style="background:linear-gradient(135deg,' + c1 + ',' + c2 + ');';
    html += 'padding:16px 18px;display:flex;align-items:center;';
    html += 'justify-content:space-between;gap:10px;">';

    // Avatar + name
    html += '<div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;">';
    html += '<div style="width:42px;height:42px;border-radius:50%;';
    html += 'background:rgba(255,255,255,0.25);border:2px solid rgba(255,255,255,0.5);';
    html += 'display:flex;align-items:center;justify-content:center;';
    html += 'font-weight:800;font-size:16px;color:#fff;flex-shrink:0;">' + init + '</div>';
    html += '<div style="min-width:0;">';
    html += '<div style="color:#fff;font-weight:700;font-size:14px;';
    html += 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + c.name + '</div>';
    if (c.title) {
      html += '<div style="color:rgba(255,255,255,0.75);font-size:11.5px;margin-top:2px;">';
      html += c.title + '</div>';
    }
    html += '</div></div>';

    // Delete button
    html += '<button onclick="deleteQuickContact(\'' + c.id + '\')" ';
    html += 'style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid ';
    html += 'rgba(255,255,255,0.35);border-radius:6px;padding:4px 10px;font-size:11px;';
    html += 'font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0;">✕</button>';
    html += '</div>';

    // Card body
    html += '<div style="padding:14px 16px;display:flex;flex-direction:column;gap:7px;">';

    // Info row helper inline
    if (c.org) {
      html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;';
      html += 'background:var(--surface2);border-radius:7px;">';
      html += '<span style="font-size:17px;flex-shrink:0;">🏢</span>';
      html += '<div><div style="font-size:10px;font-weight:700;color:var(--text3);';
      html += 'text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Organization</div>';
      html += '<div style="font-size:13px;font-weight:600;color:var(--text);">' + c.org + '</div>';
      html += '</div></div>';
    }
    if (c.phone) {
      html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;';
      html += 'background:var(--surface2);border-radius:7px;">';
      html += '<span style="font-size:17px;flex-shrink:0;">📱</span>';
      html += '<div><div style="font-size:10px;font-weight:700;color:var(--text3);';
      html += 'text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Phone</div>';
      html += '<a href="tel:' + c.phone.replace(/\D/g, '') + '" style="font-size:13px;';
      html += 'font-weight:600;color:' + c2 + ';text-decoration:none;">' + c.phone + '</a>';
      html += '</div></div>';
    }
    if (c.fax) {
      html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;';
      html += 'background:var(--surface2);border-radius:7px;">';
      html += '<span style="font-size:17px;flex-shrink:0;">📠</span>';
      html += '<div><div style="font-size:10px;font-weight:700;color:var(--text3);';
      html += 'text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Fax</div>';
      html += '<div style="font-size:13px;font-weight:600;color:var(--text);">' + c.fax + '</div>';
      html += '</div></div>';
    }
    if (c.email1) {
      html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;';
      html += 'background:var(--surface2);border-radius:7px;">';
      html += '<span style="font-size:17px;flex-shrink:0;">📧</span>';
      html += '<div><div style="font-size:10px;font-weight:700;color:var(--text3);';
      html += 'text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Email</div>';
      html += '<a href="mailto:' + c.email1 + '" style="font-size:13px;font-weight:600;';
      html += 'color:' + c2 + ';text-decoration:none;word-break:break-all;">' + c.email1 + '</a>';
      html += '</div></div>';
    }
    if (c.email2) {
      html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;';
      html += 'background:var(--surface2);border-radius:7px;">';
      html += '<span style="font-size:17px;flex-shrink:0;">📧</span>';
      html += '<div><div style="font-size:10px;font-weight:700;color:var(--text3);';
      html += 'text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Alt Email</div>';
      html += '<a href="mailto:' + c.email2 + '" style="font-size:13px;font-weight:600;';
      html += 'color:' + c2 + ';text-decoration:none;word-break:break-all;">' + c.email2 + '</a>';
      html += '</div></div>';
    }
    if (c.address) {
      html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;';
      html += 'background:var(--surface2);border-radius:7px;">';
      html += '<span style="font-size:17px;flex-shrink:0;">📍</span>';
      html += '<div><div style="font-size:10px;font-weight:700;color:var(--text3);';
      html += 'text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Address</div>';
      html += '<div style="font-size:13px;font-weight:600;color:var(--text);">' + c.address + '</div>';
      html += '</div></div>';
    }
    if (c.notes) {
      html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;';
      html += 'background:#fffdf5;border:1px solid #f0e8c8;border-radius:7px;">';
      html += '<span style="font-size:17px;flex-shrink:0;">💬</span>';
      html += '<div style="font-size:12px;font-style:italic;color:#6b5a2a;line-height:1.6;">';
      html += c.notes + '</div></div>';
    }

    html += '</div>';  // end card body
    html += '</div>';  // end card
  }

  html += '</div>';  // end grid

  root.innerHTML = html;
}

async function renderDynamicContacts() {
  loadContactsPage();
}

// ══════════════════════════════════
// INIT
// ══════════════════════════════════
checkSession();

async function exportCredentialsPDF() {
  const html = buildCredentialsHTML();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'letter' });
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:816px;background:#fff;font-family:Times New Roman,serif;font-size:12px;';
  container.innerHTML = html;
  document.body.appendChild(container);
  const name = (document.getElementById('cred-staff-name').value || 'Staff').replace(/\s+/g,'_');
  doc.html(container, {
    callback: (d) => { document.body.removeChild(container); d.save(`CredentialsChecklist_${name}_${new Date().toISOString().split('T')[0]}.pdf`); setTimeout(() => window.focus(), 300); },
    x:36, y:20, width:540, windowWidth:816
  });
}

const SAVED_DOCS_KEY = 'hlh_saved_staff_docs';

function saveToStaffDocsList(type, data) {
  const existing = getSavedDocs();
  const staffName = type === 'orientation' ? (data.name || 'Unknown') : (data['cred-staff-name'] || 'Unknown');
  const entry = { id: uid(), type, staffName, savedAt: new Date().toISOString(), data };
  existing.unshift(entry);
  localStorage.setItem(SAVED_DOCS_KEY, JSON.stringify(existing.slice(0, 50)));
  renderSavedStaffDocs();
}

function getSavedDocs() {
  try { return JSON.parse(localStorage.getItem(SAVED_DOCS_KEY)) || []; } catch { return []; }
}

function deleteSavedDoc(id) {
  if (!confirm('Delete this saved record?')) return;
  const docs = getSavedDocs().filter(d => d.id !== id);
  localStorage.setItem(SAVED_DOCS_KEY, JSON.stringify(docs));
  renderSavedStaffDocs();
  toast('Record deleted');
}

function loadSavedDoc(id) {
  const doc = getSavedDocs().find(d => d.id === id);
  if (!doc) return;
  if (doc.type === 'orientation') {
    switchStaffDocTab('orientation');
    const d = doc.data;
    document.getElementById('ori-trainee-name').value = d.name || '';
    document.getElementById('ori-hire-date').value = d.hireDate || '';
    document.getElementById('ori-date1').value = d.date1 || '';
    document.getElementById('ori-date2').value = d.date2 || '';
    document.getElementById('ori-date3').value = d.date3 || '';
    document.getElementById('ori-trainer-sig').value = d.trainerSig || '';
    document.getElementById('ori-trainee-sig').value = d.traineeSig || '';
    document.getElementById('ori-hours').value = d.hours || '';
    document.getElementById('ori-last-day').value = d.lastDay || '';
    document.getElementById('ori-notes').value = d.notes || '';
    if (d.checks) {
      d.checks.forEach((v, i) => { const el = document.getElementById('ori-chk-' + i); if (el) el.checked = v; });
    }
    toast('✅ Orientation record loaded into form');
  } else {
    switchStaffDocTab('credentials');
    const d = doc.data;
    Object.entries(d).forEach(([elId, val]) => {
      const el = document.getElementById(elId);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val || '';
    });
    toast('✅ Credentials record loaded into form');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderSavedStaffDocs() {
  let container = document.getElementById('saved-staffdocs-container');
  if (!container) {
    const page = document.getElementById('page-staffdocs');
    if (!page) return;
    container = document.createElement('div');
    container.id = 'saved-staffdocs-container';
    container.style.cssText = 'margin-top:28px;';
    page.appendChild(container);
  }
  const docs = getSavedDocs();
  if (!docs.length) { container.innerHTML = ''; return; }
  const typeLabel = { orientation: '📋 Orientation Checklist', credentials: '🏅 Credentials Checklist' };
  const typeColor = { orientation: '#b8860b', credentials: '#2563eb' };
  container.innerHTML = `
    <div id="saved-docs-list-anchor"></div>
    <div class="card">
      <div class="card-header" style="background:linear-gradient(135deg,#1a1a1a,#333);border-radius:10px 10px 0 0;padding:14px 20px;">
        <div style="color:#fff;font-family:'DM Serif Display',serif;font-size:16px;">💾 Saved Staff Document Records</div>
        <div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:2px;">${docs.length} record${docs.length!==1?'s':''} saved locally on this device</div>
      </div>
      <div class="card-body" style="padding:0;">
        ${docs.map(doc => {
          const savedDate = new Date(doc.savedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
          const color = typeColor[doc.type] || '#b8860b';
          const label = typeLabel[doc.type] || doc.type;
          return `<div style="display:flex;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid var(--border);">
            <div style="width:38px;height:38px;border-radius:10px;background:${color}18;border:1.5px solid ${color}40;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">
              ${doc.type === 'orientation' ? '📋' : '🏅'}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13.5px;color:var(--text);">${doc.staffName}</div>
              <div style="font-size:11.5px;color:${color};font-weight:600;">${label}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:1px;">Saved ${savedDate}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn btn-secondary btn-sm" onclick="loadSavedDoc('${doc.id}')" style="font-size:11px;">↩️ Load into Form</button>
              <button class="btn btn-danger btn-sm" onclick="deleteSavedDoc('${doc.id}')" style="font-size:11px;">Delete</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function viewSavedStaffDocs() {
  renderSavedStaffDocs();
  setTimeout(() => {
    const anchor = document.getElementById('saved-docs-list-anchor');
    if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }, 80);
}

// ══════════════════════════════════
// REGISTER NEW STAFF MEMBER
// ══════════════════════════════════
async function registerNewStaff() {
  const name = document.getElementById('new-staff-name').value.trim();
  const startMonth = document.getElementById('new-staff-start-month').value.trim(); // e.g. "2026-06"
  const amount = parseFloat(document.getElementById('new-staff-amount').value || 0);
  const freq = document.getElementById('new-staff-freq').value || 'monthly';

  if (!name || !startMonth) {
    toast('Please fill in Name and Month Started Working');
    return;
  }

  const startMonthFull = startMonth + '-01'; // e.g. "2026-06-01"

  // 1. Save to Supabase staff_members — this is the single source of truth
  const staffRecord = {
    id: uid(),
    name,
    email: '',
    password_plain: '',
    salary_amount: amount || null,
    salary_freq: freq,
    salary_start_month: startMonthFull,
    is_active: true,
    created_at: new Date().toISOString(),
    created_by: currentUser ? currentUser.name : ''
  };

  const { error: dbError } = await db.from('staff_members').upsert(staffRecord);
  if (dbError) {
    toast('❌ Error saving to database: ' + dbError.message);
    return;
  }

  // 2. Add to in-memory KNOWN_STAFF and STAFF_COLORS so balance tracking works this session
  const firstName = name.split(' ')[0];
  if (!KNOWN_STAFF.includes(firstName)) {
    KNOWN_STAFF.push(firstName);
    STAFF_COLORS[firstName] = { bg:'#f4f6f9', border:'#8a9ab0', text:'#4a5568', dot:'#8a9ab0' };
  }

  // 3. Reload all dynamic staff from Supabase into salary config (replaces localStorage approach)
  await loadDynamicStaffFromSupabase();

  // 4. Add a card for them in the salary config modal
  const salaryGrid = document.querySelector('#modal-salary-config .modal-body > div[style*="flex-direction:column"]');
  if (salaryGrid) {
    const colors = ['#e8f0fe:#1a73e8', '#f3e8fd:#7c3aed', '#fce4ec:#e91e63', '#e6f4ea:#1e7e34', '#fff3cd:#d68910'];
    const pick = colors[Math.floor(Math.random() * colors.length)].split(':');
    const initials = firstName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const key = firstName.toLowerCase();
    const newCard = document.createElement('div');
    newCard.id = `salary-card-${key}`;
    newCard.style.cssText = `padding:16px 18px;border-top:1px solid var(--border);background:${pick[0]}22;`;
    newCard.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="width:38px;height:38px;border-radius:50%;background:${pick[0]};border:2px solid ${pick[1]};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:${pick[1]};flex-shrink:0;">${initials}</div>
        <div style="font-weight:700;font-size:15px;color:#1a2332;">${name}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="field" style="margin:0;">
          <label style="font-size:11px;">Expected Amount Per Period ($)</label>
          <input type="number" id="salary-${key}-amount" value="${amount || ''}" placeholder="e.g. 800.00" step="0.01" min="0">
        </div>
        <div class="field" style="margin:0;">
          <label style="font-size:11px;">Pay Frequency</label>
          <select id="salary-${key}-freq">
            <option value="monthly" ${freq==='monthly'?'selected':''}>Monthly</option>
            <option value="biweekly" ${freq==='biweekly'?'selected':''}>Bi-weekly</option>
            <option value="weekly" ${freq==='weekly'?'selected':''}>Weekly</option>
            <option value="sunday_only" ${freq==='sunday_only'?'selected':''}>Sunday Only</option>
          </select>
        </div>
      </div>`;
    salaryGrid.insertBefore(newCard, salaryGrid.lastElementChild);
  }

  // 5. Clear form + hide it
  ['new-staff-name','new-staff-start-month','new-staff-amount'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('add-staff-form').style.display = 'none';

  toast(`✅ ${name} registered and saved successfully!`);
  renderExpensesPanel();
}

// ── Load all dynamic staff from Supabase into in-memory salary config ──
// Called on login and after registering new staff
async function loadDynamicStaffFromSupabase() {
  const { data: allStaff } = await db.from('staff_members')
    .select('name, salary_amount, salary_freq, salary_start_month')
    .eq('is_active', true);

  if (!allStaff || !allStaff.length) return;

  const knownSeeds = new Set(['penninah nyandia','githaiga njoroge','james','alvan','ketty','joseph']);
  const currentCfg = getSalaryConfig();

  allStaff.forEach(s => {
    if (!s.name || !s.salary_amount) return;
    const nameLower = s.name.toLowerCase();
    const firstName = s.name.split(' ')[0];
    const firstLower = firstName.toLowerCase();

    // Skip the hardcoded four caregivers and login staff
    if (knownSeeds.has(nameLower) || knownSeeds.has(firstLower)) return;

    currentCfg[firstLower] = {
      amount: parseFloat(s.salary_amount),
      freq: s.salary_freq || 'monthly',
      name: s.name,
      start_month: s.salary_start_month || null
    };

    // Always push to KNOWN_STAFF — even if already in config, may be missing from array
    if (!KNOWN_STAFF.includes(firstName)) {
      KNOWN_STAFF.push(firstName);
    }
    // Always set STAFF_COLORS so the card renders correctly
    if (!STAFF_COLORS[firstName]) {
      STAFF_COLORS[firstName] = { bg:'#f4f6f9', border:'#8a9ab0', text:'#4a5568', dot:'#8a9ab0' };
    }
  });

  localStorage.setItem(SALARY_CONFIG_KEY, JSON.stringify(currentCfg));
}

// ══════════════════════════════════
// KETTY SUNDAY MANAGER
// ══════════════════════════════════
async function openKettyManager(staffName) {
  const cfg = getSalaryConfig();
  const key = staffName.toLowerCase();
  const staffCfg = cfg[key];
  const colors = STAFF_COLORS[staffName] || { bg:'#fce4ec', border:'#e91e63', text:'#e91e63' };

  document.getElementById('ketty-manager-title').textContent = `📅 ${staffName} — Sunday Attendance Manager`;

  const allSundays = getAllSundaysSince('2026-05-01');
  const today = new Date().toISOString().split('T')[0];

  const { data: allPayments } = await db.from('expenses')
    .select('amount, wage_period_start, exp_date')
    .eq('expense_type', 'wage')
    .eq('wage_staff', staffName);
  const paidDates = new Set((allPayments || []).map(p => p.wage_period_start).filter(Boolean));
  const payAmounts = {};
  (allPayments || []).forEach(p => { if (p.wage_period_start) payAmounts[p.wage_period_start] = parseFloat(p.amount || 0); });

  const { data: daysOff } = await db.from('staff_days_off')
    .select('id, day_date, reason')
    .eq('staff_name', staffName);
  const daysOffMap = {};
  (daysOff || []).forEach(d => { daysOffMap[d.day_date] = d; });

  const rows = allSundays.map(sunday => {
    const isPaid = paidDates.has(sunday);
    const isOff = !!daysOffMap[sunday];
    const isToday = sunday === today;
    const isFuture = sunday > today;
    const isPending = !isPaid && !isOff && !isFuture;

    let statusHtml = '';
    let actionsHtml = '';

    if (isPaid) {
      const amt = payAmounts[sunday] || staffCfg?.amount || 0;
      statusHtml = `<span style="background:#e6f4ea;color:#1e7e34;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">✅ Paid $${amt.toFixed(2)}</span>`;
      actionsHtml = `<button onclick="removeKettyPayment('${staffName}','${sunday}')" style="background:var(--danger-light);color:var(--danger);border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Undo</button>`;
    } else if (isOff) {
      const reason = daysOffMap[sunday].reason || 'Day off';
      const offId = daysOffMap[sunday].id;
      statusHtml = `<span style="background:#f0f2f5;color:#8a9ab0;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">— ${reason}</span>`;
      actionsHtml = `<button onclick="removeKettyDayOff('${offId}','${sunday}')" style="background:var(--surface2);color:var(--text2);border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Undo</button>`;
    } else if (isFuture) {
      statusHtml = `<span style="background:#f0f2f5;color:#8a9ab0;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">Upcoming</span>`;
      actionsHtml = '';
    } else {
      statusHtml = `<span style="background:#fdf0ef;color:#c0392b;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">⚠️ Unaccounted</span>`;
      actionsHtml = `
        <button onclick="recordKettyPayment('${staffName}','${sunday}',${staffCfg?.amount || 0})" style="background:#e6f4ea;color:#1e7e34;border:1px solid #a8d5b0;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">💰 Record Payment</button>
        <button onclick="markKettyDayOff('${staffName}','${sunday}')" style="background:var(--surface2);color:var(--text2);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">— Did Not Work</button>`;
    }

    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border);${isPending?'background:#fff9f9;':''}${isToday?'background:#fffdf5;border-left:3px solid var(--accent);':''}">
      <div style="font-size:13px;font-weight:${isPending||isToday?'700':'400'};color:${isPending?'#c0392b':isToday?'var(--accent)':'var(--text)'};min-width:120px;">
        ${fmtDate(sunday)}${isToday ? ' <span style="font-size:10px;font-weight:700;color:var(--accent);">(today)</span>' : ''}
      </div>
      <div style="flex:1;">${statusHtml}</div>
      <div style="display:flex;gap:6px;flex-shrink:0;">${actionsHtml}</div>
    </div>`;
  }).reverse().join(''); // Most recent first

  const unpaidCount = allSundays.filter(s => !paidDates.has(s) && !daysOffMap[s] && s <= today && s !== today).length;
  const paidCount = allSundays.filter(s => paidDates.has(s)).length;
  const offCount = allSundays.filter(s => !!daysOffMap[s]).length;

  document.getElementById('ketty-manager-body').innerHTML = `
    <div style="background:linear-gradient(135deg,${colors.bg},#fff);border:1.5px solid ${colors.border};border-radius:10px;padding:14px 18px;margin-bottom:16px;">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:center;">
        <div><div style="font-size:22px;font-weight:800;color:#1e7e34;">${paidCount}</div><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;">Paid Sundays</div></div>
        <div><div style="font-size:22px;font-weight:800;color:#8a9ab0;">${offCount}</div><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;">Days Off</div></div>
        <div><div style="font-size:22px;font-weight:800;color:${unpaidCount>0?'#c0392b':'#1e7e34'};">${unpaidCount}</div><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;">Unaccounted</div></div>
      </div>
    </div>
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;max-height:55vh;overflow-y:auto;">
      ${rows}
    </div>`;

  openModal('modal-ketty-manager');
}

async function recordKettyPayment(staffName, sunday, amount) {
  const cfg = getSalaryConfig();
  const key = staffName.toLowerCase();
  const staffCfg = cfg[key];
  const payAmt = staffCfg?.amount || amount;

  const expense = {
    id: uid(),
    expense_type: 'wage',
    exp_date: sunday,
    amount: parseFloat(payAmt).toFixed(2),
    category: 'Staff Wages',
    description: `Wages — ${staffName} (${fmtDate(sunday)})`,
    wage_staff: staffName,
    wage_period_start: sunday,
    wage_period_end: sunday,
    wage_hours: null,
    wage_rate: null,
    method: 'Cash',
    paid_by: currentUser ? currentUser.name : '',
    receipt_ref: '',
    notes: `Sunday payment — ${fmtDate(sunday)}`,
    vendor: null,
    created_at: new Date().toISOString()
  };

  const { error } = await db.from('expenses').upsert(expense);
  if (error) { toast('Error recording payment: ' + error.message); return; }
  toast(`✅ Payment of $${parseFloat(payAmt).toFixed(2)} recorded for ${fmtDate(sunday)}`);
  await openKettyManager(staffName);
  renderExpensesPanel();
}

async function removeKettyPayment(staffName, sunday) {
  if (!confirm(`Remove the payment recorded for ${fmtDate(sunday)}?`)) return;
  const { error } = await db.from('expenses')
    .delete()
    .eq('expense_type', 'wage')
    .eq('wage_staff', staffName)
    .eq('wage_period_start', sunday);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Payment removed');
  await openKettyManager(staffName);
  renderExpensesPanel();
}

async function markKettyDayOff(staffName, sunday) {
  const reason = prompt(`Why did ${staffName} not work on ${fmtDate(sunday)}? (optional — press Enter to skip)`) ?? '';
  const record = {
    id: uid(),
    staff_name: staffName,
    day_date: sunday,
    reason: reason.trim() || 'Did not work',
    marked_by: currentUser ? currentUser.name : '',
    created_at: new Date().toISOString()
  };
  const { error } = await db.from('staff_days_off').upsert(record, { onConflict: 'staff_name,day_date' });
  if (error) { toast('Error: ' + error.message); return; }
  toast(`📅 ${fmtDate(sunday)} marked as day off`);
  await openKettyManager(staffName);
  renderExpensesPanel();
}

async function removeKettyDayOff(id, sunday) {
  if (!confirm(`Remove the "day off" marking for ${fmtDate(sunday)}?`)) return;
  const { error } = await db.from('staff_days_off').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Day off marking removed');
  await openKettyManager(sunday.staffName); // re-open
  // Since we don't have staffName here, reload via strip
  renderExpensesPanel();
  closeModal('modal-ketty-manager');
}  
