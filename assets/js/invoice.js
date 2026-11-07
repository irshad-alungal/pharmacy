// Invoice rendering. Input is the JSON from the invoice_detail() database function (no shelf, no purchase price).
const R = n => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+n || 0);
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = d => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const PM = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit (due)' };
export function invoiceHTML(d, fmt = 'thermal') {
  const th = fmt === 'thermal', s = d.shop || {}, i = d.invoice, c = d.customer;
  const head = `<div style="text-align:center"><b style="font-size:${th ? 14 : 20}px">${e(s.name)}</b><br>${e(s.address || '')}${s.phone ? '<br>Ph: ' + e(s.phone) : ''}${s.gstin ? '<br>GSTIN: ' + e(s.gstin) : ''}${s.drug_licence ? '<br>Drug Licence: ' + e(s.drug_licence) : ''}</div><hr>
  <div>Invoice: <b>${e(i.invoice_no)}</b><br>Date: ${e(when(i.created_at))}<br>Customer: ${c ? e(c.name) + ' (' + e(c.phone) + ')' : 'Walk-in'}</div><hr>`;
  const items = th
    ? d.items.map(x => `<div><b>${e(x.name)} ${e(x.strength || '')}</b><br><span style="font-size:10px">Batch ${e(x.batch_no)} · Exp ${e(String(x.expiry).slice(0, 7))}</span><div style="display:flex;justify-content:space-between"><span>${x.qty} x ${R(x.unit_price)}</span><span>${R(x.line_total)}</span></div></div>`).join('')
    : `<table style="width:100%;border-collapse:collapse"><tr style="border-bottom:1px solid #000;text-align:left"><th>Item</th><th>Batch</th><th>Exp</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">GST%</th><th style="text-align:right">Amount</th></tr>${d.items.map(x => `<tr><td>${e(x.name)} ${e(x.strength || '')}</td><td>${e(x.batch_no)}</td><td>${e(String(x.expiry).slice(0, 7))}</td><td style="text-align:right">${x.qty}</td><td style="text-align:right">${R(x.unit_price)}</td><td style="text-align:right">${x.tax_rate}</td><td style="text-align:right">${R(x.line_total)}</td></tr>`).join('')}</table>`;
  const row = (a, b, bold) => `<div style="display:flex;justify-content:space-between;${bold ? 'font-weight:bold;font-size:' + (th ? 13 : 16) + 'px' : ''}"><span>${a}</span><span>${b}</span></div>`;
  const tot = `<hr>${row('Subtotal', R(i.subtotal))}${+i.discount > 0 ? row('Discount', '-' + R(i.discount)) : ''}${row('GST included', R(i.tax))}${row('TOTAL', '₹' + R(i.total), true)}<hr>
  ${d.payments.map(p => row(PM[p.method] || e(p.method), R(p.amount))).join('')}
  <div style="margin-top:6px;font-size:${th ? 10 : 12}px">${d.tax_summary.map(t => `GST ${t.rate}%: taxable ${R(t.taxable)}, tax ${R(t.tax)}`).join('<br>')}</div>
  <div style="text-align:center;margin-top:8px">${e(s.footer_note || '')}</div>`;
  return `<div style="${th ? 'width:72mm;font:11px/1.35 monospace' : 'width:190mm;font:13px/1.45 Arial,sans-serif'};color:#000;background:#fff;padding:2mm">${head}${items}${tot}</div>`;
}
export function printInvoice(d, fmt) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
  const doc = f.contentDocument; doc.open();
  doc.write(`<!doctype html><title>${e(d.invoice.invoice_no)}</title><style>@page{size:${fmt === 'thermal' ? '80mm auto' : 'A4'};margin:${fmt === 'thermal' ? '3mm' : '12mm'}}body{margin:0}</style>${invoiceHTML(d, fmt)}`); doc.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 250); setTimeout(() => f.remove(), 60000);
}
// PDF is drawn with text (searchable). jsPDF's built-in fonts have no rupee glyph, so the PDF uses "Rs.".
export function buildPdf(JsPDF, d, fmt) {
  const th = fmt === 'thermal', W = th ? 80 : 210, M = th ? 4 : 14, X2 = W - M, s = d.shop || {}, i = d.invoice, c = d.customer;
  const run = doc => {
    let y = M + 3;
    const T = (txt, x, o = {}) => { doc.setFont('helvetica', o.b ? 'bold' : 'normal'); doc.setFontSize(o.s || (th ? 8 : 10)); doc.text(String(txt), x, y, { align: o.a || 'left' }); };
    const nl = (h = th ? 3.6 : 5) => { y += h; }, rule = () => { doc.line(M, y - 2, X2, y - 2); nl(2); };
    const wrap = (txt, w, o = {}) => { for (const l of doc.setFontSize(o.s || (th ? 8 : 10)).splitTextToSize(String(txt), w)) { T(l, o.a === 'center' ? W / 2 : M, o); nl(); } };
    const pair = (a, b, o = {}) => { T(a, M, o); T(b, X2, { ...o, a: 'right' }); nl(); };
    const money = n => 'Rs.' + R(n);
    wrap(s.name || 'ALZA PHARMACY', W - 2 * M, { a: 'center', b: 1, s: th ? 12 : 16 });
    if (s.address) wrap(s.address, W - 2 * M, { a: 'center' }); if (s.phone) wrap('Ph: ' + s.phone, W, { a: 'center' });
    if (s.gstin) wrap('GSTIN: ' + s.gstin, W, { a: 'center' }); if (s.drug_licence) wrap('Drug Licence: ' + s.drug_licence, W, { a: 'center' });
    rule(); T('Invoice: ' + i.invoice_no, M, { b: 1 }); nl(); T('Date: ' + when(i.created_at), M); nl(); T('Customer: ' + (c ? `${c.name} (${c.phone})` : 'Walk-in'), M); nl(); rule();
    if (th) for (const x of d.items) {
      wrap(`${x.name} ${x.strength || ''}`, W - 2 * M, { b: 1 }); T(`Batch ${x.batch_no}  Exp ${String(x.expiry).slice(0, 7)}`, M, { s: 7 }); nl(3);
      pair(`${x.qty} x ${R(x.unit_price)}`, R(x.line_total));
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
    rule(); pair('Subtotal', money(i.subtotal)); if (+i.discount > 0) pair('Discount', '-' + money(i.discount)); pair('GST included', money(i.tax));
    pair('TOTAL', money(i.total), { b: 1, s: th ? 10 : 13 }); rule();
    for (const p of d.payments) pair(PM[p.method] || p.method, money(p.amount));
    nl(1); for (const t of d.tax_summary) { T(`GST ${t.rate}%: taxable ${R(t.taxable)}, tax ${R(t.tax)}`, M, { s: th ? 7 : 9 }); nl(); }
    nl(2); if (s.footer_note) wrap(s.footer_note, W - 2 * M, { a: 'center' });
    return y;
  };
  if (th) { const h = run(new JsPDF({ unit: 'mm', format: [W, 3000] })); const doc = new JsPDF({ unit: 'mm', format: [W, Math.max(h + 4, 60)] }); run(doc); return doc; }
  const doc = new JsPDF({ unit: 'mm', format: 'a4' }); run(doc); return doc;
}
export async function downloadPDF(d, fmt) {
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
  buildPdf(jsPDF, d, fmt).save(`${d.invoice.invoice_no}-${fmt}.pdf`);
}
export function showInvoice(d, onClose) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem"><select id="fm"><option value="thermal">Thermal 80mm</option><option value="a4">A4</option></select>
  <button id="pr">Print</button><button id="pd" class="sec">Download PDF</button><button id="cl" class="sec">Close</button></div><div id="pv" style="overflow:auto;max-height:72vh;background:#fff"></div>`;
  document.body.appendChild(dlg); const q = s => dlg.querySelector(s), fmt = () => q('#fm').value, draw = () => { q('#pv').innerHTML = invoiceHTML(d, fmt()); };
  q('#fm').onchange = draw; q('#pr').onclick = () => printInvoice(d, fmt()); q('#pd').onclick = () => downloadPDF(d, fmt());
  q('#cl').onclick = () => { dlg.close(); dlg.remove(); onClose?.(); }; draw(); dlg.showModal();
}

// ---- Credit note (sales return). Same rule as invoices: no shelf, no purchase price.
export function printHTML(html, title, fmt = 'thermal') {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
  const doc = f.contentDocument; doc.open(); doc.write(`<!doctype html><title>${e(title)}</title><style>@page{size:${fmt === 'thermal' ? '80mm auto' : 'A4'};margin:3mm}body{margin:0}</style>${html}`); doc.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 250); setTimeout(() => f.remove(), 60000);
}
export function creditNoteHTML(d) {
  const s = d.shop || {}, n = d.note, c = d.customer, M = { cash: 'Cash', upi: 'UPI', card: 'Card', reduce_dues: 'Adjusted against dues' };
  return `<div style="width:72mm;font:11px/1.35 monospace;color:#000;background:#fff;padding:2mm"><div style="text-align:center"><b style="font-size:14px">${e(s.name)}</b><br>${e(s.address || '')}${s.phone ? '<br>Ph: ' + e(s.phone) : ''}${s.gstin ? '<br>GSTIN: ' + e(s.gstin) : ''}${s.drug_licence ? '<br>Drug Licence: ' + e(s.drug_licence) : ''}<br><b>CREDIT NOTE</b></div><hr>
  Note: <b>${e(n.return_no)}</b><br>Date: ${e(when(n.created_at))}<br>Against invoice: ${e(d.invoice_no)}<br>Customer: ${c ? e(c.name) + ' (' + e(c.phone) + ')' : 'Walk-in'}<br>Reason: ${e(n.reason)}<hr>
  ${d.items.map(x => `<div><b>${e(x.name)} ${e(x.strength || '')}</b><br><span style="font-size:10px">Batch ${e(x.batch_no)}</span><div style="display:flex;justify-content:space-between"><span>Qty ${x.qty}</span><span>${R(x.line_total)}</span></div></div>`).join('')}<hr>
  <div style="display:flex;justify-content:space-between"><span>GST included</span><span>${R(n.tax)}</span></div><div style="display:flex;justify-content:space-between;font-weight:bold;font-size:13px"><span>REFUND</span><span>₹${R(n.total)}</span></div>
  <div>Refund via: ${e(M[n.refund_method] || n.refund_method)}</div></div>`;
}
export function showCreditNote(d) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div style="display:flex;gap:.5rem;margin-bottom:.5rem"><button id="pr">Print</button><button id="cl" class="sec">Close</button></div><div style="overflow:auto;max-height:72vh;background:#fff">${creditNoteHTML(d)}</div>`;
  document.body.appendChild(dlg); dlg.querySelector('#pr').onclick = () => printHTML(creditNoteHTML(d), d.note.return_no); dlg.querySelector('#cl').onclick = () => { dlg.close(); dlg.remove(); }; dlg.showModal();
}
