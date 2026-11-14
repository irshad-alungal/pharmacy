# Customer Doctor's Sheet Attachments

This update adds a per-sales-invoice doctor's sheet area inside Customers → View.

## Frontend behaviour
- Each customer sales bill shows **Upload file** and **Camera** actions.
- Upload accepts PDF, JPG, PNG and WEBP files up to 15 MB.
- Camera uses the device rear-camera capture hint and accepts image files.
- Multiple documents can be attached to the same sales invoice.
- Saved documents appear under the relevant bill and open through a short-lived signed URL.
- Documents are associated with the customer, invoice and branch; they are not shared publicly.

## Required database migration
Apply `database/migrations/0013_customer_doctor_sheets.sql` only after reviewing it against the live Supabase schema and taking a database backup. It creates the `customer_doctor_sheets` metadata table, branch-scoped RLS policies and a private `customer-doctor-sheets` Storage bucket.

The migration assumes the current project schema contains `branches`, `profiles`, `customers`, `sales_invoices`, `my_branch_id()` and authenticated Supabase Storage support. Confirm these objects and current RLS policies in the live database before applying it.

## Testing limitations
JavaScript syntax and ZIP integrity can be checked locally. This update has not been tested against the live Supabase project, device camera permissions, actual mobile camera hardware, or real uploads. Do not deploy the frontend feature to production before applying and validating the migration in a test environment.
