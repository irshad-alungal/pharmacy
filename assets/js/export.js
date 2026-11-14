// PDF and Excel export for any report. Libraries are passed in (jsPDF / ExcelJS) so this file is testable without a browser.
const IN = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '')); return m ? `${m[3]}-${MON[+m[2] - 1]}-${m[1]}` : String(v ?? ''); };
export const fmt = (c, v) => v === null || v === undefined || v === '' ? '' : c.t === 'money' ? IN.format(+v) : c.t === 'qty' ? String(+(+v).toFixed(3)) : c.t === 'int' ? String(Math.round(+v)) : c.t === 'pct' ? `${+v}%` : c.t === 'date' ? fmtDate(v) : String(v);
export const totalsOf = (def, rows) => def.cols.map(c => c.sum ? Math.round(rows.reduce((a, r) => a + (+r[c.k] || 0), 0) * 1000) / 1000 : null);
const numeric = c => c.t !== 'text' && c.t !== 'date';
export const fileName = (def, meta, ext) => `${def.id}-${meta.stamp}.${ext}`;

export function buildPdf(JsPDF, def, rows, meta) {
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: def.cols.length > 6 ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12, tw = W - 2 * M, tot = def.cols.reduce((a, c) => a + (c.w || 1), 0);
  const cw = def.cols.map(c => (c.w || 1) / tot * tw), cx = []; cw.reduce((a, w, i) => (cx[i] = a, a + w), M);
  const txt = (s, x, y, o = {}) => { doc.setFont('helvetica', o.b ? 'bold' : 'normal'); doc.setFontSize(o.s || 8.5); doc.text(String(s), x, y, { align: o.a || 'left' }); };
  let y;
  const thead = () => {
    doc.setFillColor(15, 118, 110); doc.rect(M, y - 4.2, tw, 6.4, 'F'); doc.setTextColor(255);
    def.cols.forEach((c, i) => { const l = doc.splitTextToSize(c.l, cw[i] - 2)[0]; numeric(c) ? txt(l, cx[i] + cw[i] - 1, y, { b: 1, a: 'right' }) : txt(l, cx[i] + 1, y, { b: 1 }); });
    doc.setTextColor(0); y += 5.5;
  };
  const first = () => {
    y = M + 4; txt(meta.shop, M, y, { b: 1, s: 14 }); y += 6; txt(def.title, M, y, { b: 1, s: 11 }); y += 5; txt(meta.subtitle, M, y, { s: 9 }); txt('Generated ' + meta.generated, W - M, y, { s: 8, a: 'right' }); y += 4;
    if (def.note) { doc.setTextColor(90); for (const l of doc.setFontSize(7.5).splitTextToSize(def.note, tw)) { y += 3.2; txt(l, M, y, { s: 7.5 }); } doc.setTextColor(0); }
    y += 6; thead();
  };
  const next = () => { doc.addPage(); y = M + 3; txt(def.title + ' (continued)', M, y, { b: 1, s: 9 }); y += 6; thead(); };
  first(); let z = 0;
  for (const r of rows) {
    const cells = def.cols.map((c, i) => c.t === 'text' ? doc.setFontSize(8.5).splitTextToSize(fmt(c, r[c.k]), cw[i] - 2) : [fmt(c, r[c.k])]), h = Math.max(...cells.map(a => a.length)) * 3.7 + 1.8;
    if (y + h > H - M - 8) next();
    if (z++ % 2) { doc.setFillColor(243, 247, 246); doc.rect(M, y - 3.6, tw, h, 'F'); }
    cells.forEach((lines, i) => lines.forEach((l, k) => numeric(def.cols[i]) ? txt(l, cx[i] + cw[i] - 1, y + k * 3.7, { a: 'right', b: r.style === 'b' }) : txt(l, cx[i] + 1, y + k * 3.7, { b: r.style === 'b' })));
    y += h;
  }
  if (!rows.length) { txt('No data for the selected filters.', M + 1, y + 2); y += 8; }
  const T = totalsOf(def, rows);
  if (rows.length && T.some(v => v !== null)) {
    if (y + 8 > H - M - 8) next(); doc.line(M, y - 3, W - M, y - 3); txt('TOTAL', cx[0] + 1, y, { b: 1 });
    def.cols.forEach((c, i) => { if (T[i] !== null) txt(fmt(c, T[i]), cx[i] + cw[i] - 1, y, { b: 1, a: 'right' }); }); y += 6;
  }
  txt(`${rows.length} row${rows.length === 1 ? '' : 's'}`, M, y + 2, { s: 7.5 });
  const n = doc.getNumberOfPages(); for (let p = 1; p <= n; p++) { doc.setPage(p); txt(`Page ${p} of ${n}`, W / 2, H - 6, { a: 'center', s: 8 }); }
  return doc;
}

