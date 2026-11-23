// Billing (Point of Sale) — Pallikkal Pharmacy design.
// Totals, FEFO allocation, reservations, permissions and audit all come from the
// billing engine and the database; this file only lays them out.
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { afterBill, sendInvoice, waSettings } from './whatsapp-invoice.js';
import { esc, inr } from './utils.js';
import { friendly, safeQ } from './ui.js';
import { showInvoice } from './invoice.js';
import { calcLine, validateLineInput, summarize, detectAnomalies, explainAllocation, GST_FALLBACK_RATES } from './billing-engine.js';
import { mountAssistant } from './billing-assistant.js';
import { icon, setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';
import { can } from './permissions.js';
import { loadSettings } from './app-settings.js';

const prof = await mountShell('billing', 'Billing', { layout: 'brand' });
waSettings(sb);   // WhatsApp invoice settings, loaded early so the bill is not delayed
const allowedRoles = ['super_admin', 'admin', 'admin_staff', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory'];   // every staff role (0037)

if (!allowedRoles.includes(prof.role)) {
  document.getElementById('view').textContent = 'Not authorised for billing.';
  throw new Error('Not authorised for billing');
}
const isAdmin = ['super_admin', 'admin'].includes(prof.role);

// Daily opening cash is collected during the first successful login of the
// IST day, not whenever the Billing page is opened.

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// Icons used only on this page (same stroke style as the shell icons)
// ---------------------------------------------------------------------------
const svg = (body, sw = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const I = {
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2.7l2.6 12.2a1.6 1.6 0 0 0 1.6 1.3h8.7a1.6 1.6 0 0 0 1.5-1.2L21.5 7H6.1"/>', 2),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  doc: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5"/>'),
  userPlus: svg('<circle cx="10" cy="8" r="4"/><path d="M2.5 21c.8-4 3.8-6.5 7.5-6.5 1.6 0 3 .4 4.2 1.2"/><path d="M19 15v6M16 18h6"/>'),
  clip: svg('<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>'),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>', 2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  scan: svg('<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M16 8v8"/>'),
  barcode: svg('<path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14"/>', 2.2),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
  minus: svg('<path d="M5 12h14"/>', 2.2),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.4),
  note: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  bookmark: svg('<path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>', 2),
  box: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  tag: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  printer: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
  summary: svg('<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>', 2),
  card: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>', 2),
  pencil: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 2),
  cash: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>'),
  upi: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3 14 12l-5.5 9" fill="none" stroke="#f47b20" stroke-width="2.6" stroke-linejoin="round"/><path d="M12.5 3 18 12l-5.5 9" fill="none" stroke="#138808" stroke-width="2.6" stroke-linejoin="round"/></svg>',
  wallet: svg('<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7l12-4 2 4"/><circle cx="16.5" cy="13.5" r="1.2"/>'),
  credit: svg('<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a2 2 0 0 0-2.8 0l-.9.9a1 1 0 1 1-3-3l2.8-2.8a3 3 0 0 1 3.6-.5l.5.3a3 3 0 0 0 2 .4L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>'),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
  check: svg('<path d="m5 12 5 5 9-10"/>', 3),
  chevron: svg('<path d="m6 9 6 6 6-6"/>', 2),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2),
  calendar: svg('<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>'),
  truck: svg('<path d="M2 6h11v10H2z"/><path d="M13 9h4.5l3.5 3.5V16h-8"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>'),
  store: svg('<path d="M3 9.5 4.5 4h15L21 9.5"/><path d="M4 9.5V20h16V9.5"/><path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M10 20v-5h4v5"/>'),
  spark: svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>')
};
const PILL_COLORS = ['#1e7be6', '#e5484d', '#7a4ff0', '#12a01b', '#f29a00', '#0e9488'];
const pillThumb = name => {
  const c = PILL_COLORS[[...String(name || 'x')].reduce((s, ch) => s + ch.charCodeAt(0), 0) % PILL_COLORS.length];
  return `<span class="pos-thumb pos-thumb-ph" style="--c:${c}" aria-hidden="true"><svg viewBox="0 0 40 40"><rect x="3" y="9" width="34" height="22" rx="4" fill="#fff" stroke="#d9dfe8"/><rect x="3" y="9" width="12" height="22" rx="4" fill="var(--c)"/><path d="M20 15h12M20 20h9M20 25h11" stroke="#c8d0db" stroke-width="2" stroke-linecap="round"/></svg></span>`;
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');
const canSales = can(prof.role, 'sales'), canReturns = can(prof.role, 'returns'), canCustomers = can(prof.role, 'customers');

$('view').innerHTML = `
<div class="pos">
  <section class="pos-head">
    <div class="pos-title">
      <span class="pos-title-ic">${I.cart}</span>
      <div><h1>Billing <span>(Point of Sale)</span></h1><p>Create new bills, add medicines, and complete sales instantly.</p></div>
    </div>
    <div class="pos-head-actions">
      <button type="button" class="pos-btn" id="held">${I.history}<span>Hold Bills</span><b class="pos-count" id="heldCount" hidden>0</b></button>
      ${canSales ? `<a class="pos-btn" href="sales.html">${I.doc}<span>Bill History</span></a>` : ''}
      <button type="button" class="pos-btn" id="settingsBtn">${I.gear}<span>Billing Settings</span></button>
    </div>
  </section>

  <div class="pos-status">
    <span class="pos-chip">${I.calendar}<span><span id="billDate"></span> · Bill no. generated on save</span></span>
    <span class="pos-chip pos-shop">${I.store}<span>Shop</span><button id="shopStateToggle" class="shop-state-toggle is-closed" type="button" aria-pressed="false">Closed</button></span>
    <span id="deliveryIndicator" class="pos-chip delivery-indicator delivery-state-offline" aria-live="polite">
      <span class="delivery-dot"></span><span><strong>Delivery: <span id="deliveryPresenceLabel">Offline</span></strong> <small id="deliveryPresenceDetail">Checking delivery-person availability…</small></span>
    </span>
  </div>

  <div class="pos-grid">
    <div class="pos-left">
      <section class="pos-card pos-main">
        <div class="pos-top">
          <div class="pos-box pos-cust">
            <span class="pos-box-ic">${I.user}</span>
            <div class="pos-cust-body">
              <label for="custInput">Customer</label>
              <div class="pos-combo" id="cust">
                <input id="custInput" autocomplete="off" placeholder="Walk-in Customer" aria-label="Customer — type a name or phone number">
                <button type="button" class="pos-combo-btn" id="custToggle" aria-label="Show customers">${I.chevron}</button>
                <div class="pos-combo-list" id="custList" hidden></div>
              </div>
              <small class="pos-cust-info" id="custInfo"></small>
            </div>
            <button type="button" class="pos-btn pos-btn-sm" id="custAdd">${I.userPlus}<span>Add</span></button>
          </div>
          <div class="pos-box pos-rx">
            <span class="pos-box-ic">${I.clip}</span>
            <button type="button" class="pos-rx-toggle" id="rxToggle" aria-expanded="false" aria-controls="rxPanel"><b>Prescription</b> <span>(Optional)</span>${I.chevron}</button>
            <label class="pos-btn pos-btn-green pos-btn-sm" id="rxUploadBtn">${I.upload}<span>Upload</span><input type="file" id="rxFile" accept="application/pdf,image/jpeg,image/png,image/webp" hidden></label>
          </div>
        </div>
        <div class="pos-rx-panel" id="rxPanel" hidden>
          <div class="pos-field"><label for="doctorName">Doctor name</label><input id="doctorName" placeholder="Prescribing doctor's name"></div>
          <div class="pos-field"><label for="patientName">Patient name</label><input id="patientName" placeholder="Patient full name"></div>
          <div class="pos-field"><label for="patientPhone">Patient number</label><input id="patientPhone" inputmode="tel" placeholder="Mobile number"></div>
          <div class="pos-field"><label for="patientAddress">Patient address</label><input id="patientAddress" placeholder="Address"></div>
          <div class="pos-rx-file" id="rxFileInfo"></div>
        </div>

        <div class="pos-search-row">
          <div class="pos-search" id="searchWrap">
            ${I.search}
            <input id="q" placeholder="Search medicine by name, brand, or barcode..." autocomplete="off" aria-label="Search medicine by name, brand, or barcode" autofocus>
            <div id="res" class="medicine-results" role="listbox"></div>
          </div>
          <button type="button" class="pos-icon-btn" id="camScan" title="Scan with camera" aria-label="Scan barcode with camera">${I.scan}</button>
          <button type="button" class="pos-btn pos-btn-green" id="scanMode">${I.barcode}<span>Scan Barcode</span></button>
        </div>

        <div class="pos-items-head"><h2>Items <span id="itemCount">(0)</span></h2>
          <button type="button" class="pos-btn pos-btn-green pos-btn-sm" id="addMed">${I.plus}<span>Add Medicine</span></button></div>
        <div class="pos-table-wrap"><table class="pos-table bill-table fefo-table"><thead><tr>
          <th class="c-no">#</th><th>Medicine</th><th class="c-shelf">Shelf</th><th>Batch</th><th>Expiry</th><th class="c-r">MRP (₹)</th><th class="c-c">Qty</th><th class="c-c c-gst">GST</th><th class="c-c">Disc.</th><th class="c-r">Amount (₹)</th><th class="c-x"></th>
        </tr></thead><tbody id="cart"></tbody></table></div>

        <div class="pos-under">
          <div class="pos-notes" id="notesBox">
            <button type="button" class="pos-notes-btn" id="notesToggle" aria-expanded="false">${I.note}<span>Add Notes <em>(Optional)</em></span></button>
            <textarea id="diagnosis" rows="2" maxlength="500" placeholder="Diagnosis or notes printed on the bill" hidden></textarea>
          </div>
          <button type="button" class="pos-btn pos-btn-red" id="clear">${I.trash}<span>Clear Cart</span></button>
          <button type="button" class="pos-btn" id="hold">${I.bookmark}<span>Save as Hold</span></button>
        </div>
        <p class="pos-perm table-footnote" id="permNote">Batches are allocated First-Expiry-First-Out and reserved for this bill. Expired, quarantined, recalled, blocked and zero-stock batches are never allocated. Stock is revalidated and deducted only when the bill is finalized.</p>
      </section>

      <section class="pos-card pos-quick">
        <h2>${I.bolt}Quick Actions</h2>
        <div class="pos-qa">
          <button type="button" data-qa="browse">${I.box}<span>Browse Medicines</span></button>
          ${canSales ? `<a href="sales.html">${I.doc}<span>Bill History</span></a>` : ''}
          ${canReturns ? `<a href="returns.html">${I.undo}<span>Returns</span></a>` : ''}
          <button type="button" data-qa="offer">${I.tag}<span>Apply Offer</span></button>
          <button type="button" data-qa="last">${I.printer}<span>Print Last Bill</span></button>
          <button type="button" data-qa="clear" class="danger">${I.trash}<span>Clear Cart</span></button>
        </div>
      </section>

      <section class="pos-card pos-assistant assistant-card" id="assistant"></section>
    </div>

    <aside class="pos-right">
      <section class="pos-card pos-summary">
        <h2>${I.summary}Invoice Summary</h2>
        <div class="pos-sum">
          <div><span>Items</span><b id="totalItems">0</b></div>
          <div><span>Total Quantity</span><b id="totalQty">0</b></div>
          <div><span>Subtotal <small>(MRP value)</small></span><b id="sumBase">₹0.00</b></div>
          <div class="pos-disc-line"><span>Discount <button type="button" class="pos-pencil" id="discEdit" aria-label="Edit bill discount" aria-expanded="false">${I.pencil}</button></span><b class="green" id="sumDisc">- ₹0.00</b></div>
          <div class="pos-disc-edit" id="discBox" hidden>
            <label for="disc">Extra bill discount (₹)</label>
            <div class="pos-disc-row"><input id="disc" type="number" min="0" step="0.01" value="0" inputmode="decimal">
              <span class="pos-disc-quick">${[2, 5, 10].map(p => `<button type="button" data-pct="${p}">${p}%</button>`).join('')}<button type="button" data-pct="0">Clear</button></span></div>
            <small id="discHint"></small>
          </div>
          <div class="pos-sub"><span>Taxable value</span><b id="sumTaxable">₹0.00</b></div>
          <div><span id="gstLabel">GST</span><b id="sumGst">₹0.00</b></div>
          <div class="pos-sub" hidden><span>Bill amount</span><b id="sumSub">₹0.00</b></div>
        </div>
        <div class="pos-grand"><span>Grand Total</span><strong id="tot">₹0.00</strong></div>
      </section>

      <section class="pos-card pos-pay">
        <h2>${I.card}Payment Method</h2>
        <div class="pos-methods" role="radiogroup" aria-label="Payment method">
          ${[['cash', I.cash, 'Cash'], ['card', I.card, 'Card'], ['upi', I.upi, 'UPI'], ['wallet', I.wallet, 'Wallet'], ['credit', I.credit, 'Credit'], ['split', I.dots, 'Split']]
            .map(([m, ic, l]) => `<button type="button" role="radio" class="pos-method" data-method="${m}" aria-checked="false">${ic}<span>${l}</span><i class="pos-tick">${I.check}</i></button>`).join('')}
        </div>
        <div id="pays" class="payment-rows"></div>
        <div class="pos-pay-detail" id="payDetail"></div>
        <button class="pos-link-btn" id="addp" type="button" hidden>${I.plus}Add another payment method</button>
        <p id="rem" class="remaining-note"></p>
        <button id="pay" class="pos-generate" type="button">${I.printer}<span id="payLabel">Generate Bill (₹0.00)</span></button>
        <div id="msg" class="pos-msg billing-message" aria-live="polite"></div>
      </section>
    </aside>
  </div>
</div>
<dialog id="hd" class="pos-dialog billing-dialog"><div id="hl"></div><div class="pos-dialog-foot"><button class="pos-btn" type="button" onclick="this.closest('dialog').close()">Close</button></div></dialog>
<dialog id="bd" class="pos-dialog billing-dialog"><div id="bl"></div><div class="pos-dialog-foot"><button class="pos-btn" id="bc" type="button">Close</button></div></dialog>
<dialog id="custDlg" class="pos-dialog"><form id="custForm" method="dialog">
  <h3>Add customer</h3>
  <div class="pos-field"><label for="ncName">Name *</label><input id="ncName" required maxlength="120" placeholder="Customer name"></div>
  <div class="pos-field"><label for="ncPhone">Mobile number *</label><input id="ncPhone" required inputmode="tel" placeholder="10-digit mobile number"></div>
  <div class="pos-field"><label for="ncAddress">Address</label><input id="ncAddress" maxlength="300" placeholder="Optional"></div>
  <p class="pos-form-msg" id="ncMsg"></p>
  <div class="pos-dialog-foot"><button type="button" class="pos-btn" id="ncCancel">Cancel</button><button type="submit" class="pos-btn pos-btn-solid" id="ncSave">Save &amp; select</button></div>
</form></dialog>
<dialog id="setDlg" class="pos-dialog"><div id="setBody"></div></dialog>
<dialog id="browseDlg" class="pos-dialog pos-browse"><div class="pos-browse-head"><h3>Browse medicines</h3><input id="browseQ" placeholder="Filter by name" autocomplete="off"><button type="button" class="pos-icon-btn" id="browseClose" aria-label="Close">${I.close}</button></div><div id="browseList" class="pos-browse-list"></div></dialog>
<dialog id="camDlg" class="pos-dialog"><h3>Scan barcode</h3><video id="camVideo" playsinline muted></video><p class="pos-form-msg" id="camMsg">Point the camera at the barcode.</p><div class="pos-dialog-foot"><button type="button" class="pos-btn" id="camClose">Close</button></div></dialog>`;

mountGlobalSearch({ sb, prof });

// Branch-level delivery availability is supplied by delivery-person status
// buttons and read through a branch-scoped SECURITY DEFINER RPC.
let deliveryState = 'offline';
let heldN = 0;
async function refreshDeliveryPresence() {
  const indicator = $('deliveryIndicator');
  if (!indicator) return;
  const { data, error } = await sb.rpc('delivery_presence_summary');
  if (error || !data) {
    $('deliveryPresenceLabel').textContent = 'Unavailable';
    $('deliveryPresenceDetail').textContent = 'Could not load delivery availability.';
    indicator.classList.remove('delivery-state-available', 'delivery-state-purchasing');
    indicator.classList.add('delivery-state-offline');
    return;
  }
  const state = ['available', 'purchasing', 'offline'].includes(data.status) ? data.status : 'offline';
  const labels = { available: 'Online', purchasing: 'On Purchase', offline: 'Offline' };
  const counts = `Online ${Number(data.available_count || 0)} · On Purchase ${Number(data.purchasing_count || 0)} · Offline ${Number(data.offline_count || 0)}`;
  $('deliveryPresenceLabel').textContent = labels[state];
  $('deliveryPresenceDetail').textContent = counts;
  indicator.classList.remove('delivery-state-available', 'delivery-state-purchasing', 'delivery-state-offline');
  indicator.classList.add(`delivery-state-${state}`);
  deliveryState = state;
  refreshNotifications();
}

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
  refreshNotifications();
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
    refreshNotifications();
  } catch (error) {
    console.error('Could not update shop status:', error);
    note('Shop status could not be updated. Please try again.', true);
    await loadShopStatus();
  } finally {
    shopStatusBusy = false;
    shopToggle.disabled = false;
  }
});

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
async function loadConfig() {
  const { data, error } = await sb.rpc('billing_my_config');
  if (error) console.warn('billing_my_config unavailable — apply migration 0020:', error);
  else cfg = { ...cfg, ...data, gst_rates: (data.gst_rates || GST_FALLBACK_RATES).map(Number) };
}
await loadConfig();
// Payment methods switched on in Settings → Payment Methods (0033); all are on by default.
const appSet = await loadSettings(sb);
const PAY_ON = new Set(appSet.payments.enabled?.length ? appSet.payments.enabled : ['cash', 'card', 'upi', 'wallet', 'credit', 'split']);
const DEF_PM = ['cash', 'card', 'upi', 'wallet'].includes(appSet.payments.default_method) && PAY_ON.has(appSet.payments.default_method) ? appSet.payments.default_method : 'cash';
const DEF_PAY = DEF_PM === 'wallet' ? 'upi' : DEF_PM;
document.querySelectorAll('.pos-method').forEach(b => { b.hidden = !PAY_ON.has(b.dataset.method); });
const SPLIT_MS = ['cash', 'upi', 'card'].filter(m => PAY_ON.has(m)).length ? ['cash', 'upi', 'card'].filter(m => PAY_ON.has(m)) : ['cash', 'upi', 'card'];
const perm = cfg.permissions;
$('disc').disabled = !perm.discount;
if (!perm.discount) {
  $('disc').title = 'You do not have permission to apply discounts';
  $('discEdit').title = 'You do not have permission to apply discounts';
}
const permText = () => ` Editing: discount ${perm.discount ? `allowed (max ${cfg.max_discount_pct}%)` : 'not permitted'} · GST ${perm.gst_edit ? 'allowed' : 'not permitted'} · MRP ${perm.mrp_edit ? 'allowed (up to printed MRP)' : 'not permitted'} · batch override ${perm.batch_override ? 'allowed' : 'not permitted'}.`;
$('permNote').insertAdjacentText('beforeend', permText());

