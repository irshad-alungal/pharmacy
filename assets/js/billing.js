import { sb, esc, inr } from './supabase-client.js';
import { mountShell } from './navigation.js';

// Use the shared authenticated dashboard shell so Billing, Medicines,
// Customers and other permitted modules are reachable from every page.
const prof = await mountShell('billing', 'Billing counter');
const allowedRoles = ['super_admin', 'admin', 'pharmacist', 'billing'];
if (!allowedRoles.includes(prof.role)) {
  document.getElementById('view').textContent = 'Not authorised for billing.';
  throw new Error('Not authorised for billing');
}
const view = document.getElementById('view');

view.innerHTML = `
  <div class="toolbar" style="display:flex;gap:.5rem;flex-wrap:wrap">
    <input id="q" placeholder="Search name or scan barcode" style="flex:1;min-width:220px" autofocus>
  </div>
  <div id="res" class="res"></div>
  <div style="overflow-x:auto">
    <table>
      <thead><tr><th>Item</th><th>Batch</th><th>Qty</th><th>Price</th><th></th></tr></thead>
      <tbody id="cart"></tbody>
    </table>
  </div>
  <div class="row" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
    <input id="disc" type="number" min="0" step="0.01" value="0" placeholder="Discount ₹">
    <select id="pm">
      <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>
    </select>
    <strong id="tot" style="flex:1;text-align:right"></strong>
    <button id="pay" disabled>Finalize bill</button>
  </div>
  <p id="msg" role="status" aria-live="polite"></p>
`;

const $ = (id) => document.getElementById(id);
const q = $('q');
const res = $('res');
const cartEl = $('cart');
const disc = $('disc');
const pm = $('pm');
const tot = $('tot');
const pay = $('pay');
const msg = $('msg');

let cart = [];
let searchTimer;
let searchVersion = 0;

function showMessage(message, isError = false) {
  msg.textContent = message;
  msg.style.color = isError ? '#b42318' : '';
}

function subtotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function discountValue() {
  const value = Number(disc.value);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function billTotal() {
  return Math.round((subtotal() - discountValue()) * 100) / 100;
}

function render() {
  cartEl.innerHTML = cart.map((item, index) => `
    <tr>
      <td>${esc(item.name)}</td>
      <td>${esc(item.batch_no)} (exp ${esc(item.expiry)}, ${esc(item.stock)} left)</td>
      <td><input type="number" min="1" max="${esc(item.stock)}" step="1"
        value="${esc(item.qty)}" data-qty="${index}" style="width:5rem"></td>
      <td>${inr(item.price * item.qty)}</td>
      <td><button type="button" data-remove="${index}" aria-label="Remove ${esc(item.name)}">✕</button></td>
    </tr>
  `).join('');

  const discount = discountValue();
  const total = billTotal();
  tot.textContent = `Total ${inr(Math.max(0, total))}`;
  if (discount > subtotal()) {
    showMessage('Discount cannot exceed the bill subtotal.', true);
  }
  pay.disabled = cart.length === 0 || total <= 0 || discount > subtotal();
}

cartEl.addEventListener('change', (event) => {
  const index = event.target.dataset.qty;
  if (index === undefined) return;

  const item = cart[Number(index)];
  if (!item) return;

  const requested = Number(event.target.value);
  if (!Number.isFinite(requested) || requested < 1) {
    item.qty = 1;
  } else {
    item.qty = Math.min(Math.floor(requested), item.stock);
  }
  showMessage('');
  render();
});

cartEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-remove]');
  if (!button) return;
  cart.splice(Number(button.dataset.remove), 1);
  showMessage('');
  render();
});

disc.addEventListener('input', render);

async function addMedicine(medicine) {
  showMessage(`Checking stock for ${medicine.name}…`);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const { data: batches, error } = await sb
    .from('medicine_batches')
    .select('id,batch_no,expiry,qty')
    .eq('branch_id', prof.branch_id)
    .eq('medicine_id', medicine.id)
    .eq('quarantined', false)
    .gte('expiry', today)
    .gt('qty', 0)
    .order('expiry', { ascending: true })
    .limit(1);

  if (error) {
    showMessage(`Could not check batch stock: ${error.message}`, true);
    return;
  }

  if (!batches?.length) {
    showMessage(`${medicine.name}: no unexpired, available batch in this branch.`, true);
    return;
  }

  const batch = batches[0];
  const existing = cart.find(item => item.batch_id === batch.id);
  if (existing) {
    existing.qty = Math.min(existing.qty + 1, Number(batch.qty));
  } else {
    cart.push({
      batch_id: batch.id,
      name: medicine.name,
      batch_no: batch.batch_no,
      expiry: batch.expiry,
      stock: Number(batch.qty),
      price: Number(medicine.selling_price),
      qty: 1
    });
  }

  showMessage('');
  render();
}

