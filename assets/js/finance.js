// Finance Management — Pallikkal Pharmacy design.
// Tabs (kept from the existing page): Overview, Ledger, Customer dues, Supplier payables,
// Receipts & payments, Opening balances. Overview: income, expenses, net profit after the FIFO
// cost of medicines sold, profit margin, transaction history, cash flow, account balances,
// income vs expenses, expense categories, financial summary (0028_finance_management.sql).
// Opening balances: the morning opening-cash popup drives the daily cash book and Cash in Hand;
// admins can correct a wrong opening; bank opening balance; party opening balances (existing).
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { printHTML } from './invoice.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('finance', 'Finance', { layout: 'brand' });
const $ = id => document.getElementById(id);
const isAdmin = ['super_admin', 'admin'].includes(String(prof?.role || '').toLowerCase());
const canManageOpeningBalances = isAdmin;
if (!isAdmin) { $('view').innerHTML = '<p class="notice">Only Admin and Super Admin can access Finance.</p>'; throw new Error('Finance access denied'); }

const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const istDay = v => new Date(v).toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money2 = v => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = v => `${num(v) < 0 ? '−' : ''}₹${money2(Math.abs(num(v)))}`;
const rupees0 = v => `${num(v) < 0 ? '−' : ''}₹${Math.round(Math.abs(num(v))).toLocaleString('en-IN')}`;
const count = n => new Intl.NumberFormat('en-IN').format(num(n));
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const monthStart = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10); };
const monthEnd = (iso, back = 0) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - back, 0)).toISOString().slice(0, 10); };
const dmy = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const dShort = v => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
const tShort = v => new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ }).toUpperCase();
const when = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const digits = v => String(v || '').replace(/\D/g, '');
const waNumber = v => { let d = digits(v); if (d.length === 10) d = `91${d}`; if (d.startsWith('0') && d.length === 11) d = `91${d.slice(1)}`; return d; };
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  coins: svg('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/><path d="M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>', 1.8),
  wallet: svg('<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11v3"/><path d="M15 12h5v4h-5a2 2 0 0 1 0-4Z"/>', 1.8),
  scale: svg('<path d="M12 3v18M7 21h10M5 7h14"/><path d="m5 7-3 6a3 3 0 0 0 6 0Z"/><path d="m19 7-3 6a3 3 0 0 0 6 0Z"/>', 1.8),
  bars: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 17v-4M10 17V9M14 17v-6M18 17V5"/></svg>',
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  filter: svg('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  trend: svg('<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>', 2),
  card: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>', 1.9),
  bank: svg('<path d="m3 9 9-5 9 5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>', 1.9),
  cash: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v4M18 10v4"/>', 1.9),
  sigma: svg('<path d="M18 5H6l6 7-6 7h12"/>', 2),
  tag: svg('<path d="M3 12V4h8l9 9-8 8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>', 1.9),
  calc: svg('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>', 1.9),
  ledger: svg('<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4Z"/><path d="M8 8h8M8 12h8M8 16h5"/>', 1.9),
  users: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.3c2.9.3 5 2.6 5 5.7"/>', 1.8),
  truck: svg('<path d="M3 6h11v10H3Z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', 1.8),
  swap: svg('<path d="M4 8h14l-4-4"/><path d="M20 16H6l4 4"/>', 2),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 1.9),
  arrowUp: svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 2.2),
  arrowDown: svg('<path d="M12 5v14M19 12l-7 7-7-7"/>', 2.2),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', 2.2),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2),
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.6),
  phone: svg('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/>', 1.9),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 2),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const METHOD = { cash: ['Cash', 'p-cash'], upi: ['UPI', 'p-upi'], card: ['Card', 'p-card'], bank: ['Bank Transfer', 'p-bank'], split: ['Split', 'p-split'], credit: ['Credit', 'p-credit'] };
