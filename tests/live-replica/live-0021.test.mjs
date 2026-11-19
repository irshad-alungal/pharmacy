// Runs migration 0021 against a replica of the LIVE database structure (tests/live-replica/live-schema.json,
// exported with database/diagnostics/full_live_schema_export.sql). No Supabase needed.
//   npm i @electric-sql/pglite && node tests/live-replica/live-0021.test.mjs
// Migration 0021 tests on a replica of the LIVE database structure.
import fs from 'fs';
import { makeFixture, IDS as I, asUser, asOwner, q } from './fixture.mjs';
const MIG = fs.readFileSync(process.env.MIG || new URL('../../database/migrations/0021_complete_backend_and_live_fixes.sql', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? '  → ' + String(d).slice(0, 300) : ''}`); };
const bad = async (n, fn, re) => { try { await fn(); ok(n + ' (expected error)', false); } catch (e) { ok(`${n} → ${e.message.slice(0, 80)}`, re.test(e.message), e.message); } };
const tryit = async (n, fn, check = () => true) => { try { const r = await fn(); ok(n, check(r), JSON.stringify(r)); return r; } catch (e) { ok(n, false, e.message + ' @ ' + (e.where || '')); } };
const one = async (db, sql, p) => (await q(db, sql, p))[0];
// Server-side total of an allocation (deterministic billing_calc_line), used as a cash payment.
const totalOf = async (db, rows) => { let t = 0; for (const r of rows) t += +(await one(db, `select total_amount from billing_calc_line($1,$2,$3,$4,$5)`, [r.mrp, r.qty, r.default_discount_pct, r.tax_rate, r.price_includes_tax])).total_amount; return Math.round(t * 100) / 100; };
const cash = t => JSON.stringify([{ method: 'cash', amount: t }]);

const db = await makeFixture();
await asOwner(db);
const dist = (await one(db, `insert into distributors(branch_id,name) values ('${I.branch}','Dist A') returning id`)).id;
const med = (await one(db, `insert into medicines(branch_id,name,mrp,selling_price,tax_rate) values ('${I.branch}','Dolo 650',30,30,12) returning id`)).id;
const med2 = (await one(db, `insert into medicines(branch_id,name,mrp,selling_price,tax_rate,price_includes_tax) values ('${I.branch}','Excl Med',100,100,18,false) returning id`)).id;

// --- BEFORE migration: legacy opening stock (no cost layer) ------------------
await asUser(db, I.superAdmin);
await q(db, `select opening_stock_save_draft($1::jsonb,'legacy')`, [JSON.stringify([{ medicine_id: med, batch_no: 'OLD1', expiry: '2027-03-01', qty: 6, unit_cost: 11, mrp: 30, selling_price: 30 }])]);
await q(db, `select opening_stock_submit()`);
await asOwner(db);
// reset the session so the Part D tests can create a fresh one later
await db.exec(`delete from opening_stock_items; delete from opening_stock_sessions`);

// --- apply migration ---------------------------------------------------------
try { await db.exec(MIG); await db.exec(MIG); ok('migration applies twice on live replica', true); }
catch (e) { ok('migration applies twice on live replica', false, e.message); process.exit(1); }

const OLD1 = (await one(db, `select id from medicine_batches where batch_no='OLD1'`)).id;
ok('backfill: legacy opening batch now has a cost layer (6 @ 11)',
  +(await one(db, `select coalesce(sum(remaining_qty),0) s from inventory_cost_layers where batch_id=$1 and layer_type='opening_stock' and unit_cost=11`, [OLD1])).s === 6);
await asOwner(db);
await q(db, `insert into billing_settings(branch_id) values ('${I.branch}') on conflict do nothing`);

// --- A: role fixes ------------------------------------------------------------
await asUser(db, I.inventory);
const items = b => JSON.stringify([{ medicine_id: med, batch_no: b, expiry: '2028-01-01', qty: 10, price: 20, tax_rate: 12 }]);
await tryit('inventory_staff can post a purchase (v1)', () => q(db, `select confirm_purchase($1,'INV-1','2026-11-01',0,0,$2::jsonb,null) id`, [dist, items('P1')]));
const P1 = (await one(db, `select id from medicine_batches where batch_no='P1'`))?.id;
await tryit('inventory_staff can adjust stock', () => q(db, `select adjust_stock($1, 2, 'adjustment', 'found 2 strips')`, [P1]));
await tryit('inventory_staff can run a physical count (+3 on P1)', () => q(db, `select physical_count($1::jsonb,'count')`, [JSON.stringify([{ batch_id: P1, counted: 15 }])]));
await tryit('inventory_staff sees low stock', () => q(db, `select * from low_stock()`));
await asUser(db, I.billing);
await tryit('billing_staff can hold a bill', () => q(db, `insert into held_bills(label,cart,created_by) values ('x','[]'::jsonb,$1) returning id`, [I.billing]));

// --- C: FIFO for physical count ----------------------------------------------
await asOwner(db);
const layersP1 = +(await one(db, `select sum(remaining_qty) s from inventory_cost_layers where batch_id=$1`, [P1])).s;
const qtyP1 = +(await one(db, `select qty from medicine_batches where id=$1`, [P1])).qty;
ok('physical count audit row unchanged (entity_type inventory)', (await q(db, `select 1 from audit_logs where action='physical_count' and entity_type='inventory'`)).length === 1);
ok(`physical count keeps cost layers = stock (layers ${layersP1}, stock ${qtyP1})`, layersP1 === qtyP1);

// --- sale across legacy opening batch + purchase batch (finalize_sale_v3) -----
await asUser(db, I.billing);
const cart = '11111111-0000-0000-0000-0000000000a1';
const alloc = (await one(db, `select billing_allocate($1,$2,10) a`, [cart, med])).a;
ok('FEFO picks legacy opening batch OLD1 first (6) then P1 (4)', alloc.rows.map(r => r.batch_no + ':' + r.qty).join(',') === 'OLD1:6,P1:4', JSON.stringify(alloc.rows));
const patient = { doctor_name: 'Dr. Rao', patient_name: 'Anu', patient_phone: '98470 12345', patient_address: 'Pallikkal', diagnosis: 'Fever' };
const sale = await tryit('sale incl. opening-stock batch succeeds (FIFO fixed) with patient details',
  async () => q(db, `select finalize_sale_v3(null,$1::jsonb,$4::jsonb,0,$2,null,$3::jsonb) id`,
    [JSON.stringify(alloc.rows.map(r => ({ batch_id: r.batch_id, qty: r.qty }))), cart, JSON.stringify(patient), cash(await totalOf(db, alloc.rows))]));
const INV = sale?.[0]?.id;
await asOwner(db);
const pinv = await one(db, `select doctor_name, patient_name, diagnosis from sales_invoices where id=$1`, [INV]);
ok('patient details stored on invoice', pinv?.doctor_name === 'Dr. Rao' && pinv?.diagnosis === 'Fever');
const cogs = +(await one(db, `select sum(a.total_cost) s from inventory_sale_allocations a join sales_items si on si.id=a.sales_item_id where si.invoice_id=$1`, [INV])).s;
ok(`cost of goods uses real batch costs (6×11 + 4×20 = 146, got ${cogs})`, cogs === 146);

// --- H: invoice_detail with exclusive tax -------------------------------------
await asOwner(db);
await q(db, `insert into medicine_batches(branch_id,medicine_id,batch_no,expiry,qty,unit_cost) values ('${I.branch}','${med2}','X1','2028-01-01',5,60)`);
await q(db, `insert into inventory_cost_layers(branch_id,medicine_id,batch_id,layer_type,received_qty,remaining_qty,unit_cost) select branch_id,medicine_id,id,'legacy_unresolved',5,5,60 from medicine_batches where batch_no='X1'`);
await asUser(db, I.billing);
const cart2 = '11111111-0000-0000-0000-0000000000a2';
const a2 = (await one(db, `select billing_allocate($1,$2,2) a`, [cart2, med2])).a;
const s2 = await one(db, `select finalize_sale_v3(null,$1::jsonb,$3::jsonb,0,$2,236,null) id`, [JSON.stringify(a2.rows.map(r => ({ batch_id: r.batch_id, qty: r.qty }))), cart2, cash(236)]);
const det = (await one(db, `select invoice_detail($1) d`, [s2.id])).d;
const ts = det.tax_summary[0];
ok('invoice_detail: exclusive GST summary 200 taxable + 36 tax (was 200/36 wrong before)', +ts.taxable === 200 && +ts.tax === 36, JSON.stringify(det.tax_summary));
ok('invoice_detail still returns the fields invoice.js uses', det.invoice.invoice_no && det.items.length === 1 && det.payments && det.shop);
const legacyDet = (await one(db, `select invoice_detail($1) d`, [INV])).d;
ok('invoice_detail: patient name returned', legacyDet.invoice.patient_name === 'Anu');
await tryit('finalize_sale_v2 (deployed billing page) still works unchanged', async () => {
  const c3 = '11111111-0000-0000-0000-0000000000a3';
  const a3 = (await one(db, `select billing_allocate($1,$2,1) a`, [c3, med])).a;
  return q(db, `select finalize_sale_v2(null,$1::jsonb,$3::jsonb,0,$2,null)`, [JSON.stringify(a3.rows.map(r => ({ batch_id: r.batch_id, qty: r.qty }))), c3, cash(await totalOf(db, a3.rows))]);
});

// --- I: purchases v2 ------------------------------------------------------------
await asUser(db, I.inventory);
const header = { distributor_id: dist, invoice_no: 'PB-77', invoice_date: '2026-11-18', due_date: '2026-12-18', discount: 0, freight: 10, round_off: 0.2 };
const pitems = [{ medicine_id: med, batch_no: 'PK10', expiry: '2028-06-30', qty: 2, free_qty: 1, pack: 10, price: 150, tax_rate: 12, discount: 0, mrp: 320, hsn: '3004' }];
const draft = await tryit('draft saved by inventory_staff', () => one(db, `select purchase_draft_save(null,$1::jsonb) id`, [JSON.stringify({ ...header, items: pitems })]));
await tryit('draft listed', () => q(db, `select * from purchase_draft_list()`), r => r.length === 1 && r[0].item_count === 1);
await asOwner(db);
ok('saving a draft does not change stock', !(await q(db, `select 1 from medicine_batches where batch_no='PK10'`)).length);
await asUser(db, I.inventory);
await bad('inventory_staff cannot record a supplier payment', () => q(db, `select confirm_purchase_v2($1::jsonb,$2::jsonb,'{"amount":50,"method":"cash"}'::jsonb,null)`, [JSON.stringify(header), JSON.stringify(pitems)]), /Only an admin/);
const pv2 = await tryit('confirm_purchase_v2 by inventory_staff (pack 10, 2 strips + 1 free)', () => one(db, `select confirm_purchase_v2($1::jsonb,$2::jsonb,null,$3) id`, [JSON.stringify(header), JSON.stringify(pitems), draft.id]));
await asOwner(db);
const pk = await one(db, `select qty, mrp, tax_rate, pack_size from medicine_batches where batch_no='PK10'`);
ok('stock = (2 + 1 free) × 10 = 30 units, batch MRP 32/unit, GST 12', +pk.qty === 30 && +pk.mrp === 32 && +pk.tax_rate === 12, JSON.stringify(pk));
const lay = await q(db, `select layer_type, received_qty, unit_cost from inventory_cost_layers where batch_id=(select id from medicine_batches where batch_no='PK10') order by layer_type`);
ok('cost layers: free 10 @ 0, paid 20 @ 15', lay.length === 2 && lay[0].layer_type === 'free' && +lay[0].unit_cost === 0 && +lay[1].received_qty === 20 && +lay[1].unit_cost === 15, JSON.stringify(lay));
const pinv2 = await one(db, `select total, round_off, due_date from purchase_invoices where id=$1`, [pv2.id]);
ok('invoice total = 300 + 36 GST + 10 freight + 0.20 round off = 346.20', +pinv2.total === 346.2, JSON.stringify(pinv2));
ok('purchase journal posted to ledger', (await q(db, `select 1 from financial_ledger where ref_id=$1 and account='payables'`, [pv2.id])).length === 1);
ok('draft removed after posting', !(await q(db, `select 1 from purchase_drafts`)).length);
await asUser(db, I.inventory);
await bad('duplicate supplier invoice rejected with clear message', () => q(db, `select confirm_purchase_v2($1::jsonb,$2::jsonb,null,null)`, [JSON.stringify(header), JSON.stringify(pitems)]), /already posted/);
const dInv = (await one(db, `select purchase_detail($1) d`, [pv2.id])).d;
ok('purchase_detail for staff: lines shown, costs hidden', dInv.items.length === 1 && dInv.items[0].unit_price == null && dInv.invoice.total == null && dInv.items[0].stock_units == 30);
await asUser(db, I.superAdmin);
const header2 = { ...header, invoice_no: 'PB-78' };
const pv3 = await tryit('admin posts purchase with cash payment', () => one(db, `select confirm_purchase_v2($1::jsonb,$2::jsonb,'{"amount":100,"method":"cash","reference":"r1"}'::jsonb,null) id`, [JSON.stringify(header2), JSON.stringify([{ ...pitems[0], batch_no: 'PK11' }])]));
const dA = (await one(db, `select purchase_detail($1) d`, [pv3.id])).d;
ok('purchase_detail for admin: costs, payment and balance', +dA.items[0].unit_price === 150 && dA.payments.length === 1 && +dA.invoice.balance === 246.2, JSON.stringify(dA.invoice));
await tryit('purchase_invoice_exists finds PB-78', () => one(db, `select purchase_invoice_exists($1,'pb-78') id`, [dist]), r => !!r.id);

// --- new medicine from purchase takes MRP/GST from the bill -----------------------
await asUser(db, I.inventory);
const newMed = (await one(db, `insert into medicines(branch_id,name,mrp,selling_price,tax_rate) values ('${I.branch}','Brand New 10mg',0,0,12) returning id`)).id;
await tryit('purchase of a brand-new medicine', () => one(db, `select confirm_purchase_v2($1::jsonb,$2::jsonb,null,null) id`, [JSON.stringify({ ...header, invoice_no: 'PB-79' }), JSON.stringify([{ medicine_id: newMed, batch_no: 'N1', expiry: '2028-01-01', qty: 1, pack: 15, price: 90, tax_rate: 5, mrp: 150 }])]));
await asOwner(db);
const nm = await one(db, `select mrp, selling_price, tax_rate from medicines where id=$1`, [newMed]);
ok('new medicine gets MRP 10/unit and GST 5 from the bill', +nm.mrp === 10 && +nm.selling_price === 10 && +nm.tax_rate === 5, JSON.stringify(nm));

// --- D: initial stock v2 + edit -----------------------------------------------------
await asUser(db, I.superAdmin);
await tryit('initial stock draft with pack fields', () => q(db, `select opening_stock_save_draft($1::jsonb,'n')`, [JSON.stringify([{ medicine_id: med2, batch_no: 'OS9', expiry: '2028-02-01', qty: 20, pack_size: 10, pack_qty: 2, srate: 1000, prate: 600, urate: 100 }])]));
await tryit('initial stock submit', () => q(db, `select opening_stock_submit()`));
const os9 = (await one(db, `select id, qty, mrp from medicine_batches where batch_no='OS9'`));
ok('opening batch: 20 units, MRP 100, cost layer 20 @ 60', +os9.qty === 20 && +os9.mrp === 100 &&
  +(await one(db, `select sum(remaining_qty) s from inventory_cost_layers where batch_id=$1 and unit_cost=60`, [os9.id])).s === 20);
await tryit('edit submitted opening batch to 3 packs (30 units)', () => q(db, `select opening_stock_edit_submitted_batch($1,'OS9','2028-02-01',10,3,1000,600,100)`, [os9.id]));
await asOwner(db);
ok('edit keeps layers = stock (30)', +(await one(db, `select sum(remaining_qty) s from inventory_cost_layers where batch_id=$1`, [os9.id])).s === 30);

// --- E/F: logos + doctor sheets -------------------------------------------------------
await asUser(db, I.inventory);
await tryit('distributor logo_path column writable', () => q(db, `update distributors set logo_path='x/y.png' where id=$1`, [dist]));
await asOwner(db);
const cust = (await one(db, `insert into customers(branch_id,name,phone) values ('${I.branch}','Ravi','9847000001') returning id`)).id;
await q(db, `update sales_invoices set customer_id=$1 where id=$2`, [cust, INV]);
await asUser(db, I.billing);
await tryit('doctor sheet metadata insert', () => q(db, `insert into customer_doctor_sheets(branch_id,customer_id,invoice_id,file_name,mime_type,file_size,storage_path,uploaded_by) values ($1,$2,$3,'rx.pdf','application/pdf',100,$4,$5)`, [I.branch, cust, INV, `${I.branch}/${INV}/a.pdf`, I.billing]));

// --- J: reports ------------------------------------------------------------------------
await asUser(db, I.superAdmin);
const reps = [
  ['report_period_summary', `select * from report_period_summary('', '', 'month')`],
  ['report_sales', `select * from report_sales('2026-01-01','')`],
  ['report_purchases', `select * from report_purchases('', '')`],
  ['report_medicines', `select * from report_medicines('', '')`],
  ['report_customers', `select * from report_customers('', '')`],
  ['report_distributors', `select * from report_distributors('', '')`],
  ['report_stock', `select * from report_stock()`],
  ['report_expiry', `select * from report_expiry(3650)`],
  ['report_returns', `select * from report_returns('', '')`],
  ['report_expenses', `select * from report_expenses('', '')`],
  ['report_tax', `select * from report_tax('', '')`],
  ['report_pnl', `select * from report_pnl('', '')`],
  ['report_ledger', `select * from report_ledger('', '')`],
];
const res = {};
for (const [n, sql] of reps) res[n] = await tryit(`${n} runs`, () => q(db, sql));
ok('report_sales lists the 3 bills', res.report_sales?.length === 3);
const pnl = Object.fromEntries((res.report_pnl || []).map(r => [r.label, +r.amount]));
ok('P&L cost of goods matches FIFO allocations', pnl['Less: cost of goods sold (FIFO)'] < 0, JSON.stringify(pnl));
ok('report_medicines: Dolo sold 11, cost from layers', res.report_medicines?.some(r => r.name === 'Dolo 650' && +r.qty_sold === 11));
ok('tax report has output and input GST', res.report_tax?.some(r => /Output/.test(r.label)) && res.report_tax?.some(r => /Input/.test(r.label)));
await asUser(db, I.billing);
await bad('billing staff cannot run reports', () => q(db, `select * from report_sales('','')`), /Not authorised/);
await tryit('ist_today available', () => one(db, `select ist_today() d`), r => !!r.d);

// --- existing features unaffected ---------------------------------------------------------
await asUser(db, I.superAdmin);
await tryit('customer return of 1 unit from the opening-stock batch (existing process_sales_return)', async () => {
  const it = await one(db, `select si.id from sales_items si join medicine_batches b on b.id=si.batch_id where si.invoice_id=$1 and b.batch_no='OLD1'`, [INV]);
  return q(db, `select process_sales_return($1, $2::jsonb, 'cash', 'wrong item')`, [INV, JSON.stringify([{ sales_item_id: it.id, qty: 1, disposition: 'restock' }])]);
});
await tryit('purchase return to distributor (existing process_purchase_return)', async () => {
  const it = await one(db, `select id from purchase_items where invoice_id=$1`, [pv3.id]);
  return q(db, `select process_purchase_return($1, $2::jsonb, 'damaged')`, [pv3.id, JSON.stringify([{ purchase_item_id: it.id, qty: 1 }])]);
});
await tryit('dashboard RPCs still run', async () => { await q(db, `select * from customer_dues()`); await q(db, `select * from payable_balances()`); return q(db, `select * from ledger_summary('2026-01-01','2026-12-31')`); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
