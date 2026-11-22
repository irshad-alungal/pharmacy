// Expenses Management — Pallikkal Pharmacy design.
// Existing flows kept: draft → post (ledger journal) → cancel with reversal, receipts (camera / file,
// private bucket, signed links), categories, daily / monthly / category reports (expense_get_summary).
// Added: KPIs, category donut, trend, monthly / yearly summary, edit draft, save & post, duplicate,
// copy last month's regular expenses, manage categories, export / print, payment voucher, alerts.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { printHTML } from './invoice.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('expenses', 'Expenses', { layout: 'brand' });
const $ = id => document.getElementById(id);
// Expenses are restricted to the two owner/admin roles, not admin_staff.
if (!['admin', 'super_admin'].includes(String(prof?.role || '').toLowerCase())) {
  $('view').innerHTML = '<p class="notice">Only Admin and Super Admin can access Expenses.</p>';
  throw new Error('Expenses access denied');
}

const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money2 = v => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = v => `₹${money2(v)}`;
const rupees0 = v => '₹' + Math.round(num(v)).toLocaleString('en-IN');
const count = n => new Intl.NumberFormat('en-IN').format(num(n));
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const monthStart = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10); };
const monthEnd = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - back, 0)).toISOString().slice(0, 10); };
const dmy = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const dShort = d => new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const tShort = v => v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ }).toUpperCase() : '';
const when = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  wallet: svg('<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11v3"/><path d="M15 12h5v4h-5a2 2 0 0 1 0-4Z"/><circle cx="16.5" cy="14" r=".6" fill="currentColor"/>', 1.8),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2"/>', 1.9),
  layers: svg('<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 16.5 9 5 9-5"/>', 1.8),
  bars: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/></svg>',
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  filter: svg('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  pie: svg('<path d="M21 12a9 9 0 1 1-9-9v9Z"/><path d="M12 3a9 9 0 0 1 9 9h-9Z"/>', 1.9),
  tag: svg('<path d="M3 12V4h8l9 9-8 8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>', 1.9),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', 2.2),
  send: svg('<path d="m4 12 16-8-6 16-2-6Z"/><path d="m12 14 8-10"/>', 1.9),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 2),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', 2),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>', 1.9),
  camera: svg('<path d="M4 7h3l2-3h6l2 3h3v12H4Z"/><circle cx="12" cy="13" r="3.5"/>', 1.9),
  clip: svg('<path d="m21 11-8.6 8.6a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7L10 17.4a1.7 1.7 0 0 1-2.4-2.4L15.5 7"/>', 2),
  file: svg('<path d="M6 2h9l5 5v15H6Z"/><path d="M14 2v6h6"/>', 1.9),
  repeat: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>', 1.9),
  report: svg('<path d="M4 4h16v16H4Z"/><path d="M8 16v-4M12 16V8M16 16v-6"/>', 1.9),
  home: svg('<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>', 1.9),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>', 1.9),
  users: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.3c2.9.3 5 2.6 5 5.7"/>', 1.8),
  wrench: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5Z"/>', 1.8),
  truck: svg('<path d="M3 6h11v10H3Z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', 1.8),
  box: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>', 1.8),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const PAY = { cash: ['Cash', 'p-cash'], upi: ['UPI', 'p-upi'], card: ['Card', 'p-card'], bank: ['Bank Transfer', 'p-bank'] };
