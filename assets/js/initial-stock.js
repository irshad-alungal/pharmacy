import { sb, esc, inr } from './supabase-client.js';
import { friendly } from './ui.js';

export async function mountInitialStock(panel, prof) {
  const admin = ['super_admin','admin'].includes(String(prof?.role || '').toLowerCase());
  if (!admin) { panel.innerHTML = '<p>You do not have access to Initial Stock.</p>'; return; }
  let medicines = [], rows = [];
  const msg = (s, bad=false) => { const e=panel.querySelector('#os-msg'); if(e){e.textContent=s;e.style.color=bad?'#b91c1c':'';} };
  const { data: meds, error: medErr } = await sb.from('medicines')
    .select('id,name,strength,mrp,selling_price,active')
    .eq('branch_id',prof.branch_id).eq('active',true).order('name').limit(2000);
  if (medErr) { panel.innerHTML=`<p class="notice">Could not load medicines: ${esc(friendly(medErr))}</p>`; return; }
  medicines = meds || [];
  let { data: saved, error } = await sb.rpc('opening_stock_get_draft');
  if (error) { panel.innerHTML=`<p class="notice">${esc(friendly(error))}</p>`; return; }
  // The saved draft is held in `saved`; no separate undeclared global is needed.
  rows = (saved?.items || []).map(x => ({...x}));
  const status = saved?.status || 'not_started';
  const submitted = status === 'submitted';
  const medicineOptions = selected => `<option value="">Select medicine…</option>${medicines.map(m=>`<option value="${m.id}" ${m.id===selected?'selected':''}>${esc(m.name)} ${esc(m.strength||'')}</option>`).join('')}`;
  const rowHtml = (r,i) => `<tr data-row="${i}">
    <td><select class="os-med" ${submitted?'disabled':''}>${medicineOptions(r.medicine_id)}</select></td>
    <td><input class="os-batch" value="${esc(r.batch_no||'')}" placeholder="Batch no" ${submitted?'disabled':''}></td>
    <td><input class="os-exp" type="date" value="${esc(r.expiry||'')}" ${submitted?'disabled':''}></td>
    <td><input class="os-qty" type="number" min="0.001" step="any" value="${esc(r.qty??'')}" ${submitted?'disabled':''}></td>
    <td><input class="os-cost" type="number" min="0" step="0.0001" value="${esc(r.unit_cost??'')}" ${submitted?'disabled':''}></td>
    <td><input class="os-mrp" type="number" min="0" step="0.01" value="${esc(r.mrp??'')}" ${submitted?'disabled':''}></td>
    <td><input class="os-price" type="number" min="0" step="0.01" value="${esc(r.selling_price??'')}" ${submitted?'disabled':''}></td>
    <td>${submitted?'':`<button type="button" class="sec os-remove">Remove</button>`}</td></tr>`;
  const render = () => {
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:center">
      <div><h3>Initial / Takeover Stock</h3><p>Enter the existing pharmacy stock. Saving a draft does not change live inventory.</p></div>
      <strong>Status: ${submitted?'Submitted':saved?'Draft saved':'Not started'}</strong></div>
      <p id="os-msg" role="status"></p>
      ${submitted?`<div class="notice">Opening stock was submitted on ${esc(new Date(saved.submitted_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))}. This branch's opening stock is locked.</div>`:''}
      <label>Notes / takeover reference<br><input id="os-notes" style="width:100%" value="${esc(saved?.notes||'')}" ${submitted?'disabled':''} placeholder="e.g. Stock takeover from previous owner"></label>
      <div style="overflow-x:auto"><table><thead><tr><th>Medicine</th><th>Batch no.</th><th>Expiry</th><th>Qty</th><th>Unit acquisition cost (₹)</th><th>MRP (₹)</th><th>Selling price (₹)</th><th></th></tr></thead><tbody id="os-rows">${rows.map(rowHtml).join('')}</tbody></table></div>
      ${submitted?'':`<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem"><button type="button" id="os-add">＋ Add batch</button><button type="button" class="sec" id="os-save">Save draft</button><button type="button" id="os-submit">Review & submit opening stock</button></div>`}
      <p class="dash-muted">${rows.length} batch row(s) · Drafts are saved in Supabase and can be resumed after logout.</p>`;
  };
  const collect = () => [...panel.querySelectorAll('#os-rows tr')].map(tr=>({
    medicine_id:tr.querySelector('.os-med').value,
    batch_no:tr.querySelector('.os-batch').value.trim(), expiry:tr.querySelector('.os-exp').value,
    qty:tr.querySelector('.os-qty').value, unit_cost:tr.querySelector('.os-cost').value,
    mrp:tr.querySelector('.os-mrp').value, selling_price:tr.querySelector('.os-price').value
  }));
  render();
  panel.onclick = async e => {
    if (e.target.id==='os-add') { rows=collect(); rows.push({}); render(); return; }
    if (e.target.classList.contains('os-remove')) { const idx=Number(e.target.closest('tr').dataset.row); rows=collect(); rows.splice(idx,1); render(); return; }
    if (e.target.id==='os-save') {
      const items=collect();
      if (!items.length) return msg('Add at least one batch before saving.',true);
      if (items.some(x=>!x.medicine_id||!x.batch_no||!x.expiry||x.qty===''||x.unit_cost===''||x.mrp===''||x.selling_price==='')) return msg('Complete every field in each batch row before saving.',true);
      e.target.disabled=true;
      const {error:saveErr}=await sb.rpc('opening_stock_save_draft',{p_items:items,p_notes:panel.querySelector('#os-notes').value});
      e.target.disabled=false;
      if(saveErr) return msg(friendly(saveErr),true);
      const {data:newDraft,error:loadErr}=await sb.rpc('opening_stock_get_draft');
      if(loadErr) return msg(friendly(loadErr),true);
      saved=newDraft; rows=(newDraft?.items||[]).map(x=>({...x})); render(); msg('Draft saved successfully. You can sign out and continue later.'); return;
    }
    if (e.target.id==='os-submit') {
      const items=collect();
      if (!items.length) return msg('The draft is empty.',true);
      const review=items.map((x,i)=>`${i+1}. ${medicines.find(m=>m.id===x.medicine_id)?.name||'Medicine'} | ${x.batch_no} | Qty ${x.qty} | Expiry ${x.expiry} | Cost ₹${(Number(x.qty)*Number(x.unit_cost)).toFixed(2)}`).join('\n');
      if(!confirm(`FINAL OPENING STOCK SUBMISSION\n\n${review}\n\nThis will add all batches to live inventory in one transaction. Expired batches will be quarantined. This action cannot be undone. Continue?`)) return;
      e.target.disabled=true;
      const {error:draftErr}=await sb.rpc('opening_stock_save_draft',{p_items:items,p_notes:panel.querySelector('#os-notes').value});
      if(draftErr){e.target.disabled=false;return msg(friendly(draftErr),true);}
      const {error:submitErr}=await sb.rpc('opening_stock_submit');
      e.target.disabled=false;
      if(submitErr) return msg(friendly(submitErr),true);
      const {data:newDraft,error:loadErr}=await sb.rpc('opening_stock_get_draft');
      if(loadErr) return msg('Submitted, but could not reload status: '+friendly(loadErr),true);
      saved=newDraft; rows=(newDraft?.items||[]).map(x=>({...x})); render(); msg('Opening stock submitted successfully. Inventory has been updated.');
    }
  };
  panel.onchange = e=>{
    const tr=e.target.closest('tr'); if(!tr) return;
    if(e.target.classList.contains('os-med')) {
      const m=medicines.find(x=>x.id===e.target.value); if(!m) return;
      tr.querySelector('.os-mrp').value=m.mrp ?? '';
      tr.querySelector('.os-price').value=m.selling_price ?? '';
    }
  };
}
