# Purchases Management redesign (version 61)

`purchases.html` now follows the attached design. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and there is no "Your Trusted Healthcare Partner" block.

## Run once in Supabase
1. If you have not run it yet: `0023_inventory_stock_transfer.sql` (from version 59).
2. **`database/migrations/0024_purchases_management.sql`**
   - Adds purchase orders and a richer purchase list.
   - Nothing existing is changed, and the file is safe to run twice.
   - Check it with `database/diagnostics/verify_0024.sql`; every row should say true.

Without 0024 the page still shows bills through the old list and tells you to run it. Purchase orders need it.

## Page
- **Header buttons:**
  - **New Purchase** opens the supplier bill. The ▾ arrow beside it also offers "Purchase order" and "Continue a draft".
  - **Purchase Return** is for admins.
  - **Import** fills bill lines from Excel, or downloads the template.
  - **Export** downloads the filtered list.
- **KPIs (this month vs. the same days last month):**
  - Total Purchases (₹)
  - Purchase Orders (bills)
  - Items Purchased (packs)
  - Active Distributors
- **Purchase List:**
  - **Filters:** period (Today / 7 / 30 / 90 days / month / last month / year / all / custom), search (invoice, distributor, or medicine for admins), distributor, status, and a Filter panel (date range, amount, unpaid only, no bill file).
  - **Status tabs:** All · Received · Ordered · Partial · Drafts.
  - **Columns:** #, Invoice No. (with its PO number and a paper-clip when a bill file is attached), Distributor, Date, Items, Amount (with Due / Overdue / Paid), Status, 👁 and ⋯. Paging is 10/25/50/100.
  - **Bill ⋯ menu:** View, Print, Attach bill file, Record payment, Purchase return, New order to this distributor, Open distributor.
  - **Order ⋯ menu:** View, Receive stock, Edit, Print, Send on WhatsApp, Cancel / Close.
  - **Draft actions:** Continue, Delete.
- **Purchase Trend:** last 7 days, 30 days or 12 months, with a tooltip on each point.
- **Top Distributors:** by purchase value and orders for the selected period. Clicking one filters the list.
- **Purchase Summary (This Month):** total, bills, items and average order value. Below them: unpaid balance with an overdue count, open orders and drafts. Each can be clicked.
- **Bell:** overdue or due-this-week supplier bills, late orders, and unposted drafts.

## Purchase orders
1. Place an order to a distributor. Lines take the medicine, pack, quantity and an optional rate. "Add low-stock items" fills them from the reorder levels.
2. When the goods come, **Receive stock** opens the normal bill form already filled with the pending quantities. You enter the invoice number, batch, expiry, MRP and rates.
3. Posting the bill adds stock exactly as before (`confirm_purchase_v2`, wrapped by `confirm_purchase_v3`). It also marks the order **Partially Received** or **Received** in the same transaction.
4. A partly received order can be closed; an untouched order can be edited or cancelled.

## Existing functions kept
- Supplier bill with pack factor and free quantity.
- Batch MRP/GST, HSN, rate mode, discount, freight and round-off, with a printed-total check.
- Duplicate-invoice warning.
- Create a medicine from a bill row.
- Excel template and bulk upload.
- Drafts.
- Bill files from upload or camera.
- Confirm screen before posting.
- Admin payment when posting.
- Detail view with lines, payments and documents.
- Deep links: `?q=`, `?new=1`, plus the new `?order=1` and `?tab=ordered|partial|received|drafts`.

## Roles
- **Admins:** everything, including amounts, payments and returns.
- **Pharmacists and inventory staff:**
  - can post bills, place, receive and cancel orders, and attach bill files;
  - amounts are hidden, so KPIs and the trend count bills and units instead.
- Purchase returns and payments stay admin-only, as the database enforces.

Also fixed in this version: pop-up windows now stay centred on screen when the page is scrolled. This applies on every redesigned page.

## Tested
- New `tests/e2e/purchases_flow.py`: 48 checks against the database.
- New `tests/live-replica/live-0024.test.mjs`: 24 checks.
- These suites still pass:
  - flows (40), flows2 (40), dashboard (47), billing (41), delivery (41), medicines (32), inventory (69);
  - replica 0021 / 0022 / 0023;
  - monkey click-through on the purchases page for 3 roles.
