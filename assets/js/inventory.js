// Inventory Management — Pallikkal Pharmacy design.
// Batch stock, value, movements, expiry and reorder in one place. Every change
// goes through the existing stock RPCs (adjust_stock, physical_count,
// set_quarantine, set_batch_stock_status, opening stock) or stock_transfer (0023).
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly } from './ui.js';
import { mountInitialStock } from './initial-stock.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('inventory', 'Inventory', { layout: 'brand' });
const $ = id => document.getElementById(id);
const admin = ['super_admin', 'admin'].includes(prof.role);
// Roles the database lets adjust stock, quarantine or change batch status.
const canAdjust = ['super_admin', 'admin', 'pharmacist', 'inventory_staff', 'inventory'].includes(prof.role);
const canPurchase = ['super_admin', 'admin', 'pharmacist', 'inventory_staff', 'inventory'].includes(prof.role);
const branchId = prof.branch_id;
// stock_movements RLS lets these roles read movements; others would see an empty list.
const canMoves = ['super_admin', 'admin', 'pharmacist', 'inventory_staff', 'inventory'].includes(prof.role);
const STATUS_LABEL = { blocked: 'Blocked', recalled: 'Recalled', damaged: 'Damaged' };
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

// ---------------------------------------------------------------- helpers
const TZ = 'Asia/Kolkata';
const istDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const today = istDay(new Date());
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const daysTo = d => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5);
const count = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(n) || 0);
const money = v => v == null ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupees0 = v => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const monthYear = d => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const dayMonth = d => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const when = v => new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  box: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>', 1.8),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  swap: svg('<path d="M4 8h14l-3-3M20 16H6l3 3"/>', 2),
  truck: svg('<path d="M2 6h11v10H2z"/><path d="M13 9h4.5l3.5 3.5V16h-8"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  db: svg('<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/><path d="M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/>', 1.8),
  cubes: svg('<path d="m12 3 4 2.3v4.6L12 12 8 9.9V5.3Z"/><path d="m8 12 4 2.3v4.4L8 21l-4-2.3v-4.4Z"/><path d="m16 12 4 2.3v4.4L16 21l-4-2.3"/>', 1.7),
  cube: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>', 1.6),
  warn: svg('<path d="M10.3 3.9 1.8 18.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 1.8),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  filter: svg('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>'),
  layers: svg('<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>'),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 2),
  bars: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/></svg>',
  upArrow: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>', 2),
  downArrow: svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>', 2),
  adj: svg('<path d="M4 7h11l-3-3M20 17H9l3 3"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="17" r="2"/>', 2),
  cal: svg('<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>', 2),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  shield: svg('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6Z"/>'),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
  pill: svg('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  clip: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.5h6V4M9 10h6M9 14h6M9 18h3"/>'),
  bag: svg('<path d="M6 7h12l1 13H5L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>'),
  fileUp: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="m9 14 3-3 3 3M12 11v7"/>'),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M17 9v8H9"/></svg>'
};
const PILLS = ['#1e7be6', '#e5484d', '#7a4ff0', '#12a01b', '#f29a00', '#0e9488'];
const thumbPh = name => { const c = PILLS[[...String(name || 'x')].reduce((s, ch) => s + ch.charCodeAt(0), 0) % PILLS.length]; return `<span class="md-thumb md-ph" style="--c:${c}" aria-hidden="true"><svg viewBox="0 0 64 40"><rect x="2" y="6" width="60" height="28" rx="4" fill="#fff" stroke="#d9dfe8"/><rect x="2" y="6" width="20" height="28" rx="4" fill="var(--c)"/><path d="M28 14h26M28 20h18M28 26h22" stroke="#c8d0db" stroke-width="2.4" stroke-linecap="round"/></svg></span>`; };
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
async function fetchAll(build) {
  const out = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { data: out.length ? out : null, error };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}

