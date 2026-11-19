
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly, safeQ } from './ui.js';
import { showInvoice } from './invoice.js';

const prof = await mountShell('billing', 'Billing');
const allowedRoles = ['super_admin', 'admin', 'pharmacist', 'billing_staff'];

if (!allowedRoles.includes(prof.role)) {
  document.getElementById('view').textContent = 'Not authorised for billing.';
  throw new Error('Not authorised for billing');
}

// Daily opening cash is collected during the first successful login of the
// IST day, not whenever the Billing page is opened.

const $ = id => document.getElementById(id);

// Branch-level delivery availability is supplied by delivery-person status
// buttons and read through a branch-scoped SECURITY DEFINER RPC.
async function refreshDeliveryPresence() {
  const indicator = $('deliveryIndicator');
  if (!indicator) return;
  const { data, error } = await sb.rpc('delivery_presence_summary');
  if (error || !data) {
    $('deliveryPresenceLabel').textContent = 'Unavailable';
    $('deliveryPresenceDetail').textContent = 'Could not load delivery availability.';
    indicator.classList.remove('delivery-state-available','delivery-state-purchasing');
    indicator.classList.add('delivery-state-offline');
    return;
  }
  const state = ['available','purchasing','offline'].includes(data.status) ? data.status : 'offline';
  const labels = { available: 'Delivery Available', purchasing: 'Purchasing', offline: 'Offline' };
  const counts = `Available: ${Number(data.available_count || 0)} · Purchasing: ${Number(data.purchasing_count || 0)} · Offline: ${Number(data.offline_count || 0)}`;
  $('deliveryPresenceLabel').textContent = labels[state];
  $('deliveryPresenceDetail').textContent = counts;
  indicator.classList.remove('delivery-state-available','delivery-state-purchasing','delivery-state-offline');
  indicator.classList.add(`delivery-state-${state}`);
}


