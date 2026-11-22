// Reports & Analytics — Pallikkal Pharmacy design.
// Header: date range picker, Generate Report, Export. Report types (Sales, Purchase, Inventory,
// Customer, Distributor, Expense, Finance, Returns, Custom) open the report generator with every
// existing report (17: the 13 original report_* reports + sales by category, top customers, top
// selling medicines, stock valuation). Report Overview for the selected range vs the previous range
// of the same length, Sales Trend, Sales by Category, Key Insights, Recent Reports (who generated
// what — 0029 report_runs, re-run / download any time) and Quick Reports. PDF / Excel / CSV / print.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { printHTML } from './invoice.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';
import { REPORTS } from './report-defs.js';
import { fmt, fmtDate, totalsOf, downloadPdf, downloadXlsx } from './export.js';

const prof = await mountShell('reports', 'Reports', { layout: 'brand' });
const $ = id => document.getElementById(id);
const role = String(prof?.role || '').toLowerCase();
if (!['super_admin', 'admin'].includes(role)) { $('view').innerHTML = '<p class="notice">Only Admin and Super Admin can view reports.</p>'; throw new Error('Reports access denied'); }
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

const TZ = 'Asia/Kolkata';
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money2 = v => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = v => `${num(v) < 0 ? '−' : ''}₹${money2(Math.abs(num(v)))}`;
const rupees0 = v => `${num(v) < 0 ? '−' : ''}₹${Math.round(Math.abs(num(v))).toLocaleString('en-IN')}`;
const count = n => new Intl.NumberFormat('en-IN').format(num(n));
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const monthStart = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10); };
const monthEnd = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - back, 0)).toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const dmy = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const dm = d => new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const when = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, s => s.toUpperCase()) : '—';
const nowLabel = () => when(new Date().toISOString());
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  report: svg('<path d="M4 20V10"/><path d="M9.3 20V4"/><path d="M14.6 20v-7"/><path d="M20 20V8"/><path d="M2 21h20"/>', 2),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 1.9),
  play: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 16V12M12 16V8M16 16v-6"/>', 1.9),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  bars: svg('<path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/>', 2.2),
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21.5 8H6.1"/>', 1.9),
  box: svg('<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>', 1.8),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>', 1.9),
  users: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.3c2.9.3 5 2.6 5 5.7"/>', 1.8),
  truck: svg('<path d="M3 6h11v10H3Z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', 1.8),
  wallet: svg('<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11v3"/><path d="M15 12h5v4h-5a2 2 0 0 1 0-4Z"/>', 1.8),
  rupee: svg('<path d="M6 4h12M6 9h12M14 20 7 13h3a4.5 4.5 0 0 0 0-9"/>', 2),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>', 1.9),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', 1.9),
  trend: svg('<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>', 2),
  pct: svg('<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>', 2),
  pie: svg('<path d="M21 12A9 9 0 1 1 12 3v9Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/>', 1.9),
  bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V17h5v-1.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3Z"/>', 1.9),
  doc: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>', 1.9),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>', 1.9),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  pill: svg('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>', 1.9),
  star: svg('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>', 1.8),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>', 1.8),
  today: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><rect x="7" y="13" width="4" height="4" rx=".8"/>', 1.9),
  month: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2"/>', 1.9),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  down: svg('<path d="m6 9 6 6 6-6"/>', 2.2),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  sheet: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>', 1.8),
  pdf: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M8 17v-4h1.5a1.3 1.3 0 0 1 0 2.6H8M13 17v-4h1a2 2 0 0 1 0 4ZM18 13h-2v4M16 15h1.6"/>', 1.5),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 1.9),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  warn: svg('<path d="M12 3 2 21h20Z"/><path d="M12 10v4M12 17.5v.01"/>', 2),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  dn: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};

