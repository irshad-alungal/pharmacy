# Daily login and opening balance workflow

## Behaviour

- A fresh credential login is required once at the beginning of each IST calendar day, even if the previous day's browser session was left signed in.
- During that first successful login, the app checks the branch-wide daily cash opening in Supabase.
- If no opening exists for the branch/date, the login flow requires an amount (including `0`). Any active staff member or administrator can submit it.
- Only one opening can be recorded for a branch and date. Other staff/admin logins that day reuse the saved record and are not prompted again.
- Navigating between pages or refreshing during the same day does not ask for the opening again.
- A manual logout clears the local daily-login marker, so the next login requires credentials again. The already-saved branch opening is retained and is not submitted twice.
- If an app session is no longer active, the app returns the user to the appropriate login page instead of silently starting a work session.
- The Billing page no longer triggers the opening-balance prompt; it is part of login.

## Deployment

1. Run `database/migrations/0013_daily_login_opening_staff_access.sql` once in Supabase SQL Editor. This updates the daily opening RPC permissions so any authenticated staff profile assigned to a branch can submit the opening.
2. Upload the updated project files to GitHub Pages.
3. Test with one staff login and one admin login on the same IST date. The first login should ask for the opening; the second should not.
4. Test a manual logout followed by another login on the same date. Credentials should be required again, but the opening form should not reappear.

Migration `0012_daily_cash_opening_finance.sql` is already installed and must not be rerun.