// ============================================================================
// State
// ============================================================================
let cust = null, avail = 0, outstanding = 0, pays = [{ method: DEF_PAY, amount: '' }];
let payMode = DEF_PM;          // cash | card | upi | wallet | credit | split
let cashReceived = '';
let rxFile = null;
let cartToken = crypto.randomUUID();
// One group per medicine. Each group holds the server FEFO allocation (rows)
// and the user's edits, keyed by batch so re-allocation keeps them.
let groups = [];
const qtyTimers = new Map();
const expanded = new Set();     // single-batch groups whose batch details are open

let msgTimer;
const note = (m, bad) => {
  const el = $('msg');
  el.textContent = m;
  el.classList.toggle('bad', !!bad);
  el.classList.toggle('show', !!m);
  clearTimeout(msgTimer);
  if (m && !bad) msgTimer = setTimeout(() => el.classList.remove('show'), 9000);
};

$('bc').onclick = () => $('bd').close();

const digits10 = s => {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};
const num = v => (v === '' || v == null ? NaN : Number(v));
const fmtQty = v => Number(v || 0).toLocaleString('en-IN');
const findGroup = key => groups.find(g => g.key === key);
const money = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ============================================================================
// Customer (search by name or phone, walk-in by default)
// ============================================================================
async function setCust(c) {
  cust = c;
  avail = 0;
  outstanding = 0;

  if (c) {
    const { data } = await sb.rpc('customer_outstanding', { p_customer: c.id });
    outstanding = +data || 0;
    avail = Math.max(0, (+c.credit_limit || 0) - outstanding);
  }

  // Credit is represented by the server-generated unpaid remainder, not a cashier-entered row.
  pays.forEach(p => { if (p.method === 'credit') p.method = 'cash'; });
  if (!c && payMode === 'credit') payMode = DEF_PM;

  renderCust();
  renderPays();
}

