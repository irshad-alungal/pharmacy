-- READ-ONLY check after running 0021_complete_backend_and_live_fixes.sql.
-- Every row should show ok = true.
SELECT 'report functions installed (13)' AS check_name,
       count(*) = 13 AS ok, count(*)::text AS detail
FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'report\_%'
UNION ALL
SELECT 'purchase / billing functions installed',
       count(*) = 6, string_agg(proname, ', ')
FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('confirm_purchase_v2','purchase_detail','purchase_draft_save','finalize_sale_v3','opening_stock_edit_submitted_batch','ist_today')
UNION ALL
SELECT 'no function still checks the retired inventory role alone',
       count(*) = 0, COALESCE(string_agg(p.proname, ', '), 'none')
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  AND pg_get_functiondef(p.oid) ~ '''(super_admin|admin|pharmacist|billing|billing_staff)''\s*,\s*''inventory'''
  AND pg_get_functiondef(p.oid) !~ '''inventory''\s*,\s*''inventory_staff'''
UNION ALL
SELECT 'every batch with stock has matching cost layers',
       count(*) = 0, count(*)::text || ' batch(es) short'
FROM public.medicine_batches b
WHERE b.qty > COALESCE((SELECT sum(remaining_qty) FROM public.inventory_cost_layers l WHERE l.batch_id = b.id), 0)
UNION ALL
SELECT 'new tables / columns present',
       to_regclass('public.purchase_drafts') IS NOT NULL
       AND to_regclass('public.customer_doctor_sheets') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'distributors' AND column_name = 'logo_path')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_invoices' AND column_name = 'patient_name'),
       'purchase_drafts, customer_doctor_sheets, distributors.logo_path, sales_invoices.patient_name'
UNION ALL
SELECT 'billing staff may hold bills',
       with_check ~ 'billing_staff', 'held_bills_insert policy'
FROM pg_policies WHERE tablename = 'held_bills' AND policyname = 'held_bills_insert'
UNION ALL
SELECT 'storage buckets', count(*) = 5, string_agg(id, ', ')
FROM storage.buckets WHERE id IN ('medicine-images','purchase-documents','expense-receipts','distributor-logos','customer-doctor-sheets');
