// Migration 0025 on the live-schema replica: customer numbers, loyalty, customer_stats.
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
await asOwner(db);
// customers that exist before the migration
for (const [n, ph] of [['Old One', '9847000101'], ['Old Two', '9847000102']]) await q(db, `insert into customers(branch_id,name,phone) values ($1,$2,$3)`, [IDS.branch, n, ph]);
await db.exec(mig('0025_customers_management.sql'));
try { await db.exec(mig('0025_customers_management.sql')); ok('0025 runs a second time', true); } catch (e) { ok('0025 runs a second time', false, e.message); }
await asOwner(db);
const nos = await q(db, `select name, customer_no from customers order by customer_no`);
ok('existing customers back-filled CUS-00001, CUS-00002 in creation order', nos[0].name === 'Old One' && nos[0].customer_no === 'CUS-00001' && nos[1].customer_no === 'CUS-00002', JSON.stringify(nos));
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
let r = await as(IDS.billing, `insert into customers(branch_id,name,phone,loyalty_member,dob,notes) values ($1,'Ravi','9847000103',true,'1990-05-04','Diabetic, prefers Glycomet') returning customer_no, loyalty_joined_at, dob, notes, phone`, [IDS.branch]);
ok('new customer (billing staff) gets CUS-00003, loyalty date, dob and notes', !r.error && r.rows[0].customer_no === 'CUS-00003' && r.rows[0].loyalty_joined_at && r.rows[0].notes, r.error || JSON.stringify(r.rows));
const ravi = (await q(db, `select id from customers where name='Ravi'`))[0].id;
r = await as(IDS.billing, `update customers set customer_no='CUS-99999', name='Ravi K' where id=$1 returning customer_no`, [ravi]);
ok('customer ID cannot be changed', !r.error && r.rows[0]?.customer_no === 'CUS-00003', r.error || JSON.stringify(r.rows));
r = await as(IDS.billing, `update customers set loyalty_member=false where id=$1 returning loyalty_joined_at`, [ravi]);
ok('leaving loyalty clears the joined date', !r.error && r.rows[0].loyalty_joined_at === null, r.error);
// sales for stats
await q(db, `insert into sales_invoices(branch_id,invoice_no,customer_id,total,subtotal,status,created_by,created_at) values ($1,'T-1',$2,500,500,'final',$3,now() - interval '2 days'),($1,'T-2',$2,300,300,'final',$3,now() - interval '400 days'),($1,'T-3',$2,999,999,'cancelled',$3,now())`, [IDS.branch, ravi, IDS.superAdmin]);
const inv = (await q(db, `select id from sales_invoices where total=500 and customer_id='${ravi}'`))[0].id;
await q(db, `insert into payments(branch_id,invoice_id,method,amount) values ($1,$2,'credit',200)`, [IDS.branch, inv]).catch(e => console.warn('payment', e.message));
r = await as(IDS.billing, `select * from customer_stats() where customer_id=$1`, [ravi]);
const s = r.rows?.[0];
ok('customer_stats: 2 final bills, spent 800, 12-month 500, first/last bill', s && s.bills === 2 && +s.spent === 800 && +s.spent_12m === 500 && s.first_bill && s.last_bill, r.error || JSON.stringify(s));
ok('customer_stats: credit outstanding 200', s && +s.outstanding === 200, JSON.stringify(s));
r = await as(IDS.billing, `select count(*)::int n from customer_stats()`);
ok('customer_stats lists every customer of the branch', r.rows?.[0]?.n === 3, JSON.stringify(r));
r = await as(IDS.inventory, `select * from customer_stats()`);
ok('inventory staff cannot read customer statistics', !!r.error);
r = await as(IDS.billing, `insert into customers(branch_id,name,phone) values ($1,'Second','9847000104') returning customer_no`, [IDS.branch]);
ok('numbering continues after the highest ID (CUS-00004)', r.rows?.[0]?.customer_no === 'CUS-00004', r.error || JSON.stringify(r.rows));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
