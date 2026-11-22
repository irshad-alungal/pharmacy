# Invoice View redesign (version 77)

`invoice-view.html` now has two uses on one page:

| Opened as | Who | What they see |
|---|---|---|
| `invoice-view.html?id=…` (or `?no=INV-…`, or no address part = latest bill) | Super Admin, Admin, Pharmacist, Billing Staff (same as Sales) | The new **Invoice View** from your design, with the same sidebar, top search, bell and profile as the Dashboard (Sales highlighted). |
| `invoice-view.html?t=<private code>` | Customers, from the WhatsApp message | The same invoice card **without** the sidebar or login, read-only, as before. |

There is no "Your Trusted Healthcare Partner" section.

## What to do
1. In the Supabase SQL editor, run `database/migrations/0036_invoice_view.sql`. It is safe to run twice and needs 0026 (Sales) and 0030 (WhatsApp), which you already ran.
2. Optional: run `database/diagnostics/verify_0036.sql`. Every row should say `true`.
3. Upload the new files.

Without 0036 the page still shows the invoice, items, totals, printing, PDF, WhatsApp and Previous / Next. It shows a message asking you to run 0036 for the cashier, customer ID, delivery and payment status.

## The staff page
- **Header**
  - "Invoice View", breadcrumb Home › Sales › Invoices › Invoice #…
  - **Previous** (older bill) and **Next** (newer bill). The ← → keys do the same, and the browser Back button works.
- **Invoice card**
  - **Shop:** logo, pharmacy name, address, phone, e-mail, GSTIN and drug licence. These come from Business Information and follow the Print & Invoice switches.
  - **TAX INVOICE:** invoice number, date and time, **Sales Type** (Counter Sale / Home Delivery), **Payment Mode** (e.g. UPI + Credit) and **Cashier** (who made the bill).
  - **Customer Details:** name, mobile (tap to call), **Customer ID**, **Type** (New / Regular / Loyalty member / Walk-in). Patient and doctor are shown when saved with the bill.
  - **Items:** #, medicine and strength, **batch**, **expiry**, qty, MRP, discount ₹, GST %, amount.
  - **Notes:** your invoice terms from Settings → Print & Invoice. If none are set, the two default notes are shown. The UPI line appears when it is switched on in Settings.
  - **Totals:** subtotal, total discount, taxable amount, GST (per rate), round-off, **Total Amount** and the amount in words.
  - **Footer:** a thank-you line (or your invoice footer) and a scannable **barcode** of the invoice number.
  - A cancelled bill gets a "CANCELLED" stamp.
- **Invoice Actions**
  - Paper size: A4 or 80 mm receipt. The default comes from Settings.
  - **Print Invoice** (also Ctrl+P), **Download PDF**, **Share via WhatsApp** (the private customer link, as before).
  - **Email Invoice:** opens your e-mail app with the customer's e-mail, subject, medicines, total and the private link.
  - **Shortcuts:**
    - Sales return
    - New bill for this customer
    - Customer profile
    - Copy customer link
    - Copy invoice number
    - Show in the Sales list
- **Payment Summary**
  - Paid / Partly paid / On credit / Refunded / Cancelled.
  - Total, amount paid, on credit, returned, **balance**, and how it was paid.
  - The customer's total credit due, with a link to collect it.
- **Delivery Details**
  - Status (Pending / Out for delivery / Delivered / Failed), delivery boy with staff ID, delivered on (or the failure reason), and the address.
  - A counter sale offers *Arrange home delivery*.
- **Returns:** the credit notes against the bill, with amount and refund method.
- **Customer invoice link:** valid till, how many times the customer opened it, and **Stop this link** (Admin only).

On a phone the layout follows your mobile image:
- back arrow with Previous / Next;
- a compact table with the batch and expiry under each medicine;
- totals beside a large Total Amount box;
- a Payment Status bar;
- four action buttons, two per row;
- Delivery Details.

## Where it opens from
- **Sales:** row menu and bill details → **Open invoice page**.
- **Top search:** on every page, an invoice result now opens the Invoice View. Before, it went to the Sales list.
- **Dashboard → Recent Transactions:** clicking a bill opens its Invoice View.

## Kept
- **The customer's WhatsApp link:** works exactly as before.
  - No login.
  - Expires after 180 days.
  - Phone shown as ******1234.
  - No diagnosis, doctor, address, cashier or customer ID.
  - Download PDF, A4 / receipt choice, Print, Call pharmacy, and a new *WhatsApp pharmacy* button.
- **Printing:** Print and PDF use the same printed invoice as Billing and Sales, with your Settings formats.
- **Sales bill-details dialog:** unchanged.

## Notes
- **E-mail:** there is no e-mail server in the app, so *Email Invoice* opens your own e-mail app with everything filled in. To attach the PDF, download it first.
- **Balance:** the balance is the amount left on credit for this bill. Credit you collect later is recorded against the customer, not the bill. The summary therefore also shows the customer's total credit due.
- **Pharmacy name:** the shop name printed is the one in Business Information ("PALLIKKAL MEDICALS" in your data). The logo is the Pallikkal Pharmacy logo, or your uploaded logo when "Show Pharmacy Logo on Invoice" is on.

## Files
- **New:**
  - `database/migrations/0036_invoice_view.sql`
  - `database/diagnostics/verify_0036.sql`
  - `assets/js/invoice-page.js`
  - `assets/js/invoice-card.js`
  - `assets/css/invoice-view.css`
- **Changed:**
  - `invoice-view.html`
  - `assets/js/invoice-view.js`
  - `assets/js/sales.js`: Open invoice page.
  - `assets/js/global-search.js`: invoices open here.
  - `assets/js/dashboard.js`: recent bills open here.
- **Tests:**
  - `tests/live-replica/live-0036.test.mjs`: 25 checks.
  - `tests/e2e/invoice_view_flow.py`: 64 checks.
  - Updated: `dashboard_flow.py`, `whatsapp_flow.py`, `server.mjs` (runs 0036).