// ---------------------------------------------------------------------------
// Report types (tiles) → existing reports
// ---------------------------------------------------------------------------
const TYPES = [
  { k: 'sales', label: 'Sales Report', ic: I.bars, col: 'g', ids: ['sales', 'period', 'medicines', 'topmeds', 'category'] },
  { k: 'purchase', label: 'Purchase Report', ic: I.cart, col: 'b', ids: ['purchases'] },
  { k: 'inventory', label: 'Inventory Report', ic: I.box, col: 'p', ids: ['valuation', 'stock', 'expiry'] },
  { k: 'customer', label: 'Customer Report', ic: I.user, col: 'a', ids: ['customers', 'topcustomers'] },
  { k: 'distributor', label: 'Distributor Report', ic: I.truck, col: 'b', ids: ['distributors'] },
  { k: 'expense', label: 'Expense Report', ic: I.wallet, col: 'r', ids: ['expenses'] },
  { k: 'finance', label: 'Finance Report', ic: I.rupee, col: 'g', ids: ['pnl', 'tax', 'ledger'] },
  { k: 'returns', label: 'Returns Report', ic: I.undo, col: 'a', ids: ['returns'] },
  { k: 'custom', label: 'Custom Report', ic: I.sliders, col: 'n', ids: REPORTS.map(r => r.id) }
];
const typeOf = id => (TYPES.find(t => t.k !== 'custom' && t.ids.includes(id)) || TYPES[8]).k;
const TYPE_CHIP = { sales: ['Sales', 'in'], purchase: ['Purchase', 'blue'], inventory: ['Inventory', 'pu'], customer: ['Customer', 'low'], distributor: ['Distributor', 'blue'], expense: ['Expense', 'out'], finance: ['Finance', 'in'], returns: ['Returns', 'low'], custom: ['Custom', 'off'] };
const GROUPS = [['Overview', ['period']], ['Sales', ['sales', 'medicines', 'topmeds', 'category', 'customers', 'topcustomers', 'returns']], ['Purchases', ['purchases', 'distributors']], ['Inventory', ['valuation', 'stock', 'expiry']], ['Finance & tax', ['expenses', 'tax', 'pnl', 'ledger']]];
const defOf = id => REPORTS.find(r => r.id === id);
const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['d7', 'Last 7 Days'], ['week', 'This Week'], ['month', 'This Month'], ['last', 'Last Month'], ['d30', 'Last 30 Days'], ['quarter', 'This Quarter'], ['fy', 'This Financial Year'], ['year', 'This Year']];
function presetRange(k) {
  const t = todayIso();
  const [y, m] = t.split('-').map(Number);
  switch (k) {
    case 'today': return [t, t];
    case 'yesterday': return [addDays(t, -1), addDays(t, -1)];
    case 'd7': return [addDays(t, -6), t];
    case 'week': return [addDays(t, -((new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7)), t];
    case 'month': return [monthStart(t), t];
    case 'last': return [monthStart(t, 1), monthEnd(t, 1)];
    case 'd30': return [addDays(t, -29), t];
    case 'quarter': return [new Date(Date.UTC(y, Math.floor((m - 1) / 3) * 3, 1)).toISOString().slice(0, 10), t];
    case 'fy': return [`${m >= 4 ? y : y - 1}-04-01`, t];
    case 'year': return [`${y}-01-01`, t];
    case 'all': return ['', ''];
    default: return [monthStart(t), t];
  }
}
const rangeText = (f, t) => !f && !t ? 'All dates' : f === t ? dmy(f) : `${f ? dmy(f) : 'Beginning'} – ${t ? dmy(t) : 'Today'}`;
const periodText = (def, a) => !def.params.includes('range') ? (def.params.includes('days') ? `Expiring within ${a.days} days` : `As on ${dmy(a.on || todayIso())}`) : rangeText(a.from, a.to);

const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
const QUICK = [
  { k: 'today', ic: I.today, col: 'g', t: "Today's Sales Report", d: 'Invoice-wise sales for today', run: () => ({ id: 'sales', from: todayIso(), to: todayIso() }) },
  { k: 'month', ic: I.month, col: 'b', t: "This Month's Summary", d: 'Day-wise sales, purchases & expenses', run: () => ({ id: 'period', from: monthStart(todayIso()), to: todayIso(), bucket: 'day' }) },
  { k: 'valuation', ic: I.layers, col: 'p', t: 'Stock Valuation Report', d: 'Stock in hand at cost and selling price', run: () => ({ id: 'valuation' }) },
  { k: 'topcust', ic: I.users, col: 'a', t: 'Top Customers Report', d: 'Best customers this month', run: () => ({ id: 'topcustomers', from: monthStart(todayIso()), to: todayIso() }) },
  { k: 'topmeds', ic: I.pill, col: 'r', t: 'Top Selling Medicines Report', d: 'Best sellers this month by quantity', run: () => ({ id: 'topmeds', from: monthStart(todayIso()), to: todayIso() }) }
];
const CAT_COLS = ['#12a01b', '#1e8fe8', '#f5b800', '#9b6cf2', '#e5484d', '#98a2b3'];

let [rangeFrom, rangeTo] = presetRange('month');
let rangeKey = 'month';
let activeType = 'sales';
let has29 = true;
let ov = null;        // reports_overview
let cats = [];        // sales by category
let runs = [];        // recent reports
let trend = [];
let shop = 'PALLIKKAL MEDICALS';
let compact = matchMedia('(max-width: 560px)').matches;

$('view').innerHTML = `
<div class="pos dl md pur rp">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.report}</span>
      <div><h1>Reports &amp; Analytics</h1><p>Generate, view, and download detailed reports for your pharmacy.</p></div></div>
    <div class="pos-head-actions md-head-actions rp-head-actions">
      <div class="dl-pop-anchor rp-range-anchor"><button type="button" class="pos-btn rp-range-btn" id="rangeBtn" aria-expanded="false" aria-haspopup="dialog">${I.cal}<span id="rangeLabel"></span>${I.down}</button>
        <div class="dl-pop rp-range-pop" id="rangePop" hidden>
          <div class="rp-presets" id="presets">${PRESETS.map(([k, l]) => `<button type="button" data-p="${k}">${l}</button>`).join('')}</div>
          <div class="sl-dates rp-dates"><div class="pos-field"><label for="hFrom">From</label><input id="hFrom" type="date"></div><div class="pos-field"><label for="hTo">To</label><input id="hTo" type="date"></div></div>
          <p class="pos-form-msg" id="rangeErr"></p>
          <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="rangeCancel">Cancel</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="rangeApply">Apply</button></div>
        </div></div>
      <button type="button" class="pos-btn pos-btn-solid" id="gen">${I.play}<span>Generate Report</span></button>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn" id="exportBtn" aria-expanded="false">${I.download}<span>Export</span></button>
        <div class="dl-pop md-menu ds-menu rp-export" id="exportMenu" hidden>
          <button type="button" data-exp="ovpdf">${I.pdf}<span>Report overview (PDF)</span></button>
          <button type="button" data-exp="ovxls">${I.sheet}<span>Report overview (Excel)</span></button>
          <button type="button" data-exp="daily">${I.bars}<span>Daily sales, purchases &amp; expenses (Excel)</span></button>
          <button type="button" data-exp="cats">${I.pie}<span>Sales by category (Excel)</span></button>
          <button type="button" data-exp="print">${I.print}<span>Print overview</span></button>
        </div></div>
    </div>
  </section>

  <section class="rp-types" id="types" role="tablist" aria-label="Report types">
    ${TYPES.map((t, i) => `<button type="button" role="tab" class="rp-type ${t.col}${i >= 4 ? ' rp-more-only' : ''}" data-type="${t.k}"><span class="rp-type-ic">${t.ic}</span><span>${t.label}</span></button>`).join('')}
    <button type="button" class="rp-type n rp-more-btn" id="typesMore"><span class="rp-type-ic">${I.grid}</span><span>More</span></button>
  </section>

  <div id="pmsg" class="md-msg" role="status"></div>

  <section class="pos-card rp-overview">
    <div class="dl-card-head"><h2>Report Overview <small id="ovLabel"></small></h2><span class="dl-muted rp-vs" id="ovVs"></span></div>
    <div class="dz-kpis md-kpis rp-kpis">
      ${KPI('green', I.bars, 'Total Sales', 'kSales')}
      ${KPI('blue', I.cart, 'Total Purchases', 'kPur')}
      ${KPI('amber', I.wallet, 'Total Expenses', 'kExp')}
      ${KPI('purple', I.trend, 'Net Profit', 'kNet')}
      ${KPI('teal', I.pct, 'Profit Margin', 'kMargin')}
    </div>
  </section>

  <div class="rp-grid">
    <section class="pos-card pur-trend rp-trend">
      <div class="dl-card-head"><h2>Sales Trend</h2>
        <label class="dl-select pur-mini"><select id="trendRange" aria-label="Trend range"><option value="period">Selected Period</option><option value="7">Last 7 Days</option><option value="30">Last 30 Days</option><option value="12m">Last 12 Months</option></select></label></div>
      <div class="dz-chart pur-chart" id="chart"></div>
      <p class="pur-chart-sub" id="chartSub"></p>
    </section>

    <section class="pos-card rp-cats">
      <div class="dl-card-head"><h2>Sales by Category</h2><button type="button" class="dl-link" id="catAll">View ${I.chev}</button></div>
      <div class="dl-sum sl-paybox rp-catbox">
        <div class="dl-donut sl-donut"><svg viewBox="0 0 220 220" id="donut" aria-hidden="true"></svg><div class="dl-donut-c"><strong id="catTotal">₹0</strong><span>Total Sales</span></div></div>
        <div class="sl-legend rp-legend" id="catLegend"><p class="dl-muted">Loading…</p></div>
      </div>
    </section>

    <section class="pos-card rp-insights">
      <div class="dl-card-head"><h2>Key Insights</h2></div>
      <div class="rp-ins" id="insights"><p class="dl-muted">Loading…</p></div>
    </section>

    <section class="pos-card rp-recent">
      <div class="dl-card-head"><h2>Recent Reports</h2>
        <label class="dl-select pur-mini"><select id="recentType" aria-label="Report type"><option value="">All Types</option>${TYPES.slice(0, 8).map(t => `<option value="${t.k}">${TYPE_CHIP[t.k][0]}</option>`).join('')}<option value="custom">Custom</option></select></label></div>
      <div class="dl-table-wrap"><table class="dl-table rp-table"><thead><tr>
        <th>Report Name</th><th class="c-type">Type</th><th class="c-per">Period</th><th class="c-on">Generated On</th><th class="c-by">Generated By</th><th class="c-c c-act">Actions</th>
      </tr></thead><tbody id="recentRows"><tr><td colspan="6" class="dl-empty">Loading…</td></tr></tbody></table></div>
      <button type="button" class="dl-link rp-all" id="recentAll">View All Reports ${I.chev}</button>
    </section>

    <section class="pos-card rp-quick">
      <div class="dl-card-head"><h2>Quick Reports</h2></div>
      <div class="rp-qlist" id="quick">${QUICK.map(q => `<button type="button" data-quick="${q.k}"><span class="rp-q-ic ${q.col}">${q.ic}</span><span class="rp-q-t"><b>${q.t}</b><small>${q.d}</small></span>${I.chev}</button>`).join('')}</div>
    </section>
  </div>
</div>

<dialog id="genDlg" class="pos-dialog dl-dialog md-wide sl-dlg rp-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button>
  <div class="rp-gen">
    <h3 class="rt-dlg-title" id="genTitle">${I.play} Generate Report</h3>
    <div class="rp-gen-tabs" id="genTypes">${TYPES.map(t => `<button type="button" data-gt="${t.k}">${t.ic}<span>${TYPE_CHIP[t.k][0]}</span></button>`).join('')}</div>
    <div class="rp-gen-grid">
      <div class="pos-field rp-f-rp"><label for="rp">Report</label><select id="rp"></select></div>
      <div class="pos-field rp-f-df"><label for="df">From date</label><input id="df" type="date"></div>
      <div class="pos-field rp-f-dt"><label for="dt">To date</label><input id="dt" type="date"></div>
      <div class="pos-field" id="bw"><label for="bk">Group by</label><select id="bk"><option value="day">Day — daily</option><option value="week">Week — weekly</option><option value="month">Month — monthly</option></select></div>
      <div class="pos-field" id="dw"><label for="dd">Expiry window (days)</label><input id="dd" type="number" min="0" max="3650" value="90"></div>
    </div>
    <div class="rp-gen-presets" id="rg">${PRESETS.filter(p => !['yesterday', 'quarter'].includes(p[0])).map(([k, l]) => `<button type="button" data-r="${k}">${l}</button>`).join('')}<button type="button" data-r="all">All Dates</button></div>
    <p class="rp-note" id="nt" hidden></p>
    <div class="rp-gen-acts">
      <button type="button" class="pos-btn pos-btn-solid" id="run">${I.play}<span>Run Report</span></button>
      <button type="button" class="pos-btn" id="pdf" disabled>${I.pdf}<span>PDF</span></button>
      <button type="button" class="pos-btn" id="xls" disabled>${I.sheet}<span>Excel</span></button>
      <button type="button" class="pos-btn" id="csv" disabled>${I.doc}<span>CSV</span></button>
      <button type="button" class="pos-btn" id="prt" disabled>${I.print}<span>Print</span></button>
    </div>
    <p id="msg" class="reports-message rp-msg" role="status" aria-live="polite"></p>
    <div id="out" class="rp-out" aria-live="polite"></div>
  </div>
</dialog>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg rp-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<div class="dl-pop md-menu ds-menu rp-row-menu" id="rowMenu" hidden></div>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const note = (m, bad) => { $('pmsg').textContent = m; $('pmsg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; };
for (const d of ['genDlg', 'puDlg']) $(d).addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $(d)) $(d).close(); });
const dlg = html => { $('puPanel').innerHTML = html; if (!$('puDlg').open) $('puDlg').showModal(); };
const missing = e => /reports_overview|reports_sales_by_category|report_run|function|schema cache|does not exist|Could not find/i.test(e?.message || '');
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }

sb.from('branches').select('name').eq('id', prof.branch_id).maybeSingle().then(r => { if (r.data?.name) shop = r.data.name; }, () => {});

// ---------------------------------------------------------------------------
// Popovers
// ---------------------------------------------------------------------------
const POPS = [['rangeBtn', 'rangePop'], ['exportBtn', 'exportMenu']];
function closePops(except) { for (const [b, p] of POPS) if (p !== except) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } if (except !== 'rowMenu') $('rowMenu').hidden = true; }
for (const [b, p] of POPS) $(b).addEventListener('click', e => { e.stopPropagation(); const open = $(p).hidden; closePops(p); $(p).hidden = !open; $(b).setAttribute('aria-expanded', String(open)); if (open && p === 'rangePop') openRange(); });
document.addEventListener('click', e => { if (!e.target.closest('.dl-pop') && !e.target.closest('[data-rowmenu]')) closePops(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePops(); });

// header date range
function paintRange() {
  $('rangeLabel').textContent = compact && rangeFrom !== rangeTo ? `${dm(rangeFrom)} – ${dm(rangeTo)}` : rangeText(rangeFrom, rangeTo);
  const k = PRESETS.find(p => p[0] === rangeKey);
  $('ovLabel').textContent = `(${k ? k[1] : rangeText(rangeFrom, rangeTo)})`;
  const len = daysBetween(rangeFrom, rangeTo) + 1, pt = addDays(rangeFrom, -1), pf = addDays(rangeFrom, -len);
  $('ovVs').textContent = `Compared with ${rangeText(pf, pt)}`;
}
function openRange() {
  $('hFrom').value = rangeFrom; $('hTo').value = rangeTo; $('hTo').max = $('hFrom').max = todayIso(); $('rangeErr').textContent = '';
  document.querySelectorAll('#presets [data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === rangeKey));
}
$('presets').addEventListener('click', e => {
  const b = e.target.closest('[data-p]'); if (!b) return;
  [rangeFrom, rangeTo] = presetRange(b.dataset.p); rangeKey = b.dataset.p;
  closePops(); paintRange(); loadAll();
});
$('rangeCancel').addEventListener('click', () => closePops());
$('rangeApply').addEventListener('click', () => {
  const f = $('hFrom').value, t = $('hTo').value;
  if (!f || !t) { $('rangeErr').textContent = 'Choose both dates.'; return; }
  if (f > t) { $('rangeErr').textContent = 'The From date cannot be after the To date.'; return; }
  if (daysBetween(f, t) > 1830) { $('rangeErr').textContent = 'Choose a range of 5 years or less.'; return; }
  rangeFrom = f; rangeTo = t; rangeKey = PRESETS.find(([k]) => { const [a, b] = presetRange(k); return a === f && b === t; })?.[0] || 'custom';
  closePops(); paintRange(); loadAll();
});

// ---------------------------------------------------------------------------
// Overview (0029 reports_overview; falls back to the existing report_* functions)
// ---------------------------------------------------------------------------
async function overviewFallback(f, t) {
  const fig = async (a, b) => {
    const [ps, pnl] = await Promise.all([rpc('report_period_summary', { p_from: a, p_to: b, p_bucket: 'month' }), rpc('report_pnl', { p_from: a, p_to: b })]);
    const s = k => (ps || []).reduce((x, r) => x + num(r[k]), 0), L = l => num((pnl || []).find(r => r.label.startsWith(l))?.amount);
    const net = L('Net sales'), np = L('Net profit');
    return { from: a, to: b, sales: s('gross_sales'), orders: s('invoices'), customers: null, walkins: null, purchases: s('purchases'), expenses: s('expenses'), returns: null, returns_value: s('returns'), net_sales_ex_tax: net, gross_profit: L('Gross profit'), cogs: -L('Less: cost'), net_profit: np, margin: net > 0 ? Math.round(np * 10000 / net) / 100 : null, tax: s('tax') };
  };
  const len = daysBetween(f, t) + 1;
  const [cur, prev, low] = await Promise.all([fig(f, t), fig(addDays(f, -len), addDays(f, -1)), sb.rpc('low_stock')]);
  return { current: cur, previous: prev, stock: { low_stock: (low.data || []).filter(r => num(r.sellable) > 0).length, out_of_stock: (low.data || []).filter(r => num(r.sellable) <= 0).length, near_expiry_batches: null }, fallback: true };
}
async function loadOverview() {
  for (const id of ['kSales', 'kPur', 'kExp', 'kNet', 'kMargin']) $(id).innerHTML = '<span class="dz-skel"></span>';
  try {
    if (has29) ov = await rpc('reports_overview', { p_from: rangeFrom, p_to: rangeTo });
    else ov = await overviewFallback(rangeFrom, rangeTo);
  } catch (e) {
    if (has29 && missing(e)) { has29 = false; note('Run database migration 0029 (Reports & Analytics) for customers, low stock, sales by category and the shared report history. Totals below come from the existing reports.', true); return loadOverview(); }
    ov = null; note(friendly(e), true);
  }
  renderKpis(); renderInsights(); notify();
}
const vsPrev = (a, b, goodUp = true) => {
  if (!num(b)) return a ? `<span class="${goodUp ? 'dz-up' : 'dz-down'}">New</span> <span class="dz-muted">· nothing in previous period</span>` : '<span class="dz-muted">Nothing in previous period</span>';
  const p = (a - b) / Math.abs(b) * 100, good = goodUp ? p >= 0 : p <= 0;
  return `<span class="${good ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.dn}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> vs previous period`;
};
function renderKpis() {
  const c = ov?.current, p = ov?.previous;
  if (!c) { for (const id of ['kSales', 'kPur', 'kExp', 'kNet', 'kMargin']) { $(id).textContent = '—'; $(id + 'Note').textContent = 'Could not load'; } return; }
  $('kSales').textContent = rupees0(c.sales); $('kSalesNote').innerHTML = vsPrev(num(c.sales), num(p?.sales));
  $('kPur').textContent = rupees0(c.purchases); $('kPurNote').innerHTML = vsPrev(num(c.purchases), num(p?.purchases));
  $('kExp').textContent = rupees0(c.expenses); $('kExpNote').innerHTML = vsPrev(num(c.expenses), num(p?.expenses), false);
  $('kNet').textContent = rupees0(c.net_profit); $('kNetNote').innerHTML = vsPrev(num(c.net_profit), num(p?.net_profit));
  const a = c.margin === null || c.margin === undefined ? null : num(c.margin), b = p?.margin === null || p?.margin === undefined ? null : num(p.margin);
  $('kMargin').textContent = a === null ? '—' : `${a.toFixed(1)}%`;
  $('kMarginNote').innerHTML = a === null ? '<span class="dz-muted">No sales in this period</span>' : b === null ? '<span class="dz-muted">of net sales (excl. GST)</span>' : `<span class="${a >= b ? 'dz-up' : 'dz-down'}">${a >= b ? I.up : I.dn}${a >= b ? '+' : ''}${(a - b).toFixed(1)} pp</span> vs previous period`;
  $('kSales').closest('.dz-kpi').title = `${count(c.orders)} bill(s), incl. GST ${fmtMoney(c.tax)}. Cancelled / refunded bills are not counted. Click for the invoice-wise sales report.`;
  $('kPur').closest('.dz-kpi').title = 'Confirmed purchase invoices (incl. GST, freight). Click for the purchase report.';
  $('kExp').closest('.dz-kpi').title = 'Posted expenses — rent, salary, bills… (stock purchases are not expenses). Click for the expense report.';
  $('kNet').closest('.dz-kpi').title = `Estimated: net sales excl. GST ${fmtMoney(c.net_sales_ex_tax)} − cost of medicines sold (FIFO) ${fmtMoney(c.cogs)} − expenses ${fmtMoney(c.expenses)}. Click for Profit & loss.`;
  $('kMargin').closest('.dz-kpi').title = 'Net profit ÷ net sales (excl. GST). Click for Profit & loss.';
}
const KPI_GO = { kSales: 'sales', kPur: 'purchases', kExp: 'expenses', kNet: 'pnl', kMargin: 'pnl' };
document.querySelector('.rp-kpis').addEventListener('click', e => { const k = e.target.closest('[data-kpi]'); if (k) openGen({ id: KPI_GO[k.dataset.kpi], from: rangeFrom, to: rangeTo, auto: true }); });

