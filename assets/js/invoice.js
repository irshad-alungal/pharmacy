// Bill printing for Pallikkal Pharmacy: sales bills, return bills (sales + purchase) and "All Bills for Today".
// Input for a sales bill is the JSON from invoice_detail() (no shelf, no purchase price).
// Thermal 80 mm: bold, dark black text (thermal heads print thin fonts faintly), logo, pharmacy details,
// GSTIN and drug licence (Settings → Business Information), thank-you note and QR code (Settings → Print & Invoice).
import { cachedSettings, fmtDateTime, fmtDateWith, fmtTimeWith } from './app-settings.js';
import qrcode from './vendor/qrcode.js';

const R = n => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+n || 0);
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = d => fmtDateTime(d);
const PM = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit (due)', wallet: 'Wallet' };
export const LOGO_PRINT = new URL('../images/brand/logo-print.png', import.meta.url).href;
export const LOGO_COLOR = new URL('../images/brand/logo-horizontal-dark.png', import.meta.url).href;
export const THANKS_DEFAULT = 'Thank you for shopping with us! Get well soon.';
const QR_CAPTION = { whatsapp: 'Scan to order on WhatsApp', upi: 'Scan to pay by UPI', link: 'Scan me' };

// Drug licence may come as a list (branches.drug_licence_nos) or as text.
const licText = v => Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean).join(', ') : String(v ?? '').trim();
const digits = v => String(v || '').replace(/\D/g, '');

// Patient / prescription lines saved with the bill (finalize_sale_v3).
const patientLines = (i, S = cachedSettings()) => S.invoice.show_patient === false ? [] : [
  i.patient_name ? `Patient: ${i.patient_name}${i.patient_phone ? ' (' + i.patient_phone + ')' : ''}` : (i.patient_phone ? `Patient phone: ${i.patient_phone}` : ''),
  i.patient_address ? `Address: ${i.patient_address}` : '',
  i.doctor_name ? `Doctor: ${i.doctor_name}` : '',
  i.diagnosis ? `Diagnosis: ${i.diagnosis}` : ''
].filter(Boolean);
const gstLabel = d => (d.items || []).some(x => x.price_includes_tax === false) ? 'GST' : 'GST included';
const defFmt = () => cachedSettings().invoice.default_format === 'a4' ? 'a4' : 'thermal';
const extras = (S = cachedSettings()) => {
  const out = [];
  if (S.invoice.show_upi && S.payments.upi_id) out.push(`Pay by UPI: ${S.payments.upi_id}${S.payments.upi_name ? ' (' + S.payments.upi_name + ')' : ''}`);
  if (S.invoice.terms) out.push(S.invoice.terms);
  return out;
};

// ---------------------------------------------------------------- shared print pieces
// Thermal: bold Arial, pure black, dashed rules. A4: regular weight.
export const PRINT_CSS = `<style>
.ppb{width:72mm;margin:0 auto;padding:1.5mm 1mm;font:700 12.5px/1.38 Arial,Helvetica,sans-serif;color:#000;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-rendering:geometricPrecision}
.ppb *{color:#000!important;box-sizing:border-box}
.ppb hr{border:0;border-top:1.6px dashed #000;margin:5px 0;height:0}
.ppb .c{text-align:center}.ppb .r{display:flex;justify-content:space-between;gap:6px}.ppb .r>span:last-child{text-align:right;white-space:nowrap}
.ppb .nm{font-size:13.5px;font-weight:800}.ppb .sm{font-size:11.5px;font-weight:700}
.ppb .ttl{font-size:14.5px;font-weight:900;letter-spacing:.6px;margin:2px 0}
.ppb .shop{font-size:16px;font-weight:900}
.ppb .tot{font-size:17px;font-weight:900}
.ppb .lg{display:block;margin:0 auto 4px;max-width:62mm;max-height:19mm;height:auto}
.ppb .qr{margin:6px auto 2px;width:30mm}.ppb .qr svg{display:block;width:30mm;height:30mm}
.ppb .thx{font-size:13.5px;font-weight:900;margin-top:6px}
.ppb .it{margin:3px 0}.ppb .cut{border-top:2px dashed #000;margin:10px 0 8px;text-align:center;font-size:11px}
.ppb table{width:100%;border-collapse:collapse}.ppb td,.ppb th{padding:2px 1px;vertical-align:top;text-align:left;font-size:11.5px}
.ppb th{border-bottom:1.6px solid #000}.ppb td.n,.ppb th.n{text-align:right}
.ppa{width:190mm;font:13px/1.45 Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:2mm}
.ppa hr{border:0;border-top:1px solid #000;margin:6px 0}.ppa .c{text-align:center}.ppa .r{display:flex;justify-content:space-between;gap:8px}
.ppa .lg{display:block;margin:0 auto 4px;max-height:56px;max-width:220px}.ppa .shop{font-size:20px;font-weight:800}.ppa .ttl{font-size:16px;font-weight:800;letter-spacing:.5px}
.ppa .tot{font-size:16px;font-weight:800}.ppa .qr{width:28mm;margin:6px auto 2px}.ppa .qr svg{display:block;width:28mm;height:28mm}.ppa .thx{font-weight:700;margin-top:8px}
.ppa table{width:100%;border-collapse:collapse}.ppa th{border-bottom:1px solid #000;text-align:left}.ppa td.n,.ppa th.n{text-align:right}
</style>`;

