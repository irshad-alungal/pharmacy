# Version 48 billing improvements

## Changes
- Invoice numbers are assigned by a database trigger in `YYYY-MM-DD-###` format using the Asia/Kolkata calendar date.
- Daily numbering is concurrency-safe and globally unique across branches in the same Supabase project.
- Billing medicine search displays available, unexpired, non-quarantined stock for the current branch.
- Medicines with `need_doctor_sheet = true` are highlighted with a light red background and a Prescription required label.
- Existing FEFO allocation, customer, payment, held-bill, discount, GST and invoice workflows were not intentionally rewritten.

## Required Supabase migration
Apply `database/migrations/0019_daily_bill_number_and_billing_search.sql` after the existing migrations.

The database trigger applies numbering to every newly inserted sales invoice, including invoices created by the existing `finalize_sale` RPC. Existing invoice numbers are not rewritten.

The daily sequence starts at 001 for the first invoice on a date and increments atomically. It is shared across branches to preserve the globally unique `sales_invoices.invoice_no` constraint.

## Notes
- The stock shown in search is current available stock for the branch, excluding expired, quarantined and zero-stock batches, consistent with the FEFO allocator.
- The red prescription warning is based on `medicines.need_doctor_sheet`.
- Search stock is informational; final stock validation and deduction remain in the existing server-side `finalize_sale` function.
