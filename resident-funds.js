// ══════════════════════════════════════════════════════════════════
// RESIDENT FUNDS (money held by staff for safekeeping)
// Tables: resident_fund_accounts, resident_fund_transactions (resident_funds_setup.sql)
// Ledger rules: entries are never edited or deleted. A mistake is corrected by
// voiding the entry (with a reason) and recording a new one, so the history stays complete.
// WAC 388-76-10560 / 10565: written permission, separate record per resident,
// funds kept apart from the home's money, record available to the resident on request,
// funds over $100 kept in a separate interest-bearing account.
// ══════════════════════════════════════════════════════════════════

function rfEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function rfToday() { return (typeof getWATodayStr === 'function') ? getWATodayStr() : new Date().toISOString().slice(0, 10); }
function rfDate(d) { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}` : (d || ''); }
function rfCents(v) { const n = Math.round(parseFloat(v) * 100); return isNaN(n) ? 0 : n; }
function rfMoney(c) { const neg = c < 0; c = Math.abs(c); return (neg ? '−$' : '$') + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function rfUser() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.name) ? currentUser.name : ''; }
function rfLogo() { try { return new URL('harmony_living_house_logo.png', window.location.href).href; } catch (e) { return 'harmony_living_house_logo.png'; } }
function rfQuarterStart(dateStr) { const [y, m] = dateStr.split('-').map(Number); const q = Math.floor((m - 1) / 3) * 3 + 1; return `${y}-${String(q).padStart(2, '0')}-01`; }

let rfCache = { residentId: null, txns: [], account: null, resident: null };

function rfInjectOnce() {
  if (document.getElementById('rf-styles')) return;
  const css = document.createElement('style');
  css.id = 'rf-styles';
  css.textContent = `
  .rf-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 14px; }
  .rf-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; box-shadow: var(--shadow-xs); }
  .rf-card .k { font-size: 11px; font-weight: 700; color: var(--text3); text-transform: uppercase; letter-spacing: 0.06em; }
  .rf-card .v { font-size: 22px; font-weight: 700; color: var(--text); margin-top: 4px; font-variant-numeric: tabular-nums; }
  .rf-card .s { font-size: 11.5px; color: var(--text3); margin-top: 2px; }
  .rf-alert { border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 12.5px; line-height: 1.5; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
  .rf-alert.warn { background: var(--warn-light); border: 1px solid var(--warn-border); color: var(--warn); }
  .rf-alert.info { background: var(--surface2); border: 1px solid var(--border); color: var(--text2); }
  .rf-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .rf-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text3); padding: 9px 12px; border-bottom: 1px solid var(--border); background: var(--surface2); white-space: nowrap; position: static; }
  .rf-table td { padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--text); }
  .rf-table td.num, .rf-table th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rf-in { color: var(--success); font-weight: 700; }
  .rf-out { color: var(--danger); font-weight: 700; }
  .rf-void td { color: var(--text4) !important; text-decoration: line-through; }
  .rf-void td.rf-actions { text-decoration: none; }
  .rf-sub { font-size: 11.5px; color: var(--text3); margin-top: 2px; }
  .rf-actions { white-space: nowrap; text-align: right; }
  .rf-type { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .rf-type label { border: 1.5px solid var(--border); border-radius: 8px; padding: 10px 12px; cursor: pointer; font-size: 13px; display: flex; gap: 8px; align-items: flex-start; }
  .rf-type input { margin-top: 3px; accent-color: var(--accent); }
  .rf-type label:has(input:checked) { border-color: var(--accent); background: var(--accent-light); }
  [data-theme="dark"] .rf-type label:has(input:checked) { background: rgba(184,134,11,0.15); }
  @media (max-width: 760px) { .rf-hide-sm { display: none; } .rf-type { grid-template-columns: 1fr; } }`;
  document.head.appendChild(css);

  const closeSvg = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal-overlay" id="modal-rf-txn">
    <div class="modal">
      <div class="modal-header"><h3>Record Resident Funds Transaction</h3><button class="btn-close" onclick="closeModal('modal-rf-txn')">${closeSvg}</button></div>
      <div class="modal-body">
        <div class="field"><div class="rf-type">
          <label><input type="radio" name="rf-type" value="deposit" checked onchange="rfTypeChanged()"><span><strong>Received for safekeeping</strong><br><span class="rf-sub">Money given to staff to hold</span></span></label>
          <label><input type="radio" name="rf-type" value="withdrawal" onchange="rfTypeChanged()"><span><strong>Given out / spent</strong><br><span class="rf-sub">Returned to the resident or spent for them</span></span></label>
        </div></div>
        <div class="form-grid">
          <div class="field" style="margin:0;"><label>Date *</label><input type="date" id="rf-date"></div>
          <div class="field" style="margin:0;"><label>Time</label><input type="time" id="rf-time"></div>
          <div class="field" style="margin:0;"><label>Amount ($) *</label><input type="number" id="rf-amount" min="0.01" step="0.01" placeholder="0.00"></div>
          <div class="field" style="margin:0;"><label>Form</label><select id="rf-method"><option>Cash</option><option>Check</option><option>Money order</option><option>Gift card</option><option>Other</option></select></div>
          <div class="field span2" style="margin:0;"><label id="rf-party-label">Received from *</label><input type="text" id="rf-party" placeholder="e.g. Resident, Jeanne Wilson (sister)"></div>
          <div class="field span2" style="margin:0;"><label id="rf-purpose-label">Purpose / description *</label><input type="text" id="rf-purpose" placeholder="e.g. Spending money from sister"></div>
          <div class="field" style="margin:0;"><label>Handled by (staff) *</label><input type="text" id="rf-staff"></div>
          <div class="field" style="margin:0;"><label>Witness</label><input type="text" id="rf-witness" placeholder="Second staff member, if present"></div>
          <div class="field span2" style="margin:0;"><label>Receipt / reference no.</label><input type="text" id="rf-ref" placeholder="Store receipt number, check number, etc."></div>
          <div class="field span2" style="margin:0;"><label class="cp-check" style="text-transform:none;letter-spacing:0;font-size:13px;font-weight:500;display:flex;gap:8px;align-items:center;"><input type="checkbox" id="rf-ack" style="width:16px;height:16px;"> Resident or representative signed the paper receipt</label></div>
        </div>
        <div id="rf-balance-hint" class="rf-sub" style="margin-top:12px;"></div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:14px 24px;border-top:1px solid var(--border);">
        <button class="btn btn-secondary" onclick="closeModal('modal-rf-txn')">Cancel</button>
        <button class="btn btn-secondary" onclick="rfSaveTxn(true)">Save &amp; Print Receipt</button>
        <button class="btn btn-primary" onclick="rfSaveTxn(false)">Save</button>
      </div>
    </div>
  </div>
  <div class="modal-overlay" id="modal-rf-account">
    <div class="modal">
      <div class="modal-header"><h3>Funds Account Setup</h3><button class="btn-close" onclick="closeModal('modal-rf-account')">${closeSvg}</button></div>
      <div class="modal-body">
        <p style="font-size:12.5px;color:var(--text2);line-height:1.6;margin-bottom:14px;">Washington rules require the resident's <strong>written permission</strong> before the home manages their money, and the resident must be told in writing where it is kept.</p>
        <div class="form-grid">
          <div class="field" style="margin:0;"><label>Written permission date *</label><input type="date" id="rfa-consent-date"></div>
          <div class="field" style="margin:0;"><label>Signed by</label><input type="text" id="rfa-consent-by" placeholder="Resident or legal representative"></div>
          <div class="field span2" style="margin:0;"><label>Where the money is kept *</label><select id="rfa-location"><option value="">— Select —</option><option>Locked petty cash box (resident's own envelope)</option><option>Separate bank account (interest-bearing)</option><option>Separate bank account (non-interest-bearing)</option><option>Other</option></select></div>
          <div class="field span2" style="margin:0;"><label>Location details</label><input type="text" id="rfa-location-detail" placeholder="e.g. Office safe, envelope labeled with resident's name / bank name and last 4 digits"></div>
          <div class="field span2" style="margin:0;"><label>Notes</label><textarea id="rfa-notes" rows="2"></textarea></div>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:14px 24px;border-top:1px solid var(--border);">
        <button class="btn btn-secondary" onclick="closeModal('modal-rf-account')">Cancel</button>
        <button class="btn btn-primary" onclick="rfSaveAccount()">Save</button>
      </div>
    </div>
  </div>
  <div class="modal-overlay" id="modal-rf-statement">
    <div class="modal">
      <div class="modal-header"><h3>Print Funds Statement</h3><button class="btn-close" onclick="closeModal('modal-rf-statement')">${closeSvg}</button></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field" style="margin:0;"><label>From</label><input type="date" id="rfs-from"></div>
          <div class="field" style="margin:0;"><label>To</label><input type="date" id="rfs-to"></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">
          <button class="btn btn-secondary btn-sm" onclick="rfStatementPreset('month')">This month</button>
          <button class="btn btn-secondary btn-sm" onclick="rfStatementPreset('quarter')">This quarter</button>
          <button class="btn btn-secondary btn-sm" onclick="rfStatementPreset('all')">All time</button>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:14px 24px;border-top:1px solid var(--border);">
        <button class="btn btn-secondary" onclick="closeModal('modal-rf-statement')">Cancel</button>
        <button class="btn btn-primary" onclick="rfPrintStatement()">Print Statement</button>
      </div>
    </div>
  </div>`;
  while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  document.getElementById('rf-amount').addEventListener('input', rfUpdateHint);
}

