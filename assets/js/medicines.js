
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { nul, friendly, opts, safeQ } from './ui.js';

// Authenticate user and mount dashboard navigation
const prof = await mountShell('medicines', 'Medicines');

if (!prof) {
  throw new Error('Unable to load user profile.');
}

const v = document.getElementById('view');
const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const branchId = prof.branch_id;

if (!branchId) {
  v.textContent = 'Your profile has no assigned branch. Contact the administrator.';
  throw new Error('Missing profile branch_id.');
}

// Load master data
const lk = {};

for (const t of [
  'categories',
  'manufacturers',
  'units',
  'storage_locations'
]) {
  const { data, error } = await sb
    .from(t)
    .select('*')
    .eq('active', true)
    .order('name');

  if (error) {
    console.error(`Could not load ${t}:`, error);
  }

  lk[t] = data || [];
}

// Medicine page
v.innerHTML = `
<div style="display:flex;gap:.5rem;flex-wrap:wrap">
  <input
    id="q"
    placeholder="Search name, brand, generic, barcode, SKU"
    style="flex:1;min-width:220px"
  >
  <label>
    <input type="checkbox" id="inact">
    show inactive
  </label>
  <button id="new">+ Add medicine</button>
</div>

<div id="msg"></div>

<div style="overflow-x:auto">
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Brand / generic</th>
        <th>Strength</th>
        <th>MRP</th>
        <th>Price</th>
        <th>Tax</th>
        <th>Location</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
</div>

<dialog id="ph">
  <div id="phb" style="min-width:min(92vw,640px);overflow-x:auto"></div>
  <button class="sec" onclick="ph.close()">Close</button>
</dialog>

<dialog id="dlg">
  <form
    id="f"
    method="dialog"
    style="display:grid;gap:.5rem;min-width:min(92vw,520px)"
  >
    <h3 id="dt"></h3>

    <input type="hidden" name="id">

    <input name="name" placeholder="Medicine name *" required>
    <input name="brand" placeholder="Brand">
    <input name="generic_name" placeholder="Generic name">
    <input name="composition" placeholder="Composition">
    <input name="strength" placeholder="Strength (e.g. 500 mg)">
    <input name="dosage_form" placeholder="Dosage form (tablet, syrup…)">

    <select name="category_id"></select>
    <select name="manufacturer_id"></select>
    <select name="base_unit_id"></select>

    <input name="barcode" placeholder="Barcode">
    <input name="sku" placeholder="SKU">

    <input
      name="mrp"
      type="number"
      step="0.01"
      min="0"
      placeholder="MRP ₹ *"
      required
    >

    <input
      name="selling_price"
      type="number"
      step="0.01"
      min="0"
      placeholder="Selling price ₹ *"
      required
    >

    <input
      name="tax_rate"
      type="number"
      step="0.01"
      min="0"
      max="40"
      placeholder="Tax % *"
      required
    >

    <input
      name="reorder_level"
      type="number"
      step="any"
      min="0"
      placeholder="Reorder level (low-stock alert)"
    >

    <select name="storage_location_id"></select>
    <input name="rack" placeholder="Rack / shelf">

    <label>
      <input type="checkbox" name="active" checked>
      Active
    </label>

    <div id="err" style="color:#b91c1c"></div>

    <div style="display:flex;gap:.5rem">
      <button value="save">Save</button>
      <button type="button" class="sec" id="cancel">Cancel</button>
    </div>
  </form>
</dialog>
`;

const $ = id => document.getElementById(id);
const f = $('f');

const COLS = [
  'id',
  'branch_id',
  'name',
  'brand',
  'generic_name',
  'composition',
  'strength',
  'dosage_form',
  'barcode',
  'sku',
  'mrp',
  'selling_price',
  'tax_rate',
  'reorder_level',
  'shelf_location',
  'rack',
  'active',
  'category_id',
  'manufacturer_id',
  'storage_location_id',
  'base_unit_id'
].join(',');

let list = [];

