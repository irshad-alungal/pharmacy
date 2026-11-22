// Purchases Management — Pallikkal Pharmacy design.
// Supplier bills (stock-in with pack factor, free qty, batch MRP/GST, drafts, bill files,
// optional payment), purchase orders (order → partly received → received), purchase
// returns, supplier payments, trend, top distributors and monthly summary.
// Server: confirm_purchase_v3 (0024, wraps confirm_purchase_v2), purchase_list_v2,
// purchase_order_save/list/cancel, purchase_draft_save/list/delete, purchase_detail,
// purchase_invoice_exists, purchase_returnable, process_purchase_return,
// record_supplier_payment, register_purchase_document.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly, safeQ } from './ui.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('purchases', 'Purchases', { layout: 'brand' });
const $ = id => document.getElementById(id);
const WRITER_ROLES = ['super_admin', 'admin', 'pharmacist', 'inventory_staff', 'inventory'];
const canWrite = WRITER_ROLES.includes(prof.role);
const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = v => inr(num(v));
const r2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const count = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(num(n));
const money2 = v => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupees0 = v => '₹' + Math.round(num(v)).toLocaleString('en-IN');
const dmy = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const shortDay = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const when = v => new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h9a1.5 1.5 0 0 0 1.4-1.1L21.5 7.5H6"/>', 1.9),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  ret: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  layers: svg('<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>', 1.8),
  box: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>', 1.6),
  truck: svg('<path d="M2 6h11v10H2z"/><path d="M13 9h4.5l3.5 3.5V16h-8"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>', 1.8),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  cal: svg('<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>', 2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  filter: svg('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  bars: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/></svg>',
  doc: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>', 1.9),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
  caret: svg('<path d="m6 9 6 6 6-6"/>', 2.4),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  check: svg('<path d="m5 12 5 5 9-10"/>', 2.6),
  hour: svg('<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9"/>', 2),
  orderDoc: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>', 2),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', 2),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 2),
  rupee: svg('<path d="M6 4h12M6 8h12M14 4c3 0 4 2 4 4s-1 4-4 4H6l8 8"/>', 2),
  clip: svg('<path d="m21 11-8.6 8.6a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7L10 17.4a1.7 1.7 0 0 1-2.4-2.4L15.5 7"/>', 2),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  share: svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>', 1.9),
  dist: svg('<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>', 1.9),
  receive: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m8 12 3 3 5-6"/>', 1.9),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 1.9),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 2),
  summary: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M8 13h2M8 17h2M12 13h4M12 17h4"/>', 1.9),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;

const [distRes] = await Promise.all([
  sb.from('distributors').select('id,name,phone,gstin,active,drug_licence,address,contact_person').eq('branch_id', prof.branch_id).order('name')
]);
const allDists = distRes.data || [];
const dists = allDists.filter(d => d.active !== false);
const medicineMap = new Map();
let purchaseRows = [];
let draftRows = [];
let orderRows = [];
let attachments = [];
let currentDraftId = null;
let currentOrderId = null;
let tab = 'all';
let page = 1;
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

$('view').innerHTML = `
<div class="pos dl md pur purchase-page">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.cart}</span>
      <div><h1>Purchases Management</h1><p>Manage purchase orders, stock receipts, supplier bills, and returns.</p></div></div>
    <div class="pos-head-actions md-head-actions pur-head-actions">
      <div class="pur-split">
        <button type="button" class="pos-btn pos-btn-solid" id="newPurchase">${I.plusC}<span>New Purchase</span></button>
        <button type="button" class="pos-btn pos-btn-solid pur-caret" id="newMenuBtn" aria-label="More ways to add a purchase" aria-expanded="false">${I.caret}</button>
        <div class="dl-pop md-menu pur-new-menu" id="newMenu" hidden>
          <button type="button" data-new="bill">${I.receive}<span><b>Supplier bill</b><small>Receive stock now</small></span></button>
          <button type="button" data-new="order">${I.orderDoc}<span><b>Purchase order</b><small>Order from a distributor, receive later</small></span></button>
          <button type="button" data-new="drafts">${I.pencil}<span><b>Continue a draft</b><small>Bills saved without posting</small></span></button>
        </div>
      </div>
      ${isAdmin ? `<button type="button" class="pos-btn" id="returnBtn">${I.ret}<span><i class="pur-long">Purchase Return</i><i class="pur-short">Return</i></span></button>` : ''}
      <button type="button" class="pos-btn" id="importBtn">${I.upload}<span>Import</span></button>
      <button type="button" class="pos-btn" id="exportBtn">${I.download}<span>Export</span></button>
    </div>
  </section>

  <section class="dz-kpis dl-kpis md-kpis">
    ${KPI('green', I.layers, 'Total Purchases', 'kTotal')}
    ${KPI('blue', I.cart, 'Purchase Orders', 'kOrders')}
    ${KPI('amber', I.box, 'Items Purchased', 'kItems')}
    ${KPI('purple', I.truck, 'Active Distributors', 'kDists')}
  </section>

  <div id="pageMsg" class="md-msg" role="status"></div>

  <div class="dl-grid md-grid pur-grid">
    <div class="dl-main-col">
      <section class="pos-card dl-orders pur-list">
        <div class="dl-card-head pur-list-head">
          <h2>${I.list}Purchase List <span id="listTotal">(0)</span></h2>
          <label class="dl-select pur-period">${I.cal}<select id="period" aria-label="Period">
            <option value="today">Today</option><option value="7">Last 7 Days</option><option value="30" selected>Last 30 Days</option>
            <option value="month">This Month</option><option value="lastmonth">Last Month</option><option value="90">Last 90 Days</option>
            <option value="year">This Year</option><option value="all">All Time</option><option value="custom">Custom range…</option></select></label>
        </div>
        <div class="pur-tools">
          <label class="dl-search">${I.search}<input id="searchPurchase" type="search" placeholder="Search by invoice no., distributor, or medicine..." autocomplete="off" aria-label="Search purchases"></label>
          <label class="dl-select"><select id="fDist" aria-label="Distributor"><option value="">All Distributors</option>${allDists.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label>
          <label class="dl-select"><select id="fStatus" aria-label="Status"><option value="">All Status</option><option value="received">Received</option><option value="ordered">Ordered</option><option value="partial">Partially Received</option><option value="drafts">Drafts</option><option value="closed">Closed / Cancelled orders</option><option value="cancelled">Cancelled bills</option></select></label>
          <div class="dl-pop-anchor">
            <button type="button" class="pos-btn dl-filter-btn" id="filterBtn" aria-expanded="false">${I.filter}<span>Filter</span><b class="dl-filter-dot" id="filterDot" hidden></b></button>
            <div class="dl-pop" id="filterPop" hidden>
              <div class="md-form-grid"><div class="pos-field"><label for="fromDate">From</label><input id="fromDate" type="date"></div><div class="pos-field"><label for="toDate">To</label><input id="toDate" type="date"></div></div>
              ${isAdmin ? `<div class="md-form-grid"><div class="pos-field"><label for="fMin">Amount from ₹</label><input id="fMin" type="number" min="0"></div><div class="pos-field"><label for="fMax">Amount to ₹</label><input id="fMax" type="number" min="0"></div></div>
              <label class="dl-check"><input type="checkbox" id="fUnpaid"> Only bills with balance to pay</label>` : ''}
              <label class="dl-check"><input type="checkbox" id="fNoDoc"> Only bills without an attached bill file</label>
              <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="clearFilters">Reset</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="applyFilters">Apply</button></div>
            </div>
          </div>
        </div>
        <div class="pur-chips" role="tablist" aria-label="Status">
          <button type="button" role="tab" data-tab="all" class="on">All (<span id="t_all">0</span>)</button>
          <button type="button" role="tab" data-tab="received">Received (<span id="t_received">0</span>)</button>
          <button type="button" role="tab" data-tab="ordered">Ordered (<span id="t_ordered">0</span>)</button>
          <button type="button" role="tab" data-tab="partial">Partial (<span id="t_partial">0</span>)</button>
          ${canWrite ? '<button type="button" role="tab" data-tab="drafts">Drafts (<span id="draftBadge">0</span>)</button>' : ''}
        </div>
        <div class="dl-table-wrap"><table class="dl-table pur-table"><thead><tr>
          <th class="c-no">#</th><th>Invoice No.</th><th>Distributor</th><th class="c-date">Date</th><th class="c-r c-items">Items</th><th class="c-r">Amount (₹)</th><th>Status</th><th class="c-c">Actions</th>
        </tr></thead><tbody id="purchaseRows"><tr><td colspan="8" class="dl-empty">Loading purchases…</td></tr></tbody></table></div>
        <div class="dl-pager md-pager"><span id="listCount"></span><div id="pager"></div>
          <label class="dl-select md-per"><select id="perPage" aria-label="Rows per page"><option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></select></label></div>
      </section>
    </div>

    <aside class="dl-side">
      <section class="pos-card pur-trend">
        <div class="dl-card-head"><h2>${I.bars}Purchase Trend</h2>
          <label class="dl-select pur-mini"><select id="trendRange" aria-label="Trend range"><option value="7">Last 7 Days</option><option value="30">Last 30 Days</option><option value="12m">Last 12 Months</option></select></label></div>
        <div class="dz-chart pur-chart" id="chart"></div>
        <p class="pur-chart-sub" id="chartSub"></p>
      </section>
      <section class="pos-card pur-top">
        <div class="dl-card-head"><h2>${I.truck}Top Distributors <small id="topSub">(by Purchase Value)</small></h2><a class="dl-link" href="distributors.html">View All ${I.chev}</a></div>
        <div class="dl-table-wrap"><table class="dl-table md-plain pur-top-table"><thead><tr><th>Distributor</th><th class="c-r" id="topValHead">${isAdmin ? 'Purchase Value (₹)' : 'Units'}</th><th class="c-r">Orders</th></tr></thead><tbody id="topRows"><tr><td colspan="3" class="dl-empty">Loading…</td></tr></tbody></table></div>
      </section>
      <section class="pos-card pur-sum">
        <div class="dl-card-head"><h2>${I.summary}Purchase Summary <small>(This Month)</small></h2>${isAdmin ? `<a class="dl-link" href="reports.html">Details ${I.chev}</a>` : ''}</div>
        <div class="pur-sum-tiles" id="sumTiles"></div>
        <div class="pur-sum-more" id="sumMore"></div>
      </section>
    </aside>
  </div>
</div>
<input id="attachFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide pur-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>
<dialog class="purchase-dialog pur-bill-dlg pb-dlg" id="purchaseDialog">
<div class="pb-head">
  <span class="pb-head-ic">${I.receive}</span>
  <div class="pb-head-txt"><h3 id="formTitle">New purchase</h3><p>Enter the supplier invoice exactly as printed — every medicine on the bill goes into this one purchase.</p></div>
  <span class="pb-head-status" id="pbStatus"></span>
  <button class="pos-icon-btn pb-close" id="closePurchase" type="button" aria-label="Close">${I.xs}</button>
</div>
<form id="purchaseForm" class="purchase-form pb-form" novalidate>
  <div id="orderBanner" class="pur-order-banner" hidden></div>
  <section class="pb-card">
    <div class="pb-step"><b>1</b><h4>Supplier &amp; invoice</h4><span>Bill header — supplier, invoice number and dates</span></div>
    <div class="pb-sup-grid">
      <div class="pb-sup-left">
        <div class="purchase-field"><label for="supplier">Supplier / Distributor *</label>
          <div class="pb-sup-pick"><select id="supplier" required><option value="">Select supplier</option>${dists.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select>
          <button type="button" class="pos-btn pos-btn-sm" id="newDistBtn" title="Add a new distributor">${I.plusC}<span>New</span></button></div></div>
        <div class="pb-sup-card" id="supCard"></div>
      </div>
      <div class="pb-inv-grid">
        <div class="purchase-field"><label for="invoiceNo">Supplier invoice no. *</label><input id="invoiceNo" required maxlength="100" placeholder="e.g. 26000730094079"></div>
        <div class="purchase-field"><label for="invoiceDate">Invoice date *</label><input id="invoiceDate" type="date" required></div>
        <div class="purchase-field"><label for="paymentTerms">Payment terms</label><select id="paymentTerms"><option value="credit">Credit</option><option value="cash">Cash</option><option value="other">Other</option></select></div>
        <div class="purchase-field"><label for="dueDate">Due date</label><input id="dueDate" type="date"><div class="pb-chips" id="creditDays"><button type="button" data-days="0">Today</button><button type="button" data-days="15">15 d</button><button type="button" data-days="30">30 d</button><button type="button" data-days="45">45 d</button><button type="button" data-days="60">60 d</button></div></div>
        <div class="purchase-field"><label for="orderNo">Order no.</label><input id="orderNo" maxlength="60" placeholder="Optional"></div>
        <div class="purchase-field"><label for="orderDate">Order date</label><input id="orderDate" type="date"></div>
        <div class="purchase-field"><label for="invoiceTaxMode">Rates on the bill are</label><select id="invoiceTaxMode"><option value="exclusive">Before GST (trade price)</option><option value="inclusive">Including GST</option><option value="mixed">Set per item</option></select></div>
        <div class="purchase-field pb-span2"><label for="notes">Notes / reference</label><input id="notes" maxlength="300" placeholder="Sales executive, tray no., remarks…"></div>
      </div>
    </div>
    <div id="dupWarning" class="purchase-warning" hidden></div>
  </section>

  <section class="pb-card pb-items">
    <div class="pb-step"><b>2</b><h4>Medicine items</h4><span class="pb-count" id="itemCount">0 items</span>
      <div class="pb-step-acts"><button class="pos-btn pos-btn-sm" type="button" id="excelTemplate">${I.download}<span>Template</span></button><button class="pos-btn pos-btn-sm" type="button" id="excelUploadBtn">${I.upload}<span>Import Excel</span></button><input id="excelFile" type="file" accept=".xlsx,.xls,.csv" hidden><button class="pos-btn pos-btn-sm pos-btn-solid" type="button" id="addItem">${I.plusC}<span>Add medicine</span></button></div></div>
    <details class="pb-help"><summary>How to enter a bill line</summary><p>Type the medicine name and pick it from the list (or <b>+ Create</b> it). <b>Pack</b> = units in one strip (15'S → 15). <b>Qty</b> and <b>Free</b> are in packs, exactly as billed. <b>MRP</b> and <b>Rate</b> are per pack (trade price). <b>Sch ₹</b> is the scheme discount amount and <b>Disc %</b> the cash discount — both reduce the taxable value like on the supplier bill. Expiry can be typed as <b>06/28</b>. Press <b>Enter</b> to jump to the next box; Enter on the last box adds a new line.</p></details>
    <datalist id="medicineSuggestions"></datalist>
    <div class="pb-table-wrap"><table class="pb-table" id="itemTable"><thead><tr>
      <th class="c-n">#</th><th class="c-med">Medicine *</th><th>HSN</th><th>Pack</th><th>Batch *</th><th>Expiry *</th><th>Qty *</th><th>Free</th><th>MRP / pack</th><th>Rate / pack *</th><th>Sch ₹</th><th>Disc %</th><th>GST %</th><th class="c-r">Taxable</th><th class="c-r">Net</th><th></th>
    </tr></thead><tbody id="itemRows"></tbody>
    <tfoot><tr><td colspan="6"><button type="button" class="pb-addline" id="addItem2">${I.plusC}<span>Add another medicine</span></button><button type="button" class="pb-addline" id="addFive">+5 lines</button></td>
      <td class="c-r" id="ftQty">0</td><td class="c-r" id="ftFree">0</td><td colspan="5" class="c-r pb-ft-lbl">Totals</td><td class="c-r" id="ftTaxable">₹0.00</td><td class="c-r" id="ftNet">₹0.00</td><td></td></tr></tfoot></table></div>
  </section>

  <div class="pb-two">
    <section class="pb-card">
      <div class="pb-step"><b>3</b><h4>GST &amp; adjustments</h4><span>Tax-wise summary as printed on the bill</span></div>
      <div class="dl-table-wrap"><table class="pb-gst"><thead><tr><th>GST %</th><th class="c-r">Taxable</th><th class="c-r">CGST</th><th class="c-r">SGST</th><th class="c-r">Total GST</th></tr></thead><tbody id="gstSummary"></tbody></table></div>
      <div class="pb-adj">
        <div class="purchase-field"><label for="invoiceDiscount">Bill discount ₹</label><input id="invoiceDiscount" type="number" min="0" step=".01" value="0"></div>
        <div class="purchase-field"><label for="freight">Freight / other ₹</label><input id="freight" type="number" min="0" step=".01" value="0"></div>
        <div class="purchase-field"><label for="roundOff">Round off ₹</label><div class="pb-inline"><input id="roundOff" type="number" step=".01" min="-100" max="100" value="0"><button type="button" class="pos-btn pos-btn-sm" id="autoRound" title="Round the net amount to the nearest rupee">Auto</button></div></div>
        <div class="purchase-field"><label for="printedTotal">Net amount on bill ₹</label><input id="printedTotal" type="number" min="0" step=".01" placeholder="To cross-check"></div>
      </div>
    </section>
    <section class="pb-card pb-totals">
      <div class="pb-step"><b>₹</b><h4>Bill total</h4></div>
      <div class="purchase-summary-box pb-sumbox">
        <div class="purchase-summary-line"><span>Gross (qty × rate)</span><strong id="sumGross">₹0.00</strong></div>
        <div class="purchase-summary-line"><span>Scheme + cash discount</span><strong id="sumLineDisc">₹0.00</strong></div>
        <div class="purchase-summary-line"><span>Taxable value</span><strong id="sumSubtotal">₹0.00</strong></div>
        <div class="purchase-summary-line sub"><span>CGST</span><strong id="sumCgst">₹0.00</strong></div>
        <div class="purchase-summary-line sub"><span>SGST</span><strong id="sumSgst">₹0.00</strong></div>
        <div class="purchase-summary-line"><span>GST total</span><strong id="sumTax">₹0.00</strong></div>
        <div class="purchase-summary-line"><span>Bill discount</span><strong id="sumDiscount">₹0.00</strong></div>
        <div class="purchase-summary-line"><span>Freight / other</span><strong id="sumFreight">₹0.00</strong></div>
        <div class="purchase-summary-line"><span>Round off</span><strong id="sumRound">₹0.00</strong></div>
        <div class="purchase-summary-line total"><span>Net amount</span><strong id="sumTotal">₹0.00</strong></div>
        <div id="totalCompare" class="pb-compare"></div>
      </div>
    </section>
  </div>

  <div class="pb-two">
    <section class="pb-card">
      <div class="pb-step"><b>4</b><h4>Payment</h4></div>
      ${isAdmin ? `<div class="pb-pay"><div class="purchase-field"><label for="amountPaid">Amount paid now ₹</label><div class="pb-inline"><input id="amountPaid" type="number" min="0" step=".01" value="0"><button type="button" class="pos-btn pos-btn-sm" id="payFull">Full</button></div></div><div class="purchase-field"><label for="paymentMode">Mode</label><select id="paymentMode"><option value="cash">Cash</option><option value="upi">UPI</option></select></div><div class="purchase-field pb-span2"><label for="paymentRef">Reference</label><input id="paymentRef" maxlength="100" placeholder="UPI ref / cheque no."></div></div><p class="pb-note">Leave 0 for a credit purchase. The balance stays payable to the supplier (Finance → Payables).</p>`
        : `<p class="pb-note">The bill is posted as payable to the supplier. An admin records payments.</p>`}
    </section>
    <section class="pb-card">
      <div class="pb-step"><b>5</b><h4>Bill copy</h4></div>
      <div class="pb-files-acts"><label class="pos-btn pos-btn-sm" for="billFiles">${I.upload}<span>Upload PDF / images</span></label><input id="billFiles" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden><label class="pos-btn pos-btn-sm" for="cameraFiles">${I.clip}<span>Take photo</span></label><input id="cameraFiles" type="file" accept="image/*" capture="environment" multiple hidden></div>
      <div id="attachmentList" class="purchase-file-list"><span class="purchase-muted">No bill files selected.</span></div>
      <p class="pb-note">Linked to the purchase when posted (PDF, JPG, PNG or WEBP, up to 15 MB each). Drafts keep the bill details, not the files.</p>
    </section>
  </div>

  <div class="pb-foot">
    <div class="pb-foot-sum"><b id="pbSumItems">0 items</b><span id="pbSumUnits">0 units</span><span class="pb-foot-net">Net <b id="pbSumNet">₹0.00</b></span></div>
    <div id="formError" class="purchase-error" role="alert"></div>
    <div class="pb-foot-acts"><button type="button" class="pos-btn" id="saveDraft">Save draft</button><button type="button" class="pos-btn pos-btn-red" id="deleteDraft" hidden>Delete draft</button><button type="button" class="pos-btn pos-btn-solid" id="confirmPurchase">${I.check}<span>Review &amp; confirm stock-in</span></button></div>
  </div>
</form></dialog>

<dialog class="purchase-dialog" id="viewDialog"><div class="purchase-dialog-head"><h3 id="viewTitle">Purchase invoice</h3><button class="purchase-btn" id="closeView" type="button">Close</button></div><div id="viewContent"></div></dialog>
<dialog class="purchase-dialog" id="fileDialog"><div class="purchase-dialog-head"><h3>Bill preview</h3><button class="purchase-btn" id="closeFile" type="button">Close</button></div><div id="filePreview"></div></dialog>
<dialog class="purchase-dialog purchase-confirm pb-confirm" id="confirmDialog"><h3>${I.check} Confirm purchase and update stock?</h3><div id="confirmSummary"></div><p>This posts the purchase, adds the stock below and records the supplier payable. Please verify invoice, batch, expiry, quantity, rates and tax before continuing.</p><div class="pos-dialog-foot"><button class="pos-btn" id="backToEdit" type="button">Go back</button><button class="pos-btn pos-btn-solid" id="postNow" type="button">Confirm and post stock</button></div></dialog>
<dialog class="purchase-dialog purchase-confirm" id="newMedDialog"><h3>Create medicine</h3><div class="purchase-grid">
  <div class="purchase-field span2"><label for="nmName">Medicine name *</label><input id="nmName" maxlength="120"></div>
  <div class="purchase-field"><label for="nmStrength">Strength</label><input id="nmStrength" maxlength="40" placeholder="e.g. 650 mg"></div>
  <div class="purchase-field"><label for="nmGst">GST %</label><input id="nmGst" type="number" min="0" max="40" step=".01" value="5"></div>
  <div class="purchase-field span2"><label for="nmBarcode">Barcode (optional)</label><input id="nmBarcode" maxlength="40"></div>
</div><p class="purchase-muted">MRP and selling price are taken from this bill when it is posted. Complete other details later in Medicines.</p><div id="nmError" class="purchase-error"></div><div class="purchase-actions"><button class="purchase-btn" id="nmCancel" type="button">Cancel</button><button class="purchase-btn dark" id="nmSave" type="button">Create medicine</button></div></dialog>
`;
mountGlobalSearch({ sb, prof });
$('orderBanner') && ($('orderBanner').hidden = true);