// QR as crisp SVG squares (no network needed).
export function qrSvg(text) {
  if (!text) return '';
  try {
    const q = qrcode(0, 'M'); q.addData(String(text), 'Byte'); q.make();
    const n = q.getModuleCount(), m = 2; let p = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) p += `M${x + m} ${y + m}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
  } catch { return ''; }
}
// What the QR on the bill opens (Settings → Print & Invoice → QR code).
export function qrFor(shop = {}, S = cachedSettings(), amount = null, ref = '') {
  const iv = S.invoice || {}, mode = iv.qr_mode || 'whatsapp';
  let text = '';
  if (mode === 'upi' && S.payments.upi_id) {
    text = `upi://pay?pa=${encodeURIComponent(S.payments.upi_id)}&pn=${encodeURIComponent(S.payments.upi_name || shop.name || 'Pallikkal Pharmacy')}&cu=INR${amount > 0 ? `&am=${(+amount).toFixed(2)}` : ''}${ref ? `&tn=${encodeURIComponent('Bill ' + ref)}` : ''}`;
  } else if (mode === 'link' && String(iv.qr_link || '').trim()) text = String(iv.qr_link).trim();
  else if (mode === 'whatsapp') {
    let d = digits(iv.qr_phone || shop.phone); if (d.length === 10) d = '91' + d;
    if (d.length >= 11) text = `https://wa.me/${d}`;
  }
  return text ? { text, caption: String(iv.qr_caption || '').trim() || QR_CAPTION[mode] || '' } : null;
}
export function logoSrc(S = cachedSettings(), th = true) {
  if (S.general.invoice_logo === false) return '';
  const up = S.branding.logo_url && /^(https?:|data:)/.test(S.branding.logo_url) ? S.branding.logo_url : '';
  return up || (th ? LOGO_PRINT : LOGO_COLOR);
}
// Header: logo, pharmacy name, address, phone, e-mail, GSTIN, drug licence, document title.
export function shopHeader(shop = {}, S = cachedSettings(), th = true, title = '') {
  const lg = logoSrc(S, th), dl = licText(shop.drug_licence), uploaded = lg && lg !== LOGO_PRINT && lg !== LOGO_COLOR;
  const addr = [shop.address, shop.city, shop.pincode].filter(Boolean).filter((x, k, a) => !(k > 0 && String(a[0]).includes(String(x)))).join(', ');
  return `<div class="c">${lg ? `<img class="lg" src="${e(lg)}" alt="${e(shop.name || 'Pallikkal Pharmacy')}"${uploaded && th ? ' style="filter:grayscale(1) contrast(1.6)"' : ''}>` : ''}
    ${!lg || uploaded ? `<div class="shop">${e(shop.name || 'PALLIKKAL PHARMACY')}</div>` : ''}
    ${addr ? `<div>${e(addr)}</div>` : ''}${shop.phone ? `<div>Ph: ${e(shop.phone)}</div>` : ''}${shop.email ? `<div class="sm">${e(shop.email)}</div>` : ''}
    ${shop.gstin && S.invoice.show_gstin !== false ? `<div>GSTIN: ${e(shop.gstin)}</div>` : ''}${dl && S.invoice.show_drug_licence !== false ? `<div>D.L. No: ${e(dl)}</div>` : ''}
    ${title ? `<div class="ttl">${title}</div>` : ''}</div><hr>`;
}
// Footer: thank-you note and QR code.
export function shopFooter(shop = {}, S = cachedSettings(), qr = null, { thanks = true } = {}) {
  const t = String(shop.footer_note || '').trim() || THANKS_DEFAULT;
  return `${thanks ? `<div class="c thx">${e(t)}</div>` : ''}${qr ? `<div class="c"><div class="qr">${qrSvg(qr.text)}</div>${qr.caption ? `<div class="sm">${e(qr.caption)}</div>` : ''}</div>` : ''}`;
}
const wrap = (th, inner) => `${PRINT_CSS}<div class="${th ? 'ppb' : 'ppa'}" style="${th ? 'width:72mm' : 'width:190mm'}">${inner}</div>`;

