import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly } from './ui.js';
await mountShell('finance', 'Finance');
const $ = id => document.getElementById(id);
const TABS = [['ov', 'Overview'], ['led', 'Ledger'], ['rec', 'Customer dues'], ['pay', 'Supplier payables'], ['hist', 'Receipts & payments']];
$('view').innerHTML = `<div id="tabs" style="display:flex;gap:.4rem;flex-wrap:wrap">${TABS.map(([k, l]) => `<button class="sec" data-k="${k}">${l}</button>`).join('')}</div><div class="card" id="panel"></div><div id="msg" style="min-height:1.4em"></div>
<dialog id="dlg"><form id="f" method="dialog" style="display:grid;gap:.5rem;min-width:min(92vw,360px)"><h3 id="dt"></h3><input id="am" type="number" min="0.01" step="0.01" placeholder="Amount ₹" required>
<select id="me"><option value="cash">Cash</option><option value="upi">UPI (manual transfer)</option></select><input id="nt" placeholder="Note / reference"><small>UPI payments are completed manually in your UPI app. This page only records the payment.</small><div id="de" style="color:#b91c1c"></div>
<div style="display:flex;gap:.5rem"><button>Record</button><button type="button" class="sec" id="dc">Cancel</button></div></form></dialog>`;
const note = (m, bad) => { $('msg').style.color = bad ? '#b91c1c' : ''; $('msg').textContent = m; };
const when = d => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
let tab = 'ov', onSave = null;
const show = k => { $('panel').onclick = null; views[k](); };   // clear the previous tab's click handler
const ask = (title, max, fn) => { $('dt').textContent = title; $('am').value = max ?? ''; $('am').max = max ?? ''; $('nt').value = ''; $('de').textContent = ''; onSave = fn; $('dlg').showModal(); };
$('dc').onclick = () => $('dlg').close();
$('f').onsubmit = async e => { e.preventDefault(); const error = await onSave(+$('am').value, $('me').value, $('nt').value.trim()); if (error) { $('de').textContent = friendly(error); return; } $('dlg').close(); show(tab); };
const reverse = async (rpc, id, label) => { const why = prompt(`Reverse this ${label}? A reversing entry will be posted (the original stays). Reason:`); if (!why) return; const { error } = await sb.rpc(rpc, { p_id: id, p_reason: why }); if (error) return note(friendly(error), true); note('Reversed.'); show(tab); };
const views = {
  async ov() {
    $('panel').innerHTML = `<div style="display:flex;gap:.5rem;flex-wrap:wrap"><label>From <input id="df" type="date"></label><label>To <input id="dt2" type="date"></label><button id="ap">Apply</button></div><div id="o"></div>`;
    const go = async () => {
      const { data, error } = await sb.rpc('ledger_summary', { p_from: $('df').value || null, p_to: $('dt2').value || null }); if (error) return note(friendly(error), true);
      const a = {}; (data || []).forEach(r => a[r.account] = { d: +r.debit, c: +r.credit }); const D = k => a[k]?.d || 0, C = k => a[k]?.c || 0;
      const row = (l, v, h) => `<tr><td>${l}${h ? `<br><small>${h}</small>` : ''}</td><td style="text-align:right"><b>${inr(v)}</b></td></tr>`;
      $('o').innerHTML = `<table><tbody>${row('Cash', D('cash') - C('cash'), 'received minus paid out')}${row('UPI', D('upi') - C('upi'))}${row('Customers owe you (receivables)', D('receivables') - C('receivables'))}${row('You owe distributors (payables)', C('payables') - D('payables'))}
      ${row('Net sales (sales − returns, tax included)', C('sales') - D('sales_returns'))}${row('Net purchases (purchases − returns, tax included)', D('purchases') - C('purchase_returns'))}</tbody></table>
      <p style="font-size:.85rem">With a date range, balances show movement in that period. These are ledger totals, not profit: profit needs cost of goods sold (Phase 8).</p>`;
    };
    $('ap').onclick = go; go();
  },
  async led() {
    $('panel').innerHTML = `<div style="display:flex;gap:.5rem;flex-wrap:wrap"><select id="ac"><option value="">All accounts</option>${['cash', 'upi', 'receivables', 'payables', 'sales', 'sales_returns', 'purchases', 'purchase_returns'].map(a => `<option>${a}</option>`).join('')}</select><label>From <input id="df" type="date"></label><label>To <input id="dt2" type="date"></label></div>
    <div style="overflow-x:auto"><table><thead><tr><th>When (IST)</th><th>Account</th><th>Debit</th><th>Credit</th><th>Memo</th></tr></thead><tbody id="r"></tbody></table></div><small>Entries are permanent. Corrections appear as reversing entries.</small>`;
    const go = async () => { let q = sb.from('financial_ledger').select('entry_at,account,debit,credit,memo,reversal_of').order('id', { ascending: false }).limit(300);
      if ($('ac').value) q = q.eq('account', $('ac').value); if ($('df').value) q = q.gte('entry_at', $('df').value + 'T00:00:00+05:30'); if ($('dt2').value) q = q.lte('entry_at', $('dt2').value + 'T23:59:59+05:30');
      const { data } = await q; $('r').innerHTML = (data || []).map(l => `<tr style="${l.reversal_of ? 'color:#b45309' : ''}"><td>${when(l.entry_at)}</td><td>${esc(l.account)}</td><td>${+l.debit ? inr(l.debit) : ''}</td><td>${+l.credit ? inr(l.credit) : ''}</td><td>${esc(l.memo || '')}${l.reversal_of ? ' (reversal)' : ''}</td></tr>`).join('') || '<tr><td colspan="5">No entries.</td></tr>'; };
    ['ac', 'df', 'dt2'].forEach(i => $(i).onchange = go); go();
  },
  async rec() {
    const { data } = await sb.rpc('customer_dues');
    $('panel').innerHTML = `<table><thead><tr><th>Customer</th><th>Phone</th><th>Owes</th><th>Credit limit</th><th></th></tr></thead><tbody>${(data || []).map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${inr(c.outstanding)}</td><td>${inr(c.credit_limit)}</td><td><button data-c="${c.customer_id}" data-n="${esc(c.name)}" data-o="${c.outstanding}">Receive payment</button></td></tr>`).join('') || '<tr><td colspan="5">No customer owes anything.</td></tr>'}</tbody></table>`;
    $('panel').onclick = e => { const b = e.target.closest('button'); if (!b) return; ask(`Receive from ${b.dataset.n} (owes ${inr(b.dataset.o)})`, b.dataset.o, async (amt, m, n) => (await sb.rpc('record_customer_receipt', { p_customer: b.dataset.c, p_amount: amt, p_method: m, p_note: n || null })).error); };
  },
  async pay() {
    const { data } = await sb.rpc('payable_balances');
    $('panel').innerHTML = `<table><thead><tr><th>Distributor</th><th>You owe</th><th></th></tr></thead><tbody>${(data || []).map(d => `<tr><td>${esc(d.name)}</td><td>${inr(d.balance)}</td><td>${+d.balance > 0 ? `<button data-d="${d.distributor_id}" data-n="${esc(d.name)}" data-o="${d.balance}">Record payment</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3">Nothing owed.</td></tr>'}</tbody></table>`;
    $('panel').onclick = e => { const b = e.target.closest('button'); if (!b) return; ask(`Pay ${b.dataset.n} (you owe ${inr(b.dataset.o)})`, b.dataset.o, async (amt, m, n) => (await sb.rpc('record_supplier_payment', { p_distributor: b.dataset.d, p_amount: amt, p_method: m, p_reference: n || null })).error); };
  },
  async hist() {
    const [r, p] = await Promise.all([sb.from('customer_receipts').select('id,receipt_no,amount,method,status,created_at,customers(name)').order('created_at', { ascending: false }).limit(40),
      sb.from('supplier_payments').select('id,payment_no,amount,method,status,created_at,distributors(name)').order('created_at', { ascending: false }).limit(40)]);
    const t = (rows, k, who, rpc, label) => `<h3>${label}s</h3><table><tbody>${(rows || []).map(x => `<tr style="${x.status === 'reversed' ? 'opacity:.5;text-decoration:line-through' : ''}"><td>${esc(x[k])}</td><td>${esc(x[who]?.name)}</td><td>${inr(x.amount)}</td><td>${esc(x.method)}</td><td>${when(x.created_at)}</td><td>${x.status === 'posted' ? `<button class="sec" data-rpc="${rpc}" data-id="${x.id}" data-l="${label}">Reverse</button>` : 'reversed'}</td></tr>`).join('') || '<tr><td>None.</td></tr>'}</tbody></table>`;
    $('panel').innerHTML = t(r.data, 'receipt_no', 'customers', 'reverse_receipt', 'receipt') + t(p.data, 'payment_no', 'distributors', 'reverse_supplier_payment', 'payment');
    $('panel').onclick = e => { const b = e.target.closest('button'); if (b?.dataset.rpc) reverse(b.dataset.rpc, b.dataset.id, b.dataset.l); };
  }
};
$('tabs').onclick = e => { const k = e.target.dataset.k; if (k) { tab = k; note(''); show(k); } };
show('ov');
