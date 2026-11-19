# Billing batch selection and stock limit update

- Search results now open an explicit batch picker rather than automatically splitting quantities across FEFO batches.
- The batch picker shows batch number, expiry, available quantity, and selling rate.
- Each cart row represents one selected batch and shows its available quantity as the quantity input maximum.
- Quantity edits are clamped/validated against the selected batch's available stock.
- Held bills resume with their original batch selections; unavailable, expired, quarantined, or insufficient-stock lines are skipped with a notice.
- Finalize continues to send explicit `{ batch_id, qty }` items to the existing `finalize_sale` RPC. The existing database RPC locks the batch and checks `b.qty < v_qty` before deducting stock, so concurrent sales are checked server-side too.
- No database migration is required for this frontend change.
