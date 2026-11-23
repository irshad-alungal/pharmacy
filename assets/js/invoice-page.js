// Invoice View for staff (invoice-view.html?id=… or ?no=INV-…). Same sidebar as the Dashboard (Sales).
// Kept from the Sales bill dialog: invoice_detail() data, print / PDF in the paper size from Settings,
// Send on WhatsApp (private customer link, 0030), Sales return, customer profile, new bill for the customer.
// New (0036): previous / next bill, cashier, counter or home delivery, customer ID and type, payment
// status with credit, credit notes, delivery status and rider, customer link status, e-mail invoice,
// copy link / number, barcode, amount in words, search by invoice number, ← → keys.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';
import { can } from './permissions.js';
import { loadSettings, cachedSettings } from './app-settings.js';
import { printInvoice, downloadPDF } from './invoice.js';
import { sendInvoice } from './whatsapp-invoice.js';
import { friendly } from './ui.js';
import { paperHTML, figures, rs, esc, payMode, whenStr, PAY } from './invoice-card.js';

const prof = await mountShell('sales', 'Invoice View', { layout: 'brand' });
const $ = id => document.getElementById(id);
const role = String(prof?.role || '').toLowerCase();
const isAdmin = ['super_admin', 'admin'].includes(role);
const canReturn = ['super_admin', 'admin', 'admin_staff', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory'].includes(role);
const canDelivery = can(role, 'delivery');
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');
let S = cachedSettings();
loadSettings(sb).then(s => { S = s; if (D) draw(); }).catch(() => {});

const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'),
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/>'),
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>', 2.2),
  left: svg('<path d="m15 6-6 6 6 6"/>', 2.2), right: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>', 1.7),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
  pdf: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M12 11v6M9.5 14.5 12 17l2.5-2.5"/>'),
  share: svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>'),
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.6),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>'),
  wallet: svg('<path d="M3 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h2"/>'),
  bike: svg('<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17 9 9h5l4.5 8M9 9 8 6H6M14 9l-2 8h-6"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
  plus: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>', 2.2),
  check: svg('<path d="m5 12 5 5L20 7"/>', 2.6),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>', 2.2),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 2),
  stop: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', 2)
};

