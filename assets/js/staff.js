import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';

const prof = await mountShell('staff', 'Staff Management');
const view = document.getElementById('view');
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const isSuperAdmin = prof?.role === 'super_admin';
const roleOptions = [
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'billing_staff', label: 'Billing Staff' },
  { value: 'inventory_staff', label: 'Inventory Staff' },
  ...(isSuperAdmin ? [{ value: 'admin', label: 'Admin' }] : [])
];
let staffRows = [];
let selectedPhotoUrl = '';

view.innerHTML = `
<section class="staff-page">
  <header class="staff-heading"><div><h2>Staff Management</h2><p>Manage staff accounts and contact information for your branch.</p></div><button id="refreshStaff" class="staff-btn staff-secondary">↻ Refresh</button></header>
  <section class="staff-panel">
    <div class="staff-panel-title"><div><h3>Add staff member</h3><p>Create a staff login and save their contact details.</p></div><span class="staff-lock">Branch restricted</span></div>
    <form id="staffForm" class="staff-form">
      <div class="staff-grid">
        <label>Staff ID <input id="staffId" required maxlength="40" pattern="[A-Za-z0-9_-]{2,40}" placeholder="Example: PHARM01"></label>
        <label>Full name <input id="fullName" required maxlength="120" placeholder="Staff full name"></label>
        <label>Phone number <input id="phone" type="tel" maxlength="30" placeholder="+91 98765 43210"></label>
        <label>Role <select id="staffRole" required>${roleOptions.map(r=>`<option value="${r.value}">${r.label}</option>`).join('')}</select></label>
        <label class="staff-wide">Address <textarea id="staffAddress" rows="2" maxlength="500" placeholder="House / street, locality, city, PIN code"></textarea></label>
        <label>Temporary password <input id="tempPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="Minimum 12 characters"></label>
        <div class="staff-photo-field"><span class="staff-label">Staff photo</span><div class="staff-photo-row"><div id="photoPreview" class="staff-photo-preview"><span>👤</span></div><div class="staff-photo-actions"><label class="staff-btn staff-secondary staff-file-label">Choose photo<input id="staffPhoto" type="file" accept="image/*" capture="user" hidden></label><small>JPG, PNG or WEBP · up to 5 MB</small></div></div></div>
      </div>
      <div class="staff-form-footer"><p id="formMessage" role="status" aria-live="polite"></p><button type="submit" id="createBtn" class="staff-btn">Create staff account</button></div>
      <p class="staff-note">Staff sign in using their Staff ID and temporary password. They must change the password at first login. Address and photo are collected in this form; persistent storage requires the staff-profile backend upgrade.</p>
    </form>
  </section>
  <section class="staff-panel staff-list-panel"><div class="staff-panel-title"><div><h3>Staff members</h3><p>View contact details and account status.</p></div><input id="staffSearch" class="staff-search" type="search" placeholder="Search staff name, ID or phone"></div><div id="staffList" class="staff-list">Loading staff accounts…</div></section>
</section>
<div id="staffModal" class="staff-modal" hidden><div class="staff-modal-backdrop" data-close-staff></div><section class="staff-modal-card" role="dialog" aria-modal="true" aria-labelledby="staffModalTitle"><button class="staff-modal-close" type="button" data-close-staff aria-label="Close">×</button><div id="staffModalBody"></div></section></div>`;

const message = document.getElementById('formMessage');
const list = document.getElementById('staffList');
const form = document.getElementById('staffForm');
const createBtn = document.getElementById('createBtn');
const photoInput = document.getElementById('staffPhoto');