// ── data ──
async function rfLoad(residentId) {
  const [t, a, r] = await Promise.all([
    db.from('resident_fund_transactions').select('*').eq('resident_id', residentId).order('txn_date', { ascending: true }),
    db.from('resident_fund_accounts').select('*').eq('resident_id', residentId).maybeSingle(),
    db.from('residents').select('id, name, dob, room').eq('id', residentId).maybeSingle()
  ]);
  if (t.error) return { error: t.error };
  const txns = (t.data || []).slice().sort((x, y) => (x.txn_date + (x.txn_time || '') + x.created_at).localeCompare(y.txn_date + (y.txn_time || '') + y.created_at));
  let bal = 0;
  txns.forEach(x => {
    const c = rfCents(x.amount);
    if (!x.voided) bal += x.txn_type === 'deposit' ? c : -c;
    x._balance = bal;
  });
  rfCache = { residentId, txns, account: a.data || null, resident: r.data || {} };
  return rfCache;
}
function rfBalance() { const live = rfCache.txns; return live.length ? live[live.length - 1]._balance : 0; }

// ── profile tab ──
async function renderResidentFunds() {
  rfInjectOnce();
  const box = document.getElementById('profile-funds-list');
  if (!box) return;
  const res = await rfLoad(currentResidentId);
  if (res.error) {
    box.innerHTML = `<div class="rf-alert warn">⚠️ Resident funds are not set up in the database yet. Run <strong>resident_funds_setup.sql</strong> in the Supabase SQL Editor.</div>`;
    return;
  }
  const { txns, account } = res;
  const bal = rfBalance();
  const monthKey = rfToday().slice(0, 7);
  const live = txns.filter(x => !x.voided);
  const inMonth = live.filter(x => x.txn_type === 'deposit' && x.txn_date.startsWith(monthKey)).reduce((s, x) => s + rfCents(x.amount), 0);
  const outMonth = live.filter(x => x.txn_type === 'withdrawal' && x.txn_date.startsWith(monthKey)).reduce((s, x) => s + rfCents(x.amount), 0);
  const last = live[live.length - 1];

  let alerts = '';
  if (!account || !account.consent_date) {
    alerts += `<div class="rf-alert warn"><span>⚠️ No written permission on record. The resident (or their representative) must give written permission before staff hold their money.</span><button class="btn btn-secondary btn-sm" onclick="rfOpenAccount()">Record permission</button></div>`;
  }
  if (bal > 10000 && !(account && /interest-bearing\)/.test(account.location || '') && !/non-interest/.test(account.location || ''))) {
    alerts += `<div class="rf-alert warn"><span>⚠️ Balance is over $100. Washington rules require funds over $100 to be kept in a separate interest-bearing account, with the interest credited to the resident.</span><button class="btn btn-secondary btn-sm" onclick="rfOpenAccount()">Update account</button></div>`;
  }
  if (account && account.location) {
    alerts += `<div class="rf-alert info"><span>🔐 Kept in: <strong>${rfEsc(account.location)}</strong>${account.location_detail ? ' — ' + rfEsc(account.location_detail) : ''} · Permission signed ${rfDate(account.consent_date)}${account.consent_by ? ' by ' + rfEsc(account.consent_by) : ''}</span><button class="btn btn-secondary btn-sm" onclick="rfOpenAccount()">Edit</button></div>`;
  }

  const rows = txns.slice().reverse().map(x => {
    const c = rfCents(x.amount);
    const isIn = x.txn_type === 'deposit';
    return `<tr class="${x.voided ? 'rf-void' : ''}">
      <td style="white-space:nowrap;">${rfDate(x.txn_date)}${x.txn_time ? `<div class="rf-sub">${rfEsc(x.txn_time)}</div>` : ''}</td>
      <td>${rfEsc(x.purpose || '')}<div class="rf-sub">${isIn ? 'From' : 'To'}: ${rfEsc(x.party || '—')} · ${rfEsc(x.method || '')}${x.reference ? ' · Ref ' + rfEsc(x.reference) : ''}</div>
        ${x.voided ? `<div class="rf-sub" style="display:inline-block;text-decoration:none;color:var(--danger);">VOIDED by ${rfEsc(x.voided_by || '')} on ${rfDate((x.voided_at || '').slice(0, 10))}: ${rfEsc(x.void_reason || '')}</div>` : ''}</td>
      <td class="rf-hide-sm">${rfEsc(x.handled_by || '')}${x.witness ? `<div class="rf-sub">Witness: ${rfEsc(x.witness)}</div>` : ''}${x.resident_ack ? '<div class="rf-sub">✓ Receipt signed</div>' : ''}</td>
      <td class="num ${isIn ? 'rf-in' : 'rf-out'}">${isIn ? '+' : '−'}${rfMoney(c).replace('$', '$')}</td>
      <td class="num">${x.voided ? '' : rfMoney(x._balance)}</td>
      <td class="rf-actions">${x.voided ? '' : `<button class="btn btn-secondary btn-sm" onclick="rfPrintReceipt('${x.id}')">Receipt</button> <button class="btn btn-danger btn-sm" onclick="rfVoid('${x.id}')">Void</button>`}</td>
    </tr>`;
  }).join('');

  box.innerHTML = `
    <div class="rf-cards">
      <div class="rf-card" style="border-color:var(--accent);"><div class="k">Current balance held</div><div class="v">${rfMoney(bal)}</div><div class="s">${last ? 'Last activity ' + rfDate(last.txn_date) : 'No activity yet'}</div></div>
      <div class="rf-card"><div class="k">Received this month</div><div class="v rf-in">${rfMoney(inMonth)}</div></div>
      <div class="rf-card"><div class="k">Given out this month</div><div class="v rf-out">${rfMoney(outMonth)}</div></div>
    </div>
    ${alerts}
    ${txns.length ? `<div class="card"><div class="card-body" style="padding:0;overflow-x:auto;">
      <table class="rf-table"><thead><tr><th>Date</th><th>Details</th><th class="rf-hide-sm">Staff</th><th class="num">Amount</th><th class="num">Balance</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div></div>` : `<div class="empty-state">
      <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
      <h4>No Money Held Yet</h4>
      <p>When the resident or family gives staff money to keep, record it with <strong>Record Transaction</strong>. Every amount in and out is tracked with a running balance.</p>
    </div>`}`;
}

