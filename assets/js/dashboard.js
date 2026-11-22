// Admin dashboard — Pallikkal Pharmacy design. Every figure is read live from
// the branch's own records (RLS + role checks still apply on the server).
import { mountShell } from './navigation.js';
import { sb, esc } from './supabase-client.js';
import { icon, displayName, setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';
import { loadSettings } from './app-settings.js';
import { runAutoBackup } from './backup.js';

const prof = await mountShell('dashboard', 'Dashboard', { layout: 'brand' });
if (!prof) throw new Error('no session');
const role = String(prof.role || '').toLowerCase();
const appSettings = await loadSettings(sb);
let backupNote = null;
const view = document.getElementById('view');
if (!['super_admin', 'admin'].includes(role)) {
  view.innerHTML = '<div class="dz-card">You do not have access to this page.</div>';
  throw new Error('Dashboard access denied');
}
backupNote = await runAutoBackup(sb, appSettings);

// ---------------------------------------------------------------------------
// Helpers (all dates are India Standard Time calendar days)
// ---------------------------------------------------------------------------
const TZ = 'Asia/Kolkata';
const istDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const istStartUtc = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) - 330 * 60000).toISOString(); };
const shortDay = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
const rupees0 = v => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(v) || 0));
const rupees2 = v => '₹' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
const count = v => new Intl.NumberFormat('en-IN').format(Number(v) || 0);
const when = d => new Date(d).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(' am', ' AM').replace(' pm', ' PM');
const titleCase = s => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const safe = p => Promise.resolve(p).then(({ data, error }) => { if (error) { console.warn('Dashboard:', error.message); return null; } return data; }).catch(e => { console.warn('Dashboard:', e); return null; });
// PostgREST returns at most 1,000 rows per request: page through larger sets.
async function fetchAll(build) {
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) { console.warn('Dashboard:', error.message); return out.length ? out : null; }
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const trend = (now, prev, noun = 'sales') => {
  if (!prev) return now ? `<span class="dz-up">New</span> <span>no ${noun} yesterday</span>` : '<span>No activity yet today</span>';
  const pct = (now - prev) / prev * 100;
  const up = pct >= 0;
  return `<span class="${up ? 'dz-up' : 'dz-down'}"><svg class="dz-trend-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${up ? '<path d="m5 15 7-7 7 7"/>' : '<path d="m5 9 7 7 7-7"/>'}</svg>${up ? '+' : ''}${pct.toFixed(1)}%</span><span>vs. yesterday</span>`;
};

// ---------------------------------------------------------------------------
// Static layout
// ---------------------------------------------------------------------------
const today = istDay(new Date());
const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
const firstName = displayName(prof).split(' ')[0];
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

const KPI = (cls, ic, label, id, href) => `<a class="dz-kpi ${cls}" href="${href}"><span class="dz-kpi-icon">${ic}</span><div class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></div></a>`;
const ICONS = {
  bars: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><rect x="5" y="12" width="3" height="6" rx=".6"/><rect x="10.5" y="8" width="3" height="10" rx=".6"/><rect x="16" y="4" width="3" height="14" rx=".6"/></svg>',
  warn: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  chartTitle: '<svg class="pp-ic" viewBox="0 0 24 24" fill="#16a51f" stroke="none"><rect x="3" y="13" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>',
  plus: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  boxBack: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/><path d="m8.5 5.2-1.7 3 3 .4"/></svg>',
  bolt: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg>',
  book: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/><path d="M9 7h7M9 11h5"/></svg>',
  scale: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 21h10M5 7h14"/><path d="m5 7-3 7a3.5 3.5 0 0 0 6 0Z"/><path d="m19 7-3 7a3.5 3.5 0 0 0 6 0Z"/></svg>',
  hourglass: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12M6 22h12"/><path d="M7 2v4a5 5 0 0 0 10 0V2"/><path d="M7 22v-4a5 5 0 0 1 10 0v4"/></svg>',
  doc: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>'
};

const QUICK = [
  ['billing.html', ICONS.plus, 'New Sale', 'green'],
  ['purchases.html?new=1', icon('bag'), 'New Purchase', 'navy'],
  ['medicines.html?new=1', icon('pill'), 'Add Medicine', 'blue'],
  ['customers.html?new=1', icon('users'), 'Add Customer', 'purple'],
  ['returns.html', icon('undo'), 'Sales Return', 'rose'],
  ['returns.html?tab=purchase', ICONS.boxBack, 'Purchase Return', 'teal'],
  ['expenses.html?new=1', icon('wallet'), 'Add Expense', 'orange'],
  ['finance.html?tab=rec', icon('finance'), 'Receive Payment', 'green'],
  ['delivery.html', icon('truck'), 'Deliveries', 'blue'],
  ['reports.html', icon('reports'), 'Reports', 'navy']
];
const BAR_COLORS = ['#12a01b', '#1e7be6', '#f29a00', '#7a4ff0', '#94a3b8'];