// ---------------------------------------------------------------- layout
const TABS = [
  ['stock', 'Batch Stock', I.list, true],
  ['alerts', 'Alerts', I.warn, true],
  ['count', 'Physical Count', I.clip, canAdjust],
  ['opening', 'Initial Stock', I.fileUp, admin],
  ['val', 'Valuation', I.db, admin],
  ['moves', 'Movements', I.history, canMoves]
].filter(t => t[3]);
$('view').innerHTML = `
<div class="pos dl md inv">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.box}</span>
      <div><h1>Inventory Management</h1><p>Track stock levels, stock value, movements, expiry, and reorder items.</p></div></div>
    <div class="pos-head-actions md-head-actions inv-head-actions">
      <button type="button" class="pos-btn pos-btn-solid" id="updBtn">${I.plusC}<span>Update Stock</span></button>
      ${canAdjust ? `<button type="button" class="pos-btn" id="adjBtn">${I.swap}<span>Stock Adjustment</span></button>
      <button type="button" class="pos-btn" id="trfBtn">${I.truck}<span>Stock Transfer</span></button>` : ''}
      <button type="button" class="pos-btn" id="expBtn">${I.download}<span>Export</span></button>
    </div>
  </section>

  <section class="dz-kpis dl-kpis md-kpis">
    ${KPI('green', I.db, 'Total Items', 'kItems')}
    ${KPI('blue', I.cubes, 'Total Stock', 'kStock')}
    ${KPI('amber', I.cube, 'Low Stock Items', 'kLow')}
    ${KPI('rose', I.warn, 'Expiring Soon', 'kExp')}
  </section>

  <nav class="dl-tabs inv-tabs" id="invTabs" role="tablist" aria-label="Inventory sections">
    ${TABS.map(([k, l, ic]) => `<button type="button" role="tab" data-k="${k}" class="${k === 'stock' ? 'on' : ''}" aria-selected="${k === 'stock'}">${ic}<span>${l}</span>${k === 'alerts' ? '<b class="inv-tc" id="tc_alerts" hidden>0</b>' : ''}</button>`).join('')}
  </nav>

  <div id="msg" class="md-msg" role="status"></div>

  <div class="dl-grid md-grid inv-grid inv-pane" id="tab-stock">
    <div class="dl-main-col">
      <section class="pos-card dl-orders md-list">
        <div class="dl-card-head inv-list-head">
          <h2>${I.list}Inventory Stock List</h2>
          <div class="inv-tools">
            <label class="dl-select inv-cat">${I.layers}<select id="fCat" aria-label="Category"><option value="">All Categories</option></select></label>
            <label class="dl-select">${I.layers}<select id="fl" aria-label="Stock status"><option value="">All Stock Status</option><option value="in">In Stock</option><option value="low">Low Stock</option><option value="out">Out of Stock</option><option value="near">Near Expiry</option><option value="exp">Expired</option><option value="q">Quarantined</option><option value="blk">Blocked / Recalled / Damaged</option></select></label>
            <div class="dl-pop-anchor">
              <button type="button" class="pos-btn dl-filter-btn" id="filterBtn" aria-expanded="false">${I.filter}<span>Filter</span><b class="dl-filter-dot" id="filterDot" hidden></b></button>
              <div class="dl-pop" id="filterPop" hidden>
                <div class="pos-field"><label for="fWithin">Expiring within (days)</label><input id="fWithin" type="number" min="1" placeholder="Any"></div>
                <div class="pos-field"><label for="fMan">Manufacturer</label><select id="fMan"><option value="">All manufacturers</option></select></div>
                <div class="pos-field"><label for="fRack">Rack / shelf contains</label><input id="fRack" placeholder="e.g. A-03"></div>
                <div class="pos-field"><label for="nd">Near-expiry window (days)</label><input id="nd" type="number" min="1" value="90"></div>
                <label class="dl-check"><input type="checkbox" id="fEmpty"> Show empty batches (0 qty)</label>
                <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="fReset">Reset</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="fApply">Apply</button></div>
              </div>
            </div>
          </div>
        </div>
        <label class="dl-search">${I.search}<input id="s" type="search" placeholder="Search by medicine name, batch, or barcode..." autocomplete="off" aria-label="Search stock"></label>
        <div class="dl-table-wrap"><table class="dl-table md-table inv-table"><thead><tr>
          <th class="c-no">#</th><th>Medicine</th><th>Batch No.</th><th>Expiry Date</th><th class="c-r">MRP (₹)</th><th class="c-r">Stock</th><th class="c-r">Stock Value (₹)</th><th>Status</th><th class="c-c"></th>
        </tr></thead><tbody id="r"><tr><td colspan="9" class="dl-empty">Loading stock…</td></tr></tbody></table></div>
        <div class="dl-pager md-pager"><span id="pageInfo"></span><div id="pager"></div>
          <label class="dl-select md-per"><select id="perPage" aria-label="Rows per page"><option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></select></label></div>
      </section>
    </div>

    <aside class="dl-side">
      <section class="pos-card inv-value">
        <div class="dl-card-head"><h2>${I.db}Stock Value</h2><button type="button" class="dl-act" id="valInfo" title="Full valuation" aria-label="Full valuation">${I.info}</button></div>
        <div id="valBody" class="inv-val"><p class="dl-empty">Loading…</p></div>
      </section>
      <section class="pos-card inv-moves" id="movesCard">
        <div class="dl-card-head"><h2>${I.bars}Stock Movement <small>(Last 7 Days)</small></h2><button type="button" class="dl-link" id="movesAll">View All ${I.chev}</button></div>
        <div class="inv-mv" id="mvBody"><p class="dl-empty">Loading…</p></div>
      </section>
      <section class="pos-card inv-expiry">
        <div class="dl-card-head"><h2>${I.cal}Expiry Alerts</h2><button type="button" class="dl-link" id="alertsAll">View All ${I.chev}</button></div>
        <div class="dl-table-wrap"><table class="dl-table md-plain inv-exp-table"><thead><tr><th>Medicine</th><th>Batch No.</th><th>Expiry Date</th><th class="c-r">Days Left</th></tr></thead><tbody id="expRows"><tr><td colspan="4" class="dl-empty">Loading…</td></tr></tbody></table></div>
      </section>
    </aside>
  </div>
  ${TABS.filter(t => t[0] !== 'stock').map(([k]) => `<section class="pos-card inv-pane inv-tabpane" id="tab-${k}" role="tabpanel" hidden></section>`).join('')}
</div>
<dialog id="ivDlg" class="pos-dialog dl-dialog md-wide inv-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="panel"></div></dialog>
<dialog id="adj" class="pos-dialog dl-dialog"><button type="button" class="pos-icon-btn dl-x" id="ac" aria-label="Close">${I.xs}</button>
  <form id="af" method="dialog" class="md-form"><h3 id="at"></h3>
    <div class="pos-field"><label for="ak">Change</label><select id="ak"><option value="adjustment+">Increase (stock found)</option><option value="adjustment-">Decrease (correction)</option><option value="damage-">Damaged</option><option value="expiry_writeoff-">Expired write-off</option></select></div>
    <div class="md-form-grid"><div class="pos-field"><label for="aq">Quantity</label><input id="aq" type="number" min="0.001" step="any" placeholder="Quantity" required></div>
    <div class="pos-field"><label>New quantity</label><input id="anew" disabled></div></div>
    <div class="pos-field"><label for="ar">Reason *</label><input id="ar" placeholder="Reason *" required maxlength="300"></div>
    <div id="ae" class="pos-form-msg"></div>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" id="ac2">Cancel</button><button type="submit" class="pos-btn pos-btn-solid">Save adjustment</button></div>
  </form></dialog>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });

let toastT;
const note = (m, bad) => { $('msg').textContent = m || ''; $('msg').classList.toggle('bad', !!bad); if (m) toast(m, bad); };
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4000); };
const dlg = html => { $('panel').innerHTML = html; if (!$('ivDlg').open) $('ivDlg').showModal(); };
$('ivDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('ivDlg')) $('ivDlg').close(); });

// ---------------------------------------------------------------- data
let meds = new Map(), batches = [], moves7 = [], net30 = null, valuation = null, branches = [], cats = new Map(), mans = new Map();
let near = 90, page = 1, cur = null;
const filters = { within: '', man: '', rack: '', empty: false };

async function loadBatches() {
  const [mres, bres, cres, manres] = await Promise.all([
    fetchAll(() => sb.from('medicines').select('id,name,strength,dosage_form,barcode,category_id,manufacturer_id,brand,reorder_level,active,mrp,selling_price,discount_percentage,rack,shelf_location,created_at').eq('branch_id', branchId).order('name').order('id')),
    fetchAll(() => sb.from('medicine_batches').select('id,medicine_id,batch_no,expiry,qty,quarantined,stock_status,mrp,unit_cost,created_at').eq('branch_id', branchId).order('expiry').order('id')),
    sb.from('categories').select('id,name').order('name'),
    sb.from('manufacturers').select('id,name').order('name')
  ]);
  if (mres.error || bres.error) note(friendly(mres.error || bres.error), true);
  cats = new Map((cres.data || []).map(c => [c.id, c.name]));
  mans = new Map((manres.data || []).map(c => [c.id, c.name]));
  meds = new Map((mres.data || []).map(m => [m.id, m]));
  // sellable per medicine (same rule as billing)
  const sell = new Map();
  for (const b of bres.data || []) if (b.expiry > today && !b.quarantined && (b.stock_status || 'active') === 'active') sell.set(b.medicine_id, (sell.get(b.medicine_id) || 0) + Number(b.qty));
  for (const m of meds.values()) { m.sellable = sell.get(m.id) || 0; m.low = m.active && Number(m.reorder_level) > 0 && m.sellable <= Number(m.reorder_level); }
  batches = (bres.data || []).map(b => {
    const m = meds.get(b.medicine_id) || {};
    const disc = m.discount_percentage != null ? Number(m.discount_percentage) : (Number(m.mrp) > 0 && Number(m.selling_price) > 0 && Number(m.selling_price) < Number(m.mrp) ? (Number(m.mrp) - Number(m.selling_price)) * 100 / Number(m.mrp) : 0);
    const mrp = b.mrp != null ? Number(b.mrp) : (Number(m.mrp) > 0 ? Number(m.mrp) : null);
    return {
      ...b, batch_id: b.id, name: m.name || 'Medicine', strength: m.strength || '', form: m.dosage_form || '', barcode: m.barcode || '',
      category: cats.get(m.category_id) || '', manufacturer: mans.get(m.manufacturer_id) || m.brand || '', location: [m.shelf_location, m.rack].filter((x, i, a) => x && a.indexOf(x) === i).join(' '),
      reorder_level: Number(m.reorder_level) || 0, active: m.active !== false, mrpShown: mrp, disc,
      qty: Number(b.qty), value: mrp == null ? null : Number(b.qty) * mrp,
      status: b.expiry <= today ? 'expired' : b.quarantined ? 'quarantined' : 'ok'
    };
  });
}
async function loadExtras() {
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const [mv, val, br] = await Promise.all([
    canMoves ? fetchAll(() => sb.from('stock_movements').select('movement_type,qty,created_at').eq('branch_id', branchId).gte('created_at', since30).order('created_at').order('id')) : Promise.resolve({ error: 'no access' }),
    admin ? sb.rpc('inventory_valuation') : Promise.resolve({ data: null }),
    canAdjust ? sb.rpc('stock_transfer_branches') : Promise.resolve({ data: [] })
  ]);
  if (mv.error) { moves7 = null; net30 = null; }
  else {
    const since7 = istDay(Date.now() - 6 * 864e5);
    moves7 = (mv.data || []).filter(x => istDay(x.created_at) >= since7);
    net30 = (mv.data || []).reduce((s, x) => s + Number(x.qty), 0);
  }
  valuation = val?.data?.[0] || null;
  branches = br?.error ? null : (br?.data || []);
}

// ---------------------------------------------------------------- status
const state = b => b.status === 'expired' ? 'Expired' : b.status === 'quarantined' ? 'Quarantined' : STATUS_LABEL[b.stock_status] || (daysTo(b.expiry) <= near ? `Near expiry (${daysTo(b.expiry)}d)` : 'OK');
function statusKey(b) {
  if (b.status === 'expired' && b.qty > 0) return 'exp';
  if (b.stock_status && b.stock_status !== 'active') return 'blk';
  if (b.status === 'quarantined') return 'q';
  if (b.qty <= 0) return 'out';
  if (meds.get(b.medicine_id)?.low) return 'low';
  if (daysTo(b.expiry) <= near) return 'near';
  return 'in';
}
const CHIP = { in: ['In Stock', 'in'], low: ['Low Stock', 'low'], out: ['Out of Stock', 'out'], near: ['Near Expiry', 'low'], exp: ['Expired', 'out'], q: ['Quarantined', 'off'], blk: ['Blocked', 'out'] };
const chip = b => { const k = statusKey(b); const lbl = k === 'blk' ? STATUS_LABEL[b.stock_status] : k === 'near' ? `Expires in ${daysTo(b.expiry)}d` : CHIP[k][0]; return `<span class="md-chip ${CHIP[k][1]}"><i></i>${esc(lbl)}</span>`; };

// ---------------------------------------------------------------- KPIs + side cards
function renderKpis() {
  const act = [...meds.values()].filter(m => m.active);
  const total = act.length;
  const monthStart = today.slice(0, 8) + '01';
  const before = act.filter(m => m.created_at && istDay(m.created_at) < monthStart).length;
  $('kItems').textContent = count(total);
  $('kItemsNote').innerHTML = before ? `<span class="${total >= before ? 'dz-up' : 'dz-down'}">${total >= before ? I.up : I.down}${total >= before ? '+' : ''}${((total - before) / before * 100).toFixed(1)}%</span> vs. last month` : (total ? `<span class="dz-up">+${count(total)}</span> added this month` : 'active medicines');
  const units = batches.reduce((s, b) => s + b.qty, 0);
  const sellBatches = batches.filter(b => b.qty > 0 && b.expiry > today && !b.quarantined && (b.stock_status || 'active') === 'active');
  const mrpValue = sellBatches.reduce((s, b) => s + (b.value || 0), 0);
  $('kStock').textContent = admin && valuation ? rupees0(valuation.cost_total) : rupees0(mrpValue);
  const unitsBefore = net30 == null ? null : units - net30;
  $('kStockNote').innerHTML = unitsBefore ? `<span class="${units >= unitsBefore ? 'dz-up' : 'dz-down'}">${units >= unitsBefore ? I.up : I.down}${units >= unitsBefore ? '+' : ''}${((units - unitsBefore) / unitsBefore * 100).toFixed(1)}%</span> vs. last month` : `${count(units)} units ${admin && valuation ? 'at cost' : 'at MRP'}`;
  $('kStock').closest('.dz-kpi').title = (admin && valuation ? 'All stock on hand at purchase cost' : 'Sellable stock at MRP') + (unitsBefore ? '. Trend compares units on hand with 30 days ago.' : '');
  const low = act.filter(m => m.low).length;
  $('kLow').textContent = count(low);
  $('kLowNote').innerHTML = `<span class="md-pct">${total ? Math.round(low / total * 100) : 0}%</span> of total items`;
  const exp30 = sellBatches.filter(b => daysTo(b.expiry) <= 30).length;
  $('kExp').textContent = count(exp30);
  $('kExpNote').textContent = 'Next 30 days';
}
function renderValue() {
  const sellBatches = batches.filter(b => b.qty > 0 && b.expiry > today && !b.quarantined && (b.stock_status || 'active') === 'active');
  const mrpValue = sellBatches.reduce((s, b) => s + (b.value || 0), 0);
  const salesValue = sellBatches.reduce((s, b) => s + (b.value || 0) * (100 - b.disc) / 100, 0);
  $('valBody').innerHTML = admin && valuation ? `
    <div class="hl"><span>Total Stock Value</span><b>${rupees0(valuation.cost_total)}</b></div>
    <div><span>Purchase Value <small>(sellable, at cost)</small></span><b>${rupees0(valuation.cost_sellable)}</b></div>
    <div><span>Potential Sales Value</span><b>${rupees0(salesValue)}</b></div>`
    : `<div class="hl"><span>Sellable Stock at MRP</span><b>${rupees0(mrpValue)}</b></div>
    <div><span>Potential Sales Value</span><b>${rupees0(salesValue)}</b></div>
    <div><span>Units on hand</span><b>${count(batches.reduce((s, b) => s + b.qty, 0))}</b></div>
    <p class="dl-muted">Cost values are visible to administrators only.</p>`;
}
function renderMoves() {
  if (moves7 == null) { $('movesCard').hidden = true; return; }
  const inQ = moves7.filter(m => Number(m.qty) > 0 && m.movement_type !== 'transfer').reduce((s, m) => s + Number(m.qty), 0);
  const outQ = moves7.filter(m => Number(m.qty) < 0 && m.movement_type !== 'transfer').reduce((s, m) => s - Number(m.qty), 0);
  const trf = moves7.filter(m => m.movement_type === 'transfer').length;
  const adj = moves7.filter(m => ['adjustment', 'damage', 'expiry_writeoff', 'physical_count'].includes(m.movement_type)).length;
  $('mvBody').innerHTML = `
    <button type="button" class="in" data-mv="in">${I.upArrow}<strong>${count(inQ)}</strong><span>Stock In</span></button>
    <button type="button" class="out" data-mv="out">${I.downArrow}<strong>${count(outQ)}</strong><span>Stock Out</span></button>
    <button type="button" class="trf" data-mv="transfer">${I.swap}<strong>${count(trf)}</strong><span>Transfers</span></button>
    <button type="button" class="adj" data-mv="adj">${I.adj}<strong>${count(adj)}</strong><span>Adjustments</span></button>`;
}
function renderExpiry() {
  const list = batches.filter(b => b.qty > 0 && (b.stock_status || 'active') === 'active' && daysTo(b.expiry) <= near).sort((a, b) => a.expiry.localeCompare(b.expiry)).slice(0, 5);
  $('expRows').innerHTML = list.map(b => { const d = daysTo(b.expiry); return `<tr data-batch="${esc(b.batch_id)}"><td>${esc(b.name)}${b.strength && !b.name.includes(b.strength) ? ` ${esc(b.strength)}` : ''}</td><td>${esc(b.batch_no)}</td><td>${esc(dayMonth(b.expiry))}</td><td class="c-r"><span class="inv-days ${d <= 0 ? 'x' : d <= 30 ? 'r' : d <= 60 ? 'a' : 'g'}">${d <= 0 ? 'Expired' : `${d} days`}</span></td></tr>`; }).join('')
    || `<tr><td colspan="4" class="dl-empty">No stock expires in the next ${near} days.</td></tr>`;
}
function notify() {
  const act = [...meds.values()].filter(m => m.active);
  const low = act.filter(m => m.low), expd = batches.filter(b => b.status === 'expired' && b.qty > 0), soon = batches.filter(b => b.qty > 0 && b.status === 'ok' && daysTo(b.expiry) <= 30), q = batches.filter(b => b.quarantined && b.qty > 0);
  const items = [];
  if (expd.length) items.push({ tone: 'danger', title: `${expd.length} expired batch(es) still in stock`, detail: 'Write them off or return them to the distributor', href: 'inventory.html' });
  if (soon.length) items.push({ tone: 'warn', title: `${soon.length} batch(es) expire within 30 days`, detail: soon.slice(0, 3).map(b => b.name).join(', '), href: 'inventory.html' });
  if (low.length) items.push({ tone: 'warn', title: `${low.length} item(s) at or below reorder level`, detail: low.slice(0, 3).map(m => m.name).join(', '), href: 'inventory.html' });
  if (q.length) items.push({ tone: 'info', title: `${q.length} quarantined batch(es)`, detail: 'Release or write them off', href: 'inventory.html' });
  setNotifications(items);
}

// ---------------------------------------------------------------- list
function filtered() {
  const s = $('s').value.trim().toLowerCase();
  const f = $('fl').value, cat = $('fCat').value;
  return batches.filter(b => {
    if (!filters.empty && b.qty <= 0 && f !== 'out') return false;
    if (f) { const k = statusKey(b); if (f === 'near' ? !(b.qty > 0 && b.status === 'ok' && daysTo(b.expiry) <= near) : k !== f) return false; }
    if (cat && b.category !== cat) return false;
    if (filters.man && b.manufacturer !== filters.man) return false;
    if (filters.rack && !b.location.toLowerCase().includes(filters.rack.toLowerCase())) return false;
    if (filters.within && !(daysTo(b.expiry) <= Number(filters.within))) return false;
    if (s && !`${b.name} ${b.strength} ${b.batch_no} ${b.barcode} ${b.manufacturer}`.toLowerCase().includes(s)) return false;
    return true;
  });
}
function draw() {
  const rows = filtered();
  const per = Number($('perPage').value);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  page = Math.min(page, pages);
  const shown = rows.slice((page - 1) * per, page * per);
  $('r').innerHTML = shown.map((b, i) => `<tr data-batch="${esc(b.batch_id)}" class="st-${statusKey(b)}">
    <td class="c-no">${(page - 1) * per + i + 1}</td>
    <td class="c-med"><div class="md-med">${thumbPh(b.name)}<span><b>${esc(b.name)}${b.strength && !b.name.includes(b.strength) ? ` ${esc(b.strength)}` : ''}</b><small>${esc(b.form || b.manufacturer || '—')}</small><small class="md-m-sub">${esc([b.form, b.batch_no].filter(Boolean).join(' • '))}</small></span></div></td>
    <td class="c-bn">${esc(b.batch_no)}</td>
    <td class="c-exp">${esc(monthYear(b.expiry))}</td>
    <td class="c-r c-mrp">${b.mrpShown == null ? '—' : money(b.mrpShown)}<small class="md-m-stock">Stock: ${count(b.qty)}</small></td>
    <td class="c-r c-stock">${count(b.qty)}</td>
    <td class="c-r c-val">${b.value == null ? '—' : money(b.value)}</td>
    <td class="c-st">${chip(b)}</td>
    <td class="c-act"><div class="dl-pop-anchor"><button type="button" class="dl-act" data-menu="${esc(b.batch_id)}" aria-label="Actions for ${esc(b.name)} ${esc(b.batch_no)}">${I.dots}</button></div></td>
  </tr>`).join('') || `<tr><td colspan="9" class="dl-empty">${batches.length ? 'No batches match these filters.' : 'No stock yet. Add stock with a purchase bill or Initial Stock.'}</td></tr>`;
  $('pageInfo').textContent = rows.length ? `Showing ${(page - 1) * per + 1} – ${Math.min(page * per, rows.length)} of ${count(rows.length)} items` : '';
  $('pager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, k) => k + 1).filter(n => n <= 5 && page <= 3 || n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, k, arr) => `${k && n - arr[k - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
  $('filterDot').hidden = !(filters.within || filters.man || filters.rack || filters.empty || near !== 90);
}
function fillFilters() {
  const keep = { c: $('fCat').value, m: $('fMan').value };
  const cs = [...new Set(batches.map(b => b.category).filter(Boolean))].sort();
  const ms = [...new Set(batches.map(b => b.manufacturer).filter(Boolean))].sort();
  $('fCat').innerHTML = '<option value="">All Categories</option>' + cs.map(c => `<option>${esc(c)}</option>`).join('');
  $('fMan').innerHTML = '<option value="">All manufacturers</option>' + ms.map(c => `<option>${esc(c)}</option>`).join('');
  $('fCat').value = keep.c; $('fMan').value = keep.m;
}
async function refresh({ extras = true } = {}) {
  await loadBatches();
  if (extras) await loadExtras();
  fillFilters();
  renderKpis(); renderValue(); renderMoves(); renderExpiry(); draw(); notify(); tabCounts();
  if (['alerts', 'count', 'val'].includes(tab)) views[tab]();
}

// ---------------------------------------------------------------- batch actions
function openAdjust(b) {
  if (!canAdjust) return toast('Your role cannot adjust stock.', true);
  cur = b;
  $('at').textContent = `Adjust ${cur.name} · batch ${cur.batch_no} (now ${count(cur.qty)})`;
  $('af').reset(); $('ae').textContent = ''; $('anew').value = count(cur.qty);
  $('adj').showModal();
  $('aq').focus();
}
const newQty = () => { const k = $('ak').value; const q = Number($('aq').value) || 0; return cur ? cur.qty + (k.endsWith('+') ? q : -q) : 0; };
$('aq').oninput = $('ak').onchange = () => { $('anew').value = count(newQty()); };
$('ac').onclick = $('ac2').onclick = () => $('adj').close();
$('af').onsubmit = async e => {
  e.preventDefault();
  const k = $('ak').value, sign = k.endsWith('+') ? 1 : -1, type = k.slice(0, -1);
  if (newQty() < 0) { $('ae').textContent = `Stock cannot go below zero (now ${count(cur.qty)}).`; return; }
  const { error } = await sb.rpc('adjust_stock', { p_batch: cur.batch_id, p_delta: sign * +$('aq').value, p_type: type, p_reason: $('ar').value });
  if (error) { $('ae').textContent = friendly(error); return; }
  $('adj').close();
  await refresh();
  note('Stock updated.');
};
async function toggleQuarantine(x) {
  const why = prompt(`${x.quarantined ? 'Release' : 'Quarantine'} batch ${x.batch_no}: reason?`);
  if (!why) return;
  const { error } = await sb.rpc('set_quarantine', { p_batch: x.batch_id, p_flag: !x.quarantined, p_reason: why });
  if (error) return note(friendly(error), true);
  await refresh({ extras: false });
  note(x.quarantined ? 'Batch released; it can be billed again.' : 'Batch quarantined; billing will not use it.');
}
async function setBatchStatus(x) {
  let next = 'active';
  if (!x.stock_status || x.stock_status === 'active') {
    next = (prompt(`Batch ${x.batch_no}: type blocked, recalled or damaged`, 'recalled') || '').trim().toLowerCase();
    if (!next) return;
    if (!STATUS_LABEL[next]) return note('Status must be blocked, recalled or damaged.', true);
  }
  const why = prompt(`${next === 'active' ? 'Reactivate' : STATUS_LABEL[next]} batch ${x.batch_no}: reason?`);
  if (!why) return;
  const { error } = await sb.rpc('set_batch_stock_status', { p_batch: x.batch_id, p_status: next, p_reason: why });
  if (error) return note(friendly(error), true);
  await refresh({ extras: false });
  note(next === 'active' ? 'Batch reactivated; it can be billed again.' : `Batch marked ${next}. Billing will no longer allocate it.`);
}
async function batchMoves(b) {
  dlg(`<h3>Movements — ${esc(b.name)} · ${esc(b.batch_no)}</h3><div id="bmBody"><p class="dl-empty">Loading…</p></div>`);
  const { data, error } = await sb.from('stock_movements').select('created_at,movement_type,qty,reason').eq('batch_id', b.batch_id).order('created_at', { ascending: false }).limit(200);
  $('bmBody').innerHTML = error ? `<p class="pos-form-msg">${esc(friendly(error))}</p>` : moveTable(data || [], false);
}
function batchDetails(b) {
  const m = meds.get(b.medicine_id) || {};
  dlg(`<h3>${esc(b.name)}${b.strength && !b.name.includes(b.strength) ? ` ${esc(b.strength)}` : ''} ${chip(b)}</h3>
    <div class="delivery-detail-grid dl-detail-grid">
      <div><small>Batch</small><b>${esc(b.batch_no)}</b></div><div><small>Expiry</small><b>${esc(dayMonth(b.expiry))} (${daysTo(b.expiry)} days)</b></div>
      <div><small>Quantity</small><b>${count(b.qty)}</b></div><div><small>MRP</small><b>${b.mrpShown == null ? '—' : `₹${money(b.mrpShown)}`}</b></div>
      <div><small>Stock value at MRP</small><b>${b.value == null ? '—' : `₹${money(b.value)}`}</b></div>${admin ? `<div><small>Cost / unit · value at cost</small><b>${b.unit_cost == null ? '—' : `₹${money(b.unit_cost)} · ₹${money(b.unit_cost * b.qty)}`}</b></div>` : ''}
      <div><small>Medicine sellable stock</small><b>${count(m.sellable)}${m.reorder_level ? ` (reorder at ${count(m.reorder_level)})` : ''}</b></div><div><small>Location</small><b>${esc(b.location || '—')}</b></div>
      <div><small>Category</small><b>${esc(b.category || '—')}</b></div><div><small>Manufacturer / brand</small><b>${esc(b.manufacturer || '—')}</b></div>
    </div>
    <div class="pos-dialog-foot md-foot-left inv-acts">${actionButtons(b)}</div>`);
}
function actionButtons(b) {
  return [
    canAdjust ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-do="adjust" data-b="${esc(b.batch_id)}">${I.swap}<span>Adjust stock</span></button>` : '',
    canAdjust && b.qty > 0 && b.status === 'ok' && (b.stock_status || 'active') === 'active' ? `<button type="button" class="pos-btn pos-btn-sm" data-do="transfer" data-b="${esc(b.batch_id)}">${I.truck}<span>Transfer</span></button>` : '',
    canAdjust ? `<button type="button" class="pos-btn pos-btn-sm" data-q="${esc(b.batch_id)}">${I.shield}<span>${b.quarantined ? 'Release' : 'Quarantine'}</span></button>` : '',
    canAdjust ? `<button type="button" class="pos-btn pos-btn-sm" data-st="${esc(b.batch_id)}">${I.ban}<span>${b.stock_status && b.stock_status !== 'active' ? 'Reactivate' : 'Block / recall'}</span></button>` : '',
    moves7 != null ? `<button type="button" class="pos-btn pos-btn-sm" data-do="moves" data-b="${esc(b.batch_id)}">${I.history}<span>Movements</span></button>` : '',
    `<a class="pos-btn pos-btn-sm" href="medicines.html?q=${encodeURIComponent(b.name)}">${I.pill}<span>Open medicine</span></a>`
  ].join('');
}
const byBatch = id => batches.find(x => x.batch_id === id);
async function doAction(el) {
  const id = el.dataset.b || el.dataset.q || el.dataset.st || el.dataset.a;
  const b = byBatch(id);
  if (!b) return;
  if ($('ivDlg').open && (el.dataset.do !== 'moves')) $('ivDlg').close();
  if (el.dataset.q) return toggleQuarantine(b);
  if (el.dataset.st) return setBatchStatus(b);
  if (el.dataset.a || el.dataset.do === 'adjust') return openAdjust(b);
  if (el.dataset.do === 'transfer') return openTransfer(b);
  if (el.dataset.do === 'moves') return batchMoves(b);
  if (el.dataset.do === 'details') return batchDetails(b);
}
let menuEl = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
function openMenu(btn, b) {
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'dl-pop md-menu md-row-menu';
  menuEl.innerHTML = `<button type="button" data-do="details" data-b="${esc(b.batch_id)}">${I.info}<span>Batch details</span></button>` + actionButtons(b).replace(/pos-btn pos-btn-sm( pos-btn-solid)?/g, '').replace(/<a class=""/, '<a class="md-menu-link"');
  btn.parentElement.append(menuEl);
}
$('r').addEventListener('click', e => {
  const m = e.target.closest('[data-menu]');
  if (m) { e.stopPropagation(); if (menuEl && menuEl.parentElement === m.parentElement) closeMenu(); else openMenu(m, byBatch(m.dataset.menu)); return; }
  const act = e.target.closest('.md-row-menu [data-do], .md-row-menu [data-q], .md-row-menu [data-st]');
  if (act) { e.stopPropagation(); closeMenu(); doAction(act); return; }
  if (e.target.closest('.md-row-menu')) return;
  const tr = e.target.closest('tr[data-batch]');
  if (tr) batchDetails(byBatch(tr.dataset.batch));
});
document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
$('panel').addEventListener('click', e => { const el = e.target.closest('[data-do],[data-q],[data-st]'); if (el && el.closest('.inv-acts')) doAction(el); });
$('expRows').onclick = e => { const tr = e.target.closest('tr[data-batch]'); if (tr) batchDetails(byBatch(tr.dataset.batch)); };

// ---------------------------------------------------------------- section tabs
// Batch Stock · Alerts · Physical Count · Initial Stock · Valuation · Movements,
// each a full section of the page in the same design.
let tab = 'stock';
const MOVE_TYPES = ['purchase_in', 'opening_stock', 'sale_out', 'return_in', 'return_out', 'adjustment', 'damage', 'expiry_writeoff', 'physical_count', 'transfer'];
const paneHead = (ic, title, sub, tools = '') => `<div class="inv-pane-head"><div class="inv-pane-title"><span class="inv-pane-ic">${ic}</span><div><h2>${title}</h2><p>${sub}</p></div></div>${tools ? `<div class="inv-pane-tools">${tools}</div>` : ''}</div>`;
const plainTable = (cls, head, rows, empty) => `<div class="dl-table-wrap"><table class="dl-table md-plain ${cls}"><thead><tr>${head.map(h => `<th${h.startsWith('>') ? ' class="c-r"' : ''}>${h.replace(/^>/, '')}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" class="dl-empty">${empty}</td></tr>`}</tbody></table></div>`;
const medName = b => `${esc(b.name)}${b.strength && !b.name.includes(b.strength) ? ` ${esc(b.strength)}` : ''}`;
const daysChip = d => `<span class="inv-days ${d <= 0 ? 'x' : d <= 30 ? 'r' : d <= 60 ? 'a' : 'g'}">${d <= 0 ? 'Expired' : `${d} days`}</span>`;

function alertLists() {
  const lowMeds = [...meds.values()].filter(m => m.low).sort((a, b) => (a.sellable - a.reorder_level) - (b.sellable - b.reorder_level));
  const nr = batches.filter(b => b.status === 'ok' && b.qty > 0 && (b.stock_status || 'active') === 'active' && daysTo(b.expiry) <= near).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const ex = batches.filter(b => b.status === 'expired' && b.qty > 0);
  const q = batches.filter(b => b.status === 'quarantined' && b.qty > 0);
  const blk = batches.filter(b => b.status === 'ok' && b.qty > 0 && b.stock_status && b.stock_status !== 'active');
  return { lowMeds, nr, ex, q, blk };
}
function tabCounts() {
  const a = alertLists();
  const n = a.lowMeds.length + a.nr.length + a.ex.length + a.q.length + a.blk.length;
  const el = $('tc_alerts'); if (el) { el.textContent = n; el.hidden = !n; }
}
function showTab(k, opts = {}) {
  if (!TABS.some(t => t[0] === k)) k = 'stock';
  tab = k;
  document.querySelectorAll('#invTabs [data-k]').forEach(b => { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.inv-pane').forEach(p => { p.hidden = p.id !== `tab-${k}`; });
  try { history.replaceState(null, '', k === 'stock' ? location.pathname + location.search.replace(/[?&]view=[^&]*/, '').replace(/^&/, '?') : `${location.pathname}?view=${k}`); } catch { /* ignore */ }
  if (k !== 'stock') views[k](opts);
  if (opts.scroll !== false) $('invTabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const views = {
  // ---------- Alerts
  alerts() {
    const { lowMeds, nr, ex, q, blk } = alertLists();
    const nearVal = nr.reduce((s, b) => s + (b.value || 0), 0), exVal = ex.reduce((s, b) => s + (b.value || 0), 0);
    $('tab-alerts').innerHTML = `
      ${paneHead(I.warn, 'Stock Alerts', 'Items at or below reorder level, batches close to expiry, and stock that cannot be sold.',
        `<label class="inv-inline">Near-expiry window <input id="nd2" type="number" min="1" value="${near}"> days</label>`)}
      <div class="inv-sum">
        <button type="button" class="amber" data-jump="aLow">${I.cube}<span><b>${lowMeds.length}</b><small>Low stock items</small></span></button>
        <button type="button" class="rose" data-jump="aNear">${I.cal}<span><b>${nr.length}</b><small>Near expiry · ₹${money(nearVal)}</small></span></button>
        <button type="button" class="red" data-jump="aExp">${I.warn}<span><b>${ex.length}</b><small>Expired in stock · ₹${money(exVal)}</small></span></button>
        <button type="button" class="grey" data-jump="aQ">${I.shield}<span><b>${q.length + blk.length}</b><small>Quarantined / blocked</small></span></button>
      </div>
      <div class="inv-two">
        <section class="pos-card inv-sub" id="aLow"><div class="dl-card-head"><h2>${I.cube}Low stock <small>(sellable ≤ reorder level)</small></h2>${canPurchase && lowMeds.length ? `<a class="dl-link" href="purchases.html?new=1">Reorder ${I.chev}</a>` : ''}</div>
          ${plainTable('', ['Medicine', '>Sellable', '>Reorder level', '>Short by'], lowMeds.map(m => `<tr><td><a class="inv-mlink" href="medicines.html?q=${encodeURIComponent(m.name)}">${esc(m.name)}${m.strength && !m.name.includes(m.strength) ? ` ${esc(m.strength)}` : ''}</a></td><td class="c-r"><b class="${m.sellable <= 0 ? 'inv-red' : 'inv-amber'}">${count(m.sellable)}</b></td><td class="c-r">${count(m.reorder_level)}</td><td class="c-r">${count(Math.max(0, m.reorder_level - m.sellable))}</td></tr>`).join(''), 'No item is below its reorder level 🎉')}</section>
        <section class="pos-card inv-sub" id="aNear"><div class="dl-card-head"><h2>${I.cal}Near expiry <small>(${near} days)</small></h2></div>
          ${plainTable('', ['Medicine', 'Batch', 'Expiry', '>Days left', '>Qty', '>Value (₹)', ''], nr.map(b => `<tr data-batch="${esc(b.batch_id)}"><td>${medName(b)}</td><td>${esc(b.batch_no)}</td><td>${esc(dayMonth(b.expiry))}</td><td class="c-r">${daysChip(daysTo(b.expiry))}</td><td class="c-r">${count(b.qty)}</td><td class="c-r">${b.value == null ? '—' : money(b.value)}</td><td class="c-r inv-acts">${canAdjust ? `<button type="button" class="pos-btn pos-btn-sm" data-do="adjust" data-b="${esc(b.batch_id)}">Adjust</button>` : ''}</td></tr>`).join(''), `Nothing expires in the next ${near} days.`)}</section>
        <section class="pos-card inv-sub" id="aExp"><div class="dl-card-head"><h2>${I.warn}Expired, still in stock <small>(cannot be sold)</small></h2></div>
          ${plainTable('', ['Medicine', 'Batch', 'Expired on', '>Qty', '>Value (₹)', ''], ex.map(b => `<tr data-batch="${esc(b.batch_id)}"><td>${medName(b)}</td><td>${esc(b.batch_no)}</td><td>${esc(dayMonth(b.expiry))}</td><td class="c-r">${count(b.qty)}</td><td class="c-r">${b.value == null ? '—' : money(b.value)}</td><td class="c-r inv-acts">${canAdjust ? `<button type="button" class="pos-btn pos-btn-sm" data-do="writeoff" data-b="${esc(b.batch_id)}">Write off</button>` : ''}</td></tr>`).join(''), 'No expired stock on hand 🎉')}</section>
        <section class="pos-card inv-sub" id="aQ"><div class="dl-card-head"><h2>${I.shield}Quarantined / blocked</h2></div>
          ${plainTable('', ['Medicine', 'Batch', 'Expiry', 'Status', '>Qty', ''], [...q, ...blk].map(b => `<tr data-batch="${esc(b.batch_id)}"><td>${medName(b)}</td><td>${esc(b.batch_no)}</td><td>${esc(monthYear(b.expiry))}</td><td>${chip(b)}</td><td class="c-r">${count(b.qty)}</td><td class="c-r inv-acts">${canAdjust ? (b.quarantined ? `<button type="button" class="pos-btn pos-btn-sm" data-q="${esc(b.batch_id)}">Release</button>` : `<button type="button" class="pos-btn pos-btn-sm" data-st="${esc(b.batch_id)}">Reactivate</button>`) : ''}</td></tr>`).join(''), 'No quarantined or blocked batches.')}</section>
      </div>`;
    $('nd2').onchange = () => { near = Math.max(1, +$('nd2').value || 90); $('nd').value = near; renderExpiry(); draw(); tabCounts(); views.alerts(); };
  },

  // ---------- Physical count
  count() {
    const list = batches.filter(b => b.qty > 0 || b.expiry > today);
    const catsIn = [...new Set(list.map(b => b.category).filter(Boolean))].sort();
    $('tab-count').innerHTML = `
      ${paneHead(I.clip, 'Physical Count', 'Count the shelf, enter what you find. Only batches you fill in are submitted; differences are recorded as stock movements.')}
      <div class="inv-count-tools">
        <div class="pos-field"><label for="cn">Count note *</label><input id="cn" placeholder="e.g. Monthly count, rack A" maxlength="200"></div>
        <label class="dl-search inv-csearch">${I.search}<input id="cs2" type="search" placeholder="Find medicine, batch or rack…" autocomplete="off"></label>
        <label class="dl-select">${I.layers}<select id="cCat" aria-label="Category"><option value="">All categories</option>${catsIn.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label class="dl-select">${I.filter}<select id="cShow" aria-label="Show"><option value="">All batches</option><option value="todo">Not counted yet</option><option value="diff">With differences</option></select></label>
      </div>
      <div class="dl-table-wrap inv-count">${plainTable('inv-count-table', ['#', 'Medicine', 'Batch', 'Expiry', 'Location', '>System qty', 'Counted', '>Difference'], list.map((b, i) => `<tr data-n="${esc(`${b.name} ${b.batch_no} ${b.location}`.toLowerCase())}" data-c="${esc(b.category)}"><td class="c-no">${i + 1}</td><td><b>${medName(b)}</b><small>${esc(b.form || '')}</small></td><td>${esc(b.batch_no)}</td><td>${esc(monthYear(b.expiry))}</td><td>${esc(b.location || '—')}</td><td class="c-r">${count(b.qty)}</td><td><input class="ct" data-b="${b.batch_id}" data-s="${b.qty}" type="number" min="0" step="any" aria-label="Counted ${esc(b.name)} ${esc(b.batch_no)}"></td><td class="c-r inv-diff">—</td></tr>`).join(''), 'No batches to count.')}</div>
      <div class="inv-count-bar"><span id="cSum">0 counted · 0 differences</span><p class="pos-form-msg" id="cMsg"></p><button type="button" class="pos-btn" id="cClear">Clear</button><button type="button" class="pos-btn pos-btn-solid" id="cs">${I.clip}<span>Submit counts</span></button></div>`;
    const rows = () => [...$('tab-count').querySelectorAll('tbody tr[data-n]')];
    const filter = () => {
      const qv = $('cs2').value.trim().toLowerCase(), cat = $('cCat').value, show = $('cShow').value;
      rows().forEach(tr => { const i = tr.querySelector('.ct'); const filled = i.value !== ''; const diff = filled && Number(i.value) !== Number(i.dataset.s);
        tr.hidden = (qv && !tr.dataset.n.includes(qv)) || (cat && tr.dataset.c !== cat) || (show === 'todo' && filled) || (show === 'diff' && !diff); });
    };
    const sum = () => {
      let n = 0, d = 0;
      rows().forEach(tr => { const i = tr.querySelector('.ct'), cell = tr.querySelector('.inv-diff');
        if (i.value === '') { cell.textContent = '—'; cell.className = 'c-r inv-diff'; return; }
        n++; const diff = Number(i.value) - Number(i.dataset.s); if (diff) d++;
        cell.textContent = diff > 0 ? `+${count(diff)}` : count(diff); cell.className = `c-r inv-diff ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'same'}`; });
      $('cSum').textContent = `${n} counted · ${d} difference${d === 1 ? '' : 's'}`;
    };
    $('tab-count').querySelector('tbody').addEventListener('input', e => { if (e.target.matches('.ct')) sum(); });
    $('cs2').oninput = $('cCat').onchange = $('cShow').onchange = filter;
    $('cClear').onclick = () => { rows().forEach(tr => { tr.querySelector('.ct').value = ''; }); sum(); filter(); };
    $('cs').onclick = async () => {
      const counts = [...document.querySelectorAll('#tab-count .ct')].filter(i => i.value !== '').map(i => ({ batch_id: i.dataset.b, counted: +i.value }));
      if (!counts.length) return ($('cMsg').textContent = 'Enter at least one counted quantity.');
      if (counts.some(c => c.counted < 0)) return ($('cMsg').textContent = 'Counted quantity cannot be negative.');
      if (!$('cn').value.trim()) return ($('cMsg').textContent = 'A count note is required.');
      $('cs').disabled = true;
      const { data, error } = await sb.rpc('physical_count', { p_counts: counts, p_note: $('cn').value });
      $('cs').disabled = false;
      if (error) return ($('cMsg').textContent = friendly(error));
      await refresh();
      note(`Done. ${data} batch(es) had differences and were adjusted.`);
    };
  },

  // ---------- Initial stock (mounted once, keeps unsaved rows when switching tabs)
  async opening() {
    if ($('osPanel')) return;
    $('tab-opening').innerHTML = `${paneHead(I.fileUp, 'Initial Stock', 'Enter opening stock by hand or upload an Excel sheet. Saved rows create batches, cost layers and opening-stock movements.')}<div id="osPanel" class="inv-opening"></div>`;
    await mountInitialStock($('osPanel'), prof);
  },

  // ---------- Valuation
  async val() {
    $('tab-val').innerHTML = `${paneHead(I.db, 'Stock Valuation', 'What your stock is worth at purchase cost, at MRP and at expected sale price.', `<button type="button" class="pos-btn" id="valExp">${I.download}<span>Export</span></button>`)}<div id="valWrap"><p class="dl-empty">Loading…</p></div>`;
    const { data, error } = await sb.rpc('inventory_valuation');
    if (error) { $('valWrap').innerHTML = `<p class="pos-form-msg">${esc(friendly(error))}</p>`; return; }
    const v = data[0] || {};
    const sellB = batches.filter(b => b.qty > 0 && b.expiry > today && !b.quarantined && (b.stock_status || 'active') === 'active');
    const mrpValue = sellB.reduce((s, b) => s + (b.value || 0), 0);
    const salesValue = sellB.reduce((s, b) => s + (b.value || 0) * (100 - b.disc) / 100, 0);
    const margin = salesValue - Number(v.cost_sellable || 0);
    const tile = (cls, label, val, hint) => `<div class="inv-vt ${cls}"><small>${label}</small><b>${rupees0(val)}</b><span>${hint}</span></div>`;
    const group = (keyFn) => {
      const m = new Map();
      for (const b of batches.filter(x => x.qty > 0)) {
        const k = keyFn(b) || 'Uncategorised';
        const g = m.get(k) || { k, batches: 0, units: 0, cost: 0, mrp: 0, sell: 0 };
        g.batches++; g.units += b.qty; g.cost += b.unit_cost == null ? 0 : Number(b.unit_cost) * b.qty; g.mrp += b.value || 0;
        if (sellB.includes(b)) g.sell += (b.value || 0) * (100 - b.disc) / 100;
        m.set(k, g);
      }
      return [...m.values()].sort((a, b) => b.mrp - a.mrp);
    };
    const byCat = group(b => b.category), byMed = group(b => `${b.name}${b.strength && !b.name.includes(b.strength) ? ` ${b.strength}` : ''}`).slice(0, 10);
    const grpRows = list => list.map(g => `<tr><td>${esc(g.k)}</td><td class="c-r">${g.batches}</td><td class="c-r">${count(g.units)}</td><td class="c-r">${money(g.cost)}</td><td class="c-r">${money(g.mrp)}</td><td class="c-r">${money(g.sell)}</td></tr>`).join('');
    const maxCat = Math.max(1, ...byCat.map(g => g.mrp));
    $('valWrap').innerHTML = `
      <div class="inv-vtiles">
        ${tile('g', 'Total stock at cost', v.cost_total, 'All batches on hand')}
        ${tile('b', 'Purchase value (sellable)', v.cost_sellable, 'Sellable stock at cost')}
        ${tile('p', 'Sellable stock at MRP', mrpValue, `${sellB.length} sellable batches`)}
        ${tile('t', 'Potential sales value', salesValue, 'MRP less each medicine\'s discount')}
        ${tile('a', 'Expected margin', margin, salesValue ? `${(margin / salesValue * 100).toFixed(1)}% of sales value` : '—')}
        ${tile('r', 'Expired stock at cost', v.cost_expired, 'Write-off risk')}
        ${tile('o', 'Quarantined at cost', v.cost_quarantined, 'Held back from billing')}
        ${tile('s', 'Sellable at selling price', v.retail_sellable, 'Medicine master selling price')}
      </div>
      <div class="inv-two">
        <section class="pos-card inv-sub"><div class="dl-card-head"><h2>${I.layers}Value by category</h2></div>
          <div class="inv-bars">${byCat.map(g => `<div><span>${esc(g.k)}</span><i><em style="width:${(g.mrp / maxCat * 100).toFixed(1)}%"></em></i><b>${rupees0(g.mrp)}</b></div>`).join('') || '<p class="dl-empty">No stock.</p>'}</div>
          ${plainTable('', ['Category', '>Batches', '>Units', '>At cost (₹)', '>At MRP (₹)', '>Sales value (₹)'], grpRows(byCat), 'No stock.')}</section>
        <section class="pos-card inv-sub"><div class="dl-card-head"><h2>${I.pill}Top 10 medicines by value</h2></div>
          ${plainTable('', ['Medicine', '>Batches', '>Units', '>At cost (₹)', '>At MRP (₹)', '>Sales value (₹)'], grpRows(byMed), 'No stock.')}</section>
      </div>
      <p class="dl-muted inv-foot">Totals at cost use each batch's purchase cost per base unit, or the medicine's latest purchase price when a batch has none. Category and medicine rows at cost use batch cost only.</p>`;
    $('valExp').onclick = () => exportRows(byCat.map(g => ({ Category: g.k, Batches: g.batches, Units: g.units, 'At cost (₹)': Math.round(g.cost * 100) / 100, 'At MRP (₹)': Math.round(g.mrp * 100) / 100, 'Sales value (₹)': Math.round(g.sell * 100) / 100 })), 'Valuation');
  },

  // ---------- Movements
  async moves(opts = {}) {
    const type = opts.type ?? '';
    $('tab-moves').innerHTML = `
      ${paneHead(I.history, 'Stock Movements', 'Every change to stock — purchases, sales, returns, adjustments, counts, write-offs and transfers.', `<button type="button" class="pos-btn" id="mvExp">${I.download}<span>Export</span></button>`)}
      <div class="inv-mfilters">
        <label class="dl-select">${I.layers}<select id="mt" aria-label="Movement type"><option value="">All types</option><option value="__in" ${type === '__in' ? 'selected' : ''}>All stock in</option><option value="__out" ${type === '__out' ? 'selected' : ''}>All stock out</option><option value="__adj" ${type === '__adj' ? 'selected' : ''}>All adjustments</option>${MOVE_TYPES.map(t => `<option value="${t}" ${t === type ? 'selected' : ''}>${t.replace(/_/g, ' ')}</option>`).join('')}</select></label>
        <label class="inv-date">From <input id="mfrom" type="date" value="${opts.from || ''}"></label>
        <label class="inv-date">To <input id="mto" type="date"></label>
        <label class="dl-search">${I.search}<input id="mq" type="search" placeholder="Medicine name" autocomplete="off"></label>
      </div>
      <div class="inv-msum" id="msum"></div>
      <div class="dl-table-wrap" id="mr"><p class="dl-empty">Loading…</p></div>
      <div class="dl-pager md-pager"><span id="mInfo"></span><div id="mPager"></div></div>
      ${branches?.length ? `<section class="pos-card inv-sub inv-trf"><div class="dl-card-head"><h2>${I.truck}Branch transfers</h2>${canAdjust ? `<button type="button" class="dl-link" id="trfNew">New transfer ${I.chev}</button>` : ''}</div><div id="trfList"><p class="dl-empty">Loading…</p></div></section>` : ''}`;
    let rows = [], mpage = 1;
    const paint = () => {
      const per = 25, pages = Math.max(1, Math.ceil(rows.length / per)); mpage = Math.min(mpage, pages);
      $('mr').innerHTML = moveTable(rows.slice((mpage - 1) * per, mpage * per), true);
      $('mInfo').textContent = rows.length ? `Showing ${(mpage - 1) * per + 1} – ${Math.min(mpage * per, rows.length)} of ${rows.length}${rows.length >= 500 ? '+' : ''} movements` : '';
      $('mPager').innerHTML = pages > 1 ? `<button type="button" data-p="${mpage - 1}" ${mpage === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button><button type="button" class="on">${mpage} / ${pages}</button><button type="button" data-p="${mpage + 1}" ${mpage === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
      const inQ = rows.filter(m => m.qty > 0).reduce((s, m) => s + Number(m.qty), 0), outQ = rows.filter(m => m.qty < 0).reduce((s, m) => s - Number(m.qty), 0);
      $('msum').innerHTML = `<span class="in">${I.upArrow}<b>${count(inQ)}</b> units in</span><span class="out">${I.downArrow}<b>${count(outQ)}</b> units out</span><span>${I.list}<b>${rows.length}</b> entries</span>`;
    };
    $('mPager').onclick = e => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) { mpage = +b.dataset.p; paint(); } };
    const go = async () => {
      let q = sb.from('stock_movements').select('created_at,movement_type,qty,reason,medicine_id,medicines(name),medicine_batches(batch_no)').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(500);
      const t = $('mt').value;
      if (t === '__in') q = q.gt('qty', 0); else if (t === '__out') q = q.lt('qty', 0);
      else if (t === '__adj') q = q.in('movement_type', ['adjustment', 'damage', 'expiry_writeoff', 'physical_count']);
      else if (t) q = q.eq('movement_type', t);
      if ($('mfrom').value) q = q.gte('created_at', new Date($('mfrom').value + 'T00:00:00+05:30').toISOString());
      if ($('mto').value) q = q.lt('created_at', new Date(addDays($('mto').value, 1) + 'T00:00:00+05:30').toISOString());
      const term = $('mq').value.trim().toLowerCase();
      const ids = term ? [...meds.values()].filter(m => m.name.toLowerCase().includes(term)).map(m => m.id) : null;
      if (ids) { if (!ids.length) { rows = []; paint(); return; } q = q.in('medicine_id', ids.slice(0, 200)); }
      const { data, error } = await q;
      if (error) { $('mr').innerHTML = `<p class="pos-form-msg">${esc(friendly(error))}</p>`; return; }
      rows = data || []; mpage = 1; paint();
    };
    $('mt').onchange = $('mfrom').onchange = $('mto').onchange = go;
    let t; $('mq').oninput = () => { clearTimeout(t); t = setTimeout(go, 250); };
    $('mvExp').onclick = () => exportRows(rows.map(m => ({ 'When (IST)': when(m.created_at), Medicine: m.medicines?.name || meds.get(m.medicine_id)?.name || '', Batch: m.medicine_batches?.batch_no || '', Type: m.movement_type, Qty: Number(m.qty), Reason: m.reason || '' })), 'Movements');
    $('trfNew')?.addEventListener('click', () => openTransfer());
    await go();
    if (branches?.length) {
      const { data } = await sb.from('stock_transfers').select('transfer_no,qty,reason,created_at,from_branch_id,to_branch_id,medicine_id,to_medicine_id').order('created_at', { ascending: false }).limit(50);
      const bn = new Map(branches.map(b => [b.id, b.name]));
      $('trfList').innerHTML = plainTable('', ['When', 'Transfer no.', 'Medicine', 'Direction', '>Qty', 'Reason'], (data || []).map(x => `<tr><td>${esc(when(x.created_at))}</td><td>${esc(x.transfer_no)}</td><td>${esc(meds.get(x.medicine_id)?.name || meds.get(x.to_medicine_id)?.name || '—')}</td><td>${x.from_branch_id === branchId ? `<span class="inv-dir out">→ ${esc(bn.get(x.to_branch_id) || 'other branch')}</span>` : `<span class="inv-dir in">← ${esc(bn.get(x.from_branch_id) || 'other branch')}</span>`}</td><td class="c-r">${count(x.qty)}</td><td>${esc(x.reason)}</td></tr>`).join(''), 'No transfers yet.');
    }
  }
};
function moveTable(data, withMed) {
  return `<table class="dl-table md-plain inv-mtable"><thead><tr><th>When (IST)</th>${withMed ? '<th>Medicine</th>' : ''}<th>Batch</th><th>Type</th><th class="c-r">Qty</th><th>Reason</th></tr></thead><tbody>${data.map(m => `<tr><td>${esc(when(m.created_at))}</td>${withMed ? `<td>${esc(m.medicines?.name || meds.get(m.medicine_id)?.name || '')}</td>` : ''}<td>${esc(m.medicine_batches?.batch_no || '')}</td><td><span class="inv-mt t-${esc(m.movement_type)}">${esc(String(m.movement_type).replace(/_/g, ' '))}</span></td><td class="c-r inv-q ${m.qty < 0 ? 'down' : 'up'}">${m.qty > 0 ? '+' : ''}${count(m.qty)}</td><td>${esc(m.reason || '')}</td></tr>`).join('') || `<tr><td colspan="${withMed ? 6 : 5}" class="dl-empty">No movements.</td></tr>`}</tbody></table>`;
}
function exportRows(rows, name) {
  if (!rows.length) return toast('Nothing to export.', true);
  if (window.XLSX) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(36, Math.max(10, k.length + 2)) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30));
    XLSX.writeFile(wb, `Pallikkal_${name}_${today}.xlsx`);
  } else {
    const keys = Object.keys(rows[0]);
    const csv = [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `Pallikkal_${name}_${today}.csv`; a.click();
  }
  toast(`${rows.length} row(s) exported.`);
}
$('invTabs').onclick = e => { const b = e.target.closest('[data-k]'); if (b) showTab(b.dataset.k, { scroll: false }); };
document.querySelector('.inv').addEventListener('click', e => {
  const j = e.target.closest('[data-jump]'); if (j) { $(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const pane = e.target.closest('.inv-pane'); if (!pane) return;
  const el = e.target.closest('[data-do],[data-q],[data-st]');
  if (el && el.dataset.do === 'writeoff') { const b = byBatch(el.dataset.b); if (b) { openAdjust(b); $('ak').value = 'expiry_writeoff-'; $('aq').value = b.qty; $('ar').value = 'Expired stock written off'; $('anew').value = count(newQty()); } return; }
  if (el) { doAction(el); return; }
  const tr = e.target.closest('tr[data-batch]'); if (tr && !e.target.closest('button,a,input')) batchDetails(byBatch(tr.dataset.batch));
});

// ---------------------------------------------------------------- header actions
function batchPicker(title, onPick, filterFn = () => true) {
  dlg(`<h3>${title}</h3><div class="pos-field"><label for="bpQ">Medicine, batch or barcode</label><input id="bpQ" type="search" placeholder="Start typing…" autocomplete="off"></div><div class="dl-pick" id="bpList"></div>`);
  const paint = () => {
    const q = $('bpQ').value.trim().toLowerCase();
    const list = batches.filter(filterFn).filter(b => !q || `${b.name} ${b.batch_no} ${b.barcode}`.toLowerCase().includes(q)).slice(0, 40);
    $('bpList').innerHTML = list.map(b => `<button type="button" data-pick="${esc(b.batch_id)}"><b>${esc(b.name)}</b><span>${esc(b.batch_no)} · exp ${esc(monthYear(b.expiry))}</span><em>${count(b.qty)}</em><small>${esc(state(b))}${b.location ? ` · ${esc(b.location)}` : ''}</small></button>`).join('') || '<p class="dl-empty">No batch matches.</p>';
  };
  $('bpQ').oninput = paint;
  $('bpList').onclick = e => { const b = e.target.closest('[data-pick]'); if (b) { $('ivDlg').close(); onPick(byBatch(b.dataset.pick)); } };
  paint();
  $('bpQ').focus();
}
$('updBtn').onclick = () => {
  dlg(`<h3>Update stock</h3><p class="dl-muted">Choose how the stock changes. Every change is recorded as a stock movement.</p>
    <div class="inv-choices">
      ${canPurchase ? `<a href="purchases.html?new=1">${I.bag}<span><b>Receive a purchase</b><small>Enter a supplier bill — adds new batches with MRP and cost</small></span></a>` : ''}
      ${admin ? `<button type="button" data-v="opening">${I.fileUp}<span><b>Initial stock</b><small>Opening stock entry or Excel upload</small></span></button>` : ''}
      ${canAdjust ? `<button type="button" data-v="count">${I.clip}<span><b>Physical count</b><small>Enter counted quantities; differences are adjusted</small></span></button>
      <button type="button" data-v="adjust">${I.swap}<span><b>Adjust one batch</b><small>Stock found, correction, damage or expiry write-off</small></span></button>` : ''}
      ${can('returns') ? `<a href="returns.html">${I.history}<span><b>Returns</b><small>Customer returns add stock; supplier returns remove it</small></span></a>` : ''}
    </div>`);
  $('panel').querySelector('.inv-choices').onclick = e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    if (b.dataset.v === 'adjust') return batchPicker('Adjust stock — choose a batch', openAdjust);
    $('ivDlg').close();
    showTab(b.dataset.v);
  };
};
const can = page => ({ returns: ['super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory'] })[page]?.includes(prof.role);
$('adjBtn')?.addEventListener('click', () => batchPicker('Stock adjustment — choose a batch', openAdjust));

function openTransfer(b = null) {
  if (branches == null) return dlg(`<h3>Stock transfer</h3><p>Stock transfer needs database migration <b>0023_inventory_stock_transfer.sql</b>. Run it once in Supabase, then refresh.</p>`);
  if (!branches.length) return dlg(`<h3>Stock transfer</h3><p>Stock moves between branches of the same pharmacy. This pharmacy has only one active branch, so there is nowhere to transfer to yet.</p><p class="dl-muted">When a second branch is added, its name appears here.</p>`);
  if (!b) return batchPicker('Stock transfer — choose a batch', openTransfer, x => x.qty > 0 && x.status === 'ok' && (x.stock_status || 'active') === 'active');
  dlg(`<h3>Transfer ${esc(b.name)} · ${esc(b.batch_no)}</h3>
    <p class="dl-muted">In stock: <b>${count(b.qty)}</b> · expiry ${esc(monthYear(b.expiry))} · MRP ${b.mrpShown == null ? '—' : `₹${money(b.mrpShown)}`}. Stock reserved by open bills cannot be moved.</p>
    <div class="md-form-grid">
      <div class="pos-field"><label for="tBranch">To branch</label><select id="tBranch">${branches.map(x => `<option value="${esc(x.id)}">${esc(x.name)}${x.city ? ` · ${esc(x.city)}` : ''}</option>`).join('')}</select></div>
      <div class="pos-field"><label for="tQty">Quantity</label><input id="tQty" type="number" min="0.001" max="${b.qty}" step="any"></div>
      <div class="pos-field md-span-2"><label for="tWhy">Reason *</label><input id="tWhy" maxlength="300" placeholder="e.g. weekend demand at town branch"></div>
    </div>
    <p class="pos-form-msg" id="tMsg"></p>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="tSave">${I.truck}<span>Transfer stock</span></button></div>`);
  $('tQty').focus();
  $('tSave').onclick = async () => {
    const q = Number($('tQty').value);
    if (!(q > 0)) return ($('tMsg').textContent = 'Enter a quantity.');
    if (q > b.qty) return ($('tMsg').textContent = `Only ${count(b.qty)} in this batch.`);
    if ($('tWhy').value.trim().length < 3) return ($('tMsg').textContent = 'Enter a reason.');
    $('tSave').disabled = true;
    const { error } = await sb.rpc('stock_transfer', { p_batch: b.batch_id, p_qty: q, p_to_branch: $('tBranch').value, p_reason: $('tWhy').value.trim() });
    $('tSave').disabled = false;
    if (error) return ($('tMsg').textContent = friendly(error));
    $('ivDlg').close();
    await refresh();
    note(`${count(q)} of ${b.name} (${b.batch_no}) transferred to ${branches.find(x => x.id === $('tBranch')?.value)?.name || 'the other branch'}.`);
  };
}
$('trfBtn')?.addEventListener('click', () => openTransfer());

$('expBtn').onclick = () => {
  const rows = filtered().map(b => ({
    Medicine: b.name, Strength: b.strength, Form: b.form, Category: b.category, 'Manufacturer / brand': b.manufacturer, Barcode: b.barcode,
    'Batch No.': b.batch_no, Expiry: b.expiry, 'Days to expiry': daysTo(b.expiry), 'MRP (₹)': b.mrpShown ?? '', Quantity: b.qty,
    'Stock value at MRP (₹)': b.value == null ? '' : Math.round(b.value * 100) / 100, ...(admin ? { 'Unit cost (₹)': b.unit_cost ?? '', 'Value at cost (₹)': b.unit_cost == null ? '' : Math.round(b.unit_cost * b.qty * 100) / 100 } : {}),
    Status: statusKey(b) === 'blk' ? STATUS_LABEL[b.stock_status] : CHIP[statusKey(b)][0], Location: b.location, 'Reorder level': b.reorder_level
  }));
  if (!rows.length) return toast('Nothing to export with these filters.', true);
  if (window.XLSX) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(36, Math.max(10, k.length + 2)) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    XLSX.writeFile(wb, `Pallikkal_Inventory_${today}.xlsx`);
  } else {
    const keys = Object.keys(rows[0]);
    const csv = [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `Pallikkal_Inventory_${today}.csv`; a.click();
  }
  toast(`${rows.length} batch(es) exported.`);
};

// side-card links
$('valInfo').onclick = () => admin ? showTab('val') : dlg('<h3>Stock value</h3><p>Sellable stock is valued at each batch\'s MRP; potential sales value deducts each medicine\'s discount. Purchase-cost values are visible to administrators only.</p>');
$('movesAll').onclick = () => showTab('moves');
$('mvBody').onclick = e => { const b = e.target.closest('[data-mv]'); if (!b) return; showTab('moves', { type: { in: '__in', out: '__out', transfer: 'transfer', adj: '__adj' }[b.dataset.mv], from: istDay(Date.now() - 6 * 864e5) }); };
$('alertsAll').onclick = () => showTab('alerts');

// ---------------------------------------------------------------- filters
let st;
$('s').oninput = () => { clearTimeout(st); st = setTimeout(() => { page = 1; draw(); }, 200); };
['fl', 'fCat', 'perPage'].forEach(id => $(id).onchange = () => { page = 1; draw(); });
$('pager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); draw(); } };
const pop = $('filterPop');
$('filterBtn').onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; };
pop.onclick = e => e.stopPropagation();
document.addEventListener('click', () => { pop.hidden = true; });
$('fApply').onclick = () => { filters.within = $('fWithin').value; filters.man = $('fMan').value; filters.rack = $('fRack').value.trim(); filters.empty = $('fEmpty').checked; near = Math.max(1, Number($('nd').value) || 90); pop.hidden = true; page = 1; renderExpiry(); draw(); };
$('fReset').onclick = () => { Object.assign(filters, { within: '', man: '', rack: '', empty: false }); near = 90; $('fWithin').value = $('fRack').value = ''; $('fMan').value = ''; $('fEmpty').checked = false; $('nd').value = 90; pop.hidden = true; page = 1; renderExpiry(); draw(); };
document.querySelector('.md-kpis').onclick = e => {
  const b = e.target.closest('[data-kpi]'); if (!b) return;
  if (b.dataset.kpi === 'kExp') { $('fl').value = ''; filters.within = '30'; $('fWithin').value = '30'; }
  else { $('fl').value = { kItems: '', kStock: 'in', kLow: 'low' }[b.dataset.kpi]; filters.within = ''; $('fWithin').value = ''; }
  page = 1; draw();
  $('r').closest('.md-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ---------------------------------------------------------------- start
const params = new URLSearchParams(location.search);
if (params.get('q')) $('s').value = params.get('q');
if (params.get('status')) $('fl').value = params.get('status');
await refresh();
if (params.get('view')) showTab(params.get('view'), { scroll: false });