// ── account setup ──
function rfOpenAccount() {
  rfInjectOnce();
  const a = rfCache.account || {};
  document.getElementById('rfa-consent-date').value = a.consent_date || '';
  document.getElementById('rfa-consent-by').value = a.consent_by || (rfCache.resident && rfCache.resident.name) || '';
  document.getElementById('rfa-location').value = a.location || '';
  document.getElementById('rfa-location-detail').value = a.location_detail || '';
  document.getElementById('rfa-notes').value = a.notes || '';
  openModal('modal-rf-account');
}
async function rfSaveAccount() {
  const consent = document.getElementById('rfa-consent-date').value;
  const loc = document.getElementById('rfa-location').value;
  if (!consent || !loc) { toast('Please enter the permission date and where the money is kept'); return; }
  const rec = {
    resident_id: currentResidentId, consent_date: consent,
    consent_by: document.getElementById('rfa-consent-by').value.trim(),
    location: loc, location_detail: document.getElementById('rfa-location-detail').value.trim(),
    notes: document.getElementById('rfa-notes').value.trim(),
    updated_by: rfUser(), updated_at: new Date().toISOString()
  };
  const { error } = await db.from('resident_fund_accounts').upsert(rec);
  if (error) { toast('Error: ' + error.message); return; }
  closeModal('modal-rf-account');
  toast('Funds account saved');
  renderResidentFunds();
}

