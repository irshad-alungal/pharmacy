# Pallikkal Medicals brand update — reviewed frontend copy

- Customer-facing homepage English and Malayalam text uses Pallikkal Medicals.
- Admin, staff, billing and application navigation titles use PALLIKKAL MEDICALS.
- Invoice, thermal/A4 print and credit-note templates use PALLIKKAL MEDICALS as the fallback when the shop profile name is empty.
- Downloadable initial-stock, medicine bulk-upload and purchase templates use PALLIKKAL_MEDICALS filenames.
- The current live branch and pharmacy records were separately verified as PALLIKKAL MEDICALS; branch ID, pharmacy ID and invoice prefix were preserved.
- Internal storage keys, CSS identifiers, RLS policy names, comments and historical migration text containing ALZA were intentionally not renamed because they are not customer-facing labels and may be compatibility-sensitive.
- Historical SQL migration files were not rewritten. The live branch invoice prefix was verified as `INV`; legacy fallback strings in historical SQL remain a source-maintenance item and should not be replayed blindly.
- Demo contact details on the public homepage still require replacement with the pharmacy's verified phone, email, website and address before publication.
