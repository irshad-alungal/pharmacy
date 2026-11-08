
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';

const prof = await mountShell('settings', 'Settings · Master data');
const view = document.getElementById('view');

const MASTERS = [
  ['categories', 'Categories', false],
  ['manufacturers', 'Manufacturers', false],
  ['storage_locations', 'Storage locations (shelf/rack areas)', false],
  ['units', 'Units', true]
];

view.innerHTML = MASTERS.map(([t, l, u]) => `
<section class="card" data-t="${t}">
  <h3>${l}</h3>
  <div style="display:flex;gap:.5rem;flex-wrap:wrap">
    <input class="n" placeholder="Name">
    ${u ? '<input class="c" placeholder="Code (e.g. strip)" style="width:9rem">' : ''}
    <button class="add">Add</button>
  </div>
  <div class="err" style="color:#b91c1c"></div>
  <ul class="list"></ul>
</section>`).join('') +

`<section class="card" id="conv">
  <h3>Unit conversions</h3>
  <p>Example: 1 Strip = 10 Tablet</p>
  <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
    1 <select id="cf"></select> =
    <input id="cn" type="number" step="0.0001" min="0.0001" style="width:7rem">
    <select id="ct"></select>
    <button id="ca">Add</button>
  </div>
  <div id="cerr" style="color:#b91c1c"></div>
  <ul id="cl"></ul>
</section>`;

let units = [];

async function render(sec) {
  const t = sec.dataset.t;
  const { data, error } = await sb.from(t).select('*').order('name');

  if (error) {
    sec.querySelector('.err').textContent = friendly(error);
    return;
  }

  sec.querySelector('.list').innerHTML = (data || []).map(r => `
    <li style="${r.active ? '' : 'opacity:.5'}">
      ${esc(r.name)}${r.code ? ' (' + esc(r.code) + ')' : ''}
      <button class="sec" data-id="${r.id}" data-a="${r.active}">
        ${r.active ? 'Deactivate' : 'Activate'}
      </button>
    </li>`).join('');

  if (t === 'units') {
    units = data || [];
    fillConv();
  }
}

function fillConv() {
  const o = units
    .filter(u => u.active)
    .map(u => `<option value="${u.id}">${esc(u.name)}</option>`)
    .join('');

  cf.innerHTML = o;
  ct.innerHTML = o;
  loadConv();
}

async function loadConv() {
  const { data, error } = await sb
    .from('unit_conversions')
    .select('*');

  if (error) {
    cerr.textContent = friendly(error);
    return;
  }

  const n = id => units.find(u => u.id === id)?.name || '?';

  cl.innerHTML = (data || []).map(c => `
    <li>
      1 ${esc(n(c.from_unit_id))} = ${c.factor} ${esc(n(c.to_unit_id))}
      <button class="sec" data-d="${c.id}">Remove</button>
    </li>`).join('');
}

for (const sec of view.querySelectorAll('section[data-t]')) {
  sec.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;

    const t = sec.dataset.t;
    const err = sec.querySelector('.err');
    err.textContent = '';

    if (b.classList.contains('add')) {
      const name = sec.querySelector('.n').value.trim();
      const code = sec.querySelector('.c')?.value.trim();

      if (!name || (t === 'units' && !code)) return;

      const { error } = await sb.from(t).insert(
        t === 'units' ? { name, code } : { name }
      );

      if (error) {
        err.textContent = friendly(error);
        return;
      }

      sec.querySelector('.n').value = '';

      if (sec.querySelector('.c')) {
        sec.querySelector('.c').value = '';
      }

    } else if (b.dataset.id) {
      const { error } = await sb
        .from(t)
        .update({ active: b.dataset.a !== 'true' })
        .eq('id', b.dataset.id);

      if (error) {
        err.textContent = friendly(error);
        return;
      }
    }

    render(sec);
  };

  render(sec);
}

ca.onclick = async () => {
  cerr.textContent = '';

  const factor = Number(cn.value);

  if (!(factor > 0) || cf.value === ct.value) {
    cerr.textContent = 'Choose two different units and a factor above 0.';
    return;
  }

  const { error } = await sb.from('unit_conversions').insert({
    from_unit_id: cf.value,
    to_unit_id: ct.value,
    factor
  });

  if (error) {
    cerr.textContent = friendly(error);
  } else {
    cn.value = '';
    loadConv();
  }
};

cl.onclick = async e => {
  const id = e.target.dataset.d;

  if (id) {
    const { error } = await sb
      .from('unit_conversions')
      .delete()
      .eq('id', id);

    if (error) {
      cerr.textContent = friendly(error);
      return;
    }

    loadConv();
  }
};


// ============================================
// PHARMACY PROFILE
// Uses secure Supabase RPC functions.
// ============================================

view.insertAdjacentHTML('afterbegin', `
<section class="card">
  <h3>Pharmacy details (used on invoices)</h3>

  <form id="branch-profile"
    style="display:grid;gap:.5rem;max-width:560px">

    <input name="name" placeholder="Pharmacy name" required>
    <textarea name="address" placeholder="Street address"></textarea>

    <input name="city" placeholder="City">
    <input name="state" placeholder="State">
    <input name="pincode" placeholder="PIN code">
    <input name="phone" placeholder="Phone">

    <input name="email" type="email" placeholder="Email">
    <input name="gstin" placeholder="GSTIN" maxlength="15">

    <textarea name="drug_licence_nos"
      placeholder="Drug licence numbers (one per line)"></textarea>

    <input name="invoice_prefix"
      placeholder="Invoice prefix" required>

    <textarea name="invoice_footer"
      placeholder="Invoice footer"></textarea>

    <div id="branch-profile-msg" role="status"></div>

    <button type="submit">Save pharmacy details</button>
  </form>
</section>
`);


{
  const form = document.getElementById('branch-profile');
  const msg = document.getElementById('branch-profile-msg');

  const fields = [
    'name',
    'address',
    'city',
    'state',
    'pincode',
    'phone',
    'email',
    'gstin',
    'invoice_prefix',
    'invoice_footer'
  ];

  // Load pharmacy details using secure RPC.
  msg.textContent = 'Loading pharmacy details...';
  msg.style.color = '';

  const { data, error } = await sb.rpc('get_branch_profile');

  if (error) {
    msg.textContent = friendly(error);
    msg.style.color = '#b91c1c';

  } else {
    for (const k of fields) {
      form.elements[k].value = data?.[k] ?? '';
    }

    form.elements.drug_licence_nos.value =
      Array.isArray(data?.drug_licence_nos)
        ? data.drug_licence_nos.join('\n')
        : '';

    msg.textContent = 'Pharmacy details loaded.';
    msg.style.color = '#067647';
  }

  // Save pharmacy details using secure RPC.
  form.onsubmit = async e => {
    e.preventDefault();

    msg.textContent = 'Saving pharmacy details...';
    msg.style.color = '';

    const row = Object.fromEntries(
      fields.map(k => [
        k,
        form.elements[k].value.trim() || null
      ])
    );

    row.gstin = row.gstin?.toUpperCase() ?? null;

    row.drug_licence_nos = form.elements.drug_licence_nos.value
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean);

    const { error: saveError } = await sb.rpc(
      'save_branch_profile',
      { p_data: row }
    );

    if (saveError) {
      msg.textContent = friendly(saveError);
      msg.style.color = '#b91c1c';
    } else {
      msg.textContent = 'Pharmacy details saved successfully.';
      msg.style.color = '#067647';
    }
  };
}
