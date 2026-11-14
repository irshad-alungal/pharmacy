# Initial Stock Excel Update

This project update adds the Excel workflow to Inventory → Initial Stock.

## Excel columns preserved

The first worksheet uses the exact headings and order from the supplied workbook:

`sl no`, `Item NAme`, `batch`, `pack`, `Qty`, `Exp`, `Srate`, `Prate`, `Urate`

## Calculations used

- `pack` = individual units in one strip/pack.
- `Qty` = number of packs.
- Posted inventory quantity = `pack × Qty` individual units.
- `Srate` = MRP per pack.
- `Urate` = `Srate ÷ pack` (per-unit MRP).
- `Prate` = purchase rate per pack.
- Batch unit acquisition cost = `Prate ÷ pack`.

The medicine master stores per-unit MRP/selling price from `Urate`. The batch cost stores per-unit purchase cost. The original pack and rate fields are retained on the opening-stock draft rows and posted batch records by migration 0011.

## Frontend files changed

- `inventory.html` — loads the Excel reader and Initial Stock stylesheet.
- `assets/js/initial-stock.js` — Excel template download, import, editable nine-column grid, missing-medicine creation, save draft, confirmation and submitted-batch editor.
- `assets/css/initial-stock.css` — responsive styles.

## Required database migration

The current `0010_initial_stock.sql` schema does not persist all nine imported values and does not retain the posted batch ID on the opening-stock row. The frontend therefore requires:

`database/migrations/0011_initial_stock_excel_upgrade.sql`

**Do not deploy this frontend alone.** First compare the migration with the live Supabase definitions and schema, take a database backup, and apply the migration in a controlled maintenance window. The migration adds fields and replaces the Initial Stock RPCs. It does not drop tables or existing records.

The migration's submitted-batch editor:
- restricts changes to a submitted opening-stock batch in the user's branch;
- validates pack/rate arithmetic;
- records an audit log;
- records a stock movement if quantity changes;
- blocks quantity changes when the batch has non-opening stock movements, to avoid rewriting stock history.

## Medicine creation behaviour

When an uploaded row names a medicine not found in the current branch, the frontend creates a medicine master record during import. The record initially has zero MRP/selling price; the final per-unit price is populated when the opening-stock draft is submitted. A medicine created by upload remains in the medicine master even if the user later discards the draft; review imported names before uploading.

## Testing checklist

1. Download the template and confirm the nine headings.
2. Upload a copy with a test medicine and test batch.
3. Confirm the medicine is created only once.
4. Edit all nine fields and save draft.
5. Refresh/sign out and back in; confirm the draft reloads.
6. Confirm stock has not changed before submission.
7. Submit only with a controlled test dataset.
8. Confirm total units = pack × Qty and batch unit cost = Prate ÷ pack.
9. Edit a submitted batch with no subsequent movements.
10. Confirm audit log and stock movement records.
11. Confirm quantity editing is rejected if subsequent stock movements exist.
