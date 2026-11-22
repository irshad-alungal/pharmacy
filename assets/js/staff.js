// Staff Management — Pallikkal Pharmacy design.
// Kept from the old page: create a login (Staff ID, name, phone, role — Admin only for Super Admin —,
// address, photo, temporary password ≥ 12), list / search, profile with Call / WhatsApp, refresh.
// New (0031 + admin-staff Edge Function): address, photo and HR details really saved; designation and
// join date; edit; change role; deactivate / activate; reset password; attendance (automatic from logins,
// manual marks win), leaves, attendance trend / register, roles & permissions, staff performance,
// activity log, import (CSV) and export.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { printHTML } from './invoice.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('staff', 'Staff', { layout: 'brand' });
const $ = id => document.getElementById(id);
const role = String(prof?.role || '').toLowerCase();
const isSuper = role === 'super_admin';
if (!['super_admin', 'admin'].includes(role)) { $('view').innerHTML = '<p class="notice">Only Admin and Super Admin can manage staff.</p>'; throw new Error('Staff access denied'); }
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const count = n => new Intl.NumberFormat('en-IN').format(num(n));
const rupees = v => `₹${num(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const monthStart = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10); };
const monthEnd = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - back, 0)).toISOString().slice(0, 10); };
const ds = v => v ? String(v).slice(0, 10) : '';
const dmy = v => v ? new Date(ds(v) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const dm = v => new Date(ds(v) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const when = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, s => s.toUpperCase()) : '—';
const whenY = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, s => s.toUpperCase()) : '—';
const hm = t => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${String((h % 12) || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ap}`; };
const hhmm = t => t ? String(t).slice(0, 5) : '';
const digits = v => String(v || '').replace(/\D/g, '');
const waNumber = v => { let d = digits(v); if (d.length === 10) d = `91${d}`; return d; };
const initials = n => String(n || '?').replace(/[^A-Za-z\s]/g, ' ').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '#';
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  users: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.3c2.9.3 5 2.6 5 5.7"/>', 1.8),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>', 1.8),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>', 1.8),
  userLeave: svg('<circle cx="10" cy="8" r="4"/><path d="M3 21c0-3.9 3.1-7 7-7 1.4 0 2.6.4 3.7 1"/><circle cx="18" cy="18" r="3.2"/><path d="m16.8 18 1 1 1.6-1.8"/>', 1.8),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2.2),
  phone: svg('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/>', 1.9),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 1.9),
  bars: svg('<path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/>', 2.4),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 2),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>', 1.9),
  addUser: svg('<circle cx="14" cy="8" r="4"/><path d="M7 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M5 7v6M2 10h6"/>', 1.8),
  umbrella: svg('<path d="M12 3a9 9 0 0 0-9 9h18a9 9 0 0 0-9-9Z"/><path d="M12 12v7a2 2 0 0 0 4 0"/>', 1.9),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>', 1.9),
  report: svg('<path d="M4 20V10"/><path d="M9.3 20V4"/><path d="M14.6 20v-7"/><path d="M20 20V8"/><path d="M2 21h20"/>', 1.9),
  star: svg('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>', 1.8),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>', 1.9),
  power: svg('<path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>', 2),
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.6),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  refresh: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 2),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 1.9),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  photo: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>', 1.9),
  tick: svg('<path d="m5 12 4 4 10-10"/>', 2.4),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const ROLE_OPTS = [['pharmacist', 'Pharmacist'], ['billing_staff', 'Billing Staff'], ['inventory_staff', 'Inventory Staff'], ['delivery_person', 'Delivery Person'], ...(isSuper ? [['admin', 'Admin']] : [])];
const ROLE_NAME = { super_admin: 'Super Admin', admin: 'Admin', pharmacist: 'Pharmacist', billing_staff: 'Billing Staff', billing: 'Billing Staff', inventory_staff: 'Inventory Staff', inventory: 'Inventory Staff', delivery_person: 'Delivery Staff' };
const DESIGNATIONS = ['Pharmacist', 'Sales Staff', 'Cashier', 'Store Keeper', 'Delivery Staff', 'Manager', 'Helper', 'Trainee'];
const DES_FOR_ROLE = { pharmacist: 'Pharmacist', billing_staff: 'Sales Staff', inventory_staff: 'Store Keeper', delivery_person: 'Delivery Staff', admin: 'Manager' };
const DES_COL = [[/pharmac/i, 'g', '#12a01b'], [/sales|billing/i, 'b', '#1e8fe8'], [/store|inventory|stock/i, 'a', '#f5b800'], [/cash/i, 'p', '#9b6cf2'], [/deliver/i, 'r', '#ec4899'], [/manag|admin|owner/i, 't', '#0e9488']];
const desCol = n => DES_COL.find(([re]) => re.test(n || '')) || [0, 'n', '#98a2b3'];
const ATT = { present: ['Present', 'P', 'in'], absent: ['Absent', 'A', 'out'], half_day: ['Half day', 'H', 'low'], leave: ['On leave', 'L', 'pu'], holiday: ['Holiday', 'Ho', 'off'], week_off: ['Week off', 'W', 'off'] };
const LEAVE_T = { casual: 'Casual', sick: 'Sick', earned: 'Earned', unpaid: 'Unpaid', other: 'Other' };
const SHIFTS = { morning: 'Morning', evening: 'Evening', night: 'Night', full_day: 'Full day', rotational: 'Rotational' };
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
const ACT_IC = { added: ['g', I.addUser], attendance: ['b', I.cal], updated: ['a', I.pencil], leave: ['r', I.cal], role: ['p', I.shield], status: ['n', I.power], password: ['a', I.key] };

let has31 = true, staff = [], ov = null, acts = [], page = 1, per = 5, showAll = false, compact = matchMedia('(max-width: 560px)').matches;
const photoCache = new Map();

