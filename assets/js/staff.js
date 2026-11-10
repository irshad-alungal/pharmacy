
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';

const prof = await mountShell('staff', 'Staff Management');
const view = document.getElementById('view');

const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[ch]);

const isSuperAdmin = prof?.role === 'super_admin';

const roleOptions = [
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'billing_staff', label: 'Billing Staff' },
  { value: 'inventory_staff', label: 'Inventory Staff' },
  ...(isSuperAdmin ? [{ value: 'admin', label: 'Admin' }] : [])
];

view.innerHTML = `
  <section style="max-width:1000px;margin:auto">
    <h2>Staff Management</h2>
    <p>Create and view staff accounts for your branch.</p>

    <div style="background:white;padding:20px;border-radius:12px;
                margin:18px 0;border:1px solid #e5e7eb">
      <h3>Create Staff Account</h3>

      <form id="staffForm">
        <label>Staff ID</label>
        <input id="staffId" required maxlength="40"
          pattern="[A-Za-z0-9_-]{2,40}"
          placeholder="Example: PHARM01"
          style="display:block;width:100%;padding:11px;margin:7px 0 14px">

        <label>Full Name</label>
        <input id="fullName" required maxlength="120"
          placeholder="Staff full name"
          style="display:block;width:100%;padding:11px;margin:7px 0 14px">

        <label>Phone (optional)</label>
        <input id="phone" maxlength="30"
          placeholder="Phone number"
          style="display:block;width:100%;padding:11px;margin:7px 0 14px">

        <label>Role</label>
        <select id="staffRole" required
          style="display:block;width:100%;padding:11px;margin:7px 0 14px">
          ${roleOptions.map(r =>
            `<option value="${r.value}">${r.label}</option>`
          ).join('')}
        </select>

        <label>Temporary Password</label>
        <input id="tempPassword" type="password" required
          minlength="12" maxlength="128"
          autocomplete="new-password"
          placeholder="Minimum 12 characters"
          style="display:block;width:100%;padding:11px;margin:7px 0 14px">

        <button type="submit" id="createBtn"
          style="padding:12px 20px;background:#087f5b;color:white;
                 border:0;border-radius:7px;cursor:pointer">
          Create Staff Account
        </button>
      </form>

      <p id="formMessage" role="status"></p>
      <p style="color:#64748b;font-size:13px">
        Staff sign in using their Staff ID and temporary password.
        They must change the password at first login.
      </p>
    </div>

    <div style="display:flex;justify-content:space-between;
                align-items:center;gap:12px;flex-wrap:wrap">
      <h3>Staff Accounts</h3>
      <button id="refreshStaff"
        style="padding:10px 16px;cursor:pointer">
        Refresh List
      </button>
    </div>

    <div id="staffList" style="margin-top:12px">
      Loading staff accounts...
    </div>
  </section>
`;

const message = document.getElementById('formMessage');
const list = document.getElementById('staffList');
const form = document.getElementById('staffForm');
const createBtn = document.getElementById('createBtn');

async function callStaffFunction(body) {
  const { data, error } = await sb.functions.invoke('admin-staff', {
    body
  });

  if (error) {
    let detail = error.message || 'Request failed';

    if (error.context && typeof error.context.json === 'function') {
      try {
        const responseBody = await error.context.json();
        detail = responseBody.error || detail;
      } catch {
        // Keep the original error message.
      }
    }

    throw new Error(detail);
  }

  if (data?.error) throw new Error(data.error);

  return data;
}

async function loadStaff() {
  list.textContent = 'Loading staff accounts...';

  try {
    const data = await callStaffFunction({ action: 'list' });
    const staff = data.staff || [];

    if (!staff.length) {
      list.innerHTML = '<p>No staff accounts found.</p>';
      return;
    }

    list.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;
                      background:white">
          <thead>
            <tr>
              <th style="padding:12px;text-align:left">Staff ID</th>
              <th style="padding:12px;text-align:left">Name</th>
              <th style="padding:12px;text-align:left">Role</th>
              <th style="padding:12px;text-align:left">Status</th>
              <th style="padding:12px;text-align:left">Password</th>
            </tr>
          </thead>
          <tbody>
            ${staff.map(s => `
              <tr style="border-top:1px solid #e5e7eb">
                <td style="padding:12px">${escapeHtml(s.staff_id)}</td>
                <td style="padding:12px">${escapeHtml(s.full_name)}</td>
                <td style="padding:12px">${escapeHtml(s.role_name || s.role)}</td>
                <td style="padding:12px">
                  ${s.is_active ? 'Active' : 'Inactive'}
                </td>
                <td style="padding:12px">
                  ${s.must_change_password ? 'Change required' : 'Updated'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    list.textContent = 'Unable to load staff: ' + error.message;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();

  message.textContent = '';

  const staffId = document.getElementById('staffId').value.trim();
  const fullName = document.getElementById('fullName').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const role = document.getElementById('staffRole').value;
  const password = document.getElementById('tempPassword').value;

  if (password.length < 12) {
    message.textContent = 'Temporary password must contain at least 12 characters.';
    return;
  }

  createBtn.disabled = true;
  createBtn.textContent = 'Creating account...';

  try {
    const result = await callStaffFunction({
      action: 'create',
      staff_id: staffId,
      full_name: fullName,
      phone,
      role,
      password
    });

    message.textContent = result.message || 'Staff account created.';
    form.reset();
    await loadStaff();

  } catch (error) {
    message.textContent = 'Could not create staff account: ' + error.message;
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = 'Create Staff Account';
  }
});

document.getElementById('refreshStaff')
  .addEventListener('click', loadStaff);

await loadStaff();
