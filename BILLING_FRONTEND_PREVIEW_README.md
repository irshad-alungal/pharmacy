# ALZA Pharmacy Billing Frontend — first UI pass

This update refreshes the Billing page layout while retaining the current page shell and existing search, customer selection, cart, split payment, hold/resume, invoice and finalize-sale flows.

## Included in this pass
- Responsive Billing layout for desktop and mobile.
- Bill date and generated-on-save invoice number placeholder.
- Optional doctor name, patient name, patient phone, patient address and diagnosis fields.
- Medicine table columns for Sl no, Item, Rack/Shelf, Batch, Expiry, Rate, Qty, line discount, GST and Amount.
- Total item and quantity summary, overall discount, round-off placeholder and grand total.
- Split payment panel and permanent delivery-status panel location.

## Not connected yet
The new doctor/patient fields are UI-only and are not saved to the database yet. Line discount and round-off are display placeholders. Automatic FEFO split allocation and live delivery status are not connected in this UI pass. The delivery indicator intentionally says that its connection is pending; it does not invent an availability status.

Continue one feature at a time: first wire and persist patient/prescription fields, then FEFO allocation, line discounts/tax/round-off, delivery status and final invoice rendering. Do not deploy this UI as the completed full redesign.
