
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { nul, friendly, safeQ } from './ui.js';
import { showInvoice } from './invoice.js';

// Authenticate and load the dashboard
const prof = await mountShell('customers', 'Customers');

if (!prof) {
  throw new Error('Unable to load user profile.');
}

const branchId = prof.branch_id;

const view = document.getElementById('view');

if (!branchId) {
  view.textContent =
    'Your profile has no assigned branch. Contact the administrator.';
  throw new Error('Missing profile branch_id.');
}

const $ = id => document.getElementById(id);

function waNumber(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.startsWith('0') && digits.length === 11) digits = `91${digits.slice(1)}`;
  return digits;
}

const fmtDate = value => value ? new Date(value).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
const fmtMoney = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function openCustomerView(customer) {
  const dlg = $('customer-view');
  const body = $('customer-view-body');
  $('customer-view-title').textContent = customer.name || 'Customer details';
  body.innerHTML = '<p>Loading customer details and sales bills…</p>';
  dlg.showModal();

  const { data: bills, error } = await sb.from('sales_invoices')
    .select('id,invoice_no,total,status,created_at')
    .eq('branch_id', branchId)
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(500);

  const phone = String(customer.phone || '');
  const phoneActions = phone ? `<div class="cust-phone-actions"><a class="cust-mini-action" href="tel:${encodeURIComponent(phone)}">Call</a><a class="cust-mini-action cust-wa" href="https://wa.me/${waNumber(phone)}" target="_blank" rel="noopener">WhatsApp</a></div>` : '—';
  const details = [
    ['Phone', esc(phone || '—')], ['Email', esc(customer.email || '—')],
    ['Address', esc(customer.address || '—')], ['Age', esc(customer.age ?? '—')],
    ['Gender', esc(customer.gender || '—')], ['WhatsApp consent', customer.consent ? 'Yes' : 'No'],
    ['Credit limit', fmtMoney(customer.credit_limit)], ['Status', customer.active ? 'Active' : 'Inactive']
  ];
  body.innerHTML = `
    <section class="cust-profile-card"><div><h3>${esc(customer.name || '')}</h3><p>${phoneActions}</p></div></section>
    <div class="cust-detail-grid">${details.map(([label, value]) => `<div><small>${label}</small><p>${value}</p></div>`).join('')}</div>
    <section class="cust-history"><h3>Sales bills <span>${error ? 'Unable to load bills' : `${(bills || []).length} bill(s)`}</span></h3>
      ${error ? `<p class="cust-error">${esc(friendly(error))}</p>` : `
      <div class="cust-table-wrap"><table><thead><tr><th>Date</th><th>Invoice No.</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>
      ${(bills || []).map(b => `<tr><td>${fmtDate(b.created_at)}</td><td>${esc(b.invoice_no || '')}</td><td>${esc(b.status || '')}</td><td>${fmtMoney(b.total)}</td><td><button class="sec" data-cust-invoice="${esc(b.id)}">View bill</button></td></tr>`).join('') || '<tr><td colspan="5">No sales bills found for this customer.</td></tr>'}
      </tbody></table></div>`}
    </section>`;
}

async function previewCustomerInvoice(invoiceId, button) {
  button.disabled = true;
  const { data, error } = await sb.rpc('invoice_detail', { p_invoice: invoiceId });
  button.disabled = false;
  if (error) { $('customer-view-body').insertAdjacentHTML('afterbegin', `<p class="cust-error">${esc(friendly(error))}</p>`); return; }
  if (!data?.invoice || !Array.isArray(data.items) || !Array.isArray(data.payments)) {
    $('customer-view-body').insertAdjacentHTML('afterbegin', '<p class="cust-error">Invoice details returned an unexpected format.</p>'); return;
  }
  const invoiceBranchId = data.invoice.branch_id || branchId;
  let branch = null;
  if (invoiceBranchId) {
    const result = await sb.from('branches').select('name,address,city,state,pincode,phone,email,gstin,drug_licence_nos,invoice_footer').eq('id', invoiceBranchId).maybeSingle();
    branch = result.data;
  }
  const address = [branch?.address, branch?.city, branch?.state, branch?.pincode].map(v => String(v || '').trim()).filter(Boolean).join(', ');
  data.shop = {
    name: branch?.name || 'ALZA PHARMACY', address, phone: branch?.phone || '', email: branch?.email || '', gstin: branch?.gstin || '',
    drug_licence: Array.isArray(branch?.drug_licence_nos) ? branch.drug_licence_nos.filter(Boolean).join(' / ') : String(branch?.drug_licence_nos || ''),
    footer_note: branch?.invoice_footer || ''
  };
  showInvoice(data);
}

