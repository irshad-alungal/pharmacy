import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';

const prof = await mountShell('documents', 'Documents');
const $ = id => document.getElementById(id);
const branchId = prof.branch_id;
const role = prof.role;
const admin = ['super_admin','admin'].includes(role);
const canUpload = ['super_admin','admin','inventory'].includes(role);
if (!branchId) { $('view').textContent = 'Your profile has no assigned branch.'; throw new Error('Missing branch'); }

const [distRes, purchaseRes] = await Promise.all([
  sb.from('distributors').select('id,name').eq('branch_id', branchId).eq('active', true).order('name'),
  sb.from('purchase_invoices').select('id,supplier_invoice_no,distributor_id,invoice_date').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(200)
]);
if (distRes.error) console.error('Distributor list:', distRes.error);
if (purchaseRes.error) console.error('Purchase list:', purchaseRes.error);
const distributors = distRes.data || [];
const purchases = purchaseRes.data || [];

$('view').innerHTML = `
  <section class="card" style="margin-bottom:1rem">
    <h3>Supplier documents</h3>
    ${canUpload ? `<form id="docForm" style="display:grid;gap:.6rem;max-width:720px">
      <label>File (PDF, JPG, PNG or WEBP; max 15 MB)<input id="file" type="file" accept=".pdf,image/jpeg,image/png,image/webp" required></label>
      <label>Distributor<select id="distributor"><option value="">Unassigned (admin only)</option>${distributors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
      <label>Purchase invoice (optional)<select id="purchase"><option value="">No linked invoice</option>${purchases.map(p => `<option value="${p.id}" data-dist="${p.distributor_id}">${esc(p.supplier_invoice_no)} — ${esc(p.invoice_date)}</option>`).join('')}</select></label>
      <label>Document type<select id="type"><option value="purchase_bill">Purchase bill</option><option value="credit_note">Credit note</option><option value="delivery_challan">Delivery challan</option><option value="other">Other</option></select></label>
      <label>Document date<input id="date" type="date"></label>
      <input id="notes" maxlength="1000" placeholder="Notes / reference">
      <button type="submit">Upload document</button><div id="uploadMsg" role="status"></div>
    </form>` : '<p>You have view-only access.</p>'}
  </section>
  <section class="card">
    <h3>Document archive</h3>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.8rem">
      <input id="q" placeholder="Search file, supplier or invoice">
      <select id="filterDist"><option value="">All distributors</option>${distributors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
      <label><input id="removed" type="checkbox"> Include removed</label>
      <button id="search" type="button">Search</button>
    </div>
    <div id="listMsg" role="status"></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>File</th><th>Distributor</th><th>Invoice</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead><tbody id="docs"></tbody></table></div>
  </section>`;

if (canUpload) {
  $('purchase').onchange = () => {
    const dist = $('purchase').selectedOptions[0]?.dataset.dist;
    if (dist) $('distributor').value = dist;
  };
  $('docForm').onsubmit = async e => {
    e.preventDefault();
    const file = $('file').files?.[0];
    if (!file) return;
    if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      $('uploadMsg').textContent = 'Invalid file type or file exceeds 15 MB.'; return;
    }
    const distributor = $('distributor').value || null;
    const purchase = $('purchase').value || null;
    if (!distributor && !admin) { $('uploadMsg').textContent = 'Select a distributor. Unassigned uploads are admin-only.'; return; }
    if (purchase) {
      const selected = purchases.find(p => p.id === purchase);
      if (!selected || selected.distributor_id !== distributor) { $('uploadMsg').textContent = 'The selected invoice and distributor do not match.'; return; }
    }
    const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
    const path = `${distributor || 'unassigned'}/${crypto.randomUUID()}.${ext}`;
    $('uploadMsg').textContent = 'Uploading…';
    const { error: upErr } = await sb.storage.from('purchase-documents').upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) { $('uploadMsg').textContent = friendly(upErr); return; }
    const { error: regErr } = await sb.rpc('register_purchase_document', {
      p_path: path, p_name: file.name, p_mime: file.type, p_size: file.size,
      p_sha256: null, p_distributor: distributor, p_purchase: purchase,
      p_doc_date: $('date').value || null, p_type: $('type').value, p_notes: $('notes').value.trim() || null
    });
    if (regErr) {
      await sb.storage.from('purchase-documents').remove([path]);
      $('uploadMsg').textContent = friendly(regErr); return;
    }
    $('docForm').reset(); $('uploadMsg').textContent = 'Document uploaded and registered.'; await load();
  };
}

async function load() {
  $('listMsg').textContent = 'Loading…';
  const { data, error } = await sb.rpc('purchase_document_list', {
    p_q: $('q').value.trim() || null, p_distributor: $('filterDist').value || null,
    p_from: null, p_to: null, p_include_removed: $('removed').checked, p_limit: 200
  });
  if (error) { $('listMsg').textContent = friendly(error); return; }
  $('listMsg').textContent = '';
  $('docs').innerHTML = (data || []).map(d => `<tr>
    <td>${esc(d.doc_date || d.created_at?.slice(0, 10) || '')}</td><td>${esc(d.file_name)}</td>
    <td>${esc(d.distributor || 'Unassigned')}</td><td>${esc(d.supplier_invoice_no || '')}</td>
    <td>${esc(d.doc_type)}</td><td>${esc(d.status)}</td>
    <td>${admin && d.path && d.status === 'active' ? `<button type="button" data-open="${esc(d.path)}">Open</button>` : ''}
    ${admin && d.status === 'active' ? `<button type="button" class="sec" data-remove="${d.id}">Remove</button>` : ''}
    ${d.removed_reason ? `<small>${esc(d.removed_reason)}</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No documents found.</td></tr>';
}
$('search').onclick = load;
$('docs').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.open) {
    const { data, error } = await sb.storage.from('purchase-documents').createSignedUrl(b.dataset.open, 300);
    if (error) { $('listMsg').textContent = friendly(error); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }
  if (b.dataset.remove) {
    const reason = prompt('Reason for removing this document:'); if (!reason?.trim()) return;
    const { error } = await sb.rpc('remove_purchase_document', { p_id: b.dataset.remove, p_reason: reason.trim() });
    if (error) $('listMsg').textContent = friendly(error);
    else { $('listMsg').textContent = 'Document removed from archive. Stored file retained.'; await load(); }
  }
};
await load();
