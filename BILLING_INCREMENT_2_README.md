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


## Correction notice — Increment 3 package

This package corrects the partial-payment migration from Increment 2. The earlier migration accidentally retained the exact-payment validation and must not be used. Use the SQL migration in this package instead. It accepts cash/UPI/card tender, generates the unpaid remainder as a server-side `credit` payment, checks the customer's remaining credit limit while the customer row is locked, and rejects overpayment or unpaid walk-in bills.

Apply only after a current Supabase backup and review. Do not apply the old Increment 2 migration. The frontend must be deployed only after the corrected SQL is installed and verified.
