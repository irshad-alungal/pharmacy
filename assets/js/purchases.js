// Purchases: supplier bills, drafts, stock-in with pack factor and free quantity,
// optional supplier payment (admins), bill attachments and purchase detail view.
// Server functions (migration 0021): confirm_purchase_v2, purchase_draft_save/list/delete,
// purchase_detail, purchase_invoice_exists; existing: purchase_list, register_purchase_document.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly, safeQ } from './ui.js';

const prof = await mountShell('purchases', 'Purchases');
const $ = id => document.getElementById(id);
const WRITER_ROLES = ['super_admin', 'admin', 'pharmacist', 'inventory_staff', 'inventory'];
const canWrite = WRITER_ROLES.includes(prof.role);
const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = v => inr(num(v));
const r2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;

const [distRes] = await Promise.all([
  sb.from('distributors').select('id,name,phone,gstin').eq('branch_id', prof.branch_id).eq('active', true).order('name')
]);
const dists = distRes.data || [];
const medicineMap = new Map();
let purchaseRows = [];
let draftRows = [];
let attachments = [];
let currentDraftId = null;
let tab = 'posted';

$('view').innerHTML = `
<div class="purchase-page">
  <div class="purchase-toolbar"><div><h3 style="margin:.1rem 0">Purchase management</h3><div class="purchase-muted">Supplier invoices, stock-in, bill documents and payment tracking</div></div>
    <div class="purchase-actions"><button class="purchase-btn primary" id="newPurchase" type="button">+ New purchase</button></div>
  </div>
  <div class="purchase-stats">
    <div class="purchase-stat"><small>Posted invoices</small><strong id="statCount">—</strong></div>
    <div class="purchase-stat"><small>Posted value</small><strong id="statValue">—</strong></div>
    <div class="purchase-stat"><small>Draft bills</small><strong id="statDraft">—</strong></div>
    <div class="purchase-stat"><small>This month</small><strong id="statMonth">—</strong></div>
  </div>
  <section class="purchase-card">
    <div class="purchase-section-head">
      <div class="purchase-tabs" role="tablist">
        <button type="button" class="purchase-tab active" data-tab="posted" role="tab">Posted invoices</button>
        <button type="button" class="purchase-tab" data-tab="drafts" role="tab">Drafts <span id="draftBadge" class="purchase-badge">0</span></button>
      </div>
      <span class="purchase-muted" id="listCount"></span>
    </div>
    <div class="purchase-filters" style="margin:.7rem 0"><input id="searchPurchase" placeholder="Search invoice number or supplier"><input id="fromDate" type="date" aria-label="From date"><input id="toDate" type="date" aria-label="To date"><button class="purchase-btn" id="clearFilters" type="button">Clear</button></div>
    <div class="purchase-table-wrap"><table class="purchase-table"><thead id="listHead"></thead><tbody id="purchaseRows"><tr><td colspan="7" class="purchase-empty">Loading purchases…</td></tr></tbody></table></div>
  </section>
</div>

<dialog class="purchase-dialog" id="purchaseDialog"><div class="purchase-dialog-head"><div><h3 id="formTitle">New purchase</h3><div class="purchase-muted">Enter the supplier invoice and verify every batch before posting stock.</div></div><button class="purchase-btn" id="closePurchase" type="button">Close</button></div>
<form id="purchaseForm" class="purchase-form" novalidate>
  <section class="purchase-card"><h3>1. Supplier and invoice</h3><div class="purchase-grid">
    <div class="purchase-field span2"><label for="supplier">Supplier / Distributor *</label><select id="supplier" required><option value="">Select supplier</option>${dists.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></div>
    <div class="purchase-field"><label for="invoiceNo">Supplier invoice number *</label><input id="invoiceNo" required maxlength="100"></div>
    <div class="purchase-field"><label for="invoiceDate">Invoice date *</label><input id="invoiceDate" type="date" required></div>
    <div class="purchase-field"><label for="dueDate">Due date</label><input id="dueDate" type="date"></div>
    <div class="purchase-field"><label for="orderNo">Order number</label><input id="orderNo" maxlength="60"></div>
    <div class="purchase-field"><label for="orderDate">Order date</label><input id="orderDate" type="date"></div>
    <div class="purchase-field"><label for="paymentTerms">Payment terms</label><select id="paymentTerms"><option value="credit">Credit</option><option value="cash">Cash</option><option value="other">Other</option></select></div>
    <div class="purchase-field"><label for="invoiceTaxMode">Default purchase rate mode</label><select id="invoiceTaxMode"><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option><option value="mixed">Set per item</option></select></div>
    <div class="purchase-field span2"><label for="notes">Notes / reference</label><input id="notes" maxlength="300" placeholder="Optional note"></div>
  </div><div id="dupWarning" class="purchase-warning" hidden></div></section>
  <section class="purchase-card"><div class="purchase-section-head"><div><h3>2. Medicine items</h3><div class="purchase-muted">Pick a medicine from the master, or create a new one from the row.</div></div><div class="purchase-actions"><button class="purchase-btn" type="button" id="excelTemplate">↓ Medicine template</button><button class="purchase-btn" type="button" id="excelUploadBtn">↑ Bulk upload medicines</button><input id="excelFile" type="file" accept=".xlsx,.xls,.csv" hidden><button class="purchase-btn primary" type="button" id="addItem">+ Add medicine</button></div></div>
    <div class="purchase-pack-help">Pack factor = units in one strip/pack. Qty and Free are in packs. Stock added = pack factor × (Qty + Free). Billing MRP per unit = MRP per pack ÷ pack factor. Free goods carry zero cost.</div>
    <datalist id="medicineSuggestions"></datalist>
    <div class="purchase-table-wrap purchase-item-wrap"><table class="purchase-table purchase-item-table"><thead><tr><th>Medicine *</th><th>HSN</th><th>Pack factor</th><th>Batch *</th><th>Expiry *</th><th>Qty (packs) *</th><th>Free (packs)</th><th>Stock units</th><th>MRP / pack</th><th>MRP / unit</th><th>Rate / pack *</th><th>Rate mode</th><th>Discount ₹</th><th>GST %</th><th>Line total</th><th></th></tr></thead><tbody id="itemRows"></tbody></table></div>
  </section>
  <section class="purchase-card"><h3>3. Invoice totals</h3><div class="purchase-grid">
    <div class="purchase-field"><label for="invoiceDiscount">Invoice discount ₹</label><input id="invoiceDiscount" type="number" min="0" step=".01" value="0"></div>
    <div class="purchase-field"><label for="freight">Freight / other charges ₹</label><input id="freight" type="number" min="0" step=".01" value="0"></div>
    <div class="purchase-field"><label for="printedTotal">Supplier printed total ₹</label><input id="printedTotal" type="number" min="0" step=".01" placeholder="Optional"></div>
    <div class="purchase-field"><label for="roundOff">Round off ₹</label><input id="roundOff" type="number" step=".01" min="-100" max="100" value="0"></div>
  </div><div class="purchase-summary"><div class="purchase-summary-box"><div class="purchase-summary-line"><span>Taxable subtotal</span><strong id="sumSubtotal">₹0.00</strong></div><div class="purchase-summary-line"><span>GST</span><strong id="sumTax">₹0.00</strong></div><div class="purchase-summary-line"><span>Invoice discount</span><strong id="sumDiscount">₹0.00</strong></div><div class="purchase-summary-line"><span>Freight / charges</span><strong id="sumFreight">₹0.00</strong></div><div class="purchase-summary-line"><span>Round off</span><strong id="sumRound">₹0.00</strong></div><div class="purchase-summary-line total"><span>Calculated total</span><strong id="sumTotal">₹0.00</strong></div><div id="totalCompare" class="purchase-muted" style="font-size:.82rem"></div></div></div>
  </section>
  <section class="purchase-card"><h3>4. Payment</h3>
    ${isAdmin ? `<div class="purchase-grid"><div class="purchase-field"><label for="amountPaid">Amount paid now ₹</label><input id="amountPaid" type="number" min="0" step=".01" value="0"></div><div class="purchase-field"><label for="paymentMode">Payment mode</label><select id="paymentMode"><option value="cash">Cash</option><option value="upi">UPI</option></select></div><div class="purchase-field span2"><label for="paymentRef">Payment reference</label><input id="paymentRef" maxlength="100"></div></div><div class="purchase-muted" style="margin-top:.5rem">Leave 0 for a credit purchase. The balance stays payable to the supplier (Finance → Payables).</div>`
      : `<div class="purchase-muted">The invoice is posted as payable to the supplier. An admin records payments in Finance → Payables.</div>`}
  </section>
  <section class="purchase-card"><h3>5. Bill attachments</h3><div class="purchase-actions"><label class="purchase-btn" for="billFiles">↑ Upload PDF / images</label><input id="billFiles" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden><label class="purchase-btn" for="cameraFiles">▣ Capture with camera</label><input id="cameraFiles" type="file" accept="image/*" capture="environment" multiple hidden></div><div id="attachmentList" class="purchase-file-list"><span class="purchase-muted">No bill files selected.</span></div><div class="purchase-muted" style="margin-top:.6rem">Files are uploaded securely and linked to the invoice when it is posted (PDF, JPG, PNG or WEBP, up to 15 MB each). Drafts keep the bill details, not the files.</div></section>
  <div id="formError" class="purchase-error" role="alert"></div>
  <div class="purchase-actions"><button type="button" class="purchase-btn" id="saveDraft">Save draft</button><button type="button" class="purchase-btn danger" id="deleteDraft" hidden>Delete draft</button><button type="button" class="purchase-btn dark" id="confirmPurchase">Review & confirm stock-in</button></div>
</form></dialog>

<dialog class="purchase-dialog" id="viewDialog"><div class="purchase-dialog-head"><h3 id="viewTitle">Purchase invoice</h3><button class="purchase-btn" id="closeView" type="button">Close</button></div><div id="viewContent"></div></dialog>
<dialog class="purchase-dialog" id="fileDialog"><div class="purchase-dialog-head"><h3>Bill preview</h3><button class="purchase-btn" id="closeFile" type="button">Close</button></div><div id="filePreview"></div></dialog>
<dialog class="purchase-dialog purchase-confirm" id="confirmDialog"><h3>Confirm purchase and update stock?</h3><div id="confirmSummary"></div><p>This posts the purchase, adds the stock below and records the supplier payable. Please verify invoice, batch, expiry, quantity, rates and tax before continuing.</p><div class="purchase-actions"><button class="purchase-btn" id="backToEdit" type="button">Go back</button><button class="purchase-btn dark" id="postNow" type="button">Confirm and post stock</button></div></dialog>
<dialog class="purchase-dialog purchase-confirm" id="newMedDialog"><h3>Create medicine</h3><div class="purchase-grid">
  <div class="purchase-field span2"><label for="nmName">Medicine name *</label><input id="nmName" maxlength="120"></div>
  <div class="purchase-field"><label for="nmStrength">Strength</label><input id="nmStrength" maxlength="40" placeholder="e.g. 650 mg"></div>
  <div class="purchase-field"><label for="nmGst">GST %</label><input id="nmGst" type="number" min="0" max="40" step=".01" value="5"></div>
  <div class="purchase-field span2"><label for="nmBarcode">Barcode (optional)</label><input id="nmBarcode" maxlength="40"></div>
</div><p class="purchase-muted">MRP and selling price are taken from this bill when it is posted. Complete other details later in Medicines.</p><div id="nmError" class="purchase-error"></div><div class="purchase-actions"><button class="purchase-btn" id="nmCancel" type="button">Cancel</button><button class="purchase-btn dark" id="nmSave" type="button">Create medicine</button></div></dialog>
`;

