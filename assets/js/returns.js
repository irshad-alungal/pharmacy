
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly } from './ui.js';

const prof = await mountShell('returns', 'Returns');
const $ = id => document.getElementById(id);

const isAdmin = ['super_admin', 'admin'].includes(prof.role);
const canCustomerReturn = ['super_admin', 'admin', 'pharmacist'].includes(prof.role);
const canPurchaseReturn = ['super_admin', 'admin', 'pharmacist', 'inventory_staff'].includes(prof.role);

$('view').innerHTML = `
  <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem">
    ${canCustomerReturn ? '<button type="button" id="customer-tab">Customer returns</button>' : ''}
    ${canPurchaseReturn ? `<button type="button" class="${canCustomerReturn ? 'sec' : ''}" id="purchase-tab">Purchase returns</button>` : ''}
  </div>

  ${canCustomerReturn ? `
  <section id="customer-panel">
    <section class="card">
      <p>Find the original invoice and select the items being returned. The original invoice is not changed.</p>
      <p><strong>Refund methods:</strong> Cash or UPI only.</p>
      <p><strong>Cash:</strong> Staff gives the cash refund manually. <strong>UPI:</strong> Staff sends the refund manually through GPay, PhonePe or another UPI app. This page records the method and amount; it does not send money or connect to a payment gateway.</p>
      <label for="q">Search invoice number, customer name or phone</label>
      <input id="q" type="search" placeholder="Start typing…" style="width:100%;max-width:34rem">
      <div id="list" style="margin-top:.7rem"></div>
      <div id="form" style="margin-top:1rem"></div>
    </section>
    <div id="msg" role="status" aria-live="polite" style="min-height:1.5em;margin-top:.6rem"></div>
    <section class="card" style="margin-top:1rem">
      <h3>Recent customer returns</h3>
      <div id="past">Loading…</div>
    </section>
  </section>` : ''}

  ${canPurchaseReturn ? `
  <section id="purchase-panel" hidden>
    <section class="card">
      <p>Find the original supplier purchase invoice. The original purchase invoice is not changed.</p>
      <p>Returning stock reduces the original batch quantity and records a <strong>return_out</strong> inventory movement. This screen records the goods returned; it does not issue or record a supplier refund.</p>
      <label for="pq">Search supplier invoice or distributor</label>
      <input id="pq" type="search" placeholder="Supplier invoice number or distributor…" style="width:100%;max-width:38rem">
      <div id="purchase-list" style="margin-top:.7rem">Loading purchases…</div>
      <div id="purchase-form" style="margin-top:1rem"></div>
    </section>
    <div id="purchase-msg" role="status" aria-live="polite" style="min-height:1.5em;margin-top:.6rem"></div>
    <section class="card" style="margin-top:1rem">
      <h3>Recent purchase returns</h3>
      <div id="purchase-past">Loading…</div>
    </section>
  </section>` : ''}
`;

const note = (message, bad = false) => {
  $('msg').textContent = message;
  $('msg').style.color = bad ? '#b91c1c' : '';
};

const pnote = (message, bad = false) => {
  $('purchase-msg').textContent = message;
  $('purchase-msg').style.color = bad ? '#b91c1c' : '';
};

const localDate = value => value
  ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  : '';

/* ---------------- Customer returns ---------------- */

async function searchInvoices() {
  const { data, error } = await sb.rpc('invoice_search', {
    p_q: $('q').value.trim(),
    p_limit: 10
  });

  if (error) {
    $('list').textContent = friendly(error);
    return;
  }

  $('list').innerHTML = (data || []).map(i => `
    <button class="sec" type="button" data-invoice="${esc(i.id)}"
      style="display:block;width:100%;text-align:left;margin:.25rem 0">
      ${esc(i.invoice_no)} · ${esc(i.customer_name || 'Walk-in')} · ${inr(i.total)} · ${esc(localDate(i.created_at))}
    </button>
  `).join('') || '<p>No matching final invoices.</p>';
}

