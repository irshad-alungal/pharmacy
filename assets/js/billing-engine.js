// Deterministic billing engine (no DOM, no network, no AI).
//
// This module mirrors public.billing_calc_line() and public._billing_fefo_compute()
// in database/migrations/0020_billing_fefo_gst_engine.sql. The database remains
// authoritative: finalize_sale_v2() recomputes every line and rejects the bill if
// the screen total differs. All money is computed in integer paise with
// round-half-away-from-zero, the same rule PostgreSQL's round(numeric, 2) uses.

export const GST_FALLBACK_RATES = [0, 5, 12, 18, 28];

// ---- exact rounding helpers -------------------------------------------------
const toScaledInt = (value, scale) => {
  // Converts a decimal (number or string) to an integer at 10^scale without
  // binary floating-point drift, e.g. ("12.345", 2) -> 1235 (half away from zero).
  const s = String(value ?? '').trim();
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === '' || s === '-' || s === '.') return NaN;
  const neg = s.startsWith('-');
  const [ip, fp = ''] = (neg ? s.slice(1) : s).split('.');
  const digits = (ip || '0') + fp.padEnd(scale + 1, '0').slice(0, scale + 1);
  let n = Number(digits.slice(0, -1) || '0');
  if (Number(digits.slice(-1)) >= 5) n += 1;
  return neg ? -n : n;
};

// round(num / den) half away from zero; BigInt so large bills never lose precision.
const divRound = (num, den) => {
  const n = BigInt(num), d = BigInt(den);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (2n * a + d) / (2n * d);
  return Number(neg ? -q : q);
};
const mul = (a, b) => (BigInt(a) * BigInt(b)).toString();

export const paise = rupees => toScaledInt(rupees, 2);
export const fromPaise = p => Math.round(p) / 100;
export const round2 = v => fromPaise(paise(Number(v).toFixed(10)));

// ---- validation -------------------------------------------------------------
export function validateLineInput({ mrp, qty, discountPct, gstPct }, rules = {}) {
  const errors = [];
  const maxDisc = rules.maxDiscountPct ?? 100;
  const gstRates = rules.gstRates ?? null;
  if (!Number.isFinite(+qty) || +qty <= 0) errors.push('Quantity must be greater than zero.');
  else if (rules.integerQty !== false && !Number.isInteger(+qty)) errors.push('Quantity must be a whole number.');
  if (!Number.isFinite(+mrp) || +mrp < 0) errors.push('MRP must not be negative.');
  if (rules.maxMrp > 0 && +mrp > rules.maxMrp) errors.push(`MRP cannot exceed the printed MRP ₹${rules.maxMrp.toFixed(2)}.`);
  if (!Number.isFinite(+discountPct) || +discountPct < 0 || +discountPct > 100) errors.push('Discount must be between 0% and 100%.');
  else if (+discountPct > maxDisc) errors.push(`Discount cannot exceed ${maxDisc}%.`);
  if (!Number.isFinite(+gstPct) || +gstPct < 0 || +gstPct > 40) errors.push('GST must be between 0% and 40%.');
  else if (gstRates && !gstRates.map(Number).includes(+gstPct)) errors.push(`GST ${gstPct}% is not a configured rate.`);
  return errors;
}

// ---- line calculation (mirrors billing_calc_line) ---------------------------
// Returns rupee values; `priceIncludesTax` true means MRP already contains GST
// (GST is extracted, never added again).
export function calcLine({ mrp, qty, discountPct = 0, gstPct = 0, priceIncludesTax = true }) {
  const mrpP = paise(mrp);
  const qtyM = toScaledInt(qty, 3);              // quantity in 1/1000 units
  const dBp = toScaledInt(discountPct, 2);       // discount in basis points (1/100 %)
  const gBp = toScaledInt(gstPct, 2);
  if (![mrpP, qtyM, dBp, gBp].every(Number.isFinite)) throw new Error('Invalid billing input');
  if (mrpP < 0) throw new Error('MRP must not be negative');
  if (qtyM <= 0) throw new Error('Quantity must be greater than zero');
  if (dBp < 0 || dBp > 10000) throw new Error('Discount percentage must be between 0 and 100');
  if (gBp < 0 || gBp > 4000) throw new Error('GST percentage must be between 0 and 40');

  const base = divRound(mul(mrpP, qtyM), 1000);
  const disc = divRound(mul(base, dBp), 10000);
  const after = base - disc;
  let gst, taxable, total;
  if (priceIncludesTax !== false) {
    gst = divRound(mul(after, gBp), 10000 + gBp);
    taxable = after - gst;
    total = after;
  } else {
    gst = divRound(mul(after, gBp), 10000);
    taxable = after;
    total = after + gst;
  }
  return {
    base: fromPaise(base),
    discount: fromPaise(disc),
    net: fromPaise(taxable),       // taxable value (excl. GST)
    gst: fromPaise(gst),
    total: fromPaise(total),
    paise: { base, discount: disc, net: taxable, gst, total }
  };
}