view.innerHTML = `
<div class="dz">
  <section class="dz-hero">
    <div><h1>${greeting}, ${esc(firstName)} <span class="dz-wave" aria-hidden="true">👋</span></h1>
      <p id="dzSub">Here’s what’s happening at your pharmacy today.</p></div>
    <div class="dz-mobile-search">${searchBox('dzSearchMobile')}</div>
    <div class="dz-actions">
      <a class="dz-btn dz-btn-primary" href="billing.html">${ICONS.plus}New Sale</a>
      <a class="dz-btn dz-btn-outline" href="medicines.html?new=1">${ICONS.plus}Add Medicine</a>
    </div>
  </section>

  <section class="dz-kpis" aria-label="Today at a glance">
    ${KPI('green', ICONS.bars, 'Today’s Sales', 'kSales', 'sales.html')}
    ${KPI('blue', icon('cart'), 'Orders', 'kOrders', 'sales.html')}
    ${KPI('amber', ICONS.warn, 'Low Stock', 'kLow', 'inventory.html')}
    ${KPI('purple', icon('truck'), 'Pending Deliveries', 'kDel', 'delivery.html')}
  </section>

  <section class="dz-kpis dz-kpis-2" aria-label="Purchases, returns and expenses today">
    ${KPI('navy', icon('bag'), 'Today’s Purchases', 'kPur', 'purchases.html')}
    ${KPI('rose', icon('undo'), 'Sales Returns Today', 'kSRet', 'returns.html')}
    ${KPI('teal', ICONS.boxBack, 'Purchase Returns Today', 'kPRet', 'returns.html?tab=purchase')}
    ${KPI('orange', icon('wallet'), 'Today’s Expenses', 'kExp', 'expenses.html')}
  </section>

  <section class="dz-card dz-quick" aria-label="Quick actions">
    <div class="dz-card-head"><div class="dz-card-title">${ICONS.bolt}<div><h2>Quick Actions</h2><p>Jump straight to common tasks</p></div></div></div>
    <div class="dz-qa">${QUICK.map(([href, ic, label, cls]) => `<a class="dz-qa-item ${cls}" href="${href}"><span>${ic}</span>${label}</a>`).join('')}</div>
  </section>

  <section class="dz-row dz-row-a">
    <article class="dz-card">
      <div class="dz-card-head">
        <div class="dz-card-title">${ICONS.chartTitle}<div><h2>Sales Overview</h2><p id="chartSub">Total sales for the last 7 days</p></div></div>
        <select class="dz-select" id="chartRange" aria-label="Sales period">
          <option value="7">Last 7 Days</option><option value="14">Last 14 Days</option><option value="30">Last 30 Days</option><option value="90">Last 90 Days</option>
        </select>
      </div>
      <div class="dz-chart" id="chart"><div class="dz-empty">Loading sales…</div></div>
      <div class="dz-chart-foot"><span id="chartTotal"></span><span id="chartAvg"></span></div>
    </article>
    <article class="dz-card">
      <div class="dz-card-head"><div class="dz-card-title">${icon('box')}<div><h2>Inventory Overview</h2><p>Stock status of all medicines</p></div></div></div>
      <div class="dz-inv">
        <div class="dz-donut" id="donut"><svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="84" stroke="#eef1f5"/></svg><div class="dz-donut-center"><strong id="invTotal"><span class="dz-skel"></span></strong><span>Total Items</span></div></div>
        <div class="dz-legend" id="legend"></div>
      </div>
    </article>
  </section>

  <section class="dz-row dz-row-3">
    <article class="dz-card">
      <div class="dz-card-head"><div class="dz-card-title">${ICONS.book}<div><h2>Today’s Ledger Totals</h2><p>Money in and out by account</p></div></div>
        <a class="dz-link" href="finance.html?tab=led">Ledger ${icon('chevron')}</a></div>
      <div id="ledger"><div class="dz-empty">Loading…</div></div>
    </article>
    <article class="dz-card">
      <div class="dz-card-head"><div class="dz-card-title">${ICONS.scale}<div><h2>Outstanding Balances</h2><p>Credit given and supplier dues</p></div></div>
        <a class="dz-link" href="finance.html">Finance ${icon('chevron')}</a></div>
      <div id="outstanding"><div class="dz-empty">Loading…</div></div>
    </article>
    <article class="dz-card">
      <div class="dz-card-head"><div class="dz-card-title">${icon('wallet')}<div><h2>Expenses Overview</h2><p id="expSub">This month by category</p></div></div>
        <a class="dz-link" href="expenses.html">View All ${icon('chevron')}</a></div>
      <div id="expenses"><div class="dz-empty">Loading…</div></div>
    </article>
  </section>

  <section class="dz-row dz-row-b">
    <article class="dz-card">
      <div class="dz-card-head"><div class="dz-card-title">${ICONS.warn}<div><h2>Inventory Alerts</h2><p>Stock that needs your attention</p></div></div>
        <a class="dz-link" href="inventory.html">View All ${icon('chevron')}</a></div>
      <div class="dz-alerts" id="alerts"></div>
      <div class="dz-table-wrap"><table class="dz-table"><thead><tr><th>Medicine</th><th class="dz-center">In Stock</th><th class="dz-center">Min. Stock</th></tr></thead>
        <tbody id="lowRows"><tr><td colspan="3" class="dz-empty">Loading…</td></tr></tbody></table></div>
    </article>
    <article class="dz-card">
      <div class="dz-card-head"><div class="dz-card-title">${ICONS.hourglass}<div><h2>Expiry Watch</h2><p>Batches in stock by expiry date</p></div></div>
        <a class="dz-link" href="inventory.html">View All ${icon('chevron')}</a></div>
      <div class="dz-seg" id="expSeg" role="tablist" aria-label="Expiry window">
        <button type="button" role="tab" data-w="expired">Expired <b id="segExpired">0</b></button>
        <button type="button" role="tab" data-w="30" class="on">≤ 30 days <b id="seg30">0</b></button>
        <button type="button" role="tab" data-w="90">31–90 days <b id="seg90">0</b></button>
      </div>
      <div class="dz-table-wrap"><table class="dz-table"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="dz-num">Qty</th><th class="dz-num dz-col-date">Value (cost)</th></tr></thead>
        <tbody id="expiryRows"><tr><td colspan="5" class="dz-empty">Loading…</td></tr></tbody></table></div>
      <div class="dz-card-foot" id="expiryFoot"></div>
    </article>
  </section>

  <section class="dz-row dz-row-c">
    <article class="dz-card">
      <div class="dz-card-head"><div class="dz-card-title">${ICONS.doc}<div><h2>Recent Sales</h2><p>Latest bills from the counter</p></div></div>
        <a class="dz-link" href="sales.html">View All ${icon('chevron')}</a></div>
      <div class="dz-table-wrap"><table class="dz-table"><thead><tr><th>Invoice No.</th><th>Customer</th><th class="dz-col-date">Date &amp; Time</th><th class="dz-num">Amount</th><th class="dz-center">Status</th></tr></thead>
        <tbody id="recent"><tr><td colspan="5" class="dz-empty">Loading…</td></tr></tbody></table></div>
    </article>
    <article class="dz-card">
      <div class="dz-card-head"><div class="dz-card-title">${icon('bag')}<div><h2>Recent Purchases</h2><p>Latest supplier bills</p></div></div>
        <a class="dz-link" href="purchases.html">View All ${icon('chevron')}</a></div>
      <div class="dz-table-wrap"><table class="dz-table"><thead><tr><th>Bill No.</th><th>Distributor</th><th class="dz-col-date">Bill Date</th><th class="dz-num">Amount</th></tr></thead>
        <tbody id="recentPur"><tr><td colspan="4" class="dz-empty">Loading…</td></tr></tbody></table></div>
    </article>
  </section>

  <div class="dz-status" id="dzStatus" role="status"></div>
</div>`;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
let invoices = [];         // last 91 days (final only) for KPIs and chart
let chartDays = 7;
let expiryWindow = '30';
let expiryLists = { expired: [], '30': [], '90': [] };