function renderInsights() {
  const c = ov?.current, p = ov?.previous, s = ov?.stock || {};
  if (!c) { $('insights').innerHTML = '<p class="dl-muted">Insights are not available.</p>'; return; }
  const items = [];
  const ch = num(p?.sales) ? (num(c.sales) - num(p.sales)) / num(p.sales) * 100 : null;
  items.push(ch === null
    ? { tone: num(c.sales) ? 'g' : 'n', ic: I.trend, t: num(c.sales) ? `Sales of <b>${rupees0(c.sales)}</b> in this period` : 'No sales in this period', d: 'Nothing to compare in the previous period', go: 'sales' }
    : { tone: ch >= 0 ? 'g' : 'r', ic: ch >= 0 ? I.trend : I.undo, t: `Sales ${ch >= 0 ? 'increased' : 'decreased'} by <b>${Math.abs(ch).toFixed(1)}%</b> compared to previous period`, d: `${rupees0(c.sales)} vs ${rupees0(p.sales)}`, go: 'period' });
  if (c.customers !== null && c.customers !== undefined) {
    const served = num(c.customers) + num(c.walkins);
    items.push({ tone: 'b', ic: I.cart, t: `<b>${count(c.orders)}</b> order${num(c.orders) === 1 ? '' : 's'} placed by <b>${count(served)}</b> customer${served === 1 ? '' : 's'}`, d: `${count(c.customers)} registered · ${count(c.walkins)} walk-in · avg bill ${fmtMoney(c.avg_bill)}`, go: 'customers' });
  } else items.push({ tone: 'b', ic: I.cart, t: `<b>${count(c.orders)}</b> order${num(c.orders) === 1 ? '' : 's'} in this period`, d: 'Customer counts need migration 0029', go: 'sales' });
  const low = num(s.low_stock), out = num(s.out_of_stock);
  items.push({ tone: low || out ? 'a' : 'g', ic: I.warn, t: low ? `<b>${count(low)}</b> medicine${low === 1 ? ' is' : 's are'} in low stock` : 'No medicines in low stock', d: [out ? `${count(out)} out of stock` : '', s.near_expiry_batches ? `${count(s.near_expiry_batches)} batch(es) expire in 90 days` : '', s.stock_value !== undefined ? `stock value ${rupees0(s.stock_value)}` : ''].filter(Boolean).join(' · ') || 'Stock levels are healthy', href: 'inventory.html' });
  const rn = c.returns, rv = num(c.returns_value);
  items.push({ tone: rv ? 'r' : 'g', ic: I.undo, t: rn === null || rn === undefined ? `Customer returns worth <b>${rupees0(rv)}</b>` : `<b>${count(rn)}</b> return${num(rn) === 1 ? '' : 's'} recorded worth <b>${rupees0(rv)}</b>`, d: num(c.purchase_returns) ? `${count(c.purchase_returns)} purchase return(s) · ${rupees0(c.purchase_returns_value)} sent back to distributors` : 'Sales returns in this period', go: 'returns' });
  $('insights').innerHTML = items.map((x, i) => `<button type="button" class="rp-in ${x.tone}" data-ins="${i}"><span class="rp-in-ic">${x.ic}</span><span><span class="rp-in-t">${x.t}</span><small>${esc(x.d)}</small></span></button>`).join('');
  $('insights').onclick = e => { const b = e.target.closest('[data-ins]'); if (!b) return; const x = items[+b.dataset.ins]; if (x.href) location.href = x.href; else openGen({ id: x.go, from: rangeFrom, to: rangeTo, bucket: 'day', auto: true }); };
}

