# PALLIKKAL MEDICALS — version 78 (final)

## Database — run in this order (Supabase → SQL editor)

1. `database/migrations/0037_final_requirements.sql` — one run (safe to run twice). Needs 0021–0036 already applied (they are on your live database).
2. `database/diagnostics/verify_final_v78.sql` — read-only. Every row should show `ok = true`. Send the result grid back.

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
