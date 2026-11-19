// Pure unit tests for assets/js/billing-engine.js (no database needed).
//   node tests/billing-engine.test.mjs
import { calcLine, fefoAllocate, summarize, validateLineInput, detectAnomalies } from '../assets/js/billing-engine.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? '  → ' + d : ''}`); };
const throws = (n, fn, re) => { try { fn(); ok(n, false, 'no error'); } catch (e) { ok(n, re.test(e.message), e.message); } };

// Tax-exclusive formula from the spec
const ex = calcLine({ mrp: 100, qty: 3, discountPct: 10, gstPct: 12, priceIncludesTax: false });
ok('exclusive: base 300, disc 30, net 270, gst 32.40, total 302.40', ex.base === 300 && ex.discount === 30 && ex.net === 270 && ex.gst === 32.4 && ex.total === 302.4, JSON.stringify(ex));
// Tax-inclusive: GST extracted, not added
const inc = calcLine({ mrp: 105, qty: 2, discountPct: 0, gstPct: 5, priceIncludesTax: true });
ok('inclusive: 210 incl. 5% -> gst 10, taxable 200, total 210', inc.gst === 10 && inc.net === 200 && inc.total === 210);
ok('inclusive never adds GST on top of MRP', calcLine({ mrp: 50, qty: 1, gstPct: 12 }).total === 50);
ok('half-paise rounds away from zero (0.125 → 0.13)', calcLine({ mrp: 1.25, qty: 1, discountPct: 10, gstPct: 0 }).discount === 0.13);
ok('no float drift (0.1 × 3 = 0.30)', calcLine({ mrp: 0.1, qty: 3, gstPct: 0 }).total === 0.3);
ok('large bill stays exact', calcLine({ mrp: 99999.99, qty: 9999, discountPct: 0.01, gstPct: 18, priceIncludesTax: false }).base === 999899900.01);
throws('negative MRP rejected', () => calcLine({ mrp: -1, qty: 1 }), /negative/);
throws('zero quantity rejected', () => calcLine({ mrp: 1, qty: 0 }), /greater than zero/);
throws('discount > 100 rejected', () => calcLine({ mrp: 1, qty: 1, discountPct: 101 }), /0 and 100/);

// FEFO — the spec example
const today = '2026-11-19';
const batches = [
  { id: 'c', batch_no: 'C', expiry: '2027-08-31', qty: 20 },
  { id: 'a', batch_no: 'A', expiry: '2027-01-31', qty: 10 },
  { id: 'b', batch_no: 'B', expiry: '2027-03-31', qty: 8 },
  { id: 'x', batch_no: 'EXP', expiry: '2026-10-01', qty: 99 },
  { id: 'q', batch_no: 'Q', expiry: '2026-12-01', qty: 99, quarantined: true },
  { id: 'r', batch_no: 'R', expiry: '2026-12-02', qty: 99, stock_status: 'recalled' },
  { id: 'z', batch_no: 'Z', expiry: '2026-12-03', qty: 0 }
];
const a = fefoAllocate(batches, 25, { today });
ok('25 → A10, B8, C7', a.rows.map(r => r.batch_no + r.qty_allocated).join(',') === 'A10,B8,C7' && a.allocated === 25 && a.shortage === 0);
ok('ineligible batches excluded and counted', a.excluded.expired === 1 && a.excluded.blocked_or_recalled === 2 && a.excluded.zero_stock === 1, JSON.stringify(a.excluded));
const s = fefoAllocate(batches, 50, { today });
ok('shortage: requested 50, available 38, short 12', s.available_total === 38 && s.shortage === 12 && s.allocated === 38);
ok('stops once fulfilled (5 → only A)', fefoAllocate(batches, 5, { today }).rows.length === 1);
ok('batch expiring today is not sold', fefoAllocate([{ id: 't', batch_no: 'T', expiry: today, qty: 5 }], 1, { today }).allocated === 0);
const res = fefoAllocate(batches.map(b => b.id === 'a' ? { ...b, reserved_by_others: 10 } : b), 5, { today });
ok('stock reserved by another bill is skipped', res.rows[0].batch_no === 'B' && res.excluded.fully_reserved === 1);
const man = fefoAllocate(batches, 12, { today, manual: [{ batch_id: 'c', qty: 5 }] });
ok('manual override C5 + FEFO remainder A7', man.rows.map(r => r.batch_no + r.qty_allocated).join(',') === 'A7,C5');
throws('manual override cannot use expired batch', () => fefoAllocate(batches, 5, { today, manual: [{ batch_id: 'x', qty: 5 }] }), /not eligible/);

// Batch-wise totals with different MRPs / tax treatments
const lines = [
  calcLine({ mrp: 30, qty: 10, discountPct: 10, gstPct: 12 }),
  calcLine({ mrp: 32, qty: 8, discountPct: 10, gstPct: 12 }),
  calcLine({ mrp: 35, qty: 7, discountPct: 10, gstPct: 12 })
];
const sum = summarize(lines, 5);
ok('medicine total = sum of batch totals (270 + 230.40 + 220.50 = 720.90)', sum.subtotal === 720.9, JSON.stringify(sum));
ok('grand total after ₹5 bill discount = 715.90', sum.grandTotal === 715.9);
ok('bill discount larger than bill is flagged', summarize(lines, 10000).billDiscountExceeds === true);

// Validation
ok('discount above branch limit rejected', validateLineInput({ mrp: 10, qty: 1, discountPct: 40, gstPct: 12 }, { maxDiscountPct: 30 }).length === 1);
ok('unconfigured GST rate rejected', validateLineInput({ mrp: 10, qty: 1, discountPct: 0, gstPct: 7 }, { gstRates: [0, 5, 12, 18] }).length === 1);
ok('MRP above printed MRP rejected', validateLineInput({ mrp: 11, qty: 1, discountPct: 0, gstPct: 12 }, { maxMrp: 10 }).length === 1);
ok('fractional tablet quantity rejected', validateLineInput({ mrp: 10, qty: 1.5, discountPct: 0, gstPct: 12 }).length === 1);

const an = detectAnomalies([{ name: 'X', requestedQty: 300, shortage: 2, available: 298, rows: [{ batch_no: 'B1', qty: 298, mrp: 9, defaultMrp: 10, discountPct: 25, gstPct: 5, defaultGstPct: 12, daysToExpiry: 20, total: 100 }] }], { maxDiscountPct: 30 });
ok('anomalies: shortage, large qty, high discount, GST & MRP change, near expiry', ['insufficient_stock', 'large_quantity', 'high_discount', 'gst_changed', 'mrp_changed', 'near_expiry'].every(c => an.some(x => x.code === c)), an.map(x => x.code).join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
