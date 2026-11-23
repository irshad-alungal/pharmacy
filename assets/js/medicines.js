// Medicines — Pallikkal Pharmacy design.
// Catalogue, stock status, pricing and details. Stock and prices are read from
// the medicine's batches (the same rules billing uses); every change goes
// through the existing tables/RPCs and their RLS + column grants.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { nul, friendly, safeQ } from './ui.js';
import { mountMedicinePhotos } from './medicine-photos.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('medicines', 'Medicines', { layout: 'brand' });
if (!prof) throw new Error('Unable to load user profile.');

const v = document.getElementById('view');
const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const isSuperAdmin = prof.role === 'super_admin';
const canWrite = ['super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing', 'inventory', 'inventory_staff'].includes(prof.role);   // alza_med_write (all staff, 0037)
const canAdjust = ['super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing', 'inventory', 'inventory_staff'].includes(prof.role);
const canMaster = ['super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing', 'inventory', 'inventory_staff'].includes(prof.role);              // categories / manufacturers
const branchId = prof.branch_id;
if (!branchId) {
  v.textContent = 'Your profile has no assigned branch. Contact the administrator.';
  throw new Error('Missing profile branch_id.');
}

document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

// ---------------------------------------------------------------- master data
const lk = {};
async function loadMaster() {
  for (const t of ['categories', 'manufacturers', 'units', 'storage_locations']) {
    const { data, error } = await sb.from(t).select('*').eq('active', true).order('name');
    if (error) console.error(`Could not load ${t}:`, error);
    lk[t] = data || [];
  }
}
await loadMaster();

