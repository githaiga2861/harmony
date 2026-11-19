// ══════════════════════════════════════════════════════════════
// WEBSITE MANAGEMENT — tour requests from harmonylivinghouse.com,
// availability badge and announcement bar.
// Data is protected by a website PIN checked inside the database
// (see website_admin_setup.sql). The PIN is kept only for this browser tab.
// ══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const PIN_KEY = 'hlh_web_pin';
  const STATUS = {
    new:       { label: 'New',       color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
    contacted: { label: 'Contacted', color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
    toured:    { label: 'Toured',    color: '#0f7b3c', bg: '#e6f4ec', border: '#a3d4b8' },
    closed:    { label: 'Closed',    color: '#6b7280', bg: '#f3f4f6', border: '#d1d5db' },
  };
  const SITE = 'https://harmonylivinghouse.com';
  let inquiries = [];
  let settings = {};
  let filter = 'all';
  let search = '';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getPin = () => sessionStorage.getItem(PIN_KEY) || '';
  const me = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || 'Staff';
  const say = m => (typeof toast === 'function' ? toast(m) : alert(m));
  const fmtWA = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const digits = p => String(p || '').replace(/\D/g, '');
  const intlPhone = p => { const d = digits(p); return d.length === 10 ? '1' + d : d; };

  const btnStyle = (kind) => {
    const base = 'border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;text-decoration:none;white-space:nowrap;';
    if (kind === 'primary') return base + 'background:var(--accent);color:#fff;border:none;';
    if (kind === 'danger') return base + 'background:var(--danger-light);color:var(--danger);border:1.5px solid var(--danger-border);';
    return base + 'background:var(--surface2);color:var(--text2);border:1.5px solid var(--border);';
  };
  const card = 'background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:16px;';
  const input = 'width:100%;border:1.5px solid var(--border);border-radius:8px;padding:9px 11px;font-size:13.5px;font-family:inherit;background:var(--surface);color:var(--text);box-sizing:border-box;';
  const label = 'display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-bottom:5px;';

  async function rpc(fn, args) {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(error.message || 'Request failed');
    return data;
  }

  // ── New-request badge on the sidebar ──
  async function refreshBadge() {
    const nav = document.getElementById('nav-website');
    if (!nav || typeof currentUser === 'undefined' || !currentUser) return;
    let n = 0;
    try { n = await rpc('web_new_inquiry_count', {}); } catch (e) { n = 0; }
    let b = nav.querySelector('.web-badge');
    if (!b) { b = document.createElement('span'); b.className = 'web-badge'; b.style.cssText = 'margin-left:auto;background:#b45309;color:#fff;border-radius:999px;font-size:10.5px;font-weight:800;padding:1px 7px;line-height:17px;'; nav.appendChild(b); }
    b.textContent = n; b.style.display = n > 0 ? 'inline-block' : 'none';
    b.title = n + ' new tour request' + (n === 1 ? '' : 's');
  }
  const st = document.createElement('style');
  st.textContent = '@media (max-width:640px){.web-row-edit{grid-template-columns:1fr!important}}';
  document.head.appendChild(st);
  setTimeout(refreshBadge, 2500);
  setInterval(refreshBadge, 5 * 60 * 1000);

  // ── Page entry ──
  window.renderWebsitePage = async function () {
    const root = document.getElementById('website-admin-root');
    if (!root) return;
    if (!getPin() && typeof currentUser !== 'undefined' && currentUser && currentUser.password) {
      // Try the signed-in admin's password first, so the admin isn't asked twice
      try { if (await rpc('web_admin_check', { p_pin: currentUser.password })) sessionStorage.setItem(PIN_KEY, currentUser.password); } catch (e) {}
    }
    if (!getPin()) return renderLocked(root);
    root.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3);">Loading website data…</div>';
    try {
      const ok = await rpc('web_admin_check', { p_pin: getPin() });
      if (!ok) { sessionStorage.removeItem(PIN_KEY); return renderLocked(root, 'That password is no longer correct. Please enter it again.'); }
      const [list, sres] = await Promise.all([
        rpc('web_list_inquiries', { p_pin: getPin() }),
        db.from('website_settings').select('key,value,updated_at,updated_by'),
      ]);
      inquiries = list || [];
      settings = {}; (sres.data || []).forEach(r => { settings[r.key] = r; });
      renderUnlocked(root);
      refreshBadge();
    } catch (e) {
      if (/does not exist|Could not find|schema cache/i.test(e.message)) return renderSetupNeeded(root);
      sessionStorage.removeItem(PIN_KEY);
      renderLocked(root, e.message);
    }
  };

  function header(locked) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px;">
      <div><div style="font-size:16px;font-weight:700;color:var(--text);">Website</div>
      <div style="font-size:13px;color:var(--text3);margin-top:2px;">Tour requests from harmonylivinghouse.com, availability and announcements.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a href="${SITE}" target="_blank" rel="noopener" style="${btnStyle()}">↗ Open website</a>
        ${locked ? '' : `<button onclick="renderWebsitePage()" style="${btnStyle()}">⟳ Refresh</button><button onclick="websiteLock()" style="${btnStyle()}">🔒 Lock</button>`}
      </div></div>`;
  }

  function renderSetupNeeded(root) {
    root.innerHTML = header(true) + `<div style="${card}"><div style="font-weight:700;color:var(--text);margin-bottom:6px;">One-time setup needed</div>
      <div style="font-size:13.5px;color:var(--text2);line-height:1.6;">The website tables are not in the database yet. Run <b>website_admin_setup.sql</b> in the Supabase SQL Editor, then refresh this page.</div></div>`;
  }

  async function renderLocked(root, err) {
    let n = null; try { n = await rpc('web_new_inquiry_count', {}); } catch (e) {
      if (/does not exist|Could not find|schema cache/i.test(e.message)) return renderSetupNeeded(root);
    }
    root.innerHTML = header(true) + `<div style="${card}max-width:460px;">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;">🔒 Enter the admin password</div>
      <div style="font-size:13px;color:var(--text3);margin-bottom:14px;">${n != null ? `<b style="color:var(--accent)">${n}</b> new tour request${n === 1 ? '' : 's'} waiting. ` : ''}Tour requests contain families' contact details, so this section asks for the admin password.</div>
      <form onsubmit="event.preventDefault();websiteUnlock()" style="display:flex;gap:8px;">
        <input id="web-pin" type="password" autocomplete="current-password" placeholder="Admin password" style="${input}">
        <button type="submit" style="${btnStyle('primary')}">Unlock</button>
      </form>
      ${err ? `<div style="margin-top:10px;font-size:12.5px;color:var(--danger);">${esc(err)}</div>` : ''}
    </div>`;
    setTimeout(() => document.getElementById('web-pin')?.focus(), 50);
  }

  window.websiteUnlock = async function () {
    const pin = document.getElementById('web-pin')?.value || '';
    if (!pin) return;
    try {
      const ok = await rpc('web_admin_check', { p_pin: pin });
      if (!ok) return renderLocked(document.getElementById('website-admin-root'), 'Wrong password. After 5 wrong tries this section locks for 30 minutes.');
      sessionStorage.setItem(PIN_KEY, pin);
      renderWebsitePage();
    } catch (e) { renderLocked(document.getElementById('website-admin-root'), e.message); }
  };
  window.websiteLock = function () { sessionStorage.removeItem(PIN_KEY); renderWebsitePage(); };

  function counts() {
    const c = { all: inquiries.length, new: 0, contacted: 0, toured: 0, closed: 0 };
    inquiries.forEach(i => { c[i.status] = (c[i.status] || 0) + 1; });
    return c;
  }

  function renderUnlocked(root) {
    const c = counts();
    const tab = (k, lbl) => `<button onclick="websiteFilter('${k}')" style="${btnStyle(filter === k ? 'primary' : '')}">${lbl} <span style="opacity:.8">${c[k] || 0}</span></button>`;
    root.innerHTML = header(false) + `
      <div style="display:grid;grid-template-columns:minmax(0,1fr);gap:16px;" id="web-grid">
        <div>
          <div style="${card}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
              <div style="font-size:15px;font-weight:700;color:var(--text);">Tour requests</div>
              <input placeholder="Search name, phone, email…" value="${esc(search)}" oninput="websiteSearch(this.value)" style="${input}max-width:260px;">
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">${tab('all', 'All')}${tab('new', 'New')}${tab('contacted', 'Contacted')}${tab('toured', 'Toured')}${tab('closed', 'Closed')}</div>
            <div id="web-list"></div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;align-items:start;">
          ${settingsCard()}
          ${pagesCard()}
        </div>
      </div>`;
    renderList();
  }

  window.websiteFilter = function (k) { filter = k; renderUnlocked(document.getElementById('website-admin-root')); };
  window.websiteSearch = function (q) { search = q; renderList(); };

  function renderList() {
    const box = document.getElementById('web-list'); if (!box) return;
    const q = search.trim().toLowerCase();
    const rows = inquiries.filter(i => (filter === 'all' || i.status === filter) &&
      (!q || [i.name, i.phone, i.email, i.message].some(x => String(x || '').toLowerCase().includes(q))));
    if (!rows.length) {
      box.innerHTML = `<div style="padding:26px;text-align:center;color:var(--text3);font-size:13.5px;border:1.5px dashed var(--border);border-radius:10px;">${inquiries.length ? 'No requests match this view.' : 'No tour requests yet. When someone fills in the form on the Contact page, it will appear here.'}</div>`;
      return;
    }
    box.innerHTML = rows.map(rowHtml).join('');
  }

  function rowHtml(i) {
    const st = STATUS[i.status] || STATUS.new;
    const first = esc(String(i.name || '').split(' ')[0]);
    const info = [
      i.inquiring_for && ['For', i.inquiring_for],
      i.interest && ['Interest', i.interest],
      i.preferred_time && ['Tour time', i.preferred_time],
    ].filter(Boolean).map(([k, v]) => `<span style="font-size:12.5px;color:var(--text2);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:3px 8px;"><b>${k}:</b> ${esc(v)}</span>`).join(' ');
    const contact = [
      i.phone && `<a href="tel:${esc(digits(i.phone))}" style="color:var(--accent);font-weight:600;text-decoration:none;">📞 ${esc(i.phone)}</a>`,
      i.email && `<a href="mailto:${esc(i.email)}" style="color:var(--accent);font-weight:600;text-decoration:none;word-break:break-all;">✉️ ${esc(i.email)}</a>`,
    ].filter(Boolean).join('<span style="color:var(--border-strong);margin:0 8px;">|</span>');
    const opts = Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === i.status ? ' selected' : ''}>${v.label}</option>`).join('');
    return `<div style="border:1px solid var(--border);border-left:4px solid ${st.border};border-radius:10px;padding:14px 16px;margin-bottom:12px;background:var(--surface);" id="inq-${i.id}">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start;">
        <div><div style="font-size:15px;font-weight:700;color:var(--text);">${esc(i.name)}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">Received ${fmtWA(i.created_at)} (WA time)</div></div>
        <span style="font-size:11.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${st.color};background:${st.bg};border:1px solid ${st.border};border-radius:999px;padding:3px 10px;">${st.label}</span>
      </div>
      <div style="margin-top:10px;font-size:13.5px;">${contact || '<span style="color:var(--text3)">No contact details given</span>'}</div>
      ${info ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">${info}</div>` : ''}
      ${i.message ? `<div style="margin-top:10px;font-size:13.5px;color:var(--text);background:var(--surface2);border-radius:8px;padding:10px 12px;white-space:pre-wrap;line-height:1.55;">${esc(i.message)}</div>` : ''}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        ${i.email ? `<button onclick="websiteReply('${i.id}')" style="${btnStyle('primary')}">✉️ Reply by email</button>` : ''}
        ${i.phone ? `<a href="tel:${esc(digits(i.phone))}" style="${btnStyle()}">📞 Call</a>
        <a href="sms:${esc(digits(i.phone))}" style="${btnStyle()}">💬 Text</a>
        <a href="https://wa.me/${esc(intlPhone(i.phone))}?text=${encodeURIComponent('Hi ' + String(i.name || '').split(' ')[0] + ', this is ' + me() + ' from Harmony Living House. Thank you for your tour request!')}" target="_blank" rel="noopener" style="${btnStyle()}">🟢 WhatsApp</a>` : ''}
      </div>
      <div style="margin-top:12px;display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:8px;align-items:end;" class="web-row-edit">
        <div><label style="${label}">Status</label><select id="st-${i.id}" style="${input}">${opts}</select></div>
        <div><label style="${label}">Staff notes</label><input id="nt-${i.id}" value="${esc(i.staff_notes || '')}" placeholder="e.g. Called back, tour booked Sat 2 PM" style="${input}"></div>
        <div style="display:flex;gap:6px;"><button onclick="websiteSave('${i.id}')" style="${btnStyle('primary')}">Save</button><button onclick="websiteDelete('${i.id}')" style="${btnStyle('danger')}" title="Delete">🗑</button></div>
      </div>
      ${i.handled_by ? `<div style="margin-top:8px;font-size:11.5px;color:var(--text3);">Last updated by ${esc(i.handled_by)}${i.handled_at ? ' · ' + fmtWA(i.handled_at) : ''}</div>` : ''}
    </div>`;
  }

  window.websiteReply = async function (id) {
    const i = inquiries.find(x => x.id === id); if (!i || !i.email) return;
    const first = String(i.name || '').split(' ')[0];
    const about = i.interest ? i.interest.toLowerCase() : 'care for your loved one';
    const subject = 'Your tour request – Harmony Living House';
    const body = `Hi ${first},\n\nThank you for reaching out to Harmony Living House about ${about}. We'd love to show you our home and answer any questions.\n\n` +
      (i.preferred_time ? `You mentioned ${i.preferred_time} for a visit. Does that still work for you?\n\n` : 'What day and time would suit you for a tour?\n\n') +
      `Warm regards,\n${me()}\nHarmony Living House Adult Family Home\n120 Newaukum Village Dr, Chehalis, WA 98532\n(951) 446-7774 · hello@harmonylivinghouse.com\n\n` +
      `---\nYour message: ${i.message || '(no message)'}`;
    window.location.href = `mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (i.status === 'new') {
      try { await rpc('web_update_inquiry', { p_pin: getPin(), p_id: id, p_status: 'contacted', p_notes: i.staff_notes || 'Replied by email', p_by: me() });
        i.status = 'contacted'; i.staff_notes = i.staff_notes || 'Replied by email'; i.handled_by = me(); i.handled_at = new Date().toISOString();
        renderUnlocked(document.getElementById('website-admin-root')); refreshBadge(); say('Email opened · marked as Contacted');
      } catch (e) { say('Email opened'); }
    }
  };

  window.websiteSave = async function (id) {
    const i = inquiries.find(x => x.id === id); if (!i) return;
    const status = document.getElementById('st-' + id).value, notes = document.getElementById('nt-' + id).value.trim();
    try {
      const ok = await rpc('web_update_inquiry', { p_pin: getPin(), p_id: id, p_status: status, p_notes: notes || null, p_by: me() });
      if (!ok) return websiteLock();
      Object.assign(i, { status, staff_notes: notes, handled_by: me(), handled_at: new Date().toISOString() });
      renderUnlocked(document.getElementById('website-admin-root')); refreshBadge(); say('Saved');
    } catch (e) { say('Could not save: ' + e.message); }
  };

  window.websiteDelete = async function (id) {
    const i = inquiries.find(x => x.id === id); if (!i) return;
    if (!confirm(`Delete the tour request from ${i.name}? This cannot be undone.`)) return;
    try {
      const ok = await rpc('web_delete_inquiry', { p_pin: getPin(), p_id: id });
      if (!ok) return websiteLock();
      inquiries = inquiries.filter(x => x.id !== id);
      renderUnlocked(document.getElementById('website-admin-root')); refreshBadge(); say('Deleted');
    } catch (e) { say('Could not delete: ' + e.message); }
  };

  // ── Settings ──
  function val(k) { return (settings[k] && settings[k].value) || ''; }
  function settingsCard() {
    const av = val('availability_status') || 'accepting';
    const o = (k, l) => `<option value="${k}"${k === av ? ' selected' : ''}>${l}</option>`;
    const upd = ['availability_status', 'announcement_text'].map(k => settings[k]).filter(s => s && s.updated_by)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    return `<div style="${card}margin:0;">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:12px;">Website status</div>
      <label style="${label}">Availability badge</label>
      <select id="web-av" style="${input}">${o('accepting', '🟢 Now accepting new residents')}${o('limited', '🟡 Limited availability')}${o('waitlist', '🟤 Currently full, waitlist')}${o('hidden', 'Hidden (show nothing)')}</select>
      <label style="${label}margin-top:10px;">Short note (optional)</label>
      <input id="web-av-note" maxlength="80" value="${esc(val('availability_note'))}" placeholder="e.g. 1 private room open" style="${input}">
      <div style="font-size:11.5px;color:var(--text3);margin:6px 0 14px;">Shown on the home page and the contact form.</div>
      <label style="${label}">Announcement bar</label>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text2);margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="web-ann-on"${val('announcement_enabled') === 'true' ? ' checked' : ''}> Show a message across the top of every page</label>
      <input id="web-ann" maxlength="160" value="${esc(val('announcement_text'))}" placeholder="e.g. Open house this Saturday, 1–4 PM. All families welcome!" style="${input}">
      <button onclick="websiteSaveSettings()" style="${btnStyle('primary')}margin-top:14px;">Save website status</button>
      ${upd ? `<div style="font-size:11.5px;color:var(--text3);margin-top:8px;">Last changed by ${esc(upd.updated_by)} · ${fmtWA(upd.updated_at)}</div>` : ''}
    </div>`;
  }

  window.websiteSaveSettings = async function () {
    const pairs = [
      ['availability_status', document.getElementById('web-av').value],
      ['availability_note', document.getElementById('web-av-note').value.trim()],
      ['announcement_enabled', document.getElementById('web-ann-on').checked ? 'true' : 'false'],
      ['announcement_text', document.getElementById('web-ann').value.trim()],
    ];
    if (pairs[2][1] === 'true' && !pairs[3][1]) return say('Type the announcement text first');
    try {
      for (const [k, v] of pairs) {
        const ok = await rpc('web_set_setting', { p_pin: getPin(), p_key: k, p_value: v, p_by: me() });
        if (!ok) return websiteLock();
      }
      say('Website updated. Changes show on the site right away.');
      renderWebsitePage();
    } catch (e) { say('Could not save: ' + e.message); }
  };

  function pagesCard() {
    const pages = [['Home', '/'], ['About', '/about'], ['Services', '/services'], ['How It Works', '/how-it-works'], ['Our Home (gallery)', '/our-home'],
      ['Payment & Admissions', '/payment'], ['Guides & Articles', '/resources'], ['FAQs', '/faqs'], ['Careers', '/careers'], ['Contact & Tours', '/contact']];
    return `<div style="${card}margin:0;">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:10px;">Website pages</div>
      <div style="display:grid;gap:6px;">${pages.map(([l, p]) => `<a href="${SITE}${p}" target="_blank" rel="noopener" style="display:flex;justify-content:space-between;padding:8px 10px;border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--text2);font-size:13px;"><span>${l}</span><span style="color:var(--text3)">↗</span></a>`).join('')}</div>
      <div style="font-size:11.5px;color:var(--text3);margin-top:10px;">To change page text or photos, ask your IT contact to update the website files.</div>
    </div>`;
  }

  function pinCard() {
    return `<div style="${card}margin:0;">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:10px;">Change website PIN</div>
      <label style="${label}">Current PIN</label><input id="web-pin-old" type="password" style="${input}">
      <label style="${label}margin-top:10px;">New PIN (6+ characters)</label><input id="web-pin-new" type="password" style="${input}">
      <button onclick="websiteChangePin()" style="${btnStyle()}margin-top:12px;">Change PIN</button>
    </div>`;
  }

  window.websiteChangePin = async function () {
    const oldP = document.getElementById('web-pin-old').value, newP = document.getElementById('web-pin-new').value;
    if (newP.length < 6) return say('The new PIN must be at least 6 characters');
    try {
      const ok = await rpc('web_change_pin', { p_pin: oldP, p_new_pin: newP });
      if (!ok) return say('Current PIN is wrong');
      sessionStorage.setItem(PIN_KEY, newP); say('PIN changed'); renderWebsitePage();
    } catch (e) { say('Could not change PIN: ' + e.message); }
  };
})();
