# Shared shop open/closed status

- Billing now saves the current branch's status through the `set_shop_open_status(boolean)` Supabase RPC.
- Billing reads its branch's status through `my_shop_open_status()`.
- The public home page reads only the aggregate boolean through `public_shop_is_open()`; it does not receive branch records or staff details.
- The public page refreshes every 15 seconds and when the tab regains focus/visibility, so status changes appear across phones and devices without relying on browser localStorage.
- Existing billing, navigation, language selection, and other application functions are left in place.

## Database deployment

Apply the migrations in order if they have not already been applied:

1. `database/migrations/0016_shared_shop_open_status.sql`
2. `database/migrations/0017_my_shop_open_status.sql`

The first migration creates the branch status table and the secure write/public-read RPCs. The second adds the authenticated branch-specific read RPC used by Billing.

The public home page will show **Shop Open** if any branch is open, matching the aggregate behavior documented in migration 0016; otherwise it shows **Shop Closed**.
