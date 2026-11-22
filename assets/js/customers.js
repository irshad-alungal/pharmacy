// Customers Management — Pallikkal Pharmacy design.
// Customer master (ID, phone with call/WhatsApp, email, address, age, gender, birthday, notes,
// WhatsApp consent, credit limit, active), purchase statistics (customer_stats, 0025),
// loyalty membership, credit receipts, bills with doctor's sheets, import/export.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { nul, friendly } from './ui.js';
import { showInvoice } from './invoice.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('customers', 'Customers', { layout: 'brand' });
if (!prof) throw new Error('Unable to load user profile.');
const branchId = prof.branch_id;
const view = document.getElementById('view');
if (!branchId) { view.textContent = 'Your profile has no assigned branch. Contact the administrator.'; throw new Error('Missing profile branch_id.'); }
const $ = id => document.getElementById(id);
const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const canBill = ['super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing'].includes(prof.role);
const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const istDay = v => new Date(v).toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmtMoney = value => `₹${num(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money2 = v => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupees0 = v => '₹' + Math.round(num(v)).toLocaleString('en-IN');
const count = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(num(n));
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dmy = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const fmtDate = value => value ? dmy(istDay(value)) : '—';
const when = v => new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  users: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.3c2.9.3 5 2.6 5 5.7"/>', 1.8),
  user: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>', 1.9),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h9a1.5 1.5 0 0 0 1.4-1.1L21.5 7.5H6"/>', 1.9),
  bag: svg('<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', 1.9),
  crown: svg('<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8Z"/><path d="M5 21h14"/>', 1.9),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  filter: svg('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  bars: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/></svg>',
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M16 5h3v2a3 3 0 0 1-3 3M8 5H5v2a3 3 0 0 0 3 3"/><path d="M12 13v4M8 21h8M9 17h6"/>', 1.9),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  phone: svg('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/>', 1.9),
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.6),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', 1.9),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 2),
  bill: svg('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>', 1.9),
  rupee: svg('<path d="M6 4h12M6 8h12M14 4c3 0 4 2 4 4s-1 4-4 4H6l8 8"/>', 2),
  credit: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>', 1.9),
  power: svg('<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>', 2),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  cake: svg('<path d="M4 21h16v-8H4v8Z"/><path d="M4 16c2 1 4 1 6 0s4-1 6 0 3 1 4 0"/><path d="M12 13V9M12 5.5V6"/>', 1.9),
  clip: svg('<path d="m21 11-8.6 8.6a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7L10 17.4a1.7 1.7 0 0 1-2.4-2.4L15.5 7"/>', 2),
  camera: svg('<path d="M4 7h3l2-3h6l2 3h3v12H4Z"/><circle cx="12" cy="13" r="3.5"/>', 1.9),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const TONES = ['#12a01b', '#1e7be6', '#7a4ff0', '#f29a00', '#e5484d', '#0e9488'];
const toneOf = s => TONES[[...String(s || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
const TIERS = [['Platinum', 25000], ['Gold', 10000], ['Silver', 0]];
const tierOf = spent12 => TIERS.find(([, min]) => num(spent12) >= min)[0];
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

function waNumber(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.startsWith('0') && digits.length === 11) digits = `91${digits.slice(1)}`;
  return digits;
}
const digits = v => String(v || '').replace(/\D/g, '');
const prettyPhone = v => { const d = digits(v).slice(-10); return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}` : String(v || ''); };

let list = [];
let stats = new Map();
let statsOk = true;
let page = 1;
let sortKey = 'recent';
const filt = { consent: false, due: false, gender: '' };
let viewedCustomer = null;

