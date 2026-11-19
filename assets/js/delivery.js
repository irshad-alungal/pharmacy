import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { hasDailyLogin, clearDailyLogin } from './daily-session.js';

const { data: { user: currentUser }, error: currentUserError } = await sb.auth.getUser();
let currentRole = null;
if (currentUser && !currentUserError) {
  const { data: roleData, error: roleError } = await sb.rpc('my_role');
  if (!roleError) currentRole = roleData;
}

if (currentRole === 'delivery_person') {
  await mountDeliveryPersonPage(currentUser);
} else {
  await mountManagementPage();
}

async function mountDeliveryPersonPage(user) {
  // Delivery accounts use the same daily work-session rules as pharmacy staff.
  if (!hasDailyLogin(user.id)) {
    clearDailyLogin();
    await sb.rpc('end_work_session', { p_reason: 'new_day' });
    await sb.auth.signOut();
    location.replace('delivery-boy-login.html');
    return;
  }
  const { data: activeSession, error: activeSessionError } = await sb.rpc('touch_work_session');
  if (activeSessionError || activeSession !== true) {
    clearDailyLogin();
    await sb.auth.signOut();
    location.replace('delivery-boy-login.html');
    return;
  }

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('full_name,is_active,branch_id')
    .eq('id', user.id)
    .single();
  if (profileError || !profile?.is_active || !profile.branch_id) {
    await sb.auth.signOut();
    location.replace('delivery-boy-login.html');
    return;
  }

  document.title = 'PALLIKKAL PHARMACY — My Deliveries';
  document.body.innerHTML = `
    <main class="db-wrap" style="max-width:1100px;margin:0 auto;padding:22px">
      <header class="delivery-head" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h1>My Deliveries</h1><p class="delivery-muted">Welcome, <strong id="riderName"></strong></p></div>
        <div><button id="riderRefresh" class="sec" type="button">↻ Refresh</button> <button id="riderLogout" class="sec" type="button">Sign out</button></div>
      </header>
      <div class="delivery-notice"><strong>Delivery account:</strong> You can view only deliveries assigned to your account. Update each delivery when its status changes.</div>
      <section class="card rider-presence-card" aria-labelledby="riderPresenceTitle">
        <h2 id="riderPresenceTitle">Your availability</h2>
        <p class="delivery-muted">Choose your current status. Billing will show the branch delivery status using active delivery-person selections.</p>
        <div class="rider-presence-actions">
          <button class="rider-presence-btn is-available" data-presence="available" type="button">Delivery Available</button>
          <button class="rider-presence-btn is-purchasing" data-presence="purchasing" type="button">Purchasing</button>
          <button class="rider-presence-btn is-offline" data-presence="offline" type="button">Offline</button>
        </div>
        <p id="riderPresenceMessage" class="delivery-muted" role="status" aria-live="polite">Choose a status.</p>
      </section>
      <p id="riderMessage" class="delivery-muted" role="status" aria-live="polite">Loading assigned deliveries…</p>
      <section class="delivery-stats"><div class="delivery-stat"><small>Assigned to me</small><strong id="riderTotal">0</strong></div><div class="delivery-stat"><small>Pending</small><strong id="riderPending">0</strong></div><div class="delivery-stat"><small>Out for delivery</small><strong id="riderOut">0</strong></div><div class="delivery-stat"><small>Delivered</small><strong id="riderDone">0</strong></div></section>
      <section class="card"><h2>Assigned deliveries</h2><div id="riderJobs" class="delivery-rider-jobs">Loading…</div></section>
    </main>`;

  const $ = id => document.getElementById(id);
  // No idle timer or automatic sign-out. The current-day work session is
  // validated once when this page opens; manual sign-out is explicit.
  $('riderName').textContent = profile.full_name || 'Delivery person';
  const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const statusName = value => ({ pending: 'Pending', out: 'Out for delivery', done: 'Delivered' }[value] || 'Pending');
  let jobs = [];
  const presenceButtons = [...document.querySelectorAll('[data-presence]')];
  let currentPresence = null;
  function renderPresence() {
    presenceButtons.forEach(button => {
      const selected = button.dataset.presence === currentPresence;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    $('riderPresenceMessage').textContent = currentPresence
      ? `Your status: ${{available:'Delivery Available', purchasing:'Purchasing', offline:'Offline'}[currentPresence]}.`
      : 'Choose your current status.';
  }
  presenceButtons.forEach(button => button.addEventListener('click', async () => {
    const next = button.dataset.presence;
    presenceButtons.forEach(item => item.disabled = true);
    $('riderPresenceMessage').textContent = 'Updating status…';
    const { error } = await sb.rpc('delivery_set_presence', { p_status: next });
    if (error) {
      $('riderPresenceMessage').textContent = `Could not update status: ${error.message}`;
    } else {
      currentPresence = next;
      renderPresence();
    }
    presenceButtons.forEach(item => item.disabled = false);
  }));

  function renderJobs() {
    $('riderTotal').textContent = jobs.length;
    $('riderPending').textContent = jobs.filter(job => job.status === 'pending').length;
    $('riderOut').textContent = jobs.filter(job => job.status === 'out').length;
    $('riderDone').textContent = jobs.filter(job => job.status === 'done').length;
    $('riderJobs').innerHTML = jobs.length ? jobs.map(job => {
      const customer = job.customer || {};
      const status = job.status || 'pending';
      const action = status === 'pending'
        ? '<button class="delivery-btn primary" data-rider-status="out" type="button">Mark out for delivery</button>'
        : status === 'out'
          ? '<button class="delivery-btn primary" data-rider-status="done" type="button">Mark delivered</button>'
          : '<span class="delivery-status done">Delivered</span>';
      const phone = String(customer.phone || '');
      const phoneDigits = phone.replace(/\D/g, '');
      return `<article class="card delivery-rider-job" data-rider-job="${esc(job.id)}">
        <div class="delivery-rider-job-head"><div><h3>${esc(job.invoice_no || 'Invoice')}</h3><strong>${esc(customer.name || 'Customer')}</strong><p>${esc(customer.address || 'No delivery address recorded')}</p></div><div><strong>${money(job.total)}</strong><p><span class="delivery-status ${esc(status)}">${esc(statusName(status))}</span></p></div></div>
        <p>Customer phone: ${esc(phone || '—')}</p>
        <div class="delivery-actions">${phone ? `<a class="delivery-btn" href="tel:${encodeURIComponent(phone)}">Call customer</a><a class="delivery-btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/${phoneDigits}">WhatsApp</a>` : ''}${action}</div>
        <p class="delivery-muted" data-rider-message role="status" aria-live="polite"></p>
      </article>`;
    }).join('') : '<div class="delivery-empty">No deliveries are currently assigned to your account.</div>';
  }

  async function loadJobs() {
    $('riderMessage').textContent = 'Loading your assigned deliveries…';
    $('riderJobs').textContent = 'Loading…';
    const { data, error } = await sb.rpc('delivery_my_jobs');
    if (error) {
      jobs = [];
      $('riderMessage').textContent = `Unable to load deliveries: ${error.message}`;
      renderJobs();
      return;
    }
    jobs = Array.isArray(data) ? data : [];
    $('riderMessage').textContent = `${jobs.length} assigned delivery(ies) loaded.`;
    renderJobs();
  }

  $('riderJobs').addEventListener('click', async event => {
    const button = event.target.closest('[data-rider-status]');
    if (!button) return;
    const card = button.closest('[data-rider-job]');
    const job = jobs.find(item => item.id === card?.dataset.riderJob);
    if (!job) return;
    const nextStatus = button.dataset.riderStatus;
    button.disabled = true;
    button.textContent = 'Saving status…';
    const { error } = await sb.rpc('delivery_update_status', { p_invoice_id: job.id, p_status: nextStatus });
    if (error) {
      card.querySelector('[data-rider-message]').textContent = `Could not update status: ${error.message}`;
      button.disabled = false;
      button.textContent = nextStatus === 'out' ? 'Mark out for delivery' : 'Mark delivered';
      return;
    }
    await loadJobs();
  });
  $('riderRefresh').addEventListener('click', loadJobs);
  $('riderLogout').addEventListener('click', async () => {
    $('riderLogout').disabled = true;
    $('riderMessage').textContent = 'Signing out…';
    await sb.rpc('delivery_set_presence', { p_status: 'offline' });
    await sb.rpc('end_work_session', { p_reason: 'manual' });
    clearDailyLogin();
    await sb.auth.signOut();
    location.replace('delivery-boy-login.html');
  });
  const { data: savedPresence, error: savedPresenceError } = await sb.rpc('delivery_presence_my_status');
  if (!savedPresenceError) currentPresence = savedPresence;
  renderPresence();
  await loadJobs();
}

async function mountManagementPage() {
const profile = await mountShell('delivery', 'Delivery Management');
if (!profile) throw new Error('Unable to load user profile.');
const root = document.getElementById('view');
if (!profile.branch_id) { root.textContent = 'Your profile has no assigned branch.'; throw new Error('Missing branch_id'); }

const isAdmin = ['super_admin', 'admin'].includes(String(profile.role || '').toLowerCase());
const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = value => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
const phoneDigits = value => { let n = String(value || '').replace(/\D/g, ''); if (n.length === 10) n = `91${n}`; if (n.startsWith('0') && n.length === 11) n = `91${n.slice(1)}`; return n; };
let orders = [];
let deliveryPeople = [];
let listMode = 'requested';
const $ = id => document.getElementById(id);
const statusLabel = value => ({ pending: 'Pending', out: 'Out for delivery', done: 'Delivered' }[value] || 'Pending');

root.innerHTML = `
<section class="delivery-page">
 <header class="delivery-head"><div><h2>Delivery Management</h2><p class="delivery-muted">Record customer delivery requests, create delivery-person accounts and track assigned deliveries.</p></div><button id="deliveryRefresh" class="sec" type="button">↻ Refresh</button></header>
 <div class="delivery-notice"><strong>Delivery workflow:</strong> Only final bills explicitly marked as delivery requested enter the queue. Assign them to an active delivery-person account; status updates are saved to Supabase.</div>
 ${isAdmin ? `<section class="card delivery-people-card"><h3>Create delivery-person account</h3><p class="delivery-muted">Create a branch-linked Delivery ID and temporary password. Share the credentials securely with the delivery person.</p><form id="deliveryAccountForm" class="delivery-form-grid"><label class="delivery-field">Delivery ID<input id="newDeliveryId" required minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]{3,32}" title="3–32 letters, numbers, dot, dash or underscore" placeholder="Example: RIDER01" autocomplete="off"></label><label class="delivery-field">Full name<input id="newDeliveryName" required maxlength="120" placeholder="Delivery person's name"></label><label class="delivery-field">Phone number<input id="newDeliveryPhone" type="tel" maxlength="30" placeholder="Phone number"></label><label class="delivery-field">Temporary password<input id="newDeliveryPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="Minimum 12 characters"></label><div class="delivery-account-submit"><p id="deliveryAccountMessage" class="delivery-muted" role="status" aria-live="polite"></p><button class="delivery-btn primary" id="createDeliveryAccount" type="submit">Create account</button></div></form></section>` : ''}
 <section class="delivery-stats"><div class="delivery-stat"><small>Delivery requests</small><strong id="dTotal">0</strong></div><div class="delivery-stat"><small>Pending</small><strong id="dPending">0</strong></div><div class="delivery-stat"><small>Out for delivery</small><strong id="dOut">0</strong></div><div class="delivery-stat"><small>Delivered</small><strong id="dDone">0</strong></div></section>
 <section class="card"><div class="delivery-toolbar"><select id="dMode"><option value="requested">Delivery requested</option><option value="all">All final bills</option></select><input id="dSearch" type="search" placeholder="Search invoice, customer or phone"><input id="dFrom" type="date" aria-label="From date"><input id="dTo" type="date" aria-label="To date"><select id="dStatus"><option value="">All delivery statuses</option><option value="pending">Pending</option><option value="out">Out for delivery</option><option value="done">Delivered</option></select></div>
 <p id="dMessage" class="delivery-muted" role="status" aria-live="polite">Loading sales bills…</p><div class="delivery-table-wrap"><table class="delivery-table"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Delivery address</th><th>Amount</th><th>Delivery</th><th>Assigned to</th><th>Actions</th></tr></thead><tbody id="deliveryRows"><tr><td colspan="8">Loading…</td></tr></tbody></table></div><p id="dCount" class="delivery-muted"></p></section>
 <section class="card delivery-people-card"><h3>Delivery-person portal</h3><p class="delivery-muted">Delivery personnel sign in separately and can see only the deliveries assigned to their account.</p><div class="delivery-people-actions"><a class="delivery-btn" href="delivery-boy-login.html">Open delivery-person login</a></div></section>
</section>
<div id="deliveryModal" class="delivery-modal" hidden><div class="delivery-backdrop" data-close-delivery></div><section class="delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="deliveryModalTitle"><button class="delivery-close" data-close-delivery aria-label="Close">×</button><div id="deliveryModalBody"></div></section></div>`;

function isRequested(row) { return Boolean(row.delivery?.is_requested); }
function deliveryStatus(row) { return row.delivery?.status || 'pending'; }
function assigned(row) { return row.delivery_person || null; }

function renderStats() {
 const rows = orders.filter(isRequested);
 $('dTotal').textContent = rows.length;
 $('dPending').textContent = rows.filter(row => deliveryStatus(row) === 'pending').length;
 $('dOut').textContent = rows.filter(row => deliveryStatus(row) === 'out').length;
 $('dDone').textContent = rows.filter(row => deliveryStatus(row) === 'done').length;
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
  return (listMode === 'all' || isRequested(row)) && (!query || haystack.includes(query)) && (!selectedStatus || deliveryStatus(row) === selectedStatus) && (!from || day >= from) && (!to || day <= to);
 });
 $('deliveryRows').innerHTML = rows.map(row => {
  const customer = row.customer || {};
  const person = assigned(row);
  const requestLabel = isRequested(row) ? '<span class="delivery-status done">Requested</span>' : '<span class="delivery-status">Not requested</span>';
  return `<tr><td><strong>${esc(row.invoice_no || '—')}</strong></td><td>${esc(dateText(row.created_at))}</td><td><strong>${esc(customer.name || 'Walk-in')}</strong>${customer.phone ? `<small>${esc(customer.phone)}</small>` : ''}</td><td>${esc(customer.address || 'Not recorded')}</td><td>${money(row.total)}</td><td>${requestLabel}<small>${esc(statusLabel(deliveryStatus(row)))}</small></td><td>${esc(person?.full_name || '—')}</td><td><div class="delivery-actions"><button class="delivery-btn" data-view="${esc(row.id)}" type="button">View</button>${isRequested(row) ? `<button class="delivery-btn primary" data-assign="${esc(row.id)}" type="button">Assign delivery</button>` : ''}</div></td></tr>`;
 }).join('') || '<tr><td colspan="8" class="delivery-empty">No matching bills. Choose “All final bills” to record a customer’s delivery request.</td></tr>';
 $('dCount').textContent = `${rows.length} shown · ${orders.filter(isRequested).length} requested · ${orders.length} final bill(s)`;
 renderStats();
}
async function load() {
 $('dMessage').textContent = 'Loading branch delivery records…';
 $('deliveryRows').innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
 const { data, error } = await sb.rpc('delivery_management_list');
 if (error) {
  orders = []; deliveryPeople = [];
  $('deliveryRows').innerHTML = `<tr><td colspan="8">${esc(error.message || 'Unable to load delivery records.')}</td></tr>`;
  $('dMessage').textContent = 'Could not load delivery records. Confirm migration 0014 has been applied and the delivery RPCs are deployed.';
  renderStats(); return;
 }
 orders = Array.isArray(data?.invoices) ? data.invoices : [];
 deliveryPeople = Array.isArray(data?.delivery_people) ? data.delivery_people : [];
 $('dMessage').textContent = `${orders.length} final bill(s) loaded · ${deliveryPeople.length} active delivery-person account(s) available.`;
 render();
}
function showDetails(id) {
 const row = orders.find(item => item.id === id); if (!row) return;
 const customer = row.customer || {}; const person = assigned(row); const phone = customer.phone || '';
 const contact = phone ? `<div class="delivery-contact"><a class="delivery-btn" href="tel:${encodeURIComponent(phone)}">☎ Call customer</a><a class="delivery-btn" target="_blank" rel="noopener" href="https://wa.me/${phoneDigits(phone)}">WhatsApp</a></div>` : '<p class="delivery-muted">No customer phone number recorded.</p>';
 $('deliveryModalBody').innerHTML = `<h2 id="deliveryModalTitle">Delivery details — ${esc(row.invoice_no || '')}</h2><div class="delivery-detail-grid"><div class="delivery-detail"><small>Customer</small><strong>${esc(customer.name || 'Walk-in')}</strong></div><div class="delivery-detail"><small>Phone</small><strong>${esc(phone || '—')}</strong></div><div class="delivery-detail"><small>Address</small><strong>${esc(customer.address || 'Not recorded')}</strong></div><div class="delivery-detail"><small>Invoice total</small><strong>${money(row.total)}</strong></div><div class="delivery-detail"><small>Invoice date</small><strong>${esc(dateText(row.created_at))}</strong></div><div class="delivery-detail"><small>Delivery status</small><strong>${esc(statusLabel(deliveryStatus(row)))}</strong></div><div class="delivery-detail"><small>Assigned delivery person</small><strong>${esc(person?.full_name || 'Not assigned')}</strong></div><div class="delivery-detail"><small>Delivery person's phone</small><strong>${esc(person?.phone || '—')}</strong></div></div>${contact}<div class="delivery-modal-actions"><button class="delivery-btn ${isRequested(row) ? '' : 'primary'}" data-toggle-request="${esc(id)}" type="button">${isRequested(row) ? 'Remove delivery request' : 'Mark delivery requested'}</button>${isRequested(row) ? `<button class="delivery-btn primary" data-assign="${esc(id)}" type="button">Assign delivery</button>` : ''}</div>`;
 $('deliveryModal').hidden = false;
}
function showAssignment(id) {
 const row = orders.find(item => item.id === id); if (!row) return;
 const existing = assigned(row);
 $('deliveryModalBody').innerHTML = `<h2 id="deliveryModalTitle">Assign delivery</h2><p class="delivery-muted">Invoice ${esc(row.invoice_no || '—')} · ${esc(row.customer?.name || 'Customer')}</p><label class="delivery-field">Delivery person<select id="assignPerson"><option value="">Select delivery person…</option>${deliveryPeople.map(person => `<option value="${esc(person.id)}" ${existing?.id === person.id ? 'selected' : ''}>${esc(person.full_name)} · ${esc(person.staff_id)}</option>`).join('')}</select></label><p id="assignError" class="delivery-error" role="alert"></p><div class="delivery-modal-actions"><button class="delivery-btn primary" data-save-assignment="${esc(id)}" type="button">Save assignment</button></div>`;
 $('deliveryModal').hidden = false;
}
async function callAdminStaff(body) {
 const { data, error } = await sb.functions.invoke('admin-staff', { body });
 if (error) {
  let detail = error.message || 'Request failed';
  if (error.context && typeof error.context.json === 'function') { try { const result = await error.context.json(); detail = result.error || detail; } catch {} }
  throw new Error(detail);
 }
 if (data?.error) throw new Error(data.error);
 return data;
}