async function loadRecent() {
  const { data, error } = await sb.from('sales_returns')
    .select('id,return_no,invoice_id,total,refund_method,reason,created_at,sales_invoices(invoice_no)')
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) {
    $('past').textContent = friendly(error);
    return;
  }

  $('past').innerHTML = `<div style="overflow-x:auto"><table>
    <thead>
      <tr>
        <th>Credit note</th><th>Invoice</th><th>Refund</th>
        <th>Method</th><th>Reason</th><th>Date</th>
      </tr>
    </thead>
    <tbody>
      ${(data || []).map(r => `
        <tr>
          <td>${esc(r.return_no)}</td>
          <td>${esc(r.sales_invoices?.invoice_no || '')}</td>
          <td>${inr(r.total)}</td>
          <td>${esc(String(r.refund_method || '').toUpperCase())}</td>
          <td>${esc(r.reason)}</td>
          <td>${esc(localDate(r.created_at))}</td>
        </tr>
      `).join('') || '<tr><td colspan="6">No returns recorded yet.</td></tr>'}
    </tbody>
  </table></div>`;
}

async function showInvoice(invoiceId) {
  note('Loading invoice items…');
  $('form').innerHTML = '';

  const { data, error } = await sb.rpc('returnable_items', {
    p_invoice: invoiceId
  });

  if (error) {
    note(friendly(error), true);
    return;
  }

  $('form').dataset.invoice = invoiceId;

  $('form').innerHTML = `
    <h3>Items eligible for return</h3>
    <div style="overflow-x:auto"><table>
      <thead>
        <tr>
          <th>Medicine</th><th>Batch</th><th>Sold</th>
          <th>Returned</th><th>Refund/unit</th><th>Return qty</th><th>Condition</th>
        </tr>
      </thead>
      <tbody>
        ${(data || []).map(r => {
          const remaining = Math.max(0, Number(r.qty_sold) - Number(r.qty_returned));
          return `
            <tr>
              <td>${esc(r.name)} ${esc(r.strength || '')}</td>
              <td>${esc(r.batch_no)}</td>
              <td>${esc(r.qty_sold)}</td>
              <td>${esc(r.qty_returned)}</td>
              <td>${inr(r.unit_refund)}</td>
              <td>
                <input class="return-qty" data-id="${esc(r.sales_item_id)}"
                  type="number" min="0" max="${remaining}" step="any" value="0"
                  ${remaining <= 0 ? 'disabled' : ''} style="width:6rem">
              </td>
              <td>
                <select class="return-disposition">
                  <option value="restock">Good — return to stock</option>
                  <option value="damaged">Damaged — do not restock</option>
                </select>
              </td>
            </tr>
          `;
        }).join('') || '<tr><td colspan="7">No items found for this invoice.</td></tr>'}
      </tbody>
    </table></div>

    <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-top:.8rem">
      <label for="refund-method">Refund by</label>
      <select id="refund-method">
        <option value="cash">Cash</option>
        <option value="upi">UPI (manual transfer)</option>
      </select>
      <input id="return-reason" maxlength="500"
        placeholder="Reason for return *" aria-label="Reason for return"
        style="flex:1;min-width:12rem">
      <button id="submit-return" type="button">Create credit note</button>
    </div>
    <p style="margin-top:.5rem">
      The refund is not sent automatically. Staff must complete the Cash or UPI payment separately.
    </p>
  `;

  note('');

  $('submit-return').addEventListener('click', async () => {
    const rows = [...$('form').querySelectorAll('tbody tr')]
      .map(tr => ({
        sales_item_id: tr.querySelector('.return-qty')?.dataset.id,
        qty: Number(tr.querySelector('.return-qty')?.value),
        disposition: tr.querySelector('.return-disposition')?.value
      }))
      .filter(r => r.sales_item_id && Number.isFinite(r.qty) && r.qty > 0);

    if (!rows.length) {
      note('Enter a return quantity for at least one item.', true);
      return;
    }

    const reason = $('return-reason').value.trim();

    if (!reason) {
      note('A reason is required.', true);
      $('return-reason').focus();
      return;
    }

    const method = $('refund-method').value;
    const button = $('submit-return');

    button.disabled = true;
    button.textContent = 'Processing…';

    try {
      const { data: returnId, error: returnError } = await sb.rpc('process_sales_return', {
        p_invoice: invoiceId,
        p_items: rows,
        p_method: method,
        p_reason: reason
      });

      if (returnError) {
        note(friendly(returnError), true);
        return;
      }

      const { data: rec } = await sb.from('sales_returns')
        .select('return_no,total')
        .eq('id', returnId)
        .single();

      note(rec
        ? `Credit note ${rec.return_no} recorded for ${inr(rec.total)}. Complete the ${method.toUpperCase()} refund manually.`
        : `Return recorded. Complete the ${method.toUpperCase()} refund manually.`
      );

      $('form').innerHTML = '';
      await loadRecent();
      await searchInvoices();

    } catch (err) {
      note(friendly(err), true);
    } finally {
      button.disabled = false;
      button.textContent = 'Create credit note';
    }
  });
}

