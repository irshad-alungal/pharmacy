import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';

const profile = await mountShell('delivery', 'Delivery Management');
if (!profile) throw new Error('Unable to load user profile.');
const branchId = profile.branch_id;
const root = document.getElementById('view');
if (!branchId) { root.textContent = 'Your profile has no assigned branch.'; throw new Error('Missing branch_id'); }

const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = value => value ? new Date(value).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
const phoneDigits = value => { let n = String(value || '').replace(/\D/g, ''); if (n.length === 10) n = `91${n}`; if (n.startsWith('0') && n.length === 11) n = `91${n.slice(1)}`; return n; };
const STORE_KEY = `alza_delivery_preview_${branchId}`;
let orders = [];
let preview = readPreview();
let listMode = 'requested';

function readPreview() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{"requests":{},"assignments":{},"statuses":{}}'); }
  catch { return { requests: {}, assignments: {}, statuses: {} }; }
}
function savePreview() { localStorage.setItem(STORE_KEY, JSON.stringify(preview)); }
function requested(row) { return Boolean(preview.requests[row.id]); }
function status(row) { return preview.statuses[row.id] || 'pending'; }
function assigned(row) { return preview.assignments[row.id] || null; }

root.innerHTML = `
<section class="delivery-page">
 <header class="delivery-head"><div><h2>Delivery Management</h2><p class="delivery-muted">Only customer-requested deliveries are included. Assign orders to a delivery person and review their work.</p></div><button id="deliveryRefresh" class="sec" type="button">↻ Refresh</button></header>
 <div class="delivery-notice"><strong>Optional delivery:</strong> A bill enters the delivery queue only after staff records the customer's request. This frontend preview stores request and assignment choices in this browser only; it is not yet shared with delivery-person accounts or saved to Supabase.</div>
 <section class="delivery-stats"><div class="delivery-stat"><small>Delivery requests</small><strong id="dTotal">0</strong></div><div class="delivery-stat"><small>Pending</small><strong id="dPending">0</strong></div><div class="delivery-stat"><small>Out for delivery</small><strong id="dOut">0</strong></div><div class="delivery-stat"><small>Delivered</small><strong id="dDone">0</strong></div></section>
 <section class="card"><div class="delivery-toolbar"><select id="dMode"><option value="requested">Delivery requested</option><option value="all">All final bills</option></select><input id="dSearch" type="search" placeholder="Search invoice, customer or phone"><input id="dFrom" type="date" aria-label="From date"><input id="dTo" type="date" aria-label="To date"><select id="dStatus"><option value="">All delivery statuses</option><option value="pending">Pending</option><option value="out">Out for delivery</option><option value="done">Delivered</option></select></div>
 <p id="dMessage" class="delivery-muted" role="status" aria-live="polite">Loading sales bills…</p><div class="delivery-table-wrap"><table class="delivery-table"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Delivery address</th><th>Amount</th><th>Delivery</th><th>Assigned to</th><th>Actions</th></tr></thead><tbody id="deliveryRows"><tr><td colspan="8">Loading…</td></tr></tbody></table></div><p id="dCount" class="delivery-muted"></p></section>
 <section class="card delivery-people-card"><h3>Delivery person access (frontend preview)</h3><p class="delivery-muted">The login and dashboard screens are prepared separately. Delivery-person accounts and secure role-based access must be connected in the backend before operational use.</p><div class="delivery-people-actions"><a class="delivery-btn" href="delivery-boy-login.html">Open delivery person login</a><a class="delivery-btn" href="delivery-boy.html">Preview delivery person dashboard</a></div></section>
</section>
<div id="deliveryModal" class="delivery-modal" hidden><div class="delivery-backdrop" data-close-delivery></div><section class="delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="deliveryModalTitle"><button class="delivery-close" data-close-delivery aria-label="Close">×</button><div id="deliveryModalBody"></div></section></div>`;
const $ = id => document.getElementById(id);

