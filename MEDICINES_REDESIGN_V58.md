# Medicines page redesign — version 58

No SQL is needed. Upload the changed files, then hard-refresh with Ctrl+Shift+R.

## Layout
- Same sidebar, top search, bell and user menu as the dashboard, without the "Your Trusted Healthcare Partner" block.
- **Header buttons:**
  - **Add Medicine**;
  - **Import**: upload an Excel file, or download the template;
  - **Export**: the current filtered list as Excel, or CSV if Excel support can't load;
  - **Bulk Update**: for roles that can edit medicines.
- **KPIs:**
  - Total Medicines: active medicines, compared with last month;
  - In Stock, Low Stock and Out of Stock, each with its % of the total. Clicking a card filters the list.
  - Stock means sellable stock: not expired, not quarantined and not blocked. These are the same rules billing and the dashboard use.
  - **Low** means at or below the medicine's **Minimum stock**.
- **Medicine List:**
  - search across name, strength, brand, generic name, ingredients, composition, barcode, SKU and manufacturer;
  - filters: All Categories, All Brands, and All Stock Status, which includes "Inactive medicines";
  - Reset;
  - 10, 25 or 50 rows per page.
- **Row:**
  - photo (or a placeholder), name, form, brand, category, MRP, stock and status;
  - the **⋯** menu: View details, Edit, Update stock, View history, Photos, Cost history (admins only), Duplicate, Print label, Request deactivation / Activate.
  - Clicking a row shows it in **Medicine Details**:
    - barcode, next batch to sell (earliest expiry) and its expiry;
    - **MRP**: from that batch;
    - **Selling price**: MRP less the medicine's discount;
    - **current stock**.
  - The **›** opens the full profile: all fields, the batch table, photos and "Search Google" for ingredients.
- **Selection:** row tick-boxes (shown on hover, or once one is ticked) select medicines for Bulk Update.

## Quick Actions (for the selected medicine)
- **Edit Medicine:** the existing form plus new fields.
  - **Manufacturer** and **Category**, each with "＋ Add new…";
  - **Dosage form**, **Barcode** (duplicates are refused), **Minimum stock** and **GST %**.
  - All of these columns already existed in the database.
- **Update Stock:**
  - shows every batch with its status;
  - Adjust (increase / decrease / damaged / expired write-off, with a reason) uses the same `adjust_stock` function as Inventory;
  - also links to a new purchase bill and to Inventory.
- **View History:** stock movements for this medicine; administrators also see purchase cost.
- **Duplicate:** opens the form as a copy, with no barcode.
- **Print Label:** shelf / barcode labels with a real Code 128 barcode, 50 × 25 mm or an A4 sheet, any quantity.
- **Delete:**
  - medicines are never removed, because bills and stock history depend on them;
  - this sends the existing **deactivation request**, which Super Admin approves;
  - for an inactive medicine the button becomes **Activate** (Super Admin).

## Kept unchanged
- Who can change active status (Super Admin only).
- The optional discount field: if migration 0018 hasn't been run, the page works without it.
- The Excel import rules: duplicate names skipped, rows retried one by one, report shown.
- The Super Admin deactivation approval list. It now appears only when requests are waiting, and the bell shows them.
- Photos (camera, square crop, primary photo).
- Dashboard links: `medicines.html?q=` and `?new=1`. New: `?status=low|out|in|inactive`.

## Files
- **Changed:**
  - `medicines.html`, `assets/js/medicines.js`;
  - `assets/css/billing-pos.css`: button padding fix that also improves Billing and Delivery;
  - `tests/e2e/server.mjs`: demo data only.
- **New:**
  - `assets/css/medicines-pos.css`;
  - `tests/e2e/medicines_flow.py`.

## Tests
- `medicines_flow.py`: 32 checks covering every figure against the database, add / edit / duplicate / bulk update / adjust / history / label / photos / deactivate / activate / export / paging, and the phone layout.
- `flows.py` 40/40, `flows2.py` 40/40, `dashboard_flow.py` 47/47, `billing_flow.py` 41/41 and `delivery_flow.py` 41/41 pass.
- The click-through of every page by every role is clean.