$('view').innerHTML = `
<div class="pos dl md pur st">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.users}</span>
      <div><h1>Staff Management</h1><p>Manage your pharmacy staff, roles, attendance, and performance.</p></div></div>
    <div class="pos-head-actions md-head-actions st-head-actions">
      <button type="button" class="pos-btn pos-btn-solid" id="addStaff">${I.plusC}<span>Add Staff</span></button>
      <button type="button" class="pos-btn st-btn-navy" id="importBtn">${I.upload}<span>Import</span></button>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn st-btn-navy" id="exportBtn" aria-expanded="false">${I.download}<span>Export</span></button>
        <div class="dl-pop md-menu ds-menu st-menu" id="exportMenu" hidden>
          <button type="button" data-exp="csv">${I.download}<span>Staff list (CSV)</span></button>
          <button type="button" data-exp="print">${I.print}<span>Print staff list</span></button>
          <button type="button" data-exp="att">${I.report}<span>Attendance register (CSV)</span></button>
          <button type="button" data-exp="perf">${I.star}<span>Staff performance (CSV)</span></button>
        </div></div>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn st-btn-navy" id="moreBtn" aria-expanded="false">${I.dots}<span>More</span></button>
        <div class="dl-pop md-menu ds-menu st-menu" id="moreMenu" hidden>
          <button type="button" data-more="attendance">${I.cal}<span>Mark attendance</span></button>
          <button type="button" data-more="leaves">${I.umbrella}<span>Manage leaves <b id="mLeaves"></b></span></button>
          <button type="button" data-more="roles">${I.shield}<span>Roles &amp; permissions</span></button>
          <button type="button" data-more="report">${I.report}<span>Attendance report</span></button>
          <button type="button" data-more="perf">${I.star}<span>Staff performance</span></button>
          <button type="button" data-more="acts">${I.clock}<span>All staff activity</span></button>
          <button type="button" data-more="refresh">${I.refresh}<span>Refresh</span></button>
        </div></div>
    </div>
  </section>

  <section class="dz-kpis md-kpis st-kpis">
    ${KPI('green', I.users, 'Total Staff', 'kTotal')}
    ${KPI('blue', I.user, 'Active Staff', 'kActive')}
    ${KPI('amber', I.cal, "Today's Attendance", 'kPresent')}
    ${KPI('purple', I.userLeave, 'On Leave', 'kLeave')}
  </section>
  <div id="msg" class="md-msg" role="status"></div>

  <div class="st-layout">
    <section class="pos-card st-list">
      <div class="dl-card-head"><h2><span class="st-h-ic">${I.users}</span>Staff Members</h2><button type="button" class="dl-link" id="viewAll"><span id="viewAllLabel">View All Staff</span> ${I.arrow}</button></div>
      <div class="st-tools">
        <label class="dl-search">${I.search}<input id="q" type="search" placeholder="Search staff by name, role, or employee ID..." autocomplete="off" aria-label="Search staff"></label>
        <label class="dl-select"><select id="fRole" aria-label="Role"><option value="">All Roles</option></select></label>
        <label class="dl-select st-fstatus"><select id="fStatus" aria-label="Status"><option value="active">Active</option><option value="">All Status</option><option value="inactive">Inactive</option><option value="leave">On leave today</option><option value="absent">Absent / not marked today</option><option value="password">Password change pending</option></select></label>
      </div>
      <div class="dl-table-wrap"><table class="dl-table st-table"><thead><tr>
        <th class="c-id">Emp. ID</th><th class="c-name">Name</th><th class="c-role">Role</th><th class="c-ph">Phone</th><th class="c-jd">Join Date</th><th class="c-st">Status</th><th class="c-act">Actions</th>
      </tr></thead><tbody id="rows"><tr><td colspan="7" class="dl-empty">Loading staff…</td></tr></tbody></table></div>
      <div class="dl-pager md-pager" id="pagerWrap"><span id="pageInfo"></span><div id="pager"></div></div>
    </section>
    <section class="pos-card st-dist">
      <div class="dl-card-head"><h2><span class="st-h-ic">${I.users}</span>Staff Distribution <small>(By Role)</small></h2></div>
      <div class="dl-sum sl-paybox st-distbox">
        <div class="dl-donut sl-donut"><svg viewBox="0 0 220 220" id="donut" aria-hidden="true"></svg><div class="dl-donut-c"><strong id="distTotal">0</strong><span>Total Staff</span></div></div>
        <div class="sl-legend st-legend" id="legend"></div>
      </div>
    </section>
    <section class="pos-card pur-trend st-trend">
      <div class="dl-card-head"><div><h2><span class="st-h-ic">${I.bars}</span>Attendance Trend</h2><small class="dl-muted st-sub" id="trendSub">Staff attendance for the last 7 days</small></div>
        <label class="dl-select pur-mini"><select id="trendRange" aria-label="Range"><option value="7">Last 7 Days</option><option value="14">Last 14 Days</option><option value="30">Last 30 Days</option><option value="90">Last 90 Days</option></select></label></div>
      <div class="dz-chart pur-chart" id="chart"></div>
    </section>
    <section class="pos-card st-acts">
      <div class="dl-card-head"><h2><span class="st-h-ic">${I.clock}</span>Recent Staff Activities</h2><button type="button" class="dl-link" id="actsAll">View All ${I.arrow}</button></div>
      <div class="st-alist" id="acts"><p class="dl-empty">Loading…</p></div>
    </section>
    <section class="pos-card st-quick">
      <div class="dl-card-head"><h2><span class="st-h-ic">${I.bolt}</span>Quick Actions</h2></div>
      <div class="st-qlist" id="quick">
        <button type="button" data-q="attendance"><span class="st-q-ic">${I.cal}</span><b>Mark Attendance</b>${I.chev}</button>
        <button type="button" data-q="leaves"><span class="st-q-ic">${I.umbrella}</span><b>Manage Leaves</b><em class="st-q-badge" id="qLeaves" hidden></em>${I.chev}</button>
        <button type="button" data-q="roles"><span class="st-q-ic">${I.shield}</span><b>Assign Roles &amp; Permissions</b>${I.chev}</button>
        <button type="button" data-q="report"><span class="st-q-ic">${I.report}</span><b>View Attendance Report</b>${I.chev}</button>
        <button type="button" data-q="perf"><span class="st-q-ic">${I.star}</span><b>Staff Performance</b>${I.chev}</button>
      </div>
    </section>
  </div>
</div>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg st-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<div class="dl-pop md-menu ds-menu st-row-menu" id="rowMenu" hidden></div>
<input type="file" id="importFile" accept=".csv,text/csv" hidden>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const note = (m, bad) => { $('msg').textContent = m; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; };
$('puDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('puDlg')) $('puDlg').close(); });
const dlg = (html, cls = '') => { $('puPanel').innerHTML = html; $('puDlg').className = `pos-dialog dl-dialog md-wide sl-dlg st-dlg ${cls}`; $('puPanel').onclick = null; if (!$('puDlg').open) $('puDlg').showModal(); $('puDlg').scrollTop = 0; };
const missing = e => /staff_|_staff|function|schema cache|does not exist|Could not find/i.test(e?.message || '');
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }
async function edge(body) {
  const { data, error } = await sb.functions.invoke('admin-staff', { body });
  if (error) { let detail = error.message || 'Request failed'; if (error.context && typeof error.context.json === 'function') { try { detail = (await error.context.json()).error || detail; } catch { /* keep */ } } throw new Error(detail); }
  if (data?.error) throw new Error(data.error);
  return data;
}
const genPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', s = '@#$%&*!?'; const r = crypto.getRandomValues(new Uint32Array(14)); let p = [...r].slice(0, 12).map(x => a[x % a.length]).join(''); p += s[r[12] % s.length] + String(r[13] % 90 + 10); return p; };

// ---------------------------------------------------------------------------
// Popovers / row menu
// ---------------------------------------------------------------------------
const POPS = [['exportBtn', 'exportMenu'], ['moreBtn', 'moreMenu']];
function closePops() { for (const [b, p] of POPS) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } $('rowMenu').hidden = true; }
for (const [b, p] of POPS) $(b).addEventListener('click', e => { e.stopPropagation(); const open = $(p).hidden; closePops(); $(p).hidden = !open; $(b).setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', e => { if (!e.target.closest('.dl-pop') && !e.target.closest('[data-rowmenu]')) closePops(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePops(); });
function rowMenu(anchor, html, onPick) {
  const menu = $('rowMenu'), host = anchor.closest('dialog') || document.body;
  if (menu.parentNode !== host) host.appendChild(menu);
  menu.innerHTML = html; menu.hidden = false;
  const b = anchor.getBoundingClientRect();
  menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, b.bottom + 6))}px`;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, b.right - menu.offsetWidth))}px`;
  menu.onclick = ev => { const a = ev.target.closest('[data-rm]'); if (!a) return; menu.hidden = true; onPick(a.dataset.rm); };
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
async function loadStaff() {
  try { staff = (await rpc('staff_list')) || []; }
  catch (e) {
    if (!missing(e)) { note(friendly(e), true); staff = []; return; }
    has31 = false;
    note('Run database migration 0031 (Staff Management) and deploy the updated admin-staff function to save address, photo, attendance and leaves. The list below comes from the staff login service.', true);
    try {
      const d = await edge({ action: 'list' });
      staff = (d.staff || []).map(s => ({ ...s, designation: ROLE_NAME[s.role] || s.role_name || s.role, role_name: ROLE_NAME[s.role] || s.role_name, join_date: ds(s.created_at), can_manage: false, is_self: s.id === prof.id }));
    } catch (err) { note(`Unable to load staff: ${err.message}`, true); staff = []; }
  }
}
async function loadOverview() {
  if (!has31) {
    const tot = staff.length, act = staff.filter(s => s.is_active).length;
    ov = { total: tot, active: act, present: null, on_leave: null, total_last_month: null, distribution: Object.entries(staff.reduce((a, s) => (a[s.designation] = (a[s.designation] || 0) + 1, a), {})).map(([label, c]) => ({ label, count: c })) };
    return;
  }
  try { ov = await rpc('staff_overview'); } catch (e) { note(friendly(e), true); }
}
function renderKpis() {
  if (!ov) return;
  const pct = (a, b) => b ? `${(a / b * 100).toFixed(1)}%` : '0%';
  $('kTotal').textContent = count(ov.total);
  const lm = ov.total_last_month;
  $('kTotalNote').innerHTML = lm === null || lm === undefined ? '<span class="dz-muted">All logins in this branch</span>' : !lm ? (ov.total ? '<span class="dz-up">New</span> <span class="dz-muted">· none last month</span>' : '') : (() => { const p = (ov.total - lm) / lm * 100; return `<span class="${p >= 0 ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.down}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> vs. last month`; })();
  $('kActive').textContent = count(ov.active); $('kActiveNote').innerHTML = `<b>${pct(ov.active, ov.total)}</b> of total staff`;
  if (ov.present === null) { $('kPresent').textContent = '—'; $('kPresentNote').textContent = 'Needs migration 0031'; $('kLeave').textContent = '—'; $('kLeaveNote').textContent = 'Needs migration 0031'; return; }
  const pres = num(ov.present) + num(ov.half_day) * 0.5;
  $('kPresent').textContent = count(num(ov.present) + num(ov.half_day));
  $('kPresentNote').innerHTML = `<b>${pct(pres, ov.active - num(ov.off))}</b> present${num(ov.not_marked) ? ` · <span class="st-warn">${ov.not_marked} not marked</span>` : ''}`;
  $('kLeave').textContent = count(ov.on_leave); $('kLeaveNote').innerHTML = `<b>${pct(ov.on_leave, ov.total)}</b> of total staff${num(ov.pending_leaves) ? ` · <span class="st-warn">${ov.pending_leaves} request${ov.pending_leaves === 1 ? '' : 's'}</span>` : ''}`;
  $('kPresent').closest('.dz-kpi').title = `Present ${ov.present}, half day ${ov.half_day}, absent ${ov.absent}, on leave ${ov.on_leave}, off ${ov.off}, not marked ${ov.not_marked}. A login today counts as present; a manual mark wins.`;
  $('mLeaves').textContent = num(ov.pending_leaves) ? `(${ov.pending_leaves})` : '';
  $('qLeaves').hidden = !num(ov.pending_leaves); $('qLeaves').textContent = ov.pending_leaves;
}
document.querySelector('.st-kpis').addEventListener('click', e => {
  const k = e.target.closest('[data-kpi]')?.dataset.kpi; if (!k) return;
  if (k === 'kTotal') { $('fStatus').value = ''; render(1); } else if (k === 'kActive') { $('fStatus').value = 'active'; render(1); }
  else if (k === 'kPresent') markAttendance(); else showLeaves();
});

// ---------------------------------------------------------------------------
// Staff table
// ---------------------------------------------------------------------------
async function photoUrl(path) {
  if (!path) return '';
  if (photoCache.has(path)) return photoCache.get(path);
  try { const { data } = await sb.storage.from('staff-photos').createSignedUrl(path, 3600); photoCache.set(path, data?.signedUrl || ''); } catch { photoCache.set(path, ''); }
  return photoCache.get(path);
}
const avatar = (s, cls = '') => `<span class="st-av ${desCol(s.designation)[1]} ${cls}" data-photo="${esc(s.photo_path || '')}">${esc(initials(s.full_name))}</span>`;
async function fillPhotos(root) {
  for (const el of root.querySelectorAll('[data-photo]:not([data-photo=""])')) {
    const url = await photoUrl(el.dataset.photo);
    if (url && /^(https?:|blob:)/.test(url)) el.innerHTML = `<img src="${esc(url)}" alt="">`;
  }
}
const statusChip = s => !s.is_active ? '<span class="md-chip off">Inactive</span>' : s.today_status === 'leave' ? '<span class="md-chip pu">On Leave</span>' : '<span class="md-chip in">Active</span>';
const roleChip = s => `<span class="st-role ${desCol(s.designation)[1]}">${esc(s.designation || s.role_name || '')}</span>`;
function filtered() {
  const q = $('q').value.trim().toLowerCase(), r = $('fRole').value, st = $('fStatus').value;
  return staff.filter(s => (!q || [s.staff_id, s.full_name, s.phone, s.designation, s.role_name].join(' ').toLowerCase().includes(q))
    && (!r || s.designation === r)
    && (!st || (st === 'active' && s.is_active) || (st === 'inactive' && !s.is_active) || (st === 'leave' && s.today_status === 'leave')
        || (st === 'absent' && s.is_active && (!s.today_status || s.today_status === 'absent')) || (st === 'password' && s.is_active && s.must_change_password)));
}
function render(p = page) {
  const rows = filtered(), pp = showAll ? 25 : per, pages = Math.max(1, Math.ceil(rows.length / pp));
  page = Math.min(Math.max(1, p), pages);
  const vis = rows.slice((page - 1) * pp, page * pp);
  $('rows').innerHTML = vis.map(s => `<tr data-id="${esc(s.id)}" class="${s.is_active ? '' : 'st-off'}">
      <td class="c-id">${esc(s.staff_id)}</td>
      <td class="c-name"><span class="st-who">${avatar(s)}<span><b>${esc(s.full_name)}</b><small class="st-m-id">${esc(s.staff_id)}</small></span></span></td>
      <td class="c-role">${roleChip(s)}</td>
      <td class="c-ph">${s.phone ? `<a class="st-ph" href="tel:${esc(s.phone)}" title="Call ${esc(s.full_name)}">${I.phone}<span>${esc(s.phone)}</span></a>` : '<span class="dl-muted">—</span>'}</td>
      <td class="c-jd">${esc(dmy(s.join_date))}</td>
      <td class="c-st">${statusChip(s)}</td>
      <td class="c-act"><div class="st-acts-btns">${s.can_manage || s.is_self ? `<button type="button" class="dl-act" data-edit title="Edit ${esc(s.full_name)}" aria-label="Edit ${esc(s.full_name)}">${I.pencil}</button>` : ''}<button type="button" class="dl-act" data-rowmenu title="More" aria-label="More actions for ${esc(s.full_name)}">${I.dots}</button><span class="st-go">${I.chev}</span></div></td></tr>`).join('')
    || `<tr><td colspan="7" class="dl-empty">${staff.length ? 'No staff match your search.' : 'No staff yet. Use Add Staff to create the first login.'}</td></tr>`;
  $('pageInfo').textContent = rows.length ? `Showing ${(page - 1) * pp + 1}–${Math.min(rows.length, page * pp)} of ${rows.length}` : '';
  $('pager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>${Array.from({ length: pages }, (_, k) => k + 1).map(n => `<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">›</button>` : '';
  fillPhotos($('rows'));
}
$('pager').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) render(+b.dataset.page); });
for (const id of ['fRole', 'fStatus']) $(id).addEventListener('change', () => render(1));
$('q').addEventListener('input', () => render(1));
$('viewAll').addEventListener('click', () => { showAll = !showAll; $('viewAllLabel').textContent = showAll ? 'Show Less' : 'View All Staff'; if (showAll) $('fStatus').value = ''; render(1); });
$('rows').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const s = staff.find(x => x.id === tr.dataset.id); if (!s) return;
  if (e.target.closest('a')) return;
  if (e.target.closest('[data-edit]')) return editStaff(s);
  const m = e.target.closest('[data-rowmenu]');
  if (m) { e.stopPropagation(); return rowMenu(m, staffMenu(s), k => staffAction(s, k)); }
  openProfile(s);
});
const staffMenu = s => [
  `<button type="button" data-rm="view">${I.eye}<span>View profile</span></button>`,
  s.can_manage || s.is_self ? `<button type="button" data-rm="edit">${I.pencil}<span>Edit details</span></button>` : '',
  has31 && s.is_active ? `<button type="button" data-rm="att">${I.cal}<span>Mark attendance</span></button><button type="button" data-rm="leave">${I.umbrella}<span>Add leave</span></button>` : '',
  s.can_manage ? `<button type="button" data-rm="role">${I.shield}<span>Change role</span></button><button type="button" data-rm="pw">${I.key}<span>Reset password</span></button>` : '',
  s.phone ? `<a href="tel:${esc(s.phone)}">${I.phone}<span>Call</span></a><a href="https://wa.me/${esc(waNumber(s.phone))}" target="_blank" rel="noopener">${I.wa}<span>WhatsApp</span></a>` : '',
  s.can_manage ? `<button type="button" data-rm="toggle" class="${s.is_active ? 'danger' : ''}">${I.power}<span>${s.is_active ? 'Deactivate login' : 'Activate login'}</span></button>` : ''
].join('');
function staffAction(s, k) {
  ({ view: () => openProfile(s), edit: () => editStaff(s), att: () => markAttendance(today(), s.id), leave: () => leaveForm(null, s.id), role: () => showRoles(s.id), pw: () => resetPassword(s), toggle: () => toggleActive(s) })[k]?.();
}

