import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc, inr } from './utils.js';
import { friendly } from './ui.js';

const prof = await mountShell('expenses', 'Expenses');
const $ = id => document.getElementById(id);

// Expenses are restricted to the two owner/admin roles, not admin_staff.
if (!['admin', 'super_admin'].includes(String(prof.role || '').toLowerCase())) {
  $('view').innerHTML = '<p class="notice">Only Admin and Super Admin can access Expenses.</p>';
  throw new Error('Expenses access denied');
}

$('view').innerHTML = `
  <section class="card expense-create-card">
    <div class="expense-toolbar-head"><div><h3>New expense</h3><p class="muted">Create an expense draft. Posting is a separate step.</p></div></div>
    <form id="expense-form" class="expense-form">
      <label>Expense date<input id="expense-date" type="date" required></label>
      <label>Category<select id="expense-category" required><option value="">Loading categories…</option></select></label>
      <label class="expense-wide">Description<input id="expense-description" type="text" maxlength="500" required placeholder="What was this expense for?"></label>
      <label>Amount (₹)<input id="expense-amount" type="number" min="0.01" max="999999999999.99" step="0.01" required placeholder="0.00"></label>
      <label>Payment method<select id="expense-payment" required><option value="">Select payment method</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank">Bank</option></select></label>
      <label>Reference (optional)<input id="expense-reference" type="text" maxlength="150" placeholder="Transaction or bill reference"></label>
      <label class="expense-wide">Notes (optional)<textarea id="expense-notes" rows="2" maxlength="2000" placeholder="Additional details"></textarea></label>
      <div class="expense-form-actions expense-wide"><button id="expense-save-draft" type="submit">Save draft</button><button id="expense-form-clear" type="button" class="sec">Clear form</button></div>
      <div id="expense-form-message" class="expense-wide" role="status" aria-live="polite"></div>
    </form>
  </section>
  <section class="expense-toolbar card">
    <div class="expense-toolbar-head">
      <div><h3>Expense register</h3><p class="muted">View and filter expenses for your active branch.</p></div>
      <button id="expense-refresh" type="button" class="sec">Refresh</button>
    </div>
    <div class="expense-filters">
      <label>From date<input id="expense-from" type="date"></label>
      <label>To date<input id="expense-to" type="date"></label>
      <label>Status<select id="expense-status">
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="posted">Posted</option>
        <option value="cancelled">Cancelled</option>
      </select></label>
      <button id="expense-apply" type="button">Apply filters</button>
      <button id="expense-clear" type="button" class="sec">Clear</button>
    </div>
    <div id="expense-message" role="status" aria-live="polite"></div>
  </section>
  <section class="card">
    <div class="expense-table-wrap">
      <table class="expense-table">
        <thead><tr>
          <th>Date</th><th>Expense no.</th><th>Category</th><th>Description</th>
          <th>Payment</th><th>Status</th><th class="num">Amount</th><th>Receipts</th>
        </tr></thead>
        <tbody id="expense-rows"><tr><td colspan="8">Loading expenses…</td></tr></tbody>
      </table>
    </div>
  </section>
`;

const message = (text, bad = false) => {
  $('expense-message').textContent = text || '';
  $('expense-message').className = bad ? 'expense-error' : 'expense-message';
};

const formMessage = (text, bad = false) => {
  $('expense-form-message').textContent = text || '';
  $('expense-form-message').className = bad ? 'expense-error expense-wide' : 'expense-message expense-wide';
};

const todayLocal = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
$('expense-date').value = todayLocal();

const loadCategories = async () => {
  const select = $('expense-category');
  const { data, error } = await sb.rpc('expense_category_get_list', {
    p_include_inactive: false
  });
  if (error) {
    select.innerHTML = '<option value="">Unable to load categories</option>';
    formMessage(friendly(error), true);
    return;
  }
  const categories = (data || []).filter(c => c.active !== false);
  select.innerHTML = '<option value="">Select category</option>' + categories.map(c =>
    `<option value="${esc(c.category_id)}">${esc(c.category_name)}${c.is_shared ? ' (Default)' : ''}</option>`
  ).join('');
  if (!categories.length) select.innerHTML = '<option value="">No active categories</option>';
};

$('expense-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('expense-save-draft');
  const amount = Number($('expense-amount').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    formMessage('Enter an amount greater than zero.', true);
    return;
  }
  const payload = {
    p_expense_id: null,
    p_expense_date: $('expense-date').value,
    p_category_id: $('expense-category').value,
    p_description: $('expense-description').value.trim(),
    p_amount: amount,
    p_payment_method: $('expense-payment').value,
    p_reference: $('expense-reference').value.trim() || null,
    p_notes: $('expense-notes').value.trim() || null
  };
  if (!payload.p_expense_date || !payload.p_category_id || !payload.p_description || !payload.p_payment_method) {
    formMessage('Complete all required fields.', true);
    return;
  }
  button.disabled = true;
  button.textContent = 'Saving…';
  formMessage('');
  const { data, error } = await sb.rpc('expense_save_draft', payload);
  button.disabled = false;
  button.textContent = 'Save draft';
  if (error) {
    formMessage(friendly(error), true);
    return;
  }
  formMessage(`Draft saved successfully. Expense ID: ${data}`);
  $('expense-form').reset();
  $('expense-date').value = todayLocal();
  await loadExpenses();
});

$('expense-form-clear').addEventListener('click', () => {
  $('expense-form').reset();
  $('expense-date').value = todayLocal();
  formMessage('');
});

const loadExpenses = async () => {
  const from = $('expense-from').value || null;
  const to = $('expense-to').value || null;
  const status = $('expense-status').value || null;
  if (from && to && from > to) {
    message('The From date must be on or before the To date.', true);
    return;
  }

  $('expense-rows').innerHTML = '<tr><td colspan="8">Loading expenses…</td></tr>';
  message('');
  const { data, error } = await sb.rpc('expense_get_list', {
    p_from: from,
    p_to: to,
    p_status: status
  });

  if (error) {
    $('expense-rows').innerHTML = '<tr><td colspan="8">Unable to load expenses.</td></tr>';
    message(friendly(error), true);
    return;
  }

  const rows = data || [];
  $('expense-rows').innerHTML = rows.map(item => `
    <tr>
      <td>${esc(item.expense_date || '')}</td>
      <td>${esc(item.expense_no || '')}</td>
      <td>${esc(item.category_name || '')}</td>
      <td>${esc(item.description || '')}</td>
      <td>${esc(String(item.payment_method || '').toUpperCase())}</td>
      <td><span class="expense-status status-${esc(item.status || '')}">${esc(item.status || '')}</span></td>
      <td class="num">${inr(item.amount)}</td>
      <td>${Number(item.receipt_count) || 0}</td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="expense-empty">No expenses found for these filters.</td></tr>';
  message(`${rows.length} expense${rows.length === 1 ? '' : 's'} found.`);
};

$('expense-apply').addEventListener('click', loadExpenses);
$('expense-refresh').addEventListener('click', loadExpenses);
$('expense-clear').addEventListener('click', () => {
  $('expense-from').value = '';
  $('expense-to').value = '';
  $('expense-status').value = '';
  loadExpenses();
});

loadCategories();
loadExpenses();