// ── transactions ──
async function rfOpenTxn() {
  rfInjectOnce();
  if (rfCache.residentId !== currentResidentId) await rfLoad(currentResidentId);
  document.querySelector('input[name="rf-type"][value="deposit"]').checked = true;
  document.getElementById('rf-date').value = rfToday();
  document.getElementById('rf-time').value = new Date().toTimeString().slice(0, 5);
  ['rf-amount', 'rf-party', 'rf-purpose', 'rf-witness', 'rf-ref'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('rf-method').value = 'Cash';
  document.getElementById('rf-staff').value = rfUser();
  document.getElementById('rf-ack').checked = false;
  rfTypeChanged();
  openModal('modal-rf-txn');
}
function rfTypeChanged() {
  const out = document.querySelector('input[name="rf-type"]:checked').value === 'withdrawal';
  document.getElementById('rf-party-label').textContent = out ? 'Given to / paid to *' : 'Received from *';
  document.getElementById('rf-party').placeholder = out ? 'e.g. Resident (cash in hand), Marshalls, hair salon' : 'e.g. Resident, Jeanne Wilson (sister)';
  document.getElementById('rf-purpose').placeholder = out ? 'e.g. Cash for outing, haircut, toiletries' : 'e.g. Spending money from sister';
  rfUpdateHint();
}
function rfUpdateHint() {
  const el = document.getElementById('rf-balance-hint');
  if (!el) return;
  const out = document.querySelector('input[name="rf-type"]:checked').value === 'withdrawal';
  const bal = rfBalance();
  const amt = rfCents(document.getElementById('rf-amount').value);
  const after = out ? bal - amt : bal + amt;
  el.innerHTML = `Balance now: <strong>${rfMoney(bal)}</strong>${amt ? ` → after this entry: <strong style="color:${after < 0 ? 'var(--danger)' : 'var(--text)'};">${rfMoney(after)}</strong>` : ''}`;
}
async function rfSaveTxn(andPrint) {
  const type = document.querySelector('input[name="rf-type"]:checked').value;
  const amt = rfCents(document.getElementById('rf-amount').value);
  const date = document.getElementById('rf-date').value;
  const party = document.getElementById('rf-party').value.trim();
  const purpose = document.getElementById('rf-purpose').value.trim();
  const staff = document.getElementById('rf-staff').value.trim();
  if (!date || amt <= 0 || !party || !purpose || !staff) { toast('Please fill in date, amount, who, purpose and staff'); return; }
  await rfLoad(currentResidentId);
  if (type === 'withdrawal' && amt > rfBalance()) { toast(`Not enough held: balance is ${rfMoney(rfBalance())}`); return; }
  const rec = {
    id: uid(), resident_id: currentResidentId, txn_type: type,
    txn_date: date, txn_time: document.getElementById('rf-time').value || null,
    amount: (amt / 100).toFixed(2), method: document.getElementById('rf-method').value,
    party, purpose, handled_by: staff,
    witness: document.getElementById('rf-witness').value.trim() || null,
    reference: document.getElementById('rf-ref').value.trim() || null,
    resident_ack: document.getElementById('rf-ack').checked,
    receipt_no: 'RF-' + date.replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000),
    created_by: rfUser(), created_at: new Date().toISOString()
  };
  const { error } = await db.from('resident_fund_transactions').insert(rec);
  if (error) { toast('Error saving: ' + error.message); return; }
  closeModal('modal-rf-txn');
  toast(type === 'deposit' ? `✅ ${rfMoney(amt)} received for safekeeping` : `✅ ${rfMoney(amt)} given out`);
  await renderResidentFunds();
  if (andPrint) rfPrintReceipt(rec.id);
}
async function rfVoid(id) {
  const x = rfCache.txns.find(t => t.id === id);
  if (!x) return;
  if (x.txn_type === 'deposit' && rfBalance() - rfCents(x.amount) < 0) { toast('Cannot void: money from this entry has already been given out'); return; }
  const reason = prompt(`Void this ${x.txn_type === 'deposit' ? 'receipt' : 'payout'} of ${rfMoney(rfCents(x.amount))} on ${rfDate(x.txn_date)}?\n\nVoided entries stay on the record, crossed out. Enter the reason:`);
  if (reason === null) return;
  if (!reason.trim()) { toast('A reason is required to void an entry'); return; }
  const { error } = await db.from('resident_fund_transactions').update({ voided: true, void_reason: reason.trim(), voided_by: rfUser(), voided_at: new Date().toISOString() }).eq('id', id);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Entry voided');
  renderResidentFunds();
}