// ---- FEFO allocation (mirrors _billing_fefo_compute) -------------------------
// batches: [{id, batch_no, expiry:'YYYY-MM-DD', qty, quarantined, stock_status, reserved_by_others}]
export function isEligibleBatch(b, today) {
  return Number(b.qty) > 0
    && String(b.expiry) > String(today)
    && !b.quarantined
    && (b.stock_status ?? 'active') === 'active';
}

export function fefoAllocate(batches, requestedQty, { today, manual = [] } = {}) {
  const req = Number(requestedQty);
  if (!Number.isFinite(req) || req <= 0) throw new Error('Quantity must be greater than zero');
  if (!today) throw new Error('today (YYYY-MM-DD) is required');
  const excluded = { expired: 0, blocked_or_recalled: 0, zero_stock: 0, fully_reserved: 0 };
  for (const b of batches) {
    if (Number(b.qty) <= 0) excluded.zero_stock++;
    else if (String(b.expiry) <= String(today)) excluded.expired++;
    else if (b.quarantined || (b.stock_status ?? 'active') !== 'active') excluded.blocked_or_recalled++;
  }
  const candidates = batches
    .filter(b => isEligibleBatch(b, today))
    .map(b => ({ ...b, available: Number(b.qty) - Number(b.reserved_by_others || 0) }))
    .filter(b => (b.available > 0) || (excluded.fully_reserved++, false))
    .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry))
      || String(a.batch_no).localeCompare(String(b.batch_no))
      || String(a.id).localeCompare(String(b.id)));

  const manualMap = new Map();
  for (const m of manual) {
    if (manualMap.has(m.batch_id)) throw new Error('Duplicate batch in manual selection');
    if (!(Number(m.qty) > 0)) throw new Error('Manual batch selection needs a positive quantity');
    manualMap.set(m.batch_id, Number(m.qty));
  }
  const manualSum = [...manualMap.values()].reduce((s, q) => s + q, 0);
  if (manualSum > req) throw new Error('Manual batch quantities exceed requested quantity');
  for (const id of manualMap.keys()) {
    const c = candidates.find(x => x.id === id);
    if (!c) throw new Error('A manually selected batch is not eligible');
    if (manualMap.get(id) > c.available) throw new Error(`Batch ${c.batch_no} has only ${c.available} available`);
  }

  let remaining = req - manualSum;
  const rows = [];
  for (const c of candidates) {
    let take = manualMap.get(c.id) || 0;
    if (remaining > 0) {
      const extra = Math.min(c.available - take, remaining);
      if (extra > 0) { take += extra; remaining -= extra; }
    }
    if (take > 0) rows.push({ ...c, qty_allocated: take, manual: manualMap.has(c.id) });
  }
  const allocated = rows.reduce((s, r) => s + r.qty_allocated, 0);
  return {
    requested: req,
    allocated,
    available_total: candidates.reduce((s, c) => s + c.available, 0),
    shortage: Math.max(0, req - allocated),
    rows,
    candidates,
    excluded
  };
}

