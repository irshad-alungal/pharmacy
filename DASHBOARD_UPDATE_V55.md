# Dashboard update — version 55

No SQL is needed. Upload the changed files, then hard-refresh with Ctrl+Shift+R.

## New on the admin dashboard
- **Second row of figures:**
  - Today's Purchases;
  - Sales Returns Today;
  - Purchase Returns Today;
  - Today's Expenses.
  Each is compared with yesterday, and expense drafts that are not yet posted are flagged.
- **Quick Actions** has 10 shortcuts:
  - New Sale, New Purchase, Add Medicine, Add Customer;
  - Sales Return, Purchase Return;
  - Add Expense, Receive Payment;
  - Deliveries, Reports.
- **Today's Ledger Totals:**
  - money in, money out and net;
  - Cash, UPI, Card and Bank;
  - book totals for Sales, Returns, Purchases and Expenses;
  - a check that debits equal credits.
- **Outstanding Balances:** what customers owe you and what you owe distributors, each with its top 3 names and a link to collect or pay.
- **Expenses Overview:** this month's and today's totals, the drafts waiting to be posted, and bars by category.
- **Inventory Alerts:**
  - out of stock;
  - low stock;
  - expired batches still in stock;
  - batches expiring within 30 days;
  - blocked or quarantined batches;
  - medicine deactivation requests;
  - the low-stock list.
- **Expiry Watch:** tabs for Expired, ≤ 30 days and 31–90 days, showing each batch, its expiry date, the days left and the stock value at cost.
- **Recent Sales** and **Recent Purchases:** click any row to open it.
- The "Your Trusted Healthcare Partner" block is removed from the sidebar.
- The old bottom snapshot row is removed, because those figures now have their own cards.

## Links the quick actions use
| Link | Opens |
|---|---|
| `purchases.html?new=1` | The new-purchase form |
| `purchases.html?q=` | Purchases, filtered by the search |
| `returns.html?tab=purchase` | Supplier returns |
| `finance.html?tab=rec` / `pay` / `led` | That Finance tab, now highlighted |
| `expenses.html?new=1` | The new-expense form |
| `customers.html?new=1` | The add-customer form |

## Files changed
- `assets/js/dashboard.js`
- `assets/css/dashboard.css`
- `assets/js/brand-shell.js`
- `assets/js/purchases.js`
- `assets/js/returns.js`
- `assets/js/finance.js`
- `assets/js/expenses.js`
- `assets/js/customers.js`
- `tests/e2e/dashboard_flow.py`

## Tests
- `dashboard_flow.py`: 47 checks. Every figure is compared with the database, and every quick action is opened.
- `flows.py` 40/40 and `flows2.py` 40/40 still pass.
- The click-through of every page by every role is clean.
