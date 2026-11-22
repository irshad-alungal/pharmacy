# Distributors Management redesign (version 63)

`distributors.html` now follows the attached design. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and there is no "Your Trusted Healthcare Partner" block.

**No new SQL.** The figures come from `purchase_list_v2` / `purchase_order_list` (migration 0024 from version 61) and `payable_balances`.

## Page
- **Header buttons:**
  - **Add Distributor**
  - **Import** (Excel/CSV)
  - **Export** (Excel, or CSV when offline)
  - **⋯** menu: import template, print list, find duplicates (same name / GSTIN / phone), new purchase bill, new purchase order
- **KPIs** (click to filter the list):
  - **Total Distributors**, with the change vs. last month
  - **Active Distributors**, as % of total
  - **Total Purchase Value**: this month vs. the same days last month
  - **Outstanding Amount**: payable balance, number of distributors owed
  - For non-admin staff the last two show bill counts and open purchase orders instead of money.
- **Distributors List:**
  - **Show filter:** all / active / inactive / with outstanding / purchased in 30 days / no purchase in 90 days.
  - **Search** by name, contact person, phone digits, GSTIN, email, DL no. or address.
  - **Filter panel:** sort (name, purchase value, outstanding, bills, last purchase, recently added), GSTIN missing, DL missing.
  - **Columns:** #, Distributor (logo or coloured icon, GSTIN, bills, amount due), Contact Person, Phone (tap to call, WhatsApp icon), Email, Status, 👁 / ⋯. Paging is 10/25/50/100.
- **Row ⋯ menu:**
  - view, edit
  - **new purchase bill / new purchase order for this distributor** (opens Purchases with the supplier already chosen)
  - view purchases
  - **record payment** (admins)
  - call, WhatsApp, email
  - activate / deactivate (warns about open orders and dues)
- **Purchase from Distributors:** chart for the last 6 months, 12 months or 30 days.
- **Top Distributors:** by purchase value and orders. View All sorts the list by value.
- **Distributor Summary:** Total / Active / Inactive / Outstanding tiles, plus chips for "no purchase in 90 days", "GSTIN missing", "drug licence missing" and advances paid.
- **Bell:** distributors with overdue bills, missing GSTIN or DL, and late purchase orders.

## Distributor details
- **Profile:** logo, contact person and address, with one-tap call / WhatsApp / email.
- **Details:** GSTIN with its state, drug licence, date added, last purchase.
- **Tiles:** total purchased, number of bills, payable now (or the advance held), average bill value.
- **Actions:** new bill, new order, record payment, edit, print statement.
- **Lists:**
  - open purchase orders;
  - every purchase bill with its balance — **View** opens the bill lines inside the dialog;
  - payments made to this distributor.

## Add / edit (all existing fields kept)
- **Fields:** name, contact person, email, several phone numbers, GSTIN (uppercase, checked live — shows the state), drug licence, address, logo upload / remove, active.
- A duplicate warning appears while typing a name, GSTIN or phone that already exists.

## Import
- Columns: Name, Contact person, Phone, Email, GSTIN, Drug licence, Address, Active.
- A distributor with the same name or GSTIN is **updated**; blank cells keep the old values. Anything else is **added**.
- Rows with problems are skipped and listed with the reason.

## Tested
- New `tests/e2e/distributors_flow.py`: 42 checks against the database.
- All other suites pass: flows 40, flows2 40 (including the old distributor test), dashboard 47, billing 41, delivery 41, medicines 32, inventory 69, purchases 64.
- Monkey click-through for admin, inventory staff and pharmacist.