// ---------------------------------------------------------------- helpers
const $ = id => document.getElementById(id);
const TZ = 'Asia/Kolkata';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const count = n => new Intl.NumberFormat('en-IN').format(Number(n) || 0);
const money = v => v == null ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthYear = d => d ? new Date(String(d) + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  pill: svg('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>', 2),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  layers: svg('<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>'),
  box: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>', 1.8),
  warn: svg('<path d="M10.3 3.9 1.8 18.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 1.8),
  plusRed: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 1.8),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  tag: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  db: svg('<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/><path d="M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  barcode: svg('<path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14"/>', 2),
  cal: svg('<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>'),
  rupee: svg('<path d="M6 3h12M6 8h12M14 21 6 13h3a5 5 0 0 0 0-10"/>', 2),
  pencil: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  printer: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>', 2),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  camera: svg('<path d="M3 8a2 2 0 0 1 2-2h2l2-3h6l2 3h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="4"/>'),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  check: svg('<path d="m5 12 5 5 9-10"/>', 2.6),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M17 9v8H9"/></svg>'
};
const PILLS = ['#1e7be6', '#e5484d', '#7a4ff0', '#12a01b', '#f29a00', '#0e9488'];
const thumbPh = (name, cls = '') => {
  const c = PILLS[[...String(name || 'x')].reduce((s, ch) => s + ch.charCodeAt(0), 0) % PILLS.length];
  return `<span class="md-thumb md-ph ${cls}" style="--c:${c}" aria-hidden="true"><svg viewBox="0 0 64 40"><rect x="2" y="6" width="60" height="28" rx="4" fill="#fff" stroke="#d9dfe8"/><rect x="2" y="6" width="20" height="28" rx="4" fill="var(--c)"/><path d="M28 14h26M28 20h18M28 26h22" stroke="#c8d0db" stroke-width="2.4" stroke-linecap="round"/></svg></span>`;
};
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
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

// ---------------------------------------------------------------- layout
v.innerHTML = `
<div class="pos dl md">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.pill}</span>
      <div><h1>Medicines</h1><p>Manage your medicine catalog, stock, pricing, and details in one place.</p></div></div>
    <div class="pos-head-actions md-head-actions">
      <button type="button" class="pos-btn pos-btn-solid" id="new">${I.plusC}<span>Add Medicine</span></button>
      <div class="dl-pop-anchor">
        <button type="button" class="pos-btn" id="importBtn" aria-haspopup="true" aria-expanded="false">${I.upload}<span>Import</span></button>
        <div class="dl-pop md-menu" id="importMenu" hidden>
          <button type="button" id="bulkImport">${I.upload}<span><b>Upload Excel file</b><small>Add many medicines at once</small></span></button>
          <button type="button" id="downloadTemplate">${I.download}<span><b>Download Excel template</b><small>Column headings and a sample row</small></span></button>
        </div>
        <input id="bulkFile" type="file" accept=".xlsx,.xls" hidden>
      </div>
      <button type="button" class="pos-btn" id="exportBtn">${I.download}<span>Export</span></button>
      ${canWrite ? `<button type="button" class="pos-btn" id="bulkBtn">${I.layers}<span>Bulk Update</span></button>` : ''}
    </div>
  </section>

  <section class="dz-kpis dl-kpis md-kpis">
    ${KPI('green', I.box, 'Total Medicines', 'kTotal')}
    ${KPI('blue', I.pill, 'In Stock', 'kIn')}
    ${KPI('amber', I.warn, 'Low Stock', 'kLow')}
    ${KPI('rose', I.plusRed, 'Out of Stock', 'kOut')}
  </section>

  <div id="msg" class="md-msg" role="status"></div>
  <div id="bulkReport" class="md-report" role="status" hidden></div>

  <div class="dl-grid md-grid">
    <div class="dl-main-col">
      <section class="pos-card dl-orders md-list">
        <div class="dl-card-head md-list-head">
          <h2>${I.list}Medicine List <span id="listCount">(0)</span></h2>
          <label class="dl-search md-search">${I.search}<input id="q" type="search" placeholder="Search by medicine name, brand, or barcode..." autocomplete="off" aria-label="Search medicines"></label>
          <div class="md-mobile-tools"><button type="button" class="dl-act md-tool" id="mSearch" aria-label="Search">${I.search}</button></div>
        </div>
        <div class="md-filters">
          <label class="dl-select">${I.grid}<select id="fCat" aria-label="Category"><option value="">All Categories</option></select></label>
          <label class="dl-select">${I.tag}<select id="fBrand" aria-label="Brand"><option value="">All Brands</option></select></label>
          <label class="dl-select">${I.db}<select id="fStock" aria-label="Stock status"><option value="">All Stock Status</option><option value="in">In Stock</option><option value="low">Low Stock</option><option value="out">Out of Stock</option><option value="inactive">Inactive medicines</option></select></label>
          <button type="button" class="pos-btn md-reset" id="resetBtn">${I.reset}<span>Reset</span></button>
          <label class="dl-check md-inact"><input type="checkbox" id="inact"> Show inactive</label>
        </div>
        <div class="md-selbar" id="selBar" hidden><span id="selText"></span><button type="button" class="pos-text-btn" id="selBulk">Bulk update</button><button type="button" class="pos-text-btn" id="selClear">Clear selection</button></div>
        <div class="dl-table-wrap"><table class="dl-table md-table"><thead><tr>
          <th class="c-no"><label class="md-check-all"><input type="checkbox" id="selAll" aria-label="Select all on this page"><span>#</span></label></th>
          <th>Medicine Name</th><th>Brand</th><th>Category</th><th class="c-r">MRP (₹)</th><th class="c-r">Stock</th><th>Status</th><th class="c-c">Actions</th>
        </tr></thead><tbody id="rows"><tr><td colspan="8" class="dl-empty">Loading medicines…</td></tr></tbody></table></div>
        <div class="dl-pager md-pager"><span id="pageInfo"></span><div id="pager"></div>
          <label class="dl-select md-per"><select id="perPage" aria-label="Rows per page"><option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></select></label></div>
      </section>
      ${isSuperAdmin ? `<section class="pos-card md-requests" id="reqCard" hidden><div class="dl-card-head"><h2>${I.warn}Medicine Deactivation Requests <b class="pos-count" id="reqCount">0</b></h2></div><div id="deactivationRequests">Loading pending requests...</div></section>` : ''}
    </div>

    <aside class="dl-side">
      <section class="pos-card md-details" id="detailsCard">
        <div class="dl-card-head"><h2>${I.box}Medicine Details</h2><button type="button" class="dl-act" id="detailsOpen" title="Open full profile" aria-label="Open full profile">${I.chev}</button></div>
        <div id="details"><p class="dl-empty">Select a medicine to see its details.</p></div>
      </section>
      <section class="pos-card dl-quick md-quick">
        <h2>${I.bolt}Quick Actions</h2>
        <div class="md-qa" id="qa">
          <button type="button" data-qa="edit">${I.pencil}<span>Edit Medicine</span></button>
          <button type="button" data-qa="stock">${I.box}<span>Update Stock</span></button>
          <button type="button" data-qa="history">${I.history}<span>View History</span></button>
          <button type="button" data-qa="duplicate">${I.copy}<span>Duplicate</span></button>
          <button type="button" data-qa="label">${I.printer}<span>Print Label</span></button>
          <button type="button" data-qa="delete" class="danger">${I.trash}<span id="qaDelLabel">Delete</span></button>
        </div>
      </section>
    </aside>
  </div>
</div>

<dialog id="ph" class="pos-dialog dl-dialog md-wide"><button type="button" class="pos-icon-btn dl-x" onclick="this.closest('dialog').close()" aria-label="Close">${I.xs}</button><div id="phb"></div></dialog>
<dialog id="dlg" class="pos-dialog dl-dialog md-wide"><button type="button" class="pos-icon-btn dl-x" id="cancel" aria-label="Close">${I.xs}</button>
  <h3 id="dt">Add medicine</h3>
  <form id="f" method="dialog" class="md-form"><input type="hidden" name="id">
    <div class="md-form-grid">
      <div class="pos-field md-span-2"><label>Medicine name *</label><input name="name" placeholder="Enter medicine name" required maxlength="200"></div>
      <div class="pos-field"><label>Strength</label><input name="strength" placeholder="e.g. 500 mg"></div>
      <div class="pos-field"><label>Dosage form</label><input name="dosage_form" list="formList" placeholder="Tablet, Capsule, Syrup…"><datalist id="formList">${['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Drops', 'Cream', 'Ointment', 'Gel', 'Inhaler', 'Powder', 'Sachet', 'Lotion', 'Spray'].map(x => `<option value="${x}">`).join('')}</datalist></div>
      <div class="pos-field"><label>Brand</label><input name="brand" placeholder="Brand name"></div>
      <div class="pos-field"><label>Generic name</label><input name="generic_name" placeholder="Generic name"></div>
      <div class="pos-field"><label>Manufacturer</label><select name="manufacturer_id" id="fMan"></select></div>
      <div class="pos-field"><label>Category</label><select name="category_id" id="fCatSel"></select></div>
      <div class="pos-field md-span-2"><label>Ingredients</label><textarea name="ingredients" rows="2" placeholder="Active ingredients / ingredient names. You can include multiple ingredients."></textarea></div>
      <div class="pos-field md-span-2"><label>Composition</label><textarea name="composition" rows="2" placeholder="Composition details"></textarea></div>
      <div class="pos-field"><label>Barcode</label><input name="barcode" inputmode="numeric" placeholder="Scan or type the barcode"></div>
      <div class="pos-field"><label>Rack / Shelf</label><input name="rack" placeholder="e.g. A-03 / Shelf 2"></div>
      <div class="pos-field"><label>Discount <small>Optional · 10% or ₹ 5 off each unit</small></label><input name="discount_text" inputmode="decimal" maxlength="12" placeholder="e.g. 10% or 5"><small class="md-hint">Type <b>%</b> for a percentage; a number alone is ₹ off each unit. Applied automatically in billing.</small></div>
      <div class="pos-field"><label>Minimum stock <small>Low-stock alert level</small></label><input name="reorder_level" type="number" min="0" step="1" inputmode="numeric" placeholder="e.g. 50"></div>
      <div class="pos-field"><label>GST % <small>Optional</small></label><input name="tax_rate" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="0" placeholder="0"><small class="md-hint">Billing shows the GST from the purchase or opening stock entry. This value is used only if a batch has none.</small></div>
    </div>
    <div class="md-checks"><label><input type="checkbox" name="need_doctor_sheet"> Need doctor sheet / prescription</label><label><input type="checkbox" name="active" checked> Active</label></div>
    <p class="md-note">MRP, stock and GST come from purchase batches (Purchases or Inventory → Opening stock). Unit price in billing = MRP ÷ pack size, less this discount.</p>
    <div id="activeNote" class="dl-muted"></div><div id="err" class="pos-form-msg"></div>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" id="cancelBottom">Cancel</button><button type="submit" class="pos-btn pos-btn-solid">Save medicine</button></div>
  </form></dialog>
<dialog id="viewMedicine" class="pos-dialog dl-dialog md-wide"><button type="button" class="pos-icon-btn dl-x" id="viewClose" aria-label="Close">${I.xs}</button><h3 id="viewTitle">Medicine details</h3><div id="viewContent"></div></dialog>
<dialog id="mdDlg" class="pos-dialog dl-dialog md-wide"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="mdBody"></div></dialog>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;

mountGlobalSearch({ sb, prof });
const f = $('f');
let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4000); };
const msg = m => { $('msg').textContent = m || ''; };

// ---------------------------------------------------------------- data
const COLS = ['id', 'branch_id', 'name', 'ingredients', 'need_doctor_sheet', 'brand', 'generic_name', 'composition', 'strength', 'dosage_form', 'barcode', 'sku', 'mrp', 'selling_price', 'tax_rate', 'reorder_level', 'shelf_location', 'rack', 'active', 'category_id', 'manufacturer_id', 'storage_location_id', 'base_unit_id', 'discount_percentage', 'created_at', 'price_includes_tax', 'discount_amount'].join(',');
let list = [];        // all medicines of the branch (active + inactive)
let byId = new Map();
let discountColumnAvailable = true;
let selectedId = null;
const picked = new Set();
let page = 1;
const photoUrls = new Map();

// Medicine discount: a percentage ("10%") or a fixed amount in ₹ off each unit ("5"). 0037.
const discText = m => m.discount_percentage != null && m.discount_percentage !== '' ? `${Number(m.discount_percentage)}%` : (Number(m.discount_amount) > 0 ? `₹${Number(m.discount_amount)}` : '');
function parseDiscount(raw) {
  const t = String(raw ?? '').trim().replace(/₹|rs\.?/ig, '').trim();
  if (!t) return { pct: null, amt: null };
  if (/%$/.test(t)) { const v = Number(t.slice(0, -1).trim()); return Number.isFinite(v) && v >= 0 && v <= 100 ? { pct: v, amt: null } : { error: 'A percentage discount must be from 0% to 100%.' }; }
  const v = Number(t); return Number.isFinite(v) && v >= 0 ? { pct: null, amt: v || null } : { error: 'Enter the discount as 10% (percentage) or 5 (₹ off each unit).' };
}
const defaultDiscount = m => m.discount_percentage != null && m.discount_percentage !== ''
  ? Math.min(Math.max(Number(m.discount_percentage), 0), 100)
  : (Number(m.mrp) > 0 && Number(m.selling_price) > 0 && Number(m.selling_price) < Number(m.mrp) ? (Number(m.mrp) - Number(m.selling_price)) * 100 / Number(m.mrp) : 0);

async function load() {
  msg('Loading medicines…');
  let res = await fetchAll(() => sb.from('medicines').select(COLS).eq('branch_id', branchId).order('name').order('id'));
  if (res.error && /discount_amount/i.test(res.error.message || '')) res = await fetchAll(() => sb.from('medicines').select(COLS.replace(',discount_amount', '')).eq('branch_id', branchId).order('name').order('id'));
  if (res.error && /discount_percentage|price_includes_tax/i.test(res.error.message || '')) {
    discountColumnAvailable = !/discount_percentage/i.test(res.error.message || '');
    const cols = COLS.split(',').filter(c => !(/discount_percentage|price_includes_tax/.test(c))).join(',');
    res = await fetchAll(() => sb.from('medicines').select(cols).eq('branch_id', branchId).order('name').order('id'));
    if (!res.error) msg('Medicine list loaded. Apply database migration 0018 to enable the optional discount field.');
  } else if (!res.error) discountColumnAvailable = true;
  if (res.error) { msg(friendly(res.error)); console.error('Medicine loading failed:', res.error); return; }
  const meds = res.data || [];

  const bres = await fetchAll(() => sb.from('medicine_batches').select('id,medicine_id,batch_no,expiry,qty,quarantined,stock_status,mrp').eq('branch_id', branchId).gt('qty', 0).order('expiry').order('id'));
  const batches = bres.data || [];
  const perMed = new Map();
  for (const b of batches) {
    const e = perMed.get(b.medicine_id) || { sellable: 0, total: 0, next: null, batches: 0 };
    e.total += Number(b.qty);
    e.batches++;
    const ok = b.expiry > today && !b.quarantined && (b.stock_status || 'active') === 'active';
    if (ok) {
      e.sellable += Number(b.qty);
      if (!e.next || b.expiry < e.next.expiry) e.next = b;
    }
    perMed.set(b.medicine_id, e);
  }
  const catName = new Map(lk.categories.map(c => [c.id, c.name]));
  const manName = new Map(lk.manufacturers.map(c => [c.id, c.name]));
  list = meds.map(m => {
    const s = perMed.get(m.id) || { sellable: 0, total: 0, next: null, batches: 0 };
    const lvl = Number(m.reorder_level) || 0;
    const status = !m.active ? 'inactive' : s.sellable <= 0 ? 'out' : (lvl > 0 && s.sellable <= lvl) ? 'low' : 'in';
    const mrp = s.next?.mrp != null ? Number(s.next.mrp) : (Number(m.mrp) > 0 ? Number(m.mrp) : null);
    const disc = defaultDiscount(m) || (mrp && Number(m.discount_amount) > 0 ? Math.min(100, Number(m.discount_amount) / mrp * 100) : 0);
    return {
      ...m, stock: s.sellable, totalQty: s.total, nextBatch: s.next, batchCount: s.batches, status,
      category: catName.get(m.category_id) || '', manufacturer: manName.get(m.manufacturer_id) || '',
      brandLabel: m.brand || manName.get(m.manufacturer_id) || '',
      mrpShown: mrp, selling: mrp == null ? null : (Number(m.discount_amount) > 0 && m.discount_percentage == null ? Math.max(0, Math.round((mrp - Number(m.discount_amount)) * 100) / 100) : Math.round(mrp * (100 - disc)) / 100), disc
    };
  });
  byId = new Map(list.map(m => [m.id, m]));
  if (selectedId && !byId.has(selectedId)) selectedId = null;
  msg(bres.error ? `Stock could not be loaded: ${friendly(bres.error)}` : '');
  fillFilters();
  renderKpis();
  render();
  notify();
}

function fillFilters() {
  const keep = { c: $('fCat').value, b: $('fBrand').value };
  const cats = [...new Set(list.map(m => m.category).filter(Boolean))].sort();
  const brands = [...new Set(list.map(m => m.brandLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('fCat').innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('') + (list.some(m => !m.category) ? '<option value="__none">No category</option>' : '');
  $('fBrand').innerHTML = '<option value="">All Brands</option>' + brands.map(c => `<option>${esc(c)}</option>`).join('');
  $('fCat').value = keep.c; $('fBrand').value = keep.b;
}

function renderKpis() {
  const act = list.filter(m => m.active);
  const total = act.length;
  const n = s => act.filter(m => m.status === s).length;
  const pct = x => total ? `<span class="md-pct">${Math.round(x / total * 100)}%</span> of total` : 'of total';
  const monthStart = today.slice(0, 8) + '01';
  const before = act.filter(m => m.created_at && new Date(m.created_at).toLocaleDateString('en-CA', { timeZone: TZ }) < monthStart).length;
  const added = total - before;
  $('kTotal').textContent = count(total);
  $('kTotalNote').innerHTML = before ? `<span class="${added >= 0 ? 'dz-up' : 'dz-down'}">${added >= 0 ? I.up : I.down}${added >= 0 ? '+' : ''}${(added / before * 100).toFixed(1)}%</span> vs. last month` : (added ? `<span class="dz-up">+${count(added)}</span> added this month` : 'active medicines');
  $('kIn').textContent = count(n('in')); $('kInNote').innerHTML = pct(n('in'));
  $('kLow').textContent = count(n('low')); $('kLowNote').innerHTML = pct(n('low'));
  $('kOut').textContent = count(n('out')); $('kOutNote').innerHTML = pct(n('out'));
}

function filtered() {
  const s = $('q').value.trim().toLowerCase();
  const cat = $('fCat').value, brand = $('fBrand').value, st = $('fStock').value;
  const showInactive = $('inact').checked || st === 'inactive';
  return list.filter(m => {
    if (!showInactive && !m.active) return false;
    if (st && m.status !== st) return false;
    if (cat && (cat === '__none' ? m.category : m.category !== cat)) return false;
    if (brand && m.brandLabel !== brand) return false;
    if (s && !`${m.name} ${m.strength || ''} ${m.ingredients || ''} ${m.brand || ''} ${m.generic_name || ''} ${m.barcode || ''} ${m.sku || ''} ${m.manufacturer} ${m.composition || ''}`.toLowerCase().includes(s)) return false;
    return true;
  });
}

const CHIP = { in: ['In Stock', 'in'], low: ['Low Stock', 'low'], out: ['Out of Stock', 'out'], inactive: ['Inactive', 'off'] };
const chip = s => `<span class="md-chip ${CHIP[s][1]}"><i></i>${CHIP[s][0]}</span>`;
const thumb = (m, cls = '') => photoUrls.get(m.id) ? `<img class="md-thumb ${cls}" src="${esc(photoUrls.get(m.id))}" alt="" loading="lazy">` : thumbPh(m.name, cls);

async function loadPhotos(ids) {
  const need = ids.filter(id => !photoUrls.has(id));
  if (!need.length) return false;
  need.forEach(id => photoUrls.set(id, null));
  const { data: photos, error } = await sb.from('medicine_images').select('medicine_id,path,is_primary,sort_order').eq('branch_id', branchId).in('medicine_id', need).order('is_primary', { ascending: false }).order('sort_order');
  if (error) return false;
  const first = new Map();
  for (const p of photos || []) if (!first.has(p.medicine_id)) first.set(p.medicine_id, p.path);
  let changed = false;
  await Promise.all([...first.entries()].map(async ([id, path]) => {
    const { data } = await sb.storage.from('medicine-images').createSignedUrl(path, 3600);
    if (data?.signedUrl && /^(https?:|blob:)/.test(data.signedUrl)) { photoUrls.set(id, data.signedUrl); changed = true; }
  }));
  return changed;
}

function render() {
  const rows = filtered();
  const per = Number($('perPage').value);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  page = Math.min(page, pages);
  const shown = rows.slice((page - 1) * per, page * per);
  $('listCount').textContent = `(${count(rows.length)})`;
  $('rows').innerHTML = shown.map((m, i) => {
    const sub = [m.dosage_form, m.strength && !m.name.includes(m.strength) ? m.strength : ''].filter(Boolean).join(' · ');
    return `<tr data-id="${esc(m.id)}" class="${m.id === selectedId ? 'sel' : ''} ${m.active ? '' : 'inactive'}">
      <td class="c-no"><label class="md-check"><input type="checkbox" data-pick="${esc(m.id)}" ${picked.has(m.id) ? 'checked' : ''} aria-label="Select ${esc(m.name)}"><span>${(page - 1) * per + i + 1}</span></label></td>
      <td class="c-med"><div class="md-med">${thumb(m)}<span><b>${esc(m.name)}${m.strength && !m.name.includes(m.strength) ? ` ${esc(m.strength)}` : ''}</b><small>${esc(m.dosage_form || (m.generic_name ? m.generic_name : 'Form not set'))}${m.need_doctor_sheet ? ' <em class="md-rx">Rx</em>' : ''}</small><small class="md-m-sub">${esc([m.brandLabel, m.dosage_form].filter(Boolean).join(' • ') || 'No brand')}</small></span></div></td>
      <td class="c-brand">${esc(m.brandLabel || '—')}</td>
      <td class="c-cat">${esc(m.category || '—')}</td>
      <td class="c-r c-mrp">${m.mrpShown == null ? '<span class="dl-muted">—</span>' : money(m.mrpShown)}<small class="md-m-stock">Stock: ${count(m.stock)}</small></td>
      <td class="c-r c-stock">${count(m.stock)}</td>
      <td class="c-st">${chip(m.status)}</td>
      <td class="c-act"><div class="dl-pop-anchor"><button type="button" class="dl-act" data-menu="${esc(m.id)}" aria-label="Actions for ${esc(m.name)}" aria-haspopup="true">${I.dots}</button></div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="dl-empty">${list.length ? 'No medicines match these filters.' : 'No medicines yet. Use “Add Medicine” or “Import”.'}</td></tr>`;
  $('pageInfo').textContent = rows.length ? `Showing ${(page - 1) * per + 1} – ${Math.min(page * per, rows.length)} of ${count(rows.length)} medicines` : '';
  $('pager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, k) => k + 1).filter(n => n <= 5 && page <= 3 || n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, k, arr) => `${k && n - arr[k - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
  $('selAll').checked = shown.length > 0 && shown.every(m => picked.has(m.id));
  $('selBar').hidden = !picked.size;
  $('selText').textContent = `${picked.size} medicine(s) selected`;
  if (!selectedId && shown[0]) selectedId = shown[0].id;
  renderDetails();
  loadPhotos(shown.map(m => m.id)).then(changed => { if (changed) { renderDetailsPhoto(); $('rows').querySelectorAll('tr[data-id]').forEach(tr => { const m = byId.get(tr.dataset.id); const ph = tr.querySelector('.md-med > .md-thumb'); if (m && photoUrls.get(m.id) && ph && ph.tagName !== 'IMG') ph.outerHTML = thumb(m); }); } });
}

function renderDetails() {
  const m = byId.get(selectedId);
  document.querySelectorAll('#rows tr[data-id]').forEach(tr => tr.classList.toggle('sel', tr.dataset.id === selectedId));
  $('qaDelLabel').textContent = m && !m.active ? 'Activate' : 'Delete';
  if (!m) { $('details').innerHTML = '<p class="dl-empty">Select a medicine to see its details.</p>'; return; }
  const nb = m.nextBatch;
  $('details').innerHTML = `
    <div class="md-d-top"><div class="md-d-photo">${thumb(m, 'lg')}</div>
      <div class="md-d-name"><h3>${esc(m.name)}${m.strength && !m.name.includes(m.strength) ? ` ${esc(m.strength)}` : ''}</h3><p>${esc(m.brandLabel || m.manufacturer || 'No brand set')}</p>
        <div class="md-tags">${m.dosage_form ? `<span>${esc(m.dosage_form)}</span>` : ''}${m.category ? `<span>${esc(m.category)}</span>` : ''}${m.need_doctor_sheet ? '<span class="rx">Prescription</span>' : ''}${!m.active ? '<span class="off">Inactive</span>' : ''}</div></div></div>
    <div class="md-d-grid">
      <div>${I.barcode}<span>Barcode</span><b>${esc(m.barcode || '—')}</b></div>
      <div>${I.layers}<span>Batch No.</span><b>${esc(nb?.batch_no || '—')}</b></div>
      <div>${I.cal}<span>Expiry Date</span><b>${nb ? monthYear(nb.expiry) : '—'}</b></div>
      <div>${I.rupee}<span>MRP</span><b>${m.mrpShown == null ? '—' : `₹${money(m.mrpShown)}`}</b></div>
      <div>${I.tag}<span>Selling Price</span><b>${m.selling == null ? '—' : `₹${money(m.selling)}`}${m.disc ? ` <small>(${Number(m.disc.toFixed(2))}% off)</small>` : ''}</b></div>
      <div class="stock">${I.box}<span>Current Stock</span><b class="${m.status}">${count(m.stock)}</b></div>
    </div>
    ${m.batchCount > 1 || m.totalQty !== m.stock ? `<p class="md-d-note">${m.batchCount} batch(es) · ${count(m.totalQty)} units in store${m.totalQty !== m.stock ? ` · ${count(m.totalQty - m.stock)} not sellable (expired / blocked / quarantined)` : ''}${Number(m.reorder_level) ? ` · minimum ${count(m.reorder_level)}` : ''}</p>` : (Number(m.reorder_level) ? `<p class="md-d-note">Minimum stock ${count(m.reorder_level)}</p>` : '')}`;
  loadPhotos([m.id]).then(ch => { if (ch) renderDetailsPhoto(); });
}
function renderDetailsPhoto() {
  const m = byId.get(selectedId);
  const box = document.querySelector('.md-d-photo');
  if (m && box) box.innerHTML = thumb(m, 'lg');
}

function notify() {
  const act = list.filter(m => m.active);
  const low = act.filter(m => m.status === 'low'), out = act.filter(m => m.status === 'out' && m.batchCount);
  const items = [];
  if (low.length) items.push({ tone: 'warn', title: `${low.length} medicine(s) at low stock`, detail: low.slice(0, 3).map(m => m.name).join(', '), href: 'medicines.html' });
  if (out.length) items.push({ tone: 'danger', title: `${out.length} medicine(s) out of sellable stock`, detail: out.slice(0, 3).map(m => m.name).join(', '), href: 'medicines.html' });
  if (reqPending) items.push({ tone: 'info', title: `${reqPending} deactivation request(s) waiting`, detail: 'Review them below the medicine list', href: 'medicines.html' });
  setNotifications(items);
}

// ---------------------------------------------------------------- add / edit form (existing rules kept)
function fillSelect(sel, rows, value, label) {
  sel.innerHTML = `<option value="">— ${label} —</option>` + rows.map(r => `<option value="${esc(r.id)}" ${r.id === value ? 'selected' : ''}>${esc(r.name)}</option>`).join('') + (canMaster ? `<option value="__new">＋ Add new ${label.toLowerCase()}…</option>` : '');
}
function open(m = {}, { duplicate = false } = {}) {
  $('dt').textContent = duplicate ? `Duplicate ${m.name}` : m.id ? 'Edit medicine' : 'Add medicine';
  $('err').textContent = '';
  $('activeNote').textContent = '';
  f.reset();
  for (const k of ['id', 'name', 'ingredients', 'brand', 'generic_name', 'composition', 'strength', 'rack', 'dosage_form', 'barcode', 'reorder_level']) {
    f[k].value = m[k] ?? '';
  }
  if (duplicate) { f.id.value = ''; f.name.value = `${m.name} (copy)`; f.barcode.value = ''; }
  if (!Number(m.reorder_level)) f.reorder_level.value = '';
  f.tax_rate.value = String(m.id || duplicate ? Number(m.tax_rate ?? 0) : 0);
  f.discount_text.value = discText(m);
  fillSelect($('fMan'), lk.manufacturers, m.manufacturer_id, 'Manufacturer');
  fillSelect($('fCatSel'), lk.categories, m.category_id, 'Category');
  f.need_doctor_sheet.checked = Boolean(m.need_doctor_sheet);
  f.active.checked = duplicate ? true : (m.active ?? true);
  // New medicines: any permitted role picks the initial status. Existing: Super Admin only.
  f.active.disabled = Boolean(f.id.value) && !isSuperAdmin;
  if (!isSuperAdmin) {
    $('activeNote').textContent = f.id.value
      ? 'Changing medicine activation status requires Super Admin approval.'
      : 'You may choose the initial status. Later activation or deactivation requires Super Admin approval.';
  }
  $('dlg').showModal();
  f.name.focus();
}
async function addMaster(table, sel, label) {
  const name = prompt(`New ${label.toLowerCase()} name`);
  if (!name?.trim()) { sel.value = ''; return; }
  const { data, error } = await sb.from(table).insert({ name: name.trim() }).select('id,name,active').single();
  if (error) { $('err').textContent = friendly(error); sel.value = ''; return; }
  lk[table].push(data);
  lk[table].sort((a, b) => a.name.localeCompare(b.name));
  fillSelect(sel, lk[table], data.id, label);
}
$('fMan').onchange = e => { if (e.target.value === '__new') addMaster('manufacturers', e.target, 'Manufacturer'); };
$('fCatSel').onchange = e => { if (e.target.value === '__new') addMaster('categories', e.target, 'Category'); };

f.onsubmit = async e => {
  e.preventDefault();
  $('err').textContent = '';
  const d = Object.fromEntries(new FormData(f));
  const id = d.id;
  delete d.id;
  const row = { ...Object.fromEntries(Object.entries(d).map(([k, x]) => [k, nul(x.trim?.() ?? x)])), active: f.active.checked };
  if (row.manufacturer_id === '__new') row.manufacturer_id = null;
  if (row.category_id === '__new') row.category_id = null;
  row.need_doctor_sheet = f.need_doctor_sheet.checked;
  // Discount is optional: "10%" = percentage, "5" = ₹ off each unit; empty = none.
  delete row.discount_text;
  const dsc = parseDiscount(f.discount_text.value);
  if (dsc.error) { $('err').textContent = dsc.error; return; }
  row.discount_percentage = dsc.pct; row.discount_amount = dsc.amt;
  if (!discountColumnAvailable) delete row.discount_percentage;
  if (!('discount_amount' in (list[0] || { discount_amount: 1 }))) { if (dsc.amt) { $('err').textContent = 'A ₹ discount needs database migration 0037. Use a percentage for now.'; return; } delete row.discount_amount; }
  row.price_includes_tax = true;   // MRP already includes GST; billing never adds GST on top
  // MRP / selling price stay as they were (MRP comes from purchase batches).
  const old = id ? list.find(x => x.id === id) : null;
  row.mrp = old?.mrp ?? 0;
  row.selling_price = old?.selling_price ?? 0;
  row.tax_rate = Number(row.tax_rate === null || row.tax_rate === undefined || row.tax_rate === '' ? 0 : row.tax_rate);
  if (row.tax_rate < 0 || row.tax_rate > 100) { $('err').textContent = 'GST must be from 0 to 100%.'; return; }
  row.reorder_level = Number(row.reorder_level || 0);
  for (const k of ['mrp', 'selling_price', 'tax_rate', 'reorder_level']) row[k] = Number(row[k] || 0);
  if (!Number.isFinite(row.tax_rate) || !Number.isFinite(row.reorder_level) || row.reorder_level < 0) { $('err').textContent = 'Please enter valid numeric values.'; return; }
  if (row.selling_price > row.mrp) { $('err').textContent = 'Selling price cannot exceed MRP.'; return; }
  if (row.barcode) {
    const clash = list.find(x => x.barcode === row.barcode && x.id !== id);
    if (clash) { $('err').textContent = `Barcode ${row.barcode} is already used by ${clash.name}.`; return; }
  }
  // Keep the single Rack / Shelf field consistent with billing and stock views.
  row.shelf_location = row.rack || null;

  let result;
  if (id) {
    delete row.branch_id;
    if (!isSuperAdmin) {
      if (!old) { $('err').textContent = 'Medicine not found. Refresh and try again.'; return; }
      row.active = old.active;
    }
    result = await sb.from('medicines').update(row).eq('id', id).eq('branch_id', branchId);
  } else {
    row.branch_id = branchId;
    row.active = f.active.checked;
    result = await sb.from('medicines').insert(row);
  }
  if (result.error) { $('err').textContent = friendly(result.error); console.error('Medicine save failed:', result.error); return; }
  $('dlg').close();
  toast(id ? 'Medicine updated.' : `${row.name} added.`);
  await load();
  if (!id) {
    const added = list.find(x => x.name === row.name);
    if (added) { selectedId = added.id; $('q').value = ''; render(); }
  }
};
$('cancelBottom').onclick = $('cancel').onclick = () => $('dlg').close();

// ---------------------------------------------------------------- dialogs used by actions
const mdDlg = html => { $('mdBody').innerHTML = html; if (!$('mdDlg').open) $('mdDlg').showModal(); };
$('mdDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('mdDlg')) $('mdDlg').close(); });

async function costHistory(m) {
  if (!isAdmin) return toast('Purchase cost history is visible to administrators only.', true);
  const { data, error } = await sb.rpc('purchase_history', { p_medicine: m.id });
  $('phb').innerHTML = error ? esc(friendly(error)) : `<h3>Purchase history — ${esc(m.name)}</h3>
    <p class="dl-muted">Current cost per base unit: <b>${data?.[0] ? inr(data[0].current_cost) : '—'}</b> (admin only)</p>
    <div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Date</th><th>Invoice</th><th>Distributor</th><th>Batch</th><th class="c-r">Qty</th><th class="c-r">Price</th><th class="c-r">Tax</th></tr></thead><tbody>
    ${(data || []).map(r => `<tr><td>${esc(r.invoice_date)}</td><td>${esc(r.supplier_invoice_no)}</td><td>${esc(r.distributor)}</td><td>${esc(r.batch_no)}</td><td class="c-r">${r.qty}</td><td class="c-r">${inr(r.unit_price)}</td><td class="c-r">${r.tax_rate}%</td></tr>`).join('') || '<tr><td colspan="7" class="dl-empty">No purchases yet.</td></tr>'}</tbody></table></div>`;
  $('ph').showModal();
}

async function viewHistory(m) {
  mdDlg(`<h3>History — ${esc(m.name)}</h3><div class="dl-tabs dl-pills md-htabs" id="hTabs"><button type="button" data-h="moves" class="on">Stock movements</button>${isAdmin ? '<button type="button" data-h="cost">Purchase cost</button>' : ''}</div><div id="hBody"><p class="dl-empty">Loading…</p></div>`);
  const showMoves = async () => {
    const { data, error } = await sb.from('stock_movements').select('created_at,movement_type,qty,reason,medicine_batches(batch_no)').eq('medicine_id', m.id).order('created_at', { ascending: false }).limit(200);
    $('hBody').innerHTML = error ? `<p class="pos-form-msg">${esc(friendly(error))}</p>` : `<div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>When</th><th>Batch</th><th>Type</th><th class="c-r">Qty</th><th>Reason</th></tr></thead><tbody>
      ${(data || []).map(r => `<tr><td>${esc(new Date(r.created_at).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td><td>${esc(r.medicine_batches?.batch_no || '—')}</td><td>${esc(String(r.movement_type || '').replace(/_/g, ' '))}</td><td class="c-r" style="color:${r.qty < 0 ? '#c4291f' : '#0f7a16'}">${r.qty > 0 ? '+' : ''}${r.qty}</td><td>${esc(r.reason || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="dl-empty">No stock movements yet.</td></tr>'}</tbody></table></div>`;
  };
  const showCost = async () => {
    const { data, error } = await sb.rpc('purchase_history', { p_medicine: m.id });
    $('hBody').innerHTML = error ? `<p class="pos-form-msg">${esc(friendly(error))}</p>` : `<p class="dl-muted">Current cost per base unit: <b>${data?.[0] ? inr(data[0].current_cost) : '—'}</b></p><div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Date</th><th>Invoice</th><th>Distributor</th><th>Batch</th><th class="c-r">Qty</th><th class="c-r">Price</th><th class="c-r">Tax</th></tr></thead><tbody>
      ${(data || []).map(r => `<tr><td>${esc(r.invoice_date)}</td><td>${esc(r.supplier_invoice_no)}</td><td>${esc(r.distributor)}</td><td>${esc(r.batch_no)}</td><td class="c-r">${r.qty}</td><td class="c-r">${inr(r.unit_price)}</td><td class="c-r">${r.tax_rate}%</td></tr>`).join('') || '<tr><td colspan="7" class="dl-empty">No purchases yet.</td></tr>'}</tbody></table></div>`;
  };
  $('hTabs').onclick = e => { const b = e.target.closest('[data-h]'); if (!b) return; $('hTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('hBody').innerHTML = '<p class="dl-empty">Loading…</p>'; (b.dataset.h === 'cost' ? showCost : showMoves)(); };
  await showMoves();
}

async function updateStock(m) {
  const { data: bs, error } = await sb.from('medicine_batches').select('id,batch_no,expiry,qty,quarantined,stock_status,mrp').eq('branch_id', branchId).eq('medicine_id', m.id).order('expiry');
  const state = b => b.expiry <= today ? ['Expired', 'out'] : b.quarantined ? ['Quarantined', 'low'] : (b.stock_status || 'active') !== 'active' ? [String(b.stock_status).replace(/^./, c => c.toUpperCase()), 'out'] : Number(b.qty) > 0 ? ['Sellable', 'in'] : ['Empty', 'off'];
  mdDlg(`<h3>Update stock — ${esc(m.name)}</h3>
    <p class="dl-muted">Sellable stock: <b>${count(m.stock)}</b>. New stock is added through a purchase bill (or Inventory → Opening stock). Use Adjust to correct a batch after a count, damage or expiry.</p>
    ${error ? `<p class="pos-form-msg">${esc(friendly(error))}</p>` : `<div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Batch</th><th>Expiry</th><th class="c-r">MRP</th><th class="c-r">Qty</th><th>Status</th>${canAdjust ? '<th></th>' : ''}</tr></thead><tbody>
      ${(bs || []).map(b => { const [l, c] = state(b); return `<tr><td><b>${esc(b.batch_no)}</b></td><td>${esc(monthYear(b.expiry))}</td><td class="c-r">${b.mrp == null ? '—' : money(b.mrp)}</td><td class="c-r">${count(b.qty)}</td><td><span class="md-chip ${c}"><i></i>${l}</span></td>${canAdjust ? `<td><button type="button" class="pos-btn pos-btn-sm" data-adj="${esc(b.id)}" data-bn="${esc(b.batch_no)}" data-q="${esc(b.qty)}">Adjust</button></td>` : ''}</tr>`; }).join('') || `<tr><td colspan="6" class="dl-empty">No batches yet.</td></tr>`}</tbody></table></div>`}
    <form id="adjForm" class="md-adj" hidden>
      <h4 id="adjTitle"></h4>
      <div class="md-form-grid">
        <div class="pos-field"><label for="adjKind">Change</label><select id="adjKind"><option value="adjustment+">Increase (stock found)</option><option value="adjustment-">Decrease (correction)</option><option value="damage-">Damaged</option><option value="expiry_writeoff-">Expired write-off</option></select></div>
        <div class="pos-field"><label for="adjQty">Quantity</label><input id="adjQty" type="number" min="0.001" step="any" required></div>
        <div class="pos-field md-span-2"><label for="adjReason">Reason *</label><input id="adjReason" required maxlength="300" placeholder="e.g. monthly count, broken strip"></div>
      </div>
      <p class="pos-form-msg" id="adjMsg"></p>
      <div class="pos-dialog-foot"><button type="button" class="pos-btn" id="adjCancel">Cancel</button><button type="submit" class="pos-btn pos-btn-solid">Save adjustment</button></div>
    </form>
    <div class="pos-dialog-foot md-foot-left">${can('purchases') ? '<a class="pos-btn pos-btn-solid" href="purchases.html?new=1">＋ New purchase bill</a>' : ''}<a class="pos-btn" href="inventory.html">Open Inventory</a></div>`);
  let cur = null;
  $('mdBody').querySelectorAll('[data-adj]').forEach(b => b.onclick = () => {
    cur = b.dataset.adj;
    $('adjTitle').textContent = `Adjust batch ${b.dataset.bn} (now ${b.dataset.q})`;
    $('adjForm').hidden = false; $('adjMsg').textContent = ''; $('adjForm').reset(); $('adjQty').focus();
  });
  if (!$('adjForm')) return;
  $('adjCancel').onclick = () => { $('adjForm').hidden = true; };
  $('adjForm').onsubmit = async e => {
    e.preventDefault();
    const k = $('adjKind').value, sign = k.endsWith('+') ? 1 : -1, type = k.slice(0, -1);
    const { error: aerr } = await sb.rpc('adjust_stock', { p_batch: cur, p_delta: sign * Number($('adjQty').value), p_type: type, p_reason: $('adjReason').value.trim() });
    if (aerr) { $('adjMsg').textContent = friendly(aerr); return; }
    toast('Stock updated.');
    await load();
    updateStock(byId.get(m.id) || m);
  };
}
const can = page => ({ purchases: ['super_admin', 'admin', 'admin_staff'] })[page]?.includes(prof.role);

// ---- Code 128-B barcode (for printed shelf labels)
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
function code128Svg(text, h = 46) {
  const vals = [...String(text)].map(c => c.charCodeAt(0) - 32).filter(x => x >= 0 && x < 95);
  if (!vals.length) return '';
  let sum = 104; vals.forEach((x, i) => { sum += x * (i + 1); });
  const codes = [104, ...vals, sum % 103, 106];
  let x = 10, bars = '';
  for (const c of codes) [...C128[c]].forEach((w, i) => { const wd = Number(w) * 1.6; if (i % 2 === 0) bars += `<rect x="${x.toFixed(1)}" y="0" width="${wd.toFixed(1)}" height="${h}"/>`; x += wd; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(x + 10).toFixed(1)} ${h}" width="${((x + 10) / 1.6).toFixed(0)}" height="${h}" fill="#000">${bars}</svg>`;
}
function printLabel(m) {
  mdDlg(`<h3>Print label — ${esc(m.name)}</h3>
    <div class="md-form-grid"><div class="pos-field"><label for="lbCount">Number of labels</label><input id="lbCount" type="number" min="1" max="200" value="1"></div>
    <div class="pos-field"><label for="lbSize">Label size</label><select id="lbSize"><option value="50x25">50 × 25 mm (shelf / barcode printer)</option><option value="a4">A4 sheet (3 per row)</option></select></div></div>
    ${m.barcode ? '' : '<p class="dl-warn">This medicine has no barcode yet. The label prints without one. Add it with Edit Medicine.</p>'}
    <div class="md-label-preview" id="lbPrev"></div>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="lbPrint">${I.printer}<span>Print</span></button></div>`);
  const labelHtml = () => `<div class="lbl"><b>${esc(m.name)}${m.strength && !m.name.includes(m.strength) ? ` ${esc(m.strength)}` : ''}</b><span>${esc([m.brandLabel, m.dosage_form].filter(Boolean).join(' · '))}</span><span class="mrp">MRP ₹${m.mrpShown == null ? '—' : money(m.mrpShown)}${m.rack ? ` &nbsp;·&nbsp; ${esc(m.rack)}` : ''}</span>${m.barcode ? `${code128Svg(m.barcode)}<small>${esc(m.barcode)}</small>` : ''}</div>`;
  $('lbPrev').innerHTML = labelHtml();
  $('lbPrint').onclick = () => {
    const n = Math.min(200, Math.max(1, Number($('lbCount').value) || 1));
    const a4 = $('lbSize').value === 'a4';
    const w = window.open('', '_blank', 'width=720,height=640');
    if (!w) return toast('Allow pop-ups to print labels.', true);
    w.document.write(`<!doctype html><html><head><title>Label — ${esc(m.name)}</title><style>
      @page{size:${a4 ? 'A4' : '50mm 25mm'};margin:${a4 ? '8mm' : '0'}}body{margin:0;font-family:Arial,sans-serif}
      .wrap{display:${a4 ? 'grid' : 'block'};grid-template-columns:repeat(3,1fr);gap:4mm}
      .lbl{box-sizing:border-box;width:${a4 ? 'auto' : '50mm'};height:25mm;padding:1.5mm 2mm;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;overflow:hidden;${a4 ? 'border:1px dashed #999;' : 'page-break-after:always;'}}
      .lbl b{font-size:9pt;line-height:1.1;max-height:2.2em;overflow:hidden}.lbl span{font-size:6.5pt;color:#333}.lbl .mrp{font-size:8pt;font-weight:bold;color:#000}.lbl svg{height:8mm;width:auto;max-width:46mm;margin-top:.6mm}.lbl small{font-size:6pt;letter-spacing:.5px}
    </style></head><body><div class="wrap">${Array.from({ length: n }, labelHtml).join('')}</div><script>onload=()=>{print();setTimeout(()=>close(),500)}<\/script></body></html>`);
    w.document.close();
    $('mdDlg').close();
  };
}

// Deactivation request (active) / Super Admin activation (inactive) — existing rules
async function toggleActive(m) {
  if (m.active) {
    const reason = prompt(`Why do you want to deactivate ${m.name}?\n\nMedicines are never deleted (bills and stock history need them). The medicine is deactivated after Super Admin approval.`);
    if (reason === null) return;
    if (!reason.trim()) { toast('Please enter a reason.', true); return; }
    const { data, error } = await sb.rpc('request_medicine_deactivation', { p_medicine: m.id, p_reason: reason.trim() });
    if (error) { toast(friendly(error), true); console.error('Deactivation request failed:', error); return; }
    toast(data ? 'Deactivation request submitted. The medicine remains active until Super Admin approval.' : 'Deactivation request submitted.');
    if (isSuperAdmin) await loadDeactivationRequests();
    return;
  }
  if (!isSuperAdmin) { toast('Only Super Admin can activate an inactive medicine.', true); return; }
  if (!confirm(`Activate ${m.name}?`)) return;
  const { error } = await sb.from('medicines').update({ active: true }).eq('id', m.id).eq('branch_id', branchId);
  if (error) { toast(friendly(error), true); console.error('Medicine activation failed:', error); return; }
  toast('Medicine activated.');
  await load();
}

// Full medicine profile (existing view, restyled)
async function showMedicine(id) {
  const m = byId.get(id);
  if (!m) return;
  $('viewTitle').textContent = m.name;
  $('viewContent').innerHTML = '<p class="dl-empty">Loading medicine details and batch stock…</p>';
  $('viewMedicine').showModal();
  const [{ data: batches, error: batchError }, { data: photos }] = await Promise.all([
    sb.from('medicine_batches').select('id,batch_no,expiry,qty,quarantined,stock_status').eq('branch_id', branchId).eq('medicine_id', id).order('expiry'),
    sb.from('medicine_images').select('path,is_primary,sort_order').eq('branch_id', branchId).eq('medicine_id', id).order('is_primary', { ascending: false }).order('sort_order')
  ]);
  let photoUrl = '';
  const primary = (photos || [])[0];
  if (primary?.path) { const { data } = await sb.storage.from('medicine-images').createSignedUrl(primary.path, 300); photoUrl = data?.signedUrl || ''; }
  const stock = (batches || []).reduce((sum, b) => sum + Number(b.qty || 0), 0);
  const kv = (l, val, cls = '') => `<div class="${cls}"><small>${l}</small><b>${val}</b></div>`;
  $('viewContent').innerHTML = `
    <div class="md-profile"><div class="md-profile-photo">${photoUrl && /^(https?:|blob:)/.test(photoUrl) ? `<img class="md-thumb xl" src="${esc(photoUrl)}" alt="${esc(m.name)}">` : thumbPh(m.name, 'xl')}<button type="button" class="pos-btn pos-btn-sm" data-photos="${esc(m.id)}">${I.camera}<span>Manage photos</span></button></div>
    <div class="delivery-detail-grid dl-detail-grid md-kv">
      ${kv('Medicine name', esc(m.name))}${kv('Brand', esc(m.brand || '—'))}
      ${kv('Generic name', esc(m.generic_name || '—'))}${kv('Strength', esc(m.strength || '—'))}
      ${kv('Manufacturer', esc(m.manufacturer || '—'))}${kv('Category', esc(m.category || '—'))}
      ${kv('Dosage form', esc(m.dosage_form || '—'))}${kv('Barcode', esc(m.barcode || '—'))}
      ${kv('Discount', discText(m) ? (discText(m).startsWith('₹') ? `${discText(m)} off each unit` : discText(m)) : '—')}${kv('GST (default)', `${Number(m.tax_rate ?? 0)}%`)}
      ${kv('Composition', esc(m.composition || '—'), 'wide')}
      ${kv('Rack / Shelf', esc(m.rack || '—'))}${kv('Minimum stock', count(m.reorder_level))}
      <div class="wide"><small>Ingredients</small><div class="med-ingredient-profile-row"><b>${esc(m.ingredients || '—')}</b><button type="button" class="pos-btn pos-btn-sm" data-search-ingredients="${esc(m.id)}" ${m.ingredients ? '' : 'disabled'}>Search Google ↗</button></div></div>
      ${kv('Doctor sheet required', m.need_doctor_sheet ? 'Yes' : 'No')}${kv('Status', m.active ? 'Active' : 'Inactive')}
      ${kv('Current total stock', count(stock))}${kv('Sellable stock', count(m.stock))}
    </div></div>
    <h4>Current batch stock</h4>${batchError ? `<p class="pos-form-msg">${esc(friendly(batchError))}</p>` : `<div class="dl-table-wrap"><table class="dl-table md-plain med-stock"><thead><tr><th>Batch number</th><th>Expiry date</th><th class="c-r">Current stock</th><th>Status</th></tr></thead><tbody>${(batches || []).map(b => `<tr><td>${esc(b.batch_no)}</td><td>${esc(b.expiry)}</td><td class="c-r">${Number(b.qty).toLocaleString('en-IN')}</td><td>${b.quarantined ? 'Quarantined' : (b.stock_status || 'active') !== 'active' ? esc(b.stock_status) : b.expiry <= today ? 'Expired' : Number(b.qty) > 0 ? 'Available' : 'Out of stock'}</td></tr>`).join('') || '<tr><td colspan="4" class="dl-empty">No purchase batches recorded yet.</td></tr>'}</tbody></table></div>`}`;
  $('viewContent').querySelector('[data-photos]')?.addEventListener('click', () => $('viewMedicine').close());
  $('viewContent').querySelector('[data-search-ingredients]')?.addEventListener('click', () => {
    const ingredients = (m.ingredients || '').trim();
    if (!ingredients) return;
    const query = `medicines and other brands containing ${ingredients} alternatives`;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
  });
}
$('viewClose').onclick = () => $('viewMedicine').close();
$('detailsOpen').onclick = () => { if (selectedId) showMedicine(selectedId); };

// ---------------------------------------------------------------- row menu + quick actions
let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }
function openMenu(btn, m) {
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'dl-pop md-menu md-row-menu';
  menuEl.innerHTML = `
    <button type="button" data-act="view">${I.eye}<span>View details</span></button>
    <button type="button" data-act="edit">${I.pencil}<span>Edit</span></button>
    <button type="button" data-act="stock">${I.box}<span>Update stock</span></button>
    <button type="button" data-act="history">${I.history}<span>View history</span></button>
    <button type="button" data-photos="${esc(m.id)}">${I.camera}<span>Photos</span></button>
    ${isAdmin ? `<button type="button" data-act="cost">${I.rupee}<span>Cost history</span></button>` : ''}
    <button type="button" data-act="duplicate">${I.copy}<span>Duplicate</span></button>
    <button type="button" data-act="label">${I.printer}<span>Print label</span></button>
    ${m.active ? `<button type="button" data-act="toggle" class="danger">${I.trash}<span>Request deactivation</span></button>` : isSuperAdmin ? `<button type="button" data-act="toggle">${I.check}<span>Activate</span></button>` : ''}`;
  btn.parentElement.append(menuEl);
  menuEl.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.photos) { setTimeout(closeMenu, 0); return; }   // handled by medicine-photos.js
    closeMenu();
    runAction(b.dataset.act, m);
  };
}
function runAction(act, m) {
  if (!m) return toast('Select a medicine first.', true);
  if (act === 'view') return showMedicine(m.id);
  if (act === 'edit') return open(m);
  if (act === 'stock') return updateStock(m);
  if (act === 'history') return viewHistory(m);
  if (act === 'cost') return costHistory(m);
  if (act === 'duplicate') return open(m, { duplicate: true });
  if (act === 'label') return printLabel(m);
  if (act === 'toggle' || act === 'delete') return toggleActive(m);
}
$('rows').addEventListener('click', e => {
  const menuBtn = e.target.closest('[data-menu]');
  if (menuBtn) { e.stopPropagation(); const m = byId.get(menuBtn.dataset.menu); if (menuEl && menuEl.parentElement === menuBtn.parentElement) closeMenu(); else openMenu(menuBtn, m); return; }
  if (e.target.closest('.md-row-menu')) return;
  const pick = e.target.closest('[data-pick]');
  if (pick) { e.stopPropagation(); if (pick.checked) picked.add(pick.dataset.pick); else picked.delete(pick.dataset.pick); $('selBar').hidden = !picked.size; $('selText').textContent = `${picked.size} medicine(s) selected`; return; }
  if (e.target.closest('.md-check')) return;
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  selectedId = tr.dataset.id;
  renderDetails();
  if (matchMedia('(max-width: 1240px)').matches) $('detailsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
$('qa').onclick = e => { const b = e.target.closest('[data-qa]'); if (b) runAction(b.dataset.qa, byId.get(selectedId)); };

// ---------------------------------------------------------------- filters / paging
let qt;
$('q').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { page = 1; selectedId = null; render(); }, 200); };
['fCat', 'fBrand', 'fStock', 'perPage'].forEach(id => $(id).onchange = () => { page = 1; selectedId = null; render(); });
$('inact').onchange = () => { page = 1; render(); };
$('resetBtn').onclick = () => { $('q').value = ''; $('fCat').value = $('fBrand').value = $('fStock').value = ''; $('inact').checked = false; page = 1; selectedId = null; render(); };
$('pager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); selectedId = null; render(); $('rows').closest('.md-list').scrollIntoView({ block: 'start' }); } };
$('selAll').onchange = e => { const per = Number($('perPage').value); filtered().slice((page - 1) * per, page * per).forEach(m => e.target.checked ? picked.add(m.id) : picked.delete(m.id)); render(); };
$('selClear').onclick = () => { picked.clear(); render(); };
document.querySelector('.md-kpis').onclick = e => {
  const b = e.target.closest('[data-kpi]'); if (!b) return;
  $('fStock').value = { kTotal: '', kIn: 'in', kLow: 'low', kOut: 'out' }[b.dataset.kpi];
  page = 1; selectedId = null; render();
  $('rows').closest('.md-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
$('mSearch').onclick = () => { document.querySelector('.md-search').classList.toggle('open'); $('q').focus(); };

// ---------------------------------------------------------------- export
$('exportBtn').onclick = () => {
  const rows = filtered().map(m => ({
    'Medicine name': m.name, Strength: m.strength || '', 'Dosage form': m.dosage_form || '', Brand: m.brand || '', Manufacturer: m.manufacturer || '',
    'Generic name': m.generic_name || '', Category: m.category || '', Barcode: m.barcode || '', 'Rack / Shelf': m.rack || '',
    'MRP (₹)': m.mrpShown ?? '', 'Selling price (₹)': m.selling ?? '', 'Discount (% or ₹)': discText(m), 'GST (%)': Number(m.tax_rate ?? 0),
    'Sellable stock': m.stock, 'Total stock': m.totalQty, 'Minimum stock': Number(m.reorder_level || 0),
    Status: CHIP[m.status][0], 'Next batch': m.nextBatch?.batch_no || '', 'Next expiry': m.nextBatch?.expiry || '',
    'Need doctor sheet': m.need_doctor_sheet ? 'Yes' : 'No', Active: m.active ? 'Yes' : 'No', Ingredients: m.ingredients || '', Composition: m.composition || ''
  }));
  if (!rows.length) return toast('Nothing to export with these filters.', true);
  const stamp = today;
  if (window.XLSX) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Medicines');
    XLSX.writeFile(wb, `Pallikkal_Medicines_${stamp}.xlsx`);
  } else {
    const keys = Object.keys(rows[0]);
    const csv = [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `Pallikkal_Medicines_${stamp}.csv`; a.click();
  }
  toast(`${rows.length} medicine(s) exported.`);
};

// ---------------------------------------------------------------- bulk update
function bulkUpdate() {
  if (!canWrite) return toast('Your role cannot change medicines in bulk.', true);
  const all = filtered();
  const sel = [...picked].filter(id => byId.has(id));
  mdDlg(`<h3>Bulk update</h3>
    <div class="md-scope"><label class="dl-check"><input type="radio" name="bScope" value="sel" ${sel.length ? 'checked' : 'disabled'}> Selected medicines (${sel.length})</label>
      <label class="dl-check"><input type="radio" name="bScope" value="all" ${sel.length ? '' : 'checked'}> All medicines in the current list (${all.length})</label></div>
    <p class="dl-muted">Fill only the fields you want to change. Empty fields are left as they are.</p>
    <div class="md-form-grid">
      <div class="pos-field"><label for="bCat">Category</label><select id="bCat"><option value="">No change</option>${lk.categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}<option value="__clear">Clear category</option></select></div>
      <div class="pos-field"><label for="bMan">Manufacturer</label><select id="bMan"><option value="">No change</option>${lk.manufacturers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="pos-field"><label for="bDisc">Discount <small>10% or ₹ 5</small></label><input id="bDisc" maxlength="12" placeholder="No change"></div>
      <div class="pos-field"><label for="bMin">Minimum stock</label><input id="bMin" type="number" min="0" step="1" placeholder="No change"></div>
      <div class="pos-field"><label for="bGst">GST %</label><input id="bGst" type="number" min="0" max="100" step="0.01" placeholder="No change"></div>
      <div class="pos-field"><label for="bRack">Rack / Shelf</label><input id="bRack" maxlength="60" placeholder="No change"></div>
      <div class="pos-field"><label for="bForm">Dosage form</label><input id="bForm" list="formList" placeholder="No change"></div>
      <div class="pos-field"><label for="bRx">Doctor sheet</label><select id="bRx"><option value="">No change</option><option value="1">Required</option><option value="0">Not required</option></select></div>
    </div>
    <p class="pos-form-msg" id="bMsg"></p>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="bSave">Apply changes</button></div>`);
  $('bSave').onclick = async () => {
    const patch = {};
    if ($('bCat').value) patch.category_id = $('bCat').value === '__clear' ? null : $('bCat').value;
    if ($('bMan').value) patch.manufacturer_id = $('bMan').value;
    if ($('bDisc').value.trim() !== '') { const d = parseDiscount($('bDisc').value); if (d.error) return ($('bMsg').textContent = d.error); if (discountColumnAvailable) patch.discount_percentage = d.pct; patch.discount_amount = d.amt; }
    if ($('bMin').value !== '') { const n = Number($('bMin').value); if (!(n >= 0)) return ($('bMsg').textContent = 'Minimum stock must be 0 or more.'); patch.reorder_level = n; }
    if ($('bGst').value !== '') { const g = Number($('bGst').value); if (!(g >= 0 && g <= 100)) return ($('bMsg').textContent = 'GST must be from 0 to 100%.'); patch.tax_rate = g; }
    if ($('bRack').value.trim()) { patch.rack = $('bRack').value.trim(); patch.shelf_location = patch.rack; }
    if ($('bForm').value.trim()) patch.dosage_form = $('bForm').value.trim();
    if ($('bRx').value) patch.need_doctor_sheet = $('bRx').value === '1';
    if (!Object.keys(patch).length) return ($('bMsg').textContent = 'Choose at least one field to change.');
    const scope = document.querySelector('input[name="bScope"]:checked')?.value;
    const ids = scope === 'sel' ? sel : all.map(m => m.id);
    if (!ids.length) return ($('bMsg').textContent = 'No medicines to update.');
    if (!confirm(`Update ${ids.length} medicine(s)?`)) return;
    $('bSave').disabled = true;
    let done = 0, failed = '';
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await sb.from('medicines').update(patch).eq('branch_id', branchId).in('id', chunk);
      if (error) { failed = friendly(error); break; }
      done += chunk.length;
      $('bSave').textContent = `Updating… ${done}/${ids.length}`;
    }
    $('bSave').disabled = false; $('bSave').textContent = 'Apply changes';
    if (failed) { $('bMsg').textContent = `${done} updated, then stopped: ${failed}`; await load(); return; }
    $('mdDlg').close();
    picked.clear();
    toast(`${done} medicine(s) updated.`);
    await load();
  };
}
$('bulkBtn')?.addEventListener('click', bulkUpdate);
$('selBulk').onclick = bulkUpdate;

// ---------------------------------------------------------------- import menu
const importMenu = $('importMenu');
$('importBtn').onclick = e => { e.stopPropagation(); importMenu.hidden = !importMenu.hidden; $('importBtn').setAttribute('aria-expanded', String(!importMenu.hidden)); };
document.addEventListener('click', e => { if (!importMenu.contains(e.target) && e.target !== $('importBtn')) importMenu.hidden = true; });

// --------------------------------------------------
// BULK MEDICINE IMPORT (Excel .xlsx / .xls) — unchanged rules
// --------------------------------------------------
// Every field of the Add medicine form is a column (only Medicine name is required).
const BULK_HEADERS = ['Medicine name', 'Strength', 'Dosage form', 'Brand', 'Generic name', 'Manufacturer', 'Category', 'Ingredients', 'Composition', 'Barcode', 'Rack / Shelf', 'Discount (10% or ₹)', 'Minimum stock', 'GST (%)', 'Need doctor sheet', 'Active'];
function parseExcelBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const val = String(value).trim().toLowerCase();
  return ['yes', 'y', 'true', '1', 'required', 'active'].includes(val);
}
function excelCell(row, names) {
  for (const name of names) if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  return '';
}
$('downloadTemplate').onclick = () => {
  importMenu.hidden = true;
  if (!window.XLSX) { toast('Excel support could not load. Refresh the page and try again.', true); return; }
  const samples = [
    { 'Medicine name': 'Paracetamol 500 mg', Strength: '500 mg', 'Dosage form': 'Tablet', Brand: 'Calpol', 'Generic name': 'Paracetamol', Manufacturer: 'GSK', Category: 'Tablets', Ingredients: 'Paracetamol', Composition: 'Each tablet contains Paracetamol IP 500 mg', Barcode: '8901234567890', 'Rack / Shelf': 'A-01', 'Discount (10% or ₹)': '10%', 'Minimum stock': 50, 'GST (%)': 12, 'Need doctor sheet': 'No', Active: 'Yes' },
    { 'Medicine name': 'Amoxicillin 500 mg', Strength: '500 mg', 'Dosage form': 'Capsule', Brand: '', 'Generic name': 'Amoxicillin', Manufacturer: '', Category: '', Ingredients: '', Composition: '', Barcode: '', 'Rack / Shelf': 'B-02', 'Discount (10% or ₹)': '2', 'Minimum stock': '', 'GST (%)': '', 'Need doctor sheet': 'Yes', Active: 'Yes' }];
  const ws = XLSX.utils.json_to_sheet(samples, { header: BULK_HEADERS });
  ws['!cols'] = BULK_HEADERS.map(h => ({ wch: { 'Medicine name': 28, Ingredients: 30, Composition: 40, 'Generic name': 20, Barcode: 16 }[h] || Math.max(12, h.length + 2) }));
  ws['!autofilter'] = { ref: `A1:${String.fromCharCode(64 + BULK_HEADERS.length)}3` };
  const help = XLSX.utils.aoa_to_sheet([['Column', 'What to enter'], ['Medicine name', 'Required. Must be new (existing names are skipped).'], ['Discount (10% or ₹)', '10% = percentage off; 5 = ₹5 off each unit; empty = no discount'], ['GST (%)', 'Optional (0 if empty). Billing uses the GST of the purchase / opening stock batch.'], ['Manufacturer, Category', 'Names; new ones are created'], ['Minimum stock', 'Low-stock alert level (units)'], ['Need doctor sheet, Active', 'Yes or No'], ['MRP / stock', 'Not here — they come from Purchases or Inventory → Opening stock']]);
  help['!cols'] = [{ wch: 26 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Medicines');
  XLSX.utils.book_append_sheet(wb, help, 'How to fill');
  XLSX.writeFile(wb, 'PALLIKKAL_Medicine_Bulk_Upload_Template.xlsx');
};
async function masterId(table, name) {
  const n = String(name || '').trim(); if (!n) return null;
  const hit = lk[table].find(x => x.name.toLowerCase() === n.toLowerCase()); if (hit) return hit.id;
  if (!canMaster) return null;
  const { data, error } = await sb.from(table).insert({ name: n }).select('id,name,active').single();
  if (error) return null;
  lk[table].push(data); return data.id;
}
$('bulkImport').onclick = () => { importMenu.hidden = true; $('bulkFile').click(); };
$('bulkFile').onchange = async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const report = $('bulkReport');
  report.hidden = false;
  report.textContent = 'Reading Excel file…';
  if (!window.XLSX) { report.textContent = 'Excel support could not load. Check your internet connection, refresh the page, and try again.'; return; }
  if (!/\.(xlsx|xls)$/i.test(file.name)) { report.textContent = 'Please select an Excel .xlsx or .xls file.'; return; }
  try {
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error('The workbook does not contain a worksheet.');
    const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
    if (!rawRows.length) throw new Error('The worksheet has no medicine rows.');
    const normalizedRows = rawRows.map((raw, index) => {
      const row = {};
      for (const [key, value] of Object.entries(raw)) row[String(key).trim().toLowerCase()] = value;
      const name = excelCell(row, ['medicine name', 'name', 'medicine']);
      return {
        excelRow: index + 2,
        name: String(name ?? '').trim(),
        ingredients: String(excelCell(row, ['ingredients', 'ingredient']) ?? '').trim(),
        brand: String(excelCell(row, ['brand']) ?? '').trim(),
        generic_name: String(excelCell(row, ['generic name', 'generic_name', 'generic']) ?? '').trim(),
        composition: String(excelCell(row, ['composition']) ?? '').trim(),
        strength: String(excelCell(row, ['strength']) ?? '').trim(),
        rack: String(excelCell(row, ['rack / shelf', 'rack/shelf', 'rack', 'shelf']) ?? '').trim(),
        discount_text: String(excelCell(row, ['discount (10% or ₹)', 'discount (%)', 'discount', 'discount percentage', 'discount_percentage']) ?? '').trim(),
        dosage_form: String(excelCell(row, ['dosage form', 'dosage_form', 'form']) ?? '').trim(),
        manufacturer: String(excelCell(row, ['manufacturer', 'company']) ?? '').trim(),
        category: String(excelCell(row, ['category']) ?? '').trim(),
        barcode: String(excelCell(row, ['barcode']) ?? '').trim(),
        reorder_level: String(excelCell(row, ['minimum stock', 'reorder level', 'min stock']) ?? '').trim(),
        tax_rate: String(excelCell(row, ['gst (%)', 'gst', 'gst %', 'tax rate']) ?? '').trim(),
        need_doctor_sheet: parseExcelBoolean(excelCell(row, ['need doctor sheet', 'need_doctor_sheet', 'doctor sheet required']), false),
        active: parseExcelBoolean(excelCell(row, ['active', 'status']), true)
      };
    }).filter(r => r.name || r.ingredients || r.brand || r.generic_name || r.composition || r.strength || r.rack || r.barcode);
    if (!normalizedRows.length) throw new Error('No medicine entries were found. Check the Medicine name column.');
    const missingNames = normalizedRows.filter(r => !r.name);
    const candidates = normalizedRows.filter(r => r.name);
    // Prevent duplicate medicine names in this branch and within the uploaded file.
    const existingNames = new Set(list.map(m => String(m.name || '').trim().toLocaleLowerCase()));
    const seenUpload = new Set();
    const duplicates = [];
    const uniqueRows = [];
    for (const row of candidates) {
      const key = row.name.toLocaleLowerCase();
      if (existingNames.has(key) || seenUpload.has(key)) duplicates.push(row);
      else { seenUpload.add(key); uniqueRows.push(row); }
    }
    if (!uniqueRows.length) { report.textContent = `No new medicines to import. ${duplicates.length} duplicate name(s) were skipped; ${missingNames.length} row(s) had no medicine name.`; return; }
    const bad = [];
    for (const r of uniqueRows) {
      r.disc = parseDiscount(r.discount_text);
      if (r.disc.error) bad.push(`${r.excelRow} (discount)`);
      if (r.tax_rate !== '' && !(Number(r.tax_rate) >= 0 && Number(r.tax_rate) <= 100)) bad.push(`${r.excelRow} (GST)`);
      if (r.reorder_level !== '' && !(Number(r.reorder_level) >= 0)) bad.push(`${r.excelRow} (minimum stock)`);
      const clash = r.barcode && list.find(x => x.barcode === r.barcode); if (clash) bad.push(`${r.excelRow} (barcode already used by ${clash.name})`);
    }
    if (bad.length) { report.textContent = `Please fix these Excel row(s) and upload again: ${bad.join(', ')}. Discount: 10% or a ₹ amount; GST: 0–100.`; return; }
    report.textContent = 'Adding medicines…';
    const payload = [];
    for (const r of uniqueRows) payload.push({
      branch_id: branchId, name: r.name, ingredients: r.ingredients || null, brand: r.brand || null, generic_name: r.generic_name || null,
      composition: r.composition || null, strength: r.strength || null, rack: r.rack || null, shelf_location: r.rack || null,
      dosage_form: r.dosage_form || null, barcode: r.barcode || null,
      manufacturer_id: await masterId('manufacturers', r.manufacturer), category_id: await masterId('categories', r.category),
      discount_percentage: r.disc.pct, discount_amount: r.disc.amt,
      need_doctor_sheet: r.need_doctor_sheet, active: r.active, price_includes_tax: true,
      // Pricing comes from purchase batches.
      mrp: 0, selling_price: 0, tax_rate: r.tax_rate === '' ? 0 : Number(r.tax_rate), reorder_level: r.reorder_level === '' ? 0 : Number(r.reorder_level)
    });
    if (!('discount_amount' in (list[0] || { discount_amount: 1 }))) for (const item of payload) delete item.discount_amount;
    if (!discountColumnAvailable) for (const item of payload) delete item.discount_percentage;
    let inserted = 0;
    const failed = [];
    for (let i = 0; i < payload.length; i += 50) {
      const chunk = payload.slice(i, i + 50);
      const { data, error } = await sb.from('medicines').insert(chunk).select('id');
      if (error) {
        for (let j = 0; j < chunk.length; j++) {
          const { error: rowError } = await sb.from('medicines').insert(chunk[j]);
          if (rowError) failed.push(`${uniqueRows[i + j].excelRow}: ${uniqueRows[i + j].name} — ${friendly(rowError)}`);
          else inserted++;
        }
      } else inserted += (data || chunk).length;
    }
    const summary = ['Bulk import finished.', `Added: ${inserted}`, `Skipped duplicates: ${duplicates.length}`, `Rows without medicine name: ${missingNames.length}`, `Failed: ${failed.length}`];
    if (duplicates.length) summary.push(`Duplicate names: ${duplicates.map(r => r.name).join(', ')}`);
    if (failed.length) summary.push(`Failed rows:\n${failed.join('\n')}`);
    report.textContent = summary.join('\n');
    await load();
  } catch (error) {
    console.error('Medicine Excel import failed:', error);
    report.textContent = `Could not import this Excel file: ${error.message || error}`;
  }
};

$('new').onclick = () => open();

// ---------------------------------------------------------------- start
// Dashboard links: ?q=<name> pre-fills the search, ?new=1 opens Add medicine.
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('q')) $('q').value = urlParams.get('q');
if (urlParams.get('status')) $('fStock').value = urlParams.get('status');
let reqPending = 0;
await load();
if (urlParams.get('new') === '1') $('new').click();

// Branch-scoped medicine photo controls (listens for [data-photos] clicks).
mountMedicinePhotos({ sb, branchId, canManage: ['super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing', 'inventory', 'inventory_staff'].includes(prof.role) });

// --------------------------------------------------
// SUPER ADMIN: Medicine deactivation approvals (unchanged flow)
// --------------------------------------------------
async function loadDeactivationRequests() {
  if (!isSuperAdmin) return;
  const panel = $('deactivationRequests');
  if (!panel) return;
  panel.textContent = 'Loading pending requests...';
  const { data, error } = await sb.rpc('medicine_deactivation_request_list');
  if (error) { console.error('Could not load deactivation requests:', error); panel.textContent = friendly(error); $('reqCard').hidden = false; return; }
  reqPending = (data || []).length;
  $('reqCard').hidden = !reqPending;
  $('reqCount').textContent = reqPending;
  notify();
  if (!reqPending) { panel.innerHTML = '<p>No pending medicine deactivation requests.</p>'; return; }
  panel.innerHTML = `<div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Medicine</th><th>Requested by</th><th>Reason</th><th>Requested at</th><th>Action</th></tr></thead><tbody>
    ${data.map(r => `<tr><td><b>${esc(r.medicine_name)}</b><small>${esc(r.medicine_strength || '')}</small></td><td>${esc(r.requested_by_name)}<small>${esc(r.requested_by_staff_id || '')}</small></td><td>${esc(r.reason)}</td>
      <td>${r.requested_at ? new Date(r.requested_at).toLocaleString('en-IN', { timeZone: TZ }) : '—'}</td>
      <td><div class="md-req-acts"><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-approve="${r.request_id}">Approve</button><button type="button" class="pos-btn pos-btn-sm" data-reject="${r.request_id}">Reject</button></div></td></tr>`).join('')}
    </tbody></table></div><button type="button" class="pos-text-btn" id="refreshDeactivation">Refresh requests</button>`;
  panel.querySelector('#refreshDeactivation').onclick = loadDeactivationRequests;
  panel.onclick = async event => {
    const button = event.target.closest('button');
    if (!button) return;
    const requestId = button.dataset.approve || button.dataset.reject;
    if (!requestId) return;
    const approve = Boolean(button.dataset.approve);
    const note = prompt(approve ? 'Approval note (optional):' : 'Reason for rejecting this request (optional):');
    if (note === null) return;
    if (!confirm(approve ? 'Approve this request and deactivate the medicine?' : 'Reject this medicine deactivation request?')) return;
    button.disabled = true;
    button.textContent = 'Processing...';
    const { data: result, error: reviewError } = await sb.rpc('review_medicine_deactivation', { p_request: requestId, p_approve: approve, p_note: note.trim() || null });
    if (reviewError || result !== true) {
      toast(reviewError ? friendly(reviewError) : 'The request could not be processed.', true);
      await loadDeactivationRequests();
      return;
    }
    toast(approve ? 'Approved. The medicine has been deactivated.' : 'Request rejected. The medicine remains active.');
    await loadDeactivationRequests();
    await load();
  };
}
if (isSuperAdmin) await loadDeactivationRequests();
