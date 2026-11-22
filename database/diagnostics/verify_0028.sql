-- Read-only checks after running 0028_finance_management.sql. Every row should say true.
SELECT 'finance functions installed' AS check_name, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('_finance_guard','finance_overview','finance_monthly','finance_transactions','cash_book','finance_balances','record_account_opening','reverse_account_opening','correct_daily_cash_opening')) = 9 AS ok
UNION ALL SELECT 'bank opening table', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'account_opening_balances')
UNION ALL SELECT 'anon cannot read the cash book', NOT has_function_privilege('anon', 'public.cash_book(date,date)', 'EXECUTE')
UNION ALL SELECT 'morning opening table still in place', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'daily_cash_openings');