$('view').innerHTML = `
<div class="pos iv">
  <section class="pos-head iv-head">
    <div class="pos-title">
      <a class="iv-back" href="sales.html" aria-label="Back to Sales">${I.back}</a>
      <span class="pos-title-ic iv-title-ic">${I.doc}</span>
      <div><h1>Invoice View</h1>
        <nav class="iv-crumbs" aria-label="Breadcrumb"><a href="dashboard.html" aria-label="Dashboard">${I.home}</a><span>›</span><a href="sales.html">Sales</a><span>›</span><a href="sales.html" id="crumbInv">Invoices</a><span>›</span><b id="crumbNo">Invoice</b></nav></div>
    </div>
    <div class="iv-nav">
      <button type="button" class="pos-btn iv-navb" id="prevBtn" disabled title="Older bill (←)">${I.left}<span>Previous</span></button>
      <button type="button" class="pos-btn iv-navb" id="nextBtn" disabled title="Newer bill (→)"><span>Next</span>${I.right}</button>
    </div>
  </section>
  <div id="msg" class="md-msg" role="status"></div>
  <div class="iv-grid" id="ivGrid"><div class="iv-main"><div class="iv-paper iv-skel">Loading invoice…</div></div></div>
</div>
<dialog id="ivDlg" class="pos-dialog dl-dialog sl-dlg iv-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.x}</button><div id="ivDlgBody"></div></dialog>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4000); };
const note = (m, bad) => { $('msg').textContent = m; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; };
const missing = e => /invoice_view_info|invoice_lookup|invoice_share_link|function|schema cache|does not exist|Could not find/i.test(e?.message || '');
$('ivDlg').addEventListener('click', e => { if (e.target === $('ivDlg') || e.target.closest('[data-close]')) $('ivDlg').close(); });

let D = null, X = null, ID = null, fmt = null, busy = false;
const digits = v => String(v || '').replace(/\D/g, '');
const waNo = v => { let d = digits(v); if (d.length === 10) d = '91' + d; else if (d.length === 11 && d[0] === '0') d = '91' + d.slice(1); return d; };
const dateOnly = v => v ? whenStr(v, S) : '—';
const STATUS = { paid: ['Paid', 'in'], partly_paid: ['Partly paid', 'low'], credit: ['On credit', 'low'], refunded: ['Refunded', 'blue'], cancelled: ['Cancelled', 'out'], void: ['Cancelled', 'out'], voided: ['Cancelled', 'out'] };
const DSTAT = { pending: ['Pending', 'low'], out: ['Out for delivery', 'blue'], done: ['Delivered', 'in'], failed: ['Failed', 'out'] };

// ------------------------------------------------------------------ load
async function resolveStart() {
  const p = new URLSearchParams(location.search);
  if (/^[0-9a-f-]{36}$/i.test(p.get('id') || '')) return p.get('id');
  const no = (p.get('no') || '').trim();
  if (no) {
    const r = await sb.rpc('invoice_lookup', { p_q: no });
    if (!r.error && r.data?.length) return (r.data.find(x => x.invoice_no.toUpperCase() === no.toUpperCase()) || r.data[0]).id;
    const f = await sb.from('sales_invoices').select('id').eq('branch_id', prof.branch_id).eq('invoice_no', no).limit(1);
    if (f.data?.length) return f.data[0].id;
    note(`Invoice ${no} was not found in this branch. Showing the latest bill.`, true);
  }
  const { data } = await sb.from('sales_invoices').select('id').eq('branch_id', prof.branch_id).order('created_at', { ascending: false }).limit(1);
  return data?.[0]?.id || null;
}
async function neighbours(inv) {
  // before 0036: previous / next from the bills table
  const q = (op, asc) => sb.from('sales_invoices').select('id,invoice_no').eq('branch_id', prof.branch_id)[op]('created_at', inv.created_at).order('created_at', { ascending: asc }).limit(1);
  const [a, b] = await Promise.all([q('lt', false), q('gt', true)]);
  return { prev: a.data?.[0] || null, next: b.data?.[0] || null };
}
async function open(id, push = true) {
  if (!id || busy) return;
  busy = true; ID = id;
  $('prevBtn').disabled = $('nextBtn').disabled = true;
  try {
    const [d, x] = await Promise.all([sb.rpc('invoice_detail', { p_invoice: id }), sb.rpc('invoice_view_info', { p_invoice: id })]);
    if (d.error) throw d.error;
    if (!d.data?.invoice) throw new Error('Invoice not found in this branch.');
    D = d.data;
    D.items = D.items || []; D.payments = D.payments || []; D.tax_summary = D.tax_summary || [];
    const s = D.shop || {};
    D.shop = { ...s, address: [s.address, s.city, s.state, s.pincode].map(v => String(v || '').trim()).filter(Boolean).join(', '),
      drug_licence: Array.isArray(s.drug_licence) ? s.drug_licence.filter(Boolean).join(' / ') : String(s.drug_licence || '') };
    if (x.error) {
      X = null;
      if (missing(x.error)) note('Run database migration 0036 (Invoice View) to see the cashier, customer ID, delivery and payment status here. The invoice, printing and WhatsApp work now.', true);
      else note(friendly(x.error), true);
      const nb = await neighbours(D.invoice); X = { prev: nb.prev, next: nb.next, _partial: true };
    } else { X = x.data; if (!$('msg').classList.contains('purchase-warning') || /0036/.test($('msg').textContent)) note(''); }
    if (push) history.pushState({ id }, '', `invoice-view.html?id=${encodeURIComponent(id)}`);
    else history.replaceState({ id }, '', `invoice-view.html?id=${encodeURIComponent(id)}`);
    draw();
  } catch (e) {
    $('ivGrid').innerHTML = `<div class="iv-main"><div class="iv-paper iv-skel"><p class="pos-form-msg">${esc(friendly(e))}</p><a class="pos-btn" href="sales.html">Back to Sales</a></div></div>`;
  } finally { busy = false; }
}
addEventListener('popstate', e => { const id = e.state?.id || new URLSearchParams(location.search).get('id'); if (id && id !== ID) open(id, false); });

// ------------------------------------------------------------------ draw
const fig = () => figures(D);
function payInfo() {
  const i = D.invoice, total = +i.total || 0;
  if (X && !X._partial) return { status: X.payment_status, paid: +X.paid, credit: +X.on_credit, returned: +X.returned, list: X.payments || D.payments };
  const credit = D.payments.filter(p => p.method === 'credit').reduce((a, p) => a + +p.amount, 0);
  const paid = D.payments.filter(p => p.method !== 'credit').reduce((a, p) => a + +p.amount, 0);
  const st = i.status !== 'final' ? i.status : credit > 0.005 ? (paid > 0.005 ? 'partly_paid' : 'credit') : 'paid';
  return { status: st, paid: paid || (credit ? 0 : total), credit, returned: 0, list: D.payments };
}
function draw() {
  const i = D.invoice, c = D.customer, x = X || {}, p = payInfo(), [sl, sc] = STATUS[p.status] || [p.status, 'off'];
  const phone = c?.phone || i.patient_phone;
  const email = x.customer?.email || '';
  document.title = `PALLIKKAL PHARMACY — Invoice ${i.invoice_no}`;
  $('crumbNo').textContent = `Invoice #${i.invoice_no}`;
  $('crumbInv').href = `sales.html?q=${encodeURIComponent(i.invoice_no)}`;
  $('prevBtn').disabled = !x.prev; $('nextBtn').disabled = !x.next;
  $('prevBtn').title = x.prev ? `Older bill: ${x.prev.invoice_no} (←)` : 'This is the first bill';
  $('nextBtn').title = x.next ? `Newer bill: ${x.next.invoice_no} (→)` : 'This is the latest bill';
  fmt = fmt || (S.invoice.default_format === 'a4' ? 'a4' : 'thermal');
  const final = i.status === 'final';
  const del = x.delivery, [dl, dc] = del ? (DSTAT[del.status] || [del.status, 'off']) : ['Not requested', 'off'];
  const rets = x.returns || [];
  const more = [
    canReturn && final ? `<a class="iv-mini" href="returns.html?invoice=${encodeURIComponent(i.id)}">${I.undo}<span>Sales return</span></a>` : '',
    c ? `<a class="iv-mini" href="billing.html?customer=${encodeURIComponent(x.customer?.id || '')}">${I.plus}<span>New bill</span></a>` : '',
    c ? `<a class="iv-mini" href="customers.html?q=${encodeURIComponent(c.phone || c.name)}">${I.user}<span>Customer</span></a>` : '',
    `<button type="button" class="iv-mini" data-a="link">${I.link}<span>Copy link</span></button>`,
    `<button type="button" class="iv-mini" data-a="copy">${I.copy}<span>Copy no.</span></button>`,
    `<a class="iv-mini" href="sales.html?q=${encodeURIComponent(i.invoice_no)}">${I.list}<span>In Sales list</span></a>`
  ].filter(Boolean).join('');
  const actions = `<section class="pos-card iv-card iv-acts">
      <h3>${I.gear}<span>Invoice Actions</span></h3>
      <div class="iv-fmt" role="group" aria-label="Paper size"><button type="button" data-fmt="a4" class="${fmt === 'a4' ? 'on' : ''}">A4 page</button><button type="button" data-fmt="thermal" class="${fmt === 'thermal' ? 'on' : ''}">Receipt 80 mm</button></div>
      <button type="button" class="iv-act iv-act-p" data-a="print">${I.print}<span>Print Invoice</span></button>
      <button type="button" class="iv-act" data-a="pdf">${I.pdf}<span>Download PDF</span></button>
      <button type="button" class="iv-act iv-act-wa" data-a="wa"${phone ? '' : ' disabled title="No customer or patient phone on this bill"'}>${I.share}<span>Share via WhatsApp</span></button>
      <button type="button" class="iv-act" data-a="mail">${I.mail}<span>Email Invoice</span></button>
      <p class="iv-wa-msg" id="waMsg" role="status">${x.whatsapp ? `${I.wa} WhatsApp invoice ${x.whatsapp.status === 'sent' ? 'sent' : 'ready'} · ${esc(dateOnly(x.whatsapp.queued_at))}` : ''}</p>
      <div class="iv-more">${more}</div>
    </section>`;
  const pay = `<section class="pos-card iv-card iv-pay">
      <h3>${I.wallet}<span>Payment Summary</span><em class="md-chip ${sc}">${sc === 'in' ? I.check : ''}${esc(sl)}</em></h3>
      <div class="iv-row"><span>Total Amount</span><b>${rs(i.total)}</b></div>
      <div class="iv-row"><span>Amount Paid</span><b class="iv-g">${rs(p.paid)}</b></div>
      ${p.credit > 0.004 ? `<div class="iv-row"><span>On credit</span><b class="iv-o">${rs(p.credit)}</b></div>` : ''}
      ${p.returned > 0.004 ? `<div class="iv-row"><span>Returned (credit notes)</span><b class="iv-o">- ${rs(p.returned)}</b></div>` : ''}
      <div class="iv-row iv-bal${p.credit > 0.004 ? ' due' : ''}"><span>Balance</span><b>${rs(final ? p.credit : 0)}</b></div>
      <div class="iv-methods">${(p.list || []).filter(q => +q.amount > 0).map(q => `<span>${esc(PAY[q.method] || q.method)} <b>${rs(q.amount)}</b></span>`).join('') || '<span>No payment recorded</span>'}</div>
      ${x.customer && +x.customer.outstanding > 0.004 ? `<a class="iv-due" href="customers.html?q=${encodeURIComponent(x.customer.phone || x.customer.name)}">${I.info}<span>${esc(x.customer.name)} owes <b>${rs(x.customer.outstanding)}</b> in total — collect on the Customers page</span></a>` : ''}
    </section>`;
  const delivery = `<section class="pos-card iv-card iv-del">
      <h3>${I.bike}<span>Delivery Details</span></h3>
      ${del ? `<div class="iv-row"><span>Delivery Status</span><em class="md-chip ${dc}">${esc(dl)}</em></div>
        <div class="iv-row"><span>Delivery Boy</span><b>${del.rider ? `${esc(del.rider)}${del.rider_staff_id ? ` (${esc(del.rider_staff_id)})` : ''}` : 'Not assigned'}</b></div>
        ${del.status === 'done' ? `<div class="iv-row"><span>Delivered On</span><b>${esc(dateOnly(del.delivered_at))}</b></div>`
          : del.status === 'failed' ? `<div class="iv-row"><span>Failed</span><b>${esc(dateOnly(del.failed_at))}${del.failure_reason ? ` · ${esc(del.failure_reason)}` : ''}</b></div>`
          : del.status === 'out' ? `<div class="iv-row"><span>Out since</span><b>${esc(dateOnly(del.out_at))}</b></div>`
          : `<div class="iv-row"><span>Requested</span><b>${esc(dateOnly(del.requested_at))}</b></div>`}
        ${del.address ? `<div class="iv-row iv-addr"><span>Address</span><b>${esc(del.address)}</b></div>` : ''}
        ${canDelivery ? `<a class="iv-mini iv-wide" href="delivery.html">${I.bike}<span>Open Delivery</span></a>` : ''}`
      : `<p class="iv-none">${X && !X._partial ? 'Counter sale — this bill is not for home delivery.' : 'Delivery details need migration 0036.'}</p>
        ${canDelivery && final && X && !X._partial ? `<a class="iv-mini iv-wide" href="delivery.html">${I.bike}<span>Arrange home delivery</span></a>` : ''}`}
    </section>`;
  const returns = rets.length ? `<section class="pos-card iv-card iv-rets">
      <h3>${I.undo}<span>Returns (credit notes)</span></h3>
      ${rets.map(r => `<div class="iv-ret"><div><b>${esc(r.return_no)}</b><small>${esc(dateOnly(r.created_at))} · ${esc(r.reason || '')}</small></div><b>${rs(r.total)}<small>${esc(String(r.refund_method || '').toUpperCase())}</small></b></div>`).join('')}
      <a class="iv-mini iv-wide" href="returns.html">${I.undo}<span>Open Sales Return</span></a>
    </section>` : '';
  const link = x.share_link ? `<section class="pos-card iv-card iv-link">
      <h3>${I.link}<span>Customer invoice link</span></h3>
      <p>Active till <b>${esc(dateOnly(x.share_link.expires_at))}</b> · opened <b>${+x.share_link.views || 0}</b> time${+x.share_link.views === 1 ? '' : 's'}${x.share_link.last_viewed_at ? `, last ${esc(dateOnly(x.share_link.last_viewed_at))}` : ''}.</p>
      ${isAdmin ? `<button type="button" class="iv-mini iv-wide iv-danger" data-a="revoke">${I.stop}<span>Stop this link</span></button>` : ''}
    </section>` : '';
  const mobileStatus = `<section class="iv-mstat"><span class="iv-mstat-ic ${sc}">${sc === 'in' ? I.check : I.wallet}</span><div><b>Payment Status <em class="md-chip ${sc}">${esc(sl)}</em></b>
      <span>Amount Paid : ${rs(p.paid)} <i>|</i> Balance : ${rs(final ? p.credit : 0)}</span></div></section>`;
  $('ivGrid').innerHTML = `
    <div class="iv-main">${paperHTML(D, { x, S })}${mobileStatus}</div>
    <aside class="iv-side">${actions}${pay}${delivery}${returns}${link}</aside>`;
  void email;
  setNotifications([
    ...(p.credit > 0.004 && final ? [{ tone: 'warn', title: `${i.invoice_no}: ${rs(p.credit)} on credit`, detail: c ? c.name : 'Walk-in', href: c ? `customers.html?q=${encodeURIComponent(c.phone)}` : 'sales.html' }] : []),
    ...(del?.status === 'failed' ? [{ tone: 'danger', title: `Delivery failed for ${i.invoice_no}`, detail: del.failure_reason || 'See Delivery', href: 'delivery.html' }] : []),
    ...(!final ? [{ tone: 'info', title: `${i.invoice_no} is ${i.status}`, detail: 'Not counted in sales', href: 'sales.html' }] : [])
  ]);
}

