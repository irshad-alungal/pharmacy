# Billing page redesign — version 56

No SQL is needed. Upload the changed files, then hard-refresh with Ctrl+Shift+R.

## What changed
- `billing.html` uses the same navy sidebar, top search, bell and user menu as the dashboard, without the "Your Trusted Healthcare Partner" block.
- The layout follows the approved design:
  - header with **Hold Bills** (count badge), **Bill History** and **Billing Settings**;
  - Customer and Prescription boxes;
  - medicine search with camera scan and **Scan Barcode**;
  - items table showing photo, batch, expiry, MRP, a − / + quantity stepper, a discount dropdown and the amount;
  - **Add Notes**, **Clear Cart** and **Save as Hold**;
  - Quick Actions;
  - Invoice Summary and Payment Method, ending with **Generate Bill (₹ total)**.
- On phones the page becomes the mobile design: item cards, then the summary and payment below.

## How each control works
| Control | Behaviour |
|---|---|
| Customer | Type a name or phone number and choose from the list, or leave it as Walk-in. Shows the available credit. |
| Add | Creates a customer (name and 10-digit phone) and selects them. If the number already exists, the existing customer is selected instead. |
| Prescription | Opens the doctor, patient name, phone and address fields, which are saved on the bill. |
| Upload | Attaches a PDF or image. After the bill is generated it is saved to the customer's doctor-sheet record, so a customer is needed. |
| Search | Matches name, brand or barcode. Arrow keys move through the results and Enter adds one. An exact barcode match is added straight away. |
| Scan Barcode | Gets the search box ready for a USB or Bluetooth scanner; the scanned code is added automatically. |
| Camera button | Scans with the camera where the browser supports it (Chrome, Edge, Android). |
| − / + and Qty | Changes the quantity, and stock is re-allocated FEFO (earliest expiry first) each time. − at quantity 1 removes the item. |
| Disc. dropdown | Preset discounts up to the branch limit, plus Custom…. It needs the discount permission, and every change is audited. |
| Batch / "3 batches" | Shows the batch rows: MRP and GST can be edited (with permission) and the GST and taxable value for each batch are shown. "Choose batches" (override with a reason) and "Why?" are kept. |
| Add Notes | Saved as the bill's diagnosis / notes. |
| Discount ✎ / Apply Offer | Adds a bill discount in ₹, with 2%, 5% and 10% presets. It is audited. |
| Cash | Optional "cash received" field that shows the change to return. |
| Card / UPI | The full amount by default; enter less to leave the balance on the customer's credit. |
| Wallet | Recorded as UPI, because the accounts only accept cash, UPI, card or credit. |
| Credit | The whole bill goes on the selected customer's account, within their credit limit. |
| Other | Split payment across Cash, UPI and Card. |
| Browse Medicines | A searchable list of in-stock medicines; click one to add it. |
| Print Last Bill | Reopens your latest bill with the Thermal / A4 / PDF options. |
| Billing Settings | Admins can change the maximum discount %, the reservation minutes and the near-expiry days. Everyone can see their own editing permissions. |

Everything that already existed is unchanged:
- shop open/closed;
- delivery status;
- the AI billing assistant;
- held bills (resume and delete);
- batch override;
- stock reservations;
- the stock-changed retry;
- the invoice preview, printing and PDF.

## Files
- **Changed:**
  - `billing.html`, `assets/js/billing.js`;
  - `assets/js/brand-shell.js`: the logo and bottom bar point to Billing for staff who don't have the dashboard;
  - `assets/js/dashboard.js`: the search now comes from the shared module;
  - `tests/e2e/flows.py`.
- **New:**
  - `assets/css/billing-pos.css`;
  - `assets/js/global-search.js`: the shared top search;
  - `tests/e2e/billing_flow.py`.

## Tests
- `billing_flow.py`: 41 checks. Every control is used, and the saved bills, payments, notes, prescription file and settings are compared with the database.
- `flows.py` 40/40, `flows2.py` 40/40 and `dashboard_flow.py` 47/47 pass.
- The click-through of every page by every role is clean.
