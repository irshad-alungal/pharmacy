# Finance Management redesign (version 68)

`finance.html` now follows the attached design. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and there is no "Your Trusted Healthcare Partner" block.

The page has 6 tabs: **Overview · Ledger · Customer dues · Supplier payables · Receipts & payments · Opening balances**. Access is still Admin and Super Admin only.

## Run once in Supabase
**`database/migrations/0028_finance_management.sql`**, then check it with `database/diagnostics/verify_0028.sql` (every row true). It is safe to run twice. Nothing existing is changed:
- **Read-only figures:** profit (with the FIFO cost of medicines sold), month-by-month totals, one transaction list, the daily cash book and balances.
  - These read the bills, returns, receipts, supplier payments and expenses, so they match the other pages.
- **`correct_daily_cash_opening`** (admin): fixes a wrong morning entry.
  - The old ledger entry is reversed and the corrected amount posted.
  - The reason is kept on the opening and in the audit log.
- **Bank opening balance** (admin): record it once from the pass book, and reverse it if it is wrong.

Before 0028 is run, the Ledger, Customer dues, Supplier payables, Receipts & payments and Opening balances tabs still work, and the morning openings are listed. A note asks you to run 0028.

## Overview tab
- **Header buttons:**
  - **Add Transaction:** receive from a customer, pay a distributor, add an expense, opening balances.
  - **Download:** transactions (Excel / CSV), ledger CSV, daily cash book CSV, profit & loss statement.
  - **More:** the other tabs, Reports, Expenses.
- **KPIs (this month, vs. last month up to the same day):**
  - **Total Income** = sales − returns.
  - **Total Expenses** = posted expenses.
  - **Net Profit** = income − **cost of medicines sold (FIFO purchase cost)** − expenses.
  - **Profit Margin** = net profit ÷ income.
  - Stock purchases are not counted as expenses. They reach profit only when the medicines are sold, which is why the profit is realistic.
- **Transaction History** — every money movement in one list: sales receipts (cash / UPI / card), credit received, customer refunds, supplier payments, expenses and the morning opening cash.
  - Period, search and filters: type, transaction, method, status.
  - Columns: date & time, reference no., description, type, amount, payment method, status, 👁 and ⋯.
  - **Row ⋯ menu:** details, open the source document, print a voucher, **reverse** a receipt or supplier payment.
- **Cash Flow Overview:** money in, money out and net cash flow line, for 6 or 12 months.
- **Account Balances:**
  - **Bank Account** = bank opening balance + UPI, card and bank-transfer movements.
  - **Cash in Hand** = today's **morning opening** + cash in − cash out.
  - **Total Balance**, with links to customer dues and supplier payables.
- **Income vs Expenses:** monthly bars; the tooltip also shows the cost of medicines and the profit.
- **Expense by Category:** this month.
- **Financial Summary:** the 4 tiles, plus cost of medicines sold, gross profit, purchases, returns, dues and payables.
- **Bell:**
  - morning opening not entered
  - bank opening not set
  - customers over their credit limit
  - a loss so far this month

## Opening balances tab (driven by the morning pop-up)
- **Today's card:**
  - The opening cash submitted in the morning pop-up, with who entered it and when.
  - Cash in today: cash sales and dues collected.
  - Cash out today: expenses, supplier payments and refunds.
  - **Cash that should be in the drawer now.**
  - If nobody has entered the opening yet, it can be entered here. Admins can **Correct** a wrong entry, with a reason.
- **Daily cash book** (any dates, 30 days by default):
  - Columns: morning opening, entered by, cash in, cash out, expected closing, next morning's opening.
  - **Difference:** Matched / Short / Excess, so you can spot cash taken out or missing.
- **Bank account opening.**
- **Customer & supplier opening balances** (as before): post and reverse, with history.

## Other tabs
- **Ledger:**
  - Filter by account and dates, search the memo, 50 lines per page.
  - Debit / credit totals, account summary chips, CSV.
  - Reversals are highlighted.
- **Customer dues:**
  - Total due, customers owing, over-limit count, advances held.
  - Search, a credit-used meter, **Receive payment**, **WhatsApp reminder** with the amount, open customer.
- **Supplier payables:** total owed, advances, search, **Record payment / advance**, open distributor.
- **Receipts & payments:** customer receipts and supplier payments side by side, by date, searchable, with **Reverse** (as before).

## Tested
- `tests/live-replica/live-0028.test.mjs`: 20 checks through the real sale, return, receipt, payment, expense and morning-opening functions. Covers the FIFO cost, cash book arithmetic, the bank opening, correcting an opening (ledger and audit), and roles.
- `tests/e2e/finance_flow.py`: 50 checks against the database. Covers every KPI, the transactions, reversals, balances, charts, P&L, all 6 tabs, the morning pop-up opening showing in the cash book, correction, bank and party openings, links, mobile, roles, and the page without 0028.
- All other suites pass: flows 40, flows2 40, dashboard 47, billing 41, delivery 41, medicines 32, inventory 69, purchases 64, distributors 42, customers 50, sales 56, returns 52, expenses 50; replica 0021–0027; admin click-through.
