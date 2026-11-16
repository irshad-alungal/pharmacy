-- Pallikkal Pharmacy brand update. Uses the confirmed live branches schema.
-- This updates only the display name; it preserves branch IDs, invoice prefix,
-- invoice footer, contact details, invoices and all accounting/inventory data.
BEGIN;
UPDATE public.branches
SET name = 'PALLIKKAL PHARMACY'
WHERE id = '00000000-0000-0000-0000-0000000000b1'::uuid;
COMMIT;

-- Read-only verification:
SELECT id, name, invoice_prefix, invoice_footer
FROM public.branches
WHERE id = '00000000-0000-0000-0000-0000000000b1'::uuid;