function renderCust() {
  const input = $('custInput');
  $('cust').classList.toggle('has-value', !!cust);
  if (cust) {
    input.value = `${cust.name} · ${cust.phone}`;
    $('custInfo').innerHTML = `${Number(cust.credit_limit) > 0 ? `Credit available <b>${inr(avail)}</b> of ${inr(cust.credit_limit)}` : 'No credit limit set'}${outstanding > 0 ? ` · owes ${inr(outstanding)}` : ''} · <button type="button" class="pos-text-btn" id="cc">Walk-in instead</button>`;
    $('cc').onclick = () => setCust(null);
  } else {
    input.value = '';
    $('custInfo').textContent = '';
  }
}

let custTimer, custSeq = 0, custItems = [], custActive = -1;
function closeCustList() { $('custList').hidden = true; custActive = -1; }
function paintCustList() {
  $('custList').querySelectorAll('[data-ci]').forEach((b, i) => b.classList.toggle('active', i === custActive));
}
async function searchCustomers(term) {
  const my = ++custSeq;
  const s = safeQ(term || '');
  let q = sb.from('customers').select('id,name,phone,consent,credit_limit,active').eq('branch_id', prof.branch_id).eq('active', true);
  const d = s.replace(/\D/g, '');
  if (s && d.length >= 3 && d.length === s.replace(/\s/g, '').length) q = q.ilike('phone', `%${d}%`);
  else if (s) q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
  const { data, error } = await q.order('name').limit(8);
  if (my !== custSeq) return;
  custItems = [{ walkin: true }, ...(data || [])];
  $('custList').innerHTML = custItems.map((c, i) => c.walkin
    ? `<button type="button" data-ci="${i}" class="walkin">${I.user}<span><b>Walk-in Customer</b><small>No account · pay now</small></span></button>`
    : `<button type="button" data-ci="${i}"><span class="pos-avatar">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</span><span><b>${esc(c.name)}</b><small>${esc(c.phone)}${Number(c.credit_limit) > 0 ? ` · credit limit ${inr(c.credit_limit)}` : ''}</small></span></button>`).join('')
    + (error ? `<p class="pos-combo-empty">${esc(friendly(error))}</p>` : (data || []).length ? '' : `<p class="pos-combo-empty">${s ? 'No customer matches. Use “Add” to create one.' : 'No customers yet.'}</p>`);
  $('custList').hidden = false;
  custActive = custItems.length > 1 && s ? 1 : 0;
  paintCustList();
}
function pickCustomer(i) {
  const c = custItems[i];
  closeCustList();
  if (!c) return;
  setCust(c.walkin ? null : c);
}
$('custInput').addEventListener('focus', () => { if (!cust) searchCustomers(''); else $('custInput').select(); });
$('custInput').addEventListener('input', () => {
  clearTimeout(custTimer);
  custTimer = setTimeout(() => searchCustomers($('custInput').value), 220);
});
$('custInput').addEventListener('keydown', e => {
  if ($('custList').hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); custActive = Math.min(custItems.length - 1, custActive + 1); paintCustList(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); custActive = Math.max(0, custActive - 1); paintCustList(); }
  else if (e.key === 'Enter') { e.preventDefault(); pickCustomer(custActive); }
  else if (e.key === 'Escape') { closeCustList(); renderCust(); }
});
$('custInput').addEventListener('blur', () => setTimeout(() => { if (!$('cust').contains(document.activeElement)) { closeCustList(); renderCust(); } }, 180));
$('custToggle').onclick = () => { if ($('custList').hidden) { $('custInput').focus(); searchCustomers(''); } else closeCustList(); };
$('custList').addEventListener('mousedown', e => e.preventDefault());
$('custList').onclick = e => { const b = e.target.closest('[data-ci]'); if (b) pickCustomer(+b.dataset.ci); };

// Add customer (same insert the old billing screen used; RLS applies)
$('custAdd').onclick = () => {
  $('ncName').value = '';
  const typed = $('custInput').value.trim();
  $('ncPhone').value = !cust && /\d{6,}/.test(typed) ? typed.replace(/\D/g, '') : '';
  if (!cust && typed && !/\d{6,}/.test(typed)) $('ncName').value = typed;
  $('ncAddress').value = '';
  $('ncMsg').textContent = '';
  $('custDlg').showModal();
  ($('ncName').value ? $('ncPhone') : $('ncName')).focus();
};
$('ncCancel').onclick = () => $('custDlg').close();
$('custForm').onsubmit = async e => {
  e.preventDefault();
  const name = $('ncName').value.trim();
  const d = digits10($('ncPhone').value);
  if (!name) return ($('ncMsg').textContent = 'Enter the customer name.');
  if (!d) return ($('ncMsg').textContent = 'Enter a 10-digit mobile number.');
  $('ncSave').disabled = true;
  const { data: existing } = await sb.from('customers').select('id,name,phone,consent,credit_limit,active').eq('branch_id', prof.branch_id).ilike('phone', '%' + d).limit(1);
  if (existing?.length) {
    $('ncSave').disabled = false;
    if (!existing[0].active) return ($('ncMsg').textContent = 'A customer with this number exists but is inactive.');
    $('custDlg').close();
    await setCust(existing[0]);
    return note(`${existing[0].name} already has this number — selected the existing customer.`);
  }
  const row = { branch_id: prof.branch_id, name, phone: d };
  if ($('ncAddress').value.trim()) row.address = $('ncAddress').value.trim();
  const { data: c, error } = await sb.from('customers').insert(row).select('id,name,phone,consent,credit_limit').single();
  $('ncSave').disabled = false;
  if (error) return ($('ncMsg').textContent = friendly(error));
  $('custDlg').close();
  await setCust(c);
  note(`Customer ${c.name} added and selected.`);
};

