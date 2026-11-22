// WhatsApp Management — Pallikkal Pharmacy design.
// Free "one-tap" sending: every message is prepared and logged in the database (0030), staff open it
// in WhatsApp with one tap (wa.me link, text filled in) and press Send. Invoices go out as a private
// link to invoice-view.html (view / download PDF, no login). Bulk campaigns (text + photo) run one
// chat at a time with the chosen interval, can be paused and continued from any device.
// KPIs: messages sent (this month vs last), invoices shared (share rate), pending to send, active customers.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('whatsapp', 'WhatsApp', { layout: 'brand' });
const $ = id => document.getElementById(id);
const role = String(prof?.role || '').toLowerCase();
const isAdmin = ['super_admin', 'admin'].includes(role);
if (!prof?.branch_id) { $('view').innerHTML = '<p class="notice">Your profile has no assigned branch.</p>'; throw new Error('Missing branch'); }
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money2 = v => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupees = v => `₹${money2(v)}`;
const count = n => new Intl.NumberFormat('en-IN').format(num(n));
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const monthStart = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10); };
const monthEnd = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - back, 0)).toISOString().slice(0, 10); };
const timeOnly = v => new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ }).toUpperCase();
const dayOf = v => new Date(v).toLocaleDateString('en-CA', { timeZone: TZ });
const when = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, s => s.toUpperCase()) : '—';
const shortWhen = v => dayOf(v) === today() ? timeOnly(v) : dayOf(v) === addDays(today(), -1) ? 'Yesterday' : new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: TZ });
const ago = v => { const s = Math.max(0, (Date.now() - new Date(v)) / 1000); return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} hr ago` : `${Math.round(s / 86400)} days ago`; };
const digits = v => String(v || '').replace(/\D/g, '');
const waNumber = v => { let d = digits(v); if (d.length === 10) d = `91${d}`; else if (d.length === 11 && d.startsWith('0')) d = `91${d.slice(1)}`; return d.length >= 10 && d.length <= 15 ? d : ''; };
const prettyPhone = v => { const d = digits(v); return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : (v || ''); };
const initials = n => String(n || '?').replace(/[^A-Za-z\s]/g, ' ').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '#';
const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'Customer';
const fmtDuration = seconds => { const s = Math.max(0, Math.ceil(seconds)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return [h ? `${h} hr` : '', m ? `${m} min` : '', r || (!h && !m) ? `${r} sec` : ''].filter(Boolean).join(' '); };
const AV = ['g', 'p', 'b', 'a', 'r', 't'];
const avCls = s => AV[[...String(s || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.7),
  chat: svg('<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.4A8.5 8.5 0 1 1 21 12Z"/><circle cx="8.5" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="15.5" cy="12" r=".9" fill="currentColor"/>', 1.8),
  ticks: svg('<path d="m2 13 4 4 8-9"/><path d="m11 16 1 1 8-9"/>', 2),
  tick: svg('<path d="m5 12 4 4 10-10"/>', 2.2),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 2),
  users: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.3c2.9.3 5 2.6 5 5.7"/>', 1.8),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>', 1.9),
  box: svg('<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>', 1.8),
  card: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>', 1.9),
  pill: svg('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>', 1.9),
  mega: svg('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12"/>', 1.9),
  doc: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>', 1.9),
  truck: svg('<path d="M3 6h11v10H3Z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', 1.8),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2.2),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 1.9),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', 2.2),
  checkF: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12.2 3 3 6-6.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  skip: svg('<path d="m5 4 10 8-10 8Z"/><path d="M19 5v14"/>', 1.9),
  reply: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>', 1.6),
  photo: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>', 1.9),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 1.9),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', 1.9),
  play: svg('<path d="m7 4 13 8-13 8Z"/>', 1.9),
  stop: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>', 1.9),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 1.9),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>', 2),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>', 1.9),
  share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>', 1.9),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const KIND = { invoice: ['Invoice', 'k-inv'], order_update: ['Order Update', 'k-ord'], delivery: ['Order Delivery', 'k-del'], payment_reminder: ['Payment Reminder', 'k-pay'],
  refill_reminder: ['Refill Reminder', 'k-ref'], health: ['Health Campaign', 'k-hea'], offer: ['Offer', 'k-off'], custom: ['Message', 'k-cus'], customer_query: ['Customer Query', 'k-qry'] };
const STATUS = { sent: ['Sent', 'st-sent', I.checkF], queued: ['Waiting to send', 'st-q', I.clock], skipped: ['Skipped', 'st-skip', I.skip], failed: ['Not sent', 'st-fail', I.xs], received: ['Reply', 'st-in', I.reply] };
const CSTATUS = { active: ['Active', 'in'], paused: ['Paused', 'low'], completed: ['Completed', 'blue'], cancelled: ['Cancelled', 'off'], draft: ['Draft', 'off'] };
const PERIODS = { today: 'Today', week: 'Last 7 Days', month: 'This Month', last: 'Last Month', d90: 'Last 90 Days', all: 'All Time' };
const periodRange = k => { const t = today(); return k === 'today' ? [t, t] : k === 'week' ? [addDays(t, -6), t] : k === 'last' ? [monthStart(t, 1), monthEnd(t, 1)] : k === 'd90' ? [addDays(t, -89), t] : k === 'all' ? ['2000-01-01', t] : [monthStart(t), t]; };
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
const QUICK = [
  ['order', 'g', I.box, 'Send Order Update', 'Share invoice or order status'],
  ['payment', 'a', I.card, 'Payment Reminder', 'Remind pending payments'],
  ['refill', 'r', I.pill, 'Refill Reminder', 'Medicine refill / next dose reminder'],
  ['campaign', 'p', I.mega, 'Health Campaign', 'Send health tips or offers'],
  ['custom', 'g', I.chat, 'Custom Message', 'Send a personalized message']
];
const QUICK_M = { order: 'Send\nOrder Update', payment: 'Payment\nReminder', refill: 'Refill\nReminder', campaign: 'Health\nCampaign', custom: 'Custom\nMessage' };

let settings = { auto_invoice: true, open_after_bill: true, attach_link_offers: true, shop: 'Pallikkal Pharmacy', can_manage: isAdmin };
let has30 = true, ov = null, templates = [], campaigns = [], convs = [], activity = [], actTotal = 0, actPage = 0;
let customers = null;
const PER = 10;
const siteBase = () => location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');

$('view').innerHTML = `
<div class="pos dl md pur wa">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic wa-title-ic">${I.wa}</span>
      <div><h1>WhatsApp Management</h1><p>Communicate with customers, send orders, reminders, and promotional updates via WhatsApp.</p></div></div>
    <div class="pos-head-actions md-head-actions wa-head-actions">
      <button type="button" class="pos-btn pos-btn-solid" id="newMsg">${I.plusC}<span>New Message</span></button>
      <button type="button" class="pos-btn wa-btn-navy" id="newCampaign">${I.plusC}<span>New Campaign</span></button>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn wa-btn-navy" id="moreBtn" aria-expanded="false">${I.dots}<span>More</span></button>
        <div class="dl-pop md-menu ds-menu wa-more" id="moreMenu" hidden>
          <button type="button" data-more="queue">${I.clock}<span>Waiting to send <b id="mQueue"></b></span></button>
          <button type="button" data-more="unshared">${I.doc}<span>Bills not shared yet</span></button>
          <button type="button" data-more="campaigns">${I.mega}<span>All campaigns</span></button>
          <button type="button" data-more="templates">${I.doc}<span>Message templates</span></button>
          <button type="button" data-more="conversations">${I.chat}<span>All conversations</span></button>
          <button type="button" data-more="export">${I.download}<span>Export activity (CSV)</span></button>
          <button type="button" data-more="settings">${I.gear}<span>WhatsApp settings</span></button>
          <button type="button" data-more="help">${I.info}<span>How sending works</span></button>
          <a href="customers.html">${I.users}<span>Customers &amp; consent</span></a>
        </div></div>
    </div>
  </section>

  <section class="dz-kpis md-kpis wa-kpis">
    ${KPI('green', I.chat, 'Messages Sent <em>(This Month)</em>', 'kSent')}
    ${KPI('blue', I.ticks, 'Invoices Shared', 'kShared')}
    ${KPI('amber', I.clock, 'Waiting to Send', 'kPending')}
    ${KPI('purple', I.users, 'Active Customers', 'kActive')}
  </section>
  <div id="msg" class="md-msg" role="status"></div>

  <div class="wa-grid">
    <section class="pos-card wa-quick">
      <div class="dl-card-head"><h2><span class="wa-h-ic wa-bolt">${I.bolt}</span>Quick Actions</h2></div>
      <div class="wa-qlist" id="quick">${QUICK.map(([k, c, ic, t, d]) => `<button type="button" class="wa-q ${c}" data-quick="${k}"><span class="wa-q-ic">${ic}</span><span class="wa-q-t"><b>${t}</b><small>${d}</small><b class="wa-q-m">${QUICK_M[k].replace('\n', '<br>')}</b></span>${I.chev}</button>`).join('')}</div>
    </section>

    <section class="pos-card wa-convs">
      <div class="dl-card-head"><h2><span class="wa-h-ic">${I.chat}</span>Recent Conversations</h2><button type="button" class="dl-link" id="convAll">View All ${I.arrow}</button></div>
      <label class="dl-search wa-search">${I.search}<input id="convQ" type="search" placeholder="Search by customer name or mobile number..." autocomplete="off" aria-label="Search conversations"></label>
      <div class="wa-clist" id="convList"><p class="dl-empty">Loading…</p></div>
    </section>

    <div class="wa-side">
      <section class="pos-card wa-camps">
        <div class="dl-card-head"><h2><span class="wa-h-ic">${I.mega}</span><span><span class="wa-l-full">WhatsApp </span>Campaigns</span></h2><button type="button" class="dl-link" id="campAll">View All ${I.arrow}</button></div>
        <div class="wa-camp-list" id="campList"><p class="dl-empty">Loading…</p></div>
      </section>
      <section class="pos-card wa-tpls">
        <div class="dl-card-head"><h2><span class="wa-h-ic">${I.doc}</span><span><span class="wa-l-full">Message </span>Templates</span></h2><button type="button" class="dl-link" id="tplAll"><span class="wa-l-full">Manage Templates</span><span class="wa-l-short">Manage</span> ${I.arrow}</button></div>
        <div class="wa-tpl-list" id="tplList"><p class="dl-empty">Loading…</p></div>
      </section>
    </div>
  </div>

  <section class="pos-card wa-activity">
    <div class="dl-card-head"><h2><span class="wa-h-ic">${I.list}</span>Recent WhatsApp Activity</h2>
      <div class="wa-act-tools">
        <label class="dl-search wa-act-search">${I.search}<input id="actQ" type="search" placeholder="Search customer, phone, bill or text…" autocomplete="off" aria-label="Search activity"></label>
        <label class="dl-select pur-mini"><select id="actKind" aria-label="Type"><option value="">All Types</option>${Object.entries(KIND).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="dl-select pur-mini"><select id="actStatus" aria-label="Status"><option value="">Any Status</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="dl-select pur-mini"><select id="actPeriod" aria-label="Period">${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}"${k === 'month' ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div></div>
    <div class="dl-table-wrap"><table class="dl-table wa-table"><thead><tr>
      <th class="c-no">#</th><th class="c-at">Date &amp; Time</th><th class="c-cust">Customer</th><th class="c-type">Type</th><th class="c-msg">Message (Preview)</th><th class="c-st">Status</th><th class="c-act"></th>
    </tr></thead><tbody id="actRows"><tr><td colspan="7" class="dl-empty">Loading…</td></tr></tbody></table></div>
    <div class="dl-pager md-pager"><span id="actInfo"></span><div id="actPager"></div></div>
  </section>
</div>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg wa-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<dialog id="runDlg" class="pos-dialog dl-dialog sl-dlg wa-dlg wa-run-dlg"><div id="runPanel"></div></dialog>
<div class="dl-pop md-menu ds-menu wa-row-menu" id="rowMenu" hidden></div>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });

let toastT;
const toast = (m, bad = false, action) => {
  const el = $('toast');
  el.innerHTML = `<span>${esc(m)}</span>${action ? `<button type="button" class="wa-toast-act">${esc(action[0])}</button>` : ''}`;
  el.className = `dl-toast show${bad ? ' bad' : ''}`;
  if (action) el.querySelector('.wa-toast-act').onclick = () => { el.className = 'dl-toast'; action[1](); };
  clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : action ? 8000 : 4500);
};
const note = (m, bad) => { $('msg').textContent = m; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; };
$('puDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('puDlg')) $('puDlg').close(); });
const dlg = (html, cls = '') => { $('puPanel').innerHTML = html; $('puDlg').className = `pos-dialog dl-dialog md-wide sl-dlg wa-dlg ${cls}`; if (!$('puDlg').open) $('puDlg').showModal(); };
const missing = e => /whatsapp_|_wa_|function|schema cache|does not exist|Could not find/i.test(e?.message || '');
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }
const needs30 = () => note('Run database migration 0030 (WhatsApp Management) to log messages, share invoices, run campaigns and keep templates. Until then messages open in WhatsApp but are not recorded.', true);

// ---------------------------------------------------------------------------
// Sending (one tap): open WhatsApp with the text, then mark Sent
// ---------------------------------------------------------------------------
const waUrl = (phone, text) => `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
function openChat(phone, text) {
  const w = window.open(waUrl(phone, text), '_blank', 'noopener');
  return w !== null || true;   // noopener returns null in most browsers even when the tab opened
}
async function sendNow(m, { quiet = false } = {}) {
  openChat(m.phone, m.body);
  if (!has30 || !m.id) return true;
  try {
    await rpc('whatsapp_mark', { p_ids: [m.id], p_status: 'sent', p_note: null });
    if (!quiet) toast(`Opened in WhatsApp for ${m.name || prettyPhone(m.phone)} — press Send there.`, false, ['Undo', () => markStatus([m.id], 'queued')]);
  } catch (e) { toast(friendly(e), true); }
  refreshSoon();
  return true;
}
async function markStatus(ids, status, noteText = null) {
  try { await rpc('whatsapp_mark', { p_ids: ids, p_status: status, p_note: noteText }); toast(status === 'queued' ? 'Put back in the waiting list.' : status === 'skipped' ? 'Skipped.' : 'Updated.'); }
  catch (e) { toast(friendly(e), true); }
  refreshSoon();
}
async function queue(o) {
  if (!has30) return { id: null, phone: waNumber(o.phone || o.customerPhone), name: o.name, body: o.body };
  return rpc('whatsapp_queue_message', { p_customer: o.customer || null, p_phone: o.phone || null, p_name: o.name || null, p_kind: o.kind, p_body: o.body,
    p_invoice: o.invoice || null, p_link: o.link || null, p_image_url: o.image || null, p_meta: o.meta || {} });
}
let refreshT;
const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(() => loadAll(false), 500); };

// ---------------------------------------------------------------------------
// Popovers / row menu
// ---------------------------------------------------------------------------
function closePops() { $('moreMenu').hidden = true; $('moreBtn').setAttribute('aria-expanded', 'false'); $('rowMenu').hidden = true; }
$('moreBtn').addEventListener('click', e => { e.stopPropagation(); const open = $('moreMenu').hidden; closePops(); $('moreMenu').hidden = !open; $('moreBtn').setAttribute('aria-expanded', String(open)); });
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
async function loadSettings() {
  try { settings = { ...settings, ...(await rpc('whatsapp_settings_get')) }; }
  catch (e) { if (missing(e)) { has30 = false; needs30(); } else note(friendly(e), true); }
}
async function loadOverview() {
  if (!has30) { for (const id of ['kSent', 'kShared', 'kPending', 'kActive']) { $(id).textContent = '—'; $(id + 'Note').textContent = 'Needs migration 0030'; } return; }
  const t = today();
  try { ov = await rpc('whatsapp_overview', { p_from: monthStart(t), p_to: t }); }
  catch (e) { note(friendly(e), true); return; }
  // compare with last month up to the same day
  let prev = null;
  try { const lastTo = addDays(monthStart(t, 1), Math.min(+t.slice(8) - 1, +monthEnd(t, 1).slice(8) - 1)); prev = await rpc('whatsapp_overview', { p_from: monthStart(t, 1), p_to: lastTo }); } catch { /* optional */ }
  const vs = (a, b) => { if (!b) return a ? '<span class="dz-up">New</span> <span class="dz-muted">· none last month</span>' : '<span class="dz-muted">None last month either</span>'; const p = (a - b) / b * 100; return `<span class="${p >= 0 ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.down}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> vs. last month`; };
  $('kSent').textContent = count(ov.sent); $('kSentNote').innerHTML = vs(ov.sent, prev?.sent);
  const rate = ov.bills_with_phone ? ov.bills_shared / ov.bills_with_phone * 100 : null;
  $('kShared').textContent = count(ov.bills_shared);
  $('kSharedNote').innerHTML = rate === null ? '<span class="dz-muted">No bills with a phone yet</span>' : `<b class="wa-rate">${rate.toFixed(1)}%</b> of ${count(ov.bills_with_phone)} bills with a phone`;
  $('kPending').textContent = count(ov.pending);
  $('kPendingNote').innerHTML = ov.pending ? `<b class="wa-rate a">${count(ov.pending_invoices)}</b> invoice${ov.pending_invoices === 1 ? '' : 's'} · oldest ${esc(ago(ov.pending_oldest))}` : '<span class="dz-up">All caught up</span>';
  $('kActive').textContent = count(ov.active_customers); $('kActiveNote').innerHTML = vs(ov.active_customers, prev?.active_customers);
  $('kSent').closest('.dz-kpi').title = `${count(ov.sent)} message(s) opened in WhatsApp and sent this month · ${count(ov.replies)} customer repl${ov.replies === 1 ? 'y' : 'ies'} logged`;
  $('kShared').closest('.dz-kpi').title = `${count(ov.bills)} bill(s) this month · ${count(ov.bills_with_phone)} have a customer or patient phone · ${count(ov.bills_shared)} invoice link(s) sent on WhatsApp`;
  $('kActive').closest('.dz-kpi').title = `Customers you messaged or who replied this month · ${count(ov.consented)} customers have agreed to receive offers`;
  $('mQueue').textContent = ov.pending ? `(${count(ov.pending)})` : '';
}
const KPI_GO = { kSent: () => { $('actStatus').value = 'sent'; $('actPeriod').value = 'month'; loadActivity(0); $('actRows').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  kShared: () => showBills(true), kPending: () => showQueue(), kActive: () => showConversations() };
document.querySelector('.wa-kpis').addEventListener('click', e => { const k = e.target.closest('[data-kpi]'); if (k) KPI_GO[k.dataset.kpi](); });

async function loadConvs() {
  if (!has30) { $('convList').innerHTML = '<p class="dl-empty">Conversations are kept after migration 0030.</p>'; return; }
  try { convs = (await rpc('whatsapp_conversations', { p_search: $('convQ').value.trim() || null, p_limit: 20 })) || []; }
  catch (e) { $('convList').innerHTML = `<p class="dl-empty">${esc(friendly(e))}</p>`; return; }
  $('convList').innerHTML = convs.slice(0, 5).map(convRow).join('') || `<p class="dl-empty">${$('convQ').value.trim() ? 'No conversation matches your search.' : 'No messages yet. Bills, reminders and campaigns you send appear here.'}</p>`;
}
function convRow(c) {
  const tick = c.last_direction === 'in' ? `<span class="wa-c-in" title="Customer replied">${I.reply}</span>` : c.last_status === 'sent' ? `<span class="wa-c-tick" title="Sent">${I.ticks}</span>` : c.last_status === 'queued' ? `<span class="wa-c-q" title="Waiting to send">${I.clock}</span>` : '';
  return `<button type="button" class="wa-c" data-phone="${esc(c.phone)}"><span class="wa-av ${avCls(c.name)}">${esc(initials(c.name))}</span>
    <span class="wa-c-b"><b>${esc(c.name)}</b><small>${c.last_direction === 'in' ? '' : '<i>You: </i>'}${esc(String(c.last_body || '').replace(/\s+/g, ' ').slice(0, 120))}</small></span>
    <span class="wa-c-r"><small>${esc(shortWhen(c.last_at))}</small>${c.pending ? `<span class="wa-badge" title="${c.pending} waiting to send">${c.pending}</span>` : tick}</span><span class="wa-c-go">${I.chev}</span></button>`;
}
let convT;
$('convQ').addEventListener('input', () => { clearTimeout(convT); convT = setTimeout(loadConvs, 250); });
$('convList').addEventListener('click', e => { const b = e.target.closest('[data-phone]'); if (b) openThread(b.dataset.phone); });
$('convAll').addEventListener('click', () => showConversations());

async function loadCampaigns() {
  if (!has30) { $('campList').innerHTML = '<p class="dl-empty">Campaigns need migration 0030.</p>'; return; }
  try { campaigns = (await rpc('whatsapp_campaigns_list', { p_limit: 100 })) || []; }
  catch (e) { $('campList').innerHTML = `<p class="dl-empty">${esc(friendly(e))}</p>`; return; }
  $('campList').innerHTML = campaigns.slice(0, 3).map(campRow).join('') || `<p class="dl-empty">No campaigns yet. <button type="button" class="dl-link" data-newcamp>Create one</button></p>`;
}
function campRow(c) {
  const [l, cls] = CSTATUS[c.status] || CSTATUS.draft;
  return `<button type="button" class="wa-camp" data-camp="${esc(c.id)}"><span class="md-chip ${cls} wa-cs">${l}</span><span class="wa-camp-b"><b>${esc(c.name)}</b><small>${esc(c.description || c.body.slice(0, 80))}</small></span>
    <span class="wa-camp-n"><span>Sent: <b>${count(c.sent)}</b></span>${c.status === 'active' || c.status === 'paused' ? `<small>of ${count(c.total)}</small>` : ''}</span></button>`;
}
$('campList').addEventListener('click', e => { if (e.target.closest('[data-newcamp]')) return composeCampaign(); const b = e.target.closest('[data-camp]'); if (b) campaignDetail(b.dataset.camp); });
$('campAll').addEventListener('click', () => showCampaigns());

const TPL_IC = { invoice: ['g', I.doc], order_update: ['a', I.box], delivery: ['b', I.truck], payment_reminder: ['a', I.card], refill_reminder: ['r', I.pill], offer: ['p', I.mega], health: ['g', I.chat], custom: ['b', I.chat] };
async function loadTemplates() {
  if (!has30) { templates = []; $('tplList').innerHTML = '<p class="dl-empty">Templates need migration 0030.</p>'; return; }
  try { templates = (await rpc('whatsapp_templates_list')) || []; }
  catch (e) { $('tplList').innerHTML = `<p class="dl-empty">${esc(friendly(e))}</p>`; return; }
  const pick = ['order_confirmation', 'refill_reminder', 'delivery_update'];
  const show = [...pick.map(c => templates.find(t => t.code === c)).filter(Boolean), ...templates.filter(t => !pick.includes(t.code))].slice(0, 3);
  $('tplList').innerHTML = show.map(t => tplRow(t)).join('');
}
const tplRow = (t, extra = '') => { const [c, ic] = TPL_IC[t.kind] || TPL_IC.custom; return `<div class="wa-tpl${t.active ? '' : ' off'}"><span class="wa-tpl-ic ${c}">${ic}</span><span class="wa-tpl-b"><b>${esc(t.name)}</b><small>${esc(t.body.replace(/\s+/g, ' '))}</small></span>${extra}${settings.can_manage ? `<button type="button" class="dl-act" data-tpl="${esc(t.id)}" title="Edit ${esc(t.name)}" aria-label="Edit ${esc(t.name)}">${I.pencil}</button>` : ''}</div>`; };
$('tplList').addEventListener('click', e => { const b = e.target.closest('[data-tpl]'); if (b) editTemplate(templates.find(t => t.id === b.dataset.tpl)); });
$('tplAll').addEventListener('click', () => showTemplates());

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
async function loadActivity(page = actPage) {
  actPage = page;
  if (!has30) { $('actRows').innerHTML = '<tr><td colspan="7" class="dl-empty">The message log starts after migration 0030.</td></tr>'; $('actInfo').textContent = ''; $('actPager').innerHTML = ''; return; }
  const [f, t] = periodRange($('actPeriod').value);
  try { activity = (await rpc('whatsapp_activity', { p_from: f, p_to: t, p_kind: $('actKind').value || null, p_status: $('actStatus').value || null, p_search: $('actQ').value.trim() || null, p_limit: PER, p_offset: page * PER })) || []; }
  catch (e) { $('actRows').innerHTML = `<tr><td colspan="7" class="dl-empty">${esc(friendly(e))}</td></tr>`; return; }
  actTotal = activity.length ? num(activity[0].total_count) : 0;
  $('actRows').innerHTML = activity.map((m, i) => actRow(m, page * PER + i + 1)).join('') || '<tr><td colspan="7" class="dl-empty">No WhatsApp messages in this period.</td></tr>';
  const pages = Math.max(1, Math.ceil(actTotal / PER));
  $('actInfo').textContent = actTotal ? `Showing ${page * PER + 1}–${Math.min(actTotal, (page + 1) * PER)} of ${count(actTotal)}` : '';
  $('actPager').innerHTML = pages > 1 ? `<button type="button" class="dl-pg" data-pg="${page - 1}" ${page ? '' : 'disabled'} aria-label="Previous page">‹</button>${Array.from({ length: pages }, (_, i) => i).filter(i => i < 2 || i > pages - 3 || Math.abs(i - page) < 2).map((i, k, a) => `${k && i - a[k - 1] > 1 ? '<span class="dl-pg-gap">…</span>' : ''}<button type="button" class="dl-pg${i === page ? ' on' : ''}" data-pg="${i}">${i + 1}</button>`).join('')}<button type="button" class="dl-pg" data-pg="${page + 1}" ${page < pages - 1 ? '' : 'disabled'} aria-label="Next page">›</button>` : '';
}
function actRow(m, n) {
  const [kl, kc] = KIND[m.kind] || KIND.custom, [sl, sc, si] = STATUS[m.status] || STATUS.queued;
  return `<tr data-id="${esc(m.id)}"><td class="c-no">${n}</td><td class="c-at">${esc(when(m.at))}</td>
    <td class="c-cust"><b>${esc(m.name || prettyPhone(m.phone))}</b><small>${esc(prettyPhone(m.phone))}</small></td>
    <td class="c-type"><span class="wa-kind ${kc}">${kl}</span></td>
    <td class="c-msg" title="${esc(m.body)}">${m.direction === 'in' ? '' : ''}${esc(m.body.replace(/\s+/g, ' '))}</td>
    <td class="c-st"><span class="wa-st ${sc}">${si}<span>${sl}</span></span></td>
    <td class="c-act"><button type="button" class="dl-act" data-rowmenu title="Actions" aria-label="Actions for ${esc(m.name || m.phone)}">${I.dots}</button></td></tr>`;
}
$('actRows').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const m = activity.find(x => x.id === tr.dataset.id); if (!m) return;
  const btn = e.target.closest('[data-rowmenu]');
  if (!btn) return openThread(m.phone);
  e.stopPropagation();
  rowMenu(btn, msgMenu(m), k => msgAction(m, k));
});
const msgMenu = m => [
  m.direction === 'out' ? `<button type="button" data-rm="send">${I.wa}<span>${m.status === 'sent' ? 'Send again in WhatsApp' : 'Send now in WhatsApp'}</span></button>` : `<button type="button" data-rm="reply">${I.reply}<span>Reply in WhatsApp</span></button>`,
  `<button type="button" data-rm="thread">${I.chat}<span>Open conversation</span></button>`,
  m.link ? `<button type="button" data-rm="link">${I.link}<span>Open invoice link</span></button>` : '',
  `<button type="button" data-rm="copy">${I.copy}<span>Copy message</span></button>`,
  m.status === 'queued' ? `<button type="button" data-rm="sent">${I.tick}<span>Mark as sent</span></button><button type="button" data-rm="skip">${I.skip}<span>Skip (don't send)</span></button>` : '',
  m.direction === 'out' && m.status !== 'queued' ? `<button type="button" data-rm="requeue">${I.undo}<span>Not sent — put back in waiting list</span></button>` : ''
].join('');
async function msgAction(m, k) {
  if (k === 'send') return sendNow({ id: m.status === 'sent' ? null : m.id, phone: m.phone, body: m.body, name: m.name }).then(() => { if (m.status === 'sent') toast('Opened in WhatsApp again.'); });
  if (k === 'reply' || k === 'thread') return k === 'reply' ? openChat(m.phone, '') : openThread(m.phone);
  if (k === 'link') return window.open(m.link, '_blank', 'noopener');
  if (k === 'copy') { try { await navigator.clipboard.writeText(m.body); toast('Message copied.'); } catch { toast('Could not copy — select the text in the conversation instead.', true); } return; }
  if (k === 'sent') return markStatus([m.id], 'sent');
  if (k === 'skip') return markStatus([m.id], 'skipped');
  if (k === 'requeue') return markStatus([m.id], 'queued');
}
$('actPager').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (b && !b.disabled) loadActivity(+b.dataset.pg); });
for (const id of ['actKind', 'actStatus', 'actPeriod']) $(id).addEventListener('change', () => loadActivity(0));
let actT;
$('actQ').addEventListener('input', () => { clearTimeout(actT); actT = setTimeout(() => loadActivity(0), 300); });

