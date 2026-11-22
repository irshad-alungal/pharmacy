// On-screen invoice card (Pallikkal Pharmacy design) shared by the staff Invoice View page and the
// customer's WhatsApp link. d = invoice_detail() / public_invoice() data, x = invoice_view_info() (staff only).
// Printing and PDF still use invoice.js, so the paper format chosen in Settings → Print & Invoice applies.
import { cachedSettings, fmtDateWith, fmtTimeWith } from './app-settings.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+n || 0);
export const rs = n => `₹ ${money(n)}`;
export const PAY = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit', wallet: 'Wallet' };
export const payMode = list => { const m = [...new Set((list || []).filter(p => +p.amount > 0).sort((a, b) => (a.method === 'credit') - (b.method === 'credit')).map(p => PAY[p.method] || p.method))]; return m.length ? m.join(' + ') : '—'; };
export const whenStr = (v, S = cachedSettings()) => v ? `${fmtDateWith(v, S.general.date_format)}, ${fmtTimeWith(v, S.general.time_format)}` : '—';
const expStr = v => { if (!v) return '—'; const d = new Date(String(v).slice(0, 10) + 'T00:00:00'); return Number.isNaN(+d) ? esc(v) : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); };
const ic = (p, w = 1.9) => `<svg class="iv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
export const IC = {
  pin: ic('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  phone: ic('<path d="M5 3h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 5.1 5.1l1.4-2.3L19 13.5V17a3 3 0 0 1-3 3A15 15 0 0 1 2 6a3 3 0 0 1 3-3Z"/>'),
  mail: ic('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>'),
  user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
  note: ic('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v3h6V3M9 11h6M9 15h4"/>'),
  bag: ic('<path d="M5 8h14l-1 13H6Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M12 12v5M9.5 14.5h5"/>'),
  shield: ic('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  doc: ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>')
};

// ---- amount in words (Indian system)
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = n => n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
const three = n => `${n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : ''}${n % 100 ? two(n % 100) : ''}`;
export function inWords(amount) {
  const v = Math.round((+amount || 0) * 100), r = Math.floor(v / 100), p = v % 100;
  const parts = []; let n = r;
  const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(`${cr >= 1000 ? inWords(cr).replace(/^Rupees | Only$/g, '') : three(cr)} Crore`);
  if (lk) parts.push(`${two(lk)} Lakh`); if (th) parts.push(`${two(th)} Thousand`); if (n) parts.push(three(n));
  return `Rupees ${parts.join(' ') || 'Zero'}${p ? ` and ${two(p)} Paise` : ''} Only`;
}

// ---- Code 128 (set B) barcode as SVG
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
export function code128(text) {
  const s = String(text || '').replace(/[^\x20-\x7e]/g, '');
  const codes = [104, ...[...s].map(ch => ch.charCodeAt(0) - 32)];
  codes.push(codes.reduce((a, c, i) => a + c * (i || 1), 0) % 103, 106);
  return codes.map(c => C128[c]).join('');
}
export function barcodeSVG(text, h = 44) {
  const pat = code128(text); let x = 10, bars = '';
  [...pat].forEach((w, i) => { if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${h}"/>`; x += +w; });
  return `<svg class="iv-bc" viewBox="0 0 ${x + 10} ${h}" preserveAspectRatio="none" role="img" aria-label="Barcode ${esc(text)}"><rect width="${x + 10}" height="${h}" fill="#fff"/><g fill="#0d1b4b">${bars}</g></svg>`;
}

// ---- figures used by the card and the summary
export function figures(d) {
  const i = d.invoice || {}, items = d.items || [];
  const gross = items.reduce((a, x) => a + (+x.qty || 0) * (+(x.mrp ?? x.unit_price) || 0), 0);
  const disc = items.reduce((a, x) => a + lineDisc(x), 0) + (+i.discount || 0);
  const taxable = (d.tax_summary || []).reduce((a, t) => a + (+t.taxable || 0), 0);
  const gst = +i.tax || (d.tax_summary || []).reduce((a, t) => a + (+t.tax || 0), 0);
  const lines = items.reduce((a, x) => a + (+x.line_total || 0), 0);
  const round = items.length ? Math.round(((+i.total || 0) - (lines - (+i.discount || 0))) * 100) / 100 : 0;
  return { gross, disc, taxable, gst, round, total: +i.total || 0, rates: (d.tax_summary || []).filter(t => +t.tax > 0 || +t.taxable > 0) };
}
export function lineDisc(x) {
  if (x.discount_amount != null && +x.discount_amount > 0) return +x.discount_amount;
  const base = (+x.qty || 0) * (+(x.mrp ?? x.unit_price) || 0);
  const pct = +x.discount_pct || 0;
  const fromPrice = x.price_includes_tax === false ? 0 : Math.max(0, base - (+x.qty || 0) * (+x.unit_price || 0));
  return Math.round((pct ? (+x.qty || 0) * (+x.unit_price || 0) * pct / 100 : 0) * 100) / 100 + Math.round(fromPrice * 100) / 100;
}

