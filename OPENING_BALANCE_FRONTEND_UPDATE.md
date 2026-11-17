# PALLIKKAL PHARMACY — Opening Balance Management

## Frontend integration

The Finance page includes an **Opening balances** tab for `super_admin` and `admin` users.

It supports:
- Customer opening dues (debit) and customer advances (credit).
- Supplier opening payables (credit) and supplier advances (debit).
- Branch-scoped party selection.
- Opening date and optional note/reference.
- Opening-balance history.
- Reversal with a required reason. A reversed entry can be replaced by a new entry.

Customer receipts and supplier payments no longer impose a frontend maximum equal to the current balance. The excess is treated by the database as a customer or supplier advance.

## Database migration

`database/migrations/0010_opening_balance_management.sql` records the database changes already applied in Supabase during this integration.

Do not run it a second time in production without reviewing the migration state and taking a backup. It is provided so the repository retains the SQL source of the deployed changes.

## Important accounting scope

- Daily cash opening balance remains a separate workflow.
- The existing sales-return posting behaviour is unchanged.
- Customer sales returns are not automatically applied to receivables by this change.
- Opening-balance records are append/reverse oriented; do not edit or delete posted ledger rows.
