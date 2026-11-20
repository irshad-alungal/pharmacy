# Inventory Management redesign (version 59)

The attached designs were for the **Inventory Management** page, so `inventory.html` was redesigned.
The sidebar, top bar, bell and mobile bottom navigation are the same as the dashboard, and there is no "Your Trusted Healthcare Partner" block.

## Run once in Supabase
`database/migrations/0023_inventory_stock_transfer.sql` (SQL editor → Run). It adds Stock Transfer between branches of the same pharmacy.
Check it with `database/diagnostics/verify_0023.sql` (every row true). Everything else on the page works without it; the Transfer dialog explains if it is missing, or if the pharmacy has only one branch.

## Page
- **Header:** Update Stock, Stock Adjustment, Stock Transfer, Export.
- **KPIs (click to filter):**
  - Total Items: active medicines, with the change vs. last month.
  - Total Stock: value at purchase cost for admins, at MRP for others; the trend compares units on hand with 30 days ago.
  - Low Stock Items: sellable stock ≤ reorder level, as a % of items.
  - Expiring Soon: sellable batches expiring in the next 30 days.
- **Inventory Stock List:** one row per batch, showing medicine, batch, expiry, MRP, stock, stock value (qty × MRP) and status.
  - Status chips: In Stock / Low / Out / Near expiry / Expired / Quarantined / Blocked-Recalled-Damaged.
  - Category and status filters, plus a Filter popover with expiry window, manufacturer, rack, near-expiry days and empty batches.
  - Search by name, batch or barcode, with paging at 10/25/50/100 per page.
  - Click a row for batch details. The ⋯ menu offers Adjust, Transfer, Quarantine/Release, Block/Recall/Damaged/Reactivate, Movements and Open medicine.
- **Stock Value:**
  - total stock value and purchase value (cost, admin only);
  - potential sales value (MRP less each medicine's discount);
  - ⓘ opens the full valuation: expired, quarantined, MRP and selling-price figures.
- **Stock Movement (last 7 days):** Stock In, Stock Out, Transfers and Adjustments. Each tile opens the filtered movement log (type, date range, medicine) and the branch transfer list.
- **Expiry Alerts:** the soonest-expiring batches with days-left chips. View All shows the low-stock, near-expiry and expired lists (the old Alerts tab).

## Existing functions kept
- Adjust stock (increase, decrease, damage, expiry write-off).
- Quarantine/release.
- Batch block/recall/damaged/reactivate.
- Physical count.
- Initial stock (entry + Excel upload).
- Valuation.
- Movement log.
- Low-stock and near-expiry alerts.

All of these use the same database functions as before. Update Stock gathers: receive a purchase, initial stock, physical count, adjust one batch, and returns.

## Roles
- **Admin:** everything, including cost figures.
- **Pharmacist / inventory staff:** can adjust, count and transfer; values are shown at MRP.
- **Billing staff:** view and export only; the movement card is hidden because they cannot read movements.

## Tested
New `tests/e2e/inventory_flow.py`: 52 checks, with figures compared to the database. Every other suite still passes:
- flows (40), flows2 (40), dashboard (47), billing (41), delivery (41), medicines (32);
- replica 0021 (63), 0022 (15), 0023 (13);
- monkey test on the inventory page for 4 roles.
