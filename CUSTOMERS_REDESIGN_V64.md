# Customers Management redesign (version 64)

`customers.html` now follows the attached design. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and there is no "Your Trusted Healthcare Partner" block.

## Run once in Supabase
**`database/migrations/0025_customers_management.sql`**, then check it with `database/diagnostics/verify_0025.sql` (every row true). It is safe to run twice.

What it adds (nothing existing is changed):
- **Customer ID** `CUS-00001…` for every customer.
  - Existing customers are numbered in the order they joined; new ones (including customers added from Billing) get the next number automatically.
  - The ID can never be changed.
- **Loyalty membership** (with the date the customer joined), **date of birth** and **notes**.
- **`customer_stats()`**: bills, total purchases, returns, first and last bill, last-12-months spend and credit outstanding for every customer, in one call. Available to admin, pharmacist and billing staff.

Before 0025 is run, the page still works: customers, add/edit, credit and bills. The ID, totals, repeat and loyalty columns show "—" and a note asks you to run it.

## Page
- **Header buttons:**
  - **Add Customer**
  - **Import** (Excel/CSV)
  - **Export**
  - **⋯** menu: import template, birthdays this month (with a WhatsApp greeting button), find duplicates, print list, new bill, WhatsApp messages
- **KPIs** (click to filter):
  - **Total Customers**, with the change vs. last month
  - **Active Customers**, as % of total
  - **Repeat Customers** (2 or more bills), as % of total
  - **Loyalty Members**, as % of total
- **Customers List:**
  - **Show filter:** all / active / inactive / repeat / loyalty / with credit due / new this month / birthdays this month / no purchase in 90 days / never purchased.
  - **Search** by name, phone digits, email, customer ID or address.
  - **Filter panel:** sort (newest, name, total purchases, bills, last purchase, credit due), gender, WhatsApp consent only.
  - **Columns:** #, Customer ID, Name (👑 for loyalty members, bill count, credit due), Phone (tap to call, WhatsApp icon if they agreed), Email, Total Purchases (sales less returns), Status, 👁 / ⋯. Paging is 10/25/50/100.
- **Row ⋯ menu:**
  - view, edit
  - **new bill** (Billing opens with this customer already selected)
  - view sales
  - credit status
  - **receive payment** (when they owe)
  - edit credit limit (admins)
  - add to / remove from loyalty
  - call, WhatsApp, email
  - activate / deactivate (warns if they still owe)
- **Customer Growth:** customers over the last 6 months, 12 months or 30 days, with new customers per period.
- **Top Customers:** by purchase value and orders.
- **Customer Summary:** Total / Active / Repeat / Loyalty, plus credit due, new this month, birthdays this month, no purchase in 90 days and WhatsApp consent.
- **Bell:** customers over their credit limit, total credit due, and birthdays today.

## Customer details
- **Profile:** ID, status, loyalty tier, address, gender and age, with one-tap call / WhatsApp / email.
  - Tiers come from last-12-months spend: **Silver**; **Gold** from ₹10,000; **Platinum** from ₹25,000.
- **Tiles:** total purchases, bills, credit outstanding, loyalty points (1 per ₹100 spent since joining; the average bill value for non-members).
- **Details:** credit limit, available credit, last purchase, customer since, date of birth, consent, loyalty date, last-12-months spend, notes.
- **Actions:** new bill, receive payment, edit, credit limit (admin), loyalty, print statement.
- **Lists:**
  - **Sales bills:** view or print each bill (as before) and upload a doctor's sheet or take a photo of it (as before).
  - **Credit payments received.**

## Add / edit (all previous fields kept)
- Fields: name, phone, email, address, age, gender, WhatsApp consent, active — plus date of birth (fills the age), notes and loyalty member.
- A warning appears while typing a phone number that another customer already has, with a button to open that customer.

## Import
- Columns: Name, Phone, Email, Address, Age, Gender, Date of birth, WhatsApp consent, Loyalty member, Notes.
- A customer with the same phone number is updated, and blank cells keep the old values. Anything else is added.
- Rows with problems are skipped and listed with the reason.

**Loyalty points are shown only — they cannot be redeemed against a bill yet.**

## Tested
- New tests:
  - `tests/live-replica/live-0025.test.mjs`: 10 checks.
  - `tests/e2e/customers_flow.py`: 50 checks against the database.
- All other suites pass: flows 40, flows2 40, dashboard 47, billing 41, delivery 41, medicines 32, inventory 69, purchases 64, distributors 42.
- Replica 0021–0024 still pass, and the monkey click-through passes for admin, billing staff and pharmacist.
