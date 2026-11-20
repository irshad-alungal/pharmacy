// Migration 0024 on the live-schema replica: purchase orders, receiving against an order, purchase_list_v2.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture, IDS, asUser, asOwner, q } from './fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const mig = n => fs.readFileSync(path.join(HERE, '../../database/migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : '  → ' + x}`); };
const db = await makeFixture({ postgrest: true });
await db.exec(mig('0021_complete_backend_and_live_fixes.sql'));
await db.exec(mig('0024_purchases_management.sql'));
try { await db.exec(mig('0024_purchases_management.sql')); ok('0024 runs a second time', true); } catch (e) { ok('0024 runs a second time', false, e.message); }
await asOwner(db);
const unit = (await q(db, `insert into units(name,code) values ('Tab','TB') returning id`))[0].id;
const med = (await q(db, `insert into medicines(branch_id,name,strength,mrp,selling_price,tax_rate,base_unit_id) values ($1,'Dolo','650 mg',30,30,12,$2) returning id`, [IDS.branch, unit]))[0].id;
const med2 = (await q(db, `insert into medicines(branch_id,name,strength,mrp,selling_price,tax_rate,base_unit_id) values ($1,'Pan','40 mg',150,150,12,$2) returning id`, [IDS.branch, unit]))[0].id;
const dist = (await q(db, `insert into distributors(branch_id,name) values ($1,'Kerala Pharma') returning id`, [IDS.branch]))[0].id;
const dist2 = (await q(db, `insert into distributors(branch_id,name) values ($1,'Malabar Medicals') returning id`, [IDS.branch]))[0].id;
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
const J = JSON.stringify;

// --- orders
let r = await as(IDS.billing, `select purchase_order_save(null,$1::jsonb,$2::jsonb) id`, [J({ distributor_id: dist }), J([{ medicine_id: med, qty: 10, pack: 10 }])]);
ok('billing staff cannot create an order', !!r.error);
r = await as(IDS.inventory, `select purchase_order_save(null,$1::jsonb,'[]'::jsonb) id`, [J({ distributor_id: dist })]);
ok('order needs at least one line', /at least one/.test(r.error || ''), r.error);
r = await as(IDS.inventory, `select purchase_order_save(null,$1::jsonb,$2::jsonb) id`, [J({ distributor_id: dist, order_date: '2026-11-10', expected_date: '2026-11-15', notes: 'Urgent' }), J([{ medicine_id: med, qty: 10, pack: 10, rate: 20 }, { medicine_id: med2, qty: 5, pack: 15, rate: 100 }])]);
ok('inventory staff creates an order', !r.error, r.error);
const po = r.rows?.[0]?.id;
r = await as(IDS.inventory, `select * from purchase_order_list()`);
const o = r.rows?.[0];
ok('order listed as PO-202611-0001, status ordered, 2 lines, 15 packs, value 700', o && o.po_no === 'PO-202611-0001' && o.status === 'ordered' && o.line_count === 2 && +o.ordered_qty === 15 && +o.est_value === 700, J(o));
r = await as(IDS.inventory, `select purchase_order_save(null,$1::jsonb,$2::jsonb) id`, [J({ distributor_id: dist, order_date: '2026-11-12' }), J([{ medicine_id: med, qty: 1 }])]);
const po2 = r.rows?.[0]?.id;
r = await as(IDS.inventory, `select po_no from purchase_order_list() where id=$1`, [po2]);
ok('second order numbered PO-202611-0002', r.rows?.[0]?.po_no === 'PO-202611-0002', J(r));
r = await as(IDS.inventory, `select purchase_order_save($1,$2::jsonb,$3::jsonb) id`, [po, J({ distributor_id: dist, order_date: '2026-11-10' }), J([{ medicine_id: med, qty: 12, pack: 10, rate: 20 }, { medicine_id: med2, qty: 5, pack: 15, rate: 100 }])]);
ok('order edited while nothing received', !r.error, r.error);

