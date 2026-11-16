# Batch-number search update

Updated `assets/js/billing.js`:
- Billing search now searches active medicine names/barcodes and sellable, unexpired, non-quarantined batch numbers.
- A batch-number match shows the medicine and matching batch as a direct selection option.
- Selecting a batch-number result adds the medicine with that batch explicitly selected; FEFO remains the default for ordinary medicine searches.

Updated `assets/js/medicines.js`:
- Medicine master search now also matches `medicine_batches.batch_no` and returns the owning medicine in the results.
- The existing medicine profile continues to show the full batch-stock table.

No database schema or data was changed. The update uses the existing `medicine_batches` table and branch filters.
