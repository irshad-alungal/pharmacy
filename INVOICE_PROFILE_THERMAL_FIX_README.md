# ALZA PHARMACY — Invoice profile and thermal PDF fix

This update:
- Loads the active branch profile from `public.branches` when opening an invoice.
- Displays the editable branch name, address, city, state, PIN, phone, GSTIN, drug licence numbers, and invoice footer.
- Uses an explicit "Amounts in INR" label in downloadable PDFs and removes the repeated `Rs.` prefix from each right-aligned amount, avoiding the clipped currency prefix seen in the thermal PDF.
- Keeps the browser invoice preview and print renderer using the existing rupee symbol.
- Does not modify billing, sales, stock, payment, or database functions.

The branch details are edited from Settings > Pharmacy details (used on invoices).
