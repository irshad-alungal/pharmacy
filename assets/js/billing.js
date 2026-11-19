
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly, safeQ } from './ui.js';
import { showInvoice } from './invoice.js';
import { calcLine, validateLineInput, summarize, detectAnomalies, explainAllocation, GST_FALLBACK_RATES } from './billing-engine.js';
import { mountAssistant } from './billing-assistant.js';

const prof = await mountShell('billing', 'Billing');
const allowedRoles = ['super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing'];

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
    <div class="section-heading"><div><span class="step-label">02 · MEDICINES</span><h3>Bill items</h3></div><span class="muted">Search, enter quantity — batches are allocated automatically (earliest expiry first)</span></div>
    <div class="medicine-search"><span class="search-symbol">⌕</span><input id="q" placeholder="Search medicine name or scan barcode" autocomplete="off" autofocus></div>
    <div id="res" class="medicine-results"></div>
    <div class="table-scroll"><table class="bill-table fefo-table"><thead><tr>
      <th>#</th><th>Medicine / Batch</th><th>Expiry</th><th class="align-right">MRP</th><th class="align-right">Qty</th>
      <th class="align-right">Disc %</th><th class="align-right">Disc ₹</th><th class="align-right">GST %</th><th class="align-right">GST ₹</th>
      <th class="align-right">Net (taxable)</th><th class="align-right">Amount</th><th></th>
    </tr></thead><tbody id="cart"></tbody></table></div>
    <div class="table-footnote" id="permNote">Batches are allocated First-Expiry-First-Out and reserved for this bill. Expired, quarantined, recalled, blocked and zero-stock batches are never allocated. Stock is revalidated and deducted only when the bill is finalized.</div>
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
      <div class="summary-line"><span>Medicines / batch lines</span><strong id="totalItems">0</strong></div>
      <div class="summary-line"><span>Total quantity</span><strong id="totalQty">0</strong></div>
      <div class="summary-line"><span>Gross (MRP × qty)</span><strong id="sumBase">₹0.00</strong></div>
      <div class="summary-line"><span>Line discounts</span><strong id="sumDisc">₹0.00</strong></div>
      <div class="summary-line"><span>Taxable value</span><strong id="sumTaxable">₹0.00</strong></div>
      <div class="summary-line"><span>GST</span><strong id="sumGst">₹0.00</strong></div>
      <div class="summary-line"><span>Bill amount</span><strong id="sumSub">₹0.00</strong></div>
      <div class="summary-line discount-line"><label for="disc">Overall discount (₹)</label><input id="disc" type="number" min="0" step="0.01" value="0"></div>
      <div class="summary-total"><span>Grand total</span><strong id="tot">₹0.00</strong></div>
      <p id="rem" class="remaining-note"></p>
    </section>
  </div>
  <section class="billing-card assistant-card" id="assistant"></section>
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

// ============================================================================
// Billing configuration & permissions (server-side rules are authoritative)
// ============================================================================
let cfg = {
  permissions: { discount: false, gst_edit: false, mrp_edit: false, batch_override: false },
  max_discount_pct: 30, near_expiry_days: 90, reservation_minutes: 15,
  gst_rates: GST_FALLBACK_RATES,
  today: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
};
{
  const { data, error } = await sb.rpc('billing_my_config');
  if (error) console.warn('billing_my_config unavailable — apply migration 0020:', error);
  else cfg = { ...cfg, ...data, gst_rates: (data.gst_rates || GST_FALLBACK_RATES).map(Number) };
}
const perm = cfg.permissions;
$('disc').disabled = !perm.discount;
if (!perm.discount) $('disc').title = 'You do not have permission to apply discounts';
$('permNote').insertAdjacentText('beforeend',
  ` Editing: discount ${perm.discount ? `allowed (max ${cfg.max_discount_pct}%)` : 'not permitted'} · GST ${perm.gst_edit ? 'allowed' : 'not permitted'} · MRP ${perm.mrp_edit ? 'allowed (up to printed MRP)' : 'not permitted'} · batch override ${perm.batch_override ? 'allowed' : 'not permitted'}.`);

// ============================================================================
// State
// ============================================================================
let cust = null, avail = 0, pays = [{ method: 'cash', amount: '' }];
let cartToken = crypto.randomUUID();
// One group per medicine. Each group holds the server FEFO allocation (rows)
// and the user's edits, keyed by batch so re-allocation keeps them.
let groups = [];
const qtyTimers = new Map();

const note = (m, bad) => {
  $('msg').style.color = bad ? '#b91c1c' : '';
  $('msg').textContent = m;
};

$('bc').onclick = () => $('bd').close();

const digits10 = s => {
  const d = s.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};
const num = v => (v === '' || v == null ? NaN : Number(v));
const fmtQty = v => Number(v || 0).toLocaleString('en-IN');
const findGroup = key => groups.find(g => g.key === key);

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

