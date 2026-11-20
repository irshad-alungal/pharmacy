# Inventory sections (version 60)

`inventory.html` now has a section bar under the KPI cards. It holds the six sections from the old page, redesigned in the same theme:

| Section | What it shows | Who sees it |
|---|---|---|
| **Batch Stock** | The stock list with the Stock Value, Stock Movement and Expiry Alerts cards (version 59 design). | everyone |
| **Alerts** (red count badge) | 4 summary tiles. Below them: Low stock (sellable vs. reorder level, short-by, Reorder link); Near expiry (days-left chips, value, Adjust); Expired still in stock (one-click Write off); Quarantined/blocked (Release/Reactivate). The near-expiry window can be changed. | everyone |
| **Physical Count** | Every batch with location and system qty. As you type: difference (+/−) and a "N counted · M differences" summary. Search, category filter, "not counted yet" / "with differences" filters, Clear, and Submit (note required). | admin, pharmacist, inventory staff |
| **Initial Stock** | Opening-stock entry and Excel upload, restyled. Unsaved rows are kept when you switch sections. | admin |
| **Valuation** | 8 value tiles: cost, sellable cost, MRP, potential sales, expected margin, expired, quarantined, selling price. Then value by category (bars + table), the top 10 medicines by value, and Export. | admin |
| **Movements** | Filters: type (including "all in / all out / all adjustments"), from–to dates, medicine. In/out unit totals, a type chip on each row, paging (25 per page), Export, and the branch transfer list with a New transfer link. | admin, pharmacist, inventory staff |

- Sections can be opened directly with `inventory.html?view=alerts` (also `count`, `opening`, `val`, `moves`).
- The Stock Movement tiles, the Stock Value ⓘ button, Expiry Alerts "View All" and Update Stock all open the matching section.
- No new SQL is needed beyond `0023_inventory_stock_transfer.sql` from version 59.

## Tested
`tests/e2e/inventory_flow.py`: 69 checks, comparing the page's figures with the database. These also pass:
- flows (40), flows2 (40), medicines (32), dashboard (47);
- monkey click-through on the inventory page for 4 roles.
