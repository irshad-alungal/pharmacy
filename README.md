# ALZA PHARMACY (core foundation)
## Setup
1. Supabase > SQL Editor: run `database/schema.sql`, then `database/bootstrap-admin.sql` (links your existing Auth user to super_admin).
2. Put your project URL and publishable key in `assets/js/supabase-client.js`.
3. Serve statically (GitHub Pages) and sign in at `index.html` with the existing account.
4. Add medicines and batches (Table Editor, as the admin) to try billing.
## Included
Schema (core tables), RLS, role helper, confidential purchase_price column, transactional `finalize_sale` (expiry/quarantine/stock checks, server-side pricing, audit log), login, billing counter.
## NOT yet built / NOT tested
Staff-ID login Edge Function, work sessions, purchases, distributors, returns, inventory UI, documents/storage, finance ledger, dashboard, reports/exports, WhatsApp, invoice printing/PDF, tests. Nothing has been run against a live Supabase project.

## File structure
Run order: `database/schema.sql` → `database/bootstrap-admin.sql` (same content lives in `database/migrations/`).
Every `*.html` page loads `assets/js/<page>.js`, which calls `mountShell()` (auth + role check + navigation).
**Working:** login (index/admin-login), billing, navigation/role shell. **Stubs:** all other pages, staff-login page,
the 4 Edge Functions (return 501), seed.sql, tests.

## Phase 1 (master data)
Run `database/migrations/0004_master_data.sql` after schema.sql and bootstrap-admin.sql. Then: Settings → add categories, manufacturers, storage locations, units; Medicines → add items; Customers → add customers.
Verified here: JavaScript syntax only. NOT verified: the SQL (no Postgres available here) and the screens in a browser.

## Phase 2 (purchasing)
Run `database/migrations/0005_purchasing.sql` after 0004. Distributors → add; Purchases → New purchase (confirming adds stock at once). Admins see totals; Medicines → "Cost history" shows purchase prices (admin only).
SQL verified by `tests/sql-phase2.test.mjs` (20 checks pass on a local Postgres). Screens NOT verified in a browser.

## Phase 3 (inventory)
Run `database/migrations/0006_inventory.sql` after 0005. Inventory page: Batch stock, Alerts, Physical count, Valuation (admin), Movements. Medicines form now has a Reorder level (drives low-stock alerts).
Also fixed: medicines.js used `select *`, which the purchase-price column lock would reject; it now lists columns explicitly.
SQL verified by tests/sql-phase3.test.mjs (22 checks). Screens NOT verified in a browser.
