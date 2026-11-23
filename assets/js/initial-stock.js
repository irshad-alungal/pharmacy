// Inventory → Initial (opening) stock. Administrators enter the stock that was on the shelves when the
// pharmacy started using the system: by hand or from Excel, saved as a draft, then confirmed once.
// v78: GST % (shown in billing as entered), optional Distributor, type-ahead suggestions for medicine and
// distributor names, sized columns, and every column in the Excel template.
// Unit price for billing = Srate (MRP per pack) ÷ pack. GST is not added on top (MRP includes GST).
import { sb, esc } from './supabase-client.js';
import { friendly } from './ui.js';
import { attachSuggest, matchNames } from './suggest.js';

// Column order on screen and in Excel.
const COLS = [
  ['serial', 'Sl No', 'sl no'], ['item', 'Item Name', 'item name'], ['distributor', 'Distributor', 'distributor'], ['batch', 'Batch', 'batch'],
  ['pack', 'Pack', 'pack'], ['qty', 'Qty', 'qty'], ['exp', 'Exp', 'exp'], ['srate', 'Srate', 'srate'], ['prate', 'Prate', 'prate'],
  ['urate', 'Urate', 'urate'], ['gst', 'GST %', 'gst %']
];
const HEADERS = COLS.map(c => c[1]);
// Older templates and common spellings that are still accepted when uploading.
const ALIASES = { serial: ['sl no', 'sl.no', 'slno', 'serial', 's no'], item: ['item name', 'item', 'medicine', 'medicine name'], distributor: ['distributor', 'royal distributor', 'supplier', 'distributor name'],
  batch: ['batch', 'batch no', 'batch no.'], pack: ['pack', 'pack size'], qty: ['qty', 'quantity', 'qty (packs)'], exp: ['exp', 'expiry', 'expiry date'],
  srate: ['srate', 'mrp', 'mrp per pack', 'sales rate'], prate: ['prate', 'purchase rate', 'purchase rate per pack'], urate: ['urate', 'unit mrp', 'unit rate'], gst: ['gst %', 'gst', 'gst%', 'tax', 'tax %'] };
const ADMIN_ROLES = ['super_admin', 'admin'];

const toDate = value => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  if (typeof value === 'number' && window.XLSX?.SSF) {
    const d = window.XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{4})$/);            // MM/YYYY → last day of the month
  if (m) { const y = +m[2], mo = +m[1]; const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return `${y}-${String(mo).padStart(2, '0')}-${last}`; }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};
const num = v => v === '' || v === null || v === undefined ? NaN : Number(String(v).replace(/,/g, '').replace(/%$/, '').trim());
const round4 = n => Math.round((n + Number.EPSILON) * 10000) / 10000;
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

