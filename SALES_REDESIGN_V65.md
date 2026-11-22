# Sales Management redesign (version 65)

`sales.html` now follows the attached design. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and there is no "Your Trusted Healthcare Partner" block.

## Run once in Supabase
**`database/migrations/0026_sales_management.sql`**, then check it with `database/diagnostics/verify_0026.sql` (every row true). It is safe to run twice and changes no table — it only adds four read-only reporting functions and three indexes:
- `sales_list(from, to)` — every bill in the period with customer, item count, payment split (cash / UPI / card / credit), returns, billed-by, medicine names and barcodes.
- `sales_summary(from, to, until)` — sales, bills, customers, walk-ins, discount, GST, returns and payment split.
- `sales_daily(from, to)` — sales per day for the trend chart.
- `sales_top_medicines(from, to, n)` — best sellers by quantity, with value.

Roles: admin, pharmacist and billing staff (the same people who could open Sales before). Inventory and delivery staff cannot read sales.

Before 0026 is run the page still works: bills are listed, KPIs and the summary are counted from the bills, and a note asks you to run 0026. Payment split, items, top medicines and returns per bill appear after it is run.

## Page
- **Header:** New Sale (Billing), Sales Return (Returns), POS (opens Billing in its own window for the counter), Export (bills as Excel or CSV, top medicines as Excel, print list).
- **KPIs** — Today's Sales, Total Orders, Unique Customers, Average Order Value — each compared with **yesterday up to the same time**, so a morning is not compared with a whole day. Unique customers = registered customers who bought + walk-in bills.
- **Sales Transactions** (Today by default):
  - Show: all / completed / with returns / credit sales / walk-in / cancelled.
  - Search by invoice number, customer name or phone, patient, doctor, **medicine name or barcode**.
  - Filter: period (today, yesterday, 7 days, 30 days, this month, last month, any dates up to 400 days), payment (cash, UPI, card, credit, split), billed by, minimum amount, sort.
  - Columns: invoice, date & time, customer, items, amount (with any refund), payment, status (Completed / Part returned / Returned / Cancelled), 👁 and ⋯. 10/25/50/100 per page.
- **Row ⋯ menu:** view details, preview / print (as before), sales return (opens Returns with this bill's items ready), WhatsApp the bill to the customer, customer profile, new bill for this customer, copy invoice number.
- **Bill details:** customer, patient, doctor, payments, every item with batch and expiry, discount, GST, total, credit notes against the bill.
- **Sales Trend:** last 7 days, 30 days, this month, 6 or 12 months.
- **Top Selling Medicines** for the same period; click one to see its bills; View All lists the top 100 for any period with Excel export.
- **Sales Summary (This Month):** total sales, orders, customers, average order value, plus returns, net sales, discount, GST collected, credit, walk-ins and cancelled bills (click to list them).
- **Payment Methods (This Month):** cash / UPI / card / credit share; click one to list those bills.
- **Bell:** credit sold today, returns today, cancelled bills, or no sales yet today.
- Links: `sales.html?q=<invoice / phone / medicine>` (dashboard search, customers page), `sales.html?invoice=<id>` opens a bill, `returns.html?invoice=<id>` opens a bill for return.

## Tested
- `tests/live-replica/live-0026.test.mjs` — 13 checks (branch isolation, totals, payment split, returns, same-time comparison, roles).
- `tests/e2e/sales_flow.py` — 56 checks against the database, including mobile, roles and the page without 0026.
- All other suites still pass: flows 40, flows2 40, dashboard 47, billing 41, delivery 41, medicines 32, inventory 69, purchases 64, distributors 42, customers 50; replica 0021–0025; click-through for admin, billing staff and pharmacist.