// ============================================================================
// Deterministic per-row values (billing-engine.js; mirrors the database)
// ============================================================================
function rowValues(g, r) {
  const e = g.edits.get(r.batch_id) || {};
  const defaultMrp = Number(r.mrp);
  const defaultDiscountPct = Number(r.default_discount_pct || 0);
  const defaultGstPct = Number(r.tax_rate || 0);
  const mrp = e.mrp ?? defaultMrp;
  const discountPct = e.discountPct ?? g.discountPct ?? defaultDiscountPct;
  const gstPct = e.gstPct ?? defaultGstPct;
  const qty = Number(r.qty);
  const includes = r.price_includes_tax !== false;
  const errors = validateLineInput({ mrp, qty, discountPct, gstPct }, {
    maxDiscountPct: discountPct === defaultDiscountPct ? 100 : Math.max(cfg.max_discount_pct, defaultDiscountPct),
    gstRates: cfg.gst_rates,
    maxMrp: defaultMrp > 0 ? defaultMrp : 0
  });
  if (mrp !== defaultMrp && !perm.mrp_edit) errors.push('MRP change not permitted.');
  if (discountPct !== defaultDiscountPct && !perm.discount) errors.push('Discount change not permitted.');
  if (gstPct !== defaultGstPct && !perm.gst_edit) errors.push('GST change not permitted.');
  let calc = null;
  if (!errors.length) {
    try { calc = calcLine({ mrp, qty, discountPct, gstPct, priceIncludesTax: includes }); }
    catch (err) { errors.push(err.message); }
  }
  return { mrp, discountPct, gstPct, qty, includes, defaultMrp, defaultDiscountPct, defaultGstPct, errors, calc };
}

function groupTotals(g) {
  const rows = g.alloc?.rows || [];
  const vals = rows.map(r => rowValues(g, r));
  const valid = vals.filter(v => v.calc).map(v => v.calc);
  return { vals, total: summarize(valid).subtotal, errors: vals.some(v => v.errors.length) };
}

function computeBill() {
  const lines = [];
  let qty = 0, batchLines = 0, invalid = false;
  for (const g of groups) {
    for (const r of g.alloc?.rows || []) {
      const v = rowValues(g, r);
      batchLines++;
      qty += v.qty;
      if (v.calc) lines.push(v.calc); else invalid = true;
    }
  }
  const s = summarize(lines, +$('disc').value || 0);
  return { ...s, qty, batchLines, invalid };
}

const total = () => computeBill().grandTotal;

// ============================================================================
// Rendering
// ============================================================================
const statusText = g => {
  if (g.pending) return `<span class="fefo-status pending">Allocating ${fmtQty(g.requestedQty)} by earliest expiry…</span>`;
  if (g.error) return `<span class="fefo-status bad">${esc(g.error)}</span>`;
  const a = g.alloc;
  if (!a) return '';
  const bits = [];
  if (Number(a.shortage) > 0) bits.push(`<span class="fefo-status bad">Insufficient stock: requested ${fmtQty(a.requested)}, available ${fmtQty(a.available_total)}, short ${fmtQty(a.shortage)}</span>`);
  else bits.push(`<span class="fefo-status ok">${fmtQty(a.allocated)} allocated from ${a.rows.length} batch${a.rows.length === 1 ? '' : 'es'}${a.manual ? ' (manual override)' : ' (FEFO)'}</span>`);
  const ex = a.excluded || {};
  const skipped = [ex.expired && `${ex.expired} expired`, ex.blocked_or_recalled && `${ex.blocked_or_recalled} blocked/recalled/quarantined`, ex.fully_reserved && `${ex.fully_reserved} reserved by other bills`].filter(Boolean);
  if (skipped.length) bits.push(`<span class="fefo-status muted-status">Skipped: ${skipped.join(', ')}</span>`);
  return bits.join(' ');
};