export async function mountInitialStock(panel, prof) {
  if (!ADMIN_ROLES.includes(String(prof?.role || '').toLowerCase())) {
    panel.innerHTML = '<p class="notice">Only Admin and Super Admin can enter the initial stock.</p>';
    return;
  }
  const needExcel = () => {
    if (window.XLSX) return true;
    alert('The Excel reader did not load. Check your internet connection and refresh the page. You can still enter rows manually.');
    return false;
  };

  let medicines = [], distributors = [], rows = [], saved = null, busy = false, has37 = true;
  const submitted = () => (saved?.status || '') === 'submitted';
  const msg = (text, kind = '') => { const el = panel.querySelector('#os-msg'); if (el) { el.textContent = text; el.className = `os-status ${kind}`; } };
  const loadMasters = async () => {
    const [m, d] = await Promise.all([
      sb.from('medicines').select('id,name,strength,mrp,selling_price,active,tax_rate').eq('branch_id', prof.branch_id).eq('active', true).order('name').limit(10000),
      sb.from('distributors').select('id,name,active').eq('branch_id', prof.branch_id).order('name').limit(5000)
    ]);
    if (m.error) throw m.error;
    medicines = m.data || []; distributors = (d.data || []).filter(x => x.active !== false);
  };
  const fromItem = (x, i) => ({
    serial: x.serial_no ?? i + 1, item: x.medicine_name || medicines.find(m => m.id === x.medicine_id)?.name || '', medicine_id: x.medicine_id,
    distributor: x.distributor_name || distributors.find(d => d.id === x.distributor_id)?.name || '',
    batch: x.batch_no || '', pack: x.pack_size ?? 1, qty: x.pack_qty ?? x.qty ?? '', exp: toDate(x.expiry),
    srate: x.srate ?? x.mrp ?? '', prate: x.prate ?? (Number(x.unit_cost || 0) * Number(x.pack_size || 1)), urate: x.urate ?? x.mrp ?? '',
    gst: x.tax_rate ?? '', batch_id: x.batch_id || null
  });
  const loadDraft = async () => {
    const { data, error } = await sb.rpc('opening_stock_get_draft');
    if (error) throw error;
    saved = data || null;
    has37 = !saved?.items?.length || 'tax_rate' in saved.items[0];
    rows = (saved?.items || []).map(fromItem);
  };
  const template = () => {
    if (!needExcel()) return;
    const X = window.XLSX, wb = X.utils.book_new();
    const samples = [[1, 'Paracetamol 500 mg', 'Bismik Medical Agencies', 'PCM001', 10, 20, '31-12-2027', 50, 35, 5, 12],
                     [2, 'Vitamin C 500 mg', '', 'VC2209', 15, 4, '30-06-2027', 120, 90, 8, 5]];
    const ws = X.utils.aoa_to_sheet([HEADERS, ...samples]);
    ws['!cols'] = [6, 30, 26, 14, 7, 7, 13, 9, 9, 9, 8].map(wch => ({ wch }));
    X.utils.book_append_sheet(wb, ws, 'Initial Stock');
    const guide = [['Column', 'What to enter'],
      ['Sl No', 'Serial number (optional)'],
      ['Item Name', 'Medicine name (required). A new name is added to Medicines automatically.'],
      ['Distributor', 'Optional. Supplier of this stock. A new name is added to Distributors.'],
      ['Batch', 'Batch number (required)'],
      ['Pack', 'Units in one strip / pack (required, e.g. 10 tablets)'],
      ['Qty', 'Number of packs (required)'],
      ['Exp', 'Expiry date: DD-MM-YYYY, MM/YYYY or an Excel date (required)'],
      ['Srate', 'MRP per pack (required)'],
      ['Prate', 'Purchase rate per pack (required, 0 if not known)'],
      ['Urate', 'Unit MRP = Srate ÷ Pack (optional — worked out if empty). This is the price per unit in billing.'],
      ['GST %', 'GST percentage (required, 0 if none). Shown in billing as entered; not added to the price.'],
      ['Stock', 'Units added = Pack × Qty']];
    const g = X.utils.aoa_to_sheet(guide); g['!cols'] = [{ wch: 14 }, { wch: 95 }];
    X.utils.book_append_sheet(wb, g, 'How to fill');
    X.writeFile(wb, 'PALLIKKAL_Initial_Stock_Template.xlsx');
  };
  const medicineFor = async name => {
    const key = name.trim().toLocaleLowerCase();
    const found = medicines.find(m => m.name.trim().toLocaleLowerCase() === key);
    if (found) return found;
    const { data, error } = await sb.from('medicines').insert({ branch_id: prof.branch_id, name: name.trim(), mrp: 0, selling_price: 0, tax_rate: 0, price_includes_tax: true, active: true })
      .select('id,name,strength,mrp,selling_price,active,tax_rate').single();
    if (error) throw new Error(`Could not add medicine "${name}": ${friendly(error)}`);
    medicines.push(data);
    return data;
  };
  const parseWorkbook = async file => {
    if (!window.XLSX) throw new Error('The Excel reader did not load. Check your internet connection and refresh the page.');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('The Excel file has no worksheet.');
    const raw = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    if (!raw.length) throw new Error('The worksheet is empty.');
    const head = raw[0].map(v => String(v ?? '').trim().toLowerCase());
    const idx = Object.fromEntries(Object.entries(ALIASES).map(([k, names]) => [k, head.findIndex(h => names.includes(h))]));
    const need = ['item', 'batch', 'pack', 'qty', 'exp', 'srate', 'prate', 'gst'];
    const missing = need.filter(k => idx[k] < 0).map(k => COLS.find(c => c[0] === k)[1]);
    if (missing.length) throw new Error(`These columns are missing: ${missing.join(', ')}. Download the template and use its headings: ${HEADERS.join(', ')}.`);
    const out = [];
    for (let i = 1; i < raw.length; i++) {
      const cells = raw[i];
      if (!cells.some(v => String(v ?? '').trim() !== '')) continue;
      const get = k => idx[k] >= 0 ? cells[idx[k]] : '';
      const n = i + 1, item = String(get('item') ?? '').trim();
      if (!item) throw new Error(`Row ${n}: Item Name is required.`);
      const pack = num(get('pack')), qty = num(get('qty')), srate = num(get('srate')), prate = num(get('prate')), gst = num(get('gst')), exp = toDate(get('exp'));
      if (!(pack > 0)) throw new Error(`Row ${n}: Pack must be more than zero.`);
      if (!(qty > 0)) throw new Error(`Row ${n}: Qty must be more than zero.`);
      if (!exp) throw new Error(`Row ${n}: Exp is not a valid date.`);
      if (!(srate >= 0) || !(prate >= 0)) throw new Error(`Row ${n}: Srate and Prate must be 0 or more.`);
      if (!(gst >= 0 && gst <= 100)) throw new Error(`Row ${n}: GST % is required (0 to 100; enter 0 if none).`);
      const urate = round4(srate / pack), given = num(get('urate'));
      if (Number.isFinite(given) && Math.abs(given - urate) > 0.02) throw new Error(`Row ${n}: Urate should be Srate ÷ Pack = ${urate}.`);
      const batch = String(get('batch') ?? '').trim();
      if (!batch) throw new Error(`Row ${n}: Batch is required.`);
      out.push({ serial: get('serial') || out.length + 1, item, distributor: String(get('distributor') ?? '').trim(), batch, pack, qty, exp, srate, prate, urate, gst, medicine_id: null, batch_id: null });
    }
    if (!out.length) throw new Error('No stock rows were found below the heading row.');
    if (out.length > 2000) throw new Error('Up to 2,000 rows per upload.');
    return out;
  };
  const a = v => esc(v ?? '');
  const rowMarkup = (r, i, locked = false) => `<tr data-index="${i}">
    <td><input class="os-serial" data-field="serial" value="${a(r.serial)}" ${locked ? 'disabled' : ''} aria-label="Sl No"></td>
    <td><input class="os-item" data-field="item" value="${a(r.item)}" ${locked ? 'disabled' : ''} required autocomplete="off" placeholder="Type medicine name" aria-label="Item name"></td>
    <td><input class="os-dist" data-field="distributor" value="${a(r.distributor)}" ${locked ? 'disabled' : ''} autocomplete="off" placeholder="Optional" aria-label="Distributor"></td>
    <td><input data-field="batch" value="${a(r.batch)}" ${locked ? 'disabled' : ''} required aria-label="Batch"></td>
    <td><input data-field="pack" type="number" min="0.001" step="any" value="${a(r.pack)}" ${locked ? 'disabled' : ''} required aria-label="Pack"></td>
    <td><input data-field="qty" type="number" min="0.001" step="any" value="${a(r.qty)}" ${locked ? 'disabled' : ''} required aria-label="Qty (packs)"></td>
    <td><input data-field="exp" type="date" value="${a(r.exp)}" ${locked ? 'disabled' : ''} required aria-label="Expiry"></td>
    <td><input data-field="srate" type="number" min="0" step="0.01" value="${a(r.srate)}" ${locked ? 'disabled' : ''} required aria-label="Srate (MRP per pack)"></td>
    <td><input data-field="prate" type="number" min="0" step="0.01" value="${a(r.prate)}" ${locked ? 'disabled' : ''} required aria-label="Prate (purchase rate per pack)"></td>
    <td><input data-field="urate" type="number" min="0" step="0.0001" value="${a(r.urate)}" ${locked ? 'disabled' : ''} required aria-label="Urate (unit MRP)" title="Srate ÷ Pack"></td>
    <td><input data-field="gst" type="number" min="0" max="100" step="0.01" value="${a(r.gst)}" ${locked ? 'disabled' : ''} required placeholder="0" aria-label="GST %"></td>
    <td>${locked ? (r.batch_id ? '<span class="os-posted">Posted</span>' : 'Submitted') : '<button type="button" class="sec os-remove os-danger" aria-label="Remove row">✕</button>'}</td>
  </tr>`;
  const colgroup = `<colgroup><col class="w-sl"><col class="w-item"><col class="w-dist"><col class="w-batch"><col class="w-pack"><col class="w-qty"><col class="w-exp"><col class="w-rate"><col class="w-rate"><col class="w-rate"><col class="w-gst"><col class="w-act"></colgroup>`;
  const render = () => {
    const isPosted = submitted();
    const units = rows.reduce((s, r) => s + (Number(r.pack) || 0) * (Number(r.qty) || 0), 0);
    panel.innerHTML = `<section class="os-wrap">
      <header><h3>Initial Stock</h3>
        <p class="os-help">Enter the stock on your shelves when you start: type the rows or upload the Excel template, save a draft, then confirm once.
        <b>Urate</b> (Srate ÷ Pack) is the price per unit in billing, and <b>GST %</b> is shown in billing as entered. Distributor is optional.</p></header>
      ${has37 ? '' : '<div class="os-status error">Run database migration 0037 to save the GST % and distributor of each row.</div>'}
      <div id="os-msg" class="os-status" role="status" aria-live="polite"></div>
      <div class="os-toolbar">
        <button type="button" id="os-template" class="os-secondary">↓ Download Excel template</button>
        ${isPosted ? '' : '<label class="sec os-file" for="os-file">↑ Upload Excel file</label><input id="os-file" type="file" accept=".xlsx,.xls" hidden>'}
        <span class="spacer"></span><strong>Status: ${isPosted ? 'Submitted' : saved ? 'Draft saved' : 'Not started'}</strong>
      </div>
      ${saved?.submitted_at ? `<div class="os-status">Initial stock submitted on ${esc(new Date(saved.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}. Use the batch editor below for corrections.</div>` : ''}
      <label class="os-notes">Notes / reference<input id="os-notes" value="${a(saved?.notes)}" ${isPosted ? 'disabled' : ''} placeholder="Optional"></label>
      <div class="os-summary"><span>Rows: <strong id="os-count">${rows.length}</strong></span><span>Units: <strong id="os-total">${units.toLocaleString('en-IN')}</strong></span></div>
      <div class="os-table-wrap"><table class="os-table os-grid">${colgroup}<thead><tr>${HEADERS.map((h, i) => `<th${i > 3 ? ' class="c-r"' : ''}>${esc(h)}</th>`).join('')}<th></th></tr></thead>
        <tbody id="os-rows">${rows.map((r, i) => rowMarkup(r, i, isPosted)).join('') || `<tr class="os-empty"><td colspan="12">No rows yet — press <b>＋ Add row</b> or upload the Excel template.</td></tr>`}</tbody></table></div>
      ${isPosted ? '<p class="os-small">Submitted stock is live. Batch corrections are audited; quantity changes are blocked once the batch has other stock movements.</p>' : `<div class="os-actions">
        <button type="button" id="os-add">＋ Add row</button>
        <button type="button" id="os-save" class="os-secondary">Save draft</button>
        <button type="button" id="os-submit" class="os-primary">Review &amp; confirm initial stock</button></div>`}
      ${isPosted ? `<h4>Submitted batch editor</h4><div class="os-table-wrap"><table class="os-table os-grid"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="c-r">Pack</th><th class="c-r">Qty</th><th class="c-r">Srate</th><th class="c-r">Prate</th><th class="c-r">Urate</th><th class="c-r">GST %</th><th></th></tr></thead><tbody id="os-edit-rows">${rows.map((r, i) => `<tr data-index="${i}"><td>${esc(r.item)}${r.distributor ? `<small class="os-sub">${esc(r.distributor)}</small>` : ''}</td><td><input data-edit="batch" value="${a(r.batch)}"></td><td><input data-edit="exp" type="date" value="${a(r.exp)}"></td><td><input data-edit="pack" type="number" min=".001" step="any" value="${a(r.pack)}"></td><td><input data-edit="qty" type="number" min=".001" step="any" value="${a(r.qty)}"></td><td><input data-edit="srate" type="number" min="0" step=".01" value="${a(r.srate)}"></td><td><input data-edit="prate" type="number" min="0" step=".01" value="${a(r.prate)}"></td><td><input data-edit="urate" type="number" min="0" step=".0001" value="${a(r.urate)}"></td><td><input data-edit="gst" type="number" min="0" max="100" step=".01" value="${a(r.gst)}"></td><td><button type="button" class="sec os-edit-save">Save</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    </section>`;
  };
  const collect = () => [...panel.querySelectorAll('#os-rows tr[data-index]')].map(tr => {
    const v = f => tr.querySelector(`[data-field="${f}"]`)?.value ?? '';
    const old = rows[Number(tr.dataset.index)] || {};
    return { serial: v('serial'), item: v('item').trim(), distributor: v('distributor').trim(), batch: v('batch').trim(), pack: num(v('pack')), qty: num(v('qty')), exp: v('exp'),
      srate: num(v('srate')), prate: num(v('prate')), urate: num(v('urate')), gst: num(v('gst')), medicine_id: old.item === v('item').trim() ? old.medicine_id || null : null, batch_id: old.batch_id || null };
  });
  const validate = data => {
    if (!data.length) throw new Error('Add at least one stock row.');
    const seen = new Set();
    data.forEach((r, i) => {
      const n = i + 1;
      if (!r.item) throw new Error(`Row ${n}: type the item (medicine) name.`);
      if (!r.batch) throw new Error(`Row ${n}: Batch is required.`);
      if (!r.exp) throw new Error(`Row ${n}: Exp (expiry date) is required.`);
      if (!(r.pack > 0) || !(r.qty > 0)) throw new Error(`Row ${n}: Pack and Qty must be more than zero.`);
      if (!(r.srate >= 0) || !(r.prate >= 0) || !(r.urate >= 0)) throw new Error(`Row ${n}: Srate, Prate and Urate must be 0 or more.`);
      if (!(r.gst >= 0 && r.gst <= 100)) throw new Error(`Row ${n}: enter GST % (0 if none).`);
      if (Math.abs(r.urate - round4(r.srate / r.pack)) > 0.02) throw new Error(`Row ${n}: Urate must be Srate ÷ Pack = ${round4(r.srate / r.pack)}.`);
      const key = `${r.item.toLowerCase()}|${r.batch.toLowerCase()}`;
      if (seen.has(key)) throw new Error(`Row ${n}: the same medicine and batch is entered twice.`);
      seen.add(key);
    });
  };
  const prepare = async data => {
    const out = [];
    for (const r of data) {
      const med = await medicineFor(r.item);
      out.push({ medicine_id: med.id, batch_no: r.batch, expiry: r.exp, qty: round4(r.pack * r.qty), unit_cost: round4(r.prate / r.pack),
        mrp: round2(r.urate), selling_price: round2(r.urate), serial_no: String(r.serial), pack_size: r.pack, pack_qty: r.qty,
        srate: r.srate, prate: r.prate, urate: r.urate, tax_rate: r.gst, distributor_name: r.distributor || null });
    }
    return out;
  };

  try { await loadMasters(); await loadDraft(); }
  catch (error) { panel.innerHTML = `<p class="notice">Could not load Initial Stock: ${esc(friendly(error))}</p>`; return; }
  render();

  // type-ahead suggestions
  attachSuggest(panel, 'input[data-field="item"]', q => matchNames(medicines, q).map(m => ({ label: m.name, sub: m.strength || '', value: m.name, data: m })),
    (input, it) => { const tr = input.closest('tr'), g = tr?.querySelector('[data-field="gst"]'); if (g && g.value === '' && Number(it.data?.tax_rate) > 0) g.value = Number(it.data.tax_rate); });
  attachSuggest(panel, 'input[data-field="distributor"]', q => matchNames(distributors, q).map(d => ({ label: d.name, value: d.name })));

  panel.addEventListener('input', e => {
    if (e.target.matches('[data-field="srate"],[data-field="pack"]')) {
      const tr = e.target.closest('tr');
      const s = num(tr.querySelector('[data-field="srate"]').value), p = num(tr.querySelector('[data-field="pack"]').value);
      if (s >= 0 && p > 0) tr.querySelector('[data-field="urate"]').value = round4(s / p);
    }
    if (e.target.matches('[data-field="pack"],[data-field="qty"]')) {
      const units = collect().reduce((s, r) => s + (r.pack > 0 && r.qty > 0 ? r.pack * r.qty : 0), 0);
      const t = panel.querySelector('#os-total'); if (t) t.textContent = units.toLocaleString('en-IN');
    }
  });
  panel.addEventListener('click', async e => {
    const target = e.target.closest('button, label') || e.target;
    if (target.id === 'os-template') { template(); return; }
    if (target.id === 'os-add') {
      rows = collect(); rows.push({ serial: rows.length + 1, pack: 1, gst: '' }); render();
      panel.querySelector(`#os-rows tr[data-index="${rows.length - 1}"] [data-field="item"]`)?.focus(); return;
    }
    if (target.classList.contains('os-remove')) { const data = collect(); data.splice(Number(target.closest('tr').dataset.index), 1); rows = data; render(); return; }
    if (target.id === 'os-save' || target.id === 'os-submit') {
      if (busy) return;
      try {
        const data = collect(); validate(data);
        busy = true; target.disabled = true; msg('Saving…');
        const prepared = await prepare(data);
        const { error } = await sb.rpc('opening_stock_save_draft', { p_items: prepared, p_notes: panel.querySelector('#os-notes').value });
        if (error) throw error;
        await loadMasters(); await loadDraft();
        if (target.id === 'os-submit') {
          const summary = data.map((r, i) => `${i + 1}. ${r.item} / ${r.batch} — ${r.pack} × ${r.qty} = ${r.pack * r.qty} units · Exp ${r.exp} · MRP ₹${r.srate}/pack · GST ${r.gst}%${r.distributor ? ` · ${r.distributor}` : ''}`).join('\n');
          if (!confirm(`CONFIRM INITIAL STOCK\n\n${summary}\n\nThis creates live stock batches and cannot be undone from this screen. Continue?`)) { render(); msg('Draft saved. Not submitted.'); return; }
          const { error: submitError } = await sb.rpc('opening_stock_submit');
          if (submitError) throw submitError;
          await loadDraft(); render(); msg('Initial stock submitted. It is now available in billing.', 'success');
        } else { render(); msg('Draft saved. You can continue later.', 'success'); }
      } catch (error) { msg(friendly(error) || error.message || 'Could not save the initial stock.', 'error'); }
      finally { busy = false; const b = panel.querySelector(`#${target.id}`); if (b) b.disabled = false; }
      return;
    }
    if (target.classList.contains('os-edit-save')) {
      const tr = target.closest('tr'), old = rows[Number(tr.dataset.index)];
      const get = k => tr.querySelector(`[data-edit="${k}"]`).value;
      const ed = { batch_no: get('batch').trim(), expiry: get('exp'), pack_size: num(get('pack')), pack_qty: num(get('qty')), srate: num(get('srate')), prate: num(get('prate')), urate: num(get('urate')), gst: num(get('gst')) };
      if (!ed.batch_no || !ed.expiry || !(ed.pack_size > 0) || !(ed.pack_qty > 0) || !(ed.srate >= 0) || !(ed.prate >= 0) || !(ed.urate >= 0)) return msg('Complete all batch details before saving.', 'error');
      if (!(ed.gst >= 0 && ed.gst <= 100)) return msg('Enter GST % (0 to 100).', 'error');
      if (Math.abs(ed.urate - round4(ed.srate / ed.pack_size)) > .02) return msg('Urate must be Srate ÷ Pack.', 'error');
      if (!old.batch_id) return msg('This row has no posted batch yet.', 'error');
      target.disabled = true;
      let { error } = await sb.rpc('opening_stock_edit_submitted_batch', { p_batch: old.batch_id, p_batch_no: ed.batch_no, p_expiry: ed.expiry, p_pack_size: ed.pack_size, p_pack_qty: ed.pack_qty, p_srate: ed.srate, p_prate: ed.prate, p_urate: ed.urate });
      if (!error && Number(old.gst) !== ed.gst) ({ error } = await sb.rpc('opening_stock_set_batch_gst', { p_batch: old.batch_id, p_tax_rate: ed.gst }));
      target.disabled = false;
      if (error) return msg(friendly(error), 'error');
      await loadDraft(); render(); msg('Batch updated (audited).', 'success');
    }
  });
  panel.addEventListener('change', async e => {
    if (e.target.id !== 'os-file') return;
    const file = e.target.files?.[0]; if (!file) return;
    try {
      msg('Reading the Excel file…');
      const imported = await parseWorkbook(file);
      let created = 0;
      for (const r of imported) {
        const exists = medicines.some(m => m.name.trim().toLowerCase() === r.item.toLowerCase());
        r.medicine_id = (await medicineFor(r.item)).id;
        if (!exists) created++;
      }
      rows = [...collect().filter(r => r.item), ...imported].map((r, i) => ({ ...r, serial: r.serial || i + 1 }));
      render();
      msg(`${imported.length} row(s) added from Excel${created ? `, ${created} new medicine(s) created` : ''}. Check the rows, then Save draft.`, 'success');
    } catch (error) { msg(error.message || friendly(error), 'error'); }
    finally { e.target.value = ''; }
  });
}
