
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

$('view').innerHTML = `<div class="card"><b>Customer</b><div id="cust"></div></div>
<div class="card"><input id="q" placeholder="Search medicine name or scan barcode" style="width:100%" autofocus><div id="res"></div>
<div style="overflow-x:auto"><table><thead><tr><th>Item</th><th>Batch</th><th>Qty</th><th>Price</th><th></th></tr></thead><tbody id="cart"></tbody></table></div></div>
<div class="card"><b>Payment</b> (split across methods if needed)<div style="margin:.4rem 0"><input id="disc" type="number" min="0" step="0.01" value="0" style="width:9rem"> <span>Discount ₹</span></div>
<div id="pays"></div><button class="sec" id="addp">+ Split payment</button><p id="tot" style="font-weight:bold"></p><p id="rem"></p></div>
<div style="display:flex;gap:.5rem;flex-wrap:wrap"><button id="pay">Finalize bill</button><button class="sec" id="hold">Hold bill</button><button class="sec" id="held">Held bills</button><button class="sec" id="clear">Clear</button></div>
<div id="msg" style="min-height:1.4em;margin-top:.5rem"></div>
<dialog id="hd"><div id="hl" style="min-width:min(92vw,520px)"></div><button class="sec" onclick="hd.close()">Close</button></dialog>
<dialog id="bd"><div id="bl" style="min-width:min(92vw,520px)"></div><button class="sec" id="bc">Close</button></dialog>`;

let cart = [], cust = null, avail = 0, pays = [{ method: 'cash', amount: '' }];
let pendingMed = null;
let pendingBatches = [];

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

// ---- cart
function renderCart() {
  $('cart').innerHTML = cart.map((c, i) => `<tr><td>${esc(c.name)} ${esc(c.strength || '')}</td><td>${esc(c.batch_no)} (exp ${esc(c.expiry)}, ${c.stock} left)</td>
  <td><input type="number" min="1" max="${c.stock}" value="${c.qty}" data-i="${i}" style="width:5rem"></td><td>${inr(c.price * c.qty)}</td><td><button class="sec" data-x="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="5">Cart is empty.</td></tr>';
  updateTot();
}

$('cart').onchange = e => {
  const i = e.target.dataset.i;
  if (i !== undefined) {
    cart[i].qty = Math.min(Math.max(1, +e.target.value || 1), cart[i].stock);
    renderCart();
  }
};

$('cart').onclick = e => {
  const x = e.target.dataset.x;
  if (x !== undefined) {
    cart.splice(+x, 1);
    renderCart();
  }
};

// ---- manual batch selection
async function add(med) {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await sb.from('medicine_batches')
    .select('id,batch_no,expiry,qty')
    .eq('branch_id', prof.branch_id)
    .eq('medicine_id', med.id)
    .eq('quarantined', false)
    .gte('expiry', today)
    .gt('qty', 0)
    .order('expiry');

  if (error) return note(friendly(error), true);

  if (!data?.length) {
    return note(`${med.name}: no sellable stock`, true);
  }

  pendingMed = med;
  pendingBatches = data;

  $('bl').innerHTML = `
    <h3>Select batch — ${esc(med.name)}</h3>
    <p>Select one batch to add to this bill.</p>
    ${data.map(b => `
      <button class="sec"
        data-bid="${esc(b.id)}"
        style="display:block;width:100%;text-align:left;margin:5px 0;padding:10px">
        Batch: ${esc(b.batch_no)}
        · Exp: ${esc(b.expiry)}
        · Stock: ${Number(b.qty).toLocaleString('en-IN')}
      </button>
    `).join('')}
  `;

  $('bd').showModal();
};

$('bl').onclick = e => {
  const btn = e.target.closest('[data-bid]');
  if (!btn || !pendingMed) return;

  const b = pendingBatches.find(x => x.id === btn.dataset.bid);
  if (!b) return;

  // Prevent selecting the same batch twice
  if (cart.some(c => c.batch_id === b.id)) {
    $('bl').querySelector('#batchError')?.remove();

    const warning = document.createElement('p');
    warning.id = 'batchError';
    warning.style.color = '#dc2626';
    warning.style.fontWeight = 'bold';
    warning.style.margin = '10px 0';
    warning.textContent = 'This batch is already added to the bill.';

    $('bl').prepend(warning);
    return;
  }

  cart.push({
    batch_id: b.id,
    name: pendingMed.name,
    strength: pendingMed.strength,
    batch_no: b.batch_no,
    expiry: b.expiry,
    stock: +b.qty,
    price: +pendingMed.selling_price,
    qty: 1
  });

  pendingMed = null;
  pendingBatches = [];
  $('bd').close();
  note('');
  renderCart();
};

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
      .select('id,name,strength,barcode,selling_price,shelf_location')
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
      .select('id,batch_no,expiry,qty,quarantined,medicines(name,strength,selling_price)')
      .eq('branch_id', prof.branch_id)
      .in('id', h.cart.map(c => c.batch_id));

    const today = new Date().toISOString().slice(0, 10);
    const dropped = [];
    cart = [];

    for (const l of h.cart) {
      const b = bs?.find(x => x.id === l.batch_id);

      if (!b || b.quarantined || b.expiry < today || +b.qty <= 0) {
        dropped.push(b?.medicines?.name || 'an item');
        continue;
      }

      cart.push({
        batch_id: b.id,
        name: b.medicines.name,
        strength: b.medicines.strength,
        batch_no: b.batch_no,
        expiry: b.expiry,
        stock: +b.qty,
        price: +b.medicines.selling_price,
        qty: Math.min(l.qty, +b.qty)
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
