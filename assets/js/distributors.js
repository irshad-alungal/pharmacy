// Distributors Management — Pallikkal Pharmacy design.
// Supplier master (contact, phones with call/WhatsApp, GSTIN, drug licence, logo, active),
// purchase performance from purchase_list_v2 (0024), payables from payable_balances (admins),
// supplier payments, import/export, and shortcuts into Purchases.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { nul, friendly } from './ui.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('distributors', 'Distributors', { layout: 'brand' });
if (!prof) throw new Error('Distributor page could not start: profile unavailable.');
const $ = id => document.getElementById(id);
const LOGO_BUCKET = 'distributor-logos';
const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const canPurchase = ['super_admin', 'admin', 'admin_staff'].includes(prof.role);   // Purchases is an Admin page (0037)
const canWrite = ['super_admin', 'admin', 'admin_staff', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory'].includes(prof.role);
const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = v => inr(num(v));
const r2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const count = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(num(n));
const money2 = v => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupees0 = v => '₹' + Math.round(num(v)).toLocaleString('en-IN');
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dmy = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const when = v => new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const istDay = v => new Date(v).toLocaleDateString('en-CA', { timeZone: TZ });
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  truck: svg('<path d="M2 6h11v10H2z"/><path d="M13 9h4.5l3.5 3.5V16h-8"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>', 1.8),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  people: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2c3 .2 5 2.6 5 5.8"/><circle cx="4.5" cy="9" r="2.2"/>', 1.7),
  checkC: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', 2),
  layers: svg('<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>', 1.8),
  wallet: svg('<path d="M3 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h5v-3h-5a1.5 1.5 0 0 0 0 3Z"/>', 1.9),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  filter: svg('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  bars: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/></svg>',
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  building: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/><path d="M10 21v-3h4v3"/>', 1.8),
  user: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>', 1.9),
  phone: svg('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/>', 1.9),
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.6),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', 1.9),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 2),
  bill: svg('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>', 1.9),
  order: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>', 2),
  rupee: svg('<path d="M6 4h12M6 8h12M14 4c3 0 4 2 4 4s-1 4-4 4H6l8 8"/>', 2),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', 2),
  power: svg('<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>', 2),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h9a1.5 1.5 0 0 0 1.4-1.1L21.5 7.5H6"/>', 1.9),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const TONES = ['#12a01b', '#1e7be6', '#7a4ff0', '#f29a00', '#e5484d', '#0e9488'];
const toneOf = s => TONES[[...String(s || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

let list = [];            // all distributors of the branch
let bills = [];           // purchase_list_v2 rows
let balances = new Map(); // distributor_id → payable balance (admins)
let orders = [];          // open purchase orders
let stats = new Map();    // distributor_id → { value, n, units, last }
let page = 1;
let sortKey = 'name';
let logoFile = null;
let removeExistingLogo = false;
const filt = { noGst: false, noDl: false, idle: false };

$('view').innerHTML = `
<div class="pos dl md pur ds">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.truck}</span>
      <div><h1>Distributors Management</h1><p>Manage your medicine distributors, supplier details, and performance.</p></div></div>
    <div class="pos-head-actions md-head-actions ds-head-actions">
      <button type="button" class="pos-btn pos-btn-solid" id="new">${I.plusC}<span>Add Distributor</span></button>
      <button type="button" class="pos-btn" id="importBtn">${I.upload}<span>Import</span></button>
      <button type="button" class="pos-btn" id="exportBtn">${I.download}<span>Export</span></button>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn ds-more" id="moreBtn" aria-label="More actions" aria-expanded="false">${I.dots}</button>
        <div class="dl-pop md-menu ds-menu" id="moreMenu" hidden>
          <button type="button" data-more="template">${I.download}<span>Download import template</span></button>
          <button type="button" data-more="print">${I.print}<span>Print distributor list</span></button>
          <button type="button" data-more="dupes">${I.people}<span>Find duplicates (name / GSTIN / phone)</span></button>
          ${canPurchase ? `<a href="purchases.html?new=1">${I.bill}<span>New purchase bill</span></a><a href="purchases.html?order=1">${I.order}<span>New purchase order</span></a>` : ''}
        </div></div>
    </div>
  </section>

  <section class="dz-kpis dl-kpis md-kpis">
    ${KPI('green', I.people, 'Total Distributors', 'kTotal')}
    ${KPI('blue', I.checkC, 'Active Distributors', 'kActive')}
    ${KPI('amber', I.layers, isAdmin ? 'Total Purchase Value' : 'Purchase Bills (This Month)', 'kValue')}
    ${isAdmin ? KPI('rose', I.wallet, 'Outstanding Amount', 'kOut') : KPI('rose', I.order, 'Open Purchase Orders', 'kOut')}
  </section>

  <div id="msg" class="md-msg" role="status"></div>

  <div class="dl-grid md-grid ds-grid">
    <div class="dl-main-col">
      <section class="pos-card dl-orders ds-list">
        <div class="dl-card-head ds-list-head">
          <h2>${I.list}Distributors List <span id="listTotal">(0)</span></h2>
          <label class="dl-select ds-status"><select id="fStatus" aria-label="Show">
            <option value="">All Distributors</option><option value="active">Active</option><option value="inactive">Inactive</option>
            ${isAdmin ? '<option value="dues">With outstanding</option>' : ''}<option value="recent">Purchased in last 30 days</option><option value="idle">No purchase in 90 days</option></select></label>
        </div>
        <div class="ds-tools">
          <label class="dl-search">${I.search}<input id="q" type="search" placeholder="Search by distributor name, contact person, or phone..." autocomplete="off" aria-label="Search distributors"></label>
          <div class="dl-pop-anchor">
            <button type="button" class="pos-btn dl-filter-btn" id="filterBtn" aria-expanded="false">${I.filter}<span>Filter</span><b class="dl-filter-dot" id="filterDot" hidden></b></button>
            <div class="dl-pop" id="filterPop" hidden>
              <div class="pos-field"><label for="sortBy">Sort by</label><select id="sortBy"><option value="name">Name (A–Z)</option>${isAdmin ? '<option value="value">Purchase value (high first)</option><option value="due">Outstanding (high first)</option>' : '<option value="value">Units purchased (high first)</option>'}<option value="bills">Number of bills</option><option value="last">Last purchase (recent first)</option><option value="new">Recently added</option></select></div>
              <label class="dl-check"><input type="checkbox" id="fNoGst"> GSTIN missing</label>
              <label class="dl-check"><input type="checkbox" id="fNoDl"> Drug licence missing</label>
              <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="fReset">Reset</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="fApply">Apply</button></div>
            </div>
          </div>
        </div>
        <div class="dl-table-wrap"><table class="dl-table ds-table"><thead><tr>
          <th class="c-no">#</th><th>Distributor Name</th><th>Contact Person</th><th>Phone</th><th class="c-email">Email</th><th>Status</th><th class="c-c">Actions</th>
        </tr></thead><tbody id="rows"><tr><td colspan="7" class="dl-empty">Loading distributors…</td></tr></tbody></table></div>
        <div class="dl-pager md-pager"><span id="pageInfo"></span><div id="pager"></div>
          <label class="dl-select md-per"><select id="perPage" aria-label="Rows per page"><option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></select></label></div>
      </section>
    </div>

    <aside class="dl-side">
      <section class="pos-card pur-trend">
        <div class="dl-card-head"><h2>${I.bars}<span class="ds-long">Purchase from Distributors</span><span class="ds-short">Purchases</span></h2>
          <label class="dl-select pur-mini"><select id="trendRange" aria-label="Range"><option value="6">Last 6 Months</option><option value="12">Last 12 Months</option><option value="30d">Last 30 Days</option></select></label></div>
        <div class="dz-chart pur-chart" id="chart"></div>
        <p class="pur-chart-sub" id="chartSub"></p>
      </section>
      <section class="pos-card pur-top">
        <div class="dl-card-head"><h2>${I.truck}Top Distributors <small>(${isAdmin ? 'by Purchase Value' : 'by Bills'})</small></h2><button type="button" class="dl-link" id="topAll">View All ${I.chev}</button></div>
        <div class="dl-table-wrap"><table class="dl-table md-plain pur-top-table"><thead><tr><th>Distributor</th><th class="c-r">${isAdmin ? 'Purchase Value' : 'Units'}</th><th class="c-r">Orders</th></tr></thead><tbody id="topRows"><tr><td colspan="3" class="dl-empty">Loading…</td></tr></tbody></table></div>
      </section>
      <section class="pos-card pur-sum ds-sum">
        <div class="dl-card-head"><h2>${I.bars}Distributor Summary</h2></div>
        <div class="pur-sum-tiles" id="sumTiles"></div>
        <div class="pur-sum-more" id="sumMore"></div>
      </section>
    </aside>
  </div>
</div>

<dialog id="dlg" class="pos-dialog dl-dialog md-wide ds-dlg"><button type="button" class="pos-icon-btn dl-x" id="cancel" aria-label="Close">${I.xs}</button>
  <form id="f" method="dialog" class="md-form">
    <h3 id="dt">Add distributor</h3>
    <input type="hidden" name="id">
    <div class="md-form-grid">
      <div class="pos-field md-span-2"><label for="fName">Distributor name *</label><input id="fName" name="name" placeholder="e.g. Bismik Medical Agencies" required maxlength="160"></div>
      <div class="pos-field"><label for="fContact">Contact person</label><input id="fContact" name="contact_person" placeholder="Sales executive / owner" maxlength="120"></div>
      <div class="pos-field"><label for="fEmail">Email</label><input id="fEmail" name="email" type="email" placeholder="orders@distributor.com" maxlength="160"></div>
      <div class="pos-field md-span-2"><label for="fPhone">Contact number(s) <small>— one per line or separated by commas; use +91 for WhatsApp</small></label><textarea id="fPhone" name="phone" rows="2" placeholder="+91 98470 12345, 0483 2741000"></textarea></div>
      <div class="pos-field"><label for="fGst">GSTIN</label><input id="fGst" name="gstin" placeholder="32AACFB8381R1ZZ" maxlength="15" style="text-transform:uppercase"><small class="ds-hint" id="gstHint"></small></div>
      <div class="pos-field"><label for="fDl">Drug licence number</label><input id="fDl" name="drug_licence" placeholder="WLF20B2023KL001290" maxlength="160"></div>
      <div class="pos-field md-span-2"><label for="fAddr">Address</label><textarea id="fAddr" name="address" rows="2" placeholder="Building, road, town, PIN" maxlength="400"></textarea></div>
      <div class="pos-field md-span-2"><label>Distributor logo <small>— PNG, JPG or WEBP, up to 2 MB</small></label>
        <div class="ds-logo-row"><img id="logoPreview" class="ds-logo-prev" alt="Distributor logo preview" hidden><span class="ds-logo-ph" id="logoPh">${I.building}</span>
          <label class="pos-btn pos-btn-sm" for="logoFile">${I.upload}<span>Choose logo</span></label><input id="logoFile" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          <button type="button" id="clearLogo" class="pos-btn pos-btn-sm pos-btn-red">Remove logo</button></div></div>
      <label class="dl-check md-span-2"><input type="checkbox" name="active" checked> Active distributor (inactive ones cannot be picked on new purchases)</label>
    </div>
    <div id="dupHint" class="purchase-warning" hidden></div>
    <div id="err" class="pos-form-msg" role="alert"></div>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" id="cancel2">Cancel</button><button type="submit" class="pos-btn pos-btn-solid">Save distributor</button></div>
  </form></dialog>

<dialog id="viewDlg" class="pos-dialog dl-dialog md-wide ds-view"><button type="button" class="pos-icon-btn dl-x" id="viewClose" aria-label="Close">${I.xs}</button><div id="viewBody"><p>Loading…</p></div></dialog>
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

const phoneParts = value => String(value || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
const digits = value => String(value || '').replace(/[^\d]/g, '');
const callHref = value => `tel:${String(value || '').replace(/[^\d+]/g, '')}`;
const waHref = value => { const d = digits(value); return `https://wa.me/${d.length === 10 ? '91' + d : d}`; };
const logoUrl = path => {
  if (!path) return '';
  const { data } = sb.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return data?.publicUrl || '';
};
const STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 19: 'West Bengal', 24: 'Gujarat', 27: 'Maharashtra', 29: 'Karnataka', 30: 'Goa', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry', 36: 'Telangana', 37: 'Andhra Pradesh' };
const gstState = g => g && /^\d{2}/.test(g) ? STATES[g.slice(0, 2)] || STATES[Number(g.slice(0, 2))] || `State code ${g.slice(0, 2)}` : '';
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const avatar = d => d.logo_path ? `<img class="ds-av img" src="${esc(logoUrl(d.logo_path))}" alt="" loading="lazy">` : `<span class="ds-av" style="--c:${toneOf(d.name)}">${I.building}</span>`;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function loadAll() {
  const [dres, bres, pres, ores] = await Promise.all([
    sb.from('distributors').select('*').eq('branch_id', prof.branch_id).order('name').limit(2000),
    canWrite ? sb.rpc('purchase_list_v2', { p_from: null, p_to: null, p_limit: 5000 }) : Promise.resolve({ data: [] }),
    isAdmin ? sb.rpc('payable_balances') : Promise.resolve({ data: [] }),
    ['super_admin', 'admin', 'pharmacist', 'inventory_staff', 'inventory'].includes(prof.role) ? sb.rpc('purchase_order_list', { p_limit: 1000 }) : Promise.resolve({ data: [] })
  ]);
  if (dres.error) { $('rows').innerHTML = `<tr><td colspan="7" class="dl-empty">${esc(friendly(dres.error))}</td></tr>`; return; }
  list = dres.data || [];
  bills = bres.error ? [] : (bres.data || []).filter(b => b.status !== 'cancelled');
  if (bres.error) note('Purchase figures need database migration 0024_purchases_management.sql (run it once in Supabase).', true);
  balances = new Map((pres.data || []).map(r => [r.distributor_id, num(r.balance)]));
  orders = ores.error ? [] : (ores.data || []).filter(o => o.status === 'ordered' || o.status === 'partial');
  stats = new Map();
  for (const b of bills) {
    const s = stats.get(b.distributor_id) || { value: 0, n: 0, units: 0, last: '', recent: 0 };
    s.value += num(b.total); s.n++; s.units += num(b.stock_units); if (b.invoice_date > s.last) s.last = b.invoice_date;
    if (b.invoice_date >= addDays(today(), -29)) s.recent++;
    stats.set(b.distributor_id, s);
  }
  renderAll();
}
const st = id => stats.get(id) || { value: 0, n: 0, units: 0, last: '', recent: 0 };
const due = id => Math.max(0, balances.get(id) || 0);

// ---------------------------------------------------------------------------
// KPIs, chart, top, summary, notifications
// ---------------------------------------------------------------------------
function monthWindow(offset) {
  const [y, m] = today().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return [d.toISOString().slice(0, 10), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)];
}
const trend = (now, before) => {
  if (!before) return now ? '<span class="dz-up">New</span> this month' : 'No change this month';
  const pct = (now - before) / before * 100;
  return `<span class="${pct >= 0 ? 'dz-up' : 'dz-down'}">${pct >= 0 ? I.up : I.down}${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span> vs. last month`;
};
function renderKpis() {
  const total = list.length, active = list.filter(d => d.active).length;
  const [ms] = monthWindow(0);
  const before = list.filter(d => istDay(d.created_at) < ms).length;
  $('kTotal').textContent = count(total);
  $('kTotalNote').innerHTML = before ? trend(total, before) : `${count(total)} added this month`;
  $('kActive').textContent = count(active);
  $('kActiveNote').innerHTML = `<span class="md-pct ds-green">${total ? Math.round(active / total * 100) : 0}%</span> of total`;
  const [s0, e0] = monthWindow(0), [s1, e1raw] = monthWindow(-1);
  const e1 = (() => { const cut = addDays(s1, Number(today().slice(8, 10)) - 1); return cut < e1raw ? cut : e1raw; })();
  const cur = bills.filter(b => b.invoice_date >= s0 && b.invoice_date <= e0), prev = bills.filter(b => b.invoice_date >= s1 && b.invoice_date <= e1);
  if (isAdmin) {
    const v = cur.reduce((a, b) => a + num(b.total), 0), pv = prev.reduce((a, b) => a + num(b.total), 0);
    $('kValue').textContent = rupees0(v); $('kValueNote').innerHTML = trend(v, pv);
    $('kValue').closest('.dz-kpi').title = 'Purchase bills received this month (all distributors)';
    const owing = [...balances.entries()].filter(([, b]) => b > 0.005);
    $('kOut').textContent = rupees0(owing.reduce((a, [, b]) => a + b, 0));
    $('kOutNote').textContent = `${owing.length} distributor${owing.length === 1 ? '' : 's'}`;
  } else {
    $('kValue').textContent = `${count(cur.length)} bills`; $('kValueNote').innerHTML = trend(cur.length, prev.length);
    $('kOut').textContent = count(orders.length);
    $('kOutNote').textContent = `${orders.filter(o => o.status === 'partial').length} partly received`;
  }
}
function niceStep(v) { if (v <= 0) return 1; const raw = v * 1.08 / 6, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const axisVal = v => isAdmin ? (v >= 100000 ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : '₹' + new Intl.NumberFormat('en-IN').format(v)) : String(Math.round(v * 10) / 10);
function series() {
  const r = $('trendRange').value;
  const val = l => isAdmin ? l.reduce((a, b) => a + num(b.total), 0) : l.length;
  const out = [];
  if (r === '30d') {
    for (let i = 29; i >= 0; i--) { const d = addDays(today(), -i); const l = bills.filter(b => b.invoice_date === d); out.push({ label: new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }), full: dmy(d), v: val(l), n: l.length, from: d, to: d }); }
    return out;
  }
  for (let i = Number(r) - 1; i >= 0; i--) {
    const [s, e] = monthWindow(-i); const l = bills.filter(b => b.invoice_date >= s && b.invoice_date <= e);
    out.push({ label: new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), full: new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), v: val(l), n: l.length, from: s, to: e });
  }
  return out;
}
function drawChart() {
  const el = $('chart'), s = series(), vals = s.map(x => x.v), N = s.length, total = vals.reduce((a, b) => a + b, 0);
  $('chartSub').textContent = isAdmin ? `Total ${rupees0(total)} · ${s.reduce((a, x) => a + x.n, 0)} bills` : `${total} bills received`;
  const W = Math.max(280, el.clientWidth), H = el.clientHeight || 220, padL = isAdmin ? 66 : 34, padR = 16, padT = 30, padB = 28, steps = 6;
  const tick = niceStep(Math.max(...vals, isAdmin ? 0 : 1)), max = tick * steps;
  const x = i => padL + (N === 1 ? 0 : i * (W - padL - padR) / (N - 1)), yv = v => padT + (H - padT - padB) * (1 - v / max);
  const pts = vals.map((v, i) => [x(i), yv(v)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < N - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18; d += ` C${p1[0] + (p2[0] - p0[0]) * t},${Math.min(H - padB, p1[1] + (p2[1] - p0[1]) * t)} ${p2[0] - (p3[0] - p1[0]) * t},${Math.min(H - padB, p2[1] - (p3[1] - p1[1]) * t)} ${p2[0]},${p2[1]}`; }
  const area = `${d} L${pts[N - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z`;
  const fit = Math.max(2, Math.floor((W - padL - padR) / 50)), every = Math.max(1, Math.ceil(N / fit));
  const grid = Array.from({ length: steps + 1 }, (_, i) => i * tick);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Purchases from distributors">
    <defs><linearGradient id="dsArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fbf3a" stop-opacity=".35"/><stop offset="1" stop-color="#2fbf3a" stop-opacity=".04"/></linearGradient></defs>
    <g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${yv(v)}" y2="${yv(v)}"/>`).join('')}</g>
    <g class="dz-axis pur-axis">${grid.map(v => `<text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end">${axisVal(v)}</text>`).join('')}${s.map((p, i) => (i % every === 0 && N - 1 - i >= every / 2) || i === N - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '').join('')}</g>
    <path d="${area}" fill="url(#dsArea)"/><path class="dz-line" d="${d}"/>
    ${pts.map(([px, py], i) => `<circle class="dz-pt${i === N - 1 ? ' hot' : ''}" data-i="${i}" cx="${px}" cy="${py}" r="${i === N - 1 ? 6 : 4.5}"/>`).join('')}
    ${pts.map(([px], i) => `<rect data-i="${i}" x="${px - (W - padL - padR) / N / 2}" y="${padT}" width="${(W - padL - padR) / N}" height="${H - padT - padB}" fill="transparent"/>`).join('')}
  </svg><div class="dz-tip" id="dsTip"></div>`;
  const tip = $('dsTip');
  const show = i => { const [px, py] = pts[i]; tip.innerHTML = `${isAdmin ? rupees0(vals[i]) : `${vals[i]} bill${vals[i] === 1 ? '' : 's'}`}<small>${esc(s[i].full)}${isAdmin ? ` · ${s[i].n} bills` : ''}</small>`; tip.style.left = `${Math.min(Math.max(px / W * 100, 14), 86)}%`; tip.style.top = `${(py - 12) / H * 100}%`; el.querySelectorAll('.dz-pt').forEach(c => c.classList.toggle('hot', +c.dataset.i === i)); };
  show(N - 1);
  const sv = el.querySelector('svg');
  sv.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('mouseleave', () => show(N - 1));
  sv.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
}
function renderTop() {
  const s = series(), from = s[0].from, to = s[s.length - 1].to;
  const m = new Map();
  for (const b of bills.filter(x => x.invoice_date >= from && x.invoice_date <= to)) { const g = m.get(b.distributor_id) || { id: b.distributor_id, name: b.distributor, v: 0, n: 0, u: 0 }; g.v += num(b.total); g.n++; g.u += num(b.stock_units); m.set(b.distributor_id, g); }
  const top = [...m.values()].sort((a, b) => isAdmin ? b.v - a.v : b.n - a.n || b.u - a.u).slice(0, 5);
  $('topRows').innerHTML = top.map((g, i) => `<tr data-dist="${esc(g.id)}"><td><span class="pur-rank r${i + 1}">${i + 1}</span>${esc(g.name)}</td><td class="c-r">${isAdmin ? money2(g.v) : count(g.u)}</td><td class="c-r">${g.n}</td></tr>`).join('')
    || '<tr><td colspan="3" class="dl-empty">No purchases in this period.</td></tr>';
}
function renderSummary() {
  const total = list.length, active = list.filter(d => d.active).length;
  const owing = [...balances.values()].filter(b => b > 0.005).reduce((a, b) => a + b, 0);
  $('sumTiles').innerHTML = `
    <button type="button" class="g" data-sum="">${count(total) ? `<b>${count(total)}</b>` : '<b>0</b>'}<span>Total</span></button>
    <button type="button" class="b" data-sum="active"><b>${count(active)}</b><span>Active</span></button>
    <button type="button" class="r" data-sum="inactive"><b>${count(total - active)}</b><span>Inactive</span></button>
    ${isAdmin ? `<button type="button" class="p" data-sum="dues"><b>${rupees0(owing)}</b><span>Outstanding</span></button>` : `<button type="button" class="p" data-sum="recent"><b>${count(list.filter(d => st(d.id).recent).length)}</b><span>Bought from (30 d)</span></button>`}`;
  const idle = list.filter(d => d.active && (!st(d.id).last || st(d.id).last < addDays(today(), -89))).length;
  const noGst = list.filter(d => d.active && !d.gstin).length, noDl = list.filter(d => d.active && !d.drug_licence).length;
  const adv = isAdmin ? [...balances.values()].filter(b => b < -0.005).reduce((a, b) => a - b, 0) : 0;
  $('sumMore').innerHTML = [
    idle ? `<button type="button" data-sum="idle">${I.cart}<span>No purchase in 90 days <b>${idle}</b></span></button>` : '',
    noGst ? `<button type="button" data-flag="gst">${I.ban}<span>GSTIN missing <b>${noGst}</b></span></button>` : '',
    noDl ? `<button type="button" data-flag="dl">${I.ban}<span>Drug licence missing <b>${noDl}</b></span></button>` : '',
    adv ? `<span class="ds-adv">${I.rupee}<span>Advances paid <b>${rupees0(adv)}</b></span></span>` : ''
  ].join('');
  $('sumMore').hidden = !$('sumMore').innerHTML;
}
function notify() {
  const items = [];
  if (isAdmin) {
    const od = bills.filter(b => b.due_date && b.due_date < today() && num(b.total) - num(b.paid) - num(b.returned) > 0.005);
    const by = new Map(); od.forEach(b => by.set(b.distributor, (by.get(b.distributor) || 0) + num(b.total) - num(b.paid) - num(b.returned)));
    if (by.size) items.push({ tone: 'danger', title: `${by.size} distributor(s) have overdue bills`, detail: [...by.entries()].slice(0, 3).map(([n, v]) => `${n} ${rupees0(v)}`).join(', '), href: 'distributors.html?status=dues' });
  }
  const noLic = list.filter(d => d.active && (!d.gstin || !d.drug_licence));
  if (noLic.length) items.push({ tone: 'warn', title: `${noLic.length} active distributor(s) missing GSTIN or drug licence`, detail: noLic.slice(0, 3).map(d => d.name).join(', '), href: 'distributors.html' });
  const late = orders.filter(o => o.expected_date && o.expected_date < today());
  if (late.length) items.push({ tone: 'info', title: `${late.length} purchase order(s) past the expected date`, detail: late.slice(0, 3).map(o => o.distributor).join(', '), href: 'purchases.html?tab=ordered' });
  setNotifications(items);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
function filtered() {
  const q = $('q').value.trim().toLowerCase(), qd = digits(q), stt = $('fStatus').value;
  let rows = list.filter(d => {
    if (stt === 'active' && !d.active) return false;
    if (stt === 'inactive' && d.active) return false;
    if (stt === 'dues' && !(due(d.id) > 0.005)) return false;
    if (stt === 'recent' && !st(d.id).recent) return false;
    if (stt === 'idle' && !(d.active && (!st(d.id).last || st(d.id).last < addDays(today(), -89)))) return false;
    if (filt.noGst && d.gstin) return false;
    if (filt.noDl && d.drug_licence) return false;
    if (q && !(`${d.name} ${d.contact_person || ''} ${d.gstin || ''} ${d.email || ''} ${d.drug_licence || ''} ${d.address || ''}`.toLowerCase().includes(q) || (qd.length >= 3 && digits(d.phone).includes(qd)))) return false;
    return true;
  });
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    value: (a, b) => (isAdmin ? st(b.id).value - st(a.id).value : st(b.id).units - st(a.id).units) || a.name.localeCompare(b.name),
    due: (a, b) => due(b.id) - due(a.id) || a.name.localeCompare(b.name),
    bills: (a, b) => st(b.id).n - st(a.id).n || a.name.localeCompare(b.name),
    last: (a, b) => (st(b.id).last || '').localeCompare(st(a.id).last || '') || a.name.localeCompare(b.name),
    new: (a, b) => String(b.created_at).localeCompare(String(a.created_at))
  }[sortKey] || ((a, b) => a.name.localeCompare(b.name));
  rows.sort((a, b) => (b.active - a.active) * (sortKey === 'name' ? 1 : 0) || by(a, b));
  return rows;
}
function phoneCell(value) {
  const ps = phoneParts(value);
  if (!ps.length) return '<span class="ds-muted">—</span>';
  return `<div class="ds-phones">${ps.slice(0, 2).map(p => `<span class="ds-ph"><a href="${esc(callHref(p))}" class="ds-ph-no" title="Call ${esc(p)}">${esc(p)}</a><a class="ds-wa" href="${esc(waHref(p))}" target="_blank" rel="noopener" title="WhatsApp ${esc(p)}" aria-label="WhatsApp ${esc(p)}">${I.wa}</a></span>`).join('')}${ps.length > 2 ? `<small>+${ps.length - 2} more</small>` : ''}</div>`;
}
function draw() {
  const rows = filtered(), per = Number($('perPage').value), pages = Math.max(1, Math.ceil(rows.length / per));
  page = Math.min(page, pages);
  const shown = rows.slice((page - 1) * per, page * per);
  $('listTotal').textContent = `(${rows.length})`;
  $('rows').innerHTML = shown.map((d, i) => {
    const s = st(d.id), dd = due(d.id);
    return `<tr data-id="${esc(d.id)}" class="${d.active ? '' : 'ds-off'}">
      <td class="c-no">${(page - 1) * per + i + 1}</td>
      <td class="c-name"><div class="ds-name">${avatar(d)}<span><b>${esc(d.name)}</b><small>${d.gstin ? esc(d.gstin) : '<i>No GSTIN</i>'}${s.n ? ` · ${s.n} bill${s.n === 1 ? '' : 's'}` : ''}${isAdmin && dd > 0.005 ? ` · <em>Due ${rupees0(dd)}</em>` : ''}</small>
        <small class="ds-m-line">${d.contact_person ? `${I.user}${esc(d.contact_person)}` : ''}${phoneParts(d.phone)[0] ? `<a href="${esc(callHref(phoneParts(d.phone)[0]))}">${I.phone}${esc(phoneParts(d.phone)[0])}</a>` : ''}</small></span></div></td>
      <td class="c-contact">${esc(d.contact_person || '—')}</td>
      <td class="c-phone">${phoneCell(d.phone)}</td>
      <td class="c-email">${d.email ? `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : '<span class="ds-muted">—</span>'}</td>
      <td class="c-st"><span class="md-chip ${d.active ? 'in' : 'out'}"><i></i>${d.active ? 'Active' : 'Inactive'}</span></td>
      <td class="c-act"><div class="pur-acts"><button type="button" class="dl-act" data-v="${esc(d.id)}" aria-label="View ${esc(d.name)}">${I.eye}</button><div class="dl-pop-anchor"><button type="button" class="dl-act" data-menu aria-label="More actions for ${esc(d.name)}">${I.dots}</button></div></div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="dl-empty">${list.length ? 'No distributors match these filters.' : 'No distributors yet. Use “Add Distributor”.'}</td></tr>`;
  $('pageInfo').textContent = rows.length ? `Showing ${(page - 1) * per + 1} – ${Math.min(page * per, rows.length)} of ${count(rows.length)} distributors` : '';
  $('pager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, k) => k + 1).filter(n => n <= 5 && page <= 3 || n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, k, arr) => `${k && n - arr[k - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
  $('filterDot').hidden = !(filt.noGst || filt.noDl || sortKey !== 'name');
}
function renderAll() { renderKpis(); draw(); drawChart(); renderTop(); renderSummary(); notify(); }

// row menu
let menuEl = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
function menuHtml(d) {
  const ps = phoneParts(d.phone), b = (a, ic, l, cls = '') => `<button type="button" data-act="${a}" class="${cls}">${ic}<span>${l}</span></button>`;
  return [
    b('view', I.eye, 'View details'), canWrite ? b('edit', I.pencil, 'Edit') : '',
    canPurchase && d.active ? `<a href="purchases.html?new=1&dist=${encodeURIComponent(d.id)}">${I.bill}<span>New purchase bill</span></a><a href="purchases.html?order=1&dist=${encodeURIComponent(d.id)}">${I.order}<span>New purchase order</span></a>` : '',
    canPurchase ? `<a href="purchases.html?q=${encodeURIComponent(d.name)}">${I.cart}<span>View purchases</span></a>` : '',
    isAdmin && due(d.id) > 0.005 && d.active ? b('pay', I.rupee, `Record payment (${rupees0(due(d.id))} due)`) : '',
    ps[0] ? `<a href="${esc(callHref(ps[0]))}">${I.phone}<span>Call ${esc(ps[0])}</span></a><a href="${esc(waHref(ps[0]))}" target="_blank" rel="noopener">${I.wa}<span>WhatsApp</span></a>` : '',
    d.email ? `<a href="mailto:${esc(d.email)}">${I.mail}<span>Email</span></a>` : '',
    canWrite ? b('toggle', I.power, d.active ? 'Deactivate' : 'Activate', d.active ? 'danger' : '') : ''
  ].join('');
}
$('rows').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const d = list.find(x => x.id === tr.dataset.id);
  const m = e.target.closest('[data-menu]');
  if (m) { e.stopPropagation(); if (menuEl && menuEl.parentElement === m.parentElement) return closeMenu(); closeMenu(); menuEl = document.createElement('div'); menuEl.className = 'dl-pop md-menu md-row-menu pur-row-menu'; menuEl.innerHTML = menuHtml(d); m.parentElement.append(menuEl); return; }
  const a = e.target.closest('[data-act]');
  if (a) { e.stopPropagation(); closeMenu(); return act(a.dataset.act, d); }
  if (e.target.closest('a')) return;
  if (e.target.closest('[data-v]')) return showDistributor(d);
  showDistributor(d);
});
document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
async function act(a, d) {
  if (a === 'view') return showDistributor(d);
  if (a === 'edit') return openEdit(d);
  if (a === 'pay') return openPayment(d);
  if (a === 'toggle') return toggleActive(d);
}
async function toggleActive(d) {
  if (d.active) {
    const open = orders.filter(o => o.distributor_id === d.id).length, dd = due(d.id);
    if (!confirm(`Deactivate ${d.name}?${open ? `\n• ${open} open purchase order(s)` : ''}${dd > 0.005 ? `\n• ${rupees0(dd)} still payable` : ''}\nInactive distributors cannot be picked on new purchases. History stays.`)) return;
  }
  const { error } = await sb.from('distributors').update({ active: !d.active }).eq('id', d.id).eq('branch_id', prof.branch_id);
  if (error) return toast(friendly(error), true);
  await loadAll();
  note(`${d.name} ${d.active ? 'deactivated' : 'activated'}.`);
}

// ---------------------------------------------------------------------------
// Add / edit (existing behaviour: logo upload, GSTIN uppercase, phones normalised)
// ---------------------------------------------------------------------------
function setLogoPreview(src = '') {
  const img = $('logoPreview');
  if (src) { img.src = src; img.hidden = false; $('logoPh').hidden = true; }
  else { img.removeAttribute('src'); img.hidden = true; $('logoPh').hidden = false; }
}
function openEdit(d = {}) {
  if (!canWrite) return;
  $('dt').textContent = d.id ? `Edit ${d.name}` : 'Add distributor';
  $('err').textContent = ''; f.reset(); logoFile = null; $('logoFile').value = ''; $('dupHint').hidden = true;
  for (const k of ['id', 'name', 'contact_person', 'phone', 'email', 'address', 'gstin', 'drug_licence']) f.elements[k].value = d[k] ?? '';
  f.elements.active.checked = d.active ?? true;
  f.dataset.oldLogo = d.logo_path || '';
  removeExistingLogo = false;
  setLogoPreview(d.logo_path ? logoUrl(d.logo_path) : '');
  gstHint();
  $('dlg').showModal();
  $('fName').focus();
}
function gstHint() {
  const g = $('fGst').value.trim().toUpperCase();
  $('gstHint').textContent = !g ? '' : GST_RE.test(g) ? `✓ ${gstState(g)} · PAN ${g.slice(2, 12)}` : g.length < 15 ? `${15 - g.length} more character(s)` : 'Check the format (e.g. 32AACFB8381R1ZZ)';
  $('gstHint').className = `ds-hint ${!g ? '' : GST_RE.test(g) ? 'ok' : 'bad'}`;
}
function dupCheck() {
  const id = f.elements.id.value, name = $('fName').value.trim().toLowerCase(), g = $('fGst').value.trim().toUpperCase(), ph = phoneParts($('fPhone').value).map(digits).filter(x => x.length >= 6);
  const hit = list.find(d => d.id !== id && ((name && d.name.trim().toLowerCase() === name) || (g && d.gstin === g) || (ph.length && phoneParts(d.phone).map(digits).some(p => ph.includes(p)))));
  $('dupHint').hidden = !hit;
  if (hit) $('dupHint').textContent = `Looks like “${hit.name}” already exists (same ${hit.name.trim().toLowerCase() === name ? 'name' : g && hit.gstin === g ? 'GSTIN' : 'phone number'}).`;
}
$('fGst').addEventListener('input', () => { gstHint(); dupCheck(); });
$('fName').addEventListener('input', dupCheck);
$('fPhone').addEventListener('change', dupCheck);

async function uploadLogo(distributorId, file, oldPath) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${prof.branch_id}/${distributorId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await sb.storage.from(LOGO_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;
  const { error: updateError } = await sb.from('distributors').update({ logo_path: path }).eq('id', distributorId).eq('branch_id', prof.branch_id);
  if (updateError) { await sb.storage.from(LOGO_BUCKET).remove([path]); throw updateError; }
  if (oldPath && oldPath !== path) await sb.storage.from(LOGO_BUCKET).remove([oldPath]);
}
f.onsubmit = async e => {
  e.preventDefault(); $('err').textContent = '';
  const d = Object.fromEntries(new FormData(f)); const id = d.id; delete d.id;
  const row = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, nul(String(v).trim())]));
  if (!row.name || row.name.length < 2) { $('err').textContent = 'Enter the distributor name.'; return; }
  row.phone = phoneParts(row.phone).join(', ') || null;
  row.gstin = row.gstin?.toUpperCase() ?? null; row.active = f.elements.active.checked;
  if (row.gstin && row.gstin.length !== 15) { $('err').textContent = 'GSTIN must be 15 characters.'; return; }
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) { $('err').textContent = 'Check the email address.'; return; }
  if (!id) row.branch_id = prof.branch_id;
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
  const { data, error } = id
    ? await sb.from('distributors').update(row).eq('id', id).eq('branch_id', prof.branch_id).select('id').single()
    : await sb.from('distributors').insert(row).select('id').single();
  btn.disabled = false;
  if (error) { $('err').textContent = error.code === '23514' ? 'GSTIN format is invalid.' : error.code === '23505' ? 'A distributor with this name or GSTIN already exists.' : friendly(error); return; }
  const distributorId = id || data.id;
  const file = $('logoFile').files?.[0];
  if (removeExistingLogo && !file && f.dataset.oldLogo) {
    const { error: clearError } = await sb.from('distributors').update({ logo_path: null }).eq('id', distributorId).eq('branch_id', prof.branch_id);
    if (clearError) { $('err').textContent = `Distributor saved, but logo could not be removed: ${friendly(clearError)}`; return; }
    await sb.storage.from(LOGO_BUCKET).remove([f.dataset.oldLogo]);
  }
  if (file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { $('err').textContent = 'Distributor saved, but logo was not uploaded. Choose PNG, JPG or WEBP up to 2 MB.'; return; }
    try { await uploadLogo(distributorId, file, f.dataset.oldLogo || ''); }
    catch (uploadError) { $('err').textContent = `Distributor saved, but logo upload failed: ${friendly(uploadError)}. Check the distributor logo storage migration.`; return; }
  }
  $('dlg').close(); await loadAll();
  note(`${row.name} ${id ? 'updated' : 'added'}.`);
};
$('logoFile').onchange = () => {
  const file = $('logoFile').files?.[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { $('err').textContent = 'Choose a PNG, JPG or WEBP image up to 2 MB.'; $('logoFile').value = ''; return; }
  $('err').textContent = ''; setLogoPreview(URL.createObjectURL(file));
};
$('clearLogo').onclick = () => { $('logoFile').value = ''; logoFile = null; removeExistingLogo = true; setLogoPreview(''); };
$('new').onclick = () => openEdit();
$('cancel').onclick = $('cancel2').onclick = () => $('dlg').close();

// ---------------------------------------------------------------------------
// Details: profile, performance, purchases, payments, orders
// ---------------------------------------------------------------------------
async function showDistributor(d) {
  if (!d) return;
  $('viewBody').innerHTML = '<p class="dl-empty">Loading distributor details and purchase history…</p>';
  if (!$('viewDlg').open) $('viewDlg').showModal();
  const { data: full, error } = await sb.from('distributors').select('*').eq('id', d.id).eq('branch_id', prof.branch_id).single();
  if (error) { $('viewBody').innerHTML = `<p class="pos-form-msg">${esc(friendly(error))}</p>`; return; }
  let inv = bills.filter(b => b.distributor_id === d.id);
  let invErr = '';
  if (!canWrite) inv = [];
  if (!bills.length && canWrite) {
    // Fallback (migration 0024 not run): admins can read purchase_invoices directly.
    const r = await sb.from('purchase_invoices').select('id,supplier_invoice_no,invoice_date,status,total,due_date').eq('branch_id', prof.branch_id).eq('distributor_id', d.id).order('invoice_date', { ascending: false }).limit(200);
    if (r.error) invErr = friendly(r.error); else inv = (r.data || []).map(x => ({ ...x, line_count: null, paid: null, returned: null }));
  }
  const s = st(d.id), dd = isAdmin ? balances.get(d.id) || 0 : null;
  const ords = orders.filter(o => o.distributor_id === d.id);
  const ps = phoneParts(full.phone);
  const pays = isAdmin ? (await sb.from('supplier_payments').select('payment_no,amount,method,reference,status,created_at,purchase_invoice_id').eq('branch_id', prof.branch_id).eq('distributor_id', d.id).order('created_at', { ascending: false }).limit(50)).data || [] : [];
  const tile = (cls, label, val) => `<div class="${cls}"><b>${val}</b><span>${label}</span></div>`;
  $('viewBody').innerHTML = `
    <section class="ds-prof">
      ${full.logo_path ? `<img class="ds-prof-logo" src="${esc(logoUrl(full.logo_path))}" alt="${esc(full.name)} logo">` : `<span class="ds-prof-logo ph" style="--c:${toneOf(full.name)}">${I.building}</span>`}
      <div class="ds-prof-txt"><h3>${esc(full.name)} <span class="md-chip ${full.active ? 'in' : 'out'}"><i></i>${full.active ? 'Active' : 'Inactive'}</span></h3>
        <p>${full.contact_person ? `${I.user}${esc(full.contact_person)}` : ''}${full.address ? ` · ${esc(full.address)}` : ''}</p>
        <div class="ds-prof-acts">
          ${ps.map(p => `<a class="pos-btn pos-btn-sm" href="${esc(callHref(p))}">${I.phone}<span>${esc(p)}</span></a><a class="pos-btn pos-btn-sm pos-btn-green" href="${esc(waHref(p))}" target="_blank" rel="noopener">${I.wa}<span>WhatsApp</span></a>`).join('')}
          ${full.email ? `<a class="pos-btn pos-btn-sm" href="mailto:${esc(full.email)}">${I.mail}<span>${esc(full.email)}</span></a>` : ''}
        </div></div>
    </section>
    <div class="delivery-detail-grid dl-detail-grid ds-kv">
      <div><small>GSTIN</small><b>${esc(full.gstin || '—')}</b>${full.gstin ? `<small>${esc(gstState(full.gstin))}</small>` : ''}</div>
      <div><small>Drug licence</small><b>${esc(full.drug_licence || '—')}</b></div>
      <div><small>Added on</small><b>${esc(dmy(istDay(full.created_at)))}</b></div>
      <div><small>Last purchase</small><b>${s.last ? esc(dmy(s.last)) : 'No bills yet'}</b></div>
    </div>
    <div class="pur-sum-tiles ds-tiles">
      ${isAdmin ? tile('g', 'Total purchased', rupees0(s.value)) : tile('g', 'Units received', count(s.units))}
      ${tile('b', 'Purchase bills', count(s.n))}
      ${isAdmin ? tile(dd > 0.005 ? 'r' : 'a', dd < -0.005 ? 'Advance with them' : 'Payable now', rupees0(Math.abs(dd))) : tile('a', 'Open orders', count(ords.length))}
      ${isAdmin ? tile('p', 'Avg. bill value', rupees0(s.n ? s.value / s.n : 0)) : tile('p', 'Bills (30 days)', count(s.recent))}
    </div>
    <div class="pos-dialog-foot md-foot-left inv-acts ds-acts">
      ${canPurchase && full.active ? `<a class="pos-btn pos-btn-sm pos-btn-solid" href="purchases.html?new=1&dist=${encodeURIComponent(full.id)}">${I.bill}<span>New purchase bill</span></a><a class="pos-btn pos-btn-sm" href="purchases.html?order=1&dist=${encodeURIComponent(full.id)}">${I.order}<span>New order</span></a>` : ''}
      ${isAdmin && dd > 0.005 && full.active ? `<button type="button" class="pos-btn pos-btn-sm" data-dact="pay">${I.rupee}<span>Record payment</span></button>` : ''}
      ${canWrite ? `<button type="button" class="pos-btn pos-btn-sm" data-dact="edit">${I.pencil}<span>Edit</span></button>` : ''}
      <button type="button" class="pos-btn pos-btn-sm" data-dact="print">${I.print}<span>Statement</span></button>
    </div>
    ${ords.length ? `<h4>Open purchase orders (${ords.length})</h4><div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Order</th><th>Date</th><th>Expected</th><th class="c-r">Received</th><th>Status</th></tr></thead><tbody>${ords.map(o => `<tr><td><a href="purchases.html?tab=${o.status === 'partial' ? 'partial' : 'ordered'}">${esc(o.po_no)}</a></td><td>${esc(dmy(o.order_date))}</td><td>${o.expected_date ? esc(dmy(o.expected_date)) : '—'}</td><td class="c-r">${count(o.received_qty)}/${count(o.ordered_qty)}</td><td>${o.status === 'partial' ? 'Partially received' : 'Ordered'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <section class="dist-history"><h4>Purchases from this distributor <span class="ds-count">${inv.length} invoice${inv.length === 1 ? '' : 's'}</span></h4>
      ${invErr ? `<p class="pos-form-msg">Purchase history could not be loaded: ${esc(invErr)}</p>` : inv.length ? `<div class="dl-table-wrap ds-hist"><table class="dl-table md-plain"><thead><tr><th>Invoice date</th><th>Invoice no.</th><th class="c-r">Items</th>${isAdmin ? '<th class="c-r">Total</th><th class="c-r">Balance</th>' : ''}<th></th></tr></thead><tbody>
        ${inv.map(x => { const bal = isAdmin && x.total != null ? Math.max(0, num(x.total) - num(x.paid) - num(x.returned)) : null; return `<tr><td>${esc(dmy(x.invoice_date))}</td><td>${esc(x.supplier_invoice_no)}${x.order_no ? `<small>${esc(x.order_no)}</small>` : ''}</td><td class="c-r">${x.line_count ?? '—'}</td>${isAdmin ? `<td class="c-r">${fmt(x.total)}</td><td class="c-r ${bal > 0.005 ? 'pur-red' : 'pur-green'}">${bal == null ? '—' : bal > 0.005 ? fmt(bal) : 'Paid'}</td>` : ''}<td class="c-r"><button type="button" class="pos-btn pos-btn-sm" data-invoice="${esc(x.id)}">View</button></td></tr>`; }).join('')}
      </tbody></table></div>` : `<p class="ds-muted">${canWrite ? 'No purchase invoices found for this distributor.' : 'Purchase history is visible to purchase staff.'}</p>`}
    </section>
    ${isAdmin ? `<h4>Payments (${pays.length})</h4>${pays.length ? `<div class="pur-paylist">${pays.map(p => `<div><b>${esc(p.payment_no)}</b><span>${fmt(p.amount)} by ${esc(String(p.method).toUpperCase())}${p.reference ? ' · ' + esc(p.reference) : ''}${p.status !== 'posted' ? ' · ' + esc(p.status) : ''}</span><small>${esc(when(p.created_at))}</small></div>`).join('')}</div>` : '<p class="ds-muted">No payments recorded.</p>'}` : ''}`;
  $('viewBody').onclick = async e => {
    const b = e.target.closest('button[data-invoice]'); if (b) return showPurchaseInvoice(b.dataset.invoice, full);
    const a = e.target.closest('[data-dact]'); if (!a) return;
    if (a.dataset.dact === 'edit') { $('viewDlg').close(); return openEdit(full); }
    if (a.dataset.dact === 'pay') { $('viewDlg').close(); return openPayment(full); }
    if (a.dataset.dact === 'print') return printStatement(full, inv, pays);
  };
}
async function showPurchaseInvoice(invoiceId, distributor) {
  const { data, error } = await sb.rpc('purchase_detail', { p_invoice: invoiceId });
  if (error) return toast(friendly(error), true);
  const i = data.invoice, costs = data.can_see_costs;
  $('viewBody').innerHTML = `<button type="button" class="pos-btn pos-btn-sm" id="backHistory">${I.left}<span>Back to ${esc(distributor.name)}</span></button>
    <h3 class="ds-inv-title">Invoice ${esc(i.supplier_invoice_no)} · ${esc(dmy(i.invoice_date))}</h3>
    <div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="c-r">Qty</th><th class="c-r">Free</th><th class="c-r">Pack</th>${costs ? '<th class="c-r">Rate</th><th class="c-r">Net</th>' : ''}</tr></thead><tbody>
    ${data.items.map(x => `<tr><td>${esc(x.medicine)} ${esc(x.strength || '')}</td><td>${esc(x.batch_no)}</td><td>${esc(dmy(x.expiry))}</td><td class="c-r">${num(x.qty)}</td><td class="c-r">${num(x.free_qty)}</td><td class="c-r">${num(x.pack)}</td>${costs ? `<td class="c-r">${fmt(x.unit_price)}</td><td class="c-r">${fmt(x.line_net)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    ${costs ? `<div class="dist-invoice-total ds-inv-total"><span>Taxable ${fmt(i.subtotal)}</span><span>GST ${fmt(i.tax)}</span><strong>Total ${fmt(i.total)}</strong><span>Balance ${fmt(i.balance)}</span></div>` : ''}
    <div class="pos-dialog-foot md-foot-left"><a class="pos-btn pos-btn-sm" href="purchases.html?q=${encodeURIComponent(i.supplier_invoice_no)}">${I.cart}<span>Open in Purchases</span></a></div>`;
  $('backHistory').onclick = () => showDistributor(distributor);
}
$('viewClose').onclick = () => $('viewDlg').close();

function printStatement(d, inv, pays) {
  const frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(frame);
  const rows = inv.map((x, k) => `<tr><td>${k + 1}</td><td>${esc(dmy(x.invoice_date))}</td><td>${esc(x.supplier_invoice_no)}</td><td class="r">${x.line_count ?? ''}</td>${isAdmin ? `<td class="r">${money2(x.total)}</td><td class="r">${money2(x.paid)}</td><td class="r">${money2(Math.max(0, num(x.total) - num(x.paid) - num(x.returned)))}</td>` : ''}</tr>`).join('');
  frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.name)} statement</title><style>body{font:13px Arial,sans-serif;margin:24px}h1{font-size:19px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#f2f5f2}.r{text-align:right}.top{display:flex;justify-content:space-between;border-bottom:2px solid #0f8f17;padding-bottom:8px}</style></head><body>
    <div class="top"><div><h1>PALLIKKAL PHARMACY</h1>Distributor statement · printed ${esc(when(new Date()))}</div><div style="text-align:right"><b>${esc(d.name)}</b><br>${esc(d.gstin || '')}<br>${esc(d.phone || '')}</div></div>
    <table><thead><tr><th>#</th><th>Date</th><th>Invoice</th><th class="r">Items</th>${isAdmin ? '<th class="r">Total</th><th class="r">Paid</th><th class="r">Balance</th>' : ''}</tr></thead><tbody>${rows || '<tr><td colspan="7">No purchases</td></tr>'}</tbody></table>
    ${isAdmin ? `<p><b>Payable now: ${fmt(Math.max(0, balances.get(d.id) || 0))}</b> · ${pays.length} payment(s) recorded</p>` : ''}</body></html>`);
  frame.contentDocument.close();
  setTimeout(() => { try { frame.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => frame.remove(), 60000); }, 250);
}

// ---------------------------------------------------------------------------
// Supplier payment (admins) — on account; the ledger allocates it to the payable
// ---------------------------------------------------------------------------
function openPayment(d) {
  const bal = due(d.id);
  const open = bills.filter(b => b.distributor_id === d.id && num(b.total) - num(b.paid) - num(b.returned) > 0.005).sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
  dlg(`<h3>${I.rupee} Pay ${esc(d.name)}</h3>
    <p class="dl-muted">Payable now <b>${fmt(bal)}</b>${open.length ? ` across ${open.length} bill(s)` : ''}.</p>
    <div class="md-form-grid">
      <div class="pos-field md-span-2"><label for="payBill">Against bill</label><select id="payBill"><option value="">On account (no specific bill)</option>${open.map(b => `<option value="${esc(b.id)}" data-bal="${r2(num(b.total) - num(b.paid) - num(b.returned))}">${esc(b.supplier_invoice_no)} · ${esc(dmy(b.invoice_date))} · balance ${fmt(num(b.total) - num(b.paid) - num(b.returned))}</option>`).join('')}</select></div>
      <div class="pos-field"><label for="payAmt">Amount ₹</label><input id="payAmt" type="number" min="0.01" step=".01" value="${bal.toFixed(2)}"></div>
      <div class="pos-field"><label for="payMode">Mode</label><select id="payMode"><option value="cash">Cash</option><option value="upi">UPI</option></select></div>
      <div class="pos-field"><label for="payRef">Reference</label><input id="payRef" maxlength="100" placeholder="UPI ref / cheque no."></div>
      <div class="pos-field"><label for="payNote">Note</label><input id="payNote" maxlength="200"></div>
    </div><p class="pos-form-msg" id="payMsg"></p>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="paySave">${I.rupee}<span>Save payment</span></button></div>`);
  $('payBill').onchange = () => { const o = $('payBill').selectedOptions[0]; $('payAmt').value = (o.dataset.bal ? num(o.dataset.bal) : bal).toFixed(2); };
  $('paySave').onclick = async () => {
    const amt = num($('payAmt').value);
    if (!(amt > 0)) return ($('payMsg').textContent = 'Enter an amount.');
    if (amt > bal + 0.005 && !confirm(`₹${money2(amt)} is more than the payable ${fmt(bal)}. The extra becomes an advance with ${d.name}. Continue?`)) return;
    $('paySave').disabled = true;
    const { error } = await sb.rpc('record_supplier_payment', { p_distributor: d.id, p_amount: amt, p_method: $('payMode').value, p_reference: $('payRef').value.trim() || null, p_note: $('payNote').value.trim() || null, p_purchase: $('payBill').value || null });
    $('paySave').disabled = false;
    if (error) return ($('payMsg').textContent = friendly(error));
    $('puDlg').close(); await loadAll();
    note(`Payment of ${fmt(amt)} to ${d.name} recorded.`);
  };
}

// ---------------------------------------------------------------------------
// Import / export / more menu
// ---------------------------------------------------------------------------
const COLS = ['Name', 'Contact person', 'Phone', 'Email', 'GSTIN', 'Drug licence', 'Address', 'Active'];
function rowsForExport(all) {
  return (all ? list : filtered()).map(d => ({
    Name: d.name, 'Contact person': d.contact_person || '', Phone: d.phone || '', Email: d.email || '', GSTIN: d.gstin || '', 'Drug licence': d.drug_licence || '', Address: d.address || '', Active: d.active ? 'Yes' : 'No',
    Bills: st(d.id).n, 'Last purchase': st(d.id).last || '', ...(isAdmin ? { 'Total purchased (₹)': r2(st(d.id).value), 'Payable (₹)': r2(due(d.id)) } : { 'Units received': st(d.id).units })
  }));
}
function writeSheet(rows, name) {
  if (window.XLSX) { const ws = XLSX.utils.json_to_sheet(rows); ws['!cols'] = Object.keys(rows[0] || { a: 1 }).map(k => ({ wch: Math.min(40, Math.max(12, k.length + 2)) })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Distributors'); XLSX.writeFile(wb, name + '.xlsx'); return; }
  const keys = Object.keys(rows[0]);
  const csv = [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
}
$('exportBtn').onclick = () => { const rows = rowsForExport(false); if (!rows.length) return toast('Nothing to export.', true); writeSheet(rows, `Pallikkal_Distributors_${today()}`); toast(`${rows.length} distributor(s) exported.`); };
$('importBtn').onclick = () => {
  if (!canWrite) return toast('Your role cannot add distributors.', true);
  dlg(`<h3>${I.upload} Import distributors</h3><p class="dl-muted">Upload an Excel or CSV file with the columns <b>${COLS.join(', ')}</b>. Existing distributors (same name or GSTIN) are updated with any details that are filled in; new ones are added.</p>
    <div class="inv-choices"><button type="button" data-imp="file">${I.upload}<span><b>Choose file</b><small>.xlsx, .xls or .csv</small></span></button><button type="button" data-imp="template">${I.download}<span><b>Download template</b><small>With two sample rows</small></span></button></div>
    <div id="impResult"></div>`);
  $('puPanel').querySelector('.inv-choices').onclick = e => { const b = e.target.closest('[data-imp]'); if (!b) return; if (b.dataset.imp === 'template') return template(); $('importFile').click(); };
};
function template() { writeSheet([{ Name: 'Bismik Medical Agencies', 'Contact person': 'Faisal', Phone: '+91 9747616905, 0483 2741000', Email: 'kimsktkl@gmail.com', GSTIN: '32AACFB8381R1ZZ', 'Drug licence': 'WLF20B2023KL001290', Address: 'Thoppil Hamzath Road, Kottakkal 676503', Active: 'Yes' }, { Name: 'Crown Pharma', 'Contact person': 'Girish', Phone: '+91 7034534682', Email: '', GSTIN: '32AAIFC7928F1ZI', 'Drug licence': 'RLF20B2023KL000404', Address: 'Emerald Tower, Wandoor 679328', Active: 'Yes' }], 'Pallikkal_Distributor_Import_Template'); }
function parseCsv(text) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; } else cur += c; }
  if (cur || row.length) { row.push(cur); out.push(row); }
  const [h, ...rest] = out.filter(r => r.some(x => String(x).trim()));
  return rest.map(r => Object.fromEntries((h || []).map((k, i) => [String(k).replace(/^﻿/, '').trim(), r[i] ?? ''])));
}
$('importFile').onchange = async e => {
  const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
  let rows;
  try {
    if (/\.csv$/i.test(file.name)) rows = parseCsv(await file.text());
    else { if (!window.XLSX) throw new Error('Excel reader unavailable. Save the sheet as CSV and import that, or check your internet connection.'); const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); }
  } catch (err) { if (!$('puDlg').open) $('importBtn').click(); $('impResult').innerHTML = `<p class="pos-form-msg">${esc(err.message || String(err))}</p>`; return; }
  const pick = (r, ...ks) => { for (const k of ks) { const f = Object.keys(r).find(x => x.trim().toLowerCase() === k.toLowerCase()); if (f && String(r[f]).trim()) return String(r[f]).trim(); } return ''; };
  let added = 0, updated = 0; const bad = [];
  for (const [i, r] of rows.entries()) {
    const name = pick(r, 'Name', 'Distributor', 'Distributor name');
    if (!name) { if (Object.values(r).some(v => String(v).trim())) bad.push(`Row ${i + 2}: name missing`); continue; }
    const gst = pick(r, 'GSTIN', 'GST', 'GST No').toUpperCase();
    if (gst && gst.length !== 15) { bad.push(`Row ${i + 2} (${name}): GSTIN must be 15 characters`); continue; }
    const row = { name, contact_person: pick(r, 'Contact person', 'Contact') || null, phone: phoneParts(pick(r, 'Phone', 'Phone number', 'Mobile')).join(', ') || null, email: pick(r, 'Email') || null, gstin: gst || null, drug_licence: pick(r, 'Drug licence', 'Drug license', 'DL No', 'DL') || null, address: pick(r, 'Address') || null };
    const act = pick(r, 'Active'); if (act) row.active = !/^(no|n|false|0|inactive)$/i.test(act);
    const hit = list.find(d => d.name.trim().toLowerCase() === name.toLowerCase() || (gst && d.gstin === gst));
    const res = hit
      ? await sb.from('distributors').update(Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== ''))).eq('id', hit.id).eq('branch_id', prof.branch_id).select('*').single()
      : await sb.from('distributors').insert({ ...row, branch_id: prof.branch_id, active: row.active ?? true }).select('*').single();
    if (res.error) bad.push(`Row ${i + 2} (${name}): ${res.error.code === '23514' ? 'GSTIN format is invalid' : friendly(res.error)}`);
    else if (hit) { updated++; Object.assign(hit, res.data); } else { added++; list.push(res.data); }
  }
  await loadAll();
  if (!$('puDlg').open) $('importBtn').click();
  $('impResult').innerHTML = `<div class="purchase-notice ds-imp">${added} added · ${updated} updated${bad.length ? ` · ${bad.length} skipped` : ''}</div>${bad.length ? `<ul class="ds-imp-bad">${bad.slice(0, 20).map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}`;
  note(`Import finished: ${added} added, ${updated} updated${bad.length ? `, ${bad.length} skipped` : ''}.`, !!bad.length);
};
$('moreBtn').onclick = e => { e.stopPropagation(); $('moreMenu').hidden = !$('moreMenu').hidden; $('moreBtn').setAttribute('aria-expanded', !$('moreMenu').hidden); };
document.addEventListener('click', e => { if (!$('moreMenu').hidden && !e.target.closest('#moreMenu')) $('moreMenu').hidden = true; });
$('moreMenu').onclick = e => {
  const b = e.target.closest('[data-more]'); if (!b) return;
  $('moreMenu').hidden = true;
  if (b.dataset.more === 'template') return template();
  if (b.dataset.more === 'print') {
    const rows = rowsForExport(false), frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.append(frame);
    frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>Distributors</title><style>body{font:12px Arial,sans-serif;margin:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f2f5f2}</style></head><body><h2>PALLIKKAL PHARMACY — Distributors (${rows.length})</h2><table><thead><tr><th>#</th>${['Name', 'Contact person', 'Phone', 'GSTIN', 'Drug licence', 'Active'].map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r, k) => `<tr><td>${k + 1}</td>${['Name', 'Contact person', 'Phone', 'GSTIN', 'Drug licence', 'Active'].map(h => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
    frame.contentDocument.close(); setTimeout(() => { try { frame.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => frame.remove(), 60000); }, 250);
    return;
  }
  if (b.dataset.more === 'dupes') {
    const groups = new Map();
    for (const d of list) { const keys = [`n:${d.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`, d.gstin ? `g:${d.gstin}` : '', ...phoneParts(d.phone).map(p => digits(p).slice(-10)).filter(x => x.length >= 8).map(p => `p:${p}`)].filter(Boolean); for (const k of keys) groups.set(k, [...(groups.get(k) || []), d]); }
    const dup = [...groups.entries()].filter(([, v]) => v.length > 1);
    dlg(`<h3>${I.people} Possible duplicates</h3>${dup.length ? dup.map(([k, v]) => `<div class="ds-dup"><small>Same ${k[0] === 'n' ? 'name' : k[0] === 'g' ? 'GSTIN' : 'phone'}</small>${v.map(d => `<button type="button" class="pos-btn pos-btn-sm" data-open="${esc(d.id)}">${esc(d.name)}${d.active ? '' : ' (inactive)'}</button>`).join('')}</div>`).join('') : '<p class="dl-muted">No duplicates found by name, GSTIN or phone.</p>'}<p class="dl-muted">Keep one, then deactivate the extra entry so old bills stay linked.</p>`);
    $('puPanel').onclick = ev => { const o = ev.target.closest('[data-open]'); if (o) { $('puDlg').close(); showDistributor(list.find(d => d.id === o.dataset.open)); } };
  }
};

// ---------------------------------------------------------------------------
// Filters, paging, KPI and card clicks
// ---------------------------------------------------------------------------
let qt; $('q').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { page = 1; draw(); }, 200); };
['fStatus', 'perPage'].forEach(id => $(id).onchange = () => { page = 1; draw(); });
$('pager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); draw(); } };
$('filterBtn').onclick = e => { e.stopPropagation(); $('filterPop').hidden = !$('filterPop').hidden; };
$('filterPop').onclick = e => e.stopPropagation();
document.addEventListener('click', () => { $('filterPop').hidden = true; });
$('fApply').onclick = () => { sortKey = $('sortBy').value; filt.noGst = $('fNoGst').checked; filt.noDl = $('fNoDl').checked; $('filterPop').hidden = true; page = 1; draw(); };
$('fReset').onclick = () => { sortKey = 'name'; $('sortBy').value = 'name'; filt.noGst = filt.noDl = false; $('fNoGst').checked = $('fNoDl').checked = false; $('fStatus').value = ''; $('q').value = ''; $('filterPop').hidden = true; page = 1; draw(); };
$('trendRange').onchange = () => { drawChart(); renderTop(); };
let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(drawChart, 120); }).observe($('chart'));
const goList = (status = '', sort = sortKey) => { $('fStatus').value = status; sortKey = sort; $('sortBy').value = sort; page = 1; draw(); $('rows').closest('.ds-list').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
document.querySelector('.md-kpis').onclick = e => {
  const b = e.target.closest('[data-kpi]'); if (!b) return;
  if (b.dataset.kpi === 'kTotal') return goList('');
  if (b.dataset.kpi === 'kActive') return goList('active');
  if (b.dataset.kpi === 'kValue') return goList('recent', 'value');
  if (isAdmin) return goList('dues', 'due');
  location.href = 'purchases.html?tab=ordered';
};
$('topAll').onclick = () => goList('', 'value');
$('topRows').onclick = e => { const tr = e.target.closest('tr[data-dist]'); if (tr) showDistributor(list.find(d => d.id === tr.dataset.dist)); };
$('sumTiles').onclick = e => { const b = e.target.closest('[data-sum]'); if (b) goList(b.dataset.sum, b.dataset.sum === 'dues' ? 'due' : sortKey); };
$('sumMore').onclick = e => {
  const b = e.target.closest('[data-sum],[data-flag]'); if (!b) return;
  if (b.dataset.sum) return goList(b.dataset.sum, 'last');
  filt.noGst = b.dataset.flag === 'gst'; filt.noDl = b.dataset.flag === 'dl'; $('fNoGst').checked = filt.noGst; $('fNoDl').checked = filt.noDl; goList('active');
};

// ---------------------------------------------------------------------------
// Start — ?q= search, ?status=active|inactive|dues|idle, ?new=1 add form
// ---------------------------------------------------------------------------
if (!canWrite) { $('new').disabled = true; $('importBtn').disabled = true; }
const params = new URLSearchParams(location.search);
if (params.get('q')) $('q').value = params.get('q');
if (params.get('status') && [...$('fStatus').options].some(o => o.value === params.get('status'))) $('fStatus').value = params.get('status');
await loadAll();
if (params.get('new') === '1' && canWrite) openEdit();