// Customers page
view.innerHTML = `
<div style="display:flex;gap:.5rem;flex-wrap:wrap">
  <input
    id="q"
    placeholder="Search name or phone"
    style="flex:1;min-width:200px"
  >

  <label>
    <input type="checkbox" id="inact">
    show inactive
  </label>

  <button id="new">+ Add customer</button>
</div>

<div id="msg"></div>

<div style="overflow-x:auto">
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Phone</th>
        <th>Email</th>
        <th>Age</th>
        <th>WhatsApp consent</th>
        <th>Credit limit</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
</div>

<dialog id="dlg">
  <form
    id="f"
    method="dialog"
    style="display:grid;gap:.5rem;min-width:min(92vw,420px)"
  >
    <h3 id="dt"></h3>

    <input type="hidden" name="id">

    <input name="name" placeholder="Name *" required>

    <input
      name="phone"
      placeholder="Phone * (10 digits or +91…)"
      required
      inputmode="tel"
    >

    <input name="email" type="email" placeholder="Email">

    <textarea name="address" placeholder="Address"></textarea>

    <input
      name="age"
      type="number"
      min="0"
      max="120"
      placeholder="Age"
    >

    <select name="gender">
      <option value="">Gender (optional)</option>
      <option value="male">Male</option>
      <option value="female">Female</option>
      <option value="other">Other</option>
    </select>

    <label>
      <input type="checkbox" name="consent">
      Customer agrees to receive WhatsApp messages
    </label>

    <label>
      <input type="checkbox" name="active" checked>
      Active
    </label>

    <div id="err" style="color:#b91c1c"></div>

    <div style="display:flex;gap:.5rem">
      <button type="submit">Save</button>
      <button type="button" class="sec" id="cancel">
        Cancel
      </button>
    </div>
  </form>
</dialog>

<dialog id="customer-view" class="cust-view-dialog">
  <div class="cust-view-content">
    <div class="cust-view-head"><h2 id="customer-view-title">Customer details</h2><button type="button" class="sec" id="customer-view-close">Close</button></div>
    <div id="customer-view-body"><p>Loading customer details…</p></div>
  </div>
</dialog>
`;

const f = $('f');
let list = [];

