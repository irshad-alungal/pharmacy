import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { nul, friendly, safeQ } from './ui.js';
await mountShell('distributors', 'Distributors');
const $ = id => document.getElementById(id);
document.getElementById('view').innerHTML = `<div style="display:flex;gap:.5rem;flex-wrap:wrap"><input id="q" placeholder="Search name, GSTIN, phone" style="flex:1;min-width:200px">
<label><input type="checkbox" id="inact"> show inactive</label><button id="new">+ Add distributor</button></div>
<div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>GSTIN</th><th>Drug licence</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
<dialog id="dlg"><form id="f" method="dialog" style="display:grid;gap:.5rem;min-width:min(92vw,440px)"><h3 id="dt"></h3><input type="hidden" name="id">
<input name="name" placeholder="Distributor name *" required><input name="contact_person" placeholder="Contact person"><input name="phone" placeholder="Phone">
<input name="email" type="email" placeholder="Email"><textarea name="address" placeholder="Address"></textarea>
<input name="gstin" placeholder="GSTIN (15 characters)" maxlength="15" style="text-transform:uppercase"><input name="drug_licence" placeholder="Drug licence no.">
<label><input type="checkbox" name="active" checked> Active</label><div id="err" style="color:#b91c1c"></div>
<div style="display:flex;gap:.5rem"><button>Save</button><button type="button" class="sec" id="cancel">Cancel</button></div></form></dialog>`;
const f = $('f'); let list = [];
async function load() {
  let qb = sb.from('distributors').select('*').order('name').limit(200);
  if (!$('inact').checked) qb = qb.eq('active', true);
  const s = safeQ($('q').value); if (s) qb = qb.or(`name.ilike.%${s}%,gstin.ilike.%${s}%,phone.ilike.%${s}%`);
  const { data } = await qb; list = data || [];
  $('rows').innerHTML = list.map(d => `<tr style="${d.active ? '' : 'opacity:.5'}"><td>${esc(d.name)}</td><td>${esc(d.contact_person || '')}</td><td>${esc(d.phone || '')}</td>
  <td>${esc(d.gstin || '')}</td><td>${esc(d.drug_licence || '')}</td><td><button class="sec" data-e="${d.id}">Edit</button> <button class="sec" data-t="${d.id}">${d.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="6">No distributors found.</td></tr>';
}
function open(d = {}) {
  $('dt').textContent = d.id ? 'Edit distributor' : 'Add distributor'; $('err').textContent = ''; f.reset();
  for (const k of ['id', 'name', 'contact_person', 'phone', 'email', 'address', 'gstin', 'drug_licence']) f[k].value = d[k] ?? '';
  f.active.checked = d.active ?? true; $('dlg').showModal();
}
f.onsubmit = async e => {
  e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const id = d.id; delete d.id;
  const row = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, nul(v.trim())])); row.gstin = row.gstin?.toUpperCase() ?? null; row.active = f.active.checked;
  const { error } = id ? await sb.from('distributors').update(row).eq('id', id) : await sb.from('distributors').insert(row);
  if (error) { $('err').textContent = error.code === '23514' ? 'GSTIN format is invalid.' : error.code === '23505' ? 'A distributor with this name or GSTIN already exists.' : friendly(error); return; }
  $('dlg').close(); load();
};
$('rows').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.e) open(list.find(x => x.id === b.dataset.e));
  if (b.dataset.t) { const d = list.find(x => x.id === b.dataset.t); await sb.from('distributors').update({ active: !d.active }).eq('id', d.id); load(); }
};
$('new').onclick = () => open(); $('cancel').onclick = () => $('dlg').close(); $('inact').onchange = load;
let t; $('q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); }; load();