view.innerHTML = `
<div class="pos dl md pur ds cs">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.users}</span>
      <div><h1>Customers Management</h1><p>Manage customer details, purchase history, and loyalty.</p></div></div>
    <div class="pos-head-actions md-head-actions ds-head-actions">
      <button type="button" class="pos-btn pos-btn-solid" id="new">${I.plusC}<span>Add Customer</span></button>
      <button type="button" class="pos-btn" id="importBtn">${I.upload}<span>Import</span></button>
      <button type="button" class="pos-btn" id="exportBtn">${I.download}<span>Export</span></button>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn ds-more" id="moreBtn" aria-label="More actions" aria-expanded="false">${I.dots}</button>
        <div class="dl-pop md-menu ds-menu" id="moreMenu" hidden>
          <button type="button" data-more="template">${I.download}<span>Download import template</span></button>
          <button type="button" data-more="birthdays">${I.cake}<span>Birthdays this month</span></button>
          <button type="button" data-more="dupes">${I.users}<span>Find duplicates (phone / name)</span></button>
          <button type="button" data-more="print">${I.print}<span>Print customer list</span></button>
          ${canBill ? `<a href="billing.html">${I.bill}<span>New bill</span></a>` : ''}
          <a href="whatsapp.html">${I.wa}<span>WhatsApp messages</span></a>
        </div></div>
    </div>
  </section>

  <section class="dz-kpis dl-kpis md-kpis">
    ${KPI('green', I.users, 'Total Customers', 'kTotal')}
    ${KPI('blue', I.cart, 'Active Customers', 'kActive')}
    ${KPI('amber', I.bag, 'Repeat Customers', 'kRepeat')}
    ${KPI('purple', I.crown, 'Loyalty Members', 'kLoyal')}
  </section>

  <div id="msg" class="md-msg" role="status"></div>

  <div class="dl-grid md-grid ds-grid cs-grid">
    <div class="dl-main-col">
      <section class="pos-card dl-orders ds-list">
        <div class="dl-card-head ds-list-head">
          <h2>${I.list}Customers List <span id="listTotal">(0)</span></h2>
          <label class="dl-select ds-status"><select id="fStatus" aria-label="Show">
            <option value="">All Customers</option><option value="active">Active</option><option value="inactive">Inactive</option>
            <option value="repeat">Repeat customers</option><option value="loyal">Loyalty members</option><option value="due">With credit due</option>
            <option value="new">New this month</option><option value="bday">Birthdays this month</option><option value="idle">No purchase in 90 days</option><option value="never">Never purchased</option></select></label>
        </div>
        <div class="ds-tools">
          <label class="dl-search">${I.search}<input id="q" type="search" placeholder="Search by customer name, phone, email, or customer ID..." autocomplete="off" aria-label="Search customers"></label>
          <div class="dl-pop-anchor">
            <button type="button" class="pos-btn dl-filter-btn" id="filterBtn" aria-expanded="false">${I.filter}<span>Filter</span><b class="dl-filter-dot" id="filterDot" hidden></b></button>
            <div class="dl-pop" id="filterPop" hidden>
              <div class="pos-field"><label for="sortBy">Sort by</label><select id="sortBy"><option value="recent">Newest first</option><option value="name">Name (A–Z)</option><option value="spent">Total purchases (high first)</option><option value="bills">Number of bills</option><option value="last">Last purchase (recent first)</option><option value="due">Credit due (high first)</option></select></div>
              <div class="pos-field"><label for="fGender">Gender</label><select id="fGender"><option value="">Any</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></div>
              <label class="dl-check"><input type="checkbox" id="fConsent"> WhatsApp consent only</label>
              <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="fReset">Reset</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="fApply">Apply</button></div>
            </div>
          </div>
        </div>
        <div class="dl-table-wrap"><table class="dl-table ds-table cs-table"><thead><tr>
          <th class="c-no">#</th><th class="c-cid">Customer ID</th><th>Customer Name</th><th>Phone</th><th class="c-email">Email</th><th class="c-r">Total Purchases</th><th>Status</th><th class="c-c">Actions</th>
        </tr></thead><tbody id="rows"><tr><td colspan="8" class="dl-empty">Loading customers…</td></tr></tbody></table></div>
        <div class="dl-pager md-pager"><span id="pageInfo"></span><div id="pager"></div>
          <label class="dl-select md-per"><select id="perPage" aria-label="Rows per page"><option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></select></label></div>
      </section>
    </div>

    <aside class="dl-side">
      <section class="pos-card pur-trend">
        <div class="dl-card-head"><h2>${I.bars}Customer Growth</h2>
          <label class="dl-select pur-mini"><select id="trendRange" aria-label="Range"><option value="6">Last 6 Months</option><option value="12">Last 12 Months</option><option value="30d">Last 30 Days</option></select></label></div>
        <div class="dz-chart pur-chart" id="chart"></div>
        <p class="pur-chart-sub" id="chartSub"></p>
      </section>
      <section class="pos-card pur-top">
        <div class="dl-card-head"><h2>${I.trophy}Top Customers <small>(by Purchase Value)</small></h2><button type="button" class="dl-link" id="topAll">View All ${I.chev}</button></div>
        <div class="dl-table-wrap"><table class="dl-table md-plain pur-top-table"><thead><tr><th>Customer</th><th class="c-r">Purchases (₹)</th><th class="c-r">Orders</th></tr></thead><tbody id="topRows"><tr><td colspan="3" class="dl-empty">Loading…</td></tr></tbody></table></div>
      </section>
      <section class="pos-card pur-sum ds-sum">
        <div class="dl-card-head"><h2>${I.users}Customer Summary</h2></div>
        <div class="pur-sum-tiles" id="sumTiles"></div>
        <div class="pur-sum-more" id="sumMore"></div>
      </section>
    </aside>
  </div>
</div>

<dialog id="dlg" class="pos-dialog dl-dialog md-wide ds-dlg"><button type="button" class="pos-icon-btn dl-x" id="cancel" aria-label="Close">${I.xs}</button>
  <form id="f" method="dialog" class="md-form">
    <h3 id="dt">Add customer</h3>
    <input type="hidden" name="id">
    <div class="md-form-grid">
      <div class="pos-field"><label for="cName">Name *</label><input id="cName" name="name" placeholder="Customer name" required maxlength="120"></div>
      <div class="pos-field"><label for="cPhone">Phone *</label><input id="cPhone" name="phone" placeholder="10 digits or +91…" required inputmode="tel" maxlength="20"></div>
      <div class="pos-field"><label for="cEmail">Email</label><input id="cEmail" name="email" type="email" placeholder="name@email.com" maxlength="160"></div>
      <div class="pos-field"><label for="cDob">Date of birth</label><input id="cDob" name="dob" type="date"></div>
      <div class="pos-field"><label for="cAge">Age</label><input id="cAge" name="age" type="number" min="0" max="120" placeholder="Age"></div>
      <div class="pos-field"><label for="cGender">Gender</label><select id="cGender" name="gender"><option value="">Gender (optional)</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></div>
      <div class="pos-field md-span-2"><label for="cAddr">Address</label><textarea id="cAddr" name="address" rows="2" placeholder="House, street, town" maxlength="400"></textarea></div>
      <div class="pos-field md-span-2"><label for="cNotes">Notes <small>— allergies, regular medicines, delivery instructions</small></label><textarea id="cNotes" name="notes" rows="2" maxlength="600"></textarea></div>
      <div class="cs-checks md-span-2">
        <label class="dl-check"><input type="checkbox" name="consent"> Customer agrees to receive WhatsApp messages</label>
        <label class="dl-check" id="loyalWrap"><input type="checkbox" name="loyalty_member"> Loyalty member</label>
        <label class="dl-check"><input type="checkbox" name="active" checked> Active</label>
      </div>
    </div>
    <div id="dupHint" class="purchase-warning" hidden></div>
    <div id="err" class="pos-form-msg" role="alert"></div>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" id="cancel2">Cancel</button><button type="submit" class="pos-btn pos-btn-solid">Save customer</button></div>
  </form>
</dialog>

<dialog id="customer-view" class="pos-dialog dl-dialog md-wide ds-view cust-view-dialog">
  <button type="button" class="pos-icon-btn dl-x" id="customer-view-close" aria-label="Close">${I.xs}</button>
  <h3 id="customer-view-title" class="cs-sr">Customer details</h3>
  <div id="customer-view-body"><p>Loading customer details…</p></div>
</dialog>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide ds-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<input id="importFile" type="file" accept=".xlsx,.xls,.csv" hidden>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });

const f = $('f');
let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const note = (m, bad) => { $('msg').textContent = m; $('msg').className = `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}`; toast(m, bad); };
const dlg = html => { $('puPanel').innerHTML = html; if (!$('puDlg').open) $('puDlg').showModal(); };
$('puDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('puDlg')) $('puDlg').close(); });
const avatar = c => `<span class="ds-av cs-av" style="--c:${toneOf(c.name)}">${I.user}</span>`;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
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
async function load() {
  const [cres, sres] = await Promise.all([
    fetchAll(() => sb.from('customers').select('*').eq('branch_id', branchId).order('created_at', { ascending: false }).order('id')),
    sb.rpc('customer_stats')
  ]);
  if (cres.error && !cres.data) { $('rows').innerHTML = `<tr><td colspan="8" class="dl-empty">${esc(friendly(cres.error))}</td></tr>`; return; }
  list = cres.data || [];
  statsOk = !sres.error;
  stats = new Map((sres.data || []).map(s => [s.customer_id, s]));
  if (sres.error && /customer_stats|function/i.test(sres.error.message || '')) note('Customer IDs, purchase totals and loyalty need database migration 0025_customers_management.sql. Run it once in Supabase.', true);
  renderAll();
}
const st = id => stats.get(id) || { bills: 0, spent: 0, returned: 0, spent_12m: 0, outstanding: 0, last_bill: null, first_bill: null };
const net = id => Math.max(0, num(st(id).spent) - num(st(id).returned));
const cid = c => c.customer_no || '—';
const monthKey = iso => iso.slice(5, 7);

// ---------------------------------------------------------------------------
// KPIs, growth, top, summary, bell
// ---------------------------------------------------------------------------
function monthWindow(offset) {
  const [y, m] = today().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return [d.toISOString().slice(0, 10), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)];
}
const pctOf = (n, t) => `<span class="md-pct ds-green">${t ? (n / t * 100).toFixed(1).replace(/\.0$/, '') : 0}%</span> of total`;
function renderKpis() {
  const total = list.length, active = list.filter(c => c.active).length;
  const repeat = list.filter(c => st(c.id).bills >= 2).length, loyal = list.filter(c => c.loyalty_member).length;
  const [ms] = monthWindow(0);
  const before = list.filter(c => istDay(c.created_at) < ms).length;
  $('kTotal').textContent = count(total);
  if (before) { const p = (total - before) / before * 100; $('kTotalNote').innerHTML = `<span class="${p >= 0 ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.down}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> vs. last month`; }
  else $('kTotalNote').textContent = `${count(total)} added this month`;
  $('kActive').textContent = count(active); $('kActiveNote').innerHTML = pctOf(active, total);
  $('kRepeat').textContent = statsOk ? count(repeat) : '—'; $('kRepeatNote').innerHTML = statsOk ? pctOf(repeat, total) : 'Needs migration 0025';
  $('kRepeat').closest('.dz-kpi').title = 'Customers with 2 or more bills';
  $('kLoyal').textContent = count(loyal); $('kLoyalNote').innerHTML = pctOf(loyal, total);
}
function niceStep(v) { if (v <= 0) return 1; const raw = v * 1.08 / 6, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function series() {
  const r = $('trendRange').value, days = list.map(c => istDay(c.created_at)), out = [];
  const upto = d => days.filter(x => x <= d).length;
  if (r === '30d') { for (let i = 29; i >= 0; i--) { const d = addDays(today(), -i); out.push({ label: new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }), full: dmy(d), v: upto(d), added: days.filter(x => x === d).length }); } return out; }
  for (let i = Number(r) - 1; i >= 0; i--) {
    const [s, e] = monthWindow(-i), end = e > today() ? today() : e;
    out.push({ label: new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), full: new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), v: upto(end), added: days.filter(x => x >= s && x <= e).length });
  }
  return out;
}
function drawChart() {
  const el = $('chart'), s = series(), vals = s.map(x => x.v), N = s.length;
  const added = s.reduce((a, x) => a + x.added, 0);
  $('chartSub').textContent = `${count(added)} new customer${added === 1 ? '' : 's'} in this period · ${count(vals[N - 1])} in total`;
  const W = Math.max(280, el.clientWidth), H = el.clientHeight || 220, padL = 48, padR = 16, padT = 30, padB = 28, steps = 5;
  const lo = Math.min(...vals), hi = Math.max(...vals, lo + 1);
  const tick = niceStep((hi - lo) * 1.2 || 1), min = Math.max(0, Math.floor(lo / tick) * tick - (hi === lo ? tick : 0)), max = min + tick * Math.max(steps, Math.ceil((hi - min) / tick) + 1);
  const st2 = Math.round((max - min) / tick);
  const x = i => padL + (N === 1 ? 0 : i * (W - padL - padR) / (N - 1)), yv = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min));
  const pts = vals.map((v, i) => [x(i), yv(v)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < N - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18; d += ` C${p1[0] + (p2[0] - p0[0]) * t},${Math.min(H - padB, p1[1] + (p2[1] - p0[1]) * t)} ${p2[0] - (p3[0] - p1[0]) * t},${Math.min(H - padB, p2[1] - (p3[1] - p1[1]) * t)} ${p2[0]},${p2[1]}`; }
  const area = `${d} L${pts[N - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z`;
  const fit = Math.max(2, Math.floor((W - padL - padR) / 50)), every = Math.max(1, Math.ceil(N / fit));
  const grid = Array.from({ length: st2 + 1 }, (_, i) => min + i * tick);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Customer growth">
    <defs><linearGradient id="csArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fbf3a" stop-opacity=".35"/><stop offset="1" stop-color="#2fbf3a" stop-opacity=".04"/></linearGradient></defs>
    <g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${yv(v)}" y2="${yv(v)}"/>`).join('')}</g>
    <g class="dz-axis pur-axis">${grid.map(v => `<text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end">${count(v)}</text>`).join('')}${s.map((p, i) => (i % every === 0 && N - 1 - i >= every / 2) || i === N - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '').join('')}</g>
    <path d="${area}" fill="url(#csArea)"/><path class="dz-line" d="${d}"/>
    ${pts.map(([px, py], i) => `<circle class="dz-pt${i === N - 1 ? ' hot' : ''}" data-i="${i}" cx="${px}" cy="${py}" r="${i === N - 1 ? 6 : N > 12 ? 3 : 4.5}"/>`).join('')}
    ${pts.map(([px], i) => `<rect data-i="${i}" x="${px - (W - padL - padR) / N / 2}" y="${padT}" width="${(W - padL - padR) / N}" height="${H - padT - padB}" fill="transparent"/>`).join('')}
  </svg><div class="dz-tip" id="csTip"></div>`;
  const tip = $('csTip');
  const show = i => { const [px, py] = pts[i]; tip.innerHTML = `${count(vals[i])}<small>${esc(s[i].full)} · +${s[i].added} new</small>`; tip.style.left = `${Math.min(Math.max(px / W * 100, 14), 86)}%`; tip.style.top = `${(py - 12) / H * 100}%`; el.querySelectorAll('.dz-pt').forEach(c => c.classList.toggle('hot', +c.dataset.i === i)); };
  show(N - 1);
  const sv = el.querySelector('svg');
  sv.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('mouseleave', () => show(N - 1));
  sv.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
}
function renderTop() {
  const top = list.filter(c => net(c.id) > 0).sort((a, b) => net(b.id) - net(a.id)).slice(0, 5);
  $('topRows').innerHTML = top.map((c, i) => `<tr data-cust="${esc(c.id)}"><td><span class="pur-rank r${i + 1}">${i + 1}</span>${esc(c.name)}${c.loyalty_member ? `<span class="cs-crown" title="Loyalty member">${I.crown}</span>` : ''}</td><td class="c-r">${money2(net(c.id))}</td><td class="c-r">${st(c.id).bills}</td></tr>`).join('')
    || `<tr><td colspan="3" class="dl-empty">${statsOk ? 'No customer purchases yet.' : 'Needs migration 0025.'}</td></tr>`;
}
const bdayThisMonth = c => c.dob && monthKey(c.dob) === today().slice(5, 7);
const isIdle = c => { const l = st(c.id).last_bill; return c.active && l && istDay(l) < addDays(today(), -89); };
function renderSummary() {
  const total = list.length, active = list.filter(c => c.active).length, repeat = list.filter(c => st(c.id).bills >= 2).length, loyal = list.filter(c => c.loyalty_member).length;
  $('sumTiles').innerHTML = `
    <button type="button" class="g" data-sum=""><b>${count(total)}</b><span>Total</span></button>
    <button type="button" class="b cs-blue" data-sum="active"><b>${count(active)}</b><span>Active</span></button>
    <button type="button" class="a" data-sum="repeat"><b>${statsOk ? count(repeat) : '—'}</b><span>Repeat</span></button>
    <button type="button" class="p" data-sum="loyal"><b>${count(loyal)}</b><span>Loyalty</span></button>`;
  const dues = list.filter(c => num(st(c.id).outstanding) > 0.005), dueSum = dues.reduce((a, c) => a + num(st(c.id).outstanding), 0);
  const [ms] = monthWindow(0);
  const fresh = list.filter(c => istDay(c.created_at) >= ms).length, bd = list.filter(c => c.active && bdayThisMonth(c)).length, idle = list.filter(isIdle).length, consent = list.filter(c => c.active && c.consent).length;
  $('sumMore').innerHTML = [
    dues.length ? `<button type="button" data-sum="due">${I.credit}<span>Credit due <b>${rupees0(dueSum)}</b> · ${dues.length}</span></button>` : '',
    fresh ? `<button type="button" data-sum="new">${I.plusC}<span>New this month <b>${fresh}</b></span></button>` : '',
    bd ? `<button type="button" data-sum="bday">${I.cake}<span>Birthdays this month <b>${bd}</b></span></button>` : '',
    idle ? `<button type="button" data-sum="idle">${I.cart}<span>No purchase in 90 days <b>${idle}</b></span></button>` : '',
    `<span class="ds-adv">${I.wa}<span>WhatsApp consent <b>${consent}</b></span></span>`
  ].join('');
}
function notify() {
  const items = [];
  const over = list.filter(c => num(st(c.id).outstanding) > 0.005 && num(c.credit_limit) > 0 && num(st(c.id).outstanding) > num(c.credit_limit));
  if (over.length) items.push({ tone: 'danger', title: `${over.length} customer(s) over their credit limit`, detail: over.slice(0, 3).map(c => c.name).join(', '), href: 'customers.html?status=due' });
  const dues = list.filter(c => num(st(c.id).outstanding) > 0.005);
  if (dues.length) items.push({ tone: 'warn', title: `${dues.length} customer(s) owe ${rupees0(dues.reduce((a, c) => a + num(st(c.id).outstanding), 0))}`, detail: dues.slice(0, 3).map(c => c.name).join(', '), href: 'customers.html?status=due' });
  const bdToday = list.filter(c => c.active && c.dob && c.dob.slice(5) === today().slice(5));
  if (bdToday.length) items.push({ tone: 'info', title: `Birthday today: ${bdToday.map(c => c.name).slice(0, 3).join(', ')}`, detail: 'Send a greeting on WhatsApp', href: 'customers.html?status=bday' });
  setNotifications(items);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
function filtered() {
  const raw = $('q').value.trim().toLowerCase(), qd = digits(raw), s = $('fStatus').value, [ms] = monthWindow(0);
  const rows = list.filter(c => {
    if (s === 'active' && !c.active) return false;
    if (s === 'inactive' && c.active) return false;
    if (s === 'repeat' && st(c.id).bills < 2) return false;
    if (s === 'loyal' && !c.loyalty_member) return false;
    if (s === 'due' && !(num(st(c.id).outstanding) > 0.005)) return false;
    if (s === 'new' && istDay(c.created_at) < ms) return false;
    if (s === 'bday' && !bdayThisMonth(c)) return false;
    if (s === 'idle' && !isIdle(c)) return false;
    if (s === 'never' && st(c.id).bills > 0) return false;
    if (filt.consent && !c.consent) return false;
    if (filt.gender && c.gender !== filt.gender) return false;
    if (raw && !(`${c.name} ${c.email || ''} ${c.customer_no || ''} ${c.address || ''}`.toLowerCase().includes(raw) || (qd.length >= 3 && digits(c.phone).includes(qd)))) return false;
    return true;
  });
  const by = {
    recent: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
    name: (a, b) => a.name.localeCompare(b.name),
    spent: (a, b) => net(b.id) - net(a.id) || a.name.localeCompare(b.name),
    bills: (a, b) => st(b.id).bills - st(a.id).bills || a.name.localeCompare(b.name),
    last: (a, b) => String(st(b.id).last_bill || '').localeCompare(String(st(a.id).last_bill || '')),
    due: (a, b) => num(st(b.id).outstanding) - num(st(a.id).outstanding)
  }[sortKey];
  return rows.sort(by);
}
function draw() {
  const rows = filtered(), per = Number($('perPage').value), pages = Math.max(1, Math.ceil(rows.length / per));
  page = Math.min(page, pages);
  const shown = rows.slice((page - 1) * per, page * per);
  $('listTotal').textContent = `(${count(rows.length)})`;
  $('rows').innerHTML = shown.map((c, i) => {
    const s = st(c.id), due = num(s.outstanding);
    return `<tr data-id="${esc(c.id)}" class="${c.active ? '' : 'ds-off'}">
      <td class="c-no">${(page - 1) * per + i + 1}</td>
      <td class="c-cid"><b class="cs-id">${esc(cid(c))}</b></td>
      <td class="c-name"><div class="ds-name">${avatar(c)}<span><b>${esc(c.name)}${c.loyalty_member ? `<span class="cs-crown" title="Loyalty member · ${tierOf(s.spent_12m)}">${I.crown}</span>` : ''}</b>
        <small title="${s.last_bill ? `Last purchase ${fmtDate(s.last_bill)}` : ''}">${s.bills ? `${s.bills} bill${s.bills === 1 ? '' : 's'}` : 'No bills yet'}${due > 0.005 ? ` · <em>Due ${rupees0(due)}</em>` : ''}</small>
        <small class="ds-m-line cs-m-id">${esc(cid(c))}</small></span></div></td>
      <td class="c-phone"><span class="ds-ph"><a class="ds-ph-no" href="tel:${esc(c.phone)}" title="Call">${esc(prettyPhone(c.phone))}</a>${c.consent ? `<a class="ds-wa" href="https://wa.me/${waNumber(c.phone)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp ${esc(c.name)}">${I.wa}</a>` : ''}</span></td>
      <td class="c-email">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="ds-muted">—</span>'}</td>
      <td class="c-r c-spent"><b>${statsOk ? fmtMoney(net(c.id)) : '—'}</b><small class="cs-m-phone">${esc(prettyPhone(c.phone))}</small></td>
      <td class="c-st"><span class="md-chip ${c.active ? 'in' : 'out'}"><i></i>${c.active ? 'Active' : 'Inactive'}</span></td>
      <td class="c-act"><div class="pur-acts"><button type="button" class="dl-act" data-view="${esc(c.id)}" aria-label="View ${esc(c.name)}">${I.eye}</button><div class="dl-pop-anchor"><button type="button" class="dl-act" data-menu aria-label="More actions for ${esc(c.name)}">${I.dots}</button></div></div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="dl-empty">${list.length ? 'No customers match these filters.' : 'No customers yet. Use “Add Customer”.'}</td></tr>`;
  $('pageInfo').textContent = rows.length ? `Showing ${(page - 1) * per + 1} – ${Math.min(page * per, rows.length)} of ${count(rows.length)} customers` : '';
  $('pager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, k) => k + 1).filter(n => n <= 5 && page <= 3 || n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, k, arr) => `${k && n - arr[k - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
  $('filterDot').hidden = !(filt.consent || filt.gender || sortKey !== 'recent');
}
function renderAll() { renderKpis(); draw(); drawChart(); renderTop(); renderSummary(); notify(); }

// row menu + actions
let menuEl = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
function menuHtml(c) {
  const b = (a, ic, l, cls = '') => `<button type="button" data-act="${a}" class="${cls}">${ic}<span>${l}</span></button>`, due = num(st(c.id).outstanding);
  return [
    b('view', I.eye, 'View details'), b('edit', I.pencil, 'Edit'),
    canBill && c.active ? `<a href="billing.html?customer=${encodeURIComponent(c.id)}">${I.bill}<span>New bill</span></a>` : '',
    `<a href="sales.html?q=${encodeURIComponent(c.phone)}">${I.cart}<span>View sales</span></a>`,
    b('balance', I.credit, 'Credit status'),
    due > 0.005 && c.active ? b('receive', I.rupee, `Receive payment (${rupees0(due)})`) : '',
    isAdmin ? b('limit', I.credit, 'Edit credit limit') : '',
    b('loyal', I.crown, c.loyalty_member ? 'Remove from loyalty' : 'Add to loyalty'),
    `<a href="tel:${esc(c.phone)}">${I.phone}<span>Call</span></a>`,
    c.consent ? `<a href="https://wa.me/${waNumber(c.phone)}" target="_blank" rel="noopener">${I.wa}<span>WhatsApp</span></a>` : '',
    c.email ? `<a href="mailto:${esc(c.email)}">${I.mail}<span>Email</span></a>` : '',
    b('toggle', I.power, c.active ? 'Deactivate' : 'Activate', c.active ? 'danger' : '')
  ].join('');
}
$('rows').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const c = list.find(x => x.id === tr.dataset.id);
  const m = e.target.closest('[data-menu]');
  if (m) { e.stopPropagation(); if (menuEl && menuEl.parentElement === m.parentElement) return closeMenu(); closeMenu(); menuEl = document.createElement('div'); menuEl.className = 'dl-pop md-menu md-row-menu pur-row-menu'; menuEl.innerHTML = menuHtml(c); m.parentElement.append(menuEl); return; }
  const a = e.target.closest('[data-act]');
  if (a) { e.stopPropagation(); closeMenu(); return act(a.dataset.act, c); }
  if (e.target.closest('a')) return;
  return openCustomerView(c);
});
document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
async function act(a, c) {
  if (a === 'view') return openCustomerView(c);
  if (a === 'edit') return openForm(c);
  if (a === 'balance') return creditStatus(c);
  if (a === 'receive') return receivePayment(c);
  if (a === 'limit') return editLimit(c);
  if (a === 'loyal') return toggleLoyalty(c);
  if (a === 'toggle') return toggleActive(c);
}
async function creditStatus(c) {
  const { data: outstanding, error } = await sb.rpc('customer_outstanding', { p_customer: c.id });
  if (error) return note(friendly(error), true);
  const limit = num(c.credit_limit), used = num(outstanding);
  note(`${c.name}: Credit limit ₹${limit.toFixed(2)} · Outstanding ₹${used.toFixed(2)} · Available ₹${Math.max(0, limit - used).toFixed(2)}`);
}
async function editLimit(c) {
  if (!isAdmin) return note('Only administrators can edit credit limits.', true);
  const value = prompt(`Set credit limit for ${c.name} (₹):`, String(c.credit_limit || 0));
  if (value === null) return;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 0) return note('Enter a valid non-negative credit limit.', true);
  const { error } = await sb.rpc('set_credit_limit', { p_customer: c.id, p_limit: limit });
  if (error) return note(friendly(error), true);
  await load();
  note(`Credit limit for ${c.name} set to ${fmtMoney(limit)}.`);
  if ($('customer-view').open && viewedCustomer?.id === c.id) openCustomerView(list.find(x => x.id === c.id));
}
async function toggleLoyalty(c) {
  const { error } = await sb.from('customers').update({ loyalty_member: !c.loyalty_member }).eq('id', c.id).eq('branch_id', branchId);
  if (error) return note(/loyalty_member/.test(error.message || '') ? 'Loyalty needs database migration 0025_customers_management.sql.' : friendly(error), true);
  await load();
  note(c.loyalty_member ? `${c.name} removed from the loyalty programme.` : `${c.name} joined the loyalty programme.`);
  if ($('customer-view').open && viewedCustomer?.id === c.id) openCustomerView(list.find(x => x.id === c.id));
}
async function toggleActive(c) {
  if (c.active && num(st(c.id).outstanding) > 0.005 && !confirm(`${c.name} still owes ${fmtMoney(st(c.id).outstanding)}. Deactivate anyway?`)) return;
  const { error } = await sb.from('customers').update({ active: !c.active }).eq('id', c.id).eq('branch_id', branchId);
  if (error) return note(friendly(error), true);
  await load();
  note(`${c.name} ${c.active ? 'deactivated' : 'activated'}.`);
}
function receivePayment(c) {
  const due = num(st(c.id).outstanding);
  dlg(`<h3>${I.rupee} Receive payment · ${esc(c.name)}</h3>
    <p class="dl-muted">Credit outstanding <b>${fmtMoney(due)}</b>${num(c.credit_limit) ? ` · limit ${fmtMoney(c.credit_limit)}` : ''}.</p>
    <div class="md-form-grid">
      <div class="pos-field"><label for="rcAmt">Amount ₹</label><input id="rcAmt" type="number" min="0.01" step=".01" value="${due.toFixed(2)}"></div>
      <div class="pos-field"><label for="rcMode">Mode</label><select id="rcMode"><option value="cash">Cash</option><option value="upi">UPI</option></select></div>
      <div class="pos-field md-span-2"><label for="rcNote">Note</label><input id="rcNote" maxlength="200" placeholder="UPI ref, part payment…"></div>
    </div><p class="pos-form-msg" id="rcMsg"></p>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="rcSave">${I.rupee}<span>Save receipt</span></button></div>`);
  $('rcSave').onclick = async () => {
    const amt = num($('rcAmt').value);
    if (!(amt > 0)) return ($('rcMsg').textContent = 'Enter an amount.');
    if (amt > due + 0.005 && !confirm(`₹${money2(amt)} is more than the outstanding ${fmtMoney(due)}. The extra stays as an advance for ${c.name}. Continue?`)) return;
    $('rcSave').disabled = true;
    const { data, error } = await sb.rpc('record_customer_receipt', { p_customer: c.id, p_amount: amt, p_method: $('rcMode').value, p_note: $('rcNote').value.trim() || null });
    $('rcSave').disabled = false;
    if (error) return ($('rcMsg').textContent = friendly(error));
    $('puDlg').close(); await load();
    note(`Received ${fmtMoney(amt)} from ${c.name}.`);
    if ($('customer-view').open && viewedCustomer?.id === c.id) openCustomerView(list.find(x => x.id === c.id));
  };
}