const dateShort = d => {
  const x = new Date(String(d) + 'T00:00:00');
  return Number.isNaN(x.getTime()) ? esc(d) : x.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

// Full re-render that keeps the user's caret in the field they were typing in.
function renderCart() {
  const a = document.activeElement;
  const sel = a && $('cart').contains(a)
    ? (a.dataset.gqty ? `[data-gqty="${CSS.escape(a.dataset.gqty)}"]`
      : a.dataset.gdisc ? `[data-gdisc="${CSS.escape(a.dataset.gdisc)}"]`
      : a.dataset.row ? `[data-row="${CSS.escape(a.dataset.row)}"][data-field="${a.dataset.field}"]` : null)
    : null;
  const caret = sel && a.type !== 'number' && 'selectionStart' in a ? a.selectionStart : null;
  const typed = sel ? a.value : null;
  renderCartRows();
  if (sel) {
    const n = $('cart').querySelector(sel);
    if (n) {
      if (typed != null && n.tagName === 'INPUT') n.value = typed;
      n.focus();
      if (caret != null) try { n.setSelectionRange(caret, caret); } catch { /* number inputs */ }
    }
  }
}

function paintGroupStatus(g) {
  const tr = $('cart').querySelector(`tr[data-group="${CSS.escape(g.key)}"] .fefo-status-line`);
  if (tr) tr.innerHTML = statusText(g);
}

function renderCartRows() {
  let sl = 0;
  const html = groups.map(g => {
    const t = groupTotals(g);
    const rows = g.alloc?.rows || [];
    const canOverride = perm.batch_override && g.alloc && (g.alloc.candidates || []).length > 0;
    const groupDisc = g.discountPct == null ? (rows.length ? Number(rows[0].default_discount_pct || 0) : 0)
      : (Number.isFinite(g.discountPct) ? g.discountPct : '');
    const head = `<tr class="group-row${g.need_doctor_sheet ? ' requires-prescription' : ''}" data-group="${esc(g.key)}">
      <td>${++sl}</td>
      <td colspan="3"><strong>${esc(g.name)}</strong> <small class="table-subtext">${esc(g.strength || '')}${g.shelf_location ? ` · Shelf ${esc(g.shelf_location)}` : ''}${g.need_doctor_sheet ? ' · <b class="rx-tag">Prescription required</b>' : ''}</small>
        <div class="fefo-status-line">${statusText(g)}</div></td>
      <td class="align-right"><input aria-label="Requested quantity for ${esc(g.name)}" type="number" min="1" step="1" inputmode="numeric" value="${g.requestedQty}" data-gqty="${esc(g.key)}" class="qty-input"></td>
      <td class="align-right"><input aria-label="Discount % for all batches of ${esc(g.name)}" type="number" min="0" max="100" step="0.01" value="${groupDisc}" data-gdisc="${esc(g.key)}" class="pct-input" ${perm.discount ? '' : 'disabled title="No permission to edit discount"'}></td>
      <td colspan="4"></td>
      <td class="align-right"><strong class="g-total" data-gtotal="${esc(g.key)}">${t.errors ? '—' : inr(t.total)}</strong></td>
      <td class="row-actions">${canOverride ? `<button type="button" class="link-btn" data-override="${esc(g.key)}" title="Manually choose batches">Batches</button>` : ''}<button type="button" class="link-btn" data-explain="${esc(g.key)}" title="Explain allocation">Why?</button><button class="remove-item" aria-label="Remove ${esc(g.name)}" data-gremove="${esc(g.key)}">×</button></td>
    </tr>`;
    const body = rows.map(r => {
      const v = rowValues(g, r);
      const id = `${g.key}|${r.batch_id}`;
      const near = r.near_expiry ? `<span class="badge warn" title="Expires in ${r.days_to_expiry} day(s)">Near expiry</span>` : '';
      const man = r.manual ? '<span class="badge info">Manual</span>' : '';
      const mrpCell = perm.mrp_edit
        ? `<input type="number" min="0" step="0.01" value="${v.mrp}" data-field="mrp" data-row="${esc(id)}" class="money-input" aria-label="MRP for batch ${esc(r.batch_no)}">`
        : inr(v.mrp);
      const discCell = perm.discount
        ? `<input type="number" min="0" max="100" step="0.01" value="${v.discountPct}" data-field="discountPct" data-row="${esc(id)}" class="pct-input" aria-label="Discount % for batch ${esc(r.batch_no)}">`
        : `${v.discountPct}%`;
      const rates = [...new Set([...cfg.gst_rates, v.gstPct, v.defaultGstPct])].sort((a, b) => a - b);
      const gstCell = perm.gst_edit
        ? `<select data-field="gstPct" data-row="${esc(id)}" aria-label="GST % for batch ${esc(r.batch_no)}">${rates.map(x => `<option value="${x}" ${x === v.gstPct ? 'selected' : ''}>${x}%</option>`).join('')}</select>`
        : `${v.gstPct}%`;
      return `<tr class="batch-row" data-rowid="${esc(id)}">
        <td></td>
        <td class="batch-cell">↳ Batch <strong>${esc(r.batch_no)}</strong> ${man}${near}<small class="table-subtext">${v.includes ? 'MRP incl. GST' : 'GST extra'} · stock ${fmtQty(r.available)}</small><div class="row-error" data-err="${esc(id)}">${esc(v.errors.join(' '))}</div></td>
        <td>${dateShort(r.expiry)}</td>
        <td class="align-right">${mrpCell}</td>
        <td class="align-right"><strong>${fmtQty(v.qty)}</strong></td>
        <td class="align-right">${discCell}</td>
        <td class="align-right" data-c="disc">${v.calc ? inr(v.calc.discount) : '—'}</td>
        <td class="align-right">${gstCell}</td>
        <td class="align-right" data-c="gst">${v.calc ? inr(v.calc.gst) : '—'}</td>
        <td class="align-right" data-c="net">${v.calc ? inr(v.calc.net) : '—'}</td>
        <td class="align-right" data-c="total"><strong>${v.calc ? inr(v.calc.total) : '—'}</strong></td>
        <td></td>
      </tr>`;
    }).join('');
    return head + body;
  }).join('');
  $('cart').innerHTML = html || '<tr><td colspan="12" class="empty-cart">Your bill is empty. Search and add a medicine above.</td></tr>';
  updateTot();
}

// Repaint only numbers (keeps focus/caret while typing).
function paintNumbers() {
  for (const g of groups) {
    for (const r of g.alloc?.rows || []) {
      const id = `${g.key}|${r.batch_id}`;
      const tr = $('cart').querySelector(`tr[data-rowid="${CSS.escape(id)}"]`);
      if (!tr) continue;
      const v = rowValues(g, r);
      tr.querySelector('[data-c="disc"]').textContent = v.calc ? inr(v.calc.discount) : '—';
      tr.querySelector('[data-c="gst"]').textContent = v.calc ? inr(v.calc.gst) : '—';
      tr.querySelector('[data-c="net"]').textContent = v.calc ? inr(v.calc.net) : '—';
      tr.querySelector('[data-c="total"]').innerHTML = `<strong>${v.calc ? inr(v.calc.total) : '—'}</strong>`;
      tr.querySelector('.row-error').textContent = v.errors.join(' ');
      tr.classList.toggle('has-error', v.errors.length > 0);
    }
    const gt = $('cart').querySelector(`[data-gtotal="${CSS.escape(g.key)}"]`);
    if (gt) { const t = groupTotals(g); gt.textContent = t.errors ? '—' : inr(t.total); }
  }
  updateTot();
}

// ============================================================================
// FEFO allocation (server: billing_allocate → reserves stock for this bill)
// ============================================================================
async function allocate(g) {
  const run = ++g.run;
  g.pending = true;
  g.error = '';
  if ($('cart').querySelector(`tr[data-group="${CSS.escape(g.key)}"]`)) paintGroupStatus(g); else renderCart();
  const { data, error } = await sb.rpc('billing_allocate', {
    p_cart: cartToken,
    p_medicine: g.medicine_id,
    p_qty: g.requestedQty,
    p_manual: g.manual?.length ? g.manual : null,
    p_override_reason: g.manual?.length ? g.overrideReason : null
  });
  if (run !== g.run || !groups.includes(g)) return;
  g.pending = false;
  if (error) {
    g.error = friendly(error);
    if (g.manual) { g.manual = null; g.overrideReason = ''; g.error += ' Manual selection cleared — re-enter the quantity to use FEFO.'; }
    note(`${g.name}: ${g.error}`, true);
  } else {
    g.alloc = data;
    if (Number(data.shortage) > 0) note(`${g.name}: requested ${fmtQty(data.requested)}, only ${fmtQty(data.available_total)} eligible in stock. Short by ${fmtQty(data.shortage)} — reduce the quantity to finalize.`, true);
    else note(explainAllocation(g.name, data));
  }
  renderCart();
}

function scheduleAllocate(g, delay = 350) {
  clearTimeout(qtyTimers.get(g.key));
  qtyTimers.set(g.key, setTimeout(() => allocate(g), delay));
}

async function addMedicine(med, qty = 1, extra = {}) {
  const key = String(med.id);
  let g = findGroup(key);
  if (g) {
    g.requestedQty = extra.setQty ? qty : g.requestedQty + qty;
  } else {
    g = {
      key, medicine_id: med.id, name: med.name, strength: med.strength || '',
      shelf_location: med.shelf_location || '', need_doctor_sheet: med.need_doctor_sheet === true,
      requestedQty: qty, discountPct: extra.discountPct ?? null, edits: new Map(extra.edits || []),
      manual: null, overrideReason: '', alloc: null, pending: false, error: '', run: 0
    };
    groups.push(g);
  }
  if (extra.discountPct != null) g.discountPct = extra.discountPct;
  await allocate(g);
  const input = $('cart').querySelector(`[data-gqty="${CSS.escape(key)}"]`);
  if (input && !extra.silent) { input.focus(); input.select(); }
  return g;
}

async function removeGroup(key, quiet) {
  const g = findGroup(key);
  if (!g) return;
  g.run++;
  groups = groups.filter(x => x !== g);
  renderCart();
  await sb.rpc('billing_release', { p_cart: cartToken, p_medicine: g.medicine_id });
  if (!quiet) note(`${g.name} removed from bill; its reserved stock was released.`);
}

async function medicineById(id) {
  const { data, error } = await sb.from('medicines')
    .select('id,name,strength,shelf_location,need_doctor_sheet,active')
    .eq('branch_id', prof.branch_id).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data || !data.active) throw new Error('Medicine not found or inactive in this branch.');
  return data;
}

