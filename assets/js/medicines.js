
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
<style>
  .med-page{display:grid;gap:16px}.med-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:#fff;border:1px solid #d8e3df;border-radius:14px;padding:14px}
  .med-toolbar input[type=search]{flex:1;min-width:240px}.med-card{background:#fff;border:1px solid #d8e3df;border-radius:14px;padding:16px;box-shadow:0 3px 14px #102c2410}
  .med-table-wrap{overflow:auto}.med-table{width:100%;border-collapse:collapse;min-width:780px}.med-table th{background:#eff5f2;color:#526b65;font-size:12px;text-align:left;padding:12px}.med-table td{padding:11px 12px;border-top:1px solid #e4ece8;vertical-align:middle}
  .med-name-cell{display:flex;align-items:center;gap:10px;min-width:210px}.med-thumb{width:42px;height:42px;border-radius:9px;object-fit:cover;background:#eff4f1;border:1px solid #dce6e1}.med-thumb-placeholder{display:grid;place-items:center;color:#0b8177;font-weight:800}
  .med-actions{display:flex;gap:6px;flex-wrap:wrap}.med-primary{background:#087f75;color:#fff;border:1px solid #087f75}.med-secondary{background:#fff;color:#087f75;border:1px solid #0c8c80}.med-field{display:grid;gap:6px}.med-field label{font-size:13px;font-weight:700;color:#20332f}.med-field input,.med-field textarea{width:100%;box-sizing:border-box}.med-field textarea{min-height:132px;resize:vertical}.med-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.med-span-2{grid-column:1/-1}.med-checks{display:flex;gap:22px;flex-wrap:wrap;padding:12px;background:#f4f8f6;border-radius:10px}.med-checks label{display:flex;align-items:center;gap:8px;font-weight:600}.med-dialog{border:0;border-radius:16px;padding:0;width:min(900px,94vw);max-height:90vh;box-shadow:0 20px 70px #102b2570}.med-dialog::backdrop{background:#102b2580}.med-dialog-inner{padding:22px;max-height:90vh;overflow:auto}.med-dialog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px}.med-detail-grid{display:grid;grid-template-columns:170px 1fr;gap:18px;align-items:start}.med-detail-photo{width:160px;height:160px;border-radius:14px;object-fit:cover;background:#eff4f1;border:1px solid #dce6e1}.med-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.med-kv div{background:#f5f8f6;border-radius:9px;padding:10px}.med-kv small{display:block;color:#6a817a;margin-bottom:4px}.med-stock{width:100%;border-collapse:collapse;min-width:480px}.med-stock th,.med-stock td{padding:10px;border-bottom:1px solid #e2eae6;text-align:left}.med-stock th{background:#eff5f2;font-size:12px}.med-muted{color:#6d817b;font-size:12px}
  @media(max-width:700px){.med-grid,.med-kv{grid-template-columns:1fr}.med-span-2{grid-column:auto}.med-detail-grid{grid-template-columns:1fr}.med-detail-photo{width:120px;height:120px}}
</style>
<div class="med-page">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><div style="font-size:11px;letter-spacing:.12em;color:#087f75;font-weight:800">MEDICINE MASTER</div><h2 style="margin:5px 0">Medicines</h2><p class="med-muted">Add, search, view and manage your medicine catalogue.</p></div><button id="new" class="med-primary">＋ Add medicine</button></div>
  <div class="med-toolbar"><input id="q" type="search" placeholder="Search medicine name, ingredients, brand, generic name or barcode"><label style="display:flex;align-items:center;gap:7px;white-space:nowrap"><input type="checkbox" id="inact"> Show inactive</label></div>
  <div id="msg" role="status"></div>
  ${isSuperAdmin ? `<section class="med-card"><h3 style="margin-top:0">Medicine Deactivation Requests</h3><div id="deactivationRequests">Loading pending requests...</div></section>` : ''}
  <section class="med-card"><div class="med-table-wrap"><table class="med-table"><thead><tr><th>Medicine</th><th>Ingredients</th><th>Brand / Generic</th><th>Composition</th><th>Strength</th><th>Rack / Shelf</th><th>Status</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table></div></section>
</div>
<dialog id="ph" class="med-dialog"><div class="med-dialog-inner"><div id="phb"></div><button class="sec" onclick="ph.close()">Close</button></div></dialog>
<dialog id="dlg" class="med-dialog"><div class="med-dialog-inner"><div class="med-dialog-head"><div><div style="font-size:11px;letter-spacing:.12em;color:#087f75;font-weight:800">MEDICINE DETAILS</div><h3 id="dt" style="margin:5px 0">Add medicine</h3><div class="med-muted">Only the listed medicine identity and storage details are shown here.</div></div><button type="button" class="sec" id="cancel">Close</button></div>
  <form id="f" method="dialog" style="display:grid;gap:16px"><input type="hidden" name="id"><div class="med-grid">
    <div class="med-field med-span-2"><label>Medicine name *</label><input name="name" placeholder="Enter medicine name" required></div>
    <div class="med-field med-span-2"><label>Ingredients</label><div style="display:flex;gap:8px;align-items:stretch"><textarea name="ingredients" placeholder="Enter active ingredients / ingredient names. You can include multiple ingredients."></textarea><button type="button" class="sec" id="ingredientSearch" style="white-space:nowrap;align-self:flex-start">Search Google ↗</button></div><small class="med-muted">Search opens a new tab for other products containing these ingredients.</small></div>
    <div class="med-field"><label>Brand</label><input name="brand" placeholder="Brand name"></div>
    <div class="med-field"><label>Generic name</label><input name="generic_name" placeholder="Generic name"></div>
    <div class="med-field med-span-2"><label>Composition</label><textarea name="composition" style="min-height:82px" placeholder="Composition details"></textarea></div>
    <div class="med-field"><label>Strength</label><input name="strength" placeholder="e.g. 500 mg"></div>
    <div class="med-field"><label>Rack / Shelf</label><input name="rack" placeholder="e.g. A-03 / Shelf 2"></div>
  </div>
  <div class="med-checks"><label><input type="checkbox" name="need_doctor_sheet"> Need doctor sheet / prescription</label><label><input type="checkbox" name="active" checked> Active</label></div>
  <div id="activeNote" class="med-muted"></div><div id="err" style="color:#b91c1c"></div>
  <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><button type="button" class="sec" id="cancelBottom">Cancel</button><button type="submit" class="med-primary">Save medicine</button></div>
  </form></div></dialog>
<dialog id="viewMedicine" class="med-dialog"><div class="med-dialog-inner"><div class="med-dialog-head"><div><div style="font-size:11px;letter-spacing:.12em;color:#087f75;font-weight:800">MEDICINE PROFILE</div><h3 id="viewTitle" style="margin:5px 0">Medicine details</h3></div><button type="button" class="sec" id="viewClose">Close</button></div><div id="viewContent"></div></div></dialog>
`;

const $ = id => document.getElementById(id);
const f = $('f');

const COLS = [
  'id',
  'branch_id',
  'name',
  'ingredients',
  'need_doctor_sheet',
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
      ['name', 'ingredients', 'brand', 'generic_name', 'barcode', 'sku']
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

  // Load primary photo URLs for visible medicine rows.
  const ids = list.map(m => m.id);
  const primaryPhotos = new Map();
  if (ids.length) {
    const { data: photos, error: photoError } = await sb.from('medicine_images')
      .select('medicine_id,path,is_primary,sort_order')
      .eq('branch_id', branchId).in('medicine_id', ids)
      .order('is_primary', { ascending: false }).order('sort_order');
    if (!photoError) {
      for (const photo of (photos || [])) {
        if (!primaryPhotos.has(photo.medicine_id)) {
          const { data: signed } = await sb.storage.from('medicine-images').createSignedUrl(photo.path, 300);
          if (signed?.signedUrl) primaryPhotos.set(photo.medicine_id, signed.signedUrl);
        }
      }
    }
  }

  $('rows').innerHTML = list.map(m => `
    <tr style="${m.active ? '' : 'opacity:.55'}">
      <td><div class="med-name-cell">${primaryPhotos.has(m.id) ? `<img class="med-thumb" src="${primaryPhotos.get(m.id)}" alt="${esc(m.name)}">` : `<div class="med-thumb med-thumb-placeholder">${esc((m.name || '?').slice(0,1).toUpperCase())}</div>`}<div><b>${esc(m.name)}</b><div class="med-muted">${m.active ? 'Active' : 'Inactive'}</div></div></div></td>
      <td>${esc(m.ingredients || '—')}</td>
      <td>${esc(m.brand || '—')}<div class="med-muted">${esc(m.generic_name || '')}</div></td>
      <td>${esc(m.composition || '—')}</td>
      <td>${esc(m.strength || '—')}</td>
      <td>${esc(loc(m.storage_location_id))} ${esc(m.rack || '')}</td>
      <td><span style="color:${m.active ? '#087f75' : '#9b4b43'};font-weight:700">${m.active ? 'Active' : 'Inactive'}</span></td>
      <td><div class="med-actions"><button class="sec" data-view="${m.id}">View</button><button class="sec" data-e="${m.id}">Edit</button>${m.active ? `<button class="sec" data-t="${m.id}">Request deactivation</button>` : isSuperAdmin ? `<button class="sec" data-t="${m.id}">Activate</button>` : ''}${isAdmin ? `<button class="sec" data-p="${m.id}">Cost history</button>` : ''}<button class="sec" data-photos="${m.id}">Photo</button></div></td>
    </tr>
  `).join('') || `<tr><td colspan="8" style="padding:22px;text-align:center;color:#6d817b">No medicines found.</td></tr>`;
}

// Open add/edit form
function open(m = {}) {
  $('dt').textContent = m.id ? 'Edit medicine' : 'Add medicine';
  $('err').textContent = '';
  $('activeNote').textContent = '';

  f.reset();

  for (const k of [
    'id', 'name', 'ingredients', 'brand', 'generic_name',
    'composition', 'strength', 'rack'
  ]) {
    f[k].value =
      m[k] ?? (
        k === 'tax_rate' ? 12 :
        k === 'reorder_level' ? 0 :
        ''
      );
  }

  // New medicines: all permitted staff roles can choose
  // the initial Active or Inactive status.
  // Existing medicines: only Super Admin can change status.
  f.ingredients.value = m.ingredients || '';
  f.need_doctor_sheet.checked = Boolean(m.need_doctor_sheet);
  f.active.checked = m.active ?? true;
  f.active.disabled = Boolean(m.id) && !isSuperAdmin;

  if (!isSuperAdmin) {
    $('activeNote').textContent = m.id
      ? 'Changing medicine activation status requires Super Admin approval.'
      : 'You may choose the initial status. Later activation or deactivation requires Super Admin approval.';
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
      Object.entries(d).map(([k, x]) => [k, nul(x.trim?.() ?? x)])
    ),
    active: f.active.checked
  };
  row.need_doctor_sheet = f.need_doctor_sheet.checked;
  // Keep legacy required pricing columns out of the form without overwriting existing values.
  if (id) { const old = list.find(x => x.id === id); row.mrp = old?.mrp ?? 0; row.selling_price = old?.selling_price ?? 0; row.tax_rate = old?.tax_rate ?? 12; row.reorder_level = old?.reorder_level ?? 0; }
  else { row.mrp = 0; row.selling_price = 0; row.tax_rate = 12; row.reorder_level = 0; }

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
  // Keep the single Rack / Shelf field consistent with billing and stock views.
  row.shelf_location = row.rack || null;

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

    // Preserve the initial Active/Inactive choice.
    row.active = f.active.checked;

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

$('ingredientSearch').onclick = () => {
  const ingredients = $('f').ingredients.value.trim();
  if (!ingredients) { $('err').textContent = 'Enter ingredients before searching.'; return; }
  const query = `medicines containing ${ingredients} alternatives brands`;
  window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
};

$('cancelBottom').onclick = $('cancel').onclick = () => $('dlg').close();
$('viewClose').onclick = () => $('viewMedicine').close();

async function showMedicine(id) {
  const m = list.find(x => x.id === id);
  if (!m) return;
  $('viewTitle').textContent = m.name;
  $('viewContent').innerHTML = '<p>Loading medicine details and batch stock…</p>';
  $('viewMedicine').showModal();
  const [{ data: batches, error: batchError }, { data: photos }] = await Promise.all([
    sb.from('medicine_batches').select('id,batch_no,expiry,qty,quarantined').eq('branch_id', branchId).eq('medicine_id', id).order('expiry'),
    sb.from('medicine_images').select('path,is_primary,sort_order').eq('branch_id', branchId).eq('medicine_id', id).order('is_primary', { ascending: false }).order('sort_order')
  ]);
  let photoUrl = '';
  const primary = (photos || [])[0];
  if (primary?.path) { const { data } = await sb.storage.from('medicine-images').createSignedUrl(primary.path, 300); photoUrl = data?.signedUrl || ''; }
  const stock = (batches || []).reduce((sum, b) => sum + Number(b.qty || 0), 0);
  $('viewContent').innerHTML = `
    <div class="med-detail-grid"><div>${photoUrl ? `<img class="med-detail-photo" src="${photoUrl}" alt="${esc(m.name)}">` : `<div class="med-detail-photo med-thumb-placeholder">${esc((m.name || '?').slice(0,1).toUpperCase())}</div>`}<p><button type="button" class="sec" data-view-photos="${m.id}">Manage photos</button></p></div>
    <div><div class="med-kv">
      <div><small>Medicine name</small><b>${esc(m.name)}</b></div><div><small>Brand</small><b>${esc(m.brand || '—')}</b></div>
      <div><small>Generic name</small><b>${esc(m.generic_name || '—')}</b></div><div><small>Strength</small><b>${esc(m.strength || '—')}</b></div>
      <div><small>Composition</small><b>${esc(m.composition || '—')}</b></div><div><small>Rack / Shelf</small><b>${esc(m.rack || '—')}</b></div>
      <div><small>Ingredients</small><b>${esc(m.ingredients || '—')}</b></div><div><small>Doctor sheet required</small><b>${m.need_doctor_sheet ? 'Yes' : 'No'}</b></div>
      <div><small>Status</small><b>${m.active ? 'Active' : 'Inactive'}</b></div><div><small>Current total stock</small><b>${stock}</b></div>
    </div></div></div>
    <section style="margin-top:22px"><h3>Current batch stock</h3>${batchError ? `<p style="color:#b91c1c">${esc(friendly(batchError))}</p>` : `<div style="overflow:auto"><table class="med-stock"><thead><tr><th>Batch number</th><th>Expiry date</th><th>Current stock</th><th>Status</th></tr></thead><tbody>${(batches || []).map(b => `<tr><td>${esc(b.batch_no)}</td><td>${esc(b.expiry)}</td><td>${Number(b.qty).toLocaleString('en-IN')}</td><td>${b.quarantined ? 'Quarantined' : Number(b.qty) > 0 ? 'Available' : 'Out of stock'}</td></tr>`).join('') || '<tr><td colspan="4">No purchase batches recorded yet.</td></tr>'}</tbody></table></div>`}</section>`;
  $('viewContent').querySelector('[data-view-photos]')?.addEventListener('click', () => { $('viewMedicine').close(); document.querySelector(`[data-photos="${id}"]`)?.click(); });
}
$('rows').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) showMedicine(b.dataset.view); });

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
}

// Load the approval panel for Super Admin.
if (isSuperAdmin) {
  await loadDeactivationRequests();
}
