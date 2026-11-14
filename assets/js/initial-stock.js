import { sb, esc, inr } from './supabase-client.js';
import { friendly } from './ui.js';

const HEADERS = ['sl no', 'Item NAme', 'batch', 'pack', 'Qty', 'Exp', 'Srate', 'Prate', 'Urate'];
const ADMIN_ROLES = ['super_admin', 'admin'];

const toDate = value => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  if (typeof value === 'number' && window.XLSX?.SSF) {
    const d = window.XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10);
};
const num = v => v === '' || v === null || v === undefined ? NaN : Number(String(v).replace(/,/g,'').trim());
const round4 = n => Math.round((n + Number.EPSILON) * 10000) / 10000;
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

export async function mountInitialStock(panel, prof) {
  if (!ADMIN_ROLES.includes(String(prof?.role || '').toLowerCase())) {
    panel.innerHTML = '<p class="notice">You do not have access to Initial Stock.</p>';
    return;
  }
  if (!window.XLSX) {
    panel.innerHTML = '<p class="notice">Excel reader did not load. Refresh the page and check your internet connection.</p>';
    return;
  }

  let medicines = [];
  let rows = [];
  let saved = null;
  let busy = false;
  const status = () => saved?.status || 'not_started';
  const submitted = () => status() === 'submitted';
  const msg = (text, kind='') => {
    const el = panel.querySelector('#os-msg');
    if (el) { el.textContent = text; el.className = `os-status ${kind}`; }
  };
  const loadMedicines = async () => {
    const { data, error } = await sb.from('medicines')
      .select('id,name,strength,mrp,selling_price,active')
      .eq('branch_id', prof.branch_id).eq('active', true).order('name').limit(3000);
    if (error) throw error;
    medicines = data || [];
  };
  const loadDraft = async () => {
    const { data, error } = await sb.rpc('opening_stock_get_draft');
    if (error) throw error;
    saved = data || null;
    rows = (saved?.items || []).map((x, i) => ({
      serial: x.serial_no ?? i + 1,
      item: x.medicine_name || medicines.find(m => m.id === x.medicine_id)?.name || '',
      medicine_id: x.medicine_id,
      batch: x.batch_no || '',
      pack: x.pack_size ?? 1,
      qty: x.pack_qty ?? x.qty ?? '',
      exp: toDate(x.expiry),
      srate: x.srate ?? x.mrp ?? '',
      prate: x.prate ?? (Number(x.unit_cost || 0) * Number(x.pack_size || 1)),
      urate: x.urate ?? x.mrp ?? '',
      batch_id: x.batch_id || null
    }));
  };
  const template = () => {
    const wb = window.XLSX.utils.book_new();
    const sample = [1, 'Paracetamol 500 mg', 'PCM001', 10, 20, '31-12-2027', 50, 35, 5];
    const ws = window.XLSX.utils.aoa_to_sheet([HEADERS, sample]);
    ws['!cols'] = [8,28,18,10,10,16,12,12,12].map(wch => ({wch}));
    window.XLSX.utils.book_append_sheet(wb, ws, 'Initial Stock');
    const guide = [
      ['Column', 'Meaning'],
      ['sl no', 'Serial number'],
      ['Item NAme', 'Medicine name. A missing medicine is created in this branch during upload.'],
      ['batch', 'Batch number'],
      ['pack', 'Number of individual units in one strip or pack'],
      ['Qty', 'Number of packs entered'],
      ['Exp', 'Expiry date (DD-MM-YYYY or Excel date)'],
      ['Srate', 'MRP per pack'],
      ['Prate', 'Purchase rate per pack'],
      ['Urate', 'Unit MRP = Srate / pack'],
      ['Stock calculation', 'Total inventory units = pack × Qty'],
      ['Cost calculation', 'Unit acquisition cost = Prate / pack']
    ];
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(guide), 'Instructions');
    window.XLSX.writeFile(wb, 'ALZA_Initial_Stock_Template.xlsx');
  };
  const createMedicineIfMissing = async name => {
    const key = name.trim().toLocaleLowerCase();
    const found = medicines.find(m => m.name.trim().toLocaleLowerCase() === key);
    if (found) return found;
    // The current medicines schema requires branch_id, mrp and selling_price.
    // Price is populated from the imported Urate (per-unit MRP).
    const { data, error } = await sb.from('medicines').insert({
      branch_id: prof.branch_id, name: name.trim(), mrp: 0,
      selling_price: 0, purchase_price: null, tax_rate: 12, active: true
    }).select('id,name,strength,mrp,selling_price,active').single();
    if (error) throw new Error(`Could not create medicine "${name}": ${friendly(error)}`);
    medicines.push(data);
    return data;
  };
  const parseWorkbook = async file => {
    const buffer = await file.arrayBuffer();
    const wb = window.XLSX.read(buffer, {type:'array', cellDates:true});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('The Excel file has no worksheet.');
    const raw = window.XLSX.utils.sheet_to_json(sheet, {header:1, defval:'', raw:true});
    if (!raw.length) throw new Error('The worksheet is empty.');
    const normalized = raw[0].map(v => String(v ?? '').trim().toLowerCase());
    const indexes = HEADERS.map(h => normalized.indexOf(h.toLowerCase()));
    if (indexes.some(i => i < 0)) throw new Error(`Required headings not found. Use the supplied template with: ${HEADERS.join(', ')}.`);
    const imported = [];
    for (let i=1; i<raw.length; i++) {
      const cells = raw[i];
      if (!cells.some(v => String(v ?? '').trim() !== '')) continue;
      const get = h => cells[indexes[HEADERS.indexOf(h)]];
      const item = String(get('Item NAme') ?? '').trim();
      if (!item) throw new Error(`Row ${i+1}: Item NAme is required.`);
      const pack = num(get('pack')), qty = num(get('Qty')), srate = num(get('Srate')), prate = num(get('Prate'));
      const exp = toDate(get('Exp'));
      if (!(pack > 0)) throw new Error(`Row ${i+1}: pack must be greater than zero.`);
      if (!(qty > 0)) throw new Error(`Row ${i+1}: Qty must be greater than zero.`);
      if (!exp) throw new Error(`Row ${i+1}: Exp is not a valid date.`);
      if (!(srate >= 0) || !(prate >= 0)) throw new Error(`Row ${i+1}: Srate and Prate must be zero or greater.`);
      const urate = round4(srate / pack);
      const suppliedUrate = num(get('Urate'));
      if (Number.isFinite(suppliedUrate) && Math.abs(suppliedUrate-urate) > 0.02) {
        throw new Error(`Row ${i+1}: Urate should equal Srate ÷ pack (${urate}).`);
      }
      const batch = String(get('batch') ?? '').trim();
      if (!batch) throw new Error(`Row ${i+1}: batch is required.`);
      imported.push({
        serial: get('sl no') || imported.length+1, item, batch, pack, qty, exp,
        srate, prate, urate, medicine_id: null, batch_id: null
      });
    }
    if (!imported.length) throw new Error('No stock rows were found below the heading row.');
    if (imported.length > 2000) throw new Error('Maximum 2,000 rows per upload.');
    return imported;
  };
  const escapeAttr = v => esc(v);
  const rowMarkup = (r, i, locked=false) => `<tr data-index="${i}">
    <td><input class="os-serial" data-field="serial" value="${escapeAttr(r.serial)}" ${locked?'disabled':''}></td>
    <td><input class="os-item" data-field="item" value="${escapeAttr(r.item)}" ${locked?'disabled':''} required></td>
    <td><input data-field="batch" value="${escapeAttr(r.batch)}" ${locked?'disabled':''} required></td>
    <td><input class="os-pack" data-field="pack" type="number" min="0.001" step="any" value="${escapeAttr(r.pack)}" ${locked?'disabled':''} required></td>
    <td><input data-field="qty" type="number" min="0.001" step="any" value="${escapeAttr(r.qty)}" ${locked?'disabled':''} required></td>
    <td><input data-field="exp" type="date" value="${escapeAttr(r.exp)}" ${locked?'disabled':''} required></td>
    <td><input data-field="srate" type="number" min="0" step="0.01" value="${escapeAttr(r.srate)}" ${locked?'disabled':''} required></td>
    <td><input data-field="prate" type="number" min="0" step="0.01" value="${escapeAttr(r.prate)}" ${locked?'disabled':''} required></td>
    <td><input data-field="urate" type="number" min="0" step="0.0001" value="${escapeAttr(r.urate)}" ${locked?'disabled':''} required></td>
    <td>${locked ? (r.batch_id ? 'Posted' : 'Submitted') : '<button type="button" class="sec os-remove os-danger">Remove</button>'}</td>
  </tr>`;
  const render = () => {
    const isPosted = submitted();
    panel.innerHTML = `<section class="os-wrap">
      <header>
        <h3>Initial Stock — Bulk Excel Entry</h3>
        <p class="os-help">Upload your nine-column workbook, edit the rows, save a draft, then confirm to post stock. Draft saving does not change inventory.</p>
      </header>
      <div id="os-msg" class="os-status" role="status" aria-live="polite"></div>
      <div class="os-toolbar">
        <button type="button" id="os-template" class="os-secondary">↓ Download Excel template</button>
        ${isPosted ? '' : `<label class="sec os-file" for="os-file">↑ Upload Excel file</label><input id="os-file" type="file" accept=".xlsx,.xls" hidden>`}
        <span class="spacer"></span>
        <strong>Status: ${isPosted ? 'Submitted' : saved ? 'Draft saved' : 'Not started'}</strong>
      </div>
      ${saved?.submitted_at ? `<div class="os-status">Initial stock submitted on ${esc(new Date(saved.submitted_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))}. Use the batch editor below to make permitted corrections.</div>` : ''}
      <label>Notes / takeover reference<br><input id="os-notes" style="width:100%" value="${esc(saved?.notes || '')}" ${isPosted?'disabled':''} placeholder="Optional reference"></label>
      <div class="os-summary"><span>Rows: <strong id="os-count">${rows.length}</strong></span><span>Pack units: <strong id="os-total">${rows.reduce((a,r)=>a+(Number(r.pack)||0)*(Number(r.qty)||0),0).toLocaleString('en-IN')}</strong></span></div>
      <div class="os-table-wrap"><table class="os-table"><thead><tr>${HEADERS.map(h=>`<th>${esc(h)}</th>`).join('')}<th>Action</th></tr></thead><tbody id="os-rows">${rows.map((r,i)=>rowMarkup(r,i,isPosted)).join('')}</tbody></table></div>
      ${isPosted ? `<p class="os-small">Submitted stock is already live. Batch corrections are audited. Quantity changes are blocked by the server when subsequent stock movements exist.</p>` : `<div class="os-actions">
        <button type="button" id="os-add">＋ Add row</button>
        <button type="button" id="os-save" class="os-secondary">Save draft</button>
        <button type="button" id="os-submit" class="os-primary">Review & confirm initial stock</button>
      </div>`}
      ${isPosted ? `<h4>Submitted batch editor</h4><div class="os-table-wrap"><table class="os-table"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>Pack</th><th>Qty (packs)</th><th>Srate</th><th>Prate</th><th>Urate</th><th></th></tr></thead><tbody id="os-edit-rows">${rows.map((r,i)=>`<tr data-index="${i}"><td>${esc(r.item)}</td><td><input data-edit="batch" value="${esc(r.batch)}"></td><td><input data-edit="exp" type="date" value="${esc(r.exp)}"></td><td><input data-edit="pack" type="number" min=".001" step="any" value="${esc(r.pack)}"></td><td><input data-edit="qty" type="number" min=".001" step="any" value="${esc(r.qty)}"></td><td><input data-edit="srate" type="number" min="0" step=".01" value="${esc(r.srate)}"></td><td><input data-edit="prate" type="number" min="0" step=".01" value="${esc(r.prate)}"></td><td><input data-edit="urate" type="number" min="0" step=".0001" value="${esc(r.urate)}"></td><td><button type="button" class="sec os-edit-save">Save changes</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    </section>`;
  };
  const collect = () => [...panel.querySelectorAll('#os-rows tr')].map(tr => {
    const value = field => tr.querySelector(`[data-field="${field}"]`)?.value ?? '';
    return {serial:value('serial'),item:value('item').trim(),batch:value('batch').trim(),pack:num(value('pack')),qty:num(value('qty')),exp:value('exp'),srate:num(value('srate')),prate:num(value('prate')),urate:num(value('urate')),medicine_id:rows[Number(tr.dataset.index)]?.medicine_id || null,batch_id:rows[Number(tr.dataset.index)]?.batch_id || null};
  });
  const validate = data => {
    if (!data.length) throw new Error('Add at least one stock row.');
    const seen = new Set();
    for (let i=0;i<data.length;i++) {
      const r=data[i], n=i+1;
      if (!r.item||!r.batch||!r.exp||!(r.pack>0)||!(r.qty>0)||!(r.srate>=0)||!(r.prate>=0)||!(r.urate>=0)) throw new Error(`Row ${n}: complete all nine columns with valid values.`);
      if (Math.abs(r.urate-round4(r.srate/r.pack))>0.02) throw new Error(`Row ${n}: Urate must equal Srate ÷ pack (${round4(r.srate/r.pack)}).`);
      const key=`${r.item.toLowerCase()}|${r.batch.toLowerCase()}`;
      if(seen.has(key)) throw new Error(`Duplicate medicine and batch at row ${n}.`);
      seen.add(key);
    }
  };
  const prepareRpcItems = async data => {
    const prepared=[];
    for (const r of data) {
      const medicine=await createMedicineIfMissing(r.item);
      prepared.push({
        medicine_id:medicine.id, batch_no:r.batch, expiry:r.exp,
        qty:round4(r.pack*r.qty), unit_cost:round4(r.prate/r.pack),
        mrp:round2(r.urate), selling_price:round2(r.urate),
        serial_no:String(r.serial), pack_size:r.pack, pack_qty:r.qty,
        srate:r.srate, prate:r.prate, urate:r.urate
      });
    }
    return prepared;
  };

  try { await loadMedicines(); await loadDraft(); }
  catch (error) { panel.innerHTML=`<p class="notice">Could not load Initial Stock: ${esc(friendly(error))}</p>`; return; }
  render();

  panel.addEventListener('input', e => {
    if (e.target.matches('[data-field="srate"],[data-field="pack"]')) {
      const tr=e.target.closest('tr');
      const s=num(tr.querySelector('[data-field="srate"]').value), p=num(tr.querySelector('[data-field="pack"]').value);
      if(s>=0&&p>0) tr.querySelector('[data-field="urate"]').value=round4(s/p);
    }
  });
  panel.addEventListener('click', async e => {
    const target=e.target;
    if(target.id==='os-template'){ template(); return; }
    if(target.id==='os-add'){ rows=collect(); rows.push({serial:rows.length+1,pack:1}); render(); return; }
    if(target.classList.contains('os-remove')){ const data=collect(); data.splice(Number(target.closest('tr').dataset.index),1); rows=data; render(); return; }
    if(target.id==='os-file'){
      return;
    }
    if(target.id==='os-save'||target.id==='os-submit'){
      if(busy)return;
      try {
        const data=collect(); validate(data);
        const prepared=await prepareRpcItems(data);
        busy=true; target.disabled=true;
        const {error}=await sb.rpc('opening_stock_save_draft',{p_items:prepared,p_notes:panel.querySelector('#os-notes').value});
        if(error)throw error;
        const {data:reloaded,error:loadError}=await sb.rpc('opening_stock_get_draft');
        if(loadError)throw loadError;
        saved=reloaded; rows=(saved?.items||[]).map((x,i)=>({
          serial:x.serial_no??i+1,item:x.medicine_name||'',medicine_id:x.medicine_id,batch:x.batch_no,
          pack:x.pack_size??1,qty:x.pack_qty??x.qty,exp:toDate(x.expiry),srate:x.srate??x.mrp,
          prate:x.prate??(x.unit_cost*x.pack_size),urate:x.urate??x.mrp,batch_id:x.batch_id||null
        }));
        if(target.id==='os-submit'){
          const summary=data.map((r,i)=>`${i+1}. ${r.item} / ${r.batch} — ${r.pack} × ${r.qty} = ${r.pack*r.qty} units; Exp ${r.exp}; MRP ₹${r.srate}/pack; Purchase ₹${r.prate}/pack`).join('\n');
          if(!confirm(`CONFIRM INITIAL STOCK\n\n${summary}\n\nThis will create live batches and post stock movements. This action cannot be undone from this screen. Continue?`)){render();msg('Draft saved. Submission cancelled.','');return;}
          const {error:submitError}=await sb.rpc('opening_stock_submit');
          if(submitError)throw submitError;
          const {data:after,error:afterError}=await sb.rpc('opening_stock_get_draft');
          if(afterError)throw afterError;
          saved=after; rows=(saved?.items||[]).map((x,i)=>({serial:x.serial_no??i+1,item:x.medicine_name||'',medicine_id:x.medicine_id,batch:x.batch_no,pack:x.pack_size??1,qty:x.pack_qty??x.qty,exp:toDate(x.expiry),srate:x.srate??x.mrp,prate:x.prate??(x.unit_cost*x.pack_size),urate:x.urate??x.mrp,batch_id:x.batch_id||null}));
          render(); msg('Initial stock submitted successfully.','success');
        } else { render(); msg('Draft saved in Supabase. You can continue after signing in again.','success'); }
      } catch(error){msg(friendly(error) || error.message || 'Unable to save initial stock.','error');}
      finally{busy=false;}
      return;
    }
    if(target.classList.contains('os-edit-save')){
      const tr=target.closest('tr'), i=Number(tr.dataset.index), old=rows[i];
      const get=k=>tr.querySelector(`[data-edit="${k}"]`).value;
      const edit={batch_no:get('batch').trim(),expiry:get('exp'),pack_size:num(get('pack')),pack_qty:num(get('qty')),srate:num(get('srate')),prate:num(get('prate')),urate:num(get('urate'))};
      if(!edit.batch_no||!edit.expiry||!(edit.pack_size>0)||!(edit.pack_qty>0)||!(edit.srate>=0)||!(edit.prate>=0)||!(edit.urate>=0))return msg('Complete all batch details before saving.','error');
      if(Math.abs(edit.urate-round4(edit.srate/edit.pack_size))>.02)return msg('Urate must equal Srate ÷ pack.','error');
      const batchId=old.batch_id;
      if(!batchId)return msg('The database did not return the posted batch ID. Apply the included SQL migration before using post-submission editing.','error');
      target.disabled=true;
      const {error}=await sb.rpc('opening_stock_edit_submitted_batch',{
        p_batch:batchId,p_batch_no:edit.batch_no,p_expiry:edit.expiry,
        p_pack_size:edit.pack_size,p_pack_qty:edit.pack_qty,
        p_srate:edit.srate,p_prate:edit.prate,p_urate:edit.urate
      });
      target.disabled=false;
      if(error)return msg(friendly(error),'error');
      await loadDraft(); render(); msg('Submitted batch updated and audit logged.','success');
    }
  });

  panel.addEventListener('change', async e => {
    if(e.target.id!=='os-file')return;
    const file=e.target.files?.[0]; if(!file)return;
    try{
      const imported=await parseWorkbook(file);
      // Create missing medicine master records during the upload flow, as requested.
      let created=0;
      for(const r of imported){
        const exists=medicines.some(m=>m.name.trim().toLowerCase()===r.item.toLowerCase());
        const med=await createMedicineIfMissing(r.item);
        r.medicine_id=med.id;
        if(!exists)created++;
      }
      rows=imported; render();
      msg(`${imported.length} row(s) imported. ${created} new medicine(s) added to this branch. Review and edit all columns, then Save draft.`,'success');
    }catch(error){msg(error.message||friendly(error),'error');}
  });
}