// --- receive part of the order
const header = { distributor_id: dist2, invoice_no: 'KP-1', invoice_date: '2026-11-18' };
const items = [{ medicine_id: med, batch_no: 'D1', expiry: '2028-06-30', qty: 12, free_qty: 1, pack: 10, price: 20, tax_rate: 12, discount: 0, mrp: 300 }];
r = await as(IDS.inventory, `select confirm_purchase_v3($1::jsonb,$2::jsonb,null,null,$3) id`, [J(header), J(items), po]);
ok('bill from another supplier cannot receive the order', /not the supplier/.test(r.error || ''), r.error);
r = await as(IDS.inventory, `select confirm_purchase_v3($1::jsonb,$2::jsonb,null,null,$3) id`, [J({ ...header, distributor_id: dist }), J(items), po]);
ok('bill posted against the order', !r.error, r.error);
const inv1 = r.rows?.[0]?.id;
r = await as(IDS.inventory, `select status, received_qty, items from purchase_order_list() where id=$1`, [po]);
ok('order partly received (12 of 17 packs), status partial', r.rows?.[0]?.status === 'partial' && +r.rows[0].received_qty === 12, J(r.rows));
r = await as(IDS.inventory, `select purchase_order_save($1,$2::jsonb,$3::jsonb) id`, [po, J({ distributor_id: dist }), J([{ medicine_id: med, qty: 1 }])]);
ok('partly received order cannot be edited', /nothing received/.test(r.error || ''), r.error);
const st = (await q(db, `select qty from medicine_batches where batch_no='D1'`))[0];
ok('stock added by confirm_purchase_v2: (12 + 1) × 10 = 130', +st.qty === 130, J(st));
r = await as(IDS.inventory, `select confirm_purchase_v3($1::jsonb,$2::jsonb,null,null,$3) id`, [J({ ...header, distributor_id: dist, invoice_no: 'KP-2' }), J([{ medicine_id: med2, batch_no: 'P1', expiry: '2028-01-31', qty: 5, pack: 15, price: 100, tax_rate: 12, discount: 0, mrp: 2250 }]), po]);
r = await as(IDS.inventory, `select status, bills from purchase_order_list() where id=$1`, [po]);
ok('second bill completes the order (status received, 2 bills linked)', r.rows?.[0]?.status === 'received' && r.rows[0].bills.length === 2, J(r.rows));
r = await as(IDS.inventory, `select confirm_purchase_v3($1::jsonb,$2::jsonb,null,null,$3) id`, [J({ ...header, distributor_id: dist, invoice_no: 'KP-3' }), J(items.map(i => ({ ...i, batch_no: 'D2' }))), po]);
ok('received order cannot be received again', /received/.test(r.error || ''), r.error);
r = await as(IDS.inventory, `select confirm_purchase_v3($1::jsonb,$2::jsonb,null,null,null) id`, [J({ ...header, distributor_id: dist, invoice_no: 'KP-4' }), J(items.map(i => ({ ...i, batch_no: 'D3' })))]);
ok('confirm_purchase_v3 without an order is a plain purchase', !r.error, r.error);

// --- cancel / close
r = await as(IDS.inventory, `select purchase_order_cancel($1,'x')`, [po2]);
ok('cancel needs a reason', !!r.error);
r = await as(IDS.inventory, `select purchase_order_cancel($1,'Supplier out of stock') s`, [po2]);
ok('open order cancelled', r.rows?.[0]?.s === 'cancelled', J(r));
r = await as(IDS.inventory, `select purchase_order_cancel($1,'again')`, [po2]);
ok('cancelled order cannot be cancelled again', !!r.error);

// --- purchase_list_v2
await asOwner(db);
await q(db, `select set_config('request.jwt.claim.sub', $1, false)`, [IDS.superAdmin]);
r = await as(IDS.superAdmin, `select * from purchase_list_v2(null,null,100)`);
const kp1 = r.rows?.find(x => x.supplier_invoice_no === 'KP-1');
ok('admin list: KP-1 with 1 line, 13 packs, 130 units, total, order PO-202611-0001', kp1 && kp1.line_count === 1 && +kp1.pack_qty === 13 && +kp1.stock_units === 130 && +kp1.total > 0 && kp1.order_no === 'PO-202611-0001' && +kp1.paid === 0, J(kp1));
r = await as(IDS.inventory, `select * from purchase_list_v2(null,null,100)`);
const kp1s = r.rows?.find(x => x.supplier_invoice_no === 'KP-1');
ok('staff list: same bills, money hidden', r.rows?.length === 3 && kp1s && kp1s.total == null && kp1s.paid == null, J(kp1s));
r = await as(IDS.inventory, `select * from purchase_list_v2('2026-11-19','2026-11-30',100)`);
ok('date filter', r.rows?.length === 0, J(r));
r = await as(IDS.billing, `select * from purchase_list_v2(null,null,100)`);
ok('billing staff cannot list purchases', !!r.error);
const inv = (await q(db, `select purchase_order_id from purchase_invoices where id=$1`, [inv1]))[0];
ok('invoice linked to its order', inv.purchase_order_id === po);
ok('audit rows for order create / receive / cancel', (await q(db, `select count(*)::int n from audit_logs where entity_type='purchase_order'`))[0].n >= 5);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
