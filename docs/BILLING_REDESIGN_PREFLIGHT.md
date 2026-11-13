# ALZA Pharmacy Billing redesign — preflight findings

Baseline: `pharmacy-main (29).zip`.

## Static source findings

- `billing.html` is a thin shell; the UI is rendered by `assets/js/billing.js`.
- The current frontend calls `finalize_sale(p_customer, p_items, p_payments, p_discount)` and then `invoice_detail(p_invoice)`.
- The current sale RPC in the repository's `database/schema.sql` uses a single invoice-level discount, calculates tax from the medicine's saved `tax_rate`, and requires payment rows to equal the invoice total exactly.
- `sales_items` currently stores batch, quantity, unit price, tax rate and line total; the source schema does not include a per-line discount field or patient/doctor/diagnosis fields.
- The invoice renderer has separate thermal and A4 paths. Rack/shelf is not currently part of the invoice payload or printed output, which is consistent with the requested exclusion.
- The first FEFO increment is not yet the complete requested design. It needs follow-up for grouped quantity editing, re-adding/scanning a medicine without resetting its quantity, line-level discount, overall discount, round-off, partial payment/customer due, patient fields and persistent delivery presence.

## Critical source/live distinction

The repository SQL is not guaranteed to match the live Supabase database. The project has branch-aware features and later migrations beyond the original core schema. Therefore, do not apply `database/schema.sql` to the live project as a replacement. Use the read-only SQL in `database/diagnostics/billing_delivery_preflight.sql` against the live project first, then design a forward-only migration from the actual definitions and policies returned.

## Recommended design decisions

- Keep stock deduction atomic in a SECURITY DEFINER RPC; never trust browser-calculated batch availability or totals.
- Allocate eligible batches FEFO in the UI for clarity, but revalidate and lock every batch in the RPC at finalization.
- Store each allocated batch as its own `sales_items` row, including same-medicine split rows.
- Keep medicine GST sourced from `medicines.tax_rate`; do not accept a client-supplied GST override.
- Keep rack/shelf in the on-screen medicine display only; do not add it to invoice JSON or print/PDF templates.
- Persist delivery status independently of the delivery user's login session; status changes only from the three explicit buttons. A protected RPC should enforce delivery-role identity and branch scope.
- Billing availability priority: any Online => green Delivery Available; otherwise any Purchasing => blue Purchasing; otherwise red Delivery Unavailable.
- Delivery contact is shown in the fixed billing-page status panel; staff contacts the delivery person manually; no assignment workflow.
- Partial payment should be represented as received tender plus a separately derived outstanding balance, not by inserting a fake `credit` tender for an unpaid amount. The live ledger/customer-dues model must be inspected before changing accounting semantics.

## Current status

This is a static source review and a prepared read-only live-schema inspection script. No live Supabase query has been executed, no migration has been applied, and no GitHub deployment has occurred.