$('list').addEventListener('click', async e => {
  const id = e.target.closest('[data-invoice]')?.dataset.invoice;
  if (id) await showInvoice(id);
});

let debounce;
$('q').addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(searchInvoices, 250);
});

/* ---------------- Purchase returns ---------------- */

let purchases = [];

async function loadPurchases() {
  pnote('Loading purchase invoices…');

  const { data, error } = await sb.rpc('purchase_list', {
    p_limit: 300
  });

  if (error) {
    $('purchase-list').textContent = friendly(error);
    pnote('', true);
    return;
  }

  purchases = data || [];
  renderPurchaseList();
  pnote('');
}

function renderPurchaseList() {
  const q = $('pq').value.trim().toLowerCase();

  const rows = purchases.filter(p =>
    !q ||
    String(p.supplier_invoice_no || '').toLowerCase().includes(q) ||
    String(p.distributor || '').toLowerCase().includes(q)
  );

  $('purchase-list').innerHTML = rows.map(p => `
    <button type="button" class="sec" data-purchase="${esc(p.id)}"
      style="display:block;width:100%;text-align:left;margin:.25rem 0">
      ${esc(p.supplier_invoice_no)} · ${esc(p.distributor)} · ${esc(p.invoice_date)}
      ${p.total == null ? '' : ' · ' + inr(p.total)}
    </button>
  `).join('') || '<p>No matching purchase invoices.</p>';
}

async function showPurchase(invoiceId) {
  pnote('Loading purchased items…');
  $('purchase-form').innerHTML = '';

  const { data, error } = await sb.rpc('purchase_returnable', {
    p_invoice: invoiceId
  });

  if (error) {
    pnote(friendly(error), true);
    return;
  }

  const selected = purchases.find(p => p.id === invoiceId);
  $('purchase-form').dataset.invoice = invoiceId;

  $('purchase-form').innerHTML = `
    <h3>Items eligible for supplier return</h3>
    ${selected ? `
      <p>
        <strong>Supplier invoice:</strong> ${esc(selected.supplier_invoice_no)}
        &nbsp;
        <strong>Distributor:</strong> ${esc(selected.distributor)}
      </p>
    ` : ''}
    <p>Enter quantity in the same unit used on the purchase invoice. The system converts it to base stock units.</p>

    <div style="overflow-x:auto"><table>
      <thead>
        <tr>
          <th>Medicine</th><th>Batch</th><th>Purchased</th>
          <th>Returned</th><th>Remaining</th><th>Return qty</th>
          ${isAdmin ? '<th>Unit price</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${(data || []).map(r => {
          const rem = Math.max(0, Number(r.remaining_qty));
          return `
            <tr>
              <td>${esc(r.medicine_name)}</td>
              <td>${esc(r.batch_no)}</td>
              <td>${esc(r.purchased_qty)}</td>
              <td>${esc(r.returned_qty)}</td>
              <td>${esc(r.remaining_qty)}</td>
              <td>
                <input class="purchase-return-qty" data-id="${esc(r.purchase_item_id)}"
                  type="number" min="0" max="${rem}" step="any" value="0"
                  ${rem <= 0 ? 'disabled' : ''} style="width:6rem">
              </td>
              ${isAdmin ? `<td>${inr(r.unit_price)}</td>` : ''}
            </tr>
          `;
        }).join('') || `<tr><td colspan="${isAdmin ? 7 : 6}">No purchased items found.</td></tr>`}
      </tbody>
    </table></div>

    <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-top:.8rem">
      <input id="purchase-return-reason" maxlength="500"
        placeholder="Reason for supplier return *"
        style="flex:1;min-width:15rem">
      <button id="submit-purchase-return" type="button">Record purchase return</button>
    </div>

    <p>Recording this return reduces stock and creates a return_out movement. Contact the distributor separately for the supplier credit/refund.</p>
  `;

  pnote('');

  $('submit-purchase-return').addEventListener('click', async () => {
    const items = [...$('purchase-form').querySelectorAll('.purchase-return-qty')]
      .map(input => ({
        purchase_item_id: input.dataset.id,
        qty: Number(input.value)
      }))
      .filter(x => Number.isFinite(x.qty) && x.qty > 0);

    if (!items.length) {
      pnote('Enter a return quantity for at least one item.', true);
      return;
    }

    const reason = $('purchase-return-reason').value.trim();

    if (!reason) {
      pnote('A reason is required.', true);
      $('purchase-return-reason').focus();
      return;
    }

    const button = $('submit-purchase-return');

    if (!confirm('Record this supplier return and reduce the selected batch stock?')) return;

    button.disabled = true;
    button.textContent = 'Processing…';

    try {
      const { data: returnId, error: rpcError } = await sb.rpc('process_purchase_return', {
        p_invoice: invoiceId,
        p_items: items,
        p_reason: reason
      });

      if (rpcError) {
        pnote(friendly(rpcError), true);
        return;
      }

      pnote('Purchase return recorded. Stock has been reduced.');
      $('purchase-form').innerHTML = '';

      await loadPurchaseReturns();
      await loadPurchases();

    } catch (err) {
      pnote(friendly(err), true);
    } finally {
      button.disabled = false;
      button.textContent = 'Record purchase return';
    }
  });
}