// ---------------------------------------------------------------------------
// Add / edit (existing validations kept)
// ---------------------------------------------------------------------------
function openForm(c = {}) {
  $('dt').textContent = c.id ? `Edit ${c.name}${c.customer_no ? ` · ${c.customer_no}` : ''}` : 'Add customer';
  $('err').textContent = ''; $('dupHint').hidden = true;
  f.reset();
  for (const k of ['id', 'name', 'phone', 'email', 'address', 'age', 'gender', 'dob', 'notes']) f.elements[k].value = c[k] ?? '';
  f.elements.consent.checked = !!c.consent;
  f.elements.loyalty_member.checked = !!c.loyalty_member;
  f.elements.active.checked = c.active ?? true;
  $('dlg').showModal();
  $('cName').focus();
}
function dupCheck() {
  const id = f.elements.id.value, d = digits($('cPhone').value).slice(-10);
  const hit = d.length === 10 && list.find(c => c.id !== id && digits(c.phone).slice(-10) === d);
  $('dupHint').hidden = !hit;
  if (hit) $('dupHint').innerHTML = `${esc(hit.name)} (${esc(cid(hit))}) already has this phone number. <button type="button" class="pos-btn pos-btn-sm" id="openDup">Open</button>`;
}
$('cPhone').addEventListener('input', dupCheck);
$('dupHint').addEventListener('click', e => { if (e.target.closest('#openDup')) { const d = digits($('cPhone').value).slice(-10); const hit = list.find(c => digits(c.phone).slice(-10) === d); $('dlg').close(); openCustomerView(hit); } });
$('cDob').addEventListener('change', () => { const v = $('cDob').value; if (v) { const [y, m, d] = v.split('-').map(Number), [ty, tm, td] = today().split('-').map(Number); $('cAge').value = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0); } });
f.onsubmit = async e => {
  e.preventDefault();
  $('err').textContent = '';
  const d = Object.fromEntries(new FormData(f));
  const id = d.id;
  const name = d.name.trim(), phone = d.phone.trim();
  if (!name || !phone) { $('err').textContent = 'Customer name and phone number are required.'; return; }
  const row = {
    name, phone, email: nul(d.email.trim()), address: nul(d.address.trim()), age: d.age === '' ? null : Number(d.age), gender: nul(d.gender),
    consent: f.elements.consent.checked, active: f.elements.active.checked
  };
  if (row.age !== null && (!Number.isInteger(row.age) || row.age < 0 || row.age > 120)) { $('err').textContent = 'Please enter a valid age.'; return; }
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) { $('err').textContent = 'Check the email address.'; return; }
  const extra = { dob: d.dob || null, notes: nul(d.notes.trim()), loyalty_member: f.elements.loyalty_member.checked };
  if (extra.dob && extra.dob > today()) { $('err').textContent = 'Date of birth cannot be in the future.'; return; }
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
  const send = r => id ? sb.from('customers').update(r).eq('id', id).eq('branch_id', branchId) : sb.from('customers').insert({ ...r, branch_id: branchId });
  let result = await send({ ...row, ...extra });
  // Before migration 0025 the new columns do not exist: save the original fields.
  if (result.error && /dob|notes|loyalty_member|column/i.test(result.error.message || '')) result = await send(row);
  btn.disabled = false;
  if (result.error) {
    $('err').textContent = result.error.code === '23505' ? 'A customer with this phone number already exists.' : result.error.code === '23514' ? 'Please enter a valid phone number.' : friendly(result.error);
    return;
  }
  $('dlg').close();
  await load();
  note(`${name} ${id ? 'updated' : 'added'}.`);
};
$('new').onclick = () => openForm();
$('cancel').onclick = $('cancel2').onclick = () => $('dlg').close();

