# ALZA PHARMACY — Sales & Invoice module

This update replaces the Sales page placeholder with a branch-filtered invoice list.

Features:
- Loads up to 500 invoices for the signed-in user's active branch.
- Search by invoice number, customer name or phone.
- Filter by date range and invoice status.
- Loads customer names separately to avoid depending on an optional Supabase join relationship.
- Opens the existing `invoice_detail(uuid)` RPC and uses the Phase 5 invoice renderer.
- Preview, print 80mm thermal, print A4, and download PDF through the existing invoice renderer.

This update does not create or modify sales, payments, stock, returns, or the `finalize_sale` function.
It requires the already-installed `invoice_detail(uuid)` function and the existing invoice renderer.