// ============================================================================
// Prescription (patient details are saved on the bill; the file is attached to
// the customer's record after the bill is saved)
// ============================================================================
const RX_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
function openRx(open = true) {
  $('rxPanel').hidden = !open;
  $('rxToggle').setAttribute('aria-expanded', String(open));
  $('rxToggle').classList.toggle('open', open);
}
$('rxToggle').onclick = () => openRx($('rxPanel').hidden);
function renderRxFile() {
  $('rxUploadBtn').classList.toggle('has-file', !!rxFile);
  $('rxUploadBtn').querySelector('span').textContent = rxFile ? 'Change' : 'Upload';
  $('rxFileInfo').innerHTML = rxFile
    ? `<span class="pos-file">${I.clip}<b>${esc(rxFile.name)}</b><small>${(rxFile.size / 1024).toFixed(0)} KB · ${cust ? 'saved to the customer after billing' : 'select a customer to save it'}</small><button type="button" class="pos-text-btn" id="rxRemove">Remove</button></span>`
    : '<small class="pos-muted">Attach a photo or PDF of the prescription (PDF, JPG, PNG or WEBP, up to 15 MB). It is saved to the selected customer after the bill is generated.</small>';
  const r = $('rxRemove');
  if (r) r.onclick = () => { rxFile = null; $('rxFile').value = ''; renderRxFile(); };
}
$('rxFile').onchange = () => {
  const f = $('rxFile').files[0];
  if (!f) return;
  if (!RX_TYPES.includes(f.type) || f.size > 15 * 1024 * 1024) {
    $('rxFile').value = '';
    return note('Choose a PDF, JPG, PNG or WEBP file up to 15 MB.', true);
  }
  rxFile = f;
  openRx(true);
  renderRxFile();
  if (!cust) note('Prescription attached. Select or add a customer so it can be saved with their record.');
};
async function uploadPrescription(invoiceId) {
  if (!rxFile || !cust) return '';
  const f = rxFile;
  const ext = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/jpeg' ? 'jpg' : f.type.split('/')[1];
  const path = `${prof.branch_id}/${invoiceId}/${crypto.randomUUID()}.${ext}`;
  const up = await sb.storage.from('customer-doctor-sheets').upload(path, f, { contentType: f.type, upsert: false });
  if (up.error) return `Prescription not saved: ${friendly(up.error)}`;
  const ins = await sb.from('customer_doctor_sheets').insert({
    branch_id: prof.branch_id, customer_id: cust.id, invoice_id: invoiceId,
    file_name: f.name, mime_type: f.type, file_size: f.size, storage_path: path
  });
  if (ins.error) {
    await sb.storage.from('customer-doctor-sheets').remove([path]);
    return `Prescription not saved: ${friendly(ins.error)}`;
  }
  return 'Prescription saved to the customer record.';
}

// Notes (stored in the bill's diagnosis / notes field)
function openNotes(open = true) {
  $('diagnosis').hidden = !open;
  $('notesToggle').setAttribute('aria-expanded', String(open));
  $('notesBox').classList.toggle('open', open);
  if (open) $('diagnosis').focus();
}
$('notesToggle').onclick = () => openNotes($('diagnosis').hidden);

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
    gstRates: null,
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
  else if (a.manual) bits.push(`<span class="fefo-status ok">${fmtQty(a.allocated)} from ${a.rows.length} batch${a.rows.length === 1 ? '' : 'es'}${a.manual ? ' (manual override)' : ' (FEFO)'}</span>`);
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

// Discount presets offered in the per-medicine dropdown (never above the branch limit).
function discOptions(current, defaultPct) {
  const max = Math.max(Number(cfg.max_discount_pct) || 0, defaultPct || 0);
  const set = new Set([0, 2, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50].filter(v => v <= max));
  if (Number.isFinite(defaultPct)) set.add(defaultPct);
  if (Number.isFinite(current)) set.add(current);
  return [...set].sort((a, b) => a - b);
}

function renderCartRows() {
  let sl = 0;
  const html = groups.map(g => {
    const t = groupTotals(g);
    const rows = g.alloc?.rows || [];
    const multi = rows.length > 1;
    const open = multi || expanded.has(g.key);
    const canOverride = perm.batch_override && g.alloc && (g.alloc.candidates || []).length > 0;
    const defaultPct = rows.length ? Number(rows[0].default_discount_pct || 0) : 0;
    const groupDisc = g.discountPct == null ? defaultPct : g.discountPct;
    const first = rows[0];
    const fv = first ? rowValues(g, first) : null;
    const amt = rows.length ? Number(rows[0].discount_amount || 0) : 0;
    const dLabel = v => (v === defaultPct && amt > 0) ? `₹${+amt.toFixed(2)}` : `${+Number(v).toFixed(2)}%`;
    const discSel = `<select class="pos-disc-sel" aria-label="Discount for ${esc(g.name)}" data-gdisc="${esc(g.key)}" ${perm.discount ? '' : 'disabled title="Discount set on the medicine"'}>
        ${discOptions(Number.isFinite(groupDisc) ? groupDisc : NaN, defaultPct).map(v => `<option value="${v}" ${v === groupDisc ? 'selected' : ''}>${dLabel(v)}</option>`).join('')}
        ${perm.discount ? '<option value="custom">Custom…</option>' : ''}</select>`;
    const sub = [g.manufacturer, g.form].filter(Boolean).map(esc).join(' • ');
    const batchCell = !rows.length ? '<span class="pos-muted">—</span>'
      : multi ? `<button type="button" class="pos-batches" data-toggle="${esc(g.key)}" aria-expanded="true">${rows.length} batches</button>`
      : `<button type="button" class="pos-batch-link" data-toggle="${esc(g.key)}" aria-expanded="${open}" title="Show batch details">${esc(first.batch_no)}</button>`;
    const head = `<tr class="group-row${g.need_doctor_sheet ? ' requires-prescription' : ''}${t.errors ? ' has-error' : ''}" data-group="${esc(g.key)}">
      <td class="c-no">${++sl}</td>
      <td class="c-med"><div class="pos-med">${g.photo ? `<img class="pos-thumb" src="${esc(g.photo)}" alt="" loading="lazy">` : pillThumb(g.name)}
        <div class="pos-med-text"><strong>${esc(g.name)}${g.strength ? ` ${esc(g.strength)}` : ''}</strong>
          <small>${sub || (g.shelf_location ? `Shelf ${esc(g.shelf_location)}` : '&nbsp;')}${g.need_doctor_sheet ? ' <b class="rx-tag">Rx</b>' : ''}</small>
          <span class="pos-mobile-meta">${first ? `${esc(first.batch_no)}${multi ? ` +${rows.length - 1}` : ''} • ${dateShort(first.expiry)}${(first.shelf || g.shelf_location) ? ` • Shelf ${esc(first.shelf || g.shelf_location)}` : ''} • GST ${+fv.gstPct}%` : ''}</span>
          <div class="fefo-status-line">${statusText(g)}</div>
          <span class="pos-row-links">${canOverride ? `<button type="button" class="link-btn" data-override="${esc(g.key)}" title="Manually choose batches">Choose batches</button>` : ''}<button type="button" class="link-btn" data-explain="${esc(g.key)}" title="Explain allocation">Why?</button></span>
        </div></div></td>
      <td class="c-shelf">${esc((first && first.shelf) || g.shelf_location || '—')}</td>
      <td class="c-batch">${batchCell}</td>
      <td class="c-exp">${first ? dateShort(first.expiry) : '—'}${first?.near_expiry && !multi ? ' <span class="badge warn" title="Near expiry">!</span>' : ''}</td>
      <td class="c-r c-mrp">${fv ? (multi && rows.some(r => rowValues(g, r).mrp !== fv.mrp) ? '<span class="pos-muted">varies</span>' : money(fv.mrp)) : '—'}</td>
      <td class="c-c c-qty"><div class="pos-stepper"><button type="button" data-qminus="${esc(g.key)}" aria-label="Decrease quantity of ${esc(g.name)}">${I.minus}</button><input aria-label="Requested quantity for ${esc(g.name)}" type="number" min="1" step="1" inputmode="numeric" value="${g.requestedQty}" data-gqty="${esc(g.key)}" class="qty-input"><button type="button" data-qplus="${esc(g.key)}" aria-label="Increase quantity of ${esc(g.name)}">${I.plus}</button></div></td>
      <td class="c-c c-gst">${fv ? (multi && rows.some(r => rowValues(g, r).gstPct !== fv.gstPct) ? '<span class="pos-muted">varies</span>' : `${+fv.gstPct}%`) : '—'}</td>
      <td class="c-c c-disc">${discSel}</td>
      <td class="c-r c-amt"><strong class="g-total" data-gtotal="${esc(g.key)}">${t.errors ? '—' : money(t.total)}</strong></td>
      <td class="c-x"><button class="remove-item pos-del" aria-label="Remove ${esc(g.name)}" title="Remove" data-gremove="${esc(g.key)}">${I.trash}</button></td>
    </tr>`;
    const body = rows.map(r => {
      const v = rowValues(g, r);
      const id = `${g.key}|${r.batch_id}`;
      const near = r.near_expiry ? `<span class="badge warn" title="Expires in ${r.days_to_expiry} day(s)">Near expiry</span>` : '';
      const man = r.manual ? '<span class="badge info">Manual</span>' : '';
      const mrpCell = perm.mrp_edit
        ? `<input type="number" min="0" step="0.01" value="${v.mrp}" data-field="mrp" data-row="${esc(id)}" class="money-input" aria-label="MRP for batch ${esc(r.batch_no)}">`
        : money(v.mrp);
      const discCell = perm.discount
        ? `<input type="number" min="0" max="100" step="0.01" value="${v.discountPct}" data-field="discountPct" data-row="${esc(id)}" class="pct-input" aria-label="Discount % for batch ${esc(r.batch_no)}">`
        : `${v.discountPct}%`;
      const rates = [...new Set([...cfg.gst_rates, v.gstPct, v.defaultGstPct])].sort((a, b) => a - b);
      void rates;   // GST is shown as entered on the purchase / opening stock (not edited here)
      const gstCell = `${v.gstPct}%`;
      return `<tr class="batch-row${open ? '' : ' collapsed'}${v.errors.length ? ' has-error' : ''}" data-rowid="${esc(id)}" data-parent="${esc(g.key)}">
        <td></td>
        <td class="batch-cell" colspan="3">↳ ${esc(r.batch_no)} ${man}${near}<small class="table-subtext">GST ${gstCell} ${v.includes ? 'incl.' : 'extra'} · Disc ₹<span data-c="disc">${v.calc ? money(v.calc.discount) : '—'}</span> · GST ₹<span data-c="gst">${v.calc ? money(v.calc.gst) : '—'}</span> · Taxable ₹<span data-c="net">${v.calc ? money(v.calc.net) : '—'}</span> · Stock ${fmtQty(r.available)}</small><div class="row-error" data-err="${esc(id)}">${esc(v.errors.join(' '))}</div></td>
        <td class="c-exp">${dateShort(r.expiry)}</td>
        <td class="c-r">${mrpCell}</td>
        <td class="c-c"><b>${fmtQty(v.qty)}</b></td>
        <td class="c-c c-gst">${+v.gstPct}%</td>
        <td class="c-c">${discCell}</td>
        <td class="c-r" data-c="total">${v.calc ? money(v.calc.total) : '—'}</td>
        <td></td>
      </tr>`;
    }).join('');
    return head + body;
  }).join('');
  $('cart').innerHTML = html || `<tr class="pos-empty-row"><td colspan="11"><div class="pos-empty">${I.cart}<b>Your bill is empty</b><span>Search above or scan a barcode to add medicines.</span></div></td></tr>`;
  $('itemCount').textContent = `(${groups.length})`;
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
      tr.querySelector('[data-c="disc"]').textContent = v.calc ? money(v.calc.discount) : '—';
      tr.querySelector('[data-c="gst"]').textContent = v.calc ? money(v.calc.gst) : '—';
      tr.querySelector('[data-c="net"]').textContent = v.calc ? money(v.calc.net) : '—';
      tr.querySelector('[data-c="total"]').textContent = v.calc ? money(v.calc.total) : '—';
      tr.querySelector('.row-error').textContent = v.errors.join(' ');
      tr.classList.toggle('has-error', v.errors.length > 0);
      if (v.errors.length) { tr.classList.remove('collapsed'); expanded.add(g.key); }
    }
    const gt = $('cart').querySelector(`[data-gtotal="${CSS.escape(g.key)}"]`);
    if (gt) {
      const t = groupTotals(g);
      gt.textContent = t.errors ? '—' : money(t.total);
      gt.closest('tr').classList.toggle('has-error', t.errors);
    }
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
    if (Number(data.shortage) > 0) { note(`${g.name}: requested ${fmtQty(data.requested)}, only ${fmtQty(data.available_total)} eligible in stock. Short by ${fmtQty(data.shortage)} — reduce the quantity to finalize.`, true); stockAlert(g, data); }
    else note(explainAllocation(g.name, data));
  }
  renderCart();
}