async function callStaffFunction(body) {
  const { data, error } = await sb.functions.invoke('admin-staff', { body });
  if (error) {
    let detail = error.message || 'Request failed';
    if (error.context && typeof error.context.json === 'function') { try { const responseBody = await error.context.json(); detail = responseBody.error || detail; } catch {} }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
function phoneLinks(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '<span class="staff-muted">No phone number</span>';
  const digits = raw.replace(/\D/g, '');
  const wa = digits.length === 10 ? `91${digits}` : digits;
  return `<div class="staff-contact-actions"><a class="staff-mini-btn" href="tel:${encodeURIComponent(raw)}">☎ Call</a><a class="staff-mini-btn staff-wa" href="https://wa.me/${encodeURIComponent(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a><span>${escapeHtml(raw)}</span></div>`;
}
function renderStaff(rows) {
  if (!rows.length) { list.innerHTML = '<div class="staff-empty"><span>👥</span><strong>No staff members found</strong><p>Create a staff account or change your search.</p></div>'; return; }
  list.innerHTML = `<div class="staff-table-wrap"><table class="staff-table"><thead><tr><th>Staff ID</th><th>Staff member</th><th>Role</th><th>Contact</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(s=>`<tr><td data-label="Staff ID"><strong>${escapeHtml(s.staff_id)}</strong></td><td data-label="Staff member"><strong>${escapeHtml(s.full_name)}</strong><small>Added ${s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</small></td><td data-label="Role">${escapeHtml(s.role_name || s.role || '—')}</td><td data-label="Contact">${phoneLinks(s.phone)}</td><td data-label="Status"><span class="staff-status ${s.is_active?'is-active':'is-inactive'}">${s.is_active?'Active':'Inactive'}</span><small>${s.must_change_password?'Password change required':'Password updated'}</small></td><td data-label="Action"><button class="staff-btn staff-view-btn" data-view-staff="${escapeHtml(s.id)}">View</button></td></tr>`).join('')}</tbody></table></div>`;
}
async function loadStaff() {
  list.textContent = 'Loading staff accounts…';
  try { const data = await callStaffFunction({ action: 'list' }); staffRows = data.staff || []; applySearch(); }
  catch (error) { list.textContent = 'Unable to load staff: ' + error.message; }
}
function applySearch() {
  const q = document.getElementById('staffSearch').value.trim().toLowerCase();
  renderStaff(staffRows.filter(s => [s.staff_id,s.full_name,s.phone,s.role_name,s.role].join(' ').toLowerCase().includes(q)));
}
function openStaff(s) {
  const photo = s.photo_url || s.avatar_url || '';
  document.getElementById('staffModalBody').innerHTML = `<div class="staff-detail-head">${photo?`<img class="staff-detail-photo" src="${escapeHtml(photo)}" alt="Staff photo">`:'<div class="staff-detail-photo staff-avatar-placeholder">👤</div>'}<div><h3 id="staffModalTitle">${escapeHtml(s.full_name)}</h3><p>${escapeHtml(s.staff_id)} · ${escapeHtml(s.role_name || s.role || '')}</p><span class="staff-status ${s.is_active?'is-active':'is-inactive'}">${s.is_active?'Active':'Inactive'}</span></div></div><div class="staff-detail-grid"><div><small>Phone number</small><strong>${escapeHtml(s.phone || 'Not provided')}</strong></div><div><small>Account status</small><strong>${s.is_active?'Active':'Inactive'}</strong></div><div><small>Staff ID</small><strong>${escapeHtml(s.staff_id)}</strong></div><div><small>Role</small><strong>${escapeHtml(s.role_name || s.role || '—')}</strong></div><div><small>Joined</small><strong>${s.created_at?new Date(s.created_at).toLocaleString():'—'}</strong></div><div><small>Password</small><strong>${s.must_change_password?'Change required':'Updated'}</strong></div><div class="staff-detail-wide"><small>Address</small><strong>${escapeHtml(s.address || 'Not recorded')}</strong></div></div><div class="staff-detail-contact">${s.phone?phoneLinks(s.phone):''}</div><p class="staff-note">Only details currently returned by your staff-management service are shown. Address and photo display will become persistent after the backend/storage upgrade.</p>`;
  document.getElementById('staffModal').hidden = false;
}

document.getElementById('staffModal').addEventListener('click', e => { if (e.target.matches('[data-close-staff]')) document.getElementById('staffModal').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('staffModal').hidden = true; });
list.addEventListener('click', e => { const btn = e.target.closest('[data-view-staff]'); if (btn) { const s = staffRows.find(x => String(x.id) === btn.dataset.viewStaff); if (s) openStaff(s); } });
document.getElementById('staffSearch').addEventListener('input', applySearch);
document.getElementById('refreshStaff').addEventListener('click', loadStaff);

photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
  selectedPhotoUrl = '';
  const preview = document.getElementById('photoPreview');
  if (!file) { preview.innerHTML = '<span>👤</span>'; return; }
  if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) { message.textContent = 'Choose an image up to 5 MB.'; photoInput.value = ''; preview.innerHTML = '<span>👤</span>'; return; }
  selectedPhotoUrl = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${selectedPhotoUrl}" alt="Selected staff photo">`;
});

form.addEventListener('submit', async event => {
  event.preventDefault(); message.textContent = '';
  const staffId = document.getElementById('staffId').value.trim();
  const fullName = document.getElementById('fullName').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const address = document.getElementById('staffAddress').value.trim();
  const role = document.getElementById('staffRole').value;
  const password = document.getElementById('tempPassword').value;
  if (password.length < 12) { message.textContent = 'Temporary password must contain at least 12 characters.'; return; }
  createBtn.disabled = true; createBtn.textContent = 'Creating account…';
  try {
    const result = await callStaffFunction({ action:'create', staff_id:staffId, full_name:fullName, phone, address, role, password });
    message.textContent = result.message || 'Staff account created.';
    if (address || photoInput.files?.length) message.textContent += ' Note: address/photo are previewed in this frontend but require the staff backend and storage upgrade to persist.';
    form.reset();
    if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl); selectedPhotoUrl = '';
    document.getElementById('photoPreview').innerHTML = '<span>👤</span>';
    await loadStaff();
  } catch (error) { message.textContent = 'Could not create staff account: ' + error.message; }
  finally { createBtn.disabled = false; createBtn.textContent = 'Create staff account'; }
});

await loadStaff();