// ---- audit of live edits (fire-and-forget; finalize also audits the result)
const AUDIT_ACTION = { discountPct: 'billing_discount_change', gstPct: 'billing_gst_change', mrp: 'billing_mrp_change' };
function auditEdit(field, g, batchNo, before, after) {
  sb.rpc('billing_log_event', {
    p_cart: cartToken, p_action: AUDIT_ACTION[field],
    p_before: { medicine: g.name, batch_no: batchNo, value: before },
    p_after: { medicine: g.name, batch_no: batchNo, value: after }
  }).then(({ error }) => { if (error) console.warn('Audit log failed:', error); });
}

// ---- cart events
$('cart').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.gqty) {
    const g = findGroup(t.dataset.gqty);
    const q = Math.floor(num(t.value));
    if (!g) return;
    if (!(q >= 1)) { t.classList.add('invalid'); note('Quantity must be greater than zero.', true); return; }
    t.classList.remove('invalid');
    if (q === g.requestedQty) return;
    g.requestedQty = q;
    scheduleAllocate(g);
    return;
  }
  if (t.dataset.gdisc) {
    const g = findGroup(t.dataset.gdisc);
    if (!g) return;
    const v = num(t.value);
    g.discountPct = Number.isFinite(v) ? v : NaN;
    // Medicine-level discount overrides per-batch discount edits.
    for (const [, e2] of g.edits) delete e2.discountPct;
    $('cart').querySelectorAll(`[data-row^="${CSS.escape(g.key)}|"][data-field="discountPct"]`).forEach(inp => { inp.value = t.value; });
    paintNumbers();
    return;
  }
  if (t.dataset.row && t.dataset.field) {
    const [key, batchId] = t.dataset.row.split('|');
    const g = findGroup(key);
    if (!g) return;
    const ed = g.edits.get(batchId) || {};
    const v = num(t.value);
    ed[t.dataset.field] = Number.isFinite(v) ? v : NaN;
    g.edits.set(batchId, ed);
    paintNumbers();
  }
});