// ---------------------------------------------------------------------------
// Purchase bill form (stock-in)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Item rows
// ---------------------------------------------------------------------------
const medLabel = m => `${m.name}${m.strength ? ' ' + m.strength : ''}`;

// Expiry as printed on bills: 06/28, 06-28, 06/2028, 30/06/2028 or 2028-06-30 → ISO (month end for MM/YY).
function parseExp(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return s;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/))) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return okDate(y, +m[2], +m[1]); }
  if ((m = s.match(/^(\d{1,2})[\/\-.\s]?(\d{2}|\d{4})$/))) { const y = m[2].length === 2 ? 2000 + +m[2] : +m[2], mo = +m[1]; if (mo < 1 || mo > 12) return null; return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); }
  return null;
}
function okDate(y, mo, d) { const dt = new Date(Date.UTC(y, mo - 1, d)); return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null; }
const expShow = iso => { if (!iso) return ''; const [y, mo, d] = iso.split('-').map(Number); const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return d === last ? `${String(mo).padStart(2, '0')}/${String(y).slice(2)}` : `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`; };
const expISO = tr => parseExp(tr.querySelector('.expiry').value) || '';
const packOf = v => { const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10); return n > 0 ? n : 1; };

function makeItemRow(seed = {}, focus = false) {
  const tr = document.createElement('tr');
  tr.className = 'purchase-item-row';
  const mode = seed.rate_mode || ($('invoiceTaxMode').value === 'inclusive' ? 'inclusive' : 'exclusive');
  const sch = seed.sch_disc ?? (seed.disc_pct ? 0 : seed.discount ?? 0);
  const cells = [
    ['#', '<span class="pb-n"></span>', 'c-n'],
    ['Medicine *', `<input class="med-name" list="medicineSuggestions" placeholder="Type medicine name…" autocomplete="off" value="${esc(seed.medicine_label || '')}"><small class="pb-medinfo"></small><button type="button" class="purchase-link create-med" hidden>+ Create “<span></span>”</button>`, 'c-med'],
    ['HSN', `<input class="hsn" placeholder="HSN" maxlength="12" value="${esc(seed.hsn || '')}">`, 'c-hsn'],
    ['Pack', `<input class="pack" type="number" min="1" step="1" value="${seed.pack ?? 1}" title="Units in one pack (15'S = 15)">`, 'c-pack'],
    ['Batch *', `<input class="batch" placeholder="Batch" maxlength="40" value="${esc(seed.batch_no || '')}">`, 'c-batch'],
    ['Expiry *', `<input class="expiry" placeholder="MM/YY" maxlength="10" value="${esc(expShow(seed.expiry || ''))}" inputmode="numeric"><small class="pb-exp"></small>`, 'c-exp'],
    ['Qty *', `<input class="qty" type="number" min="1" step="1" value="${seed.qty ?? 1}"><small class="pb-units">= <output class="stock-units">0</output> units</small>`, 'c-qty'],
    ['Free', `<input class="free" type="number" min="0" step="1" value="${seed.free_qty ?? 0}">`, 'c-free'],
    ['MRP / pack', `<input class="mrp" type="number" min="0" step=".01" value="${seed.mrp ?? 0}"><small class="pb-units"><output class="billing-rate">₹0.00</output>/unit</small>`, 'c-mrp'],
    ['Rate / pack *', `<input class="rate" type="number" min="0" step=".01" value="${seed.rate ?? 0}"><select class="rate-mode" aria-label="Rate mode"><option value="exclusive">+GST</option><option value="inclusive">incl. GST</option></select>`, 'c-rate'],
    ['Sch ₹', `<input class="line-discount" type="number" min="0" step=".01" value="${sch}" title="Scheme discount amount">`, 'c-sch'],
    ['Disc %', `<input class="disc-pct" type="number" min="0" max="100" step=".01" value="${seed.disc_pct ?? 0}" title="Cash discount %">`, 'c-dpct'],
    ['GST %', `<select class="gst" aria-label="GST %">${[0, 5, 12, 18, 28].map(g => `<option value="${g}">${g}</option>`).join('')}</select>`, 'c-gst'],
    ['Taxable', '<output class="line-taxable">₹0.00</output>', 'c-r c-tx'],
    ['Net', '<output class="line-total">₹0.00</output>', 'c-r c-net'],
    ['', `<div class="pb-row-acts"><button class="dl-act dup-line" type="button" title="Same medicine, another batch" aria-label="Duplicate line">${I.layers}</button><button class="dl-act remove-line" type="button" title="Remove line" aria-label="Remove medicine row">${I.xs}</button></div>`, 'c-act']
  ];
  tr.innerHTML = cells.map(([label, html, cls]) => `<td data-label="${label}" class="${cls}">${html}</td>`).join('');
  tr.querySelector('.rate-mode').value = mode;
  setGst(tr, seed.tax_rate ?? 5);
  if (seed.medicine_id) tr.dataset.medicineId = seed.medicine_id;
  if (seed.gst_touched) tr.dataset.gstTouched = '1';
  $('itemRows').appendChild(tr);
  if (seed.medicine_label && !seed.medicine_id) resolveMedicine(tr);
  calcTotals();
  if (focus) tr.querySelector('.med-name').focus();
  return tr;
}
function setGst(tr, v) {
  const sel = tr.querySelector('.gst'), val = String(num(v));
  if (![...sel.options].some(o => o.value === val)) sel.insertAdjacentHTML('beforeend', `<option value="${val}">${val}</option>`);
  sel.value = val;
}

// Per line, as on the supplier bill: gross = qty × rate; scheme ₹ then cash-discount % reduce it to the
// taxable value; GST on top. Amounts sent to confirm_purchase_v2 exclude GST.
function calcLine(tr) {
  const v = c => tr.querySelector(c).value;
  const qty = num(v('.qty')), free = num(v('.free')), pack = Math.max(1, Math.floor(num(v('.pack')) || 1));
  const rate = num(v('.rate')), sch = num(v('.line-discount')), pct = Math.min(100, Math.max(0, num(v('.disc-pct')))), gst = num(v('.gst')), mrp = num(v('.mrp'));
  const mode = v('.rate-mode');
  const gross = qty * rate;
  const schD = Math.min(sch, gross);
  const discount = r2(schD + (gross - schD) * pct / 100);
  const entered = Math.max(0, gross - discount);
  const factor = mode === 'inclusive' ? 1 + gst / 100 : 1;
  const priceEx = rate / factor;
  const discEx = discount / factor;
  const taxable = r2(qty * priceEx - discEx);
  const tax = r2(taxable * gst / 100);
  const total = mode === 'inclusive' ? r2(entered) : r2(taxable + tax);
  const stockUnits = pack * (qty + free);
  tr.querySelector('.stock-units').textContent = String(stockUnits);
  tr.querySelector('.billing-rate').textContent = fmt(mrp / pack);
  tr.querySelector('.line-taxable').textContent = fmt(taxable);
  tr.querySelector('.line-total').textContent = fmt(total);
  const ex = v('.expiry').trim(), iso = parseExp(ex), hint = tr.querySelector('.pb-exp');
  hint.textContent = !ex ? '' : iso === null ? 'Use MM/YY' : iso <= today() ? 'Expired' : dmy(iso);
  hint.className = `pb-exp ${!ex ? '' : iso === null || iso <= today() ? 'bad' : iso <= addDays(today(), 180) ? 'warn' : 'ok'}`;
  return { qty, free, pack, rate, discount, gross, gst, mode, mrp, priceEx, discEx, taxable, tax, total, stockUnits, sch: schD, pct };
}

function calcTotals() {
  let sub = 0, tax = 0, gross = 0, ldisc = 0, units = 0, qty = 0, free = 0, n = 0;
  const byRate = new Map();
  [...$('itemRows').children].forEach((tr, i) => {
    tr.querySelector('.pb-n').textContent = i + 1;
    const c = calcLine(tr);
    sub += c.taxable; tax += c.tax; gross += c.gross; ldisc += c.discount; units += c.stockUnits; qty += c.qty; free += c.free;
    if (tr.querySelector('.med-name').value.trim()) n++;
    const g = byRate.get(c.gst) || { t: 0, x: 0 }; g.t += c.taxable; g.x += c.tax; byRate.set(c.gst, g);
  });
  const disc = num($('invoiceDiscount').value), freight = num($('freight').value), round = num($('roundOff').value);
  const total = r2(sub + tax - disc + freight + round);
  $('sumGross').textContent = fmt(gross);
  $('sumLineDisc').textContent = fmt(ldisc);
  $('sumSubtotal').textContent = fmt(sub);
  $('sumCgst').textContent = fmt(tax / 2);
  $('sumSgst').textContent = fmt(tax / 2);
  $('sumTax').textContent = fmt(tax);
  $('sumDiscount').textContent = fmt(disc);
  $('sumFreight').textContent = fmt(freight);
  $('sumRound').textContent = fmt(round);
  $('sumTotal').textContent = fmt(total);
  $('ftQty').textContent = count(qty); $('ftFree').textContent = count(free);
  $('ftTaxable').textContent = fmt(sub); $('ftNet').textContent = fmt(r2(sub + tax));
  $('itemCount').textContent = `${n} item${n === 1 ? '' : 's'}`;
  $('pbSumItems').textContent = `${n} item${n === 1 ? '' : 's'}`;
  $('pbSumUnits').textContent = `${count(units)} stock units`;
  $('pbSumNet').textContent = fmt(total);
  $('gstSummary').innerHTML = [...byRate.entries()].filter(([, g]) => g.t || g.x).sort((a, b) => a[0] - b[0]).map(([r, g]) => `<tr><td>${r}%</td><td class="c-r">${money2(g.t)}</td><td class="c-r">${money2(g.x / 2)}</td><td class="c-r">${money2(g.x / 2)}</td><td class="c-r"><b>${money2(g.x)}</b></td></tr>`).join('')
    || '<tr><td colspan="5" class="pb-empty">Add medicines to see the GST summary.</td></tr>';
  const printed = $('printedTotal').value === '' ? null : num($('printedTotal').value);
  const cmp = $('totalCompare');
  cmp.className = `pb-compare ${printed === null ? '' : Math.abs(printed - total) > 0.02 ? 'bad' : 'ok'}`;
  cmp.textContent = printed === null ? '' : Math.abs(printed - total) > 0.02
    ? `Bill says ${fmt(printed)} — differs by ${fmt(Math.abs(printed - total))}. Check rates, discounts, GST and round off.`
    : '✓ Matches the net amount on the bill.';
  return { sub: r2(sub), tax: r2(tax), total };
}

async function searchMedicines(text) {
  const q = safeQ(text);
  if (q.length < 2) return [];
  const run = term => sb.from('medicines')
    .select('id,name,strength,tax_rate,mrp')
    .eq('branch_id', prof.branch_id).eq('active', true)
    .or(`name.ilike.%${term}%,barcode.eq.${term}`).limit(15);
  let { data, error } = await run(q);
  // "Cetirizine 10 mg" (name + strength, e.g. typed or from Excel): retry with the first word.
  if (!error && !(data || []).length && q.includes(' ')) ({ data, error } = await run(q.split(' ')[0]));
  if (error) throw error;
  const dl = $('medicineSuggestions');
  dl.innerHTML = '';
  for (const m of data || []) {
    medicineMap.set(medLabel(m).toLowerCase(), m);
    const op = document.createElement('option');
    op.value = medLabel(m);
    dl.appendChild(op);
  }
  return data || [];
}

