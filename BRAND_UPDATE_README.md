# Pallikkal Pharmacy brand update

- Visible frontend branding changed from PALLIKKAL MEDICALS to PALLIKKAL PHARMACY.
- Shared navigation, login screens, page titles and public homepage updated.
- Invoice rendering and credit-note fallback branding updated.
- Billing finalization now loads the current branch profile before showing the invoice, so thermal/A4 print and PDF use the branch name.
- Sales reprints and customer invoice previews continue to load the branch profile by the invoice's branch_id.
- Backend SQL is in `database/BRAND_RENAME_PALLIKKAL_PHARMACY.sql`.

Run the SQL only if the live branch name has not already been changed. The SQL is safe to re-run.
