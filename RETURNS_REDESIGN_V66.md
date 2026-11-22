# Returns Management redesign (version 66)

`returns.html` now follows the attached design, with **Sales Returns** (from customers) and **Purchase Returns** (to distributors) as two tabs on one page. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and there is no "Your Trusted Healthcare Partner" block.

## Run once in Supabase
**`database/migrations/0027_returns_management.sql`**, then check it with `database/diagnostics/verify_0027.sql` (every row true). It is safe to run twice. Nothing existing is removed:
- **Reason code** on sales returns: Wrong medicine, Adverse reaction, Expired / near expiry, Damaged, Doctor changed prescription, Not needed / excess, Other.
- **Reason code** on purchase returns: Expired / near expiry, Damaged / broken, Wrong item supplied, Excess / slow-moving, Batch recall, Other.
- Existing returns get a reason code guessed from the reason text that was already typed.
- **Refund type** on sales returns: **Refund** (money back) or **Exchange** (the value is used on the new bill).
  - Money still goes out by Cash or UPI, so finance posting is unchanged.
  - When you make the exchange bill, the cash nets out.
- New returns are saved through `process_sales_return_v2` / `process_purchase_return_v2`. These call the existing return functions, so stock, FIFO cost and finance work exactly as before.
- Read-only list, detail, top-medicine, return-rate and **expiry-candidate** functions.

Before 0027 is run, the page still lists returns and still creates credit notes with the old functions, and a note asks you to run 0027.

## Sales Returns tab
- **Header:**
  - **New Return** opens a 2-step popup: find the bill by number, customer or phone; then for each item, quantity ("All" button) and condition (back to stock or damaged, as before).
  - In the popup you choose the reason, an optional note, **Refund / Exchange** and **Cash / UPI**. The refund total updates as you type.
  - After saving: **Print credit note**, **Make exchange bill** (Billing opens with the customer selected), or start another return.
- **Export** (Excel) and **⋯** menu: sales / purchase return, expired stock, CSV, print list, top returned medicines.
- **KPIs (this month):**
  - Total Returns and Return Value, vs. last month up to the same day.
  - **Return Rate** = returns ÷ sales.
  - **Refunded Amount** = money paid back, with % of returns. Exchanges are excluded.
- **Returns List:**
  - Period: today, 7 / 30 days, this month, last month, 3 months, this year, or any dates.
  - Search by return no., invoice no., customer, phone or medicine.
  - Filter by reason, refund type, refund by, condition; sort.
  - Columns: return no., invoice, date, customer, items, value, refund type, status, 👁 and ⋯.
- **Row ⋯ menu:** details, print credit note, open the bill, return more from the same bill, WhatsApp the customer, copy number.
- **Returns by Reason:** donut with % and count (click a reason to list those returns), plus Refunded Amount and Exchanged Value.
- **Return Trend:** 7 days, 30 days, this month, 6 or 12 months.
- **Top Returned Medicines:** by quantity and value. View All shows the top 100.
- **Bell:** returns today, and **adverse-reaction returns in the last 7 days** (with the medicines).

## Purchase Returns tab (admins, as before)
- **New Purchase Return:**
  1. Pick the supplier invoice.
  2. For each batch: expiry, stock in hand, how much can still be returned, quantity ("All").
  3. Choose a reason and note. The value including GST is shown before you save.
- **Expired / near-expiry stock to return:** batches that have expired or expire within 30 / 60 / 90 / 180 days, with the distributor and invoice they came from.
  - **Return** opens the purchase return with that batch, quantity and reason already filled.
  - The 4th KPI and the bell show how many batches are waiting.
- **Lists and charts:**
  - The list, reasons, trend and top medicines work the same way, for distributors.
  - **Supplier Credit:** the return value is credited against what you owe the distributor (payables), as before.
- **Debit note print (A4):** to hand over with the goods.

## Links
- `returns.html?tab=purchase` (dashboard), `?invoice=<id>` (Sales page → Sales return), `?q=<invoice no.>` and `?expiry=1`.

## Tested
- `tests/live-replica/live-0027.test.mjs`: 25 checks through the real sale, return, stock and finance functions (reason backfill, exchange, branch isolation, roles).
- `tests/e2e/returns_flow.py`: 52 checks against the database, covering both tabs, the popups, expiry returns, export, mobile, roles and the page without 0027.
- All other suites pass: flows 40, flows2 40, dashboard 47, billing 41, delivery 41, medicines 32, inventory 69, purchases 64, distributors 42, customers 50, sales 56; replica 0021–0026; click-through for admin, billing staff and pharmacist.