// ---------------------------------------------------------------------------
// Sales trend
// ---------------------------------------------------------------------------
function trendWindow() {
  const r = $('trendRange').value, t = todayIso();
  if (r === '7') return { from: addDays(t, -6), to: t, bucket: 'day', label: 'Last 7 Days' };
  if (r === '30') return { from: addDays(t, -29), to: t, bucket: 'day', label: 'Last 30 Days' };
  if (r === '12m') return { from: monthStart(t, 11), to: t, bucket: 'month', label: 'Last 12 Months' };
  const len = daysBetween(rangeFrom, rangeTo);
  return { from: rangeFrom, to: rangeTo, bucket: len > 400 ? 'month' : len > 92 ? 'week' : 'day', label: rangeText(rangeFrom, rangeTo) };
}
function niceStep(v) { if (v <= 0) return 1; const raw = v * 1.08 / 5, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const axisMoney = v => v >= 1e7 ? `₹${+(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${+(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `₹${+(v / 1e3).toFixed(v % 1000 ? 1 : 0)}K` : `₹${Math.round(v)}`;
async function loadTrend() {
  const w = trendWindow();
  try { trend = (await rpc('report_period_summary', { p_from: w.from, p_to: w.to, p_bucket: w.bucket })) || []; }
  catch (e) { $('chart').innerHTML = `<p class="dl-empty">${esc(friendly(e))}</p>`; $('chartSub').textContent = ''; return; }
  trend = trend.map(r => {
    const k = String(r.period).slice(0, 10), d = new Date(k + 'T00:00:00Z');
    const label = w.bucket === 'month' ? d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    const full = w.bucket === 'month' ? d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : w.bucket === 'week' ? `Week of ${dmy(k)}` : d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return { k, label, full, sales: num(r.gross_sales), orders: num(r.invoices), returns: num(r.returns), purchases: num(r.purchases), expenses: num(r.expenses) };
  });
  drawChart(w);
}
function drawChart(w = trendWindow()) {
  const el = $('chart'), s = trend, N = s.length;
  if (!N) { el.innerHTML = '<p class="dl-empty">No sales in this period.</p>'; $('chartSub').textContent = ''; return; }
  const vals = s.map(x => x.sales), total = vals.reduce((a, b) => a + b, 0), orders = s.reduce((a, x) => a + x.orders, 0);
  $('chartSub').textContent = `${rupees0(total)} from ${count(orders)} bill${orders === 1 ? '' : 's'} · ${w.label}${w.bucket !== 'day' ? ` · by ${w.bucket}` : ''}`;
  const W = Math.max(260, el.clientWidth), H = el.clientHeight || 240, padL = 54, padR = 16, padT = 40, padB = 28, steps = 5;
  const hi = Math.max(...vals, 1), tick = niceStep(hi), max = tick * steps;
  const x = i => padL + (N === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (N - 1)), yv = v => padT + (H - padT - padB) * (1 - v / max);
  const pts = vals.map((v, i) => [x(i), yv(v)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < N; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
  const area = `${d} L${pts[N - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z`;
  const fit = Math.max(2, Math.floor((W - padL - padR) / 52)), every = Math.max(1, Math.ceil(N / fit));
  const grid = Array.from({ length: steps + 1 }, (_, i) => i * tick);
  const peak = vals.indexOf(Math.max(...vals));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales trend">
    <defs><linearGradient id="rpArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fbf3a" stop-opacity=".34"/><stop offset="1" stop-color="#2fbf3a" stop-opacity=".03"/></linearGradient></defs>
    <g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${yv(v)}" y2="${yv(v)}"/>`).join('')}</g>
    <g class="dz-axis pur-axis">${grid.map(v => `<text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end">${axisMoney(v)}</text>`).join('')}${s.map((p, i) => (i % every === 0 && N - 1 - i >= every / 2) || i === N - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '').join('')}</g>
    <path d="${area}" fill="url(#rpArea)"/><path class="dz-line" d="${d}"/>
    ${pts.map(([px, py], i) => `<circle class="dz-pt${i === peak ? ' hot' : ''}" data-i="${i}" cx="${px}" cy="${py}" r="${i === peak ? 6 : N > 20 ? 2.6 : 4}"/>`).join('')}
    ${pts.map(([px], i) => `<rect data-i="${i}" x="${px - (W - padL - padR) / Math.max(1, N - 1) / 2}" y="${padT}" width="${(W - padL - padR) / Math.max(1, N - 1)}" height="${H - padT - padB}" fill="transparent"/>`).join('')}
  </svg><div class="dz-tip" id="rpTip"></div>`;
  const tip = $('rpTip');
  const show = i => { const [px, py] = pts[i]; tip.innerHTML = `${rupees0(vals[i])}<small>${esc(s[i].full)} · ${s[i].orders} bill${s[i].orders === 1 ? '' : 's'}${s[i].returns && W > 480 ? ` · returns ${rupees0(s[i].returns)}` : ''}</small>`; tip.style.left = `${Math.min(Math.max(px / W * 100, 18), 82)}%`; tip.style.top = `${(py - 12) / H * 100}%`; el.querySelectorAll('.dz-pt').forEach(c => c.classList.toggle('hot', +c.dataset.i === i)); };
  show(peak);
  const sv = el.querySelector('svg');
  sv.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('mouseleave', () => show(peak));
  sv.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
}
$('trendRange').addEventListener('change', loadTrend);

// ---------------------------------------------------------------------------
// Sales by category
// ---------------------------------------------------------------------------
async function loadCats() {
  if (!has29) { cats = []; $('donut').innerHTML = '<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="30"/>'; $('catTotal').textContent = rupees0(ov?.current?.sales); $('catLegend').innerHTML = '<p class="dl-muted">Sales by category needs migration 0029.</p>'; return; }
  try { cats = (await rpc('reports_sales_by_category', { p_from: rangeFrom, p_to: rangeTo })) || []; }
  catch (e) { if (missing(e)) { has29 = false; return loadCats(); } $('catLegend').innerHTML = `<p class="dl-muted">${esc(friendly(e))}</p>`; return; }
  drawCats();
}
function drawCats() {
  const named = cats.filter(c => c.category !== 'Uncategorised'), un = cats.find(c => c.category === 'Uncategorised');
  const top = named.slice(0, 5).map(c => ({ l: c.category, v: num(c.sales), go: c.category }));
  const rest = named.slice(5).reduce((a, c) => a + num(c.sales), 0) + num(un?.sales);
  if (rest > 0) top.push({ l: named.length > 5 ? 'Others' : 'Uncategorised', v: rest });
  const parts = top.map((p, i) => ({ ...p, col: p.l === 'Others' || p.l === 'Uncategorised' ? CAT_COLS[5] : CAT_COLS[i] }));
  const total = parts.reduce((a, p) => a + p.v, 0), C = 2 * Math.PI * 84, gap = parts.length > 1 ? 2 : 0;
  let off = 0;
  $('donut').innerHTML = `<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="30"/>` + parts.map(p => {
    const len = total ? p.v / total * C : 0;
    const out = len > gap ? `<circle cx="110" cy="110" r="84" fill="none" stroke="${p.col}" stroke-width="30" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-off}"><title>${esc(p.l)} ${fmtMoney(p.v)}</title></circle>` : '';
    off += len; return out;
  }).join('');
  $('catTotal').textContent = rupees0(total);
  $('catLegend').innerHTML = parts.map(p => `<button type="button" data-cat="${esc(p.l)}" title="${esc(p.l)}: ${fmtMoney(p.v)}"><i style="background:${p.col}"></i><b>${esc(p.l)}</b><em>${total ? (p.v / total * 100).toFixed(1) : '0.0'}%</em><span>${rupees0(p.v)}</span></button>`).join('')
    || `<p class="dl-muted">No sales in this period.${cats.length ? '' : ' Assign categories to medicines in Medicines to see the split.'}</p>`;
}
$('catLegend').addEventListener('click', e => { if (e.target.closest('[data-cat]')) openGen({ id: 'category', from: rangeFrom, to: rangeTo, auto: true }); });
$('catAll').addEventListener('click', () => openGen({ id: 'category', from: rangeFrom, to: rangeTo, auto: true }));

