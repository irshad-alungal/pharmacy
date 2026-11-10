import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly } from './ui.js';
import { showInvoice } from './invoice.js';

const prof = await mountShell('sales', 'Sales');
const allowedRoles = ['super_admin', 'admin', 'pharmacist', 'billing_staff'];
if (!allowedRoles.includes(prof.role)) {
  document.getElementById('view').textContent = 'Not authorised to view sales.';
  throw new Error('Not authorised to view sales');
}

const view = document.getElementById('view');
view.innerHTML = `
  <section class="card">
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center">
      <input id="sq" placeholder="Search invoice number or customer name / phone" style="flex:1;min-width:240px">
      <input id="from" type="date" aria-label="From date">
      <input id="to" type="date" aria-label="To date">
      <select id="status"><option value="">All statuses</option><option value="final">Final</option><option value="cancelled">Cancelled</option></select>
      <button id="search">Search</button><button id="refresh" class="sec">Refresh</button>
    </div>
    <p id="sales-msg" role="status" style="min-height:1.4em"></p>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Status</th><th>Total</th><th></th></tr></thead>
        <tbody id="sales-rows"><tr><td colspan="6">Loading invoices…</td></tr></tbody>
      </table>
    </div>
    <p id="sales-count"></p>
  </section>`;

const $ = id => document.getElementById(id);
let invoices = [];
const msg = (s, bad = false) => {
  $('sales-msg').textContent = s;
  $('sales-msg').style.color = bad ? '#b91c1c' : '';
};

function displayRows() {
  const q = $('sq').value.trim().toLowerCase();
  const status = $('status').value;
  const from = $('from').value;
  const to = $('to').value;
  const filtered = invoices.filter(x => {
    const customer = x.customer || {};
    const hay = `${x.invoice_no || ''} ${customer.name || ''} ${customer.phone || ''}`.toLowerCase();
    const day = String(x.created_at || '').slice(0, 10);
    return (!q || hay.includes(q)) &&
      (!status || x.status === status) &&
      (!from || day >= from) &&
      (!to || day <= to);
  });
  $('sales-rows').innerHTML = filtered.map(x => `
    <tr>
      <td>${esc(x.invoice_no || '')}</td>
      <td>${esc(new Date(x.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}</td>
      <td>${esc(x.customer?.name || 'Walk-in')}${x.customer?.phone ? `<br><small>${esc(x.customer.phone)}</small>` : ''}</td>
      <td>${esc(x.status || '')}</td>
      <td>${inr(x.total)}</td>
      <td><button data-view="${esc(x.id)}">Preview / Print</button></td>
    </tr>`).join('') || '<tr><td colspan="6">No invoices found.</td></tr>';
  $('sales-count').textContent = `${filtered.length} invoice(s) shown`;
}

async function loadInvoices() {
  msg('Loading invoices…');
  $('sales-rows').innerHTML = '<tr><td colspan="6">Loading invoices…</td></tr>';
  const { data, error } = await sb.from('sales_invoices')
    .select('id,branch_id,invoice_no,customer_id,total,status,created_at')
    .eq('branch_id', prof.branch_id)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    invoices = [];
    $('sales-rows').innerHTML = `<tr><td colspan="6">${esc(friendly(error))}</td></tr>`;
    msg('Could not load invoices. Check branch access and table permissions.', true);
    $('sales-count').textContent = '';
    return;
  }

  const ids = [...new Set((data || []).map(x => x.customer_id).filter(Boolean))];
  let customerMap = {};
  if (ids.length) {
    const { data: customers, error: customerError } = await sb.from('customers')
      .select('id,name,phone')
      .eq('branch_id', prof.branch_id)
      .in('id', ids);
    if (customerError) {
      msg('Invoices loaded, but customer names could not be loaded: ' + friendly(customerError), true);
    } else {
      customerMap = Object.fromEntries((customers || []).map(c => [c.id, c]));
    }
  }
  invoices = (data || []).map(x => ({ ...x, customer: customerMap[x.customer_id] || null }));
  displayRows();
  if (!error) msg(`${invoices.length} invoice(s) loaded.`);
}

$('search').onclick = displayRows;
$('refresh').onclick = loadInvoices;
$('sq').oninput = displayRows;
$('status').onchange = displayRows;
$('from').onchange = displayRows;
$('to').onchange = displayRows;

$('sales-rows').onclick = async e => {
  const button = e.target.closest('button[data-view]');
  if (!button) return;
  const id = button.dataset.view;
  button.disabled = true;
  msg('Loading invoice preview…');
  const { data, error } = await sb.rpc('invoice_detail', { p_invoice: id });
  button.disabled = false;
  if (error) {
    msg('Invoice preview failed: ' + friendly(error), true);
    return;
  }
  if (!data?.invoice || !Array.isArray(data.items) || !Array.isArray(data.payments)) {
    msg('Invoice detail returned an unexpected format. No print window was opened.', true);
    return;
  }
  // Attach editable pharmacy details using the branch recorded on this invoice.
  // maybeSingle() avoids aborting preview when branch profile is not visible under RLS.
  const invoiceBranchId = data.invoice.branch_id || prof.branch_id;
  let branch = null;
  let branchError = null;
  if (invoiceBranchId) {
    const result = await sb.from('branches')
      .select('name,address,city,state,pincode,phone,email,gstin,drug_licence_nos,invoice_footer')
      .eq('id', invoiceBranchId)
      .maybeSingle();
    branch = result.data;
    branchError = result.error;
  }
  if (branchError) {
    console.warn('Invoice pharmacy profile lookup:', branchError);
  }
  const addressParts = [branch?.address, branch?.city, branch?.state, branch?.pincode]
    .map(v => String(v || '').trim()).filter(Boolean);
  data.shop = {
    name: branch?.name || 'ALZA PHARMACY',
    address: addressParts.join(', '),
    phone: branch?.phone || '',
    email: branch?.email || '',
    gstin: branch?.gstin || '',
    drug_licence: Array.isArray(branch?.drug_licence_nos)
      ? branch.drug_licence_nos.filter(Boolean).join(' / ')
      : String(branch?.drug_licence_nos || ''),
    footer_note: branch?.invoice_footer || ''
  };
  if (!branch) {
    msg('Invoice opened. Pharmacy profile details are not visible for this branch; configure/check Settings access to show them.', true);
  }
  if (branch) msg(`Invoice ${data.invoice.invoice_no} opened.`);
  showInvoice(data);
};

await loadInvoices();
