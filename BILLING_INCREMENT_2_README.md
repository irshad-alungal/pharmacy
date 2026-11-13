# ALZA Billing Increment 2 — partial payment foundation

## Included
- Billing UI permits split Cash/UPI/Card payments below the invoice total when a customer is selected.
- The remaining amount is shown as customer due and checked against the customer's currently available credit limit.
- The browser no longer offers a manually-entered Credit payment row; the database calculates and records the unpaid remainder as `payments.method = 'credit'`.
- The sale RPC locks the customer row while checking the credit limit, rejects overpayments, rejects partial payment without a customer, and enforces `sales.discount` permission for bill discounts.
- Requires an authenticated active staff work session.
- Existing `finance_post_sale_journal()` and customer receipt flow are reused. The invoice journal trigger sees cash/card/UPI plus the generated credit remainder, so the journal can balance on the full invoice amount.

## Important scope
This is a focused accounting increment, not the full Billing redesign. It does not yet implement automatic FEFO batch splitting, line-level discount, patient/doctor invoice fields, delivery-boy role/status, or the final print layout changes. Those require separate schema and UI work.

## Apply safely
1. Export a Supabase database backup first.
2. Review `database/migrations/20261113_billing_partial_payments.sql` against the live project.
3. Apply the migration in Supabase SQL Editor.
4. Deploy the updated static files from this project.
5. Test in a non-production/test branch first: full payment, split payment, partial payment with customer, partial payment without customer, credit-limit exceeded, and customer receipt collection.

No migration has been run against production by this package.
