# Opening Balance Frontend Integration

- Integrated the existing `assets/js/daily-session.js` opening-balance dialog into `assets/js/billing.js`.
- The dialog is requested after the authenticated profile and billing role are validated, but before the billing form is mounted.
- The date is generated using `Asia/Kolkata` and displayed read-only.
- Only the date, opening amount and Submit action are shown.
- The entry is stored in browser localStorage per authenticated user and IST date (frontend preview only).
- Existing Billing Shop Open/Closed toggle (`alza_shop_open_status_v1`) is preserved.
- Existing public `index.html` shop status indicator is preserved and continues to listen for localStorage changes.

Important: this is frontend-only. Opening balance is not yet a permanent accounting record in Supabase and is not shared across devices. A branch/user/IST-date keyed table plus RLS-protected RPC is required before production reconciliation.
