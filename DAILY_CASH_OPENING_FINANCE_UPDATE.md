# Daily cash opening is now posted to Finance

## Behaviour
- Billing checks Supabase for the current IST date's branch-wide opening cash record before showing the popup.
- On Submit, the app calls `record_daily_cash_opening` in Supabase. The popup closes only after the server confirms the save.
- A positive amount posts a balanced Finance journal: debit `cash`, credit `opening_balance_equity`, tagged `daily_cash_opening`.
- Finance Overview includes the cash debit in the selected date range; Finance Ledger shows the two journal lines.
- The opening is unique per branch and IST date. Other staff/devices in the same branch reuse the saved opening rather than creating duplicates.
- Zero is permitted and saved as a daily record; no zero-value ledger journal is created.

## Supabase migration required
Run `database/migrations/0012_daily_cash_opening_finance.sql` once in the Supabase SQL Editor, after the already-applied `0010_opening_balance_management.sql` migration. Do not rerun migration 0010.

## Accounting treatment
The opening cash amount is an opening position, not sales revenue. It is posted as Dr Cash / Cr Opening Balance Equity so it appears in Finance without inflating sales. Corrections should be handled by an administrator through an audited reversal/correction workflow, not by editing ledger rows.
