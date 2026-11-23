// Returns Management — Pallikkal Pharmacy design. Sales returns (credit notes: refund or exchange,
// Cash / UPI, restock or damaged) and purchase returns to distributors (debit notes, expiry returns).
// KPIs, returns by reason, trend, top returned medicines (0027_returns_management.sql).
// Existing flows kept: invoice search → returnable items → process_sales_return; purchase invoice →
// purchase_returnable → process_purchase_return. Works on older databases until 0027 is run.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { showCreditNote, printHTML } from './invoice.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('returns', 'Returns', { layout: 'brand' });
if (!prof) throw new Error('Unable to load user profile.');
const view = document.getElementById('view');
const branchId = prof.branch_id;
const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const canCustomerReturn = ['super_admin', 'admin', 'admin_staff', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory'].includes(prof.role);   // every staff role (0037)
const canPurchaseReturn = isAdmin;
if (!canCustomerReturn && !canPurchaseReturn) { view.textContent = 'Not authorised to view returns.'; throw new Error('Not authorised'); }
if (!branchId) { view.textContent = 'Your profile has no assigned branch. Contact the administrator.'; throw new Error('Missing profile branch_id.'); }

const $ = id => document.getElementById(id);
const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const istDay = v => new Date(v).toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money2 = v => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = v => `₹${money2(v)}`;
const rupees0 = v => '₹' + Math.round(num(v)).toLocaleString('en-IN');
const count = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(n));
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const monthStart = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10); };
const monthEnd = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - back, 0)).toISOString().slice(0, 10); };
const dmy = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const dShort = v => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
const tShort = v => new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ }).toUpperCase();
const when = v => new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const digits = v => String(v || '').replace(/\D/g, '');
const waNumber = v => { let d = digits(v); if (d.length === 10) d = `91${d}`; if (d.startsWith('0') && d.length === 11) d = `91${d.slice(1)}`; return d; };
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  box: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/><path d="m8 5.3 8 4.5"/>', 1.8),
  coins: svg('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/><path d="M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>', 1.8),
  pct: svg('<circle cx="12" cy="12" r="9"/><path d="m9 15 6-6"/><circle cx="9.3" cy="9.3" r=".9" fill="currentColor"/><circle cx="14.7" cy="14.7" r=".9" fill="currentColor"/>', 1.9),
  swap: svg('<path d="M4 8h14l-4-4"/><path d="M20 16H6l4 4"/>', 2),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  filter: svg('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  pie: svg('<path d="M21 12a9 9 0 1 1-9-9v9Z"/><path d="M12 3a9 9 0 0 1 9 9h-9Z"/>', 1.9),
  bars: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/></svg>',
  pill: svg('<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m8.5 8.5 7 7"/>', 2),
  refund: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/><path d="M10 9.5c0-.8.9-1.5 2-1.5s2 .7 2 1.5-.9 1.3-2 1.5-2 .7-2 1.5.9 1.5 2 1.5 2-.7 2-1.5M12 7v1M12 15v1"/>', 1.8),
  truck: svg('<path d="M3 6h11v10H3Z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', 1.8),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 2),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.6),
  phone: svg('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/>', 1.9),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>', 1.9),
  bill: svg('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>', 1.9),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', 2.2),
  alert: svg('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h.01"/>', 2),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const REASONS = {
  sales: { wrong_medicine: ['Wrong Medicine', '#12a01b'], adverse_reaction: ['Adverse Reaction', '#1e8fe8'], expired: ['Expired / Near Expiry', '#f5b800'], damaged: ['Damaged Product', '#e5484d'], doctor_changed: ['Doctor Changed Prescription', '#0e9488'], not_needed: ['Not Needed / Excess', '#f08a24'], other: ['Other', '#9b6cf2'] },
  purchase: { expired: ['Expired / Near Expiry', '#f5b800'], damaged: ['Damaged / Broken', '#e5484d'], wrong_item: ['Wrong Item Supplied', '#12a01b'], excess: ['Excess / Slow-moving', '#1e8fe8'], recall: ['Batch Recall', '#0e9488'], other: ['Other', '#9b6cf2'] }
};
const guessReason = (kind, text) => {
  const t = String(text || '').toLowerCase();
  if (/expir/.test(t)) return 'expired';
  if (/damag|broken|leak|torn/.test(t)) return 'damaged';
  if (kind === 'purchase') return /wrong|incorrect/.test(t) ? 'wrong_item' : /recall/.test(t) ? 'recall' : /excess|slow|extra/.test(t) ? 'excess' : 'other';
  return /wrong|mistake|incorrect|strength/.test(t) ? 'wrong_medicine' : /reaction|allerg|rash|side.?effect/.test(t) ? 'adverse_reaction' : /doctor|prescri/.test(t) ? 'doctor_changed' : /not needed|excess|unused|no longer/.test(t) ? 'not_needed' : 'other';
};
const PERIODS = { today: 'Today', '7d': 'Last 7 Days', '30d': 'Last 30 Days', month: 'This Month', lastmonth: 'Last Month', '3m': 'Last 3 Months', year: 'This Year', custom: 'Custom' };
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
const TONES = ['g', 'b', 'p', 'a', 't'];
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

const params = new URLSearchParams(location.search);
let kind = canCustomerReturn ? 'sales' : 'purchase';
if (params.get('tab') === 'purchase' && canPurchaseReturn) kind = 'purchase';
const store = { sales: null, purchase: null };   // { from, to, rows }
let v27 = true;                                     // migration 0027 installed
let page = 1;
let compact = matchMedia('(max-width: 560px)').matches;
const filt = { period: 'month', from: '', to: '', type: '', reason: '', method: '', cond: '', sort: 'new' };
let expiryList = null;

