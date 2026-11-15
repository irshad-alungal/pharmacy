# Daily login and opening balance frontend update

## Included
- Daily login validity is keyed to the authenticated user and the current Indian Standard Time (Asia/Kolkata) calendar date.
- A persisted Supabase session from a previous IST date is signed out and redirected to the appropriate staff/admin login page when the user returns to the public home page or opens a protected page.
- Successful staff/admin login marks the user's daily login for the current IST date. Navigation between protected pages during that date does not require another login.
- The existing sign-out action clears the daily-login marker.
- Before the billing form is rendered, a blocking Opening Balance dialog asks for only the IST date (read-only) and amount, with a Submit button.
- The opening balance prompt is shown once per user per IST date in that browser; it is shown again on the next IST date.

## Important limitation
This is a frontend-only implementation. The daily-login marker and opening balance are stored in browser localStorage. They are not authoritative across devices and do not yet create an accounting record in Supabase. For real daily cash reconciliation, add a branch/user/date keyed opening-cash table and an RLS-protected RPC, then replace the localStorage save/read in `assets/js/daily-session.js` with that RPC. A user can clear browser storage or use another device; server-side enforcement is required for production accounting controls.

## Files changed
- `assets/js/daily-session.js` (new)
- `assets/js/supabase-client.js`
- `assets/js/auth.js`
- `assets/js/billing.js`
- `staff-login.html`
- `admin-login.html`
- `index.html`