$('cart').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.gqty) {
    const g = findGroup(e.target.dataset.gqty);
    if (g) { clearTimeout(qtyTimers.get(g.key)); allocate(g); }
  }
});

// Remember values at focus so 'change' can audit before → after.
$('cart').addEventListener('focusin', e => { if (e.target.dataset.field || e.target.dataset.gdisc) e.target.dataset.before = e.target.value; });
$('cart').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.gdisc) {
    const g = findGroup(t.dataset.gdisc);
    if (g && t.dataset.before !== t.value) auditEdit('discountPct', g, '(all batches)', t.dataset.before, t.value);
    return;
  }
  if (t.dataset.row && t.dataset.field) {
    const [key, batchId] = t.dataset.row.split('|');
    const g = findGroup(key);
    const r = g?.alloc?.rows.find(x => x.batch_id === batchId);
    if (g && r && t.dataset.before !== t.value) auditEdit(t.dataset.field, g, r.batch_no, t.dataset.before, t.value);
    t.dataset.before = t.value;
    if (t.tagName === 'SELECT') paintNumbers();
  }
});

$('cart').addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.gremove) return removeGroup(t.dataset.gremove);
  if (t.dataset.explain) {
    const g = findGroup(t.dataset.explain);
    if (g) note(explainAllocation(g.name, g.alloc) || 'No allocation yet.');
    return;
  }
  if (t.dataset.override) openOverride(findGroup(t.dataset.override));
});

// ---- manual batch override (permission + reason; audited by the server)
function openOverride(g) {
  if (!g?.alloc) return;
  const cands = g.alloc.candidates || [];
  const current = new Map((g.alloc.rows || []).map(r => [r.batch_id, Number(r.qty)]));
  $('bl').innerHTML = `<h3>Choose batches — ${esc(g.name)}</h3>
    <p class="muted">Requested ${fmtQty(g.requestedQty)}. Any quantity you leave unassigned is filled automatically by earliest expiry. Expired, recalled and blocked batches are not listed.</p>
    <table class="bill-table override-table"><thead><tr><th>Batch</th><th>Expiry</th><th class="align-right">Available</th><th class="align-right">MRP</th><th class="align-right">Qty</th></tr></thead><tbody>
    ${cands.map(c => `<tr><td>${esc(c.batch_no)} ${c.near_expiry ? '<span class="badge warn">Near expiry</span>' : ''}</td><td>${dateShort(c.expiry)}</td><td class="align-right">${fmtQty(c.available)}</td><td class="align-right">${inr(c.mrp)}</td>
      <td class="align-right"><input type="number" min="0" step="1" max="${Number(c.available)}" value="${current.get(c.batch_id) || 0}" data-ov="${esc(c.batch_id)}" class="qty-input"></td></tr>`).join('')}
    </tbody></table>
    <label class="override-reason">Reason (recorded in audit log)<input id="ovReason" value="${esc(g.overrideReason || '')}" placeholder="e.g. customer requested a longer expiry"></label>
    <div id="ovMsg" class="row-error"></div>
    <div class="action-buttons"><button type="button" id="ovApply" class="button-primary">Apply override</button><button type="button" id="ovReset" class="button-outline">Reset to FEFO</button></div>`;
  $('ovApply').onclick = async () => {
    const manual = [...$('bl').querySelectorAll('[data-ov]')]
      .map(i => ({ batch_id: i.dataset.ov, qty: Math.floor(num(i.value) || 0) }))
      .filter(x => x.qty > 0);
    const sum = manual.reduce((s, x) => s + x.qty, 0);
    const reason = $('ovReason').value.trim();
    if (!manual.length) return ($('ovMsg').textContent = 'Enter a quantity for at least one batch.');
    if (sum > g.requestedQty) return ($('ovMsg').textContent = `Selected ${sum} is more than the requested ${g.requestedQty}.`);
    if (reason.length < 3) return ($('ovMsg').textContent = 'A reason is required.');
    g.manual = manual; g.overrideReason = reason;
    $('bd').close();
    await allocate(g);
  };
  $('ovReset').onclick = async () => { g.manual = null; g.overrideReason = ''; $('bd').close(); await allocate(g); };
  $('bd').showModal();
}

