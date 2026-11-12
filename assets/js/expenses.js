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
          <th>Payment</th><th>Status</th><th class="num">Amount</th><th>Receipts</th><th>Actions</th>
        </tr></thead>
        <tbody id="expense-rows"><tr><td colspan="9">Loading expenses…</td></tr></tbody>
      </table>
    </div>
  </section>
  <dialog id="expense-receipts-dialog" class="expense-receipts-dialog">
    <div class="expense-receipts-dialog-inner">
      <h3 id="expense-receipts-title">Expense receipts</h3>
      <div id="expense-receipts-list"></div>
      <button id="expense-receipts-close" type="button" class="sec">Close</button>
    </div>
  </dialog>
  <input id="expense-camera-input" type="file" accept="image/*" capture="environment" hidden>
  <input id="expense-file-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden>
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

  $('expense-rows').innerHTML = '<tr><td colspan="9">Loading expenses…</td></tr>';
  message('');
  const { data, error } = await sb.rpc('expense_get_list', {
    p_from: from,
    p_to: to,
    p_status: status
  });

  if (error) {
    $('expense-rows').innerHTML = '<tr><td colspan="9">Unable to load expenses.</td></tr>';
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
      <td class="expense-row-actions">
        ${item.status !== 'cancelled' ? `<button type="button" class="sec" data-receipt-camera="${esc(item.expense_id)}" data-expense-no="${esc(item.expense_no || '')}">Take photo</button> <button type="button" class="sec" data-receipt-file="${esc(item.expense_id)}" data-expense-no="${esc(item.expense_no || '')}">Upload file</button>` : ''}
        ${(Number(item.receipt_count) || 0) > 0 ? `<button type="button" class="sec" data-receipt-view="${esc(item.expense_id)}" data-expense-no="${esc(item.expense_no || '')}">View receipts</button>` : ''}
        ${item.status === 'draft' ? `<button type="button" class="expense-post-button" data-expense-post="${esc(item.expense_id)}" data-expense-no="${esc(item.expense_no || '')}">Post</button>` : ''}
        ${item.status === 'posted' ? `<button type="button" class="sec expense-cancel-button" data-expense-cancel="${esc(item.expense_id)}" data-expense-no="${esc(item.expense_no || '')}">Cancel expense</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="expense-empty">No expenses found for these filters.</td></tr>';
  message(`${rows.length} expense${rows.length === 1 ? '' : 's'} found.`);
};


// Receipt upload: camera capture on supported mobile devices, or choose a PDF/image.
const receiptBucket = sb.storage.from('expense-receipts');
let pendingReceiptExpense = null;
let pendingReceiptNo = null;
const allowedReceiptTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const maxReceiptBytes = 15 * 1024 * 1024;
$('expense-receipts-close').addEventListener('click', () => $('expense-receipts-dialog').close());

function receiptExtension(file) {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return '';
}

async function uploadExpenseReceipt(file) {
  if (!pendingReceiptExpense || !file) return;
  if (!allowedReceiptTypes.includes(file.type) || file.size <= 0 || file.size > maxReceiptBytes) {
    message('Choose a PDF, JPEG, PNG or WebP file up to 15 MB.', true);
    return;
  }
  const extension = receiptExtension(file);
  const path = `${pendingReceiptExpense}/${crypto.randomUUID()}.${extension}`;
  message(`Uploading receipt for ${pendingReceiptNo || 'expense'}…`);
  const { error: uploadError } = await receiptBucket.upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (uploadError) {
    message(friendly(uploadError), true);
    return;
  }
  const { data, error: registerError } = await sb.rpc('expense_register_receipt', {
    p_expense_id: pendingReceiptExpense,
    p_storage_path: path,
    p_file_name: file.name
  });
  if (registerError) {
    // The bucket intentionally has no client DELETE policy. Keep the uploaded
    // object private and report registration failure for controlled cleanup.
    message(`File uploaded but receipt registration failed: ${friendly(registerError)}. Please contact an administrator for cleanup.`, true);
    return;
  }
  message(`Receipt uploaded and registered successfully. Receipt ID: ${data}`);
  await loadExpenses();
}

$('expense-camera-input').addEventListener('change', async () => {
  const file = $('expense-camera-input').files?.[0];
  await uploadExpenseReceipt(file);
  $('expense-camera-input').value = '';
});
$('expense-file-input').addEventListener('change', async () => {
  const file = $('expense-file-input').files?.[0];
  await uploadExpenseReceipt(file);
  $('expense-file-input').value = '';
});

async function showExpenseReceipts(expenseId, expenseNo) {
  $('expense-receipts-title').textContent = `Receipts — ${expenseNo || 'Expense'}`;
  $('expense-receipts-list').textContent = 'Loading receipts…';
  $('expense-receipts-dialog').showModal();
  const { data, error } = await sb.rpc('expense_get_detail', { p_expense_id: expenseId });
  if (error) {
    $('expense-receipts-list').textContent = friendly(error);
    return;
  }
  const receipts = (data || []).filter(row => row.receipt_id);
  if (!receipts.length) {
    $('expense-receipts-list').textContent = 'No receipts attached to this expense.';
    return;
  }
  $('expense-receipts-list').innerHTML = receipts.map(receipt => `
    <div class="expense-receipt-item">
      <div><strong>${esc(receipt.receipt_file_name || 'Receipt')}</strong><br>
      <small>${esc(receipt.receipt_mime_type || '')} · ${(Number(receipt.receipt_file_size) / 1024 / 1024).toFixed(2)} MB</small></div>
      <button type="button" class="sec" data-receipt-open="${esc(receipt.receipt_storage_path)}">Open</button>
    </div>`).join('');
}
$('expense-receipts-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-receipt-open]');
  if (!button) return;
  button.disabled = true;
  const { data, error } = await receiptBucket.createSignedUrl(button.dataset.receiptOpen, 300);
  button.disabled = false;
  if (error) {
    $('expense-receipts-list').insertAdjacentText('beforeend', ` Unable to open receipt: ${friendly(error)}`);
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener');
});

$('expense-rows').addEventListener('click', async event => {
  const cameraButton = event.target.closest('[data-receipt-camera]');
  const fileButton = event.target.closest('[data-receipt-file]');
  const viewButton = event.target.closest('[data-receipt-view]');
  if (cameraButton || fileButton) {
    const source = cameraButton || fileButton;
    pendingReceiptExpense = source.dataset.receiptCamera || source.dataset.receiptFile;
    pendingReceiptNo = source.dataset.expenseNo || '';
    (cameraButton ? $('expense-camera-input') : $('expense-file-input')).click();
    return;
  }
  if (viewButton) {
    await showExpenseReceipts(viewButton.dataset.receiptView, viewButton.dataset.expenseNo || '');
    return;
  }
  const cancelButton = event.target.closest('[data-expense-cancel]');
  if (cancelButton) {
    const expenseId = cancelButton.dataset.expenseCancel;
    const expenseNo = cancelButton.dataset.expenseNo || 'this expense';
    const reason = window.prompt(`Enter the reason for cancelling ${expenseNo}:`);
    if (reason === null) return;
    if (!reason.trim()) {
      message('A cancellation reason is required.', true);
      return;
    }
    if (!confirm(`Cancel ${expenseNo}? This will create a reversal journal. Original ledger entries will remain unchanged.`)) return;

    cancelButton.disabled = true;
    cancelButton.textContent = 'Cancelling…';
    message('');
    const { data, error } = await sb.rpc('expense_cancel', {
      p_expense_id: expenseId,
      p_reason: reason.trim()
    });
    if (error) {
      cancelButton.disabled = false;
      cancelButton.textContent = 'Cancel expense';
      message(friendly(error), true);
      return;
    }
    message(`Expense ${expenseNo} cancelled successfully. Reversal journal ID: ${data}`);
    await loadExpenses();
    return;
  }

  const button = event.target.closest('[data-expense-post]');
  if (!button) return;
  const expenseId = button.dataset.expensePost;
  const expenseNo = button.dataset.expenseNo || 'this expense';
  if (!confirm(`Post ${expenseNo}? This will create permanent financial ledger entries. You can cancel later only through a reversal.`)) return;

  button.disabled = true;
  button.textContent = 'Posting…';
  message('');
  const { data, error } = await sb.rpc('expense_post', {
    p_expense_id: expenseId
  });
  if (error) {
    button.disabled = false;
    button.textContent = 'Post';
    message(friendly(error), true);
    return;
  }
  message(`Expense ${expenseNo} posted successfully. Journal ID: ${data}`);
  await loadExpenses();
});

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
