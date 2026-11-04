import { sb, requireProfile, esc, inr } from './supabase-client.js';
const prof = await requireProfile(); if (!prof) throw 0;
if (!['super_admin','admin','pharmacist','billing'].includes(prof.role)) { document.body.innerHTML='<p>Not authorised for billing.</p>'; throw 0; }
who.textContent = `${prof.staff_id} (${prof.role})`;
out.onclick = async()=>{ await sb.auth.signOut(); location.href='index.html'; };
let cart = [];
const sub = () => cart.reduce((s,c)=>s+c.price*c.qty,0);
const cartEl = document.getElementById('cart');
function render(){
  cartEl.innerHTML = cart.map((c,i)=>`<tr><td>${esc(c.name)}</td><td>${esc(c.batch_no)} (exp ${esc(c.expiry)}, ${c.stock} left)</td>
  <td><input type="number" min="1" max="${c.stock}" value="${c.qty}" data-i="${i}" style="width:5rem"></td><td>${inr(c.price*c.qty)}</td>
  <td><button data-x="${i}">✕</button></td></tr>`).join('');
  tot.textContent = 'Total ' + inr(Math.max(0, sub() - (+disc.value||0)));
}
cartEl.onchange = e => { const i=e.target.dataset.i; if(i!==undefined){ cart[i].qty=Math.min(Math.max(1,+e.target.value||1),cart[i].stock); render(); } };
cartEl.onclick = e => { const x=e.target.dataset.x; if(x!==undefined){ cart.splice(+x,1); render(); } };
disc.oninput = render;
async function add(med){
  // FEFO: earliest non-expired, non-quarantined batch with stock
  const today = new Date().toISOString().slice(0,10);
  const { data } = await sb.from('medicine_batches').select('id,batch_no,expiry,qty').eq('medicine_id',med.id)
    .eq('quarantined',false).gte('expiry',today).gt('qty',0).order('expiry').limit(1);
  if (!data?.length) { msg.textContent = `${med.name}: no sellable stock`; return; }
  const b = data[0]; const ex = cart.find(c=>c.batch_id===b.id);
  if (ex) ex.qty = Math.min(ex.qty+1, +b.qty); else cart.push({ batch_id:b.id, name:med.name, batch_no:b.batch_no, expiry:b.expiry, stock:+b.qty, price:+med.selling_price, qty:1 });
  msg.textContent=''; render();
}
let t; q.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
  const v = q.value.trim(); if (v.length<2) { res.innerHTML=''; return; }
  const safe = v.replace(/[%,()]/g,'');
  const { data } = await sb.from('medicines').select('id,name,barcode,selling_price,shelf_location').eq('active',true)
    .or(`name.ilike.%${safe}%,barcode.eq.${safe}`).limit(8);
  if (data?.length===1 && data[0].barcode===v) { add(data[0]); q.value=''; res.innerHTML=''; return; }
  res.innerHTML = (data||[]).map(m=>`<button data-m='${esc(JSON.stringify(m))}'>${esc(m.name)} — ${inr(m.selling_price)} · shelf ${esc(m.shelf_location||'-')}</button>`).join('');
},250); };
res.onclick = e => { const b=e.target.closest('button'); if(b){ add(JSON.parse(b.dataset.m)); q.value=''; res.innerHTML=''; } };
pay.onclick = async () => {
  if (!cart.length) return; pay.disabled = true; msg.textContent='Saving…';
  const total = Math.round((sub()-(+disc.value||0))*100)/100;
  const { data, error } = await sb.rpc('finalize_sale', { p_customer:null, p_discount:+disc.value||0,
    p_items: cart.map(c=>({batch_id:c.batch_id, qty:c.qty})), p_payments:[{method:pm.value, amount:total}] });
  pay.disabled = false;
  if (error) { msg.textContent = error.message; return; }
  msg.textContent = 'Bill saved: ' + data; cart = []; render();
};
render();
