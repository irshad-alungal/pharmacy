-- Pallikkal Pharmacy brand rename
-- Run once in the Supabase SQL Editor. This changes only display-name fields.
-- It preserves branch IDs, pharmacy IDs, invoice prefix, invoices, stock and financial records.

BEGIN;

DO $$
DECLARE
  v_branch_count integer;
  v_settings_count integer;
BEGIN
  UPDATE public.branches
     SET name = 'PALLIKKAL PHARMACY'
   WHERE id = '00000000-0000-0000-0000-0000000000b1'::uuid;
  GET DIAGNOSTICS v_branch_count = ROW_COUNT;

  IF v_branch_count <> 1 THEN
    RAISE EXCEPTION 'Expected to update exactly one active branch (ID 00000000-0000-0000-0000-0000000000b1); updated % rows. No changes committed.', v_branch_count;
  END IF;

  UPDATE public.pharmacy_settings
     SET name = 'PALLIKKAL PHARMACY'
   WHERE id = 1;
  GET DIAGNOSTICS v_settings_count = ROW_COUNT;

  IF v_settings_count <> 1 THEN
    RAISE EXCEPTION 'Expected pharmacy_settings row id=1; updated % rows. No changes committed.', v_settings_count;
  END IF;
END $$;

COMMIT;

-- Verify the two display-name records.
SELECT id, name FROM public.branches
WHERE id = '00000000-0000-0000-0000-0000000000b1'::uuid;

SELECT id, name FROM public.pharmacy_settings WHERE id = 1;
