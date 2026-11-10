
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { nul, friendly, opts, safeQ } from './ui.js';
import { mountMedicinePhotos } from './medicine-photos.js';

// Authenticate user and mount dashboard navigation
const prof = await mountShell('medicines', 'Medicines');

if (!prof) {
  throw new Error('Unable to load user profile.');
}

const v = document.getElementById('view');
const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const isSuperAdmin = prof.role === 'super_admin';
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

${isSuperAdmin ? `
  <section style="background:white;padding:16px;border-radius:10px;
                  margin:15px 0;border:1px solid #ddd">
    <h3>Medicine Deactivation Requests</h3>
    <div id="deactivationRequests">
      Loading pending requests...
    </div>
  </section>
` : ''}

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

    <div id="activeNote" style="font-size:13px;color:#64748b"></div>

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

        ${m.active
          ? `<button class="sec" data-t="${m.id}">Request deactivation</button>`
          : isSuperAdmin
            ? `<button class="sec" data-t="${m.id}">Activate</button>`
            : ''
        }

        ${isAdmin
          ? `<button class="sec" data-p="${m.id}">Cost history</button>`
          : ''
        }

        <button class="sec" data-photos="${m.id}">Photos</button>
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
  $('activeNote').textContent = '';

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

  // Only Super Admin can change medicine active status here.
  f.active.disabled = !isSuperAdmin;

  if (!isSuperAdmin) {
    $('activeNote').textContent =
      'Medicine activation and deactivation require Super Admin approval.';
  }

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

    // Preserve existing active status for non-Super Admin users.
    if (!isSuperAdmin) {
      const existingMedicine = list.find(m => m.id === id);

      if (!existingMedicine) {
        $('err').textContent = 'Medicine not found. Refresh and try again.';
        return;
      }

      row.active = existingMedicine.active;
    }

    result = await sb
      .from('medicines')
      .update(row)
      .eq('id', id)
      .eq('branch_id', branchId);
  } else {
    // New medicines must belong to the logged-in user's branch.
    row.branch_id = branchId;

    // New medicines are created active.
    row.active = true;

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

  // Cost history
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

  // Edit medicine
  if (b.dataset.e) {
    const m = list.find(x => x.id === b.dataset.e);

    if (m) open(m);
    return;
  }

  // Deactivation request or Super Admin activation
  if (b.dataset.t) {
    const m = list.find(x => x.id === b.dataset.t);

    if (!m) return;

    // Active medicine: submit a deactivation request.
    // Do not directly update medicines.active.
    if (m.active) {
      const reason = prompt(
        `Why do you want to deactivate ${m.name}?`
      );

      if (reason === null) return;

      if (!reason.trim()) {
        $('msg').textContent = 'Please enter a reason.';
        return;
      }

      const { data, error } = await sb.rpc(
        'request_medicine_deactivation',
        {
          p_medicine: m.id,
          p_reason: reason.trim()
        }
      );

      if (error) {
        $('msg').textContent = friendly(error);
        console.error('Deactivation request failed:', error);
        return;
      }

      $('msg').textContent =
        data
          ? 'Deactivation request submitted. The medicine remains active until Super Admin approval.'
          : 'Deactivation request submitted.';

      return;
    }

    // Inactive medicine: only Super Admin can activate.
    if (!isSuperAdmin) {
      $('msg').textContent =
        'Only Super Admin can activate an inactive medicine.';
      return;
    }

    if (!confirm(`Activate ${m.name}?`)) return;

    const { error } = await sb
      .from('medicines')
      .update({ active: true })
      .eq('id', m.id)
      .eq('branch_id', branchId);

    if (error) {
      $('msg').textContent = friendly(error);
      console.error('Medicine activation failed:', error);
      return;
    }

    $('msg').textContent = 'Medicine activated.';
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

// Attach branch-scoped medicine photo controls.
mountMedicinePhotos({
  sb,
  branchId,
  canManage: [
    'super_admin',
    'admin',
    'pharmacist',
    'inventory_staff'
  ].includes(prof.role)
});

// --------------------------------------------------
// SUPER ADMIN: Medicine deactivation approvals
// --------------------------------------------------

async function loadDeactivationRequests() {
  if (!isSuperAdmin) return;

  const panel = $('deactivationRequests');
  if (!panel) return;

  panel.textContent = 'Loading pending requests...';

  const { data, error } = await sb.rpc(
    'medicine_deactivation_request_list'
  );

  if (error) {
    console.error('Could not load deactivation requests:', error);
    panel.textContent = friendly(error);
    return;
  }

  if (!data || data.length === 0) {
    panel.innerHTML = `
      <p>No pending medicine deactivation requests.</p>
      <button type="button" class="sec" id="refreshDeactivation">
        Refresh
      </button>
    `;
    return;
  }

  panel.innerHTML = `
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Medicine</th>
            <th>Requested by</th>
            <th>Reason</th>
            <th>Requested at</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td>
                <b>${esc(r.medicine_name)}</b><br>
                ${esc(r.medicine_strength || '')}
              </td>
              <td>
                ${esc(r.requested_by_name)}<br>
                <small>${esc(r.requested_by_staff_id || '')}</small>
              </td>
              <td>${esc(r.reason)}</td>
              <td>
                ${r.requested_at
                  ? new Date(r.requested_at).toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata'
                    })
                  : '—'}
              </td>
              <td>
                <button
                  type="button"
                  data-approve="${r.request_id}"
                >Approve</button>

                <button
                  type="button"
                  class="sec"
                  data-reject="${r.request_id}"
                >Reject</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <button type="button" class="sec" id="refreshDeactivation">
      Refresh requests
    </button>
  `;

  panel.querySelector('#refreshDeactivation').onclick =
    loadDeactivationRequests;

  panel.onclick = async event => {
    const button = event.target.closest('button');
    if (!button) return;

    const requestId = button.dataset.approve ||
                      button.dataset.reject;

    if (!requestId) return;

    const approve = Boolean(button.dataset.approve);

    const note = prompt(
      approve
        ? 'Approval note (optional):'
        : 'Reason for rejecting this request (optional):'
    );

    if (note === null) return;

    const confirmation = approve
      ? 'Approve this request and deactivate the medicine?'
      : 'Reject this medicine deactivation request?';

    if (!confirm(confirmation)) return;

    button.disabled = true;
    button.textContent = 'Processing...';

    const { data: result, error: reviewError } = await sb.rpc(
      'review_medicine_deactivation',
      {
        p_request: requestId,
        p_approve: approve,
        p_note: note.trim() || null
      }
    );

    if (reviewError || result !== true) {
      alert(
        reviewError
          ? friendly(reviewError)
          : 'The request could not be processed.'
      );

      await loadDeactivationRequests();
      return;
    }

    alert(
      approve
        ? 'Approved. The medicine has been deactivated.'
        : 'Request rejected. The medicine remains active.'
    );

    await loadDeactivationRequests();
    await load();
  };
};

// Load the approval panel for Super Admin.
if (isSuperAdmin) {
  await loadDeactivationRequests();
}
