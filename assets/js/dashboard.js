import { mountShell } from './navigation.js';
import { sb, esc, inr } from './supabase-client.js';

const prof = await mountShell('dashboard', 'Dashboard');
if (!prof) throw new Error('no session');

const view = document.getElementById('view');
const role = String(prof.role || '').toLowerCase();

// Dashboard is intentionally restricted to the two owner/admin roles.
if (!['super_admin', 'admin'].includes(role)) {
  view.innerHTML = '<div class="notice">You do not have access to this page.</div>';
  throw new Error('Dashboard access denied');
}

const dateKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const [year, month, day] = dateKey.split('-').map(Number);
// Asia/Kolkata is UTC+05:30. Use exact local-day boundaries for timestamp columns.
const dayStart = new Date(Date.UTC(year, month - 1, day) - 330 * 60000).toISOString();
const dayEnd = new Date(Date.UTC(year, month - 1, day + 1) - 330 * 60000).toISOString();
const todayLabel = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric'
}).format(new Date());

const money = value => inr(Number(value) || 0);
const count = value => new Intl.NumberFormat('en-IN').format(Number(value) || 0);
const safe = promise => promise.then(({ data, error }) => {
  if (error) { console.warn('Dashboard data unavailable:', error.message); return null; }
  return data;
}).catch(error => {
  console.warn('Dashboard request failed:', error);
  return null;
});

view.innerHTML = `
  <section class="dash-head">
    <div><p class="dash-eyebrow">OWNER OVERVIEW</p><h3>Pharmacy dashboard</h3><p class="dash-muted">${esc(todayLabel)} · ${esc(prof.full_name || prof.staff_id || 'Administrator')}</p></div>
    <button class="dash-refresh" id="dash-refresh" type="button">Refresh data</button>
  </section>
  <div id="dash-status" class="dash-status" role="status">Loading branch data…</div>
  <section class="dash-grid dash-kpis" id="dash-kpis"></section>
  <section class="dash-panel" id="dash-expense-report">
    <div class="dash-panel-head"><h3>Expenses overview</h3><a href="expenses.html">Open expenses</a></div>
    <div id="dash-expense-kpis" class="dash-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:10px"><p class="dash-muted">Loading expense totals…</p></div>
    <div class="dash-columns" style="margin-bottom:0">
      <div><h4>Current month by category</h4><div id="dash-expense-categories" class="dash-list"><p class="dash-muted">Loading…</p></div></div>
      <div><h4>Daily totals this month</h4><div id="dash-expense-daily" class="dash-table-wrap"><p class="dash-muted">Loading…</p></div></div>
    </div>
  </section>
  <section class="dash-columns">
    <article class="dash-panel"><div class="dash-panel-head"><h3>Inventory alerts</h3><a href="inventory.html">Open inventory</a></div><div id="dash-stock" class="dash-list"><p class="dash-muted">Loading…</p></div></article>
    <article class="dash-panel"><div class="dash-panel-head"><h3>Expiry watch</h3><a href="medicines.html">Medicines</a></div><div id="dash-expiry" class="dash-list"><p class="dash-muted">Loading…</p></div></article>
  </section>
  <section class="dash-columns">
    <article class="dash-panel"><div class="dash-panel-head"><h3>Outstanding balances</h3><a href="finance.html">Finance</a></div><div id="dash-dues" class="dash-list"><p class="dash-muted">Loading…</p></div></article>
    <article class="dash-panel"><div class="dash-panel-head"><h3>Today's ledger totals</h3><a href="finance.html">View finance</a></div><div id="dash-ledger" class="dash-list"><p class="dash-muted">Loading…</p></div></article>
  </section>
  <section class="dash-columns">
    <article class="dash-panel"><div class="dash-panel-head"><h3>Recent sales</h3><a href="sales.html">All sales</a></div><div id="dash-sales" class="dash-table-wrap"><p class="dash-muted">Loading…</p></div></article>
    <article class="dash-panel"><div class="dash-panel-head"><h3>Recent purchases</h3><a href="purchases.html">All purchases</a></div><div id="dash-purchases" class="dash-table-wrap"><p class="dash-muted">Loading…</p></div></article>
  </section>
  <section class="dash-panel"><div class="dash-panel-head"><h3>Quick actions</h3></div><div class="dash-actions">
    <a href="billing.html">＋ New bill</a><a href="purchases.html">＋ New purchase</a><a href="medicines.html">＋ Add medicine</a><a href="reports.html">View reports</a>
  </div></section>
`;

