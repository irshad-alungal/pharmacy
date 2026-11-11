# ALZA Pharmacy — Initial Stock tab fix

## What was fixed
`assets/js/initial-stock.js` assigned to an undeclared variable (`draft = saved`).
ES modules run in strict mode, so this caused a `ReferenceError` and prevented the
Initial Stock panel from rendering. The unnecessary assignment has been removed.
The existing `saved` variable continues to hold the Supabase draft response.

## Install
1. Extract this ZIP.
2. Open the `pharmacy-main` folder.
3. Upload/push the contents into the same GitHub repository and folder structure,
   replacing the existing files when prompted.
4. Wait for GitHub Pages to publish.
5. Open Inventory and hard-refresh with Ctrl+Shift+R.
6. Select Initial Stock.

## Safe test
- Confirm the Initial / Takeover Stock heading and empty/draft form appears.
- Add one TEST row only; save draft.
- Reload the page and confirm the row is restored.
- Sign out and sign in again, then confirm the same draft is restored.
- Do not click final submission with real takeover stock until the draft test passes.

No SQL migration is needed for this JavaScript-only fix. Do not rerun migration 0010.
