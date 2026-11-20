-- Read-only checks after running 0023_inventory_stock_transfer.sql. Every row should say true.
SELECT 'stock_transfers table' AS check_name, to_regclass('public.stock_transfers') IS NOT NULL AS ok
UNION ALL
SELECT 'stock_transfers has RLS', relrowsecurity FROM pg_class WHERE oid = 'public.stock_transfers'::regclass
UNION ALL
SELECT 'transfer functions', count(*) = 2
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('stock_transfer', 'stock_transfer_branches')
UNION ALL
SELECT 'stock_transfer is SECURITY DEFINER', bool_and(prosecdef)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('stock_transfer', 'stock_transfer_branches');
-- Branches you can transfer to (needs at least one other active branch of the same pharmacy):
-- SELECT * FROM stock_transfer_branches();