// ---------------------------------------------------------------------------
// Item rows
// ---------------------------------------------------------------------------
const medLabel = m => `${m.name}${m.strength ? ' ' + m.strength : ''}`;

function makeItemRow(seed = {}) {
  const tr = document.createElement('tr');
  tr.className = 'purchase-item-row';
  const mode = seed.rate_mode || ($('invoiceTaxMode').value === 'inclusive' ? 'inclusive' : 'exclusive');
  const cells = [
    ['Medicine *', `<input class="med-name" list="medicineSuggestions" placeholder="Search medicine" autocomplete="off" value="${esc(seed.medicine_label || '')}"><button type="button" class="purchase-link create-med" hidden>+ Create “<span></span>”</button>`],
    ['HSN', `<input class="hsn small-num" placeholder="HSN" maxlength="12" value="${esc(seed.hsn || '')}">`],
    ['Pack factor', `<input class="pack small-num" type="number" min="1" step="1" value="${seed.pack ?? 1}">`],
    ['Batch *', `<input class="batch" placeholder="Batch no." maxlength="40" value="${esc(seed.batch_no || '')}">`],
    ['Expiry *', `<input class="expiry" type="date" value="${esc(seed.expiry || '')}">`],
    ['Qty (packs) *', `<input class="qty small-num" type="number" min="1" step="1" value="${seed.qty ?? 1}">`],
    ['Free (packs)', `<input class="free small-num" type="number" min="0" step="1" value="${seed.free_qty ?? 0}">`],
    ['Stock units', `<output class="stock-units">0</output>`],
    ['MRP / pack', `<input class="mrp small-num" type="number" min="0" step=".01" value="${seed.mrp ?? 0}">`],
    ['MRP / unit', `<output class="billing-rate">₹0.00</output>`],
    ['Rate / pack *', `<input class="rate small-num" type="number" min="0" step=".01" value="${seed.rate ?? 0}">`],
    ['Rate mode', `<select class="rate-mode"><option value="exclusive">Exclusive</option><option value="inclusive">Inclusive</option></select>`],
    ['Discount ₹', `<input class="line-discount small-num" type="number" min="0" step=".01" value="${seed.discount ?? 0}">`],
    ['GST %', `<input class="gst small-num" type="number" min="0" max="40" step=".01" value="${seed.tax_rate ?? 5}">`],
    ['Line total', `<output class="line-total">₹0.00</output>`],
    ['Action', `<button class="purchase-btn danger remove-line" type="button" title="Remove row" aria-label="Remove medicine row">×</button>`]
  ];
  tr.innerHTML = cells.map(([label, html]) => `<td data-label="${label}">${html}</td>`).join('');
  tr.querySelector('.rate-mode').value = mode;
  if (seed.medicine_id) tr.dataset.medicineId = seed.medicine_id;
  $('itemRows').appendChild(tr);
  if (seed.medicine_label && !seed.medicine_id) resolveMedicine(tr);
  calcTotals();
  return tr;
}

