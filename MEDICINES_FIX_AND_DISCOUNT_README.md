# Medicines page fix — Version 46

## What changed
- Fixed the medicines table's explicit column privileges for the current medicine master form, while keeping `purchase_price` inaccessible to direct client writes.
- Kept medicine write access branch-scoped and explicitly includes the `inventory_staff` role already used by the frontend.
- Added optional `discount_percentage` (0–100, nullable) to medicine records.
- Added the optional Discount (%) field to add/edit medicine.
- Added discount display to the medicine list and medicine profile.
- Added Discount (%) to the Excel template and bulk-import parser; blank values remain NULL.
- Existing medicine photos, deactivation requests, cost history, search, filtering, and other page functions remain in place.

## Required Supabase migration
Apply `database/migrations/0018_medicine_write_permissions_and_discount.sql` in the Supabase SQL Editor after the earlier migrations, including `20261113_medicine_master_fields.sql`.

The migration is idempotent for the new column and constraint. It deliberately does not grant direct access to `purchase_price`.

## Validation
The frontend code was syntax-checked. Database migration execution and live Supabase add/edit/bulk-import tests must still be performed in the target Supabase project.