// Load customers for the logged-in user's branch
async function load() {
  $('msg').textContent = 'Loading customers...';

  let qb = sb
    .from('customers')
    .select('*')
    .eq('branch_id', branchId)
    .order('name')
    .limit(200);

  if (!$('inact').checked) {
    qb = qb.eq('active', true);
  }

  const s = safeQ($('q').value);

  if (s) {
    const phoneSearch = s.replace(/[^0-9+]/g, '');

    qb = qb.or(
      `name.ilike.%${s}%,phone.ilike.%${phoneSearch}%`
    );
  }

  const { data, error } = await qb;

  if (error) {
    $('msg').textContent = friendly(error);
    console.error('Customer loading failed:', error);
    return;
  }

  list = data || [];
  $('msg').textContent = '';

  $('rows').innerHTML = list.map(c => `
    <tr style="${c.active ? '' : 'opacity:.5'}">
      <td>${esc(c.name)}</td>
      <td><div class="cust-phone-actions"><span>${esc(c.phone)}</span><a class="cust-mini-action" href="tel:${encodeURIComponent(c.phone)}">Call</a><a class="cust-mini-action cust-wa" href="https://wa.me/${waNumber(c.phone)}" target="_blank" rel="noopener">WhatsApp</a></div></td>
      <td>${esc(c.email || '')}</td>
      <td>${c.age ?? ''}</td>
      <td>${c.consent ? 'Yes' : 'No'}</td>
      <td>₹${Number(c.credit_limit || 0).toFixed(2)}</td>
      <td>
        <button class="sec" data-view="${c.id}">View</button>
        <button class="sec" data-balance="${c.id}">Credit status</button>
        ${['super_admin','admin'].includes(prof.role) ? `<button class="sec" data-credit="${c.id}">Edit limit</button>` : ''}
        <button class="sec" data-e="${c.id}">
          Edit
        </button>

        <button class="sec" data-t="${c.id}">
          ${c.active ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="7">No customers found.</td>
    </tr>
  `;
}

// Open add/edit form
function open(c = {}) {
  $('dt').textContent = c.id
    ? 'Edit customer'
    : 'Add customer';

  $('err').textContent = '';

  f.reset();

  for (const k of [
    'id',
    'name',
    'phone',
    'email',
    'address',
    'age',
    'gender'
  ]) {
    f.elements[k].value = c[k] ?? '';
  }

  f.elements.consent.checked = !!c.consent;
  f.elements.active.checked = c.active ?? true;

  $('dlg').showModal();
}

// Save customer
f.onsubmit = async e => {
  e.preventDefault();

  $('err').textContent = '';

  const d = Object.fromEntries(new FormData(f));

  const id = d.id;
  delete d.id;

  const name = d.name.trim();
  const phone = d.phone.trim();

  if (!name || !phone) {
    $('err').textContent =
      'Customer name and phone number are required.';
    return;
  }

  const row = {
    name,
    phone,
    email: nul(d.email.trim()),
    address: nul(d.address.trim()),
    age: d.age === '' ? null : Number(d.age),
    gender: nul(d.gender),
    consent: f.elements.consent.checked,
    active: f.elements.active.checked
  };

  if (
    row.age !== null &&
    (!Number.isInteger(row.age) || row.age < 0 || row.age > 120)
  ) {
    $('err').textContent = 'Please enter a valid age.';
    return;
  }

  let result;

  if (id) {
    // Update only a customer belonging to this branch
    result = await sb
      .from('customers')
      .update(row)
      .eq('id', id)
      .eq('branch_id', branchId);
  } else {
    // Assign new customer to the logged-in user's branch
    row.branch_id = branchId;

    result = await sb
      .from('customers')
      .insert(row);
  }

  if (result.error) {
    console.error('Customer save failed:', result.error);

    if (result.error.code === '23505') {
      $('err').textContent =
        'A customer with this phone number already exists.';
    } else if (result.error.code === '23514') {
      $('err').textContent =
        'Please enter a valid phone number.';
    } else {
      $('err').textContent = friendly(result.error);
    }

    return;
  }

  $('dlg').close();
  await load();
};

// Edit and activate/deactivate actions
$('rows').onclick = async e => {
  const b = e.target.closest('button');

  if (!b) return;

  if (b.dataset.view) {
    const customer = list.find(c => c.id === b.dataset.view);
    if (customer) await openCustomerView(customer);
    return;
  }

  if (b.dataset.custInvoice) {
    await previewCustomerInvoice(b.dataset.custInvoice, b);
    return;
  }

  if (b.dataset.balance) {
    const customer = list.find(c => c.id === b.dataset.balance);
    if (!customer) return;

    $('msg').textContent = 'Checking customer credit...';
    const { data: outstanding, error } = await sb.rpc(
      'customer_outstanding',
      { p_customer: customer.id }
    );
    if (error) {
      $('msg').textContent = friendly(error);
      console.error('Customer credit lookup failed:', error);
      return;
    }

    const limit = Number(customer.credit_limit || 0);
    const used = Number(outstanding || 0);
    $('msg').textContent =
      `${customer.name}: Credit limit ₹${limit.toFixed(2)} · Outstanding ₹${used.toFixed(2)} · Available ₹${Math.max(0, limit - used).toFixed(2)}`;
    return;
  }

  if (b.dataset.credit) {
    if (!['super_admin','admin'].includes(prof.role)) {
      $('msg').textContent = 'Only administrators can edit credit limits.';
      return;
    }
    const customer = list.find(c => c.id === b.dataset.credit);
    if (!customer) return;

    const value = prompt(
      `Set credit limit for ${customer.name} (₹):`,
      String(customer.credit_limit || 0)
    );
    if (value === null) return;
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit < 0) {
      $('msg').textContent = 'Enter a valid non-negative credit limit.';
      return;
    }

    $('msg').textContent = 'Saving credit limit...';
    const { error } = await sb.rpc('set_credit_limit', {
      p_customer: customer.id,
      p_limit: limit
    });
    if (error) {
      $('msg').textContent = friendly(error);
      console.error('Credit limit update failed:', error);
      return;
    }
    $('msg').textContent = 'Credit limit updated.';
    await load();
    return;
  }

  if (b.dataset.e) {
    const customer = list.find(c => c.id === b.dataset.e);

    if (customer) {
      open(customer);
    }

    return;
  }

  if (b.dataset.t) {
    const customer = list.find(c => c.id === b.dataset.t);

    if (!customer) return;

    const { error } = await sb
      .from('customers')
      .update({ active: !customer.active })
      .eq('id', customer.id)
      .eq('branch_id', branchId);

    if (error) {
      $('msg').textContent = friendly(error);
      console.error('Customer status update failed:', error);
      return;
    }

    await load();
  }
};

// Customer detail dialog controls
$('customer-view-close').onclick = () => $('customer-view').close();
$('customer-view-body').addEventListener('click', async e => {
  const button = e.target.closest('button[data-cust-invoice]');
  if (button) await previewCustomerInvoice(button.dataset.custInvoice, button);
});

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

// Initial customer list
await load();