export function buildXlsx(ExcelJS, def, rows, meta) {
  const wb = new ExcelJS.Workbook(); wb.creator = meta.shop; wb.created = new Date();
  const ws = wb.addWorksheet(def.title.replace(/[\\/?*[\]:]/g, '-').slice(0, 31));
  ws.addRow([meta.shop]).font = { bold: true, size: 14 }; ws.addRow([def.title]).font = { bold: true, size: 12 }; ws.addRow([meta.subtitle]); ws.addRow(['Generated ' + meta.generated]);
  if (def.note) ws.addRow([def.note]).font = { italic: true, color: { argb: 'FF666666' } }; ws.addRow([]);
  const hr = ws.addRow(def.cols.map(c => c.l));
  hr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
  const first = hr.number + 1, FM = { money: '#,##0.00;[Red]-#,##0.00', qty: '#,##0.###', int: '#,##0', pct: '0.##"%"', date: 'dd-mmm-yyyy' };
  for (const r of rows) {
    const row = ws.addRow(def.cols.map(c => { const v = r[c.k]; if (v === null || v === undefined || v === '') return null; return c.t === 'date' ? new Date(String(v).slice(0, 10) + 'T00:00:00Z') : numeric(c) ? +v : String(v); }));
    def.cols.forEach((c, i) => { if (FM[c.t]) row.getCell(i + 1).numFmt = FM[c.t]; }); if (r.style === 'b') row.font = { bold: true };
  }
  const last = ws.rowCount, T = totalsOf(def, rows);
  if (rows.length && T.some(v => v !== null)) {
    const tr = ws.addRow(def.cols.map((c, i) => i === 0 ? 'TOTAL' : T[i] === null ? null : { formula: `SUM(${ws.getColumn(i + 1).letter}${first}:${ws.getColumn(i + 1).letter}${last})`, result: T[i] }));
    tr.font = { bold: true }; tr.eachCell(c => { c.border = { top: { style: 'thin' } }; }); def.cols.forEach((c, i) => { if (FM[c.t]) tr.getCell(i + 1).numFmt = FM[c.t]; });
  }
  def.cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(12, Math.round((c.w || 1) * 9), c.l.length + 2)); });
  ws.views = [{ state: 'frozen', ySplit: hr.number }];
  if (rows.length) ws.autoFilter = { from: { row: hr.number, column: 1 }, to: { row: last, column: def.cols.length } };
  return wb;
}
const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
export async function downloadPdf(def, rows, meta) { const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm'); save(new Blob([buildPdf(jsPDF, def, rows, meta).output('arraybuffer')], { type: 'application/pdf' }), fileName(def, meta, 'pdf')); }
export async function loadExcelJS() {
  if (window.ExcelJS) return window.ExcelJS;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel library')); document.head.appendChild(s); });
  return window.ExcelJS;
}
export async function downloadXlsx(def, rows, meta) { const E = await loadExcelJS(); const buf = await buildXlsx(E, def, rows, meta).xlsx.writeBuffer(); save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName(def, meta, 'xlsx')); }