// ---- invoice totals ----------------------------------------------------------
// lines: [{ total, gst, net, discount, base }] in rupees (from calcLine)
export function summarize(lines, billDiscount = 0) {
  const sum = key => lines.reduce((s, l) => s + (l.paise ? l.paise[key] : paise(l[key])), 0);
  const subtotalP = sum('total');
  const billDiscP = Math.max(0, paise(billDiscount) || 0);
  return {
    base: fromPaise(sum('base')),
    lineDiscount: fromPaise(sum('discount')),
    taxable: fromPaise(sum('net')),
    gst: fromPaise(sum('gst')),
    subtotal: fromPaise(subtotalP),
    billDiscount: fromPaise(billDiscP),
    grandTotal: fromPaise(Math.max(0, subtotalP - billDiscP)),
    billDiscountExceeds: billDiscP > subtotalP
  };
}

// ---- deterministic anomaly checks (fed to the AI for explanation only) ------
export function detectAnomalies(groups, { maxDiscountPct = 30, nearExpiryDays = 90 } = {}) {
  const out = [];
  for (const g of groups) {
    if (g.shortage > 0) out.push({ level: 'error', medicine: g.name, code: 'insufficient_stock', message: `${g.name}: short by ${g.shortage} (only ${g.available} eligible).` });
    if (g.requestedQty >= 200) out.push({ level: 'warn', medicine: g.name, code: 'large_quantity', message: `${g.name}: unusually large quantity (${g.requestedQty}).` });
    for (const r of g.rows) {
      if (r.discountPct > maxDiscountPct) out.push({ level: 'error', medicine: g.name, code: 'discount_over_limit', message: `${g.name} ${r.batch_no}: discount ${r.discountPct}% exceeds ${maxDiscountPct}%.` });
      else if (r.discountPct >= Math.min(20, maxDiscountPct)) out.push({ level: 'warn', medicine: g.name, code: 'high_discount', message: `${g.name} ${r.batch_no}: high discount ${r.discountPct}%.` });
      if (r.gstPct !== r.defaultGstPct) out.push({ level: 'warn', medicine: g.name, code: 'gst_changed', message: `${g.name} ${r.batch_no}: GST changed from ${r.defaultGstPct}% to ${r.gstPct}%.` });
      if (r.mrp !== r.defaultMrp) out.push({ level: 'warn', medicine: g.name, code: 'mrp_changed', message: `${g.name} ${r.batch_no}: MRP changed from ₹${r.defaultMrp} to ₹${r.mrp}.` });
      if (r.daysToExpiry != null && r.daysToExpiry <= nearExpiryDays) out.push({ level: 'info', medicine: g.name, code: 'near_expiry', message: `${g.name} ${r.batch_no}: expires in ${r.daysToExpiry} day(s).` });
      if (r.total === 0 && r.qty > 0) out.push({ level: 'warn', medicine: g.name, code: 'zero_amount', message: `${g.name} ${r.batch_no}: line amount is ₹0.` });
    }
    const mrps = new Set(g.rows.map(r => r.mrp));
    if (mrps.size > 1) out.push({ level: 'info', medicine: g.name, code: 'mixed_mrp', message: `${g.name}: batches have different MRPs (${[...mrps].map(v => '₹' + v).join(', ')}).` });
  }
  return out;
}

// Plain-language explanation of an allocation (deterministic, no AI needed).
export function explainAllocation(name, alloc) {
  if (!alloc) return '';
  const parts = alloc.rows.map(r => `${r.qty ?? r.qty_allocated} from ${r.batch_no} (exp ${String(r.expiry).slice(0, 7)})${r.manual ? ' [manual]' : ''}`);
  const ex = alloc.excluded || {};
  const skipped = [
    ex.expired ? `${ex.expired} expired` : '',
    ex.blocked_or_recalled ? `${ex.blocked_or_recalled} blocked/recalled` : '',
    ex.fully_reserved ? `${ex.fully_reserved} reserved by other bills` : ''
  ].filter(Boolean).join(', ');
  let s = `${name}: ${parts.join(', ') || 'nothing allocated'} — earliest eligible expiry first.`;
  if (skipped) s += ` Skipped batches: ${skipped}.`;
  if (Number(alloc.shortage) > 0) s += ` Short by ${alloc.shortage}; only ${alloc.available_total} available.`;
  return s;
}
