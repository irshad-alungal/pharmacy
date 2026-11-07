# ALZA PHARMACY — Phase 5 Billing website integration

This package is based on the latest `pharmacy-main (3).zip`, not the older Phase 5 project.

Included:
- Phase 5 Billing screen: customer selection, split payments, held bills and credit option.
- Phase 5 invoice renderer: 80mm thermal and A4 print/PDF.
- Branch-scoped customer, medicine, batch and held-bill queries in Billing.
- Branch-based pharmacy profile editor in Settings.
- Billing page loads the existing print stylesheet.

Important:
- The Supabase compatibility migration was run separately in the preceding step.
- `finalize_sale` is not replaced by this website package.
- Test with a non-production/test sale before using at the counter.
- Credit settlement/receipt recording is not implemented in this website package yet; the current outstanding function counts credit payment rows. Do not treat it as a complete receivables/collection workflow until receipts are added and tested.