// ---------------------------------------------------------------------------
// Recent reports (0029 report_runs; falls back to this browser)
// ---------------------------------------------------------------------------
const LS = `pp-report-runs-${prof.id || 'me'}`;
const lsRuns = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } };
const lsSave = list => { try { localStorage.setItem(LS, JSON.stringify(list.slice(0, 100))); } catch { /* storage full or blocked */ } };
async function logRun(def, a, rows) {
  const cat = a.type && a.type !== 'custom' && TYPES.find(t => t.k === a.type)?.ids.includes(def.id) ? a.type : typeOf(def.id);
  const params = { bucket: a.bucket, days: a.days };
  const entry = { report_id: def.id, title: def.title, category: cat, p_from: a.from || null, p_to: a.to || null, params, row_count: rows.length };
  if (has29) {
    try { await rpc('report_run_log', { p_report: def.id, p_title: def.title, p_category: cat, p_from: entry.p_from, p_to: entry.p_to, p_params: params, p_rows: rows.length }); return loadRecent(); }
    catch (e) { if (!missing(e)) { console.warn('report history', e); return; } has29 = false; }
  }
  lsSave([{ ...entry, id: `ls-${Date.now()}`, created_at: new Date().toISOString(), generated_by: prof.full_name || 'You', mine: true }, ...lsRuns()]);
  loadRecent();
}
async function loadRecent(limit = 5) {
  const type = $('recentType').value || null;
  if (has29) {
    try { runs = (await rpc('report_runs_list', { p_limit: 100, p_category: type })) || []; }
    catch (e) { if (missing(e)) { has29 = false; return loadRecent(limit); } $('recentRows').innerHTML = `<tr><td colspan="6" class="dl-empty">${esc(friendly(e))}</td></tr>`; return; }
  } else runs = lsRuns().filter(r => !type || r.category === type);
  $('recentRows').innerHTML = runs.slice(0, limit).map(r => recentRow(r)).join('') || `<tr><td colspan="6" class="dl-empty">No reports generated yet. Pick a report type or a quick report to get started.</td></tr>`;
  $('recentAll').hidden = runs.length <= limit;
}
function runPeriod(r) {
  const def = defOf(r.report_id);
  if (!def) return '—';
  if (!def.params.includes('range')) return def.params.includes('days') ? `Next ${r.params?.days ?? 90} days` : `As on ${dmy(String(r.created_at).slice(0, 10))}`;
  return !r.p_from && !r.p_to ? 'All dates' : r.p_from === r.p_to ? dmy(r.p_from) : `${dm(r.p_from)} – ${dmy(r.p_to)}`;
}
function recentRow(r, full = false) {
  const [tl, tc] = TYPE_CHIP[r.category] || TYPE_CHIP.custom;
  return `<tr data-run="${esc(r.id)}"><td class="c-name"><span class="rp-doc ${tc}">${I.doc}</span><span><b>${esc(r.title)}</b><small class="rp-m">${esc(runPeriod(r))}</small></span></td>
    <td class="c-type"><span class="md-chip ${tc}">${tl}</span></td><td class="c-per">${esc(runPeriod(r))}</td><td class="c-on">${esc(when(r.created_at))}</td><td class="c-by">${esc(r.generated_by || '—')}</td>
    <td class="c-act"><div class="pur-acts"><button type="button" class="dl-act" data-rowmenu="dl" title="Download" aria-label="Download ${esc(r.title)}">${I.download}</button><button type="button" class="dl-act" data-rview title="View" aria-label="View ${esc(r.title)}">${I.eye}</button>${full ? `<button type="button" class="dl-act" data-rowmenu="more" title="More" aria-label="More">${I.dots}</button>` : ''}</div></td></tr>`;
}
const runArgs = r => ({ id: r.report_id, from: r.p_from || '', to: r.p_to || '', bucket: r.params?.bucket, days: r.params?.days, type: r.category });
function onRecentClick(e) {
  const tr = e.target.closest('tr[data-run]'); if (!tr) return;
  const r = runs.find(x => String(x.id) === tr.dataset.run); if (!r) return;
  const m = e.target.closest('[data-rowmenu]');
  if (m) {
    e.stopPropagation();
    const menu = $('rowMenu');
    menu.innerHTML = m.dataset.rowmenu === 'dl'
      ? `<button type="button" data-rm="pdf">${I.pdf}<span>Download PDF</span></button><button type="button" data-rm="xls">${I.sheet}<span>Download Excel</span></button><button type="button" data-rm="csv">${I.doc}<span>Download CSV</span></button><button type="button" data-rm="print">${I.print}<span>Print</span></button>`
      : `<button type="button" data-rm="view">${I.eye}<span>View report</span></button><button type="button" data-rm="again">${I.play}<span>Run again for the selected period</span></button>${r.mine || role === 'super_admin' ? `<button type="button" data-rm="del" class="danger">${I.trash}<span>Remove from history</span></button>` : ''}`;
    const host = tr.closest('dialog') || document.body;
    if (menu.parentNode !== host) host.appendChild(menu);
    const b = m.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = `${Math.min(innerHeight - menu.offsetHeight - 8, b.bottom + 6)}px`;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, b.right - menu.offsetWidth))}px`;
    menu.onclick = async ev => {
      const a = ev.target.closest('[data-rm]'); if (!a) return;
      menu.hidden = true;
      const k = a.dataset.rm;
      if (k === 'view') return openGen({ ...runArgs(r), auto: true, nolog: true });
      if (k === 'again') return openGen({ ...runArgs(r), from: rangeFrom, to: rangeTo, auto: true });
      if (k === 'del') return removeRun(r);
      await quickExport(runArgs(r), k);
    };
    return;
  }
  openGen({ ...runArgs(r), auto: true, nolog: true });
}
$('recentRows').addEventListener('click', onRecentClick);
$('recentType').addEventListener('change', () => loadRecent());
async function removeRun(r) {
  if (!confirm(`Remove "${r.title}" (${runPeriod(r)}) from the report history?\nThe report itself can be generated again any time.`)) return;
  try {
    if (String(r.id).startsWith('ls-')) lsSave(lsRuns().filter(x => x.id !== r.id));
    else await rpc('report_run_delete', { p_id: r.id });
    toast('Removed from report history.');
    await loadRecent();
    if ($('puDlg').open && $('allRows')) showAll();
  } catch (e) { toast(friendly(e), true); }
}
function showAll() {
  dlg(`<h3 class="rt-dlg-title">${I.doc} All Reports <small class="dl-muted">(${count(runs.length)}${runs.length >= 100 ? '+' : ''})</small></h3>
    <p class="dl-muted">Every report generated in this branch, newest first. Open or download any of them again — the figures are recalculated from the current data.</p>
    <div class="dl-table-wrap rp-all-wrap"><table class="dl-table rp-table rp-table-all"><thead><tr><th>Report Name</th><th class="c-type">Type</th><th class="c-per">Period</th><th class="c-on">Generated On</th><th class="c-by">Generated By</th><th class="c-c c-act">Actions</th></tr></thead>
    <tbody id="allRows">${runs.map(r => recentRow(r, true)).join('') || '<tr><td colspan="6" class="dl-empty">No reports yet.</td></tr>'}</tbody></table></div>`);
  $('allRows').addEventListener('click', onRecentClick);
}
$('recentAll').addEventListener('click', showAll);

// ---------------------------------------------------------------------------
// Report generator (all existing reports)
// ---------------------------------------------------------------------------
let current = null;
let genType = 'sales';
function fillSelect(type, keep) {
  const t = TYPES.find(x => x.k === type) || TYPES[8];
  genType = t.k;
  $('rp').innerHTML = t.k === 'custom'
    ? GROUPS.map(([label, ids]) => `<optgroup label="${esc(label)}">${ids.map(id => `<option value="${id}">${esc(defOf(id).title)}</option>`).join('')}</optgroup>`).join('')
    : t.ids.map(id => `<option value="${id}">${esc(defOf(id).title)}</option>`).join('');
  if (keep && t.ids.includes(keep)) $('rp').value = keep;
  document.querySelectorAll('#genTypes [data-gt]').forEach(b => b.classList.toggle('on', b.dataset.gt === t.k));
  syncDef();
}
function markPreset() {
  const f = $('df').value, t = $('dt').value;
  document.querySelectorAll('#rg [data-r]').forEach(b => { const [a, z] = presetRange(b.dataset.r); b.classList.toggle('active', a === f && z === t); });
}
function syncDef() {
  const d = defOf($('rp').value), hasRange = d.params.includes('range');
  $('rg').hidden = !hasRange;
  document.querySelector('.rp-f-df').hidden = document.querySelector('.rp-f-dt').hidden = !hasRange;
  $('bw').hidden = !d.params.includes('bucket');
  $('dw').hidden = !d.params.includes('days');
  $('nt').hidden = !d.note; $('nt').textContent = d.note || '';
  $('pdf').disabled = $('xls').disabled = $('csv').disabled = $('prt').disabled = true;
  $('msg').textContent = ''; $('msg').className = 'reports-message rp-msg';
  $('out').innerHTML = `<div class="rp-empty">${I.report}<strong>${esc(d.title)}</strong><span>${hasRange ? 'Choose the period' : d.params.includes('days') ? 'Choose the expiry window' : 'Current stock snapshot'} and click Run Report.</span></div>`;
  $('genTitle').innerHTML = `${I.play} ${esc(TYPES.find(t => t.k === genType).label)}`;
  current = null;
  markPreset();
}
function openGen(o = {}) {
  closePops();
  const id = o.id && defOf(o.id) ? o.id : null;
  const type = o.type || (id ? (TYPES.find(t => t.k === activeType)?.ids.includes(id) && activeType !== 'custom' ? activeType : typeOf(id)) : activeType);
  fillSelect(type, id);
  $('df').value = o.from ?? rangeFrom; $('dt').value = o.to ?? rangeTo;
  $('df').max = $('dt').max = todayIso();
  if (o.bucket) $('bk').value = o.bucket;
  if (o.days !== undefined && o.days !== null) $('dd').value = o.days;
  markPreset();
  if (!$('genDlg').open) $('genDlg').showModal();
  if (o.auto) runReport({ nolog: o.nolog });
}
$('genTypes').addEventListener('click', e => { const b = e.target.closest('[data-gt]'); if (b) fillSelect(b.dataset.gt); });
$('rp').addEventListener('change', syncDef);
$('rg').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; const [f, t] = presetRange(b.dataset.r); $('df').value = f; $('dt').value = t; markPreset(); });
for (const id of ['df', 'dt']) $(id).addEventListener('change', markPreset);

function collectArgs() {
  const d = defOf($('rp').value);
  return { id: d.id, from: $('df').value, to: $('dt').value, bucket: $('bk').value, days: +$('dd').value, type: genType };
}
async function fetchReport(a) {
  const d = defOf(a.id);
  if (d.params.includes('range') && a.from && a.to && a.from > a.to) throw new Error('The From date cannot be after the To date.');
  if (d.params.includes('days') && (!Number.isInteger(+a.days) || +a.days < 0 || +a.days > 3650)) throw new Error('Enter an expiry window between 0 and 3650 days.');
  const args = {};
  if (d.params.includes('range')) { args.p_from = d.dates ? (a.from || '2000-01-01') : (a.from || null); args.p_to = d.dates ? (a.to || todayIso()) : (a.to || null); }
  if (d.params.includes('bucket')) args.p_bucket = a.bucket || 'day';
  if (d.params.includes('days')) args.p_days = +a.days;
  let rows = await rpc(d.rpc, args);
  rows = Array.isArray(rows) ? rows : [];
  if (d.post) rows = d.post(rows);
  const period = periodText(d, a) + (d.params.includes('bucket') ? ` · Grouped by ${args.p_bucket}` : '');
  return { def: d, rows, args: a, meta: { shop, subtitle: period, generated: nowLabel(), stamp: todayIso() } };
}
const isNumeric = col => col.t !== 'text' && col.t !== 'date';
async function runReport({ nolog = false } = {}) {
  const a = collectArgs(), d = defOf(a.id);
  $('msg').className = 'reports-message rp-msg'; $('msg').textContent = 'Running report…';
  $('run').disabled = true;
  $('out').innerHTML = '<div class="rp-empty"><span class="dz-skel"></span><span>Loading report data…</span></div>';
  try {
    current = await fetchReport(a);
    const { rows, meta } = current;
    const totals = totalsOf(d, rows), visible = rows.slice(0, 500);
    const tfoot = rows.length && totals.some(v => v !== null) ? `<tfoot><tr>${d.cols.map((c, i) => `<td class="${isNumeric(c) ? 'numeric' : ''}">${i === 0 ? 'TOTAL' : totals[i] !== null ? esc(fmt(c, totals[i])) : ''}</td>`).join('')}</tr></tfoot>` : '';
    $('out').innerHTML = `
      <div class="rp-out-head"><div><h4>${esc(d.title)}</h4><p class="dl-muted">${esc(meta.subtitle)} · Generated ${esc(meta.generated)}</p></div>
        <div class="rp-out-stat"><small>Rows</small><b>${count(rows.length)}</b></div></div>
      ${rows.length > 500 ? `<p class="dl-muted">Showing the first 500 rows. PDF, Excel and CSV include all ${count(rows.length)} rows.</p>` : ''}
      <div class="dl-table-wrap rp-res-wrap"><table class="dl-table reports-table rp-res">
        <thead><tr>${d.cols.map(c => `<th class="${isNumeric(c) ? 'numeric' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead>
        <tbody>${visible.map(r => `<tr class="${r.style === 'b' ? 'rp-bold' : ''}">${d.cols.map(c => `<td class="${isNumeric(c) ? 'numeric' : ''}">${esc(fmt(c, r[c.k]))}</td>`).join('')}</tr>`).join('') || `<tr><td class="dl-empty" colspan="${d.cols.length}">No data for the selected filters.</td></tr>`}</tbody>${tfoot}
      </table></div>`;
    $('pdf').disabled = $('xls').disabled = $('csv').disabled = $('prt').disabled = false;
    $('msg').textContent = rows.length ? 'Report generated successfully.' : 'Report completed. No data matched the selected filters.';
    $('msg').classList.add('success');
    if (!nolog) logRun(d, a, rows);
  } catch (e) {
    current = null;
    $('pdf').disabled = $('xls').disabled = $('csv').disabled = $('prt').disabled = true;
    $('out').innerHTML = `<div class="rp-empty">${I.warn}<strong>Unable to display this report.</strong></div>`;
    $('msg').textContent = friendly(e); $('msg').classList.add('error');
  } finally { $('run').disabled = false; }
}
$('run').addEventListener('click', () => runReport());

