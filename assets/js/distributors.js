import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { nul, friendly, safeQ } from './ui.js';

const prof = await mountShell('distributors', 'Distributors');
if (!prof) throw new Error('Distributor page could not start: profile unavailable.');
const $ = id => document.getElementById(id);
const LOGO_BUCKET = 'distributor-logos';
let list = [];
let logoFile = null;
let removeExistingLogo = false;

$('view').innerHTML = `
  <section class="dist-toolbar">
    <input id="q" placeholder="Search distributor, GSTIN or contact number" aria-label="Search distributors">
    <label class="dist-check"><input type="checkbox" id="inact"> Show inactive</label>
    <button id="new">+ Add distributor</button>
  </section>
  <div class="dist-table-wrap"><table class="dist-table">
    <thead><tr><th>Distributor</th><th>Contact person</th><th>Contact numbers</th><th>GSTIN</th><th>Drug licence</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody id="rows"><tr><td colspan="7">Loading distributors…</td></tr></tbody>
  </table></div>

  <dialog id="dlg" class="dist-dialog"><form id="f" method="dialog" class="dist-form">
    <header class="dist-dialog-head"><h2 id="dt">Add distributor</h2><button type="button" class="sec" id="cancel">Close</button></header>
    <input type="hidden" name="id">
    <div class="dist-form-grid">
      <label class="dist-field dist-span-2">Distributor name *<input name="name" placeholder="Distributor name" required maxlength="160"></label>
      <label class="dist-field">Contact person<input name="contact_person" placeholder="Contact person"></label>
      <label class="dist-field">Contact number(s)<textarea name="phone" rows="2" placeholder="One number per line or separate with commas"></textarea><small>Use country code for WhatsApp, e.g. +91 9876543210.</small></label>
      <label class="dist-field">Email<input name="email" type="email" placeholder="Email"></label>
      <label class="dist-field">GSTIN<input name="gstin" placeholder="GSTIN (15 characters)" maxlength="15" style="text-transform:uppercase"></label>
      <label class="dist-field">Drug licence number<input name="drug_licence" placeholder="Drug licence no."></label>
      <label class="dist-field dist-span-2">Address<textarea name="address" rows="2" placeholder="Full address"></textarea></label>
      <div class="dist-field dist-span-2"><span>Distributor logo</span><div class="dist-logo-row"><img id="logoPreview" class="dist-logo-preview" alt="Distributor logo preview" hidden><div><input id="logoFile" type="file" accept="image/png,image/jpeg,image/webp"><small>PNG, JPG or WEBP · maximum 2 MB</small></div><button type="button" id="clearLogo" class="sec">Remove logo</button></div></div>
      <label class="dist-check dist-span-2"><input type="checkbox" name="active" checked> Active distributor</label>
    </div>
    <div id="err" class="dist-error" role="alert"></div>
    <footer class="dist-dialog-foot"><button type="submit">Save distributor</button><button type="button" class="sec" id="cancel2">Cancel</button></footer>
  </form></dialog>

  <dialog id="viewDlg" class="dist-dialog dist-view-dialog"><div class="dist-form">
    <header class="dist-dialog-head"><h2>Distributor details</h2><button type="button" class="sec" id="viewClose">Close</button></header>
    <div id="viewBody"><p>Loading…</p></div>
  </div></dialog>`;

