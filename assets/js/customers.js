import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { nul, friendly, safeQ } from './ui.js';
await mountShell('customers', 'Customers');
const $ = id => document.getElementById(id);
document.getElementById('view').innerHTML = `<div style="display:flex;gap:.5rem;flex-wrap:wrap"><input id="q" placeholder="Search name or phone" style="flex:1;min-width:200px">
<label><input type="checkbox" id="inact"> show inactive</label><button id="new">+ Add customer</button></div>
<div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Age</th><th>WhatsApp consent</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
<dialog id="dlg"><form id="f" method="dialog" style="display:grid;gap:.5rem;min-width:min(92vw,420px)"><h3 id="dt"></h3><input type="hidden" name="id">
<input name="name" placeholder="Name *" required><input name="phone" placeholder="Phone * (10 digits or +91…)" required inputmode="tel">
<input name="email" type="email" placeholder="Email"><textarea name="address" placeholder="Address"></textarea>
<input name="age" type="number" min="0" max="120" placeholder="Age"><select name="gender"><option value="">Gender (optional)</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>
<label><input type="checkbox" name="consent"> Customer agrees to receive WhatsApp messages</label><label><input type="checkbox" name="active" checked> Active</label>
<div id="err" style="color:#b91c1c"></div><div style="display:flex;gap:.5rem"><button>Save</button><button type="button" class="sec" id="cancel">Cancel</button></div></form></dialog>`;
const f = $('f'); let list = [];
async function load() {
  let qb = sb.from('customers').select('*').order('name').limit(200);
  if (!$('inact').checked) qb = qb.eq('active', true);
  const s = safeQ($('q').value); if (s) qb = qb.or(`name.ilike.%${s}%,phone.ilike.%${s.replace(/[^0-9+]/g, '')}%`);
  const { data, error } = await qb; if (error) return;
  list = data;
  $('rows').innerHTML = list.map(c => `<tr style="${c.active ? '' : 'opacity:.5'}"><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.email || '')}</td><td>${c.age ?? ''}</td>
  <td>${c.consent ? 'Yes' : 'No'}</td><td><button class="sec" data-e="${c.id}">Edit</button> <button class="sec" data-t="${c.id}">${c.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="6">No customers found.</td></tr>';
}
function open(c = {}) {
  $('dt').textContent = c.id ? 'Edit customer' : 'Add customer'; $('err').textContent = ''; f.reset();
  for (const k of ['id', 'name', 'phone', 'email', 'address', 'age', 'gender']) f[k].value = c[k] ?? '';
  f.consent.checked = !!c.consent; f.active.checked = c.active ?? true; $('dlg').showModal();
}
f.onsubmit = async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f)); const id = d.id; delete d.id;
  const row = { name: d.name.trim(), phone: d.phone.trim(), email: nul(d.email.trim()), address: nul(d.address.trim()), age: d.age === '' ? null : Number(d.age),
    gender: nul(d.gender), consent: f.consent.checked, active: f.active.checked };
  const { error } = id ? await sb.from('customers').update(row).eq('id', id) : await sb.from('customers').insert(row);
  if (error) { $('err').textContent = error.code === '23505' ? 'A customer with this phone number already exists.' : error.code === '23514' ? 'Enter a valid phone number.' : friendly(error); return; }
  $('dlg').close(); load();
};
$('rows').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.e) open(list.find(c => c.id === b.dataset.e));
  if (b.dataset.t) { const c = list.find(x => x.id === b.dataset.t); await sb.from('customers').update({ active: !c.active }).eq('id', c.id); load(); }
};
$('new').onclick = () => open(); $('cancel').onclick = () => $('dlg').close(); $('inact').onchange = load;
let t; $('q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); }; load();