function renderStats() {
 const rows = orders.filter(requested);
 $('dTotal').textContent = rows.length;
 $('dPending').textContent = rows.filter(row => status(row) === 'pending').length;
 $('dOut').textContent = rows.filter(row => status(row) === 'out').length;
 $('dDone').textContent = rows.filter(row => status(row) === 'done').length;
}
function render() {
 const query = $('dSearch').value.trim().toLowerCase();
 const selectedStatus = $('dStatus').value;
 const from = $('dFrom').value;
 const to = $('dTo').value;
 const rows = orders.filter(row => {
  const day = String(row.created_at || '').slice(0, 10);
  const customer = row.customer || {};
  const haystack = `${row.invoice_no || ''} ${customer.name || ''} ${customer.phone || ''}`.toLowerCase();
  return (listMode === 'all' || requested(row)) && (!query || haystack.includes(query)) && (!selectedStatus || status(row) === selectedStatus) && (!from || day >= from) && (!to || day <= to);
 });
 $('deliveryRows').innerHTML = rows.map(row => {
  const customer = row.customer || {};
  const person = assigned(row);
  const requestLabel = requested(row) ? '<span class="delivery-status done">Requested</span>' : '<span class="delivery-status">Not requested</span>';
  return `<tr><td><strong>${esc(row.invoice_no || '—')}</strong></td><td>${esc(dateText(row.created_at))}</td><td><strong>${esc(customer.name || 'Walk-in')}</strong>${customer.phone ? `<small>${esc(customer.phone)}</small>` : ''}</td><td>${esc(customer.address || 'Not recorded')}</td><td>${money(row.total)}</td><td>${requestLabel}<small>${esc(status(row))}</small></td><td>${esc(person?.name || '—')}</td><td><div class="delivery-actions"><button class="delivery-btn" data-view="${esc(row.id)}" type="button">View</button>${requested(row) ? `<button class="delivery-btn primary" data-assign="${esc(row.id)}" type="button">Assign delivery</button>` : ''}</div></td></tr>`;
 }).join('') || '<tr><td colspan="8" class="delivery-empty">No matching bills. Choose “All final bills” to record a customer’s delivery request.</td></tr>';
 $('dCount').textContent = `${rows.length} shown · ${orders.filter(requested).length} requested · ${orders.length} final bill(s)`;
 renderStats();
}
async function load() {
 preview = readPreview();
 $('dMessage').textContent = 'Loading branch sales bills…';
 $('deliveryRows').innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
 const { data, error } = await sb.from('sales_invoices').select('id,branch_id,invoice_no,customer_id,total,status,created_at').eq('branch_id', branchId).eq('status', 'final').order('created_at', { ascending: false }).limit(500);
 if (error) {
  orders = [];
  $('deliveryRows').innerHTML = `<tr><td colspan="8">${esc(error.message || 'Unable to load bills.')}</td></tr>`;
  $('dMessage').textContent = 'Could not load sales bills. Check branch access and table permissions.';
  renderStats();
  return;
 }
 const ids = [...new Set((data || []).map(row => row.customer_id).filter(Boolean))];
 let customerMap = {};
 if (ids.length) {
  const result = await sb.from('customers').select('id,name,phone,address').eq('branch_id', branchId).in('id', ids);
  if (!result.error) customerMap = Object.fromEntries((result.data || []).map(customer => [customer.id, customer]));
 }
 orders = (data || []).map(row => ({ ...row, customer: customerMap[row.customer_id] || null }));
 $('dMessage').textContent = `${orders.length} final bill(s) loaded. Only customer-requested deliveries appear in the default queue.`;
 render();
}
function showDetails(id) {
 const row = orders.find(item => item.id === id);
 if (!row) return;
 const customer = row.customer || {};
 const person = assigned(row);
 const phone = customer.phone || '';
 const contact = phone ? `<div class="delivery-contact"><a class="delivery-btn" href="tel:${encodeURIComponent(phone)}">☎ Call customer</a><a class="delivery-btn" target="_blank" rel="noopener" href="https://wa.me/${phoneDigits(phone)}">WhatsApp</a></div>` : '<p class="delivery-muted">No customer phone number recorded.</p>';
 $('deliveryModalBody').innerHTML = `<h2 id="deliveryModalTitle">Delivery details — ${esc(row.invoice_no || '')}</h2><div class="delivery-detail-grid"><div class="delivery-detail"><small>Customer</small><strong>${esc(customer.name || 'Walk-in')}</strong></div><div class="delivery-detail"><small>Phone</small><strong>${esc(phone || '—')}</strong></div><div class="delivery-detail"><small>Address</small><strong>${esc(customer.address || 'Not recorded')}</strong></div><div class="delivery-detail"><small>Invoice total</small><strong>${money(row.total)}</strong></div><div class="delivery-detail"><small>Invoice date</small><strong>${esc(dateText(row.created_at))}</strong></div><div class="delivery-detail"><small>Delivery status</small><strong>${esc(status(row))}</strong></div><div class="delivery-detail"><small>Assigned delivery person</small><strong>${esc(person?.name || 'Not assigned')}</strong></div><div class="delivery-detail"><small>Delivery person's phone</small><strong>${esc(person?.phone || '—')}</strong></div></div>${contact}<div class="delivery-modal-actions"><button class="delivery-btn ${requested(row) ? '' : 'primary'}" data-toggle-request="${esc(id)}" type="button">${requested(row) ? 'Remove delivery request' : 'Mark delivery requested'}</button>${requested(row) ? `<button class="delivery-btn primary" data-assign="${esc(id)}" type="button">Assign delivery</button>` : ''}</div>`;
 $('deliveryModal').hidden = false;
}
function showAssignment(id) {
 const row = orders.find(item => item.id === id);
 if (!row) return;
 const existing = assigned(row) || {};
 $('deliveryModalBody').innerHTML = `<h2 id="deliveryModalTitle">Assign delivery</h2><p class="delivery-muted">Invoice ${esc(row.invoice_no || '—')} · ${esc(row.customer?.name || 'Customer')}</p><label class="delivery-field">Delivery person's name<input id="assignName" value="${esc(existing.name || '')}" placeholder="Enter delivery person's name"></label><label class="delivery-field">Delivery person's phone<input id="assignPhone" type="tel" value="${esc(existing.phone || '')}" placeholder="Enter phone number"></label><p id="assignError" class="delivery-error" role="alert"></p><div class="delivery-modal-actions"><button class="delivery-btn primary" data-save-assignment="${esc(id)}" type="button">Save assignment</button></div>`;
 $('deliveryModal').hidden = false;
}
$('deliveryRows').addEventListener('click', event => {
 const viewButton = event.target.closest('[data-view]');
 const assignButton = event.target.closest('[data-assign]');
 if (viewButton) showDetails(viewButton.dataset.view);
 else if (assignButton) showAssignment(assignButton.dataset.assign);
});
$('deliveryModalBody').addEventListener('click', event => {
 const toggle = event.target.closest('[data-toggle-request]');
 if (toggle) {
  const id = toggle.dataset.toggleRequest;
  if (preview.requests[id]) delete preview.requests[id]; else preview.requests[id] = true;
  savePreview(); showDetails(id); render(); return;
 }
 const assignButton = event.target.closest('[data-assign]');
 if (assignButton) { showAssignment(assignButton.dataset.assign); return; }
 const save = event.target.closest('[data-save-assignment]');
 if (save) {
  const name = $('assignName').value.trim();
  const phone = $('assignPhone').value.trim();
  if (!name) { $('assignError').textContent = 'Enter the delivery person's name.'; return; }
  const assignedOrder = orders.find(item => item.id === save.dataset.saveAssignment);
  preview.assignments[save.dataset.saveAssignment] = { name, phone, invoice_no: assignedOrder?.invoice_no || '', customer_name: assignedOrder?.customer?.name || 'Customer', customer_phone: assignedOrder?.customer?.phone || '', address: assignedOrder?.customer?.address || '', total: assignedOrder?.total || 0, created_at: assignedOrder?.created_at || '', branch_id: branchId };
  savePreview(); $('deliveryModal').hidden = true; render();
 }
});
$('deliveryModal').addEventListener('click', event => { if (event.target.matches('[data-close-delivery]')) $('deliveryModal').hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('deliveryModal').hidden = true; });
['dSearch', 'dFrom', 'dTo'].forEach(id => $(id).addEventListener('input', render));
$('dStatus').addEventListener('change', render);
$('dMode').addEventListener('change', event => { listMode = event.target.value; render(); });
$('deliveryRefresh').addEventListener('click', load);
await load();
