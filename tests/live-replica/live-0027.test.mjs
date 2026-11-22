// Migration 0027 on the live-schema replica: reason codes, exchange, return lists, top medicines,
// return rate base, return detail and expiry candidates — through the real sale / return functions.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture, IDS as I, asUser, asOwner, q } from './fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const mig = n => fs.readFileSync(path.join(HERE, '../../database/migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : '  → ' + String(x).slice(0, 300)}`); };
const one = async (sql, p) => (await q(db, sql, p))[0];
const db = await makeFixture();
await db.exec(mig('0021_complete_backend_and_live_fixes.sql'));
await asOwner(db);
const dist = (await one(`insert into distributors(branch_id,name,phone) values ($1,'Dist A','9847000500') returning id`, [I.branch])).id;
const med = (await one(`insert into medicines(branch_id,name,strength,mrp,selling_price,tax_rate) values ($1,'Dolo','650 mg',30,30,12) returning id`, [I.branch])).id;
const today = (await one(`select (now() at time zone 'Asia/Kolkata')::date::text d`)).d;
const soon = (await one(`select ((now() at time zone 'Asia/Kolkata')::date + 20)::text d`)).d;
await asUser(db, I.superAdmin);
const pv = (await one(`select confirm_purchase_v2($1::jsonb,$2::jsonb,null,null) id`, [JSON.stringify({ distributor_id: dist, invoice_no: 'PB-1', invoice_date: today, discount: 0, freight: 0, round_off: 0 }),
  JSON.stringify([{ medicine_id: med, batch_no: 'X1', expiry: soon, qty: 3, pack: 10, price: 150, tax_rate: 12, discount: 0, mrp: 300 }])])).id;
const sell = async (cart, qty) => {
  await asUser(db, I.billing);
  const a = (await one(`select billing_allocate($1,$2,$3) a`, [cart, med, qty])).a;
  let t = 0; for (const r of a.rows) t += +(await one(`select total_amount from billing_calc_line($1,$2,$3,$4,$5)`, [r.mrp, r.qty, r.default_discount_pct, r.tax_rate, r.price_includes_tax])).total_amount;
  return (await one(`select finalize_sale_v3(null,$1::jsonb,$3::jsonb,0,$2,null,null) id`, [JSON.stringify(a.rows.map(r => ({ batch_id: r.batch_id, qty: r.qty }))), cart, JSON.stringify([{ method: 'cash', amount: Math.round(t * 100) / 100 }])])).id;
};
const inv1 = await sell('11111111-0000-0000-0000-0000000000b1', 4);
const inv2 = await sell('11111111-0000-0000-0000-0000000000b2', 3);
const item = async inv => (await one(`select id from sales_items where invoice_id=$1`, [inv])).id;
// a return recorded before the migration
await q(db, `select process_sales_return($1,$2::jsonb,'cash','Expired strip given by mistake')`, [inv1, JSON.stringify([{ sales_item_id: await item(inv1), qty: 1, disposition: 'damaged' }])]);
await asOwner(db);
await db.exec(mig('0027_returns_management.sql'));
try { await db.exec(mig('0027_returns_management.sql')); ok('0027 runs a second time', true); } catch (e) { ok('0027 runs a second time', false, e.message); }
await asOwner(db);
let r0 = await one(`select reason_code, refund_type from sales_returns`);
ok('existing return gets reason code from its text (expired) and type refund', r0.reason_code === 'expired' && r0.refund_type === 'refund', JSON.stringify(r0));

const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
let r = await as(I.billing, `select process_sales_return_v2($1,$2::jsonb,'upi','Patient got rash','adverse_reaction','exchange') id`, [inv2, JSON.stringify([{ sales_item_id: await item(inv2), qty: 2, disposition: 'restock' }])]);
ok('billing staff: process_sales_return_v2 with reason code and exchange', !r.error && r.rows[0].id, r.error);
const ret2 = r.rows?.[0]?.id;
r0 = await one(`select reason_code, refund_type, refund_method, total from sales_returns where id=$1`, [ret2]);
ok('saved: adverse_reaction, exchange, UPI, value > 0', r0.reason_code === 'adverse_reaction' && r0.refund_type === 'exchange' && r0.refund_method === 'upi' && +r0.total > 0, JSON.stringify(r0));
ok('finance posted once for the return', (await q(db, `select 1 from financial_ledger where ref_type='sales_return' and ref_id=$1 and account='sales_returns'`, [ret2])).length === 1);
ok('restocked: batch stock back up', +(await one(`select qty from medicine_batches where batch_no='X1'`)).qty === 30 - 7 + 2);
r = await as(I.billing, `select process_sales_return_v2($1,$2::jsonb,'cash','x','bogus','refund')`, [inv2, JSON.stringify([{ sales_item_id: await item(inv2), qty: 1 }])]);
ok('unknown reason code refused', /reason/.test(r.error || ''), r.error);
r = await as(I.billing, `select process_sales_return_v2($1,$2::jsonb,'cash','x','other','store_credit')`, [inv2, JSON.stringify([{ sales_item_id: await item(inv2), qty: 1 }])]);
ok('unknown refund type refused', /Refund type/.test(r.error || ''), r.error);