// ---- medicine search
let t;
$('q').oninput = () => {
  clearTimeout(t);
  t = setTimeout(async () => {
    const s = safeQ($('q').value);
    if (s.length < 2) {
      $('res').innerHTML = '';
      return;
    }

    const { data, error } = await sb.from('medicines')
      .select('id,name,strength,barcode,mrp,selling_price,shelf_location,tax_rate,need_doctor_sheet')
      .eq('branch_id', prof.branch_id)
      .eq('active', true)
      .or(`name.ilike.%${s}%,barcode.eq.${s}`)
      .limit(8);

    if (error) {
      $('res').textContent = friendly(error);
      return;
    }

    const medicines = data || [];
    // Live eligible branch stock (same eligibility rules as the FEFO allocator).
    const medicineIds = medicines.map(m => m.id);
    const stockByMedicine = new Map();
    if (medicineIds.length) {
      const { data: batches, error: stockError } = await sb.from('medicine_batches')
        .select('medicine_id,qty')
        .eq('branch_id', prof.branch_id)
        .in('medicine_id', medicineIds)
        .eq('quarantined', false)
        .eq('stock_status', 'active')
        .gt('qty', 0)
        .gt('expiry', cfg.today);
      if (stockError) {
        console.warn('Could not load medicine search stock:', stockError);
      } else {
        (batches || []).forEach(batch => {
          stockByMedicine.set(batch.medicine_id, (stockByMedicine.get(batch.medicine_id) || 0) + Number(batch.qty || 0));
        });
      }
    }

    medicines.forEach(m => { m.available_stock = stockByMedicine.get(m.id) || 0; });

    if (medicines.length === 1 && medicines[0].barcode === s) {
      addMedicine(medicines[0]);
      $('q').value = '';
      $('res').innerHTML = '';
      return;
    }

    $('res').innerHTML = medicines.map(m => {
      const prescription = m.need_doctor_sheet === true;
      const warning = prescription ? '<span class="medicine-result-warning">Prescription required</span>' : '';
      const out = m.available_stock <= 0;
      const stock = `<span class="medicine-result-stock${out ? ' out' : ''}">${out ? 'No eligible stock' : `Stock: ${Number(m.available_stock).toLocaleString('en-IN')}`}</span>`;
      return `<button class="sec medicine-result${prescription ? ' requires-prescription' : ''}" type="button" data-m='${esc(JSON.stringify(m))}'>
        <span class="medicine-result-main"><strong>${esc(m.name)} ${esc(m.strength || '')}</strong>
        <span class="medicine-result-meta">MRP ${inr(m.mrp)} · GST ${Number(m.tax_rate)}% · Shelf ${esc(m.shelf_location || '—')}</span></span>
        <span class="medicine-result-side">${warning}${stock}</span>
      </button>`;
    }).join('') || '<div class="muted">No matching medicine.</div>';
  }, 250);
};

$('res').onclick = e => {
  const b = e.target.closest('button');
  if (b) {
    addMedicine(JSON.parse(b.dataset.m));
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
  const b = computeBill();
  $('totalItems').textContent = `${groups.length} / ${b.batchLines}`;
  $('totalQty').textContent = fmtQty(b.qty);
  $('sumBase').textContent = inr(b.base);
  $('sumDisc').textContent = `−${inr(b.lineDiscount)}`;
  $('sumTaxable').textContent = inr(b.taxable);
  $('sumGst').textContent = inr(b.gst);
  $('sumSub').textContent = inr(b.subtotal);
  $('disc').classList.toggle('invalid', b.billDiscountExceeds);
  $('tot').textContent = b.invalid ? 'Fix errors' : inr(b.grandTotal);
  const r = Math.round((b.grandTotal - paidSum()) * 100) / 100;
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

// ---- reservations lifecycle
async function releaseAll() {
  const token = cartToken;
  cartToken = crypto.randomUUID();
  await sb.rpc('billing_release', { p_cart: token, p_medicine: null });
}

setInterval(() => {
  if (groups.length) sb.rpc('billing_touch', { p_cart: cartToken }).then(({ error }) => { if (error) console.warn('Reservation refresh failed:', error); });
}, Math.max(60, (cfg.reservation_minutes || 15) * 60 / 3) * 1000);

let accessToken = (await sb.auth.getSession()).data.session?.access_token || '';
sb.auth.onAuthStateChange((_e, session) => { accessToken = session?.access_token || ''; });
window.addEventListener('pagehide', () => {
  if (!groups.length || !accessToken) return;
  // keepalive lets the request finish while the tab closes; reservations also expire on their own.
  fetch(`${SUPABASE_URL}/rest/v1/rpc/billing_release`, {
    method: 'POST', keepalive: true,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_cart: cartToken, p_medicine: null })
  }).catch(() => {});
});

async function reset({ keepToken = false } = {}) {
  groups.forEach(g => g.run++);
  groups = [];
  if (!keepToken) await releaseAll();
  pays = [{ method: 'cash', amount: '' }];
  $('disc').value = 0;
  ['doctorName','patientName','patientPhone','patientAddress','diagnosis'].forEach(id => { if ($(id)) $(id).value = ''; });
  setCust(null);
  renderCart();
}

$('clear').onclick = async () => {
  if (groups.length) sb.rpc('billing_log_event', { p_cart: cartToken, p_action: 'billing_bill_cleared', p_before: { medicines: groups.map(g => ({ name: g.name, qty: g.requestedQty })) }, p_after: null }).then(() => {});
  await reset();
  note('Bill cleared. Reserved stock released.');
};

