// Sales Management — Pallikkal Pharmacy design.
// Today's KPIs (vs. yesterday at the same time), sales transactions with search by invoice /
// customer / medicine / barcode, payment split, returns, sales trend, top selling medicines,
// monthly summary and payment methods (0026_sales_management.sql). Invoice preview / print
// (existing) kept. Works read-only on older databases (invoice list only) until 0026 is run.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { sendInvoice } from './whatsapp-invoice.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { showInvoice } from './invoice.js';
import { openAllBills } from './day-close.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('sales', 'Sales', { layout: 'brand' });
if (!prof) throw new Error('Unable to load user profile.');
const allowedRoles = ['super_admin', 'admin', 'admin_staff', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory'];   // every staff role (0037)
const view = document.getElementById('view');
if (!allowedRoles.includes(prof.role)) {
  view.textContent = 'Not authorised to view sales.';
  throw new Error('Not authorised to view sales');
}
const branchId = prof.branch_id;
if (!branchId) { view.textContent = 'Your profile has no assigned branch. Contact the administrator.'; throw new Error('Missing profile branch_id.'); }
const canReturn = ['super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory'].includes(prof.role);
// Staff see each bill and its amount, but not money totals (today's sales, averages, trends, summaries).
const isAdminView = ['super_admin', 'admin'].includes(prof.role);
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
const dmy = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const dShort = v => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
const tShort = v => new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ }).toUpperCase();
const when = v => new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const digits = v => String(v || '').replace(/\D/g, '');
function waNumber(value) {
  let d = digits(value);
  if (d.length === 10) d = `91${d}`;
  if (d.startsWith('0') && d.length === 11) d = `91${d.slice(1)}`;
  return d;
}
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h9a1.5 1.5 0 0 0 1.4-1.1L21.5 7.5H6"/>', 1.9),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2),
  monitor: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', 1.9),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  bars: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/></svg>',
  user: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>', 1.9),
  receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>', 1.9),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  filter: svg('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  pill: svg('<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m8.5 8.5 7 7"/>', 2),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7 14h2M11 14h2M15 14h2"/>', 1.9),
  card: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>', 1.9),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.6),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>', 1.9),
  bill: svg('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>', 1.9),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', 2.2),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
const PAY = { cash: ['Cash', '#12a01b'], upi: ['UPI', '#1e8fe8'], card: ['Card', '#f5b800'], credit: ['Credit', '#7a4ff0'] };
const RANGES = { today: 'Today', yesterday: 'Yesterday', '7d': 'Last 7 Days', '30d': 'Last 30 Days', month: 'This Month', lastmonth: 'Last Month', custom: 'Custom' };
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

let rows = [];          // bills in the selected range
let rpcOk = true;       // 0026 installed
let page = 1;
let compact = matchMedia('(max-width: 560px)').matches;
const filt = { range: 'today', from: today(), to: today(), pay: '', staff: '', min: '', sort: 'new' };