// Per line: amounts excluding GST (what confirm_purchase_v2 expects).
function calcLine(tr) {
  const v = c => tr.querySelector(c).value;
  const qty = num(v('.qty')), free = num(v('.free')), pack = Math.max(1, Math.floor(num(v('.pack')) || 1));
  const rate = num(v('.rate')), disc = num(v('.line-discount')), gst = num(v('.gst')), mrp = num(v('.mrp'));
  const mode = v('.rate-mode');
  const gross = qty * rate;
  const discount = Math.min(disc, gross);
  const entered = Math.max(0, gross - discount);
  const factor = mode === 'inclusive' ? 1 + gst / 100 : 1;
  const priceEx = rate / factor;
  const discEx = discount / factor;
  const taxable = r2(qty * priceEx - discEx);
  const tax = r2(taxable * gst / 100);
  const total = mode === 'inclusive' ? r2(entered) : r2(taxable + tax);
  const stockUnits = pack * (qty + free);
  tr.querySelector('.stock-units').textContent = String(stockUnits);
  tr.querySelector('.billing-rate').textContent = fmt(mrp / pack);
  tr.querySelector('.line-total').textContent = fmt(total);
  return { qty, free, pack, rate, discount, gst, mode, mrp, priceEx, discEx, taxable, tax, total, stockUnits };
}

function calcTotals() {
  let sub = 0, tax = 0;
  for (const tr of $('itemRows').children) { const c = calcLine(tr); sub += c.taxable; tax += c.tax; }
  const disc = num($('invoiceDiscount').value), freight = num($('freight').value), round = num($('roundOff').value);
  const total = r2(sub + tax - disc + freight + round);
  $('sumSubtotal').textContent = fmt(sub);
  $('sumTax').textContent = fmt(tax);
  $('sumDiscount').textContent = fmt(disc);
  $('sumFreight').textContent = fmt(freight);
  $('sumRound').textContent = fmt(round);
  $('sumTotal').textContent = fmt(total);
  const printed = $('printedTotal').value === '' ? null : num($('printedTotal').value);
  $('totalCompare').textContent = printed === null ? '' : Math.abs(printed - total) > 0.02
    ? `Warning: printed total ${fmt(printed)} differs by ${fmt(Math.abs(printed - total))}. Check rates, tax mode and round off.`
    : 'Printed invoice total matches.';
  return { sub: r2(sub), tax: r2(tax), total };
}

async function searchMedicines(text) {
  const q = safeQ(text);
  if (q.length < 2) return [];
  const run = term => sb.from('medicines')
    .select('id,name,strength,tax_rate,mrp')
    .eq('branch_id', prof.branch_id).eq('active', true)
    .or(`name.ilike.%${term}%,barcode.eq.${term}`).limit(15);
  let { data, error } = await run(q);
  // "Cetirizine 10 mg" (name + strength, e.g. typed or from Excel): retry with the first word.
  if (!error && !(data || []).length && q.includes(' ')) ({ data, error } = await run(q.split(' ')[0]));
  if (error) throw error;
  const dl = $('medicineSuggestions');
  dl.innerHTML = '';
  for (const m of data || []) {
    medicineMap.set(medLabel(m).toLowerCase(), m);
    const op = document.createElement('option');
    op.value = medLabel(m);
    dl.appendChild(op);
  }
  return data || [];
}

async function resolveMedicine(tr) {
  const input = tr.querySelector('.med-name');
  const label = input.value.trim();
  const createBtn = tr.querySelector('.create-med');
  if (!label) { delete tr.dataset.medicineId; createBtn.hidden = true; return; }
  let m = medicineMap.get(label.toLowerCase());
  if (!m) {
    try {
      const found = await searchMedicines(label);
      m = medicineMap.get(label.toLowerCase()) || (found.length === 1 && found[0].name.toLowerCase() === label.toLowerCase() ? found[0] : null);
    } catch (err) { setMsg(friendly(err), 'error'); }
  }
  if (m) {
    tr.dataset.medicineId = m.id;
    tr.classList.remove('unknown');
    createBtn.hidden = true;
    if (!tr.dataset.gstTouched && m.tax_rate != null) tr.querySelector('.gst').value = m.tax_rate;
  } else {
    delete tr.dataset.medicineId;
    tr.classList.add('unknown');
    createBtn.hidden = !canWrite;
    createBtn.querySelector('span').textContent = label;
  }
  calcTotals();
}