// ---- patient / prescription details (optional; saved on the invoice)
const PATIENT_FIELDS = { doctorName: 'doctor_name', patientName: 'patient_name', patientPhone: 'patient_phone', patientAddress: 'patient_address', diagnosis: 'diagnosis' };
function patientDetails() {
  const out = {};
  for (const [id, key] of Object.entries(PATIENT_FIELDS)) { const v = $(id)?.value.trim(); if (v) out[key] = v; }
  return Object.keys(out).length ? out : null;
}
function setPatientDetails(p) {
  for (const [id, key] of Object.entries(PATIENT_FIELDS)) if ($(id)) $(id).value = p?.[key] || '';
}

// ---- finalize
function blockingProblems() {
  const problems = [];
  for (const g of groups) {
    if (g.pending) problems.push(`${g.name}: allocation in progress`);
    else if (g.error) problems.push(`${g.name}: ${g.error}`);
    else if (!g.alloc || !g.alloc.rows.length) problems.push(`${g.name}: no eligible stock`);
    else if (Number(g.alloc.shortage) > 0) problems.push(`${g.name}: short by ${fmtQty(g.alloc.shortage)}`);
    else if (groupTotals(g).errors) problems.push(`${g.name}: fix the highlighted values`);
  }
  if (computeBill().billDiscountExceeds) problems.push('Overall discount exceeds the bill amount');
  return problems;
}

$('pay').onclick = async () => {
  if (!groups.length) return note('Cart is empty.', true);
  const problems = blockingProblems();
  if (problems.length) return note(`Cannot finalize — ${problems.join('; ')}.`, true);

  const bill = computeBill();
  const grand = bill.grandTotal;
  const rows = pays.map(p => ({
    method: p.method,
    amount: pays.length === 1 && p.amount === '' ? grand : +p.amount
  })).filter(p => p.amount > 0);

  const cashPaid = paidSum();
  const due = Math.round((grand - cashPaid) * 100) / 100;
  if (due < 0) return note('Payments cannot exceed the bill total.', true);
  if (due > 0 && !cust) return note('Select a customer before leaving an unpaid balance.', true);
  if (due > avail) return note(`Customer credit limit exceeded. Available: ${inr(avail)}.`, true);

  const items = groups.flatMap(g => g.alloc.rows.map(r => {
    const v = rowValues(g, r);
    return {
      batch_id: r.batch_id, qty: v.qty, mrp: v.mrp, discount_pct: v.discountPct, gst_pct: v.gstPct,
      manual: !!g.alloc.manual, override_reason: g.alloc.manual ? g.overrideReason : null
    };
  }));

  $('pay').disabled = true;
  note(due > 0 ? `Saving bill with ${inr(due)} customer balance…` : 'Saving…');

  const { data, error } = await sb.rpc('finalize_sale_v3', {
    p_customer: cust?.id ?? null,
    p_discount: +$('disc').value || 0,
    p_items: items,
    p_payments: rows,
    p_cart: cartToken,
    p_expected_total: grand,
    p_patient: patientDetails()
  });

  $('pay').disabled = false;
  if (error) {
    if (/Stock changed|Insufficient stock|reserved/i.test(error.message || '')) {
      note(`${friendly(error)} Re-allocating from current stock — please review before finalizing again.`, true);
      for (const g of groups) await allocate(g);
      return;
    }
    return note(friendly(error), true);
  }

  // Stock was deducted and reservations released inside the same transaction.
  cartToken = crypto.randomUUID();
  const det = await sb.rpc('invoice_detail', { p_invoice: data });
  await reset({ keepToken: true });
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

// ---- hold / resume (held bills do not reserve stock; they re-allocate FEFO on resume)
$('hold').onclick = async () => {
  if (!groups.length) return note('Nothing to hold.', true);

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
    cart: groups.map(g => ({
      medicine_id: g.medicine_id,
      qty: g.requestedQty,
      discount_pct: Number.isFinite(g.discountPct) ? g.discountPct : null,
      edits: [...g.edits.entries()],
      // first batch kept for compatibility with older held-bill readers
      batch_id: g.alloc?.rows?.[0]?.batch_id ?? null
    })).concat(patientDetails() ? [{ type: 'patient', ...patientDetails() }] : []),
    payments: heldPayments
  });

  if (error) return note(friendly(error), true);
  await reset();
  note('Bill held. Reserved stock was released; batches are re-allocated by FEFO on resume.');
};