// Quantity above the stock of all batches together: a clear alert with "Use available".
function stockAlert(g, data) {
  let d = $('stockAlert');
  if (!d) { d = document.createElement('dialog'); d.id = 'stockAlert'; d.className = 'pos-dialog pos-stock-alert'; document.body.appendChild(d); }
  const avail = Number(data.available_total) || 0;
  d.innerHTML = `<div class="psa-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 21h20Z"/><path d="M12 10v5M12 18h.01"/></svg></div><h3>Not enough stock</h3>
    <p><b>${esc(g.name)}${g.strength ? ' ' + esc(g.strength) : ''}</b>: you entered <b>${fmtQty(data.requested)}</b>, but only <b>${fmtQty(avail)}</b> ${avail === 1 ? 'is' : 'are'} in stock across all batches.</p>
    <div class="pos-dialog-foot">${avail > 0 ? `<button type="button" class="pos-btn pos-btn-solid" id="psaUse">Use ${fmtQty(avail)}</button>` : `<button type="button" class="pos-btn pos-btn-red" id="psaRemove">Remove item</button>`}<button type="button" class="pos-btn" id="psaClose">OK</button></div>`;
  d.querySelector('#psaClose').onclick = () => d.close();
  const use = d.querySelector('#psaUse'); if (use) use.onclick = () => { d.close(); g.requestedQty = avail; allocate(g); };
  const rm = d.querySelector('#psaRemove'); if (rm) rm.onclick = () => { d.close(); removeGroup(g.key); };
  if (!d.open) d.showModal();
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
    enrichGroup(g);
  }
  if (extra.discountPct != null) g.discountPct = extra.discountPct;
  await allocate(g);
  if (!extra.silent) $('cart').querySelector(`tr[data-group="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
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


// ---- medicine details for the item rows (manufacturer, form, primary photo)
const photoCache = new Map();
async function enrichGroup(g) {
  try {
    const { data: m } = await sb.from('medicines').select('manufacturer_id,dosage_form,brand').eq('branch_id', prof.branch_id).eq('id', g.medicine_id).maybeSingle();
    if (m) {
      g.form = m.dosage_form || '';
      if (m.manufacturer_id) {
        const { data: mf } = await sb.from('manufacturers').select('name').eq('id', m.manufacturer_id).maybeSingle();
        g.manufacturer = mf?.name || m.brand || '';
      } else g.manufacturer = m.brand || '';
    }
    if (!photoCache.has(g.medicine_id)) {
      let url = null;
      const { data: imgs } = await sb.from('medicine_images').select('path,is_primary,sort_order').eq('branch_id', prof.branch_id).eq('medicine_id', g.medicine_id).order('sort_order').limit(5);
      const img = (imgs || []).find(i => i.is_primary) || (imgs || [])[0];
      if (img) {
        const { data: s } = await sb.storage.from('medicine-images').createSignedUrl(img.path, 3600);
        url = s?.signedUrl && /^https?:|^blob:/.test(s.signedUrl) ? s.signedUrl : null;
      }
      photoCache.set(g.medicine_id, url);
    }
    g.photo = photoCache.get(g.medicine_id);
  } catch (err) {
    console.warn('Medicine details unavailable:', err);
  }
  if (groups.includes(g)) renderCart();
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
    let raw = t.value;
    if (raw === 'custom') {
      const before = t.dataset.before ?? String(g.discountPct ?? '');
      const ans = prompt(`Discount % for ${g.name} (0 – ${cfg.max_discount_pct})`, before === 'custom' ? '' : before);
      if (ans == null || ans.trim() === '' || !Number.isFinite(Number(ans))) { renderCart(); return; }
      raw = String(Number(ans));
    }
    const v = num(raw);
    g.discountPct = Number.isFinite(v) ? v : NaN;
    // Medicine-level discount overrides per-batch discount edits.
    for (const [, e2] of g.edits) delete e2.discountPct;
    $('cart').querySelectorAll(`[data-row^="${CSS.escape(g.key)}|"][data-field="discountPct"]`).forEach(inp => { inp.value = raw; });
    if (t.value === 'custom') { auditEdit('discountPct', g, '(all batches)', t.dataset.before, raw); renderCart(); }
    else paintNumbers();
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
    if (g && t.value !== 'custom' && t.dataset.before !== t.value) auditEdit('discountPct', g, '(all batches)', t.dataset.before, t.value);
    t.dataset.before = t.value;
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
  if (t.dataset.qminus || t.dataset.qplus) {
    const g = findGroup(t.dataset.qminus || t.dataset.qplus);
    if (!g) return;
    const next = g.requestedQty + (t.dataset.qplus ? 1 : -1);
    if (next < 1) return removeGroup(g.key);
    g.requestedQty = next;
    const input = $('cart').querySelector(`[data-gqty="${CSS.escape(g.key)}"]`);
    if (input) input.value = next;
    scheduleAllocate(g, 300);
    return;
  }
  if (t.dataset.toggle) {
    const g = findGroup(t.dataset.toggle);
    if (!g || (g.alloc?.rows || []).length > 1) return;
    if (expanded.has(g.key)) expanded.delete(g.key); else expanded.add(g.key);
    renderCart();
    return;
  }
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


// ---- medicine search (name, brand or barcode; Enter adds; scanners type + Enter)
let t;
let results = [], resActive = -1;
async function findMedicines(term) {
  const s = safeQ(term);
  const { data, error } = await sb.from('medicines')
    .select('id,name,strength,barcode,brand,mrp,selling_price,shelf_location,tax_rate,need_doctor_sheet,dosage_form')
    .eq('branch_id', prof.branch_id)
    .eq('active', true)
    .or(`name.ilike.%${s}%,brand.ilike.%${s}%,barcode.eq.${s}`)
    .order('name')
    .limit(8);
  if (error) throw error;
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
    if (stockError) console.warn('Could not load medicine search stock:', stockError);
    else (batches || []).forEach(batch => stockByMedicine.set(batch.medicine_id, (stockByMedicine.get(batch.medicine_id) || 0) + Number(batch.qty || 0)));
  }
  medicines.forEach(m => { m.available_stock = stockByMedicine.get(m.id) || 0; });
  return medicines;
}
function closeResults() { $('res').innerHTML = ''; $('res').classList.remove('open'); results = []; resActive = -1; }
function paintResults() { $('res').querySelectorAll('.medicine-result').forEach((b, i) => b.classList.toggle('active', i === resActive)); }
function addFromSearch(m) {
  addMedicine(m);
  $('q').value = '';
  closeResults();
}
async function runSearch(fromEnter = false) {
  const raw = $('q').value.trim();
  const s = safeQ(raw);
  if (s.length < 2) { closeResults(); return; }
  let medicines;
  try { medicines = await findMedicines(raw); } catch (error) { $('res').textContent = friendly(error); $('res').classList.add('open'); return; }
  if (safeQ($('q').value.trim()) !== s) return;  // user kept typing
  const exact = medicines.filter(m => m.barcode && m.barcode === s);
  if (exact.length === 1) { addFromSearch(exact[0]); return; }
  if (fromEnter && medicines.length === 1) { addFromSearch(medicines[0]); return; }
  results = medicines;
  resActive = medicines.length ? 0 : -1;
  $('res').classList.add('open');
  $('res').innerHTML = medicines.map((m, i) => {
    const prescription = m.need_doctor_sheet === true;
    const warning = prescription ? '<span class="medicine-result-warning">Rx</span>' : '';
    const out = m.available_stock <= 0;
    const stock = `<span class="medicine-result-stock${out ? ' out' : ''}">${out ? 'No eligible stock' : `Stock: ${Number(m.available_stock).toLocaleString('en-IN')}`}</span>`;
    return `<button class="medicine-result${prescription ? ' requires-prescription' : ''}" type="button" role="option" data-i="${i}">
      ${pillThumb(m.name)}
      <span class="medicine-result-main"><strong>${esc(m.name)} ${esc(m.strength || '')}</strong>
      <span class="medicine-result-meta">MRP ${inr(m.mrp)} · GST ${Number(m.tax_rate)}%${m.dosage_form ? ` · ${esc(m.dosage_form)}` : ''} · Shelf ${esc(m.shelf_location || '—')}</span></span>
      <span class="medicine-result-side">${warning}${stock}</span>
    </button>`;
  }).join('') || '<div class="pos-res-empty">No matching medicine.</div>';
  paintResults();
}
$('q').oninput = () => {
  clearTimeout(t);
  t = setTimeout(() => runSearch(false), 250);
};
$('q').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); resActive = (resActive + 1) % results.length; paintResults(); }
  else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); resActive = (resActive - 1 + results.length) % results.length; paintResults(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(t);
    if (results.length && resActive >= 0 && $('res').classList.contains('open')) addFromSearch(results[resActive]);
    else runSearch(true);
  } else if (e.key === 'Escape') closeResults();
});
$('res').addEventListener('mousedown', e => e.preventDefault());
$('res').onclick = e => {
  const b = e.target.closest('.medicine-result');
  if (b) addFromSearch(results[+b.dataset.i]);
};
document.addEventListener('click', e => { if (!$('searchWrap').contains(e.target)) $('res').classList.remove('open'); });
$('q').addEventListener('focus', () => { if (results.length) $('res').classList.add('open'); });

$('addMed').onclick = () => { $('q').focus(); $('q').scrollIntoView({ block: 'center', behavior: 'smooth' }); };
$('scanMode').onclick = () => {
  $('q').value = '';
  $('q').focus();
  $('searchWrap').classList.add('scan-ready');
  $('q').placeholder = 'Ready — scan the barcode now…';
  note('Scanner ready: scan a barcode and the medicine is added automatically.');
};
$('q').addEventListener('blur', () => { $('searchWrap').classList.remove('scan-ready'); $('q').placeholder = 'Search medicine by name, brand, or barcode...'; });

// Camera scanning where the browser supports it (Chrome on Android, Edge, Chrome desktop)
let camStream = null, camLoop = 0;
async function stopCamera() {
  cancelAnimationFrame(camLoop);
  camStream?.getTracks().forEach(tr => tr.stop());
  camStream = null;
}
$('camClose').onclick = () => { stopCamera(); $('camDlg').close(); };
$('camDlg').addEventListener('close', stopCamera);
$('camScan').onclick = async () => {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    return note('Camera scanning is not supported in this browser. Use a USB/Bluetooth scanner with “Scan Barcode”, or type the barcode.', true);
  }
  $('camMsg').textContent = 'Point the camera at the barcode.';
  $('camDlg').showModal();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('camVideo');
    v.srcObject = camStream;
    await v.play();
    const det = new window.BarcodeDetector();
    const tick = async () => {
      if (!camStream) return;
      try {
        const codes = await det.detect(v);
        if (codes.length) {
          const code = codes[0].rawValue;
          await stopCamera();
          $('camDlg').close();
          $('q').value = code;
          return runSearch(true);
        }
      } catch { /* frame not ready */ }
      camLoop = requestAnimationFrame(tick);
    };
    tick();
  } catch (err) {
    $('camMsg').textContent = `Camera unavailable: ${err.message || err}`;
  }
};

// ============================================================================
// Payment method
// ============================================================================
const MODE_LABEL = { cash: 'Cash', card: 'Card', upi: 'UPI', wallet: 'Wallet', credit: 'Credit', split: 'Split payment' };
function setPayMode(mode) {
  if (mode === 'credit' && !cust) {
    note('Select or add a customer to bill on credit.', true);
    $('custInput').focus();
    return;
  }
  const prev = payMode;
  payMode = mode;
  if (mode === 'split') {
    if (prev !== 'split') {
      const first = ['cash', 'upi', 'card'].includes(prev) ? prev : prev === 'wallet' ? 'upi' : 'cash';
      const tot = total();
      pays = [{ method: first, amount: tot ? String(tot) : '' }];
    }
  } else if (mode === 'credit') {
    pays = [];
  } else {
    const keep = pays.length === 1 && pays[0].amount !== '' ? pays[0].amount : '';
    pays = [{ method: mode === 'wallet' ? 'upi' : mode, amount: prev === 'split' || prev === 'credit' ? '' : keep }];
  }
  renderPays();
}
$('view').querySelector('.pos-methods').onclick = e => { const b = e.target.closest('[data-method]'); if (b) setPayMode(b.dataset.method); };

function renderPays() {
  document.querySelectorAll('.pos-method').forEach(b => {
    const on = b.dataset.method === payMode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    if (b.dataset.method === 'credit') b.classList.toggle('needs-cust', !cust);
  });
  const ms = SPLIT_MS;
  $('addp').hidden = payMode !== 'split';
  if (payMode === 'split') {
    $('pays').innerHTML = pays.map((p, i) => `<div class="pos-split-row"><select data-m="${i}" aria-label="Payment method ${i + 1}">${ms.map(m => `<option value="${m}" ${m === p.method ? 'selected' : ''}>${m.toUpperCase()}</option>`).join('')}</select>
      <input type="number" min="0" step="0.01" data-a="${i}" value="${p.amount}" placeholder="Amount" aria-label="Amount ${i + 1}"><button type="button" class="pos-icon-btn" data-r="${i}" aria-label="Remove payment ${i + 1}" ${pays.length === 1 ? 'disabled' : ''}>${I.close}</button></div>`).join('');
  } else if (payMode === 'credit') {
    $('pays').innerHTML = '';
  } else {
    $('pays').innerHTML = `<label class="pos-paid"><span>${payMode === 'cash' ? 'Amount paid in cash' : `Amount paid by ${MODE_LABEL[payMode]}`}</span>
      <input type="number" min="0" step="0.01" data-a="0" value="${pays[0]?.amount ?? ''}" placeholder="Full amount" inputmode="decimal"></label>`;
  }
  renderPayDetail();
  updateTot();
}
function renderPayDetail() {
  const el = $('payDetail');
  if (payMode === 'cash') {
    el.innerHTML = `<label class="pos-paid"><span>Cash received from customer</span><input id="cashGiven" type="number" min="0" step="0.01" inputmode="decimal" placeholder="For change calculation" value="${esc(cashReceived)}"></label><div class="pos-change" id="changeOut"></div>`;
    $('cashGiven').oninput = e => { cashReceived = e.target.value; paintChange(); };
  } else if (payMode === 'credit') {
    el.innerHTML = `<p class="pos-pay-note">${cust ? `The full bill is added to <b>${esc(cust.name)}</b>'s account. Credit available: <b>${inr(avail)}</b>.` : 'Select a customer to bill on credit.'}</p>`;
  } else if (payMode === 'wallet') {
    el.innerHTML = '<p class="pos-pay-note">Wallet payments (Paytm, PhonePe, Amazon Pay…) are recorded under UPI in the accounts.</p>';
  } else if (payMode === 'split') {
    el.innerHTML = '<p class="pos-pay-note">Split the bill across Cash, UPI and Card. Any unpaid balance goes to the selected customer\'s credit account.</p>';
  } else el.innerHTML = '';
}
function paintChange() {
  const out = $('changeOut');
  if (!out) return;
  const due = paidSum();
  const given = Number(cashReceived);
  if (!cashReceived || !Number.isFinite(given)) { out.textContent = ''; out.className = 'pos-change'; return; }
  const diff = Math.round((given - due) * 100) / 100;
  out.className = `pos-change ${diff < 0 ? 'short' : 'ok'}`;
  out.innerHTML = diff >= 0 ? `Return change: <b>${inr(diff)}</b>` : `Short by <b>${inr(-diff)}</b>`;
}

function paidSum() {
  if (payMode === 'credit') return 0;
  return pays.length === 1 && pays[0].amount === ''
    ? total()
    : Math.round(pays.reduce((s, p) => s + (+p.amount || 0), 0) * 100) / 100;
}

function updateTot() {
  const b = computeBill();
  $('totalItems').textContent = fmtQty(groups.length);
  $('totalItems').title = `${b.batchLines} batch line(s)`;
  $('totalQty').textContent = fmtQty(b.qty);
  $('sumBase').textContent = inr(b.base);
  $('sumDisc').textContent = `- ${inr(Math.round((b.lineDiscount + b.billDiscount) * 100) / 100)}`;
  $('sumDisc').title = `Line discounts ${inr(b.lineDiscount)} + bill discount ${inr(b.billDiscount)}`;
  $('sumTaxable').textContent = inr(b.taxable);
  $('sumGst').textContent = inr(b.gst);
  $('sumSub').textContent = inr(b.subtotal);
  const rates = new Set(), incl = new Set();
  for (const g of groups) for (const r of g.alloc?.rows || []) { const v = rowValues(g, r); rates.add(v.gstPct); incl.add(v.includes); }
  $('gstLabel').textContent = `GST${rates.size === 1 ? ` (${[...rates][0]}%)` : ''}${incl.size === 1 && incl.has(true) ? ' incl.' : ''}`;
  $('disc').classList.toggle('invalid', b.billDiscountExceeds);
  $('discHint').textContent = b.billDiscountExceeds ? 'Bill discount is more than the bill amount.' : `Bill amount before this discount: ${inr(b.subtotal)}`;
  $('tot').textContent = b.invalid ? 'Fix errors' : inr(b.grandTotal);
  $('payLabel').textContent = b.invalid ? 'Fix errors to generate bill' : `Generate Bill (${inr(b.grandTotal)})`;
  const r = Math.round((b.grandTotal - paidSum()) * 100) / 100;
  $('rem').textContent = !groups.length || r === 0 ? '' : r > 0 ? (cust ? `On ${cust.name}'s credit: ${inr(r)}${r > avail ? ` — exceeds available credit ${inr(avail)}` : ''}` : `Remaining: ${inr(r)} — select a customer for credit`) : `Over by ${inr(-r)}`;
  $('rem').classList.toggle('bad', r < 0 || (r > 0 && (!cust || r > avail)));
  paintChange();
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
  const b = e.target.closest('[data-r]');
  const r = b?.dataset.r;
  if (r !== undefined && pays.length > 1) {
    pays.splice(+r, 1);
    renderPays();
  }
};