// ---------------------------------------------------------------- sales bill
function billBody(d, th, S, compact = false) {
  const s = d.shop || {}, i = d.invoice, c = d.customer;
  const cancelled = i.status && i.status !== 'final';
  const title = cancelled ? '*** CANCELLED BILL ***' : (s.gstin && S.invoice.show_gstin !== false ? 'TAX INVOICE' : 'INVOICE');
  const info = `<div class="r"><span>Bill No: <b>${e(i.invoice_no)}</b></span></div>
    <div>Date: ${e(`${fmtDateWith(i.created_at, S.general.date_format)}, ${fmtTimeWith(i.created_at, S.general.time_format)}`)}</div>
    <div>Customer: ${c ? e(c.name) + (c.phone ? ' (' + e(c.phone) + ')' : '') : 'Walk-in'}</div>${patientLines(i, S).map(l => `<div>${e(l)}</div>`).join('')}<hr>`;
  const qtyTotal = (d.items || []).reduce((a, x) => a + (+x.qty || 0), 0);
  const items = th
    ? `<div class="r sm"><span>Item · Qty x MRP</span><span>Amount</span></div><hr>` + d.items.map((x, k) => `<div class="it"><div class="nm">${k + 1}. ${e(x.name)} ${e(x.strength || '')}</div>
        <div class="sm">Batch ${e(x.batch_no)} · Exp ${e(String(x.expiry || '').slice(5, 7) + '/' + String(x.expiry || '').slice(2, 4))}${+x.tax_rate ? ` · GST ${+x.tax_rate}%` : ''}</div>
        <div class="r"><span>${x.qty} x ${R(x.unit_price)}${+x.discount_pct > 0 ? ` (-${+x.discount_pct}%)` : ''}${x.price_includes_tax === false ? ` +GST` : ''}</span><span>${R(x.line_total)}</span></div></div>`).join('')
    : `<table><tr><th>#</th><th>Item</th><th>Batch</th><th>Exp</th><th class="n">Qty</th><th class="n">MRP</th><th class="n">Disc%</th><th class="n">GST%</th><th class="n">Amount</th></tr>${d.items.map((x, k) => `<tr><td>${k + 1}</td><td>${e(x.name)} ${e(x.strength || '')}</td><td>${e(x.batch_no)}</td><td>${e(String(x.expiry).slice(0, 7))}</td><td class="n">${x.qty}</td><td class="n">${R(x.unit_price)}</td><td class="n">${+x.discount_pct || 0}</td><td class="n">${x.tax_rate}${x.price_includes_tax === false ? '+' : ''}</td><td class="n">${R(x.line_total)}</td></tr>`).join('')}</table>`;
  const row = (a, b, cls = '') => `<div class="r ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const tot = `<hr>${row(`Items: ${d.items.length}`, `Qty: ${qtyTotal}`, 'sm')}${+i.line_discount > 0 ? row('You saved', '₹' + R(i.line_discount)) : ''}${row('Subtotal', R(i.subtotal))}${+i.discount > 0 ? row('Bill discount', '-' + R(i.discount)) : ''}${row(gstLabel(d), R(i.tax))}${row('NET TOTAL', '₹' + R(i.total), 'tot')}<hr>
    ${(d.payments || []).map(p => row('Paid by ' + (PM[p.method] || e(p.method)), R(p.amount))).join('')}
    ${(d.tax_summary || []).length ? `<div class="sm" style="margin-top:4px">${d.tax_summary.map(t => `GST ${t.rate}%: taxable ${R(t.taxable)}, tax ${R(t.tax)}`).join('<br>')}</div>` : ''}
    ${extras(S).map(x => `<div class="sm" style="margin-top:4px">${e(x)}</div>`).join('')}
    ${!th && S.invoice.signature_line ? '<div style="margin-top:36px;text-align:right">Authorised signatory<br>________________________</div>' : ''}<hr>`;
  if (compact) return `${cancelled ? `<div class="c ttl">${title}</div>` : ''}${info}${items}${tot}`;
  return shopHeader(s, S, th, title) + info + items + tot + shopFooter(s, S, cancelled ? null : qrFor(s, S, i.total, i.invoice_no));
}
// S: settings to use (Settings → Print & Invoice passes unsaved values for its live preview).
export function invoiceHTML(d, fmt = defFmt(), S = cachedSettings()) {
  const th = fmt === 'thermal';
  return wrap(th, billBody(d, th, S));
}

// ---------------------------------------------------------------- printing (hidden frame; waits for the logo)
export function printDoc(html, title, fmt = 'thermal') {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
  const doc = f.contentDocument; doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${e(title)}</title><style>@page{size:${fmt === 'thermal' ? '80mm auto' : 'A4'};margin:${fmt === 'thermal' ? '2mm 3mm' : '12mm'}}html,body{margin:0;background:#fff}</style></head><body>${html}</body></html>`); doc.close();
  const imgs = [...doc.images];
  const ready = Promise.race([Promise.all(imgs.map(im => im.complete ? 1 : new Promise(r => { im.onload = im.onerror = r; }))), new Promise(r => setTimeout(r, 2500))]);
  ready.then(() => setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 150));
  setTimeout(() => f.remove(), 60000);
}
export function printInvoice(d, fmt = defFmt()) { printDoc(invoiceHTML(d, fmt), d.invoice.invoice_no, fmt); }
export function printHTML(html, title, fmt = 'thermal') { printDoc(html, title, fmt); }