view.innerHTML = `
<div class="pos dl md pur ds sl rt${isAdmin ? '' : ' rt-staff'}">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.undo}</span>
      <div><h1>Returns Management</h1><p id="subTitle">Manage sales returns, refund/adjustments, and return analytics.</p></div></div>
    <div class="pos-head-actions md-head-actions rt-head-actions">
      <button type="button" class="pos-btn pos-btn-solid" id="newReturn">${I.plusC}<span>New Return</span></button>
      <button type="button" class="pos-btn" id="exportBtn">${I.download}<span>Export</span></button>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn ds-more" id="moreBtn" aria-label="More actions" aria-expanded="false">${I.dots}</button>
        <div class="dl-pop md-menu ds-menu rt-more" id="moreMenu" hidden>
          ${canCustomerReturn ? `<button type="button" data-more="new-sales">${I.undo}<span>New sales return (customer)</span></button>` : ''}
          ${canPurchaseReturn ? `<button type="button" data-more="new-purchase">${I.truck}<span>New purchase return (distributor)</span></button>` : ''}
          ${canPurchaseReturn ? `<button type="button" data-more="expiry">${I.clock}<span>Expired / near-expiry stock to return</span></button>` : ''}
          <button type="button" data-more="csv">${I.download}<span>Export CSV</span></button>
          <button type="button" data-more="print">${I.print}<span>Print returns list</span></button>
          ${isAdmin ? `<button type="button" data-more="top">${I.pill}<span>Top returned medicines</span></button>` : ''}
          ${canCustomerReturn ? `<a href="sales.html">${I.bill}<span>Sales bills</span></a>` : ''}
          ${canPurchaseReturn ? `<a href="purchases.html">${I.truck}<span>Purchase bills</span></a>` : ''}
        </div></div>
    </div>
  </section>

  ${canCustomerReturn && canPurchaseReturn ? `<div class="rt-tabs" role="tablist">
    <button type="button" role="tab" id="customer-tab" data-kind="sales">${I.undo}<span>Sales Returns</span><small>from customers</small></button>
    <button type="button" role="tab" id="purchase-tab" data-kind="purchase">${I.truck}<span>Purchase Returns</span><small>to distributors</small></button>
  </div>` : ''}

  <section class="dz-kpis dl-kpis md-kpis">
    ${KPI('green', I.box, 'Total Returns', 'kCount')}
    ${KPI('blue', I.coins, 'Return Value', 'kValue')}
    ${KPI('amber', I.pct, 'Return Rate', 'kRate')}
    ${KPI('purple', I.swap, 'Refunded Amount', 'kFourth')}
  </section>

  <div id="msg" class="md-msg" role="status"></div>

  <div class="rt-grid">
    <section class="pos-card dl-orders ds-list sl-list rt-list">
      <div class="dl-card-head ds-list-head">
        <h2>${I.list}<span id="listTitle">Returns List</span> <span id="listTotal">(0)</span></h2>
        <label class="dl-select ds-status sl-status"><select id="fPeriod" aria-label="Period">${Object.entries(PERIODS).filter(([k]) => k !== 'custom').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="custom" hidden>Custom</option></select></label>
      </div>
      <div class="ds-tools">
        <label class="dl-search">${I.search}<input id="rq" type="search" placeholder="Search by return no., invoice no., customer, or medicine..." autocomplete="off" aria-label="Search returns"></label>
        <div class="dl-pop-anchor">
          <button type="button" class="pos-btn dl-filter-btn" id="filterBtn" aria-expanded="false">${I.filter}<span>Filter</span><b class="dl-filter-dot" id="filterDot" hidden></b></button>
          <div class="dl-pop sl-filter" id="filterPop" hidden>
            <div class="sl-dates"><div class="pos-field"><label for="from">From</label><input id="from" type="date"></div><div class="pos-field"><label for="to">To</label><input id="to" type="date"></div></div>
            <div class="pos-field"><label for="fReason">Reason</label><select id="fReason"></select></div>
            <div class="pos-field rt-s-only"><label for="fType">Refund type</label><select id="fType"><option value="">Any</option><option value="refund">Refund</option><option value="exchange">Exchange</option></select></div>
            <div class="pos-field rt-s-only"><label for="fMethod">Refund by</label><select id="fMethod"><option value="">Any</option><option value="cash">Cash</option><option value="upi">UPI</option></select></div>
            <div class="pos-field rt-s-only"><label for="fCond">Condition</label><select id="fCond"><option value="">Any</option><option value="restock">Returned to stock</option><option value="damaged">Damaged (not restocked)</option></select></div>
            <div class="pos-field"><label for="fSort">Sort by</label><select id="fSort"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="high">Value (high first)</option><option value="low">Value (low first)</option></select></div>
            <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="fReset">Reset</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="fApply">Apply</button></div>
          </div>
        </div>
      </div>
      <div class="dl-table-wrap"><table class="dl-table sl-table rt-table"><thead id="thead"></thead><tbody id="rows"><tr><td colspan="10" class="dl-empty">Loading returns…</td></tr></tbody></table></div>
      <div class="dl-pager md-pager"><span id="pageInfo"></span><div id="pager"></div>
        <button type="button" class="dl-link sl-all" id="viewAll" hidden>View All Returns ${I.chev}</button>
        <label class="dl-select md-per"><select id="perPage" aria-label="Rows per page"><option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></select></label></div>
    </section>

    <section class="pos-card rt-reason">
      <div class="dl-card-head"><h2>${I.pie}Returns by Reason</h2>
        <label class="dl-select pur-mini"><select id="reasonPeriod" aria-label="Period"><option value="month">This Month</option><option value="lastmonth">Last Month</option><option value="3m">Last 3 Months</option><option value="year">This Year</option></select></label></div>
      <div class="rt-reason-box">
        <div class="dl-donut rt-donut"><svg viewBox="0 0 220 220" id="donut" aria-hidden="true"></svg><div class="dl-donut-c"><strong id="donutN">0</strong><span>Returns</span></div></div>
        <div class="rt-legend" id="reasonLegend"></div>
      </div>
      <div class="rt-tiles" id="moneyTiles"></div>
    </section>

    <section class="pos-card pur-trend rt-trend">
      <div class="dl-card-head"><h2>${I.bars}Return Trend</h2>
        <label class="dl-select pur-mini"><select id="trendRange" aria-label="Range"><option value="7">Last 7 Days</option><option value="30">Last 30 Days</option><option value="month">This Month</option><option value="6m">Last 6 Months</option><option value="12m">Last 12 Months</option></select></label></div>
      <div class="dz-chart pur-chart" id="chart"></div>
      <p class="pur-chart-sub" id="chartSub"></p>
    </section>

    <section class="pos-card pur-top sl-top rt-top">
      <div class="dl-card-head"><h2>${I.pill}Top Returned Medicines <small id="topLabel"></small></h2><button type="button" class="dl-link" id="topAll">View All ${I.chev}</button></div>
      <div class="dl-table-wrap"><table class="dl-table md-plain pur-top-table sl-top-table"><thead><tr><th class="c-no">#</th><th>Medicine</th><th class="c-r">Return Qty</th><th class="c-r sl-val">Return Value</th></tr></thead><tbody id="topRows"><tr><td colspan="4" class="dl-empty">Loading…</td></tr></tbody></table></div>
    </section>
  </div>
</div>

<dialog id="newDlg" class="pos-dialog dl-dialog md-wide sl-dlg rt-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="newBody"></div></dialog>
<dialog id="viewDlg" class="pos-dialog dl-dialog md-wide sl-dlg rt-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="viewBody"></div></dialog>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg rt-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const note = (m, bad) => { $('msg').textContent = m; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; if (m) toast(m, bad); };
for (const d of ['newDlg', 'viewDlg', 'puDlg']) $(d).addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $(d)) $(d).close(); });
const dlg = html => { $('puPanel').innerHTML = html; if (!$('puDlg').open) $('puDlg').showModal(); };
const reasonOf = (k, code) => (REASONS[k][code] || REASONS[k].other);

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const missing = e => /sales_returns_list|purchase_returns_list|returns_top_medicines|returns_base_total|return_detail|_returns_guard|expiry_return_candidates|_v2|function|schema cache|does not exist/i.test(e?.message || '');
const was27Missing = () => { if (v27) { v27 = false; note('Return reasons, exchange, charts and top medicines need database migration 0027_returns_management.sql. Run it once in Supabase. Creating returns still works.', true); } };
function windowFor(p) {
  const t = today();
  if (p === 'today') return [t, t];
  if (p === '7d') return [addDays(t, -6), t];
  if (p === '30d') return [addDays(t, -29), t];
  if (p === 'month') return [monthStart(t), t];
  if (p === 'lastmonth') return [monthStart(t, 1), monthEnd(t, 1)];
  if (p === '3m') return [monthStart(t, 2), t];
  if (p === 'year') return [t.slice(0, 4) + '-01-01', t];
  return [filt.from || t, filt.to || t];
}
function baseWindow() { const t = today(), a = monthStart(t, 11), b = t.slice(0, 4) + '-01-01'; return [a < b ? a : b, t]; }
async function fetchRange(k, from, to) {
  if (v27) {
    const { data, error } = await sb.rpc(k === 'sales' ? 'sales_returns_list' : 'purchase_returns_list', { p_from: from, p_to: to });
    if (!error) return data || [];
    if (!missing(error)) throw error;
    was27Missing();
  }
  // Older database: read the tables / old list function and guess reasons from the text.
  if (k === 'sales') {
    const { data, error } = await sb.from('sales_returns').select('id,return_no,invoice_id,customer_id,total,tax,refund_method,reason,created_at,sales_invoices(invoice_no)')
      .eq('branch_id', branchId).gte('created_at', `${from}T00:00:00+05:30`).lt('created_at', `${addDays(to, 1)}T00:00:00+05:30`).order('created_at', { ascending: false }).limit(5000);
    if (error) throw error;
    const ids = [...new Set((data || []).map(r => r.customer_id).filter(Boolean))], cm = {};
    if (ids.length) { const { data: cs } = await sb.from('customers').select('id,name,phone').in('id', ids); for (const c of cs || []) cm[c.id] = c; }
    return (data || []).map(r => ({ ...r, invoice_no: r.sales_invoices?.invoice_no || '', customer_name: cm[r.customer_id]?.name || null, customer_phone: cm[r.customer_id]?.phone || null, items: null, qty: null, refund_type: 'refund', reason_code: guessReason('sales', r.reason), restocked: 0, damaged: 0, created_by_name: '', medicines: '' }));
  }
  const { data, error } = await sb.rpc('purchase_return_list', { p_limit: 1000 });
  if (error) throw error;
  const { data: pl } = await sb.rpc('purchase_list', { p_limit: 1000 });
  const pm = new Map((pl || []).map(p => [p.id, p]));
  return (data || []).filter(r => istDay(r.created_at) >= from && istDay(r.created_at) <= to).map(r => ({ ...r, total: r.total_value, supplier_invoice_no: pm.get(r.purchase_invoice_id)?.supplier_invoice_no || '', distributor_name: pm.get(r.purchase_invoice_id)?.distributor || '', items: null, qty: null, reason_code: guessReason('purchase', r.reason), medicines: '', created_by_name: '' }));
}
async function ensure(k, from, to) {
  const s = store[k];
  if (s && s.from <= from && s.to >= to) return s.rows.filter(r => istDay(r.created_at) >= from && istDay(r.created_at) <= to);
  const [bf, bt] = baseWindow();
  const f = from < bf ? from : bf, t2 = to > bt ? to : bt;
  const span = (new Date(t2) - new Date(f)) / 864e5;
  const rows = await fetchRange(k, span > 400 ? from : f, span > 400 ? to : t2);
  if (span <= 400) store[k] = { from: f, to: t2, rows };
  return rows.filter(r => istDay(r.created_at) >= from && istDay(r.created_at) <= to);
}
const inWin = (rows, [a, b]) => rows.filter(r => { const d = istDay(r.created_at); return d >= a && d <= b; });
const sum = (rows, f = 'total') => rows.reduce((a, r) => a + num(r[f]), 0);
let baseCache = {};
async function baseTotal(k, from, to) {
  const key = `${k}|${from}|${to}`;
  if (key in baseCache) return baseCache[key];
  let v = null;
  if (v27) { const { data, error } = await sb.rpc('returns_base_total', { p_kind: k, p_from: from, p_to: to }); if (!error) v = num(data); else if (missing(error)) was27Missing(); }
  if (v === null && k === 'sales') { const { data } = await sb.rpc('sales_summary', { p_from: from, p_to: to }); if (data?.[0]) v = num(data[0].sales); }
  baseCache[key] = v;
  return v;
}

// ---------------------------------------------------------------------------
// Mode (sales / purchase)
// ---------------------------------------------------------------------------
function applyMode() {
  document.querySelectorAll('.rt-tabs [data-kind]').forEach(b => { b.classList.toggle('on', b.dataset.kind === kind); b.setAttribute('aria-selected', String(b.dataset.kind === kind)); });
  $('subTitle').textContent = kind === 'sales' ? 'Manage sales returns, refund/adjustments, and return analytics.' : 'Return expired, damaged or wrong stock to distributors and track supplier credit.';
  $('listTitle').textContent = kind === 'sales' ? 'Returns List' : 'Purchase Returns';
  $('rq').placeholder = kind === 'sales' ? 'Search by return no., invoice no., customer, or medicine...' : 'Search by return no., supplier invoice, distributor, or medicine...';
  document.querySelectorAll('.rt-s-only').forEach(e => { e.hidden = kind !== 'sales'; });
  $('fReason').innerHTML = '<option value="">Any reason</option>' + Object.entries(REASONS[kind]).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('');
  $('thead').innerHTML = kind === 'sales'
    ? '<tr><th class="c-no">#</th><th>Return No.</th><th class="c-ref">Invoice No.</th><th>Date &amp; Time</th><th class="c-cust">Customer</th><th class="c-c c-items">Items</th><th class="c-r">Return Value</th><th class="c-type">Refund Type</th><th>Status</th><th class="c-c">Actions</th></tr>'
    : '<tr><th class="c-no">#</th><th>Return No.</th><th class="c-ref">Supplier Inv.</th><th>Date &amp; Time</th><th class="c-cust">Distributor</th><th class="c-c c-items">Items</th><th class="c-r">Return Value</th><th class="c-type">Reason</th><th>Status</th><th class="c-c">Actions</th></tr>';
  $('kFourth').closest('.dz-kpi').querySelector('.dz-kpi-label').textContent = kind === 'sales' ? 'Refunded Amount' : 'Expiry Stock to Return';
  $('kFourth').closest('.dz-kpi').querySelector('.dz-kpi-icon').innerHTML = kind === 'sales' ? I.swap : I.clock;
  $('newReturn').querySelector('span').textContent = kind === 'sales' ? 'New Return' : 'New Purchase Return';
}
async function setKind(k) {
  if (k === kind) return;
  kind = k; page = 1;
  Object.assign(filt, { type: '', reason: '', method: '', cond: '' });
  $('rq').value = '';
  applyMode();
  await refresh();
}

// ---------------------------------------------------------------------------
// KPIs (this month vs. last month)
// ---------------------------------------------------------------------------
const vsLast = (a, b, label = 'vs. last month') => {
  if (!b) return a ? `<span class="dz-up">New</span> · none last month` : 'None last month either';
  const p = (a - b) / b * 100;
  return `<span class="${p <= 0 ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.down}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> ${label}`;
};
async function renderKpis() {
  const t = today(), cur = [monthStart(t), t], dayN = Number(t.slice(8)), lastEnd = monthEnd(t, 1);
  const prev = [monthStart(t, 1), (monthStart(t, 1).slice(0, 8) + String(Math.min(dayN, Number(lastEnd.slice(8)))).padStart(2, '0'))];
  const all = store[kind]?.rows || [], a = inWin(all, cur), b = inWin(all, prev);
  $('kCount').textContent = count(a.length);
  $('kCountNote').innerHTML = vsLast(a.length, b.length);
  if (!isAdmin) {
    // Staff: counts only — no money totals.
    const t0 = today(), td = all.filter(r => String(r.created_at || '').length && new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === t0);
    const lbl = (id, l) => { $(id).closest('.dz-kpi').querySelector('.dz-kpi-label').textContent = l; };
    lbl('kValue', 'Returns Today'); $('kValue').textContent = count(td.length); $('kValueNote').textContent = 'credit notes today';
    lbl('kRate', 'Exchanges'); $('kRate').textContent = count(a.filter(r => r.refund_type === 'exchange').length); $('kRateNote').textContent = 'this month';
    lbl('kFourth', 'Refunds'); $('kFourth').textContent = count(a.filter(r => r.refund_type !== 'exchange').length); $('kFourthNote').textContent = 'this month';
    return;
  }
  $('kValue').textContent = rupees0(sum(a));
  $('kValueNote').innerHTML = vsLast(sum(a), sum(b));
  for (const id of ['kCount', 'kValue']) $(id).closest('.dz-kpi').title = `This month, compared with last month up to day ${dayN}`;
  const base = await baseTotal(kind, ...cur);
  $('kRate').textContent = base ? `${(sum(a) / base * 100).toFixed(1)}%` : '—';
  $('kRateNote').textContent = kind === 'sales' ? 'of total sales this month' : 'of purchases this month';
  $('kRate').closest('.dz-kpi').title = base === null ? '' : `${rupees0(sum(a))} returned of ${rupees0(base)} ${kind === 'sales' ? 'sold' : 'purchased'} this month`;
  if (kind === 'sales') {
    const refunded = sum(a.filter(r => r.refund_type !== 'exchange'));
    $('kFourth').textContent = rupees0(refunded);
    $('kFourthNote').textContent = `(${sum(a) ? (refunded / sum(a) * 100).toFixed(1) : '0.0'}% of returns)`;
    $('kFourth').closest('.dz-kpi').title = 'Money paid back by Cash or UPI this month (exchanges excluded)';
  } else {
    if (!expiryList) await loadExpiry();
    const val = (expiryList || []).reduce((s, r) => s + num(r.returnable) * num(r.unit_price) * 1.12, 0);
    $('kFourth').textContent = expiryList ? count(expiryList.filter(r => num(r.returnable) > 0).length) : '—';
    $('kFourthNote').textContent = expiryList ? `batch(es) · about ${rupees0(val)} within 90 days` : 'Needs migration 0027';
    $('kFourth').closest('.dz-kpi').title = 'Expired or expiring in 90 days, bought from a distributor — click to return';
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
let listRows = [];
async function loadList() {
  const [from, to] = windowFor(filt.period);
  filt.from = from; filt.to = to;
  $('fPeriod').value = filt.period;
  $('fPeriod').querySelector('option[value="custom"]').hidden = filt.period !== 'custom';
  if (filt.period === 'custom') $('fPeriod').querySelector('option[value="custom"]').textContent = from === to ? dmy(from) : `${dmy(from)} – ${dmy(to)}`;
  $('rows').innerHTML = '<tr><td colspan="10" class="dl-empty">Loading returns…</td></tr>';
  try { listRows = await ensure(kind, from, to); }
  catch (e) { listRows = []; $('rows').innerHTML = `<tr><td colspan="10" class="dl-empty">${esc(friendly(e))}</td></tr>`; return; }
  draw();
}
function filtered() {
  const raw = $('rq').value.trim().toLowerCase(), qd = digits(raw);
  const out = listRows.filter(r => {
    if (filt.reason && r.reason_code !== filt.reason) return false;
    if (kind === 'sales') {
      if (filt.type && (r.refund_type || 'refund') !== filt.type) return false;
      if (filt.method && r.refund_method !== filt.method) return false;
      if (filt.cond === 'damaged' && !(num(r.damaged) > 0)) return false;
      if (filt.cond === 'restock' && !(num(r.restocked) > 0)) return false;
    }
    if (raw) {
      const hay = `${r.return_no} ${r.invoice_no || ''} ${r.supplier_invoice_no || ''} ${r.customer_name || 'walk-in'} ${r.distributor_name || ''} ${r.medicines || ''} ${r.reason || ''} ${reasonOf(kind, r.reason_code)[0]}`.toLowerCase();
      if (!hay.includes(raw) && !(qd.length >= 3 && (digits(r.customer_phone).includes(qd) || digits(r.distributor_phone).includes(qd)))) return false;
    }
    return true;
  });
  const by = { new: (a, b) => String(b.created_at).localeCompare(String(a.created_at)), old: (a, b) => String(a.created_at).localeCompare(String(b.created_at)), high: (a, b) => num(b.total) - num(a.total), low: (a, b) => num(a.total) - num(b.total) }[filt.sort];
  return out.sort(by);
}
const BOX_TONES = ['g', 'b', 'p'];
function draw() {
  const list = filtered(), per = compact ? 3 : Number($('perPage').value), pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(page, pages);
  const shown = list.slice((page - 1) * per, page * per);
  $('listTotal').textContent = `(${count(list.length)})`;
  $('rows').innerHTML = shown.map((r, i) => {
    const n = (page - 1) * per + i;
    const party = kind === 'sales' ? (r.customer_name || 'Walk-in') : (r.distributor_name || '—');
    const ref = kind === 'sales' ? r.invoice_no : r.supplier_invoice_no;
    const tag = kind === 'sales'
      ? `<span class="rt-type ${r.refund_type === 'exchange' ? 'ex' : 'rf'}">${r.refund_type === 'exchange' ? 'Exchange' : 'Refund'}</span>`
      : `<span class="rt-reason-chip" style="--c:${reasonOf(kind, r.reason_code)[1]}">${esc(reasonOf(kind, r.reason_code)[0])}</span>`;
    return `<tr data-id="${esc(r.id)}">
      <td class="c-no">${n + 1}</td>
      <td class="c-inv"><span class="sl-doc rt-box ${BOX_TONES[n % 3]}">${I.box}</span><b>${esc(r.return_no)}</b><small class="sl-m-cust rt-m-ref">${esc(ref || '')}</small></td>
      <td class="c-ref">${esc(ref || '—')}</td>
      <td class="c-when"><span class="sl-d">${esc(dShort(r.created_at))}, ${esc(tShort(r.created_at))}</span><small class="sl-m-items">${esc(party)}</small></td>
      <td class="c-cust">${kind === 'sales' && !r.customer_name ? '<span class="ds-muted">Walk-in</span>' : esc(party)}</td>
      <td class="c-c c-items">${r.items === null || r.items === undefined ? '—' : r.items}</td>
      <td class="c-r c-amt"><b>${fmtMoney(r.total)}</b></td>
      <td class="c-type">${tag}</td>
      <td class="c-st"><span class="md-chip sl-st in" title="${kind === 'sales' ? `${r.refund_type === 'exchange' ? 'Exchange' : 'Refund'} by ${String(r.refund_method || '').toUpperCase()}` : 'Stock removed, supplier credit recorded'}">${I.check}Completed</span></td>
      <td class="c-act"><div class="pur-acts"><button type="button" class="dl-act" data-view aria-label="View ${esc(r.return_no)}">${I.eye}</button><div class="dl-pop-anchor"><button type="button" class="dl-act" data-menu aria-label="More actions for ${esc(r.return_no)}">${I.dots}</button></div></div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="10" class="dl-empty">${listRows.length ? 'No returns match these filters.' : `No ${kind === 'sales' ? 'sales' : 'purchase'} returns in this period.`}</td></tr>`;
  $('pageInfo').textContent = list.length ? `Showing ${(page - 1) * per + 1} – ${Math.min(page * per, list.length)} of ${count(list.length)} returns` : '';
  $('pager').innerHTML = !compact && pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, k) => k + 1).filter(x => x <= 5 && page <= 3 || x === 1 || x === pages || Math.abs(x - page) <= 1).map((x, k, arr) => `${k && x - arr[k - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${x}" class="${x === page ? 'on' : ''}">${x}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
  $('viewAll').hidden = !(compact && list.length > per);
  $('filterDot').hidden = !(filt.reason || filt.type || filt.method || filt.cond || filt.sort !== 'new' || filt.period === 'custom');
}

// ---------------------------------------------------------------------------
// Reasons, money tiles, trend, top medicines
// ---------------------------------------------------------------------------
function renderReasons() {
  const rows = inWin(store[kind]?.rows || [], windowFor($('reasonPeriod').value)), total = rows.length;
  const parts = Object.entries(REASONS[kind]).map(([k, [l, col]]) => ({ k, l, col, n: rows.filter(r => r.reason_code === k).length, v: sum(rows.filter(r => r.reason_code === k)) })).filter(p => p.n || ['other'].includes(p.k) && !total);
  const C = 2 * Math.PI * 84, gap = total > 1 ? 2 : 0; let off = 0;
  $('donut').innerHTML = `<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="32"/>` + parts.map(p => {
    const len = total ? p.n / total * C : 0, s = len > gap ? `<circle cx="110" cy="110" r="84" fill="none" stroke="${p.col}" stroke-width="32" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-off}"><title>${p.l}: ${p.n}</title></circle>` : '';
    off += len; return s;
  }).join('');
  $('donutN').textContent = count(total);
  $('reasonLegend').innerHTML = total ? parts.filter(p => p.n).sort((a, b) => b.n - a.n).map(p => `<button type="button" data-reason="${p.k}" title="${rupees0(p.v)}"><i style="background:${p.col}"></i><b>${esc(p.l)}</b><em>${(p.n / total * 100).toFixed(1)}%</em><span>(${p.n})</span></button>`).join('') : '<p class="dl-muted">No returns in this period.</p>';
  const value = sum(rows);
  if (!isAdmin) { $('moneyTiles').innerHTML = ''; $('reasonLegend').querySelectorAll('[title]').forEach(b => b.removeAttribute('title')); return; }
  if (kind === 'sales') {
    const ref = sum(rows.filter(r => r.refund_type !== 'exchange')), ex = value - ref;
    $('moneyTiles').innerHTML = `
      <button type="button" class="rt-tile g" data-tile="refund">${I.refund}<span>Refunded Amount</span><b>${rupees0(ref)}</b><em>(${value ? (ref / value * 100).toFixed(1) : '0.0'}%)</em></button>
      <button type="button" class="rt-tile p" data-tile="exchange">${I.swap}<span>Exchanged Value</span><b>${rupees0(ex)}</b><em>(${value ? (ex / value * 100).toFixed(1) : '0.0'}%)</em></button>`;
  } else {
    const dists = new Set(rows.map(r => r.distributor_id || r.distributor_name)).size;
    $('moneyTiles').innerHTML = `
      <button type="button" class="rt-tile g" data-tile="">${I.refund}<span>Supplier Credit</span><b>${rupees0(value)}</b><em>${dists} distributor${dists === 1 ? '' : 's'}</em></button>
      <button type="button" class="rt-tile p" data-tile="expiry">${I.clock}<span>Expired stock returned</span><b>${rupees0(sum(rows.filter(r => r.reason_code === 'expired')))}</b><em>${rows.filter(r => r.reason_code === 'expired').length} return(s)</em></button>`;
  }
}
function trendWindow() {
  const r = $('trendRange').value, t = today();
  if (r === '7') return { from: addDays(t, -6), to: t, monthly: false, label: 'Last 7 Days' };
  if (r === '30') return { from: addDays(t, -29), to: t, monthly: false, label: 'Last 30 Days' };
  if (r === 'month') return { from: monthStart(t), to: t, monthly: false, label: 'This Month' };
  const n = r === '6m' ? 6 : 12;
  return { from: monthStart(t, n - 1), to: t, monthly: true, label: `Last ${n} Months` };
}
function niceStep(v) { if (v <= 0) return 1; const raw = v * 1.08 / 6, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const axisMoney = v => v >= 1e5 ? `₹${+(v / 1e5).toFixed(1)}L` : `₹${Math.round(v).toLocaleString('en-IN')}`;
function trendSeries() {
  const w = trendWindow(), rows = inWin(store[kind]?.rows || [], [w.from, w.to]), out = [];
  if (w.monthly) {
    for (let d = w.from; d <= w.to; d = monthStart(d, -1)) { const k = d.slice(0, 7), m = rows.filter(r => istDay(r.created_at).startsWith(k)); out.push({ label: new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), full: new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), v: sum(m), n: m.length }); }
  } else {
    for (let d = w.from; d <= w.to; d = addDays(d, 1)) { const m = rows.filter(r => istDay(r.created_at) === d); out.push({ label: new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }), full: new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }), v: sum(m), n: m.length }); }
  }
  return out;
}
function drawChart() {
  const el = $('chart'), s = trendSeries(), N = s.length;
  if (!N) { el.innerHTML = ''; return; }
  const vals = s.map(x => x.v), tot = vals.reduce((a, b) => a + b, 0), n = s.reduce((a, x) => a + x.n, 0);
  $('chartSub').textContent = `${rupees0(tot)} in ${count(n)} return${n === 1 ? '' : 's'} · ${trendWindow().label}`;
  const W = Math.max(260, el.clientWidth), H = el.clientHeight || 220, padL = 54, padR = 18, padT = 34, padB = 28, steps = 6;
  const tick = niceStep(Math.max(...vals, 1)), max = tick * steps;
  const x = i => padL + (N === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (N - 1)), yv = v => padT + (H - padT - padB) * (1 - v / max);
  const pts = vals.map((v, i) => [x(i), yv(v)]);
  let d = `M${pts[0][0]},${pts[0][1]}`; for (let i = 1; i < N; i++) d += ` L${pts[i][0]},${pts[i][1]}`;
  const fit = Math.max(2, Math.floor((W - padL - padR) / 46)), every = Math.max(1, Math.ceil(N / fit));
  const grid = Array.from({ length: steps + 1 }, (_, i) => i * tick);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Return trend">
    <defs><linearGradient id="rtArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fbf3a" stop-opacity=".38"/><stop offset="1" stop-color="#2fbf3a" stop-opacity=".05"/></linearGradient></defs>
    <g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${yv(v)}" y2="${yv(v)}"/>`).join('')}</g>
    <g class="dz-axis pur-axis">${grid.map(v => `<text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end">${axisMoney(v)}</text>`).join('')}${s.map((p, i) => (i % every === 0 && N - 1 - i >= every / 2) || i === N - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '').join('')}</g>
    <path d="${d} L${pts[N - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z" fill="url(#rtArea)"/><path class="dz-line" d="${d}"/>
    ${pts.map(([px, py], i) => `<circle class="dz-pt${i === N - 1 ? ' hot' : ''}" data-i="${i}" cx="${px}" cy="${py}" r="${i === N - 1 ? 6 : N > 14 ? 3 : 4.5}"/>`).join('')}
    ${pts.map(([px], i) => `<rect data-i="${i}" x="${px - (W - padL - padR) / Math.max(1, N - 1) / 2}" y="${padT}" width="${(W - padL - padR) / Math.max(1, N - 1)}" height="${H - padT - padB}" fill="transparent"/>`).join('')}
  </svg><div class="dz-tip" id="rtTip"></div>`;
  const tip = $('rtTip');
  const show = i => { const [px, py] = pts[i]; tip.innerHTML = `${rupees0(vals[i])}<small>${esc(s[i].full)} · ${s[i].n} return${s[i].n === 1 ? '' : 's'}</small>`; tip.style.left = `${Math.min(Math.max(px / W * 100, 20), 80)}%`; tip.style.top = `${(py - 12) / H * 100}%`; el.querySelectorAll('.dz-pt').forEach(c => c.classList.toggle('hot', +c.dataset.i === i)); };
  show(N - 1);
  const sv = el.querySelector('svg');
  sv.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('mouseleave', () => show(N - 1));
  sv.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
}
const medName = m => `${m.name}${m.strength ? ' ' + m.strength : ''}`;
async function topMeds(k, from, to, n) {
  if (!v27) return null;
  const { data, error } = await sb.rpc('returns_top_medicines', { p_kind: k, p_from: from, p_to: to, p_limit: n });
  if (error) { if (missing(error)) { was27Missing(); return null; } throw error; }
  return data || [];
}
async function renderTop() {
  const w = trendWindow();
  $('topLabel').textContent = `(${w.label})`;
  try {
    const top = await topMeds(kind, w.from, w.to, 5);
    $('topRows').innerHTML = top === null ? '<tr><td colspan="4" class="dl-empty">Needs migration 0027.</td></tr>'
      : top.map((m, i) => `<tr data-med="${esc(m.name)}" title="Show returns of ${esc(medName(m))}"><td class="c-no"><span class="pur-rank r${i + 1}">${i + 1}</span></td><td>${esc(medName(m))}</td><td class="c-r">${count(m.qty)}</td><td class="c-r sl-val">${fmtMoney(m.value)}</td></tr>`).join('') || '<tr><td colspan="4" class="dl-empty">No medicines returned in this period.</td></tr>';
  } catch (e) { $('topRows').innerHTML = `<tr><td colspan="4" class="dl-empty">${esc(friendly(e))}</td></tr>`; }
}
function notify() {
  const items = [], t = today(), rows = store[kind]?.rows || [];
  const s = inWin(store.sales?.rows || [], [t, t]);
  if (s.length) items.push({ tone: 'info', title: `${s.length} sales return(s) today · ${rupees0(sum(s))}`, detail: `${rupees0(sum(s.filter(r => r.refund_type !== 'exchange')))} refunded`, href: 'returns.html' });
  const ar = inWin(store.sales?.rows || [], windowFor('7d')).filter(r => r.reason_code === 'adverse_reaction');
  if (ar.length) items.push({ tone: 'warn', title: `${ar.length} return(s) for adverse reaction in 7 days`, detail: [...new Set(ar.map(r => r.medicines).filter(Boolean))].slice(0, 2).join(', ') || 'Check with the pharmacist', href: 'returns.html' });
  const ex = (expiryList || []).filter(r => num(r.returnable) > 0);
  if (ex.length) items.push({ tone: 'danger', title: `${ex.length} expired / near-expiry batch(es) can go back to distributors`, detail: 'Returns → ⋯ → Expired stock to return', href: 'returns.html?tab=purchase&expiry=1' });
  void rows;
  setNotifications(items);
}
async function refresh() {
  await loadList();
  await renderKpis().catch(e => note(friendly(e), true));
  renderReasons(); if (isAdmin) { drawChart(); await renderTop(); } notify();
}

// ---------------------------------------------------------------------------
// Details, credit / debit note
// ---------------------------------------------------------------------------
async function detail(k, id) {
  if (v27) {
    const { data, error } = await sb.rpc('return_detail', { p_kind: k, p_id: id });
    if (!error && data) return data;
    if (error && !missing(error)) throw error;
    was27Missing();
  }
  const r = (store[k]?.rows || []).find(x => x.id === id) || listRows.find(x => x.id === id);
  if (!r) throw new Error('Return not found');
  if (k === 'sales') {
    const { data: its } = await sb.from('sales_return_items').select('qty,disposition,line_total,medicine_id,batch_id').eq('return_id', id);
    return { kind: 'sales', shop: {}, note: { ...r, refund_type: 'refund' }, invoice_id: r.invoice_id, invoice_no: r.invoice_no, customer: r.customer_name ? { name: r.customer_name, phone: r.customer_phone } : null, items: (its || []).map(x => ({ name: 'Item', qty: x.qty, disposition: x.disposition, line_total: x.line_total })) };
  }
  return { kind: 'purchase', shop: {}, note: { ...r, total: r.total }, invoice_id: r.purchase_invoice_id, invoice_no: r.supplier_invoice_no, distributor: { name: r.distributor_name }, items: [] };
}
function debitNoteHTML(d) {
  const s = d.shop || {}, n = d.note, ds = d.distributor || {};
  const R = v => money2(v);
  return `<div style="font:12px/1.4 Arial,sans-serif;color:#000;padding:8mm;max-width:190mm">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:6px"><div><b style="font-size:18px">${esc(s.name || 'PALLIKKAL PHARMACY')}</b><br>${esc(s.address || '')}${s.phone ? '<br>Ph: ' + esc(s.phone) : ''}${s.gstin ? '<br>GSTIN: ' + esc(s.gstin) : ''}${s.drug_licence ? '<br>DL: ' + esc(s.drug_licence) : ''}</div><div style="text-align:right"><b style="font-size:16px">DEBIT NOTE</b><br>Purchase return<br><b>${esc(n.return_no)}</b><br>${esc(when(n.created_at))}</div></div>
    <p><b>To:</b> ${esc(ds.name || '')}${ds.address ? ', ' + esc(ds.address) : ''}${ds.gstin ? '<br>GSTIN: ' + esc(ds.gstin) : ''}${ds.drug_licence ? ' · DL: ' + esc(ds.drug_licence) : ''}<br><b>Against invoice:</b> ${esc(d.invoice_no || '')}${d.invoice_date ? ' dated ' + esc(dmy(d.invoice_date)) : ''}<br><b>Reason:</b> ${esc(reasonOf('purchase', n.reason_code)[0])} — ${esc(n.reason || '')}</p>
    <table style="width:100%;border-collapse:collapse" border="1" cellpadding="4"><tr style="background:#eee"><th align="left">Medicine</th><th align="left">Batch</th><th align="left">Expiry</th><th align="right">Qty</th><th align="right">Rate</th><th align="right">Amount</th></tr>
    ${(d.items || []).map(x => `<tr><td>${esc(x.name)} ${esc(x.strength || '')}</td><td>${esc(x.batch_no || '')}</td><td>${esc(String(x.expiry || '').slice(0, 7))}</td><td align="right">${count(x.qty)}</td><td align="right">${R(x.unit_price)}</td><td align="right">${R(x.line_total)}</td></tr>`).join('')}
    <tr><td colspan="5" align="right"><b>Total (incl. GST)</b></td><td align="right"><b>₹${R(n.total)}</b></td></tr></table>
    <p style="margin-top:28px;display:flex;justify-content:space-between"><span>Received by (distributor): ______________</span><span>For ${esc(s.name || 'PALLIKKAL PHARMACY')}</span></p></div>`;
}
function printNote(d) {
  if (d.kind === 'sales') return showCreditNote({ ...d, items: d.items.map(x => ({ ...x, batch_no: x.batch_no || '' })), note: { ...d.note, reason: `${reasonOf('sales', d.note.reason_code)[0]}${d.note.reason ? ' — ' + d.note.reason : ''}${d.note.refund_type === 'exchange' ? ' (Exchange)' : ''}` } });
  printHTML(debitNoteHTML(d), d.note.return_no, 'a4');
}
async function openView(id) {
  const k = kind, r = listRows.find(x => x.id === id) || {};
  $('viewBody').innerHTML = '<p class="dl-muted">Loading return…</p>';
  if (!$('viewDlg').open) $('viewDlg').showModal();
  let d; try { d = await detail(k, id); } catch (e) { $('viewBody').innerHTML = `<p class="pos-form-msg">${esc(friendly(e))}</p>`; return; }
  const n = d.note, [rl, rc] = reasonOf(k, n.reason_code), phone = d.customer?.phone || d.distributor?.phone;
  $('viewBody').innerHTML = `
    <div class="sl-bill-head"><span class="pos-title-ic sl-bill-ic">${k === 'sales' ? I.undo : I.truck}</span>
      <div><h3>${esc(n.return_no)} <span class="md-chip sl-st in">${I.check}Completed</span>${k === 'sales' ? ` <span class="rt-type ${n.refund_type === 'exchange' ? 'ex' : 'rf'}">${n.refund_type === 'exchange' ? 'Exchange' : 'Refund'}</span>` : ''}</h3>
      <p class="dl-muted">${esc(when(n.created_at))}${n.created_by || r.created_by_name ? ` · by ${esc(n.created_by || r.created_by_name)}` : ''} · ${k === 'sales' ? 'Credit note' : 'Debit note (purchase return)'}</p></div></div>
    <div class="sl-kv">
      <div><small>${k === 'sales' ? 'Customer' : 'Distributor'}</small><b>${k === 'sales' ? (d.customer ? `${esc(d.customer.name)}<br><a href="tel:${esc(d.customer.phone)}">${esc(d.customer.phone)}</a>` : 'Walk-in') : `${esc(d.distributor?.name || '—')}${d.distributor?.phone ? `<br><a href="tel:${esc(d.distributor.phone)}">${esc(d.distributor.phone)}</a>` : ''}`}</b></div>
      <div><small>${k === 'sales' ? 'Against bill' : 'Against supplier invoice'}</small><b>${esc(d.invoice_no || '—')}${d.invoice_at ? `<br><span class="dl-muted">${esc(when(d.invoice_at))}</span>` : d.invoice_date ? `<br><span class="dl-muted">${esc(dmy(d.invoice_date))}</span>` : ''}</b></div>
      <div><small>Reason</small><b><i class="rt-dot" style="background:${rc}"></i>${esc(rl)}${n.reason ? `<br><span class="dl-muted">${esc(n.reason)}</span>` : ''}</b></div>
      <div><small>${k === 'sales' ? 'Refund' : 'Supplier credit'}</small><b>${fmtMoney(n.total)}${k === 'sales' ? `<br><span class="dl-muted">${n.refund_type === 'exchange' ? 'Exchange · ' : ''}${esc(String(n.refund_method || '').toUpperCase())}${num(n.tax) ? ` · GST ${fmtMoney(n.tax)}` : ''}</span>` : '<br><span class="dl-muted">Adjusted in payables</span>'}</b></div>
    </div>
    <div class="dl-table-wrap"><table class="dl-table md-plain sl-items"><thead><tr><th>Medicine</th><th>Batch · Exp</th><th class="c-r">Qty</th>${k === 'sales' ? '<th>Condition</th>' : '<th class="c-r">Rate</th>'}<th class="c-r">Amount</th></tr></thead>
      <tbody>${d.items.map(x => `<tr><td><b>${esc(x.name)}</b> ${esc(x.strength || '')}</td><td>${esc(x.batch_no || '')}${x.expiry ? ` · ${esc(String(x.expiry).slice(0, 7))}` : ''}</td><td class="c-r">${count(x.qty)}</td>${k === 'sales' ? `<td>${x.disposition === 'damaged' ? '<span class="md-chip out"><i></i>Damaged</span>' : '<span class="md-chip in"><i></i>Back to stock</span>'}</td>` : `<td class="c-r">${money2(x.unit_price)}</td>`}<td class="c-r">${money2(x.line_total)}</td></tr>`).join('') || '<tr><td colspan="5" class="dl-empty">No items.</td></tr>'}</tbody></table></div>
    <div class="pos-dialog-foot sl-bill-acts">
      <button type="button" class="pos-btn pos-btn-solid" data-vact="print">${I.print}<span>Print ${k === 'sales' ? 'credit' : 'debit'} note</span></button>
      ${k === 'sales' && d.invoice_id ? `<a class="pos-btn" href="sales.html?invoice=${encodeURIComponent(d.invoice_id)}">${I.bill}<span>Open bill</span></a>` : ''}
      ${k === 'purchase' && d.invoice_no ? `<a class="pos-btn" href="purchases.html?q=${encodeURIComponent(d.invoice_no)}">${I.bill}<span>Open purchase</span></a>` : ''}
      ${k === 'sales' && n.refund_type === 'exchange' ? `<a class="pos-btn" href="billing.html${d.customer?.id ? `?customer=${encodeURIComponent(d.customer.id)}` : ''}">${I.swap}<span>Exchange bill</span></a>` : ''}
      ${phone ? `<a class="pos-btn pos-btn-green" target="_blank" rel="noopener" href="https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(waText(d))}">${I.wa}<span>WhatsApp</span></a>` : ''}
    </div>`;
  $('viewBody').onclick = e => { if (e.target.closest('[data-vact="print"]')) printNote(d); };
}
function waText(d) {
  const n = d.note, items = (d.items || []).map(x => `• ${x.name}${x.strength ? ' ' + x.strength : ''} × ${count(x.qty)}`).join('\n');
  return d.kind === 'sales'
    ? `PALLIKKAL PHARMACY\nCredit note ${n.return_no} against bill ${d.invoice_no}\n${items}\n${n.refund_type === 'exchange' ? 'Exchange value' : 'Refund'}: ₹${money2(n.total)} (${String(n.refund_method || '').toUpperCase()})\nThank you.`
    : `PALLIKKAL PHARMACY — purchase return ${n.return_no}\nAgainst your invoice ${d.invoice_no}\nReason: ${reasonOf('purchase', n.reason_code)[0]}\n${items}\nValue ₹${money2(n.total)} incl. GST — please issue a credit note.`;
}
let menuEl = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
function menuHtml(r) {
  const b = (a, ic, l) => `<button type="button" data-act="${a}">${ic}<span>${l}</span></button>`;
  return [
    b('view', I.eye, 'View details'), b('print', I.print, `Print ${kind === 'sales' ? 'credit' : 'debit'} note`),
    kind === 'sales' && r.invoice_id ? `<a href="sales.html?invoice=${encodeURIComponent(r.invoice_id)}">${I.bill}<span>Open bill</span></a>` : '',
    kind === 'sales' && r.invoice_id ? b('again', I.undo, 'Return more from this bill') : '',
    kind === 'purchase' && r.supplier_invoice_no ? `<a href="purchases.html?q=${encodeURIComponent(r.supplier_invoice_no)}">${I.bill}<span>Open purchase</span></a>` : '',
    kind === 'purchase' && r.purchase_invoice_id ? b('again', I.undo, 'Return more from this invoice') : '',
    r.customer_phone || r.distributor_phone ? b('wa', I.wa, `WhatsApp ${kind === 'sales' ? 'customer' : 'distributor'}`) : '',
    r.distributor_phone ? `<a href="tel:${esc(r.distributor_phone)}">${I.phone}<span>Call distributor</span></a>` : '',
    b('copy', I.copy, 'Copy return no.')
  ].join('');
}
$('rows').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const r = listRows.find(x => x.id === tr.dataset.id);
  const m = e.target.closest('[data-menu]');
  if (m) { e.stopPropagation(); if (menuEl && menuEl.parentElement === m.parentElement) return closeMenu(); closeMenu(); menuEl = document.createElement('div'); menuEl.className = 'dl-pop md-menu md-row-menu pur-row-menu'; menuEl.innerHTML = menuHtml(r); m.parentElement.append(menuEl); return; }
  const a = e.target.closest('[data-act]');
  if (a) {
    e.stopPropagation(); closeMenu();
    const act = a.dataset.act;
    if (act === 'view') return openView(r.id);
    if (act === 'copy') { try { await navigator.clipboard.writeText(r.return_no); toast(`${r.return_no} copied.`); } catch { prompt('Return number', r.return_no); } return; }
    if (act === 'again') return kind === 'sales' ? openSalesReturn(r.invoice_id) : openPurchaseReturn(r.purchase_invoice_id);
    try {
      const d = await detail(kind, r.id);
      if (act === 'print') return printNote(d);
      if (act === 'wa') return window.open(`https://wa.me/${waNumber(r.customer_phone || r.distributor_phone)}?text=${encodeURIComponent(waText(d))}`, '_blank', 'noopener');
    } catch (err) { note(friendly(err), true); }
    return;
  }
  if (e.target.closest('a')) return;
  return openView(r.id);
});
document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });

// ---------------------------------------------------------------------------
// New sales return (existing flow: invoice search → returnable items → credit note)
// ---------------------------------------------------------------------------
const reasonSelect = (k, id = 'reasonCode') => `<select id="${id}" required><option value="">Choose a reason…</option>${Object.entries(REASONS[k]).map(([c, [l]]) => `<option value="${c}">${l}</option>`).join('')}</select>`;
function openSalesReturn(invoiceId = null) {
  if (!canCustomerReturn) return note('Your role cannot create customer returns.', true);
  $('newBody').innerHTML = `
    <h3 class="rt-dlg-title">${I.undo} New sales return</h3>
    <p class="dl-muted">Find the bill, choose what comes back and how the customer is paid. The original bill is not changed.</p>
    <div class="rt-steps"><span class="on">1 · Find bill</span><span id="st2">2 · Items &amp; refund</span></div>
    <label class="dl-search rt-find">${I.search}<input id="q" type="search" placeholder="Invoice number, customer name or phone…" autocomplete="off" aria-label="Search invoice number, customer name or phone"></label>
    <div id="list" class="rt-found"></div>
    <div id="form"></div>
    <div id="rmsg" class="pos-form-msg" role="status"></div>`;
  if (!$('newDlg').open) $('newDlg').showModal();
  let deb; $('q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(searchInvoices, 250); });
  $('list').addEventListener('click', e => { const id = e.target.closest('[data-invoice]')?.dataset.invoice; if (id) showReturnable(id); });
  if (invoiceId) showReturnable(invoiceId); else { if (params.get('q') && !$('q').value) $('q').value = params.get('q'); searchInvoices(); $('q').focus(); }
}
async function searchInvoices() {
  const { data, error } = await sb.rpc('invoice_search', { p_q: $('q').value.trim(), p_limit: 10 });
  if (error) { $('list').textContent = friendly(error); return; }
  $('list').innerHTML = (data || []).map(i => `<button type="button" class="rt-pick" data-invoice="${esc(i.id)}"><span class="sl-doc rt-box g">${I.bill}</span><span><b>${esc(i.invoice_no)}</b><small>${esc(i.customer_name || 'Walk-in')} · ${esc(when(i.created_at))}</small></span><em>${fmtMoney(i.total)}</em>${I.chev}</button>`).join('') || '<p class="dl-muted">No matching final invoices.</p>';
}
async function showReturnable(invoiceId) {
  $('rmsg').textContent = 'Loading invoice items…';
  const { data, error } = await sb.rpc('returnable_items', { p_invoice: invoiceId });
  if (error) { $('rmsg').textContent = friendly(error); return; }
  const { data: inv } = await sb.from('sales_invoices').select('invoice_no,created_at,total,customer_id').eq('id', invoiceId).maybeSingle();
  let cust = null;
  if (inv?.customer_id) cust = (await sb.from('customers').select('id,name,phone').eq('id', inv.customer_id).maybeSingle()).data;
  $('list').innerHTML = ''; $('q').closest('label').hidden = true;
  $('st2').classList.add('on');
  $('form').dataset.invoice = invoiceId;
  const rows = data || [];
  $('form').innerHTML = `
    <div class="rt-inv-head"><span><b>${esc(inv?.invoice_no || '')}</b> · ${esc(cust?.name || 'Walk-in')}${inv ? ` · ${esc(when(inv.created_at))} · ${fmtMoney(inv.total)}` : ''}</span><button type="button" class="dl-link" id="changeInv">Change bill</button></div>
    <h4 class="sl-sub">Items eligible for return</h4>
    <div class="dl-table-wrap"><table class="dl-table md-plain rt-items"><thead><tr><th>Medicine</th><th>Batch</th><th class="c-r">Sold</th><th class="c-r">Returned</th><th class="c-r">Refund/unit</th><th>Return qty</th><th>Condition</th></tr></thead>
      <tbody>${rows.map(r => { const rem = Math.max(0, num(r.qty_sold) - num(r.qty_returned)); return `<tr data-unit="${num(r.unit_refund)}">
        <td><b>${esc(r.name)}</b> ${esc(r.strength || '')}</td><td>${esc(r.batch_no)}</td><td class="c-r">${count(r.qty_sold)}</td><td class="c-r">${count(r.qty_returned)}</td><td class="c-r">${money2(r.unit_refund)}</td>
        <td><div class="rt-qty"><input class="return-qty" data-id="${esc(r.sales_item_id)}" type="number" min="0" max="${rem}" step="any" value="0" ${rem <= 0 ? 'disabled' : ''} aria-label="Return qty ${esc(r.name)}"><button type="button" class="dl-link" data-all="${rem}" ${rem <= 0 ? 'disabled' : ''}>All ${count(rem)}</button></div></td>
        <td><select class="return-disposition" aria-label="Condition"><option value="restock">Good — back to stock</option><option value="damaged">Damaged — do not restock</option></select></td></tr>`; }).join('') || '<tr><td colspan="7" class="dl-empty">No items found for this invoice.</td></tr>'}</tbody></table></div>
    <div class="md-form-grid rt-form">
      <div class="pos-field"><label for="reasonCode">Reason *</label>${reasonSelect('sales')}</div>
      <div class="pos-field"><label for="return-reason">Note</label><input id="return-reason" maxlength="400" placeholder="e.g. 250 mg given instead of 500 mg"></div>
      <div class="pos-field"><label>Refund type</label><div class="rt-seg" id="rtype"><button type="button" class="on" data-v="refund">${I.refund}Refund</button><button type="button" data-v="exchange">${I.swap}Exchange</button></div></div>
      <div class="pos-field"><label for="refund-method">Refund by</label><select id="refund-method"><option value="cash">Cash</option><option value="upi">UPI (manual transfer)</option></select></div>
    </div>
    <div class="rt-total"><span id="rtHint">The refund is not sent automatically — staff pay it by Cash or UPI.</span><b>Refund <span id="rtTotal">₹0.00</span></b></div>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button id="submit-return" type="button" class="pos-btn pos-btn-solid">${I.check}<span>Create credit note</span></button></div>`;
  $('rmsg').textContent = '';
  const recalc = () => {
    let t = 0; $('form').querySelectorAll('tbody tr[data-unit]').forEach(tr => { t += num(tr.querySelector('.return-qty')?.value) * num(tr.dataset.unit); });
    const ex = $('rtype').querySelector('.on').dataset.v === 'exchange';
    $('rtTotal').textContent = fmtMoney(t);
    $('rtTotal').parentElement.firstChild.textContent = ex ? 'Exchange value ' : 'Refund ';
    $('rtHint').textContent = ex ? 'Exchange: this value is paid back and used on the new bill — collect only the difference.' : 'The refund is not sent automatically — staff pay it by Cash or UPI.';
  };
  $('form').oninput = recalc;
  $('form').onclick = e => {
    const all = e.target.closest('[data-all]'); if (all) { all.closest('td').querySelector('.return-qty').value = all.dataset.all; recalc(); }
    const seg = e.target.closest('#rtype [data-v]'); if (seg) { $('rtype').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === seg)); recalc(); }
    if (e.target.closest('#changeInv')) { $('form').innerHTML = ''; $('q').closest('label').hidden = false; $('st2').classList.remove('on'); searchInvoices(); }
  };
  $('submit-return').onclick = () => submitSalesReturn(invoiceId, cust);
}
async function submitSalesReturn(invoiceId, cust) {
  const items = [...$('form').querySelectorAll('tbody tr[data-unit]')].map(tr => ({ sales_item_id: tr.querySelector('.return-qty')?.dataset.id, qty: Number(tr.querySelector('.return-qty')?.value), disposition: tr.querySelector('.return-disposition')?.value })).filter(r => r.sales_item_id && Number.isFinite(r.qty) && r.qty > 0);
  if (!items.length) { $('rmsg').textContent = 'Enter a return quantity for at least one item.'; return; }
  const code = $('reasonCode').value, txt = $('return-reason').value.trim();
  if (!code && !txt) { $('rmsg').textContent = 'A reason is required.'; $('reasonCode').focus(); return; }
  const reasonCode = code || guessReason('sales', txt), reason = txt || REASONS.sales[reasonCode][0];
  const method = $('refund-method').value, type = $('rtype').querySelector('.on').dataset.v;
  const btn = $('submit-return'); btn.disabled = true; btn.querySelector('span').textContent = 'Processing…';
  try {
    let res = v27 ? await sb.rpc('process_sales_return_v2', { p_invoice: invoiceId, p_items: items, p_method: method, p_reason: reason, p_reason_code: reasonCode, p_refund_type: type }) : { error: { message: 'function process_sales_return_v2 missing' } };
    if (res.error && missing(res.error)) { was27Missing(); res = await sb.rpc('process_sales_return', { p_invoice: invoiceId, p_items: items, p_method: method, p_reason: type === 'exchange' ? `${reason} (exchange)` : reason }); }
    if (res.error) { $('rmsg').textContent = friendly(res.error); return; }
    const { data: rec } = await sb.from('sales_returns').select('return_no,total').eq('id', res.data).single();
    store.sales = null; baseCache = {};
    const amount = rec ? fmtMoney(rec.total) : '';
    $('newBody').innerHTML = `<div class="rt-done">${I.check}<h3>Credit note ${esc(rec?.return_no || '')} recorded</h3>
      <p>${type === 'exchange' ? `Exchange value <b>${amount}</b>. Make the new bill for the replacement and collect only the difference.` : `Refund <b>${amount}</b> — give it by <b>${method.toUpperCase()}</b> now.`}</p>
      <div class="pos-dialog-foot"><button type="button" class="pos-btn pos-btn-solid" id="donePrint">${I.print}<span>Print credit note</span></button>
      ${type === 'exchange' ? `<a class="pos-btn" href="billing.html${cust?.id ? `?customer=${encodeURIComponent(cust.id)}` : ''}">${I.swap}<span>Make exchange bill</span></a>` : ''}
      <button type="button" class="pos-btn" id="doneAnother">${I.plusC}<span>Another return</span></button><button type="button" class="pos-btn" data-close>Close</button></div></div>`;
    $('msg').textContent = `Credit note ${rec?.return_no || ''} recorded for ${amount}. Complete the ${method.toUpperCase()} refund manually.`; $('msg').className = 'md-msg purchase-flash purchase-notice';
    $('donePrint').onclick = async () => { try { printNote(await detail('sales', res.data)); } catch (e) { note(friendly(e), true); } };
    $('doneAnother').onclick = () => openSalesReturn();
    if (kind !== 'sales') await setKind('sales'); else await refresh();
  } catch (err) { $('rmsg').textContent = friendly(err); }
  finally { if (document.body.contains(btn)) { btn.disabled = false; btn.querySelector('span').textContent = 'Create credit note'; } }
}