let medTimer;
$('itemRows').addEventListener('input', e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  if (e.target.classList.contains('med-name')) {
    clearTimeout(medTimer);
    medTimer = setTimeout(() => searchMedicines(e.target.value).catch(() => {}), 250);
  }
  if (e.target.classList.contains('gst')) tr.dataset.gstTouched = '1';
  calcTotals();
});
$('itemRows').addEventListener('change', e => {
  const tr = e.target.closest('tr');
  if (tr && e.target.classList.contains('med-name')) resolveMedicine(tr);
  calcTotals();
});
$('itemRows').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (e.target.classList.contains('remove-line')) { tr.remove(); calcTotals(); }
  const create = e.target.closest('.create-med');
  if (create) openNewMedicine(tr);
});

// Create a missing medicine directly from a bill row.
let newMedRow = null;
function openNewMedicine(tr) {
  newMedRow = tr;
  $('nmName').value = tr.querySelector('.med-name').value.trim();
  $('nmStrength').value = '';
  $('nmBarcode').value = '';
  $('nmGst').value = tr.querySelector('.gst').value || 5;
  $('nmError').textContent = '';
  $('newMedDialog').showModal();
}
$('nmCancel').onclick = () => $('newMedDialog').close();
$('nmSave').onclick = async () => {
  const name = $('nmName').value.trim();
  const gst = num($('nmGst').value);
  if (name.length < 2) return ($('nmError').textContent = 'Enter the medicine name.');
  if (gst < 0 || gst > 40) return ($('nmError').textContent = 'GST must be between 0 and 40.');
  $('nmSave').disabled = true;
  const row = { branch_id: prof.branch_id, name, strength: $('nmStrength').value.trim() || null, tax_rate: gst, mrp: 0, selling_price: 0, active: true };
  if ($('nmBarcode').value.trim()) row.barcode = $('nmBarcode').value.trim();
  const { data, error } = await sb.from('medicines').insert(row).select('id,name,strength,tax_rate,mrp').single();
  $('nmSave').disabled = false;
  if (error) return ($('nmError').textContent = friendly(error));
  medicineMap.set(medLabel(data).toLowerCase(), data);
  if (newMedRow) {
    newMedRow.querySelector('.med-name').value = medLabel(data);
    newMedRow.querySelector('.gst').value = gst;
    await resolveMedicine(newMedRow);
  }
  $('newMedDialog').close();
  setMsg(`Medicine “${medLabel(data)}” created. Its MRP will be set from this bill when posted.`);
};

$('addItem').onclick = () => { const tr = makeItemRow(); tr.querySelector('.med-name').focus(); };
['invoiceDiscount', 'freight', 'roundOff', 'printedTotal'].forEach(id => $(id).addEventListener('input', calcTotals));
$('invoiceTaxMode').onchange = () => {
  if ($('invoiceTaxMode').value !== 'mixed') for (const tr of $('itemRows').children) tr.querySelector('.rate-mode').value = $('invoiceTaxMode').value;
  calcTotals();
};

function setMsg(message, type = 'info') {
  const el = $('formError');
  el.className = type === 'error' ? 'purchase-error' : type === 'warning' ? 'purchase-warning' : 'purchase-muted';
  el.textContent = message;
}

// Duplicate invoice warning as soon as supplier + number are known.
async function checkDuplicate() {
  const dist = $('supplier').value, no = $('invoiceNo').value.trim();
  $('dupWarning').hidden = true;
  if (!dist || !no) return false;
  const { data } = await sb.rpc('purchase_invoice_exists', { p_distributor: dist, p_invoice_no: no });
  if (data) {
    $('dupWarning').textContent = `Invoice ${no} from this supplier is already posted. Check the existing purchase before entering it again.`;
    $('dupWarning').hidden = false;
    return true;
  }
  return false;
}
$('supplier').addEventListener('change', checkDuplicate);
$('invoiceNo').addEventListener('change', checkDuplicate);

// ---------------------------------------------------------------------------
// Form state (draft payload)
// ---------------------------------------------------------------------------
function collectPayload() {
  return {
    distributor_id: $('supplier').value || null,
    invoice_no: $('invoiceNo').value.trim(),
    invoice_date: $('invoiceDate').value || null,
    due_date: $('dueDate').value || null,
    order_no: $('orderNo').value.trim(),
    order_date: $('orderDate').value || null,
    payment_terms: $('paymentTerms').value,
    tax_mode: $('invoiceTaxMode').value,
    notes: $('notes').value.trim(),
    discount: num($('invoiceDiscount').value),
    freight: num($('freight').value),
    round_off: num($('roundOff').value),
    printed_total: $('printedTotal').value === '' ? null : num($('printedTotal').value),
    items: [...$('itemRows').children].map(tr => ({
      medicine_id: tr.dataset.medicineId || null,
      medicine_label: tr.querySelector('.med-name').value.trim(),
      hsn: tr.querySelector('.hsn').value.trim(),
      pack: num(tr.querySelector('.pack').value) || 1,
      batch_no: tr.querySelector('.batch').value.trim(),
      expiry: tr.querySelector('.expiry').value,
      qty: num(tr.querySelector('.qty').value),
      free_qty: num(tr.querySelector('.free').value),
      mrp: num(tr.querySelector('.mrp').value),
      rate: num(tr.querySelector('.rate').value),
      rate_mode: tr.querySelector('.rate-mode').value,
      discount: num(tr.querySelector('.line-discount').value),
      tax_rate: num(tr.querySelector('.gst').value)
    }))
  };
}