// ---------------------------------------------------------------- PDF (text, bold on thermal)
// jsPDF's built-in fonts have no rupee glyph, so the PDF uses "Rs.".
async function imgData(url) {
  try {
    const b = await (await fetch(url)).blob();
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(b); });
    const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = data; });
    return { data, ratio: im.naturalHeight / im.naturalWidth };
  } catch { return null; }
}
export function buildPdf(JsPDF, d, fmt, assets = {}) {
  const th = fmt === 'thermal', W = th ? 80 : 210, M = th ? 4 : 14, X2 = W - M, s = d.shop || {}, i = d.invoice, c = d.customer, S = cachedSettings();
  const run = doc => {
    let y = M + 3;
    const T = (txt, x, o = {}) => { doc.setFont('helvetica', o.b || th ? 'bold' : 'normal'); doc.setFontSize(o.s || (th ? 8.8 : 10)); doc.text(String(txt), x, y, { align: o.a || 'left' }); };
    const nl = (h = th ? 3.9 : 5) => { y += h; }, rule = () => { doc.setLineWidth(th ? 0.35 : 0.2); doc.line(M, y - 2, X2, y - 2); nl(2); };
    const wrapT = (txt, w, o = {}) => { doc.setFont('helvetica', o.b || th ? 'bold' : 'normal'); for (const l of doc.setFontSize(o.s || (th ? 8.8 : 10)).splitTextToSize(String(txt), w)) { T(l, o.a === 'center' ? W / 2 : M, o); nl(); } };
    const pair = (a, b, o = {}) => { T(a, M, o); T(b, X2, { ...o, a: 'right' }); nl(); };
    if (assets.logo) { const lw = th ? 56 : 70, lh = lw * assets.logo.ratio; doc.addImage(assets.logo.data, 'PNG', (W - lw) / 2, y - 3, lw, lh); y += lh + 2; }
    else wrapT(s.name || 'PALLIKKAL PHARMACY', W - 2 * M, { a: 'center', b: 1, s: th ? 12 : 16 });
    const addr = [s.address, s.city, s.pincode].filter(Boolean).join(', ');
    if (addr) wrapT(addr, W - 2 * M, { a: 'center' }); if (s.phone) wrapT('Ph: ' + s.phone, W, { a: 'center' });
    if (s.gstin && S.invoice.show_gstin !== false) wrapT('GSTIN: ' + s.gstin, W, { a: 'center' });
    const dl = licText(s.drug_licence); if (dl && S.invoice.show_drug_licence !== false) wrapT('D.L. No: ' + dl, W - 2 * M, { a: 'center' });
    wrapT(s.gstin ? 'TAX INVOICE' : 'INVOICE', W, { a: 'center', b: 1, s: th ? 10 : 12 });
    rule(); T('Bill No: ' + i.invoice_no, M, { b: 1 }); nl(); T('Date: ' + when(i.created_at), M); nl(); T('Customer: ' + (c ? `${c.name} (${c.phone})` : 'Walk-in'), M); nl(); for (const l of patientLines(i)) wrapT(l, W - 2 * M); rule();
    if (th) for (const x of d.items) {
      wrapT(`${x.name} ${x.strength || ''}`, W - 2 * M, { b: 1, s: 9.4 }); T(`Batch ${x.batch_no}  Exp ${String(x.expiry).slice(0, 7)}`, M, { s: 7.8 }); nl(3.4);
      pair(`${x.qty} x ${R(x.unit_price)}${+x.discount_pct > 0 ? ` (-${+x.discount_pct}%)` : ''}`, R(x.line_total));
    } else {
      const H = ['Item', 'Batch', 'Exp', 'Qty', 'Rate', 'GST%', 'Amount'], cx = [M, 92, 122, 146, 164, 178, X2], al = ['left', 'left', 'left', 'right', 'right', 'right', 'right'];
      H.forEach((h, k) => T(h, cx[k], { b: 1, a: al[k] })); nl(); rule();
      for (const x of d.items) {
        if (y > 270) { doc.addPage(); y = M + 3; }
        const nm = doc.splitTextToSize(`${x.name} ${x.strength || ''}`, 74), y0 = y;
        [x.batch_no, String(x.expiry).slice(0, 7), x.qty, R(x.unit_price), x.tax_rate, R(x.line_total)].forEach((v, k) => T(v, cx[k + 1], { a: al[k + 1] }));
        nm.forEach(l => { T(l, M); nl(); }); y = Math.max(y, y0 + 5);
      }
    }
    wrapT('Amounts in INR', W - 2 * M, { a: 'right', s: th ? 7.5 : 9 }); rule(); pair('Subtotal', R(i.subtotal)); if (+i.discount > 0) pair('Discount', '-' + R(i.discount)); if (+i.line_discount > 0) pair('You saved', R(i.line_discount)); pair(gstLabel(d), R(i.tax));
    pair('NET TOTAL', 'Rs. ' + R(i.total), { b: 1, s: th ? 11 : 13 }); rule();
    for (const p of d.payments) pair('Paid by ' + (PM[p.method] || p.method), R(p.amount));
    nl(1); for (const t of d.tax_summary) { T(`GST ${t.rate}%: taxable ${R(t.taxable)}, tax ${R(t.tax)}`, M, { s: th ? 7.8 : 9 }); nl(); }
    for (const x of extras()) wrapT(x, W - 2 * M, { s: th ? 7.8 : 9 });
    nl(2); wrapT(String(s.footer_note || '').trim() || THANKS_DEFAULT, W - 2 * M, { a: 'center', b: 1, s: th ? 9.4 : 11 });
    const qr = qrFor(s, S, i.total, i.invoice_no);
    if (qr) {
      try {
        const q = qrcode(0, 'M'); q.addData(qr.text, 'Byte'); q.make(); const n = q.getModuleCount(), size = th ? 26 : 30, cell = size / n, x0 = (W - size) / 2;
        doc.setFillColor(0, 0, 0); for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) doc.rect(x0 + k * cell, y + r * cell, cell, cell, 'F');
        y += size + 4; if (qr.caption) wrapT(qr.caption, W - 2 * M, { a: 'center', s: th ? 8 : 9 });
      } catch { /* no QR */ }
    }
    return y;
  };
  if (th) { const h = run(new JsPDF({ unit: 'mm', format: [W, 3000] })); const doc = new JsPDF({ unit: 'mm', format: [W, Math.max(h + 4, 60)] }); run(doc); return doc; }
  const doc = new JsPDF({ unit: 'mm', format: 'a4' }); run(doc); return doc;
}
export async function downloadPDF(d, fmt = defFmt()) {
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
  const lg = logoSrc(cachedSettings(), fmt === 'thermal');
  buildPdf(jsPDF, d, fmt, { logo: lg ? await imgData(lg) : null }).save(`${d.invoice.invoice_no}-${fmt}.pdf`);
}
export function showInvoice(d, onClose, extra = {}) {
  const dlg = document.createElement('dialog');
  const canWa = typeof extra.whatsapp === 'function' && !!String(d.customer?.phone || d.invoice?.patient_phone || '').replace(/\D/g, '');
  dlg.innerHTML = `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-bottom:.5rem"><select id="fm"><option value="thermal">Thermal 80mm</option><option value="a4"${defFmt() === 'a4' ? ' selected' : ''}>A4</option></select>
  <button id="pr">Print</button><button id="pd" class="sec">Download PDF</button>${canWa ? '<button id="wa" class="sec inv-wa" style="background:#12a01b;color:#fff;border-color:#12a01b">Send on WhatsApp</button>' : ''}<button id="cl" class="sec">Close</button>
  ${canWa ? `<span id="was" role="status" style="font-size:.85rem;color:#0f7a16">${e(extra.status || '')}</span>` : ''}</div><div id="pv" style="overflow:auto;max-height:72vh;background:#fff"></div>`;
  document.body.appendChild(dlg); const q = s => dlg.querySelector(s), fmt = () => q('#fm').value, draw = () => { q('#pv').innerHTML = invoiceHTML(d, fmt()); };
  q('#fm').onchange = draw; q('#pr').onclick = () => printInvoice(d, fmt()); q('#pd').onclick = () => downloadPDF(d, fmt());
  if (canWa) q('#wa').onclick = () => extra.whatsapp(d, m => { q('#was').textContent = m; });
  q('#cl').onclick = () => { dlg.close(); dlg.remove(); onClose?.(); }; draw(); dlg.showModal();
}