// ---------------------------------------------------------------------------
// New purchase return (existing flow: purchase invoice → purchase_returnable → return)
// ---------------------------------------------------------------------------
let purchases = [];
async function openPurchaseReturn(invoiceId = null, preset = null) {
  if (!canPurchaseReturn) return note('Only administrators can create purchase returns.', true);
  $('newBody').innerHTML = `
    <h3 class="rt-dlg-title">${I.truck} New purchase return</h3>
    <p class="dl-muted">Send expired, damaged or wrong stock back to the distributor. Stock goes down and the value is credited against what you owe them.</p>
    <div class="rt-steps"><span class="on">1 · Find purchase</span><span id="pst2">2 · Items &amp; reason</span></div>
    <label class="dl-search rt-find">${I.search}<input id="pq" type="search" placeholder="Supplier invoice number or distributor…" autocomplete="off" aria-label="Search supplier invoice or distributor"></label>
    <div id="purchase-list" class="rt-found">Loading purchases…</div>
    <div id="purchase-form"></div>
    <div id="pmsg" class="pos-form-msg" role="status"></div>`;
  if (!$('newDlg').open) $('newDlg').showModal();
  $('pq').addEventListener('input', renderPurchaseList);
  $('purchase-list').addEventListener('click', e => { const id = e.target.closest('[data-purchase]')?.dataset.purchase; if (id) showPurchase(id); });
  if (!purchases.length) { const { data, error } = await sb.rpc('purchase_list', { p_limit: 300 }); if (error) { $('purchase-list').textContent = friendly(error); return; } purchases = data || []; }
  if (invoiceId) showPurchase(invoiceId, preset); else { renderPurchaseList(); $('pq').focus(); }
}
function renderPurchaseList() {
  const q = $('pq').value.trim().toLowerCase();
  const rows = purchases.filter(p => !q || String(p.supplier_invoice_no || '').toLowerCase().includes(q) || String(p.distributor || '').toLowerCase().includes(q)).slice(0, 40);
  $('purchase-list').innerHTML = rows.map(p => `<button type="button" class="rt-pick" data-purchase="${esc(p.id)}"><span class="sl-doc rt-box b">${I.truck}</span><span><b>${esc(p.supplier_invoice_no)}</b><small>${esc(p.distributor)} · ${esc(dmy(p.invoice_date))}</small></span><em>${p.total == null ? '' : fmtMoney(p.total)}</em>${I.chev}</button>`).join('') || '<p class="dl-muted">No matching purchase invoices.</p>';
}
async function showPurchase(invoiceId, preset = null) {
  $('pmsg').textContent = 'Loading purchased items…';
  const { data, error } = await sb.rpc('purchase_returnable', { p_invoice: invoiceId });
  if (error) { $('pmsg').textContent = friendly(error); return; }
  const rows = data || [], sel = purchases.find(p => p.id === invoiceId);
  const bids = [...new Set(rows.map(r => r.batch_id))];
  const bm = new Map();
  if (bids.length) { const { data: bs } = await sb.from('medicine_batches').select('id,qty,expiry').in('id', bids); for (const b of bs || []) bm.set(b.id, b); }
  $('purchase-list').innerHTML = ''; $('pq').closest('label').hidden = true; $('pst2').classList.add('on');
  $('purchase-form').dataset.invoice = invoiceId;
  const t = today();
  $('purchase-form').innerHTML = `
    <div class="rt-inv-head"><span><b>${esc(sel?.supplier_invoice_no || '')}</b> · ${esc(sel?.distributor || '')}${sel ? ` · ${esc(dmy(sel.invoice_date))}` : ''}</span><button type="button" class="dl-link" id="changePur">Change purchase</button></div>
    <h4 class="sl-sub">Items eligible for supplier return</h4>
    <p class="dl-muted rt-small">Quantity is in the unit used on the purchase invoice (e.g. strips / boxes).</p>
    <div class="dl-table-wrap"><table class="dl-table md-plain rt-items"><thead><tr><th>Medicine</th><th>Batch · Exp</th><th class="c-r">Purchased</th><th class="c-r">Returned</th><th class="c-r">In stock</th><th>Return qty</th><th class="c-r">Rate</th></tr></thead>
      <tbody>${rows.map(r => { const b = bm.get(r.batch_id) || {}, f = num(r.unit_factor) || 1, stockPk = Math.floor(num(b.qty) / f), rem = Math.max(0, Math.min(num(r.remaining_qty), stockPk)), exp = b.expiry && b.expiry < t ? 'out' : b.expiry && b.expiry <= addDays(t, 90) ? 'low' : ''; return `<tr data-rate="${num(r.unit_price)}" data-tax="${num(r.tax_rate)}">
        <td><b>${esc(r.medicine_name)}</b></td><td>${esc(r.batch_no)}${b.expiry ? ` · <span class="md-chip ${exp || 'in'} rt-exp">${esc(String(b.expiry).slice(0, 7))}</span>` : ''}</td><td class="c-r">${count(r.purchased_qty)}</td><td class="c-r">${count(r.returned_qty)}</td><td class="c-r">${count(stockPk)}${f > 1 ? `<small class="dl-muted"> (${count(b.qty)} units)</small>` : ''}</td>
        <td><div class="rt-qty"><input class="purchase-return-qty" data-id="${esc(r.purchase_item_id)}" type="number" min="0" max="${rem}" step="any" value="${preset && preset.purchase_item_id === r.purchase_item_id ? Math.min(rem, num(preset.qty)) : 0}" ${rem <= 0 ? 'disabled' : ''} aria-label="Return qty ${esc(r.medicine_name)}"><button type="button" class="dl-link" data-all="${rem}" ${rem <= 0 ? 'disabled' : ''}>All ${count(rem)}</button></div></td>
        <td class="c-r">${money2(r.unit_price)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="dl-empty">No purchased items found.</td></tr>'}</tbody></table></div>
    <div class="md-form-grid rt-form">
      <div class="pos-field"><label for="preasonCode">Reason *</label>${reasonSelect('purchase', 'preasonCode')}</div>
      <div class="pos-field"><label for="purchase-return-reason">Note</label><input id="purchase-return-reason" maxlength="400" placeholder="e.g. Expires next month, distributor agreed to credit"></div>
    </div>
    <div class="rt-total"><span>Stock is reduced now. The value is credited against what you owe this distributor.</span><b>Value <span id="prTotal">₹0.00</span></b></div>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button id="submit-purchase-return" type="button" class="pos-btn pos-btn-solid">${I.check}<span>Record purchase return</span></button></div>`;
  $('pmsg').textContent = '';
  if (preset?.reason_code) $('preasonCode').value = preset.reason_code;
  const recalc = () => { let s = 0; $('purchase-form').querySelectorAll('tbody tr[data-rate]').forEach(tr => { s += num(tr.querySelector('.purchase-return-qty')?.value) * num(tr.dataset.rate) * (1 + num(tr.dataset.tax) / 100); }); $('prTotal').textContent = fmtMoney(s); };
  recalc();
  $('purchase-form').oninput = recalc;
  $('purchase-form').onclick = e => {
    const all = e.target.closest('[data-all]'); if (all) { all.closest('td').querySelector('.purchase-return-qty').value = all.dataset.all; recalc(); }
    if (e.target.closest('#changePur')) { $('purchase-form').innerHTML = ''; $('pq').closest('label').hidden = false; $('pst2').classList.remove('on'); renderPurchaseList(); }
  };
  $('submit-purchase-return').onclick = () => submitPurchaseReturn(invoiceId);
}
async function submitPurchaseReturn(invoiceId) {
  const items = [...$('purchase-form').querySelectorAll('.purchase-return-qty')].map(i => ({ purchase_item_id: i.dataset.id, qty: Number(i.value) })).filter(x => Number.isFinite(x.qty) && x.qty > 0);
  if (!items.length) { $('pmsg').textContent = 'Enter a return quantity for at least one item.'; return; }
  const code = $('preasonCode').value, txt = $('purchase-return-reason').value.trim();
  if (!code && !txt) { $('pmsg').textContent = 'A reason is required.'; $('preasonCode').focus(); return; }
  if (!confirm('Record this supplier return and reduce the selected batch stock?')) return;
  const reasonCode = code || guessReason('purchase', txt), reason = txt || REASONS.purchase[reasonCode][0];
  const btn = $('submit-purchase-return'); btn.disabled = true; btn.querySelector('span').textContent = 'Processing…';
  try {
    let res = v27 ? await sb.rpc('process_purchase_return_v2', { p_invoice: invoiceId, p_items: items, p_reason: reason, p_reason_code: reasonCode }) : { error: { message: 'function process_purchase_return_v2 missing' } };
    if (res.error && missing(res.error)) { was27Missing(); res = await sb.rpc('process_purchase_return', { p_invoice: invoiceId, p_items: items, p_reason: reason }); }
    if (res.error) { $('pmsg').textContent = friendly(res.error); return; }
    store.purchase = null; expiryList = null; baseCache = {};
    const { data: rec } = await sb.rpc('purchase_return_list', { p_limit: 5 });
    const r0 = (rec || []).find(x => x.id === res.data);
    $('newBody').innerHTML = `<div class="rt-done">${I.check}<h3>Purchase return ${esc(r0?.return_no || '')} recorded</h3>
      <p>Stock has been reduced. Value <b>${r0 ? fmtMoney(r0.total_value) : ''}</b> is credited against this distributor. Send the goods with the debit note.</p>
      <div class="pos-dialog-foot"><button type="button" class="pos-btn pos-btn-solid" id="donePrint">${I.print}<span>Print debit note</span></button>
      <button type="button" class="pos-btn" id="doneAnother">${I.plusC}<span>Another return</span></button><button type="button" class="pos-btn" data-close>Close</button></div></div>`;
    $('msg').textContent = 'Purchase return recorded. Stock has been reduced.'; $('msg').className = 'md-msg purchase-flash purchase-notice';
    $('donePrint').onclick = async () => { try { printNote(await detail('purchase', res.data)); } catch (e) { note(friendly(e), true); } };
    $('doneAnother').onclick = () => openPurchaseReturn();
    if (kind !== 'purchase') await setKind('purchase'); else await refresh();
  } catch (err) { $('pmsg').textContent = friendly(err); }
  finally { if (document.body.contains(btn)) { btn.disabled = false; btn.querySelector('span').textContent = 'Record purchase return'; } }
}

// Expired / near-expiry stock that can go back to the distributor it came from.
async function loadExpiry(days = 90) {
  if (!canPurchaseReturn || !v27) return null;
  const { data, error } = await sb.rpc('expiry_return_candidates', { p_days: days });
  if (error) { if (missing(error)) was27Missing(); return null; }
  expiryList = data || [];
  return expiryList;
}
async function expiryDialog(days = 90) {
  if (!canPurchaseReturn) return;
  dlg(`<h3 class="rt-dlg-title">${I.clock} Expired / near-expiry stock</h3><p class="dl-muted">Batches in stock that expire within the period, with the distributor and purchase they came from.</p>
    <div class="sl-top-tools"><label class="dl-select pur-mini"><select id="expDays" aria-label="Expiring within">${[[0, 'Already expired'], [30, 'Within 30 days'], [60, 'Within 60 days'], [90, 'Within 90 days'], [180, 'Within 6 months']].map(([v, l]) => `<option value="${v}" ${v === days ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="dl-table-wrap sl-top-all"><table class="dl-table md-plain rt-exp-table"><thead><tr><th>Medicine</th><th>Batch · Expiry</th><th>Distributor · Invoice</th><th class="c-r">Returnable</th><th></th></tr></thead><tbody id="expRows"><tr><td colspan="5" class="dl-empty">Loading…</td></tr></tbody></table></div>`);
  const list = await loadExpiry(days), t = today();
  if (list === null) { $('expRows').innerHTML = '<tr><td colspan="5" class="dl-empty">Needs migration 0027.</td></tr>'; return; }
  $('expRows').innerHTML = list.map(r => `<tr><td><b>${esc(r.name)}</b> ${esc(r.strength || '')}</td><td>${esc(r.batch_no)} · <span class="md-chip ${r.expiry < t ? 'out' : 'low'}">${esc(dmy(r.expiry))}</span></td><td>${esc(r.distributor_name || '—')}<br><small class="dl-muted">${esc(r.supplier_invoice_no)} · ${esc(dmy(r.invoice_date))}</small></td><td class="c-r">${count(r.returnable)}${num(r.unit_factor) > 1 ? `<br><small class="dl-muted">pack of ${count(r.unit_factor)}</small>` : ''}</td>
    <td class="c-r">${num(r.returnable) > 0 ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-exp="${esc(r.purchase_item_id)}">${I.undo}<span>Return</span></button>` : '<small class="dl-muted">Already returned / sold</small>'}</td></tr>`).join('') || '<tr><td colspan="5" class="dl-empty">No stock expiring in this period. 👍</td></tr>';
  $('expDays').onchange = () => expiryDialog(Number($('expDays').value));
  $('expRows').onclick = e => { const b = e.target.closest('[data-exp]'); if (!b) return; const r = list.find(x => x.purchase_item_id === b.dataset.exp); $('puDlg').close(); openPurchaseReturn(r.purchase_invoice_id, { purchase_item_id: r.purchase_item_id, qty: r.returnable, reason_code: 'expired' }); };
}

// ---------------------------------------------------------------------------
// Export / print / top dialog
// ---------------------------------------------------------------------------
function exportRows() {
  return filtered().map(r => kind === 'sales' ? {
    'Return No.': r.return_no, Date: istDay(r.created_at), Time: tShort(r.created_at), 'Invoice No.': r.invoice_no || '', Customer: r.customer_name || 'Walk-in', Phone: r.customer_phone || '', Items: r.items ?? '', Qty: r.qty ?? '',
    'Return value (₹)': num(r.total), 'GST (₹)': num(r.tax), 'Refund type': r.refund_type === 'exchange' ? 'Exchange' : 'Refund', 'Refund by': String(r.refund_method || '').toUpperCase(),
    Reason: reasonOf('sales', r.reason_code)[0], Note: r.reason || '', 'Back to stock (₹)': num(r.restocked), 'Damaged (₹)': num(r.damaged), 'Recorded by': r.created_by_name || '', Medicines: r.medicines || ''
  } : {
    'Return No.': r.return_no, Date: istDay(r.created_at), Time: tShort(r.created_at), 'Supplier invoice': r.supplier_invoice_no || '', Distributor: r.distributor_name || '', Items: r.items ?? '', Qty: r.qty ?? '',
    'Return value (₹)': num(r.total), Reason: reasonOf('purchase', r.reason_code)[0], Note: r.reason || '', 'Recorded by': r.created_by_name || '', Medicines: r.medicines || ''
  });
}
function writeSheet(list, name, sheet, csv = false) {
  if (window.XLSX && !csv) { const ws = XLSX.utils.json_to_sheet(list); ws['!cols'] = Object.keys(list[0] || { a: 1 }).map(k => ({ wch: k === 'Medicines' ? 50 : Math.min(36, Math.max(11, k.length + 2)) })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet); XLSX.writeFile(wb, name + '.xlsx'); return; }
  const keys = Object.keys(list[0]);
  const text = [keys, ...list.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
}
const fileName = () => `Pallikkal_${kind === 'sales' ? 'Sales' : 'Purchase'}_Returns_${filt.from === filt.to ? filt.from : `${filt.from}_to_${filt.to}`}`;
function doExport(csv) { const list = exportRows(); if (!list.length) return toast('Nothing to export for these filters.', true); writeSheet(list, fileName(), 'Returns', csv); toast(`${list.length} return(s) exported.`); }
function printList() {
  const list = exportRows(); if (!list.length) return toast('Nothing to print.', true);
  const H = kind === 'sales' ? ['Return No.', 'Date', 'Invoice No.', 'Customer', 'Return value (₹)', 'Refund type', 'Refund by', 'Reason'] : ['Return No.', 'Date', 'Supplier invoice', 'Distributor', 'Return value (₹)', 'Reason'];
  printHTML(`<div style="font:12px Arial,sans-serif;padding:10px"><h2>PALLIKKAL PHARMACY — ${kind === 'sales' ? 'Sales' : 'Purchase'} returns (${esc($('fPeriod').selectedOptions[0].textContent)})</h2><p>${list.length} return(s) · Total ${esc(fmtMoney(list.reduce((a, r) => a + r['Return value (₹)'], 0)))}</p><table style="width:100%;border-collapse:collapse" border="1" cellpadding="4"><tr>${H.map(h => `<th align="left">${h}</th>`).join('')}</tr>${list.map(r => `<tr>${H.map(h => `<td>${esc(typeof r[h] === 'number' ? money2(r[h]) : r[h])}</td>`).join('')}</tr>`).join('')}</table></div>`, 'Returns', 'a4');
}
async function topDialog() {
  const w = trendWindow();
  dlg(`<h3 class="rt-dlg-title">${I.pill} Top returned medicines · ${esc(w.label)}</h3><div class="dl-table-wrap sl-top-all"><table class="dl-table md-plain"><thead><tr><th>#</th><th>Medicine</th><th class="c-r">Return qty</th><th class="c-r">Returns</th><th class="c-r">Value</th></tr></thead><tbody id="topAllRows"><tr><td colspan="5" class="dl-empty">Loading…</td></tr></tbody></table></div>`);
  try {
    const top = await topMeds(kind, w.from, w.to, 100);
    $('topAllRows').innerHTML = top === null ? '<tr><td colspan="5" class="dl-empty">Needs migration 0027.</td></tr>' : top.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(medName(m))}</td><td class="c-r">${count(m.qty)}</td><td class="c-r">${m.returns}</td><td class="c-r">${fmtMoney(m.value)}</td></tr>`).join('') || '<tr><td colspan="5" class="dl-empty">No medicines returned in this period.</td></tr>';
  } catch (e) { $('topAllRows').innerHTML = `<tr><td colspan="5" class="dl-empty">${esc(friendly(e))}</td></tr>`; }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
$('newReturn').onclick = () => kind === 'sales' ? openSalesReturn() : openPurchaseReturn();
$('exportBtn').onclick = () => doExport(false);
$('moreBtn').onclick = e => { e.stopPropagation(); $('moreMenu').hidden = !$('moreMenu').hidden; };
document.addEventListener('click', e => { if (!$('moreMenu').hidden && !e.target.closest('#moreMenu')) $('moreMenu').hidden = true; });
$('moreMenu').onclick = e => {
  const b = e.target.closest('[data-more]'); if (!b) return;
  $('moreMenu').hidden = true;
  ({ 'new-sales': () => openSalesReturn(), 'new-purchase': () => openPurchaseReturn(), expiry: () => expiryDialog(), csv: () => doExport(true), print: printList, top: topDialog })[b.dataset.more]();
};
document.querySelector('.rt-tabs')?.addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (b) setKind(b.dataset.kind); });
let deb; $('rq').oninput = () => { clearTimeout(deb); deb = setTimeout(() => { page = 1; draw(); }, 200); };
$('perPage').onchange = () => { page = 1; draw(); };
$('fPeriod').onchange = async () => { filt.period = $('fPeriod').value; page = 1; await loadList(); };
$('pager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); draw(); } };
$('viewAll').onclick = () => { compact = false; draw(); };
$('filterBtn').onclick = e => {
  e.stopPropagation();
  if ($('filterPop').hidden) { $('from').value = filt.from; $('to').value = filt.to; $('fReason').value = filt.reason; $('fType').value = filt.type; $('fMethod').value = filt.method; $('fCond').value = filt.cond; $('fSort').value = filt.sort; }
  $('filterPop').hidden = !$('filterPop').hidden;
};
$('filterPop').onclick = e => e.stopPropagation();
document.addEventListener('click', () => { $('filterPop').hidden = true; });
$('fApply').onclick = async () => {
  let from = $('from').value, to = $('to').value;
  if (!from || !to) return toast('Choose both dates.', true);
  if (to < from) [from, to] = [to, from];
  Object.assign(filt, { reason: $('fReason').value, type: $('fType').value, method: $('fMethod').value, cond: $('fCond').value, sort: $('fSort').value });
  $('filterPop').hidden = true; page = 1;
  const [pf, pt] = windowFor(filt.period);
  if (from !== pf || to !== pt) { filt.period = 'custom'; filt.from = from; filt.to = to; }
  await loadList();
};
$('fReset').onclick = async () => { Object.assign(filt, { period: 'month', reason: '', type: '', method: '', cond: '', sort: 'new' }); $('rq').value = ''; $('filterPop').hidden = true; page = 1; await loadList(); };
const goList = async (patch, period) => { Object.assign(filt, { reason: '', type: '', method: '', cond: '' }, patch); if (period) filt.period = period; page = 1; await loadList(); $('rows').closest('.rt-list').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
$('reasonLegend').onclick = e => { const b = e.target.closest('[data-reason]'); if (b) goList({ reason: b.dataset.reason }, $('reasonPeriod').value); };
$('moneyTiles').onclick = e => { const b = e.target.closest('[data-tile]'); if (!b) return; if (b.dataset.tile === 'expiry') return expiryDialog(); goList(kind === 'sales' ? { type: b.dataset.tile } : {}, $('reasonPeriod').value); };
$('reasonPeriod').onchange = renderReasons;
$('trendRange').onchange = () => { if (isAdmin) { drawChart(); renderTop(); } };
$('topAll').onclick = topDialog;
$('topRows').onclick = e => { const tr = e.target.closest('tr[data-med]'); if (!tr) return; $('rq').value = tr.dataset.med; const r = $('trendRange').value; goList({}, r === '7' ? '7d' : r === 'month' ? 'month' : r === '30' ? '30d' : 'year'); };
document.querySelector('.md-kpis').onclick = e => {
  const b = e.target.closest('[data-kpi]'); if (!b) return;
  if (b.dataset.kpi === 'kFourth') return kind === 'sales' ? goList({ type: 'refund' }, 'month') : expiryDialog();
  goList({}, 'month');
};
let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(drawChart, 120); }).observe($('chart'));
matchMedia('(max-width: 560px)').addEventListener('change', ev => { compact = ev.matches; page = 1; draw(); });

// ---------------------------------------------------------------------------
// Start — ?tab=purchase (dashboard), ?invoice=<id> / ?q=<invoice no.> (Sales page), ?expiry=1
// ---------------------------------------------------------------------------
applyMode();
if (canPurchaseReturn && !expiryList) await loadExpiry();
await refresh();
if (canCustomerReturn && params.get('invoice')) openSalesReturn(params.get('invoice'));
else if (canCustomerReturn && params.get('q')) openSalesReturn();
if (canPurchaseReturn && params.get('expiry') === '1') expiryDialog();
