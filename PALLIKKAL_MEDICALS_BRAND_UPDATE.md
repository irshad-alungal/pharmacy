# Pallikkal Pharmacy brand update

- Customer-facing homepage, English/Malayalam website copy, admin/staff screens, application navigation and page titles now use Pallikkal Pharmacy.
- Invoice, thermal/A4 print, PDF and credit-note fallbacks now use PALLIKKAL PHARMACY. The invoice continues to prefer the active branch profile name from Supabase.
- Update the active branch profile name in Supabase as well; see `database/BRAND_RENAME_PALLIKKAL_PHARMACY.sql`.
- Internal storage keys, CSS identifiers, RLS policy names, database identifiers, historical migrations and invoice prefix are intentionally preserved.
- Existing invoice printouts use the current branch profile when reprinted; this does not rewrite any archived PDF already downloaded or printed.