// ---------------------------------------------------------------------------
// Distribution, trend, activities
// ---------------------------------------------------------------------------
function drawDist() {
  const d = (ov?.distribution || []).slice();
  const top = d.slice(0, 5), rest = d.slice(5).reduce((a, x) => a + num(x.count), 0);
  const parts = top.map(x => ({ l: x.label, v: num(x.count), col: desCol(x.label)[2] }));
  if (rest) parts.push({ l: 'Others', v: rest, col: '#98a2b3' });
  const total = parts.reduce((a, p) => a + p.v, 0), C = 2 * Math.PI * 84, gap = parts.length > 1 ? 2 : 0;
  let off = 0;
  $('donut').innerHTML = `<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="30"/>` + parts.map(p => { const len = total ? p.v / total * C : 0; const o = len > gap ? `<circle cx="110" cy="110" r="84" fill="none" stroke="${p.col}" stroke-width="30" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-off}"><title>${esc(p.l)}: ${p.v}</title></circle>` : ''; off += len; return o; }).join('');
  $('distTotal').textContent = count(total);
  $('legend').innerHTML = parts.map(p => `<button type="button" data-des="${esc(p.l)}"><i style="background:${p.col}"></i><b>${esc(p.l)}</b><span>${p.v} (${total ? (p.v / total * 100).toFixed(1) : '0.0'}%)</span></button>`).join('') || '<p class="dl-muted">No staff yet.</p>';
}
$('legend').addEventListener('click', e => { const b = e.target.closest('[data-des]'); if (!b || b.dataset.des === 'Others') return; $('fRole').value = b.dataset.des; $('fStatus').value = ''; render(1); $('rows').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
function niceStep(v) { if (v <= 0) return 1; const raw = v * 1.08 / 5, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
let trend = [];
async function loadTrend() {
  const n = +$('trendRange').value;
  $('trendSub').textContent = `Staff attendance for the last ${n} days`;
  if (!has31) { $('chart').innerHTML = '<p class="dl-empty">Attendance needs migration 0031.</p>'; return; }
  try { trend = ((await rpc('staff_attendance_trend', { p_from: addDays(today(), -(n - 1)), p_to: today() })) || []).filter(r => r.pct !== null); }
  catch (e) { $('chart').innerHTML = `<p class="dl-empty">${esc(friendly(e))}</p>`; return; }
  drawTrend();
}
function drawTrend() {
  const el = $('chart'), s = trend, N = s.length;
  if (!N) { el.innerHTML = '<p class="dl-empty">No attendance yet.</p>'; return; }
  const vals = s.map(x => num(x.pct));
  const W = Math.max(260, el.clientWidth), H = el.clientHeight || 220, padL = 48, padR = 16, padT = 34, padB = 28;
  const lo = Math.max(0, Math.min(75, Math.floor((Math.min(...vals) - 5) / 5) * 5)), hi = 100, tick = (hi - lo) <= 25 ? 5 : niceStep(hi - lo);
  const grid = []; for (let v = lo; v <= hi + 0.01; v += tick) grid.push(v);
  const x = i => padL + (N === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (N - 1)), y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
  const pts = vals.map((v, i) => [x(i), y(v)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < N; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
  const area = `${d} L${pts[N - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z`;
  const fit = Math.max(2, Math.floor((W - padL - padR) / 46)), every = Math.max(1, Math.ceil(N / fit));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Attendance trend">
    <defs><linearGradient id="stArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fbf3a" stop-opacity=".32"/><stop offset="1" stop-color="#2fbf3a" stop-opacity=".04"/></linearGradient></defs>
    <g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
    <g class="dz-axis pur-axis">${grid.map(v => `<text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join('')}${s.map((p, i) => (i % every === 0 && N - 1 - i >= every / 2) || i === N - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(dm(p.day))}</text>` : '').join('')}</g>
    <path d="${area}" fill="url(#stArea)"/><path class="dz-line" d="${d}"/>
    ${pts.map(([px, py], i) => `<circle class="dz-pt${i === N - 1 ? ' hot' : ''}" data-i="${i}" cx="${px}" cy="${py}" r="${i === N - 1 ? 6 : N > 20 ? 2.6 : 4.5}"/>`).join('')}
    ${pts.map(([px], i) => `<rect data-i="${i}" x="${px - (W - padL - padR) / Math.max(1, N - 1) / 2}" y="${padT}" width="${(W - padL - padR) / Math.max(1, N - 1)}" height="${H - padT - padB}" fill="transparent"/>`).join('')}
  </svg><div class="dz-tip" id="stTip"></div>`;
  const tip = $('stTip');
  const show = i => { const [px, py] = pts[i], r = s[i]; tip.innerHTML = compact ? `${num(r.pct).toFixed(1)}%` : `${num(r.pct).toFixed(1)}%<small>${esc(dmy(r.day))} · ${r.present + r.half_day} of ${r.staff - r.off} present${r.on_leave ? ` · ${r.on_leave} on leave` : ''}${r.absent ? ` · ${r.absent} absent` : ''}</small>`; tip.style.left = `${Math.min(Math.max(px / W * 100, 18), 82)}%`; tip.style.top = `${(py - 12) / H * 100}%`; el.querySelectorAll('.dz-pt').forEach(c => c.classList.toggle('hot', +c.dataset.i === i)); };
  show(N - 1);
  const sv = el.querySelector('svg');
  sv.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('mouseleave', () => show(N - 1));
  sv.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) markAttendance(ds(s[+r.dataset.i].day)); });
}
$('trendRange').addEventListener('change', loadTrend);
async function loadActs() {
  if (!has31) { acts = staff.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 4).map(s => ({ at: s.created_at, kind: 'added', title: 'New staff added', detail: `${s.full_name} (${s.designation})` })); }
  else { try { acts = (await rpc('staff_activities', { p_limit: 60 })) || []; } catch (e) { $('acts').innerHTML = `<p class="dl-empty">${esc(friendly(e))}</p>`; return; } }
  $('acts').innerHTML = acts.slice(0, 4).map(actRow).join('') || '<p class="dl-empty">No staff activity yet.</p>';
}
const actRow = a => { const [c, ic] = ACT_IC[a.kind] || ACT_IC.updated; return `<div class="st-act"><span class="st-act-ic ${c}">${ic}</span><span class="st-act-b"><b>${esc(a.title)}</b><small>${esc(a.detail || '')}</small></span><time>${esc(when(a.at))}</time></div>`; };
$('actsAll').addEventListener('click', () => showActs());
function showActs() {
  dlg(`<h3 class="rt-dlg-title">${I.clock} Staff Activity <small class="dl-muted">(latest ${acts.length})</small></h3><div class="st-alist st-alist-all">${acts.map(a => actRow(a).replace('</small></span>', `${a.actor ? ` · by ${esc(a.actor)}` : ''}</small></span>`)).join('') || '<p class="dl-empty">No staff activity yet.</p>'}</div>`);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
async function openProfile(s) {
  let month = [], leaves = [], logins = [];
  if (has31) {
    try {
      [month, leaves, logins] = await Promise.all([
        rpc('staff_attendance_register', { p_from: monthStart(today()), p_to: today() }).then(r => (r || []).find(x => x.profile_id === s.id)),
        rpc('staff_leaves_list', { p_status: null, p_from: null, p_to: null }).then(r => (r || []).filter(x => x.profile_id === s.id)),
        rpc('staff_login_history', { p_profile: s.id, p_limit: 15 })]);
    } catch (e) { toast(friendly(e), true); }
  }
  const kv = (l, v) => `<div><small>${l}</small><strong>${v ? esc(v) : '<span class="dl-muted">Not recorded</span>'}</strong></div>`;
  const tAtt = s.today_status ? `${ATT[s.today_status]?.[0] || s.today_status}${s.today_in ? ` · in ${hm(s.today_in)}` : ''}${s.today_source === 'login' ? ' (login)' : ''}` : 'Not marked today';
  dlg(`<div class="st-prof-head">${avatar(s, 'lg')}<div><h3>${esc(s.full_name)}</h3><p class="dl-muted">${esc(s.staff_id)} · ${esc(s.role_name || '')}</p><div class="st-prof-chips">${roleChip(s)}${statusChip(s)}${s.must_change_password && s.is_active ? '<span class="md-chip low">Password change pending</span>' : ''}</div></div></div>
    <div class="st-prof-acts">
      ${s.phone ? `<a class="pos-btn pos-btn-sm" href="tel:${esc(s.phone)}">${I.phone}<span>Call</span></a><a class="pos-btn pos-btn-sm st-wa" href="https://wa.me/${esc(waNumber(s.phone))}" target="_blank" rel="noopener">${I.wa}<span>WhatsApp</span></a>` : ''}
      ${s.can_manage || s.is_self ? `<button type="button" class="pos-btn pos-btn-sm" data-p="edit">${I.pencil}<span>Edit</span></button>` : ''}
      ${has31 && s.is_active ? `<button type="button" class="pos-btn pos-btn-sm" data-p="att">${I.cal}<span>Attendance</span></button><button type="button" class="pos-btn pos-btn-sm" data-p="leave">${I.umbrella}<span>Add leave</span></button>` : ''}
      ${s.can_manage ? `<button type="button" class="pos-btn pos-btn-sm" data-p="pw">${I.key}<span>Reset password</span></button><button type="button" class="pos-btn pos-btn-sm ${s.is_active ? 'st-danger' : ''}" data-p="toggle">${I.power}<span>${s.is_active ? 'Deactivate' : 'Activate'}</span></button>` : ''}
    </div>
    <div class="st-tabs" id="pTabs"><button type="button" class="on" data-t="info">Details</button><button type="button" data-t="att">Attendance</button><button type="button" data-t="leave">Leaves</button><button type="button" data-t="login">Logins</button></div>
    <div class="st-pane" data-pane="info"><div class="st-kv">
      ${kv('Today', tAtt)}${kv('Phone number', s.phone)}${kv('Staff ID (login)', s.staff_id)}${kv('Login role', s.role_name)}${kv('Join date', s.join_date ? dmy(s.join_date) : '')}${kv('Shift', SHIFTS[s.shift])}
      ${kv('Email', s.email)}${kv('Date of birth', s.dob ? dmy(s.dob) : '')}${kv('Gender', s.gender ? s.gender[0].toUpperCase() + s.gender.slice(1) : '')}
      ${kv('Qualification', s.qualification)}${kv('Licence / registration no.', s.licence_no)}${kv('Monthly salary', s.salary !== null && s.salary !== undefined ? rupees(s.salary) : '')}
      ${kv('Emergency contact', [s.emergency_name, s.emergency_phone].filter(Boolean).join(' · '))}${kv('Last login', s.last_login ? whenY(s.last_login) : '')}${kv('Password', s.must_change_password ? 'Change required at next login' : 'Updated by the staff member')}
      <div class="st-wide"><small>Address</small><strong>${s.address ? esc(s.address) : '<span class="dl-muted">Not recorded</span>'}</strong></div>
      ${s.notes ? `<div class="st-wide"><small>Notes</small><strong>${esc(s.notes)}</strong></div>` : ''}</div></div>
    <div class="st-pane" data-pane="att" hidden>${month ? `<div class="st-sum"><div><b>${num(month.present)}</b><span>Present</span></div><div><b>${month.absent}</b><span>Absent</span></div><div><b>${month.on_leave}</b><span>Leave</span></div><div><b>${month.pct === null ? '—' : `${month.pct}%`}</b><span>Attendance</span></div><div><b>${num(month.hours)}</b><span>Hours</span></div></div>
      <div class="st-cal">${Object.entries(month.days || {}).sort().map(([d, v]) => `<span class="st-cal-d ${v && ATT[v] ? ATT[v][2] : v === 'not_marked' ? 'nm' : 'na'}" title="${esc(dmy(d))}: ${esc(ATT[v]?.[0] || (v === 'not_marked' ? 'Not marked' : v === '-' ? 'Before joining' : ''))}"><b>${+d.slice(8)}</b><i>${esc(ATT[v]?.[1] || (v === 'not_marked' ? '?' : ''))}</i></span>`).join('')}</div><p class="dl-muted">This month. A login counts as present; manual marks win. P present · A absent · H half day · L leave · W week off.</p>` : '<p class="dl-empty">No attendance yet.</p>'}</div>
    <div class="st-pane" data-pane="leave" hidden>${leaves.length ? `<div class="dl-table-wrap"><table class="dl-table st-mini"><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th></tr></thead><tbody>${leaves.map(l => `<tr><td>${LEAVE_T[l.leave_type]}</td><td>${esc(dm(l.from_date))}${l.to_date !== l.from_date ? ` – ${esc(dm(l.to_date))}` : ''}${l.reason ? `<small>${esc(l.reason)}</small>` : ''}</td><td>${num(l.days)}</td><td>${leaveChip(l.status)}</td></tr>`).join('')}</tbody></table></div><p class="dl-muted">Approved this year: ${num(leaves[0].taken_this_year)} day(s)</p>` : '<p class="dl-empty">No leaves recorded.</p>'}</div>
    <div class="st-pane" data-pane="login" hidden>${logins.length ? `<div class="dl-table-wrap"><table class="dl-table st-mini"><thead><tr><th>Date</th><th>Login</th><th>Last active / logout</th><th>Hours</th></tr></thead><tbody>${logins.map(w => `<tr><td>${esc(dmy(w.work_date))}</td><td>${esc(when(w.login_at))}</td><td>${esc(when(w.logout_at || w.last_activity_at))}${w.logout_reason ? `<small>${esc(w.logout_reason === 'admin' ? 'signed out by admin' : w.logout_reason.replace('_', ' '))}</small>` : '<small>still signed in</small>'}</td><td>${num(w.hours).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dl-empty">No logins yet.</p>'}</div>`, 'st-prof-dlg');
  fillPhotos($('puPanel'));
  $('puPanel').onclick = e => {
    const t = e.target.closest('[data-t]');
    if (t) { $('puPanel').querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === t)); $('puPanel').querySelectorAll('[data-pane]').forEach(x => { x.hidden = x.dataset.pane !== t.dataset.t; }); return; }
    const b = e.target.closest('[data-p]'); if (!b) return;
    ({ edit: () => editStaff(s), att: () => markAttendance(today(), s.id), leave: () => leaveForm(null, s.id), pw: () => resetPassword(s), toggle: () => toggleActive(s) })[b.dataset.p]();
  };
}
const leaveChip = st => `<span class="md-chip ${{ pending: 'low', approved: 'in', rejected: 'out', cancelled: 'off' }[st]}">${st[0].toUpperCase() + st.slice(1)}</span>`;

// ---------------------------------------------------------------------------
// Add / edit staff
// ---------------------------------------------------------------------------
function nextEmpId() {
  const ns = staff.map(s => /^EMP-?(\d+)$/i.exec(s.staff_id)).filter(Boolean).map(m => +m[1]);
  return ns.length ? `EMP-${String(Math.max(...ns) + 1).padStart(3, '0')}` : '';
}
let newPhoto = null, newPhotoUrl = '';
function photoPicker(cur) {
  return `<div class="st-photo"><span class="st-photo-prev" id="phPrev">${cur ? `<img src="${esc(cur)}" alt="">` : I.user}</span><div><label class="pos-btn pos-btn-sm st-file" for="phFile">${I.photo}<span>Choose photo</span></label><input id="phFile" type="file" accept="image/jpeg,image/png,image/webp" capture="user" hidden>
    <button type="button" class="dl-link" id="phRm" ${cur ? '' : 'hidden'}>Remove photo</button><small class="dl-muted">JPG, PNG or WEBP · up to 5 MB</small></div></div>`;
}
function wirePhoto(onRemove) {
  newPhoto = null; if (newPhotoUrl) URL.revokeObjectURL(newPhotoUrl); newPhotoUrl = '';
  $('phFile').onchange = () => {
    const f = $('phFile').files?.[0]; if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024) { toast('Choose a JPG, PNG or WEBP image up to 5 MB.', true); $('phFile').value = ''; return; }
    newPhoto = f; if (newPhotoUrl) URL.revokeObjectURL(newPhotoUrl); newPhotoUrl = URL.createObjectURL(f);
    $('phPrev').innerHTML = `<img src="${newPhotoUrl}" alt="Selected photo">`; $('phRm').hidden = false;
  };
  $('phRm').onclick = () => { newPhoto = null; $('phFile').value = ''; $('phPrev').innerHTML = I.user; $('phRm').hidden = true; onRemove?.(); };
}
async function uploadPhoto(profileId) {
  if (!newPhoto) return null;
  const path = `${prof.branch_id}/${profileId}-${Date.now()}.${newPhoto.type === 'image/png' ? 'png' : newPhoto.type === 'image/webp' ? 'webp' : 'jpg'}`;
  const up = await sb.storage.from('staff-photos').upload(path, newPhoto, { contentType: newPhoto.type, upsert: true });
  if (up.error) throw up.error;
  photoCache.set(path, newPhotoUrl);
  return path;
}
function addStaff(prefill = {}) {
  const pw = genPassword();
  dlg(`<h3 class="rt-dlg-title">${I.addUser} Add Staff</h3>
    <p class="dl-muted">Creates a login for this branch. The staff member signs in with the Staff ID and the temporary password, and must change the password at first login. Delivery staff only see the Delivery page.</p>
    <form id="addForm" class="md-form" novalidate>
      ${photoPicker('')}
      <div class="md-form-grid st-form">
        <div class="pos-field"><label for="aId">Staff ID (login)</label><input id="aId" required maxlength="32" pattern="[A-Za-z0-9._-]{3,32}" placeholder="e.g. EMP-013" value="${esc(prefill.staff_id || nextEmpId())}"></div>
        <div class="pos-field"><label for="aName">Full name</label><input id="aName" required maxlength="120" placeholder="Staff full name"></div>
        <div class="pos-field"><label for="aPhone">Phone number</label><input id="aPhone" type="tel" maxlength="30" placeholder="+91 98765 43210"></div>
        <div class="pos-field"><label for="aRole">Login role <small class="dl-muted">(what they can open)</small></label><select id="aRole">${ROLE_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div class="pos-field"><label for="aDes">Designation <small class="dl-muted">(job title)</small></label><input id="aDes" list="desList" maxlength="60" value="Pharmacist"><datalist id="desList">${DESIGNATIONS.map(d => `<option value="${d}"></option>`).join('')}</datalist></div>
        <div class="pos-field"><label for="aJoin">Join date</label><input id="aJoin" type="date" value="${today()}"></div>
        <div class="pos-field md-span-2"><label for="aAddr">Address</label><textarea id="aAddr" rows="2" maxlength="500" placeholder="House / street, locality, city, PIN code"></textarea></div>
        <div class="pos-field md-span-2"><label for="aPw">Temporary password <small class="dl-muted">(minimum 12 characters)</small></label>
          <div class="st-pw"><input id="aPw" type="text" minlength="12" maxlength="128" autocomplete="new-password" value="${esc(pw)}" spellcheck="false"><button type="button" class="pos-btn pos-btn-sm" id="aGen">${I.refresh}<span>New</span></button><button type="button" class="pos-btn pos-btn-sm" id="aCopy">${I.copy}<span>Copy</span></button></div></div>
      </div>
      <p class="pos-form-msg" id="aErr"></p>
      <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="submit" class="pos-btn pos-btn-solid" id="aSave">${I.addUser}<span>Create account</span></button></div>
    </form>`, 'st-form-dlg');
  wirePhoto();
  $('aRole').onchange = () => { if (!$('aDes').value || Object.values(DES_FOR_ROLE).includes($('aDes').value)) $('aDes').value = DES_FOR_ROLE[$('aRole').value] || ''; };
  $('aGen').onclick = () => { $('aPw').value = genPassword(); };
  $('aCopy').onclick = async () => { try { await navigator.clipboard.writeText($('aPw').value); toast('Password copied.'); } catch { $('aPw').select(); } };
  $('addForm').onsubmit = async e => {
    e.preventDefault(); $('aErr').textContent = '';
    const body = { action: 'create', staff_id: $('aId').value.trim(), full_name: $('aName').value.trim(), phone: $('aPhone').value.trim(), address: $('aAddr').value.trim(), role: $('aRole').value, password: $('aPw').value, designation: $('aDes').value.trim(), join_date: $('aJoin').value };
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(body.staff_id)) return ($('aErr').textContent = 'Staff ID must be 3–32 letters, numbers, dots, dashes or underscores.');
    if (!body.full_name) return ($('aErr').textContent = 'Enter the staff member\'s full name.');
    if (body.phone && digits(body.phone).length < 10) return ($('aErr').textContent = 'Enter a valid 10-digit phone number.');
    if (body.password.length < 12) return ($('aErr').textContent = 'Temporary password must contain at least 12 characters.');
    $('aSave').disabled = true; $('aErr').textContent = 'Creating account…';
    try {
      const r = await edge(body);
      let id = r.staff?.id, warn = '';
      await loadStaff();
      if (!id) id = staff.find(s => String(s.staff_id).toLowerCase() === body.staff_id.toLowerCase())?.id;
      if (id && has31) {
        try {
          const photo = await uploadPhoto(id);
          await rpc('staff_update', { p_profile: id, p: { designation: body.designation, join_date: body.join_date || null, address: body.address, ...(photo ? { photo_path: photo } : {}) } });
        } catch (err) { warn = ` Details not saved: ${friendly(err)}`; }
      } else if (!has31 && (body.address || newPhoto)) warn = ' Address and photo are saved after migration 0031.';
      credentials(body, r.message + warn);
      refresh();
    } catch (err) { $('aErr').textContent = `Could not create staff account: ${err.message}`; $('aSave').disabled = false; }
  };
  $('aName').focus();
}
function credentials(b, msg) {
  dlg(`<h3 class="rt-dlg-title">${I.tick} Login created</h3><p>${esc(msg || 'Staff account created.')}</p>
    <div class="st-cred"><div><small>Name</small><b>${esc(b.full_name)}</b></div><div><small>Staff ID</small><b id="crId">${esc(b.staff_id)}</b></div><div><small>Temporary password</small><b id="crPw">${esc(b.password)}</b></div></div>
    <p class="dl-muted">Give these to the staff member in person. They must set their own password at first login. This password is not shown again.</p>
    <div class="st-foot"><button type="button" class="pos-btn" id="crCopy">${I.copy}<span>Copy</span></button><button type="button" class="pos-btn" id="crPrint">${I.print}<span>Print slip</span></button><button type="button" class="pos-btn pos-btn-solid" data-close>Done</button></div>`, 'st-form-dlg');
  $('crCopy').onclick = async () => { try { await navigator.clipboard.writeText(`Staff ID: ${b.staff_id}\nTemporary password: ${b.password}`); toast('Copied.'); } catch { toast('Copy failed — note the details down.', true); } };
  $('crPrint').onclick = () => printHTML(`<div style="font:13px Arial;padding:6mm"><b style="font-size:16px">Pallikkal Pharmacy — staff login</b><p>Name: <b>${esc(b.full_name)}</b><br>Staff ID: <b>${esc(b.staff_id)}</b><br>Temporary password: <b>${esc(b.password)}</b></p><p>Change this password at your first login. Do not share it.</p></div>`, 'Staff login', 'thermal');
}
$('addStaff').addEventListener('click', () => addStaff());

async function editStaff(s) {
  if (!has31) return note('Editing details needs migration 0031.', true);
  const cur = s.photo_path ? await photoUrl(s.photo_path) : '';
  let removePhoto = false;
  dlg(`<h3 class="rt-dlg-title">${I.pencil} Edit · ${esc(s.full_name)}</h3>
    <form id="eForm" class="md-form" novalidate>
      ${photoPicker(/^(https?:|blob:)/.test(cur) ? cur : '')}
      <div class="md-form-grid st-form">
        <div class="pos-field"><label for="eName">Full name</label><input id="eName" maxlength="120" value="${esc(s.full_name)}"></div>
        <div class="pos-field"><label for="ePhone">Phone number</label><input id="ePhone" type="tel" maxlength="30" value="${esc(s.phone || '')}"></div>
        <div class="pos-field"><label for="eDes">Designation</label><input id="eDes" list="desList2" maxlength="60" value="${esc(s.designation || '')}"><datalist id="desList2">${DESIGNATIONS.map(d => `<option value="${d}"></option>`).join('')}</datalist></div>
        <div class="pos-field"><label for="eJoin">Join date</label><input id="eJoin" type="date" value="${esc(ds(s.join_date))}"></div>
        <div class="pos-field"><label for="eShift">Shift</label><select id="eShift"><option value="">—</option>${Object.entries(SHIFTS).map(([k, l]) => `<option value="${k}"${s.shift === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="pos-field"><label for="eSal">Monthly salary (₹)</label><input id="eSal" type="number" min="0" step="100" value="${s.salary ?? ''}"></div>
        <div class="pos-field"><label for="eEmail">Email</label><input id="eEmail" type="email" maxlength="120" value="${esc(s.email || '')}"></div>
        <div class="pos-field"><label for="eDob">Date of birth</label><input id="eDob" type="date" value="${esc(ds(s.dob))}"></div>
        <div class="pos-field"><label for="eGender">Gender</label><select id="eGender"><option value="">—</option>${['female', 'male', 'other'].map(g => `<option value="${g}"${s.gender === g ? ' selected' : ''}>${g[0].toUpperCase() + g.slice(1)}</option>`).join('')}</select></div>
        <div class="pos-field"><label for="eQual">Qualification</label><input id="eQual" maxlength="120" placeholder="e.g. D.Pharm" value="${esc(s.qualification || '')}"></div>
        <div class="pos-field"><label for="eLic">Licence / registration no.</label><input id="eLic" maxlength="60" value="${esc(s.licence_no || '')}"></div>
        <div class="pos-field"><label for="eEmN">Emergency contact name</label><input id="eEmN" maxlength="120" value="${esc(s.emergency_name || '')}"></div>
        <div class="pos-field"><label for="eEmP">Emergency contact phone</label><input id="eEmP" type="tel" maxlength="30" value="${esc(s.emergency_phone || '')}"></div>
        <div class="pos-field md-span-2"><label for="eAddr">Address</label><textarea id="eAddr" rows="2" maxlength="500">${esc(s.address || '')}</textarea></div>
        <div class="pos-field md-span-2"><label for="eNotes">Notes</label><textarea id="eNotes" rows="2" maxlength="1000">${esc(s.notes || '')}</textarea></div>
      </div>
      <p class="dl-muted">Login role and status are changed from the ⋯ menu (Change role / Deactivate). Staff ID cannot be changed.</p>
      <p class="pos-form-msg" id="eErr"></p>
      <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="submit" class="pos-btn pos-btn-solid" id="eSave">Save changes</button></div>
    </form>`, 'st-form-dlg');
  wirePhoto(() => { removePhoto = true; });
  $('eForm').onsubmit = async e => {
    e.preventDefault(); $('eErr').textContent = ''; $('eSave').disabled = true;
    try {
      const photo = await uploadPhoto(s.id);
      const p = { full_name: $('eName').value.trim(), phone: $('ePhone').value.trim(), designation: $('eDes').value.trim(), join_date: $('eJoin').value || null, shift: $('eShift').value, salary: $('eSal').value,
        email: $('eEmail').value.trim(), dob: $('eDob').value || null, gender: $('eGender').value, qualification: $('eQual').value.trim(), licence_no: $('eLic').value.trim(),
        emergency_name: $('eEmN').value.trim(), emergency_phone: $('eEmP').value.trim(), address: $('eAddr').value.trim(), notes: $('eNotes').value.trim(),
        ...(photo ? { photo_path: photo } : removePhoto ? { photo_path: '' } : {}) };
      await rpc('staff_update', { p_profile: s.id, p });
      if (removePhoto && s.photo_path && !photo) sb.storage.from('staff-photos').remove([s.photo_path]).then(() => {}, () => {});
      $('puDlg').close(); toast('Staff details saved.'); refresh();
    } catch (err) { $('eErr').textContent = friendly(err); $('eSave').disabled = false; }
  };
}

// ---------------------------------------------------------------------------
// Password, status
// ---------------------------------------------------------------------------
function resetPassword(s) {
  const pw = genPassword();
  dlg(`<h3 class="rt-dlg-title">${I.key} Reset password · ${esc(s.full_name)}</h3>
    <p class="dl-muted">Sets a new temporary password and signs ${esc(s.full_name.split(' ')[0])} out. They must choose their own password at the next login.</p>
    <div class="pos-field"><label for="rPw">New temporary password</label><div class="st-pw"><input id="rPw" type="text" minlength="12" maxlength="128" value="${esc(pw)}" spellcheck="false"><button type="button" class="pos-btn pos-btn-sm" id="rGen">${I.refresh}<span>New</span></button></div></div>
    <p class="pos-form-msg" id="rErr"></p>
    <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="rGo">${I.key}<span>Reset password</span></button></div>`, 'st-form-dlg');
  $('rGen').onclick = () => { $('rPw').value = genPassword(); };
  $('rGo').onclick = async () => {
    const password = $('rPw').value;
    if (password.length < 12) return ($('rErr').textContent = 'Temporary password must contain at least 12 characters.');
    $('rGo').disabled = true;
    try { const r = await edge({ action: 'reset_password', profile_id: s.id, password }); credentials({ full_name: s.full_name, staff_id: s.staff_id, password }, r.message); refresh(); }
    catch (err) { $('rErr').textContent = /Unknown staff management action/.test(err.message) ? 'Deploy the updated admin-staff function (supabase functions deploy admin-staff) to reset passwords from here.' : err.message; $('rGo').disabled = false; }
  };
}
function toggleActive(s) {
  if (s.is_active) {
    dlg(`<h3 class="rt-dlg-title">${I.power} Deactivate ${esc(s.full_name)}?</h3>
      <p>${esc(s.full_name.split(' ')[0])} is signed out now and cannot log in until the login is activated again. Their bills, attendance and history stay.</p>
      <div class="pos-field"><label for="dReason">Reason</label><input id="dReason" maxlength="200" placeholder="e.g. Resigned / long leave"></div>
      <p class="pos-form-msg" id="dErr"></p>
      <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid st-danger-solid" id="dGo">${I.power}<span>Deactivate login</span></button></div>`, 'st-form-dlg');
    $('dGo').onclick = async () => {
      try { await rpc('staff_set_active', { p_profile: s.id, p_active: false, p_reason: $('dReason').value.trim() }); $('puDlg').close(); toast(`${s.full_name} deactivated.`); refresh(); }
      catch (err) { $('dErr').textContent = friendly(err); }
    };
    $('dReason').focus();
  } else {
    rpc('staff_set_active', { p_profile: s.id, p_active: true, p_reason: null }).then(() => { if ($('puDlg').open) $('puDlg').close(); toast(`${s.full_name} can log in again.`); refresh(); }, err => toast(friendly(err), true));
  }
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
async function markAttendance(date = today(), focusId = null) {
  if (!has31) return note('Attendance needs migration 0031.', true);
  let rows = [];
  try { rows = (await rpc('staff_attendance_day', { p_date: date })) || []; } catch (e) { return toast(friendly(e), true); }
  rows = rows.filter(r => r.joined || r.status);
  const st = new Map(rows.map(r => [r.profile_id, { status: r.source === 'manual' ? r.status : '', in: r.source === 'manual' ? hhmm(r.check_in) : '', out: r.source === 'manual' ? hhmm(r.check_out) : '', note: r.note || '', dirty: false }]));
  const future = date > today();
  dlg(`<div class="st-att-head"><h3 class="rt-dlg-title">${I.cal} Mark Attendance</h3>
      <div class="st-att-date"><button type="button" class="pos-btn pos-btn-sm" data-day="-1" aria-label="Previous day">‹</button><input id="attDate" type="date" value="${date}" max="${addDays(today(), 31)}"><button type="button" class="pos-btn pos-btn-sm" data-day="1" aria-label="Next day">›</button></div></div>
    <p class="dl-muted">${future ? 'Future date: only Leave, Holiday or Week off can be marked.' : 'A staff login on this day counts as <b>Present</b> automatically (shown as “Login”). Mark only to change it — absent, half day, leave, week off — or to record times for staff who do not log in.'}</p>
    <div class="st-att-sum" id="attSum"></div>
    <div class="st-att-tools"><button type="button" class="pos-btn pos-btn-sm" id="attAllP" ${future ? 'disabled' : ''}>${I.tick}<span>Mark everyone not marked as present</span></button><button type="button" class="pos-btn pos-btn-sm" id="attAllW">${I.cal}<span>Holiday for everyone</span></button></div>
    <div class="st-att-list" id="attList">${rows.map(r => `<div class="st-att-row${r.profile_id === focusId ? ' focus' : ''}" data-id="${esc(r.profile_id)}">
        <span class="st-who"><span class="st-av ${desCol(r.designation)[1]}">${esc(initials(r.full_name))}</span><span><b>${esc(r.full_name)}</b><small>${esc(r.staff_id)} · ${esc(r.designation)}</small></span></span>
        <span class="st-att-auto">${r.login_in ? `<span class="md-chip blue" title="First login ${esc(hm(r.login_in))}">Login ${esc(hm(r.login_in))}</span>` : ''}${r.source === 'leave' ? `<span class="md-chip pu">Approved leave (${esc(LEAVE_T[r.leave_type] || '')})</span>` : ''}</span>
        <span class="st-seg" role="group" aria-label="Status for ${esc(r.full_name)}">${Object.entries(ATT).map(([k, [l, c]]) => `<button type="button" data-s="${k}" title="${l}" ${future && !['leave', 'holiday', 'week_off'].includes(k) ? 'disabled' : ''}>${c}</button>`).join('')}<button type="button" data-s="" title="Clear (use login / leave)">Auto</button></span>
        <span class="st-times"><input type="time" data-f="in" aria-label="In time" title="In time"><input type="time" data-f="out" aria-label="Out time" title="Out time"></span>
        <input class="st-att-note" data-f="note" maxlength="200" placeholder="Note" aria-label="Note"></div>`).join('') || '<p class="dl-empty">No active staff on this date.</p>'}</div>
    <p class="pos-form-msg" id="attErr"></p>
    <div class="st-foot"><button type="button" class="pos-btn" data-close>Close</button><button type="button" class="pos-btn pos-btn-solid" id="attSave">${I.tick}<span>Save attendance</span></button></div>`, 'st-att-dlg');
  const eff = r => { const m = st.get(r.profile_id); return m.status || (r.source === 'leave' ? 'leave' : r.login_in ? 'present' : ''); };
  const paint = () => {
    for (const r of rows) {
      const el = $('attList').querySelector(`[data-id="${r.profile_id}"]`), m = st.get(r.profile_id), e = eff(r);
      el.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === m.status && (m.status || !e) || (b.dataset.s === '' && !m.status && !!e)));
      el.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('auto', !m.status && b.dataset.s === e && !!e));
      el.querySelector('[data-f="in"]').value = m.in; el.querySelector('[data-f="out"]').value = m.out; el.querySelector('[data-f="note"]').value = m.note;
      el.querySelector('.st-times').classList.toggle('dim', !['present', 'half_day'].includes(m.status));
      el.classList.toggle('dirty', m.dirty);
    }
    const c = { present: 0, half_day: 0, absent: 0, leave: 0, off: 0, none: 0 };
    for (const r of rows) { const e = eff(r); if (e === 'holiday' || e === 'week_off') c.off++; else if (e) c[e]++; else c.none++; }
    $('attSum').innerHTML = `<span class="md-chip in">Present ${c.present}</span><span class="md-chip low">Half day ${c.half_day}</span><span class="md-chip out">Absent ${c.absent}</span><span class="md-chip pu">Leave ${c.leave}</span><span class="md-chip off">Off ${c.off}</span>${c.none ? `<span class="md-chip st-nm">Not marked ${c.none}</span>` : ''}`;
  };
  paint();
  if (focusId) $('attList').querySelector('.focus')?.scrollIntoView({ block: 'center' });
  $('attList').onclick = e => { const b = e.target.closest('[data-s]'); if (!b || b.disabled) return; const id = b.closest('[data-id]').dataset.id, m = st.get(id); m.status = b.dataset.s; m.dirty = true; if (!['present', 'half_day'].includes(m.status)) { m.in = ''; m.out = ''; } paint(); };
  $('attList').oninput = e => { const f = e.target.dataset.f; if (!f) return; const m = st.get(e.target.closest('[data-id]').dataset.id); m[f] = e.target.value; m.dirty = true; if ((f === 'in' || f === 'out') && !m.status) m.status = 'present'; paint(); };
  $('attAllP').onclick = () => { for (const r of rows) { const m = st.get(r.profile_id); if (!eff(r)) { m.status = 'present'; m.dirty = true; } } paint(); };
  $('attAllW').onclick = () => { for (const r of rows) { const m = st.get(r.profile_id); if (r.source !== 'leave') { m.status = 'holiday'; m.dirty = true; m.in = m.out = ''; } } paint(); };
  $('attDate').onchange = () => markAttendance($('attDate').value || today());
  $('puPanel').querySelectorAll('[data-day]').forEach(b => { b.onclick = () => markAttendance(addDays($('attDate').value || today(), +b.dataset.day)); });
  $('attSave').onclick = async () => {
    const changes = rows.filter(r => st.get(r.profile_id).dirty).map(r => { const m = st.get(r.profile_id); return { profile_id: r.profile_id, status: m.status, check_in: m.in, check_out: m.out, note: m.note }; });
    if (!changes.length) return ($('attErr').textContent = 'Nothing changed.');
    $('attSave').disabled = true; $('attErr').textContent = '';
    try { const s = await rpc('staff_attendance_save', { p_date: date, p_rows: changes }); toast(`Attendance saved for ${dmy(date)}: ${s.present} present${s.leave ? `, ${s.leave} on leave` : ''}${s.absent ? `, ${s.absent} absent` : ''}.`); $('puDlg').close(); refresh(); }
    catch (err) { $('attErr').textContent = friendly(err); $('attSave').disabled = false; }
  };
}

async function attendanceReport(from = monthStart(today()), to = today()) {
  if (!has31) return note('Attendance needs migration 0031.', true);
  let rows = [];
  try { rows = (await rpc('staff_attendance_register', { p_from: from, p_to: to })) || []; } catch (e) { return toast(friendly(e), true); }
  const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const months = [0, 1, 2].map(k => [monthStart(today(), k), k ? monthEnd(today(), k) : today()]);
  dlg(`<div class="st-att-head"><h3 class="rt-dlg-title">${I.report} Attendance Report</h3>
      <div class="st-att-date"><select id="arMonth" aria-label="Month">${months.map(([f, t]) => `<option value="${f}|${t}"${f === from ? ' selected' : ''}>${new Date(f + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</option>`).join('')}<option value="custom">Custom…</option></select>
      <input type="date" id="arFrom" value="${from}"><input type="date" id="arTo" value="${to}"><button type="button" class="pos-btn pos-btn-sm" id="arGo">Show</button></div></div>
    <p class="dl-muted">${esc(dmy(from))} – ${esc(dmy(to))}. P present · A absent · H half day · L leave · W week off / holiday · ? not marked (no login, no mark). Click a day to mark it.</p>
    <div class="dl-table-wrap st-reg-wrap"><table class="st-reg"><thead><tr><th class="st-reg-name">Staff</th>${days.map(d => `<th data-d="${d}" class="${new Date(d + 'T00:00:00Z').getUTCDay() === 0 ? 'sun' : ''}">${+d.slice(8)}<small>${'SMTWTFS'[new Date(d + 'T00:00:00Z').getUTCDay()]}</small></th>`).join('')}<th>P</th><th>A</th><th>L</th><th>%</th><th>Hrs</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td class="st-reg-name"><b>${esc(r.full_name)}</b><small>${esc(r.staff_id)} · ${esc(r.designation)}</small></td>${days.map(d => { const v = r.days?.[d]; const a = ATT[v]; return `<td data-d="${d}" class="${a ? a[2] : v === 'not_marked' ? 'nm' : 'na'}" title="${esc(dmy(d))}: ${esc(a?.[0] || (v === 'not_marked' ? 'Not marked' : v === '-' ? 'Before joining' : ''))}">${a ? (v === 'holiday' || v === 'week_off' ? 'W' : a[1]) : v === 'not_marked' ? '?' : ''}</td>`; }).join('')}
      <td class="tot">${num(r.present)}</td><td class="tot">${r.absent}</td><td class="tot">${r.on_leave}</td><td class="tot">${r.pct === null ? '—' : `${r.pct}%`}</td><td class="tot">${num(r.hours)}</td></tr>`).join('') || `<tr><td colspan="${days.length + 6}" class="dl-empty">No staff.</td></tr>`}</tbody></table></div>
    <div class="st-foot"><button type="button" class="pos-btn" id="arCsv">${I.download}<span>CSV</span></button><button type="button" class="pos-btn" id="arPrint">${I.print}<span>Print</span></button><button type="button" class="pos-btn pos-btn-solid" data-close>Close</button></div>`, 'st-wide-dlg');
  $('arMonth').onchange = () => { if ($('arMonth').value !== 'custom') { const [f, t] = $('arMonth').value.split('|'); attendanceReport(f, t); } };
  $('arGo').onclick = () => { const f = $('arFrom').value, t = $('arTo').value; if (!f || !t || t < f) return toast('Choose valid dates.', true); attendanceReport(f, t); };
  $('puPanel').querySelector('.st-reg tbody').onclick = e => { const td = e.target.closest('td[data-d]'); if (td) markAttendance(td.dataset.d); };
  $('arCsv').onclick = () => csvDownload(`attendance-${from}-to-${to}.csv`, [['Staff ID', 'Name', 'Designation', ...days, 'Present', 'Absent', 'Leave', 'Half days', 'Attendance %', 'Hours'],
    ...rows.map(r => [r.staff_id, r.full_name, r.designation, ...days.map(d => { const v = r.days?.[d]; return ATT[v]?.[1] || (v === 'not_marked' ? '?' : ''); }), num(r.present), r.absent, r.on_leave, r.half_days, r.pct ?? '', num(r.hours)])]);
  $('arPrint').onclick = () => printHTML(`<style>body{font:10px Arial;margin:8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:2px 3px;text-align:center}td:first-child{text-align:left;white-space:nowrap}.A{color:#c4291f;font-weight:bold}.L{color:#6a3fd8}</style><h2 style="margin:0 0 4px">Attendance register · ${esc(dmy(from))} – ${esc(dmy(to))}</h2>
    <table><tr><th>Staff</th>${days.map(d => `<th>${+d.slice(8)}</th>`).join('')}<th>P</th><th>A</th><th>L</th><th>%</th></tr>${rows.map(r => `<tr><td>${esc(r.full_name)} (${esc(r.staff_id)})</td>${days.map(d => { const c = ATT[r.days?.[d]]?.[1] || (r.days?.[d] === 'not_marked' ? '?' : ''); return `<td class="${c}">${c}</td>`; }).join('')}<td>${num(r.present)}</td><td>${r.absent}</td><td>${r.on_leave}</td><td>${r.pct ?? ''}</td></tr>`).join('')}</table>`, 'Attendance register', 'a4');
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------
async function showLeaves(tab = 'pending') {
  if (!has31) return note('Leaves need migration 0031.', true);
  let rows = [];
  try { rows = (await rpc('staff_leaves_list', { p_status: tab === 'all' ? null : tab, p_from: null, p_to: null })) || []; } catch (e) { return toast(friendly(e), true); }
  dlg(`<div class="st-att-head"><h3 class="rt-dlg-title">${I.umbrella} Manage Leaves</h3><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="lvNew">${I.plusC}<span>Add leave</span></button></div>
    <div class="st-tabs" id="lvTabs">${[['pending', 'Requests'], ['approved', 'Approved'], ['all', 'All']].map(([k, l]) => `<button type="button" data-lt="${k}" class="${k === tab ? 'on' : ''}">${l}${k === 'pending' && num(ov?.pending_leaves) ? ` <em>${ov.pending_leaves}</em>` : ''}</button>`).join('')}</div>
    <div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv"><thead><tr><th>Staff</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead>
    <tbody id="lvRows">${rows.map(l => `<tr data-id="${esc(l.id)}"><td><b>${esc(l.full_name)}</b><small>${esc(l.staff_id)} · ${esc(l.designation)} · ${num(l.taken_this_year)} day(s) this year</small></td><td>${LEAVE_T[l.leave_type]}</td>
      <td>${esc(dmy(l.from_date))}${l.to_date !== l.from_date ? ` – ${esc(dmy(l.to_date))}` : ''}${l.reason ? `<small>${esc(l.reason)}</small>` : ''}</td><td>${l.half_day ? '½' : num(l.days)}</td>
      <td>${leaveChip(l.status)}<small>${l.decided_at ? `${esc(l.decided_by_name || '')} · ${esc(when(l.decided_at))}` : `asked ${esc(when(l.requested_at))}`}${l.decision_note ? ` · ${esc(l.decision_note)}` : ''}</small></td>
      <td class="c-c"><div class="st-lv-acts">${l.status === 'pending' ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-lv="approved">${I.tick}<span>Approve</span></button><button type="button" class="pos-btn pos-btn-sm" data-lv="rejected">${I.xs}<span>Reject</span></button>` : ''}${['pending', 'approved'].includes(l.status) ? `<button type="button" class="dl-act" data-lv="edit" title="Edit">${I.pencil}</button>` : ''}${l.status === 'approved' ? `<button type="button" class="pos-btn pos-btn-sm" data-lv="cancelled">Cancel</button>` : ''}</div></td></tr>`).join('')
      || `<tr><td colspan="6" class="dl-empty">${tab === 'pending' ? 'No leave requests waiting. 🎉' : 'No leaves.'}</td></tr>`}</tbody></table></div>`, 'st-wide-dlg');
  $('lvNew').onclick = () => leaveForm(null, null, () => showLeaves(tab));
  $('lvTabs').onclick = e => { const b = e.target.closest('[data-lt]'); if (b) showLeaves(b.dataset.lt); };
  $('lvRows').onclick = async e => {
    const b = e.target.closest('[data-lv]'); if (!b) return;
    const l = rows.find(x => x.id === b.closest('tr').dataset.id);
    if (b.dataset.lv === 'edit') return leaveForm(l, l.profile_id, () => showLeaves(tab));
    let noteText = null;
    if (b.dataset.lv === 'rejected') { noteText = prompt(`Reason for rejecting ${l.full_name}'s leave`); if (!noteText) return; }
    if (b.dataset.lv === 'cancelled' && !confirm(`Cancel ${l.full_name}'s approved leave (${dmy(l.from_date)})?`)) return;
    try { await rpc('staff_leave_decide', { p_id: l.id, p_status: b.dataset.lv, p_note: noteText }); toast(`Leave ${b.dataset.lv}.`); await refresh(); showLeaves(tab); }
    catch (err) { toast(friendly(err), true); }
  };
}
function leaveForm(l = null, profileId = null, back = null) {
  const opts = staff.filter(s => s.is_active || s.id === profileId).map(s => `<option value="${esc(s.id)}"${s.id === (l?.profile_id || profileId) ? ' selected' : ''}>${esc(s.full_name)} · ${esc(s.staff_id)}</option>`).join('');
  dlg(`<h3 class="rt-dlg-title">${I.umbrella} ${l ? 'Edit leave' : 'Add leave'}</h3>
    <div class="md-form-grid st-form">
      <div class="pos-field md-span-2"><label for="lvStaff">Staff member</label><select id="lvStaff" ${l ? 'disabled' : ''}>${opts}</select></div>
      <div class="pos-field"><label for="lvType">Leave type</label><select id="lvType">${Object.entries(LEAVE_T).map(([k, v]) => `<option value="${k}"${l?.leave_type === k ? ' selected' : ''}>${v} leave</option>`).join('')}</select></div>
      <div class="pos-field"><label for="lvStatus">Status</label><select id="lvStatus" ${l ? 'disabled' : ''}><option value="approved">Approved</option><option value="pending"${l?.status === 'pending' ? ' selected' : ''}>Request (approve later)</option></select></div>
      <div class="pos-field"><label for="lvFrom">From</label><input id="lvFrom" type="date" value="${esc(ds(l?.from_date) || today())}"></div>
      <div class="pos-field"><label for="lvTo">To</label><input id="lvTo" type="date" value="${esc(ds(l?.to_date) || today())}"></div>
      <label class="st-check md-span-2"><input type="checkbox" id="lvHalf" ${l?.half_day ? 'checked' : ''}> Half day</label>
      <div class="pos-field md-span-2"><label for="lvReason">Reason</label><input id="lvReason" maxlength="300" value="${esc(l?.reason || '')}" placeholder="e.g. Family function"></div>
    </div>
    <p class="dl-muted" id="lvDays"></p>
    <p class="pos-form-msg" id="lvErr"></p>
    <div class="st-foot"><button type="button" class="pos-btn" id="lvBack">Back</button><button type="button" class="pos-btn pos-btn-solid" id="lvSave">Save leave</button></div>`, 'st-form-dlg');
  const days = () => { const f = $('lvFrom').value, t = $('lvTo').value; if ($('lvHalf').checked) { $('lvTo').value = f; return 0.5; } return f && t && t >= f ? Math.round((Date.parse(t) - Date.parse(f)) / 864e5) + 1 : 0; };
  const paint = () => { const d = days(); $('lvDays').textContent = d ? `${d === 0.5 ? 'Half day' : `${d} day${d === 1 ? '' : 's'}`}` : 'Choose valid dates.'; };
  for (const id of ['lvFrom', 'lvTo', 'lvHalf']) $(id).addEventListener('change', paint);
  paint();
  $('lvBack').onclick = () => (back ? back() : $('puDlg').close());
  $('lvSave').onclick = async () => {
    $('lvErr').textContent = '';
    try {
      await rpc('staff_leave_save', { p_id: l?.id || null, p_profile: $('lvStaff').value, p_type: $('lvType').value, p_from: $('lvFrom').value, p_to: $('lvTo').value, p_half: $('lvHalf').checked, p_reason: $('lvReason').value.trim(), p_status: $('lvStatus').value });
      toast('Leave saved.'); await refresh(); if (back) back(); else $('puDlg').close();
    } catch (err) { $('lvErr').textContent = friendly(err); }
  };
}

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------
const PERM_LABEL = { 'sales.create': 'Create bills', 'sales.view': 'View sales', 'sales.discount': 'Give discounts', 'sales.return': 'Process returns', 'sales.void': 'Cancel bills',
  'customer.view': 'View customers', 'customer.manage': 'Manage customers', 'medicine.view': 'View medicines', 'medicine.manage': 'Manage medicines', 'medicine.cost.view': 'See purchase cost',
  'inventory.view': 'View stock', 'inventory.adjust': 'Adjust stock', 'purchase.view': 'View purchases', 'purchase.manage': 'Enter purchases', 'distributor.manage': 'Manage distributors',
  'finance.view': 'View finance', 'finance.manage': 'Manage finance', 'reports.view': 'View reports', 'reports.export': 'Export reports', 'staff.view': 'View staff', 'staff.manage': 'Manage staff',
  'staff.assign_admin': 'Create Admins', 'settings.view': 'View settings', 'settings.manage': 'Change settings', 'audit.view': 'Audit logs', 'security.view': 'Login attempts', 'whatsapp.manage': 'WhatsApp' };
async function showRoles(focusId = null) {
  if (!has31) return note('Roles & permissions need migration 0031.', true);
  let roles = [];
  try { roles = (await rpc('staff_roles_permissions')) || []; } catch (e) { return toast(friendly(e), true); }
  const assignable = roles.filter(r => r.assignable);
  const perms = [...new Set(roles.flatMap(r => r.permissions))].sort();
  const people = staff.filter(s => s.is_active && !s.is_self);
  dlg(`<h3 class="rt-dlg-title">${I.shield} Assign Roles &amp; Permissions</h3>
    <p class="dl-muted">The <b>login role</b> decides which pages and actions a person can use. The <b>designation</b> is the job title shown on this page. A role change signs the person out so it applies at their next login.</p>
    <div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv"><thead><tr><th>Staff</th><th>Login role</th><th>Designation</th><th></th></tr></thead>
    <tbody id="roRows">${people.map(s => `<tr data-id="${esc(s.id)}" class="${s.id === focusId ? 'focus' : ''}"><td><span class="st-who">${avatar(s)}<span><b>${esc(s.full_name)}</b><small>${esc(s.staff_id)}</small></span></span></td>
      <td>${s.can_manage ? `<select data-ro="role" aria-label="Login role for ${esc(s.full_name)}">${(assignable.some(r => r.code === s.role) ? assignable : [{ code: s.role, name: s.role_name }, ...assignable]).map(r => `<option value="${r.code}"${r.code === s.role ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>` : `<b>${esc(s.role_name)}</b>`}</td>
      <td>${s.can_manage ? `<input data-ro="des" list="desList3" maxlength="60" value="${esc(s.designation || '')}" aria-label="Designation for ${esc(s.full_name)}">` : esc(s.designation)}</td>
      <td class="c-c">${s.can_manage ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-ro="save" disabled>Save</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="dl-empty">No staff to change.</td></tr>'}</tbody></table></div>
    <datalist id="desList3">${DESIGNATIONS.map(d => `<option value="${d}"></option>`).join('')}</datalist>
    <h4 class="st-subh">What each role can do</h4>
    <div class="dl-table-wrap st-perm-wrap"><table class="st-perm"><thead><tr><th>Permission</th>${roles.map(r => `<th>${esc(r.name)}<small>${r.staff} active</small></th>`).join('')}</tr></thead>
    <tbody>${perms.map(p => `<tr><td>${esc(PERM_LABEL[p] || p)}</td>${roles.map(r => `<td>${r.permissions.includes(p) ? `<span class="st-yes">${I.tick}</span>` : '<span class="st-no">–</span>'}</td>`).join('')}</tr>`).join('')}
      <tr><td>Pages</td>${roles.map(r => `<td class="st-pages">${esc({ super_admin: 'All', admin: 'All', pharmacist: 'Billing, sales, stock, purchases', billing_staff: 'Billing, sales, customers', inventory_staff: 'Medicines, stock, purchases', delivery_person: 'Delivery only' }[r.code] || '')}</td>`).join('')}</tr></tbody></table></div>`, 'st-wide-dlg');
  fillPhotos($('puPanel'));
  if (focusId) $('roRows').querySelector('.focus')?.scrollIntoView({ block: 'center' });
  $('roRows').oninput = $('roRows').onchange = e => { const tr = e.target.closest('tr'); if (tr && e.target.dataset.ro !== 'save') tr.querySelector('[data-ro="save"]').disabled = false; };
  $('roRows').onclick = async e => {
    const b = e.target.closest('[data-ro="save"]'); if (!b) return;
    const tr = b.closest('tr'), s = staff.find(x => x.id === tr.dataset.id), newRole = tr.querySelector('[data-ro="role"]').value, des = tr.querySelector('[data-ro="des"]').value.trim();
    if (newRole !== s.role && !confirm(`Change ${s.full_name}'s login role from ${s.role_name} to ${ROLE_NAME[newRole]}? They will be signed out.`)) return;
    b.disabled = true;
    try {
      if (newRole !== s.role) await rpc('staff_set_role', { p_profile: s.id, p_role: newRole });
      if (des !== (s.designation || '')) await rpc('staff_update', { p_profile: s.id, p: { designation: des } });
      toast(`${s.full_name} updated.`); await refresh(); showRoles(s.id);
    } catch (err) { toast(friendly(err), true); b.disabled = false; }
  };
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------
const PERF_P = { month: ['This month', () => [monthStart(today()), today()]], last: ['Last month', () => [monthStart(today(), 1), monthEnd(today(), 1)]], d30: ['Last 30 days', () => [addDays(today(), -29), today()]], d90: ['Last 90 days', () => [addDays(today(), -89), today()]] };
async function showPerf(k = 'month', sort = 'sales') {
  if (!has31) return note('Performance needs migration 0031.', true);
  const [from, to] = PERF_P[k][1]();
  let rows = [];
  try { rows = (await rpc('staff_performance', { p_from: from, p_to: to })) || []; } catch (e) { return toast(friendly(e), true); }
  const key = { sales: r => num(r.sales), bills: r => num(r.bills), att: r => num(r.attendance_pct), hours: r => num(r.hours), deliveries: r => num(r.deliveries) }[sort];
  rows.sort((a, b) => key(b) - key(a));
  const maxS = Math.max(1, ...rows.map(r => num(r.sales)));
  dlg(`<div class="st-att-head"><h3 class="rt-dlg-title">${I.star} Staff Performance</h3><div class="st-att-date"><select id="pfP" aria-label="Period">${Object.entries(PERF_P).map(([kk, [l]]) => `<option value="${kk}"${kk === k ? ' selected' : ''}>${l}</option>`).join('')}</select><select id="pfS" aria-label="Sort">${[['sales', 'By sales'], ['bills', 'By bills'], ['att', 'By attendance'], ['hours', 'By hours'], ['deliveries', 'By deliveries']].map(([v, l]) => `<option value="${v}"${v === sort ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <p class="dl-muted">${esc(dmy(from))} – ${esc(dmy(to))}. Bills and sales are counted for the person who billed; deliveries for the rider; attendance from logins and marks.</p>
    <div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv st-perf"><thead><tr><th>#</th><th>Staff</th><th class="c-r">Bills</th><th>Sales</th><th class="c-r">Avg bill</th><th class="c-r">Returns</th><th class="c-r">Purchases</th><th class="c-r">Deliveries</th><th class="c-r">Attendance</th><th class="c-r">Hours</th><th>Last login</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td><span class="pur-rank r${Math.min(i + 1, 5)}">${i + 1}</span></td><td><b>${esc(r.full_name)}</b><small>${esc(r.staff_id)} · ${esc(r.designation)}${r.is_active ? '' : ' · inactive'}</small></td>
      <td class="c-r">${count(r.bills)}</td><td><div class="st-bar"><span style="width:${num(r.sales) / maxS * 100}%"></span></div><b>${rupees(r.sales)}</b></td><td class="c-r">${num(r.bills) ? rupees(r.avg_bill) : '—'}</td>
      <td class="c-r">${r.returns ? `${r.returns}<small>${rupees(r.returns_value)}</small>` : '—'}</td><td class="c-r">${r.purchases || '—'}</td><td class="c-r">${r.deliveries || '—'}</td>
      <td class="c-r">${r.attendance_pct === null ? '—' : `${num(r.attendance_pct)}%`}<small>${num(r.days_present)} / ${r.working_days} days</small></td><td class="c-r">${num(r.hours)}</td><td>${r.last_login ? esc(when(r.last_login)) : '—'}</td></tr>`).join('') || '<tr><td colspan="11" class="dl-empty">No staff.</td></tr>'}</tbody></table></div>
    <div class="st-foot"><button type="button" class="pos-btn" id="pfCsv">${I.download}<span>CSV</span></button><button type="button" class="pos-btn pos-btn-solid" data-close>Close</button></div>`, 'st-wide-dlg');
  $('pfP').onchange = () => showPerf($('pfP').value, $('pfS').value);
  $('pfS').onchange = () => showPerf($('pfP').value, $('pfS').value);
  $('pfCsv').onclick = () => csvDownload(`staff-performance-${from}-to-${to}.csv`, [['Staff ID', 'Name', 'Designation', 'Bills', 'Sales', 'Average bill', 'Returns', 'Returns value', 'Purchases', 'Deliveries', 'Days present', 'Working days', 'Attendance %', 'Hours', 'Last login'],
    ...rows.map(r => [r.staff_id, r.full_name, r.designation, r.bills, num(r.sales), num(r.avg_bill), r.returns, num(r.returns_value), r.purchases, r.deliveries, num(r.days_present), r.working_days, r.attendance_pct ?? '', num(r.hours), r.last_login ? whenY(r.last_login) : ''])]);
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------
function csvDownload(name, rows) {
  const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const IMPORT_COLS = ['staff_id', 'full_name', 'phone', 'role', 'designation', 'join_date', 'address'];
function showImport() {
  dlg(`<h3 class="rt-dlg-title">${I.upload} Import Staff</h3>
    <p class="dl-muted">Create many logins at once from a CSV file (Excel → Save as CSV). Columns: <code>${IMPORT_COLS.join(', ')}</code>. Role is one of <code>${ROLE_OPTS.map(r => r[0]).join(', ')}</code>; join date as YYYY-MM-DD. A temporary password is made for each person — download them at the end.</p>
    <div class="st-foot st-foot-l"><button type="button" class="pos-btn" id="imTpl">${I.download}<span>Download template</span></button><button type="button" class="pos-btn pos-btn-solid" id="imPick">${I.upload}<span>Choose CSV file</span></button></div>
    <div id="imOut"></div>`, 'st-wide-dlg');
  $('imTpl').onclick = () => csvDownload('staff-import-template.csv', [IMPORT_COLS, ['EMP-013', 'Lakshmi Nair', '9847012345', 'billing_staff', 'Cashier', today(), 'Thodupuzha']]);
  $('imPick').onclick = () => { $('importFile').value = ''; $('importFile').click(); };
}
$('importBtn').addEventListener('click', showImport);
$('importFile').addEventListener('change', async () => {
  const f = $('importFile').files?.[0]; if (!f) return;
  if (f.size > 1024 * 1024) return toast('CSV file is too large (1 MB max).', true);
  const rows = parseCsv(await f.text());
  if (!rows.length) return toast('The file is empty.', true);
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const idx = Object.fromEntries(IMPORT_COLS.map(c => [c, head.indexOf(c)]));
  if (idx.staff_id < 0 || idx.full_name < 0 || idx.role < 0) return toast('The CSV needs at least staff_id, full_name and role columns.', true);
  const seen = new Set(staff.map(s => String(s.staff_id).toLowerCase()));
  const items = rows.slice(1).map((r, i) => {
    const g = c => idx[c] >= 0 ? String(r[idx[c]] || '').trim() : '';
    const it = { line: i + 2, staff_id: g('staff_id'), full_name: g('full_name'), phone: g('phone'), role: g('role').toLowerCase().replace(/\s+/g, '_'), designation: g('designation'), join_date: g('join_date'), address: g('address'), errors: [] };
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(it.staff_id)) it.errors.push('Staff ID');
    else if (seen.has(it.staff_id.toLowerCase())) it.errors.push('Staff ID already used');
    seen.add(it.staff_id.toLowerCase());
    if (!it.full_name) it.errors.push('Name');
    if (!ROLE_OPTS.some(r2 => r2[0] === it.role)) it.errors.push('Role');
    if (it.phone && digits(it.phone).length < 10) it.errors.push('Phone');
    if (it.join_date && !/^\d{4}-\d{2}-\d{2}$/.test(it.join_date)) it.errors.push('Join date');
    if (!it.designation) it.designation = DES_FOR_ROLE[it.role] || '';
    return it;
  });
  if (!items.length) return toast('No staff rows in the file.', true);
  const good = items.filter(x => !x.errors.length);
  $('imOut').innerHTML = `<h4 class="st-subh">${good.length} of ${items.length} row(s) ready</h4>
    <div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv"><thead><tr><th>Line</th><th>Staff ID</th><th>Name</th><th>Role</th><th>Designation</th><th>Check</th></tr></thead><tbody id="imRows">${items.map(x => `<tr data-line="${x.line}"><td>${x.line}</td><td>${esc(x.staff_id)}</td><td>${esc(x.full_name)}<small>${esc(x.phone)}</small></td><td>${esc(ROLE_NAME[x.role] || x.role)}</td><td>${esc(x.designation)}</td><td class="im-st">${x.errors.length ? `<span class="md-chip out">Fix: ${esc(x.errors.join(', '))}</span>` : '<span class="md-chip in">Ready</span>'}</td></tr>`).join('')}</tbody></table></div>
    <div class="st-foot"><button type="button" class="pos-btn pos-btn-solid" id="imGo" ${good.length ? '' : 'disabled'}>${I.addUser}<span>Create ${good.length} login(s)</span></button></div>`;
  $('imGo').onclick = async () => {
    $('imGo').disabled = true;
    const creds = [];
    for (const it of good) {
      const cell = $('imRows').querySelector(`[data-line="${it.line}"] .im-st`);
      cell.innerHTML = '<span class="md-chip low">Creating…</span>';
      const password = genPassword();
      try {
        const r = await edge({ action: 'create', staff_id: it.staff_id, full_name: it.full_name, phone: it.phone, role: it.role, password, address: it.address, designation: it.designation, join_date: it.join_date });
        creds.push([it.staff_id, it.full_name, password]);
        if (has31 && r.staff?.id) await rpc('staff_update', { p_profile: r.staff.id, p: { designation: it.designation, join_date: it.join_date || null, address: it.address } }).catch(() => {});
        cell.innerHTML = '<span class="md-chip in">Created</span>';
      } catch (err) { cell.innerHTML = `<span class="md-chip out">${esc(err.message)}</span>`; }
    }
    await refresh();
    if (creds.length) {
      $('imOut').insertAdjacentHTML('beforeend', `<p class="st-cred-note">${I.key} ${creds.length} login(s) created. Download the temporary passwords now — they are not shown again.</p><div class="st-foot"><button type="button" class="pos-btn pos-btn-solid" id="imCred">${I.download}<span>Download passwords (CSV)</span></button></div>`);
      $('imCred').onclick = () => csvDownload(`staff-logins-${today()}.csv`, [['Staff ID', 'Name', 'Temporary password'], ...creds]);
    }
  };
});
$('exportMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-exp]'); if (!b) return;
  closePops();
  const k = b.dataset.exp, rows = filtered();
  if (k === 'csv') return csvDownload(`staff-${today()}.csv`, [['Staff ID', 'Name', 'Phone', 'Login role', 'Designation', 'Join date', 'Status', 'Today', 'Shift', 'Email', 'Address', 'Emergency contact', 'Qualification', 'Licence no.', 'Last login'],
    ...rows.map(s => [s.staff_id, s.full_name, s.phone || '', s.role_name, s.designation, ds(s.join_date), s.is_active ? 'Active' : 'Inactive', ATT[s.today_status]?.[0] || '', SHIFTS[s.shift] || '', s.email || '', s.address || '', [s.emergency_name, s.emergency_phone].filter(Boolean).join(' '), s.qualification || '', s.licence_no || '', s.last_login ? whenY(s.last_login) : ''])]);
  if (k === 'print') return printHTML(`<style>body{font:11px Arial;margin:10px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:4px;text-align:left}th{background:#0f766e;color:#fff}</style><h2 style="margin:0">Pallikkal Pharmacy — Staff list</h2><p>${esc(dmy(today()))} · ${rows.length} staff</p>
    <table><tr><th>Emp. ID</th><th>Name</th><th>Designation</th><th>Login role</th><th>Phone</th><th>Join date</th><th>Status</th></tr>${rows.map(s => `<tr><td>${esc(s.staff_id)}</td><td>${esc(s.full_name)}</td><td>${esc(s.designation)}</td><td>${esc(s.role_name)}</td><td>${esc(s.phone || '')}</td><td>${esc(dmy(s.join_date))}</td><td>${s.is_active ? 'Active' : 'Inactive'}</td></tr>`).join('')}</table>`, 'Staff list', 'a4');
  if (k === 'att') return attendanceReport().then(() => $('arCsv')?.click());
  if (k === 'perf') return showPerf().then(() => $('pfCsv')?.click());
});
$('moreMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-more]'); if (!b) return;
  closePops();
  ({ attendance: () => markAttendance(), leaves: () => showLeaves(), roles: () => showRoles(), report: () => attendanceReport(), perf: () => showPerf(), acts: showActs, refresh: () => refresh().then(() => toast('Staff list refreshed.')) })[b.dataset.more]();
});
$('quick').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (!b) return; ({ attendance: () => markAttendance(), leaves: () => showLeaves(), roles: () => showRoles(), report: () => attendanceReport(), perf: () => showPerf() })[b.dataset.q](); });

// ---------------------------------------------------------------------------
// Bell, load
// ---------------------------------------------------------------------------
function notify() {
  const items = [];
  if (num(ov?.pending_leaves)) items.push({ tone: 'warn', title: `${ov.pending_leaves} leave request(s) waiting`, detail: 'Manage Leaves', href: 'staff.html?show=leaves' });
  if (num(ov?.not_marked)) items.push({ tone: 'info', title: `${ov.not_marked} staff not marked today`, detail: 'Mark Attendance', href: 'staff.html?show=attendance' });
  if (num(ov?.absent)) items.push({ tone: 'info', title: `${ov.absent} staff absent today`, detail: 'Mark Attendance', href: 'staff.html?show=attendance' });
  if (num(ov?.password_change)) items.push({ tone: 'info', title: `${ov.password_change} staff have not set their own password yet`, detail: 'They must change it at first login', href: 'staff.html' });
  setNotifications(items);
}
async function refresh() {
  await loadStaff();
  await loadOverview();
  const roles = [...new Set(staff.map(s => s.designation).filter(Boolean))].sort();
  const cur = $('fRole').value;
  $('fRole').innerHTML = `<option value="">All Roles</option>${roles.map(r => `<option value="${esc(r)}"${r === cur ? ' selected' : ''}>${esc(r)}</option>`).join('')}`;
  renderKpis(); render(); drawDist();
  await Promise.all([loadTrend(), loadActs()]);
  notify();
}
await refresh();
const show = new URLSearchParams(location.search).get('show');
if (show === 'attendance') markAttendance(); else if (show === 'leaves') showLeaves(); else if (show === 'report') attendanceReport(); else if (show === 'roles') showRoles(); else if (show === 'perf') showPerf(); else if (show === 'add') addStaff();
let rz;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { compact = matchMedia('(max-width: 560px)').matches; drawTrend(); }, 150); });
