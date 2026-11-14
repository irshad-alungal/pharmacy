# Purchase frontend refinements

## Changes in this update
- Moved Excel template download and medicine bulk upload from the Purchase dashboard toolbar into the Medicine Items section of the New Purchase form, beside Add Medicine.
- Bulk upload now imports medicine-line fields only. It does not read or overwrite supplier, invoice number, or invoice date. The user must enter those invoice details separately before uploading.
- Template columns are medicine-only: item, manufacturer, HSN, pack factor, batch, expiry, strip quantity, free strips, MRP per pack, rate per pack, rate mode, discount, and GST.
- Pack factor is the number of base units in one strip. Quantity is the number of strips. The UI calculates stock units as `pack factor * (quantity + free strips)`.
- MRP is captured per strip; the derived billing rate per base unit is displayed as `MRP / pack factor`.
- Line total is displayed as `rate per strip * purchased strip quantity`.
- Default GST for a new/imported line is 5% unless a medicine master record supplies an explicit tax rate.
- The item table is rendered as responsive medicine cards inside the purchase dialog to avoid horizontal scrolling. Dialog width and height are constrained to the viewport.

## Important backend limitation
The currently deployed `confirm_purchase()` database function does not persist the purchase pack factor/free-strip details or update the medicine selling price from the invoice MRP. To avoid corrupting stock, the frontend blocks posting rows with pack factor greater than 1 or free quantity greater than 0 until the purchase database upgrade is installed. The frontend displays the calculated stock-unit count for review, but actual inventory and billing-rate updates require that backend upgrade.

This update is a frontend refinement only. It has not been tested against the live Supabase database or in a live browser session.
