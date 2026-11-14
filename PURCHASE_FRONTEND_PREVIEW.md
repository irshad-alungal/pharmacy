# ALZA Pharmacy — Purchase frontend preview

This update replaces the old purchase screen with a responsive purchase-management interface.

## Included in this frontend increment
- Purchase list with search, status and date filters, using the existing `purchase_list` RPC.
- Purchase summary cards.
- New purchase form with supplier/invoice details, item rows, invoice totals, payment fields and attachment selection.
- Per-item tax-inclusive or tax-exclusive purchase rate calculation.
- Purchase Excel template download and Excel/CSV row import preview (SheetJS CDN required).
- PDF/JPG/PNG attachment selection, camera capture input and local file preview/removal.
- Review-before-post confirmation step. Existing `confirm_purchase` RPC is used only after the user explicitly confirms.
- Existing medicines can be selected from the medicine master.

## Important backend dependencies / limitations
This is a frontend increment, not a complete production purchase workflow. The current database migration `0005_purchasing.sql` creates purchases directly as `confirmed` and posts stock inside `confirm_purchase`. It does not support draft records, attachment storage, payment ledger entries, invoice detail retrieval, pack/free quantity capture, or assisted OCR.

Accordingly:
- **Save draft** is intentionally informational and does not save data.
- Attachments and camera captures are local previews only; files are not uploaded to Supabase Storage.
- OCR / assisted bill extraction is not yet connected.
- New medicine creation is not enabled; unknown medicines must be created separately until the reviewed backend RPC is implemented.
- The current posting RPC cannot preserve free quantity or a numeric pack factor. To avoid incorrect stock, posting validation currently requires pack factor `1` and free quantity `0`.
- Duplicate invoice numbers are rejected by the existing database unique constraint; the approved warn-and-review workflow needs a backend duplicate-check endpoint before production.
- Payment fields are a UI preview only and are not persisted.
- Purchase View currently shows the fields returned by `purchase_list`; item details and attachments require a new detail RPC.

## Recommended next increment
Review and apply a separate, schema-checked database migration for purchase drafts, expanded item pricing/tax fields, attachments, payment records, duplicate warnings, purchase detail retrieval and a controlled confirm/reversal workflow. Do not run a migration against the live database until the live schema and existing functions have been compared and backed up.

## Checks performed
- `node --check` on the updated `assets/js/purchases.js`.
- Static HTML asset reference check.
- ZIP archive integrity check.

No live Supabase operations, browser end-to-end tests, OCR extraction or real document upload have been performed.