r = await as(I.pharmacist, `select * from sales_returns_list($1::date, $1::date)`, [today]);
const L = r.rows || [];
const x = L.find(z => z.id === ret2) || {};
ok('sales_returns_list: 2 returns with invoice, items, qty, type, reason, medicines', L.length === 2 && x.invoice_no && x.items === 1 && +x.qty === 2 && x.refund_type === 'exchange' && x.reason_code === 'adverse_reaction' && x.medicines.includes('Dolo 650 mg') && +x.restocked === +x.total, r.error || JSON.stringify(x));
ok('sales_returns_list: damaged value on the first return', L.some(z => +z.damaged > 0), JSON.stringify(L));
r = await as(I.billing, `select * from returns_top_medicines('sales',$1::date,$1::date,5)`, [today]);
ok('returns_top_medicines: Dolo 3 units', r.rows?.[0]?.name === 'Dolo' && +r.rows[0].qty === 3 && r.rows[0].returns === 2, r.error || JSON.stringify(r.rows));
r = await as(I.billing, `select returns_base_total('sales',$1::date,$1::date) v`, [today]);
const sales = +(await one(`select sum(total) s from sales_invoices where status='final'`)).s;
ok('returns_base_total sales = final bills', +r.rows?.[0]?.v === sales, r.error || JSON.stringify(r.rows));
r = await as(I.billing, `select return_detail('sales',$1) d`, [ret2]);
const d = r.rows?.[0]?.d || {};
ok('return_detail sales: note, invoice, items, shop for the credit note', d.note?.return_no && d.invoice_no && d.items?.length === 1 && d.items[0].batch_no === 'X1' && d.shop?.name, r.error || JSON.stringify(d));

r = await as(I.superAdmin, `select * from expiry_return_candidates(30)`);
const c = r.rows?.[0] || {};
ok('expiry_return_candidates: batch X1 (expires in 20 days) from PB-1 / Dist A, returnable whole packs', c.batch_no === 'X1' && c.supplier_invoice_no === 'PB-1' && c.distributor_name === 'Dist A' && +c.returnable === 2, r.error || JSON.stringify(r.rows));
r = await as(I.superAdmin, `select * from expiry_return_candidates(5)`);
ok('expiry_return_candidates respects the day window', r.rows?.length === 0, JSON.stringify(r.rows));
r = await as(I.superAdmin, `select process_purchase_return_v2($1,$2::jsonb,'Near expiry, distributor will credit','expired') id`, [pv, JSON.stringify([{ purchase_item_id: c.purchase_item_id, qty: 1 }])]);
ok('admin: process_purchase_return_v2 with reason code', !r.error && r.rows[0].id, r.error);
const pr = r.rows?.[0]?.id;
r0 = await one(`select reason_code, total_value from purchase_returns where id=$1`, [pr]);
ok('saved: expired, value 168 (1 strip ₹150 + 12% GST)', r0.reason_code === 'expired' && +r0.total_value === 168, JSON.stringify(r0));
r = await as(I.superAdmin, `select * from purchase_returns_list($1::date,$1::date)`, [today]);
const p = r.rows?.[0] || {};
ok('purchase_returns_list: distributor, supplier invoice, items, value, reason', p.distributor_name === 'Dist A' && p.supplier_invoice_no === 'PB-1' && p.items === 1 && +p.total === 168 && p.reason_code === 'expired' && p.medicines.includes('Dolo'), r.error || JSON.stringify(p));
r = await as(I.superAdmin, `select return_detail('purchase',$1) d`, [pr]);
ok('return_detail purchase: distributor and items', r.rows?.[0]?.d?.distributor?.name === 'Dist A' && r.rows[0].d.items.length === 1, r.error);
r = await as(I.superAdmin, `select returns_base_total('purchase',$1::date,$1::date) v`, [today]);
ok('returns_base_total purchase = purchase invoices today', +r.rows?.[0]?.v === +(await one(`select total from purchase_invoices where id=$1`, [pv])).total, r.error);
r = await as(I.superAdmin, `select * from returns_top_medicines('purchase',$1::date,$1::date,5)`, [today]);
ok('returns_top_medicines purchase', r.rows?.[0]?.name === 'Dolo' && +r.rows[0].value === 168, r.error || JSON.stringify(r.rows));
r = await as(I.billing, `select * from purchase_returns_list($1::date,$1::date)`, [today]);
ok('billing staff cannot read purchase returns', /Not authorised/.test(r.error || ''), r.error);
r = await as(I.inventory, `select * from sales_returns_list($1::date,$1::date)`, [today]);
ok('inventory staff cannot read sales returns', /Not authorised/.test(r.error || ''), r.error);
r = await as(I.billing, `select process_purchase_return_v2($1,$2::jsonb,'x','expired')`, [pv, JSON.stringify([{ purchase_item_id: c.purchase_item_id, qty: 1 }])]);
ok('billing staff cannot create a purchase return', !!r.error, r.error);
await q(db, `insert into branches(id,pharmacy_id,code,name,invoice_prefix) values ('0b000000-0000-0000-0000-000000000002',$1,'B2','Other','B2X')`, [I.pharmacy]);
await q(db, `update profiles set branch_id='0b000000-0000-0000-0000-000000000002' where id=$1`, [I.pharmacist]);
r = await as(I.pharmacist, `select * from sales_returns_list($1::date,$1::date)`, [today]);
ok('another branch sees none of these returns', r.rows?.length === 0, r.error || JSON.stringify(r.rows));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