view.innerHTML = `
<div class="pos dl md pur ds sl">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.cart}</span>
      <div><h1>Sales Management</h1><p>Create sales, manage invoices, returns, and view sales performance.</p></div></div>
    <div class="pos-head-actions md-head-actions sl-head-actions">
      <a class="pos-btn pos-btn-solid" id="newSale" href="billing.html">${I.plusC}<span>New Sale</span></a>
      ${canReturn ? `<a class="pos-btn" id="returnBtn" href="returns.html">${I.undo}<span>Sales Return</span></a>` : ''}
      <button type="button" class="pos-btn" id="posBtn" title="Open the billing counter in its own window">${I.monitor}<span>POS</span></button>
      <button type="button" class="pos-btn" id="allBillsBtn" title="Print every bill of a day on one 80 mm roll">${I.print}<span>All Bills for Today</span></button>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn" id="exportBtn" aria-expanded="false">${I.download}<span>Export</span></button>
        <div class="dl-pop md-menu ds-menu sl-export" id="exportMenu" hidden>
          <button type="button" data-exp="xlsx">${I.download}<span>Bills — Excel (.xlsx)</span></button>
          <button type="button" data-exp="csv">${I.download}<span>Bills — CSV</span></button>
          ${isAdminView ? `<button type="button" data-exp="top">${I.pill}<span>Top selling medicines — Excel</span></button>` : ''}
          <button type="button" data-exp="print">${I.print}<span>Print sales list</span></button>
        </div></div>
    </div>
  </section>

  <section class="dz-kpis dl-kpis md-kpis">
    ${isAdminView ? KPI('green', I.bars, "Today's Sales", 'kSales') : ''}
    ${KPI('blue', I.cart, isAdminView ? 'Total Orders' : 'Bills Today', 'kOrders')}
    ${KPI('amber', I.user, 'Unique Customers', 'kCust')}
    ${isAdminView ? KPI('purple', I.receipt, 'Average Order Value', 'kAov') : ''}
  </section>

  <div id="msg" class="md-msg" role="status"></div>

  <div class="sl-grid">
    <section class="pos-card dl-orders ds-list sl-list">
      <div class="dl-card-head ds-list-head">
        <h2>${I.list}Sales Transactions <small id="rangeLabel">(Today)</small></h2>
        <label class="dl-select ds-status sl-status"><select id="fStatus" aria-label="Show">
          <option value="">All Sales</option><option value="completed">Completed</option><option value="returned">With returns</option>
          <option value="credit">Credit sales</option><option value="walkin">Walk-in (no customer)</option><option value="cancelled">Cancelled / refunded</option></select></label>
      </div>
      <div class="ds-tools">
        <label class="dl-search">${I.search}<input id="sq" type="search" placeholder="Search by invoice no., customer, medicine, or barcode..." autocomplete="off" aria-label="Search sales"></label>
        <div class="dl-pop-anchor">
          <button type="button" class="pos-btn dl-filter-btn" id="filterBtn" aria-expanded="false">${I.filter}<span>Filter</span><b class="dl-filter-dot" id="filterDot" hidden></b></button>
          <div class="dl-pop sl-filter" id="filterPop" hidden>
            <div class="pos-field"><label for="fRange">Period</label><select id="fRange">${Object.entries(RANGES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
            <div class="sl-dates" id="fDates" hidden><div class="pos-field"><label for="from">From</label><input id="from" type="date"></div><div class="pos-field"><label for="to">To</label><input id="to" type="date"></div></div>
            <div class="pos-field"><label for="fPay">Payment</label><select id="fPay"><option value="">Any</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="credit">Credit</option><option value="split">Split payment</option></select></div>
            <div class="pos-field"><label for="fStaff">Billed by</label><select id="fStaff"><option value="">Anyone</option></select></div>
            <div class="pos-field"><label for="fMin">Amount at least (₹)</label><input id="fMin" type="number" min="0" step="1" placeholder="0"></div>
            <div class="pos-field"><label for="fSort">Sort by</label><select id="fSort"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="high">Amount (high first)</option><option value="low">Amount (low first)</option><option value="items">Items (most first)</option></select></div>
            <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="fReset">Reset</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="fApply">Apply</button></div>
          </div>
        </div>
      </div>
      <div class="dl-table-wrap"><table class="dl-table sl-table"><thead><tr>
        <th class="c-no">#</th><th>Invoice No.</th><th>Date &amp; Time</th><th>Customer</th><th class="c-c c-items">Items</th><th class="c-r">Amount</th><th>Payment</th><th>Status</th><th class="c-c">Actions</th>
      </tr></thead><tbody id="rows"><tr><td colspan="9" class="dl-empty">Loading sales…</td></tr></tbody></table></div>
      <div class="dl-pager md-pager"><span id="pageInfo"></span><div id="pager"></div>
        <button type="button" class="dl-link sl-all" id="viewAll" hidden>View All Sales ${I.chev}</button>
        <label class="dl-select md-per"><select id="perPage" aria-label="Rows per page"><option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></select></label></div>
    </section>

    ${isAdminView ? `<section class="pos-card pur-trend sl-trend">
      <div class="dl-card-head"><h2>${I.bars}Sales Trend</h2>
        <label class="dl-select pur-mini"><select id="trendRange" aria-label="Range"><option value="7">Last 7 Days</option><option value="30">Last 30 Days</option><option value="month">This Month</option><option value="6m">Last 6 Months</option><option value="12m">Last 12 Months</option></select></label></div>
      <div class="dz-chart pur-chart" id="chart"></div>
      <p class="pur-chart-sub" id="chartSub"></p>
    </section>

    <section class="pos-card pur-top sl-top">
      <div class="dl-card-head"><h2>${I.pill}Top Selling Medicines <small id="topLabel">(by Quantity)</small></h2><button type="button" class="dl-link" id="topAll">View All ${I.chev}</button></div>
      <div class="dl-table-wrap"><table class="dl-table md-plain pur-top-table sl-top-table"><thead><tr><th class="c-no">#</th><th>Medicine</th><th class="c-r">Qty Sold</th><th class="c-r sl-val">Sales Value</th></tr></thead><tbody id="topRows"><tr><td colspan="4" class="dl-empty">Loading…</td></tr></tbody></table></div>
    </section>

    <section class="pos-card pur-sum sl-sum">
      <div class="dl-card-head"><h2>${I.cal}Sales Summary <small>(This Month)</small></h2></div>
      <div class="pur-sum-tiles sl-tiles" id="sumTiles"></div>
      <div class="pur-sum-more" id="sumMore"></div>
    </section>

    <section class="pos-card sl-pay">
      <div class="dl-card-head"><h2>${I.card}Payment Methods <small>(This Month)</small></h2></div>
      <div class="dl-sum sl-paybox">
        <div class="dl-donut sl-donut"><svg viewBox="0 0 220 220" id="donut" aria-hidden="true"></svg><div class="dl-donut-c"><strong id="payTotal">₹0</strong><span>Total Sales</span></div></div>
        <div class="sl-legend" id="payLegend"></div>
      </div>
    </section>` : ''}
  </div>
</div>

<dialog id="billDlg" class="pos-dialog dl-dialog md-wide sl-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="billBody"></div></dialog>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const note = (m, bad) => { $('msg').textContent = m; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; if (m) toast(m, bad); };
for (const d of ['billDlg', 'puDlg']) $(d).addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $(d)) $(d).close(); });
const dlg = html => { $('puPanel').innerHTML = html; if (!$('puDlg').open) $('puDlg').showModal(); };

// ---------------------------------------------------------------------------
// Data: 0026 functions, with a read-only fallback on the invoice table
// ---------------------------------------------------------------------------
const missingFn = e => /sales_(list|summary|daily|top_medicines)|_sales_guard|function|schema cache|does not exist/i.test(e?.message || '');
const istStart = d => `${d}T00:00:00+05:30`;
async function fetchAll(build) {
  const out = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { data: out.length ? out : null, error };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}
const localCache = new Map();
async function localInvoices(from, to) {
  const key = `${from}|${to}`;
  if (localCache.has(key)) return localCache.get(key);
  const { data, error } = await fetchAll(() => sb.from('sales_invoices')
    .select('id,branch_id,invoice_no,customer_id,subtotal,discount,tax,total,status,created_at')
    .eq('branch_id', branchId).gte('created_at', istStart(from)).lt('created_at', istStart(addDays(to, 1)))
    .order('created_at', { ascending: false }).order('id'));
  if (error && !data) throw error;
  const ids = [...new Set((data || []).map(x => x.customer_id).filter(Boolean))];
  let cmap = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data: cs } = await sb.from('customers').select('id,name,phone').eq('branch_id', branchId).in('id', ids.slice(i, i + 200));
    for (const c of cs || []) cmap[c.id] = c;
  }
  const out = (data || []).map(x => ({ ...x, customer_name: cmap[x.customer_id]?.name || null, customer_phone: cmap[x.customer_id]?.phone || null, items: null, paid_cash: 0, paid_upi: 0, paid_card: 0, paid_credit: 0, returned: 0, returns: 0, billed_by: '', medicines: '', barcodes: '' }));
  localCache.set(key, out);
  return out;
}
const localSummary = (list, until) => {
  const all = list.filter(x => !until || new Date(x.created_at) <= until), fin = all.filter(x => x.status === 'final');
  return { sales: fin.reduce((a, x) => a + num(x.total), 0), orders: fin.length, customers: new Set(fin.map(x => x.customer_id).filter(Boolean)).size, walkins: fin.filter(x => !x.customer_id).length, discount: fin.reduce((a, x) => a + num(x.discount), 0), tax: fin.reduce((a, x) => a + num(x.tax), 0), returns: 0, return_count: 0, cash: 0, upi: 0, card: 0, credit: 0, cancelled: all.length - fin.length };
};
async function rpc(name, args) {
  if (rpcOk) {
    const { data, error } = await sb.rpc(name, args);
    if (!error) return data || [];
    if (!missingFn(error)) throw error;
    rpcOk = false;
    note('Sales charts, payment methods and top medicines need database migration 0026_sales_management.sql. Run it once in Supabase. The bill list below still works.', true);
  }
  const from = args.p_from, to = args.p_to;
  if (name === 'sales_list') return localInvoices(from, to);
  if (name === 'sales_summary') return [localSummary(await localInvoices(from, to), args.p_until ? new Date(args.p_until) : null)];
  if (name === 'sales_daily') {
    const list = (await localInvoices(from, to)).filter(x => x.status === 'final'), out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) { const day = list.filter(x => istDay(x.created_at) === d); out.push({ day: d, sales: day.reduce((a, x) => a + num(x.total), 0), orders: day.length, customers: new Set(day.map(x => x.customer_id)).size, returns: 0 }); }
    return out;
  }
  return [];
}
// Customers served: distinct registered customers + each walk-in bill (no customer chosen) counts as one.
const served = s => num(s.customers) + num(s.walkins);

// ---------------------------------------------------------------------------
// KPIs (today vs. yesterday at the same time)
// ---------------------------------------------------------------------------
const delta = (a, b) => {
  if (!b) return a ? '<span class="dz-up">New today</span> · nothing yesterday by now' : 'No sales yet today';
  const p = (a - b) / b * 100;
  return `<span class="${p >= 0 ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.down}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> vs. yesterday`;
};
let kToday = null, kYest = null, monthSum = null;
async function loadKpis() {
  if (!isAdminView) {
    // Staff: counts only, from today's bills.
    const t = today(), list = await rpc('sales_list', { p_from: t, p_to: t }).catch(() => []);
    const fin = list.filter(r => r.status === 'final');
    kToday = { orders: fin.length, customers: new Set(fin.filter(r => r.customer_id).map(r => r.customer_id)).size, walkins: fin.filter(r => !r.customer_id).length, cancelled: list.filter(r => r.status !== 'final').length };
    $('kOrders').textContent = count(kToday.orders); $('kOrdersNote').textContent = 'final bills';
    $('kCust').textContent = count(served(kToday)); $('kCustNote').textContent = `${count(kToday.walkins)} walk-in`;
    return;
  }
  const t = today(), y = addDays(t, -1), sameTime = new Date(Date.now() - 864e5).toISOString();
  const [a, b] = await Promise.all([rpc('sales_summary', { p_from: t, p_to: t }), rpc('sales_summary', { p_from: y, p_to: y, p_until: sameTime })]);
  kToday = a[0] || {}; kYest = b[0] || {};
  const uniq = served;
  const aov = s => num(s.orders) ? num(s.sales) / num(s.orders) : 0;
  $('kSales').textContent = fmtMoney(kToday.sales).replace(/\.00$/, '');
  $('kSalesNote').innerHTML = delta(num(kToday.sales), num(kYest.sales));
  $('kOrders').textContent = count(kToday.orders);
  $('kOrdersNote').innerHTML = delta(num(kToday.orders), num(kYest.orders));
  $('kCust').textContent = count(uniq(kToday));
  $('kCustNote').innerHTML = delta(uniq(kToday), uniq(kYest));
  $('kCust').closest('.dz-kpi').title = `${count(kToday.customers)} registered customer(s) + ${count(kToday.walkins)} walk-in bill(s) today`;
  $('kAov').textContent = fmtMoney(aov(kToday));
  $('kAovNote').innerHTML = delta(aov(kToday), aov(kYest));
  $('kSales').closest('.dz-kpi').title = 'Final bills today. Compared with yesterday up to the same time.';
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
function rangeDates(r) {
  const t = today(), ms = t.slice(0, 8) + '01';
  if (r === 'today') return [t, t];
  if (r === 'yesterday') return [addDays(t, -1), addDays(t, -1)];
  if (r === '7d') return [addDays(t, -6), t];
  if (r === '30d') return [addDays(t, -29), t];
  if (r === 'month') return [ms, t];
  if (r === 'lastmonth') { const e = addDays(ms, -1); return [e.slice(0, 8) + '01', e]; }
  return [filt.from || t, filt.to || t];
}
async function loadList() {
  const [from, to] = rangeDates(filt.range);
  filt.from = from; filt.to = to;
  $('rangeLabel').textContent = `(${filt.range === 'custom' ? (from === to ? dmy(from) : `${dmy(from)} – ${dmy(to)}`) : RANGES[filt.range]})`;
  $('rows').innerHTML = '<tr><td colspan="9" class="dl-empty">Loading sales…</td></tr>';
  try { rows = await rpc('sales_list', { p_from: from, p_to: to }); }
  catch (e) { rows = []; $('rows').innerHTML = `<tr><td colspan="9" class="dl-empty">${esc(friendly(e))}</td></tr>`; return; }
  const staff = [...new Set(rows.map(r => r.billed_by).filter(Boolean))].sort();
  $('fStaff').innerHTML = '<option value="">Anyone</option>' + staff.map(s => `<option ${s === filt.staff ? 'selected' : ''}>${esc(s)}</option>`).join('');
  draw();
}
const paidMethods = r => Object.keys(PAY).filter(k => num(r[`paid_${k}`]) > 0.004);
function payChip(r) {
  if (r.items === null) return '<span class="ds-muted">—</span>';
  const m = paidMethods(r);
  if (!m.length) return '<span class="ds-muted">—</span>';
  if (m.length > 1) return `<span class="sl-pay-chip p-split" title="${esc(m.map(k => `${PAY[k][0]} ${fmtMoney(r[`paid_${k}`])}`).join(' · '))}">Split</span>`;
  return `<span class="sl-pay-chip p-${m[0]}">${PAY[m[0]][0]}</span>`;
}
function statusOf(r) {
  if (r.status === 'cancelled') return ['Cancelled', 'out'];
  if (r.status === 'refunded') return ['Refunded', 'off'];
  if (num(r.returned) > 0 && num(r.returned) >= num(r.total) - 0.5) return ['Returned', 'low'];
  if (num(r.returned) > 0) return ['Part returned', 'low'];
  return ['Completed', 'in'];
}
function filtered() {
  const raw = $('sq').value.trim().toLowerCase(), qd = digits(raw), s = $('fStatus').value;
  const out = rows.filter(r => {
    if (s === 'completed' && !(r.status === 'final' && !(num(r.returned) > 0))) return false;
    if (s === 'returned' && !(num(r.returned) > 0)) return false;
    if (s === 'credit' && !(num(r.paid_credit) > 0)) return false;
    if (s === 'walkin' && r.customer_id) return false;
    if (s === 'cancelled' && r.status === 'final') return false;
    if (filt.pay === 'split' && paidMethods(r).length < 2) return false;
    if (filt.pay && filt.pay !== 'split' && !(num(r[`paid_${filt.pay}`]) > 0)) return false;
    if (filt.staff && r.billed_by !== filt.staff) return false;
    if (filt.min !== '' && num(r.total) < num(filt.min)) return false;
    if (raw) {
      const hay = `${r.invoice_no} ${r.customer_name || 'walk-in'} ${r.patient_name || ''} ${r.doctor_name || ''} ${r.medicines || ''} ${r.billed_by || ''}`.toLowerCase();
      const hit = hay.includes(raw) || (qd.length >= 3 && (digits(r.customer_phone).includes(qd) || String(r.barcodes || '').includes(qd) || digits(r.invoice_no).includes(qd)));
      if (!hit) return false;
    }
    return true;
  });
  const by = { new: (a, b) => String(b.created_at).localeCompare(String(a.created_at)), old: (a, b) => String(a.created_at).localeCompare(String(b.created_at)), high: (a, b) => num(b.total) - num(a.total), low: (a, b) => num(a.total) - num(b.total), items: (a, b) => num(b.items) - num(a.items) }[filt.sort];
  return out.sort(by);
}
function draw() {
  const list = filtered(), per = compact ? 5 : Number($('perPage').value), pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(page, pages);
  const shown = list.slice((page - 1) * per, page * per);
  $('rows').innerHTML = shown.map((r, i) => {
    const [sl, sc] = statusOf(r);
    return `<tr data-id="${esc(r.id)}" class="${r.status === 'final' ? '' : 'ds-off'}">
      <td class="c-no">${(page - 1) * per + i + 1}</td>
      <td class="c-inv"><span class="sl-doc">${I.bill}</span><b>${esc(r.invoice_no)}</b><small class="sl-m-cust">${I.user}${esc(r.customer_name || r.patient_name || 'Walk-in')}</small></td>
      <td class="c-when"><span class="sl-d">${esc(dShort(r.created_at))}, ${esc(tShort(r.created_at))}</span><small class="sl-m-items">${r.items === null ? '' : `${r.items} item${r.items === 1 ? '' : 's'}`}</small></td>
      <td class="c-cust">${r.customer_name ? `<b>${esc(r.customer_name)}</b>` : `<span class="ds-muted">${esc(r.patient_name || 'Walk-in')}</span>`}</td>
      <td class="c-c c-items">${r.items === null ? '—' : r.items}</td>
      <td class="c-r c-amt"><b>${fmtMoney(r.total)}</b>${num(r.returned) > 0 ? `<small class="sl-ret">−${fmtMoney(r.returned)} returned</small>` : ''}</td>
      <td class="c-pay">${payChip(r)}</td>
      <td class="c-st"><span class="md-chip sl-st ${sc}">${sc === 'in' ? I.check : '<i></i>'}${sl}</span></td>
      <td class="c-act"><div class="pur-acts"><button type="button" class="dl-act" data-view aria-label="View ${esc(r.invoice_no)}">${I.eye}</button><div class="dl-pop-anchor"><button type="button" class="dl-act" data-menu aria-label="More actions for ${esc(r.invoice_no)}">${I.dots}</button></div></div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="dl-empty">${rows.length ? 'No sales match these filters.' : `No sales ${filt.range === 'today' ? 'yet today' : 'in this period'}.`} <a href="billing.html">Start a new sale</a></td></tr>`;
  $('pageInfo').textContent = list.length ? `Showing ${(page - 1) * per + 1} – ${Math.min(page * per, list.length)} of ${count(list.length)} sales` : '';
  $('pager').innerHTML = !compact && pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, k) => k + 1).filter(n => n <= 5 && page <= 3 || n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, k, arr) => `${k && n - arr[k - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
  $('viewAll').hidden = !(compact && list.length > per);
  $('filterDot').hidden = !(filt.range !== 'today' || filt.pay || filt.staff || filt.min !== '' || filt.sort !== 'new');
}

// ---------------------------------------------------------------------------
// Trend, top medicines, summary, payment methods
// ---------------------------------------------------------------------------
function trendWindow() {
  const r = $('trendRange').value, t = today();
  if (r === '7') return { from: addDays(t, -6), to: t, monthly: false, label: 'Last 7 Days' };
  if (r === '30') return { from: addDays(t, -29), to: t, monthly: false, label: 'Last 30 Days' };
  if (r === 'month') return { from: t.slice(0, 8) + '01', to: t, monthly: false, label: 'This Month' };
  const n = r === '6m' ? 6 : 12, [y, m] = t.split('-').map(Number), s = new Date(Date.UTC(y, m - n, 1)).toISOString().slice(0, 10);
  return { from: s, to: t, monthly: true, label: `Last ${n} Months` };
}
function niceStep(v) { if (v <= 0) return 1; const raw = v * 1.08 / 6, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const axisMoney = v => v >= 1e7 ? `₹${+(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${+(v / 1e5).toFixed(1)}L` : `₹${Math.round(v).toLocaleString('en-IN')}`;
let trendData = [];
async function loadTrend() {
  const w = trendWindow();
  let days = [];
  try { days = await rpc('sales_daily', { p_from: w.from, p_to: w.to }); } catch (e) { $('chart').innerHTML = `<p class="dl-empty">${esc(friendly(e))}</p>`; return; }
  if (w.monthly) {
    const g = new Map();
    for (const d of days) { const k = String(d.day).slice(0, 7); const x = g.get(k) || { sales: 0, orders: 0, returns: 0 }; x.sales += num(d.sales); x.orders += num(d.orders); x.returns += num(d.returns); g.set(k, x); }
    trendData = [...g.entries()].map(([k, x]) => ({ label: new Date(k + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), full: new Date(k + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), ...x }));
  } else {
    trendData = days.map(d => { const k = String(d.day).slice(0, 10); return { label: new Date(k + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }), full: new Date(k + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }), sales: num(d.sales), orders: num(d.orders), returns: num(d.returns) }; });
  }
  drawChart();
  loadTop();
}
function drawChart() {
  const el = $('chart'), s = trendData, N = s.length;
  if (!N) { el.innerHTML = '<p class="dl-empty">No sales in this period.</p>'; $('chartSub').textContent = ''; return; }
  const vals = s.map(x => x.sales), total = vals.reduce((a, b) => a + b, 0), orders = s.reduce((a, x) => a + x.orders, 0);
  $('chartSub').textContent = `${rupees0(total)} from ${count(orders)} bill${orders === 1 ? '' : 's'} · ${trendWindow().label}`;
  const W = Math.max(260, el.clientWidth), H = el.clientHeight || 220, padL = 58, padR = 18, padT = 34, padB = 28, steps = 6;
  const hi = Math.max(...vals, 1), tick = niceStep(hi), max = tick * steps;
  const x = i => padL + (N === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (N - 1)), yv = v => padT + (H - padT - padB) * (1 - v / max);
  const pts = vals.map((v, i) => [x(i), yv(v)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < N; i++) d += ` L${pts[i][0]},${pts[i][1]}`;
  const area = `${d} L${pts[N - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z`;
  const fit = Math.max(2, Math.floor((W - padL - padR) / 46)), every = Math.max(1, Math.ceil(N / fit));
  const grid = Array.from({ length: steps + 1 }, (_, i) => i * tick);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales trend">
    <defs><linearGradient id="slArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fbf3a" stop-opacity=".38"/><stop offset="1" stop-color="#2fbf3a" stop-opacity=".05"/></linearGradient></defs>
    <g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${yv(v)}" y2="${yv(v)}"/>`).join('')}</g>
    <g class="dz-axis pur-axis">${grid.map(v => `<text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end">${axisMoney(v)}</text>`).join('')}${s.map((p, i) => (i % every === 0 && N - 1 - i >= every / 2) || i === N - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '').join('')}</g>
    <path d="${area}" fill="url(#slArea)"/><path class="dz-line" d="${d}"/>
    ${pts.map(([px, py], i) => `<circle class="dz-pt${i === N - 1 ? ' hot' : ''}" data-i="${i}" cx="${px}" cy="${py}" r="${i === N - 1 ? 6 : N > 14 ? 3 : 4.5}"/>`).join('')}
    ${pts.map(([px], i) => `<rect data-i="${i}" x="${px - (W - padL - padR) / Math.max(1, N - 1) / 2}" y="${padT}" width="${(W - padL - padR) / Math.max(1, N - 1)}" height="${H - padT - padB}" fill="transparent"/>`).join('')}
  </svg><div class="dz-tip" id="slTip"></div>`;
  const tip = $('slTip');
  const show = i => { const [px, py] = pts[i]; tip.innerHTML = `${rupees0(vals[i])}<small>${esc(s[i].full)} · ${s[i].orders} bill${s[i].orders === 1 ? '' : 's'}${s[i].returns && W > 480 ? ` · returns ${rupees0(s[i].returns)}` : ''}</small>`; tip.style.left = `${Math.min(Math.max(px / W * 100, 20), 80)}%`; tip.style.top = `${(py - 12) / H * 100}%`; el.querySelectorAll('.dz-pt').forEach(c => c.classList.toggle('hot', +c.dataset.i === i)); };
  show(N - 1);
  const sv = el.querySelector('svg');
  sv.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('mouseleave', () => show(N - 1));
  sv.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
}
const medName = m => `${m.name}${m.strength ? ' ' + m.strength : ''}`;
async function loadTop() {
  const w = trendWindow();
  $('topLabel').textContent = `(by Quantity · ${w.label})`;
  if (!rpcOk) { $('topRows').innerHTML = '<tr><td colspan="4" class="dl-empty">Needs migration 0026.</td></tr>'; return; }
  let top = [];
  try { top = await rpc('sales_top_medicines', { p_from: w.from, p_to: w.to, p_limit: 5 }); } catch (e) { $('topRows').innerHTML = `<tr><td colspan="4" class="dl-empty">${esc(friendly(e))}</td></tr>`; return; }
  $('topRows').innerHTML = top.map((m, i) => `<tr data-med="${esc(medName(m))}" title="Show bills with ${esc(medName(m))}"><td class="c-no"><span class="pur-rank r${i + 1}">${i + 1}</span></td><td>${esc(medName(m))}</td><td class="c-r">${count(m.qty)}</td><td class="c-r sl-val">${fmtMoney(m.sales)}</td></tr>`).join('')
    || '<tr><td colspan="4" class="dl-empty">No medicines sold in this period.</td></tr>';
}
async function loadMonth() {
  const t = today(), ms = t.slice(0, 8) + '01';
  try { monthSum = (await rpc('sales_summary', { p_from: ms, p_to: t }))[0] || {}; } catch (e) { $('sumTiles').innerHTML = `<p class="dl-empty">${esc(friendly(e))}</p>`; return; }
  const s = monthSum, aov = num(s.orders) ? num(s.sales) / num(s.orders) : 0;
  const uniq = served(s);
  $('sumTiles').innerHTML = `
    <button type="button" class="g" data-goto="month"><b>${rupees0(s.sales)}</b><span>Total Sales</span></button>
    <button type="button" class="b" data-goto="month"><b>${count(s.orders)}</b><span>Total Orders</span></button>
    <button type="button" class="a" data-goto="month" title="${count(s.customers)} registered customer(s) + ${count(s.walkins)} walk-in bill(s)"><b>${count(uniq)}</b><span>Unique Customers</span></button>
    <button type="button" class="p" data-goto="month"><b>${fmtMoney(aov)}</b><span>Avg. Order Value</span></button>`;
  $('sumMore').innerHTML = [
    num(s.returns) ? `<button type="button" data-goto="returned">${I.undo}<span>Returns <b>${rupees0(s.returns)}</b> · ${s.return_count}</span></button>` : '',
    num(s.returns) ? `<span class="ds-adv">${I.bars}<span>Net sales <b>${rupees0(num(s.sales) - num(s.returns))}</b></span></span>` : '',
    num(s.discount) ? `<span class="ds-adv">${I.receipt}<span>Discount given <b>${rupees0(s.discount)}</b></span></span>` : '',
    num(s.tax) ? `<span class="ds-adv">${I.bill}<span>GST collected <b>${fmtMoney(s.tax)}</b></span></span>` : '',
    num(s.credit) ? `<button type="button" data-goto="credit">${I.card}<span>On credit <b>${rupees0(s.credit)}</b></span></button>` : '',
    num(s.walkins) ? `<button type="button" data-goto="walkin">${I.user}<span>Walk-in bills <b>${count(s.walkins)}</b></span></button>` : '',
    num(s.cancelled) ? `<button type="button" data-goto="cancelled">${I.xs}<span>Cancelled <b>${count(s.cancelled)}</b></span></button>` : ''
  ].join('');
  drawPay();
}
function drawPay() {
  const s = monthSum || {};
  if (!rpcOk) { $('donut').innerHTML = '<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="30"/>'; $('payTotal').textContent = rupees0(s.sales); $('payLegend').innerHTML = '<p class="dl-muted">Payment split needs migration 0026.</p>'; return; }
  const parts = Object.entries(PAY).map(([k, [l, col]]) => ({ k, l, col, v: num(s[k]) })).filter(p => p.v > 0 || p.k !== 'credit');
  const total = parts.reduce((a, p) => a + p.v, 0), C = 2 * Math.PI * 84, gap = total ? 2 : 0;
  let off = 0;
  $('donut').innerHTML = `<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="30"/>` + parts.map(p => {
    const len = total ? p.v / total * C : 0;
    const out = len > gap ? `<circle cx="110" cy="110" r="84" fill="none" stroke="${p.col}" stroke-width="30" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-off}"><title>${p.l} ${fmtMoney(p.v)}</title></circle>` : '';
    off += len;
    return out;
  }).join('');
  $('payTotal').textContent = rupees0(num(s.sales));
  $('payLegend').innerHTML = parts.map(p => `<button type="button" data-paygo="${p.k}"><i style="background:${p.col}"></i><b>${p.l}</b><em>${total ? (p.v / total * 100).toFixed(1) : '0.0'}%</em><span>${rupees0(p.v)}</span></button>`).join('');
}
function notify() {
  const items = [], s = kToday || {};
  if (isAdminView && num(s.credit) > 0) items.push({ tone: 'warn', title: `${rupees0(s.credit)} sold on credit today`, detail: 'Collect from Customers → Receive payment', href: 'customers.html?status=due' });
  if (isAdminView && num(s.returns) > 0) items.push({ tone: 'info', title: `${s.return_count} return(s) today · ${rupees0(s.returns)} refunded`, detail: 'See Sales Return', href: 'returns.html' });
  if (num(s.cancelled) > 0) items.push({ tone: 'danger', title: `${s.cancelled} bill(s) cancelled today`, detail: 'Check the bills marked Cancelled', href: 'sales.html' });
  if (!num(s.orders)) items.push({ tone: 'info', title: 'No sales yet today', detail: 'Start a new sale from Billing', href: 'billing.html' });
  setNotifications(items);
}

