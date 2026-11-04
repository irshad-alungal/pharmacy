import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
await mountShell('settings', 'Settings · Master data');
const view = document.getElementById('view');
const MASTERS = [['categories', 'Categories', false], ['manufacturers', 'Manufacturers', false], ['storage_locations', 'Storage locations (shelf/rack areas)', false], ['units', 'Units', true]];
view.innerHTML = MASTERS.map(([t, l, u]) => `<section class="card" data-t="${t}"><h3>${l}</h3>
<div style="display:flex;gap:.5rem;flex-wrap:wrap"><input class="n" placeholder="Name">${u ? '<input class="c" placeholder="Code (e.g. strip)" style="width:9rem">' : ''}<button class="add">Add</button></div>
<div class="err" style="color:#b91c1c"></div><ul class="list"></ul></section>`).join('') +
`<section class="card" id="conv"><h3>Unit conversions</h3><p>Example: 1 Strip = 10 Tablet</p>
<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">1 <select id="cf"></select> = <input id="cn" type="number" step="0.0001" min="0.0001" style="width:7rem"> <select id="ct"></select><button id="ca">Add</button></div>
<div id="cerr" style="color:#b91c1c"></div><ul id="cl"></ul></section>`;
let units = [];
async function render(sec) {
  const t = sec.dataset.t; const { data } = await sb.from(t).select('*').order('name');
  sec.querySelector('.list').innerHTML = (data || []).map(r => `<li style="${r.active ? '' : 'opacity:.5'}">${esc(r.name)}${r.code ? ' (' + esc(r.code) + ')' : ''}
  <button class="sec" data-id="${r.id}" data-a="${r.active}">${r.active ? 'Deactivate' : 'Activate'}</button></li>`).join('');
  if (t === 'units') { units = data || []; fillConv(); }
}
function fillConv() { const o = units.filter(u => u.active).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join(''); cf.innerHTML = o; ct.innerHTML = o; loadConv(); }
async function loadConv() {
  const { data } = await sb.from('unit_conversions').select('*'); const n = id => units.find(u => u.id === id)?.name || '?';
  cl.innerHTML = (data || []).map(c => `<li>1 ${esc(n(c.from_unit_id))} = ${c.factor} ${esc(n(c.to_unit_id))} <button class="sec" data-d="${c.id}">Remove</button></li>`).join('');
}
for (const sec of view.querySelectorAll('section[data-t]')) {
  sec.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return; const t = sec.dataset.t, err = sec.querySelector('.err'); err.textContent = '';
    if (b.classList.contains('add')) {
      const name = sec.querySelector('.n').value.trim(), code = sec.querySelector('.c')?.value.trim(); if (!name || (t === 'units' && !code)) return;
      const { error } = await sb.from(t).insert(t === 'units' ? { name, code } : { name }); if (error) { err.textContent = friendly(error); return; }
      sec.querySelector('.n').value = ''; if (sec.querySelector('.c')) sec.querySelector('.c').value = '';
    } else if (b.dataset.id) await sb.from(t).update({ active: b.dataset.a !== 'true' }).eq('id', b.dataset.id);
    render(sec);
  };
  render(sec);
}
ca.onclick = async () => {
  cerr.textContent = ''; const factor = Number(cn.value);
  if (!(factor > 0) || cf.value === ct.value) { cerr.textContent = 'Choose two different units and a factor above 0.'; return; }
  const { error } = await sb.from('unit_conversions').insert({ from_unit_id: cf.value, to_unit_id: ct.value, factor });
  if (error) cerr.textContent = friendly(error); else { cn.value = ''; loadConv(); }
};
cl.onclick = async e => { const id = e.target.dataset.d; if (id) { await sb.from('unit_conversions').delete().eq('id', id); loadConv(); } };