const TYPE = { income: ['Income', 'fn-in'], expense: ['Expense', 'fn-out'], opening: ['Opening', 'fn-open'] };
const KIND = { sale: 'Sales receipt', receipt: 'Credit received', refund: 'Customer refund', supplier: 'Supplier payment', expense: 'Expense', opening: 'Morning opening cash' };
const ACCOUNTS = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank', receivables: 'Customer dues (receivables)', payables: 'Supplier payables', sales: 'Sales', sales_returns: 'Sales returns', purchases: 'Purchases', purchase_returns: 'Purchase returns', expenses: 'Expenses', opening_balance_equity: 'Opening balance equity' };
const CAT_RULES = [[/rent|lease/i, '#12a01b'], [/salar|wage|staff|payroll/i, '#1e8fe8'], [/utilit|electric|power|water|internet|phone/i, '#f5b800'], [/mainten|repair|clean|waste/i, '#9b6cf2'], [/logist|deliver|transport|fuel/i, '#e5484d'], [/office|station/i, '#0e9488'], [/suppl/i, '#f08a24'], [/software|subscri/i, '#3b5bdb']];
const EXTRA = ['#0e9488', '#f08a24', '#3b5bdb', '#d6336c', '#5c940d'];
const catCol = n => (CAT_RULES.find(([re]) => re.test(n || '')) || [0, EXTRA[[...String(n || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % EXTRA.length]])[1];
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;
const PERIODS = { today: 'Today', month: 'This Month', lastmonth: 'Last Month', '3m': 'Last 3 Months', year: 'This Year' };
const TABS = [['ov', 'Overview', I.coins], ['led', 'Ledger', I.ledger], ['rec', 'Customer dues', I.users], ['pay', 'Supplier payables', I.truck], ['hist', 'Receipts & payments', I.swap], ...(canManageOpeningBalances ? [['ob', 'Opening balances', I.sun]] : [])];
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

let v28 = true;
let tab = 'ov';
let compact = matchMedia('(max-width: 560px)').matches;

$('view').innerHTML = `
<div class="pos dl md pur ds sl rt fn">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.coins}</span>
      <div><h1>Finance Management</h1><p>Track cash flow, payments, receipts, and overall financial performance.</p></div></div>
    <div class="pos-head-actions md-head-actions rt-head-actions fn-head-actions">
      <div class="dl-pop-anchor"><button type="button" class="pos-btn pos-btn-solid" id="addTxn" aria-expanded="false">${I.plusC}<span>Add Transaction</span></button>
        <div class="dl-pop md-menu ds-menu fn-add" id="addMenu" hidden>
          <button type="button" data-add="receipt">${I.arrowDown}<span><b>Receive from customer</b><small>Credit / due collected (Cash or UPI)</small></span></button>
          <button type="button" data-add="supplier">${I.arrowUp}<span><b>Pay a distributor</b><small>Supplier payment or advance</small></span></button>
          <a href="expenses.html?new=1">${I.wallet}<span><b>Add expense</b><small>Rent, salary, bills…</small></span></a>
          <button type="button" data-add="opening">${I.sun}<span><b>Opening balances</b><small>Morning cash, bank, customers & suppliers</small></span></button>
        </div></div>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn" id="downloadBtn" aria-expanded="false">${I.download}<span>Download</span></button>
        <div class="dl-pop md-menu ds-menu fn-dl" id="dlMenu" hidden>
          <button type="button" data-dl="txn">${I.list}<span>Transactions (Excel)</span></button>
          <button type="button" data-dl="txncsv">${I.list}<span>Transactions (CSV)</span></button>
          <button type="button" data-dl="ledger">${I.ledger}<span>Ledger (CSV)</span></button>
          <button type="button" data-dl="cash">${I.sun}<span>Daily cash book (CSV)</span></button>
          <button type="button" data-dl="pl">${I.print}<span>Profit &amp; loss statement (print)</span></button>
        </div></div>
      <div class="dl-pop-anchor"><button type="button" class="pos-btn" id="moreBtn" aria-expanded="false">${I.dots}<span>More</span></button>
        <div class="dl-pop md-menu ds-menu rt-more" id="moreMenu" hidden>
          ${TABS.slice(1).map(([k, l, ic]) => `<button type="button" data-tabgo="${k}">${ic}<span>${l}</span></button>`).join('')}
          <a href="reports.html">${I.bars}<span>Reports</span></a>
          <a href="expenses.html">${I.wallet}<span>Expenses</span></a>
        </div></div>
    </div>
  </section>
  <div class="rt-tabs fn-tabs" id="tabs" role="tablist">${TABS.map(([k, l, ic]) => `<button type="button" role="tab" data-k="${k}">${ic}<span>${l}</span></button>`).join('')}</div>
  <div id="msg" class="md-msg" role="status"></div>
  <div id="pane-ov" class="fn-pane"></div>
  <div class="card fn-pane" id="panel" hidden></div>
</div>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg rt-dlg fn-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<dialog id="dlg" class="pos-dialog dl-dialog sl-dlg rt-dlg fn-pay-dlg"><button type="button" class="pos-icon-btn dl-x" id="dc" aria-label="Close">${I.xs}</button>
  <form id="f" method="dialog" class="md-form">
    <h3 id="dt" class="rt-dlg-title"></h3>
    <p class="dl-muted" id="dsub"></p>
    <div class="fn-party" id="partyRow" hidden><label for="party">Party</label><select id="party"></select></div>
    <div class="md-form-grid">
      <div class="pos-field"><label for="am">Amount ₹</label><input id="am" type="number" min="0.01" step="0.01" placeholder="Amount ₹" required></div>
      <div class="pos-field"><label for="me">Method</label><select id="me"><option value="cash">Cash</option><option value="upi">UPI (manual transfer)</option></select></div>
      <div class="pos-field md-span-2"><label for="nt">Note / reference</label><input id="nt" placeholder="Note / reference" maxlength="200"></div>
    </div>
    <small class="dl-muted">UPI payments are completed manually in your UPI app. This page only records the payment.</small>
    <div id="de" class="pos-form-msg"></div>
    <div class="pos-dialog-foot"><button type="button" class="pos-btn" id="dc2">Cancel</button><button class="pos-btn pos-btn-solid" id="dsave">${I.check}<span>Record</span></button></div>
  </form>
</dialog>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const note = (m, bad = false) => { $('msg').textContent = m || ''; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; if (m) toast(m, bad); };
$('puDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('puDlg')) $('puDlg').close(); });
const dlg = html => { $('puPanel').innerHTML = html; if (!$('puDlg').open) $('puDlg').showModal(); };
const missing = e => /finance_|cash_book|_finance_guard|account_opening|correct_daily|function|schema cache|does not exist/i.test(e?.message || '');
const need28 = () => { if (v28) { v28 = false; note('Profit, cash flow, transactions and the daily cash book need database migration 0028_finance_management.sql. Run it once in Supabase. Ledger, dues, payables, receipts and opening balances still work.', true); } };
async function rpc28(name, args) {
  if (!v28) return null;
  const { data, error } = await sb.rpc(name, args);
  if (error) { if (missing(error)) { need28(); return null; } throw error; }
  return data;
}

// ---------------------------------------------------------------------------
// Payment dialog (existing record_customer_receipt / record_supplier_payment)
// ---------------------------------------------------------------------------
let onSave = null;
const ask = (title, fn, { sub = '', parties = null, preset = null } = {}) => {
  $('dt').textContent = title; $('dsub').textContent = sub;
  $('am').value = ''; $('am').removeAttribute('max'); $('nt').value = ''; $('de').textContent = ''; $('me').value = 'cash';
  $('partyRow').hidden = !parties;
  if (parties) { $('party').innerHTML = '<option value="">Select…</option>' + parties.map(p => `<option value="${esc(p.id)}" data-o="${num(p.o)}">${esc(p.name)}${p.o ? ` — ${p.o > 0 ? 'due' : 'advance'} ${fmtMoney(Math.abs(p.o))}` : ''}</option>`).join(''); if (preset) $('party').value = preset; }
  onSave = fn;
  $('dlg').showModal();
  (parties && !preset ? $('party') : $('am')).focus();
};
$('dc').onclick = () => $('dlg').close();
$('dc2').onclick = () => $('dlg').close();
$('party').onchange = () => { const o = num($('party').selectedOptions[0]?.dataset.o); if (o > 0) $('am').value = o.toFixed(2); };
$('f').onsubmit = async e => {
  e.preventDefault();
  if (!onSave) return;
  const amount = +$('am').value;
  if (!Number.isFinite(amount) || amount <= 0) { $('de').textContent = 'Enter a valid positive amount.'; return; }
  if (!$('partyRow').hidden && !$('party').value) { $('de').textContent = 'Select the customer / distributor.'; return; }
  $('dsave').disabled = true;
  const error = await onSave(amount, $('me').value, $('nt').value.trim(), $('party').value);
  $('dsave').disabled = false;
  if (error) { $('de').textContent = friendly(error); return; }
  $('dlg').close();
  note('Payment recorded successfully.');
  await refreshTab();
};
const receiveFrom = (cust, list) => ask(cust ? `Receive from ${cust.name}` : 'Receive from customer', (amt, method, n, party) => sb.rpc('record_customer_receipt', { p_customer: cust?.customer_id || party, p_amount: amt, p_method: method, p_note: n || null }).then(r => r.error),
  { sub: cust ? `Current due ${fmtMoney(cust.outstanding)}; anything above it becomes an advance.` : 'Anything above the due becomes an advance.', parties: cust ? null : (list || []).map(c => ({ id: c.customer_id, name: c.name, o: num(c.outstanding) })) });
const payTo = (dist, list) => ask(dist ? `Pay ${dist.name}` : 'Pay a distributor', (amt, method, n, party) => sb.rpc('record_supplier_payment', { p_distributor: dist?.distributor_id || party, p_amount: amt, p_method: method, p_reference: n || null }).then(r => r.error),
  { sub: dist ? `Current payable ${fmtMoney(dist.balance)}; anything above it becomes a supplier advance.` : 'Anything above the payable becomes a supplier advance.', parties: dist ? null : (list || []).map(d => ({ id: d.distributor_id || d.id, name: d.name, o: num(d.balance) })) });
const reverse = async (rpc, id, label) => {
  const why = prompt(`Reverse this ${label}? A reversing entry will be posted. Reason:`);
  if (!why || !why.trim()) return;
  const { error } = await sb.rpc(rpc, { p_id: id, p_reason: why.trim() });
  if (error) return note(friendly(error), true);
  note('Reversed successfully.');
  await refreshTab();
};

// ---------------------------------------------------------------------------
// OVERVIEW
// ---------------------------------------------------------------------------
const ov = { txns: [], page: 1, period: 'month', filt: { type: '', method: '', kind: '', status: '' }, month: null, prev: null, monthly: [], bal: null, cats: [], dues: [], pays: [] };
function periodWin(p) {
  const t = today();
  if (p === 'today') return [t, t];
  if (p === 'month') return [monthStart(t), t];
  if (p === 'lastmonth') return [monthStart(t, 1), monthEnd(t, 1)];
  if (p === '3m') return [monthStart(t, 2), t];
  if (p === 'year') return [t.slice(0, 4) + '-01-01', t];
  return [t, t];
}
function renderOverviewShell() {
  $('pane-ov').innerHTML = `
  <section class="dz-kpis dl-kpis md-kpis fn-kpis">
    ${KPI('green', I.wallet, 'Total Income (This Month)', 'kInc')}
    ${KPI('rose', I.wallet, 'Total Expenses (This Month)', 'kExp')}
    ${KPI('blue', I.scale, 'Net Profit (This Month)', 'kNet')}
    ${KPI('purple', I.bars, 'Profit Margin', 'kMargin')}
  </section>
  <div class="fn-top">
    <section class="pos-card dl-orders ds-list sl-list rt-list fn-txn">
      <div class="dl-card-head ds-list-head">
        <h2>${I.list}Transaction History <small id="txnLabel">(This Month)</small></h2>
        <label class="dl-select ds-status sl-status"><select id="txnPeriod" aria-label="Period">${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}" ${k === 'month' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="ds-tools">
        <label class="dl-search">${I.search}<input id="tq" type="search" placeholder="Search by reference no., description, or party..." autocomplete="off" aria-label="Search transactions"></label>
        <div class="dl-pop-anchor">
          <button type="button" class="pos-btn dl-filter-btn" id="tFilterBtn" aria-expanded="false">${I.filter}<span>Filter</span><b class="dl-filter-dot" id="tFilterDot" hidden></b></button>
          <div class="dl-pop sl-filter" id="tFilterPop" hidden>
            <div class="pos-field"><label for="tfType">Type</label><select id="tfType"><option value="">All</option><option value="income">Income</option><option value="expense">Expense</option><option value="opening">Opening cash</option></select></div>
            <div class="pos-field"><label for="tfKind">Transaction</label><select id="tfKind"><option value="">All</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
            <div class="pos-field"><label for="tfMethod">Payment method</label><select id="tfMethod"><option value="">Any</option>${['cash', 'upi', 'card', 'bank', 'split'].map(k => `<option value="${k}">${METHOD[k][0]}</option>`).join('')}</select></div>
            <div class="pos-field"><label for="tfStatus">Status</label><select id="tfStatus"><option value="">Any</option><option value="completed">Completed</option><option value="reversed">Reversed</option><option value="cancelled">Cancelled</option></select></div>
            <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="tfReset">Reset</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="tfApply">Apply</button></div>
          </div>
        </div>
      </div>
      <div class="dl-table-wrap"><table class="dl-table sl-table fn-table"><thead><tr>
        <th class="c-no">#</th><th class="c-dt">Date &amp; Time</th><th class="c-ref">Reference No.</th><th>Description</th><th class="c-type">Type</th><th class="c-r">Amount</th><th class="c-pay">Payment Method</th><th class="c-st">Status</th><th class="c-c">Actions</th>
      </tr></thead><tbody id="txnRows"><tr><td colspan="9" class="dl-empty">Loading transactions…</td></tr></tbody></table></div>
      <div class="dl-pager md-pager"><span id="txnInfo"></span><div id="txnPager"></div>
        <button type="button" class="dl-link sl-all" id="txnAll" hidden>View All Transactions ${I.chev}</button>
        <label class="dl-select md-per"><select id="txnPer" aria-label="Rows per page"><option value="8">8 per page</option><option value="15">15 per page</option><option value="30">30 per page</option><option value="100">100 per page</option></select></label></div>
    </section>
    <div class="fn-side">
      <section class="pos-card pur-trend fn-cash">
        <div class="dl-card-head"><h2>${I.trend}Cash Flow Overview</h2>
          <label class="dl-select pur-mini"><select id="cfRange" aria-label="Range"><option value="6">Last 6 Months</option><option value="12">Last 12 Months</option></select></label></div>
        <div class="dz-chart pur-chart fn-chart" id="cfChart"></div>
        <div class="fn-legend"><span><i class="g"></i>Money In</span><span><i class="r"></i>Money Out</span><span><i class="ln"></i>Net Cash Flow</span></div>
      </section>
      <section class="pos-card fn-bal">
        <div class="dl-card-head"><h2>${I.card}Account Balances</h2></div>
        <div id="balRows" class="fn-bal-rows"><p class="dl-muted">Loading…</p></div>
      </section>
    </div>
  </div>
  <div class="fn-bottom">
    <section class="pos-card pur-trend fn-ive">
      <div class="dl-card-head"><h2>${I.bars}Income vs Expenses</h2>
        <label class="dl-select pur-mini"><select id="ieRange" aria-label="Range"><option value="6">Last 6 Months</option><option value="12">Last 12 Months</option></select></label></div>
      <div class="dz-chart pur-chart fn-chart" id="ieChart"></div>
      <div class="fn-legend"><span><i class="g"></i>Income</span><span><i class="r"></i>Expenses</span></div>
    </section>
    <section class="pos-card rt-reason fn-cat">
      <div class="dl-card-head"><h2>${I.tag}Expense by Category <small>(This Month)</small></h2></div>
      <div class="rt-reason-box ex-cat-box">
        <div class="dl-donut rt-donut ex-donut"><svg viewBox="0 0 220 220" id="catDonut" aria-hidden="true"></svg><div class="dl-donut-c"><strong id="catTotal">₹0</strong><span>Total Expenses</span></div></div>
        <div class="rt-legend ex-legend" id="catLegend"></div>
      </div>
    </section>
    <section class="pos-card pur-sum sl-sum fn-sum">
      <div class="dl-card-head"><h2>${I.calc}Financial Summary</h2></div>
      <div class="pur-sum-tiles sl-tiles ex-tiles fn-tiles" id="sumTiles"></div>
      <div class="pur-sum-more" id="sumMore"></div>
    </section>
  </div>`;
  wireOverview();
}
async function loadOverview() {
  if (!$('kInc')) renderOverviewShell();
  const t = today(), d = Number(t.slice(8)), le = monthEnd(t, 1), prevTo = monthStart(t, 1).slice(0, 8) + String(Math.min(d, Number(le.slice(8)))).padStart(2, '0');
  const [m, p, bal, mo, catRes, dues, pays] = await Promise.all([
    rpc28('finance_overview', { p_from: monthStart(t), p_to: t }).catch(e => (note(friendly(e), true), null)),
    rpc28('finance_overview', { p_from: monthStart(t, 1), p_to: prevTo }).catch(() => null),
    rpc28('finance_balances', {}).catch(() => null),
    rpc28('finance_monthly', { p_from: monthStart(t, 11), p_to: t }).catch(() => null),
    sb.rpc('expense_get_list', { p_from: monthStart(t), p_to: t, p_status: 'posted' }),
    sb.rpc('customer_dues'), sb.rpc('payable_balances')
  ]);
  Object.assign(ov, { month: m, prev: p, bal, monthly: mo || [], cats: catRes.data || [], dues: dues.data || [], pays: pays.data || [] });
  renderKpis(); renderBalances(); drawCash(); drawIE(); renderCats(); renderSummary();
  await loadTxns();
  notify();
}
const netSales = o => num(o?.sales) - num(o?.returns);
const profit = o => netSales(o) - num(o?.cogs) - num(o?.expenses);
const vs = (a, b, label = 'vs. last month', goodUp = true) => {
  if (!b) return a ? `<span class="${goodUp ? 'dz-up' : 'dz-down'}">New</span> · nothing last month` : 'Nothing last month either';
  const p = (a - b) / Math.abs(b) * 100, good = goodUp ? p >= 0 : p <= 0;
  return `<span class="${good ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.down}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> ${label}`;
};
function renderKpis() {
  const m = ov.month, p = ov.prev;
  if (!m) { for (const id of ['kInc', 'kExp', 'kNet', 'kMargin']) { $(id).textContent = '—'; $(id + 'Note').textContent = 'Needs migration 0028'; } return; }
  $('kInc').textContent = rupees0(netSales(m)); $('kIncNote').innerHTML = vs(netSales(m), netSales(p));
  $('kExp').textContent = rupees0(m.expenses); $('kExpNote').innerHTML = vs(num(m.expenses), num(p?.expenses), 'vs. last month', false);
  $('kNet').textContent = rupees0(profit(m)); $('kNetNote').innerHTML = vs(profit(m), profit(p));
  const mg = o => netSales(o) ? profit(o) / netSales(o) * 100 : null, a = mg(m), b = mg(p);
  $('kMargin').textContent = a === null ? '—' : `${a.toFixed(1)}%`;
  $('kMarginNote').innerHTML = a === null || b === null ? 'of net sales' : `<span class="${a >= b ? 'dz-up' : 'dz-down'}">${a >= b ? I.up : I.down}${a >= b ? '+' : ''}${(a - b).toFixed(1)} pp</span> vs. last month`;
  $('kInc').closest('.dz-kpi').title = `Sales ${rupees0(m.sales)} − returns ${rupees0(m.returns)} (this month, compared with last month up to the same day)`;
  $('kExp').closest('.dz-kpi').title = `${m.expense_count} posted expense(s): rent, salary, bills… (purchases of stock are not expenses)`;
  $('kNet').closest('.dz-kpi').title = `Income ${rupees0(netSales(m))} − cost of medicines sold ${rupees0(m.cogs)} (FIFO purchase cost) − expenses ${rupees0(m.expenses)}${num(m.cogs_unknown) ? ` · ${m.cogs_unknown} sale line(s) without a purchase cost are counted at ₹0` : ''}`;
  $('kMargin').closest('.dz-kpi').title = 'Net profit ÷ income';
}
function renderBalances() {
  const b = ov.bal;
  if (!b) { $('balRows').innerHTML = '<p class="dl-muted">Needs migration 0028.</p>'; return; }
  const bank = num(b.bank) + num(b.upi) + num(b.card), c = b.cash_today || {}, cash = c.expected === null || c.expected === undefined ? null : num(c.expected);
  $('balRows').innerHTML = `
    <button type="button" class="fn-acc" data-go="bank"><span class="fn-acc-ic b">${I.bank}</span><span><b>Bank Account</b><small>${esc(b.bank_opening?.label || 'UPI, card & bank transfers')}${b.bank_opening ? '' : ' · <em>no opening balance yet</em>'}</small></span><strong>${fmtMoney(bank)}</strong></button>
    <button type="button" class="fn-acc" data-go="cash"><span class="fn-acc-ic g">${I.cash}</span><span><b>Cash in Hand</b><small>${cash === null ? '<em>Morning opening not entered today</em>' : `Opening ${rupees0(c.opening)} at ${esc(tShort(c.opening_at))} · in ${rupees0(c.cash_in)} · out ${rupees0(c.cash_out)}`}</small></span><strong>${cash === null ? '—' : fmtMoney(cash)}</strong></button>
    <div class="fn-total">${I.sigma}<b>Total Balance</b><strong>${fmtMoney(bank + (cash || 0))}</strong></div>
    <div class="fn-bal-more"><button type="button" data-go="rec">${I.users}<span>${num(b.receivables) >= 0 ? 'Customers owe' : 'Customer advances'} <b>${rupees0(Math.abs(num(b.receivables)))}</b></span></button><button type="button" data-go="pay">${I.truck}<span>You owe distributors <b>${rupees0(b.payables)}</b></span></button></div>`;
}
function niceStep(v) { if (v <= 0) return 1; const raw = v * 1.08 / 6, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const axisMoney = v => Math.abs(v) >= 1e7 ? `₹${+(v / 1e7).toFixed(1)}Cr` : Math.abs(v) >= 1e5 ? `₹${+(v / 1e5).toFixed(1)}L` : `₹${Math.round(v).toLocaleString('en-IN')}`;
function barChart(el, series, line, tipFn) {
  const N = series[0].vals.length; if (!N) { el.innerHTML = '<p class="dl-empty">Needs migration 0028.</p>'; return; }
  const W = Math.max(260, el.clientWidth), H = el.clientHeight || 220, padL = 62, padR = 12, padT = 16, padB = 26;
  const all = [...series.flatMap(s => s.vals), ...(line ? line.vals : [])], hi = Math.max(...all, 1), lo = Math.min(0, ...all);
  const tick = niceStep(hi - lo), max = Math.ceil(hi / tick) * tick, min = Math.floor(lo / tick) * tick;
  const yv = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min || 1));
  const gw = (W - padL - padR) / N, bw = Math.min(26, gw * .32), x0 = i => padL + gw * i + gw / 2;
  const grid = []; for (let v = min; v <= max + 1e-6; v += tick) grid.push(v);
  const bars = series.map((s, k) => s.vals.map((v, i) => { const x = x0(i) + (k - (series.length - 1) / 2) * (bw + 3) - bw / 2, y1 = yv(Math.max(v, 0)), y2 = yv(Math.min(v, 0)); return `<rect class="fn-bar ${s.cls}" x="${x}" y="${y1}" width="${bw}" height="${Math.max(1, y2 - y1)}" rx="3"/>`; }).join('')).join('');
  const lp = line ? line.vals.map((v, i) => [x0(i), yv(v)]) : [];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"><g class="dz-grid">${grid.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${yv(v)}" y2="${yv(v)}"/>`).join('')}</g>
    <g class="dz-axis pur-axis">${grid.map(v => `<text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end">${axisMoney(v)}</text>`).join('')}${series[0].labels.map((l, i) => `<text x="${x0(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`).join('')}</g>
    ${bars}${line ? `<path class="fn-line" d="${lp.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')}"/>${lp.map(([x, y]) => `<circle class="fn-dot" cx="${x}" cy="${y}" r="4"/>`).join('')}` : ''}
    ${series[0].labels.map((l, i) => `<rect data-i="${i}" x="${padL + gw * i}" y="${padT}" width="${gw}" height="${H - padT - padB}" fill="transparent"/>`).join('')}</svg><div class="dz-tip" hidden></div>`;
  const tip = el.querySelector('.dz-tip'), sv = el.querySelector('svg');
  const show = i => { tip.hidden = false; tip.innerHTML = tipFn(i); tip.style.left = `${Math.min(Math.max(x0(i) / W * 100, 22), 78)}%`; tip.style.top = `${(yv(Math.max(...series.map(s => s.vals[i]), line ? line.vals[i] : 0)) - 8) / H * 100}%`; };
  sv.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) show(+r.dataset.i); });
  sv.addEventListener('mouseleave', () => { tip.hidden = true; });
}
const monthsFor = n => ov.monthly.slice(-n);
const mLabel = m => new Date(String(m).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
const mFull = m => new Date(String(m).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
function drawCash() {
  const ms = monthsFor(+$('cfRange').value), labels = ms.map(x => mLabel(x.month));
  barChart($('cfChart'), [{ cls: 'g', vals: ms.map(x => num(x.money_in)), labels }, { cls: 'r', vals: ms.map(x => num(x.money_out)), labels }], { vals: ms.map(x => num(x.money_in) - num(x.money_out)) },
    i => `${esc(mFull(ms[i].month))}<small>In ${rupees0(ms[i].money_in)} · Out ${rupees0(ms[i].money_out)} · Net ${rupees0(num(ms[i].money_in) - num(ms[i].money_out))}</small>`);
}
function drawIE() {
  const ms = monthsFor(+$('ieRange').value), labels = ms.map(x => mLabel(x.month));
  barChart($('ieChart'), [{ cls: 'g', vals: ms.map(x => num(x.sales) - num(x.returns)), labels }, { cls: 'r', vals: ms.map(x => num(x.expenses)), labels }], null,
    i => { const x = ms[i], inc = num(x.sales) - num(x.returns), pr = inc - num(x.cogs) - num(x.expenses); return `${esc(mFull(x.month))}<small>Income ${rupees0(inc)} · Expenses ${rupees0(x.expenses)} · Cost of medicines ${rupees0(x.cogs)} · Profit ${rupees0(pr)}</small>`; });
}
function renderCats() {
  const g = new Map(); for (const r of ov.cats) g.set(r.category_name, (g.get(r.category_name) || 0) + num(r.amount));
  const total = [...g.values()].reduce((a, b) => a + b, 0);
  let parts = [...g.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ n, v, col: catCol(n) }));
  if (parts.length > 6) { const rest = parts.slice(5); parts = [...parts.slice(0, 5), { n: 'Others', v: rest.reduce((a, p) => a + p.v, 0), col: '#c3cad5' }]; }
  const C = 2 * Math.PI * 84, gap = parts.length > 1 ? 2 : 0; let off = 0;
  $('catDonut').innerHTML = `<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="32"/>` + parts.map(p => { const len = total ? p.v / total * C : 0, s = len > gap ? `<circle cx="110" cy="110" r="84" fill="none" stroke="${p.col}" stroke-width="32" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-off}"><title>${esc(p.n)}: ${rupees0(p.v)}</title></circle>` : ''; off += len; return s; }).join('');
  $('catTotal').textContent = rupees0(total);
  $('catLegend').innerHTML = parts.map(p => `<a href="expenses.html?q=${encodeURIComponent(p.n === 'Others' ? '' : p.n)}"><i style="background:${p.col}"></i><b>${esc(p.n)}</b><em>${(p.v / total * 100).toFixed(1)}%</em><span>${rupees0(p.v)}</span></a>`).join('') || '<p class="dl-muted">No posted expenses this month.</p>';
}
function renderSummary() {
  const m = ov.month;
  if (!m) { $('sumTiles').innerHTML = '<p class="dl-muted">Needs migration 0028.</p>'; return; }
  const inc = netSales(m), pr = profit(m);
  $('sumTiles').innerHTML = `
    <div class="g"><b>${rupees0(inc)}</b><span>Total Income<br>(This Month)</span></div>
    <div class="fn-r"><b>${rupees0(m.expenses)}</b><span>Total Expenses<br>(This Month)</span></div>
    <div class="a"><b>${rupees0(pr)}</b><span>Net Profit<br>(This Month)</span></div>
    <div class="p"><b>${inc ? (pr / inc * 100).toFixed(1) + '%' : '—'}</b><span>Profit Margin<br>(This Month)</span></div>`;
  const b = ov.bal || {};
  $('sumMore').innerHTML = [
    `<span class="ds-adv" title="FIFO purchase cost of the medicines sold this month">${I.coins}<span>Cost of medicines sold <b>${rupees0(m.cogs)}</b></span></span>`,
    `<span class="ds-adv">${I.trend}<span>Gross profit <b>${rupees0(inc - num(m.cogs))}</b></span></span>`,
    `<span class="ds-adv">${I.truck}<span>Purchases <b>${rupees0(m.purchases)}</b></span></span>`,
    num(m.returns) ? `<span class="ds-adv">${I.undo}<span>Sales returns <b>${rupees0(m.returns)}</b></span></span>` : '',
    `<button type="button" data-go="rec">${I.users}<span>${num(b.receivables) >= 0 ? 'Customer dues' : 'Customer advances'} <b>${rupees0(Math.abs(num(b.receivables)))}</b></span></button>`,
    `<button type="button" data-go="pay">${I.truck}<span>Supplier payables <b>${rupees0(b.payables)}</b></span></button>`
  ].join('');
}
async function loadTxns() {
  const [from, to] = periodWin(ov.period);
  $('txnLabel').textContent = `(${PERIODS[ov.period]})`;
  try { ov.txns = (await rpc28('finance_transactions', { p_from: from, p_to: to })) || []; }
  catch (e) { ov.txns = []; $('txnRows').innerHTML = `<tr><td colspan="9" class="dl-empty">${esc(friendly(e))}</td></tr>`; return; }
  if (!v28) { $('txnRows').innerHTML = '<tr><td colspan="9" class="dl-empty">Transaction history needs migration 0028. Use the Receipts &amp; payments and Ledger tabs meanwhile.</td></tr>'; return; }
  drawTxns();
}
function txnFiltered() {
  const raw = $('tq').value.trim().toLowerCase(), f = ov.filt;
  return ov.txns.filter(t => (!f.type || t.type === f.type) && (!f.kind || t.kind === f.kind) && (!f.method || t.method === f.method) && (!f.status || t.status === f.status)
    && (!raw || `${t.ref_no} ${t.description} ${t.party || ''} ${KIND[t.kind]}`.toLowerCase().includes(raw)));
}
function drawTxns() {
  const list = txnFiltered(), per = compact ? 3 : Number($('txnPer').value), pages = Math.max(1, Math.ceil(list.length / per));
  ov.page = Math.min(ov.page, pages);
  const shown = list.slice((ov.page - 1) * per, ov.page * per);
  $('txnRows').innerHTML = shown.map((t, i) => {
    const [tl, tc] = TYPE[t.type] || [t.type, ''], [ml, mc] = METHOD[t.method] || [t.method, ''], st = t.status === 'completed' ? ['Completed', 'in'] : t.status === 'reversed' ? ['Reversed', 'off'] : ['Cancelled', 'out'];
    return `<tr data-k="${esc(t.kind)}" data-id="${esc(t.id)}" class="${t.status === 'completed' ? '' : 'ds-off'}">
      <td class="c-no">${(ov.page - 1) * per + i + 1}</td>
      <td class="c-dt">${esc(dShort(t.at))}, ${esc(tShort(t.at))}</td>
      <td class="c-ref">${esc(t.ref_no)}</td>
      <td class="c-inv"><span class="sl-doc fn-arrow ${tc}">${t.type === 'income' ? I.arrowUp : t.type === 'opening' ? I.sun : I.arrowDown}</span><b>${esc(t.description)}</b><small class="sl-m-cust fn-m-sub">${esc(dShort(t.at))}, ${esc(tShort(t.at))} &nbsp;|&nbsp; ${esc(t.ref_no)}</small></td>
      <td class="c-type"><span class="fn-type ${tc}">${tl}</span></td>
      <td class="c-r c-amt"><b>${fmtMoney(t.amount)}</b></td>
      <td class="c-pay"><span class="sl-pay-chip ${mc}">${esc(ml)}</span></td>
      <td class="c-st"><span class="md-chip sl-st ${st[1]}">${st[1] === 'in' ? I.check : '<i></i>'}${st[0]}</span></td>
      <td class="c-act"><div class="pur-acts"><button type="button" class="dl-act" data-view aria-label="View ${esc(t.ref_no)}">${I.eye}</button><div class="dl-pop-anchor"><button type="button" class="dl-act" data-menu aria-label="More actions for ${esc(t.ref_no)}">${I.dots}</button></div></div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="dl-empty">${ov.txns.length ? 'No transactions match these filters.' : 'No transactions in this period.'}</td></tr>`;
  const inSum = list.filter(t => t.type === 'income' && t.status === 'completed').reduce((a, t) => a + num(t.amount), 0), outSum = list.filter(t => t.type === 'expense' && t.status === 'completed').reduce((a, t) => a + num(t.amount), 0);
  $('txnInfo').innerHTML = list.length ? `Showing ${(ov.page - 1) * per + 1} – ${Math.min(ov.page * per, list.length)} of ${count(list.length)} transactions${compact ? '' : ` · <span class="fn-in-t">in ${rupees0(inSum)}</span> · <span class="fn-out-t">out ${rupees0(outSum)}</span>`}` : '';
  $('txnPager').innerHTML = !compact && pages > 1 ? `<button type="button" data-page="${ov.page - 1}" ${ov.page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, k) => k + 1).filter(x => x <= 5 && ov.page <= 3 || x === 1 || x === pages || Math.abs(x - ov.page) <= 1).map((x, k, arr) => `${k && x - arr[k - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${x}" class="${x === ov.page ? 'on' : ''}">${x}</button>`).join('')}<button type="button" data-page="${ov.page + 1}" ${ov.page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';
  $('txnAll').hidden = !(compact && list.length > per);
  $('tFilterDot').hidden = !Object.values(ov.filt).some(Boolean);
}
const sourceLink = t => ({ sale: `sales.html?invoice=${t.doc_id}`, receipt: `customers.html?q=${encodeURIComponent(t.party || '')}`, refund: `returns.html?q=${encodeURIComponent(t.ref_no)}`, supplier: `distributors.html?q=${encodeURIComponent(t.party || '')}`, expense: `expenses.html?q=${encodeURIComponent(t.ref_no)}`, opening: null })[t.kind];
function voucherHTML(t) {
  return `<div style="font:13px/1.5 Arial,sans-serif;color:#000;padding:10mm;max-width:180mm"><div style="display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:6px"><b style="font-size:18px">PALLIKKAL PHARMACY</b><div style="text-align:right"><b style="font-size:16px">${t.type === 'income' ? 'RECEIPT' : 'PAYMENT'} VOUCHER</b><br>${esc(t.ref_no)}</div></div>
    <table style="width:100%;margin-top:12px" cellpadding="6"><tr><td style="width:35%">Date</td><td><b>${esc(when(t.at))}</b></td></tr><tr><td>${t.type === 'income' ? 'Received from' : 'Paid to'}</td><td><b>${esc(t.party || '—')}</b></td></tr><tr><td>Towards</td><td>${esc(t.description)}</td></tr><tr><td>Amount</td><td><b style="font-size:16px">₹${money2(t.amount)}</b></td></tr><tr><td>Mode</td><td>${esc(METHOD[t.method]?.[0] || t.method)}</td></tr><tr><td>Status</td><td>${esc(t.status)}</td></tr></table>
    <p style="margin-top:40px;display:flex;justify-content:space-between"><span>Prepared by: ______________</span><span>Signature: ______________</span></p></div>`;
}
function openTxn(t) {
  const link = sourceLink(t), [tl] = TYPE[t.type] || [t.type];
  dlg(`<div class="sl-bill-head"><span class="pos-title-ic sl-bill-ic fn-arrow ${TYPE[t.type]?.[1] || ''}">${t.type === 'income' ? I.arrowUp : t.type === 'opening' ? I.sun : I.arrowDown}</span>
    <div><h3>${esc(t.description)}</h3><p class="dl-muted">${esc(t.ref_no)} · ${esc(KIND[t.kind])} · ${esc(when(t.at))}</p></div></div>
    <div class="sl-kv"><div><small>Amount</small><b class="ex-amt">${fmtMoney(t.amount)}</b></div><div><small>Type</small><b>${esc(tl)}</b></div><div><small>Method</small><b>${esc(METHOD[t.method]?.[0] || t.method)}</b></div><div><small>${t.kind === 'opening' ? 'Entered by' : 'Party'}</small><b>${esc(t.party || '—')}</b></div><div><small>Status</small><b>${esc(t.status)}</b></div></div>
    <div class="pos-dialog-foot sl-bill-acts">
      ${link ? `<a class="pos-btn pos-btn-solid" href="${link}">${I.eye}<span>Open source</span></a>` : `<button type="button" class="pos-btn pos-btn-solid" data-tabgo="ob">${I.sun}<span>Daily cash book</span></button>`}
      ${t.kind === 'receipt' && t.status === 'completed' ? `<button type="button" class="pos-btn ex-danger" data-rev="reverse_receipt">${I.undo}<span>Reverse receipt</span></button>` : ''}
      ${t.kind === 'supplier' && t.status === 'completed' ? `<button type="button" class="pos-btn ex-danger" data-rev="reverse_supplier_payment">${I.undo}<span>Reverse payment</span></button>` : ''}
      <button type="button" class="pos-btn" data-vprint>${I.print}<span>Voucher</span></button></div>`);
  $('puPanel').onclick = e => {
    if (e.target.closest('[data-vprint]')) return printHTML(voucherHTML(t), t.ref_no, 'a4');
    const r = e.target.closest('[data-rev]'); if (r) { $('puDlg').close(); return reverse(r.dataset.rev, t.id, t.kind === 'receipt' ? 'receipt' : 'payment'); }
    const g = e.target.closest('[data-tabgo]'); if (g) { $('puDlg').close(); setTab(g.dataset.tabgo); }
  };
}
let menuEl = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
function wireOverview() {
  $('txnPeriod').onchange = async () => { ov.period = $('txnPeriod').value; ov.page = 1; await loadTxns(); };
  let deb; $('tq').oninput = () => { clearTimeout(deb); deb = setTimeout(() => { ov.page = 1; drawTxns(); }, 200); };
  $('txnPer').onchange = () => { ov.page = 1; drawTxns(); };
  $('txnPager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { ov.page = +b.dataset.page; drawTxns(); } };
  $('txnAll').onclick = () => { compact = false; drawTxns(); };
  $('tFilterBtn').onclick = e => { e.stopPropagation(); if ($('tFilterPop').hidden) { $('tfType').value = ov.filt.type; $('tfKind').value = ov.filt.kind; $('tfMethod').value = ov.filt.method; $('tfStatus').value = ov.filt.status; } $('tFilterPop').hidden = !$('tFilterPop').hidden; };
  $('tFilterPop').onclick = e => e.stopPropagation();
  document.addEventListener('click', () => { if ($('tFilterPop')) $('tFilterPop').hidden = true; });
  $('tfApply').onclick = () => { ov.filt = { type: $('tfType').value, kind: $('tfKind').value, method: $('tfMethod').value, status: $('tfStatus').value }; $('tFilterPop').hidden = true; ov.page = 1; drawTxns(); };
  $('tfReset').onclick = () => { ov.filt = { type: '', method: '', kind: '', status: '' }; $('tq').value = ''; $('tFilterPop').hidden = true; ov.page = 1; drawTxns(); };
  $('txnRows').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const t = ov.txns.find(x => x.id === tr.dataset.id && x.kind === tr.dataset.k);
    const m = e.target.closest('[data-menu]');
    if (m) {
      e.stopPropagation(); if (menuEl && menuEl.parentElement === m.parentElement) return closeMenu(); closeMenu();
      const link = sourceLink(t);
      menuEl = document.createElement('div'); menuEl.className = 'dl-pop md-menu md-row-menu pur-row-menu';
      menuEl.innerHTML = `<button type="button" data-act="view">${I.eye}<span>View details</span></button>${link ? `<a href="${link}">${I.chev}<span>Open ${esc(KIND[t.kind].toLowerCase())}</span></a>` : ''}<button type="button" data-act="print">${I.print}<span>Print voucher</span></button>${t.kind === 'receipt' && t.status === 'completed' ? `<button type="button" data-act="rev" class="danger">${I.undo}<span>Reverse receipt</span></button>` : ''}${t.kind === 'supplier' && t.status === 'completed' ? `<button type="button" data-act="rev" class="danger">${I.undo}<span>Reverse payment</span></button>` : ''}`;
      m.parentElement.append(menuEl); return;
    }
    const a = e.target.closest('[data-act]');
    if (a) { e.stopPropagation(); closeMenu(); if (a.dataset.act === 'print') return printHTML(voucherHTML(t), t.ref_no, 'a4'); if (a.dataset.act === 'rev') return reverse(t.kind === 'receipt' ? 'reverse_receipt' : 'reverse_supplier_payment', t.id, t.kind === 'receipt' ? 'receipt' : 'payment'); }
    if (e.target.closest('a')) return;
    openTxn(t);
  });
  document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  $('cfRange').onchange = drawCash; $('ieRange').onchange = drawIE;
  $('pane-ov').addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (!g) return;
    if (g.dataset.go === 'rec' || g.dataset.go === 'pay') return setTab(g.dataset.go);
    if (g.dataset.go === 'cash' || g.dataset.go === 'bank') return setTab('ob');
  });
  $('pane-ov').querySelector('.md-kpis').onclick = e => { const b = e.target.closest('[data-kpi]'); if (!b) return; if (b.dataset.kpi === 'kExp') location.href = 'expenses.html'; else plStatement(); };
  let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { drawCash(); drawIE(); }, 120); }).observe($('cfChart'));
}
function notify() {
  const items = [], b = ov.bal;
  if (b && (b.cash_today?.opening === null || b.cash_today?.opening === undefined)) items.push({ tone: 'warn', title: 'Morning opening cash not entered today', detail: 'Cash in Hand cannot be worked out until it is entered', href: 'finance.html?tab=ob' });
  if (b && !b.bank_opening) items.push({ tone: 'info', title: 'Bank opening balance not set', detail: 'Opening balances → Bank account', href: 'finance.html?tab=ob' });
  const over = ov.dues.filter(c => num(c.credit_limit) > 0 && num(c.outstanding) > num(c.credit_limit));
  if (over.length) items.push({ tone: 'danger', title: `${over.length} customer(s) over their credit limit`, detail: over.slice(0, 3).map(c => c.name).join(', '), href: 'finance.html?tab=rec' });
  if (ov.month && profit(ov.month) < 0) items.push({ tone: 'danger', title: `Loss this month so far: ${rupees0(profit(ov.month))}`, detail: 'Income is below cost of medicines + expenses', href: 'finance.html' });
  setNotifications(items);
}
async function plStatement(from = monthStart(today()), to = today()) {
  const o = await rpc28('finance_overview', { p_from: from, p_to: to }).catch(e => (note(friendly(e), true), null));
  if (!o) return;
  const inc = netSales(o), gp = inc - num(o.cogs), np = gp - num(o.expenses);
  const R = (l, v, b = false) => `<tr${b ? ' style="font-weight:700;border-top:1px solid #000"' : ''}><td>${l}</td><td align="right">${fmtMoney(v)}</td></tr>`;
  dlg(`<h3 class="rt-dlg-title">${I.calc} Profit &amp; loss</h3><div class="sl-dates ex-rep-dates"><div class="pos-field"><label for="plFrom">From</label><input id="plFrom" type="date" value="${from}"></div><div class="pos-field"><label for="plTo">To</label><input id="plTo" type="date" value="${to}"></div><button type="button" class="pos-btn pos-btn-solid" id="plGo">Apply</button><button type="button" class="pos-btn" id="plPrint">${I.print}<span>Print</span></button></div>
    <table class="dl-table md-plain fn-pl" id="plTable">${R('Sales', o.sales)}${R('Less: sales returns', -num(o.returns))}${R('Net sales (income)', inc, true)}${R('Less: cost of medicines sold (FIFO)', -num(o.cogs))}${R('Gross profit', gp, true)}${R('Less: expenses', -num(o.expenses))}${R('Net profit', np, true)}
    <tr><td>Profit margin</td><td align="right">${inc ? (np / inc * 100).toFixed(1) + '%' : '—'}</td></tr></table>
    <p class="dl-muted">${o.bills} bill(s), ${o.expense_count} expense(s). Purchases this period ${rupees0(o.purchases)} are stock, not expenses — they reach profit only when the medicines are sold.${num(o.cogs_unknown) ? ` ${o.cogs_unknown} sale line(s) had no purchase cost (old opening stock) and count as ₹0 cost.` : ''}</p>`);
  $('plGo').onclick = () => plStatement($('plFrom').value, $('plTo').value);
  $('plPrint').onclick = () => printHTML(`<div style="font:13px Arial;padding:12mm"><h2>PALLIKKAL PHARMACY — Profit &amp; loss</h2><p>${esc(dmy(from))} to ${esc(dmy(to))}</p><table style="width:100%;border-collapse:collapse" cellpadding="6">${$('plTable').innerHTML}</table></div>`, 'Profit and loss', 'a4');
}

