# PALLIKKAL MEDICALS — version 80

## Run in Supabase (SQL editor), in this order
1. `0037_final_requirements.sql` and `0038_billing_medicine_discount.sql` — only if not run yet (both are safe to run again).
2. `database/migrations/0039_day_close_print_purchase_no.sql` — new in version 80. Safe to run again.
3. `database/diagnostics/verify_final_v80.sql` — read-only check. Every row should show `ok = true`.

## New in version 80
1. **All Bills for Today** — Billing (header and Quick Actions), Sales and Finance. Prints every bill of the day on one 80 mm roll: logo and pharmacy details once, then each bill complete ("BILL 1 OF n"). A short-list layout (one line per bill) and A4 are also available; any earlier day can be chosen. Admins can add a day summary (bill count, totals by payment method); staff never see income totals.
2. **80 mm bills** — bold, pure-black text (Arial 700, larger sizes), dashed rules, the Pallikkal Pharmacy logo (black-and-white version for thermal printers), address, phone, e-mail, GSTIN (only printed when entered) and drug licence numbers. Footer: thank-you note and a QR code. Settings → Print & Invoice now has GSTIN, drug licence number(s), thank-you note and QR options (WhatsApp chat — default, UPI payment for the bill amount, any link such as a Google review page, or none) with a live preview. The PDF download is bold too and includes the logo and QR.
3. **Daily closing balance** — Billing → Close Day (any staff) or Finance → Opening & closing. Cash counted at closing, once per day (a second entry is refused). Admins see the expected cash (morning opening + cash in − cash out) and the excess or shortage, can correct with a reason (Audit logs), and get a day-by-day history table.
4. **Return bills** — after a sales return or purchase return is submitted, the return bill opens at once for printing (80 mm or A4): SALES RETURN BILL (credit note) / PURCHASE RETURN BILL (debit note), with items, batch, quantity × rate, totals, refund method or distributor details, and signature lines. It can be printed again from the Returns list.
5. **Purchase order number** — every posted purchase gets 1, 2, 3 … automatically. Existing purchases were numbered in the order they were entered. The next number shows on the New purchase form; the number is shown in the list ("PO No."), the confirm step, the detail view, the printout and the Excel export, and cannot be changed. The old typed "Order no." box is now "Supplier order ref.".
6. **Fix** — between midnight and 5:30 AM India time, opening balances dated today were refused (the database clock is UTC). Fixed.

# Earlier notes (version 78 / 79)

**Version 79:** the discount set on a medicine (10% or ₹5 off each unit) now always shows in Billing — in the search list ("Disc 10%") and in the Disc. column — and is saved on the bill. If the database is not updated, Billing shows a message asking to run 0038.

## Database — run in this order (Supabase → SQL editor)

1. `database/migrations/0037_final_requirements.sql` — one run (safe to run twice). Needs 0021–0036 already applied (they are on your live database).
2. `database/migrations/0038_billing_medicine_discount.sql` — version 79: makes Billing use the discount set in Medicines (10% or ₹5). Safe to run again. It ends with a small table of your discounted medicines and the discount Billing will use.
3. `database/diagnostics/verify_final_v80.sql` — read-only. Every row should show `ok = true`. Send the result grid back.

## What changed

**Contact details** — 8848642677 · pallikkalpharmacy@gmail.com · Pallikkal Bazar, Pallikkal PO, Malappuram 673634 on bills, the home page and the website settings. Ayurvedic store: 9895843039, same address. No other contact details are shown. The shop open/closed badge on the home page still follows the Billing Open/Closed switch.

**Login and sessions**
- Admin, staff and delivery login pages work as before; after login everyone (admin and staff) lands on Billing, delivery staff on Delivery.
- No automatic logout during the day. Signing in on another device no longer signs you out. The next day everyone signs in again (sessions from earlier days are closed at the next login).
- Change password keeps the "current password" box. On the first login it is labelled "Temporary password" (the one the admin gave). This prevents someone at an unlocked screen changing another person's password.
- First login of the day asks for the opening balance (once per day for the whole shop). New popup design. Finance shows a Daily Opening Balance chart.

**Sidebars**
- Staff: Billing, Delivery, Medicines, Inventory, Customers, Sales, Returns, Distributors, WhatsApp. Staff see individual bill amounts but no total income figures.
- Admin: Dashboard, Billing, Delivery, Medicines, Inventory, Customers, Sales, Returns, Distributors, WhatsApp, then MORE: Purchases, Expenses, Finance, Reports, Staff, Documents, Settings, Audit logs.

**Medicines** — GST may be 0. Discount as % or a fixed ₹ amount; billing applies it automatically. 100 medicines per page (pagination for 4,000+). Excel template has every field.

**Distributors** — Excel template has every field of the form (name, contact person, phone, email, GSTIN, drug licence, address, active). Logo is uploaded in the form.

**Inventory → Initial stock** — GST % column (shown in billing as entered), unit price = MRP ÷ pack, optional distributor column (a new name is added to Distributors), narrow serial / wide item columns, Excel template headers, suggestions while typing medicine and distributor names.

**Purchases**
- Distributor: type the name; suggestions appear under the box. A new name is added to Distributors when the bill is posted (the **New** button still adds phone, GSTIN and licence).
- HSN removed from medicine lines.
- GST % is a number box (0 allowed).
- One **Discount** box: `3%` = percentage, `10` = fixed ₹ amount for the line.
- Medicine name shows type-ahead suggestions (not a drop-down).
- Billing uses MRP ÷ pack as the unit price; GST % is only displayed (MRP already includes GST); amount = unit price × qty.

**Billing** — Open/Closed switch drives the home page. Delivery staff status Online / Offline / On Purchase shown in Billing and Delivery. Shelf column (not printed), GST column (display only), discount from the medicine, FEFO across batches, warning when the quantity is above stock, bill number `YYYY-MM-DD-####`, "Add another payment method" for split payments.

**WhatsApp** — one-tap sending (opens WhatsApp with the message filled in; press Send). Every staff role can send bills, reminders and messages; campaigns, templates and settings stay Admin-only.

## Decisions taken
- Branch `state` is left empty (the address line already says Malappuram).
- Current password kept on Change password (labelled Temporary password on first login).
- A ₹ medicine discount is per unit; in purchases a plain number is a ₹ amount for the whole line.
- Purchases, Documents and the other MORE pages are Admin pages; staff opening them see "no access". Purchase links are hidden from staff on Inventory, Medicines and Distributors.
- Every staff role (Pharmacist, Billing Staff, Inventory Staff) has the same rights on the nine staff pages: billing, returns, stock adjust / transfer, medicines, distributors, customers and WhatsApp.