async function resolveMedicine(tr) {
  const input = tr.querySelector('.med-name');
  const label = input.value.trim();
  const createBtn = tr.querySelector('.create-med');
  if (!label) { delete tr.dataset.medicineId; createBtn.hidden = true; return; }
  let m = medicineMap.get(label.toLowerCase());
  if (!m) {
    try {
      const found = await searchMedicines(label);
      m = medicineMap.get(label.toLowerCase()) || (found.length === 1 && found[0].name.toLowerCase() === label.toLowerCase() ? found[0] : null);
    } catch (err) { setMsg(friendly(err), 'error'); }
  }
  if (m) {
    tr.dataset.medicineId = m.id;
    tr.classList.remove('unknown');
    createBtn.hidden = true;
    if (!tr.dataset.gstTouched && m.tax_rate != null) setGst(tr, m.tax_rate);
    tr.querySelector('.pb-medinfo').textContent = [m.tax_rate != null ? `GST ${num(m.tax_rate)}%` : '', num(m.mrp) > 0 ? `master MRP ₹${money2(m.mrp)}/unit` : ''].filter(Boolean).join(' · ');
  } else {
    delete tr.dataset.medicineId;
    tr.classList.add('unknown');
    tr.querySelector('.pb-medinfo').textContent = '';
    createBtn.hidden = !canWrite;
    createBtn.querySelector('span').textContent = label;
  }
  calcTotals();
}

let medTimer;
$('itemRows').addEventListener('input', e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  if (e.target.classList.contains('med-name')) {
    clearTimeout(medTimer);
    medTimer = setTimeout(() => searchMedicines(e.target.value).catch(() => {}), 250);
  }
  if (e.target.classList.contains('gst')) tr.dataset.gstTouched = '1';
  calcTotals();
});
$('itemRows').addEventListener('change', e => {
  const tr = e.target.closest('tr');
  if (tr && e.target.classList.contains('med-name')) resolveMedicine(tr);
  calcTotals();
});
$('itemRows').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (e.target.closest('.remove-line')) { tr.remove(); if (!$('itemRows').children.length) makeItemRow({}); calcTotals(); return; }
  const create = e.target.closest('.create-med');
  if (create) openNewMedicine(tr);
});

// Create a missing medicine directly from a bill row.
let newMedRow = null;
function openNewMedicine(tr) {
  newMedRow = tr;
  $('nmName').value = tr.querySelector('.med-name').value.trim();
  $('nmStrength').value = '';
  $('nmBarcode').value = '';
  $('nmGst').value = tr.querySelector('.gst').value || 5;
  $('nmError').textContent = '';
  $('newMedDialog').showModal();
}
$('nmCancel').onclick = () => $('newMedDialog').close();
$('nmSave').onclick = async () => {
  const name = $('nmName').value.trim();
  const gst = num($('nmGst').value);
  if (name.length < 2) return ($('nmError').textContent = 'Enter the medicine name.');
  if (gst < 0 || gst > 40) return ($('nmError').textContent = 'GST must be between 0 and 40.');
  $('nmSave').disabled = true;
  const row = { branch_id: prof.branch_id, name, strength: $('nmStrength').value.trim() || null, tax_rate: gst, mrp: 0, selling_price: 0, active: true };
  if ($('nmBarcode').value.trim()) row.barcode = $('nmBarcode').value.trim();
  const { data, error } = await sb.from('medicines').insert(row).select('id,name,strength,tax_rate,mrp').single();
  $('nmSave').disabled = false;
  if (error) return ($('nmError').textContent = friendly(error));
  medicineMap.set(medLabel(data).toLowerCase(), data);
  if (newMedRow) {
    newMedRow.querySelector('.med-name').value = medLabel(data);
    setGst(newMedRow, gst); newMedRow.dataset.gstTouched = '1';
    await resolveMedicine(newMedRow);
  }
  $('newMedDialog').close();
  setMsg(`Medicine “${medLabel(data)}” created. Its MRP will be set from this bill when posted.`);
};

$('addItem').onclick = () => makeItemRow({ tax_rate: lastGst() }, true);
['invoiceDiscount', 'freight', 'roundOff', 'printedTotal'].forEach(id => $(id).addEventListener('input', calcTotals));
$('invoiceTaxMode').onchange = () => {
  if ($('invoiceTaxMode').value !== 'mixed') for (const tr of $('itemRows').children) tr.querySelector('.rate-mode').value = $('invoiceTaxMode').value;
  calcTotals();
};


// ---- bill-entry helpers: supplier card, keyboard flow, quick actions ----
function renderSupplier() {
  const d = allDists.find(x => x.id === $('supplier').value);
  if (!d) { $('supCard').innerHTML = `<div class="pb-sup-empty">${I.truck}<span>Choose the supplier printed at the top of the bill. Not in the list? Use <b>New</b>.</span></div>`; return; }
  const bills = purchaseRows.filter(p => p.distributor_id === d.id && p.status !== 'cancelled');
  const bal = isAdmin ? bills.reduce((a, p) => a + Math.max(0, num(p.total) - num(p.paid) - num(p.returned)), 0) : null;
  const last = bills.map(p => p.invoice_date).sort().pop();
  const kv = (k, v) => v ? `<div><small>${k}</small><b>${esc(v)}</b></div>` : '';
  $('supCard').innerHTML = `<div class="pb-sup-name">${I.truck}<b>${esc(d.name)}</b>${d.active === false ? ' <span class="md-chip off">Inactive</span>' : ''}</div>
    <div class="pb-sup-kv">${kv('GSTIN', d.gstin)}${kv('Drug licence', d.drug_licence)}${kv('Phone', d.phone)}${kv('Contact', d.contact_person)}${kv('Address', d.address)}
    ${kv('Last bill', last ? dmy(last) : 'No bills yet')}${isAdmin ? `<div><small>Payable now</small><b class="${bal > 0.005 ? 'pur-red' : 'pur-green'}">${fmt(bal)}</b></div>` : ''}</div>`;
}
$('supplier').addEventListener('change', renderSupplier);
$('newDistBtn').onclick = () => {
  dlg(`<h3>${I.truck} New distributor</h3><p class="dl-muted">Copy the details from the top of the supplier bill.</p>
    <div class="md-form-grid">
      <div class="pos-field md-span-2"><label for="ndName">Name *</label><input id="ndName" maxlength="120" placeholder="e.g. Bismik Medical Agencies"></div>
      <div class="pos-field"><label for="ndPhone">Phone</label><input id="ndPhone" maxlength="40"></div>
      <div class="pos-field"><label for="ndGst">GSTIN</label><input id="ndGst" maxlength="15" placeholder="32AACFB8381R1ZZ"></div>
      <div class="pos-field"><label for="ndDl">Drug licence no.</label><input id="ndDl" maxlength="120" placeholder="WLF20B2023KL001290"></div>
      <div class="pos-field"><label for="ndContact">Contact person</label><input id="ndContact" maxlength="80"></div>
      <div class="pos-field md-span-2"><label for="ndAddr">Address</label><input id="ndAddr" maxlength="300"></div>
    </div><p class="pos-form-msg" id="ndMsg"></p>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="ndSave">${I.plusC}<span>Add distributor</span></button></div>`);
  $('ndName').focus();
  $('ndSave').onclick = async () => {
    const name = $('ndName').value.trim(), gst = $('ndGst').value.trim().toUpperCase();
    if (name.length < 2) return ($('ndMsg').textContent = 'Enter the distributor name.');
    if (gst && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gst)) return ($('ndMsg').textContent = 'GSTIN should be 15 characters, e.g. 32AACFB8381R1ZZ.');
    if (allDists.some(x => x.name.trim().toLowerCase() === name.toLowerCase())) return ($('ndMsg').textContent = 'A distributor with this name already exists.');
    $('ndSave').disabled = true;
    const row = { branch_id: prof.branch_id, name, phone: $('ndPhone').value.trim() || null, gstin: gst || null, drug_licence: $('ndDl').value.trim() || null, contact_person: $('ndContact').value.trim() || null, address: $('ndAddr').value.trim() || null };
    const { data, error } = await sb.from('distributors').insert(row).select('id,name,phone,gstin,active,drug_licence,address,contact_person').single();
    $('ndSave').disabled = false;
    if (error) return ($('ndMsg').textContent = friendly(error));
    allDists.push(data); dists.push(data);
    $('supplier').insertAdjacentHTML('beforeend', `<option value="${esc(data.id)}">${esc(data.name)}</option>`);
    $('fDist').insertAdjacentHTML('beforeend', `<option value="${esc(data.id)}">${esc(data.name)}</option>`);
    $('supplier').value = data.id; renderSupplier(); checkDuplicate();
    $('puDlg').close();
    $('invoiceNo').focus();
    setMsg(`Distributor “${data.name}” added.`);
  };
};
$('creditDays').onclick = e => {
  const b = e.target.closest('[data-days]'); if (!b) return;
  const d = Number(b.dataset.days);
  $('dueDate').value = addDays($('invoiceDate').value || today(), d);
  $('paymentTerms').value = d ? 'credit' : 'cash';
};
$('autoRound').onclick = () => {
  $('roundOff').value = 0;
  const t = calcTotals().total;
  $('roundOff').value = r2(Math.round(t) - t).toFixed(2);
  calcTotals();
};
$('payFull')?.addEventListener('click', () => { $('amountPaid').value = calcTotals().total.toFixed(2); });
$('invoiceTaxMode').addEventListener('change', () => $('itemTable').classList.toggle('pb-mixed', $('invoiceTaxMode').value === 'mixed'));
$('addItem2').onclick = () => makeItemRow({ tax_rate: lastGst() }, true);
$('addFive').onclick = () => { const g = lastGst(); const first = makeItemRow({ tax_rate: g }); for (let i = 0; i < 4; i++) makeItemRow({ tax_rate: g }); first.querySelector('.med-name').focus(); };
const lastGst = () => { const rows = [...$('itemRows').children]; return rows.length ? num(rows[rows.length - 1].querySelector('.gst').value) : 5; };
// Enter moves to the next box; Enter on the last box of the last line adds a new line.
$('itemRows').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('input, select')) return;
  e.preventDefault();
  const tr = e.target.closest('tr');
  const fields = [...tr.querySelectorAll('input, select')].filter(x => x.offsetParent !== null && !x.disabled);
  const i = fields.indexOf(e.target);
  if (e.target.matches('.med-name')) resolveMedicine(tr);
  if (i < fields.length - 1) { fields[i + 1].focus(); fields[i + 1].select?.(); return; }
  const next = tr.nextElementSibling;
  if (next) next.querySelector('.med-name').focus();
  else makeItemRow({ tax_rate: num(tr.querySelector('.gst').value), pack: num(tr.querySelector('.pack').value) || 1 }, true);
});
$('itemRows').addEventListener('change', e => {
  if (e.target.matches('.expiry')) { const iso = parseExp(e.target.value); if (iso) e.target.value = expShow(iso); calcTotals(); }
});
$('itemRows').addEventListener('click', e => {
  const d = e.target.closest('.dup-line'); if (!d) return;
  const tr = d.closest('tr');
  const n = makeItemRow({ medicine_id: tr.dataset.medicineId, medicine_label: tr.querySelector('.med-name').value, hsn: tr.querySelector('.hsn').value, pack: num(tr.querySelector('.pack').value), mrp: num(tr.querySelector('.mrp').value), rate: num(tr.querySelector('.rate').value), tax_rate: num(tr.querySelector('.gst').value), rate_mode: tr.querySelector('.rate-mode').value, qty: 1 });
  tr.after(n); calcTotals(); n.querySelector('.batch').focus();
});

function setMsg(message, type = 'info') {
  const el = $('formError');
  el.className = type === 'error' ? 'purchase-error' : type === 'warning' ? 'purchase-warning' : 'purchase-muted';
  el.textContent = message;
}

// Duplicate invoice warning as soon as supplier + number are known.
async function checkDuplicate() {
  const dist = $('supplier').value, no = $('invoiceNo').value.trim();
  $('dupWarning').hidden = true;
  if (!dist || !no) return false;
  const { data } = await sb.rpc('purchase_invoice_exists', { p_distributor: dist, p_invoice_no: no });
  if (data) {
    $('dupWarning').textContent = `Invoice ${no} from this supplier is already posted. Check the existing purchase before entering it again.`;
    $('dupWarning').hidden = false;
    return true;
  }
  return false;
}
$('supplier').addEventListener('change', checkDuplicate);
$('invoiceNo').addEventListener('change', checkDuplicate);

// ---------------------------------------------------------------------------
// Form state (draft payload)
// ---------------------------------------------------------------------------
function collectPayload() {
  return {
    distributor_id: $('supplier').value || null,
    invoice_no: $('invoiceNo').value.trim(),
    invoice_date: $('invoiceDate').value || null,
    due_date: $('dueDate').value || null,
    order_no: $('orderNo').value.trim(),
    order_date: $('orderDate').value || null,
    payment_terms: $('paymentTerms').value,
    tax_mode: $('invoiceTaxMode').value,
    notes: $('notes').value.trim(),
    discount: num($('invoiceDiscount').value),
    freight: num($('freight').value),
    round_off: num($('roundOff').value),
    printed_total: $('printedTotal').value === '' ? null : num($('printedTotal').value),
    items: [...$('itemRows').children].map(tr => ({
      medicine_id: tr.dataset.medicineId || null,
      medicine_label: tr.querySelector('.med-name').value.trim(),
      hsn: tr.querySelector('.hsn').value.trim(),
      pack: num(tr.querySelector('.pack').value) || 1,
      batch_no: tr.querySelector('.batch').value.trim(),
      expiry: parseExp(tr.querySelector('.expiry').value) || tr.querySelector('.expiry').value,
      qty: num(tr.querySelector('.qty').value),
      free_qty: num(tr.querySelector('.free').value),
      mrp: num(tr.querySelector('.mrp').value),
      rate: num(tr.querySelector('.rate').value),
      rate_mode: tr.querySelector('.rate-mode').value,
      discount: num(tr.querySelector('.line-discount').value),
      sch_disc: num(tr.querySelector('.line-discount').value),
      disc_pct: num(tr.querySelector('.disc-pct').value),
      tax_rate: num(tr.querySelector('.gst').value),
      gst_touched: !!tr.dataset.gstTouched
    }))
  };
}

function fillForm(p = {}) {
  $('purchaseForm').reset();
  $('itemRows').innerHTML = '';
  $('supplier').value = p.distributor_id || '';
  $('invoiceNo').value = p.invoice_no || '';
  $('invoiceDate').value = p.invoice_date || today();
  $('dueDate').value = p.due_date || '';
  $('orderNo').value = p.order_no || '';
  $('orderDate').value = p.order_date || '';
  $('paymentTerms').value = p.payment_terms || 'credit';
  $('invoiceTaxMode').value = p.tax_mode || 'exclusive';
  $('notes').value = p.notes || '';
  $('invoiceDiscount').value = p.discount ?? 0;
  $('freight').value = p.freight ?? 0;
  $('roundOff').value = p.round_off ?? 0;
  $('printedTotal').value = p.printed_total ?? '';
  if ($('amountPaid')) $('amountPaid').value = 0;
  attachments = [];
  renderFiles();
  $('dupWarning').hidden = true;
  setMsg('');
  (p.items?.length ? p.items : [{}]).forEach(it => makeItemRow(it));
  $('itemTable').classList.toggle('pb-mixed', $('invoiceTaxMode').value === 'mixed');
  renderSupplier();
  calcTotals();
}

function openForm(draft = null, order = null) {
  if (!canWrite) return;
  currentDraftId = draft?.id || null;
  currentOrderId = order?.id || null;
  $('formTitle').textContent = order ? `Receive ${order.po_no}` : draft ? `Draft — ${draft.supplier_invoice_no || 'unnumbered'}` : 'New purchase';
  $('deleteDraft').hidden = !draft?.id;
  $('saveDraft').hidden = !!order;
  fillForm(draft?.payload || {});
  $('orderBanner').hidden = !order;
  if (order) {
    $('orderBanner').innerHTML = `${I.orderDoc}<span>Receiving purchase order <b>${esc(order.po_no)}</b> from <b>${esc(order.distributor)}</b>. Lines are pre-filled with the pending quantities — enter the supplier invoice number, batch, expiry, MRP and rates from the bill. Remove lines that did not arrive; the order stays “Partially Received” until everything is in.</span>`;
    $('supplier').value = order.distributor_id;
    renderSupplier();
  }
  $('pbStatus').textContent = order ? `Order ${order.po_no}` : draft?.id ? 'Draft' : '';
  $('purchaseDialog').showModal();
  if (draft?.id) checkDuplicate();
  setTimeout(() => (order ? $('invoiceNo') : $('supplier').value ? $('invoiceNo') : $('supplier')).focus(), 50);
}
$('newPurchase').onclick = () => openForm();
$('closePurchase').onclick = () => $('purchaseDialog').close();