$('addp').onclick = () => {
  if (pays.length === 1 && pays[0].amount === '') pays[0].amount = total();
  const rest = Math.max(0, Math.round((total() - paidSum()) * 100) / 100);
  const used = new Set(pays.map(p => p.method));
  pays.push({ method: SPLIT_MS.find(m => !used.has(m)) || SPLIT_MS[0], amount: rest || '' });
  renderPays();
};

// ---- bill discount (pencil / Apply Offer)
function openDiscount() {
  if (!perm.discount) return note('You do not have permission to apply discounts.', true);
  const open = $('discBox').hidden;
  $('discBox').hidden = !open;
  $('discEdit').setAttribute('aria-expanded', String(open));
  if (open) { $('disc').focus(); $('disc').select(); }
}
$('discEdit').onclick = openDiscount;
$('disc').oninput = updateTot;
let discBefore = '0';
$('disc').addEventListener('focus', () => { discBefore = $('disc').value; });
$('disc').addEventListener('change', () => {
  if ($('disc').value !== discBefore) sb.rpc('billing_log_event', { p_cart: cartToken, p_action: 'billing_discount_change', p_before: { bill_discount: discBefore }, p_after: { bill_discount: $('disc').value } }).then(() => {});
  discBefore = $('disc').value;
});
$('discBox').querySelector('.pos-disc-quick').onclick = e => {
  const b = e.target.closest('[data-pct]');
  if (!b || !perm.discount) return;
  const pct = Number(b.dataset.pct);
  const sub = computeBill().subtotal;
  const before = $('disc').value;
  $('disc').value = pct ? (Math.floor(sub * pct) / 100).toFixed(2) : '0';
  updateTot();
  if (before !== $('disc').value) sb.rpc('billing_log_event', { p_cart: cartToken, p_action: 'billing_discount_change', p_before: { bill_discount: before }, p_after: { bill_discount: $('disc').value, preset_pct: pct } }).then(() => {});
};

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
  expanded.clear();
  if (!keepToken) await releaseAll();
  payMode = DEF_PM;
  cashReceived = '';
  pays = [{ method: DEF_PAY, amount: '' }];
  $('disc').value = 0;
  ['doctorName', 'patientName', 'patientPhone', 'patientAddress', 'diagnosis'].forEach(id => { if ($(id)) $(id).value = ''; });
  rxFile = null;
  $('rxFile').value = '';
  renderRxFile();
  openNotes(false);
  setCust(null);
  renderCart();
}

