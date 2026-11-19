# Billing — FEFO batch allocation, editable discount / GST / MRP, AI assistant (v52)

## What changed
- **Automatic FEFO allocation.** Enter a medicine and quantity, and the database (`billing_allocate`) picks eligible batches by earliest expiry. It skips expired, quarantined, blocked, recalled, damaged and zero-stock batches, as well as stock reserved by other open bills. Each batch gets its own row showing batch number, expiry, its own MRP, GST rate and tax treatment.
- **Shortage handling.** If there isn't enough eligible stock, the row shows the requested quantity, what is available and the shortage. The bill cannot be finalized until you fix it, and nothing is billed silently.
- **Editable values with instant recalculation.** You can edit quantity, discount % (per medicine or per batch), GST % (configured slabs only) and MRP (only up to the printed MRP). Every amount, plus the medicine total, bill summary and grand total, updates as you type, with no Calculate button. Changing discount or GST never changes the selected batches. Changing quantity re-runs FEFO.
- **Tax-inclusive and tax-exclusive pricing.** `medicines.price_includes_tax` defaults to `true`, matching Indian MRP and the old behaviour. In inclusive mode GST is extracted from the price, never added a second time. In exclusive mode GST is added on top. Each batch can override MRP, GST and treatment (`medicine_batches.mrp / tax_rate / price_includes_tax`). Leave these NULL to inherit from the medicine.
- **Default discount.** This is `medicines.discount_percentage` if set. Otherwise it is the discount implied by `selling_price < mrp`, so existing shop prices are kept.
- **Stock reservations.** Allocated stock is reserved per open bill for 15 minutes (configurable), and the reservation is refreshed while the page is open. It is released when a medicine is removed, the bill is cleared or held, the tab closes, or the bill is finalized. Two counters cannot sell the same units.
- **`finalize_sale_v2`** is atomic and re-validates everything. It locks the batches, checks expiry, status and availability, re-runs FEFO and rejects a bill that is not FEFO unless it was a permitted manual override. It also rejects duplicate batch rows and checks every permission and limit. It recomputes every line with `billing_calc_line`, rejects the bill if the server total differs from the screen total, deducts stock and releases reservations in the same transaction. Stock is never reduced before this commit.
- **Permissions** are `sales.discount` (existing), `sales.gst_edit`, `sales.mrp_edit` and `sales.batch_override`. `super_admin` and `admin` always have them. Assign them to other roles through `role_permissions`.
- **Audit log.** Entries are written for manual batch overrides (with reason), live discount, GST and MRP edits, cleared bills, applied AI suggestions, batch status changes, and a per-invoice record of every changed line (before and after values).
- **AI assistant** (`supabase/functions/billing-assistant`). It understands instructions like "add 25 dolo 650", explains allocations and flags anomalies. Its tools only call the validated database functions (`billing_fefo_preview`, `billing_calc_line`, medicine search). It cannot change the bill. It returns suggestions that the cashier applies with a click, through the same validated path as a manual edit. **Check bill** runs deterministic anomaly checks with no AI involved.

## Files
| File | Status |
|---|---|
| `database/migrations/0020_billing_fefo_gst_engine.sql` | new |
| `assets/js/billing-engine.js` | new: pure calculation / FEFO / validation (mirrors SQL) |
| `assets/js/billing-assistant.js` | new: AI panel |
| `assets/js/billing.js` | replaced |
| `assets/css/billing.css` | appended styles |
| `supabase/functions/billing-assistant/index.ts` | new |
| `supabase/config.toml`, `.env.example` | assistant function + secret |
| `tests/billing-engine.test.mjs`, `tests/sql-billing-fefo.test.mjs`, `tests/README.md` | new tests |

## Deploy (in this order, together)
1. Back up the database. Run `database/migrations/0020_billing_fefo_gst_engine.sql` in the Supabase SQL editor. It can safely be run more than once.
2. Upload the frontend files above. Browsers can no longer execute the old `finalize_sale()`, so deploy the new `billing.js` at the same time. Rollback: `GRANT EXECUTE ON FUNCTION public.finalize_sale(uuid, jsonb, jsonb, numeric) TO authenticated;`
3. Optional AI: `supabase secrets set ANTHROPIC_API_KEY=...`, then `supabase functions deploy billing-assistant`. Without it, billing works normally and the panel shows "Assistant unavailable".
4. Optional settings per branch:
   `insert into billing_settings(branch_id, max_discount_pct, reservation_minutes, near_expiry_days) values ('<branch>', 20, 15, 90) on conflict (branch_id) do update set max_discount_pct = excluded.max_discount_pct;`
5. Recall or block a batch: `select set_batch_stock_status('<batch_id>', 'recalled', 'reason');`

## Known follow-ups
- `invoice_detail()` is not in the repository, so it was not changed. If its `tax_summary` derives tax from `line_total` assuming inclusive pricing, update it to use the new `sales_items.taxable_amount` and `gst_amount` columns before you bill tax-exclusive medicines.
- The purchase and opening-stock flows do not fill the new batch-level `mrp`, `tax_rate` and `price_includes_tax` yet, so batches inherit these from the medicine master until they do.

## Tests
`node tests/billing-engine.test.mjs`: 25 passed. `node tests/sql-billing-fefo.test.mjs`: 43 passed. The SQL tests run against a stub of the live tables in PGlite, not the live Supabase project, so do a live check on a test branch before going live.