const f = $('f');
const phoneParts = value => String(value || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
const digits = value => String(value || '').replace(/[^\d]/g, '');
const callHref = value => `tel:${String(value || '').replace(/[^\d+]/g, '')}`;
const waHref = value => `https://wa.me/${digits(value)}`;
const logoUrl = path => {
  if (!path) return '';
  const { data } = sb.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return data?.publicUrl || '';
};

function phoneActions(value) {
  const phones = phoneParts(value);
  if (!phones.length) return '<span class="dist-muted">—</span>';
  return `<div class="dist-phone-list">${phones.map(p => `<div class="dist-phone-entry"><span>${esc(p)}</span><a class="dist-mini-action" href="${esc(callHref(p))}" aria-label="Call ${esc(p)}">Call</a><a class="dist-mini-action dist-wa" href="${esc(waHref(p))}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(p)}">WhatsApp</a></div>`).join('')}</div>`;
}

async function load() {
  $('rows').innerHTML = '<tr><td colspan="7">Loading distributors…</td></tr>';
  let qb = sb.from('distributors').select('*').eq('branch_id', prof.branch_id).order('name').limit(300);
  if (!$('inact').checked) qb = qb.eq('active', true);
  const s = safeQ($('q').value);
  if (s) qb = qb.or(`name.ilike.%${s}%,gstin.ilike.%${s}%,phone.ilike.%${s}%,contact_person.ilike.%${s}%`);
  const { data, error } = await qb;
  if (error) { $('rows').innerHTML = `<tr><td colspan="7">${esc(friendly(error))}</td></tr>`; return; }
  list = data || [];
  $('rows').innerHTML = list.map(d => `<tr class="${d.active ? '' : 'dist-inactive'}">
    <td><div class="dist-name-cell">${d.logo_path ? `<img class="dist-table-logo" src="${esc(logoUrl(d.logo_path))}" alt="">` : '<span class="dist-logo-placeholder">＋</span>'}<strong>${esc(d.name)}</strong></div></td>
    <td>${esc(d.contact_person || '—')}</td><td>${phoneActions(d.phone)}</td><td>${esc(d.gstin || '—')}</td><td>${esc(d.drug_licence || '—')}</td>
    <td><span class="dist-status ${d.active ? 'is-active' : 'is-inactive'}">${d.active ? 'Active' : 'Inactive'}</span></td>
    <td class="dist-actions"><button class="sec" data-v="${d.id}">View</button><button class="sec" data-e="${d.id}">Edit</button><button class="sec" data-t="${d.id}">${d.active ? 'Deactivate' : 'Activate'}</button></td>
  </tr>`).join('') || '<tr><td colspan="7">No distributors found.</td></tr>';
}

function setLogoPreview(path = '') {
  const img = $('logoPreview');
  if (path) { img.src = logoUrl(path); img.hidden = false; }
  else { img.removeAttribute('src'); img.hidden = true; }
}

function openEdit(d = {}) {
  $('dt').textContent = d.id ? 'Edit distributor' : 'Add distributor';
  $('err').textContent = ''; f.reset(); logoFile = null; $('logoFile').value = '';
  for (const k of ['id', 'name', 'contact_person', 'phone', 'email', 'address', 'gstin', 'drug_licence']) f.elements[k].value = d[k] ?? '';
  f.elements.active.checked = d.active ?? true;
  f.dataset.oldLogo = d.logo_path || '';
  removeExistingLogo = false;
  setLogoPreview(d.logo_path || '');
  $('dlg').showModal();
}

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
  row.phone = phoneParts(row.phone).join(', ') || null;
  row.gstin = row.gstin?.toUpperCase() ?? null; row.active = f.elements.active.checked;
  if (!id) row.branch_id = prof.branch_id;
  const { data, error } = id
    ? await sb.from('distributors').update(row).eq('id', id).eq('branch_id', prof.branch_id).select('id').single()
    : await sb.from('distributors').insert(row).select('id').single();
  if (error) { $('err').textContent = error.code === '23514' ? 'GSTIN format is invalid.' : error.code === '23505' ? 'A distributor with this name or GSTIN already exists.' : friendly(error); return; }
  const distributorId = id || data.id;
  const file = $('logoFile').files?.[0];
  if (removeExistingLogo && !file && f.dataset.oldLogo) {
    const { error: clearError } = await sb.from('distributors').update({ logo_path: null }).eq('id', distributorId).eq('branch_id', prof.branch_id);
    if (clearError) { $('err').textContent = `Distributor saved, but logo could not be removed: ${friendly(clearError)}`; return; }
    await sb.storage.from(LOGO_BUCKET).remove([f.dataset.oldLogo]);
  }
  if (file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      $('err').textContent = 'Distributor saved, but logo was not uploaded. Choose PNG, JPG or WEBP up to 2 MB.'; return;
    }
    try { await uploadLogo(distributorId, file, f.dataset.oldLogo || ''); }
    catch (uploadError) { $('err').textContent = `Distributor saved, but logo upload failed: ${friendly(uploadError)}. Check the distributor logo storage migration.`; return; }
  }
  $('dlg').close(); await load();
};

$('logoFile').onchange = () => {
  const file = $('logoFile').files?.[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    $('err').textContent = 'Choose a PNG, JPG or WEBP image up to 2 MB.'; $('logoFile').value = ''; return;
  }
  $('err').textContent = ''; setLogoPreview(URL.createObjectURL(file));
};
$('clearLogo').onclick = () => { $('logoFile').value = ''; logoFile = null; removeExistingLogo = true; setLogoPreview(''); };
$('rows').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.e) openEdit(list.find(x => x.id === b.dataset.e));
  if (b.dataset.v) await showDistributor(list.find(x => x.id === b.dataset.v));
  if (b.dataset.t) {
    const d = list.find(x => x.id === b.dataset.t); if (!d) return;
    const { error } = await sb.from('distributors').update({ active: !d.active }).eq('id', d.id).eq('branch_id', prof.branch_id);
    if (error) alert(friendly(error)); else await load();
  }
};

function purchaseStatus(status) {
  const s = String(status || 'unknown').toLowerCase();
  return `<span class="dist-status ${s === 'confirmed' || s === 'posted' ? 'is-active' : 'is-inactive'}">${esc(status || 'Unknown')}</span>`;
}