// ---------------------------------------------------------------- return bills
// d = return_detail(): { kind: 'sales'|'purchase', shop, note, items, customer | distributor, invoice_no, invoice_date }
// note.reason_label: reason text prepared by the Returns page.
const REFUND = { cash: 'Cash', upi: 'UPI', card: 'Card', reduce_dues: 'Adjusted against dues', credit: 'Adjusted against dues' };
export function returnBillHTML(d, fmt = 'thermal', S = cachedSettings()) {
  const th = fmt === 'thermal', s = d.shop || {}, n = d.note || {}, sales = d.kind !== 'purchase';
  const title = sales ? 'SALES RETURN BILL' : 'PURCHASE RETURN BILL', sub = sales ? 'Credit note' : 'Debit note';
  const rate = x => +x.unit_price > 0 ? +x.unit_price : (+x.qty ? (+x.line_total || 0) / +x.qty : 0);
  const ds = d.distributor || {}, c = d.customer;
  const party = sales
    ? `<div>Customer: ${c ? e(c.name) + (c.phone ? ' (' + e(c.phone) + ')' : '') : 'Walk-in'}</div>`
    : `<div>To: <b>${e(ds.name || '')}</b></div>${ds.address ? `<div class="sm">${e(ds.address)}</div>` : ''}${ds.phone ? `<div class="sm">Ph: ${e(ds.phone)}</div>` : ''}${ds.gstin ? `<div class="sm">GSTIN: ${e(ds.gstin)}</div>` : ''}${ds.drug_licence ? `<div class="sm">D.L. No: ${e(licText(ds.drug_licence))}</div>` : ''}`;
  const info = `<div>Return No: <b>${e(n.return_no || '')}</b> <span class="sm">(${sub})</span></div><div>Date: ${e(when(n.created_at))}</div>
    <div>${sales ? 'Against bill' : 'Against supplier invoice'}: <b>${e(d.invoice_no || '—')}</b>${d.invoice_date ? ` <span class="sm">dated ${e(fmtDateWith(d.invoice_date, S.general.date_format))}</span>` : ''}</div>
    ${party}${n.reason_label || n.reason ? `<div>Reason: ${e(n.reason_label || n.reason)}</div>` : ''}<hr>`;
  const items = d.items || [];
  const lines = th
    ? `<div class="r sm"><span>Item · Qty x Rate</span><span>Amount</span></div><hr>` + items.map((x, k) => `<div class="it"><div class="nm">${k + 1}. ${e(x.name)} ${e(x.strength || '')}</div>
        <div class="sm">${x.batch_no ? `Batch ${e(x.batch_no)}` : ''}${x.expiry ? ` · Exp ${e(String(x.expiry).slice(0, 7))}` : ''}${sales && x.disposition ? ` · ${x.disposition === 'damaged' ? 'Damaged' : 'Back to stock'}` : ''}</div>
        <div class="r"><span>${+x.qty} x ${R(rate(x))}</span><span>${R(x.line_total)}</span></div></div>`).join('')
    : `<table><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr>${items.map((x, k) => `<tr><td>${k + 1}</td><td>${e(x.name)} ${e(x.strength || '')}</td><td>${e(x.batch_no || '')}</td><td>${e(String(x.expiry || '').slice(0, 7))}</td><td class="n">${+x.qty}</td><td class="n">${R(rate(x))}</td><td class="n">${R(x.line_total)}</td></tr>`).join('')}</table>`;
  const qty = items.reduce((a, x) => a + (+x.qty || 0), 0);
  const row = (a, b, cls = '') => `<div class="r ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const tot = `<hr>${row(`Items: ${items.length}`, `Qty: ${qty}`, 'sm')}${+n.tax ? row('GST included', R(n.tax)) : ''}${row(sales ? 'REFUND TOTAL' : 'RETURN VALUE', '₹' + R(n.total), 'tot')}
    ${sales && n.refund_method ? row(n.refund_type === 'exchange' ? 'Exchange value' : 'Refund by', e(REFUND[n.refund_method] || n.refund_method)) : ''}
    ${!sales ? '<div class="sm" style="margin-top:3px">Value credited against this distributor (payables).</div>' : ''}<hr>
    <div class="r sm" style="margin-top:${th ? 18 : 30}px"><span>${sales ? 'Customer' : 'Received by (distributor)'}<br>__________________</span><span>For ${e(s.name || 'Pallikkal Pharmacy')}<br>__________________</span></div>`;
  return wrap(th, shopHeader(s, S, th, title) + info + lines + tot + (sales ? shopFooter(s, S, null) : ''));
}
export function showReturnBill(d, { auto = false } = {}) {
  const dlg = document.createElement('dialog'), title = d.kind === 'purchase' ? 'Purchase return bill' : 'Sales return bill';
  dlg.className = 'pp-print-dlg';
  dlg.innerHTML = `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-bottom:.5rem"><b style="margin-right:auto">${title} ${e(d.note?.return_no || '')}</b>
    <select id="rfm" aria-label="Paper"><option value="thermal">Thermal 80mm</option><option value="a4"${defFmt() === 'a4' ? ' selected' : ''}>A4</option></select>
    <button id="rpr">Print</button><button id="rcl" class="sec">Close</button></div><div id="rpv" style="overflow:auto;max-height:72vh;background:#fff"></div>`;
  document.body.appendChild(dlg);
  const q = s => dlg.querySelector(s), fmt = () => q('#rfm').value, draw = () => { q('#rpv').innerHTML = returnBillHTML(d, fmt()); };
  q('#rfm').onchange = draw; q('#rpr').onclick = () => printDoc(returnBillHTML(d, fmt()), d.note?.return_no || title, fmt());
  q('#rcl').onclick = () => { dlg.close(); dlg.remove(); }; draw(); dlg.showModal();
  if (auto) q('#rpr').focus();
  return dlg;
}
// Older names kept for pages that still use them.
export const creditNoteHTML = d => returnBillHTML({ ...d, kind: 'sales' }, 'thermal');
export const showCreditNote = d => showReturnBill({ ...d, kind: 'sales' });

// ---------------------------------------------------------------- all bills of a day (80 mm roll)
// layout 'full': every bill in full, one after another, with a cut line between bills.
// layout 'list': one line per bill. summary (admins): bill count and totals by payment method.
export function dayBillsHTML(bills, { date, layout = 'full', summary = false, fmt = 'thermal', S = cachedSettings() } = {}) {
  const th = fmt === 'thermal', shop = bills[0]?.shop || {};
  const day = fmtDateWith(date, S.general.date_format);
  const live = bills.filter(b => !b.invoice.status || b.invoice.status === 'final');
  const pay = {}; let total = 0, items = 0;
  for (const b of live) { total += +b.invoice.total || 0; items += (b.items || []).length; for (const p of b.payments || []) pay[p.method] = (pay[p.method] || 0) + (+p.amount || 0); }
  const row = (a, b, cls = '') => `<div class="r ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const sum = summary ? `<div class="ttl c">DAY SUMMARY</div>${row('Bills', live.length)}${row('Items sold', items)}${Object.entries(pay).map(([m, v]) => row(PM[m] || e(m), R(v))).join('')}${row('TOTAL SALES', '₹' + R(total), 'tot')}<hr>` : '';
  const head = `${shopHeader(shop, S, th, 'ALL BILLS')}<div class="c"><b>${e(day)}</b> · ${live.length} bill${live.length === 1 ? '' : 's'}</div><div class="c sm">Printed ${e(when(new Date().toISOString()))}</div><hr>`;
  if (!bills.length) return wrap(th, head + '<div class="c">No bills on this day.</div>');
  if (layout === 'list') {
    const body = `<table><tr><th>#</th><th>Bill No · Time</th><th>Customer</th><th class="n">Amount</th></tr>${bills.map((b, k) => {
      const i = b.invoice, cust = b.customer?.name || i.patient_name || 'Walk-in', m = (b.payments || []).map(p => PM[p.method] || p.method).join('+');
      return `<tr><td>${k + 1}</td><td><b>No. ${e(String(i.invoice_no).slice(-4))}</b><br><span class="sm">${e(fmtTimeWith(i.created_at, S.general.time_format))}</span>${i.status && i.status !== 'final' ? '<br>CANCELLED' : ''}</td><td>${e(cust)}<br><span class="sm">${(b.items || []).length} item(s) · ${e(m)}</span></td><td class="n">${R(i.total)}</td></tr>`;
    }).join('')}</table><hr>`;
    return wrap(th, head + body + sum);
  }
  const body = bills.map((b, k) => `<div class="c sm" style="margin:${k ? 8 : 2}px 0 4px">====== BILL ${k + 1} OF ${bills.length} ======</div>${billBody(b, th, S, true)}`).join('');
  return wrap(th, head + body + sum + `<div class="c sm">End of bills · ${e(day)}</div>`);
}