// ---------------------------------------------------------------------------
// Templates helpers
// ---------------------------------------------------------------------------
const tpl = code => templates.find(t => t.code === code && t.active)?.body;
const FALLBACK = {
  order_confirmation: 'Hello {{name}}, your order {{order_no}} for ₹{{amount}} has been confirmed. We will let you know when it is ready. – {{shop}}',
  delivery_update: 'Hello {{name}}, your order {{order_no}} is out for delivery and will reach you shortly. – {{shop}}',
  order_delivered: 'Hello {{name}}, your order {{order_no}} has been delivered. Thank you for choosing {{shop}}!',
  payment_reminder: 'Hello {{name}}, this is a gentle reminder that ₹{{due}} is pending at {{shop}}. You can pay by cash or UPI at your convenience. Thank you!',
  refill_reminder: "Hello {{name}}, it's time to refill {{medicine_name}}. Reply to this message or visit {{shop}} and we will keep it ready for you.",
  offer: 'Hello {{name}}! Special offer at {{shop}}: up to 20% off on selected medicines and health products this week. Visit us today!',
  health_tip: 'Hello {{name}}, a health tip from {{shop}}: drink plenty of water, take your medicines on time and complete the full course. Stay healthy!'
};
const body = code => tpl(code) || FALLBACK[code] || '';
const fill = (text, vars) => String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k) => vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : all);
const unfilled = text => [...new Set([...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(x => x[1]))];
const PLACEHOLDERS = [['name', 'Customer first name'], ['shop', 'Pharmacy name'], ['order_no', 'Bill number'], ['amount', 'Bill amount'], ['date', 'Bill date'], ['link', 'Invoice link'], ['due', 'Amount due'], ['medicine_name', 'Medicine'], ['photo', 'Offer photo link']];

async function loadCustomers(force = false) {
  if (customers && !force) return customers;
  const { data, error } = await sb.from('customers').select('id,name,phone,consent,active').eq('branch_id', prof.branch_id).order('name');
  if (error) throw error;
  customers = data || [];
  return customers;
}
const eligible = c => c.active !== false && c.consent === true && digits(c.phone).length >= 10;

// ---------------------------------------------------------------------------
// Compose (New Message / Custom Message / conversation reply)
// ---------------------------------------------------------------------------
async function compose(o = {}) {
  let list = [];
  try { list = await loadCustomers(); } catch (e) { toast(friendly(e), true); }
  const tplOpts = templates.filter(t => t.active && t.kind !== 'invoice').map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  dlg(`<h3 class="rt-dlg-title">${I.chat} ${esc(o.title || 'New Message')}</h3>
    <p class="dl-muted">Pick a customer (or type any WhatsApp number), write the message and tap <b>Send on WhatsApp</b>. WhatsApp opens with the text filled in — press Send there.</p>
    <div class="md-form-grid wa-form">
      <div class="pos-field md-span-2 wa-to"><label for="cTo">To</label><input id="cTo" list="cToList" placeholder="Customer name or mobile number" autocomplete="off" value="${esc(o.toLabel || '')}">
        <datalist id="cToList">${list.filter(c => c.active !== false && digits(c.phone).length >= 10).map(c => `<option value="${esc(`${c.name} · ${c.phone}`)}"></option>`).join('')}</datalist><small class="dl-muted" id="cToInfo"></small></div>
      <div class="pos-field"><label for="cKind">Type</label><select id="cKind">${['custom', 'order_update', 'delivery', 'payment_reminder', 'refill_reminder', 'health', 'offer'].map(k => `<option value="${k}"${(o.kind || 'custom') === k ? ' selected' : ''}>${KIND[k][0]}</option>`).join('')}</select></div>
      <div class="pos-field"><label for="cTpl">Template</label><select id="cTpl"><option value="">— Write my own —</option>${tplOpts}</select></div>
      <div class="pos-field md-span-2"><label for="cBody">Message</label><textarea id="cBody" rows="6" maxlength="1024" placeholder="Type your message…">${esc(o.body || '')}</textarea>
        <div class="wa-row-b"><small class="dl-muted" id="cHint">Use {{name}} for the customer's first name.</small><small class="dl-muted" id="cCount">0 / 1024</small></div></div>
    </div>
    <div class="wa-preview-bubble" id="cPrev"></div>
    <p class="pos-form-msg" id="cErr"></p>
    <div class="dl-pop-foot wa-dlg-foot">${has30 ? '<button type="button" class="pos-btn" id="cQueue">Add to waiting list</button>' : ''}<button type="button" class="pos-btn pos-btn-solid" id="cSend">${I.wa}<span>Send on WhatsApp</span></button></div>`, 'wa-compose');
  const target = () => {
    const v = $('cTo').value.trim();
    const c = list.find(x => `${x.name} · ${x.phone}` === v) || (o.customer && v === o.toLabel ? list.find(x => x.id === o.customer) : null) || list.find(x => waNumber(x.phone) && waNumber(x.phone) === waNumber(v));
    return c ? { customer: c.id, name: c.name, phone: c.phone, consent: c.consent } : { customer: null, name: null, phone: v, consent: false };
  };
  const vars = () => { const t = target(); return { name: firstName(t.name || ''), shop: settings.shop, ...(o.vars || {}) }; };
  const paint = () => {
    const t = target(), text = $('cBody').value;
    $('cToInfo').textContent = t.customer ? `${t.consent ? 'Agreed to WhatsApp offers' : 'No consent for offers — service messages only'} · ${prettyPhone(t.phone)}` : waNumber(t.phone) ? `WhatsApp number +${waNumber(t.phone)}` : '';
    $('cCount').textContent = `${text.length} / 1024`;
    $('cPrev').innerHTML = text.trim() ? `<span>${esc(fill(text, vars())).replace(/\n/g, '<br>')}</span><small>${timeOnly(new Date())} ${I.ticks}</small>` : '';
    const left = unfilled(fill(text, vars()));
    $('cHint').textContent = left.length ? `Fill in or remove: ${left.map(x => `{{${x}}}`).join(', ')}` : 'Use {{name}} for the customer\'s first name.';
    $('cHint').classList.toggle('wa-warn', !!left.length);
  };
  $('cTpl').onchange = () => { const t = templates.find(x => x.id === $('cTpl').value); if (t) { $('cBody').value = t.body; if (KIND[t.kind] && t.kind !== 'invoice') $('cKind').value = t.kind; } paint(); };
  for (const id of ['cTo', 'cBody']) $(id).addEventListener('input', paint);
  paint();
  const go = async open => {
    const t = target(), text = fill($('cBody').value.trim(), vars());
    $('cErr').textContent = '';
    if (!waNumber(t.phone)) return ($('cErr').textContent = 'Choose a customer or enter a 10-digit WhatsApp number.');
    if (!text) return ($('cErr').textContent = 'Write a message first.');
    if (unfilled(text).length) return ($('cErr').textContent = `Replace ${unfilled(text).map(x => `{{${x}}}`).join(', ')} before sending.`);
    if (['offer', 'health'].includes($('cKind').value) && !(t.customer && t.consent)) return ($('cErr').textContent = 'Offers and health campaigns can only go to customers who agreed to receive them (Customers → WhatsApp consent).');
    try {
      const m = await queue({ customer: t.customer, phone: t.customer ? null : t.phone, customerPhone: t.phone, name: t.name, kind: $('cKind').value, body: text, invoice: o.invoice, link: o.link, meta: o.meta });
      $('puDlg').close();
      if (open) await sendNow({ ...m, name: m.name || t.name }); else { toast('Added to the waiting list.'); refreshSoon(); }
      o.after?.();
    } catch (e) { $('cErr').textContent = friendly(e); }
  };
  $('cSend').onclick = () => go(true);
  if ($('cQueue')) $('cQueue').onclick = () => go(false);
  if (!o.toLabel) $('cTo').focus(); else $('cBody').focus();
}
$('newMsg').addEventListener('click', () => compose());

// ---------------------------------------------------------------------------
// Conversation thread
// ---------------------------------------------------------------------------
async function openThread(phone) {
  const c = convs.find(x => x.phone === waNumber(phone)) || {};
  let rows = [];
  try { rows = (await rpc('whatsapp_thread', { p_phone: phone })) || []; } catch (e) { return toast(friendly(e), true); }
  const name = c.name || rows.find(r => r.direction === 'out')?.name || `+${waNumber(phone)}`;
  const pending = rows.filter(r => r.status === 'queued');
  dlg(`<div class="wa-th-head"><span class="wa-av ${avCls(name)}">${esc(initials(name))}</span><div><h3>${esc(name)}</h3><small class="dl-muted">${esc(prettyPhone(phone))} · ${count(rows.length)} message${rows.length === 1 ? '' : 's'}</small></div>
      <a class="pos-btn pos-btn-sm wa-open-chat" href="${esc(waUrl(phone, ''))}" target="_blank" rel="noopener">${I.wa}<span>Open chat</span></a></div>
    ${pending.length ? `<div class="wa-th-pending">${I.clock}<span>${pending.length} message${pending.length === 1 ? ' is' : 's are'} waiting to be sent</span><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-th-send="${esc(pending[pending.length - 1].id)}">${I.wa}<span>Send now</span></button></div>` : ''}
    <div class="wa-thread" id="thread">${rows.slice().reverse().map(r => `<div class="wa-bub ${r.direction === 'in' ? 'in' : 'out'}${r.status === 'queued' ? ' q' : r.status === 'skipped' || r.status === 'failed' ? ' x' : ''}">
        ${r.direction === 'out' ? `<span class="wa-bub-k">${esc((KIND[r.kind] || KIND.custom)[0])}${r.invoice_no ? ` · ${esc(r.invoice_no)}` : ''}${r.campaign_name ? ` · ${esc(r.campaign_name)}` : ''}</span>` : '<span class="wa-bub-k">Customer</span>'}
        <span class="wa-bub-t">${esc(r.body).replace(/\n/g, '<br>')}</span>
        <small>${esc(when(r.at))}${r.by_name ? ` · ${esc(r.by_name)}` : ''} ${r.status === 'sent' ? I.ticks : r.status === 'queued' ? `${I.clock} waiting <button type="button" class="dl-link" data-th-send="${esc(r.id)}">Send</button>` : r.status === 'received' ? '' : `· ${esc((STATUS[r.status] || STATUS.queued)[0])}`}</small></div>`).join('') || '<p class="dl-empty">No messages yet.</p>'}</div>
    <div class="wa-th-compose">
      <div class="wa-th-tabs"><button type="button" class="on" data-tt="send">Send a message</button><button type="button" data-tt="log">Log the customer's reply</button></div>
      <textarea id="thBody" rows="3" maxlength="1024" placeholder="Type a message to send on WhatsApp…"></textarea>
      <div class="wa-row-b"><select id="thTpl" aria-label="Template"><option value="">Template…</option>${templates.filter(t => t.active && t.kind !== 'invoice').map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>
        <button type="button" class="pos-btn pos-btn-solid" id="thGo">${I.wa}<span>Send on WhatsApp</span></button></div>
      <p class="pos-form-msg" id="thErr"></p>
    </div>`, 'wa-thread-dlg');
  const t = $('thread'); t.scrollTop = t.scrollHeight;
  let mode = 'send';
  $('puPanel').querySelector('.wa-th-tabs').onclick = e => { const b = e.target.closest('[data-tt]'); if (!b) return; mode = b.dataset.tt; $('puPanel').querySelectorAll('[data-tt]').forEach(x => x.classList.toggle('on', x === b)); $('thBody').placeholder = mode === 'send' ? 'Type a message to send on WhatsApp…' : 'Type what the customer wrote to you on WhatsApp…'; $('thGo').innerHTML = mode === 'send' ? `${I.wa}<span>Send on WhatsApp</span>` : `${I.reply}<span>Save reply</span>`; $('thTpl').hidden = mode !== 'send'; };
  $('thTpl').onchange = () => { const x = templates.find(y => y.id === $('thTpl').value); if (x) $('thBody').value = fill(x.body, { name: firstName(name), shop: settings.shop }); };
  $('puPanel').onclick = async e => {
    const s = e.target.closest('[data-th-send]'); if (!s) return;
    const r = rows.find(x => x.id === s.dataset.thSend);
    await sendNow({ id: r.id, phone, body: r.body, name }); openThread(phone);
  };
  $('thGo').onclick = async () => {
    const text = $('thBody').value.trim(); $('thErr').textContent = '';
    if (!text) return ($('thErr').textContent = mode === 'send' ? 'Write a message first.' : 'Type the customer\'s message first.');
    try {
      if (mode === 'log') { await rpc('whatsapp_log_reply', { p_phone: phone, p_body: text, p_customer: null }); toast('Customer reply saved.'); refreshSoon(); return openThread(phone); }
      const unf = unfilled(text); if (unf.length) return ($('thErr').textContent = `Replace ${unf.map(x => `{{${x}}}`).join(', ')} first.`);
      const m = await queue({ customer: c.customer_id || null, phone: c.customer_id ? null : phone, name, kind: 'custom', body: text });
      await sendNow({ ...m, name }); openThread(phone);
    } catch (err) { $('thErr').textContent = friendly(err); }
  };
}
async function showConversations() {
  let all = [];
  try { all = (await rpc('whatsapp_conversations', { p_search: null, p_limit: 200 })) || []; } catch (e) { return toast(friendly(e), true); }
  const draw = q => all.filter(c => !q || c.name.toLowerCase().includes(q) || c.phone.includes(digits(q) || '~')).map(convRow).join('') || '<p class="dl-empty">No conversations.</p>';
  dlg(`<h3 class="rt-dlg-title">${I.chat} All Conversations <small class="dl-muted">(${count(all.length)})</small></h3>
    <label class="dl-search wa-search">${I.search}<input id="acQ" type="search" placeholder="Search by customer name or mobile number..." autocomplete="off"></label>
    <div class="wa-clist wa-clist-all" id="acList">${draw('')}</div>`);
  $('acQ').oninput = () => { $('acList').innerHTML = draw($('acQ').value.trim().toLowerCase()); };
  $('acList').onclick = e => { const b = e.target.closest('[data-phone]'); if (b) openThread(b.dataset.phone); };
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------
$('quick').addEventListener('click', e => {
  const b = e.target.closest('[data-quick]'); if (!b) return;
  ({ order: () => showBills(false), payment: showDues, refill: showRefills, campaign: () => composeCampaign({ kind: 'health' }), custom: () => compose({ title: 'Custom Message' }) })[b.dataset.quick]();
});
const DEL = { pending: ['Delivery requested', 'low'], out: ['Out for delivery', 'blue'], done: ['Delivered', 'in'], failed: ['Delivery failed', 'out'] };
async function showBills(unshared) {
  if (!has30) return needs30();
  const t = today();
  let rows = [];
  try { rows = (await rpc('whatsapp_bills', { p_from: addDays(t, unshared ? -6 : -13), p_to: t, p_unshared_only: unshared })) || []; } catch (e) { return toast(friendly(e), true); }
  dlg(`<h3 class="rt-dlg-title">${I.box} ${unshared ? 'Bills not shared on WhatsApp yet' : 'Send Order Update'}</h3>
    <p class="dl-muted">${unshared ? 'Bills of the last 7 days that have a customer or patient phone but whose invoice link has not been sent.' : 'Bills of the last 14 days with a phone number. Send the invoice link (customer can view and download the PDF) or an order status update.'}</p>
    <label class="dl-search wa-search">${I.search}<input id="bQ" type="search" placeholder="Search bill no., customer or phone…" autocomplete="off"></label>
    <div class="dl-table-wrap wa-bills-wrap"><table class="dl-table wa-bills"><thead><tr><th>Bill</th><th>Customer</th><th class="c-r">Amount</th><th>Status</th><th class="c-c">Send</th></tr></thead><tbody id="bRows"></tbody></table></div>`, 'wa-bills-dlg');
  const draw = () => {
    const q = $('bQ').value.trim().toLowerCase();
    $('bRows').innerHTML = rows.filter(r => !q || `${r.invoice_no} ${r.name} ${r.phone}`.toLowerCase().includes(q)).map(r => {
      const d = DEL[r.delivery_status];
      return `<tr data-inv="${esc(r.invoice_id)}"><td><b>${esc(r.invoice_no)}</b><small>${esc(when(r.created_at))}</small></td><td>${esc(r.name)}<small>${esc(prettyPhone(r.phone))}</small></td><td class="c-r">${rupees(r.total)}</td>
        <td>${r.shared ? `<span class="md-chip in">${I.tick} Invoice sent</span>` : r.invoice_message_status === 'queued' ? '<span class="md-chip low">Invoice waiting</span>' : '<span class="md-chip off">Not shared</span>'}${d ? ` <span class="md-chip ${d[1]}">${d[0]}</span>` : ''}${r.last_update_kind ? `<small>Last update ${esc(shortWhen(r.last_update_at))}</small>` : ''}</td>
        <td class="c-c"><div class="wa-bill-acts"><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-b="invoice">${I.doc}<span>${r.shared ? 'Invoice again' : 'Invoice'}</span></button>${unshared ? '' : `<button type="button" class="pos-btn pos-btn-sm" data-rowmenu data-b="more">${I.dots}<span>Update</span></button>`}</div></td></tr>`;
    }).join('') || `<tr><td colspan="5" class="dl-empty">${unshared ? 'Every bill with a phone has been shared. 🎉' : 'No bills with a phone number in the last 14 days.'}</td></tr>`;
  };
  draw();
  $('bQ').oninput = draw;
  $('bRows').onclick = async e => {
    const b = e.target.closest('[data-b]'), tr = e.target.closest('tr[data-inv]'); if (!b || !tr) return;
    const r = rows.find(x => x.invoice_id === tr.dataset.inv);
    if (b.dataset.b === 'invoice') {
      try {
        const j = await rpc('whatsapp_queue_invoice', { p_invoice: r.invoice_id, p_base_url: siteBase() });
        if (j.status === 'no_phone') return toast('This bill has no phone number.', true);
        await sendNow({ id: j.status === 'sent' ? null : j.id, phone: j.phone, body: j.body, name: j.name });
        r.shared = true; r.invoice_message_status = 'sent'; if (unshared) rows = rows.filter(x => x !== r); draw();
      } catch (err) { toast(friendly(err), true); }
      return;
    }
    e.stopPropagation();
    rowMenu(b, `<button type="button" data-rm="order_confirmation">${I.box}<span>Order confirmed</span></button><button type="button" data-rm="delivery_update">${I.truck}<span>Out for delivery</span></button><button type="button" data-rm="order_delivered">${I.check}<span>Delivered</span></button><button type="button" data-rm="own">${I.pencil}<span>Write my own update…</span></button>`, code => {
      const vars = { name: firstName(r.name), shop: settings.shop, order_no: r.invoice_no, amount: money2(r.total), date: new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }) };
      compose({ title: `Order update · ${r.invoice_no}`, customer: r.customer_id, toLabel: r.customer_id ? `${r.name} · ${(customers || []).find(c => c.id === r.customer_id)?.phone || r.phone}` : r.phone, kind: code === 'order_confirmation' || code === 'own' ? 'order_update' : 'delivery',
        body: code === 'own' ? fill('Hello {{name}}, an update on your order {{order_no}}: ', vars) : fill(body(code), vars), invoice: r.invoice_id, vars, after: () => showBills(unshared) });
    });
  };
}
async function showDues() {
  if (!has30) return needs30();
  let rows = [];
  try { rows = (await rpc('whatsapp_due_customers')) || []; } catch (e) { return toast(friendly(e), true); }
  const sel = new Set();
  dlg(`<h3 class="rt-dlg-title">${I.card} Payment Reminder</h3>
    <p class="dl-muted">Customers with an unpaid balance. Send one reminder now, or select several and send them one after another.</p>
    <div class="dl-table-wrap wa-bills-wrap"><table class="dl-table wa-bills"><thead><tr><th class="c-c"><input type="checkbox" id="dAll" aria-label="Select all"></th><th>Customer</th><th class="c-r">Due</th><th>Last reminder</th><th class="c-c">Send</th></tr></thead>
    <tbody id="dRows">${rows.map(r => `<tr data-c="${esc(r.customer_id)}"><td class="c-c"><input type="checkbox" data-sel aria-label="Select ${esc(r.name)}"></td><td><b>${esc(r.name)}</b><small>${esc(prettyPhone(r.phone))}</small></td><td class="c-r"><b class="wa-due">${rupees(r.outstanding)}</b>${num(r.credit_limit) && num(r.outstanding) > num(r.credit_limit) ? '<small class="wa-warn">Over credit limit</small>' : ''}</td>
      <td>${r.last_reminder_at ? esc(ago(r.last_reminder_at)) : '<span class="dl-muted">Never</span>'}</td><td class="c-c"><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-send>${I.wa}<span>Remind</span></button></td></tr>`).join('') || '<tr><td colspan="5" class="dl-empty">No customer owes money right now. 🎉</td></tr>'}</tbody></table></div>
    <div class="dl-pop-foot wa-dlg-foot"><span class="dl-muted" id="dCount">0 selected</span><button type="button" class="pos-btn pos-btn-solid" id="dRun" disabled>${I.play}<span>Send to selected one by one</span></button></div>`, 'wa-bills-dlg');
  const vars = r => ({ name: firstName(r.name), shop: settings.shop, due: money2(r.outstanding) });
  const paint = () => { $('dCount').textContent = `${sel.size} selected`; $('dRun').disabled = !sel.size; };
  $('dAll').onchange = () => { $('dRows').querySelectorAll('[data-sel]').forEach(x => { x.checked = $('dAll').checked; const id = x.closest('tr').dataset.c; x.checked ? sel.add(id) : sel.delete(id); }); paint(); };
  $('dRows').onchange = e => { const x = e.target.closest('[data-sel]'); if (!x) return; const id = x.closest('tr').dataset.c; x.checked ? sel.add(id) : sel.delete(id); paint(); };
  $('dRows').onclick = e => {
    const b = e.target.closest('[data-send]'); if (!b) return;
    const r = rows.find(x => x.customer_id === b.closest('tr').dataset.c);
    compose({ title: `Payment reminder · ${r.name}`, customer: r.customer_id, toLabel: `${r.name} · ${r.phone}`, kind: 'payment_reminder', body: fill(body('payment_reminder'), vars(r)), vars: vars(r), after: () => {} });
  };
  $('dRun').onclick = async () => {
    try {
      const msgs = [];
      for (const r of rows.filter(x => sel.has(x.customer_id))) msgs.push({ ...(await queue({ customer: r.customer_id, kind: 'payment_reminder', body: fill(body('payment_reminder'), vars(r)) })), name: r.name });
      $('puDlg').close(); refreshSoon();
      runQueue({ title: 'Payment reminders', msgs, interval: 0 });
    } catch (e) { toast(friendly(e), true); }
  };
}
async function showRefills(days = 30, win = 5) {
  if (!has30) return needs30();
  let rows = [];
  try { rows = (await rpc('whatsapp_refill_candidates', { p_days: days, p_window: win })) || []; } catch (e) { return toast(friendly(e), true); }
  const sel = new Set();
  const key = r => `${r.customer_id}|${r.medicine_id}`;
  dlg(`<h3 class="rt-dlg-title">${I.pill} Refill Reminder</h3>
    <p class="dl-muted">Customers whose medicine, bought about <b>${days} days</b> ago, is due for a refill (due within ${win} days of today). Already reminded customers are marked.</p>
    <div class="wa-inline"><label>Refill every <input type="number" id="rDays" min="1" max="365" value="${days}"> days</label><label>± <input type="number" id="rWin" min="0" max="60" value="${win}"> days</label><button type="button" class="pos-btn pos-btn-sm" id="rApply">Show</button></div>
    <div class="dl-table-wrap wa-bills-wrap"><table class="dl-table wa-bills"><thead><tr><th class="c-c"><input type="checkbox" id="rAll" aria-label="Select all"></th><th>Customer</th><th>Medicine</th><th>Last bought</th><th>Due</th><th class="c-c">Send</th></tr></thead>
    <tbody id="rRows">${rows.map(r => `<tr data-k="${esc(key(r))}"><td class="c-c"><input type="checkbox" data-sel ${r.reminded_at ? '' : ''} aria-label="Select ${esc(r.name)}"></td><td><b>${esc(r.name)}</b><small>${esc(prettyPhone(r.phone))}</small></td><td>${esc(r.medicine)}<small>Qty ${esc(String(+r.qty))}</small></td>
      <td>${esc(new Date(r.last_date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }))}<small>${r.days_since} days ago</small></td><td>${esc(new Date(r.due_date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }))}${r.reminded_at ? `<small class="wa-ok">${I.tick} Reminded ${esc(ago(r.reminded_at))}</small>` : ''}</td>
      <td class="c-c"><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-send>${I.wa}<span>Remind</span></button></td></tr>`).join('') || '<tr><td colspan="6" class="dl-empty">No refills due around today. Try a different refill period.</td></tr>'}</tbody></table></div>
    <div class="dl-pop-foot wa-dlg-foot"><span class="dl-muted" id="rCount">0 selected</span><button type="button" class="pos-btn pos-btn-solid" id="rRun" disabled>${I.play}<span>Send to selected one by one</span></button></div>`, 'wa-bills-dlg');
  const vars = r => ({ name: firstName(r.name), shop: settings.shop, medicine_name: r.medicine });
  const paint = () => { $('rCount').textContent = `${sel.size} selected`; $('rRun').disabled = !sel.size; };
  $('rApply').onclick = () => showRefills(Math.min(365, Math.max(1, +$('rDays').value || 30)), Math.min(60, Math.max(0, +$('rWin').value || 0)));
  $('rAll').onchange = () => { $('rRows').querySelectorAll('[data-sel]').forEach(x => { x.checked = $('rAll').checked; const k = x.closest('tr').dataset.k; x.checked ? sel.add(k) : sel.delete(k); }); paint(); };
  $('rRows').onchange = e => { const x = e.target.closest('[data-sel]'); if (!x) return; const k = x.closest('tr').dataset.k; x.checked ? sel.add(k) : sel.delete(k); paint(); };
  $('rRows').onclick = e => {
    const b = e.target.closest('[data-send]'); if (!b) return;
    const r = rows.find(x => key(x) === b.closest('tr').dataset.k);
    compose({ title: `Refill reminder · ${r.name}`, customer: r.customer_id, toLabel: `${r.name} · ${r.phone}`, kind: 'refill_reminder', body: fill(body('refill_reminder'), vars(r)), vars: vars(r), meta: { medicine_id: r.medicine_id }, after: () => showRefills(days, win) });
  };
  $('rRun').onclick = async () => {
    try {
      const msgs = [];
      for (const r of rows.filter(x => sel.has(key(x)))) msgs.push({ ...(await queue({ customer: r.customer_id, kind: 'refill_reminder', body: fill(body('refill_reminder'), vars(r)), meta: { medicine_id: r.medicine_id } })), name: r.name });
      $('puDlg').close(); refreshSoon();
      runQueue({ title: 'Refill reminders', msgs, interval: 0 });
    } catch (e) { toast(friendly(e), true); }
  };
}
async function showQueue() {
  if (!has30) return needs30();
  let rows = [];
  try { rows = (await rpc('whatsapp_activity', { p_from: null, p_to: null, p_kind: null, p_status: 'queued', p_search: null, p_limit: 500, p_offset: 0 })) || []; } catch (e) { return toast(friendly(e), true); }
  rows.reverse();
  dlg(`<h3 class="rt-dlg-title">${I.clock} Waiting to send <small class="dl-muted">(${count(rows.length)})</small></h3>
    <p class="dl-muted">Messages that were prepared (for example invoices after billing) but not opened in WhatsApp yet. Oldest first.</p>
    <div class="dl-table-wrap wa-bills-wrap"><table class="dl-table wa-bills"><thead><tr><th>Prepared</th><th>Customer</th><th>Type</th><th>Message</th><th class="c-c">Send</th></tr></thead>
    <tbody id="qRows">${rows.map(m => `<tr data-id="${esc(m.id)}"><td>${esc(when(m.queued_at))}<small>${esc(ago(m.queued_at))}${m.by_name ? ` · ${esc(m.by_name)}` : ''}</small></td><td><b>${esc(m.name || prettyPhone(m.phone))}</b><small>${esc(prettyPhone(m.phone))}</small></td>
      <td><span class="wa-kind ${(KIND[m.kind] || KIND.custom)[1]}">${(KIND[m.kind] || KIND.custom)[0]}</span>${m.invoice_no ? `<small>${esc(m.invoice_no)}</small>` : m.campaign_name ? `<small>${esc(m.campaign_name)}</small>` : ''}</td><td class="wa-q-body">${esc(m.body.replace(/\s+/g, ' ').slice(0, 140))}</td>
      <td class="c-c"><div class="wa-bill-acts"><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-q="send">${I.wa}<span>Send</span></button><button type="button" class="pos-btn pos-btn-sm" data-q="skip" title="Don't send">${I.skip}<span>Skip</span></button></div></td></tr>`).join('') || '<tr><td colspan="5" class="dl-empty">Nothing is waiting. 🎉</td></tr>'}</tbody></table></div>
    ${rows.length ? `<div class="dl-pop-foot wa-dlg-foot"><button type="button" class="pos-btn pos-btn-solid" id="qRun">${I.play}<span>Send all one by one</span></button></div>` : ''}`, 'wa-bills-dlg');
  $('qRows').onclick = async e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const tr = b.closest('tr'), m = rows.find(x => x.id === tr.dataset.id);
    if (b.dataset.q === 'send') await sendNow({ id: m.id, phone: m.phone, body: m.body, name: m.name }); else await markStatus([m.id], 'skipped');
    tr.remove(); rows = rows.filter(x => x !== m);
  };
  if ($('qRun')) $('qRun').onclick = () => { $('puDlg').close(); runQueue({ title: 'Waiting messages', msgs: rows.filter(m => !m.campaign_id).concat(rows.filter(m => m.campaign_id)).map(m => ({ id: m.id, phone: m.phone, body: m.body, name: m.name, image_url: m.image_url })), interval: 0 }); };
}