async function searchMedicines(value, version) {
  const term = value.trim();
  if (!term) {
    res.innerHTML = '';
    return;
  }

  // Separate name and exact-barcode queries avoid injecting user text into
  // PostgREST's .or() filter syntax.
  const [nameResult, barcodeResult] = await Promise.all([
    sb.from('medicines')
      .select('id,name,barcode,selling_price,shelf_location')
      .eq('branch_id', prof.branch_id)
      .eq('active', true)
      .ilike('name', `%${term}%`)
      .order('name')
      .limit(8),
    sb.from('medicines')
      .select('id,name,barcode,selling_price,shelf_location')
      .eq('branch_id', prof.branch_id)
      .eq('active', true)
      .eq('barcode', term)
      .limit(1)
  ]);

  if (version !== searchVersion) return;

  const error = nameResult.error || barcodeResult.error;
  if (error) {
    res.innerHTML = '';
    showMessage(`Medicine search failed: ${error.message}`, true);
    return;
  }

  const byId = new Map();
  for (const medicine of [...(barcodeResult.data || []), ...(nameResult.data || [])]) {
    byId.set(medicine.id, medicine);
  }
  const medicines = [...byId.values()].slice(0, 8);

  const exactBarcode = (barcodeResult.data || [])[0];
  if (exactBarcode && term === exactBarcode.barcode) {
    await addMedicine(exactBarcode);
    q.value = '';
    res.innerHTML = '';
    return;
  }

  if (!medicines.length) {
    res.innerHTML = '<p>No matching active medicines found.</p>';
    return;
  }

  res.innerHTML = medicines.map(medicine => `
    <button type="button" data-medicine-id="${esc(medicine.id)}"
      style="display:block;width:100%;text-align:left;margin:2px 0">
      ${esc(medicine.name)} — ${inr(medicine.selling_price)}
      · shelf ${esc(medicine.shelf_location || '-')}
    </button>
  `).join('');
}

q.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const version = ++searchVersion;
  const term = q.value;
  if (term.trim().length < 2) {
    res.innerHTML = '';
    showMessage('');
    return;
  }
  searchTimer = setTimeout(() => searchMedicines(term, version), 250);
});

res.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-medicine-id]');
  if (!button) return;

  const medicineId = button.dataset.medicineId;
  const { data, error } = await sb
    .from('medicines')
    .select('id,name,barcode,selling_price,shelf_location')
    .eq('id', medicineId)
    .eq('branch_id', prof.branch_id)
    .eq('active', true)
    .single();

  if (error || !data) {
    showMessage(`Could not load medicine: ${error?.message || 'not found'}`, true);
    return;
  }

  await addMedicine(data);
  q.value = '';
  res.innerHTML = '';
  q.focus();
});

pay.addEventListener('click', async () => {
  if (!cart.length) {
    showMessage('Add at least one medicine before finalizing the bill.', true);
    return;
  }

  const discount = discountValue();
  const total = billTotal();

  if (discount > subtotal()) {
    showMessage('Discount cannot exceed the bill subtotal.', true);
    return;
  }
  if (total <= 0) {
    showMessage('Bill total must be greater than ₹0.00.', true);
    return;
  }

  pay.disabled = true;
  showMessage('Saving bill…');

  const { data, error } = await sb.rpc('finalize_sale', {
    p_customer: null,
    p_discount: discount,
    p_items: cart.map(item => ({
      batch_id: item.batch_id,
      qty: item.qty
    })),
    p_payments: [{
      method: pm.value,
      amount: total
    }]
  });

  if (error) {
    showMessage(`Bill was not saved: ${error.message}`, true);
    render();
    return;
  }

  cart = [];
  disc.value = '0';
  render();
  showMessage(`Bill saved successfully. Invoice ID: ${data}`);
  q.value = '';
  q.focus();
});

render();