// ---------------------------------------------------------------------------
// Bill details, print, menu
// ---------------------------------------------------------------------------
async function loadDetail(id) {
  const { data, error } = await sb.rpc('invoice_detail', { p_invoice: id });
  if (error) throw error;
  if (!data?.invoice || !Array.isArray(data.items) || !Array.isArray(data.payments)) throw new Error('Invoice detail returned an unexpected format.');
  // Pharmacy details for the printout — from the branch recorded on the invoice (existing behaviour).
  const invoiceBranchId = data.invoice.branch_id || branchId;
  const { data: branch, error: be } = await sb.from('branches')
    .select('name,address,city,state,pincode,phone,email,gstin,drug_licence_nos,invoice_footer')
    .eq('id', invoiceBranchId).maybeSingle();
  if (be) console.warn('Invoice pharmacy profile lookup:', be);
  const addressParts = [branch?.address, branch?.city, branch?.state, branch?.pincode].map(v => String(v || '').trim()).filter(Boolean);
  data.shop = {
    name: branch?.name || data.shop?.name || 'PALLIKKAL PHARMACY',
    address: addressParts.join(', '),
    phone: branch?.phone || '', email: branch?.email || '', gstin: branch?.gstin || '',
    drug_licence: Array.isArray(branch?.drug_licence_nos) ? branch.drug_licence_nos.filter(Boolean).join(' / ') : String(branch?.drug_licence_nos || ''),
    footer_note: branch?.invoice_footer || ''
  };
  data._noBranch = !branch;
  return data;
}
async function printBill(id) {
  note('Loading invoice preview…');
  try {
    const data = await loadDetail(id);
    if (data._noBranch) note('Invoice opened. Pharmacy profile details are not visible for this branch; configure/check Settings access to show them.', true);
    else note(`Invoice ${data.invoice.invoice_no} opened.`);
    showInvoice(data, undefined, { whatsapp: (x, say) => sendInvoice(sb, x.invoice.id, x, say) });
  } catch (e) { note('Invoice preview failed: ' + friendly(e), true); }
}
function billSummaryText(r, d) {
  const items = (d?.items || []).map(x => `• ${x.name}${x.strength ? ' ' + x.strength : ''} × ${x.qty} = ₹${money2(x.line_total)}`).join('\n');
  return `PALLIKKAL PHARMACY\nBill ${r.invoice_no} · ${when(r.created_at)}\n${items ? items + '\n' : ''}Total: ₹${money2(r.total)}\nThank you! Get well soon.`;
}
async function openBill(id) {
  const r = rows.find(x => x.id === id) || { id };
  $('billBody').innerHTML = '<p class="dl-muted">Loading bill…</p>';
  if (!$('billDlg').open) $('billDlg').showModal();
  let d, rets = [];
  try { d = await loadDetail(id); } catch (e) { $('billBody').innerHTML = `<p class="pos-form-msg">${esc(friendly(e))}</p>`; return; }
  const { data: rr } = await sb.from('sales_returns').select('return_no,total,refund_method,reason,created_at').eq('invoice_id', id).order('created_at');
  rets = rr || [];
  const inv = d.invoice, c = d.customer, [sl, sc] = statusOf({ ...r, ...inv, returned: r.returned ?? rets.reduce((a, x) => a + num(x.total), 0) });
  const phone = c?.phone || inv.patient_phone;
  const paid = d.payments.reduce((a, p) => a + num(p.amount), 0);
  $('billBody').innerHTML = `
    <div class="sl-bill-head"><span class="pos-title-ic sl-bill-ic">${I.bill}</span>
      <div><h3>${esc(inv.invoice_no)} <span class="md-chip sl-st ${sc}">${sc === 'in' ? I.check : '<i></i>'}${sl}</span></h3>
      <p class="dl-muted">${esc(when(inv.created_at))}${r.billed_by ? ` · billed by ${esc(r.billed_by)}` : ''}</p></div></div>
    <div class="sl-kv">
      <div><small>Customer</small><b>${c ? `${esc(c.name)}<br><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : 'Walk-in'}</b></div>
      ${inv.patient_name ? `<div><small>Patient</small><b>${esc(inv.patient_name)}${inv.patient_phone ? `<br>${esc(inv.patient_phone)}` : ''}</b></div>` : ''}
      ${inv.doctor_name ? `<div><small>Doctor</small><b>${esc(inv.doctor_name)}</b></div>` : ''}
      <div><small>Payment</small><b>${d.payments.length ? d.payments.map(p => `${esc((PAY[p.method] || [p.method])[0])} ${fmtMoney(p.amount)}`).join('<br>') : '—'}</b></div>
    </div>
    <div class="dl-table-wrap"><table class="dl-table md-plain sl-items"><thead><tr><th>Medicine</th><th>Batch · Exp</th><th class="c-r">Qty</th><th class="c-r">Rate</th><th class="c-r">Disc %</th><th class="c-r">GST %</th><th class="c-r">Amount</th></tr></thead>
      <tbody>${d.items.map(x => `<tr><td><b>${esc(x.name)}</b> ${esc(x.strength || '')}</td><td>${esc(x.batch_no || '')}${x.expiry ? ` · ${esc(String(x.expiry).slice(0, 7))}` : ''}</td><td class="c-r">${count(x.qty)}</td><td class="c-r">${money2(x.unit_price)}</td><td class="c-r">${num(x.discount_pct) || 0}</td><td class="c-r">${num(x.tax_rate)}</td><td class="c-r">${money2(x.line_total)}</td></tr>`).join('') || '<tr><td colspan="7" class="dl-empty">No items.</td></tr>'}</tbody></table></div>
    <div class="sl-totals">
      <span>Subtotal <b>${fmtMoney(inv.subtotal)}</b></span>
      ${num(inv.discount) + num(inv.line_discount) ? `<span>Discount <b>−${fmtMoney(num(inv.discount) + num(inv.line_discount))}</b></span>` : ''}
      <span>GST <b>${fmtMoney(inv.tax)}</b></span>
      <span class="big">Total <b>${fmtMoney(inv.total)}</b></span>
      ${paid && Math.abs(paid - num(inv.total)) > 0.01 ? `<span>Paid <b>${fmtMoney(paid)}</b></span>` : ''}
    </div>
    ${rets.length ? `<h4 class="sl-sub">${I.undo} Returns</h4><div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Credit note</th><th>Date</th><th>Refund</th><th>Reason</th></tr></thead><tbody>${rets.map(x => `<tr><td>${esc(x.return_no)}</td><td>${esc(when(x.created_at))}</td><td>${fmtMoney(x.total)} · ${esc(String(x.refund_method || '').toUpperCase())}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="pos-dialog-foot sl-bill-acts">
      <button type="button" class="pos-btn pos-btn-solid" data-bact="print">${I.print}<span>Preview / Print</span></button>
      <a class="pos-btn" href="invoice-view.html?id=${encodeURIComponent(id)}">${I.bill}<span>Open invoice page</span></a>
      ${canReturn && inv.status === 'final' ? `<a class="pos-btn" href="returns.html?invoice=${encodeURIComponent(id)}">${I.undo}<span>Sales return</span></a>` : ''}
      ${phone ? `<a class="pos-btn pos-btn-green" target="_blank" rel="noopener" href="https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(billSummaryText({ ...r, ...inv }, d))}">${I.wa}<span>WhatsApp bill</span></a>` : ''}
      ${c ? `<a class="pos-btn" href="customers.html?q=${encodeURIComponent(c.phone)}">${I.user}<span>Customer</span></a>` : ''}
    </div>`;
  $('billBody').onclick = e => { if (e.target.closest('[data-bact="print"]')) { $('billDlg').close(); showInvoice(d, undefined, { whatsapp: (x, say) => sendInvoice(sb, x.invoice.id, x, say) }); } };
}
let menuEl = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
function menuHtml(r) {
  const b = (a, ic, l) => `<button type="button" data-act="${a}">${ic}<span>${l}</span></button>`;
  return [
    b('view', I.eye, 'View details'), `<a href="invoice-view.html?id=${encodeURIComponent(r.id)}">${I.bill}<span>Open invoice page</span></a>`, b('print', I.print, 'Preview / Print'),
    canReturn && r.status === 'final' ? `<a href="returns.html?invoice=${encodeURIComponent(r.id)}">${I.undo}<span>Sales return</span></a>` : '',
    r.customer_phone ? b('wa', I.wa, 'WhatsApp bill to customer') : '',
    r.customer_id ? `<a href="customers.html?q=${encodeURIComponent(r.customer_phone || r.customer_name)}">${I.user}<span>Customer profile</span></a>` : '',
    r.customer_id ? `<a href="billing.html?customer=${encodeURIComponent(r.customer_id)}">${I.plusC}<span>New bill for this customer</span></a>` : '',
    b('copy', I.copy, 'Copy invoice no.')
  ].join('');
}
$('rows').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const r = rows.find(x => x.id === tr.dataset.id);
  const m = e.target.closest('[data-menu]');
  if (m) { e.stopPropagation(); if (menuEl && menuEl.parentElement === m.parentElement) return closeMenu(); closeMenu(); menuEl = document.createElement('div'); menuEl.className = 'dl-pop md-menu md-row-menu pur-row-menu'; menuEl.innerHTML = menuHtml(r); m.parentElement.append(menuEl); return; }
  const a = e.target.closest('[data-act]');
  if (a) {
    e.stopPropagation(); closeMenu();
    if (a.dataset.act === 'view') return openBill(r.id);
    if (a.dataset.act === 'print') return printBill(r.id);
    if (a.dataset.act === 'copy') { try { await navigator.clipboard.writeText(r.invoice_no); toast(`${r.invoice_no} copied.`); } catch { prompt('Invoice number', r.invoice_no); } return; }
    if (a.dataset.act === 'wa') {
      let d = null; try { d = await loadDetail(r.id); } catch { /* summary without items */ }
      window.open(`https://wa.me/${waNumber(r.customer_phone)}?text=${encodeURIComponent(billSummaryText(r, d))}`, '_blank', 'noopener');
      return;
    }
  }
  if (e.target.closest('a')) return;
  return openBill(r.id);
});
document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });

// ---------------------------------------------------------------------------
// Export / print / top medicines dialog
// ---------------------------------------------------------------------------
function exportRows() {
  return filtered().map(r => ({
    'Invoice No.': r.invoice_no, Date: istDay(r.created_at), Time: tShort(r.created_at), Customer: r.customer_name || 'Walk-in', Phone: r.customer_phone || '',
    Patient: r.patient_name || '', Doctor: r.doctor_name || '', Items: r.items ?? '', 'Subtotal (₹)': num(r.subtotal), 'Discount (₹)': num(r.discount), 'GST (₹)': num(r.tax), 'Total (₹)': num(r.total),
    'Cash (₹)': num(r.paid_cash), 'UPI (₹)': num(r.paid_upi), 'Card (₹)': num(r.paid_card), 'Credit (₹)': num(r.paid_credit), 'Returned (₹)': num(r.returned),
    Status: statusOf(r)[0], 'Billed by': r.billed_by || '', Medicines: r.medicines || ''
  }));
}
function writeSheet(list, name, sheet, csv = false) {
  if (window.XLSX && !csv) { const ws = XLSX.utils.json_to_sheet(list); ws['!cols'] = Object.keys(list[0] || { a: 1 }).map(k => ({ wch: k === 'Medicines' ? 60 : Math.min(40, Math.max(11, k.length + 2)) })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet); XLSX.writeFile(wb, name + '.xlsx'); return; }
  const keys = Object.keys(list[0]);
  const text = [keys, ...list.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
}
const fileTag = () => filt.from === filt.to ? filt.from : `${filt.from}_to_${filt.to}`;
function printList() {
  const list = exportRows(), H = ['Invoice No.', 'Date', 'Time', 'Customer', 'Items', 'Total (₹)', 'Returned (₹)', 'Status'];
  const tot = list.filter((r, i) => filtered()[i].status === 'final').reduce((a, r) => a + r['Total (₹)'], 0);
  const frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.append(frame);
  frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>Sales</title><style>body{font:12px Arial,sans-serif;margin:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f2f5f2}td.r{text-align:right}</style></head><body><h2>PALLIKKAL PHARMACY — Sales ${esc($('rangeLabel').textContent)}</h2><p>${list.length} bill(s)${isAdminView ? ` · Total ${esc(fmtMoney(tot))}` : ''}</p><table><thead><tr>${H.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${list.map(r => `<tr>${H.map(h => `<td class="${/₹|Items/.test(h) ? 'r' : ''}">${esc(typeof r[h] === 'number' && /₹/.test(h) ? money2(r[h]) : r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
  frame.contentDocument.close(); setTimeout(() => { try { frame.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => frame.remove(), 60000); }, 250);
}
const TOP_P = { '7': 'Last 7 Days', '30': 'Last 30 Days', month: 'This Month', lastmonth: 'Last Month', '90': 'Last 90 Days', today: 'Today' };
function topWindow(k) {
  const t = today(), ms = t.slice(0, 8) + '01';
  if (k === 'today') return [t, t];
  if (k === 'month') return [ms, t];
  if (k === 'lastmonth') { const e = addDays(ms, -1); return [e.slice(0, 8) + '01', e]; }
  return [addDays(t, -(Number(k) - 1)), t];
}
let topList = [];
async function topDialog(k = '30') {
  if (!rpcOk) return note('Top selling medicines need database migration 0026_sales_management.sql.', true);
  dlg(`<h3>${I.pill} Top selling medicines</h3>
    <div class="sl-top-tools"><label class="dl-select pur-mini"><select id="topPeriod" aria-label="Period">${Object.entries(TOP_P).map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button type="button" class="pos-btn pos-btn-sm" id="topExport">${I.download}<span>Excel</span></button></div>
    <div class="dl-table-wrap sl-top-all"><table class="dl-table md-plain"><thead><tr><th>#</th><th>Medicine</th><th class="c-r">Qty Sold</th><th class="c-r">Bills</th><th class="c-r">Sales Value</th></tr></thead><tbody id="topAllRows"><tr><td colspan="5" class="dl-empty">Loading…</td></tr></tbody></table></div>`);
  const [from, to] = topWindow(k);
  try { topList = await rpc('sales_top_medicines', { p_from: from, p_to: to, p_limit: 100 }); } catch (e) { $('topAllRows').innerHTML = `<tr><td colspan="5" class="dl-empty">${esc(friendly(e))}</td></tr>`; return; }
  $('topAllRows').innerHTML = topList.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(medName(m))}</td><td class="c-r">${count(m.qty)}</td><td class="c-r">${m.bills}</td><td class="c-r">${fmtMoney(m.sales)}</td></tr>`).join('') || '<tr><td colspan="5" class="dl-empty">No medicines sold in this period.</td></tr>';
  $('topPeriod').onchange = () => topDialog($('topPeriod').value);
  $('topExport').onclick = () => topList.length ? writeSheet(topList.map((m, i) => ({ Rank: i + 1, Medicine: medName(m), 'Qty sold': num(m.qty), Bills: m.bills, 'Sales value (₹)': num(m.sales) })), `Pallikkal_Top_Medicines_${from}_to_${to}`, 'Top medicines') : toast('Nothing to export.', true);
}
$('exportBtn').onclick = e => { e.stopPropagation(); $('exportMenu').hidden = !$('exportMenu').hidden; };
document.addEventListener('click', e => { if (!$('exportMenu').hidden && !e.target.closest('#exportMenu')) $('exportMenu').hidden = true; });
$('exportMenu').onclick = e => {
  const b = e.target.closest('[data-exp]'); if (!b) return;
  $('exportMenu').hidden = true;
  if (b.dataset.exp === 'top') return topDialog($('trendRange').value === '7' ? '7' : $('trendRange').value === 'month' ? 'month' : '30');
  const list = exportRows();
  if (!list.length) return toast('Nothing to export for these filters.', true);
  if (b.dataset.exp === 'print') return printList();
  writeSheet(list, `Pallikkal_Sales_${fileTag()}`, 'Sales', b.dataset.exp === 'csv');
  toast(`${list.length} bill(s) exported.`);
};
$('posBtn').onclick = () => { const w = window.open('billing.html', 'pallikkal-pos', 'popup=yes,width=1440,height=900'); if (!w) location.href = 'billing.html'; };

// ---------------------------------------------------------------------------
// Filters, paging, clicks
// ---------------------------------------------------------------------------
let t; $('sq').oninput = () => { clearTimeout(t); t = setTimeout(() => { page = 1; draw(); }, 200); };
['fStatus', 'perPage'].forEach(id => $(id).onchange = () => { page = 1; draw(); });
$('pager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); draw(); } };
$('viewAll').onclick = () => { compact = false; draw(); };
$('filterBtn').onclick = e => {
  e.stopPropagation();
  if ($('filterPop').hidden) { $('fRange').value = filt.range; $('from').value = filt.from; $('to').value = filt.to; $('fDates').hidden = filt.range !== 'custom'; $('fPay').value = filt.pay; $('fStaff').value = filt.staff; $('fMin').value = filt.min; $('fSort').value = filt.sort; }
  $('filterPop').hidden = !$('filterPop').hidden;
};
$('filterPop').onclick = e => e.stopPropagation();
document.addEventListener('click', () => { $('filterPop').hidden = true; });
$('fRange').onchange = () => { $('fDates').hidden = $('fRange').value !== 'custom'; if ($('fRange').value === 'custom') { $('from').value ||= today(); $('to').value ||= today(); } };
async function setRange(r, from, to) {
  const changed = r !== filt.range || (r === 'custom' && (from !== filt.from || to !== filt.to));
  filt.range = r; if (r === 'custom') { filt.from = from; filt.to = to; }
  page = 1;
  if (changed) await loadList(); else draw();
}
$('fApply').onclick = async () => {
  let from = $('from').value, to = $('to').value;
  if ($('fRange').value === 'custom') {
    if (!from || !to) return toast('Choose both dates.', true);
    if (to < from) [from, to] = [to, from];
    if ((new Date(to) - new Date(from)) / 864e5 > 400) return toast('Choose a period of 400 days or less.', true);
  }
  filt.pay = $('fPay').value; filt.staff = $('fStaff').value; filt.min = $('fMin').value; filt.sort = $('fSort').value;
  $('filterPop').hidden = true;
  await setRange($('fRange').value, from, to);
};
$('fReset').onclick = async () => { Object.assign(filt, { pay: '', staff: '', min: '', sort: 'new' }); $('fStatus').value = ''; $('sq').value = ''; $('filterPop').hidden = true; await setRange('today'); draw(); };
const goList = async (status = '', range = filt.range) => { $('fStatus').value = status; await setRange(range); draw(); $('rows').closest('.sl-list').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
document.querySelector('.md-kpis').onclick = e => { if (e.target.closest('[data-kpi]')) goList('', 'today'); };
if (isAdminView) {
$('topAll').onclick = () => topDialog($('trendRange').value === '7' ? '7' : $('trendRange').value === 'month' ? 'month' : '30');
$('topRows').onclick = async e => { const tr = e.target.closest('tr[data-med]'); if (!tr) return; $('sq').value = tr.dataset.med; const r = $('trendRange').value; await goList('', r === '7' ? '7d' : r === 'month' ? 'month' : '30d'); };
$('sumTiles').onclick = e => { if (e.target.closest('[data-goto]')) goList('', 'month'); };
$('sumMore').onclick = e => { const b = e.target.closest('[data-goto]'); if (b) goList(b.dataset.goto, 'month'); };
$('payLegend').onclick = async e => { const b = e.target.closest('[data-paygo]'); if (!b) return; filt.pay = b.dataset.paygo; await goList('', 'month'); };
$('trendRange').onchange = loadTrend;
let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(drawChart, 120); }).observe($('chart'));
}
matchMedia('(max-width: 560px)').addEventListener('change', ev => { compact = ev.matches; page = 1; draw(); });

// ---------------------------------------------------------------------------
// Start — ?q=<invoice no. / phone / medicine> (dashboard, customers), ?range=, ?invoice=<id>
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
if (params.get('q')) {
  $('sq').value = params.get('q');
  filt.range = '30d';                    // a search from another page looks back 30 days
}
if (RANGES[params.get('range')] && params.get('range') !== 'custom') filt.range = params.get('range');
await loadKpis().catch(e => note(friendly(e), true));
await loadList();
if (params.get('q') && !filtered().length && filt.range === '30d') { filt.range = 'custom'; filt.from = addDays(today(), -365); filt.to = today(); await loadList(); }
if (isAdminView) await Promise.all([loadTrend(), loadMonth()]).catch(e => note(friendly(e), true));
notify();
if (params.get('invoice')) openBill(params.get('invoice'));
$('allBillsBtn').onclick = () => openAllBills(sb, prof);