// ---------------------------------------------------------------------------
// Customer details: profile, credit, loyalty, bills with doctor's sheets, receipts
// ---------------------------------------------------------------------------
async function openCustomerView(customer) {
  if (!customer) return;
  viewedCustomer = customer;
  const dlgEl = $('customer-view'), body = $('customer-view-body');
  $('customer-view-title').textContent = customer.name || 'Customer details';
  body.innerHTML = '<p class="dl-empty">Loading customer details and sales bills…</p>';
  if (!dlgEl.open) dlgEl.showModal();
  const [{ data: bills, error }, rec] = await Promise.all([
    sb.from('sales_invoices').select('id,invoice_no,total,status,created_at').eq('branch_id', branchId).eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(500),
    sb.from('customer_receipts').select('receipt_no,amount,method,note,status,created_at').eq('branch_id', branchId).eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(50)
  ]);
  const invoiceIds = (bills || []).map(b => b.id).filter(Boolean);
  let doctorSheets = [], doctorSheetError = null;
  if (invoiceIds.length) {
    const sheetResult = await sb.from('customer_doctor_sheets').select('id,invoice_id,file_name,mime_type,file_size,storage_path,created_at').eq('branch_id', branchId).in('invoice_id', invoiceIds).order('created_at', { ascending: false });
    doctorSheets = sheetResult.data || []; doctorSheetError = sheetResult.error;
  }
  const sheetsByInvoice = new Map();
  for (const sheet of doctorSheets) { if (!sheetsByInvoice.has(sheet.invoice_id)) sheetsByInvoice.set(sheet.invoice_id, []); sheetsByInvoice.get(sheet.invoice_id).push(sheet); }
  const s = st(customer.id), finals = (bills || []).filter(b => b.status === 'final');
  const spent = statsOk ? net(customer.id) : finals.reduce((a, b) => a + num(b.total), 0);
  const nBills = statsOk ? s.bills : finals.length;
  const { data: outRpc } = await sb.rpc('customer_outstanding', { p_customer: customer.id });
  const due = num(outRpc ?? s.outstanding), limit = num(customer.credit_limit);
  const sinceJoin = customer.loyalty_joined_at ? finals.filter(b => b.created_at >= customer.loyalty_joined_at).reduce((a, b) => a + num(b.total), 0) : 0;
  const points = Math.floor(sinceJoin / 100);
  const phone = String(customer.phone || '');
  const kv = (k, v) => `<div><small>${k}</small><b>${v}</b></div>`;
  body.innerHTML = `
    <section class="ds-prof cs-prof">
      <span class="ds-prof-logo ph" style="--c:${toneOf(customer.name)}">${I.user}</span>
      <div class="ds-prof-txt"><h3>${esc(customer.name)} <span class="cs-id">${esc(cid(customer))}</span> <span class="md-chip ${customer.active ? 'in' : 'out'}"><i></i>${customer.active ? 'Active' : 'Inactive'}</span>
        ${customer.loyalty_member ? `<span class="cs-tier t-${tierOf(s.spent_12m).toLowerCase()}">${I.crown}${tierOf(s.spent_12m)} member</span>` : ''}</h3>
        <p>${customer.address ? esc(customer.address) : 'No address recorded'}${customer.gender ? ` · ${esc(customer.gender)}` : ''}${customer.age != null ? ` · ${esc(customer.age)} yrs` : ''}</p>
        <div class="ds-prof-acts cust-phone-actions">
          ${phone ? `<a class="pos-btn pos-btn-sm cust-mini-action" href="tel:${encodeURIComponent(phone)}">${I.phone}<span>${esc(prettyPhone(phone))}</span></a><a class="pos-btn pos-btn-sm pos-btn-green cust-mini-action cust-wa" href="https://wa.me/${waNumber(phone)}" target="_blank" rel="noopener">${I.wa}<span>WhatsApp</span></a>` : ''}
          ${customer.email ? `<a class="pos-btn pos-btn-sm" href="mailto:${esc(customer.email)}">${I.mail}<span>${esc(customer.email)}</span></a>` : ''}
        </div></div>
    </section>
    <div class="pur-sum-tiles ds-tiles">
      <div class="g"><b>${rupees0(spent)}</b><span>Total purchases</span></div>
      <div class="b"><b>${count(nBills)}</b><span>Bills</span></div>
      <div class="${due > 0.005 ? 'r' : 'a'}"><b>${rupees0(due)}</b><span>Credit outstanding</span></div>
      <div class="p"><b>${customer.loyalty_member ? count(points) : rupees0(nBills ? spent / nBills : 0)}</b><span>${customer.loyalty_member ? 'Loyalty points' : 'Avg. bill value'}</span></div>
    </div>
    <div class="delivery-detail-grid dl-detail-grid cs-kv">
      ${kv('Credit limit', fmtMoney(limit))}${kv('Available credit', fmtMoney(Math.max(0, limit - due)))}${kv('Last purchase', fmtDate(s.last_bill || finals[0]?.created_at))}${kv('Customer since', fmtDate(customer.created_at))}
      ${kv('Date of birth', customer.dob ? `${dmy(customer.dob)}${bdayThisMonth(customer) ? ' 🎂' : ''}` : '—')}${kv('WhatsApp consent', customer.consent ? 'Yes' : 'No')}${kv('Loyalty', customer.loyalty_member ? `Since ${fmtDate(customer.loyalty_joined_at)}` : 'Not a member')}${kv('Last 12 months', rupees0(s.spent_12m))}
      ${customer.notes ? `<div class="pur-span-all cs-notes"><small>Notes</small><b>${esc(customer.notes)}</b></div>` : ''}
    </div>
    <div class="pos-dialog-foot md-foot-left inv-acts ds-acts">
      ${canBill && customer.active ? `<a class="pos-btn pos-btn-sm pos-btn-solid" href="billing.html?customer=${encodeURIComponent(customer.id)}">${I.bill}<span>New bill</span></a>` : ''}
      ${due > 0.005 && customer.active ? `<button type="button" class="pos-btn pos-btn-sm" data-cact="receive">${I.rupee}<span>Receive payment</span></button>` : ''}
      <button type="button" class="pos-btn pos-btn-sm" data-cact="edit">${I.pencil}<span>Edit</span></button>
      ${isAdmin ? `<button type="button" class="pos-btn pos-btn-sm" data-cact="limit">${I.credit}<span>Credit limit</span></button>` : ''}
      <button type="button" class="pos-btn pos-btn-sm" data-cact="loyal">${I.crown}<span>${customer.loyalty_member ? 'Remove from loyalty' : 'Add to loyalty'}</span></button>
      <button type="button" class="pos-btn pos-btn-sm" data-cact="print">${I.print}<span>Statement</span></button>
    </div>
    <section class="cust-history"><h4>Sales bills <span class="ds-count">${error ? 'Unable to load bills' : `${(bills || []).length} bill(s)`}</span></h4>
      ${error ? `<p class="pos-form-msg">${esc(friendly(error))}</p>` : `
      ${doctorSheetError ? `<p class="pos-form-msg">Doctor sheet list: ${esc(friendly(doctorSheetError))}. Apply migration 0013 to enable this feature.</p>` : ''}
      <div class="dl-table-wrap ds-hist cust-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Date</th><th>Invoice No.</th><th>Status</th><th class="c-r">Total</th><th>Bill</th><th>Doctor's sheet</th></tr></thead><tbody>
      ${(bills || []).map(b => {
        const sheets = sheetsByInvoice.get(b.id) || [];
        return `<tr><td>${fmtDate(b.created_at)}</td><td>${esc(b.invoice_no || '')}</td><td><span class="md-chip ${b.status === 'final' ? 'in' : 'out'}">${esc(b.status === 'final' ? 'Final' : b.status || '')}</span></td><td class="c-r">${fmtMoney(b.total)}</td><td><button type="button" class="pos-btn pos-btn-sm" data-cust-invoice="${esc(b.id)}">View bill</button></td><td>
          <div class="cust-sheet-actions">
            <button type="button" class="pos-btn pos-btn-sm" data-sheet-upload="${esc(b.id)}" title="Upload doctor's sheet">${I.clip}<span>Upload</span></button>
            <button type="button" class="pos-btn pos-btn-sm" data-sheet-camera="${esc(b.id)}" title="Take a photo">${I.camera}<span>Camera</span></button>
            <input class="cust-sheet-file" type="file" data-sheet-input="${esc(b.id)}" accept="application/pdf,image/jpeg,image/png,image/webp" hidden>
            <input class="cust-sheet-file" type="file" data-sheet-camera-input="${esc(b.id)}" accept="image/*" capture="environment" hidden>
          </div>
          <div class="cust-sheet-list">${sheets.map(sheet => `<div><button type="button" class="cust-sheet-link" data-sheet-open="${esc(sheet.storage_path)}">${esc(sheet.file_name)}</button><small>${fmtDate(sheet.created_at)}</small></div>`).join('') || "<small>No doctor's sheet saved</small>"}</div>
        </td></tr>`;
      }).join('') || '<tr><td colspan="6" class="dl-empty">No sales bills found for this customer.</td></tr>'}
      </tbody></table></div>`}
    </section>
    <h4>Credit payments received <span class="ds-count">${(rec.data || []).length}</span></h4>
    ${(rec.data || []).length ? `<div class="pur-paylist">${rec.data.map(r => `<div><b>${esc(r.receipt_no)}</b><span>${fmtMoney(r.amount)} by ${esc(String(r.method).toUpperCase())}${r.note ? ' · ' + esc(r.note) : ''}${r.status !== 'posted' ? ' · ' + esc(r.status) : ''}</span><small>${esc(when(r.created_at))}</small></div>`).join('')}</div>` : '<p class="ds-muted">No credit payments recorded.</p>'}`;
  body.dataset.bills = JSON.stringify((bills || []).map(b => ({ no: b.invoice_no, at: b.created_at, total: b.total, status: b.status })));
}

