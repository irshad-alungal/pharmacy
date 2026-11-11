import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly } from './ui.js';
import { mountInitialStock } from './initial-stock.js';
const prof = await mountShell('inventory', 'Inventory');
const $ = id => document.getElementById(id), admin = ['super_admin', 'admin'].includes(prof.role);
const TABS = [['stock', 'Batch stock'], ['alerts', 'Alerts'], ['count', 'Physical count'], ...(admin ? [['opening', 'Initial Stock'], ['val', 'Valuation']] : []), ['moves', 'Movements']];
document.getElementById('view').innerHTML = `<div style="display:flex;gap:.4rem;flex-wrap:wrap" id="tabs">${TABS.map(([k, l]) => `<button class="sec" data-k="${k}">${l}</button>`).join('')}</div>
<div class="card" id="panel"></div><div id="msg"></div>
<dialog id="adj"><form id="af" method="dialog" style="display:grid;gap:.5rem;min-width:min(92vw,380px)"><h3 id="at"></h3>
<select id="ak"><option value="adjustment+">Increase (stock found)</option><option value="adjustment-">Decrease (correction)</option><option value="damage-">Damaged</option><option value="expiry_writeoff-">Expired write-off</option></select>
<input id="aq" type="number" min="0.001" step="any" placeholder="Quantity" required><input id="ar" placeholder="Reason *" required><div id="ae" style="color:#b91c1c"></div>
<div style="display:flex;gap:.5rem"><button>Save</button><button type="button" class="sec" id="ac">Cancel</button></div></form></dialog>`;
let batches = [], near = 90, tab = 'stock', cur = null;
const days = d => Math.floor((new Date(d) - new Date(new Date().toISOString().slice(0, 10))) / 864e5);
const state = b => b.status === 'expired' ? 'Expired' : b.status === 'quarantined' ? 'Quarantined' : days(b.expiry) <= near ? `Near expiry (${days(b.expiry)}d)` : 'OK';
const note = (m, bad) => { $('msg').style.color = bad ? '#b91c1c' : ''; $('msg').textContent = m; };
async function loadBatches(s) { const { data, error } = await sb.rpc('inventory_batches', { p_search: s || null }); if (error) note(friendly(error), true); batches = data || []; }
const show = async k => { tab = k; note(''); await views[k](); };
const views = {
  async opening() { await mountInitialStock($('panel'), prof); },
  async stock() {
    $('panel').innerHTML = `<div style="display:flex;gap:.5rem;flex-wrap:wrap"><input id="s" placeholder="Search medicine, batch or barcode" style="flex:1;min-width:200px"><select id="fl"><option value="">All</option><option value="ok">Sellable</option><option value="near">Near expiry</option><option value="exp">Expired</option><option value="q">Quarantined</option></select></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Status</th><th>Location</th>${admin ? '<th>Cost value</th>' : ''}<th></th></tr></thead><tbody id="r"></tbody></table></div>`;
    const draw = () => {
      const f = $('fl').value, rows = batches.filter(b => !f || (f === 'ok' && state(b) === 'OK') || (f === 'near' && state(b).startsWith('Near')) || (f === 'exp' && b.status === 'expired') || (f === 'q' && b.status === 'quarantined'));
      $('r').innerHTML = rows.map(b => `<tr style="${b.status !== 'ok' ? 'color:#b91c1c' : ''}"><td>${esc(b.name)} ${esc(b.strength || '')}</td><td>${esc(b.batch_no)}</td><td>${esc(b.expiry)}</td><td>${b.qty}</td><td>${state(b)}</td><td>${esc(b.location || '')}</td>${admin ? `<td>${inr(b.cost_value)}</td>` : ''}
      <td><button class="sec" data-a="${b.batch_id}">Adjust</button> <button class="sec" data-q="${b.batch_id}">${b.quarantined ? 'Release' : 'Quarantine'}</button></td></tr>`).join('') || '<tr><td colspan="8">No batches.</td></tr>';
    };
    draw(); $('fl').onchange = draw; let t; $('s').oninput = () => { clearTimeout(t); t = setTimeout(async () => { await loadBatches($('s').value.trim()); draw(); }, 250); };
    $('r').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a) { cur = batches.find(x => x.batch_id === b.dataset.a); $('at').textContent = `Adjust ${cur.name} · batch ${cur.batch_no} (now ${cur.qty})`; $('af').reset(); $('ae').textContent = ''; $('adj').showModal(); }
      if (b.dataset.q) { const x = batches.find(y => y.batch_id === b.dataset.q), why = prompt(`${x.quarantined ? 'Release' : 'Quarantine'} batch ${x.batch_no}: reason?`); if (!why) return;
        const { error } = await sb.rpc('set_quarantine', { p_batch: x.batch_id, p_flag: !x.quarantined, p_reason: why }); if (error) return note(friendly(error), true); await loadBatches($('s').value.trim()); draw(); note('Updated.'); }
    };
  },
  async alerts() {
    const { data: low } = await sb.rpc('low_stock');
    const nr = batches.filter(b => b.status === 'ok' && b.qty > 0 && days(b.expiry) <= near), ex = batches.filter(b => b.status === 'expired' && b.qty > 0);
    const tb = (h, rows) => `<table><thead><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${h.length}">None 🎉</td></tr>`}</tbody></table>`;
    $('panel').innerHTML = `<label>Near-expiry window (days) <input id="nd" type="number" min="1" value="${near}" style="width:6rem"></label>
    <h3>Low stock (sellable ≤ reorder level)</h3>${tb(['Medicine', 'Sellable', 'Reorder level'], (low || []).map(l => `<tr><td>${esc(l.name)}</td><td>${l.sellable}</td><td>${l.reorder_level}</td></tr>`).join(''))}
    <h3>Near expiry</h3>${tb(['Medicine', 'Batch', 'Expiry', 'Qty'], nr.map(b => `<tr><td>${esc(b.name)}</td><td>${esc(b.batch_no)}</td><td>${esc(b.expiry)} (${days(b.expiry)}d)</td><td>${b.qty}</td></tr>`).join(''))}
    <h3>Expired, still in stock (cannot be sold)</h3>${tb(['Medicine', 'Batch', 'Expiry', 'Qty'], ex.map(b => `<tr><td>${esc(b.name)}</td><td>${esc(b.batch_no)}</td><td>${esc(b.expiry)}</td><td>${b.qty}</td></tr>`).join(''))}`;
    $('nd').onchange = () => { near = Math.max(1, +$('nd').value || 90); views.alerts(); };
  },
  async count() {
    $('panel').innerHTML = `<p>Enter the counted quantity only for batches you counted. Differences are recorded as stock movements.</p><input id="cn" placeholder="Note * (e.g. monthly count, rack A)" style="width:100%">
    <div style="overflow-x:auto"><table><thead><tr><th>Medicine</th><th>Batch</th><th>System qty</th><th>Counted</th></tr></thead><tbody>${batches.map(b => `<tr><td>${esc(b.name)}</td><td>${esc(b.batch_no)}</td><td>${b.qty}</td><td><input class="ct" data-b="${b.batch_id}" data-s="${b.qty}" type="number" min="0" step="any" style="width:6rem"></td></tr>`).join('')}</tbody></table></div><button id="cs">Submit counts</button>`;
    $('cs').onclick = async () => {
      const counts = [...document.querySelectorAll('.ct')].filter(i => i.value !== '').map(i => ({ batch_id: i.dataset.b, counted: +i.value }));
      if (!counts.length) return note('Enter at least one counted quantity.', true); if (!$('cn').value.trim()) return note('A note is required.', true);
      const { data, error } = await sb.rpc('physical_count', { p_counts: counts, p_note: $('cn').value }); if (error) return note(friendly(error), true);
      await loadBatches(); await views.count(); note(`Done. ${data} batch(es) had differences and were adjusted.`);
    };
  },
  async val() {
    const { data, error } = await sb.rpc('inventory_valuation'); if (error) return note(friendly(error), true); const v = data[0];
    $('panel').innerHTML = `<table><tr><th>Total stock at cost</th><td>${inr(v.cost_total)}</td></tr><tr><th>Sellable stock at cost</th><td>${inr(v.cost_sellable)}</td></tr>
    <tr><th>Expired stock at cost (write-off risk)</th><td>${inr(v.cost_expired)}</td></tr><tr><th>Quarantined stock at cost</th><td>${inr(v.cost_quarantined)}</td></tr>
    <tr><th>Sellable stock at selling price</th><td>${inr(v.retail_sellable)}</td></tr></table><p style="font-size:.85rem">Cost uses each medicine's latest purchase cost per base unit.</p>`;
  },
  async moves() {
    $('panel').innerHTML = `<select id="mt"><option value="">All types</option>${['purchase_in', 'opening_stock', 'sale_out', 'adjustment', 'damage', 'expiry_writeoff', 'physical_count'].map(t => `<option>${t}</option>`).join('')}</select>
    <div style="overflow-x:auto"><table><thead><tr><th>When (IST)</th><th>Medicine</th><th>Batch</th><th>Type</th><th>Qty</th><th>Reason</th></tr></thead><tbody id="mr"></tbody></table></div>`;
    const go = async () => { let q = sb.from('stock_movements').select('created_at,movement_type,qty,reason,medicines(name),medicine_batches(batch_no)').order('created_at', { ascending: false }).limit(200); if ($('mt').value) q = q.eq('movement_type', $('mt').value);
      const { data } = await q; $('mr').innerHTML = (data || []).map(m => `<tr><td>${new Date(m.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td><td>${esc(m.medicines?.name)}</td><td>${esc(m.medicine_batches?.batch_no)}</td><td>${esc(m.movement_type)}</td><td style="color:${m.qty < 0 ? '#b91c1c' : '#0f766e'}">${m.qty > 0 ? '+' : ''}${m.qty}</td><td>${esc(m.reason || '')}</td></tr>`).join('') || '<tr><td colspan="6">No movements.</td></tr>'; };
    $('mt').onchange = go; go();
  }
};
$('tabs').onclick = e => { const k = e.target.dataset.k; if (k) show(k); };
$('ac').onclick = () => $('adj').close();
$('af').onsubmit = async e => {
  e.preventDefault(); const k = $('ak').value, sign = k.endsWith('+') ? 1 : -1, type = k.slice(0, -1);
  const { error } = await sb.rpc('adjust_stock', { p_batch: cur.batch_id, p_delta: sign * +$('aq').value, p_type: type, p_reason: $('ar').value });
  if (error) { $('ae').textContent = friendly(error); return; } $('adj').close(); await loadBatches(); show(tab); note('Stock updated.');
};
await loadBatches(); show('stock');