// ------------------------------------------------------------------ actions
async function shareLink() {
  const { data, error } = await sb.rpc('invoice_share_link', { p_invoice: ID, p_base_url: location.href });
  if (error) throw error;
  if (!data?.link) throw new Error('Could not build the link.');
  X = { ...(X || {}), share_link: X?.share_link || { expires_at: data.expires_at, views: 0 } };
  return data.link;
}
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} copied.`); }
  catch { prompt(label, text); }
}
function mailDialog() {
  const i = D.invoice, c = D.customer, email = X?.customer?.email || '';
  $('ivDlgBody').innerHTML = `<h2 class="iv-dlg-t">${I.mail}<span>Email invoice ${esc(i.invoice_no)}</span></h2>
    <form id="mailF" class="iv-mailf" novalidate>
      <div class="pos-field"><label for="mTo">To</label><input id="mTo" type="email" value="${esc(email)}" placeholder="customer@example.com" maxlength="120" required></div>
      <div class="pos-field"><label for="mSub">Subject</label><input id="mSub" value="${esc(`Invoice ${i.invoice_no} from ${D.shop?.name || 'Pallikkal Pharmacy'}`)}" maxlength="150"></div>
      <label class="iv-chk"><input type="checkbox" id="mLink" checked> Include the private link to view and download the invoice (valid 180 days)</label>
      <label class="iv-chk"><input type="checkbox" id="mItems" checked> List the medicines in the e-mail</label>
      <p class="dl-muted">Your e-mail app opens with the message ready. To attach the PDF, use <b>Download PDF</b> first and attach the file.</p>
      <p class="pos-form-msg" id="mErr" role="alert"></p>
      <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="submit" class="pos-btn pos-btn-solid">${I.mail}<span>Open e-mail</span></button></div>
    </form>`;
  if (!$('ivDlg').open) $('ivDlg').showModal();
  $('mailF').onsubmit = async ev => {
    ev.preventDefault();
    const to = $('mTo').value.trim();
    if (to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { $('mErr').textContent = 'Enter a valid e-mail address.'; return; }
    let link = '';
    if ($('mLink').checked) { try { link = await shareLink(); } catch (e) { $('mErr').textContent = missing(e) ? 'Customer links need migration 0030 / 0036 — untick the link option.' : friendly(e); return; } }
    const f = figures(D);
    const lines = [`Dear ${c?.name || i.patient_name || 'Customer'},`, '', `Thank you for choosing ${D.shop?.name || 'Pallikkal Pharmacy'}.`, `Invoice: ${i.invoice_no}`, `Date: ${whenStr(i.created_at, S)}`, `Total: Rs. ${f.total.toFixed(2)}`];
    if ($('mItems').checked) { lines.push('', 'Medicines:'); D.items.forEach(it => lines.push(`- ${it.name}${it.strength ? ' ' + it.strength : ''} x ${+it.qty} = Rs. ${(+it.line_total).toFixed(2)}`)); }
    if (link) lines.push('', `View / download your invoice: ${link}`);
    lines.push('', D.shop?.name || 'Pallikkal Pharmacy', [D.shop?.phone, D.shop?.email].filter(Boolean).join(' · '));
    const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent($('mSub').value)}&body=${encodeURIComponent(lines.join('\n'))}`;
    window.__mailto = href;
    location.href = href;
    $('ivDlg').close(); toast('E-mail opened in your mail app.');
    if (link) draw();
  };
}
document.addEventListener('click', async e => {
  const f = e.target.closest('[data-fmt]');
  if (f) { fmt = f.dataset.fmt; document.querySelectorAll('[data-fmt]').forEach(b => b.classList.toggle('on', b === f)); return; }
  const a = e.target.closest('#ivGrid [data-a]'); if (!a || !D) return;
  const act = a.dataset.a;
  if (act === 'print') return printInvoice(D, fmt);
  if (act === 'pdf') {
    a.disabled = true; const lbl = a.querySelector('span'); lbl.textContent = 'Preparing PDF…';
    try { await downloadPDF(D, fmt); toast('PDF downloaded.'); } catch { toast('Could not create the PDF — use Print → Save as PDF.', true); }
    finally { a.disabled = false; lbl.textContent = 'Download PDF'; }
    return;
  }
  if (act === 'wa') return sendInvoice(sb, ID, D, m => { $('waMsg').textContent = m; toast(m, /not|blocked|no customer/i.test(m)); });
  if (act === 'mail') return mailDialog();
  if (act === 'copy') return copy(D.invoice.invoice_no, `Invoice ${D.invoice.invoice_no}`);
  if (act === 'link') { try { const l = await shareLink(); await copy(l, 'Customer link'); draw(); } catch (err) { toast(missing(err) ? 'Customer links need migrations 0030 and 0036.' : friendly(err), true); } return; }
  if (act === 'revoke') {
    if (!confirm('Stop the customer link for this bill? The customer will not be able to open it any more. A new link is made the next time you share it.')) return;
    const { error } = await sb.rpc('whatsapp_invoice_link_revoke', { p_invoice: ID });
    if (error) return toast(friendly(error), true);
    toast('Customer link stopped.'); open(ID, false);
  }
});
$('prevBtn').onclick = () => X?.prev && open(X.prev.id);
$('nextBtn').onclick = () => X?.next && open(X.next.id);
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select, [contenteditable], dialog[open]') || e.altKey || e.metaKey) return;
  if (e.ctrlKey && (e.key === 'p' || e.key === 'P') && D) { e.preventDefault(); printInvoice(D, fmt); return; }
  if (e.ctrlKey) return;
  if (e.key === 'ArrowLeft' && X?.prev) open(X.prev.id);
  if (e.key === 'ArrowRight' && X?.next) open(X.next.id);
});

// ------------------------------------------------------------------ search, start
mountGlobalSearch({ sb, prof });   // invoices in the search open here (invoice-view.html?id=…)
const start = await resolveStart();
if (start) open(start, false);
else $('ivGrid').innerHTML = '<div class="iv-main"><div class="iv-paper iv-skel"><p>No bills yet in this branch.</p><a class="pos-btn pos-btn-solid" href="billing.html">Start a bill</a></div></div>';
window.__iv = { open, get data() { return D; }, get info() { return X; } };