// ---------------------------------------------------------------------------
// Campaign composer (bulk text + photo, consented customers only)
// ---------------------------------------------------------------------------
let photoFile = null, photoUrl = '';
async function composeCampaign(prefill = {}) {
  if (!isAdmin || !settings.can_manage) return toast('Only Admin can create campaigns.', true);
  if (!has30) return needs30();
  let list = [];
  try { list = await loadCustomers(true); } catch (e) { return toast(friendly(e), true); }
  const sel = new Set(prefill.customers || []);
  let search = '';
  photoFile = null; if (photoUrl) URL.revokeObjectURL(photoUrl); photoUrl = '';
  const kinds = [['offer', 'Promotional offer'], ['health', 'Health tip / announcement'], ['custom', 'Custom message']];
  const tplFor = k => templates.filter(t => t.active && (k === 'custom' ? ['custom', 'offer', 'health'].includes(t.kind) : t.kind === k));
  dlg(`<h3 class="rt-dlg-title">${I.mega} New Campaign</h3>
    <p class="dl-muted">Send an offer or health message (with an optional photo) to customers who agreed to receive WhatsApp promotions. Messages open one chat at a time with your interval between them — this keeps the shop's number safe from spam limits.</p>
    <div class="wa-cmp">
      <section class="wa-cmp-col">
        <h4>1. Select recipients <span class="wa-count" id="wcSel">0 selected</span></h4>
        <label class="dl-search wa-search">${I.search}<input id="wcQ" type="search" placeholder="Search customer name or phone…" autocomplete="off"></label>
        <div class="wa-row-b"><span><button type="button" class="pos-btn pos-btn-sm" id="wcAll">Select all eligible</button> <button type="button" class="pos-btn pos-btn-sm" id="wcClear">Clear selection</button></span><span class="wa-count" id="wcElig"></span></div>
        <div class="wa-recips" id="wcList"></div>
        <small class="dl-muted">Only active customers with WhatsApp consent and a valid phone can be selected. Change consent in Customers.</small>
      </section>
      <section class="wa-cmp-col">
        <h4>2. Compose</h4>
        <div class="md-form-grid">
          <div class="pos-field md-span-2"><label for="wcName">Campaign name</label><input id="wcName" maxlength="80" placeholder="e.g. Winter Health Offer" value="${esc(prefill.name || '')}"></div>
          <div class="pos-field"><label for="wcKind">Message type</label><select id="wcKind">${kinds.map(([k, l]) => `<option value="${k}"${(prefill.kind || 'offer') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="pos-field"><label for="wcTpl">Template</label><select id="wcTpl"></select></div>
          <div class="pos-field md-span-2"><label for="wcDesc">Short description <small class="dl-muted">(shown in the list)</small></label><input id="wcDesc" maxlength="120" placeholder="e.g. Up to 20% off on selected medicines" value="${esc(prefill.description || '')}"></div>
          <div class="pos-field md-span-2"><label for="wcBody">Message</label><textarea id="wcBody" rows="6" maxlength="1024" placeholder="Write your pharmacy offer…">${esc(prefill.body || '')}</textarea>
            <div class="wa-row-b"><small class="dl-muted">Keep it clear and short. {{name}} = customer's first name.</small><small class="wa-count" id="wcCount">0 / 1024</small></div></div>
          <div class="pos-field md-span-2"><label>Promotional photo <small class="dl-muted">(optional)</small></label>
            <label class="wa-file" for="wcPhoto">${I.photo}<span><b>Choose photo</b><small>JPG, PNG or WEBP · up to 5 MB</small></span></label><input id="wcPhoto" type="file" accept="image/jpeg,image/png,image/webp" hidden>
            <div class="wa-row-b"><span class="dl-muted" id="wcPhotoName">No photo selected</span><button type="button" class="dl-link" id="wcPhotoRm" hidden>Remove photo</button></div></div>
        </div>
        <h4>3. Sending interval</h4>
        <div class="wa-interval"><input id="wcInt" type="number" min="30" max="3600" step="15" value="${prefill.interval || 120}" aria-label="Seconds between messages"><b id="wcIntLabel"></b><input id="wcRange" type="range" min="30" max="600" step="30" value="${Math.min(600, prefill.interval || 120)}" aria-label="Interval"></div>
        <small class="dl-muted">30 seconds to 60 minutes between chats. Type any value in seconds.</small>
      </section>
      <section class="wa-cmp-col wa-cmp-prev">
        <h4>4. Preview</h4>
        <div class="wa-phone"><div class="wa-phone-top">${I.wa}<b>${esc(settings.shop)}</b></div><div class="wa-phone-chat"><div class="wa-preview-bubble big"><img id="wcImg" alt="Offer photo preview" hidden><span id="wcPrev" class="dl-muted">Your message preview will appear here.</span><small>${timeOnly(new Date())} ${I.ticks}</small></div></div></div>
        <h4>5. Campaign summary</h4>
        <div class="wa-sum"><div><b id="wsRec">0</b><span>Recipients</span></div><div><b id="wsInt">2 min</b><span>Interval</span></div><div><b id="wsDur">—</b><span>Approx. duration</span></div></div>
        <p class="dl-muted" id="wsNote">Select recipients to estimate campaign duration.</p>
        <p class="pos-form-msg" id="wcErr"></p>
        <div class="wa-dlg-foot"><button type="button" class="pos-btn" id="wcReset">Reset</button><button type="button" class="pos-btn pos-btn-solid" id="wcStart" disabled>${I.play}<span>Create &amp; start sending</span></button></div>
      </section>
    </div>`, 'wa-camp-dlg');
  const intSec = () => { const n = Number($('wcInt').value); return Number.isFinite(n) ? Math.min(3600, Math.max(30, Math.round(n))) : 120; };
  const visible = () => list.filter(c => eligible(c) && `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(search));
  const drawList = () => {
    const v = visible();
    $('wcElig').textContent = `${count(list.filter(eligible).length)} eligible`;
    $('wcList').innerHTML = v.map(c => `<label class="wa-recip"><input type="checkbox" data-c="${esc(c.id)}" ${sel.has(c.id) ? 'checked' : ''}><span class="wa-av sm ${avCls(c.name)}">${esc(initials(c.name))}</span><span><b>${esc(c.name || 'Unnamed customer')}</b><small>${esc(prettyPhone(c.phone))}</small></span><span class="md-chip in">Consent</span></label>`).join('') || '<p class="dl-empty">No eligible customers match your search.</p>';
  };
  const paint = () => {
    const text = $('wcBody').value, s = intSec();
    $('wcSel').textContent = `${count(sel.size)} selected`;
    $('wcCount').textContent = `${text.length} / 1024`;
    $('wcPrev').textContent = text.trim() ? fill(text, { name: 'Ravi', shop: settings.shop, photo: photoFile ? '(photo link)' : '' }) : 'Your message preview will appear here.';
    $('wcPrev').classList.toggle('dl-muted', !text.trim());
    $('wcIntLabel').textContent = fmtDuration(s);
    $('wcRange').value = String(Math.min(600, s));
    $('wsRec').textContent = count(sel.size);
    $('wsInt').textContent = s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s}s`;
    const dur = sel.size > 1 ? (sel.size - 1) * s : 0;
    $('wsDur').textContent = sel.size ? fmtDuration(dur) : '—';
    $('wsNote').textContent = sel.size ? `Estimated time from first to last message: ${fmtDuration(dur)}. You can pause and continue later, from any device.` : 'Select recipients to estimate campaign duration.';
    $('wcStart').disabled = !sel.size || !text.trim() || !$('wcName').value.trim();
  };
  const fillTpls = () => { const ts = tplFor($('wcKind').value); $('wcTpl').innerHTML = `<option value="">— Write my own —</option>${ts.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}`; };
  fillTpls(); drawList(); paint();
  if (!prefill.body) { const t = tplFor($('wcKind').value)[0]; if (t) { $('wcTpl').value = t.id; $('wcBody').value = t.body; paint(); } }
  $('wcKind').onchange = () => { fillTpls(); const t = tplFor($('wcKind').value)[0]; if (t && !$('wcBody').value.trim()) { $('wcTpl').value = t.id; $('wcBody').value = t.body; } paint(); };
  $('wcTpl').onchange = () => { const t = templates.find(x => x.id === $('wcTpl').value); if (t) $('wcBody').value = t.body; paint(); };
  $('wcQ').oninput = () => { search = $('wcQ').value.trim().toLowerCase(); drawList(); };
  $('wcList').onchange = e => { const x = e.target.closest('[data-c]'); if (!x) return; x.checked ? sel.add(x.dataset.c) : sel.delete(x.dataset.c); paint(); };
  $('wcAll').onclick = () => { visible().forEach(c => sel.add(c.id)); drawList(); paint(); };
  $('wcClear').onclick = () => { sel.clear(); drawList(); paint(); };
  for (const id of ['wcBody', 'wcInt', 'wcName']) $(id).addEventListener('input', paint);
  $('wcRange').oninput = () => { $('wcInt').value = $('wcRange').value; paint(); };
  $('wcPhoto').onchange = () => {
    const f = $('wcPhoto').files?.[0]; if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024) { $('wcErr').textContent = 'Choose a JPG, PNG or WEBP image up to 5 MB.'; $('wcPhoto').value = ''; return; }
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoFile = f; photoUrl = URL.createObjectURL(f);
    $('wcImg').src = photoUrl; $('wcImg').hidden = false; $('wcPhotoName').textContent = f.name; $('wcPhotoRm').hidden = false; $('wcErr').textContent = ''; paint();
  };
  $('wcPhotoRm').onclick = () => { if (photoUrl) URL.revokeObjectURL(photoUrl); photoUrl = ''; photoFile = null; $('wcPhoto').value = ''; $('wcImg').hidden = true; $('wcImg').removeAttribute('src'); $('wcPhotoName').textContent = 'No photo selected'; $('wcPhotoRm').hidden = true; paint(); };
  $('wcReset').onclick = () => { sel.clear(); $('wcBody').value = ''; $('wcName').value = ''; $('wcDesc').value = ''; $('wcKind').value = 'offer'; fillTpls(); $('wcInt').value = '120'; $('wcPhotoRm').click(); $('wcErr').textContent = 'Campaign form reset.'; drawList(); paint(); };
  $('wcStart').onclick = async () => {
    $('wcErr').textContent = ''; $('wcStart').disabled = true;
    try {
      let imageUrl = null, imagePath = null;
      if (photoFile) {
        $('wcErr').textContent = 'Uploading photo…';
        imagePath = `${prof.branch_id}/${crypto.randomUUID()}.${photoFile.type === 'image/png' ? 'png' : photoFile.type === 'image/webp' ? 'webp' : 'jpg'}`;
        const up = await sb.storage.from('whatsapp-media').upload(imagePath, photoFile, { contentType: photoFile.type, upsert: false });
        if (up.error) throw up.error;
        const pub = sb.storage.from('whatsapp-media').getPublicUrl(imagePath).data?.publicUrl;
        imageUrl = /^https?:\/\//.test(pub || '') ? pub : null;
      }
      $('wcErr').textContent = 'Preparing messages…';
      const id = await rpc('whatsapp_campaign_create', { p_name: $('wcName').value.trim(), p_description: $('wcDesc').value.trim() || null, p_kind: $('wcKind').value, p_body: $('wcBody').value.trim(),
        p_image_url: imageUrl, p_image_path: imagePath, p_interval: intSec(), p_customers: [...sel] });
      const localPhoto = photoFile;
      $('puDlg').close(); toast('Campaign created.'); refreshSoon();
      runCampaign(id, localPhoto);
    } catch (e) { $('wcErr').textContent = friendly(e); $('wcStart').disabled = false; }
  };
}
$('newCampaign').addEventListener('click', () => composeCampaign());

// ---------------------------------------------------------------------------
// Runner: one chat at a time, interval enforced (campaigns and lists)
// ---------------------------------------------------------------------------
let run = null;
async function runCampaign(id, localPhoto = null) {
  let c, q;
  try { [c, q] = await Promise.all([rpc('whatsapp_campaigns_list', { p_limit: 500 }).then(r => (r || []).find(x => x.id === id)), rpc('whatsapp_campaign_queue', { p_id: id })]); }
  catch (e) { return toast(friendly(e), true); }
  if (!c) return toast('Campaign not found.', true);
  if (c.status === 'paused') { try { await rpc('whatsapp_campaign_status', { p_id: id, p_status: 'active' }); } catch (e) { return toast(friendly(e), true); } }
  const msgs = (q || []).filter(m => m.status === 'queued');
  if (!msgs.length) { toast('Nothing left to send in this campaign.'); return refreshSoon(); }
  runQueue({ title: c.name, msgs, interval: c.interval_sec, campaign: c, photo: localPhoto, photoUrl: c.image_url });
}
function runQueue(o) {
  if (run) clearInterval(run.timer);
  run = { ...o, index: 0, opened: 0, skipped: 0, nextAt: 0, timer: null, total: o.msgs.length, photoBlob: o.photo || null };
  run.timer = setInterval(() => { if (run && $('runDlg').open) tickRun(); }, 1000);
  if (!$('runDlg').open) $('runDlg').showModal();
  paintRun();
}
// Only the countdown changes every second; the rest is drawn when the step changes.
function tickRun() {
  const b = $('runPanel').querySelector('[data-run="open"]');
  if (!b || run.painted !== run.index) return paintRun();
  const wait = Math.max(0, Math.ceil((run.nextAt - Date.now()) / 1000));
  b.disabled = !!wait;
  b.querySelector('span').textContent = wait ? `Next chat in ${fmtDuration(wait)}` : 'Open WhatsApp chat';
}
function paintRun() {
  if (!run) return;
  run.painted = run.index;
  const m = run.msgs[run.index], done = run.index >= run.msgs.length;
  const wait = Math.max(0, Math.ceil((run.nextAt - Date.now()) / 1000));
  const pct = Math.round(run.index / Math.max(1, run.total) * 100);
  const hasPhoto = !!(run.photoBlob || run.photoUrl || m?.image_url);
  $('runPanel').innerHTML = done
    ? `<div class="wa-run"><h3 class="rt-dlg-title">${I.check} ${esc(run.title)} — finished</h3><p>Opened <b>${run.opened}</b> of ${run.total} chat(s)${run.skipped ? `, skipped ${run.skipped}` : ''}.</p><div class="wa-progress"><span style="width:100%"></span></div>
       <div class="wa-dlg-foot"><button type="button" class="pos-btn pos-btn-solid" data-run="close">Close</button></div></div>`
    : `<div class="wa-run"><div class="wa-run-head"><h3 class="rt-dlg-title">${I.wa} ${esc(run.title)}</h3><span class="dl-muted">Sending ${run.index + 1} of ${run.total} · opened ${run.opened}${run.skipped ? ` · skipped ${run.skipped}` : ''}</span></div>
       <div class="wa-progress"><span style="width:${pct}%"></span></div>
       <div class="wa-run-to"><span class="wa-av ${avCls(m.name)}">${esc(initials(m.name))}</span><div><b>${esc(m.name || 'Customer')}</b><small>${esc(prettyPhone(m.phone))}</small></div></div>
       <div class="wa-preview-bubble">${esc(m.body).replace(/\n/g, '<br>')}</div>
       ${hasPhoto ? `<p class="dl-muted wa-run-photo-hint">${I.photo} WhatsApp links cannot attach a photo. Use <b>Copy photo</b> and paste it (Ctrl + V) in the chat${navigator.canShare ? ', or <b>Share photo</b> on a phone' : ''}.</p>` : ''}
       <div class="wa-run-acts">
         <button type="button" class="pos-btn pos-btn-solid" data-run="open" ${wait ? 'disabled' : ''}>${I.wa}<span>${wait ? `Next chat in ${fmtDuration(wait)}` : 'Open WhatsApp chat'}</span></button>
         ${hasPhoto ? `<button type="button" class="pos-btn" data-run="photo">${I.copy}<span>Copy photo</span></button>${navigator.canShare ? `<button type="button" class="pos-btn" data-run="share">${I.share}<span>Share photo</span></button>` : ''}` : ''}
         <button type="button" class="pos-btn" data-run="skip">${I.skip}<span>Skip</span></button>
         <button type="button" class="pos-btn" data-run="stop">${run.campaign ? `${I.pause}<span>Pause</span>` : `${I.stop}<span>Stop</span>`}</button>
       </div>
       ${run.campaign && isAdmin ? `<button type="button" class="dl-link wa-run-cancel" data-run="cancel">Cancel campaign (don't send the rest)</button>` : ''}
       <p class="dl-muted wa-run-note">${run.interval ? `The next chat opens after ${fmtDuration(run.interval)} — this keeps your number safe from WhatsApp spam limits.` : 'Press Send in WhatsApp, then come back for the next one.'} You can close this and continue later from ${run.campaign ? 'WhatsApp Campaigns' : 'Waiting to send'}.</p></div>`;
}
async function photoBlob() {
  if (run.photoBlob) return run.photoBlob;
  const url = run.photoUrl || run.msgs[run.index]?.image_url;
  const r = await fetch(url); if (!r.ok) throw new Error('Could not load the photo');
  run.photoBlob = await r.blob(); return run.photoBlob;
}
$('runDlg').addEventListener('cancel', e => { e.preventDefault(); stopRun(); });
$('runPanel').addEventListener('click', async e => {
  const b = e.target.closest('[data-run]'); if (!b || !run) return;
  const k = b.dataset.run, m = run.msgs[run.index];
  if (k === 'open') {
    await sendNow({ ...m }, { quiet: true });
    run.opened++; run.index++; run.nextAt = run.interval ? Date.now() + run.interval * 1000 : 0;
  } else if (k === 'skip') { if (m.id && has30) await markStatus([m.id], 'skipped', 'Skipped while sending'); run.skipped++; run.index++; }
  else if (k === 'photo') {
    try {
      const blob = await photoBlob(), bmp = await createImageBitmap(blob);
      const cv = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height }); cv.getContext('2d').drawImage(bmp, 0, 0);
      const png = await new Promise(r => cv.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      b.innerHTML = `${I.tick}<span>Photo copied — paste it in the chat</span>`;
    } catch {
      try { const blob = await photoBlob(); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'offer-photo' }); a.click(); b.innerHTML = `${I.download}<span>Photo downloaded — attach it in the chat</span>`; }
      catch { b.innerHTML = `${I.xs}<span>Photo not available</span>`; }
    }
    return;
  } else if (k === 'share') {
    try { const blob = await photoBlob(); const f = new File([blob], 'offer.jpg', { type: blob.type || 'image/jpeg' }); await navigator.share({ files: [f], text: m.body }); } catch { /* cancelled */ }
    return;
  } else if (k === 'stop') return stopRun();
  else if (k === 'cancel') {
    if (!confirm(`Cancel "${run.title}"? The ${run.total - run.index} message(s) not sent yet will be skipped.`)) return;
    try { await rpc('whatsapp_campaign_status', { p_id: run.campaign.id, p_status: 'cancelled' }); toast('Campaign cancelled.'); } catch (err) { toast(friendly(err), true); }
    return stopRun(true);
  } else if (k === 'close') return stopRun(true);
  paintRun();
});
async function stopRun(final = false) {
  if (!run) { $('runDlg').close(); return; }
  clearInterval(run.timer);
  if (!final && run.campaign && run.index < run.msgs.length) { try { await rpc('whatsapp_campaign_status', { p_id: run.campaign.id, p_status: 'paused' }); toast('Campaign paused. Continue it any time from WhatsApp Campaigns.'); } catch { /* already finished */ } }
  run = null; $('runDlg').close(); refreshSoon();
}

// ---------------------------------------------------------------------------
// Campaign list / detail
// ---------------------------------------------------------------------------
async function showCampaigns() {
  if (!has30) return needs30();
  try { campaigns = (await rpc('whatsapp_campaigns_list', { p_limit: 200 })) || []; } catch (e) { return toast(friendly(e), true); }
  dlg(`<div class="wa-row-b"><h3 class="rt-dlg-title">${I.mega} WhatsApp Campaigns <small class="dl-muted">(${count(campaigns.length)})</small></h3>${isAdmin ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="caNew">${I.plusC}<span>New Campaign</span></button>` : ''}</div>
    <div class="dl-table-wrap wa-bills-wrap"><table class="dl-table wa-bills wa-camp-table"><thead><tr><th>Campaign</th><th>Status</th><th>Progress</th><th>Started</th><th class="c-c"></th></tr></thead>
    <tbody id="caRows">${campaigns.map(c => { const [l, cls] = CSTATUS[c.status]; const p = c.total ? Math.round((c.sent + c.skipped) / c.total * 100) : 0; return `<tr data-camp="${esc(c.id)}"><td><b>${esc(c.name)}</b><small>${esc(c.description || '')}</small></td><td><span class="md-chip ${cls}">${l}</span></td>
      <td><div class="wa-progress sm"><span style="width:${p}%"></span></div><small>Sent ${count(c.sent)} of ${count(c.total)}${c.skipped ? ` · skipped ${count(c.skipped)}` : ''}</small></td><td>${esc(when(c.started_at || c.created_at))}<small>${esc(c.created_by_name || '')}</small></td>
      <td class="c-c">${c.queued && c.status !== 'cancelled' ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-ca="run">${I.play}<span>Continue</span></button>` : `<button type="button" class="pos-btn pos-btn-sm" data-ca="view">View</button>`}</td></tr>`; }).join('') || '<tr><td colspan="5" class="dl-empty">No campaigns yet.</td></tr>'}</tbody></table></div>`, 'wa-bills-dlg');
  if ($('caNew')) $('caNew').onclick = () => composeCampaign();
  $('caRows').onclick = e => { const tr = e.target.closest('tr[data-camp]'); if (!tr) return; const b = e.target.closest('[data-ca]'); if (b?.dataset.ca === 'run') { $('puDlg').close(); return runCampaign(tr.dataset.camp); } campaignDetail(tr.dataset.camp); };
}
async function campaignDetail(id) {
  let c = campaigns.find(x => x.id === id), q = [];
  try { [q] = await Promise.all([rpc('whatsapp_campaign_queue', { p_id: id })]); if (!c) c = ((await rpc('whatsapp_campaigns_list', { p_limit: 500 })) || []).find(x => x.id === id); } catch (e) { return toast(friendly(e), true); }
  const [l, cls] = CSTATUS[c.status];
  const live = ['active', 'paused'].includes(c.status);
  dlg(`<div class="wa-cd-head"><div><h3 class="rt-dlg-title">${I.mega} ${esc(c.name)} <span class="md-chip ${cls}">${l}</span></h3><p class="dl-muted">${esc(c.description || '')} · ${esc((KIND[c.kind] || KIND.custom)[0])} · every ${esc(fmtDuration(c.interval_sec))} · started ${esc(when(c.started_at || c.created_at))}${c.created_by_name ? ` by ${esc(c.created_by_name)}` : ''}</p></div></div>
    <div class="wa-sum"><div><b>${count(c.total)}</b><span>Recipients</span></div><div><b>${count(c.sent)}</b><span>Sent</span></div><div><b>${count(c.queued)}</b><span>Waiting</span></div><div><b>${count(c.skipped)}</b><span>Skipped</span></div></div>
    <div class="wa-cd-body">${c.image_url ? `<img class="wa-cd-img" src="${esc(c.image_url)}" alt="Campaign photo">` : ''}<div class="wa-preview-bubble">${esc(c.body).replace(/\n/g, '<br>')}</div></div>
    <div class="wa-dlg-foot">${live && c.queued ? `<button type="button" class="pos-btn pos-btn-solid" data-cd="run">${I.play}<span>${c.status === 'paused' ? 'Continue sending' : 'Send now'}</span></button>` : ''}
      ${live && isAdmin && c.status === 'active' ? `<button type="button" class="pos-btn" data-cd="pause">${I.pause}<span>Pause</span></button>` : ''}
      ${live && isAdmin ? `<button type="button" class="pos-btn" data-cd="cancel">${I.stop}<span>Cancel</span></button>` : ''}
      ${isAdmin ? `<button type="button" class="pos-btn" data-cd="dup">${I.copy}<span>Send again (copy)</span></button>` : ''}</div>
    <h4 class="wa-sub">Recipients</h4>
    <div class="dl-table-wrap wa-bills-wrap"><table class="dl-table wa-bills"><thead><tr><th>Customer</th><th>Status</th></tr></thead><tbody>${q.map(m => { const [sl, sc, si] = STATUS[m.status]; return `<tr><td><b>${esc(m.name || '')}</b><small>${esc(prettyPhone(m.phone))}</small></td><td><span class="wa-st ${sc}">${si}<span>${sl}</span></span></td></tr>`; }).join('')}</tbody></table></div>`, 'wa-bills-dlg');
  $('puPanel').onclick = async e => {
    const b = e.target.closest('[data-cd]'); if (!b) return;
    const k = b.dataset.cd;
    if (k === 'run') { $('puDlg').close(); return runCampaign(id); }
    if (k === 'dup') return composeCampaign({ name: `${c.name} (again)`, description: c.description, kind: ['offer', 'health'].includes(c.kind) ? c.kind : 'custom', body: c.body, interval: c.interval_sec, customers: q.map(m => m.customer_id).filter(Boolean) });
    if (k === 'cancel' && !confirm(`Cancel "${c.name}"? ${c.queued} message(s) not sent yet will be skipped.`)) return;
    try { await rpc('whatsapp_campaign_status', { p_id: id, p_status: k === 'pause' ? 'paused' : 'cancelled' }); toast(k === 'pause' ? 'Campaign paused.' : 'Campaign cancelled.'); await loadCampaigns(); campaignDetail(id); refreshSoon(); }
    catch (err) { toast(friendly(err), true); }
  };
}

// ---------------------------------------------------------------------------
// Templates manage / edit
// ---------------------------------------------------------------------------
function showTemplates() {
  if (!has30) return needs30();
  dlg(`<div class="wa-row-b"><h3 class="rt-dlg-title">${I.doc} Message Templates</h3>${settings.can_manage ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="tNew">${I.plusC}<span>New template</span></button>` : ''}</div>
    <p class="dl-muted">Ready-made texts used by billing (invoice), order updates, reminders and campaigns. Placeholders: ${PLACEHOLDERS.map(([k, l]) => `<code title="${esc(l)}">{{${k}}}</code>`).join(' ')}</p>
    <div class="wa-tpl-list wa-tpl-all" id="tAll">${templates.map(t => tplRow(t, `<span class="wa-tpl-tags">${t.is_system ? '<span class="md-chip off">Ready-made</span>' : '<span class="md-chip blue">Yours</span>'}${t.active ? '' : '<span class="md-chip low">Off</span>'}</span>`)).join('')}</div>`, 'wa-tpl-dlg');
  if ($('tNew')) $('tNew').onclick = () => editTemplate(null);
  $('tAll').onclick = e => { const b = e.target.closest('[data-tpl]'); if (b) editTemplate(templates.find(t => t.id === b.dataset.tpl)); };
}
function editTemplate(t) {
  if (!settings.can_manage) return toast('Only Admin can edit templates.', true);
  const kinds = ['custom', 'order_update', 'delivery', 'payment_reminder', 'refill_reminder', 'health', 'offer', ...(t?.kind === 'invoice' ? ['invoice'] : [])];
  dlg(`<h3 class="rt-dlg-title">${I.pencil} ${t ? `Edit · ${esc(t.name)}` : 'New template'}</h3>
    ${t?.code === 'invoice' ? '<p class="wa-note">This text goes out with every bill. Keep <code>{{link}}</code> so the customer gets the invoice link.</p>' : ''}
    <div class="md-form-grid">
      <div class="pos-field"><label for="tName">Name</label><input id="tName" maxlength="80" value="${esc(t?.name || '')}"></div>
      <div class="pos-field"><label for="tKind">Type</label><select id="tKind" ${t?.is_system ? 'disabled' : ''}>${kinds.map(k => `<option value="${k}"${(t?.kind || 'custom') === k ? ' selected' : ''}>${KIND[k][0]}</option>`).join('')}</select></div>
      <div class="pos-field md-span-2"><label for="tBody">Message</label><textarea id="tBody" rows="7" maxlength="1024">${esc(t?.body || '')}</textarea>
        <div class="wa-chips" id="tPh">${PLACEHOLDERS.map(([k, l]) => `<button type="button" data-ph="${k}" title="${esc(l)}">{{${k}}}</button>`).join('')}</div></div>
      <label class="wa-check md-span-2"><input type="checkbox" id="tActive" ${t?.active === false ? '' : 'checked'}> Active (show this template when writing messages)</label>
    </div>
    <div class="wa-preview-bubble" id="tPrev"></div>
    <p class="pos-form-msg" id="tErr"></p>
    <div class="wa-dlg-foot">${t ? `<button type="button" class="pos-btn" id="tDel">${t.is_system ? `${I.undo}<span>Reset to original</span>` : `${I.xs}<span>Delete</span>`}</button>` : ''}<button type="button" class="pos-btn" id="tBack">Back</button><button type="button" class="pos-btn pos-btn-solid" id="tSave">Save template</button></div>`, 'wa-compose');
  const sample = { name: 'Ajay', shop: settings.shop, order_no: 'INV-01456', amount: '1,280.00', date: '20 Jan 2026', link: `${siteBase()}invoice-view.html?t=…`, due: '1,280.00', medicine_name: 'Paracetamol 500 mg', photo: 'https://…/offer.jpg' };
  const paint = () => { $('tPrev').innerHTML = `<span>${esc(fill($('tBody').value, sample)).replace(/\n/g, '<br>')}</span><small>Preview with sample values</small>`; };
  paint();
  $('tBody').oninput = paint;
  $('tPh').onclick = e => { const b = e.target.closest('[data-ph]'); if (!b) return; const ta = $('tBody'), s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, s) + `{{${b.dataset.ph}}}` + ta.value.slice(ta.selectionEnd ?? s); ta.focus(); paint(); };
  $('tBack').onclick = showTemplates;
  $('tSave').onclick = async () => {
    $('tErr').textContent = '';
    if (t?.code === 'invoice' && !/\{\{\s*link\s*\}\}/.test($('tBody').value) && !confirm('The invoice template has no {{link}} — customers will not get the invoice link. Save anyway?')) return;
    try { await rpc('whatsapp_template_save', { p_id: t?.id || null, p_name: $('tName').value.trim(), p_kind: $('tKind').value, p_body: $('tBody').value.trim(), p_active: $('tActive').checked }); toast('Template saved.'); await loadTemplates(); showTemplates(); }
    catch (e) { $('tErr').textContent = friendly(e); }
  };
  if ($('tDel')) $('tDel').onclick = async () => {
    if (!confirm(t.is_system ? `Reset "${t.name}" to the original text?` : `Delete the template "${t.name}"?`)) return;
    try { await rpc('whatsapp_template_delete', { p_id: t.id }); toast(t.is_system ? 'Template reset.' : 'Template deleted.'); await loadTemplates(); showTemplates(); }
    catch (e) { $('tErr').textContent = friendly(e); }
  };
}

