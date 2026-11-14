# Reports frontend update

## Files updated
- `reports.html`
- `assets/js/reports.js`
- `assets/css/reports.css` (new)

## Existing project dependencies retained
The page continues to use the Phase 0–15 reference project's:
- `assets/js/report-defs.js` (13 report definitions)
- `assets/js/export.js` (PDF and Excel exports)
- `assets/js/supabase-client.js`
- `assets/js/navigation.js`
- `assets/js/permissions.js`
- shared CSS and UI utilities

## Included report catalogue
1. Sales, purchases & expenses by period
2. Sales report (invoice-wise)
3. Purchase report
4. Medicine-wise sales & estimated profit
5. Customer-wise report
6. Distributor-wise report
7. Stock report (batch-wise)
8. Expiry report
9. Returns & refunds
10. Expense report
11. Tax summary
12. Profit & loss (estimated)
13. Financial ledger

## Frontend behaviour
- Report categories and selector
- Today, this week, this month, last month, last 30 days, this year, all dates and custom date range
- Daily / weekly / monthly grouping for period summary
- Expiry-window input for expiry report
- Results preview with totals where defined
- PDF and Excel downloads
- Responsive table container and mobile filter layout

## Important compatibility note
The attached Phase 0–15 README explicitly distinguishes the reference project (Phases 0–15A) from the user's separate live, branch-aware GitHub application (Phases 15B–15C). This frontend uses the reference project's 13 `report_*` RPC names and `pharmacy_settings` lookup. Do not copy it into the live branch-aware app or deploy it against live Supabase until the corresponding report RPCs, branch scoping, authorization and schema compatibility have been checked. Reports expose costs/profit and are admin-only in the reference project.

No database migration or live database change is included in this frontend update.