$('purchase-list')?.addEventListener('click', async e => {
  const id = e.target.closest('[data-purchase]')?.dataset.purchase;
  if (id) await showPurchase(id);
});

$('pq')?.addEventListener('input', renderPurchaseList);

async function loadPurchaseReturns() {
  const { data, error } = await sb.rpc('purchase_return_list', {
    p_limit: 25
  });

  if (error) {
    $('purchase-past').textContent = friendly(error);
    return;
  }

  const byId = new Map(purchases.map(p => [p.id, p]));

  $('purchase-past').innerHTML = `
    <div style="overflow-x:auto"><table>
      <thead>
        <tr>
          <th>Return no.</th><th>Supplier invoice</th><th>Distributor</th>
          ${isAdmin ? '<th>Value</th>' : ''}
          <th>Reason</th><th>Date</th>
        </tr>
      </thead>
      <tbody>
        ${(data || []).map(r => {
          const p = byId.get(r.purchase_invoice_id);
          return `
            <tr>
              <td>${esc(r.return_no)}</td>
              <td>${esc(p?.supplier_invoice_no || '—')}</td>
              <td>${esc(p?.distributor || '—')}</td>
              ${isAdmin ? `<td>${inr(r.total_value)}</td>` : ''}
              <td>${esc(r.reason)}</td>
              <td>${esc(localDate(r.created_at))}</td>
            </tr>
          `;
        }).join('') || `<tr><td colspan="${isAdmin ? 6 : 5}">No purchase returns recorded yet.</td></tr>`}
      </tbody>
    </table></div>
  `;
}

/* ---------------- Page tabs and initial loading ---------------- */

if (canPurchaseReturn) {
  if (canCustomerReturn) {
    $('customer-tab').onclick = () => {
      $('customer-panel').hidden = false;
      $('purchase-panel').hidden = true;
      $('customer-tab').classList.remove('sec');
      $('purchase-tab').classList.add('sec');
    };
  }

  $('purchase-tab').onclick = async () => {
    if (canCustomerReturn) {
      $('customer-panel').hidden = true;
    }

    $('purchase-panel').hidden = false;
    $('purchase-tab').classList.remove('sec');

    if (canCustomerReturn) {
      $('customer-tab').classList.add('sec');
    }

    if (!purchases.length) {
      await loadPurchases();
    }

    await loadPurchaseReturns();
  };
}

if (canCustomerReturn) {
  await searchInvoices();
  await loadRecent();
} else if (canPurchaseReturn) {
  // Inventory Staff use this page for supplier returns only.
  await $('purchase-tab').click();
}