$('saveDraft').onclick = async () => {
  const payload = collectPayload();
  if (!payload.distributor_id && !payload.invoice_no && !payload.items.some(i => i.medicine_label)) {
    return setMsg('Enter at least a supplier, invoice number or one medicine before saving a draft.', 'warning');
  }
  $('saveDraft').disabled = true;
  const { data, error } = await sb.rpc('purchase_draft_save', { p_id: currentDraftId, p_payload: payload });
  $('saveDraft').disabled = false;
  if (error) return setMsg(friendly(error), 'error');
  currentDraftId = data;
  $('deleteDraft').hidden = false;
  setMsg(`Draft saved at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}. Stock has not changed.${attachments.length ? ' Attached files are kept only until you close this form.' : ''}`);
  await loadDrafts();
};
$('deleteDraft').onclick = async () => {
  if (!currentDraftId || !confirm('Delete this draft? This cannot be undone.')) return;
  const { error } = await sb.rpc('purchase_draft_delete', { p_id: currentDraftId });
  if (error) return setMsg(friendly(error), 'error');
  currentDraftId = null;
  $('purchaseDialog').close();
  await loadDrafts();
};

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
const ALLOWED = /^(application\/pdf|image\/(jpeg|png|webp))$/;
function renderFiles() {
  $('attachmentList').innerHTML = attachments.length
    ? attachments.map((f, i) => `<div class="purchase-file"><span>${esc(f.name)} <small class="purchase-muted">(${Math.round(f.size / 1024)} KB)</small></span><span><button class="purchase-btn preview-file" data-index="${i}" type="button">View</button> <button class="purchase-btn danger remove-file" data-index="${i}" type="button">Remove</button></span></div>`).join('')
    : '<span class="purchase-muted">No bill files selected.</span>';
}
function addFiles(list) {
  for (const f of list) {
    if (!ALLOWED.test(f.type)) { setMsg(`Unsupported file: ${f.name}. Use PDF, JPG, PNG or WEBP.`, 'error'); continue; }
    if (f.size > 15 * 1024 * 1024) { setMsg(`${f.name} is larger than 15 MB.`, 'error'); continue; }
    attachments.push(f);
  }
  renderFiles();
}
$('billFiles').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('cameraFiles').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('attachmentList').onclick = e => {
  const i = Number(e.target.dataset.index);
  if (e.target.classList.contains('remove-file')) { attachments.splice(i, 1); renderFiles(); }
  if (e.target.classList.contains('preview-file')) showFile(URL.createObjectURL(attachments[i]), attachments[i].type, true);
};
function showFile(url, type, revoke) {
  $('filePreview').innerHTML = type === 'application/pdf'
    ? `<iframe title="Bill PDF" src="${esc(url)}" style="width:100%;height:70vh;border:0"></iframe>`
    : `<img class="purchase-preview" alt="Bill preview" src="${esc(url)}">`;
  $('fileDialog').dataset.url = revoke ? url : '';
  $('fileDialog').showModal();
}
$('closeFile').onclick = () => {
  $('fileDialog').close();
  if ($('fileDialog').dataset.url) URL.revokeObjectURL($('fileDialog').dataset.url);
  $('filePreview').innerHTML = '';
};