const sumBy = (rows, key, day, dateKey = 'created_at') => (rows || []).filter(r => istDay(r[dateKey]) === day).reduce((s, r) => s + (Number(r[key]) || 0), 0);
const countOn = (rows, day, dateKey = 'created_at') => (rows || []).filter(r => istDay(r[dateKey]) === day).length;
const plural = (n, one, many = one + 's') => `${count(n)} ${n === 1 ? one : many}`;

async function load() {
  const status = document.getElementById('dzStatus');
  status.textContent = 'Updating…';
  const from = addDays(today, -90);
  const yesterday = addDays(today, -1);
  const monthStart = today.slice(0, 8) + '01';
  const expFrom = monthStart < yesterday ? monthStart : yesterday;
  const sinceY = istStartUtc(yesterday);

  const [branch, inv, recent, low, deliveries, meds, batches, deact, dues, payables, recentPur, purToday, sRet, pRet, exps, drafts, ledger] = await Promise.all([
    safe(sb.from('branches').select('name').eq('id', prof.branch_id).maybeSingle()),
    fetchAll(() => sb.from('sales_invoices').select('id,total,created_at').eq('branch_id', prof.branch_id).eq('status', 'final').gte('created_at', istStartUtc(from)).order('created_at')),
    safe(sb.from('sales_invoices').select('id,invoice_no,customer_id,total,status,created_at,patient_name').eq('branch_id', prof.branch_id).order('created_at', { ascending: false }).limit(6)),
    safe(sb.rpc('low_stock')),
    safe(sb.rpc('delivery_management_list')),
    fetchAll(() => sb.from('medicines').select('id,name,strength,reorder_level').eq('branch_id', prof.branch_id).eq('active', true).order('id')),
    fetchAll(() => sb.from('medicine_batches').select('id,medicine_id,batch_no,qty,expiry,quarantined,stock_status,unit_cost').eq('branch_id', prof.branch_id).gt('qty', 0).order('id')),
    safe(sb.rpc('medicine_deactivation_request_list')),
    safe(sb.rpc('customer_dues')),
    safe(sb.rpc('payable_balances')),
    safe(sb.rpc('purchase_list', { p_limit: 6 })),
    fetchAll(() => sb.from('purchase_invoices').select('id,total,status,created_at').eq('branch_id', prof.branch_id).gte('created_at', sinceY).order('created_at')),
    fetchAll(() => sb.from('sales_returns').select('id,total,created_at').eq('branch_id', prof.branch_id).gte('created_at', sinceY).order('created_at')),
    fetchAll(() => sb.from('purchase_returns').select('id,total_value,created_at').eq('branch_id', prof.branch_id).gte('created_at', sinceY).order('created_at')),
    safe(sb.rpc('expense_get_list', { p_from: expFrom, p_to: today, p_status: 'posted' })),
    safe(sb.rpc('expense_get_list', { p_from: null, p_to: null, p_status: 'draft' })),
    safe(sb.rpc('ledger_summary', { p_from: today, p_to: today }))
  ]);

  if (branch?.name) document.getElementById('dzSub').textContent = `Here’s what’s happening at ${titleCase(branch.name)} today.`;

  // ---- KPI row 1: today vs yesterday
  invoices = inv || [];
  const byDay = new Map();
  for (const r of invoices) { const k = istDay(r.created_at); const e = byDay.get(k) || { total: 0, n: 0 }; e.total += Number(r.total) || 0; e.n++; byDay.set(k, e); }
  const t = byDay.get(today) || { total: 0, n: 0 }, y = byDay.get(yesterday) || { total: 0, n: 0 };
  setKpi('kSales', inv ? rupees0(t.total) : '—', inv ? trend(t.total, y.total, 'sales') : 'Unavailable');
  setKpi('kOrders', inv ? count(t.n) : '—', inv ? trend(t.n, y.n, 'bills') : 'Unavailable');
  const outOfStock = (low || []).filter(l => Number(l.sellable) <= 0).length;
  setKpi('kLow', low ? plural(low.length, 'item') : '—', low ? (outOfStock ? `<span class="dz-down">${count(outOfStock)} out of stock</span>` : '<span>at or below reorder level</span>') : 'Unavailable');
  const delRows = (deliveries?.invoices || []).filter(r => r.delivery?.is_requested && ['pending', 'out'].includes(r.delivery.status));
  const outNow = delRows.filter(r => r.delivery.status === 'out').length;
  setKpi('kDel', deliveries ? count(delRows.length) : '—', deliveries ? `<span>${count(outNow)} out for delivery</span>` : 'Unavailable');
  byDayCache = byDay;
  drawChart();

  // ---- KPI row 2: purchases, returns, expenses (today vs yesterday)
  const purOk = (purToday || []).filter(p => p.status === 'confirmed');
  const purT = sumBy(purOk, 'total', today), purY = sumBy(purOk, 'total', yesterday), purN = countOn(purOk, today);
  setKpi('kPur', purToday ? rupees0(purT) : '—', purToday ? `<span>${plural(purN, 'bill')}</span>${purY || purT ? trend(purT, purY, 'purchases') : ''}` : 'Unavailable');
  const srT = sumBy(sRet, 'total', today), srY = sumBy(sRet, 'total', yesterday), srN = countOn(sRet, today);
  setKpi('kSRet', sRet ? rupees0(srT) : '—', sRet ? `<span>${plural(srN, 'return')}</span><span class="dz-muted">yesterday ${rupees0(srY)}</span>` : 'Unavailable');
  const prT = sumBy(pRet, 'total_value', today), prY = sumBy(pRet, 'total_value', yesterday), prN = countOn(pRet, today);
  setKpi('kPRet', pRet ? rupees0(prT) : '—', pRet ? `<span>${plural(prN, 'return')}</span><span class="dz-muted">yesterday ${rupees0(prY)}</span>` : 'Unavailable');
  const expT = (exps || []).filter(e => e.expense_date === today).reduce((s, e) => s + Number(e.amount || 0), 0);
  const expTn = (exps || []).filter(e => e.expense_date === today).length;
  setKpi('kExp', exps ? rupees0(expT) : '—', exps ? `<span>${plural(expTn, 'expense')} posted</span>${drafts?.length ? `<span class="dz-warnText">${count(drafts.length)} draft${drafts.length === 1 ? '' : 's'} to post</span>` : ''}` : 'Unavailable');

  // ---- Inventory overview + alerts + expiry watch
  const medById = new Map((meds || []).map(m => [m.id, m]));
  const sellable = new Map();
  const d30 = addDays(today, 30), d90 = addDays(today, 90);
  const lists = { expired: [], '30': [], '90': [] };
  let blocked = 0;
  for (const b of batches || []) {
    const st = b.stock_status || 'active';
    const ok = b.expiry > today && !b.quarantined && st === 'active';
    if (ok) sellable.set(b.medicine_id, (sellable.get(b.medicine_id) || 0) + Number(b.qty));
    if (b.quarantined || st !== 'active') blocked++;
    const row = { ...b, med: medById.get(b.medicine_id) };
    if (b.expiry <= today) lists.expired.push(row);
    else if (b.expiry <= d30) lists['30'].push(row);
    else if (b.expiry <= d90) lists['90'].push(row);
  }
  for (const k of Object.keys(lists)) lists[k].sort((a, b) => a.expiry.localeCompare(b.expiry) || Number(b.qty) - Number(a.qty));
  expiryLists = lists;
  let inStock = 0, lowCt = 0, out = 0;
  for (const m of meds || []) {
    const q = sellable.get(m.id) || 0, lvl = Number(m.reorder_level) || 0;
    if (q <= 0) out++; else if (lvl > 0 && q <= lvl) lowCt++; else inStock++;
  }
  drawDonut(meds ? [inStock, lowCt, out] : null);

  const lowList = (low || []).slice().sort((a, b) => Number(a.sellable) - Number(b.sellable) || String(a.name).localeCompare(b.name));
  const tiles = [
    ['danger', 'Out of stock', low ? outOfStock : null, 'inventory.html'],
    ['warn', 'Low stock', low ? lowList.length - outOfStock : null, 'inventory.html'],
    ['danger', 'Expired in stock', batches ? lists.expired.length : null, 'inventory.html', 'batches'],
    ['warn', 'Expiring ≤ 30 days', batches ? lists['30'].length : null, 'inventory.html', 'batches'],
    ['info', 'Blocked / quarantined', batches ? blocked : null, 'inventory.html', 'batches'],
    ['info', 'Deactivation requests', deact ? deact.length : null, 'medicines.html', 'requests']
  ];
  document.getElementById('alerts').innerHTML = tiles.map(([tone, label, n, href, unit]) =>
    `<a class="dz-alert ${n ? tone : 'clear'}" href="${href}"><strong>${n == null ? '—' : count(n)}</strong><span>${label}</span>${unit && n ? `<small>${unit}</small>` : ''}</a>`).join('');
  document.getElementById('lowRows').innerHTML = lowList.length ? lowList.slice(0, 5).map(l => `<tr data-href="medicines.html?q=${encodeURIComponent(l.name)}"><td><span class="dz-med">${icon('pill')}${esc(l.name)}</span></td><td class="dz-center"><span class="dz-pill-red">${count(l.sellable)}</span></td><td class="dz-center">${count(l.reorder_level)}</td></tr>`).join('')
    : `<tr><td colspan="3" class="dz-empty">${low ? 'All medicines are above their reorder level.' : 'Low-stock data is unavailable.'}</td></tr>`;
  document.getElementById('segExpired').textContent = count(lists.expired.length);
  document.getElementById('seg30').textContent = count(lists['30'].length);
  document.getElementById('seg90').textContent = count(lists['90'].length);
  drawExpiry(!!batches);

  // ---- Recent sales
  const recentRows = recent || [];
  const custIds = [...new Set(recentRows.map(r => r.customer_id).filter(Boolean))];
  const ids = recentRows.map(r => r.id);
  const [custs, pays] = await Promise.all([
    custIds.length ? safe(sb.from('customers').select('id,name').in('id', custIds)) : [],
    ids.length ? safe(sb.from('payments').select('invoice_id,method').in('invoice_id', ids)) : []
  ]);
  const cname = new Map((custs || []).map(c => [c.id, c.name]));
  const onCredit = new Set((pays || []).filter(p => p.method === 'credit').map(p => p.invoice_id));
  document.getElementById('recent').innerHTML = recentRows.length ? recentRows.map(r => {
    const badge = r.status === 'cancelled' ? '<span class="dz-badge bad">Cancelled</span>' : r.status === 'refunded' ? '<span class="dz-badge bad">Refunded</span>'
      : onCredit.has(r.id) ? '<span class="dz-badge credit">Credit</span>' : '<span class="dz-badge ok">Completed</span>';
    return `<tr data-href="${r.id ? `invoice-view.html?id=${encodeURIComponent(r.id)}` : `sales.html?q=${encodeURIComponent(r.invoice_no)}`}"><td>${esc(r.invoice_no)}</td><td class="dz-wrap">${esc(cname.get(r.customer_id) || r.patient_name || 'Walk-in')}</td><td class="dz-col-date">${esc(when(r.created_at))}</td><td class="dz-num">${rupees2(r.total)}</td><td class="dz-center">${badge}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="dz-empty">No bills yet. Click “New Sale” to create the first one.</td></tr>';

  // ---- Recent purchases
  document.getElementById('recentPur').innerHTML = recentPur?.length ? recentPur.map(p => `<tr data-href="purchases.html?q=${encodeURIComponent(p.supplier_invoice_no)}"><td>${esc(p.supplier_invoice_no)}${p.status !== 'confirmed' ? ` <span class="dz-badge bad">${esc(titleCase(p.status))}</span>` : ''}</td><td class="dz-wrap">${esc(p.distributor || '—')}</td><td class="dz-col-date">${esc(shortDay(p.invoice_date))}</td><td class="dz-num">${p.total == null ? '—' : rupees2(p.total)}</td></tr>`).join('')
    : `<tr><td colspan="4" class="dz-empty">${recentPur ? 'No purchase bills yet.' : 'Purchase data is unavailable.'}</td></tr>`;

  // ---- Today's ledger totals
  drawLedger(ledger);

  // ---- Outstanding balances
  const duesTotal = (dues || []).reduce((s, r) => s + Number(r.outstanding || 0), 0);
  const owe = (payables || []).filter(r => Number(r.balance) > 0);
  const advance = (payables || []).filter(r => Number(r.balance) < 0);
  const payTotal = owe.reduce((s, r) => s + Number(r.balance), 0);
  const top = (rows, nameKey, valKey, href) => rows.slice(0, 3).map(r => `<a href="${href}"><span>${esc(r[nameKey])}</span><b>${rupees0(r[valKey])}</b></a>`).join('');
  const overLimit = (dues || []).filter(r => Number(r.credit_limit) > 0 && Number(r.outstanding) > Number(r.credit_limit)).length;
  document.getElementById('outstanding').innerHTML = `
    <div class="dz-owe">
      <div class="dz-owe-box in"><span>Customers owe you</span><strong>${dues ? rupees0(duesTotal) : '—'}</strong><small>${dues ? plural(dues.length, 'customer') : 'Unavailable'}${overLimit ? ` · <em>${count(overLimit)} over limit</em>` : ''}</small>
        <div class="dz-owe-list">${dues?.length ? top(dues, 'name', 'outstanding', 'finance.html?tab=rec') : '<p>No customer dues.</p>'}</div>
        <a class="dz-owe-go" href="finance.html?tab=rec">Collect payment ${icon('chevron')}</a></div>
      <div class="dz-owe-box out"><span>You owe distributors</span><strong>${payables ? rupees0(payTotal) : '—'}</strong><small>${payables ? plural(owe.length, 'distributor') : 'Unavailable'}${advance.length ? ` · ${count(advance.length)} with advance` : ''}</small>
        <div class="dz-owe-list">${owe.length ? top(owe, 'name', 'balance', 'finance.html?tab=pay') : '<p>Nothing due to suppliers.</p>'}</div>
        <a class="dz-owe-go" href="finance.html?tab=pay">Pay supplier ${icon('chevron')}</a></div>
    </div>`;

  // ---- Expenses overview (posted only; same rule as Expenses → Reports)
  const monthRows = (exps || []).filter(e => e.expense_date >= monthStart);
  const monthTotal = monthRows.reduce((s, e) => s + Number(e.amount || 0), 0);
  const byCat = new Map();
  for (const e of monthRows) byCat.set(e.category_name, (byCat.get(e.category_name) || 0) + Number(e.amount || 0));
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const shown = cats.slice(0, 4);
  if (cats.length > 4) shown.push(['Other', cats.slice(4).reduce((s, [, v]) => s + v, 0)]);
  const maxCat = Math.max(1, ...shown.map(([, v]) => v));
  const monthName = new Date(today + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });
  document.getElementById('expSub').textContent = `${monthName} by category`;
  document.getElementById('expenses').innerHTML = exps ? `
    <div class="dz-exp-top"><div><span>This month</span><strong>${rupees0(monthTotal)}</strong><small>${plural(monthRows.length, 'expense')}</small></div>
      <div><span>Today</span><strong>${rupees0(expT)}</strong><small>${drafts?.length ? `<a href="expenses.html">${count(drafts.length)} draft${drafts.length === 1 ? '' : 's'} waiting</a>` : 'no drafts waiting'}</small></div></div>
    <div class="dz-bars">${shown.length ? shown.map(([n, v], i) => `<div class="dz-bar"><span>${esc(n)}</span><b>${rupees0(v)}</b><i><em style="width:${Math.max(3, v / maxCat * 100).toFixed(1)}%;background:${BAR_COLORS[i % BAR_COLORS.length]}"></em></i></div>`).join('') : '<p class="dz-empty">No expenses posted this month.</p>'}</div>`
    : '<p class="dz-empty">Expense data is unavailable.</p>';

  // ---- Notifications (which alerts appear follows Settings → Notifications, 0033)
  const notes = [];
  const AS = appSettings, nd = Number(AS.notifications.expiry_days) || 30, dN = addDays(today, nd);
  const soon = (batches || []).filter(b => b.expiry > today && b.expiry <= dN && Number(b.qty) > 0).length;
  if (AS.general.low_stock_alerts !== false && lowList.length) notes.push({ tone: 'warn', title: `${count(lowList.length)} medicine(s) at low stock`, detail: lowList.slice(0, 3).map(l => l.name).join(', '), href: 'inventory.html' });
  if (AS.general.expiry_alerts !== false && lists.expired.length) notes.push({ tone: 'danger', title: `${count(lists.expired.length)} expired batch(es) still in stock`, detail: 'Write off or return to distributor', href: 'inventory.html' });
  if (AS.general.expiry_alerts !== false && soon) notes.push({ tone: 'warn', title: `${count(soon)} batch(es) expire within ${nd} days`, detail: 'Sell first or plan returns', href: 'inventory.html' });
  const waiting = delRows.filter(r => r.delivery.status === 'pending' && !r.delivery.assigned_to).length;
  if (AS.notifications.deliveries !== false && waiting) notes.push({ tone: 'info', title: `${count(waiting)} delivery request(s) not assigned`, detail: 'Assign a delivery person', href: 'delivery.html' });
  if (AS.notifications.deactivations !== false && deact?.length) notes.push({ tone: 'info', title: `${count(deact.length)} medicine deactivation request(s)`, detail: 'Waiting for your review', href: 'medicines.html' });
  if (AS.notifications.expense_drafts !== false && drafts?.length) notes.push({ tone: 'info', title: `${count(drafts.length)} expense draft(s) not posted`, detail: 'Post them so they reach the ledger', href: 'expenses.html' });
  if (backupNote) notes.push(backupNote);
  setNotifications(notes);

  status.textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })} · figures are for your branch only`;
}

function setKpi(id, value, note) {
  document.getElementById(id).textContent = value;
  document.getElementById(id + 'Note').innerHTML = note;
}

// ---------------------------------------------------------------------------
// Expiry watch table
// ---------------------------------------------------------------------------
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
function drawExpiry(ok = true) {
  document.querySelectorAll('#expSeg button').forEach(b => { const on = b.dataset.w === expiryWindow; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  const rows = expiryLists[expiryWindow] || [];
  const body = document.getElementById('expiryRows');
  if (!ok) { body.innerHTML = '<tr><td colspan="5" class="dz-empty">Batch data is unavailable.</td></tr>'; document.getElementById('expiryFoot').textContent = ''; return; }
  body.innerHTML = rows.length ? rows.slice(0, 6).map(b => {
    const d = daysBetween(today, b.expiry);
    const tag = d <= 0 ? `<span class="dz-badge bad">${d === 0 ? 'Today' : `${-d}d ago`}</span>` : `<span class="dz-badge ${d <= 30 ? 'credit' : 'soft'}">${d}d left</span>`;
    const name = b.med ? `${b.med.name}${b.med.strength ? ' ' + b.med.strength : ''}` : 'Unknown medicine';
    const val = b.unit_cost == null ? '—' : rupees0(Number(b.unit_cost) * Number(b.qty));
    return `<tr data-href="medicines.html?q=${encodeURIComponent(b.med?.name || '')}"><td class="dz-wrap">${esc(name)}</td><td>${esc(b.batch_no)}</td><td>${esc(shortDay(b.expiry))} ${tag}</td><td class="dz-num">${count(b.qty)}</td><td class="dz-num dz-col-date">${val}</td></tr>`;
  }).join('') : `<tr><td colspan="5" class="dz-empty">${expiryWindow === 'expired' ? 'No expired stock on the shelves.' : 'No batches expire in this window.'}</td></tr>`;
  const value = rows.reduce((s, b) => s + (b.unit_cost == null ? 0 : Number(b.unit_cost) * Number(b.qty)), 0);
  document.getElementById('expiryFoot').innerHTML = rows.length ? `<span>${plural(rows.length, 'batch', 'batches')}${rows.length > 6 ? ' · showing the earliest 6' : ''}</span><span>Stock value at cost <b>${rupees0(value)}</b></span>` : '';
}
document.getElementById('expSeg').onclick = e => { const b = e.target.closest('[data-w]'); if (!b) return; expiryWindow = b.dataset.w; drawExpiry(); };

// ---------------------------------------------------------------------------
// Today's ledger totals (financial_ledger, IST calendar day)
// ---------------------------------------------------------------------------
const MONEY_ACCOUNTS = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['bank', 'Bank']];
const BOOK_ACCOUNTS = [
  ['sales', 'Sales', r => r.credit - r.debit],
  ['sales_returns', 'Sales returns', r => r.debit - r.credit],
  ['purchases', 'Purchases', r => r.debit - r.credit],
  ['purchase_returns', 'Purchase returns', r => r.credit - r.debit],
  ['expenses', 'Expenses', r => r.debit - r.credit],
  ['receivables', 'Credit sales (net)', r => r.debit - r.credit]
];
function drawLedger(rows) {
  const el = document.getElementById('ledger');
  if (!rows) { el.innerHTML = '<p class="dz-empty">Ledger data is unavailable.</p>'; return; }
  const acc = new Map(rows.map(r => [r.account, { debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }]));
  const get = k => acc.get(k) || { debit: 0, credit: 0 };
  const inT = MONEY_ACCOUNTS.reduce((s, [k]) => s + get(k).debit, 0);
  const outT = MONEY_ACCOUNTS.reduce((s, [k]) => s + get(k).credit, 0);
  const dr = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0), cr = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
  const balanced = Math.abs(dr - cr) < 0.005;
  const net = inT - outT;
  el.innerHTML = `
    <div class="dz-led-top">
      <div class="in"><span>Money in</span><strong>${rupees0(inT)}</strong></div>
      <div class="out"><span>Money out</span><strong>${rupees0(outT)}</strong></div>
      <div class="net"><span>Net</span><strong class="${net < 0 ? 'neg' : ''}">${net < 0 ? '−' : ''}${rupees0(Math.abs(net))}</strong></div>
    </div>
    <table class="dz-table dz-led"><thead><tr><th>Account</th><th class="dz-num">In</th><th class="dz-num">Out</th><th class="dz-num">Net</th></tr></thead><tbody>
      ${MONEY_ACCOUNTS.map(([k, l]) => { const a = get(k), n = a.debit - a.credit; return `<tr data-href="finance.html?tab=led"><td>${l}</td><td class="dz-num">${rupees0(a.debit)}</td><td class="dz-num">${rupees0(a.credit)}</td><td class="dz-num ${n < 0 ? 'dz-negNum' : ''}">${n < 0 ? '−' : ''}${rupees0(Math.abs(n))}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="dz-led-books">${BOOK_ACCOUNTS.filter(([k]) => acc.has(k)).map(([k, l, f]) => `<span>${l}<b>${rupees0(f(get(k)))}</b></span>`).join('') || '<span class="dz-muted">No entries posted today yet.</span>'}</div>
    <div class="dz-led-check ${balanced ? 'ok' : 'bad'}">${balanced ? '✓' : '!'} Debits ${rupees2(dr)} · Credits ${rupees2(cr)}${balanced ? ' · balanced' : ' · not balanced, check the ledger'}</div>`;
}

// ---------------------------------------------------------------------------
// Sales chart (SVG, smooth line + area, hover tooltips)
// ---------------------------------------------------------------------------
let byDayCache = new Map();
// Six even steps on "nice" values (1, 2, 2.5, 5 × 10^n) with ~8% headroom above the peak.
function niceStep(v) {
  if (v <= 0) return 1000;
  const raw = v * 1.08 / 6, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const axisMoney = v => v >= 100000 ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : '₹' + new Intl.NumberFormat('en-IN').format(v);

function drawChart() {
  const el = document.getElementById('chart');
  const days = [];
  for (let i = chartDays - 1; i >= 0; i--) days.push(addDays(today, -i));
  const vals = days.map(d => byDayCache.get(d)?.total || 0);
  const total = vals.reduce((a, b) => a + b, 0);
  document.getElementById('chartSub').textContent = `Total sales for the last ${chartDays} days`;
  document.getElementById('chartTotal').textContent = `Total ${rupees0(total)}`;
  document.getElementById('chartAvg').textContent = `Daily average ${rupees0(total / chartDays)}`;

  const W = Math.max(320, el.clientWidth), H = el.clientHeight || 250;
  const padL = W < 520 ? 56 : 64, padR = W < 520 ? 18 : 26, padT = 34, padB = 30;
  const steps = 6;
  const tick = niceStep(Math.max(...vals));
  const max = tick * steps;
  const x = i => padL + (chartDays === 1 ? 0 : i * (W - padL - padR) / (chartDays - 1));
  const yv = v => padT + (H - padT - padB) * (1 - v / max);
  const pts = vals.map((v, i) => [x(i), yv(v)]);
  // Catmull-Rom → cubic Bézier for a smooth line
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const t = 0.18;
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${Math.min(H - padB, p1[1] + (p2[1] - p0[1]) * t)} ${p2[0] - (p3[0] - p1[0]) * t},${Math.min(H - padB, p2[1] - (p3[1] - p1[1]) * t)} ${p2[0]},${p2[1]}`;
  }
  const area = `${d} L${pts[pts.length - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z`;
  // Thin the date labels so they never overlap (about 58px per label).
  const fit = Math.max(2, Math.floor((W - padL - padR) / 58));
  const labelEvery = Math.max(1, Math.ceil(chartDays / fit));
  const grid = Array.from({ length: steps + 1 }, (_, i) => i * tick);
  const showPts = chartDays <= 30;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily sales for the last ${chartDays} days, total ${rupees0(total)}">
    <defs><linearGradient id="dzArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fbf3a" stop-opacity=".32"/><stop offset="1" stop-color="#2fbf3a" stop-opacity=".04"/></linearGradient></defs>
    <g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${yv(v)}" y2="${yv(v)}"/>`).join('')}
      <line x1="${padL}" x2="${padL}" y1="${padT - 6}" y2="${H - padB}"/>${days.map((_, i) => i % labelEvery === 0 || i === chartDays - 1 ? `<line x1="${x(i)}" x2="${x(i)}" y1="${H - padB}" y2="${H - padB + 5}"/>` : '').join('')}</g>
    <g class="dz-axis">${grid.map(v => `<text x="${padL - 10}" y="${yv(v) + 4}" text-anchor="end">${axisMoney(v)}</text>`).join('')}
      ${days.map((dd, i) => (i % labelEvery === 0 && chartDays - 1 - i >= labelEvery / 2) || i === chartDays - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${shortDay(dd)}</text>` : '').join('')}</g>
    <path d="${area}" fill="url(#dzArea)"/>
    <path class="dz-line" d="${d}"/>
    ${pts.map(([px, py], i) => `<circle class="dz-pt${i === pts.length - 1 ? ' hot' : ''}" data-i="${i}" cx="${px}" cy="${py}" r="${showPts || i === pts.length - 1 ? (i === pts.length - 1 ? 6 : 5) : 0}"/>`).join('')}
    ${pts.map(([px], i) => `<rect data-i="${i}" x="${px - (W - padL - padR) / chartDays / 2}" y="${padT}" width="${(W - padL - padR) / chartDays}" height="${H - padT - padB}" fill="transparent"/>`).join('')}
  </svg><div class="dz-tip" id="dzTip"></div>`;
  const tip = document.getElementById('dzTip');
  const show = i => {
    const [px, py] = pts[i];
    tip.innerHTML = `${rupees0(vals[i])}${i === pts.length - 1 ? '' : `<small>${shortDay(days[i])} · ${count(byDayCache.get(days[i])?.n || 0)} bills</small>`}`;
    tip.style.left = `${px / W * 100}%`;
    tip.style.top = `${(py - 12) / H * 100}%`;
    el.querySelectorAll('.dz-pt').forEach(c => c.classList.toggle('hot', +c.dataset.i === i));
  };
  show(pts.length - 1);
  el.querySelector('svg').addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  el.querySelector('svg').addEventListener('mouseleave', () => show(pts.length - 1));
  el.querySelector('svg').addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
}
document.getElementById('chartRange').onchange = e => { chartDays = Number(e.target.value); drawChart(); };
let resizeT;
new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(drawChart, 120); }).observe(document.getElementById('chart'));

// ---------------------------------------------------------------------------
// Inventory donut
// ---------------------------------------------------------------------------
function drawDonut(parts) {
  const legend = document.getElementById('legend');
  if (!parts) { document.getElementById('invTotal').textContent = '—'; legend.innerHTML = '<p class="dz-empty">Inventory data is unavailable.</p>'; return; }
  const total = parts.reduce((a, b) => a + b, 0);
  const colors = ['#1fb52b', '#f5b301', '#e5484d'];
  const labels = [['In Stock', 'inventory.html'], ['Low Stock', 'inventory.html'], ['Out of Stock', 'inventory.html']];
  const C = 2 * Math.PI * 84, gap = total && parts.filter(Boolean).length > 1 ? 3 : 0;
  let offset = 0;
  const segs = parts.map((v, i) => {
    const len = total ? v / total * C : 0;
    const s = len > gap ? `<circle cx="110" cy="110" r="84" stroke="${colors[i]}" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-offset}"/>` : '';
    offset += len;
    return s;
  }).join('');
  document.querySelector('#donut svg').innerHTML = `<circle cx="110" cy="110" r="84" stroke="#eef1f5"/>${segs}`;
  document.getElementById('invTotal').textContent = count(total);
  const pct = parts.map(v => total ? Math.round(v / total * 100) : 0);
  legend.innerHTML = parts.map((v, i) => `<a href="${labels[i][1]}"><i style="background:${colors[i]}"></i><span><b>${labels[i][0]}</b><small>${count(v)} item${v === 1 ? '' : 's'}</small></span><em>${pct[i]}%</em></a>`).join('');
}

// ---------------------------------------------------------------------------
// Global search (medicines, invoices, customers)
// ---------------------------------------------------------------------------
mountGlobalSearch({ sb, prof });
view.addEventListener('click', e => { const tr = e.target.closest('tr[data-href]'); if (tr) location.href = tr.dataset.href; });

// ---------------------------------------------------------------------------
await load();
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