// ---------------------------------------------------------------------------
// More menu: settings, help, export
// ---------------------------------------------------------------------------
function showSettings() {
  if (!has30) return needs30();
  const can = settings.can_manage;
  dlg(`<h3 class="rt-dlg-title">${I.gear} WhatsApp settings</h3>
    <div class="wa-set">
      <label class="wa-switch"><input type="checkbox" id="sAuto" ${settings.auto_invoice ? 'checked' : ''} ${can ? '' : 'disabled'}><span></span><b>Send the invoice on WhatsApp after every bill</b><small>When a bill is finalised for a customer (or a patient phone), the invoice message with a private view / download link is prepared automatically.</small></label>
      <label class="wa-switch"><input type="checkbox" id="sOpen" ${settings.open_after_bill ? 'checked' : ''} ${can ? '' : 'disabled'}><span></span><b>Open WhatsApp straight after the bill</b><small>The counter only has to press Send. If off, the bill shows a "Send on WhatsApp" button and the message waits in the list.</small></label>
      <label class="wa-switch"><input type="checkbox" id="sLink" ${settings.attach_link_offers ? 'checked' : ''} ${can ? '' : 'disabled'}><span></span><b>Add the photo link to campaign messages</b><small>Customers can open the offer photo even when it is not pasted into the chat.</small></label>
      <div class="pos-field"><label for="sSig">Signature added to every message <small class="dl-muted">(optional)</small></label><input id="sSig" maxlength="200" placeholder="e.g. — Pallikkal Pharmacy, Ph 0486-2000000" value="${esc(settings.signature || '')}" ${can ? '' : 'disabled'}></div>
      <p class="wa-note">${I.link} Invoice links point to <b>${esc(settings.base_url || siteBase())}invoice-view.html</b>. Links work for 180 days and show no diagnosis, doctor or address.</p>
    </div>
    <p class="pos-form-msg" id="sErr"></p>
    <div class="wa-dlg-foot">${can ? '<button type="button" class="pos-btn pos-btn-solid" id="sSave">Save settings</button>' : '<span class="dl-muted">Only Admin can change these settings.</span>'}</div>`, 'wa-compose');
  if ($('sSave')) $('sSave').onclick = async () => {
    try { settings = { ...settings, ...(await rpc('whatsapp_settings_save', { p_auto_invoice: $('sAuto').checked, p_open_after_bill: $('sOpen').checked, p_attach_link_offers: $('sLink').checked, p_signature: $('sSig').value })) }; toast('Settings saved.'); $('puDlg').close(); }
    catch (e) { $('sErr').textContent = friendly(e); }
  };
}
function showHelp() {
  dlg(`<h3 class="rt-dlg-title">${I.info} How WhatsApp sending works (free)</h3>
    <ol class="wa-help">
      <li><b>Everything is prepared for you.</b> Invoices after billing, order updates, payment and refill reminders, and campaign messages are written from your templates and saved here.</li>
      <li><b>One tap to send.</b> Tapping <i>Send on WhatsApp</i> opens WhatsApp (app or WhatsApp Web) on this device with the customer and text filled in. Press <b>Send</b> in WhatsApp. It is then marked Sent here.</li>
      <li><b>Invoices</b> go as a private link. The customer opens it to view or download the PDF — no login, no app.</li>
      <li><b>Photos in campaigns:</b> WhatsApp links cannot carry a photo, so use <i>Copy photo</i> and paste it in the chat (or <i>Share photo</i> on a phone). The photo link is also added to the text.</li>
      <li><b>Bulk sending</b> opens one chat at a time with your interval between chats, so WhatsApp does not treat your number as spam. Pause any time and continue later from any device.</li>
      <li><b>Cost:</b> ₹0 — it uses your normal WhatsApp / WhatsApp Business app. Customer replies arrive in WhatsApp; use <i>Log the customer's reply</i> in a conversation to keep a note here.</li>
    </ol>`, 'wa-compose');
}
async function exportCsv() {
  const [f, t] = periodRange($('actPeriod').value);
  try {
    const rows = (await rpc('whatsapp_activity', { p_from: f, p_to: t, p_kind: $('actKind').value || null, p_status: $('actStatus').value || null, p_search: $('actQ').value.trim() || null, p_limit: 500, p_offset: 0 })) || [];
    const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['Date & time', 'Customer', 'Phone', 'Type', 'Status', 'Bill', 'Campaign', 'By', 'Message'].join(','), ...rows.map(m => [when(m.at), m.name || '', `+${m.phone}`, (KIND[m.kind] || KIND.custom)[0], (STATUS[m.status] || STATUS.queued)[0], m.invoice_no || '', m.campaign_name || '', m.by_name || '', m.body].map(q).join(','))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = `whatsapp-activity-${today()}.csv`; document.body.appendChild(a); a.click(); a.remove();
    toast(`Exported ${rows.length} message(s).`);
  } catch (e) { toast(friendly(e), true); }
}
$('moreMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-more]'); if (!b) return;
  closePops();
  ({ queue: showQueue, unshared: () => showBills(true), campaigns: showCampaigns, templates: showTemplates, conversations: showConversations, export: exportCsv, settings: showSettings, help: showHelp })[b.dataset.more]();
});