function fillForm(p = {}) {
  $('purchaseForm').reset();
  $('itemRows').innerHTML = '';
  $('supplier').value = p.distributor_id || '';
  $('invoiceNo').value = p.invoice_no || '';
  $('invoiceDate').value = p.invoice_date || today();
  $('dueDate').value = p.due_date || '';
  $('orderNo').value = p.order_no || '';
  $('orderDate').value = p.order_date || '';
  $('paymentTerms').value = p.payment_terms || 'credit';
  $('invoiceTaxMode').value = p.tax_mode || 'exclusive';
  $('notes').value = p.notes || '';
  $('invoiceDiscount').value = p.discount ?? 0;
  $('freight').value = p.freight ?? 0;
  $('roundOff').value = p.round_off ?? 0;
  $('printedTotal').value = p.printed_total ?? '';
  if ($('amountPaid')) $('amountPaid').value = 0;
  attachments = [];
  renderFiles();
  $('dupWarning').hidden = true;
  setMsg('');
  (p.items?.length ? p.items : [{}]).forEach(makeItemRow);
  calcTotals();
}

function openForm(draft = null) {
  if (!canWrite) return;
  currentDraftId = draft?.id || null;
  $('formTitle').textContent = draft ? `Draft — ${draft.supplier_invoice_no || 'unnumbered'}` : 'New purchase';
  $('deleteDraft').hidden = !draft;
  fillForm(draft?.payload || {});
  $('purchaseDialog').showModal();
  if (draft) checkDuplicate();
}
$('newPurchase').onclick = () => openForm();
$('closePurchase').onclick = () => $('purchaseDialog').close();

$('saveDraft').onclick = async () => {
  const payload = collectPayload();
  if (!payload.distributor_id && !payload.invoice_no && !payload.items.some(i => i.medicine_label)) {
    return setMsg('Enter at least a supplier, invoice number or one medicine before saving a draft.', 'warning');
  }
  $('saveDraft').disabled = true;
  const { data, error } = await sb.rpc('purchase_draft_save', { p_id: currentDraftId, p_payload: payload });
  $('saveDraft').disabled = false;
  if (error) return setMsg(friendly(error), 'error');
  currentDraftId = data;
  $('deleteDraft').hidden = false;
  setMsg(`Draft saved at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}. Stock has not changed.${attachments.length ? ' Attached files are kept only until you close this form.' : ''}`);
  await loadDrafts();
};
$('deleteDraft').onclick = async () => {
  if (!currentDraftId || !confirm('Delete this draft? This cannot be undone.')) return;
  const { error } = await sb.rpc('purchase_draft_delete', { p_id: currentDraftId });
  if (error) return setMsg(friendly(error), 'error');
  currentDraftId = null;
  $('purchaseDialog').close();
  await loadDrafts();
};

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
const ALLOWED = /^(application\/pdf|image\/(jpeg|png|webp))$/;
function renderFiles() {
  $('attachmentList').innerHTML = attachments.length
    ? attachments.map((f, i) => `<div class="purchase-file"><span>${esc(f.name)} <small class="purchase-muted">(${Math.round(f.size / 1024)} KB)</small></span><span><button class="purchase-btn preview-file" data-index="${i}" type="button">View</button> <button class="purchase-btn danger remove-file" data-index="${i}" type="button">Remove</button></span></div>`).join('')
    : '<span class="purchase-muted">No bill files selected.</span>';
}
function addFiles(list) {
  for (const f of list) {
    if (!ALLOWED.test(f.type)) { setMsg(`Unsupported file: ${f.name}. Use PDF, JPG, PNG or WEBP.`, 'error'); continue; }
    if (f.size > 15 * 1024 * 1024) { setMsg(`${f.name} is larger than 15 MB.`, 'error'); continue; }
    attachments.push(f);
  }
  renderFiles();
}
$('billFiles').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('cameraFiles').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('attachmentList').onclick = e => {
  const i = Number(e.target.dataset.index);
  if (e.target.classList.contains('remove-file')) { attachments.splice(i, 1); renderFiles(); }
  if (e.target.classList.contains('preview-file')) showFile(URL.createObjectURL(attachments[i]), attachments[i].type, true);
};
function showFile(url, type, revoke) {
  $('filePreview').innerHTML = type === 'application/pdf'
    ? `<iframe title="Bill PDF" src="${esc(url)}" style="width:100%;height:70vh;border:0"></iframe>`
    : `<img class="purchase-preview" alt="Bill preview" src="${esc(url)}">`;
  $('fileDialog').dataset.url = revoke ? url : '';
  $('fileDialog').showModal();
}
$('closeFile').onclick = () => {
  $('fileDialog').close();
  if ($('fileDialog').dataset.url) URL.revokeObjectURL($('fileDialog').dataset.url);
  $('filePreview').innerHTML = '';
};