$('view').innerHTML = `
<div class="billing-page">
  <div class="billing-topbar">
    <div><div class="eyebrow">POINT OF SALE</div><h2>New bill</h2><p class="muted">Create a pharmacy invoice and record payment.</p></div>
    <div class="bill-meta"><div><span>Bill number</span><strong>YYYY-MM-DD-### (generated on save)</strong></div><div><span>Date</span><strong id="billDate"></strong></div></div>
    <div class="shop-state-control">
      <span class="shop-state-label">Shop status</span>
      <button id="shopStateToggle" class="shop-state-toggle is-closed" type="button" aria-pressed="false">Closed</button>
    </div>
  </div>
  <aside id="deliveryIndicator" class="delivery-indicator delivery-state-offline" aria-live="polite">
    <span class="delivery-dot"></span>
    <div><strong>Delivery status: <span id="deliveryPresenceLabel">Offline</span></strong>
    <small id="deliveryPresenceDetail">Checking delivery-person availability…</small></div>
  </aside>
  <section class="billing-card">
    <div class="section-heading"><div><span class="step-label">01 · CUSTOMER & PRESCRIPTION</span><h3>Customer details</h3></div><span class="optional-tag">Patient details are optional</span></div>
    <div class="customer-picker"><div class="field grow"><label>Customer account / phone</label><div id="cust"></div></div></div>
    <div class="patient-grid">
      <div class="field"><label for="doctorName">Dr. name <span>Optional</span></label><input id="doctorName" placeholder="Prescribing doctor's name"></div>
      <div class="field"><label for="patientName">Patient name <span>Optional</span></label><input id="patientName" placeholder="Patient full name"></div>
      <div class="field"><label for="patientPhone">Patient number <span>Optional</span></label><input id="patientPhone" inputmode="tel" placeholder="Mobile number"></div>
      <div class="field"><label for="patientAddress">Patient address <span>Optional</span></label><input id="patientAddress" placeholder="Address"></div>
      <div class="field field-wide"><label for="diagnosis">Diagnosis <span>Optional</span></label><input id="diagnosis" placeholder="Diagnosis / notes"></div>
    </div>
  </section>
  <section class="billing-card medicine-card">
    <div class="section-heading"><div><span class="step-label">02 · MEDICINES</span><h3>Bill items</h3></div><span class="muted">Search by medicine name or scan barcode</span></div>
    <div class="medicine-search"><span class="search-symbol">⌕</span><input id="q" placeholder="Search medicine name or scan barcode" autocomplete="off" autofocus></div>
    <div id="res" class="medicine-results"></div>
    <div id="batchPicker" class="batch-picker" hidden></div>
    <div class="table-scroll"><table class="bill-table"><thead><tr><th>Sl no</th><th>Item</th><th>Rack / Shelf</th><th>Batch</th><th>Exp</th><th>Rate</th><th>Qty</th><th>Disc %</th><th>GST %</th><th class="align-right">Amount</th><th></th></tr></thead><tbody id="cart"></tbody></table></div>
    <div class="table-footnote">Select a batch for each medicine. Quantity is limited to the selected batch’s available stock.</div>
  </section>
  <div class="billing-bottom-grid">
    <section class="billing-card payment-card">
      <div class="section-heading"><div><span class="step-label">03 · PAYMENT</span><h3>Payment details</h3></div><span class="muted">Split payments supported</span></div>
      <div id="pays" class="payment-rows"></div>
      <button class="button-outline" id="addp" type="button">＋ Add another payment method</button>
      <div class="payment-hint">Available methods: Cash, UPI, Card. Any unpaid balance is calculated by the database and assigned to the selected customer's credit account.</div>
    </section>
    <section class="billing-card summary-card">
      <div class="section-heading"><div><span class="step-label">04 · BILL SUMMARY</span><h3>Amount payable</h3></div></div>
      <div class="summary-line"><span>Total items</span><strong id="totalItems">0</strong></div>
      <div class="summary-line"><span>Total quantity</span><strong id="totalQty">0</strong></div>
      <div class="summary-line discount-line"><label for="disc">Overall discount (₹)</label><input id="disc" type="number" min="0" step="0.01" value="0"></div>
      <div class="summary-line"><span>Round off</span><strong>₹0.00</strong></div>
      <div class="summary-total"><span>Grand total</span><strong id="tot">₹0.00</strong></div>
      <p id="rem" class="remaining-note"></p>
    </section>
  </div>
  <div class="billing-actions"><div id="msg" class="billing-message" aria-live="polite"></div><div class="action-buttons"><button id="hold" class="button-outline" type="button">Hold bill</button><button id="held" class="button-outline" type="button">Held bills</button><button id="clear" class="button-ghost" type="button">Clear</button><button id="pay" class="button-primary" type="button">Finalize bill</button></div></div>
</div>
<dialog id="hd" class="billing-dialog"><div id="hl"></div><button class="sec" onclick="this.closest('dialog').close()">Close</button></dialog>
<dialog id="bd" class="billing-dialog"><div id="bl"></div><button class="sec" id="bc" type="button">Close</button></dialog>`;

// Shop status is stored centrally in Supabase so every device sees the same value.
const shopToggle = $('shopStateToggle');
function renderShopStatus(isOpen) {
  shopToggle.textContent = isOpen ? 'Open' : 'Closed';
  shopToggle.classList.toggle('is-open', isOpen);
  shopToggle.classList.toggle('is-closed', !isOpen);
  shopToggle.setAttribute('aria-pressed', String(isOpen));
  shopToggle.setAttribute('aria-label', isOpen ? 'Shop is open. Click to close.' : 'Shop is closed. Click to open.');
}
let shopIsOpen = false;
let shopStatusBusy = false;

async function loadShopStatus() {
  const { data, error } = await sb.rpc('my_shop_open_status');
  if (error) {
    console.error('Could not load shop status:', error);
    return;
  }
  shopIsOpen = data === true;
  renderShopStatus(shopIsOpen);
}