async function previewCustomerInvoice(invoiceId, button) {
  button.disabled = true;
  const { data, error } = await sb.rpc('invoice_detail', { p_invoice: invoiceId });
  button.disabled = false;
  if (error) { $('customer-view-body').insertAdjacentHTML('afterbegin', `<p class="pos-form-msg">${esc(friendly(error))}</p>`); return; }
  if (!data?.invoice || !Array.isArray(data.items) || !Array.isArray(data.payments)) { $('customer-view-body').insertAdjacentHTML('afterbegin', '<p class="pos-form-msg">Invoice details returned an unexpected format.</p>'); return; }
  const invoiceBranchId = data.invoice.branch_id || branchId;
  let branch = null;
  if (invoiceBranchId) { const result = await sb.from('branches').select('name,address,city,state,pincode,phone,email,gstin,drug_licence_nos,invoice_footer').eq('id', invoiceBranchId).maybeSingle(); branch = result.data; }
  const address = [branch?.address, branch?.city, branch?.state, branch?.pincode].map(v => String(v || '').trim()).filter(Boolean).join(', ');
  data.shop = { name: branch?.name || 'PALLIKKAL PHARMACY', address, phone: branch?.phone || '', email: branch?.email || '', gstin: branch?.gstin || '', drug_licence: Array.isArray(branch?.drug_licence_nos) ? branch.drug_licence_nos.filter(Boolean).join(' / ') : String(branch?.drug_licence_nos || ''), footer_note: branch?.invoice_footer || '' };
  showInvoice(data);
}
function printStatement(c) {
  const bills = JSON.parse($('customer-view-body').dataset.bills || '[]'), s = st(c.id);
  const frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(frame);
  frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.name)} statement</title><style>body{font:13px Arial,sans-serif;margin:24px}h1{font-size:19px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#f2f5f2}.r{text-align:right}.top{display:flex;justify-content:space-between;border-bottom:2px solid #0f8f17;padding-bottom:8px}</style></head><body>
    <div class="top"><div><h1>PALLIKKAL PHARMACY</h1>Customer statement · printed ${esc(when(new Date()))}</div><div style="text-align:right"><b>${esc(c.name)}</b><br>${esc(cid(c))}<br>${esc(c.phone)}</div></div>
    <table><thead><tr><th>#</th><th>Date</th><th>Invoice</th><th>Status</th><th class="r">Total</th></tr></thead><tbody>${bills.map((b, k) => `<tr><td>${k + 1}</td><td>${esc(fmtDate(b.at))}</td><td>${esc(b.no)}</td><td>${esc(b.status)}</td><td class="r">${money2(b.total)}</td></tr>`).join('') || '<tr><td colspan="5">No bills</td></tr>'}</tbody></table>
    <p><b>Total purchases ${fmtMoney(net(c.id))}</b> · Credit outstanding ${fmtMoney(s.outstanding)} · Credit limit ${fmtMoney(c.credit_limit)}</p></body></html>`);
  frame.contentDocument.close(); setTimeout(() => { try { frame.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => frame.remove(), 60000); }, 250);
}

$('customer-view-close').onclick = () => $('customer-view').close();
$('customer-view-body').addEventListener('click', async e => {
  const button = e.target.closest('button'); if (!button) return;
  if (button.dataset.cact) {
    const c = viewedCustomer;
    if (button.dataset.cact === 'edit') { $('customer-view').close(); return openForm(c); }
    if (button.dataset.cact === 'receive') return receivePayment(c);
    if (button.dataset.cact === 'limit') return editLimit(c);
    if (button.dataset.cact === 'loyal') return toggleLoyalty(c);
    if (button.dataset.cact === 'print') return printStatement(c);
  }
  if (button.dataset.custInvoice) return previewCustomerInvoice(button.dataset.custInvoice, button);
  if (button.dataset.sheetUpload) { $('customer-view-body').querySelector(`[data-sheet-input="${CSS.escape(button.dataset.sheetUpload)}"]`)?.click(); return; }
  if (button.dataset.sheetCamera) { $('customer-view-body').querySelector(`[data-sheet-camera-input="${CSS.escape(button.dataset.sheetCamera)}"]`)?.click(); return; }
  if (button.dataset.sheetOpen) {
    const { data, error } = await sb.storage.from('customer-doctor-sheets').createSignedUrl(button.dataset.sheetOpen, 300);
    if (error) { toast(friendly(error), true); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }
});
$('customer-view-body').addEventListener('change', async e => {
  const input = e.target.closest('input[type="file"][data-sheet-input],input[type="file"][data-sheet-camera-input]');
  if (!input) return;
  const file = input.files?.[0], invoiceId = input.dataset.sheetInput || input.dataset.sheetCameraInput;
  if (!file || !invoiceId) return;
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type) || file.size > 15 * 1024 * 1024) { toast('Choose a PDF, JPG, PNG or WEBP file up to 15 MB.', true); input.value = ''; return; }
  const invoice = await sb.from('sales_invoices').select('id,customer_id').eq('id', invoiceId).eq('branch_id', branchId).maybeSingle();
  if (invoice.error || !invoice.data || invoice.data.customer_id == null) { toast(invoice.error ? friendly(invoice.error) : 'This invoice is not linked to a customer.', true); input.value = ''; return; }
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
  const path = `${branchId}/${invoiceId}/${crypto.randomUUID()}.${ext}`;
  const cell = input.closest('td'), status = document.createElement('small');
  status.className = 'cust-sheet-upload-status'; status.textContent = "Uploading doctor's sheet…"; cell?.append(status);
  input.disabled = true;
  const { error: uploadError } = await sb.storage.from('customer-doctor-sheets').upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) { status.textContent = friendly(uploadError); input.disabled = false; input.value = ''; return; }
  const { error: insertError } = await sb.from('customer_doctor_sheets').insert({ branch_id: branchId, customer_id: invoice.data.customer_id, invoice_id: invoiceId, file_name: file.name, mime_type: file.type, file_size: file.size, storage_path: path });
  if (insertError) { await sb.storage.from('customer-doctor-sheets').remove([path]); status.textContent = friendly(insertError); input.disabled = false; input.value = ''; return; }
  status.textContent = "Doctor's sheet saved."; input.disabled = false; input.value = '';
  if (viewedCustomer) await openCustomerView(viewedCustomer);
});

// ---------------------------------------------------------------------------
// Import / export / more
// ---------------------------------------------------------------------------
function rowsForExport() {
  return filtered().map(c => ({
    'Customer ID': c.customer_no || '', Name: c.name, Phone: c.phone, Email: c.email || '', Address: c.address || '', Age: c.age ?? '', Gender: c.gender || '', 'Date of birth': c.dob || '',
    'WhatsApp consent': c.consent ? 'Yes' : 'No', 'Loyalty member': c.loyalty_member ? 'Yes' : 'No', Active: c.active ? 'Yes' : 'No', 'Credit limit (₹)': num(c.credit_limit),
    Bills: st(c.id).bills, 'Total purchases (₹)': Math.round(net(c.id) * 100) / 100, 'Credit due (₹)': Math.round(num(st(c.id).outstanding) * 100) / 100, 'Last purchase': st(c.id).last_bill ? istDay(st(c.id).last_bill) : '', 'Customer since': istDay(c.created_at), Notes: c.notes || ''
  }));
}
function writeSheet(rows, name) {
  if (window.XLSX) { const ws = XLSX.utils.json_to_sheet(rows); ws['!cols'] = Object.keys(rows[0] || { a: 1 }).map(k => ({ wch: Math.min(40, Math.max(12, k.length + 2)) })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Customers'); XLSX.writeFile(wb, name + '.xlsx'); return; }
  const keys = Object.keys(rows[0]);
  const csv = [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
}
$('exportBtn').onclick = () => { const rows = rowsForExport(); if (!rows.length) return toast('Nothing to export.', true); writeSheet(rows, `Pallikkal_Customers_${today()}`); toast(`${rows.length} customer(s) exported.`); };
const template = () => writeSheet([{ Name: 'Ajay Kumar', Phone: '9876543210', Email: 'ajay.kumar@email.com', Address: 'Pallikkal Bazar', Age: 42, Gender: 'male', 'Date of birth': '1984-03-12', 'WhatsApp consent': 'Yes', 'Loyalty member': 'Yes', Notes: 'BP patient' }, { Name: 'Revathi Nair', Phone: '9765432109', Email: '', Address: 'Kondotty', Age: '', Gender: 'female', 'Date of birth': '', 'WhatsApp consent': 'No', 'Loyalty member': 'No', Notes: '' }], 'Pallikkal_Customer_Import_Template');
$('importBtn').onclick = () => {
  dlg(`<h3>${I.upload} Import customers</h3><p class="dl-muted">Excel or CSV with <b>Name, Phone</b> and optionally Email, Address, Age, Gender, Date of birth, WhatsApp consent, Loyalty member, Notes. A customer with the same phone number is <b>updated</b> (blank cells keep old values); new numbers are <b>added</b>. Credit limits are set by an admin from the customer menu.</p>
    <div class="inv-choices"><button type="button" data-imp="file">${I.upload}<span><b>Choose file</b><small>.xlsx, .xls or .csv</small></span></button><button type="button" data-imp="template">${I.download}<span><b>Download template</b><small>With two sample rows</small></span></button></div>
    <div id="impResult"></div>`);
  $('puPanel').querySelector('.inv-choices').onclick = e => { const b = e.target.closest('[data-imp]'); if (!b) return; if (b.dataset.imp === 'template') return template(); $('importFile').click(); };
};
function parseCsv(text) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; } else cur += ch; }
  if (cur || row.length) { row.push(cur); out.push(row); }
  const [h, ...rest] = out.filter(r => r.some(x => String(x).trim()));
  return rest.map(r => Object.fromEntries((h || []).map((k, i) => [String(k).replace(/^﻿/, '').trim(), r[i] ?? ''])));
}
const yes = v => /^(yes|y|true|1)$/i.test(String(v).trim());
$('importFile').onchange = async e => {
  const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
  let rows;
  try {
    if (/\.csv$/i.test(file.name)) rows = parseCsv(await file.text());
    else { if (!window.XLSX) throw new Error('Excel reader unavailable. Save the sheet as CSV and import that.'); const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); }
  } catch (err) { if (!$('puDlg').open) $('importBtn').click(); $('impResult').innerHTML = `<p class="pos-form-msg">${esc(err.message || String(err))}</p>`; return; }
  const pick = (r, ...ks) => { for (const k of ks) { const fk = Object.keys(r).find(x => x.trim().toLowerCase() === k.toLowerCase()); if (fk != null && String(r[fk]).trim() !== '') return r[fk] instanceof Date ? r[fk].toISOString().slice(0, 10) : String(r[fk]).trim(); } return ''; };
  let added = 0, updated = 0; const bad = [];
  for (const [i, r] of rows.entries()) {
    const name = pick(r, 'Name', 'Customer name', 'Customer'), phone = pick(r, 'Phone', 'Mobile', 'Phone number');
    if (!name && !phone) continue;
    if (!name || digits(phone).length < 10) { bad.push(`Row ${i + 2}${name ? ` (${name})` : ''}: name and a 10-digit phone are required`); continue; }
    const age = pick(r, 'Age'), g = pick(r, 'Gender').toLowerCase(), dob = pick(r, 'Date of birth', 'DOB');
    const row = { name, phone, email: pick(r, 'Email') || null, address: pick(r, 'Address') || null, age: age ? Number(age) : null, gender: ['male', 'female', 'other'].includes(g) ? g : null };
    if (row.age != null && (!Number.isInteger(row.age) || row.age < 0 || row.age > 120)) { bad.push(`Row ${i + 2} (${name}): age is not valid`); continue; }
    const cons = pick(r, 'WhatsApp consent', 'Consent'), loy = pick(r, 'Loyalty member', 'Loyalty'), notes = pick(r, 'Notes');
    if (cons) row.consent = yes(cons);
    const extra = { ...(dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? { dob } : {}), ...(loy ? { loyalty_member: yes(loy) } : {}), ...(notes ? { notes } : {}) };
    const hit = list.find(c => digits(c.phone).slice(-10) === digits(phone).slice(-10));
    const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));
    let res = hit ? await sb.from('customers').update(clean({ ...row, ...extra })).eq('id', hit.id).eq('branch_id', branchId).select('*').single()
      : await sb.from('customers').insert({ ...clean({ ...row, ...extra }), branch_id: branchId }).select('*').single();
    if (res.error && /dob|notes|loyalty_member/.test(res.error.message || '')) res = hit ? await sb.from('customers').update(clean(row)).eq('id', hit.id).eq('branch_id', branchId).select('*').single() : await sb.from('customers').insert({ ...clean(row), branch_id: branchId }).select('*').single();
    if (res.error) bad.push(`Row ${i + 2} (${name}): ${res.error.code === '23514' ? 'phone number is not valid' : res.error.code === '23505' ? 'phone already used' : friendly(res.error)}`);
    else if (hit) { updated++; Object.assign(hit, res.data); } else { added++; list.push(res.data); }
  }
  await load();
  if (!$('puDlg').open) $('importBtn').click();
  $('impResult').innerHTML = `<div class="purchase-notice ds-imp">${added} added · ${updated} updated${bad.length ? ` · ${bad.length} skipped` : ''}</div>${bad.length ? `<ul class="ds-imp-bad">${bad.slice(0, 20).map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}`;
  note(`Import finished: ${added} added, ${updated} updated${bad.length ? `, ${bad.length} skipped` : ''}.`, !!bad.length);
};
$('moreBtn').onclick = e => { e.stopPropagation(); $('moreMenu').hidden = !$('moreMenu').hidden; };
document.addEventListener('click', e => { if (!$('moreMenu').hidden && !e.target.closest('#moreMenu')) $('moreMenu').hidden = true; });
$('moreMenu').onclick = e => {
  const b = e.target.closest('[data-more]'); if (!b) return;
  $('moreMenu').hidden = true;
  if (b.dataset.more === 'template') return template();
  if (b.dataset.more === 'birthdays') {
    const bd = list.filter(c => c.active && bdayThisMonth(c)).sort((a, z) => a.dob.slice(8).localeCompare(z.dob.slice(8)));
    dlg(`<h3>${I.cake} Birthdays this month</h3>${bd.length ? `<div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Date</th><th>Customer</th><th>Phone</th><th></th></tr></thead><tbody>${bd.map(c => `<tr><td>${esc(new Date(c.dob + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }))}${c.dob.slice(5) === today().slice(5) ? ' · <b>Today</b>' : ''}</td><td>${esc(c.name)} <small class="ds-muted">${esc(cid(c))}</small></td><td>${esc(prettyPhone(c.phone))}</td><td class="c-r">${c.consent ? `<a class="pos-btn pos-btn-sm pos-btn-green" target="_blank" rel="noopener" href="https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(`Happy birthday ${c.name}! Best wishes from PALLIKKAL PHARMACY.`)}">${I.wa}<span>Wish</span></a>` : '<small class="ds-muted">No consent</small>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dl-muted">No birthdays recorded for this month. Add a date of birth when editing a customer.</p>'}`);
    return;
  }
  if (b.dataset.more === 'dupes') {
    const groups = new Map();
    for (const c of list) for (const k of [`p:${digits(c.phone).slice(-10)}`, `n:${c.name.trim().toLowerCase().replace(/\s+/g, ' ')}`]) groups.set(k, [...(groups.get(k) || []), c]);
    const dup = [...groups.entries()].filter(([, v]) => v.length > 1);
    dlg(`<h3>${I.users} Possible duplicates</h3>${dup.length ? dup.map(([k, v]) => `<div class="ds-dup"><small>Same ${k[0] === 'p' ? 'phone' : 'name'}</small>${v.map(c => `<button type="button" class="pos-btn pos-btn-sm" data-open="${esc(c.id)}">${esc(c.name)} · ${esc(cid(c))}${c.active ? '' : ' (inactive)'}</button>`).join('')}</div>`).join('') : '<p class="dl-muted">No duplicates found by phone or name.</p>'}<p class="dl-muted">Same name can be different people — check the phone and address before deactivating one.</p>`);
    $('puPanel').onclick = ev => { const o = ev.target.closest('[data-open]'); if (o) { $('puDlg').close(); openCustomerView(list.find(c => c.id === o.dataset.open)); } };
    return;
  }
  if (b.dataset.more === 'print') {
    const rows = rowsForExport(), frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.append(frame);
    const H = ['Customer ID', 'Name', 'Phone', 'Bills', 'Total purchases (₹)', 'Credit due (₹)', 'Active'];
    frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>Customers</title><style>body{font:12px Arial,sans-serif;margin:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f2f5f2}</style></head><body><h2>PALLIKKAL PHARMACY — Customers (${rows.length})</h2><table><thead><tr>${H.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${H.map(h => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
    frame.contentDocument.close(); setTimeout(() => { try { frame.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => frame.remove(), 60000); }, 250);
  }
};

// ---------------------------------------------------------------------------
// Filters, paging, KPI and card clicks
// ---------------------------------------------------------------------------
let t; $('q').oninput = () => { clearTimeout(t); t = setTimeout(() => { page = 1; draw(); }, 200); };
['fStatus', 'perPage'].forEach(id => $(id).onchange = () => { page = 1; draw(); });
$('pager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); draw(); } };
$('filterBtn').onclick = e => { e.stopPropagation(); $('filterPop').hidden = !$('filterPop').hidden; };
$('filterPop').onclick = e => e.stopPropagation();
document.addEventListener('click', () => { $('filterPop').hidden = true; });
$('fApply').onclick = () => { sortKey = $('sortBy').value; filt.consent = $('fConsent').checked; filt.gender = $('fGender').value; $('filterPop').hidden = true; page = 1; draw(); };
$('fReset').onclick = () => { sortKey = 'recent'; $('sortBy').value = 'recent'; filt.consent = false; filt.gender = ''; $('fConsent').checked = false; $('fGender').value = ''; $('fStatus').value = ''; $('q').value = ''; $('filterPop').hidden = true; page = 1; draw(); };
$('trendRange').onchange = drawChart;
let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(drawChart, 120); }).observe($('chart'));
const goList = (status = '', sort = sortKey) => { $('fStatus').value = status; sortKey = sort; $('sortBy').value = sort; page = 1; draw(); $('rows').closest('.ds-list').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
document.querySelector('.md-kpis').onclick = e => {
  const b = e.target.closest('[data-kpi]'); if (!b) return;
  ({ kTotal: () => goList(''), kActive: () => goList('active'), kRepeat: () => goList('repeat', 'bills'), kLoyal: () => goList('loyal', 'spent') })[b.dataset.kpi]();
};
$('topAll').onclick = () => goList('', 'spent');
$('topRows').onclick = e => { const tr = e.target.closest('tr[data-cust]'); if (tr) openCustomerView(list.find(c => c.id === tr.dataset.cust)); };
$('sumTiles').onclick = e => { const b = e.target.closest('[data-sum]'); if (b) goList(b.dataset.sum); };
$('sumMore').onclick = e => { const b = e.target.closest('[data-sum]'); if (b) goList(b.dataset.sum, b.dataset.sum === 'due' ? 'due' : sortKey); };

// ---------------------------------------------------------------------------
// Start — ?q=<name or phone> (dashboard search), ?status=…, ?new=1
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
if (params.get('q')) $('q').value = params.get('q');
if (params.get('status') && [...$('fStatus').options].some(o => o.value === params.get('status'))) $('fStatus').value = params.get('status');
await load();
if (params.get('new') === '1') $('new')?.click();
