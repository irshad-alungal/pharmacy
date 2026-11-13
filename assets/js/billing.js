
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

const $ = id => document.getElementById(id);

$('view').innerHTML = `
<div class="billing-page">
  <div class="billing-topbar">
    <div><div class="eyebrow">POINT OF SALE</div><h2>New bill</h2><p class="muted">Create a pharmacy invoice and record payment.</p></div>
    <div class="bill-meta"><div><span>Bill number</span><strong>Generated on save</strong></div><div><span>Date</span><strong id="billDate"></strong></div></div>
  </div>
  <aside class="delivery-indicator" aria-live="polite"><span class="delivery-dot"></span><div><strong>Delivery status</strong><small>Delivery status connection will be enabled in the next step</small></div></aside>
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
    <div class="table-scroll"><table class="bill-table"><thead><tr><th>Sl no</th><th>Item</th><th>Rack / Shelf</th><th>Batch</th><th>Exp</th><th>Rate</th><th>Qty</th><th>Disc %</th><th>GST %</th><th class="align-right">Amount</th><th></th></tr></thead><tbody id="cart"></tbody></table></div>
    <div class="table-footnote">Automatic batch allocation, line discounts and GST calculation will be connected in the next implementation steps.</div>
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

// The bill date element is created by the markup above, so populate it only after mounting the form.
$('billDate').textContent = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date());

let cart = [], cust = null, avail = 0, pays = [{ method: 'cash', amount: '' }];
let allocationRun = 0;

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

// ---- cart and automatic FEFO batch allocation
const groupKey = med => String(med.id);
const groupRows = key => cart.filter(row => row.group_key === key);
const groupRequestedQty = key => groupRows(key)[0]?.requested_qty || 0;

function renderCart() {
  const groups = [...new Set(cart.map(row => row.group_key))];
  $('cart').innerHTML = cart.map((c, i) => {
    const rows = groupRows(c.group_key);
    const first = rows[0] === c;
    return `<tr>
      <td>${i + 1}</td><td><strong>${esc(c.name)}</strong><small class="table-subtext">${esc(c.strength || '')}${rows.length > 1 ? ` · FEFO split ${rows.indexOf(c) + 1}/${rows.length}` : ''}</small></td>
      <td>${esc(c.shelf_location || '—')}</td><td>${esc(c.batch_no)}</td><td>${esc(c.expiry)}</td>
      <td>${inr(c.price)}</td><td>${first ? `<input aria-label="Total quantity for ${esc(c.name)}" type="number" min="1" step="1" value="${c.requested_qty}" data-group-qty="${esc(c.group_key)}" class="qty-input">` : `<strong>${Number(c.qty).toLocaleString('en-IN')}</strong>`}</td>
      <td><span class="not-ready-value">—</span></td><td>${Number(c.tax_rate || 0)}%</td>
      <td class="align-right"><strong>${inr(c.price * c.qty)}</strong></td><td>${first ? `<button class="remove-item" aria-label="Remove ${esc(c.name)}" data-group-remove="${esc(c.group_key)}">×</button>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="11" class="empty-cart">Your bill is empty. Search and add a medicine above.</td></tr>';
  $('totalItems').textContent = groups.length;
  $('totalQty').textContent = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const shortage = [...new Set(cart.filter(x => x.shortage).map(x => x.name))];
  if (shortage.length) note(`Insufficient stock for: ${shortage.join(', ')}. Reduce the quantity to continue.`, true);
  updateTot();
}

$('cart').onchange = async e => {
  const key = e.target.dataset.groupQty;
  if (!key) return;
  const qty = Math.max(1, Math.floor(Number(e.target.value) || 1));
  const current = groupRows(key)[0];
  if (!current) return;
  await allocateMedicine(current.medicine, qty, key);
};

$('cart').onclick = e => {
  const key = e.target.dataset.groupRemove;
  if (key) {
    cart = cart.filter(row => row.group_key !== key);
    renderCart();
    note('Medicine removed from bill.');
  }
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

async function allocateMedicine(med, requestedQty, key = groupKey(med)) {
  const run = ++allocationRun;
  note(`Allocating ${requestedQty} ${med.name} by earliest expiry…`);
  try {
    const batches = await fetchEligibleBatches(med.id);
    if (run !== allocationRun) return;
    const available = batches.reduce((sum, b) => sum + Number(b.qty || 0), 0);
    let remaining = requestedQty;
    const allocated = [];
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(b.qty || 0));
      if (take <= 0) continue;
      allocated.push({
        group_key: key, medicine_id: med.id, medicine: med,
        batch_id: b.id, name: med.name, strength: med.strength,
        batch_no: b.batch_no, expiry: b.expiry, stock: Number(b.qty),
        price: Number(med.selling_price), shelf_location: med.shelf_location || '',
        tax_rate: Number(med.tax_rate || 0), qty: take,
        requested_qty: requestedQty, shortage: false
      });
      remaining -= take;
    }
    if (!allocated.length) {
      cart = cart.filter(row => row.group_key !== key);
      renderCart();
      return note(`${med.name}: no eligible, unexpired stock available.`, true);
    }
    if (remaining > 0) allocated.forEach(row => row.shortage = true);
    cart = cart.filter(row => row.group_key !== key).concat(allocated);
    renderCart();
    if (remaining > 0) {
      note(`${med.name}: requested ${requestedQty}, but only ${available} is available. Reduce quantity by ${remaining}.`, true);
    } else {
      note(`${med.name}: ${requestedQty} allocated across ${allocated.length} batch${allocated.length === 1 ? '' : 'es'} using earliest expiry first.`);
    }
  } catch (error) {
    note(friendly(error), true);
  }
}

async function add(med) {
  const key = groupKey(med);
  const existing = groupRows(key);
  const nextQty = (existing[0]?.requested_qty || 0) + 1;
  await allocateMedicine(med, nextQty, key);
  $('q').value = '';
  $('res').innerHTML = '';
}

let t;
$('q').oninput = () => {
  clearTimeout(t);
  t = setTimeout(async () => {
    const s = safeQ($('q').value);
    if (s.length < 2) {
      $('res').innerHTML = '';
      return;
    }

    const { data } = await sb.from('medicines')
      .select('id,name,strength,barcode,selling_price,shelf_location,tax_rate')
      .eq('branch_id', prof.branch_id)
      .eq('active', true)
      .or(`name.ilike.%${s}%,barcode.eq.${s}`)
      .limit(8);

    if (data?.length === 1 && data[0].barcode === s) {
      add(data[0]);
      $('q').value = '';
      $('res').innerHTML = '';
      return;
    }

    $('res').innerHTML = (data || []).map(m => `<button class="sec" style="display:block;width:100%;text-align:left;margin:2px 0" data-m='${esc(JSON.stringify(m))}'>${esc(m.name)} ${esc(m.strength || '')} — ${inr(m.selling_price)} · shelf ${esc(m.shelf_location || '-')}</button>`).join('');
  }, 250);
};

$('res').onclick = e => {
  const b = e.target.closest('button');
  if (b) {
    add(JSON.parse(b.dataset.m));
    $('q').value = '';
    $('res').innerHTML = '';
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
  if (cart.some(row => row.shortage)) return note('Resolve insufficient stock before finalizing this bill.', true);

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
    const resumeGroups = new Map();
    for (const l of h.cart) {
      const b = bs?.find(x => x.id === l.batch_id);
      if (!b?.medicines) {
        dropped.push('an unavailable medicine');
        continue;
      }
      const medId = b.medicine_id;
      const entry = resumeGroups.get(medId) || { med: { id: medId, name: b.medicines.name, strength: b.medicines.strength, selling_price: b.medicines.selling_price, shelf_location: b.medicines.shelf_location, tax_rate: b.medicines.tax_rate }, qty: 0 };
      entry.qty += Number(l.qty || 0);
      resumeGroups.set(medId, entry);
    }
    for (const [medId, entry] of resumeGroups) {
      await allocateMedicine(entry.med, entry.qty, String(medId));
      if (groupRows(String(medId)).some(row => row.shortage)) dropped.push(entry.med.name);
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