function renderKpis(items) {
  document.getElementById('dash-kpis').innerHTML = items.map(item => `
    <article class="dash-kpi"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><small>${esc(item.note || '')}</small></article>
  `).join('');
}
function renderRows(id, rows, empty, render) {
  const el = document.getElementById(id);
  el.innerHTML = rows?.length ? rows.map(render).join('') : `<p class="dash-muted">${esc(empty)}</p>`;
}
function tableMarkup(rows, empty, columns) {
  if (!rows?.length) return `<p class="dash-muted">${esc(empty)}</p>`;
  return `<table class="dash-table"><thead><tr>${columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(c => `<td>${esc(c.value(row))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function loadDashboard() {
  const status = document.getElementById('dash-status');
  status.textContent = 'Refreshing branch data…';
  const branch = prof.branch_id;

  const jobs = await Promise.all([
    safe(sb.from('sales_invoices').select('total,created_at').eq('branch_id', branch).eq('status', 'final').gte('created_at', dayStart).lt('created_at', dayEnd)),
    safe(sb.rpc('purchase_list', { p_limit: 500 })),
    safe(sb.from('sales_returns').select('total,created_at').eq('branch_id', branch).gte('created_at', dayStart).lt('created_at', dayEnd)),
    safe(sb.from('purchase_returns').select('total_value,created_at').eq('branch_id', branch).gte('created_at', dayStart).lt('created_at', dayEnd)),
    safe(sb.rpc('low_stock')),
    safe(sb.from('medicine_batches').select('expiry,qty,quarantined').eq('branch_id', branch).gt('qty', 0)),
    safe(sb.rpc('customer_dues')),
    safe(sb.rpc('payable_balances')),
    safe(sb.rpc('ledger_summary', { p_from: dateKey, p_to: dateKey })),
    safe(sb.rpc('invoice_search', { p_q: '', p_limit: 8 })),
    safe(sb.rpc('expense_get_summary', { p_from: dateKey, p_to: dateKey })),
    safe(sb.rpc('expense_get_summary', { p_from: `${year}-${String(month).padStart(2, '0')}-01`, p_to: dateKey }))
  ]);

  const [sales, purchases, salesReturns, purchaseReturns, lowStock, batches, dues, payables, ledger, recentSales, todayExpenses, monthExpenses] = jobs;
  const todayPurchases = (purchases || []).filter(p => String(p.invoice_date || '').slice(0, 10) === dateKey);
  const todaySalesTotal = (sales || []).reduce((sum, row) => sum + Number(row.total || 0), 0);
  const todayPurchaseTotal = todayPurchases.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const todaySalesReturnTotal = (salesReturns || []).reduce((sum, row) => sum + Number(row.total || 0), 0);
  const todayPurchaseReturnTotal = (purchaseReturns || []).reduce((sum, row) => sum + Number(row.total_value || 0), 0);

  renderKpis([
    { label: "Today's sales", value: money(todaySalesTotal), note: `${count(sales?.length || 0)} finalized bills` },
    { label: "Today's purchases", value: todayPurchases.some(p => p.total == null) ? 'Restricted' : money(todayPurchaseTotal), note: `${count(todayPurchases.length)} purchase entries` },
    { label: 'Sales returns today', value: money(todaySalesReturnTotal), note: `${count(salesReturns?.length || 0)} return entries` },
    { label: 'Purchase returns today', value: money(todayPurchaseReturnTotal), note: `${count(purchaseReturns?.length || 0)} return entries` }
  ]);

  // Expense summaries are returned only to Admin/Super Admin by the protected RPC.
  const todayExpenseRows = (todayExpenses || []).filter(r => r.summary_type === 'daily');
  const monthExpenseRows = (monthExpenses || []).filter(r => r.summary_type === 'monthly');
  const categoryExpenseRows = (monthExpenses || []).filter(r => r.summary_type === 'category')
    .sort((a, b) => Number(b.total_amount || 0) - Number(a.total_amount || 0));
  const dailyExpenseTotal = todayExpenseRows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
  const monthExpenseTotal = monthExpenseRows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
  const todayExpenseCount = todayExpenseRows.reduce((sum, r) => sum + Number(r.expense_count || 0), 0);
  const monthExpenseCount = monthExpenseRows.reduce((sum, r) => sum + Number(r.expense_count || 0), 0);
  document.getElementById('dash-expense-kpis').innerHTML = [
    { label: "Today's posted expenses", value: money(dailyExpenseTotal), note: `${count(todayExpenseCount)} posted entries` },
    { label: 'This month’s expenses', value: money(monthExpenseTotal), note: `${count(monthExpenseCount)} posted entries` }
  ].map(item => `<article class="dash-kpi"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><small>${esc(item.note)}</small></article>`).join('');
  renderRows('dash-expense-categories', categoryExpenseRows, 'No posted expenses this month.', row =>
    `<div class="dash-row"><span>${esc(row.category_name || 'Uncategorised')}<small>${count(row.expense_count)} entries</small></span><b>${money(row.total_amount)}</b></div>`);
  document.getElementById('dash-expense-daily').innerHTML = tableMarkup(
    (monthExpenses || []).filter(r => r.summary_type === 'daily').sort((a, b) => String(b.period).localeCompare(String(a.period))),
    'No posted expenses this month.', [
      { label: 'Date', value: r => r.period },
      { label: 'Count', value: r => count(r.expense_count) },
      { label: 'Total', value: r => money(r.total_amount) }
    ]
  );

  renderRows('dash-stock', lowStock, 'No low-stock medicines reported.', row => `
    <div class="dash-row"><span><strong>${esc(row.name)}</strong><small>Reorder level: ${count(row.reorder_level)}</small></span><b>${count(row.sellable)} left</b></div>`);

  const activeBatches = batches || [];
  const expired = activeBatches.filter(b => !b.quarantined && Number(b.qty) > 0 && b.expiry < dateKey).length;
  const within30 = activeBatches.filter(b => !b.quarantined && Number(b.qty) > 0 && b.expiry >= dateKey && b.expiry <= addDays(dateKey, 30)).length;
  const within90 = activeBatches.filter(b => !b.quarantined && Number(b.qty) > 0 && b.expiry > addDays(dateKey, 30) && b.expiry <= addDays(dateKey, 90)).length;
  renderRows('dash-expiry', [
    { label: 'Expired batches', value: expired },
    { label: 'Expiring within 30 days', value: within30 },
    { label: 'Expiring in 31–90 days', value: within90 }
  ], 'Expiry data unavailable.', row => `<div class="dash-row"><span>${esc(row.label)}</span><b>${count(row.value)}</b></div>`);

  const customerTotal = dues?.reduce((sum, row) => sum + Number(row.outstanding || 0), 0);
  const supplierTotal = payables?.reduce((sum, row) => sum + Number(row.balance || 0), 0);
  renderRows('dash-dues', [
    { label: 'Customer outstanding', value: customerTotal == null ? null : money(customerTotal), count: dues?.length },
    { label: 'Supplier outstanding', value: supplierTotal == null ? null : money(supplierTotal), count: payables?.length }
  ].filter(row => row.value !== null), 'Balance information unavailable for this session.', row => `<div class="dash-row"><span>${esc(row.label)}<small>${count(row.count)} accounts</small></span><b>${esc(row.value)}</b></div>`);

  const debit = ledger?.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const credit = ledger?.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  renderRows('dash-ledger', ledger ? [
    { label: 'Total debit entries', value: money(debit) },
    { label: 'Total credit entries', value: money(credit) }
  ] : [], 'Ledger summary unavailable.', row => `<div class="dash-row"><span>${esc(row.label)}</span><b>${esc(row.value)}</b></div>`);

  document.getElementById('dash-sales').innerHTML = tableMarkup(recentSales, 'No finalized sales found.', [
    { label: 'Invoice', value: r => r.invoice_no },
    { label: 'Customer', value: r => r.customer_name },
    { label: 'Total', value: r => money(r.total) }
  ]);
  document.getElementById('dash-purchases').innerHTML = tableMarkup((purchases || []).slice(0, 8), 'No purchase entries available.', [
    { label: 'Supplier invoice', value: r => r.supplier_invoice_no || '—' },
    { label: 'Distributor', value: r => r.distributor || '—' },
    { label: 'Total', value: r => r.total == null ? 'Restricted' : money(r.total) }
  ]);
  status.textContent = 'Dashboard updated. All data is limited to your assigned branch.';
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

document.getElementById('dash-refresh').addEventListener('click', loadDashboard);
await loadDashboard();
