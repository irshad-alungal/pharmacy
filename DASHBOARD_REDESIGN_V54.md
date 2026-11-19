# Version 54 — Admin dashboard redesign (Pallikkal Pharmacy brand)

`dashboard.html` now follows the approved Pallikkal Pharmacy dashboard design, using the official logo from the brand pack: navy #02224D, green and white, with Montserrat headings. Every figure is read live from your branch's records.

| Element | Source of the figure |
|---|---|
| Today's Sales, and % vs. yesterday | Total of today's final bills (India time) compared with yesterday's |
| Orders, and % vs. yesterday | Number of today's final bills compared with yesterday's |
| Low Stock | `low_stock()`: the same list as Inventory → Alerts (stock at or below reorder level) |
| Pending Deliveries | Delivery requests that are pending or out for delivery |
| Sales Overview chart | Daily sales totals. Choose 7, 14, 30 or 90 days. Hover or tap a point to see that day. |
| Inventory Overview | Active medicines, split into in stock, low (at or below reorder level) and out of stock. Only unexpired stock that is not quarantined, blocked or recalled counts. |
| Recent Transactions | The 5 newest bills. Status: Completed, Credit, Cancelled or Refunded. Click a row to open it in Sales. |
| Low Stock Alerts | The 5 lowest medicines with current stock and minimum stock. Click a row to open it in Medicines. |
| Search (Ctrl + K) | Medicines, invoices and customers. Opens the matching page already filtered. |
| Bell | Low stock, expired batches still in stock, batches expiring within 30 days, unassigned deliveries and medicine-deactivation requests |
| New Sale / Add Medicine | Opens Billing / opens the Medicines "Add medicine" form |
| Bottom row | Customer dues, supplier payables, expenses this month, purchases today. This row is not in the mock; it keeps figures the previous dashboard already showed. |

On phones the page uses the mobile layout: navy header, 2×2 cards, and a bottom bar (Dashboard, Sales, Medicines, Inventory, More).

The page refreshes itself every minute, and again when you return to the tab.

## Files
- **New:**
  - `assets/js/brand-shell.js`
  - `assets/images/brand/` (logo, icon and favicon from the brand pack)
  - `tests/e2e/dashboard_flow.py`
- **Changed:**
  - `dashboard.html`, `assets/js/dashboard.js`, `assets/css/dashboard.css`
  - `assets/js/navigation.js`: the branded layout is opt-in. Other pages are unchanged.
  - `assets/js/medicines.js`, `sales.js`, `customers.js`: accept `?q=` from search. `medicines.js` also accepts `?new=1`.

No database change is needed.

## Tests
`tests/e2e/dashboard_flow.py`: 25 checks. Each dashboard figure is compared with the database, and each control is exercised on desktop and on mobile. The full suite also passes: 80 workflow checks plus the click-through of every page for every role.