function csvOf(def, rows) {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const plain = (c, v) => v === null || v === undefined || v === '' ? '' : isNumeric(c) && c.t !== 'pct' ? String(+v) : fmt(c, v);
  const T = totalsOf(def, rows);
  const lines = [def.cols.map(c => q(c.l)).join(','), ...rows.map(r => def.cols.map(c => q(plain(c, r[c.k]))).join(','))];
  if (rows.length && T.some(v => v !== null)) lines.push(def.cols.map((c, i) => i === 0 ? 'TOTAL' : T[i] === null ? '' : q(plain(c, T[i]))).join(','));
  return '﻿' + lines.join('\r\n');
}
function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
function printReport(def, rows, meta) {
  const T = totalsOf(def, rows);
  const html = `<style>body{font:12px Inter,Arial,sans-serif;color:#101828;margin:14px}h1{font-size:17px;margin:0}h2{font-size:14px;margin:4px 0}p{margin:2px 0;color:#475467}table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#0f766e;color:#fff;text-align:left;padding:5px 6px;font-size:11px}td{padding:4px 6px;border-bottom:1px solid #e4e7ec;font-size:11px}.n{text-align:right}tfoot td{font-weight:700;border-top:2px solid #101828}tr.b td{font-weight:700}</style>
    <h1>${esc(meta.shop)}</h1><h2>${esc(def.title)}</h2><p>${esc(meta.subtitle)} · Generated ${esc(meta.generated)}</p>${def.note ? `<p><i>${esc(def.note)}</i></p>` : ''}
    <table><thead><tr>${def.cols.map(c => `<th class="${isNumeric(c) ? 'n' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr class="${r.style === 'b' ? 'b' : ''}">${def.cols.map(c => `<td class="${isNumeric(c) ? 'n' : ''}">${esc(fmt(c, r[c.k]))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${def.cols.length}">No data for the selected filters.</td></tr>`}</tbody>
    ${rows.length && T.some(v => v !== null) ? `<tfoot><tr>${def.cols.map((c, i) => `<td class="${isNumeric(c) ? 'n' : ''}">${i === 0 ? 'TOTAL' : T[i] !== null ? esc(fmt(c, T[i])) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table><p>${rows.length} row(s)</p>`;
  printHTML(html, def.title, 'a4');
}
async function doExport(rep, kind) {
  const { def, rows, meta } = rep;
  if (kind === 'pdf') return downloadPdf(def, rows, meta);
  if (kind === 'xls') return downloadXlsx(def, rows, meta);
  if (kind === 'csv') return saveBlob(new Blob([csvOf(def, rows)], { type: 'text/csv;charset=utf-8' }), `${def.id}-${meta.stamp}.csv`);
  if (kind === 'print') return printReport(def, rows, meta);
}
async function exportCurrent(kind, btn) {
  if (!current) return;
  const btns = ['pdf', 'xls', 'csv', 'prt'].map($);
  btns.forEach(b => { b.disabled = true; });
  $('msg').className = 'reports-message rp-msg'; $('msg').textContent = 'Preparing download…';
  try { await doExport(current, kind); $('msg').textContent = kind === 'print' ? 'Sent to the printer.' : 'Download prepared.'; $('msg').classList.add('success'); }
  catch (e) { $('msg').textContent = `Export failed: ${e.message || e}`; $('msg').classList.add('error'); }
  finally { btns.forEach(b => { b.disabled = false; }); btn?.focus(); }
}
$('pdf').addEventListener('click', () => exportCurrent('pdf', $('pdf')));
$('xls').addEventListener('click', () => exportCurrent('xls', $('xls')));
$('csv').addEventListener('click', () => exportCurrent('csv', $('csv')));
$('prt').addEventListener('click', () => exportCurrent('print', $('prt')));
async function quickExport(a, kind) {
  toast('Preparing report…');
  try { const rep = await fetchReport(a); await doExport(rep, kind); toast(kind === 'print' ? `${rep.def.title} sent to the printer.` : `${rep.def.title} downloaded (${count(rep.rows.length)} rows).`); }
  catch (e) { toast(friendly(e), true); }
}

// tiles + quick reports
function paintTypes() { document.querySelectorAll('#types [data-type]').forEach(b => { b.classList.toggle('on', b.dataset.type === activeType); b.setAttribute('aria-selected', String(b.dataset.type === activeType)); }); }
$('types').addEventListener('click', e => {
  if (e.target.closest('#typesMore')) {
    dlg(`<h3 class="rt-dlg-title">${I.grid} Report Types</h3><div class="rp-types rp-types-sheet">${TYPES.map(t => `<button type="button" class="rp-type ${t.col}${t.k === activeType ? ' on' : ''}" data-sheet="${t.k}"><span class="rp-type-ic">${t.ic}</span><span>${t.label}</span></button>`).join('')}</div>`);
    $('puPanel').onclick = ev => { const b = ev.target.closest('[data-sheet]'); if (!b) return; $('puDlg').close(); activeType = b.dataset.sheet; paintTypes(); openGen({ type: activeType }); };
    return;
  }
  const b = e.target.closest('[data-type]'); if (!b) return;
  activeType = b.dataset.type; paintTypes(); openGen({ type: activeType });
});
$('gen').addEventListener('click', () => openGen({ type: activeType }));
$('quick').addEventListener('click', e => { const b = e.target.closest('[data-quick]'); if (!b) return; const q = QUICK.find(x => x.k === b.dataset.quick); openGen({ ...q.run(), auto: true }); });

// ---------------------------------------------------------------------------
// Header export: overview / daily / categories
// ---------------------------------------------------------------------------
function overviewReport() {
  const c = ov?.current || {}, p = ov?.previous || {}, s = ov?.stock || {};
  const has = v => v !== null && v !== undefined;
  const rows = [];
  const add = (label, cur, prev, kind = 'money', style = '') => {
    if (!has(cur)) return;
    const f = v => !has(v) ? '—' : kind === 'count' ? count(v) : kind === 'pct' ? `${num(v).toFixed(2)}%` : fmtMoney(v);
    let change = '';
    if (kind === 'pct') { if (has(prev)) { const d = num(cur) - num(prev); change = `${d > 0 ? '+' : ''}${d.toFixed(2)} pp`; } }
    else if (has(prev) && num(prev)) { const d = (num(cur) - num(prev)) / Math.abs(num(prev)) * 100; change = `${d > 0 ? '+' : ''}${d.toFixed(1)}%`; }
    else if (has(prev) && num(cur)) change = 'New';
    rows.push({ label, cur: f(cur), prev: prev === undefined ? '' : f(prev), change, style });
  };
  add('Total sales (incl. GST)', c.sales, p.sales, 'money', 'b'); add('Orders (bills)', c.orders, p.orders, 'count');
  add('Registered customers', c.customers, p.customers, 'count'); add('Walk-in bills', c.walkins, p.walkins, 'count');
  add('Average bill value', c.avg_bill, p.avg_bill); add('GST collected', c.tax, p.tax);
  add('Net sales (excl. GST, after returns)', c.net_sales_ex_tax, p.net_sales_ex_tax); add('Cost of medicines sold (FIFO)', c.cogs, p.cogs);
  add('Gross profit', c.gross_profit, p.gross_profit); add('Expenses', c.expenses, p.expenses);
  add('Net profit (estimated)', c.net_profit, p.net_profit, 'money', 'b'); add('Profit margin', has(c.margin) ? c.margin : null, p.margin, 'pct', 'b');
  add('Purchases', c.purchases, p.purchases); add('Sales returns (count)', c.returns, p.returns, 'count'); add('Sales returns (value)', c.returns_value, p.returns_value);
  add('Purchase returns (count)', c.purchase_returns, p.purchase_returns, 'count'); add('Purchase returns (value)', c.purchase_returns_value, p.purchase_returns_value);
  add('Low stock medicines (now)', s.low_stock, undefined, 'count'); add('Out of stock medicines (now)', s.out_of_stock, undefined, 'count');
  add('Batches expiring in 90 days (now)', s.near_expiry_batches, undefined, 'count'); add('Stock value at cost (now)', s.stock_value, undefined);
  const def = { id: 'overview', title: 'Report overview', note: 'Change: vs the previous period of the same length (profit margin in percentage points). Net profit is an estimate using real batch costs.', params: ['range'],
    cols: [{ k: 'label', l: 'Particulars', t: 'text', w: 4 }, { k: 'cur', l: 'This period', t: 'text', w: 1.7 }, { k: 'prev', l: 'Previous period', t: 'text', w: 1.7 }, { k: 'change', l: 'Change', t: 'text', w: 1.1 }] };
  const len = daysBetween(rangeFrom, rangeTo) + 1;
  return { def, rows, meta: { shop, subtitle: `${rangeText(rangeFrom, rangeTo)} · compared with ${rangeText(addDays(rangeFrom, -len), addDays(rangeFrom, -1))}`, generated: nowLabel(), stamp: todayIso() } };
}
$('exportMenu').addEventListener('click', async e => {
  const b = e.target.closest('[data-exp]'); if (!b) return;
  closePops();
  const k = b.dataset.exp;
  try {
    if (k === 'ovpdf' || k === 'ovxls' || k === 'print') {
      if (!ov?.current) throw new Error('The overview has not loaded yet.');
      const rep = overviewReport();
      if (k === 'print') return printOverview(rep);
      await doExport(rep, k === 'ovpdf' ? 'pdf' : 'xls');
    } else if (k === 'daily') await quickExport({ id: 'period', from: rangeFrom, to: rangeTo, bucket: 'day' }, 'xls');
    else if (k === 'cats') await quickExport({ id: 'category', from: rangeFrom, to: rangeTo }, 'xls');
    if (k !== 'daily' && k !== 'cats') toast('Download prepared.');
  } catch (err) { toast(friendly(err), true); }
});
function printOverview(rep) {
  const ins = [...document.querySelectorAll('#insights .rp-in')].map(b => `<li>${b.querySelector('.rp-in-t').innerHTML} — ${esc(b.querySelector('small').textContent)}</li>`).join('');
  const catRows = [...document.querySelectorAll('#catLegend [data-cat]')].map(b => `<tr><td>${esc(b.querySelector('b').textContent)}</td><td class="n">${esc(b.querySelector('em').textContent)}</td><td class="n">${esc(b.querySelector('span').textContent)}</td></tr>`).join('');
  printHTML(`<style>body{font:12px Inter,Arial,sans-serif;color:#101828;margin:14px}h1{font-size:18px;margin:0}h2{font-size:14px;margin:14px 0 4px}p{margin:2px 0;color:#475467}table{width:100%;border-collapse:collapse}th{background:#0f766e;color:#fff;text-align:left;padding:5px 6px}td{padding:4px 6px;border-bottom:1px solid #e4e7ec}.n{text-align:right}tr.b td{font-weight:700}li{margin:3px 0}</style>
    <h1>${esc(rep.meta.shop)} — Reports &amp; Analytics</h1><p>${esc(rep.meta.subtitle)} · Printed ${esc(rep.meta.generated)}</p>
    <h2>Report overview</h2><table><thead><tr><th>Particulars</th><th class="n">This period</th><th class="n">Previous period</th><th class="n">Change</th></tr></thead><tbody>${rep.rows.map(r => `<tr class="${r.style || ''}"><td>${esc(r.label)}</td><td class="n">${esc(r.cur)}</td><td class="n">${esc(r.prev)}</td><td class="n">${esc(r.change)}</td></tr>`).join('')}</tbody></table>
    ${catRows ? `<h2>Sales by category</h2><table><thead><tr><th>Category</th><th class="n">Share</th><th class="n">Sales</th></tr></thead><tbody>${catRows}</tbody></table>` : ''}
    <h2>Key insights</h2><ul>${ins}</ul>`, 'Reports overview', 'a4');
}

// ---------------------------------------------------------------------------
// Notifications, load, resize
// ---------------------------------------------------------------------------
function notify() {
  const items = [], c = ov?.current, s = ov?.stock || {};
  if (num(s.low_stock)) items.push({ tone: 'warn', title: `${count(s.low_stock)} medicine(s) in low stock`, detail: 'Reorder from Inventory', href: 'inventory.html' });
  if (num(s.out_of_stock)) items.push({ tone: 'danger', title: `${count(s.out_of_stock)} medicine(s) out of stock`, detail: 'See Inventory', href: 'inventory.html' });
  if (num(s.near_expiry_batches)) items.push({ tone: 'warn', title: `${count(s.near_expiry_batches)} batch(es) expire within 90 days`, detail: 'Run the Expiry report', href: 'reports.html' });
  if (c && num(c.net_profit) < 0) items.push({ tone: 'danger', title: `Estimated loss of ${rupees0(-num(c.net_profit))} in this period`, detail: 'Open Profit & loss', href: 'finance.html' });
  if (c && num(c.returns_value)) items.push({ tone: 'info', title: `${rupees0(c.returns_value)} returned by customers`, detail: 'See Returns', href: 'returns.html' });
  setNotifications(items);
}
async function loadAll() {
  note('');
  await loadOverview();
  await Promise.all([loadTrend(), loadCats(), loadRecent()]);
}
paintRange(); paintTypes();
await loadAll();

const params = new URLSearchParams(location.search);
if (params.get('report') && defOf(params.get('report'))) openGen({ id: params.get('report'), from: params.get('from') || rangeFrom, to: params.get('to') || rangeTo, auto: params.has('run') });
else if (params.get('type') && TYPES.some(t => t.k === params.get('type'))) { activeType = params.get('type'); paintTypes(); openGen({ type: activeType }); }

let rz;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const c = matchMedia('(max-width: 560px)').matches; if (c !== compact) { compact = c; paintRange(); } drawChart(); }, 150); });