async function showDistributor(d) {
  if (!d) return;
  $('viewBody').innerHTML = '<p>Loading distributor details and purchase history…</p>';
  $('viewDlg').showModal();
  const [{ data: invoices, error: invError }, { data: full, error: distError }] = await Promise.all([
    sb.from('purchase_invoices').select('id,supplier_invoice_no,invoice_date,status,subtotal,tax,discount,freight,total,created_at').eq('branch_id', prof.branch_id).eq('distributor_id', d.id).order('invoice_date', { ascending: false }).limit(200),
    sb.from('distributors').select('*').eq('id', d.id).eq('branch_id', prof.branch_id).single()
  ]);
  if (distError) { $('viewBody').innerHTML = `<p class="dist-error">${esc(friendly(distError))}</p>`; return; }
  const inv = invoices || [];
  const purchasesHtml = invError
    ? `<p class="dist-error">Purchase history could not be loaded: ${esc(friendly(invError))}</p>`
    : inv.length ? `<div class="dist-table-wrap"><table class="dist-table"><thead><tr><th>Invoice date</th><th>Invoice no.</th><th>Status</th><th>Items</th><th>Total</th><th>Action</th></tr></thead><tbody>${inv.map(x => `<tr><td>${esc(x.invoice_date || '—')}</td><td>${esc(x.supplier_invoice_no)}</td><td>${purchaseStatus(x.status)}</td><td id="count-${x.id}">…</td><td>₹${Number(x.total || 0).toFixed(2)}</td><td><button class="sec" data-invoice="${x.id}">View</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="dist-muted">No purchase invoices found for this distributor.</p>';
  $('viewBody').innerHTML = `
    <section class="dist-profile-card">${full.logo_path ? `<img class="dist-profile-logo" src="${esc(logoUrl(full.logo_path))}" alt="${esc(full.name)} logo">` : '<div class="dist-profile-logo dist-logo-placeholder">No logo</div>'}
      <div><h3>${esc(full.name)}</h3><p>${esc(full.contact_person || 'No contact person')}</p><p>${esc(full.address || 'No address recorded')}</p></div></section>
    <div class="dist-detail-grid">
      <div><small>Contact numbers</small><div>${phoneActions(full.phone)}</div></div>
      <div><small>Email</small><p>${full.email ? `<a href="mailto:${esc(full.email)}">${esc(full.email)}</a>` : '—'}</p></div>
      <div><small>GSTIN</small><p>${esc(full.gstin || '—')}</p></div>
      <div><small>Drug licence</small><p>${esc(full.drug_licence || '—')}</p></div>
      <div><small>Status</small><p>${full.active ? 'Active' : 'Inactive'}</p></div>
    </div>
    <section class="dist-history"><h3>Purchases from this distributor <span>${inv.length} invoices</span></h3>${purchasesHtml}</section>`;
  for (const x of inv) {
    const { count, error } = await sb.from('purchase_items').select('id', { count: 'exact', head: true }).eq('branch_id', prof.branch_id).eq('invoice_id', x.id);
    const cell = document.getElementById(`count-${x.id}`); if (cell) cell.textContent = error ? '—' : String(count ?? 0);
  }
  $('viewBody').onclick = async e => {
    const b = e.target.closest('button[data-invoice]'); if (!b) return;
    await showPurchaseInvoice(b.dataset.invoice, full);
  };
}

async function showPurchaseInvoice(invoiceId, distributor) {
  const { data: invoice, error } = await sb.from('purchase_invoices').select('*').eq('id', invoiceId).eq('branch_id', prof.branch_id).single();
  if (error) { alert(friendly(error)); return; }
  const { data: items, error: itemError } = await sb.from('purchase_items').select('*, medicines(name,strength), medicine_batches(batch_no,expiry)').eq('invoice_id', invoiceId).eq('branch_id', prof.branch_id);
  const detail = itemError ? `<p class="dist-error">Could not load invoice items: ${esc(friendly(itemError))}</p>` : `<div class="dist-table-wrap"><table class="dist-table"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Rate</th><th>Line total</th></tr></thead><tbody>${(items || []).map(i => `<tr><td>${esc(i.medicines?.name || 'Medicine')}</td><td>${esc(i.medicine_batches?.batch_no || '—')}</td><td>${esc(i.medicine_batches?.expiry || '—')}</td><td>${esc(i.qty)}</td><td>₹${Number(i.unit_price || 0).toFixed(2)}</td><td>₹${Number(i.line_net || 0).toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`;
  $('viewBody').innerHTML = `<button class="sec" id="backHistory">← Back to distributor</button><h3>${esc(distributor.name)} · Invoice ${esc(invoice.supplier_invoice_no)}</h3><p>Date: ${esc(invoice.invoice_date)} · Status: ${purchaseStatus(invoice.status)}</p>${detail}<div class="dist-invoice-total"><span>Subtotal ₹${Number(invoice.subtotal || 0).toFixed(2)}</span><span>Tax ₹${Number(invoice.tax || 0).toFixed(2)}</span><strong>Grand total ₹${Number(invoice.total || 0).toFixed(2)}</strong></div>`;
  $('backHistory').onclick = () => showDistributor(distributor);
}

$('new').onclick = () => openEdit();
$('cancel').onclick = $('cancel2').onclick = () => $('dlg').close();
$('viewClose').onclick = () => $('viewDlg').close();
$('inact').onchange = load;
let searchTimer; $('q').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); };
await load();