async function clearCart() {
  if (groups.length) sb.rpc('billing_log_event', { p_cart: cartToken, p_action: 'billing_bill_cleared', p_before: { medicines: groups.map(g => ({ name: g.name, qty: g.requestedQty })) }, p_after: null }).then(() => {});
  await reset();
  note('Bill cleared. Reserved stock released.');
}
$('clear').onclick = clearCart;

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


// Opens the printable invoice (preview, thermal, A4, PDF) for a saved bill.
async function openInvoice(invoiceId, waStatus = '') {
  const det = await sb.rpc('invoice_detail', { p_invoice: invoiceId });
  if (det.error) { note('The invoice could not be loaded: ' + friendly(det.error), true); return false; }

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
  if (!branch) note('Pharmacy profile could not be loaded; using the default pharmacy name.', true);
  showInvoice(det.data, undefined, { whatsapp: (d, say) => sendInvoice(sb, invoiceId, d, say), status: waStatus.trim() });
  return true;
}

$('pay').onclick = async () => {
  if (!groups.length) return note('Cart is empty.', true);
  const problems = blockingProblems();
  if (problems.length) return note(`Cannot finalize — ${problems.join('; ')}.`, true);

  const bill = computeBill();
  const grand = bill.grandTotal;
  const rows = (payMode === 'credit' ? [] : pays).map(p => ({
    method: p.method,
    amount: pays.length === 1 && p.amount === '' ? grand : +p.amount
  })).filter(p => p.amount > 0);

  const cashPaid = paidSum();
  const due = Math.round((grand - cashPaid) * 100) / 100;
  if (due < 0) return note('Payments cannot exceed the bill total.', true);
  if (due > 0 && !cust) return note('Select a customer before leaving an unpaid balance.', true);
  if (due > avail) return note(`Customer credit limit exceeded. Available: ${inr(avail)}.`, true);
  if (rxFile && !cust && !confirm('The prescription file can only be saved for a selected customer. Generate the bill without saving the file?')) return;

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
  const waNote = await afterBill(sb, data);   // invoice on WhatsApp (0030): prepared and opened while the click is still fresh
  const rxNote = await uploadPrescription(data);
  const changeNote = payMode === 'cash' && Number(cashReceived) > grand ? ` Return change ${inr(Math.round((Number(cashReceived) - cashPaid) * 100) / 100)}.` : '';
  lastInvoiceId = data;
  await reset({ keepToken: true });
  note(`${due > 0 ? `Bill saved. Customer balance added: ${inr(due)}.` : 'Bill saved.'}${changeNote}${rxNote ? ` ${rxNote}` : ''}${waNote}`, /not saved/.test(rxNote));
  await openInvoice(data, waNote);
};

// ---- hold / resume (held bills do not reserve stock; they re-allocate FEFO on resume)
async function refreshHeldCount() {
  const { data } = await sb.from('held_bills').select('id').eq('branch_id', prof.branch_id);
  const n = (data || []).length;
  $('heldCount').textContent = n;
  $('heldCount').hidden = !n;
  heldN = n;
  refreshNotifications();
}