renderShopStatus(false);
loadShopStatus();
shopToggle.addEventListener('click', async () => {
  if (shopStatusBusy) return;
  shopStatusBusy = true;
  shopToggle.disabled = true;
  const requestedStatus = !shopIsOpen;
  try {
    const { data, error } = await sb.rpc('set_shop_open_status', { p_is_open: requestedStatus });
    if (error) throw error;
    shopIsOpen = data === true;
    renderShopStatus(shopIsOpen);
  } catch (error) {
    console.error('Could not update shop status:', error);
    note('Shop status could not be updated. Please try again.', true);
    await loadShopStatus();
  } finally {
    shopStatusBusy = false;
    shopToggle.disabled = false;
  }
});

// The bill date element is created by the markup above, so populate it only after mounting the form.
refreshDeliveryPresence();
setInterval(refreshDeliveryPresence, 15000);

$('billDate').textContent = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date());

let cart = [], cust = null, avail = 0, pays = [{ method: 'cash', amount: '' }];
let pendingMedicine = null, pendingBatches = [];

const note = (m, bad) => {
  $('msg').style.color = bad ? '#b91c1c' : '';
  $('msg').textContent = m;
};

$('bc').onclick = () => $('bd').close();

const sub = () => cart.reduce((s, c) => s + c.price * c.qty, 0);
const total = () => Math.max(0, Math.round((sub() - (+$('disc').value || 0)) * 100) / 100);
const digits10 = s => {
  const d = s.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

// ---- customer
async function setCust(c) {
  cust = c;
  avail = 0;

  if (c) {
    const { data } = await sb.rpc('customer_outstanding', { p_customer: c.id });
    avail = Math.max(0, (+c.credit_limit || 0) - (+data || 0));
  }

  // Credit is represented by the server-generated unpaid remainder, not a cashier-entered row.
  pays.forEach(p => { if (p.method === 'credit') p.method = 'cash'; });

  renderCust();
  renderPays();
}

function renderCust() {
  if (cust) {
    $('cust').innerHTML = `${esc(cust.name)} · ${esc(cust.phone)} ${cust.credit_limit > 0 ? `· credit available ${inr(avail)}` : ''} <button class="sec" id="cc">Walk-in instead</button>`;
    $('cc').onclick = () => setCust(null);
    return;
  }

  $('cust').innerHTML = `<div style="display:flex;gap:.5rem;flex-wrap:wrap"><input id="ph" placeholder="Customer phone (leave blank for walk-in)" inputmode="tel"><button id="cf" class="sec">Find</button></div><div id="cm" style="margin-top:.4rem"></div>`;

  $('cf').onclick = async () => {
    const d = digits10($('ph').value);
    if (!d) {
      $('cm').textContent = 'Enter a 10-digit phone number.';
      return;
    }

    const { data } = await sb.from('customers')
      .select('id,name,phone,consent,credit_limit,active')
      .eq('branch_id', prof.branch_id)
      .ilike('phone', '%' + d)
      .limit(1);

    if (data?.length) {
      if (!data[0].active) {
        $('cm').textContent = 'This customer is inactive.';
        return;
      }
      return setCust(data[0]);
    }

    $('cm').innerHTML = `Not found. <input id="nn" placeholder="New customer name"> <button id="nc">Create & select</button>`;

    $('nc').onclick = async () => {
      if (!$('nn').value.trim()) return;

      const { data: c, error } = await sb.from('customers')
        .insert({ branch_id: prof.branch_id, name: $('nn').value.trim(), phone: d })
        .select('id,name,phone,consent,credit_limit')
        .single();

      if (error) {
        $('cm').textContent = friendly(error);
        return;
      }

      setCust(c);
    };
  };
}

// ---- Explicit batch selection and per-batch quantity limits
function renderCart() {
  $('cart').innerHTML = cart.map((c, i) => `<tr>
    <td>${i + 1}</td>
    <td><strong>${esc(c.name)}</strong><small class="table-subtext">${esc(c.strength || '')}</small></td>
    <td>${esc(c.shelf_location || '—')}</td>
    <td>${esc(c.batch_no)}</td>
    <td>${esc(c.expiry)}</td>
    <td>${inr(c.price)}</td>
    <td><input aria-label="Quantity for ${esc(c.name)} batch ${esc(c.batch_no)}" type="number" min="1" max="${c.stock}" step="1" value="${c.qty}" data-cart-qty="${esc(c.line_id)}" class="qty-input"></td>
    <td><span class="not-ready-value">—</span></td>
    <td>${Number(c.tax_rate || 0)}%</td>
    <td class="align-right"><strong>${inr(c.price * c.qty)}</strong></td>
    <td><button class="remove-item" aria-label="Remove ${esc(c.name)} batch ${esc(c.batch_no)}" data-cart-remove="${esc(c.line_id)}">×</button></td>
  </tr>`).join('') || '<tr><td colspan="11" class="empty-cart">Your bill is empty. Search and select a medicine batch above.</td></tr>';
  $('totalItems').textContent = new Set(cart.map(x => x.medicine_id)).size;
  $('totalQty').textContent = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  updateTot();
}

$('cart').oninput = e => {
  const lineId = e.target.dataset.cartQty;
  if (!lineId) return;
  const row = cart.find(x => x.line_id === lineId);
  if (!row) return;
  const raw = e.target.value;
  if (raw === '') return;
  const entered = Number(raw);
  if (entered > row.stock) {
    e.target.value = String(row.stock);
    row.qty = row.stock;
    updateTot();
    note(`Maximum ${row.stock} unit(s) available in batch ${row.batch_no}.`, true);
  } else if (Number.isInteger(entered) && entered >= 1) {
    row.qty = entered;
    updateTot();
  }
};

$('cart').onchange = e => {
  const lineId = e.target.dataset.cartQty;
  if (!lineId) return;
  const row = cart.find(x => x.line_id === lineId);
  if (!row) return;
  const entered = Number(e.target.value);
  if (!Number.isInteger(entered) || entered < 1) {
    e.target.value = row.qty;
    return note('Quantity must be a whole number of at least 1.', true);
  }
  if (entered > row.stock) {
    e.target.value = row.stock;
    row.qty = row.stock;
    renderCart();
    return note(`Only ${row.stock} unit(s) are available in batch ${row.batch_no}.`, true);
  }
  row.qty = entered;
  renderCart();
  note('Quantity updated.');
};

$('cart').onclick = e => {
  const lineId = e.target.dataset.cartRemove;
  if (!lineId) return;
  cart = cart.filter(row => row.line_id !== lineId);
  renderCart();
  note('Medicine batch removed from bill.');
};

async function fetchEligibleBatches(medicineId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const { data, error } = await sb.from('medicine_batches')
    .select('id,batch_no,expiry,qty,quarantined')
    .eq('branch_id', prof.branch_id)
    .eq('medicine_id', medicineId)
    .eq('quarantined', false)
    .gt('qty', 0)
    .gt('expiry', today)
    .order('expiry', { ascending: true })
    .order('batch_no', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function chooseMedicineBatch(med) {
  pendingMedicine = med;
  $('batchPicker').hidden = false;
  $('batchPicker').textContent = 'Loading available batches…';
  try {
    pendingBatches = await fetchEligibleBatches(med.id);
    if (!pendingBatches.length) {
      $('batchPicker').innerHTML = `<p>${esc(med.name)}: no eligible, unexpired stock available.</p>`;
      return;
    }
    $('batchPicker').innerHTML = `
      <div class="batch-picker-heading"><strong>Select batch for ${esc(med.name)} ${esc(med.strength || '')}</strong><button type="button" class="button-ghost" id="cancelBatchPicker">Cancel</button></div>
      <div class="batch-picker-controls">
        <label>Batch
          <select id="selectedBatch">${pendingBatches.map((b, i) => `<option value="${esc(b.id)}">${esc(b.batch_no)} · Exp ${esc(b.expiry)} · Available ${Number(b.qty).toLocaleString('en-IN')} · ${inr(med.selling_price)}</option>`).join('')}</select>
        </label>
        <label>Quantity
          <input id="selectedBatchQty" type="number" min="1" max="${Number(pendingBatches[0].qty)}" step="1" value="1" inputmode="numeric">
          <small id="selectedBatchStock">Available: ${Number(pendingBatches[0].qty).toLocaleString('en-IN')}</small>
        </label>
        <button type="button" class="button-primary" id="addSelectedBatch">Add batch</button>
      </div>`;
    const batchSelect = $('selectedBatch');
    const qtyInput = $('selectedBatchQty');
    const stockLabel = $('selectedBatchStock');
    const updateBatchLimit = () => {
      const batch = pendingBatches.find(b => b.id === batchSelect.value);
      const stock = Number(batch?.qty || 0);
      qtyInput.max = String(stock);
      if (Number(qtyInput.value) > stock) qtyInput.value = String(stock);
      stockLabel.textContent = `Available: ${stock.toLocaleString('en-IN')}`;
    };
    batchSelect.onchange = updateBatchLimit;
    $('cancelBatchPicker').onclick = () => { $('batchPicker').hidden = true; pendingMedicine = null; };
    $('addSelectedBatch').onclick = () => {
      const batch = pendingBatches.find(b => b.id === batchSelect.value);
      const qty = Number(qtyInput.value);
      const stock = Number(batch?.qty || 0);
      if (!batch) return note('Select a valid batch.', true);
      if (!Number.isInteger(qty) || qty < 1) return note('Enter a whole-number quantity of at least 1.', true);
      if (qty > stock) return note(`Only ${stock} unit(s) are available in this batch.`, true);
      const existing = cart.find(row => row.batch_id === batch.id);
      if (existing) {
        if (existing.qty + qty > stock) return note(`This bill already contains ${existing.qty} unit(s) from this batch. Maximum available is ${stock}.`, true);
        existing.qty += qty;
      } else {
        cart.push({
          line_id: `${batch.id}-${Date.now()}`, medicine_id: med.id,
          batch_id: batch.id, name: med.name, strength: med.strength,
          batch_no: batch.batch_no, expiry: batch.expiry, stock,
          price: Number(med.selling_price), shelf_location: med.shelf_location || '',
          tax_rate: Number(med.tax_rate || 0), qty
        });
      }
      $('batchPicker').hidden = true;
      $('q').value = '';
      $('res').innerHTML = '';
      pendingMedicine = null;
      pendingBatches = [];
      renderCart();
      note(`${med.name} · batch ${batch.batch_no} added (${qty} unit(s)).`);
    };
  } catch (error) {
    $('batchPicker').textContent = friendly(error);
    note(friendly(error), true);
  }
}


// ---- medicine search (restored) and explicit batch selection
let medicineSearchTimer = null;
let medicineSearchRun = 0;

$('q').oninput = () => {
  clearTimeout(medicineSearchTimer);
  const run = ++medicineSearchRun;
  medicineSearchTimer = setTimeout(async () => {
    const term = safeQ($('q').value);
    if (term.length < 2) {
      $('res').innerHTML = '';
      return;
    }

    $('res').innerHTML = '<div class="search-status">Searching medicines…</div>';
    try {
      const { data, error } = await sb.from('medicines')
        .select('id,name,strength,barcode,selling_price,shelf_location,tax_rate')
        .eq('branch_id', prof.branch_id)
        .eq('active', true)
        .or(`name.ilike.%${term}%,barcode.eq.${term}`)
        .order('name', { ascending: true })
        .limit(8);
      if (run !== medicineSearchRun) return;
      if (error) throw error;

      if (!data?.length) {
        $('res').innerHTML = '<div class="search-status">No matching active medicines found.</div>';
        return;
      }

      $('res').innerHTML = data.map(m => `
        <button type="button" class="medicine-result sec" data-m='${esc(JSON.stringify(m))}'>
          <span class="medicine-result-main">
            <strong>${esc(m.name)} ${esc(m.strength || '')}</strong>
            <span class="medicine-result-meta">Barcode: ${esc(m.barcode || '—')} · Shelf: ${esc(m.shelf_location || '—')}</span>
          </span>
          <span class="medicine-result-side"><strong>${inr(m.selling_price)}</strong><span>Select batch</span></span>
        </button>`).join('');

      // An exact barcode match still opens the batch picker; it never bypasses batch choice.
      const exact = data.length === 1 && String(data[0].barcode || '').toLowerCase() === term.toLowerCase();
      if (exact) {
        $('res').querySelector('button')?.click();
      }
    } catch (error) {
      if (run !== medicineSearchRun) return;
      console.error('Medicine search failed:', error);
      $('res').innerHTML = `<div class="search-status search-error">${esc(friendly(error))}</div>`;
      note(`Medicine search failed: ${friendly(error)}`, true);
    }
  }, 250);
};

$('res').onclick = e => {
  const button = e.target.closest('button[data-m]');
  if (!button) return;
  try {
    clearTimeout(medicineSearchTimer);
    medicineSearchRun++;
    const med = JSON.parse(button.dataset.m);
    $('res').innerHTML = '';
    chooseMedicineBatch(med);
  } catch (error) {
    console.error('Could not select medicine:', error);
    note('Could not select this medicine. Please search again.', true);
  }
};

// ---- payments (split)
function renderPays() {
  const ms = ['cash', 'upi', 'card'];

  $('pays').innerHTML = pays.map((p, i) => `<div style="display:flex;gap:.4rem;margin:.3rem 0"><select data-m="${i}">${ms.map(m => `<option value="${m}" ${m === p.method ? 'selected' : ''}>${m.toUpperCase()}</option>`).join('')}</select>
  <input type="number" min="0" step="0.01" data-a="${i}" value="${p.amount}" placeholder="${pays.length === 1 ? 'full amount' : 'amount'}" style="width:9rem"><button class="sec" data-r="${i}">✕</button></div>`).join('');
  updateTot();
}

function paidSum() {
  return pays.length === 1 && pays[0].amount === ''
    ? total()
    : Math.round(pays.reduce((s, p) => s + (+p.amount || 0), 0) * 100) / 100;
}

function updateTot() {
  $('tot').textContent = `Total ${inr(total())}`;
  const r = Math.round((total() - paidSum()) * 100) / 100;
  $('rem').textContent = r === 0 ? '' : r > 0 ? (cust ? `Customer due (subject to credit limit): ${inr(r)}` : `Remaining: ${inr(r)} — select a customer for credit`) : `Over by ${inr(-r)}`;
  $('rem').style.color = r === 0 ? '' : '#b91c1c';
}

$('pays').onchange = e => {
  const { m, a } = e.target.dataset;
  if (m !== undefined) pays[m].method = e.target.value;
  if (a !== undefined) pays[a].amount = e.target.value;
  updateTot();
};

$('pays').oninput = e => {
  const a = e.target.dataset.a;
  if (a !== undefined) {
    pays[a].amount = e.target.value;
    updateTot();
  }
};

$('pays').onclick = e => {
  const r = e.target.dataset.r;
  if (r !== undefined && pays.length > 1) {
    pays.splice(+r, 1);
    renderPays();
  }
};

$('addp').onclick = () => {
  if (pays.length === 1 && pays[0].amount === '') pays[0].amount = total();
  const rest = Math.max(0, Math.round((total() - paidSum()) * 100) / 100);
  pays.push({ method: 'upi', amount: rest || '' });
  renderPays();
};

$('disc').oninput = updateTot;

function reset() {
  cart = [];
  pendingMedicine = null;
  pendingBatches = [];
  if ($('batchPicker')) { $('batchPicker').hidden = true; $('batchPicker').innerHTML = ''; }
  pays = [{ method: 'cash', amount: '' }];
  $('disc').value = 0;
  ['doctorName','patientName','patientPhone','patientAddress','diagnosis'].forEach(id => { if ($(id)) $(id).value = ''; });
  setCust(null);
  renderCart();
}

$('clear').onclick = () => {
  reset();
  note('');
};

// ---- finalize
$('pay').onclick = async () => {
  if (!cart.length) return note('Cart is empty.', true);
  if (cart.some(row => !Number.isInteger(Number(row.qty)) || Number(row.qty) < 1 || Number(row.qty) > Number(row.stock))) return note('A bill quantity exceeds the selected batch stock. Correct it before finalizing.', true);

  const rows = pays.map(p => ({
    method: p.method,
    amount: pays.length === 1 && p.amount === '' ? total() : +p.amount
  })).filter(p => p.amount > 0);

  const cashPaid = paidSum();
  const due = Math.round((total() - cashPaid) * 100) / 100;
  if (due < 0) return note('Payments cannot exceed the bill total.', true);
  if (due > 0 && !cust) return note('Select a customer before leaving an unpaid balance.', true);
  if (due > avail) return note(`Customer credit limit exceeded. Available: ${inr(avail)}.`, true);

  $('pay').disabled = true;
  note(due > 0 ? `Saving bill with ${inr(due)} customer balance…` : 'Saving…');

  const { data, error } = await sb.rpc('finalize_sale', {
    p_customer: cust?.id ?? null,
    p_discount: +$('disc').value || 0,
    p_items: cart.map(c => ({ batch_id: c.batch_id, qty: c.qty })),
    p_payments: rows
  });

  $('pay').disabled = false;
  if (error) return note(friendly(error), true);

  const det = await sb.rpc('invoice_detail', { p_invoice: data });
  reset();
  note(due > 0 ? `Bill saved. Customer balance added: ${inr(due)}.` : 'Bill saved.');

  if (det.error) return note('Bill saved, but the invoice could not be loaded: ' + friendly(det.error), true);

  // Load the pharmacy profile for this invoice's branch so preview, thermal,
  // A4 and PDF all use the same current branch name and contact details.
  const invoiceBranchId = det.data?.invoice?.branch_id || prof.branch_id;
  let branch = null;
  if (invoiceBranchId) {
    const profileResult = await sb.from('branches')
      .select('name,address,city,state,pincode,phone,email,gstin,drug_licence_nos,invoice_footer')
      .eq('id', invoiceBranchId)
      .maybeSingle();
    if (profileResult.error) console.warn('Invoice pharmacy profile lookup:', profileResult.error);
    branch = profileResult.data;
  }
  const addressParts = [branch?.address, branch?.city, branch?.state, branch?.pincode]
    .map(v => String(v || '').trim()).filter(Boolean);
  det.data.shop = {
    name: branch?.name || 'PALLIKKAL PHARMACY',
    address: addressParts.join(', '),
    phone: branch?.phone || '',
    email: branch?.email || '',
    gstin: branch?.gstin || '',
    drug_licence: Array.isArray(branch?.drug_licence_nos)
      ? branch.drug_licence_nos.filter(Boolean).join(' / ')
      : String(branch?.drug_licence_nos || ''),
    footer_note: branch?.invoice_footer || ''
  };
  if (!branch) note('Bill saved. Pharmacy profile could not be loaded; using the default pharmacy name.', true);
  showInvoice(det.data);
};

// ---- hold / resume
$('hold').onclick = async () => {
  if (!cart.length) return note('Nothing to hold.', true);

  const label = prompt('Label for this held bill (optional)') ?? null;
  if (label === null) return;

  const heldPayments = pays.map(p => ({
    method: p.method,
    amount: p.amount === '' ? '' : String(p.amount)
  }));

  const { error } = await sb.from('held_bills').insert({
    label: label.trim() || null,
    customer_id: cust?.id ?? null,
    discount: +$('disc').value || 0,
    cart: cart.map(c => ({ batch_id: c.batch_id, qty: c.qty })),
    payments: heldPayments
  });

  if (error) return note(friendly(error), true);
  reset();
  note('Bill held. Stock is not reserved.');
};

$('held').onclick = async () => {
  const { data } = await sb.from('held_bills')
    .select('id,label,cart,created_at,customer_id,payments')
    .eq('branch_id', prof.branch_id)
    .order('created_at', { ascending: false });

  $('hl').innerHTML = `<h3>Held bills</h3>` + ((data || []).map(h => `<div style="display:flex;gap:.5rem;align-items:center;margin:.3rem 0"><span style="flex:1">${esc(h.label || 'Unnamed')} · ${h.cart.length} item(s) · ${new Date(h.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span><button data-res="${h.id}">Resume</button><button class="sec" data-del="${h.id}">Delete</button></div>`).join('') || 'None.');

  $('hl').onclick = async e => {
    const { res, del } = e.target.dataset;

    if (del) {
      await sb.from('held_bills').delete().eq('id', del).eq('branch_id', prof.branch_id);
      return $('held').click();
    }

    if (!res) return;
    const h = data.find(x => x.id === res);

    if (cart.length && !confirm('Replace the current cart?')) return;

    const { data: bs } = await sb.from('medicine_batches')
      .select('id,medicine_id,batch_no,expiry,qty,quarantined,medicines(name,strength,selling_price,shelf_location,tax_rate)')
      .eq('branch_id', prof.branch_id)
      .in('id', h.cart.map(c => c.batch_id));

    const dropped = [];
    cart = [];
    for (const l of h.cart) {
      const b = bs?.find(x => x.id === l.batch_id);
      if (!b?.medicines || b.quarantined || new Date(`${b.expiry}T00:00:00`) <= new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00')) {
        dropped.push('an unavailable or expired batch');
        continue;
      }
      const stock = Number(b.qty || 0);
      const qty = Number(l.qty || 0);
      if (!Number.isInteger(qty) || qty < 1 || qty > stock) {
        dropped.push(b.batch_no || 'a batch with insufficient stock');
        continue;
      }
      cart.push({
        line_id: `${b.id}-${Date.now()}-${cart.length}`,
        medicine_id: b.medicine_id, batch_id: b.id,
        name: b.medicines.name, strength: b.medicines.strength,
        batch_no: b.batch_no, expiry: b.expiry, stock,
        price: Number(b.medicines.selling_price),
        shelf_location: b.medicines.shelf_location || '',
        tax_rate: Number(b.medicines.tax_rate || 0), qty
      });
    }

    $('disc').value = h.discount;

    pays = Array.isArray(h.payments) && h.payments.length
      ? h.payments.map(p => ({
          method: String(p.method || 'cash').toLowerCase(),
          amount: p.amount == null ? '' : String(p.amount)
        }))
      : [{ method: 'cash', amount: '' }];

    if (h.customer_id) {
      const { data: c } = await sb.from('customers')
        .select('id,name,phone,consent,credit_limit,active')
        .eq('branch_id', prof.branch_id)
        .eq('id', h.customer_id)
        .single();
      await setCust(c?.active ? c : null);
    } else {
      await setCust(null);
    }

    await sb.from('held_bills').delete().eq('id', h.id).eq('branch_id', prof.branch_id);
    $('hd').close();
    renderCart();

    note(dropped.length
      ? `Resumed. Removed (no longer sellable): ${dropped.join(', ')}`
      : 'Bill resumed.', dropped.length > 0);
  };

  $('hd').showModal();
};

renderCust();
renderPays();
renderCart();
