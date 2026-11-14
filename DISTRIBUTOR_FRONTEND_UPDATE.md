# ALZA Pharmacy — Distributor frontend update

## Included
- Distributor list now has a **View** action next to each entry.
- Distributor details view shows address, contact person, all stored contact numbers, email, GSTIN, drug licence and logo.
- Each contact number has a `tel:` Call link and a WhatsApp link. Enter WhatsApp numbers with country code (for example, `+91...`).
- Distributor details show purchase invoice history from `purchase_invoices`, with invoice date, number, status, item count and total. Each purchase can be opened to inspect its item rows.
- Add/Edit distributor supports a PNG, JPG or WEBP logo up to 2 MB.
- Contact number input accepts multiple numbers separated by commas, semicolons or new lines.
- Existing add/edit and activate/deactivate behaviour is retained.
- Layout is responsive; distributor detail and edit dialogs fit within the viewport.

## Required database/storage migration
Run `database/migrations/0012_distributor_logos.sql` only after reviewing it against the actual live Supabase schema and taking a backup. It adds `distributors.logo_path`, creates the public `distributor-logos` bucket, and adds branch-folder-scoped upload/update/delete policies. Public read is enabled because logos are public branding assets.

The migration assumes the current ALZA profile schema has `profiles.branch_id` and `profiles.is_active`, consistent with the supplied current `database/schema.sql`. Do not run it against a different schema without adapting and reviewing it first.

## Storage path convention
`<branch_uuid>/<distributor_uuid>/<random_filename>.<ext>`

## Checks performed
- JavaScript syntax checks with Node.js.
- HTML local asset references checked.
- ZIP archive integrity checked.

## Not yet verified
- Live Supabase migration execution.
- Live Storage bucket/policy behaviour.
- Browser interaction against the production database.
- Purchase history relationship queries against the live schema.