// ---------------------------------------------------------------------------
// Bell, load, deep links
// ---------------------------------------------------------------------------
function notify() {
  const items = [];
  if (!has30) items.push({ tone: 'warn', title: 'WhatsApp log not set up', detail: 'Run database migration 0030', href: 'whatsapp.html' });
  if (ov?.pending_invoices) items.push({ tone: 'warn', title: `${ov.pending_invoices} invoice(s) waiting to be sent`, detail: 'More → Waiting to send', href: 'whatsapp.html?show=queue' });
  else if (ov?.pending) items.push({ tone: 'info', title: `${ov.pending} message(s) waiting to be sent`, detail: 'More → Waiting to send', href: 'whatsapp.html?show=queue' });
  const live = campaigns.filter(c => c.status === 'active' || c.status === 'paused');
  for (const c of live.slice(0, 2)) items.push({ tone: 'info', title: `Campaign "${c.name}" ${c.status === 'paused' ? 'paused' : 'in progress'}`, detail: `${c.sent} of ${c.total} sent`, href: 'whatsapp.html?show=campaigns' });
  if (ov && ov.bills_with_phone > ov.bills_shared + ov.pending_invoices) items.push({ tone: 'info', title: `${ov.bills_with_phone - ov.bills_shared - ov.pending_invoices} bill(s) this month not shared`, detail: 'More → Bills not shared yet', href: 'whatsapp.html?show=unshared' });
  setNotifications(items);
}
async function loadAll(first = true) {
  if (first) await loadSettings();
  await Promise.all([loadOverview(), loadTemplates()]);
  await Promise.all([loadConvs(), loadCampaigns(), loadActivity(first ? 0 : actPage)]);
  notify();
}
await loadAll(true);
const params = new URLSearchParams(location.search);
const show = params.get('show');
if (show === 'queue') showQueue(); else if (show === 'unshared') showBills(true); else if (show === 'campaigns') showCampaigns(); else if (show === 'templates') showTemplates(); else if (show === 'settings') showSettings();
else if (params.get('phone')) openThread(params.get('phone'));
else if (params.get('new') === 'campaign') composeCampaign();
