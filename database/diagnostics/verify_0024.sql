-- Read-only checks after running 0024_purchases_management.sql. Every row should say true.
SELECT 'purchase_orders table' AS check_name, to_regclass('public.purchase_orders') IS NOT NULL AS ok
UNION ALL SELECT 'purchase_order_items table', to_regclass('public.purchase_order_items') IS NOT NULL
UNION ALL SELECT 'purchase_invoices.purchase_order_id column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'purchase_invoices' AND column_name = 'purchase_order_id')
UNION ALL SELECT 'new functions', count(*) = 5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('purchase_list_v2','purchase_order_save','purchase_order_list','purchase_order_cancel','confirm_purchase_v3')
UNION ALL SELECT 'existing purchase functions kept', count(*) = 4 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('confirm_purchase_v2','purchase_detail','purchase_draft_save','purchase_list');