const STATUS = { posted: ['Completed', 'in', 'Posted to the ledger'], draft: ['Draft', 'low', 'Saved, not posted yet'], cancelled: ['Cancelled', 'out', 'Cancelled with a reversal journal'] };
// Category look: colour + icon by name, so any category the pharmacy adds still looks right.
const CAT_RULES = [
  [/rent|lease/i, '#12a01b', 'home'], [/salar|wage|staff|payroll/i, '#1e8fe8', 'users'], [/utilit|electric|power|water|internet|wi-?fi|phone/i, '#f5b800', 'bolt'],
  [/mainten|repair|clean|waste/i, '#9b6cf2', 'wrench'], [/logist|deliver|transport|fuel|courier/i, '#e5484d', 'truck'],
  [/office|station/i, '#0e9488', 'file'], [/suppl/i, '#f08a24', 'box'], [/software|subscri|licen/i, '#3b5bdb', 'layers']
];
const EXTRA = ['#0e9488', '#f08a24', '#3b5bdb', '#d6336c', '#5c940d', '#1098ad'];
const catLook = name => { const r = CAT_RULES.find(([re]) => re.test(name || '')); if (r) return { col: r[1], ic: I[r[2]] }; const h = [...String(name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0); return { col: EXTRA[h % EXTRA.length], ic: I.tag }; };
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
const PERIODS = { month: 'This Month', lastmonth: 'Last Month', '3m': 'Last 3 Months', year: 'This Year', lastyear: 'Last Year', all: 'All (2 years)' };
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

let all = [];             // every expense since 1 Jan last year (drafts, posted, cancelled)
let cats = [];            // active + inactive categories
let page = 1;
let compact = matchMedia('(max-width: 560px)').matches;
const filt = { period: 'month', from: '', to: '', status: '', cat: '', pay: '', receipt: '', min: '', sort: 'new' };

$('view').innerHTML = `
<div class="pos dl md pur ds sl rt ex">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.wallet}</span>
      <div><h1>Expenses Management</h1><p>Record, track, and analyze all business expenses.</p></div></div>
    <div class="pos-head-actions md-head-actions rt-head-actions ex-head-actions">
      <button type="button" class="pos-btn pos-btn-solid" id="addExpense">${I.plusC}<span>Add Expense</span></button>
      <button type="button" class="pos-btn" id="exportBtn">${I.download}<span>Export</span></button>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn" id="moreBtn" aria-expanded="false">${I.dots}<span>More</span></button>
        <div class="dl-pop md-menu ds-menu rt-more" id="moreMenu" hidden>
          <button type="button" data-more="copy">${I.repeat}<span>Copy last month's regular expenses</span></button>
          <button type="button" data-more="drafts">${I.pencil}<span>Drafts waiting to post</span></button>
          <button type="button" data-more="cats">${I.tag}<span>Manage categories</span></button>
          <button type="button" data-more="reports">${I.report}<span>Daily / monthly / category reports</span></button>
          <button type="button" data-more="csv">${I.download}<span>Export CSV</span></button>
          <button type="button" data-more="print">${I.print}<span>Print expense list</span></button>
          <a href="finance.html">${I.wallet}<span>Finance &amp; ledger</span></a>
        </div></div>
    </div>
  </section>

  <section class="dz-kpis dl-kpis md-kpis">
    ${KPI('green', I.wallet, 'Total Expenses (This Month)', 'kMonth')}
    ${KPI('blue', I.cal, 'Expense Transactions', 'kCount')}
    ${KPI('amber', I.layers, 'Average Expense', 'kAvg')}
    ${KPI('purple', I.bars, 'Expenses (This Year)', 'kYear')}
  </section>

  <div id="msg" class="md-msg" role="status"></div>
  <div id="expense-message" class="ex-sr" role="status" aria-live="polite"></div>

  <div class="rt-grid ex-grid">
    <section class="pos-card dl-orders ds-list sl-list rt-list">
      <div class="dl-card-head ds-list-head">
        <h2>${I.list}Expense Transactions <small id="rangeLabel">(This Month)</small></h2>
        <label class="dl-select ds-status sl-status"><select id="fPeriod" aria-label="Period">${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="custom" hidden>Custom</option></select></label>
      </div>
      <div class="ds-tools">
        <label class="dl-search">${I.search}<input id="eq" type="search" placeholder="Search by title, category, or reference no..." autocomplete="off" aria-label="Search expenses"></label>
        <div class="dl-pop-anchor">
          <button type="button" class="pos-btn dl-filter-btn" id="filterBtn" aria-expanded="false">${I.filter}<span>Filter</span><b class="dl-filter-dot" id="filterDot" hidden></b></button>
          <div class="dl-pop sl-filter" id="filterPop" hidden>
            <div class="sl-dates"><div class="pos-field"><label for="expense-from">From</label><input id="expense-from" type="date"></div><div class="pos-field"><label for="expense-to">To</label><input id="expense-to" type="date"></div></div>
            <div class="pos-field"><label for="expense-status">Status</label><select id="expense-status"><option value="">All statuses</option><option value="posted">Completed (posted)</option><option value="draft">Draft</option><option value="cancelled">Cancelled</option></select></div>
            <div class="pos-field"><label for="fCat">Category</label><select id="fCat"><option value="">All categories</option></select></div>
            <div class="pos-field"><label for="fPay">Payment method</label><select id="fPay"><option value="">Any</option>${Object.entries(PAY).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
            <div class="pos-field"><label for="fRcpt">Receipt</label><select id="fRcpt"><option value="">Any</option><option value="yes">With receipt</option><option value="no">Without receipt</option></select></div>
            <div class="pos-field"><label for="fMin">Amount at least (₹)</label><input id="fMin" type="number" min="0" step="1" placeholder="0"></div>
            <div class="pos-field"><label for="fSort">Sort by</label><select id="fSort"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="high">Amount (high first)</option><option value="low">Amount (low first)</option></select></div>
            <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="expense-clear">Reset</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="expense-apply">Apply</button></div>
          </div>
        </div>
      </div>
      <div class="dl-table-wrap"><table class="dl-table sl-table ex-table"><thead><tr>
        <th class="c-no">#</th><th class="c-dt">Date &amp; Time</th><th>Expense Title</th><th class="c-cat">Category</th><th class="c-r">Amount</th><th class="c-pay">Payment Method</th><th>Status</th><th class="c-c">Actions</th>
      </tr></thead><tbody id="expense-rows"><tr><td colspan="8" class="dl-empty">Loading expenses…</td></tr></tbody></table></div>
      <div class="dl-pager md-pager"><span id="pageInfo"></span><div id="pager"></div>
        <button type="button" class="dl-link sl-all" id="viewAll" hidden>View All Expenses ${I.chev}</button>
        <label class="dl-select md-per"><select id="perPage" aria-label="Rows per page"><option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></select></label></div>
    </section>

    <section class="pos-card rt-reason ex-cats">
      <div class="dl-card-head"><h2>${I.pie}Expenses by Category</h2>
        <label class="dl-select pur-mini"><select id="catPeriod" aria-label="Period"><option value="month">This Month</option><option value="lastmonth">Last Month</option><option value="3m">Last 3 Months</option><option value="year">This Year</option></select></label></div>
      <div class="rt-reason-box ex-cat-box">
        <div class="dl-donut rt-donut ex-donut"><svg viewBox="0 0 220 220" id="donut" aria-hidden="true"></svg><div class="dl-donut-c"><strong id="donutTotal">₹0</strong><span>Total Expenses</span></div></div>
        <div class="rt-legend ex-legend" id="catLegend"></div>
      </div>
    </section>

    <section class="pos-card pur-trend rt-trend">
      <div class="dl-card-head"><h2>${I.bars}Expense Trend</h2>
        <label class="dl-select pur-mini"><select id="trendRange" aria-label="Range"><option value="6m">Last 6 Months</option><option value="12m">Last 12 Months</option><option value="30">Last 30 Days</option><option value="month">This Month</option></select></label></div>
      <div class="dz-chart pur-chart" id="chart"></div>
      <p class="pur-chart-sub" id="chartSub"></p>
    </section>

    <section class="pos-card pur-sum sl-sum ex-sum">
      <div class="dl-card-head"><h2>${I.tag}Expense Summary</h2></div>
      <div class="pur-sum-tiles sl-tiles ex-tiles" id="sumTiles"></div>
      <div class="pur-sum-more" id="sumMore"></div>
    </section>
  </div>
</div>

<dialog id="expDlg" class="pos-dialog dl-dialog md-wide sl-dlg rt-dlg ex-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button>
  <form id="expense-form" class="md-form" novalidate>
    <h3 class="rt-dlg-title" id="formTitle">${I.wallet} Add expense</h3>
    <p class="dl-muted" id="formSub">Save as a draft, or save and post it to the accounts now.</p>
    <div class="ex-quick" id="quick"></div>
    <div class="md-form-grid">
      <div class="pos-field"><label for="expense-date">Expense date *</label><input id="expense-date" type="date" required></div>
      <div class="pos-field"><label for="expense-category">Category *</label><div class="ex-cat-row"><select id="expense-category" required><option value="">Loading categories…</option></select><button type="button" class="pos-btn pos-btn-sm" id="newCat" title="Add a category">+</button></div></div>
      <div class="pos-field md-span-2"><label for="expense-description">Expense title *</label><input id="expense-description" type="text" maxlength="500" required placeholder="What was this expense for? e.g. Shop Rent – December"></div>
      <div class="pos-field"><label for="expense-amount">Amount (₹) *</label><input id="expense-amount" type="number" min="0.01" max="999999999999.99" step="0.01" required placeholder="0.00"></div>
      <div class="pos-field"><label>Payment method *</label><div class="ex-pay" id="payPick">${Object.entries(PAY).map(([k, [l]]) => `<button type="button" data-pay="${k}">${l}</button>`).join('')}</div>
        <select id="expense-payment" class="ex-sr" aria-label="Payment method" tabindex="-1"><option value="">Select payment method</option>${Object.entries(PAY).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="pos-field"><label for="expense-reference">Reference no.</label><input id="expense-reference" type="text" maxlength="150" placeholder="Bill no., UTR / UPI ref"></div>
      <div class="pos-field"><label for="expense-receipt">Receipt (optional)</label><input id="expense-receipt" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></div>
      <div class="pos-field md-span-2"><label for="expense-notes">Notes</label><textarea id="expense-notes" rows="2" maxlength="2000" placeholder="Additional details"></textarea></div>
    </div>
    <div id="expense-form-message" class="pos-form-msg" role="status" aria-live="polite"></div>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" id="expense-form-clear">Clear</button><button id="expense-save-draft" type="submit" class="pos-btn">${I.pencil}<span>Save draft</span></button><button id="expense-save-post" type="button" class="pos-btn pos-btn-solid">${I.send}<span>Save &amp; post</span></button></div>
  </form>
</dialog>
<dialog id="viewDlg" class="pos-dialog dl-dialog md-wide sl-dlg rt-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="viewBody"></div></dialog>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg rt-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<dialog id="expense-receipts-dialog" class="pos-dialog dl-dialog sl-dlg rt-dlg ex-rc-dlg"><button type="button" class="pos-icon-btn dl-x" id="expense-receipts-close" aria-label="Close">${I.xs}</button>
  <h3 id="expense-receipts-title" class="rt-dlg-title">Expense receipts</h3><div id="expense-receipts-list"></div></dialog>
<input id="expense-camera-input" type="file" accept="image/*" capture="environment" hidden>
<input id="expense-file-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const message = (m, bad = false) => { $('expense-message').textContent = m || ''; $('msg').textContent = m || ''; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; if (m) toast(m, bad); };
const formMessage = (m, bad = false) => { $('expense-form-message').textContent = m || ''; $('expense-form-message').style.color = bad ? '#c4291f' : '#0f7a16'; };
for (const d of ['expDlg', 'viewDlg', 'puDlg']) $(d).addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $(d)) $(d).close(); });
$('expense-receipts-close').onclick = () => $('expense-receipts-dialog').close();
const dlg = html => { $('puPanel').innerHTML = html; if (!$('puDlg').open) $('puDlg').showModal(); };

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const loadFrom = () => `${Number(today().slice(0, 4)) - 1}-01-01`;
async function loadAll() {
  const { data, error } = await sb.rpc('expense_get_list', { p_from: loadFrom(), p_to: null, p_status: null });
  if (error) { $('expense-rows').innerHTML = '<tr><td colspan="8" class="dl-empty">Unable to load expenses.</td></tr>'; message(friendly(error), true); return false; }
  all = (data || []).map(r => ({ ...r, amount: num(r.amount), receipt_count: num(r.receipt_count) }));
  return true;
}
async function loadCategories() {
  const { data, error } = await sb.rpc('expense_category_get_list', { p_include_inactive: true });
  if (error) { $('expense-category').innerHTML = '<option value="">Unable to load categories</option>'; formMessage(friendly(error), true); return; }
  cats = data || [];
  const active = cats.filter(c => c.active !== false);
  $('expense-category').innerHTML = active.length ? '<option value="">Select category</option>' + active.map(c => `<option value="${esc(c.category_id)}">${esc(c.category_name)}${c.is_shared ? ' (Default)' : ''}</option>`).join('') : '<option value="">No active categories — add one with +</option>';
  $('fCat').innerHTML = '<option value="">All categories</option>' + [...new Set([...cats.map(c => c.category_name), ...all.map(r => r.category_name)])].sort().map(n => `<option>${esc(n)}</option>`).join('');
}
const inWin = (rows, [a, b]) => rows.filter(r => r.expense_date >= a && r.expense_date <= b);
const posted = rows => rows.filter(r => r.status === 'posted');
const sum = rows => rows.reduce((a, r) => a + num(r.amount), 0);
function windowFor(p) {
  const t = today(), y = Number(t.slice(0, 4));
  if (p === 'month') return [monthStart(t), t];
  if (p === 'lastmonth') return [monthStart(t, 1), monthEnd(t, 1)];
  if (p === '3m') return [monthStart(t, 2), t];
  if (p === 'year') return [`${y}-01-01`, t];
  if (p === 'lastyear') return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  if (p === 'all') return [loadFrom(), t];
  return [filt.from || t, filt.to || t];
}
async function rangeRows(from, to) {
  if (from >= loadFrom()) return inWin(all, [from, to]);
  const { data, error } = await sb.rpc('expense_get_list', { p_from: from, p_to: to, p_status: null });
  if (error) throw error;
  return (data || []).map(r => ({ ...r, amount: num(r.amount), receipt_count: num(r.receipt_count) }));
}

// ---------------------------------------------------------------------------
// KPIs, categories, trend, summary
// ---------------------------------------------------------------------------
const vs = (a, b, label) => {
  if (!b) return a ? `<span class="dz-down">New</span> · nothing ${label.replace('vs. ', '')}` : `Nothing ${label.replace('vs. ', '')} either`;
  const p = (a - b) / b * 100;
  return `<span class="${p <= 0 ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.down}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> ${label}`;
};
function renderKpis() {
  const t = today(), d = Number(t.slice(8)), le = monthEnd(t, 1);
  const cur = posted(inWin(all, [monthStart(t), t])), prev = posted(inWin(all, [monthStart(t, 1), monthStart(t, 1).slice(0, 8) + String(Math.min(d, Number(le.slice(8)))).padStart(2, '0')]));
  const y = Number(t.slice(0, 4)), ytd = posted(inWin(all, [`${y}-01-01`, t])), lytd = posted(inWin(all, [`${y - 1}-01-01`, `${y - 1}${t.slice(4)}`]));
  $('kMonth').textContent = rupees0(sum(cur)); $('kMonthNote').innerHTML = vs(sum(cur), sum(prev), 'vs. last month');
  $('kCount').textContent = count(cur.length); $('kCountNote').innerHTML = vs(cur.length, prev.length, 'vs. last month');
  const avg = r => r.length ? sum(r) / r.length : 0;
  $('kAvg').textContent = rupees0(avg(cur)); $('kAvgNote').innerHTML = vs(avg(cur), avg(prev), 'vs. last month');
  $('kYear').textContent = rupees0(sum(ytd)); $('kYearNote').innerHTML = vs(sum(ytd), sum(lytd), 'vs. last year');
  for (const [id, tip] of [['kMonth', `Posted expenses this month, compared with last month up to day ${d}`], ['kCount', 'Posted expenses this month'], ['kAvg', 'Average posted expense this month'], ['kYear', 'Posted expenses since 1 January, compared with the same dates last year']]) $(id).closest('.dz-kpi').title = tip;
  const drafts = all.filter(r => r.status === 'draft');
  $('kCountNote').insertAdjacentHTML('beforeend', drafts.length ? ` · <b class="ex-drafts">${drafts.length} draft${drafts.length === 1 ? '' : 's'}</b>` : '');
}
function renderCategories() {
  const rows = posted(inWin(all, windowFor($('catPeriod').value))), total = sum(rows);
  const g = new Map(); for (const r of rows) g.set(r.category_name, (g.get(r.category_name) || 0) + num(r.amount));
  let parts = [...g.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ n, v, ...catLook(n) }));
  if (parts.length > 6) { const rest = parts.slice(5); parts = [...parts.slice(0, 5), { n: 'Others', v: rest.reduce((a, p) => a + p.v, 0), col: '#c3cad5', others: rest.map(p => p.n) }]; }
  const C = 2 * Math.PI * 84, gap = parts.length > 1 ? 2 : 0; let off = 0;
  $('donut').innerHTML = `<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="32"/>` + parts.map(p => { const len = total ? p.v / total * C : 0, s = len > gap ? `<circle cx="110" cy="110" r="84" fill="none" stroke="${p.col}" stroke-width="32" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-off}"><title>${esc(p.n)}: ${rupees0(p.v)}</title></circle>` : ''; off += len; return s; }).join('');
  $('donutTotal').textContent = rupees0(total);
  $('catLegend').innerHTML = parts.map(p => `<button type="button" data-cat="${esc(p.others ? '' : p.n)}" title="${esc(p.others ? p.others.join(', ') : p.n)}"><i style="background:${p.col}"></i><b>${esc(p.n)}</b><em>${(p.v / total * 100).toFixed(1)}%</em><span>${rupees0(p.v)}</span></button>`).join('') || '<p class="dl-muted">No posted expenses in this period.</p>';
}
function trendSeries() {
  const r = $('trendRange').value, t = today(), out = [];
  if (r === '6m' || r === '12m') {
    const n = r === '6m' ? 6 : 12;
    for (let i = n - 1; i >= 0; i--) { const a = monthStart(t, i), b = i ? monthEnd(t, i) : t, rows = posted(inWin(all, [a, b])); out.push({ label: new Date(a + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), full: new Date(a + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), v: sum(rows), n: rows.length }); }
    return { out, label: `Last ${n} Months` };
  }
  const from = r === '30' ? addDays(t, -29) : monthStart(t);
  for (let d = from; d <= t; d = addDays(d, 1)) { const rows = posted(all.filter(x => x.expense_date === d)); out.push({ label: dShort(d), full: dmy(d), v: sum(rows), n: rows.length }); }
  return { out, label: r === '30' ? 'Last 30 Days' : 'This Month' };
}
function niceStep(v) { if (v <= 0) return 1; const raw = v * 1.08 / 6, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const axisMoney = v => v >= 1e5 ? `₹${+(v / 1e5).toFixed(1)}L` : `₹${Math.round(v).toLocaleString('en-IN')}`;
function drawChart() {
  const el = $('chart'), { out: s, label } = trendSeries(), N = s.length;
  const vals = s.map(x => x.v), tot = vals.reduce((a, b) => a + b, 0), n = s.reduce((a, x) => a + x.n, 0);
  $('chartSub').textContent = `${rupees0(tot)} in ${count(n)} expense${n === 1 ? '' : 's'} · ${label}`;
  const W = Math.max(260, el.clientWidth), H = el.clientHeight || 220, padL = 60, padR = 22, padT = 34, padB = 28, steps = 6;
  const nz = vals.filter(v => v > 0), lo0 = nz.length ? Math.min(...nz) : 0, hi = Math.max(...vals, 1);
  const tick = niceStep(N > 12 ? hi : Math.max(hi - lo0 * .7, hi * .3)), min = N > 12 ? 0 : Math.max(0, Math.floor(lo0 * .7 / tick) * tick), max = min + tick * steps < hi ? Math.ceil(hi / tick) * tick : min + tick * steps;
  const grid = []; for (let v = min; v <= max + 1e-6; v += tick) grid.push(v);
  const x = i => padL + (N === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (N - 1)), yv = v => padT + (H - padT - padB) * (1 - (Math.max(v, min) - min) / (max - min || 1));
  const pts = vals.map((v, i) => [x(i), yv(v)]);
  let d = `M${pts[0][0]},${pts[0][1]}`; for (let i = 1; i < N; i++) d += ` L${pts[i][0]},${pts[i][1]}`;
  const fit = Math.max(2, Math.floor((W - padL - padR) / 46)), every = Math.max(1, Math.ceil(N / fit));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Expense trend">
    <defs><linearGradient id="exArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fbf3a" stop-opacity=".38"/><stop offset="1" stop-color="#2fbf3a" stop-opacity=".05"/></linearGradient></defs>
    <g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${yv(v)}" y2="${yv(v)}"/>`).join('')}</g>
    <g class="dz-axis pur-axis">${grid.map(v => `<text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end">${axisMoney(v)}</text>`).join('')}${s.map((p, i) => (i % every === 0 && N - 1 - i >= every / 2) || i === N - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '').join('')}</g>
    <path d="${d} L${pts[N - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z" fill="url(#exArea)"/><path class="dz-line" d="${d}"/>
    ${pts.map(([px, py], i) => `<circle class="dz-pt${i === N - 1 ? ' hot' : ''}" data-i="${i}" cx="${px}" cy="${py}" r="${i === N - 1 ? 6 : N > 14 ? 3 : 4.5}"/>`).join('')}
    ${pts.map(([px], i) => `<rect data-i="${i}" x="${px - (W - padL - padR) / Math.max(1, N - 1) / 2}" y="${padT}" width="${(W - padL - padR) / Math.max(1, N - 1)}" height="${H - padT - padB}" fill="transparent"/>`).join('')}
  </svg><div class="dz-tip" id="exTip"></div>`;
  const tip = $('exTip');
  const show = i => { const [px, py] = pts[i]; tip.innerHTML = `${rupees0(vals[i])}<small>${esc(s[i].full)} · ${s[i].n} expense${s[i].n === 1 ? '' : 's'}</small>`; tip.style.left = `${Math.min(Math.max(px / W * 100, 20), 80)}%`; tip.style.top = `${(py - 12) / H * 100}%`; el.querySelectorAll('.dz-pt').forEach(c => c.classList.toggle('hot', +c.dataset.i === i)); };
  show(N - 1);
  const sv = el.querySelector('svg');
  sv.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('mouseleave', () => show(N - 1));
  sv.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
}
function renderSummary() {
  const t = today(), y = Number(t.slice(0, 4));
  const tm = sum(posted(inWin(all, windowFor('month')))), lm = sum(posted(inWin(all, windowFor('lastmonth')))), ty = sum(posted(inWin(all, windowFor('year')))), ly = sum(posted(inWin(all, windowFor('lastyear'))));
  $('sumTiles').innerHTML = `
    <button type="button" class="g" data-goto="month"><b>${rupees0(tm)}</b><span>This Month</span></button>
    <button type="button" class="b" data-goto="lastmonth"><b>${rupees0(lm)}</b><span>Last Month</span></button>
    <button type="button" class="a" data-goto="year"><b>${rupees0(ty)}</b><span>This Year</span></button>
    <button type="button" class="p" data-goto="lastyear"><b>${rupees0(ly)}</b><span>Last Year</span></button>`;
  const mrows = inWin(all, windowFor('month')), drafts = all.filter(r => r.status === 'draft'), noRc = posted(mrows).filter(r => !r.receipt_count);
  const byPay = Object.keys(PAY).map(k => [k, sum(posted(mrows).filter(r => r.payment_method === k))]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const pace = Number(t.slice(8)) >= 5 ? tm / Number(t.slice(8)) * Number(monthEnd(t).slice(8)) : 0;
  $('sumMore').innerHTML = [
    drafts.length ? `<button type="button" data-goto="draft">${I.pencil}<span>Drafts waiting <b>${drafts.length}</b> · ${rupees0(sum(drafts))}</span></button>` : '',
    noRc.length ? `<button type="button" data-goto="norc">${I.clip}<span>No receipt this month <b>${noRc.length}</b></span></button>` : '',
    byPay.length ? `<span class="ds-adv">${I.wallet}<span>${byPay.map(([k, v]) => `${PAY[k][0]} <b>${rupees0(v)}</b>`).join(' · ')}</span></span>` : '',
    pace ? `<span class="ds-adv" title="This month's spending so far, extended to the end of the month">${I.bars}<span>Month-end estimate <b>${rupees0(pace)}</b></span></span>` : '',
    `<span class="ds-adv">${I.cal}<span>${y}: ${count(posted(inWin(all, windowFor('year'))).length)} expenses</span></span>`
  ].join('');
}
const recurring = () => {   // last month's expenses whose title is not yet recorded this month
  const lm = posted(inWin(all, windowFor('lastmonth'))), tm = inWin(all, windowFor('month')).filter(r => r.status !== 'cancelled');
  const key = r => `${r.category_name}|${String(r.description).toLowerCase().replace(/\(.*?\)|[-–].*$/g, '').trim()}`;
  const have = new Set(tm.map(key)), seen = new Set();
  return lm.filter(r => { const k = key(r); if (have.has(k) || seen.has(k)) return false; seen.add(k); return true; });
};
function notify() {
  const items = [], drafts = all.filter(r => r.status === 'draft');
  if (drafts.length) items.push({ tone: 'warn', title: `${drafts.length} expense draft(s) not posted`, detail: `${rupees0(sum(drafts))} — post them so they reach the ledger`, href: 'expenses.html?status=draft' });
  const big = recurring().filter(r => /rent|salar|electric|internet/i.test(`${r.category_name} ${r.description}`));
  if (big.length && Number(today().slice(8)) >= 5) items.push({ tone: 'info', title: `Not yet recorded this month: ${big.slice(0, 3).map(r => r.description).join(', ')}`, detail: 'More → Copy last month\'s regular expenses', href: 'expenses.html?copy=1' });
  const noRc = posted(inWin(all, windowFor('month'))).filter(r => !r.receipt_count && r.amount >= 1000);
  if (noRc.length) items.push({ tone: 'info', title: `${noRc.length} expense(s) of ₹1,000+ without a receipt`, detail: 'Attach a photo or PDF of the bill', href: 'expenses.html' });
  setNotifications(items);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
let listRows = [];
async function loadExpenses() {
  const [from, to] = windowFor(filt.period);
  filt.from = from; filt.to = to;
  $('fPeriod').value = filt.period;
  const cOpt = $('fPeriod').querySelector('option[value="custom"]');
  cOpt.hidden = filt.period !== 'custom'; cOpt.textContent = filt.period === 'custom' ? (from === to ? dmy(from) : `${dmy(from)} – ${dmy(to)}`) : 'Custom';
  $('rangeLabel').textContent = `(${filt.period === 'custom' ? cOpt.textContent : PERIODS[filt.period]})`;
  try { listRows = await rangeRows(from, to); } catch (e) { listRows = []; $('expense-rows').innerHTML = `<tr><td colspan="8" class="dl-empty">${esc(friendly(e))}</td></tr>`; message(friendly(e), true); return; }
  draw();
}
function filtered() {
  const raw = $('eq').value.trim().toLowerCase();
  const out = listRows.filter(r => {
    if (filt.status && r.status !== filt.status) return false;
    if (filt.cat && r.category_name !== filt.cat) return false;
    if (filt.pay && r.payment_method !== filt.pay) return false;
    if (filt.receipt === 'yes' && !r.receipt_count) return false;
    if (filt.receipt === 'no' && r.receipt_count) return false;
    if (filt.min !== '' && r.amount < num(filt.min)) return false;
    if (raw && !`${r.description} ${r.category_name} ${r.reference || ''} ${r.expense_no} ${PAY[r.payment_method]?.[0] || ''}`.toLowerCase().includes(raw)) return false;
    return true;
  });
  const by = { new: (a, b) => b.expense_date.localeCompare(a.expense_date) || String(b.created_at).localeCompare(String(a.created_at)), old: (a, b) => a.expense_date.localeCompare(b.expense_date) || String(a.created_at).localeCompare(String(b.created_at)), high: (a, b) => b.amount - a.amount, low: (a, b) => a.amount - b.amount }[filt.sort];
  return out.sort(by);
}
function draw() {
  const list = filtered(), per = compact ? 3 : Number($('perPage').value), pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(page, pages);
  const shown = list.slice((page - 1) * per, page * per);
  $('expense-rows').innerHTML = shown.map((r, i) => {
    const [sl, sc, st] = STATUS[r.status] || [r.status, 'off', ''], lk = catLook(r.category_name), [pl, pc] = PAY[r.payment_method] || [r.payment_method, ''];
    return `<tr data-id="${esc(r.expense_id)}" class="${r.status === 'cancelled' ? 'ds-off' : ''}">
      <td class="c-no">${(page - 1) * per + i + 1}</td>
      <td class="c-dt">${esc(dShort(r.expense_date))}${r.created_at ? `, ${esc(tShort(r.created_at))}` : ''}</td>
      <td class="c-inv"><span class="sl-doc ex-ic" style="--c:${lk.col}">${lk.ic}</span><b>${esc(r.description)}</b>${r.receipt_count ? `<span class="ex-clip" title="${r.receipt_count} receipt(s)">${I.clip}</span>` : ''}<small class="sl-m-cust ex-m-date">${esc(dShort(r.expense_date))}${r.created_at ? `, ${esc(tShort(r.created_at))}` : ''}</small></td>
      <td class="c-cat"><span class="ex-cat" style="--c:${lk.col}">${esc(r.category_name)}</span></td>
      <td class="c-r c-amt"><b>${fmtMoney(r.amount)}</b><small class="ex-m-cat"><span class="ex-cat" style="--c:${lk.col}">${esc(r.category_name)}</span></small><small class="ex-m-pay">${esc(pl)}</small></td>
      <td class="c-pay"><span class="sl-pay-chip ${pc}">${esc(pl)}</span></td>
      <td class="c-st"><span class="md-chip sl-st ${sc}" title="${esc(st)}">${sc === 'in' ? I.check : '<i></i>'}${esc(sl)}</span></td>
      <td class="c-act"><div class="pur-acts"><button type="button" class="dl-act" data-view aria-label="View ${esc(r.description)}">${I.eye}</button><div class="dl-pop-anchor"><button type="button" class="dl-act" data-menu aria-label="More actions for ${esc(r.description)}">${I.dots}</button></div></div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="dl-empty">${listRows.length ? 'No expenses match these filters.' : 'No expenses in this period. Use “Add Expense”.'}</td></tr>`;
  const tot = sum(list.filter(r => r.status === 'posted'));
  $('pageInfo').textContent = list.length ? `Showing ${(page - 1) * per + 1} – ${Math.min(page * per, list.length)} of ${count(list.length)} expenses${compact ? '' : ` · posted ${rupees0(tot)}`}` : '';
  $('pager').innerHTML = !compact && pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, k) => k + 1).filter(x => x <= 5 && page <= 3 || x === 1 || x === pages || Math.abs(x - page) <= 1).map((x, k, arr) => `${k && x - arr[k - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${x}" class="${x === page ? 'on' : ''}">${x}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
  $('viewAll').hidden = !(compact && list.length > per);
  $('filterDot').hidden = !(filt.status || filt.cat || filt.pay || filt.receipt || filt.min !== '' || filt.sort !== 'new' || filt.period === 'custom');
  $('expense-message').textContent = `${list.length} expense${list.length === 1 ? '' : 's'} found.`;
}
async function reloadAll() {
  if (!await loadAll()) return;
  await loadCategories();
  await loadExpenses();
  renderKpis(); renderCategories(); drawChart(); renderSummary(); notify();
}

// ---------------------------------------------------------------------------
// Add / edit (existing expense_save_draft) + save & post, quick templates, receipt
// ---------------------------------------------------------------------------
let editingId = null;
const setPay = v => { $('expense-payment').value = v || ''; $('payPick').querySelectorAll('[data-pay]').forEach(b => b.classList.toggle('on', b.dataset.pay === v)); };
$('payPick').onclick = e => { const b = e.target.closest('[data-pay]'); if (b) setPay(b.dataset.pay); };
function quickChips() {
  const seen = new Set(), recent = [];
  for (const r of [...all].sort((a, b) => b.expense_date.localeCompare(a.expense_date))) {
    if (r.status === 'cancelled') continue;
    const k = String(r.description).replace(/\s*\(.*?\)\s*/g, ' ').trim();
    if (seen.has(k.toLowerCase())) continue; seen.add(k.toLowerCase()); recent.push({ ...r, k });
    if (recent.length >= 8) break;
  }
  $('quick').innerHTML = recent.length ? `<small>Quick fill:</small>${recent.map((r, i) => `<button type="button" data-q="${i}" style="--c:${catLook(r.category_name).col}" title="${esc(r.category_name)} · last ${fmtMoney(r.amount)}">${catLook(r.category_name).ic}${esc(r.k)}</button>`).join('')}` : '';
  $('quick').onclick = e => {
    const b = e.target.closest('[data-q]'); if (!b) return; const r = recent[+b.dataset.q];
    $('expense-description').value = r.k; $('expense-amount').value = r.amount;
    const c = cats.find(x => x.category_name === r.category_name && x.active !== false); if (c) $('expense-category').value = c.category_id;
    setPay(r.payment_method); $('expense-amount').focus(); $('expense-amount').select();
  };
}
function resetForm() { $('expense-form').reset(); editingId = null; $('expense-date').value = today(); setPay(''); formMessage(''); }
function openForm(prefill = null, edit = false) {
  resetForm();
  editingId = edit ? prefill.expense_id : null;
  $('formTitle').innerHTML = `${I.wallet} ${edit ? `Edit draft ${esc(prefill.expense_no)}` : prefill ? 'Duplicate expense' : 'Add expense'}`;
  $('formSub').textContent = edit ? 'Only drafts can be edited. Posted expenses are changed by cancelling (reversal) and adding again.' : 'Save as a draft, or save and post it to the accounts now.';
  $('quick').hidden = !!prefill;
  if (prefill) {
    $('expense-date').value = edit ? prefill.expense_date : today();
    $('expense-description').value = prefill.description || '';
    $('expense-amount').value = prefill.amount || '';
    $('expense-reference').value = edit ? (prefill.reference || '') : '';
    $('expense-notes').value = prefill.notes || '';
    const c = cats.find(x => x.category_id === prefill.category_id) || cats.find(x => x.category_name === prefill.category_name && x.active !== false);
    if (c) $('expense-category').value = c.category_id;
    setPay(prefill.payment_method);
  } else quickChips();
  if (!$('expDlg').open) $('expDlg').showModal();
  $('expense-description').focus();
}
async function saveForm(andPost) {
  const amount = Number($('expense-amount').value);
  if (!Number.isFinite(amount) || amount <= 0) return formMessage('Enter an amount greater than zero.', true);
  const payload = { p_expense_id: editingId, p_expense_date: $('expense-date').value, p_category_id: $('expense-category').value, p_description: $('expense-description').value.trim(), p_amount: amount, p_payment_method: $('expense-payment').value, p_reference: $('expense-reference').value.trim() || null, p_notes: $('expense-notes').value.trim() || null };
  if (!payload.p_expense_date || !payload.p_category_id || !payload.p_description || !payload.p_payment_method) return formMessage('Complete all required fields.', true);
  if (payload.p_expense_date > today() && !confirm('The expense date is in the future. Save anyway?')) return;
  const dup = all.find(r => r.expense_id !== editingId && r.status !== 'cancelled' && r.expense_date === payload.p_expense_date && Math.abs(r.amount - amount) < .005 && r.description.toLowerCase() === payload.p_description.toLowerCase());
  if (dup && !confirm(`${dup.expense_no} already has the same title, date and amount. Save another one?`)) return;
  if (andPost && !confirm(`Save and post ${fmtMoney(amount)}? Posting creates permanent ledger entries; it can later only be cancelled with a reversal.`)) return;
  const btns = [$('expense-save-draft'), $('expense-save-post')]; btns.forEach(b => { b.disabled = true; });
  formMessage('Saving…');
  try {
    const { data: id, error } = await sb.rpc('expense_save_draft', payload);
    if (error) return formMessage(friendly(error), true);
    const file = $('expense-receipt').files?.[0];
    let rcMsg = '';
    if (file) { const r = await uploadReceipt(id, file); rcMsg = r.ok ? ' Receipt attached.' : ` Receipt not attached: ${r.msg}`; }
    let postMsg = '';
    if (andPost) { const { error: pe } = await sb.rpc('expense_post', { p_expense_id: id }); postMsg = pe ? ` Saved as draft but not posted: ${friendly(pe)}` : ' Posted to the ledger.'; }
    $('expDlg').close();
    await reloadAll();
    const no = all.find(r => r.expense_id === id)?.expense_no || '';
    message(`${editingId ? 'Draft updated' : 'Draft saved successfully'}. Expense ${no}.${postMsg}${rcMsg}`, /not /.test(postMsg + rcMsg));
  } finally { btns.forEach(b => { b.disabled = false; }); }
}
$('expense-form').addEventListener('submit', e => { e.preventDefault(); saveForm(false); });
$('expense-save-post').onclick = () => saveForm(true);
$('expense-form-clear').onclick = () => { const id = editingId; resetForm(); editingId = id; };
$('newCat').onclick = async () => {
  const name = prompt('New expense category name (2–60 characters):'); if (!name) return;
  const { data, error } = await sb.rpc('expense_category_add', { p_name: name.trim() });
  if (error) return formMessage(friendly(error), true);
  await loadCategories(); $('expense-category').value = data; formMessage(`Category “${name.trim()}” added.`);
};

// ---------------------------------------------------------------------------
// Receipts (existing private bucket + expense_register_receipt)
// ---------------------------------------------------------------------------
const receiptBucket = sb.storage.from('expense-receipts');
const allowedReceiptTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const maxReceiptBytes = 15 * 1024 * 1024;
const receiptExtension = f => ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[f.type] || '';
async function uploadReceipt(expenseId, file) {
  if (!allowedReceiptTypes.includes(file.type) || file.size <= 0 || file.size > maxReceiptBytes) return { ok: false, msg: 'Choose a PDF, JPEG, PNG or WebP file up to 15 MB.' };
  const path = `${expenseId}/${crypto.randomUUID()}.${receiptExtension(file)}`;
  const { error: uploadError } = await receiptBucket.upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, msg: friendly(uploadError) };
  const { data, error } = await sb.rpc('expense_register_receipt', { p_expense_id: expenseId, p_storage_path: path, p_file_name: file.name });
  // The bucket intentionally has no client DELETE policy; report registration failure for controlled cleanup.
  if (error) return { ok: false, msg: `File uploaded but receipt registration failed: ${friendly(error)}. Please contact an administrator for cleanup.` };
  return { ok: true, id: data };
}
let pendingReceipt = null;
async function onReceiptPicked(input) {
  const file = input.files?.[0]; input.value = '';
  if (!pendingReceipt || !file) return;
  message(`Uploading receipt for ${pendingReceipt.no || 'expense'}…`);
  const r = await uploadReceipt(pendingReceipt.id, file);
  if (!r.ok) return message(r.msg, true);
  await reloadAll();
  message(`Receipt uploaded and registered successfully. Receipt ID: ${r.id}`);
  if ($('viewDlg').open) openView(pendingReceipt.id);
}
$('expense-camera-input').addEventListener('change', () => onReceiptPicked($('expense-camera-input')));
$('expense-file-input').addEventListener('change', () => onReceiptPicked($('expense-file-input')));
const pickReceipt = (r, camera) => { pendingReceipt = { id: r.expense_id, no: r.expense_no }; (camera ? $('expense-camera-input') : $('expense-file-input')).click(); };
async function showExpenseReceipts(expenseId, expenseNo) {
  $('expense-receipts-title').textContent = `Receipts — ${expenseNo || 'Expense'}`;
  $('expense-receipts-list').textContent = 'Loading receipts…';
  $('expense-receipts-dialog').showModal();
  const { data, error } = await sb.rpc('expense_get_detail', { p_expense_id: expenseId });
  if (error) { $('expense-receipts-list').textContent = friendly(error); return; }
  $('expense-receipts-list').innerHTML = receiptList(data || []) || 'No receipts attached to this expense.';
}
const receiptList = rows => rows.filter(x => x.receipt_id).map(x => `<div class="expense-receipt-item ex-rc"><span>${I.file}</span><div><strong>${esc(x.receipt_file_name || 'Receipt')}</strong><br><small>${esc(x.receipt_mime_type || '')} · ${(num(x.receipt_file_size) / 1024 / 1024).toFixed(2)} MB · ${esc(when(x.receipt_uploaded_at))}</small></div><button type="button" class="pos-btn pos-btn-sm" data-receipt-open="${esc(x.receipt_storage_path)}">Open</button></div>`).join('');
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-receipt-open]'); if (!b) return;
  b.disabled = true;
  const { data, error } = await receiptBucket.createSignedUrl(b.dataset.receiptOpen, 300);
  b.disabled = false;
  if (error) return toast(`Unable to open receipt: ${friendly(error)}`, true);
  window.open(data.signedUrl, '_blank', 'noopener');
});