$('held').onclick = async () => {
  const { data } = await sb.from('held_bills')
    .select('id,label,cart,created_at,customer_id,payments,discount')
    .eq('branch_id', prof.branch_id)
    .order('created_at', { ascending: false });

  $('hl').innerHTML = `<h3>Held bills</h3>` + ((data || []).map(h => `<div style="display:flex;gap:.5rem;align-items:center;margin:.3rem 0"><span style="flex:1">${esc(h.label || 'Unnamed')} · ${h.cart.filter(l => l?.type !== 'patient').length} item(s) · ${new Date(h.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span><button data-res="${h.id}">Resume</button><button class="sec" data-del="${h.id}">Delete</button></div>`).join('') || 'None.');

  $('hl').onclick = async e => {
    const { res, del } = e.target.dataset;

    if (del) {
      await sb.from('held_bills').delete().eq('id', del).eq('branch_id', prof.branch_id);
      return $('held').click();
    }

    if (!res) return;
    const h = data.find(x => x.id === res);

    if (groups.length && !confirm('Replace the current cart?')) return;
    await reset();

    // Support both the new (medicine_id) and legacy (batch_id only) formats.
    const legacyBatchIds = h.cart.filter(l => !l.medicine_id && l.batch_id).map(l => l.batch_id);
    const batchToMed = new Map();
    if (legacyBatchIds.length) {
      const { data: bs } = await sb.from('medicine_batches').select('id,medicine_id').eq('branch_id', prof.branch_id).in('id', legacyBatchIds);
      (bs || []).forEach(b => batchToMed.set(b.id, b.medicine_id));
    }
    const wanted = new Map();
    for (const l of h.cart) {
      if (l?.type === 'patient') continue;
      const medId = l.medicine_id || batchToMed.get(l.batch_id);
      if (!medId) continue;
      const w = wanted.get(medId) || { qty: 0, discount_pct: l.discount_pct ?? null, edits: l.edits || [] };
      w.qty += Number(l.qty || 0);
      wanted.set(medId, w);
    }

    const dropped = [];
    for (const [medId, w] of wanted) {
      try {
        const med = await medicineById(medId);
        const g = await addMedicine(med, w.qty, { discountPct: w.discount_pct, edits: w.edits, silent: true });
        if (g.error || Number(g.alloc?.shortage) > 0) dropped.push(`${med.name} (check stock)`);
      } catch {
        dropped.push('an unavailable medicine');
      }
    }

    $('disc').value = h.discount ?? 0;
    setPatientDetails(h.cart.find(l => l && l.type === 'patient'));

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
      ? `Resumed with current FEFO stock. Needs attention: ${dropped.join(', ')}`
      : 'Bill resumed. Batches re-allocated from current stock (FEFO).', dropped.length > 0);
  };

  $('hd').showModal();
};

// ============================================================================
// AI assistant — suggestions only. It reads deterministic results and calls
// validated server functions; every change it proposes is applied through the
// same code paths (and server checks) as a manual edit, after the user clicks.
// ============================================================================
function assistantContext() {
  const bill = computeBill();
  const snapshot = groups.map(g => {
    const rows = (g.alloc?.rows || []).map(r => {
      const v = rowValues(g, r);
      return {
        batch_no: r.batch_no, expiry: r.expiry, qty: v.qty, mrp: v.mrp, discountPct: v.discountPct, gstPct: v.gstPct,
        defaultMrp: v.defaultMrp, defaultGstPct: v.defaultGstPct, priceIncludesTax: v.includes,
        daysToExpiry: r.days_to_expiry, total: v.calc?.total ?? null, gst: v.calc?.gst ?? null, discount: v.calc?.discount ?? null
      };
    });
    return {
      medicine_id: g.medicine_id, name: g.name, requestedQty: g.requestedQty,
      shortage: Number(g.alloc?.shortage || 0), available: Number(g.alloc?.available_total || 0),
      manual: !!g.alloc?.manual, rows, excluded: g.alloc?.excluded || null
    };
  });
  return {
    cart_token: cartToken,
    permissions: perm,
    limits: { max_discount_pct: cfg.max_discount_pct, gst_rates: cfg.gst_rates, near_expiry_days: cfg.near_expiry_days },
    groups: snapshot,
    summary: bill,
    anomalies: detectAnomalies(snapshot, { maxDiscountPct: cfg.max_discount_pct, nearExpiryDays: cfg.near_expiry_days })
  };
}

async function applyAssistantAction(a) {
  const qty = Math.floor(Number(a.quantity));
  switch (a.type) {
    case 'add_medicine': {
      if (!(qty >= 1)) throw new Error('Quantity must be greater than zero.');
      const med = await medicineById(a.medicine_id);
      await addMedicine(med, qty, { silent: true });
      break;
    }
    case 'set_quantity': {
      const g = findGroup(String(a.medicine_id));
      if (!g) throw new Error('That medicine is not on the bill.');
      if (!(qty >= 1)) throw new Error('Quantity must be greater than zero.');
      g.requestedQty = qty;
      await allocate(g);
      break;
    }
    case 'set_discount': {
      if (!perm.discount) throw new Error('You do not have permission to change discounts.');
      const g = findGroup(String(a.medicine_id));
      if (!g) throw new Error('That medicine is not on the bill.');
      const d = Number(a.discount_pct);
      if (!(d >= 0 && d <= cfg.max_discount_pct)) throw new Error(`Discount must be between 0% and ${cfg.max_discount_pct}%.`);
      const before = g.discountPct;
      g.discountPct = d;
      for (const [, e] of g.edits) delete e.discountPct;
      renderCart();
      auditEdit('discountPct', g, '(all batches)', before, d);
      break;
    }
    case 'remove_medicine':
      await removeGroup(String(a.medicine_id));
      break;
    default:
      throw new Error('Unsupported suggestion.');
  }
  sb.rpc('billing_log_event', { p_cart: cartToken, p_action: 'billing_ai_suggestion_applied', p_before: null, p_after: a }).then(() => {});
}

mountAssistant({
  container: $('assistant'),
  getContext: assistantContext,
  applyAction: applyAssistantAction,
  onApplied: msg => note(msg)
});

renderCust();
renderPays();
renderCart();