const DEFAULT_NOTES = ['Medicines once sold cannot be returned (except as per return policy).', 'Keep medicines out of reach of children.'];

// The invoice "paper". opt: { x: invoice_view_info, S: settings, logo: url, mobile: bool, publicView: bool }
export function paperHTML(d, opt = {}) {
  const S = opt.S || cachedSettings(), x = opt.x || {}, s = d.shop || {}, i = d.invoice || {}, c = d.customer, items = d.items || [];
  const f = figures(d);
  const cancelled = i.status && i.status !== 'final';
  const logo = opt.logo || (S.general.invoice_logo && S.branding.logo_url && /^(https?:)/.test(S.branding.logo_url) ? S.branding.logo_url : 'assets/images/brand/logo-horizontal-dark.png');
  const lic = Array.isArray(s.drug_licence) ? s.drug_licence.filter(Boolean).join(' / ') : (s.drug_licence || '');
  const cashier = x.cashier ? `${esc(x.cashier.name)}` : '';
  const showPatient = S.invoice.show_patient !== false;
  const notes = (S.invoice.terms ? S.invoice.terms.split(/\n+/) : DEFAULT_NOTES).map(t => t.trim()).filter(Boolean);
  const cust = c ? `
      <div class="iv-kv"><span>Name</span><b>${esc(c.name)}</b></div>
      <div class="iv-kv"><span>Mobile</span><b>${c.phone ? (opt.publicView ? esc(c.phone) : `<a href="tel:+91${esc(String(c.phone).replace(/\D/g, '').slice(-10))}">${esc(c.phone)}</a>`) : '—'}</b></div>`
    : `<div class="iv-kv"><span>Name</span><b>${esc(showPatient && i.patient_name ? i.patient_name : 'Walk-in customer')}</b></div>
      <div class="iv-kv"><span>Mobile</span><b>${esc(showPatient && i.patient_phone ? i.patient_phone : '—')}</b></div>`;
  const cust2 = opt.publicView ? '' : `
      <div class="iv-kv"><span>Customer ID</span><b>${esc(x.customer?.customer_no || (c ? '—' : 'Walk-in'))}</b></div>
      <div class="iv-kv"><span>Type</span><b>${esc(x.customer?.type || (c ? 'Registered' : 'Walk-in'))}</b></div>`;
  const rx = showPatient && !opt.publicView && (i.doctor_name || (c && i.patient_name)) ? `<div class="iv-rx">${c && i.patient_name ? `<span><small>Patient</small> ${esc(i.patient_name)}</span>` : ''}${i.doctor_name ? `<span><small>Doctor</small> ${esc(i.doctor_name)}</span>` : ''}</div>` : '';
  const rows = items.map((it, n) => `<tr>
      <td class="iv-n">${n + 1}</td>
      <td class="iv-med"><b>${esc(it.name)}</b>${it.strength ? ` <span>${esc(it.strength)}</span>` : ''}<small class="iv-m-only">${esc(it.batch_no || '')}${it.expiry ? ` · Exp ${expStr(it.expiry)}` : ''}</small></td>
      <td class="iv-d-only">${esc(it.batch_no || '—')}</td><td class="iv-d-only">${expStr(it.expiry)}</td>
      <td class="iv-r">${+it.qty}</td><td class="iv-r">${money(it.mrp ?? it.unit_price)}</td><td class="iv-r">${money(lineDisc(it))}</td>
      <td class="iv-r">${+it.tax_rate}%${it.price_includes_tax === false ? '<sup title="GST added to the price">+</sup>' : ''}</td><td class="iv-r iv-amt">${money(it.line_total)}</td></tr>`).join('')
    || '<tr><td colspan="9" class="iv-empty">No items on this bill.</td></tr>';
  const gstRows = f.rates.length > 1
    ? f.rates.map(t => `<div class="iv-t"><span>GST (${+t.rate}%)</span><b>${rs(t.tax)}</b></div>`).join('')
    : `<div class="iv-t"><span>GST${f.rates[0] ? ` (${+f.rates[0].rate}%)` : ''}</span><b>${rs(f.gst)}</b></div>`;
  return `<article class="iv-paper${cancelled ? ' is-void' : ''}" id="ivPaper">
    ${cancelled ? `<div class="iv-stamp">${esc(String(i.status).toUpperCase())}</div>` : ''}
    <header class="iv-ph">
      <div class="iv-shop">
        <img class="iv-logo" src="${esc(logo)}" alt="${esc(s.name || 'Pallikkal Pharmacy')}" onerror="this.src='assets/images/brand/logo-horizontal-dark.png'">
        <div class="iv-line">${IC.pin}<div><b>${esc(s.name || 'Pallikkal Pharmacy')}</b><br>${esc(s.address || '')}</div></div>
        ${s.phone ? `<div class="iv-line">${IC.phone}<span>${esc(s.phone)}</span></div>` : ''}
        ${s.email ? `<div class="iv-line">${IC.mail}<span>${esc(s.email)}</span></div>` : ''}
        ${(s.gstin && S.invoice.show_gstin !== false) || (lic && S.invoice.show_drug_licence !== false) ? `<div class="iv-reg">${s.gstin && S.invoice.show_gstin !== false ? `<span>GSTIN <b>${esc(s.gstin)}</b></span>` : ''}${lic && S.invoice.show_drug_licence !== false ? `<span>DL <b>${esc(lic)}</b></span>` : ''}</div>` : ''}
      </div>
      <div class="iv-meta">
        <h2>TAX INVOICE</h2>
        <div class="iv-kv"><span>Invoice No</span><b><em class="iv-no">${esc(i.invoice_no)}</em></b></div>
        <div class="iv-kv"><span>Invoice Date</span><b>${esc(whenStr(i.created_at, S))}</b></div>
        ${x.sales_type ? `<div class="iv-kv"><span>Sales Type</span><b>${esc(x.sales_type)}</b></div>` : ''}
        <div class="iv-kv"><span>Payment Mode</span><b>${esc(payMode(x.payments || d.payments))}</b></div>
        ${cashier ? `<div class="iv-kv"><span>Cashier</span><b>${cashier}</b></div>` : ''}
      </div>
    </header>
    <section class="iv-cust">
      <h3>${IC.user}<span>Customer Details</span></h3>
      <div class="iv-cust-g"><div>${cust}</div>${cust2 ? `<div>${cust2}</div>` : ''}</div>
      ${rx}
    </section>
    <div class="iv-tw"><table class="iv-items">
      <thead><tr><th class="iv-n">#</th><th>Medicine / Product</th><th class="iv-d-only">Batch No.</th><th class="iv-d-only">Expiry</th><th class="iv-r">Qty</th><th class="iv-r">MRP (₹)</th><th class="iv-r">Disc. (₹)</th><th class="iv-r">GST</th><th class="iv-r">Amount (₹)</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="iv-bottom">
      <div class="iv-notes"><h4>${IC.note}<span>Notes</span></h4><ul>${notes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        ${S.invoice.show_upi && S.payments.upi_id ? `<p class="iv-upi">Pay by UPI: <b>${esc(S.payments.upi_id)}</b>${S.payments.upi_name ? ` (${esc(S.payments.upi_name)})` : ''}</p>` : ''}</div>
      <div class="iv-totals">
        <div class="iv-t"><span>Subtotal</span><b>${rs(f.gross)}</b></div>
        <div class="iv-t"><span>Total Discount</span><b class="iv-g">${f.disc > 0.004 ? '- ' : ''}${rs(f.disc)}</b></div>
        <div class="iv-t"><span>Taxable Amount</span><b>${rs(f.taxable)}</b></div>
        ${gstRows}
        ${Math.abs(f.round) >= 0.01 ? `<div class="iv-t"><span>Round Off</span><b>${f.round < 0 ? '- ' : '+ '}${rs(Math.abs(f.round))}</b></div>` : ''}
        <div class="iv-grand"><span>Total Amount</span><b>${rs(f.total)}</b></div>
        <p class="iv-words">${esc(inWords(f.total))}</p>
      </div>
    </div>
    <footer class="iv-pf">
      <div class="iv-thanks">${IC.bag}<span>${esc(s.footer_note || `Thank you for choosing ${s.name ? s.name.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()) : 'Pallikkal Pharmacy'}!`)}</span></div>
      <div class="iv-bcw">${barcodeSVG(i.invoice_no)}<span>${esc(String(i.invoice_no || '').split('').join(' '))}</span></div>
    </footer>
  </article>`;
}