// ---------------------------------------------------------------------------
// LEDGER
// ---------------------------------------------------------------------------
async function viewLedger() {
  const t = today();
  $('panel').innerHTML = `
    <div class="fn-pane-head"><h2>${I.ledger}Ledger</h2><p class="dl-muted">Every double-entry line. Entries are permanent; corrections appear as reversing entries.</p></div>
    <div class="fn-chips" id="ledSum"></div>
    <div class="fn-filters">
      <div class="pos-field"><label for="ac">Account</label><select id="ac"><option value="">All accounts</option>${Object.entries(ACCOUNTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="pos-field"><label for="df">From</label><input id="df" type="date" value="${monthStart(t)}"></div>
      <div class="pos-field"><label for="dt2">To</label><input id="dt2" type="date" value="${t}"></div>
      <div class="pos-field fn-grow"><label for="lq">Search memo</label><input id="lq" type="search" placeholder="e.g. Sale 2026-11-21, Supplier payment…"></div>
      <button type="button" class="pos-btn" id="ledCsv">${I.download}<span>CSV</span></button>
    </div>
    <div class="dl-table-wrap"><table class="dl-table md-plain fn-ledger"><thead><tr><th>When (IST)</th><th>Account</th><th class="c-r">Debit</th><th class="c-r">Credit</th><th>Memo</th><th>Source</th></tr></thead><tbody id="r"></tbody></table></div>
    <div class="dl-pager md-pager"><span id="ledInfo"></span><div id="ledPager"></div></div>`;
  let rows = [], page = 1;
  const go = async () => {
    $('r').innerHTML = '<tr><td colspan="6" class="dl-empty">Loading…</td></tr>';
    const out = [];
    for (let from = 0; from < 10000; from += 1000) {
      let q = sb.from('financial_ledger').select('entry_at,account,debit,credit,memo,reversal_of,ref_type').order('id', { ascending: false });
      if ($('ac').value) q = q.eq('account', $('ac').value);
      if ($('df').value) q = q.gte('entry_at', $('df').value + 'T00:00:00+05:30');
      if ($('dt2').value) q = q.lte('entry_at', $('dt2').value + 'T23:59:59+05:30');
      const { data, error } = await q.range(from, from + 999);
      if (error) return note(friendly(error), true);
      out.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    rows = out; page = 1; draw();
    const { data: sum } = await sb.rpc('ledger_summary', { p_from: $('df').value || null, p_to: $('dt2').value || null });
    const a = Object.fromEntries((sum || []).map(x => [x.account, num(x.debit) - num(x.credit)]));
    const chip = (l, v) => `<span class="ds-adv"><span>${l} <b>${fmtMoney(v)}</b></span></span>`;
    $('ledSum').innerHTML = (sum || []).length ? [chip('Sales', -(a.sales || 0)), chip('Sales returns', a.sales_returns || 0), chip('Purchases', a.purchases || 0), chip('Expenses', a.expenses || 0), chip('Cash (net)', a.cash || 0), chip('UPI (net)', a.upi || 0), chip('Card (net)', a.card || 0), chip('Bank (net)', a.bank || 0), chip('Customer dues (change)', a.receivables || 0), chip('Supplier payables (change)', -(a.payables || 0))].join('') : '';
  };
  const filtered = () => { const s = $('lq').value.trim().toLowerCase(); return rows.filter(l => !s || `${l.memo || ''} ${l.ref_type || ''} ${l.account}`.toLowerCase().includes(s)); };
  const draw = () => {
    const list = filtered(), per = 50, pages = Math.max(1, Math.ceil(list.length / per)); page = Math.min(page, pages);
    $('r').innerHTML = list.slice((page - 1) * per, page * per).map(l => `<tr class="${l.reversal_of ? 'fn-rev' : ''}"><td>${esc(when(l.entry_at))}</td><td>${esc(ACCOUNTS[l.account] || l.account)}</td><td class="c-r">${+l.debit ? fmtMoney(l.debit) : ''}</td><td class="c-r">${+l.credit ? fmtMoney(l.credit) : ''}</td><td>${esc(l.memo || '')}${l.reversal_of ? ' (reversal)' : ''}</td><td><small class="dl-muted">${esc(String(l.ref_type || '').replace(/_/g, ' '))}</small></td></tr>`).join('') || '<tr><td colspan="6" class="dl-empty">No entries.</td></tr>';
    const d = list.reduce((s, l) => s + num(l.debit), 0), c = list.reduce((s, l) => s + num(l.credit), 0);
    $('ledInfo').innerHTML = list.length ? `${count(list.length)} line(s) · debit <b>${fmtMoney(d)}</b> · credit <b>${fmtMoney(c)}</b>${$('ac').value ? ` · net <b>${fmtMoney(d - c)}</b>` : ''}` : '';
    $('ledPager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>${I.left}</button><span>${page} / ${pages}</span><button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>${I.chev}</button>` : '';
  };
  ['ac', 'df', 'dt2'].forEach(id => { $(id).onchange = go; });
  $('lq').oninput = () => { page = 1; draw(); };
  $('ledPager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = +b.dataset.page; draw(); } };
  $('ledCsv').onclick = () => csvDownload(filtered().map(l => ({ 'When (IST)': when(l.entry_at), Account: ACCOUNTS[l.account] || l.account, Debit: num(l.debit), Credit: num(l.credit), Memo: l.memo || '', Source: l.ref_type || '', Reversal: l.reversal_of ? 'Yes' : '' })), `Pallikkal_Ledger_${$('df').value}_to_${$('dt2').value}`);
  await go();
}

// ---------------------------------------------------------------------------
// CUSTOMER DUES
// ---------------------------------------------------------------------------
async function viewDues() {
  const { data, error } = await sb.rpc('customer_dues');
  if (error) { $('panel').innerHTML = ''; return note(friendly(error), true); }
  const rows = (data || []).sort((a, b) => num(b.outstanding) - num(a.outstanding));
  const total = rows.filter(c => num(c.outstanding) > 0).reduce((s, c) => s + num(c.outstanding), 0), over = rows.filter(c => num(c.credit_limit) > 0 && num(c.outstanding) > num(c.credit_limit));
  $('panel').innerHTML = `
    <div class="fn-pane-head"><h2>${I.users}Customer dues</h2><p class="dl-muted">Credit sales not yet paid. Receiving money here reduces the due; anything extra stays as an advance.</p></div>
    <div class="fn-stat"><div class="g"><b>${fmtMoney(total)}</b><span>Total due</span></div><div class="b"><b>${count(rows.filter(c => num(c.outstanding) > 0).length)}</b><span>Customers owing</span></div><div class="fn-r"><b>${count(over.length)}</b><span>Over credit limit</span></div><div class="p"><b>${fmtMoney(-rows.filter(c => num(c.outstanding) < 0).reduce((s, c) => s + num(c.outstanding), 0))}</b><span>Advances held</span></div></div>
    <div class="fn-filters"><div class="pos-field fn-grow"><label for="dq">Search</label><input id="dq" type="search" placeholder="Customer name or phone"></div><button type="button" class="pos-btn pos-btn-solid" id="recvAny">${I.arrowDown}<span>Receive payment</span></button></div>
    <div class="dl-table-wrap"><table class="dl-table md-plain fn-dues"><thead><tr><th>Customer</th><th>Phone</th><th class="c-r">Owes</th><th class="c-r">Credit limit</th><th>Used</th><th class="c-r"></th></tr></thead><tbody id="duesRows"></tbody></table></div>`;
  const draw = () => {
    const s = $('dq').value.trim().toLowerCase(), sd = digits(s);
    $('duesRows').innerHTML = rows.filter(c => !s || c.name.toLowerCase().includes(s) || (sd.length >= 3 && digits(c.phone).includes(sd))).map(c => {
      const o = num(c.outstanding), lim = num(c.credit_limit), pct = lim ? Math.min(100, o / lim * 100) : 0;
      return `<tr><td><b>${esc(c.name)}</b>${o < 0 ? ' <small class="md-chip blue">advance</small>' : ''}</td><td>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</td><td class="c-r"><b class="${o > lim && lim ? 'fn-out-t' : ''}">${fmtMoney(o)}</b></td><td class="c-r">${fmtMoney(lim)}</td>
        <td>${lim ? `<div class="fn-meter"><i style="width:${pct}%;background:${o > lim ? '#e5484d' : pct > 80 ? '#f5b800' : '#12a01b'}"></i></div><small>${pct.toFixed(0)}%</small>` : '<small class="dl-muted">no limit</small>'}</td>
        <td class="c-r fn-acts"><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-c="${esc(c.customer_id)}" data-n="${esc(c.name)}" data-o="${o}">Receive payment</button>${c.phone && o > 0 ? `<a class="pos-btn pos-btn-sm" target="_blank" rel="noopener" href="https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(`Dear ${c.name}, a balance of ₹${money2(o)} is due at PALLIKKAL PHARMACY. Kindly pay at your convenience. Thank you.`)}" title="WhatsApp reminder">${I.wa}</a>` : ''}<a class="pos-btn pos-btn-sm" href="customers.html?q=${encodeURIComponent(c.phone || c.name)}" title="Open customer">${I.eye}</a></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="dl-empty">No customer owes anything.</td></tr>';
  };
  draw();
  $('dq').oninput = draw;
  $('recvAny').onclick = () => receiveFrom(null, rows.filter(c => num(c.outstanding) > 0));
  $('panel').onclick = e => { const b = e.target.closest('button[data-c]'); if (!b) return; receiveFrom({ customer_id: b.dataset.c, name: b.dataset.n, outstanding: b.dataset.o }); };
}

// ---------------------------------------------------------------------------
// SUPPLIER PAYABLES
// ---------------------------------------------------------------------------
async function viewPayables() {
  const [{ data, error }, { data: dists }] = await Promise.all([sb.rpc('payable_balances'), sb.from('distributors').select('id,name,phone,active').eq('branch_id', prof.branch_id).order('name')]);
  if (error) { $('panel').innerHTML = ''; return note(friendly(error), true); }
  const rows = data || [], ph = new Map((dists || []).map(d => [d.id, d.phone]));
  const owe = rows.filter(d => num(d.balance) > 0).reduce((s, d) => s + num(d.balance), 0), adv = -rows.filter(d => num(d.balance) < 0).reduce((s, d) => s + num(d.balance), 0);
  $('panel').innerHTML = `
    <div class="fn-pane-head"><h2>${I.truck}Supplier payables</h2><p class="dl-muted">What you owe each distributor (purchases − payments − returns). Paying more than the balance becomes a supplier advance.</p></div>
    <div class="fn-stat"><div class="fn-r"><b>${fmtMoney(owe)}</b><span>You owe distributors</span></div><div class="b"><b>${count(rows.filter(d => num(d.balance) > 0).length)}</b><span>Distributors to pay</span></div><div class="g"><b>${fmtMoney(adv)}</b><span>Advances with suppliers</span></div></div>
    <div class="fn-filters"><div class="pos-field fn-grow"><label for="pq2">Search</label><input id="pq2" type="search" placeholder="Distributor name"></div><button type="button" class="pos-btn pos-btn-solid" id="payAny">${I.arrowUp}<span>Pay a distributor</span></button></div>
    <div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Distributor</th><th>Net balance</th><th class="c-r"></th></tr></thead><tbody id="payRows"></tbody></table></div>`;
  const draw = () => {
    const s = $('pq2').value.trim().toLowerCase();
    $('payRows').innerHTML = rows.filter(d => !s || d.name.toLowerCase().includes(s)).map(d => `<tr><td><b>${esc(d.name)}</b>${ph.get(d.distributor_id) ? `<br><a href="tel:${esc(ph.get(d.distributor_id))}"><small>${esc(ph.get(d.distributor_id))}</small></a>` : ''}</td>
      <td>${+d.balance > 0 ? `<span class="fn-out-t"><b>${fmtMoney(d.balance)}</b> payable</span>` : `<span class="fn-in-t"><b>${fmtMoney(Math.abs(+d.balance))}</b> advance with supplier</span>`}</td>
      <td class="c-r fn-acts"><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-d="${esc(d.distributor_id)}" data-n="${esc(d.name)}" data-o="${d.balance}">Record payment / advance</button><a class="pos-btn pos-btn-sm" href="distributors.html?q=${encodeURIComponent(d.name)}" title="Open distributor">${I.eye}</a></td></tr>`).join('') || '<tr><td colspan="3" class="dl-empty">Nothing owed.</td></tr>';
  };
  draw();
  $('pq2').oninput = draw;
  $('payAny').onclick = () => payTo(null, (dists || []).filter(d => d.active).map(d => ({ distributor_id: d.id, name: d.name, balance: rows.find(x => x.distributor_id === d.id)?.balance || 0 })));
  $('panel').onclick = e => { const b = e.target.closest('button[data-d]'); if (!b) return; payTo({ distributor_id: b.dataset.d, name: b.dataset.n, balance: b.dataset.o }); };
}

// ---------------------------------------------------------------------------
// RECEIPTS & PAYMENTS
// ---------------------------------------------------------------------------
async function viewHistory() {
  const t = today();
  $('panel').innerHTML = `
    <div class="fn-pane-head"><h2>${I.swap}Receipts &amp; payments</h2><p class="dl-muted">Money received from customers against dues, and payments made to distributors. Reversing posts a correcting entry.</p></div>
    <div class="fn-filters"><div class="pos-field"><label for="hf">From</label><input id="hf" type="date" value="${monthStart(t, 2)}"></div><div class="pos-field"><label for="ht">To</label><input id="ht" type="date" value="${t}"></div>
      <div class="pos-field"><label for="hk">Show</label><select id="hk"><option value="">Receipts and payments</option><option value="r">Customer receipts</option><option value="p">Supplier payments</option></select></div>
      <div class="pos-field fn-grow"><label for="hq">Search</label><input id="hq" type="search" placeholder="Number, customer or distributor"></div></div>
    <div class="fn-two"><section><h3 class="sl-sub">${I.arrowDown} Customer receipts <small id="rTot"></small></h3><div class="dl-table-wrap"><table class="dl-table md-plain"><tbody id="rRows"></tbody></table></div></section>
    <section><h3 class="sl-sub">${I.arrowUp} Supplier payments <small id="pTot"></small></h3><div class="dl-table-wrap"><table class="dl-table md-plain"><tbody id="pRows"></tbody></table></div></section></div>`;
  let R = [], P = [];
  const go = async () => {
    const f = $('hf').value + 'T00:00:00+05:30', to = $('ht').value + 'T23:59:59+05:30';
    const [r, p] = await Promise.all([
      sb.from('customer_receipts').select('id,receipt_no,amount,method,status,created_at,note,reversal_reason,customers(name)').gte('created_at', f).lte('created_at', to).order('created_at', { ascending: false }).limit(1000),
      sb.from('supplier_payments').select('id,payment_no,amount,method,status,created_at,reference,reversal_reason,distributors(name)').gte('created_at', f).lte('created_at', to).order('created_at', { ascending: false }).limit(1000)
    ]);
    if (r.error || p.error) return note(friendly(r.error || p.error), true);
    R = r.data || []; P = p.data || []; draw();
  };
  const tbl = (rows, k, who, rpc, label, extra) => rows.map(x => `<tr class="${x.status === 'reversed' ? 'fn-reversed' : ''}"><td><b>${esc(x[k])}</b><br><small class="dl-muted">${esc(when(x.created_at))}</small></td><td>${esc(x[who]?.name || '')}<br><small class="dl-muted">${esc(x[extra] || '')}</small></td><td class="c-r"><b>${fmtMoney(x.amount)}</b></td><td><span class="sl-pay-chip ${METHOD[x.method]?.[1] || ''}">${esc(METHOD[x.method]?.[0] || x.method)}</span></td>
    <td class="c-r">${x.status === 'posted' ? `<button type="button" class="pos-btn pos-btn-sm" data-rpc="${rpc}" data-id="${x.id}" data-l="${label}">Reverse</button>` : `<small title="${esc(x.reversal_reason || '')}">reversed</small>`}</td></tr>`).join('') || `<tr><td class="dl-empty">None.</td></tr>`;
  const draw = () => {
    const s = $('hq').value.trim().toLowerCase(), k = $('hk').value, m = (x, n, w) => !s || `${x[n]} ${x[w]?.name || ''}`.toLowerCase().includes(s);
    const r = R.filter(x => m(x, 'receipt_no', 'customers')), p = P.filter(x => m(x, 'payment_no', 'distributors'));
    $('rRows').closest('section').hidden = k === 'p'; $('pRows').closest('section').hidden = k === 'r';
    $('rRows').innerHTML = tbl(r, 'receipt_no', 'customers', 'reverse_receipt', 'receipt', 'note');
    $('pRows').innerHTML = tbl(p, 'payment_no', 'distributors', 'reverse_supplier_payment', 'payment', 'reference');
    $('rTot').textContent = `· ${r.length} · ${rupees0(r.filter(x => x.status === 'posted').reduce((a, x) => a + num(x.amount), 0))}`;
    $('pTot').textContent = `· ${p.length} · ${rupees0(p.filter(x => x.status === 'posted').reduce((a, x) => a + num(x.amount), 0))}`;
  };
  ['hf', 'ht'].forEach(id => { $(id).onchange = go; });
  $('hk').onchange = draw; $('hq').oninput = draw;
  $('panel').onclick = e => { const b = e.target.closest('button[data-rpc]'); if (b) reverse(b.dataset.rpc, b.dataset.id, b.dataset.l); };
  await go();
}

// ---------------------------------------------------------------------------
// OPENING BALANCES — morning cash (popup), bank, customers / suppliers
// ---------------------------------------------------------------------------
let cashBook = [];
async function viewOpening() {
  if (!canManageOpeningBalances) { $('panel').innerHTML = '<p>Only Admin and Super Admin can manage opening balances.</p>'; return; }
  const t = today();
  $('panel').innerHTML = `
    <div class="fn-pane-head"><h2>${I.sun}Opening balances</h2><p class="dl-muted">The opening cash entered in the morning pop-up (first sign-in of the day) starts each day's cash book. Bank and party balances are entered once when you start using the system.</p></div>
    <section class="fn-today" id="todayCash"><p class="dl-muted">Loading today's cash…</p></section>
    <section class="fn-block"><div class="fn-block-head"><h3 class="sl-sub">${I.cash} Daily cash book <small>(from the morning opening)</small></h3>
      <div class="fn-filters fn-inline"><div class="pos-field"><label for="cbFrom">From</label><input id="cbFrom" type="date" value="${addDays(t, -29)}"></div><div class="pos-field"><label for="cbTo">To</label><input id="cbTo" type="date" value="${t}" max="${t}"></div></div></div>
      <div class="dl-table-wrap"><table class="dl-table md-plain fn-cb"><thead><tr><th>Date</th><th class="c-r">Morning opening</th><th>Entered by</th><th class="c-r">Cash in</th><th class="c-r">Cash out</th><th class="c-r">Expected closing</th><th class="c-r">Next morning</th><th>Difference</th><th></th></tr></thead><tbody id="cbRows"><tr><td colspan="9" class="dl-empty">Loading…</td></tr></tbody></table></div>
      <p class="dl-muted fn-small">Expected closing = morning opening + cash sales + cash received from customers − cash refunds − cash expenses − cash paid to distributors. Difference = next morning's opening − expected closing (money taken out, banked or short).</p></section>
    <section class="fn-block" id="bankBlock"></section>
    <section class="fn-block"><h3 class="sl-sub">${I.users} Customer &amp; supplier opening balances</h3>
      <p class="dl-muted fn-small">Enter the balance as it stood on the selected date. Reversals remain in the audit history.</p>
      <div class="fn-ob-form">
        <div class="pos-field"><label for="obType">Party type</label><select id="obType"><option value="customer">Customer</option><option value="distributor">Distributor / Supplier</option></select></div>
        <div class="pos-field"><label for="obParty">Party</label><select id="obParty" required><option value="">Loading parties…</option></select></div>
        <div class="pos-field"><label for="obAmount">Opening amount (₹)</label><input id="obAmount" type="number" min="0.01" step="0.01" placeholder="0.00" required></div>
        <div class="pos-field"><label for="obSide">Balance type</label><select id="obSide"></select></div>
        <div class="pos-field"><label for="obDate">As of date</label><input id="obDate" type="date" required></div>
        <div class="pos-field"><label for="obNote">Note / reference</label><input id="obNote" type="text" maxlength="500" placeholder="Optional note"></div>
      </div>
      <div class="fn-ob-foot"><button type="button" class="pos-btn pos-btn-solid" id="obSave">${I.check}<span>Post opening balance</span></button><span id="obError" class="pos-form-msg" role="status"></span></div>
      <small class="dl-muted">Customer debit = customer owes you; customer credit = customer advance. Supplier credit = you owe supplier; supplier debit = advance with supplier.</small>
      <h4 class="sl-sub">Opening balance history</h4><div id="obHistory">Loading…</div></section>`;
  await Promise.all([loadTodayAndBook(), loadBank(), loadParties()]);
  ['cbFrom', 'cbTo'].forEach(id => { $(id).onchange = loadTodayAndBook; });
}
async function loadTodayAndBook() {
  const t = today(), from = $('cbFrom').value || addDays(t, -29), to = $('cbTo').value || t;
  let rows = null;
  try { rows = await rpc28('cash_book', { p_from: from, p_to: to }); } catch (e) { $('cbRows').innerHTML = `<tr><td colspan="9" class="dl-empty">${esc(friendly(e))}</td></tr>`; }
  if (rows === null && !v28) {
    // Older database: show the morning openings only.
    const { data } = await sb.from('daily_cash_openings').select('opening_date,amount,created_at,note').gte('opening_date', from).lte('opening_date', to).order('opening_date', { ascending: false });
    rows = (data || []).map(o => ({ day: o.opening_date, opening: o.amount, opening_at: o.created_at, opening_note: o.note }));
  }
  cashBook = rows || [];
  const todayRow = cashBook.find(r => String(r.day).slice(0, 10) === t) || (await rpc28('cash_book', { p_from: t, p_to: t }).catch(() => null) || [])[0];
  const op = todayRow?.opening;
  $('todayCash').innerHTML = op === null || op === undefined ? `
    <div class="fn-today-card warn"><span class="fn-acc-ic a">${I.sun}</span><div><b>Today's opening cash is not entered yet</b><small>It is asked in the pop-up at the first sign-in of the day. You can enter it here now.</small></div>
      <div class="fn-today-form"><input id="openAmt" type="number" min="0" step="0.01" placeholder="Opening cash ₹" aria-label="Opening cash"><button type="button" class="pos-btn pos-btn-solid" id="openSave">${I.check}<span>Save opening</span></button></div></div>`
    : `<div class="fn-today-card"><span class="fn-acc-ic g">${I.sun}</span>
      <div class="fn-today-grid">
        <div><small>Morning opening (${esc(dmy(t))})</small><b>${fmtMoney(op)}</b><em>${esc(todayRow.opening_by || '')}${todayRow.opening_at ? ` · ${esc(tShort(todayRow.opening_at))}` : ''}</em></div>
        <div><small>Cash in today</small><b class="fn-in-t">+${fmtMoney(todayRow.cash_in)}</b><em>sales ${rupees0(todayRow.cash_sales)} · dues ${rupees0(todayRow.cash_receipts)}</em></div>
        <div><small>Cash out today</small><b class="fn-out-t">−${fmtMoney(todayRow.cash_out)}</b><em>expenses ${rupees0(todayRow.cash_expenses)} · suppliers ${rupees0(todayRow.cash_supplier)} · refunds ${rupees0(todayRow.cash_refunds)}</em></div>
        <div class="fn-today-total"><small>Cash that should be in the drawer now</small><b>${todayRow.expected_close === undefined ? '—' : fmtMoney(todayRow.expected_close)}</b></div>
      </div>
      <button type="button" class="pos-btn pos-btn-sm" id="openFix" title="Correct a wrong morning entry">${I.pencil}<span>Correct</span></button></div>
      ${todayRow.opening_note ? `<p class="dl-muted fn-small">${esc(todayRow.opening_note)}</p>` : ''}`;
  $('openSave')?.addEventListener('click', async () => {
    const v = Number($('openAmt').value);
    if (!$('openAmt').value.trim() || !Number.isFinite(v) || v < 0) return toast('Enter a valid opening cash amount.', true);
    const { error } = await sb.rpc('record_daily_cash_opening', { p_opening_date: t, p_amount: Math.round(v * 100) / 100 });
    if (error) return toast(friendly(error), true);
    note(`Today's opening cash ${fmtMoney(v)} saved.`); await loadTodayAndBook(); if (ov.month !== undefined) ov.bal = await rpc28('finance_balances', {}).catch(() => ov.bal);
  });
  $('openFix')?.addEventListener('click', () => correctOpening(t, op));
  $('cbRows').innerHTML = cashBook.map(r => {
    const d = String(r.day).slice(0, 10), diff = r.difference;
    const dtag = diff === null || diff === undefined ? (r.opening === null || r.opening === undefined ? '<span class="md-chip off"><i></i>No opening</span>' : d === t ? '<span class="md-chip blue"><i></i>Today</span>' : '<span class="md-chip off"><i></i>Next day not opened</span>')
      : Math.abs(num(diff)) < 1 ? '<span class="md-chip in"><i></i>Matched</span>' : num(diff) < 0 ? `<span class="md-chip out" title="Cash taken out / banked / short"><i></i>Short ${fmtMoney(-num(diff))}</span>` : `<span class="md-chip low"><i></i>Excess ${fmtMoney(diff)}</span>`;
    return `<tr data-day="${d}"><td><b>${esc(dmy(d))}</b></td><td class="c-r">${r.opening === null || r.opening === undefined ? '—' : fmtMoney(r.opening)}</td><td>${esc(r.opening_by || '')}${r.opening_at ? `<br><small class="dl-muted">${esc(tShort(r.opening_at))}</small>` : ''}</td>
      <td class="c-r fn-in-t">${r.cash_in === undefined ? '' : fmtMoney(r.cash_in)}</td><td class="c-r fn-out-t">${r.cash_out === undefined ? '' : fmtMoney(r.cash_out)}</td><td class="c-r"><b>${r.expected_close === null || r.expected_close === undefined ? '—' : fmtMoney(r.expected_close)}</b></td><td class="c-r">${r.next_opening === null || r.next_opening === undefined ? '—' : fmtMoney(r.next_opening)}</td><td>${dtag}</td>
      <td class="c-r">${r.opening === null || r.opening === undefined ? '' : `<button type="button" class="pos-btn pos-btn-sm" data-fix="${d}" data-amt="${num(r.opening)}" title="Correct this morning's opening">${I.pencil}</button>`}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="dl-empty">No days in this range.</td></tr>';
  $('cbRows').onclick = e => { const b = e.target.closest('[data-fix]'); if (b) correctOpening(b.dataset.fix, b.dataset.amt); };
}
function correctOpening(day, current) {
  if (!v28) return toast('Correcting an opening needs migration 0028.', true);
  dlg(`<h3 class="rt-dlg-title">${I.pencil} Correct morning opening · ${esc(dmy(day))}</h3>
    <p class="dl-muted">Saved: <b>${fmtMoney(current)}</b>. The old ledger entry is reversed and the corrected amount posted. The change and reason are kept in the audit log.</p>
    <div class="md-form-grid"><div class="pos-field"><label for="fixAmt">Correct opening cash ₹</label><input id="fixAmt" type="number" min="0" step="0.01" value="${num(current)}"></div><div class="pos-field"><label for="fixWhy">Reason *</label><input id="fixWhy" maxlength="200" placeholder="e.g. Counted again, ₹500 note missed"></div></div>
    <p class="pos-form-msg" id="fixMsg"></p><div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="fixGo">${I.check}<span>Save correction</span></button></div>`);
  $('fixGo').onclick = async () => {
    const v = Number($('fixAmt').value), why = $('fixWhy').value.trim();
    if (!Number.isFinite(v) || v < 0) return ($('fixMsg').textContent = 'Enter a valid amount.');
    if (!why) return ($('fixMsg').textContent = 'A reason is required.');
    const { error } = await sb.rpc('correct_daily_cash_opening', { p_opening_date: day, p_amount: Math.round(v * 100) / 100, p_reason: why });
    if (error) return ($('fixMsg').textContent = friendly(error));
    $('puDlg').close(); note(`Opening for ${dmy(day)} corrected to ${fmtMoney(v)}.`); await loadTodayAndBook();
  };
}
async function loadBank() {
  const { data, error } = await sb.from('account_opening_balances').select('*').eq('branch_id', prof.branch_id).order('created_at', { ascending: false });
  if (error) { $('bankBlock').innerHTML = `<h3 class="sl-sub">${I.bank} Bank account opening</h3><p class="dl-muted">${missing(error) || /account_opening/.test(error.message || '') ? 'Needs migration 0028.' : esc(friendly(error))}</p>`; return; }
  const cur = (data || []).find(x => x.status === 'posted');
  $('bankBlock').innerHTML = `<h3 class="sl-sub">${I.bank} Bank account opening</h3>
    ${cur ? `<div class="fn-today-card"><span class="fn-acc-ic b">${I.bank}</span><div><b>${esc(cur.label || 'Bank account')}: ${fmtMoney(cur.amount)}</b><small>as of ${esc(dmy(cur.as_of_date))}${cur.note ? ` · ${esc(cur.note)}` : ''}. UPI, card and bank-transfer movements after it are added automatically.</small></div><button type="button" class="pos-btn pos-btn-sm" data-brev="${esc(cur.id)}">${I.undo}<span>Reverse</span></button></div>`
    : `<p class="dl-muted fn-small">Enter the bank balance from your pass book or statement on the day you started. Without it the Bank Account figure only shows movements since then.</p>
      <div class="fn-ob-form"><div class="pos-field"><label for="bkLabel">Bank &amp; account</label><input id="bkLabel" maxlength="80" placeholder="e.g. HDFC Bank - A/c ****2034"></div><div class="pos-field"><label for="bkAmt">Balance ₹</label><input id="bkAmt" type="number" min="0.01" step="0.01"></div><div class="pos-field"><label for="bkDate">As of date</label><input id="bkDate" type="date" value="${today()}" max="${today()}"></div><div class="pos-field"><label for="bkNote">Note</label><input id="bkNote" maxlength="200" placeholder="Optional"></div></div>
      <div class="fn-ob-foot"><button type="button" class="pos-btn pos-btn-solid" id="bkSave">${I.check}<span>Post bank opening</span></button><span id="bkMsg" class="pos-form-msg"></span></div>`}
    ${(data || []).filter(x => x.status === 'reversed').length ? `<details class="fn-small"><summary>Reversed (${data.filter(x => x.status === 'reversed').length})</summary>${data.filter(x => x.status === 'reversed').map(x => `<div>${esc(x.label || 'Bank')} ${fmtMoney(x.amount)} · ${esc(dmy(x.as_of_date))} — reversed: ${esc(x.reversal_reason || '')}</div>`).join('')}</details>` : ''}`;
  $('bkSave')?.addEventListener('click', async () => {
    const v = Number($('bkAmt').value);
    if (!(v > 0)) return ($('bkMsg').textContent = 'Enter the balance.');
    const { error: e } = await sb.rpc('record_account_opening', { p_account: 'bank', p_amount: v, p_as_of_date: $('bkDate').value, p_label: $('bkLabel').value.trim() || null, p_note: $('bkNote').value.trim() || null });
    if (e) return ($('bkMsg').textContent = friendly(e));
    note('Bank opening balance posted.'); await loadBank();
  });
  $('bankBlock').onclick = async e => {
    const b = e.target.closest('[data-brev]'); if (!b) return;
    const why = prompt('Reason for reversing the bank opening balance:'); if (!why || !why.trim()) return;
    const { error: er } = await sb.rpc('reverse_account_opening', { p_id: b.dataset.brev, p_reason: why.trim() });
    if (er) return note(friendly(er), true);
    note('Bank opening balance reversed. You can now post the correct one.'); await loadBank();
  };
}
async function loadParties() {
  const typeEl = $('obType'), partyEl = $('obParty'), sideEl = $('obSide'), amountEl = $('obAmount'), dateEl = $('obDate'), noteEl = $('obNote'), errorEl = $('obError');
  const t = today(); dateEl.value = t; dateEl.max = t;
  let customers = [], distributors = [];
  const updateSides = () => { sideEl.innerHTML = typeEl.value === 'customer' ? '<option value="debit">Customer owes pharmacy (Debit)</option><option value="credit">Customer advance (Credit)</option>' : '<option value="credit">Pharmacy owes supplier (Credit)</option><option value="debit">Supplier advance (Debit)</option>'; };
  const updateParties = () => { const rows = (typeEl.value === 'customer' ? customers : distributors).filter(x => x.active); partyEl.innerHTML = '<option value="">Select party…</option>' + rows.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join(''); updateSides(); };
  const [{ data: cr, error: ce }, { data: dr, error: de }] = await Promise.all([
    sb.from('customers').select('id,name,active').eq('branch_id', prof.branch_id).order('name').limit(5000),
    sb.from('distributors').select('id,name,active').eq('branch_id', prof.branch_id).order('name').limit(1000)
  ]);
  if (ce || de) { errorEl.textContent = friendly(ce || de); return; }
  customers = cr || []; distributors = dr || [];
  updateParties(); typeEl.onchange = updateParties;
  $('obSave').onclick = async () => {
    errorEl.textContent = '';
    const partyId = partyEl.value, amount = Number(amountEl.value);
    if (!partyId) { errorEl.textContent = 'Select a customer or distributor.'; return; }
    if (!Number.isFinite(amount) || amount <= 0) { errorEl.textContent = 'Enter an opening amount greater than zero.'; return; }
    if (!dateEl.value || dateEl.value > t) { errorEl.textContent = 'Choose a valid date that is not in the future.'; return; }
    $('obSave').disabled = true;
    const { error } = await sb.rpc('record_party_opening_balance', { p_party_type: typeEl.value, p_party_id: partyId, p_amount: amount, p_balance_side: sideEl.value, p_as_of_date: dateEl.value, p_note: noteEl.value.trim() || null });
    $('obSave').disabled = false;
    if (error) { errorEl.textContent = friendly(error); return; }
    note('Opening balance posted successfully.'); amountEl.value = ''; noteEl.value = '';
    await loadPartyHistory(customers, distributors);
  };
  await loadPartyHistory(customers, distributors);
}
async function loadPartyHistory(customers, distributors) {
  const { data: entries, error } = await sb.from('party_opening_balances').select('*').eq('branch_id', prof.branch_id).order('created_at', { ascending: false }).limit(200);
  if (error) { $('obHistory').innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const cn = new Map(customers.map(x => [x.id, x.name])), dn = new Map(distributors.map(x => [x.id, x.name])), rows = entries || [];
  $('obHistory').innerHTML = rows.length ? `<div class="dl-table-wrap"><table class="dl-table md-plain"><thead><tr><th>Party</th><th>Type</th><th>Opening date</th><th class="c-r">Amount</th><th>Balance side</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${rows.map(x => { const nm = x.party_type === 'customer' ? cn.get(x.customer_id) : dn.get(x.distributor_id), side = x.party_type === 'customer' ? (x.balance_side === 'debit' ? 'Customer due' : 'Customer advance') : (x.balance_side === 'credit' ? 'Supplier payable' : 'Supplier advance');
      return `<tr><td>${esc(nm || (x.party_type === 'customer' ? 'Customer' : 'Supplier'))}</td><td>${x.party_type === 'customer' ? 'Customer' : 'Supplier'}</td><td>${esc(dmy(x.as_of_date))}</td><td class="c-r">${fmtMoney(x.amount)}</td><td>${side}</td><td>${x.status === 'posted' ? '<span class="md-chip in"><i></i>Active</span>' : '<span class="md-chip off"><i></i>Reversed</span>'}</td><td>${x.status === 'posted' ? `<button type="button" class="pos-btn pos-btn-sm" data-ob-reverse="${x.id}">Reverse</button>` : esc(x.reversal_reason || '—')}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="dl-muted">No opening balances have been recorded yet.</p>';
  $('obHistory').onclick = async e => {
    const b = e.target.closest('[data-ob-reverse]'); if (!b) return;
    const reason = prompt('Reason for reversing this opening balance:'); if (!reason || !reason.trim()) return;
    b.disabled = true;
    const { error: er } = await sb.rpc('reverse_party_opening_balance', { p_entry_id: b.dataset.obReverse, p_reason: reason.trim() });
    if (er) { b.disabled = false; note(friendly(er), true); return; }
    note('Opening balance reversed. You can now post a replacement entry.');
    await loadPartyHistory(customers, distributors);
  };
}

// ---------------------------------------------------------------------------
// Tabs, menus, downloads
// ---------------------------------------------------------------------------
const views = { ov: loadOverview, led: viewLedger, rec: viewDues, pay: viewPayables, hist: viewHistory, ob: viewOpening };
async function refreshTab() { if (tab === 'ov') { await loadOverview(); } else await views[tab](); }
async function setTab(k) {
  if (!views[k]) return;
  tab = k; note('');
  document.querySelectorAll('#tabs [data-k]').forEach(b => { b.classList.toggle('on', b.dataset.k === tab); b.setAttribute('aria-selected', String(b.dataset.k === tab)); });
  $('pane-ov').hidden = k !== 'ov'; $('panel').hidden = k === 'ov';
  $('panel').onclick = null;
  const u = new URL(location.href); if (k === 'ov') u.searchParams.delete('tab'); else u.searchParams.set('tab', k); history.replaceState(null, '', u);
  await views[k]();
}
$('tabs').onclick = e => { const b = e.target.closest('[data-k]'); if (b) setTab(b.dataset.k); };
const menus = [['addTxn', 'addMenu'], ['downloadBtn', 'dlMenu'], ['moreBtn', 'moreMenu']];
for (const [b, m] of menus) $(b).onclick = e => { e.stopPropagation(); for (const [, o] of menus) if (o !== m) $(o).hidden = true; $(m).hidden = !$(m).hidden; };
document.addEventListener('click', e => { for (const [, m] of menus) if (!$(m).hidden && !e.target.closest('#' + m)) $(m).hidden = true; });
$('moreMenu').onclick = e => { const b = e.target.closest('[data-tabgo]'); if (b) { $('moreMenu').hidden = true; setTab(b.dataset.tabgo); } };
$('addMenu').onclick = async e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  $('addMenu').hidden = true;
  if (b.dataset.add === 'receipt') { const { data } = await sb.rpc('customer_dues'); return receiveFrom(null, (data || []).filter(c => num(c.outstanding) > 0)); }
  if (b.dataset.add === 'supplier') { const [{ data: bal }, { data: dists }] = await Promise.all([sb.rpc('payable_balances'), sb.from('distributors').select('id,name,active').eq('branch_id', prof.branch_id).order('name')]); return payTo(null, (dists || []).filter(d => d.active).map(d => ({ distributor_id: d.id, name: d.name, balance: (bal || []).find(x => x.distributor_id === d.id)?.balance || 0 }))); }
  if (b.dataset.add === 'opening') return setTab('ob');
};
function csvDownload(list, name) {
  if (!list.length) return toast('Nothing to download.', true);
  const keys = Object.keys(list[0]);
  const text = [keys, ...list.map(r => keys.map(k => r[k]))].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
  toast(`${list.length} row(s) downloaded.`);
}
const txnExport = () => (tab === 'ov' && $('tq') ? txnFiltered() : ov.txns).map(t => ({ 'Date & time': when(t.at), 'Reference No.': t.ref_no, Description: t.description, Party: t.party || '', Type: TYPE[t.type]?.[0] || t.type, 'Amount (₹)': num(t.amount), 'Payment method': METHOD[t.method]?.[0] || t.method, Status: t.status, Kind: KIND[t.kind] || t.kind }));
$('dlMenu').onclick = async e => {
  const b = e.target.closest('[data-dl]'); if (!b) return;
  $('dlMenu').hidden = true;
  const k = b.dataset.dl, t = today();
  if (k === 'txn' || k === 'txncsv') {
    if (!ov.txns.length) { const [f, to] = periodWin(ov.period); ov.txns = (await rpc28('finance_transactions', { p_from: f, p_to: to }).catch(() => [])) || []; }
    const list = txnExport();
    if (k === 'txn' && window.XLSX && list.length) { const ws = XLSX.utils.json_to_sheet(list); ws['!cols'] = Object.keys(list[0]).map(x => ({ wch: x === 'Description' ? 36 : 16 })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Transactions'); XLSX.writeFile(wb, `Pallikkal_Transactions_${t}.xlsx`); return toast(`${list.length} transaction(s) downloaded.`); }
    return csvDownload(list, `Pallikkal_Transactions_${t}`);
  }
  if (k === 'ledger') { await setTab('led'); return $('ledCsv').click(); }
  if (k === 'cash') { const rows = await rpc28('cash_book', { p_from: addDays(t, -89), p_to: t }).catch(() => null); if (!rows) return toast('The cash book needs migration 0028.', true); return csvDownload(rows.map(r => ({ Date: String(r.day).slice(0, 10), 'Morning opening': r.opening ?? '', 'Entered by': r.opening_by || '', 'Cash sales': num(r.cash_sales), 'Cash received (dues)': num(r.cash_receipts), 'Cash refunds': num(r.cash_refunds), 'Cash expenses': num(r.cash_expenses), 'Cash to distributors': num(r.cash_supplier), 'Expected closing': r.expected_close ?? '', 'Next morning opening': r.next_opening ?? '', Difference: r.difference ?? '' })), `Pallikkal_Cash_Book_${t}`); }
  if (k === 'pl') return plStatement();
};
matchMedia('(max-width: 560px)').addEventListener('change', ev => { compact = ev.matches; if ($('txnRows')) drawTxns(); });

// Dashboard links: finance.html?tab=led|rec|pay|hist|ob opens that tab.
const startTab = new URLSearchParams(location.search).get('tab');
await setTab(startTab && views[startTab] && TABS.some(([k]) => k === startTab) ? startTab : 'ov');
if (tab !== 'ov') loadOverview().catch(() => {});   // KPIs / bell ready when switching back