$('hold').onclick = async () => {
  if (!groups.length) return note('Nothing to hold.', true);

  const label = prompt('Label for this held bill (optional)') ?? null;
  if (label === null) return;

  const heldPayments = (payMode === 'credit' ? [] : pays).map(p => ({
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
  refreshHeldCount();
  note('Bill held. Reserved stock was released; batches are re-allocated by FEFO on resume.');
};

$('held').onclick = async () => {
  const { data } = await sb.from('held_bills')
    .select('id,label,cart,created_at,customer_id,payments,discount')
    .eq('branch_id', prof.branch_id)
    .order('created_at', { ascending: false });

  $('hl').innerHTML = `<h3>Held bills</h3>` + ((data || []).map(h => `<div class="pos-held"><span class="pos-held-ic">${I.bookmark}</span><span class="pos-held-text"><b>${esc(h.label || 'Unnamed bill')}</b><small>${h.cart.filter(l => l?.type !== 'patient').length} item(s) · ${new Date(h.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span><button type="button" class="pos-btn pos-btn-solid pos-btn-sm" data-res="${h.id}">Resume</button><button type="button" class="pos-btn pos-btn-red pos-btn-sm" data-del="${h.id}">Delete</button></div>`).join('') || '<p class="pos-muted">No held bills.</p>');

  $('hl').onclick = async e => {
    const { res, del } = e.target.closest('button')?.dataset || {};

    if (del) {
      if (!confirm('Delete this held bill?')) return;
      await sb.from('held_bills').delete().eq('id', del).eq('branch_id', prof.branch_id);
      refreshHeldCount();
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
    const patient = h.cart.find(l => l && l.type === 'patient');
    setPatientDetails(patient);
    if (patient && ['doctor_name', 'patient_name', 'patient_phone', 'patient_address'].some(k => patient[k])) openRx(true);
    if (patient?.diagnosis) openNotes(true);

    pays = Array.isArray(h.payments) && h.payments.length
      ? h.payments.map(p => ({
          method: String(p.method || 'cash').toLowerCase(),
          amount: p.amount == null ? '' : String(p.amount)
        }))
      : [{ method: 'cash', amount: '' }];
    payMode = pays.length > 1 ? 'split' : (pays[0]?.method || 'cash');

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
    refreshHeldCount();
    $('hd').close();
    renderCart();

    note(dropped.length
      ? `Resumed with current FEFO stock. Needs attention: ${dropped.join(', ')}`
      : 'Bill resumed. Batches re-allocated from current stock (FEFO).', dropped.length > 0);
  };

  $('hd').showModal();
};

// ---- quick actions
let lastInvoiceId = null;
async function printLastBill() {
  let id = lastInvoiceId;
  if (!id) {
    const { data, error } = await sb.from('sales_invoices').select('id').eq('branch_id', prof.branch_id).eq('created_by', prof.user_id || prof.id).order('created_at', { ascending: false }).limit(1);
    if (error) return note(friendly(error), true);
    id = data?.[0]?.id;
  }
  if (!id) return note('You have not generated any bill yet.', true);
  note('Opening your last bill…');
  if (await openInvoice(id)) note('Last bill opened — choose Thermal or A4 and press Print.');
}

async function openBrowse() {
  $('browseQ').value = '';
  $('browseDlg').showModal();
  $('browseQ').focus();
  await loadBrowse('');
}
let browseT, browseSeq = 0;
async function loadBrowse(term) {
  const my = ++browseSeq;
  $('browseList').innerHTML = '<p class="pos-muted">Loading…</p>';
  const s = safeQ(term);
  let q = sb.from('medicines').select('id,name,strength,brand,mrp,tax_rate,shelf_location,need_doctor_sheet,dosage_form').eq('branch_id', prof.branch_id).eq('active', true);
  if (s) q = q.or(`name.ilike.%${s}%,brand.ilike.%${s}%`);
  const { data, error } = await q.order('name').limit(60);
  if (my !== browseSeq) return;
  if (error) { $('browseList').innerHTML = `<p class="pos-muted">${esc(friendly(error))}</p>`; return; }
  const meds = data || [];
  const stock = new Map();
  if (meds.length) {
    const { data: bs } = await sb.from('medicine_batches').select('medicine_id,qty').eq('branch_id', prof.branch_id).in('medicine_id', meds.map(m => m.id))
      .eq('quarantined', false).eq('stock_status', 'active').gt('qty', 0).gt('expiry', cfg.today);
    (bs || []).forEach(b => stock.set(b.medicine_id, (stock.get(b.medicine_id) || 0) + Number(b.qty || 0)));
  }
  if (my !== browseSeq) return;
  $('browseList').innerHTML = meds.map(m => {
    const st = stock.get(m.id) || 0;
    return `<button type="button" class="pos-browse-item" data-bm='${esc(JSON.stringify(m))}' ${st > 0 ? '' : 'disabled'}>${pillThumb(m.name)}<span><b>${esc(m.name)} ${esc(m.strength || '')}</b><small>MRP ${inr(m.mrp)} · ${st > 0 ? `${fmtQty(st)} in stock` : 'No eligible stock'}${m.shelf_location ? ` · Shelf ${esc(m.shelf_location)}` : ''}</small></span>${st > 0 ? `<i>${I.plus}</i>` : ''}</button>`;
  }).join('') || '<p class="pos-muted">No medicines found.</p>';
}
$('browseQ').oninput = () => { clearTimeout(browseT); browseT = setTimeout(() => loadBrowse($('browseQ').value), 220); };
$('browseClose').onclick = () => $('browseDlg').close();
$('browseList').onclick = async e => {
  const b = e.target.closest('[data-bm]');
  if (!b || b.disabled) return;
  const m = JSON.parse(b.dataset.bm);
  b.classList.add('added');
  await addMedicine(m, 1, { silent: true });
  note(`${m.name} added to the bill.`);
};

document.querySelector('.pos-qa').onclick = e => {
  const b = e.target.closest('[data-qa]');
  if (!b) return;
  const act = b.dataset.qa;
  if (act === 'browse') openBrowse();
  else if (act === 'offer') { if ($('discBox').hidden) openDiscount(); else $('disc').focus(); $('discBox').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  else if (act === 'last') printLastBill();
  else if (act === 'clear') clearCart();
};

// ---- billing settings (branch limits; admins can change them)
$('settingsBtn').onclick = async () => {
  const { data: row } = await sb.from('billing_settings').select('max_discount_pct,reservation_minutes,near_expiry_days,updated_at').eq('branch_id', prof.branch_id).maybeSingle();
  const v = row || { max_discount_pct: cfg.max_discount_pct, reservation_minutes: cfg.reservation_minutes, near_expiry_days: cfg.near_expiry_days };
  const yes = b => `<span class="pos-perm-pill ${b ? 'on' : ''}">${b ? 'Allowed' : 'Not allowed'}</span>`;
  $('setBody').innerHTML = `<h3>Billing settings</h3>
    <p class="pos-muted">These limits apply to every bill in this branch and are enforced by the server.</p>
    <form id="setForm" class="pos-set-grid">
      <div class="pos-field"><label for="setDisc">Maximum discount %</label><input id="setDisc" type="number" min="0" max="100" step="0.5" value="${Number(v.max_discount_pct)}" ${isAdmin ? '' : 'disabled'}></div>
      <div class="pos-field"><label for="setRes">Stock reservation (minutes)</label><input id="setRes" type="number" min="1" max="240" step="1" value="${Number(v.reservation_minutes)}" ${isAdmin ? '' : 'disabled'}></div>
      <div class="pos-field"><label for="setNear">Near-expiry warning (days)</label><input id="setNear" type="number" min="0" max="730" step="1" value="${Number(v.near_expiry_days)}" ${isAdmin ? '' : 'disabled'}></div>
    </form>
    <h4>Your editing permissions</h4>
    <div class="pos-perm-list"><span>Discount ${yes(perm.discount)}</span><span>GST rate ${yes(perm.gst_edit)}</span><span>MRP ${yes(perm.mrp_edit)}</span><span>Batch override ${yes(perm.batch_override)}</span></div>
    <p class="pos-muted">${isAdmin ? 'Staff permissions are managed under Staff → Permissions.' : 'Only an administrator can change these settings.'}</p>
    <p class="pos-form-msg" id="setMsg"></p>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" id="setClose">Close</button>${isAdmin ? '<button type="button" class="pos-btn pos-btn-solid" id="setSave">Save settings</button>' : ''}</div>`;
  $('setClose').onclick = () => $('setDlg').close();
  if (isAdmin) $('setSave').onclick = async () => {
    const vals = { max_discount_pct: Number($('setDisc').value), reservation_minutes: Math.round(Number($('setRes').value)), near_expiry_days: Math.round(Number($('setNear').value)) };
    if (!(vals.max_discount_pct >= 0 && vals.max_discount_pct <= 100)) return ($('setMsg').textContent = 'Maximum discount must be between 0 and 100%.');
    if (!(vals.reservation_minutes >= 1 && vals.reservation_minutes <= 240)) return ($('setMsg').textContent = 'Reservation must be 1 to 240 minutes.');
    if (!(vals.near_expiry_days >= 0 && vals.near_expiry_days <= 730)) return ($('setMsg').textContent = 'Near-expiry warning must be 0 to 730 days.');
    $('setSave').disabled = true;
    const payload = { ...vals, updated_at: new Date().toISOString(), updated_by: prof.user_id || prof.id };
    const res = row
      ? await sb.from('billing_settings').update(payload).eq('branch_id', prof.branch_id)
      : await sb.from('billing_settings').insert({ branch_id: prof.branch_id, ...payload });
    $('setSave').disabled = false;
    if (res.error) return ($('setMsg').textContent = friendly(res.error));
    sb.rpc('billing_log_event', { p_cart: cartToken, p_action: 'billing_settings_changed', p_before: row || null, p_after: vals }).then(() => {});
    await loadConfig();
    Object.assign(perm, cfg.permissions);
    $('setMsg').textContent = 'Settings saved.';
    renderCart();
    note('Billing settings saved.');
  };
  $('setDlg').showModal();
};

// ---- notification bell (page-level alerts)
function refreshNotifications() {
  const items = [];
  if (!shopIsOpen) items.push({ tone: 'warn', title: 'Shop is marked Closed', detail: 'Tap the Shop switch on Billing to open it', href: 'billing.html' });
  if (heldN) items.push({ tone: 'info', title: `${heldN} held bill(s) waiting`, detail: 'Open Hold Bills to resume', href: 'billing.html' });
  if (deliveryState === 'offline') items.push({ tone: 'info', title: 'No delivery person available', detail: 'All delivery staff are offline', href: can(prof.role, 'delivery') ? 'delivery.html' : 'billing.html' });
  setNotifications(items);
}

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
renderRxFile();
renderPays();
renderCart();
refreshHeldCount();
// ?customer=<id> (from the Customers page) starts the bill for that customer.
const startCustomer = new URLSearchParams(location.search).get('customer');
if (startCustomer) {
  const { data: sc } = await sb.from('customers').select('id,name,phone,consent,credit_limit,active').eq('branch_id', prof.branch_id).eq('id', startCustomer).maybeSingle();
  if (sc?.active) { await setCust(sc); note(`Billing ${sc.name}.`); }
}