// Load medicines belonging to the current branch
async function load() {
  $('msg').textContent = 'Loading medicines...';

  let qb = sb
    .from('medicines')
    .select(COLS)
    .eq('branch_id', branchId)
    .order('name')
    .limit(200);

  if (!$('inact').checked) {
    qb = qb.eq('active', true);
  }

  const s = safeQ($('q').value);

  if (s) {
    qb = qb.or(
      ['name', 'brand', 'generic_name', 'barcode', 'sku']
        .map(c => `${c}.ilike.%${s}%`)
        .join(',')
    );
  }

  const { data, error } = await qb;

  if (error) {
    $('msg').textContent = friendly(error);
    console.error('Medicine loading failed:', error);
    return;
  }

  list = data || [];
  $('msg').textContent = '';

  const loc = id =>
    lk.storage_locations.find(l => l.id === id)?.name || '';

  $('rows').innerHTML = list.map(m => `
    <tr style="${m.active ? '' : 'opacity:.5'}">
      <td>${esc(m.name)}</td>
      <td>${esc(m.brand || '')} ${esc(m.generic_name || '')}</td>
      <td>${esc(m.strength || '')}</td>
      <td>${inr(m.mrp)}</td>
      <td>${inr(m.selling_price)}</td>
      <td>${m.tax_rate}%</td>
      <td>
        ${esc(loc(m.storage_location_id))}
        ${esc(m.rack || '')}
      </td>
      <td>
        <button class="sec" data-e="${m.id}">Edit</button>
        <button class="sec" data-t="${m.id}">
          ${m.active ? 'Deactivate' : 'Activate'}
        </button>
        ${isAdmin
          ? `<button class="sec" data-p="${m.id}">Cost history</button>`
          : ''
        }
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="8">No medicines found.</td>
    </tr>
  `;
}

// Open add/edit form
function open(m = {}) {
  $('dt').textContent = m.id ? 'Edit medicine' : 'Add medicine';
  $('err').textContent = '';

  f.reset();

  f.category_id.innerHTML =
    opts(lk.categories, m.category_id);

  f.manufacturer_id.innerHTML =
    opts(lk.manufacturers, m.manufacturer_id);

  f.base_unit_id.innerHTML =
    opts(lk.units, m.base_unit_id);

  f.storage_location_id.innerHTML =
    opts(lk.storage_locations, m.storage_location_id);

  for (const k of [
    'id',
    'name',
    'brand',
    'generic_name',
    'composition',
    'strength',
    'dosage_form',
    'barcode',
    'sku',
    'mrp',
    'selling_price',
    'tax_rate',
    'reorder_level',
    'rack'
  ]) {
    f[k].value =
      m[k] ?? (
        k === 'tax_rate' ? 12 :
        k === 'reorder_level' ? 0 :
        ''
      );
  }

  f.active.checked = m.active ?? true;

  $('dlg').showModal();
}

// Save medicine
f.onsubmit = async e => {
  e.preventDefault();

  $('err').textContent = '';

  const d = Object.fromEntries(new FormData(f));
  const id = d.id;
  delete d.id;

  const row = {
    ...Object.fromEntries(
      Object.entries(d).map(([k, x]) => [
        k,
        nul(x.trim?.() ?? x)
      ])
    ),
    active: f.active.checked
  };

  // Always use the authenticated user's actual branch
  if (!branchId) {
    $('err').textContent =
      'Your profile has no assigned branch.';
    return;
  }

  // Convert numeric fields
  for (const k of [
    'mrp',
    'selling_price',
    'tax_rate',
    'reorder_level'
  ]) {
    row[k] = Number(row[k] || 0);
  }

  if (
    !Number.isFinite(row.mrp) ||
    !Number.isFinite(row.selling_price) ||
    !Number.isFinite(row.tax_rate) ||
    !Number.isFinite(row.reorder_level)
  ) {
    $('err').textContent = 'Please enter valid numeric values.';
    return;
  }

  if (row.selling_price > row.mrp) {
    $('err').textContent =
      'Selling price cannot exceed MRP.';
    return;
  }

  // Set shelf location name for billing display
  row.shelf_location =
    lk.storage_locations.find(
      l => l.id === row.storage_location_id
    )?.name || null;

  let result;

  if (id) {
    // Update only a medicine belonging to this branch.
    // Do not allow changing its branch through this form.
    delete row.branch_id;

    result = await sb
      .from('medicines')
      .update(row)
      .eq('id', id)
      .eq('branch_id', branchId);
  } else {
    // New medicines must belong to the logged-in user's branch.
    row.branch_id = branchId;

    result = await sb
      .from('medicines')
      .insert(row);
  }

  if (result.error) {
    $('err').textContent = friendly(result.error);
    console.error('Medicine save failed:', result.error);
    return;
  }

  $('dlg').close();
  await load();
};

// Medicine actions
$('rows').onclick = async e => {
  const b = e.target.closest('button');

  if (!b) return;

  if (b.dataset.p) {
    if (!isAdmin) return;

    const { data, error } = await sb.rpc(
      'purchase_history',
      { p_medicine: b.dataset.p }
    );

    $('phb').innerHTML = error
      ? esc(friendly(error))
      : `
        <h3>Purchase history (admin only)</h3>

        <p>
          Current cost per base unit:
          ${data?.[0] ? inr(data[0].current_cost) : '—'}
        </p>

        <table>
          <tr>
            <th>Date</th>
            <th>Invoice</th>
            <th>Distributor</th>
            <th>Batch</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Tax</th>
          </tr>

          ${(data || []).map(r => `
            <tr>
              <td>${esc(r.invoice_date)}</td>
              <td>${esc(r.supplier_invoice_no)}</td>
              <td>${esc(r.distributor)}</td>
              <td>${esc(r.batch_no)}</td>
              <td>${r.qty}</td>
              <td>${inr(r.unit_price)}</td>
              <td>${r.tax_rate}%</td>
            </tr>
          `).join('') || `
            <tr>
              <td colspan="7">No purchases yet.</td>
            </tr>
          `}
        </table>
      `;

    $('ph').showModal();
    return;
  }

  if (b.dataset.e) {
    const m = list.find(x => x.id === b.dataset.e);

    if (m) open(m);
    return;
  }

  if (b.dataset.t) {
    const m = list.find(x => x.id === b.dataset.t);

    if (!m) return;

    const { error } = await sb
      .from('medicines')
      .update({ active: !m.active })
      .eq('id', m.id)
      .eq('branch_id', branchId);

    if (error) {
      $('msg').textContent = friendly(error);
      console.error('Medicine status update failed:', error);
      return;
    }

    await load();
  }
};

// Page controls
$('new').onclick = () => open();

$('cancel').onclick = () => {
  $('dlg').close();
};

$('inact').onchange = load;

let t;

$('q').oninput = () => {
  clearTimeout(t);
  t = setTimeout(load, 250);
};

// Initial load
await load();
