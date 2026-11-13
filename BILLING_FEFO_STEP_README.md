# ALZA Billing — FEFO medicine allocation step

This increment replaces the manual batch picker with automatic FEFO allocation in the Billing page.

## Behaviour
- Medicine search remains by medicine name or barcode.
- Adding a medicine allocates quantity 1 from eligible batches ordered by expiry ascending, then batch number.
- Eligible batches must belong to the active branch, be non-quarantined, have positive stock, and have expiry strictly after the India-local current date.
- Increasing the medicine quantity re-fetches eligible batches and redistributes the requested quantity across batches in FEFO order.
- Each allocated batch remains a separate cart row and is sent as a separate `batch_id`/`qty` item to `finalize_sale()`.
- If requested quantity exceeds available eligible stock, the page shows the allocated stock and a shortage warning, and blocks finalization until quantity is reduced.
- Removing the medicine removes all of its allocated batch rows.
- Resuming a held bill groups its saved quantities by medicine and reallocates them using current FEFO stock.

## Safety
- No database migration is included or required for this frontend allocation step.
- The existing `finalize_sale()` remains authoritative: it locks each batch and rechecks branch, expiry, quarantine and stock before deducting inventory.
- If stock changes between browser allocation and finalization, the database may reject the sale; refresh/re-add the medicine to allocate current stock.

## Deploy
Replace these files in the GitHub repository:
- `billing.html`
- `assets/js/billing.js`
- `assets/css/billing.css`

No other project files are changed in this increment.