async function sha256(file) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function uploadAttachments(invoiceId, distributorId, invoiceDate) {
  const failed = [];
  for (const f of attachments) {
    const path = `${distributorId}/${crypto.randomUUID()}.${EXT[f.type]}`;
    const up = await sb.storage.from('purchase-documents').upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { failed.push(`${f.name}: ${friendly(up.error)}`); continue; }
    const reg = await sb.rpc('register_purchase_document', {
      p_path: path, p_name: f.name.slice(0, 200), p_mime: f.type, p_size: f.size, p_sha256: await sha256(f),
      p_distributor: distributorId, p_purchase: invoiceId, p_doc_date: invoiceDate, p_type: 'purchase_bill', p_notes: null
    });
    if (reg.error) { failed.push(`${f.name}: ${friendly(reg.error)}`); await sb.storage.from('purchase-documents').remove([path]); }
  }
  return failed;
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
$('excelUploadBtn').onclick = () => $('excelFile').click();
$('excelTemplate').onclick = () => {
  if (!window.XLSX) return alert('Excel library is not available. Please check your internet connection.');
  const headers = ['sl no', 'Item Name', 'HSN', 'Pack', 'Batch', 'Expiry', 'Qty', 'Free', 'MRP', 'Trade Price', 'Sch Disc', 'Disc %', 'GST %', 'Rate mode'];
  const ws = XLSX.utils.aoa_to_sheet([headers, [1, 'Thyronorm 50 Tab', '30049082', 120, 'TMD26267', '06/28', 2, 0, 132.87, 101.23, 0, 3, 5, 'exclusive'], [2, 'Pantop 40mg Tab', '30049039', 15, 'SPH261247', '01/29', 4, 0, 174.45, 132.91, 0, 3, 5, 'exclusive']]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Medicine Items');
  XLSX.writeFile(wb, 'PALLIKKAL_MEDICALS_Purchase_Medicine_Template.xlsx');
};
$('excelFile').onchange = async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    if (!window.XLSX) throw new Error('Excel reader unavailable. Check your internet connection.');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const imported = [];
    for (const r of rows) {
      const pick = (...keys) => { for (const k of keys) { const f = Object.keys(r).find(x => x.trim().toLowerCase() === k.toLowerCase()); if (f) return r[f]; } return ''; };
      const raw = pick('Expiry', 'Exp', 'Exp Date', 'Exp. Date');
      let exp = '';
      if (raw instanceof Date) exp = raw.toISOString().slice(0, 10);
      else if (typeof raw === 'number' && raw > 20000) { const d = XLSX.SSF.parse_date_code(raw); if (d) exp = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
      else if (raw) exp = parseExp(raw) || String(raw).trim();
      const label = String(pick('Item Name', 'Medicine', 'Description')).trim();
      if (!label && !pick('Batch')) continue;
      const gst = pick('GST %', 'GST', 'Tax %');
      imported.push({
        medicine_label: label, hsn: pick('HSN', 'HSN Code'), batch_no: String(pick('Batch', 'batch')).trim(),
        pack: packOf(pick('Pack factor', 'Pack')), qty: Number(pick('Qty (packs)', 'Qty (strips)', 'Qty', 'Quantity', 'Billed')) || 1,
        free_qty: Number(pick('Free (packs)', 'Free (strips)', 'Free Qty', 'Free')) || 0, expiry: exp,
        mrp: Number(pick('MRP per pack', 'MRP', 'M.R.P')) || 0, rate: Number(pick('Rate per pack', 'Rate', 'Trade Price', 'Trade Rate', 'PTR')) || 0,
        sch_disc: Number(pick('Sch Disc', 'Scheme Discount', 'Sch. Disc')) || 0, disc_pct: Number(pick('Disc %', 'Discount %', 'CD %')) || 0,
        rate_mode: String(pick('Rate mode', 'Rate Mode') || $('invoiceTaxMode').value || 'exclusive').toLowerCase() === 'inclusive' ? 'inclusive' : 'exclusive',
        discount: Number(pick('Discount', 'Discount Amount')) || 0, tax_rate: gst === '' ? 5 : Number(gst), gst_touched: gst !== ''
      });
    }
    if (!imported.length) throw new Error('No medicine rows found. Check the template headings.');
    if (!$('purchaseDialog').open) openForm();
    const blank = [...$('itemRows').children].filter(tr => !tr.querySelector('.med-name').value.trim());
    blank.forEach(tr => tr.remove());
    imported.forEach(it => { if (!it.sch_disc && it.discount) it.sch_disc = it.discount; makeItemRow(it); });
    const unknown = [...$('itemRows').children].filter(tr => !tr.dataset.medicineId).length;
    setMsg(`${imported.length} medicine row(s) imported.${unknown ? ` ${unknown} row(s) are checking the medicine master — use “Create” on any row that stays red.` : ''} Review every row before posting.`);
  } catch (err) {
    setMsg(err.message || String(err), 'error');
  } finally {
    e.target.value = '';
  }
};

// ---------------------------------------------------------------------------
// Validate → confirm → post
// ---------------------------------------------------------------------------
function validateForm() {
  if (!$('supplier').value) return 'Select a supplier.';
  if (!$('invoiceNo').value.trim()) return 'Enter the supplier invoice number.';
  if (!$('invoiceDate').value) return 'Enter the invoice date.';
  if ($('invoiceDate').value > today()) return 'Invoice date cannot be in the future.';
  const rows = [...$('itemRows').children];
  if (!rows.length) return 'Add at least one medicine item.';
  const seen = new Set();
  for (const [idx, tr] of rows.entries()) {
    const c = calcLine(tr);
    const n = idx + 1;
    if (!tr.dataset.medicineId) return `Row ${n}: choose a medicine from the list or create it with “+ Create”.`;
    const batch = tr.querySelector('.batch').value.trim();
    const expiry = expISO(tr);
    if (!batch || !tr.querySelector('.expiry').value.trim()) return `Row ${n}: enter batch number and expiry.`;
    if (!expiry) return `Row ${n}: expiry “${tr.querySelector('.expiry').value}” is not a date. Type it as MM/YY, e.g. 06/28.`;
    if (expiry <= today()) return `Row ${n}: batch ${batch} is expired.`;
    if (!(c.qty > 0) || !Number.isInteger(c.qty)) return `Row ${n}: quantity must be a whole number of packs above zero.`;
    if (c.free < 0 || !Number.isInteger(c.free)) return `Row ${n}: free quantity must be a whole number.`;
    if (!(c.pack >= 1)) return `Row ${n}: pack factor must be at least 1.`;
    if (c.gst < 0 || c.gst > 40) return `Row ${n}: GST must be between 0 and 40.`;
    if (c.discount > c.qty * c.rate) return `Row ${n}: discount exceeds the line amount.`;
    if (c.mrp > 0 && c.priceEx > c.mrp) return `Row ${n}: purchase rate per pack is above the MRP per pack. Check the values.`;
    const key = `${tr.dataset.medicineId}|${batch.toLowerCase()}`;
    if (seen.has(key)) return `Row ${n}: the same medicine and batch appear twice. Combine them into one row.`;
    seen.add(key);
  }
  const rnd = num($('roundOff').value);
  if (Math.abs(rnd) > 100) return 'Round off must be within ±100.';
  return '';
}

$('confirmPurchase').onclick = async () => {
  const err = validateForm();
  if (err) return setMsg(err, 'error');
  if (await checkDuplicate()) return setMsg('This supplier invoice is already posted.', 'error');
  const t = calcTotals();
  const paid = isAdmin ? num($('amountPaid').value) : 0;
  if (paid < 0 || paid > t.total + 0.005) return setMsg('Amount paid must be between 0 and the invoice total.', 'error');
  const rows = [...$('itemRows').children].map(tr => ({ name: tr.querySelector('.med-name').value, batch: tr.querySelector('.batch').value, exp: expISO(tr), c: calcLine(tr) }));
  const sup = allDists.find(d => d.id === $('supplier').value);
  $('confirmSummary').innerHTML = `<div class="pb-conf-head"><div><small>Supplier</small><b>${esc(sup?.name || '')}</b></div><div><small>Invoice</small><b>${esc($('invoiceNo').value.trim())}</b></div><div><small>Date</small><b>${esc(dmy($('invoiceDate').value))}</b></div><div><small>Items</small><b>${rows.length}</b></div></div>
    <div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="c-r">Qty + free</th><th class="c-r">Stock added</th>${isAdmin ? '<th class="c-r">Net</th>' : ''}</tr></thead><tbody>
    ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.batch)}</td><td>${esc(dmy(r.exp))}</td><td class="c-r">${r.c.qty}${r.c.free ? ` + ${r.c.free}` : ''}</td><td class="c-r">${r.c.stockUnits} units</td>${isAdmin ? `<td class="c-r">${fmt(r.c.total)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    <p><strong>Invoice total ${fmt(t.total)}</strong>${paid > 0 ? ` · paying ${fmt(paid)} now by ${esc($('paymentMode').value.toUpperCase())}` : ' · posted as payable'}${attachments.length ? ` · ${attachments.length} file(s) will be attached` : ''}</p>`;
  $('confirmDialog').showModal();
};
$('backToEdit').onclick = () => $('confirmDialog').close();

$('postNow').onclick = async () => {
  $('confirmDialog').close();
  $('postNow').disabled = true;
  setMsg('Posting purchase…');
  const header = {
    distributor_id: $('supplier').value, invoice_no: $('invoiceNo').value.trim(), invoice_date: $('invoiceDate').value,
    due_date: $('dueDate').value || null, order_no: $('orderNo').value.trim() || null, order_date: $('orderDate').value || null,
    payment_terms: $('paymentTerms').value, discount: num($('invoiceDiscount').value), freight: num($('freight').value),
    round_off: num($('roundOff').value), printed_total: $('printedTotal').value === '' ? null : num($('printedTotal').value),
    notes: $('notes').value.trim() || null
  };
  const items = [...$('itemRows').children].map(tr => {
    const c = calcLine(tr);
    return {
      medicine_id: tr.dataset.medicineId, batch_no: tr.querySelector('.batch').value.trim(), expiry: expISO(tr),
      qty: c.qty, free_qty: c.free, pack: c.pack, price: Math.round(c.priceEx * 10000) / 10000,
      discount: Math.round(c.discEx * 100) / 100, tax_rate: c.gst, mrp: c.mrp || null,
      hsn: tr.querySelector('.hsn').value.trim() || null, rate_mode: c.mode
    };
  });
  const payment = isAdmin && num($('amountPaid').value) > 0
    ? { amount: num($('amountPaid').value), method: $('paymentMode').value, reference: $('paymentRef').value.trim() || null } : null;
  const { data: invoiceId, error } = currentOrderId
    ? await sb.rpc('confirm_purchase_v3', { p_header: header, p_items: items, p_payment: payment, p_draft: currentDraftId, p_order: currentOrderId })
    : await sb.rpc('confirm_purchase_v2', { p_header: header, p_items: items, p_payment: payment, p_draft: currentDraftId });
  $('postNow').disabled = false;
  if (error) return setMsg(friendly(error), 'error');

  let note = 'Purchase posted and stock updated.';
  if (attachments.length) {
    setMsg('Purchase posted. Uploading bill files…');
    const failed = await uploadAttachments(invoiceId, header.distributor_id, header.invoice_date);
    note += failed.length ? ` ${attachments.length - failed.length} of ${attachments.length} file(s) attached. Not attached: ${failed.join('; ')}. Upload them from Documents.` : ` ${attachments.length} bill file(s) attached.`;
  }
  const receivedOrder = currentOrderId ? orderRows.find(o => o.id === currentOrderId) : null;
  currentDraftId = null;
  currentOrderId = null;
  $('purchaseDialog').close();
  await reloadAll();
  if (receivedOrder) { const o = orderRows.find(x => x.id === receivedOrder.id); note += ` Order ${receivedOrder.po_no} is now ${o?.status === 'received' ? 'fully received' : 'partially received'}.`; }
  flash(note, /Not attached/.test(note));
  openDetail(invoiceId);
};

// ---------------------------------------------------------------------------
// Page messages
// ---------------------------------------------------------------------------
let toastT;
function toast(m, bad = false) { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); }
function flash(message, warn) {
  const el = $('pageMsg');
  el.className = `md-msg purchase-flash ${warn ? 'purchase-warning' : 'purchase-notice'}`;
  el.textContent = message;
  toast(message, warn);
}
const dlg = html => { $('puPanel').innerHTML = html; if (!$('puDlg').open) $('puDlg').showModal(); };
$('puDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('puDlg')) $('puDlg').close(); });

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function loadPurchases() {
  const { data, error } = await sb.rpc('purchase_list_v2', { p_from: null, p_to: null, p_limit: 5000 });
  if (error) {
    // Migration 0024 not run yet: fall back to the original list (fewer columns).
    const old = await sb.rpc('purchase_list', { p_limit: 500 });
    if (old.error) { purchaseRows = []; renderAll(friendly(error)); return; }
    purchaseRows = (old.data || []).map(p => ({ ...p, line_count: null, pack_qty: 0, stock_units: 0, paid: null, returned: null, doc_count: null }));
    flash('Some purchase features need database migration 0024_purchases_management.sql. Run it once in Supabase.', true);
  } else purchaseRows = data || [];
  renderAll();
}
async function loadDrafts() {
  if (!canWrite) { draftRows = []; return; }
  const { data, error } = await sb.rpc('purchase_draft_list');
  draftRows = error ? [] : (data || []);
  if ($('draftBadge')) $('draftBadge').textContent = draftRows.length;
  renderList(); renderSummary(); notify();
}
async function loadOrders() {
  if (!canWrite) { orderRows = []; return; }
  const { data, error } = await sb.rpc('purchase_order_list', { p_limit: 1000 });
  orderRows = error ? [] : (data || []);
}
async function reloadAll() {
  await Promise.all([loadOrders(), loadDrafts()]);
  await loadPurchases();
}

// ---------------------------------------------------------------------------
// Unified list: bills, orders, drafts
// ---------------------------------------------------------------------------
const STATUS = {
  received: ['Received', 'in', I.check], partial: ['Partially Received', 'low', I.hour], ordered: ['Ordered', 'blue', I.orderDoc],
  cancelled: ['Cancelled', 'out', I.ban], closed: ['Closed', 'off', I.ban], draft: ['Draft', 'off', I.pencil]
};
const statusChip = s => { const [l, c, ic] = STATUS[s] || [s, 'off', '']; return `<span class="md-chip pur-chip ${c}">${ic}${esc(l)}</span>`; };
function entries() {
  const bills = purchaseRows.map(p => ({
    kind: 'bill', id: p.id, no: p.supplier_invoice_no, date: p.invoice_date, distId: p.distributor_id, dist: p.distributor,
    lines: p.line_count, packs: num(p.pack_qty), units: num(p.stock_units), amount: p.total, paid: p.paid, returned: p.returned,
    balance: p.total == null ? null : r2(num(p.total) - num(p.paid) - num(p.returned)), docs: p.doc_count, due: p.due_date,
    status: p.status === 'cancelled' ? 'cancelled' : 'received', orderNo: p.order_no, orderId: p.order_id, by: p.created_by_name
  }));
  const orders = orderRows.map(o => ({
    kind: 'order', id: o.id, no: o.po_no, date: o.order_date, distId: o.distributor_id, dist: o.distributor, lines: o.line_count,
    packs: num(o.ordered_qty), received: num(o.received_qty), amount: isAdmin ? o.est_value : null, status: o.status === 'cancelled' || o.status === 'closed' ? 'closed' : o.status,
    rawStatus: o.status, expected: o.expected_date, by: o.created_by_name, o
  }));
  const drafts = draftRows.map(d => ({
    kind: 'draft', id: d.id, no: d.supplier_invoice_no || 'Unnumbered draft', date: String(d.updated_at).slice(0, 10) ? new Date(d.updated_at).toLocaleDateString('en-CA', { timeZone: TZ }) : '', distId: d.payload?.distributor_id || null,
    dist: d.distributor || '—', lines: d.item_count, packs: 0, amount: null, status: 'draft', by: d.updated_by_name, d
  }));
  return { bills, orders, drafts };
}
function periodRange() {
  const t = today(), p = $('period').value;
  if (p === 'today') return [t, t];
  if (p === 'month') return [t.slice(0, 8) + '01', t];
  if (p === 'lastmonth') { const first = t.slice(0, 8) + '01'; const lastEnd = addDays(first, -1); return [lastEnd.slice(0, 8) + '01', lastEnd]; }
  if (p === 'year') return [t.slice(0, 5) + '01-01', t];
  if (p === 'all') return [null, null];
  if (p === 'custom') return [$('fromDate').value || null, $('toDate').value || null];
  return [addDays(t, -(Number(p) - 1)), t];
}
const filt = { min: '', max: '', unpaid: false, nodoc: false };
function matches(e) {
  const [from, to] = periodRange();
  if (from && e.date < from) return false;
  if (to && e.date > to) return false;
  if ($('fDist').value && e.distId !== $('fDist').value) return false;
  const q = $('searchPurchase').value.trim().toLowerCase();
  if (q) {
    const meds = e.kind === 'order' ? (e.o.items || []).map(i => i.name).join(' ') : e.kind === 'draft' ? (e.d.payload?.items || []).map(i => i.medicine_label).join(' ') : '';
    if (!`${e.no} ${e.dist} ${e.orderNo || ''} ${meds}`.toLowerCase().includes(q) && !(e.kind === 'bill' && medHits.has(e.id))) return false;
  }
  if (filt.min !== '' && !(num(e.amount) >= Number(filt.min))) return false;
  if (filt.max !== '' && !(e.amount != null && num(e.amount) <= Number(filt.max))) return false;
  if (filt.unpaid && !(e.kind === 'bill' && num(e.balance) > 0.005)) return false;
  if (filt.nodoc && !(e.kind === 'bill' && e.docs === 0)) return false;
  return true;
}
function visible() {
  const { bills, orders, drafts } = entries();
  const openOrders = orders.filter(o => o.status === 'ordered' || o.status === 'partial');
  const st = $('fStatus').value;
  const inPeriod = list => list.filter(matches);
  const counts = { received: inPeriod(bills).filter(b => b.status === 'received').length, ordered: inPeriod(openOrders).filter(o => o.status === 'ordered').length, partial: inPeriod(openOrders).filter(o => o.status === 'partial').length };
  counts.all = inPeriod(bills).length + counts.ordered + counts.partial;
  let list;
  const key = st || tab;
  if (key === 'drafts') list = inPeriod(drafts);
  else if (key === 'received') list = inPeriod(bills).filter(b => b.status === 'received');
  else if (key === 'ordered' || key === 'partial') list = inPeriod(openOrders).filter(o => o.status === key);
  else if (key === 'closed') list = inPeriod(orders).filter(o => o.status === 'closed' || o.rawStatus === 'received');
  else if (key === 'cancelled') list = inPeriod(bills).filter(b => b.status === 'cancelled');
  else list = [...inPeriod(bills), ...inPeriod(openOrders)];
  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.kind === 'order') - (a.kind === 'order'));
  return { list, counts };
}
function renderList(errorText) {
  const { list, counts } = visible();
  for (const k of ['all', 'received', 'ordered', 'partial']) $('t_' + k).textContent = counts[k];
  $('listTotal').textContent = `(${list.length})`;
  if (errorText) { $('purchaseRows').innerHTML = `<tr><td colspan="8" class="dl-empty">${esc(errorText)}</td></tr>`; return; }
  const per = Number($('perPage').value), pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(page, pages);
  const shown = list.slice((page - 1) * per, page * per);
  $('purchaseRows').innerHTML = shown.map((e, i) => {
    const amt = e.kind === 'draft' ? '—' : e.amount == null ? (e.kind === 'bill' ? '<span class="pur-muted" title="Amounts are visible to administrators">—</span>' : '—') : money2(e.amount);
    const due = e.kind === 'bill' && isAdmin && num(e.balance) > 0.005 && e.status === 'received' ? `<small class="pur-due ${e.due && e.due < today() ? 'over' : ''}">${e.due && e.due < today() ? 'Overdue' : 'Due'} ₹${money2(e.balance)}</small>` : e.kind === 'bill' && isAdmin && e.status === 'received' && num(e.amount) > 0 ? '<small class="pur-paid">Paid</small>' : '';
    const sub = e.kind === 'bill' ? [e.orderNo ? `<span class="pur-po">${esc(e.orderNo)}</span>` : '', e.docs ? `<span class="pur-clip" title="${e.docs} bill file(s) attached">${I.clip}</span>` : ''].join('') : e.kind === 'order' ? `<span class="pur-po">Purchase order</span>` : '<span class="pur-po">Not posted</span>';
    const itemsTxt = e.kind === 'order' && e.status === 'partial' ? `${count(e.received)}/${count(e.packs)}` : e.lines == null ? '—' : e.kind === 'bill' ? `<span title="${count(e.packs)} packs · ${count(e.units)} stock units">${e.lines}</span>` : e.lines;
    return `<tr data-kind="${e.kind}" data-id="${esc(e.id)}" class="k-${e.kind} s-${e.status}">
      <td class="c-no">${(page - 1) * per + i + 1}</td>
      <td class="c-inv"><b>${esc(e.no)}</b><span class="pur-sub">${sub}</span><small class="pur-m-date">${esc(dmy(e.date))}</small></td>
      <td class="c-dist">${esc(e.dist || '—')}<small class="pur-m-items">${e.lines ?? '—'} items</small></td>
      <td class="c-date">${esc(dmy(e.date))}</td>
      <td class="c-r c-items">${itemsTxt}</td>
      <td class="c-r c-amt"><b>${e.kind === 'draft' || e.amount == null ? amt : '₹' + amt}</b>${due}</td>
      <td class="c-st">${statusChip(e.status)}</td>
      <td class="c-act"><div class="pur-acts">${e.kind === 'draft' ? `<button type="button" class="pos-btn pos-btn-sm pur-resume" data-resume="${esc(e.id)}" aria-label="Continue draft ${esc(e.no)}">Continue</button>` : `<button type="button" class="dl-act pur-eye" data-view-row aria-label="View ${esc(e.no)}">${I.eye}</button>`}<div class="dl-pop-anchor"><button type="button" class="dl-act" data-menu aria-label="More actions for ${esc(e.no)}">${I.dots}</button></div></div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="dl-empty">${(st => st === 'drafts' || tab === 'drafts' ? (canWrite ? 'No drafts. Use “Save draft” in a purchase to finish it later.' : 'Drafts are available to purchase staff.') : purchaseRows.length || orderRows.length ? 'No purchases match these filters.' : 'No purchases yet. Use “New Purchase” to enter a supplier bill.')($('fStatus').value)}</td></tr>`;
  $('listCount').textContent = list.length ? `Showing ${(page - 1) * per + 1} – ${Math.min(page * per, list.length)} of ${count(list.length)} purchases` : '';
  $('pager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, k) => k + 1).filter(n => n <= 5 && page <= 3 || n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, k, arr) => `${k && n - arr[k - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
  $('filterDot').hidden = !(filt.min !== '' || filt.max !== '' || filt.unpaid || filt.nodoc || $('period').value === 'custom');
}
function renderAll(errorText) { renderKpis(); renderList(errorText); drawChart(); renderTop(); renderSummary(); notify(); }

// medicine search across bills (by name) — uses purchase_detail lazily is too heavy; match orders/drafts by
// their own lines, and bills through purchase items when the user is an admin (RLS allows admins to read them).
let medHits = new Set();
let medT;
async function medicineSearch() {
  const q = safeQ($('searchPurchase').value.trim());
  medHits = new Set();
  if (!isAdmin || q.length < 3) return;
  const { data: meds } = await sb.from('medicines').select('id').eq('branch_id', prof.branch_id).ilike('name', `%${q}%`).limit(50);
  if (!meds?.length) return;
  const { data } = await sb.from('purchase_items').select('invoice_id').in('medicine_id', meds.map(m => m.id)).limit(2000);
  medHits = new Set((data || []).map(x => x.invoice_id));
  renderList();
}

// ---------------------------------------------------------------------------
// KPIs, trend, top distributors, summary
// ---------------------------------------------------------------------------
const billsLive = () => purchaseRows.filter(p => p.status !== 'cancelled');
function monthWindow(offset) {
  const t = today(); const [y, m] = t.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const start = d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return [start, end];
}
function monthStats(offset, sameSpan = false) {
  let [s, e] = monthWindow(offset);
  if (sameSpan) { const dayN = Number(today().slice(8, 10)); const cut = addDays(s, dayN - 1); if (cut < e) e = cut; }
  const list = billsLive().filter(p => p.invoice_date >= s && p.invoice_date <= e);
  return { n: list.length, value: list.reduce((a, p) => a + num(p.total), 0), packs: list.reduce((a, p) => a + num(p.pack_qty), 0), dists: new Set(list.map(p => p.distributor_id)).size };
}
const trend = (now, before) => {
  if (!before) return now ? '<span class="dz-up">New</span> this month' : 'No purchases yet this month';
  const pct = (now - before) / before * 100;
  return `<span class="${pct >= 0 ? 'dz-up' : 'dz-down'}">${pct >= 0 ? I.up : I.down}${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span> vs. last month`;
};
function renderKpis() {
  const cur = monthStats(0), prev = monthStats(-1, true);
  if (isAdmin) { $('kTotal').textContent = rupees0(cur.value); $('kTotalNote').innerHTML = trend(cur.value, prev.value); }
  else { $('kTotal').textContent = `${count(cur.n)} bills`; $('kTotalNote').textContent = 'Amounts are visible to administrators'; }
  $('kOrders').textContent = count(cur.n);
  $('kOrdersNote').innerHTML = trend(cur.n, prev.n);
  $('kOrders').closest('.dz-kpi').title = 'Purchase bills received this month' + (orderRows.length ? `; ${orderRows.filter(o => ['ordered', 'partial'].includes(o.status)).length} order(s) still open` : '');
  $('kItems').textContent = count(cur.packs);
  $('kItemsNote').innerHTML = trend(cur.packs, prev.packs);
  $('kItems').closest('.dz-kpi').title = 'Packs received this month (paid + free)';
  $('kDists').textContent = count(dists.length);
  $('kDistsNote').textContent = `${cur.dists} supplied this month`;
}
function niceStep(v) {
  if (v <= 0) return 1;
  const raw = v * 1.08 / 6, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const axisVal = v => isAdmin ? (v >= 100000 ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : '₹' + new Intl.NumberFormat('en-IN').format(v)) : String(Math.round(v * 10) / 10);
function trendSeries() {
  const r = $('trendRange').value, t = today();
  const val = list => isAdmin ? list.reduce((a, p) => a + num(p.total), 0) : list.length;
  if (r === '12m') {
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const [s, e] = monthWindow(-i);
      const list = billsLive().filter(p => p.invoice_date >= s && p.invoice_date <= e);
      out.push({ label: new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), full: new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), v: val(list), n: list.length });
    }
    return out;
  }
  const n = Number(r), out = [];
  for (let i = n - 1; i >= 0; i--) { const d = addDays(t, -i); const list = billsLive().filter(p => p.invoice_date === d); out.push({ label: shortDay(d), full: dmy(d), v: val(list), n: list.length }); }
  return out;
}
function drawChart() {
  const el = $('chart');
  const s = trendSeries();
  const vals = s.map(x => x.v), N = s.length;
  const total = vals.reduce((a, b) => a + b, 0);
  $('chartSub').textContent = isAdmin ? `Total ${rupees0(total)} · ${s.reduce((a, x) => a + x.n, 0)} bills` : `${total} bills received`;
  const W = Math.max(280, el.clientWidth), H = el.clientHeight || 220;
  const padL = isAdmin ? 66 : 34, padR = 16, padT = 30, padB = 28, steps = 6;
  const tick = niceStep(Math.max(...vals, isAdmin ? 0 : 1)), max = tick * steps;
  const x = i => padL + (N === 1 ? 0 : i * (W - padL - padR) / (N - 1));
  const yv = v => padT + (H - padT - padB) * (1 - v / max);
  const pts = vals.map((v, i) => [x(i), yv(v)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18;
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${Math.min(H - padB, p1[1] + (p2[1] - p0[1]) * t)} ${p2[0] - (p3[0] - p1[0]) * t},${Math.min(H - padB, p2[1] - (p3[1] - p1[1]) * t)} ${p2[0]},${p2[1]}`;
  }
  const area = `${d} L${pts[N - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z`;
  const fit = Math.max(2, Math.floor((W - padL - padR) / 52)), every = Math.max(1, Math.ceil(N / fit));
  const grid = Array.from({ length: steps + 1 }, (_, i) => i * tick);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Purchase trend">
    <defs><linearGradient id="puArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fbf3a" stop-opacity=".35"/><stop offset="1" stop-color="#2fbf3a" stop-opacity=".04"/></linearGradient></defs>
    <g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${yv(v)}" y2="${yv(v)}"/>`).join('')}</g>
    <g class="dz-axis pur-axis">${grid.map(v => `<text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end">${axisVal(v)}</text>`).join('')}
      ${s.map((p, i) => (i % every === 0 && N - 1 - i >= every / 2) || i === N - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '').join('')}</g>
    <path d="${area}" fill="url(#puArea)"/><path class="dz-line" d="${d}"/>
    ${pts.map(([px, py], i) => `<circle class="dz-pt${i === N - 1 ? ' hot' : ''}" data-i="${i}" cx="${px}" cy="${py}" r="${N <= 31 || i === N - 1 ? (i === N - 1 ? 6 : 4.5) : 0}"/>`).join('')}
    ${pts.map(([px], i) => `<rect data-i="${i}" x="${px - (W - padL - padR) / N / 2}" y="${padT}" width="${(W - padL - padR) / N}" height="${H - padT - padB}" fill="transparent"/>`).join('')}
  </svg><div class="dz-tip" id="puTip"></div>`;
  const tip = $('puTip');
  const show = i => {
    const [px, py] = pts[i];
    tip.innerHTML = `${isAdmin ? rupees0(vals[i]) : `${vals[i]} bill${vals[i] === 1 ? '' : 's'}`}<small>${esc(s[i].full)}${isAdmin ? ` · ${s[i].n} bill${s[i].n === 1 ? '' : 's'}` : ''}</small>`;
    tip.style.left = `${Math.min(Math.max(px / W * 100, 14), 86)}%`; tip.style.top = `${(py - 12) / H * 100}%`;
    el.querySelectorAll('.dz-pt').forEach(c => c.classList.toggle('hot', +c.dataset.i === i));
  };
  show(N - 1);
  const sv = el.querySelector('svg');
  sv.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('mouseleave', () => show(N - 1));
  sv.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
}
function renderTop() {
  const [from, to] = periodRange();
  const list = billsLive().filter(p => (!from || p.invoice_date >= from) && (!to || p.invoice_date <= to));
  const m = new Map();
  for (const p of list) { const g = m.get(p.distributor_id) || { id: p.distributor_id, name: p.distributor, v: 0, n: 0, u: 0 }; g.v += num(p.total); g.n++; g.u += num(p.stock_units); m.set(p.distributor_id, g); }
  const top = [...m.values()].sort((a, b) => isAdmin ? b.v - a.v : b.n - a.n || b.u - a.u).slice(0, 5);
  $('topSub').textContent = `(${isAdmin ? 'by Purchase Value' : 'by Bills'})`;
  $('topSub').closest('h2').title = `${isAdmin ? 'By purchase value' : 'By number of bills'} · ${$('period').selectedOptions[0].text.replace('…', '')}`;
  $('topRows').innerHTML = top.map((g, i) => `<tr data-dist="${esc(g.id)}"><td><span class="pur-rank r${i + 1}">${i + 1}</span>${esc(g.name)}</td><td class="c-r">${isAdmin ? money2(g.v) : count(g.u)}</td><td class="c-r">${g.n}</td></tr>`).join('')
    || '<tr><td colspan="3" class="dl-empty">No purchases in this period.</td></tr>';
}
function renderSummary() {
  const cur = monthStats(0);
  const open = orderRows.filter(o => o.status === 'ordered' || o.status === 'partial');
  $('sumTiles').innerHTML = `
    <div class="g"><b>${isAdmin ? rupees0(cur.value) : count(cur.n)}</b><span>${isAdmin ? 'Total Purchases' : 'Purchase Bills'}</span></div>
    <div class="b"><b>${count(cur.n)}</b><span>Purchase Orders</span></div>
    <div class="a"><b>${count(cur.packs)}</b><span>Items Purchased</span></div>
    <div class="p"><b>${isAdmin ? rupees0(cur.n ? cur.value / cur.n : 0) : count(open.length)}</b><span>${isAdmin ? 'Avg. Order Value' : 'Open Orders'}</span></div>`;
  const live = billsLive();
  const payable = isAdmin ? live.reduce((a, p) => a + Math.max(0, num(p.total) - num(p.paid) - num(p.returned)), 0) : 0;
  const overdue = isAdmin ? live.filter(p => p.due_date && p.due_date < today() && num(p.total) - num(p.paid) - num(p.returned) > 0.005).length : 0;
  const parts = [
    isAdmin ? `<button type="button" data-sum="unpaid">${I.rupee}<span>Unpaid <b>${rupees0(payable)}</b>${overdue ? ` · <em>${overdue} overdue</em>` : ''}</span></button>` : '',
    canWrite ? `<button type="button" data-sum="ordered">${I.orderDoc}<span>Open orders <b>${open.length}</b></span></button>` : '',
    canWrite ? `<button type="button" data-sum="drafts">${I.pencil}<span>Drafts <b>${draftRows.length}</b></span></button>` : ''
  ].join('');
  $('sumMore').innerHTML = parts;
  $('sumMore').hidden = !parts;
}
function notify() {
  const items = [];
  if (isAdmin) {
    const od = billsLive().filter(p => p.due_date && p.due_date < today() && num(p.total) - num(p.paid) - num(p.returned) > 0.005);
    if (od.length) items.push({ tone: 'danger', title: `${od.length} supplier bill(s) overdue`, detail: od.slice(0, 3).map(p => `${p.supplier_invoice_no} · ${p.distributor}`).join(', '), href: 'purchases.html' });
    const soon = billsLive().filter(p => p.due_date && p.due_date >= today() && p.due_date <= addDays(today(), 7) && num(p.total) - num(p.paid) - num(p.returned) > 0.005);
    if (soon.length) items.push({ tone: 'warn', title: `${soon.length} supplier bill(s) due this week`, detail: soon.slice(0, 3).map(p => p.supplier_invoice_no).join(', '), href: 'purchases.html' });
  }
  const late = orderRows.filter(o => (o.status === 'ordered' || o.status === 'partial') && o.expected_date && o.expected_date < today());
  if (late.length) items.push({ tone: 'warn', title: `${late.length} purchase order(s) past the expected date`, detail: late.slice(0, 3).map(o => `${o.po_no} · ${o.distributor}`).join(', '), href: 'purchases.html' });
  if (draftRows.length) items.push({ tone: 'info', title: `${draftRows.length} purchase draft(s) not posted`, detail: 'Stock is added only after posting', href: 'purchases.html' });
  setNotifications(items);
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------
const findEntry = (kind, id) => { const e = entries(); return (kind === 'bill' ? e.bills : kind === 'order' ? e.orders : e.drafts).find(x => x.id === id); };
let menuEl = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
function menuHtml(e) {
  const b = (act, ic, label, extra = '') => `<button type="button" data-act="${act}" ${extra}>${ic}<span>${label}</span></button>`;
  const dist = allDists.find(d => d.id === e.distId);
  if (e.kind === 'bill') return [
    b('view', I.eye, 'View details'), b('print', I.print, 'Print'),
    canWrite ? b('attach', I.clip, 'Attach bill file') : '',
    isAdmin && num(e.balance) > 0.005 && e.status === 'received' ? b('pay', I.rupee, 'Record payment') : '',
    isAdmin && e.status === 'received' ? b('return', I.ret, 'Purchase return') : '',
    canWrite && dist?.active !== false ? b('neworder', I.orderDoc, 'New order to this distributor') : '',
    `<a href="distributors.html?q=${encodeURIComponent(e.dist || '')}">${I.dist}<span>Open distributor</span></a>`
  ].join('');
  if (e.kind === 'order') return [
    b('vieworder', I.eye, 'View order'),
    ['ordered', 'partial'].includes(e.rawStatus) && canWrite ? b('receive', I.receive, e.rawStatus === 'partial' ? 'Receive remaining stock' : 'Receive stock') : '',
    e.rawStatus === 'ordered' && !e.received && canWrite ? b('editorder', I.pencil, 'Edit order') : '',
    b('printorder', I.print, 'Print order'),
    dist?.phone ? b('shareorder', I.share, 'Send on WhatsApp') : '',
    ['ordered', 'partial'].includes(e.rawStatus) && canWrite ? b('cancelorder', I.ban, e.rawStatus === 'partial' ? 'Close order' : 'Cancel order', 'class="danger"') : ''
  ].join('');
  return [b('resume', I.pencil, 'Continue draft'), b('deldraft', I.trash, 'Delete draft', 'class="danger"')].join('');
}
$('purchaseRows').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-kind]');
  if (!tr) return;
  const entry = findEntry(tr.dataset.kind, tr.dataset.id);
  const m = e.target.closest('[data-menu]');
  if (m) {
    e.stopPropagation();
    if (menuEl && menuEl.parentElement === m.parentElement) return closeMenu();
    closeMenu();
    menuEl = document.createElement('div'); menuEl.className = 'dl-pop md-menu md-row-menu pur-row-menu'; menuEl.innerHTML = menuHtml(entry);
    m.parentElement.append(menuEl);
    return;
  }
  const act = e.target.closest('[data-act]');
  if (act) { e.stopPropagation(); closeMenu(); return rowAction(act.dataset.act, entry); }
  if (e.target.closest('[data-resume]')) return openForm(draftRows.find(d => d.id === tr.dataset.id));
  if (e.target.closest('a')) return;
  rowAction(entry.kind === 'bill' ? 'view' : entry.kind === 'order' ? 'vieworder' : 'resume', entry);
});
document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });

async function rowAction(act, e) {
  if (!e) return;
  if (act === 'view') return openDetail(e.id);
  if (act === 'print') return printBill(e.id);
  if (act === 'attach') { attachTarget = e; $('attachFile').click(); return; }
  if (act === 'pay') return openPayment(e);
  if (act === 'return') return openReturn(e.id);
  if (act === 'neworder') return openOrderForm(null, { distributor_id: e.distId });
  if (act === 'vieworder') return viewOrder(e.o);
  if (act === 'receive') return receiveOrder(e.o);
  if (act === 'editorder') return openOrderForm(e.o);
  if (act === 'printorder') return printOrder(e.o);
  if (act === 'shareorder') return shareOrder(e.o);
  if (act === 'cancelorder') return cancelOrder(e.o);
  if (act === 'resume') return openForm(e.d);
  if (act === 'deldraft') {
    if (!confirm(`Delete draft ${e.no}? This cannot be undone.`)) return;
    const { error } = await sb.rpc('purchase_draft_delete', { p_id: e.id });
    if (error) return toast(friendly(error), true);
    await loadDrafts(); toast('Draft deleted.');
  }
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------
let detailCache = null;
async function openDetail(id) {
  $('viewContent').innerHTML = '<p class="dl-empty">Loading purchase…</p>';
  $('viewTitle').textContent = 'Purchase invoice';
  if (!$('viewDialog').open) $('viewDialog').showModal();
  const { data, error } = await sb.rpc('purchase_detail', { p_invoice: id });
  if (error) { $('viewContent').innerHTML = `<div class="purchase-error">${esc(friendly(error))}</div>`; return; }
  detailCache = data;
  const i = data.invoice, costs = data.can_see_costs;
  const row = purchaseRows.find(p => p.id === id) || {};
  const returned = num(row.returned);
  const balance = costs ? r2(num(i.balance) - returned) : null;
  $('viewTitle').innerHTML = `Purchase ${esc(i.supplier_invoice_no)} ${statusChip(i.status === 'cancelled' ? 'cancelled' : 'received')}`;
  const detail = (label, value) => value == null || value === '' ? '' : `<div class="purchase-detail"><small>${label}</small><strong>${value}</strong></div>`;
  $('viewContent').innerHTML = `
    <div class="purchase-view-grid pur-view-grid">
      ${detail('Supplier', esc(i.distributor?.name))}${detail('Invoice number', esc(i.supplier_invoice_no))}${detail('Invoice date', esc(dmy(i.invoice_date)))}
      ${detail('Due date', i.due_date ? esc(dmy(i.due_date)) : '')}${detail('Order', esc([row.order_no || i.order_no, i.order_date ? dmy(i.order_date) : ''].filter(Boolean).join(' · ')))}${detail('Payment terms', esc(i.payment_terms))}
      ${detail('Supplier GSTIN', esc(i.distributor?.gstin))}${detail('Entered by', esc(i.created_by))}${detail('Entered at', esc(when(i.created_at)))}
      ${costs ? detail('Invoice total', fmt(i.total)) + detail('Paid', fmt(num(i.total) - num(i.balance))) + (returned ? detail('Returned to supplier', fmt(returned)) : '') + detail('Balance payable', `<span class="${balance > 0.005 ? 'pur-red' : 'pur-green'}">${fmt(Math.max(0, balance))}</span>`) : ''}
    </div>
    ${i.notes ? `<p class="purchase-muted">Note: ${esc(i.notes)}</p>` : ''}
    <h4>Medicines (${data.items.length})</h4>
    <div class="dl-table-wrap"><table class="dl-table md-plain pur-dtable"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="c-r">Qty</th><th class="c-r">Free</th><th class="c-r">Pack</th><th class="c-r">Stock units</th><th class="c-r">MRP/pack</th><th class="c-r">GST</th>${costs ? '<th class="c-r">Rate/pack (ex GST)</th><th class="c-r">Discount</th><th class="c-r">Net</th>' : ''}</tr></thead><tbody>
    ${data.items.map(x => `<tr><td>${esc(x.medicine)} ${esc(x.strength || '')}</td><td>${esc(x.batch_no)}</td><td>${esc(dmy(x.expiry))}</td><td class="c-r">${num(x.qty)}</td><td class="c-r">${num(x.free_qty)}</td><td class="c-r">${num(x.pack)}</td><td class="c-r">${num(x.stock_units)}</td><td class="c-r">${x.mrp == null ? '—' : fmt(x.mrp)}</td><td class="c-r">${num(x.tax_rate)}%</td>${costs ? `<td class="c-r">${fmt(x.unit_price)}</td><td class="c-r">${fmt(x.line_discount)}</td><td class="c-r">${fmt(x.line_net)}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>
    ${costs ? `<div class="purchase-summary"><div class="purchase-summary-box">
      <div class="purchase-summary-line"><span>Taxable subtotal</span><strong>${fmt(i.subtotal)}</strong></div>
      <div class="purchase-summary-line"><span>GST</span><strong>${fmt(i.tax)}</strong></div>
      <div class="purchase-summary-line"><span>Invoice discount</span><strong>${fmt(i.discount)}</strong></div>
      <div class="purchase-summary-line"><span>Freight</span><strong>${fmt(i.freight)}</strong></div>
      <div class="purchase-summary-line"><span>Round off</span><strong>${fmt(i.round_off)}</strong></div>
      <div class="purchase-summary-line total"><span>Total</span><strong>${fmt(i.total)}</strong></div></div></div>
      <h4>Payments</h4>${data.payments.length ? `<div class="pur-paylist">${data.payments.map(p => `<div><b>${esc(p.payment_no)}</b><span>${fmt(p.amount)} by ${esc(String(p.method).toUpperCase())}${p.reference ? ' · ' + esc(p.reference) : ''}</span><small>${esc(when(p.created_at))}${p.status !== 'posted' ? ' · ' + esc(p.status) : ''}</small></div>`).join('')}</div>` : '<p class="purchase-muted">No payments recorded yet.</p>'}` : ''}
    <h4>Bill documents</h4>
    ${data.documents.length ? `<div class="purchase-file-list">${data.documents.map(d => `<div class="purchase-file"><span>${I.clip} ${esc(d.file_name)}</span><button class="pos-btn pos-btn-sm" type="button" data-open="${esc(d.path)}" data-mime="${esc(d.mime)}">Open</button></div>`).join('')}</div>` : '<p class="purchase-muted">No bill files attached yet.</p>'}
    <div class="pos-dialog-foot md-foot-left pur-view-acts">
      <button type="button" class="pos-btn pos-btn-sm" data-vact="print">${I.print}<span>Print</span></button>
      ${canWrite ? `<button type="button" class="pos-btn pos-btn-sm" data-vact="attach">${I.clip}<span>Attach bill file</span></button>` : ''}
      ${costs && balance > 0.005 && i.status !== 'cancelled' ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-vact="pay">${I.rupee}<span>Record payment</span></button>` : ''}
      ${costs && i.status !== 'cancelled' ? `<button type="button" class="pos-btn pos-btn-sm" data-vact="return">${I.ret}<span>Purchase return</span></button>` : ''}
    </div>`;
  $('viewContent').dataset.id = id;
}
$('viewContent').onclick = async e => {
  const b = e.target.closest('[data-open]');
  if (b) {
    const { data, error } = await sb.storage.from('purchase-documents').createSignedUrl(b.dataset.open, 300);
    if (error) return toast(friendly(error), true);
    return showFile(data.signedUrl, b.dataset.mime, false);
  }
  const v = e.target.closest('[data-vact]');
  if (!v) return;
  const id = $('viewContent').dataset.id, entry = findEntry('bill', id) || { id, kind: 'bill' };
  if (v.dataset.vact === 'print') return printBill(id);
  if (v.dataset.vact === 'attach') { attachTarget = entry; $('attachFile').click(); return; }
  $('viewDialog').close();
  if (v.dataset.vact === 'pay') return openPayment(entry);
  if (v.dataset.vact === 'return') return openReturn(id);
};
$('closeView').onclick = () => $('viewDialog').close();

// ---------------------------------------------------------------------------
// Attach bill files to a posted purchase
// ---------------------------------------------------------------------------
let attachTarget = null;
$('attachFile').onchange = async ev => {
  const files = [...ev.target.files]; ev.target.value = '';
  if (!files.length || !attachTarget) return;
  const target = purchaseRows.find(p => p.id === attachTarget.id) || {};
  const bad = files.filter(f => !ALLOWED.test(f.type) || f.size > 15 * 1024 * 1024);
  if (bad.length) return toast(`Not attached: ${bad.map(f => f.name).join(', ')} (PDF, JPG, PNG or WEBP up to 15 MB).`, true);
  toast('Uploading bill file(s)…');
  const keep = attachments; attachments = files;
  const failed = await uploadAttachments(attachTarget.id, target.distributor_id || attachTarget.distId, target.invoice_date || today());
  attachments = keep;
  if (failed.length) toast(`Not attached: ${failed.join('; ')}`, true); else toast(`${files.length} bill file(s) attached to ${target.supplier_invoice_no || 'the purchase'}.`);
  await loadPurchases();
  if ($('viewDialog').open && $('viewContent').dataset.id === attachTarget.id) openDetail(attachTarget.id);
};

// ---------------------------------------------------------------------------
// Supplier payment (admins)
// ---------------------------------------------------------------------------
function openPayment(e) {
  const p = purchaseRows.find(x => x.id === e.id);
  if (!p) return;
  const bal = r2(num(p.total) - num(p.paid) - num(p.returned));
  dlg(`<h3>${I.rupee} Record payment · ${esc(p.supplier_invoice_no)}</h3>
    <p class="dl-muted">${esc(p.distributor)} · bill total ${fmt(p.total)} · paid ${fmt(p.paid)}${num(p.returned) ? ` · returned ${fmt(p.returned)}` : ''} · <b>balance ${fmt(bal)}</b></p>
    <div class="md-form-grid">
      <div class="pos-field"><label for="payAmt">Amount ₹</label><input id="payAmt" type="number" min="0.01" step=".01" value="${Math.max(0, bal).toFixed(2)}"></div>
      <div class="pos-field"><label for="payMode">Mode</label><select id="payMode"><option value="cash">Cash</option><option value="upi">UPI</option></select></div>
      <div class="pos-field"><label for="payRef">Reference</label><input id="payRef" maxlength="100" placeholder="UPI ref / cheque no."></div>
      <div class="pos-field"><label for="payNote">Note</label><input id="payNote" maxlength="200"></div>
    </div>
    <p class="pos-form-msg" id="payMsg"></p>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="paySave">${I.rupee}<span>Save payment</span></button></div>`);
  $('paySave').onclick = async () => {
    const amt = num($('payAmt').value);
    if (!(amt > 0)) return ($('payMsg').textContent = 'Enter an amount.');
    if (amt > bal + 0.005 && !confirm(`₹${money2(amt)} is more than the balance ${fmt(bal)}. The extra becomes a supplier advance. Continue?`)) return;
    $('paySave').disabled = true;
    const { error } = await sb.rpc('record_supplier_payment', { p_distributor: p.distributor_id, p_amount: amt, p_method: $('payMode').value, p_reference: $('payRef').value.trim() || null, p_note: $('payNote').value.trim() || null, p_purchase: p.id });
    $('paySave').disabled = false;
    if (error) return ($('payMsg').textContent = friendly(error));
    $('puDlg').close();
    await loadPurchases();
    flash(`Payment of ${fmt(amt)} recorded for ${p.supplier_invoice_no}.`);
  };
}

// ---------------------------------------------------------------------------
// Purchase return (admins; same server function as the Returns page)
// ---------------------------------------------------------------------------
async function openReturn(invoiceId = null) {
  if (!isAdmin) return toast('Purchase returns are recorded by administrators.', true);
  if (!invoiceId) {
    dlg(`<h3>${I.ret} Purchase return</h3><p class="dl-muted">Choose the supplier bill the goods came on.</p>
      <div class="pos-field"><label for="rtQ">Invoice no. or distributor</label><input id="rtQ" type="search" placeholder="Start typing…" autocomplete="off"></div>
      <div class="dl-pick" id="rtList"></div>`);
    const paint = () => {
      const q = $('rtQ').value.trim().toLowerCase();
      const list = billsLive().filter(p => !q || `${p.supplier_invoice_no} ${p.distributor}`.toLowerCase().includes(q)).slice(0, 40);
      $('rtList').innerHTML = list.map(p => `<button type="button" data-pick="${esc(p.id)}"><b>${esc(p.supplier_invoice_no)}</b><span>${esc(p.distributor)}</span><em>${fmt(p.total)}</em><small>${esc(dmy(p.invoice_date))} · ${p.line_count ?? '—'} items${num(p.returned) ? ` · returned ${fmt(p.returned)}` : ''}</small></button>`).join('') || '<p class="dl-empty">No bill matches.</p>';
    };
    $('rtQ').oninput = paint; paint(); $('rtQ').focus();
    $('rtList').onclick = ev => { const b = ev.target.closest('[data-pick]'); if (b) openReturn(b.dataset.pick); };
    return;
  }
  const p = purchaseRows.find(x => x.id === invoiceId) || {};
  dlg(`<h3>${I.ret} Return to supplier · ${esc(p.supplier_invoice_no || '')}</h3><div id="rtBody"><p class="dl-empty">Loading items…</p></div>`);
  const { data, error } = await sb.rpc('purchase_returnable', { p_invoice: invoiceId });
  if (error) { $('rtBody').innerHTML = `<p class="pos-form-msg">${esc(friendly(error))}</p>`; return; }
  $('rtBody').innerHTML = `<p class="dl-muted">${esc(p.distributor || '')} · ${esc(dmy(p.invoice_date))}. Enter quantity in the unit used on the bill (packs). Stock goes down and a return_out movement is recorded.</p>
    <div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Medicine</th><th>Batch</th><th class="c-r">Purchased</th><th class="c-r">Returned</th><th class="c-r">Remaining</th><th>Return qty</th><th class="c-r">Rate</th></tr></thead><tbody>
    ${(data || []).map(r => { const rem = Math.max(0, num(r.remaining_qty)); return `<tr><td>${esc(r.medicine_name)}</td><td>${esc(r.batch_no)}</td><td class="c-r">${count(r.purchased_qty)}</td><td class="c-r">${count(r.returned_qty)}</td><td class="c-r">${count(rem)}</td><td><input class="rt-qty" data-id="${esc(r.purchase_item_id)}" data-rate="${num(r.unit_price)}" data-tax="${num(r.tax_rate)}" type="number" min="0" max="${rem}" step="any" value="0" ${rem <= 0 ? 'disabled' : ''}></td><td class="c-r">${fmt(r.unit_price)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="dl-empty">No items on this bill.</td></tr>'}
    </tbody></table></div>
    <div class="pos-field"><label for="rtWhy">Reason *</label><input id="rtWhy" maxlength="500" placeholder="e.g. damaged in transit, short expiry, wrong item"></div>
    <p class="pur-rt-sum" id="rtSum">Return value: ₹0.00</p>
    <p class="pos-form-msg" id="rtMsg"></p>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="rtSave">${I.ret}<span>Record return</span></button></div>`;
  const sum = () => { const v = [...document.querySelectorAll('.rt-qty')].reduce((a, i) => a + num(i.value) * num(i.dataset.rate) * (1 + num(i.dataset.tax) / 100), 0); $('rtSum').textContent = `Return value (approx. incl. GST): ${fmt(v)}`; };
  $('rtBody').addEventListener('input', sum);
  $('rtSave').onclick = async () => {
    const items = [...document.querySelectorAll('.rt-qty')].map(i => ({ purchase_item_id: i.dataset.id, qty: Number(i.value), max: Number(i.max) })).filter(x => x.qty > 0);
    if (!items.length) return ($('rtMsg').textContent = 'Enter a return quantity for at least one item.');
    if (items.some(x => x.qty > x.max)) return ($('rtMsg').textContent = 'A return quantity is more than what remains.');
    if ($('rtWhy').value.trim().length < 3) return ($('rtMsg').textContent = 'A reason is required.');
    if (!confirm('Record this supplier return and reduce the selected batch stock?')) return;
    $('rtSave').disabled = true;
    const { error: e2 } = await sb.rpc('process_purchase_return', { p_invoice: invoiceId, p_items: items.map(({ purchase_item_id, qty }) => ({ purchase_item_id, qty })), p_reason: $('rtWhy').value.trim() });
    $('rtSave').disabled = false;
    if (e2) return ($('rtMsg').textContent = friendly(e2));
    $('puDlg').close();
    await loadPurchases();
    flash(`Purchase return recorded for ${p.supplier_invoice_no}. Stock has been reduced.`);
  };
}
$('returnBtn')?.addEventListener('click', () => openReturn());

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------
const ORDER_MEDS = new Map();
async function orderMedSearch(text) {
  const q = safeQ(text);
  if (q.length < 2) return [];
  const run = term => sb.from('medicines').select('id,name,strength,tax_rate,mrp,reorder_level').eq('branch_id', prof.branch_id).eq('active', true).or(`name.ilike.%${term}%,barcode.eq.${term}`).limit(15);
  let { data } = await run(q);
  // "Dolo 650 mg" (name + strength): retry with the first word.
  if (!(data || []).length && q.includes(' ')) ({ data } = await run(q.split(' ')[0]));
  const dl = $('orderMedList'); if (dl) dl.innerHTML = '';
  for (const m of data || []) { ORDER_MEDS.set(medLabel(m).toLowerCase(), m); if (dl) { const o = document.createElement('option'); o.value = medLabel(m); dl.append(o); } }
  return data || [];
}
function orderLine(seed = {}) {
  return `<tr data-med="${esc(seed.medicine_id || '')}">
    <td><input class="ol-med" list="orderMedList" placeholder="Search medicine" autocomplete="off" value="${esc(seed.label || '')}"><small class="ol-hint">${esc(seed.hint || '')}</small></td>
    <td><input class="ol-pack" type="number" min="1" step="1" value="${seed.pack ?? 1}"></td>
    <td><input class="ol-qty" type="number" min="1" step="1" value="${seed.qty ?? 1}"></td>
    <td><input class="ol-rate" type="number" min="0" step=".01" value="${seed.rate ?? ''}" placeholder="Optional"></td>
    <td class="c-r ol-val">—</td>
    <td><button type="button" class="dl-act ol-del" aria-label="Remove line">${I.xs}</button></td></tr>`;
}
function openOrderForm(order = null, preset = {}) {
  if (!canWrite) return;
  const d = order || {};
  dlg(`<h3>${I.orderDoc} ${order ? `Edit order ${esc(order.po_no)}` : 'New purchase order'}</h3>
    <p class="dl-muted">Order medicines from a distributor. Stock is added only when you receive the order as a supplier bill (batch, expiry and rates come from that bill).</p>
    <div class="pur-of-grid">
      <div class="pos-field pur-span2"><label for="ofDist">Distributor *</label><select id="ofDist"><option value="">Select distributor</option>${dists.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
      <div class="pos-field"><label for="ofDate">Order date</label><input id="ofDate" type="date" value="${esc(d.order_date || today())}"></div>
      <div class="pos-field"><label for="ofExp">Expected delivery</label><input id="ofExp" type="date" value="${esc(d.expected_date || '')}"></div>
      <div class="pos-field pur-span4"><label for="ofNotes">Notes</label><input id="ofNotes" maxlength="300" value="${esc(d.notes || '')}" placeholder="Optional note for the distributor"></div>
    </div>
    <datalist id="orderMedList"></datalist>
    <div class="pur-of-head"><h4>Medicines</h4><div><button type="button" class="pos-btn pos-btn-sm" id="ofLow">${I.box}<span>Add low-stock items</span></button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="ofAdd">${I.plusC}<span>Add line</span></button></div></div>
    <div class="dl-table-wrap"><table class="dl-table md-plain pur-of-table"><thead><tr><th>Medicine</th><th>Pack (units)</th><th>Qty (packs)</th><th>Rate / pack ₹</th><th class="c-r">Value</th><th></th></tr></thead><tbody id="ofRows"></tbody></table></div>
    <p class="pur-of-total" id="ofTotal"></p>
    <p class="pos-form-msg" id="ofMsg"></p>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="ofSave">${I.orderDoc}<span>${order ? 'Save order' : 'Place order'}</span></button></div>`);
  $('ofDist').value = d.distributor_id || preset.distributor_id || '';
  const rows = $('ofRows');
  const lines = (d.items || []).map(i => ({ medicine_id: i.medicine_id, label: `${i.name}${i.strength ? ' ' + i.strength : ''}`, pack: num(i.pack), qty: num(i.qty), rate: i.rate }));
  rows.innerHTML = (lines.length ? lines : [{}]).map(orderLine).join('');
  const totals = () => {
    let tot = 0, n = 0;
    rows.querySelectorAll('tr').forEach(tr => { const v = num(tr.querySelector('.ol-qty').value) * num(tr.querySelector('.ol-rate').value); tr.querySelector('.ol-val').textContent = tr.querySelector('.ol-rate').value === '' ? '—' : fmt(v); tot += v; if (tr.dataset.med) n++; });
    $('ofTotal').textContent = `${n} medicine(s) · estimated value ${fmt(tot)}`;
  };
  let t;
  rows.addEventListener('input', e => {
    if (e.target.matches('.ol-med')) { e.target.closest('tr').dataset.med = ''; clearTimeout(t); t = setTimeout(() => orderMedSearch(e.target.value), 220); }
    totals();
  });
  rows.addEventListener('change', async e => {
    if (!e.target.matches('.ol-med')) return;
    const tr = e.target.closest('tr'), label = e.target.value.trim().toLowerCase();
    let m = ORDER_MEDS.get(label);
    if (!m && label) { const found = await orderMedSearch(e.target.value); m = ORDER_MEDS.get(label) || (found.length === 1 ? found[0] : null); if (m) e.target.value = medLabel(m); }
    tr.dataset.med = m?.id || '';
    tr.classList.toggle('unknown', !m && !!label);
    tr.querySelector('.ol-hint').textContent = m ? '' : label ? 'Pick a medicine from the list (create new medicines in Medicines).' : '';
    totals();
  });
  rows.addEventListener('click', e => { if (e.target.closest('.ol-del')) { e.target.closest('tr').remove(); if (!rows.children.length) rows.insertAdjacentHTML('beforeend', orderLine()); totals(); } });
  $('ofAdd').onclick = () => { rows.insertAdjacentHTML('beforeend', orderLine()); rows.lastElementChild.querySelector('.ol-med').focus(); };
  $('ofLow').onclick = async () => {
    $('ofLow').disabled = true;
    const [mres, bres] = await Promise.all([
      sb.from('medicines').select('id,name,strength,reorder_level,active').eq('branch_id', prof.branch_id).eq('active', true).gt('reorder_level', 0).limit(2000),
      sb.from('medicine_batches').select('medicine_id,qty,expiry,quarantined,stock_status').eq('branch_id', prof.branch_id).gt('qty', 0).limit(10000)
    ]);
    $('ofLow').disabled = false;
    if (mres.error) return ($('ofMsg').textContent = friendly(mres.error));
    const sell = new Map();
    for (const b of bres.data || []) if (b.expiry > today() && !b.quarantined && (b.stock_status || 'active') === 'active') sell.set(b.medicine_id, (sell.get(b.medicine_id) || 0) + num(b.qty));
    const have = new Set([...rows.querySelectorAll('tr')].map(tr => tr.dataset.med).filter(Boolean));
    const low = (mres.data || []).filter(m => (sell.get(m.id) || 0) <= num(m.reorder_level) && !have.has(m.id));
    if (!low.length) return ($('ofMsg').textContent = 'No other medicine is at or below its reorder level.');
    [...rows.querySelectorAll('tr')].filter(tr => !tr.dataset.med && !tr.querySelector('.ol-med').value.trim()).forEach(tr => tr.remove());
    for (const m of low) { ORDER_MEDS.set(medLabel(m).toLowerCase(), m); rows.insertAdjacentHTML('beforeend', orderLine({ medicine_id: m.id, label: medLabel(m), pack: 1, qty: Math.max(1, Math.ceil(num(m.reorder_level) * 2 - (sell.get(m.id) || 0))), hint: `In stock ${count(sell.get(m.id) || 0)} · reorder at ${count(m.reorder_level)} (qty in units; set the pack)` })); }
    $('ofMsg').textContent = `${low.length} low-stock medicine(s) added. Check pack size and quantity.`;
    totals();
  };
  totals();
  $('ofSave').onclick = async () => {
    if (!$('ofDist').value) return ($('ofMsg').textContent = 'Select a distributor.');
    const trs = [...rows.querySelectorAll('tr')];
    const bad = trs.find(tr => tr.querySelector('.ol-med').value.trim() && !tr.dataset.med);
    if (bad) return ($('ofMsg').textContent = `Pick “${bad.querySelector('.ol-med').value}” from the medicine list.`);
    const items = trs.filter(tr => tr.dataset.med).map(tr => ({ medicine_id: tr.dataset.med, pack: Math.max(1, Math.floor(num(tr.querySelector('.ol-pack').value) || 1)), qty: num(tr.querySelector('.ol-qty').value), rate: tr.querySelector('.ol-rate').value === '' ? null : num(tr.querySelector('.ol-rate').value) }));
    if (!items.length) return ($('ofMsg').textContent = 'Add at least one medicine.');
    if (items.some(i => !(i.qty > 0))) return ($('ofMsg').textContent = 'Every quantity must be above zero.');
    const ids = items.map(i => i.medicine_id); if (new Set(ids).size !== ids.length) return ($('ofMsg').textContent = 'The same medicine is on two lines. Combine them.');
    $('ofSave').disabled = true;
    const { data, error } = await sb.rpc('purchase_order_save', { p_id: order?.id || null, p_header: { distributor_id: $('ofDist').value, order_date: $('ofDate').value, expected_date: $('ofExp').value || null, notes: $('ofNotes').value.trim() }, p_items: items });
    $('ofSave').disabled = false;
    if (error) return ($('ofMsg').textContent = /purchase_order_save|function/.test(error.message || '') ? 'Purchase orders need database migration 0024_purchases_management.sql.' : friendly(error));
    $('puDlg').close();
    await loadOrders(); renderAll();
    const o = orderRows.find(x => x.id === data);
    flash(`${order ? 'Order updated' : 'Purchase order placed'}: ${o?.po_no || ''} to ${o?.distributor || ''}.`);
    if (!order && o) viewOrder(o);
  };
}
function viewOrder(o) {
  const dist = allDists.find(d => d.id === o.distributor_id);
  const st = o.status === 'cancelled' || o.status === 'closed' ? 'closed' : o.status;
  dlg(`<h3>${I.orderDoc} ${esc(o.po_no)} ${statusChip(st)}</h3>
    <div class="delivery-detail-grid dl-detail-grid">
      <div><small>Distributor</small><b>${esc(o.distributor)}${dist?.phone ? ` · ${esc(dist.phone)}` : ''}</b></div>
      <div><small>Order date</small><b>${esc(dmy(o.order_date))}</b></div>
      <div><small>Expected delivery</small><b>${o.expected_date ? esc(dmy(o.expected_date)) : '—'}${o.expected_date && o.expected_date < today() && ['ordered', 'partial'].includes(o.status) ? ' <span class="pur-red">(late)</span>' : ''}</b></div>
      <div><small>Received</small><b>${count(o.received_qty)} of ${count(o.ordered_qty)} packs</b></div>
      ${isAdmin && o.est_value != null ? `<div><small>Estimated value</small><b>${fmt(o.est_value)}</b></div>` : ''}
      <div><small>Created by</small><b>${esc(o.created_by_name || '—')} · ${esc(when(o.created_at))}</b></div>
      ${o.notes ? `<div class="pur-span-all"><small>Notes</small><b>${esc(o.notes)}</b></div>` : ''}
      ${o.cancel_reason ? `<div class="pur-span-all"><small>${o.status === 'closed' ? 'Closed' : 'Cancelled'} because</small><b>${esc(o.cancel_reason)}</b></div>` : ''}
    </div>
    <h4>Medicines</h4>
    <div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Medicine</th><th class="c-r">Pack</th><th class="c-r">Ordered</th><th class="c-r">Received</th><th class="c-r">Pending</th><th class="c-r">Rate / pack</th></tr></thead><tbody>
      ${(o.items || []).map(i => `<tr><td>${esc(i.name)} ${esc(i.strength || '')}</td><td class="c-r">${count(i.pack)}</td><td class="c-r">${count(i.qty)}</td><td class="c-r">${count(i.received_qty)}</td><td class="c-r"><b class="${num(i.qty) - num(i.received_qty) > 0 ? 'pur-amber' : 'pur-green'}">${count(Math.max(0, num(i.qty) - num(i.received_qty)))}</b></td><td class="c-r">${i.rate == null ? '—' : fmt(i.rate)}</td></tr>`).join('')}
    </tbody></table></div>
    ${(o.bills || []).length ? `<h4>Received on bills</h4><div class="pur-bills">${o.bills.map(b => `<button type="button" class="pos-btn pos-btn-sm" data-bill="${esc(b.id)}">${I.doc}<span>${esc(b.invoice_no)} · ${esc(dmy(b.invoice_date))}</span></button>`).join('')}</div>` : ''}
    <div class="pos-dialog-foot md-foot-left inv-acts">
      ${['ordered', 'partial'].includes(o.status) && canWrite ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-oact="receive">${I.receive}<span>${o.status === 'partial' ? 'Receive remaining' : 'Receive stock'}</span></button>` : ''}
      ${o.status === 'ordered' && !num(o.received_qty) && canWrite ? `<button type="button" class="pos-btn pos-btn-sm" data-oact="edit">${I.pencil}<span>Edit</span></button>` : ''}
      <button type="button" class="pos-btn pos-btn-sm" data-oact="print">${I.print}<span>Print</span></button>
      ${dist?.phone ? `<button type="button" class="pos-btn pos-btn-sm" data-oact="share">${I.share}<span>WhatsApp</span></button>` : ''}
      ${['ordered', 'partial'].includes(o.status) && canWrite ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-red" data-oact="cancel">${I.ban}<span>${o.status === 'partial' ? 'Close order' : 'Cancel order'}</span></button>` : ''}
    </div>`);
  $('puPanel').onclick = e => {
    const b = e.target.closest('[data-bill]'); if (b) { $('puDlg').close(); return openDetail(b.dataset.bill); }
    const a = e.target.closest('[data-oact]'); if (!a) return;
    ({ receive: () => receiveOrder(o), edit: () => openOrderForm(o), print: () => printOrder(o), share: () => shareOrder(o), cancel: () => cancelOrder(o) })[a.dataset.oact]();
  };
}
function receiveOrder(o) {
  if ($('puDlg').open) $('puDlg').close();
  const items = (o.items || []).filter(i => num(i.qty) - num(i.received_qty) > 0).map(i => ({
    medicine_id: i.medicine_id, medicine_label: `${i.name}${i.strength ? ' ' + i.strength : ''}`, pack: num(i.pack) || 1,
    qty: num(i.qty) - num(i.received_qty), free_qty: 0, rate: i.rate ?? 0, tax_rate: i.tax_rate ?? 5, mrp: i.mrp ? r2(num(i.mrp) * (num(i.pack) || 1)) : 0, batch_no: '', expiry: ''
  }));
  items.forEach(i => medicineMap.set(i.medicine_label.toLowerCase(), { id: i.medicine_id, name: i.medicine_label, tax_rate: i.tax_rate }));
  openForm({ payload: { distributor_id: o.distributor_id, order_no: o.po_no, order_date: o.order_date, items } }, o);
}
async function cancelOrder(o) {
  const why = prompt(`${o.status === 'partial' ? 'Close' : 'Cancel'} order ${o.po_no}: reason?`);
  if (!why) return;
  const { data, error } = await sb.rpc('purchase_order_cancel', { p_id: o.id, p_reason: why });
  if (error) return toast(friendly(error), true);
  if ($('puDlg').open) $('puDlg').close();
  await loadOrders(); renderAll();
  flash(`Order ${o.po_no} ${data}.`);
}
function orderText(o) {
  return [`*Purchase Order ${o.po_no}*`, `PALLIKKAL PHARMACY`, `Date: ${dmy(o.order_date)}${o.expected_date ? ` · Needed by ${dmy(o.expected_date)}` : ''}`, '',
    ...(o.items || []).filter(i => num(i.qty) - num(i.received_qty) > 0).map((i, k) => `${k + 1}. ${i.name}${i.strength ? ' ' + i.strength : ''} — ${count(num(i.qty) - num(i.received_qty))} pack(s)${num(i.pack) > 1 ? ` of ${count(i.pack)}` : ''}`),
    o.notes ? `\nNote: ${o.notes}` : ''].join('\n');
}
function shareOrder(o) {
  const dist = allDists.find(d => d.id === o.distributor_id);
  const phone = String(dist?.phone || '').replace(/\D/g, '');
  if (!phone) return toast('This distributor has no phone number.', true);
  const a = document.createElement('a');
  a.href = `https://wa.me/${phone.length === 10 ? '91' + phone : phone}?text=${encodeURIComponent(orderText(o))}`; a.target = '_blank'; a.rel = 'noopener'; a.click();
}

// ---------------------------------------------------------------------------
// Printing (hidden frame, no pop-ups)
// ---------------------------------------------------------------------------
function printHtml(title, body) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(f);
  const doc = f.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:13px/1.45 Arial,sans-serif;color:#111;margin:24px} h1{font-size:20px;margin:0} h2{font-size:15px;margin:18px 0 6px}
    .top{display:flex;justify-content:space-between;border-bottom:2px solid #0f8f17;padding-bottom:10px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;margin-top:6px} th,td{border:1px solid #ccc;padding:5px 7px;text-align:left} th{background:#f2f5f2} .r{text-align:right}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px} .meta b{display:block} .tot{margin-top:10px;margin-left:auto;width:280px} .tot div{display:flex;justify-content:space-between}
    .sign{margin-top:48px;display:flex;justify-content:space-between}</style></head><body>${body}</body></html>`);
  doc.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => f.remove(), 60000); }, 250);
}
const shopHead = sub => `<div class="top"><div><h1>PALLIKKAL PHARMACY</h1><div>${esc(sub)}</div></div><div style="text-align:right">Printed ${esc(when(new Date()))}<br>${esc(prof.full_name || '')}</div></div>`;
async function printBill(id) {
  let data = detailCache?.invoice?.id === id ? detailCache : null;
  if (!data) { const r = await sb.rpc('purchase_detail', { p_invoice: id }); if (r.error) return toast(friendly(r.error), true); data = r.data; }
  const i = data.invoice, costs = data.can_see_costs;
  printHtml(`Purchase ${i.supplier_invoice_no}`, `${shopHead('Purchase / goods received note')}
    <div class="meta"><div>Supplier<b>${esc(i.distributor?.name)}</b></div><div>Invoice no.<b>${esc(i.supplier_invoice_no)}</b></div><div>Invoice date<b>${esc(dmy(i.invoice_date))}</b></div>
    <div>GSTIN<b>${esc(i.distributor?.gstin || '—')}</b></div><div>Due date<b>${esc(i.due_date ? dmy(i.due_date) : '—')}</b></div><div>Entered by<b>${esc(i.created_by || '—')}</b></div></div>
    <h2>Medicines</h2><table><thead><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="r">Qty</th><th class="r">Free</th><th class="r">Pack</th><th class="r">Units</th><th class="r">MRP/pack</th><th class="r">GST</th>${costs ? '<th class="r">Rate/pack</th><th class="r">Net</th>' : ''}</tr></thead><tbody>
    ${data.items.map((x, k) => `<tr><td>${k + 1}</td><td>${esc(x.medicine)} ${esc(x.strength || '')}</td><td>${esc(x.batch_no)}</td><td>${esc(dmy(x.expiry))}</td><td class="r">${num(x.qty)}</td><td class="r">${num(x.free_qty)}</td><td class="r">${num(x.pack)}</td><td class="r">${num(x.stock_units)}</td><td class="r">${x.mrp == null ? '—' : money2(x.mrp)}</td><td class="r">${num(x.tax_rate)}%</td>${costs ? `<td class="r">${money2(x.unit_price)}</td><td class="r">${money2(x.line_net)}</td>` : ''}</tr>`).join('')}</tbody></table>
    ${costs ? `<div class="tot"><div><span>Taxable</span><b>${fmt(i.subtotal)}</b></div><div><span>GST</span><b>${fmt(i.tax)}</b></div><div><span>Discount</span><b>${fmt(i.discount)}</b></div><div><span>Freight</span><b>${fmt(i.freight)}</b></div><div><span>Round off</span><b>${fmt(i.round_off)}</b></div><div style="border-top:1px solid #333;margin-top:4px;padding-top:4px"><span>Total</span><b>${fmt(i.total)}</b></div></div>` : ''}
    <div class="sign"><span>Checked by</span><span>Received by</span></div>`);
}
function printOrder(o) {
  const dist = allDists.find(d => d.id === o.distributor_id) || {};
  printHtml(`Purchase order ${o.po_no}`, `${shopHead('Purchase order')}
    <div class="meta"><div>Order no.<b>${esc(o.po_no)}</b></div><div>Order date<b>${esc(dmy(o.order_date))}</b></div><div>Needed by<b>${esc(o.expected_date ? dmy(o.expected_date) : '—')}</b></div>
    <div>To<b>${esc(o.distributor)}</b></div><div>Phone<b>${esc(dist.phone || '—')}</b></div><div>GSTIN<b>${esc(dist.gstin || '—')}</b></div></div>
    <h2>Please supply</h2><table><thead><tr><th>#</th><th>Medicine</th><th class="r">Pack</th><th class="r">Qty (packs)</th>${isAdmin ? '<th class="r">Rate / pack</th>' : ''}</tr></thead><tbody>
    ${(o.items || []).map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.name)} ${esc(i.strength || '')}</td><td class="r">${count(i.pack)}</td><td class="r">${count(i.qty)}</td>${isAdmin ? `<td class="r">${i.rate == null ? '—' : money2(i.rate)}</td>` : ''}</tr>`).join('')}</tbody></table>
    ${o.notes ? `<p><b>Note:</b> ${esc(o.notes)}</p>` : ''}<div class="sign"><span>Prepared by: ${esc(o.created_by_name || '')}</span><span>Authorised signature</span></div>`);
}

// ---------------------------------------------------------------------------
// Export / Import / new menu
// ---------------------------------------------------------------------------
$('exportBtn').onclick = () => {
  const { list } = visible();
  const rows = list.map(e => ({
    Type: e.kind === 'bill' ? 'Bill' : e.kind === 'order' ? 'Purchase order' : 'Draft', 'Invoice / order no.': e.no, Distributor: e.dist, Date: e.date,
    Items: e.lines ?? '', Packs: e.packs || '', ...(e.kind === 'bill' ? { 'Stock units': e.units } : { 'Stock units': '' }),
    ...(isAdmin ? { 'Amount (₹)': e.amount == null ? '' : r2(e.amount), 'Paid (₹)': e.kind === 'bill' ? r2(e.paid) : '', 'Returned (₹)': e.kind === 'bill' ? r2(e.returned) : '', 'Balance (₹)': e.kind === 'bill' ? Math.max(0, r2(e.balance)) : '' } : {}),
    Status: (STATUS[e.status] || [e.status])[0], 'Order no.': e.orderNo || '', 'Due date': e.due || '', 'Bill files': e.docs ?? '', 'Entered by': e.by || ''
  }));
  if (!rows.length) return toast('Nothing to export with these filters.', true);
  const name = `Pallikkal_Purchases_${today()}`;
  if (window.XLSX) {
    const ws = XLSX.utils.json_to_sheet(rows); ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(34, Math.max(10, k.length + 2)) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Purchases'); XLSX.writeFile(wb, name + '.xlsx');
  } else {
    const keys = Object.keys(rows[0]);
    const csv = [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
  }
  toast(`${rows.length} purchase(s) exported.`);
};
$('importBtn').onclick = () => {
  dlg(`<h3>${I.upload} Import</h3><p class="dl-muted">Bring a supplier bill in from Excel instead of typing every line.</p>
    <div class="inv-choices">
      ${canWrite ? `<button type="button" data-imp="bill">${I.upload}<span><b>Import bill items from Excel</b><small>Opens a new purchase and fills the medicine lines from your sheet (.xlsx, .xls, .csv)</small></span></button>` : ''}
      <button type="button" data-imp="template">${I.download}<span><b>Download the item template</b><small>Columns: item, HSN, pack, batch, expiry, qty, free, MRP, rate, rate mode, discount, GST</small></span></button>
      ${canWrite ? `<a href="documents.html">${I.clip}<span><b>Upload bill documents</b><small>Scanned bills and credit notes go to Documents</small></span></a>` : ''}
    </div>`);
  $('puPanel').querySelector('.inv-choices').onclick = e => {
    const b = e.target.closest('[data-imp]'); if (!b) return;
    $('puDlg').close();
    if (b.dataset.imp === 'template') return $('excelTemplate').click();
    openForm(); $('excelFile').click();
  };
};
const newMenu = $('newMenu');
$('newMenuBtn').onclick = e => { e.stopPropagation(); newMenu.hidden = !newMenu.hidden; $('newMenuBtn').setAttribute('aria-expanded', !newMenu.hidden); };
newMenu.onclick = e => {
  const b = e.target.closest('[data-new]'); if (!b) return;
  newMenu.hidden = true;
  if (b.dataset.new === 'bill') return openForm();
  if (b.dataset.new === 'order') return openOrderForm();
  setTab('drafts');
};
document.addEventListener('click', e => { if (!newMenu.hidden && !e.target.closest('.pur-split')) newMenu.hidden = true; });

// ---------------------------------------------------------------------------
// Filters, tabs, paging, KPI clicks
// ---------------------------------------------------------------------------
function setTab(k) {
  tab = k; page = 1;
  $('fStatus').value = ['received', 'ordered', 'partial', 'drafts'].includes(k) ? k : '';
  document.querySelectorAll('.pur-chips [data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === k));
  renderList();
  $('purchaseRows').closest('.pur-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.querySelector('.pur-chips').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); };
$('fStatus').onchange = () => { tab = $('fStatus').value || 'all'; page = 1; document.querySelectorAll('.pur-chips [data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === tab)); renderList(); };
let st;
$('searchPurchase').addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => { page = 1; renderList(); clearTimeout(medT); medT = setTimeout(medicineSearch, 300); }, 200); });
['fDist', 'perPage'].forEach(id => $(id).onchange = () => { page = 1; renderList(); });
$('period').onchange = () => { if ($('period').value === 'custom') { $('filterPop').hidden = false; $('fromDate').focus(); } page = 1; renderList(); renderTop(); };
$('pager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); renderList(); } };
$('filterBtn').onclick = e => { e.stopPropagation(); $('filterPop').hidden = !$('filterPop').hidden; };
$('filterPop').onclick = e => e.stopPropagation();
document.addEventListener('click', () => { $('filterPop').hidden = true; });
$('applyFilters').onclick = () => {
  if ($('fromDate').value || $('toDate').value) $('period').value = 'custom';
  filt.min = $('fMin')?.value ?? ''; filt.max = $('fMax')?.value ?? ''; filt.unpaid = !!$('fUnpaid')?.checked; filt.nodoc = $('fNoDoc').checked;
  $('filterPop').hidden = true; page = 1; renderList(); renderTop();
};
$('clearFilters').onclick = () => {
  ['searchPurchase', 'fromDate', 'toDate', 'fMin', 'fMax'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('fUnpaid')) $('fUnpaid').checked = false; $('fNoDoc').checked = false;
  Object.assign(filt, { min: '', max: '', unpaid: false, nodoc: false });
  $('fDist').value = ''; $('period').value = '30'; medHits = new Set();
  $('filterPop').hidden = true; setTab('all'); renderTop();
};
$('trendRange').onchange = drawChart;
let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(drawChart, 120); }).observe($('chart'));
document.querySelector('.md-kpis').onclick = e => {
  const b = e.target.closest('[data-kpi]'); if (!b) return;
  if (b.dataset.kpi === 'kDists') { location.href = 'distributors.html'; return; }
  $('period').value = 'month'; renderTop(); setTab('received');
};
$('topRows').onclick = e => { const tr = e.target.closest('tr[data-dist]'); if (!tr) return; $('fDist').value = tr.dataset.dist; page = 1; setTab('all'); };
$('sumMore').onclick = e => {
  const b = e.target.closest('[data-sum]'); if (!b) return;
  if (b.dataset.sum === 'unpaid') { filt.unpaid = true; if ($('fUnpaid')) $('fUnpaid').checked = true; $('period').value = 'all'; return setTab('received'); }
  setTab(b.dataset.sum);
};

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (!canWrite) { $('newPurchase').disabled = true; $('newPurchase').title = 'Your role can view purchases only'; $('newMenuBtn').disabled = true; }
// Deep links: ?q=<invoice or supplier> pre-fills the search (all time), ?new=1 opens a new purchase,
// ?order=1 opens a new purchase order, ?tab=ordered|partial|received|drafts opens that list.
const purchaseParams = new URLSearchParams(location.search);
if (purchaseParams.get('q')) { $('searchPurchase').value = purchaseParams.get('q'); $('period').value = 'all'; }
await reloadAll();
if (purchaseParams.get('tab')) setTab(purchaseParams.get('tab'));
// ?dist=<distributor id> (from the Distributors page) pre-selects the supplier.
const presetDist = dists.find(d => d.id === purchaseParams.get('dist'))?.id || '';
if (purchaseParams.get('new') === '1' && canWrite) { $('newPurchase').click(); if (presetDist) { $('supplier').value = presetDist; renderSupplier(); $('invoiceNo').focus(); } }
if (purchaseParams.get('order') === '1' && canWrite) openOrderForm(null, { distributor_id: presetDist });