async function sha256(file) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function uploadAttachments(invoiceId, distributorId, invoiceDate) {
  const failed = [];
  for (const f of attachments) {
    const path = `${distributorId}/${crypto.randomUUID()}.${EXT[f.type]}`;
    const up = await sb.storage.from('purchase-documents').upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { failed.push(`${f.name}: ${friendly(up.error)}`); continue; }
    const reg = await sb.rpc('register_purchase_document', {
      p_path: path, p_name: f.name.slice(0, 200), p_mime: f.type, p_size: f.size, p_sha256: await sha256(f),
      p_distributor: distributorId, p_purchase: invoiceId, p_doc_date: invoiceDate, p_type: 'purchase_bill', p_notes: null
    });
    if (reg.error) { failed.push(`${f.name}: ${friendly(reg.error)}`); await sb.storage.from('purchase-documents').remove([path]); }
  }
  return failed;
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
$('excelUploadBtn').onclick = () => $('excelFile').click();
$('excelTemplate').onclick = () => {
  if (!window.XLSX) return alert('Excel library is not available. Please check your internet connection.');
  const headers = ['sl no', 'Item Name', 'HSN', 'Pack factor', 'Batch', 'Expiry', 'Qty (packs)', 'Free (packs)', 'MRP per pack', 'Rate per pack', 'Rate mode', 'Discount', 'GST %'];
  const ws = XLSX.utils.aoa_to_sheet([headers, [1, 'Paracetamol 650', '3004', 10, 'B123', '2027-12-31', 5, 0, 30, 18, 'exclusive', 0, 5]]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Medicine Items');
  XLSX.writeFile(wb, 'PALLIKKAL_MEDICALS_Purchase_Medicine_Template.xlsx');
};
$('excelFile').onchange = async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    if (!window.XLSX) throw new Error('Excel reader unavailable. Check your internet connection.');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const imported = [];
    for (const r of rows) {
      const pick = (...keys) => { for (const k of keys) { const f = Object.keys(r).find(x => x.trim().toLowerCase() === k.toLowerCase()); if (f) return r[f]; } return ''; };
      const raw = pick('Expiry', 'Exp');
      let exp = '';
      if (raw instanceof Date) exp = raw.toISOString().slice(0, 10);
      else if (typeof raw === 'number' && raw > 20000) { const d = XLSX.SSF.parse_date_code(raw); if (d) exp = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
      else if (raw) exp = String(raw).trim();
      const label = String(pick('Item Name', 'Medicine', 'Description')).trim();
      if (!label && !pick('Batch')) continue;
      const gst = pick('GST %', 'GST', 'Tax %');
      imported.push({
        medicine_label: label, hsn: pick('HSN', 'HSN Code'), batch_no: String(pick('Batch', 'batch')).trim(),
        pack: Number(pick('Pack factor', 'Pack')) || 1, qty: Number(pick('Qty (packs)', 'Qty (strips)', 'Qty', 'Quantity')) || 1,
        free_qty: Number(pick('Free (packs)', 'Free (strips)', 'Free Qty', 'Free')) || 0, expiry: exp,
        mrp: Number(pick('MRP per pack', 'MRP')) || 0, rate: Number(pick('Rate per pack', 'Rate', 'Trade Price')) || 0,
        rate_mode: String(pick('Rate mode', 'Rate Mode') || $('invoiceTaxMode').value || 'exclusive').toLowerCase() === 'inclusive' ? 'inclusive' : 'exclusive',
        discount: Number(pick('Discount', 'Discount Amount')) || 0, tax_rate: gst === '' ? 5 : Number(gst)
      });
    }
    if (!imported.length) throw new Error('No medicine rows found. Check the template headings.');
    if (!$('purchaseDialog').open) openForm();
    const blank = [...$('itemRows').children].filter(tr => !tr.querySelector('.med-name').value.trim());
    blank.forEach(tr => tr.remove());
    imported.forEach(makeItemRow);
    const unknown = [...$('itemRows').children].filter(tr => !tr.dataset.medicineId).length;
    setMsg(`${imported.length} medicine row(s) imported.${unknown ? ` ${unknown} row(s) are checking the medicine master — use “Create” on any row that stays red.` : ''} Review every row before posting.`);
  } catch (err) {
    setMsg(err.message || String(err), 'error');
  } finally {
    e.target.value = '';
  }
};

// ---------------------------------------------------------------------------
// Validate → confirm → post
// ---------------------------------------------------------------------------
function validateForm() {
  if (!$('supplier').value) return 'Select a supplier.';
  if (!$('invoiceNo').value.trim()) return 'Enter the supplier invoice number.';
  if (!$('invoiceDate').value) return 'Enter the invoice date.';
  if ($('invoiceDate').value > today()) return 'Invoice date cannot be in the future.';
  const rows = [...$('itemRows').children];
  if (!rows.length) return 'Add at least one medicine item.';
  const seen = new Set();
  for (const [idx, tr] of rows.entries()) {
    const c = calcLine(tr);
    const n = idx + 1;
    if (!tr.dataset.medicineId) return `Row ${n}: choose a medicine from the list or create it with “+ Create”.`;
    const batch = tr.querySelector('.batch').value.trim();
    const expiry = tr.querySelector('.expiry').value;
    if (!batch || !expiry) return `Row ${n}: enter batch number and expiry.`;
    if (expiry <= today()) return `Row ${n}: batch ${batch} is expired.`;
    if (!(c.qty > 0) || !Number.isInteger(c.qty)) return `Row ${n}: quantity must be a whole number of packs above zero.`;
    if (c.free < 0 || !Number.isInteger(c.free)) return `Row ${n}: free quantity must be a whole number.`;
    if (!(c.pack >= 1)) return `Row ${n}: pack factor must be at least 1.`;
    if (c.gst < 0 || c.gst > 40) return `Row ${n}: GST must be between 0 and 40.`;
    if (c.discount > c.qty * c.rate) return `Row ${n}: discount exceeds the line amount.`;
    if (c.mrp > 0 && c.priceEx > c.mrp) return `Row ${n}: purchase rate per pack is above the MRP per pack. Check the values.`;
    const key = `${tr.dataset.medicineId}|${batch.toLowerCase()}`;
    if (seen.has(key)) return `Row ${n}: the same medicine and batch appear twice. Combine them into one row.`;
    seen.add(key);
  }
  const rnd = num($('roundOff').value);
  if (Math.abs(rnd) > 100) return 'Round off must be within ±100.';
  return '';
}

$('confirmPurchase').onclick = async () => {
  const err = validateForm();
  if (err) return setMsg(err, 'error');
  if (await checkDuplicate()) return setMsg('This supplier invoice is already posted.', 'error');
  const t = calcTotals();
  const paid = isAdmin ? num($('amountPaid').value) : 0;
  if (paid < 0 || paid > t.total + 0.005) return setMsg('Amount paid must be between 0 and the invoice total.', 'error');
  const rows = [...$('itemRows').children].map(tr => ({ name: tr.querySelector('.med-name').value, batch: tr.querySelector('.batch').value, c: calcLine(tr) }));
  $('confirmSummary').innerHTML = `<div class="purchase-table-wrap"><table class="purchase-table"><thead><tr><th>Medicine</th><th>Batch</th><th>Stock added</th>${isAdmin ? '<th>Line total</th>' : ''}</tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.batch)}</td><td>${r.c.stockUnits} units${r.c.free ? ` (incl. ${r.c.free * r.c.pack} free)` : ''}</td>${isAdmin ? `<td>${fmt(r.c.total)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    <p><strong>Invoice total ${fmt(t.total)}</strong>${paid > 0 ? ` · paying ${fmt(paid)} now by ${esc($('paymentMode').value.toUpperCase())}` : ' · posted as payable'}${attachments.length ? ` · ${attachments.length} file(s) will be attached` : ''}</p>`;
  $('confirmDialog').showModal();
};
$('backToEdit').onclick = () => $('confirmDialog').close();

$('postNow').onclick = async () => {
  $('confirmDialog').close();
  $('postNow').disabled = true;
  setMsg('Posting purchase…');
  const header = {
    distributor_id: $('supplier').value, invoice_no: $('invoiceNo').value.trim(), invoice_date: $('invoiceDate').value,
    due_date: $('dueDate').value || null, order_no: $('orderNo').value.trim() || null, order_date: $('orderDate').value || null,
    payment_terms: $('paymentTerms').value, discount: num($('invoiceDiscount').value), freight: num($('freight').value),
    round_off: num($('roundOff').value), printed_total: $('printedTotal').value === '' ? null : num($('printedTotal').value),
    notes: $('notes').value.trim() || null
  };
  const items = [...$('itemRows').children].map(tr => {
    const c = calcLine(tr);
    return {
      medicine_id: tr.dataset.medicineId, batch_no: tr.querySelector('.batch').value.trim(), expiry: tr.querySelector('.expiry').value,
      qty: c.qty, free_qty: c.free, pack: c.pack, price: Math.round(c.priceEx * 10000) / 10000,
      discount: Math.round(c.discEx * 100) / 100, tax_rate: c.gst, mrp: c.mrp || null,
      hsn: tr.querySelector('.hsn').value.trim() || null, rate_mode: c.mode
    };
  });
  const payment = isAdmin && num($('amountPaid').value) > 0
    ? { amount: num($('amountPaid').value), method: $('paymentMode').value, reference: $('paymentRef').value.trim() || null } : null;
  const { data: invoiceId, error } = await sb.rpc('confirm_purchase_v2', { p_header: header, p_items: items, p_payment: payment, p_draft: currentDraftId });
  $('postNow').disabled = false;
  if (error) return setMsg(friendly(error), 'error');

  let note = 'Purchase posted and stock updated.';
  if (attachments.length) {
    setMsg('Purchase posted. Uploading bill files…');
    const failed = await uploadAttachments(invoiceId, header.distributor_id, header.invoice_date);
    note += failed.length ? ` ${attachments.length - failed.length} of ${attachments.length} file(s) attached. Not attached: ${failed.join('; ')}. Upload them from Documents.` : ` ${attachments.length} bill file(s) attached.`;
  }
  currentDraftId = null;
  $('purchaseDialog').close();
  await Promise.all([loadPurchases(), loadDrafts()]);
  flash(note, /Not attached/.test(note));
  openDetail(invoiceId);
};

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------
function flash(message, warn) {
  let el = document.querySelector('.purchase-flash');
  if (!el) { el = document.createElement('div'); el.className = 'purchase-flash'; document.querySelector('.purchase-page').prepend(el); }
  el.className = `purchase-flash ${warn ? 'purchase-warning' : 'purchase-notice'}`;
  el.textContent = message;
}

async function loadPurchases() {
  const { data, error } = await sb.rpc('purchase_list', { p_limit: 500 });
  if (error) { purchaseRows = []; renderList(friendly(error)); return; }
  purchaseRows = data || [];
  renderList();
}
async function loadDrafts() {
  if (!canWrite) { draftRows = []; return; }
  const { data, error } = await sb.rpc('purchase_draft_list');
  draftRows = error ? [] : (data || []);
  $('draftBadge').textContent = draftRows.length;
  $('statDraft').textContent = draftRows.length;
  if (tab === 'drafts') renderList();
}

function renderList(errorText) {
  const query = $('searchPurchase').value.trim().toLowerCase();
  const from = $('fromDate').value, to = $('toDate').value;
  const posted = purchaseRows.filter(p => p.status === 'confirmed');
  $('statCount').textContent = posted.length;
  $('statValue').textContent = isAdmin ? fmt(posted.reduce((s, p) => s + num(p.total), 0)) : 'Admin only';
  const month = today().slice(0, 7);
  $('statMonth').textContent = isAdmin ? fmt(posted.filter(p => String(p.invoice_date).startsWith(month)).reduce((s, p) => s + num(p.total), 0)) : posted.filter(p => String(p.invoice_date).startsWith(month)).length + ' bills';

  if (tab === 'drafts') {
    $('listHead').innerHTML = '<tr><th>Saved</th><th>Invoice No.</th><th>Supplier</th><th>Items</th><th>Saved by</th><th>Actions</th></tr>';
    const rows = draftRows.filter(d => (!query || `${d.supplier_invoice_no || ''} ${d.distributor || ''}`.toLowerCase().includes(query)));
    $('listCount').textContent = `${rows.length} draft(s)`;
    $('purchaseRows').innerHTML = rows.length ? rows.map(d => `<tr><td>${esc(new Date(d.updated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }))}</td><td>${esc(d.supplier_invoice_no || '—')}</td><td>${esc(d.distributor || '—')}</td><td>${d.item_count}</td><td>${esc(d.updated_by_name || '')}</td><td class="purchase-actions-cell"><button class="purchase-btn primary" data-resume="${esc(d.id)}" type="button">Continue</button></td></tr>`).join('')
      : `<tr><td colspan="6" class="purchase-empty">${canWrite ? 'No drafts. Use “Save draft” in a purchase to finish it later.' : 'Drafts are available to purchase staff.'}</td></tr>`;
    return;
  }
  $('listHead').innerHTML = `<tr><th>Date</th><th>Invoice No.</th><th>Supplier</th><th>Status</th>${isAdmin ? '<th>Total</th>' : ''}<th>Actions</th></tr>`;
  if (errorText) { $('purchaseRows').innerHTML = `<tr><td colspan="6" class="purchase-empty">${esc(errorText)}</td></tr>`; return; }
  const rows = purchaseRows.filter(p => (!query || `${p.supplier_invoice_no} ${p.distributor}`.toLowerCase().includes(query))
    && (!from || p.invoice_date >= from) && (!to || p.invoice_date <= to));
  $('listCount').textContent = `${rows.length} shown`;
  $('purchaseRows').innerHTML = rows.length ? rows.map(p => `<tr><td>${esc(p.invoice_date || '')}</td><td>${esc(p.supplier_invoice_no || '')}</td><td>${esc(p.distributor || '')}</td><td><span class="purchase-status ${p.status === 'confirmed' ? 'posted' : 'cancelled'}">${p.status === 'confirmed' ? 'Posted' : esc(p.status)}</span></td>${isAdmin ? `<td>${fmt(p.total)}</td>` : ''}<td class="purchase-actions-cell"><button class="purchase-btn" data-view="${esc(p.id)}" type="button">View</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="purchase-empty">No matching purchase invoices.</td></tr>';
}

document.querySelector('.purchase-tabs').onclick = e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('.purchase-tab').forEach(x => x.classList.toggle('active', x === b));
  renderList();
};
['searchPurchase', 'fromDate', 'toDate'].forEach(id => $(id).addEventListener('input', () => renderList()));
$('clearFilters').onclick = () => { ['searchPurchase', 'fromDate', 'toDate'].forEach(id => { $(id).value = ''; }); renderList(); };
$('purchaseRows').onclick = e => {
  const v = e.target.closest('[data-view]');
  if (v) return openDetail(v.dataset.view);
  const r = e.target.closest('[data-resume]');
  if (r) openForm(draftRows.find(d => d.id === r.dataset.resume));
};

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------
async function openDetail(id) {
  $('viewContent').innerHTML = '<div class="purchase-muted">Loading purchase…</div>';
  $('viewDialog').showModal();
  const { data, error } = await sb.rpc('purchase_detail', { p_invoice: id });
  if (error) { $('viewContent').innerHTML = `<div class="purchase-error">${esc(friendly(error))}</div>`; return; }
  const i = data.invoice, costs = data.can_see_costs;
  $('viewTitle').textContent = `Purchase ${i.supplier_invoice_no}`;
  const detail = (label, value) => value == null || value === '' ? '' : `<div class="purchase-detail"><small>${label}</small><strong>${value}</strong></div>`;
  $('viewContent').innerHTML = `
    <div class="purchase-view-grid">
      ${detail('Supplier', esc(i.distributor?.name))}${detail('Invoice number', esc(i.supplier_invoice_no))}${detail('Invoice date', esc(i.invoice_date))}
      ${detail('Due date', esc(i.due_date))}${detail('Order', esc([i.order_no, i.order_date].filter(Boolean).join(' · ')))}${detail('Payment terms', esc(i.payment_terms))}
      ${detail('Status', i.status === 'confirmed' ? 'Posted' : esc(i.status))}${detail('Entered by', esc(i.created_by))}
      ${costs ? detail('Invoice total', fmt(i.total)) + detail('Balance payable', fmt(i.balance)) : ''}
    </div>
    ${i.notes ? `<p class="purchase-muted">Note: ${esc(i.notes)}</p>` : ''}
    <h4>Medicines</h4>
    <div class="purchase-table-wrap"><table class="purchase-table"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Free</th><th>Pack</th><th>Stock units</th><th>MRP/pack</th><th>GST</th>${costs ? '<th>Rate/pack (ex GST)</th><th>Discount</th><th>Net</th>' : ''}</tr></thead><tbody>
    ${data.items.map(x => `<tr><td>${esc(x.medicine)} ${esc(x.strength || '')}</td><td>${esc(x.batch_no)}</td><td>${esc(x.expiry)}</td><td>${num(x.qty)}</td><td>${num(x.free_qty)}</td><td>${num(x.pack)}</td><td>${num(x.stock_units)}</td><td>${x.mrp == null ? '—' : fmt(x.mrp)}</td><td>${num(x.tax_rate)}%</td>${costs ? `<td>${fmt(x.unit_price)}</td><td>${fmt(x.line_discount)}</td><td>${fmt(x.line_net)}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>
    ${costs ? `<div class="purchase-summary"><div class="purchase-summary-box">
      <div class="purchase-summary-line"><span>Taxable subtotal</span><strong>${fmt(i.subtotal)}</strong></div>
      <div class="purchase-summary-line"><span>GST</span><strong>${fmt(i.tax)}</strong></div>
      <div class="purchase-summary-line"><span>Invoice discount</span><strong>${fmt(i.discount)}</strong></div>
      <div class="purchase-summary-line"><span>Freight</span><strong>${fmt(i.freight)}</strong></div>
      <div class="purchase-summary-line"><span>Round off</span><strong>${fmt(i.round_off)}</strong></div>
      <div class="purchase-summary-line total"><span>Total</span><strong>${fmt(i.total)}</strong></div></div></div>
      <h4>Payments</h4>${data.payments.length ? `<ul>${data.payments.map(p => `<li>${esc(p.payment_no)} · ${fmt(p.amount)} by ${esc(String(p.method).toUpperCase())}${p.reference ? ' · ' + esc(p.reference) : ''}${p.status !== 'posted' ? ' · ' + esc(p.status) : ''}</li>`).join('')}</ul>` : '<p class="purchase-muted">No payments recorded yet (Finance → Payables).</p>'}` : ''}
    <h4>Bill documents</h4>
    ${data.documents.length ? `<div class="purchase-file-list">${data.documents.map(d => `<div class="purchase-file"><span>${esc(d.file_name)}</span><button class="purchase-btn" type="button" data-open="${esc(d.path)}" data-mime="${esc(d.mime)}">Open</button></div>`).join('')}</div>` : '<p class="purchase-muted">No bill files attached. Add them from Documents.</p>'}`;
}
$('viewContent').onclick = async e => {
  const b = e.target.closest('[data-open]');
  if (!b) return;
  const { data, error } = await sb.storage.from('purchase-documents').createSignedUrl(b.dataset.open, 300);
  if (error) return alert(friendly(error));
  showFile(data.signedUrl, b.dataset.mime, false);
};
$('closeView').onclick = () => $('viewDialog').close();

if (!canWrite) {
  $('newPurchase').disabled = true;
  $('newPurchase').title = 'Your role can view purchases only';
}
// Deep links from the dashboard: ?q=<invoice or supplier> pre-fills the search, ?new=1 opens a new purchase.
const purchaseParams = new URLSearchParams(location.search);
if (purchaseParams.get('q')) $('searchPurchase').value = purchaseParams.get('q');
await Promise.all([loadPurchases(), loadDrafts()]);
if (purchaseParams.get('new') === '1' && canWrite) $('newPurchase').click();
