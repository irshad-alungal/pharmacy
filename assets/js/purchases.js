import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly, safeQ } from './ui.js';
const prof = await mountShell('purchases', 'Purchases');
const $ = id => document.getElementById(id);
const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const dists = (await sb.from('distributors').select('id,name').eq('active', true).order('name')).data || [];
const units = (await sb.from('units').select('id,name').eq('active', true).order('name')).data || [];
document.getElementById('view').innerHTML = `<button id="new">+ New purchase</button><div id="msg"></div>
<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Supplier invoice</th><th>Distributor</th><th>Status</th>${isAdmin ? '<th>Total</th>' : ''}</tr></thead><tbody id="rows"></tbody></table></div>
<dialog id="dlg"><form id="f" method="dialog" style="display:grid;gap:.6rem;width:min(96vw,980px)"><h3>New purchase (confirming adds stock immediately)</h3>
<div style="display:flex;gap:.5rem;flex-wrap:wrap"><select id="dist" required><option value="">Distributor *</option>${dists.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
<input id="inv" placeholder="Supplier invoice no. *" required><input id="dt" type="date" required></div>
<datalist id="ml"></datalist><div style="overflow-x:auto"><table><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Unit</th><th>Price ₹ (ex-tax)</th><th>Tax %</th><th>Disc ₹</th><th></th></tr></thead><tbody id="lines"></tbody></table></div>
<button type="button" class="sec" id="addl">+ Add line</button>
<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><input id="disc" type="number" min="0" step="0.01" placeholder="Invoice discount ₹" value="0"><input id="fr" type="number" min="0" step="0.01" placeholder="Freight ₹" value="0">
<strong id="tot" style="flex:1;text-align:right"></strong></div><div id="err" style="color:#b91c1c"></div>
<div style="display:flex;gap:.5rem"><button>Confirm purchase</button><button type="button" class="sec" id="cancel">Cancel</button></div></form></dialog>`;
const map = new Map();
const unitOpts = sel => '<option value="">Base unit</option>' + units.map(u => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
function addLine() {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input class="med" list="ml" placeholder="Search medicine" style="min-width:180px"></td><td><input class="bn" style="width:6rem"></td><td><input class="ex" type="date"></td>
  <td><input class="q" type="number" min="0.001" step="any" style="width:5rem"></td><td><select class="u">${unitOpts()}</select></td><td><input class="p" type="number" min="0" step="0.01" style="width:6rem"></td>
  <td><input class="t" type="number" min="0" max="40" step="0.01" value="12" style="width:4.5rem"></td><td><input class="d" type="number" min="0" step="0.01" value="0" style="width:5rem"></td><td><button type="button" class="sec rm">✕</button></td>`;
  $('lines').appendChild(tr);
}
function totals() {
  let sub = 0, tx = 0;
  for (const r of $('lines').children) {
    const net = (+r.querySelector('.q').value || 0) * (+r.querySelector('.p').value || 0) - (+r.querySelector('.d').value || 0);
    sub += net; tx += net * (+r.querySelector('.t').value || 0) / 100;
  }
  $('tot').textContent = `Subtotal ${inr(sub)} + tax ${inr(tx)} = ${inr(sub + tx - (+$('disc').value || 0) + (+$('fr').value || 0))} (server recalculates)`;
}
$('lines').oninput = async e => {
  const r = e.target.closest('tr');
  if (e.target.classList.contains('med')) {
    const v = e.target.value, hit = map.get(v);
    if (hit) { r.dataset.id = hit.id; r.querySelector('.t').value = hit.tax_rate; r.querySelector('.u').innerHTML = unitOpts(hit.base_unit_id); }
    else {
      delete r.dataset.id; const s = safeQ(v); if (s.length < 2) return;
      const { data } = await sb.from('medicines').select('id,name,strength,tax_rate,base_unit_id').eq('active', true).or(`name.ilike.%${s}%,barcode.eq.${s}`).limit(15);
      $('ml').innerHTML = ''; for (const m of data || []) { const label = `${m.name}${m.strength ? ' ' + m.strength : ''}`; map.set(label, m); $('ml').insertAdjacentHTML('beforeend', `<option value="${esc(label)}">`); }
    }
  }
  totals();
};
$('lines').onclick = e => { if (e.target.classList.contains('rm')) { e.target.closest('tr').remove(); totals(); } };
$('disc').oninput = $('fr').oninput = totals; $('addl').onclick = () => { addLine(); totals(); };
$('new').onclick = () => { $('f').reset(); $('dt').value = new Date().toISOString().slice(0, 10); $('lines').innerHTML = ''; $('err').textContent = ''; addLine(); totals(); $('dlg').showModal(); };
$('cancel').onclick = () => $('dlg').close();
$('f').onsubmit = async e => {
  e.preventDefault(); $('err').textContent = '';
  const items = [...$('lines').children].map(r => ({ medicine_id: r.dataset.id, batch_no: r.querySelector('.bn').value, expiry: r.querySelector('.ex').value, qty: +r.querySelector('.q').value,
    unit_id: r.querySelector('.u').value || null, price: +r.querySelector('.p').value, tax_rate: +r.querySelector('.t').value, discount: +r.querySelector('.d').value || 0 }));
  if (items.some(i => !i.medicine_id)) { $('err').textContent = 'Pick every medicine from the suggestion list.'; return; }
  if (items.some(i => !i.expiry || !i.batch_no.trim() || !(i.qty > 0))) { $('err').textContent = 'Each line needs batch, expiry and quantity.'; return; }
  const { error } = await sb.rpc('confirm_purchase', { p_distributor: $('dist').value, p_invoice_no: $('inv').value, p_date: $('dt').value,
    p_discount: +$('disc').value || 0, p_freight: +$('fr').value || 0, p_items: items });
  if (error) { $('err').textContent = error.code === '23505' ? 'This supplier invoice number is already recorded for that distributor.' : friendly(error); return; }
  $('dlg').close(); $('msg').textContent = 'Purchase confirmed and stock updated.'; load();
};
async function load() {
  const { data, error } = await sb.rpc('purchase_list', { p_limit: 100 });
  if (error) { $('msg').textContent = friendly(error); return; }
  $('rows').innerHTML = (data || []).map(p => `<tr><td>${esc(p.invoice_date)}</td><td>${esc(p.supplier_invoice_no)}</td><td>${esc(p.distributor)}</td><td>${esc(p.status)}</td>${isAdmin ? `<td>${inr(p.total)}</td>` : ''}</tr>`).join('') || '<tr><td colspan="5">No purchases yet.</td></tr>';
}
load();
