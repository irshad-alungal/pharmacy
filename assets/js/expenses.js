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

loadExpenses();