$('deliveryRows').addEventListener('click', event => {
 const viewButton = event.target.closest('[data-view]'); const assignButton = event.target.closest('[data-assign]');
 if (viewButton) showDetails(viewButton.dataset.view); else if (assignButton) showAssignment(assignButton.dataset.assign);
});
$('deliveryModalBody').addEventListener('click', async event => {
 const toggle = event.target.closest('[data-toggle-request]');
 if (toggle) {
  toggle.disabled = true;
  const id = toggle.dataset.toggleRequest;
  const row = orders.find(item => item.id === id);
  const { error } = await sb.rpc('delivery_set_request', { p_invoice_id: id, p_requested: !isRequested(row) });
  if (error) { toggle.disabled = false; alert(error.message); return; }
  $('deliveryModal').hidden = true; await load(); return;
 }
 const assignButton = event.target.closest('[data-assign]');
 if (assignButton) { showAssignment(assignButton.dataset.assign); return; }
 const save = event.target.closest('[data-save-assignment]');
 if (save) {
  const personId = $('assignPerson').value;
  if (!personId) { $('assignError').textContent = 'Select an active delivery-person account.'; return; }
  save.disabled = true; save.textContent = 'Saving…';
  const { error } = await sb.rpc('delivery_assign', { p_invoice_id: save.dataset.saveAssignment, p_delivery_person_id: personId });
  if (error) { $('assignError').textContent = error.message; save.disabled = false; save.textContent = 'Save assignment'; return; }
  $('deliveryModal').hidden = true; await load();
 }
});
$('deliveryModal').addEventListener('click', event => { if (event.target.matches('[data-close-delivery]')) $('deliveryModal').hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('deliveryModal').hidden = true; });
['dSearch', 'dFrom', 'dTo'].forEach(id => $(id).addEventListener('input', render));
$('dStatus').addEventListener('change', render);
$('dMode').addEventListener('change', event => { listMode = event.target.value; render(); });
$('deliveryRefresh').addEventListener('click', load);

if (isAdmin) {
 $('deliveryAccountForm').addEventListener('submit', async event => {
  event.preventDefault(); const message = $('deliveryAccountMessage'); const button = $('createDeliveryAccount');
  const staffId = $('newDeliveryId').value.trim(); const fullName = $('newDeliveryName').value.trim();
  const phone = $('newDeliveryPhone').value.trim(); const password = $('newDeliveryPassword').value;
  if (password.length < 12) { message.textContent = 'Temporary password must contain at least 12 characters.'; return; }
  button.disabled = true; button.textContent = 'Creating…'; message.textContent = 'Creating delivery-person account…';
  try {
   const result = await callAdminStaff({ action: 'create', staff_id: staffId, full_name: fullName, phone, role: 'delivery_person', password });
   message.textContent = `${result.message || 'Delivery-person account created successfully.'} Delivery ID: ${result.staff?.staff_id || staffId}.`;
   $('deliveryAccountForm').reset(); await load();
  } catch (error) { message.textContent = `Could not create account: ${error.message}`; }
  finally { button.disabled = false; button.textContent = 'Create account'; }
 });
}

await load();

}