// ── printing ──
const RF_PRINT_CSS = `
  @page { size: letter; margin: 0.6in; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; margin: 0; }
  .head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
  .head img { width: 58px; height: 58px; object-fit: contain; }
  .head h1 { font-size: 13pt; margin: 0; } .head h2 { font-size: 11.5pt; margin: 2px 0 0; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #000; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #d9e2f3; }
  .num { text-align: right; white-space: nowrap; }
  .void td { color: #777; text-decoration: line-through; }
  .kv { margin: 3px 0; } .kv b { display: inline-block; min-width: 150px; }
  .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 28px 40px; margin-top: 34px; }
  .sig div { border-top: 1px solid #000; padding-top: 3px; font-size: 9pt; }
  .conf { font-size: 8pt; color: #555; margin-top: 14px; text-align: center; }`;
function rfOpenPrint(html) {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) { toast('Please allow pop-ups to print'); return; }
  win.document.write(html); win.document.close(); win.focus();
  setTimeout(() => win.print(), 600);
}
function rfHeader(title, sub) {
  return `<div class="head"><img src="${rfLogo()}" alt="" onerror="this.style.display='none'"><div><h1>HARMONY LIVING HOUSE ADULT FAMILY LLC</h1><h2>${title}</h2>${sub ? `<div style="font-size:9.5pt;color:#333;margin-top:2px;">${sub}</div>` : ''}</div></div>`;
}
function rfPrintReceipt(id) {
  const x = rfCache.txns.find(t => t.id === id);
  if (!x) { toast('Entry not found'); return; }
  const r = rfCache.resident || {};
  const isIn = x.txn_type === 'deposit';
  rfOpenPrint(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Funds receipt ${rfEsc(x.receipt_no || '')}</title><style>${RF_PRINT_CSS}</style></head><body>
    ${rfHeader(isIn ? 'Receipt — Resident Funds Received for Safekeeping' : 'Receipt — Resident Funds Given Out', 'Receipt no. ' + rfEsc(x.receipt_no || x.id))}
    <div class="kv"><b>Resident:</b> ${rfEsc(r.name || '')}</div>
    <div class="kv"><b>Date / time:</b> ${rfDate(x.txn_date)} ${rfEsc(x.txn_time || '')}</div>
    <div class="kv"><b>Amount:</b> <strong>${rfMoney(rfCents(x.amount))}</strong> (${rfEsc(x.method || '')})</div>
    <div class="kv"><b>${isIn ? 'Received from' : 'Given / paid to'}:</b> ${rfEsc(x.party || '')}</div>
    <div class="kv"><b>Purpose:</b> ${rfEsc(x.purpose || '')}</div>
    ${x.reference ? `<div class="kv"><b>Reference:</b> ${rfEsc(x.reference)}</div>` : ''}
    <div class="kv"><b>Handled by:</b> ${rfEsc(x.handled_by || '')}${x.witness ? ' &nbsp;·&nbsp; <b style="min-width:0;">Witness:</b> ' + rfEsc(x.witness) : ''}</div>
    <div class="kv"><b>Balance held after:</b> ${rfMoney(x._balance)}</div>
    ${x.voided ? `<p style="color:#c00;font-weight:bold;">VOIDED: ${rfEsc(x.void_reason || '')}</p>` : ''}
    <div class="sig"><div>Resident / representative signature</div><div>Date</div><div>Staff signature — ${rfEsc(x.handled_by || '')}</div><div>Witness signature${x.witness ? ' — ' + rfEsc(x.witness) : ''}</div></div>
    <div class="conf">CONFIDENTIAL — resident financial record. Resident funds are kept separate from the home's funds (WAC 388-76-10560, 10565).</div>
  </body></html>`);
}
function rfOpenStatement() { rfInjectOnce(); rfStatementPreset('quarter'); openModal('modal-rf-statement'); }
function rfStatementPreset(p) {
  const t = rfToday();
  const from = p === 'month' ? t.slice(0, 7) + '-01' : p === 'quarter' ? rfQuarterStart(t) : ((rfCache.txns[0] && rfCache.txns[0].txn_date) || t);
  document.getElementById('rfs-from').value = from;
  document.getElementById('rfs-to').value = t;
}
async function rfPrintStatement() {
  const from = document.getElementById('rfs-from').value, to = document.getElementById('rfs-to').value;
  if (!from || !to || from > to) { toast('Please choose a valid date range'); return; }
  await rfLoad(currentResidentId);
  const { txns, account, resident } = rfCache;
  const before = txns.filter(x => x.txn_date < from && !x.voided);
  const opening = before.length ? before[before.length - 1]._balance : 0;
  const inRange = txns.filter(x => x.txn_date >= from && x.txn_date <= to);
  const live = inRange.filter(x => !x.voided);
  const totIn = live.filter(x => x.txn_type === 'deposit').reduce((s, x) => s + rfCents(x.amount), 0);
  const totOut = live.filter(x => x.txn_type === 'withdrawal').reduce((s, x) => s + rfCents(x.amount), 0);
  const closing = opening + totIn - totOut;
  const rows = inRange.map(x => {
    const isIn = x.txn_type === 'deposit';
    return `<tr class="${x.voided ? 'void' : ''}"><td>${rfDate(x.txn_date)}</td><td>${rfEsc(x.receipt_no || '')}</td><td>${rfEsc(x.purpose || '')}<br><span style="font-size:9pt;">${isIn ? 'From' : 'To'}: ${rfEsc(x.party || '')}${x.voided ? ' — VOIDED: ' + rfEsc(x.void_reason || '') : ''}</span></td><td>${rfEsc(x.handled_by || '')}</td><td class="num">${isIn ? rfMoney(rfCents(x.amount)) : ''}</td><td class="num">${isIn ? '' : rfMoney(rfCents(x.amount))}</td><td class="num">${x.voided ? '' : rfMoney(x._balance)}</td></tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:#555;">No transactions in this period</td></tr>';
  closeModal('modal-rf-statement');
  rfOpenPrint(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Funds statement — ${rfEsc(resident.name || '')}</title><style>${RF_PRINT_CSS}</style></head><body>
    ${rfHeader('Resident Funds Statement', `${rfDate(from)} – ${rfDate(to)}`)}
    <div class="kv"><b>Resident:</b> ${rfEsc(resident.name || '')}</div>
    <div class="kv"><b>Funds kept in:</b> ${rfEsc(account && account.location || 'Not recorded')}${account && account.location_detail ? ' — ' + rfEsc(account.location_detail) : ''}</div>
    <div class="kv"><b>Written permission:</b> ${account && account.consent_date ? rfDate(account.consent_date) + (account.consent_by ? ' — ' + rfEsc(account.consent_by) : '') : 'Not recorded'}</div>
    <table style="margin-top:12px;"><tr><th>Opening balance</th><th>Received</th><th>Given out</th><th>Closing balance</th></tr>
      <tr><td class="num">${rfMoney(opening)}</td><td class="num">${rfMoney(totIn)}</td><td class="num">${rfMoney(totOut)}</td><td class="num"><strong>${rfMoney(closing)}</strong></td></tr></table>
    <table><tr><th>Date</th><th>Receipt</th><th>Details</th><th>Staff</th><th class="num">In</th><th class="num">Out</th><th class="num">Balance</th></tr>${rows}</table>
    <p style="font-size:9.5pt;">I have reviewed this statement of my funds held by Harmony Living House Adult Family LLC.</p>
    <div class="sig"><div>Resident / representative signature</div><div>Date</div><div>Provider signature</div><div>Date</div></div>
    <div class="conf">CONFIDENTIAL — resident financial record. Printed ${rfDate(rfToday())} by ${rfEsc(rfUser())}.</div>
  </body></html>`);
}
