import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly } from './ui.js';

const prof = await mountShell('returns', 'Customer returns');
const $ = id => document.getElementById(id);
const canReturn = ['super_admin', 'admin', 'pharmacist'].includes(prof.role);

$('view').innerHTML = `
  <div class="card">
    <p>Find the original invoice and select the items being returned. The original invoice is not changed.</p>
    <p><b>Refund methods:</b> Cash or UPI. Cash is paid manually by staff. UPI is sent manually by staff through GPay, PhonePe or another UPI app; this page only records the refund method and amount.</p>
    <label for="q">Search invoice number, customer name or phone</label>
    <input id="q" type="search" placeholder="Start typing…" style="width:100%;max-width:34rem">
    <div id="list" style="margin-top:.7rem"></div>
    <div id="form" style="margin-top:1rem"></div>
  </div>
  <div id="msg" role="status" style="min-height:1.5em;margin-top:.6rem"></div>
  <div class="card" style="margin-top:1rem"><h3>Recent customer returns</h3><div id="past">Loading…</div></div>
`;

const note = (message, bad = false) => {
  $('msg').textContent = message;
  $('msg').style.color = bad ? '#b91c1c' : '';
};

async function searchInvoices() {
  const { data, error } = await sb.rpc('invoice_search', { p_q: $('q').value, p_limit: 10 });
  if (error) { $('list').textContent = friendly(error); return; }
  $('list').innerHTML = (data || []).map(i => `
    <button class="sec" type="button" data-invoice="${i.id}" style="display:block;width:100%;text-align:left;margin:.25rem 0">
      ${esc(i.invoice_no)} · ${esc(i.customer_name || 'Walk-in')} · ${inr(i.total)}
      · ${new Date(i.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}
    </button>`).join('') || '<p>No matching final invoices.</p>';
}

async function loadRecent() {
  const { data, error } = await sb.from('sales_returns')
    .select('id,return_no,invoice_id,total,refund_method,reason,created_at,sales_invoices(invoice_no)')
    .order('created_at', { ascending: false }).limit(25);
  if (error) { $('past').textContent = friendly(error); return; }
  $('past').innerHTML = `<div style="overflow-x:auto"><table><thead><tr><th>Credit note</th><th>Invoice</th><th>Refund</th><th>Method</th><th>Reason</th><th>Date</th></tr></thead><tbody>
    ${(data || []).map(r => `<tr><td>${esc(r.return_no)}</td><td>${esc(r.sales_invoices?.invoice_no || '')}</td><td>${inr(r.total)}</td><td>${esc(r.refund_method.toUpperCase())}</td><td>${esc(r.reason)}</td><td>${new Date(r.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</td></tr>`).join('') || '<tr><td colspan="6">No returns recorded yet.</td></tr>'}
  </tbody></table></div>`;
}

$('list').addEventListener('click', async event => {
  const invoiceId = event.target.closest('[data-invoice]')?.dataset.invoice;
  if (!invoiceId) return;
  note('Loading invoice items…');
  const { data, error } = await sb.rpc('returnable_items', { p_invoice: invoiceId });
  if (error) { note(friendly(error), true); return; }
  $('form').dataset.invoice = invoiceId;
  $('form').innerHTML = `
    <h3>Items eligible for return</h3>
    <div style="overflow-x:auto"><table><thead><tr><th>Medicine</th><th>Batch</th><th>Sold</th><th>Returned</th><th>Refund/unit</th><th>Return qty</th><th>Condition</th></tr></thead><tbody>
    ${(data || []).map(r => {
      const remaining = Math.max(0, Number(r.qty_sold) - Number(r.qty_returned));
      return `<tr><td>${esc(r.name)} ${esc(r.strength || '')}</td><td>${esc(r.batch_no)}</td><td>${r.qty_sold}</td><td>${r.qty_returned}</td><td>${inr(r.unit_refund)}</td>
      <td><input class="return-qty" data-id="${r.sales_item_id}" type="number" min="0" max="${remaining}" step="any" value="0" ${remaining <= 0 ? 'disabled' : ''} style="width:6rem"></td>
      <td><select class="return-disposition"><option value="restock">Good — return to stock</option><option value="damaged">Damaged — do not restock</option></select></td></tr>`;
    }).join('')}
    </tbody></table></div>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-top:.8rem">
      <label for="refund-method">Refund by</label>
      <select id="refund-method"><option value="cash">Cash</option><option value="upi">UPI (manual transfer)</option></select>
      <input id="return-reason" placeholder="Reason for return *" style="flex:1;min-width:12rem">
      <button id="submit-return" type="button">Create credit note</button>
    </div>`;
  note('');
  $('submit-return').addEventListener('click', async () => {
    const rows = [...$('form').querySelectorAll('tbody tr')].map(tr => ({
      sales_item_id: tr.querySelector('.return-qty').dataset.id,
      qty: Number(tr.querySelector('.return-qty').value),
      disposition: tr.querySelector('.return-disposition').value
    })).filter(r => r.qty > 0);
    if (!rows.length) return note('Enter a return quantity for at least one item.', true);
    if (!$('return-reason').value.trim()) return note('A reason is required.', true);
    const button = $('submit-return');
    button.disabled = true;
    const { data: returnId, error: returnError } = await sb.rpc('process_sales_return', {
      p_invoice: invoiceId, p_items: rows,
      p_method: $('refund-method').value,
      p_reason: $('return-reason').value.trim()
    });
    button.disabled = false;
    if (returnError) return note(friendly(returnError), true);
    note(`Credit note ${returnId} created. Complete the ${$('refund-method').value.toUpperCase()} refund manually.`);
    $('form').innerHTML = '';
    await loadRecent();
  });
});

let debounce;
$('q').addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(searchInvoices, 250);
});
await searchInvoices();
await loadRecent();
