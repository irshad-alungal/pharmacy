// Audit Logs — Pallikkal Pharmacy design.
// Kept from the old page: read-only activity trail (audit_logs) with search, action filter, date range,
// paging, entry details (before / after) and CSV export; sign-in history (login_attempts) — now under
// More → Login history. Entries cannot be edited or deleted. Access: audit.view (Admin, Super Admin);
// sign-in attempts need security.view.
// New (0034): logins and logouts in the same list, module / action type / critical flags, IP address,
// KPIs vs the previous period, activity by module, recent critical actions, user and module filters,
// list / timeline view, print / PDF, user activity report, login history with session length,
// page settings and bell alerts.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly, safeQ } from './ui.js';
import { printHTML } from './invoice.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('audit-logs', 'Audit logs', { layout: 'brand' });
const $ = id => document.getElementById(id);
const role = String(prof?.role || '').toLowerCase();
if (!['super_admin', 'admin'].includes(role)) { $('view').innerHTML = '<p class="notice">Only Admin and Super Admin can view audit logs.</p>'; throw new Error('Audit access denied'); }
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

const TZ = 'Asia/Kolkata';
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const count = n => new Intl.NumberFormat('en-IN').format(num(n));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const when = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, s => s.toUpperCase()) : '—';
const whenS = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, s => s.toUpperCase()) : '—';
const timeOnly = v => new Date(v).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, s => s.toUpperCase());
const dayKey = v => new Date(v).toLocaleDateString('en-CA', { timeZone: TZ });
const dayLabel = k => k === today() ? 'Today' : k === addDays(today(), -1) ? 'Yesterday' : new Date(k + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const label = a => String(a || '').replace(/_/g, ' ');
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  shield: svg('<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>', 1.9),
  layers: svg('<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".55"/>', 1.8),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>', 1.8),
  warn: svg('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h.01"/>', 1.9),
  lock: svg('<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>', 1.9),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 1.9),
  down: svg('<path d="m6 9 6 6 6-6"/>', 2.2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  list: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.5 8h.01M11 8h6M7.5 12h.01M11 12h6M7.5 16h.01M11 16h6"/>', 1.8),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  chart: svg('<path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/>', 2.4),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>', 1.9),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2.2),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>', 1.8),
  users: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.3c2.9.3 5 2.6 5 5.7"/>', 1.8),
  calList: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h2M11 14h6M7 17.5h2M11 17.5h6"/>', 1.8),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  refresh: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 2),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 1.9),
  link: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 2),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  dn: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  // action icons
  created: svg('<path d="M12 3 21 12 12 21 3 12Z"/><path d="M12 8v8M8 12h8"/>', 1.9),
  updated: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 1.9),
  deleted: svg('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>', 1.9),
  login: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 17 5-5-5-5M15 12H3"/>', 1.9),
  logout: svg('<path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3"/><path d="m16 17 5-5-5-5M21 12H9"/>', 1.9),
  exported: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  viewed: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  other: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/>', 1.9)
};
const KIND = { created: ['Created', 'g'], updated: ['Updated', 'b'], deleted: ['Deleted', 'r'], exported: ['Exported', 'b'], login: ['Login', 'p'], logout: ['Logout', 'p'], viewed: ['Viewed', 'n'], other: ['Other', 'n'] };
const chip = k => { const [l, c] = KIND[k] || KIND.other; return `<span class="al-chip ${c}">${I[k] || I.other}<span>${l}</span></span>`; };
const MOD_COL = { Sales: '#16a34a', Inventory: '#1e7be6', Medicines: '#f5b800', Purchase: '#9b6cf2', Settings: '#ec4899', System: '#0e9488', Customer: '#f97316', Returns: '#ef4444', Delivery: '#06b6d4', Expenses: '#84cc16', Finance: '#0f766e', Staff: '#a16207', Documents: '#e879f9', WhatsApp: '#22c55e', Reports: '#64748b', Other: '#c3cad6' };
const MODULES = Object.keys(MOD_COL);
const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 Days'], ['30d', 'Last 30 Days'], ['90d', 'Last 90 Days'], ['month', 'This Month'], ['all', 'All Time'], ['custom', 'Custom range…']];
const KPI = (cls, ic, lbl, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${lbl}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;

let has34 = true, cfg = { default_range: '7d', page_size: 10, alert_critical: true, alert_failed_logins: true };
let range = '7d', from = null, to = null, ov = null, rows = [], total = 0, page = 1, view = 'list', critical = false, canSecurity = false;
const per = () => num(cfg.page_size) || 10;

$('view').innerHTML = `
<div class="pos dl md pur al">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.shield}</span>
      <div><h1>Audit Logs</h1><p>Track and monitor all important activities in the pharmacy system.</p></div></div>
    <div class="pos-head-actions md-head-actions al-head-actions">
      <div class="dl-pop-anchor"><button type="button" class="pos-btn al-btn" id="rangeBtn" aria-expanded="false">${I.cal}<span id="rangeLbl">Last 7 Days</span>${I.down}</button>
        <div class="dl-pop md-menu ds-menu al-menu" id="rangeMenu" hidden>${RANGES.map(([k, l]) => `<button type="button" data-range="${k}">${l}</button>`).join('')}</div></div>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn al-btn" id="exportBtn" aria-expanded="false">${I.download}<span>Export Logs</span></button>
        <div class="dl-pop md-menu ds-menu al-menu" id="exportMenu" hidden>
          <button type="button" data-exp="csv">${I.download}<span>CSV (Excel) — current filters</span></button>
          <button type="button" data-exp="print">${I.print}<span>Print / Save as PDF</span></button>
          <button type="button" data-exp="users">${I.users}<span>User activity report (CSV)</span></button>
          <button type="button" data-exp="logins">${I.calList}<span>Login history (CSV)</span></button>
        </div></div>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn al-btn" id="moreBtn" aria-expanded="false">${I.dots}<span>More</span></button>
        <div class="dl-pop md-menu ds-menu al-menu" id="moreMenu" hidden>
          <button type="button" data-more="critical">${I.warn}<span id="critLbl">Show critical actions only</span></button>
          <button type="button" data-more="logins">${I.calList}<span>Login history</span></button>
          <button type="button" data-more="users">${I.users}<span>User activity report</span></button>
          <button type="button" data-more="settings">${I.gear}<span>Audit log settings</span></button>
          <button type="button" data-more="refresh">${I.refresh}<span>Refresh</span></button>
        </div></div>
    </div>
  </section>

  <section class="dz-kpis md-kpis al-kpis">
    ${KPI('green', I.layers, 'Total Activities', 'kTotal')}
    ${KPI('blue', I.user, 'Active Users', 'kUsers')}
    ${KPI('amber', I.warn, 'Critical Actions', 'kCrit')}
    ${KPI('purple', I.lock, 'Login Events', 'kLogin')}
  </section>
  <div id="msg" class="md-msg" role="status"></div>

  <div class="al-layout">
    <section class="pos-card al-list" id="listCard">
      <div class="dl-card-head al-list-head"><h2><span class="al-h-ic">${I.list}</span>Activity Logs</h2>
        <label class="dl-select al-view"><span>View:</span><select id="fView" aria-label="View"><option value="list">List</option><option value="timeline">Timeline</option></select></label></div>
      <div class="al-tools">
        <label class="dl-search al-q">${I.search}<input id="q" type="search" placeholder="Search by user, action, or details..." autocomplete="off" aria-label="Search activity"></label>
        <label class="dl-select"><select id="fUser" aria-label="User"><option value="">All Users</option></select></label>
        <label class="dl-select"><select id="fModule" aria-label="Module"><option value="">All Modules</option></select></label>
        <label class="dl-select"><select id="fKind" aria-label="Action"><option value="">All Actions</option>${Object.entries(KIND).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <button type="button" class="pos-btn al-clear" id="clear">Clear</button>
      </div>
      <div class="al-chips" id="chips"></div>
      <div class="dl-table-wrap" id="tableWrap"><table class="dl-table al-table"><thead><tr>
        <th class="c-no">#</th><th class="c-at">Date &amp; Time</th><th class="c-user">User</th><th class="c-kind">Action</th><th class="c-mod">Module</th><th class="c-det">Details</th><th class="c-ip">IP Address</th><th class="c-go"></th>
      </tr></thead><tbody id="rows"><tr><td colspan="8" class="dl-empty">Loading activity…</td></tr></tbody></table></div>
      <div class="al-timeline" id="timeline" hidden></div>
      <div class="dl-pager md-pager" id="pagerWrap"><span id="pageInfo"></span><div id="pager" class="al-pager"></div></div>
    </section>
    <div class="al-side">
      <section class="pos-card al-mod">
        <div class="dl-card-head"><h2><span class="al-h-ic">${I.chart}</span>Activity by Module</h2></div>
        <div class="dl-sum sl-paybox al-modbox">
          <div class="dl-donut sl-donut"><svg viewBox="0 0 220 220" id="donut" aria-hidden="true"></svg><div class="dl-donut-c"><strong id="donutTotal">0</strong><span>Total Activities</span></div></div>
          <div class="sl-legend al-legend" id="legend"></div>
        </div>
      </section>
      <section class="pos-card al-crit">
        <div class="dl-card-head"><h2><span class="al-h-ic r">${I.warn}</span>Recent Critical Actions</h2><button type="button" class="dl-link" id="critAll">View All ${I.arrow}</button></div>
        <div class="al-clist" id="critList"><p class="dl-empty">Loading…</p></div>
      </section>
      <section class="pos-card al-quick">
        <div class="dl-card-head"><h2><span class="al-h-ic">${I.bolt}</span>Quick Actions</h2></div>
        <div class="al-qlist" id="quick">
          <button type="button" data-q="export"><span class="al-q-ic">${I.download}</span><b>Export Audit Logs</b>${I.chev}</button>
          <button type="button" data-q="logins"><span class="al-q-ic">${I.calList}</span><b>View Login History</b>${I.chev}</button>
          <button type="button" data-q="users"><span class="al-q-ic">${I.users}</span><b>User Activity Report</b>${I.chev}</button>
          <button type="button" data-q="settings"><span class="al-q-ic">${I.gear}</span><b>Audit Log Settings</b>${I.chev}</button>
        </div>
      </section>
    </div>
  </div>
  <p class="al-foot">Times are India Standard Time. Entries cannot be edited or deleted.</p>
</div>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg al-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const note = (m, bad) => { $('msg').textContent = m; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; };
$('puDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('puDlg')) $('puDlg').close(); });
const dlg = (html, cls = '') => { $('puPanel').innerHTML = html; $('puDlg').className = `pos-dialog dl-dialog md-wide sl-dlg al-dlg ${cls}`; $('puPanel').onclick = null; if (!$('puDlg').open) $('puDlg').showModal(); $('puDlg').scrollTop = 0; };
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }
const missing = e => /audit_|function|schema cache|does not exist|Could not find/i.test(e?.message || '');
function csvDownload(name, data) {
  const qq = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + data.map(r => r.map(qq).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---- popovers
const POPS = [['rangeBtn', 'rangeMenu'], ['exportBtn', 'exportMenu'], ['moreBtn', 'moreMenu']];
function closePops() { for (const [b, p] of POPS) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } }
for (const [b, p] of POPS) $(b).addEventListener('click', e => { e.stopPropagation(); const open = $(p).hidden; closePops(); $(p).hidden = !open; $(b).setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', e => { if (!e.target.closest('.dl-pop')) closePops(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePops(); });

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------
function setRange(k, f = null, t = null) {
  range = k; const d = today();
  if (k === 'today') { from = d; to = d; }
  else if (k === 'yesterday') { from = to = addDays(d, -1); }
  else if (k === '7d') { from = addDays(d, -6); to = d; }
  else if (k === '30d') { from = addDays(d, -29); to = d; }
  else if (k === '90d') { from = addDays(d, -89); to = d; }
  else if (k === 'month') { from = d.slice(0, 8) + '01'; to = d; }
  else if (k === 'all') { from = null; to = null; }
  else { from = f; to = t; }
  const short = v => new Date(v + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  $('rangeLbl').textContent = k === 'custom' ? `${short(from)} – ${short(to)}` : RANGES.find(r => r[0] === k)[1];
  for (const b of document.querySelectorAll('#rangeMenu [data-range]')) b.classList.toggle('on', b.dataset.range === k);
}
$('rangeMenu').addEventListener('click', e => {
  const k = e.target.closest('[data-range]')?.dataset.range; if (!k) return;
  closePops();
  if (k === 'custom') return customRange();
  setRange(k); refresh(1);
});
function customRange() {
  dlg(`<h3 class="rt-dlg-title">${I.cal} Custom range</h3>
    <div class="md-form-grid"><div class="pos-field"><label for="crFrom">From</label><input id="crFrom" type="date" max="${today()}" value="${from || addDays(today(), -6)}"></div>
    <div class="pos-field"><label for="crTo">To</label><input id="crTo" type="date" max="${today()}" value="${to || today()}"></div></div>
    <p class="pos-form-msg" id="crErr"></p>
    <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="crGo">Apply</button></div>`, 'al-small-dlg');
  $('crGo').onclick = () => {
    const f = $('crFrom').value, t = $('crTo').value;
    if (!f || !t || f > t) return ($('crErr').textContent = 'Choose a start date on or before the end date.');
    $('puDlg').close(); setRange('custom', f, t); refresh(1);
  };
}

// ---------------------------------------------------------------------------
// Fallback before 0034: read audit_logs directly (old behaviour) and classify here
// ---------------------------------------------------------------------------
const jsKind = a => a === 'login' ? 'login' : a === 'logout' ? 'logout' : /(exported|downloaded|_export$)/.test(a) ? 'exported' : /(viewed|_view$)/.test(a) ? 'viewed'
  : /(deleted|removed|cancelled|canceled|void|reversed|deactivated|_delete$|_remove$)/.test(a) ? 'deleted'
    : /(created|_create$|added|recorded|finalized|uploaded|submitted|requested|registered|confirmed|posted|_receive$)/.test(a) ? 'created'
      : /(updated|_update$|changed|saved|renamed|edited|corrected|adjusted|_set$|marked|moved|assigned|reset|override|quarantined|released|activated|primary|restored|decided|approved|rejected|reported)/.test(a) ? 'updated' : 'other';
const jsModule = (a, e) => /^(settings|branding|pharmacy_profile|billing_settings|backup|delivery_settings|whatsapp_settings|audit_settings)/.test(a) || ['settings', 'branch'].includes(e) ? 'Settings'
  : /^document|^purchase_document/.test(a) || /(pharmacy_document|purchase_document|document_)/.test(e) ? 'Documents' : e === 'sales_return' || /^sales?_return/.test(a) ? 'Returns'
    : e === 'purchase_return' || /^(purchase|supplier|po_)/.test(a) || /^(purchase_invoice|purchase_order|supplier)/.test(e) ? 'Purchase' : /^(sale_|billing_|invoice)/.test(a) || ['sales_invoice', 'invoice', 'billing_session', 'billing'].includes(e) ? 'Sales'
      : /(batch|stock|physical_count|opening_stock|transfer|inventory)/.test(a + ' ' + e) ? 'Inventory' : /^medicine/.test(a) || /^medicine/.test(e) ? 'Medicines' : /^(customer|credit_limit)/.test(a) || /^customer/.test(e) ? 'Customer'
        : /^delivery/.test(a) ? 'Delivery' : /^expense/.test(a) ? 'Expenses' : /^(account|daily_cash|journal)/.test(a) ? 'Finance' : /^(staff|role)/.test(a) || e === 'staff' ? 'Staff' : /^whatsapp/.test(a) ? 'WhatsApp' : 'Other';
const users = new Map();
async function loadUsers(ids) {
  const need = [...new Set(ids.filter(id => id && !users.has(id)))];
  if (!need.length) return;
  const { data } = await sb.from('profiles').select('id,full_name,staff_id').in('id', need);
  for (const p of data || []) users.set(p.id, p);
}
function legacyQuery(forExport = false) {
  const q = safeQ($('q').value);
  let query = sb.from('audit_logs').select('id,at,user_id,action,entity_type,entity_id,reason,before_data,after_data,ip', { count: forExport ? undefined : 'exact' })
    .eq('branch_id', prof.branch_id).order('at', { ascending: false }).order('id', { ascending: false });
  if (q) query = query.or(`action.ilike.%${q}%,entity_type.ilike.%${q}%,reason.ilike.%${q}%,entity_id.ilike.%${q}%`);
  if ($('fUser').value) query = query.eq('user_id', $('fUser').value);
  if (from) query = query.gte('at', new Date(`${from}T00:00:00+05:30`).toISOString());
  if (to) query = query.lte('at', new Date(`${to}T23:59:59.999+05:30`).toISOString());
  return query;
}
const mapLegacy = r => {
  const u = users.get(r.user_id), d = r.after_data || r.before_data || {};
  const nm = d.invoice_no || d.return_no || d.name || d.file_name || d.title || (r.entity_id && !/^[0-9a-f]{8}-/.test(r.entity_id) ? r.entity_id : '');
  return { ...r, src: 'audit', id: String(r.id), user_name: u?.full_name || (r.user_id ? 'Unknown user' : 'System'), staff_id: u?.staff_id, module: jsModule(r.action, r.entity_type), kind: jsKind(r.action),
    critical: false, details: `${label(r.action).replace(/^./, c => c.toUpperCase())}${nm ? `: ${nm}` : ''}${r.reason ? ` — ${r.reason}` : ''}` };
};

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
const filt = () => ({ p_from: from, p_to: to, p_q: $('q').value.trim() || null, p_user: $('fUser').value || null, p_module: $('fModule').value || null, p_kind: $('fKind').value || null, p_critical: critical });
function noteMissing() { has34 = false; note('Run database migration 0034 (Audit Logs) to see logins, modules, critical actions and IP addresses here. The activity list below comes straight from the audit table.', true); }
async function loadOverview() {
  if (!has34) return;
  try { ov = await rpc('audit_overview', { p_from: from, p_to: to }); canSecurity = !!ov.can_security; }
  catch (e) {
    if (!missing(e)) { note(friendly(e), true); return; }
    noteMissing();
  }
}
let seq = 0;
async function loadList(p = page) {
  page = Math.max(1, p); const mine = ++seq;
  if (has34) {
    try {
      const r = await rpc('audit_list', { ...filt(), p_limit: per(), p_offset: (page - 1) * per() });
      if (mine !== seq) return;
      total = num(r.total); rows = r.rows || [];
      if (!rows.length && total && page > 1) return loadList(Math.ceil(total / per()));
    } catch (e) { $('rows').innerHTML = `<tr><td colspan="8" class="dl-empty">${esc(friendly(e))}</td></tr>`; return; }
  } else {
    const { data, error, count: c } = await legacyQuery().range((page - 1) * per(), page * per() - 1);
    if (mine !== seq) return;
    if (error) { $('rows').innerHTML = `<tr><td colspan="8" class="dl-empty">${esc(friendly(error))}</td></tr>`; return; }
    await loadUsers((data || []).map(r => r.user_id));
    rows = (data || []).map(mapLegacy).filter(r => (!$('fModule').value || r.module === $('fModule').value) && (!$('fKind').value || r.kind === $('fKind').value));
    total = c ?? rows.length;
  }
  render();
}
async function refresh(p = 1) {
  await loadOverview();
  fillFilters(); renderKpis(); drawModules(); renderCritical();
  await loadList(p);
  notify();
}

// ---------------------------------------------------------------------------
// KPIs, filters, module chart, critical list
// ---------------------------------------------------------------------------
const pctTxt = (a, b) => b ? `${(a / b * 100).toFixed(1)}%` : '0%';
function renderKpis() {
  if (!has34 || !ov) {
    $('kTotal').textContent = '—'; $('kTotalNote').textContent = 'Needs migration 0034';
    for (const k of ['kUsers', 'kCrit', 'kLogin']) { $(k).textContent = '—'; $(`${k}Note`).textContent = 'Needs migration 0034'; }
    return;
  }
  $('kTotal').textContent = count(ov.total);
  const prev = ov.previous_total, lbl = range === 'today' ? 'yesterday' : range === 'yesterday' ? 'the day before' : range === 'all' ? '' : `previous ${(Math.round((new Date(ov.to) - new Date(ov.from)) / 86400000) + 1)} days`;
  $('kTotalNote').innerHTML = prev === null || prev === undefined ? '<span class="dz-muted">Since the first entry</span>'
    : !prev ? (ov.total ? `<span class="dz-up">${I.up}New</span> vs. ${lbl}` : `<span class="dz-muted">No activity</span>`)
      : (() => { const p = (ov.total - prev) / prev * 100; return `<span class="${p >= 0 ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.dn}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> vs. ${lbl}`; })();
  $('kUsers').textContent = count(ov.active_users); $('kUsersNote').textContent = 'Users performed actions';
  $('kCrit').textContent = count(ov.critical); $('kCritNote').textContent = `Sensitive changes (${pctTxt(ov.critical, ov.total)})`;
  $('kLogin').textContent = count(ov.login_events);
  $('kLoginNote').innerHTML = `System login &amp; logout activities${num(ov.failed_logins) ? ` · <span class="al-warn">${ov.failed_logins} failed</span>` : ''}`;
}
document.querySelector('.al-kpis').addEventListener('click', e => {
  const k = e.target.closest('[data-kpi]')?.dataset.kpi; if (!k) return;
  if (k === 'kTotal') { critical = false; $('fKind').value = ''; $('fModule').value = ''; }
  else if (k === 'kUsers') return userReport();
  else if (k === 'kCrit') critical = true;
  else return loginHistory();
  syncCrit(); loadList(1); scrollToList();
});
const scrollToList = () => { if (matchMedia('(max-width: 1240px)').matches) $('listCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
function fillFilters() {
  const cu = $('fUser').value, cm = $('fModule').value;
  const us = ov?.all_users || [...users.values()].map(u => ({ id: u.id, name: u.full_name }));
  const cnt = new Map((ov?.users || []).map(u => [u.id, u.count]));
  $('fUser').innerHTML = `<option value="">All Users</option>${us.map(u => `<option value="${esc(u.id)}"${u.id === cu ? ' selected' : ''}>${esc(u.name)}${cnt.has(u.id) ? ` (${cnt.get(u.id)})` : ''}</option>`).join('')}`;
  const present = new Map((ov?.modules || []).map(m => [m.module, m.count]));
  $('fModule').innerHTML = `<option value="">All Modules</option>${MODULES.map(m => `<option value="${m}"${m === cm ? ' selected' : ''}>${m}${present.has(m) ? ` (${present.get(m)})` : ''}</option>`).join('')}`;
}
function drawModules() {
  const d = (ov?.modules || []).filter(m => m.count);
  const top = d.slice(0, 5), rest = d.slice(5).reduce((a, x) => a + num(x.count), 0);
  const parts = top.map(x => ({ l: x.module, v: num(x.count), col: MOD_COL[x.module] || '#c3cad6' }));
  if (rest) parts.push({ l: 'Others', v: rest, col: '#c3cad6' });
  const totalM = parts.reduce((a, p) => a + p.v, 0), C = 2 * Math.PI * 84, gap = parts.length > 1 ? 2 : 0;
  let off = 0;
  $('donut').innerHTML = `<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="30"/>` + parts.map(p => { const len = totalM ? p.v / totalM * C : 0; const o = len > gap ? `<circle cx="110" cy="110" r="84" fill="none" stroke="${p.col}" stroke-width="30" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-off}"><title>${esc(p.l)}: ${p.v}</title></circle>` : ''; off += len; return o; }).join('');
  $('donutTotal').textContent = count(totalM);
  $('legend').innerHTML = parts.map(p => `<button type="button" data-mod="${esc(p.l)}"><i style="background:${p.col}"></i><b>${esc(p.l)}</b><span>${totalM ? (p.v / totalM * 100).toFixed(1) : '0.0'}%</span></button>`).join('') || `<p class="dl-muted">${has34 ? 'No activity in this period.' : 'Needs migration 0034.'}</p>`;
}
$('legend').addEventListener('click', e => { const b = e.target.closest('[data-mod]'); if (!b || b.dataset.mod === 'Others') return; $('fModule').value = $('fModule').value === b.dataset.mod ? '' : b.dataset.mod; loadList(1); scrollToList(); });
function renderCritical() {
  const L = ov?.critical_recent || [];
  $('critList').innerHTML = L.slice(0, matchMedia('(max-width: 560px)').matches ? 3 : 3).map((c, i) => `<button type="button" class="al-crow" data-ci="${i}"><span class="al-c-ic ${(KIND[c.kind] || KIND.other)[1]}">${I[c.kind] || I.other}</span>
      <span class="al-c-b"><b>${esc(c.details)}</b><small>${esc(c.user_name)} • ${esc(when(c.at))}</small></span>${I.chev}</button>`).join('')
    || `<div class="al-ok">${I.shield}<span><b>No critical actions</b><small>${has34 ? 'Nothing sensitive was changed in this period.' : 'Needs migration 0034.'}</small></span></div>`;
}
$('critList').addEventListener('click', e => { const b = e.target.closest('[data-ci]'); if (b) openEntry(ov.critical_recent[+b.dataset.ci]); });
$('critAll').addEventListener('click', () => { critical = true; syncCrit(); loadList(1); $('listCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
function syncCrit() { $('critLbl').textContent = critical ? 'Show all actions' : 'Show critical actions only'; }

// ---------------------------------------------------------------------------
// List / timeline
// ---------------------------------------------------------------------------
function chips() {
  const out = [];
  if (critical) out.push(['crit', 'Critical only']);
  if ($('fUser').value) out.push(['fUser', $('fUser').selectedOptions[0].textContent.replace(/ \(\d+\)$/, '')]);
  if ($('fModule').value) out.push(['fModule', $('fModule').value]);
  if ($('fKind').value) out.push(['fKind', KIND[$('fKind').value][0]]);
  if ($('q').value.trim()) out.push(['q', `“${$('q').value.trim()}”`]);
  $('chips').innerHTML = out.map(([k, l]) => `<button type="button" class="al-fchip" data-clear="${k}">${esc(l)} ${I.xs}</button>`).join('');
}
$('chips').addEventListener('click', e => { const k = e.target.closest('[data-clear]')?.dataset.clear; if (!k) return; if (k === 'crit') { critical = false; syncCrit(); } else $(k).value = ''; loadList(1); });
const rowLine = r => `${esc(r.user_name)} • ${esc(r.module)} • ${esc(when(r.at))}`;
function render() {
  chips();
  const start = (page - 1) * per();
  const empty = total ? '' : `No activity ${range === 'all' ? '' : 'in this period '}matches these filters.`;
  $('rows').innerHTML = rows.map((r, i) => `<tr data-i="${i}" class="${r.critical ? 'al-critrow' : ''}">
      <td class="c-no">${start + i + 1}</td>
      <td class="c-at">${esc(when(r.at))}</td>
      <td class="c-user">${esc(r.user_name)}</td>
      <td class="c-kind">${chip(r.kind)}</td>
      <td class="c-mod">${esc(r.module)}</td>
      <td class="c-det"><span class="al-m-ic ${(KIND[r.kind] || KIND.other)[1]}">${I[r.kind] || I.other}</span><span class="al-det"><b>${esc(r.details)}</b>${r.critical ? '<i class="al-cflag" title="Critical action">Critical</i>' : ''}<small class="al-m-line">${rowLine(r)}</small></span></td>
      <td class="c-ip">${esc(r.ip || '—')}</td>
      <td class="c-go">${I.chev}</td></tr>`).join('') || `<tr><td colspan="8" class="dl-empty">${empty}</td></tr>`;
  // timeline: grouped by day
  let last = '';
  $('timeline').innerHTML = rows.map((r, i) => { const k = dayKey(r.at), head = k !== last ? `<h3 class="al-tl-day">${esc(dayLabel(k))}</h3>` : ''; last = k;
    return `${head}<button type="button" class="al-tl-row" data-i="${i}"><time>${esc(timeOnly(r.at))}</time><span class="al-tl-dot ${(KIND[r.kind] || KIND.other)[1]}">${I[r.kind] || I.other}</span><span class="al-tl-b"><b>${esc(r.details)}</b><small>${esc(r.user_name)} • ${esc(r.module)}${r.ip ? ` • ${esc(r.ip)}` : ''}</small></span>${chip(r.kind)}</button>`; }).join('') || `<p class="dl-empty">${empty}</p>`;
  $('tableWrap').hidden = view === 'timeline'; $('timeline').hidden = view !== 'timeline';
  const pages = Math.max(1, Math.ceil(total / per()));
  $('pageInfo').textContent = total ? `Showing ${start + 1} to ${start + rows.length} of ${count(total)} activities` : '';
  const nums = []; for (let n = 1; n <= pages; n++) if (n <= 5 && page <= 4 || n === 1 || n === pages || Math.abs(n - page) <= 1) nums.push(n); else if (nums[nums.length - 1] !== '…') nums.push('…');
  $('pager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>${nums.map(n => n === '…' ? '<span class="al-gap">…</span>' : `<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">›</button>` : '';
}
$('pager').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) loadList(+b.dataset.page); });
for (const h of [$('rows'), $('timeline')]) h.addEventListener('click', e => { const el = e.target.closest('[data-i]'); if (el) openEntry(rows[+el.dataset.i]); });
for (const id of ['fUser', 'fModule', 'fKind']) $(id).addEventListener('change', () => loadList(1));
let qT; $('q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => loadList(1), 300); });
$('clear').addEventListener('click', () => { for (const id of ['q', 'fUser', 'fModule', 'fKind']) $(id).value = ''; critical = false; syncCrit(); loadList(1); });
$('fView').addEventListener('change', () => { view = $('fView').value; try { localStorage.setItem('pp.audit.view', view); } catch { /* ignore */ } render(); });

// ---------------------------------------------------------------------------
// Entry details (before / after)
// ---------------------------------------------------------------------------
const fmtVal = v => v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const LINK = r => {
  const d = r.after_data || r.before_data || {};
  if (r.module === 'Sales' && d.invoice_no) return ['sales.html?q=' + encodeURIComponent(d.invoice_no), `Open ${d.invoice_no} in Sales`];
  if (r.module === 'Returns' && d.return_no) return ['returns.html?q=' + encodeURIComponent(d.return_no), `Open ${d.return_no} in Returns`];
  if (r.module === 'Medicines' && d.name) return ['medicines.html?q=' + encodeURIComponent(d.name), `Open ${d.name} in Medicines`];
  if (r.module === 'Customer' && (d.phone || d.name)) return ['customers.html?q=' + encodeURIComponent(d.phone || d.name), 'Open in Customers'];
  const page = { Purchase: 'purchases.html', Inventory: 'inventory.html', Staff: 'staff.html', Documents: 'documents.html', Settings: 'settings.html', Expenses: 'expenses.html', Delivery: 'delivery.html', Finance: 'finance.html', WhatsApp: 'whatsapp.html', Reports: 'reports.html' }[r.module];
  return page ? [page, `Open ${r.module}`] : null;
};
function openEntry(r) {
  if (!r) return;
  const full = rows.find(x => x.id === r.id && x.src === r.src) || r;
  const b = full.before_data && typeof full.before_data === 'object' ? full.before_data : null, a = full.after_data && typeof full.after_data === 'object' ? full.after_data : null;
  const keys = [...new Set([...Object.keys(b || {}), ...Object.keys(a || {})])];
  const link = LINK(full);
  dlg(`<div class="al-det-head"><span class="al-c-ic ${(KIND[full.kind] || KIND.other)[1]}">${I[full.kind] || I.other}</span><div><h3>${esc(full.details)}</h3><p>${chip(full.kind)}${full.critical ? '<span class="md-chip out">Critical</span>' : ''}<span class="md-chip off">${esc(full.module)}</span></p></div></div>
    <div class="al-kv">
      <div><small>When</small><b>${esc(whenS(full.at))}</b></div>
      <div><small>User</small><b>${esc(full.user_name)}${full.staff_id ? ` <span class="dl-muted">(${esc(full.staff_id)})</span>` : ''}</b></div>
      <div><small>IP address</small><b>${esc(full.ip || 'Not recorded')}</b></div>
      <div><small>Action code</small><b>${esc(full.action)}</b></div>
      <div><small>Record</small><b>${esc(label(full.entity_type))}${full.entity_id ? ` <span class="dl-muted">${esc(String(full.entity_id).slice(0, 36))}</span>` : ''}</b></div>
      ${full.reason ? `<div class="al-wide"><small>Reason</small><b>${esc(full.reason)}</b></div>` : ''}
    </div>
    ${keys.length ? `<h4 class="al-subh">${b && a ? 'Changes' : 'Recorded data'}</h4>
      <div class="dl-table-wrap al-diff-wrap"><table class="dl-table al-diff"><thead><tr><th>Field</th>${b ? '<th>Before</th>' : ''}${a ? '<th>After</th>' : ''}</tr></thead><tbody>
      ${keys.map(k => { const ch = b && a && JSON.stringify(b[k]) !== JSON.stringify(a[k]); return `<tr class="${ch ? 'al-changed' : ''}"><td>${esc(label(k))}</td>${b ? `<td>${esc(fmtVal(b[k]))}</td>` : ''}${a ? `<td>${esc(fmtVal(a[k]))}</td>` : ''}</tr>`; }).join('')}
      </tbody></table></div>` : ''}
    <details class="al-raw"><summary>Raw entry (JSON)</summary><pre id="raw">${esc(JSON.stringify({ user: full.user_name, action: full.action, record_type: full.entity_type, record_id: full.entity_id, reason: full.reason, before: full.before_data, after: full.after_data, ip: full.ip, at: full.at }, null, 2))}</pre></details>
    <div class="st-foot st-foot-l">
      ${link ? `<a class="pos-btn pos-btn-sm pos-btn-solid" href="${esc(link[0])}">${I.link}<span>${esc(link[1])}</span></a>` : ''}
      ${full.user_id ? `<button type="button" class="pos-btn pos-btn-sm" id="byUser">${I.user}<span>More from ${esc(full.user_name)}</span></button>` : ''}
      <button type="button" class="pos-btn pos-btn-sm" id="cpRaw">${I.copy}<span>Copy</span></button>
    </div>`, 'al-entry-dlg');
  if ($('byUser')) $('byUser').onclick = () => { $('puDlg').close(); $('fUser').value = full.user_id; critical = false; syncCrit(); loadList(1); scrollToList(); };
  $('cpRaw').onclick = async () => { try { await navigator.clipboard.writeText($('raw').textContent); toast('Entry copied.'); } catch { toast('Copy failed.', true); } };
}

// ---------------------------------------------------------------------------
// Exports, login history, user report, settings
// ---------------------------------------------------------------------------
const periodTxt = () => range === 'all' ? 'All time' : from === to ? new Date(from + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : `${from} to ${to}`;
const logExport = (fmt, n) => { if (has34) sb.rpc('audit_log_export', { p_format: fmt, p_rows: n, p_filters: { range, from, to, user: $('fUser').value || null, module: $('fModule').value || null, kind: $('fKind').value || null, q: $('q').value.trim() || null, critical } }).then(() => {}, () => {}); };
async function allRows() {
  if (has34) return (await rpc('audit_list', { ...filt(), p_limit: 5000, p_offset: 0 })).rows || [];
  const { data, error } = await legacyQuery(true).range(0, 4999); if (error) throw error;
  await loadUsers((data || []).map(r => r.user_id)); return (data || []).map(mapLegacy);
}
async function exportCsv() {
  try {
    const L = await allRows();
    csvDownload(`audit-log-${today()}.csv`, [['#', 'Date & Time (IST)', 'User', 'Staff ID', 'Action', 'Module', 'Details', 'IP Address', 'Critical', 'Action code', 'Record type', 'Record ID', 'Reason', 'Before', 'After'],
      ...L.map((r, i) => [i + 1, whenS(r.at), r.user_name, r.staff_id || '', (KIND[r.kind] || KIND.other)[0], r.module, r.details, r.ip || '', r.critical ? 'yes' : '', r.action, r.entity_type, r.entity_id || '', r.reason || '', r.before_data ? JSON.stringify(r.before_data) : '', r.after_data ? JSON.stringify(r.after_data) : ''])]);
    logExport('csv', L.length); toast(`Exported ${count(L.length)} activities${L.length >= 5000 ? ' (first 5,000)' : ''}.`);
  } catch (e) { toast(friendly(e), true); }
}
async function exportPrint() {
  try {
    const L = await allRows();
    printHTML(`<style>body{font:10px Arial;margin:10px;color:#0b1b33}h2{margin:0;color:#02224d}table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border-bottom:1px solid #ddd;padding:3px 4px;text-align:left;vertical-align:top}th{background:#0f7a16;color:#fff}.c{color:#c4291f;font-weight:bold}.s{color:#555}</style>
      <h2>Pallikkal Pharmacy — Audit log</h2><p class="s">${esc(periodTxt())} · ${count(L.length)} activities${critical ? ' · critical only' : ''} · printed ${esc(whenS(new Date()))}</p>
      <table><thead><tr><th>#</th><th>Date &amp; time</th><th>User</th><th>Action</th><th>Module</th><th>Details</th><th>IP</th></tr></thead><tbody>
      ${L.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(when(r.at))}</td><td>${esc(r.user_name)}</td><td class="${r.critical ? 'c' : ''}">${esc((KIND[r.kind] || KIND.other)[0])}</td><td>${esc(r.module)}</td><td>${esc(r.details)}</td><td>${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table>`, 'Audit log', 'a4');
    logExport('print', L.length);
  } catch (e) { toast(friendly(e), true); }
}
function exportDlg() {
  dlg(`<h3 class="rt-dlg-title">${I.download} Export Audit Logs</h3>
    <p class="dl-muted">${esc(periodTxt())}${$('fUser').value || $('fModule').value || $('fKind').value || $('q').value || critical ? ' · with the current filters' : ''} · ${count(total)} activities. Every export is recorded in the audit log.</p>
    <div class="al-rep">
      <button type="button" class="al-rep-b" data-exp="csv"><span class="al-q-ic">${I.download}</span><b>CSV (Excel)</b><small>All fields incl. before / after</small></button>
      <button type="button" class="al-rep-b" data-exp="print"><span class="al-q-ic">${I.print}</span><b>Print / Save as PDF</b><small>A4 list for inspection</small></button>
      <button type="button" class="al-rep-b" data-exp="users"><span class="al-q-ic">${I.users}</span><b>User activity</b><small>One line per staff member</small></button>
      <button type="button" class="al-rep-b" data-exp="logins"><span class="al-q-ic">${I.calList}</span><b>Login history</b><small>Sessions and sign-in attempts</small></button>
    </div>`, 'al-small-dlg');
  $('puPanel').onclick = e => { const k = e.target.closest('[data-exp]')?.dataset.exp; if (k) doExport(k); };
}
function doExport(k) { ({ csv: exportCsv, print: exportPrint, users: () => userReport(true), logins: () => loginHistory('sessions', true) })[k]?.(); }
$('exportMenu').addEventListener('click', e => { const k = e.target.closest('[data-exp]')?.dataset.exp; if (!k) return; closePops(); doExport(k); });

async function loginHistory(tab = 'sessions', csv = false) {
  let data = null;
  if (has34) { try { data = await rpc('audit_login_history', { p_from: from, p_to: to, p_limit: 1000 }); } catch (e) { return toast(friendly(e), true); } }
  else {
    // before 0034: sign-in attempts straight from login_attempts (old Sign-in history tab)
    let qy = sb.from('login_attempts').select('id,at,staff_id,portal,success,reason,ip').order('at', { ascending: false }).limit(1000);
    if (from) qy = qy.gte('at', new Date(`${from}T00:00:00+05:30`).toISOString()); if (to) qy = qy.lte('at', new Date(`${to}T23:59:59.999+05:30`).toISOString());
    const { data: at, error } = await qy; data = { sessions: [], attempts: error ? null : at || [] }; tab = 'attempts';
  }
  const S = data.sessions || [], A = data.attempts;
  if (csv) {
    const out = [['Type', 'When (IST)', 'Staff', 'Staff ID', 'Result / logout', 'Minutes', 'IP', 'Portal / device']];
    for (const s of S) out.push(['Session', whenS(s.login_at), s.user_name || '', s.staff_id || '', s.logout_at ? `Logged out ${whenS(s.logout_at)} (${s.logout_reason || ''})` : s.active ? 'Active now' : 'Not logged out', s.minutes ?? '', s.ip || '', s.user_agent || '']);
    for (const a of A || []) out.push(['Sign-in attempt', whenS(a.at), '', a.staff_id || '', a.success ? 'Success' : `Failed${a.reason ? ': ' + a.reason : ''}`, '', a.ip || '', a.portal || '']);
    csvDownload(`login-history-${today()}.csv`, out); logExport('login_csv', out.length - 1); return toast('Login history downloaded.');
  }
  const dur = m => m === null || m === undefined ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  const failed = (A || []).filter(a => !a.success).length;
  dlg(`<h3 class="rt-dlg-title">${I.calList} Login History <small class="dl-muted">${esc(periodTxt())}</small></h3>
    <div class="st-tabs al-tabs">${has34 ? `<button type="button" data-tab="sessions" class="${tab === 'sessions' ? 'on' : ''}">Sessions (${S.length})</button>` : ''}${A ? `<button type="button" data-tab="attempts" class="${tab === 'attempts' ? 'on' : ''}">Sign-in attempts (${A.length})${failed ? ` <em>${failed} failed</em>` : ''}</button>` : ''}</div>
    <div id="lhBody"></div>
    <div class="st-foot"><button type="button" class="pos-btn" id="lhCsv">${I.download}<span>Download CSV</span></button><button type="button" class="pos-btn pos-btn-solid" data-close>Close</button></div>`, 'al-wide-dlg');
  const body = t => {
    for (const b of $('puPanel').querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === t);
    $('lhBody').innerHTML = t === 'sessions'
      ? `<div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv al-lh"><thead><tr><th>Staff</th><th>Login</th><th>Logout</th><th>Duration</th><th>IP</th></tr></thead><tbody>${S.map(s => `<tr><td><b>${esc(s.user_name || '—')}</b><small>${esc(s.staff_id || '')}</small></td><td>${esc(when(s.login_at))}</td>
          <td>${s.logout_at ? `${esc(when(s.logout_at))}<small>${esc({ manual: 'Logged out', idle: 'Idle timeout', new_login: 'Signed in elsewhere', admin: 'By administrator', deactivated: 'Login deactivated', new_day: 'New day' }[s.logout_reason] || s.logout_reason || '')}</small>` : s.active ? '<span class="md-chip in">Active now</span>' : '<span class="dl-muted">Not logged out</span>'}</td>
          <td>${esc(dur(s.minutes))}</td><td>${esc(s.ip || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="dl-empty">No logins in this period.</td></tr>'}</tbody></table></div>`
      : `<div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv al-lh"><thead><tr><th>When</th><th>Staff ID</th><th>Portal</th><th>Result</th><th>Reason</th><th>IP</th></tr></thead><tbody>${(A || []).map(a => `<tr><td>${esc(whenS(a.at))}</td><td>${esc(a.staff_id || '—')}${a.known === false ? ' <span class="md-chip low">Unknown ID</span>' : ''}</td><td>${esc(a.portal || '—')}</td>
          <td>${a.success ? '<span class="md-chip in">Success</span>' : '<span class="md-chip out">Failed</span>'}</td><td>${esc(a.reason || '')}</td><td>${esc(a.ip || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="dl-empty">No sign-in attempts for this period.</td></tr>'}</tbody></table></div>`;
  };
  $('puPanel').onclick = e => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) body(t); };
  $('lhCsv').onclick = () => loginHistory(tab, true);
  body(A && !has34 ? 'attempts' : tab);
}
async function userReport(csv = false) {
  if (!has34) return toast('The user activity report needs migration 0034.', true);
  let L = [];
  try { L = await rpc('audit_user_report', { p_from: from, p_to: to }) || []; } catch (e) { return toast(friendly(e), true); }
  if (csv) {
    csvDownload(`user-activity-${today()}.csv`, [['Staff', 'Staff ID', 'Role', 'Total', 'Created', 'Updated', 'Deleted', 'Exported', 'Critical', 'Logins', 'Most used module', 'First', 'Last'],
      ...L.map(u => [u.user_name, u.staff_id || '', u.role || '', u.total, u.created, u.updated, u.deleted, u.exported, u.critical, u.logins, u.top_module || '', whenS(u.first_at), whenS(u.last_at)])]);
    logExport('user_csv', L.length); return toast('User activity report downloaded.');
  }
  const max = Math.max(1, ...L.map(u => num(u.total)));
  dlg(`<h3 class="rt-dlg-title">${I.users} User Activity Report <small class="dl-muted">${esc(periodTxt())}</small></h3>
    <div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv al-ur"><thead><tr><th>Staff</th><th>Activities</th><th>Created</th><th>Updated</th><th>Deleted</th><th>Critical</th><th>Logins</th><th>Most used</th><th>Last activity</th></tr></thead><tbody>
    ${L.map(u => `<tr data-u="${esc(u.user_id)}"><td><b>${esc(u.user_name)}</b><small>${esc(u.staff_id || '')} · ${esc(u.role || '')}</small></td><td><div class="st-bar"><span style="width:${(num(u.total) / max * 100).toFixed(0)}%"></span></div>${count(u.total)}</td>
      <td>${count(u.created)}</td><td>${count(u.updated)}</td><td>${num(u.deleted) ? `<b class="al-warn">${count(u.deleted)}</b>` : 0}</td><td>${num(u.critical) ? `<b class="al-warn">${count(u.critical)}</b>` : 0}</td><td>${count(u.logins)}</td><td>${esc(u.top_module || '—')}</td><td>${esc(when(u.last_at))}</td></tr>`).join('') || '<tr><td colspan="9" class="dl-empty">No activity in this period.</td></tr>'}
    </tbody></table></div>
    <p class="dl-muted al-small">Click a person to see their activity in the list.</p>
    <div class="st-foot"><button type="button" class="pos-btn" id="urCsv">${I.download}<span>Download CSV</span></button><button type="button" class="pos-btn pos-btn-solid" data-close>Close</button></div>`, 'al-wide-dlg');
  $('urCsv').onclick = () => userReport(true);
  $('puPanel').onclick = e => { const tr = e.target.closest('tr[data-u]'); if (!tr) return; $('puDlg').close(); $('fUser').value = tr.dataset.u; critical = false; syncCrit(); loadList(1); scrollToList(); };
}
async function settingsDlg() {
  if (!has34) return toast('Audit log settings need migration 0034.', true);
  dlg(`<h3 class="rt-dlg-title">${I.gear} Audit Log Settings</h3>
    <div class="md-form-grid">
      <div class="pos-field"><label for="asRange">Default period</label><select id="asRange">${RANGES.filter(r => r[0] !== 'custom').map(([k, l]) => `<option value="${k}"${k === cfg.default_range ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="pos-field"><label for="asSize">Rows per page</label><select id="asSize">${[10, 25, 50, 100].map(n => `<option${n === num(cfg.page_size) ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <label class="st-check al-chk"><input type="checkbox" id="asCrit"${cfg.alert_critical ? ' checked' : ''}> Bell alert for critical actions in the last 24 hours</label>
    <label class="st-check al-chk"><input type="checkbox" id="asFail"${cfg.alert_failed_logins ? ' checked' : ''}> Bell alert for failed sign-in attempts today</label>
    <div class="al-info"><b>What is recorded</b><ul><li>Bills, returns, purchases, stock changes, medicine and price changes, expenses, accounts, staff, documents, WhatsApp and settings — with the person, time and before / after values.</li><li>Every login and logout, and failed sign-in attempts.</li><li>The IP address of new entries (sent by Supabase with each request).</li></ul>
      <b>Safety</b><ul><li>Entries can never be edited or deleted — not even by Super Admin. Exports are recorded too.</li></ul></div>
    <p class="pos-form-msg" id="asErr"></p>
    <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="asSave">Save settings</button></div>`, 'al-small-dlg');
  $('asSave').onclick = async () => {
    try {
      cfg = await rpc('audit_settings_save', { p: { default_range: $('asRange').value, page_size: +$('asSize').value, alert_critical: $('asCrit').checked, alert_failed_logins: $('asFail').checked } });
      $('puDlg').close(); toast('Audit log settings saved.'); setRange(cfg.default_range); await refresh(1);
    } catch (e) { $('asErr').textContent = friendly(e); }
  };
}
$('quick').addEventListener('click', e => { const k = e.target.closest('[data-q]')?.dataset.q; if (!k) return; ({ export: exportDlg, logins: () => loginHistory(), users: () => userReport(), settings: settingsDlg })[k]?.(); });
$('moreMenu').addEventListener('click', e => {
  const k = e.target.closest('[data-more]')?.dataset.more; if (!k) return; closePops();
  if (k === 'critical') { critical = !critical; syncCrit(); return loadList(1); }
  ({ logins: () => loginHistory(), users: () => userReport(), settings: settingsDlg, refresh: () => refresh(page).then(() => toast('Refreshed.')) })[k]?.();
});

// ---------------------------------------------------------------------------
// Bell, search, start
// ---------------------------------------------------------------------------
async function notify() {
  const items = [];
  if (has34) {
    try {
      const o = await rpc('audit_overview', { p_from: addDays(today(), -1), p_to: today() });
      if (cfg.alert_critical && num(o.critical)) items.push({ tone: 'warn', title: `${o.critical} critical action${o.critical === 1 ? '' : 's'} in the last 2 days`, detail: (o.critical_recent || []).slice(0, 2).map(c => c.details).join(' · '), href: 'audit-logs.html?critical=1' });
      const f = await rpc('audit_overview', { p_from: today(), p_to: today() });
      if (cfg.alert_failed_logins && num(f.failed_logins)) items.push({ tone: 'danger', title: `${f.failed_logins} failed sign-in attempt${f.failed_logins === 1 ? '' : 's'} today`, detail: 'Login history → Sign-in attempts', href: 'audit-logs.html?show=logins' });
    } catch { /* bell is optional */ }
  }
  setNotifications(items);
}
mountGlobalSearch({ sb, prof, placeholder: 'Search audit logs by user, action, module, or details...', extra: q => [{ g: 'Audit logs', t: `Search activity for “${q}”`, s: 'Filter the activity list', h: '#', run: () => { $('q').value = q; loadList(1); scrollToList(); } }] });

const params = new URLSearchParams(location.search);
try { cfg = { ...cfg, ...(await rpc('audit_settings_get')) }; } catch (e) { if (missing(e)) noteMissing(); }
try { view = localStorage.getItem('pp.audit.view') === 'timeline' ? 'timeline' : 'list'; } catch { /* ignore */ }
$('fView').value = view;
setRange(RANGES.some(r => r[0] === params.get('range') && r[0] !== 'custom') ? params.get('range') : cfg.default_range || '7d');
if (params.get('critical') === '1') { critical = true; syncCrit(); }
if (params.get('q')) $('q').value = params.get('q');
await refresh(1);
if (params.get('show') === 'logins') loginHistory('attempts'); else if (params.get('show') === 'users') userReport();