// ---------------------------------------------------------------------------
// Post / cancel (existing), details, voucher, row menu
// ---------------------------------------------------------------------------
async function postExpense(r) {
  if (!confirm(`Post ${r.expense_no}? This will create permanent financial ledger entries. You can cancel later only through a reversal.`)) return;
  const { data, error } = await sb.rpc('expense_post', { p_expense_id: r.expense_id });
  if (error) return message(friendly(error), true);
  await reloadAll();
  message(`Expense ${r.expense_no} posted successfully. Journal ID: ${data}`);
  if ($('viewDlg').open) openView(r.expense_id);
}
async function cancelExpense(r) {
  const reason = window.prompt(`Enter the reason for cancelling ${r.expense_no}:`);
  if (reason === null) return;
  if (!reason.trim()) return message('A cancellation reason is required.', true);
  if (!confirm(`Cancel ${r.expense_no}? This will create a reversal journal. Original ledger entries will remain unchanged.`)) return;
  const { data, error } = await sb.rpc('expense_cancel', { p_expense_id: r.expense_id, p_reason: reason.trim() });
  if (error) return message(friendly(error), true);
  await reloadAll();
  message(`Expense ${r.expense_no} cancelled successfully. Reversal journal ID: ${data}`);
  if ($('viewDlg').open) openView(r.expense_id);
}
async function detail(id) {
  const { data, error } = await sb.rpc('expense_get_detail', { p_expense_id: id });
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) throw new Error('Expense not found');
  const names = {};
  const ids = [...new Set([rows[0].created_by, rows[0].posted_by, rows[0].cancelled_by].filter(Boolean))];
  if (ids.length) { const { data: ps } = await sb.from('profiles').select('id,full_name').in('id', ids); for (const p of ps || []) names[p.id] = p.full_name; }
  return { ...rows[0], receipts: rows.filter(x => x.receipt_id), names };
}
function voucherHTML(d) {
  return `<div style="font:13px/1.5 Arial,sans-serif;color:#000;padding:10mm;max-width:180mm">
    <div style="display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:6px"><b style="font-size:18px">PALLIKKAL PHARMACY</b><div style="text-align:right"><b style="font-size:16px">PAYMENT VOUCHER</b><br>${esc(d.expense_no)}</div></div>
    <table style="width:100%;margin-top:12px;border-collapse:collapse" cellpadding="6">
      <tr><td style="width:35%">Date</td><td><b>${esc(dmy(d.expense_date))}</b></td></tr>
      <tr><td>Paid for</td><td><b>${esc(d.description)}</b></td></tr>
      <tr><td>Category</td><td>${esc(d.category_name)}</td></tr>
      <tr><td>Amount</td><td><b style="font-size:16px">₹${money2(d.amount)}</b></td></tr>
      <tr><td>Paid by</td><td>${esc(PAY[d.payment_method]?.[0] || d.payment_method)}${d.reference ? ` · Ref ${esc(d.reference)}` : ''}</td></tr>
      ${d.notes ? `<tr><td>Notes</td><td>${esc(d.notes)}</td></tr>` : ''}
      <tr><td>Status</td><td>${esc(STATUS[d.status]?.[0] || d.status)}${d.status === 'cancelled' ? ` — ${esc(d.cancellation_reason || '')}` : ''}</td></tr>
    </table>
    <p style="margin-top:40px;display:flex;justify-content:space-between"><span>Prepared by: ${esc(d.names[d.created_by] || '')}</span><span>Approved by: ______________</span><span>Received by: ______________</span></p></div>`;
}
async function openView(id) {
  $('viewBody').innerHTML = '<p class="dl-muted">Loading expense…</p>';
  if (!$('viewDlg').open) $('viewDlg').showModal();
  let d; try { d = await detail(id); } catch (e) { $('viewBody').innerHTML = `<p class="pos-form-msg">${esc(friendly(e))}</p>`; return; }
  const r = all.find(x => x.expense_id === id) || d, [sl, sc, st] = STATUS[d.status] || [d.status, 'off', ''], lk = catLook(d.category_name);
  $('viewBody').innerHTML = `
    <div class="sl-bill-head"><span class="pos-title-ic sl-bill-ic ex-ic-big" style="--c:${lk.col}">${lk.ic}</span>
      <div><h3>${esc(d.description)} <span class="md-chip sl-st ${sc}" title="${esc(st)}">${sc === 'in' ? I.check : '<i></i>'}${esc(sl)}</span></h3>
      <p class="dl-muted">${esc(d.expense_no)} · ${esc(dmy(d.expense_date))} · <span class="ex-cat" style="--c:${lk.col}">${esc(d.category_name)}</span></p></div></div>
    <div class="sl-kv">
      <div><small>Amount</small><b class="ex-amt">${fmtMoney(d.amount)}</b></div>
      <div><small>Payment</small><b>${esc(PAY[d.payment_method]?.[0] || d.payment_method)}${d.reference ? `<br><span class="dl-muted">Ref ${esc(d.reference)}</span>` : ''}</b></div>
      <div><small>Created</small><b>${esc(d.names[d.created_by] || '—')}<br><span class="dl-muted">${esc(when(d.created_at))}</span></b></div>
      <div><small>${d.status === 'cancelled' ? 'Cancelled' : 'Posted'}</small><b>${d.status === 'draft' ? 'Not posted yet' : d.status === 'cancelled' ? `${esc(d.names[d.cancelled_by] || '')}<br><span class="dl-muted">${esc(when(d.cancelled_at))} · ${esc(d.cancellation_reason || '')}</span>` : `${esc(d.names[d.posted_by] || '')}<br><span class="dl-muted">${esc(when(d.posted_at))}</span>`}</b></div>
    </div>
    ${d.notes ? `<p class="ex-notes"><b>Notes:</b> ${esc(d.notes)}</p>` : ''}
    <h4 class="sl-sub">${I.clip} Receipts (${d.receipts.length})</h4>
    <div class="ex-rcs">${receiptList(d.receipts) || '<p class="dl-muted">No receipt attached yet.</p>'}</div>
    <div class="pos-dialog-foot sl-bill-acts">
      ${d.status === 'draft' ? `<button type="button" class="pos-btn pos-btn-solid" data-vact="post">${I.send}<span>Post</span></button><button type="button" class="pos-btn" data-vact="edit">${I.pencil}<span>Edit</span></button>` : ''}
      ${d.status !== 'cancelled' ? `<button type="button" class="pos-btn" data-vact="camera">${I.camera}<span>Take photo</span></button><button type="button" class="pos-btn" data-vact="file">${I.clip}<span>Upload file</span></button>` : ''}
      <button type="button" class="pos-btn" data-vact="dup">${I.copy}<span>Duplicate</span></button>
      <button type="button" class="pos-btn" data-vact="print">${I.print}<span>Voucher</span></button>
      ${d.status === 'posted' ? `<button type="button" class="pos-btn ex-danger" data-vact="cancel">${I.ban}<span>Cancel expense</span></button>` : ''}
    </div>`;
  $('viewBody').onclick = e => {
    const a = e.target.closest('[data-vact]')?.dataset.vact; if (!a) return;
    if (a === 'post') return postExpense(r);
    if (a === 'cancel') return cancelExpense(r);
    if (a === 'edit') { $('viewDlg').close(); return openForm({ ...r, ...d }, true); }
    if (a === 'dup') { $('viewDlg').close(); return openForm({ ...r, ...d }); }
    if (a === 'camera' || a === 'file') return pickReceipt(r, a === 'camera');
    if (a === 'print') return printHTML(voucherHTML(d), d.expense_no, 'a4');
  };
}
let menuEl = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
function menuHtml(r) {
  const b = (a, ic, l, cls = '') => `<button type="button" data-act="${a}" class="${cls}" ${a === 'post' ? `data-expense-post="${esc(r.expense_id)}"` : ''}>${ic}<span>${l}</span></button>`;
  return [
    b('view', I.eye, 'View details'),
    r.status === 'draft' ? b('post', I.send, 'Post to ledger') : '',
    r.status === 'draft' ? b('edit', I.pencil, 'Edit draft') : '',
    r.status !== 'cancelled' ? b('camera', I.camera, 'Take receipt photo') : '',
    r.status !== 'cancelled' ? b('file', I.clip, 'Upload receipt file') : '',
    r.receipt_count ? b('receipts', I.file, `View receipts (${r.receipt_count})`) : '',
    b('dup', I.copy, 'Duplicate'), b('print', I.print, 'Print voucher'),
    r.status === 'posted' ? b('cancel', I.ban, 'Cancel expense', 'danger') : ''
  ].join('');
}
$('expense-rows').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const r = listRows.find(x => x.expense_id === tr.dataset.id);
  const m = e.target.closest('[data-menu]');
  if (m) { e.stopPropagation(); if (menuEl && menuEl.parentElement === m.parentElement) return closeMenu(); closeMenu(); menuEl = document.createElement('div'); menuEl.className = 'dl-pop md-menu md-row-menu pur-row-menu'; menuEl.innerHTML = menuHtml(r); m.parentElement.append(menuEl); return; }
  const a = e.target.closest('[data-act]');
  if (a) {
    e.stopPropagation(); closeMenu();
    const act = a.dataset.act;
    if (act === 'view') return openView(r.expense_id);
    if (act === 'post') return postExpense(r);
    if (act === 'cancel') return cancelExpense(r);
    if (act === 'camera' || act === 'file') return pickReceipt(r, act === 'camera');
    if (act === 'receipts') return showExpenseReceipts(r.expense_id, r.expense_no);
    try {
      const d = await detail(r.expense_id);
      if (act === 'edit') return openForm({ ...r, ...d }, true);
      if (act === 'dup') return openForm({ ...r, ...d });
      if (act === 'print') return printHTML(voucherHTML(d), d.expense_no, 'a4');
    } catch (err) { message(friendly(err), true); }
    return;
  }
  return openView(r.expense_id);
});
document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });

// ---------------------------------------------------------------------------
// More: copy last month, categories, reports (existing expense_get_summary), export, print
// ---------------------------------------------------------------------------
function copyDialog() {
  const list = recurring();
  dlg(`<h3 class="rt-dlg-title">${I.repeat} Copy last month's regular expenses</h3>
    <p class="dl-muted">Expenses from last month that are not recorded yet this month. Tick the ones to copy — each becomes a <b>draft</b> dated today with last month's amount. Check the amount, then post.</p>
    ${list.length ? `<div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th><input type="checkbox" id="cpAll" checked aria-label="Select all"></th><th>Expense</th><th>Category</th><th class="c-r">Last month</th><th class="c-r">Amount now</th></tr></thead>
    <tbody>${list.map((r, i) => `<tr><td><input type="checkbox" class="cp" data-i="${i}" checked aria-label="Copy ${esc(r.description)}"></td><td><b>${esc(r.description)}</b><br><small class="dl-muted">${esc(dmy(r.expense_date))} · ${esc(PAY[r.payment_method]?.[0] || '')}</small></td><td>${esc(r.category_name)}</td><td class="c-r">${fmtMoney(r.amount)}</td><td class="c-r"><input type="number" class="cpAmt" data-i="${i}" value="${r.amount}" min="0.01" step="0.01" style="width:110px"></td></tr>`).join('')}</tbody></table></div>
    <p class="pos-form-msg" id="cpMsg"></p><div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="cpGo">${I.copy}<span>Create drafts</span></button></div>`
    : '<p class="dl-muted">Everything from last month is already recorded this month. 👍</p>'}`);
  if (!list.length) return;
  $('cpAll').onchange = () => $('puPanel').querySelectorAll('.cp').forEach(c => { c.checked = $('cpAll').checked; });
  $('cpGo').onclick = async () => {
    const pick = [...$('puPanel').querySelectorAll('.cp:checked')].map(c => +c.dataset.i);
    if (!pick.length) return ($('cpMsg').textContent = 'Tick at least one expense.');
    $('cpGo').disabled = true; let ok = 0; const bad = [];
    for (const i of pick) {
      const r = list[i], amt = num($('puPanel').querySelector(`.cpAmt[data-i="${i}"]`).value);
      const d = await detail(r.expense_id).catch(() => null);
      const cat = d?.category_id || cats.find(c => c.category_name === r.category_name)?.category_id;
      const { error } = await sb.rpc('expense_save_draft', { p_expense_id: null, p_expense_date: today(), p_category_id: cat, p_description: r.description.replace(/\s*\(partial\)/i, ''), p_amount: amt, p_payment_method: r.payment_method, p_reference: null, p_notes: `Copied from ${r.expense_no}` });
      if (error) bad.push(`${r.description}: ${friendly(error)}`); else ok++;
    }
    $('puDlg').close(); await reloadAll();
    filt.status = 'draft'; await loadExpenses();
    message(`${ok} draft(s) created from last month.${bad.length ? ' Not created: ' + bad.join('; ') : ''} Check the amounts and post them.`, !!bad.length);
  };
}
async function categoriesDialog() {
  await loadCategories();
  const used = new Map(); for (const r of posted(all)) used.set(r.category_name, (used.get(r.category_name) || 0) + r.amount);
  dlg(`<h3 class="rt-dlg-title">${I.tag} Expense categories</h3>
    <div class="ex-cat-add"><input id="catName" maxlength="60" placeholder="New category name, e.g. Water Bill"><button type="button" class="pos-btn pos-btn-solid" id="catAdd">${I.plusC}<span>Add</span></button></div>
    <div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Category</th><th class="c-r">Spent (2 yrs)</th><th>Status</th><th></th></tr></thead><tbody>
    ${cats.map(c => `<tr><td><span class="ex-cat" style="--c:${catLook(c.category_name).col}">${esc(c.category_name)}</span>${c.is_shared ? ' <small class="dl-muted">(Default — shared)</small>' : ''}</td><td class="c-r">${rupees0(used.get(c.category_name) || 0)}</td><td>${c.active !== false ? '<span class="md-chip in"><i></i>Active</span>' : '<span class="md-chip off"><i></i>Inactive</span>'}</td>
      <td class="c-r ex-cat-acts">${c.is_shared ? '' : `<button type="button" class="pos-btn pos-btn-sm" data-cren="${esc(c.category_id)}">Rename</button>${c.active !== false ? `<button type="button" class="pos-btn pos-btn-sm" data-coff="${esc(c.category_id)}">Deactivate</button>` : `<button type="button" class="pos-btn pos-btn-sm" data-con="${esc(c.category_id)}">Reactivate</button>`}`}</td></tr>`).join('') || '<tr><td colspan="4" class="dl-empty">No categories yet.</td></tr>'}
    </tbody></table></div><p class="pos-form-msg" id="catMsg"></p>`);
  const done = async (error, okMsg) => { if (error) { $('catMsg').textContent = friendly(error); return; } await reloadAll(); await categoriesDialog(); toast(okMsg); };
  $('catAdd').onclick = async () => { const n = $('catName').value.trim(); if (!n) return; const { error } = await sb.rpc('expense_category_add', { p_name: n }); done(error, `Category “${n}” added.`); };
  $('puPanel').onclick = async e => {
    const ren = e.target.closest('[data-cren]'), off = e.target.closest('[data-coff]'), on = e.target.closest('[data-con]');
    if (ren) { const c = cats.find(x => x.category_id === ren.dataset.cren), n = prompt('Rename category:', c.category_name); if (!n || n.trim() === c.category_name) return; const { error } = await sb.rpc('expense_category_rename', { p_category_id: c.category_id, p_new_name: n.trim() }); return done(error, 'Category renamed.'); }
    if (off) { if (!confirm('Deactivate this category? Old expenses keep it; it will not be offered for new ones.')) return; const { error } = await sb.rpc('expense_category_deactivate', { p_category_id: off.dataset.coff }); return done(error, 'Category deactivated.'); }
    if (on) { const { error } = await sb.rpc('expense_category_reactivate', { p_category_id: on.dataset.con }); return done(error, 'Category reactivated.'); }
  };
}
async function reportsDialog(from = monthStart(today()), to = today()) {
  dlg(`<h3 class="rt-dlg-title">${I.report} Expense reports</h3><p class="dl-muted">Posted expenses only. Drafts and cancelled expenses are excluded.</p>
    <div class="sl-dates ex-rep-dates"><div class="pos-field"><label for="expense-report-from">Report from</label><input id="expense-report-from" type="date" value="${from || ''}"></div><div class="pos-field"><label for="expense-report-to">Report to</label><input id="expense-report-to" type="date" value="${to || ''}"></div><button type="button" class="pos-btn pos-btn-solid" id="expense-report-apply">Apply</button><button type="button" class="pos-btn" id="expense-report-clear">All dates</button></div>
    <div id="expense-report-message" class="dl-muted" role="status"></div>
    <div class="ex-rep-grid">
      <section><h4 class="sl-sub">Daily expenses</h4><div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Date</th><th class="c-r">Count</th><th class="c-r">Total</th></tr></thead><tbody id="expense-report-daily"></tbody></table></div></section>
      <section><h4 class="sl-sub">Monthly expenses</h4><div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Month</th><th class="c-r">Count</th><th class="c-r">Total</th></tr></thead><tbody id="expense-report-monthly"></tbody></table></div></section>
      <section><h4 class="sl-sub">Category-wise expenses</h4><div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Category</th><th class="c-r">Count</th><th class="c-r">Total</th></tr></thead><tbody id="expense-report-category"></tbody></table></div></section>
    </div>`);
  $('expense-report-apply').onclick = () => reportsDialog($('expense-report-from').value || null, $('expense-report-to').value || null);
  $('expense-report-clear').onclick = () => reportsDialog(null, null);
  if (from && to && from > to) { $('expense-report-message').textContent = 'The report From date must be on or before the To date.'; return; }
  const { data, error } = await sb.rpc('expense_get_summary', { p_from: from, p_to: to });
  if (error) { $('expense-report-message').textContent = friendly(error); return; }
  const rows = data || [];
  const put = (type, id, label, sort) => { const r = rows.filter(x => x.summary_type === type).sort(sort); $(id).innerHTML = r.map(x => `<tr><td>${esc(x[label] || '')}</td><td class="c-r">${num(x.expense_count)}</td><td class="c-r">${fmtMoney(x.total_amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="dl-empty">No posted expenses in this period.</td></tr>'; };
  put('daily', 'expense-report-daily', 'period', (a, b) => String(b.period).localeCompare(String(a.period)));
  put('monthly', 'expense-report-monthly', 'period', (a, b) => String(b.period).localeCompare(String(a.period)));
  put('category', 'expense-report-category', 'category_name', (a, b) => num(b.total_amount) - num(a.total_amount));
  $('expense-report-message').textContent = rows.length ? 'Reports updated.' : 'No posted expenses found for this period.';
}
function exportRows() {
  return filtered().map(r => ({ 'Expense No.': r.expense_no, Date: r.expense_date, Title: r.description, Category: r.category_name, 'Amount (₹)': r.amount, 'Payment method': PAY[r.payment_method]?.[0] || r.payment_method, Reference: r.reference || '', Status: STATUS[r.status]?.[0] || r.status, Receipts: r.receipt_count }));
}
function writeSheet(list, name, csv = false) {
  if (window.XLSX && !csv) { const ws = XLSX.utils.json_to_sheet(list); ws['!cols'] = Object.keys(list[0]).map(k => ({ wch: k === 'Title' ? 40 : Math.max(12, k.length + 2) })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Expenses'); XLSX.writeFile(wb, name + '.xlsx'); return; }
  const keys = Object.keys(list[0]);
  const text = [keys, ...list.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
}
const doExport = csv => { const l = exportRows(); if (!l.length) return toast('Nothing to export for these filters.', true); writeSheet(l, `Pallikkal_Expenses_${filt.from}_to_${filt.to}`, csv); toast(`${l.length} expense(s) exported.`); };
function printList() {
  const l = exportRows(); if (!l.length) return toast('Nothing to print.', true);
  const H = ['Date', 'Expense No.', 'Title', 'Category', 'Payment method', 'Status', 'Amount (₹)'];
  printHTML(`<div style="font:12px Arial,sans-serif;padding:10px"><h2>PALLIKKAL PHARMACY — Expenses ${esc($('rangeLabel').textContent)}</h2><p>${l.length} expense(s) · Posted total ${esc(fmtMoney(l.filter(r => r.Status === 'Completed').reduce((a, r) => a + r['Amount (₹)'], 0)))}</p><table style="width:100%;border-collapse:collapse" border="1" cellpadding="4"><tr>${H.map(h => `<th align="left">${h}</th>`).join('')}</tr>${l.map(r => `<tr>${H.map(h => `<td ${h.includes('₹') ? 'align="right"' : ''}>${esc(typeof r[h] === 'number' ? money2(r[h]) : r[h])}</td>`).join('')}</tr>`).join('')}</table></div>`, 'Expenses', 'a4');
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
$('addExpense').onclick = () => openForm();
$('exportBtn').onclick = () => doExport(false);
$('moreBtn').onclick = e => { e.stopPropagation(); $('moreMenu').hidden = !$('moreMenu').hidden; };
document.addEventListener('click', e => { if (!$('moreMenu').hidden && !e.target.closest('#moreMenu')) $('moreMenu').hidden = true; });
$('moreMenu').onclick = e => {
  const b = e.target.closest('[data-more]'); if (!b) return;
  $('moreMenu').hidden = true;
  ({ copy: copyDialog, drafts: () => goList({ status: 'draft' }, 'all'), cats: categoriesDialog, reports: () => reportsDialog(), csv: () => doExport(true), print: printList })[b.dataset.more]();
};
let deb; $('eq').oninput = () => { clearTimeout(deb); deb = setTimeout(() => { page = 1; draw(); }, 200); };
$('perPage').onchange = () => { page = 1; draw(); };
$('fPeriod').onchange = async () => { filt.period = $('fPeriod').value; page = 1; await loadExpenses(); };
$('pager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); draw(); } };
$('viewAll').onclick = () => { compact = false; draw(); };
$('filterBtn').onclick = e => {
  e.stopPropagation();
  if ($('filterPop').hidden) { $('expense-from').value = filt.from; $('expense-to').value = filt.to; $('expense-status').value = filt.status; $('fCat').value = filt.cat; $('fPay').value = filt.pay; $('fRcpt').value = filt.receipt; $('fMin').value = filt.min; $('fSort').value = filt.sort; }
  $('filterPop').hidden = !$('filterPop').hidden;
};
$('filterPop').onclick = e => e.stopPropagation();
document.addEventListener('click', () => { $('filterPop').hidden = true; });
$('expense-apply').onclick = async () => {
  let from = $('expense-from').value, to = $('expense-to').value;
  if (from && to && from > to) return toast('The From date must be on or before the To date.', true);
  Object.assign(filt, { status: $('expense-status').value, cat: $('fCat').value, pay: $('fPay').value, receipt: $('fRcpt').value, min: $('fMin').value, sort: $('fSort').value });
  $('filterPop').hidden = true; page = 1;
  const [pf, pt] = windowFor(filt.period);
  if ((from || pf) !== pf || (to || pt) !== pt) { filt.period = 'custom'; filt.from = from || pf; filt.to = to || pt; }
  await loadExpenses();
};
$('expense-clear').onclick = async () => { Object.assign(filt, { period: 'month', status: '', cat: '', pay: '', receipt: '', min: '', sort: 'new' }); $('eq').value = ''; $('filterPop').hidden = true; page = 1; await loadExpenses(); };
const goList = async (patch, period) => { Object.assign(filt, { status: '', cat: '', pay: '', receipt: '' }, patch); if (period) filt.period = period; page = 1; await loadExpenses(); $('expense-rows').closest('.rt-list').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
$('catLegend').onclick = e => { const b = e.target.closest('[data-cat]'); if (b && b.dataset.cat) goList({ cat: b.dataset.cat, status: 'posted' }, $('catPeriod').value); };
$('catPeriod').onchange = renderCategories;
$('trendRange').onchange = drawChart;
$('sumTiles').onclick = e => { const b = e.target.closest('[data-goto]'); if (b) goList({ status: 'posted' }, b.dataset.goto); };
$('sumMore').onclick = e => { const b = e.target.closest('[data-goto]'); if (!b) return; b.dataset.goto === 'draft' ? goList({ status: 'draft' }, 'all') : goList({ status: 'posted', receipt: 'no' }, 'month'); };
document.querySelector('.md-kpis').onclick = e => { const b = e.target.closest('[data-kpi]'); if (b) goList({ status: 'posted' }, b.dataset.kpi === 'kYear' ? 'year' : 'month'); };
let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(drawChart, 120); }).observe($('chart'));
matchMedia('(max-width: 560px)').addEventListener('change', ev => { compact = ev.matches; page = 1; draw(); });

// ---------------------------------------------------------------------------
// Start — ?new=1 (dashboard: Add Expense), ?status=draft, ?copy=1, ?q=
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
if (params.get('status') && STATUS[params.get('status')]) { filt.status = params.get('status'); filt.period = 'all'; }
if (params.get('q')) { $('eq').value = params.get('q'); filt.period = 'all'; }
$('expense-date').value = today();
await reloadAll();
// Dashboard quick action: expenses.html?new=1 jumps to the new-expense form.
if (params.get('new') === '1') openForm();
if (params.get('copy') === '1') copyDialog();
