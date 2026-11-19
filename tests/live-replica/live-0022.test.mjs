// Migration 0022 on the live-schema replica: applies cleanly twice, keeps old RPCs, enforces roles.
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
await db.exec(mig('0022_delivery_management_v2.sql'));
try { await db.exec(mig('0022_delivery_management_v2.sql')); ok('0022 runs a second time without error', true); } catch (e) { ok('0022 runs a second time without error', false, e.message); }
const fns = (await q(db, `select proname from pg_proc where proname in ('delivery_management_list','delivery_my_jobs','delivery_set_request','delivery_assign','delivery_update_status','delivery_management_list_v2','delivery_my_jobs_v2','delivery_update_status_v2','delivery_report_issue','delivery_set_details','delivery_settings_set')`)).map(r => r.proname);
ok('old and new delivery functions all exist', fns.length === 11, fns.join(','));
const chk = (await q(db, `select pg_get_constraintdef(oid) d from pg_constraint where conname='delivery_jobs_status_check'`))[0].d;
ok('status check allows failed', chk.includes('failed'), chk);
// a bill to deliver
await asOwner(db);
const unit = (await q(db, `insert into units(name,code) values ('Tab','TB') returning id`))[0].id;
const med = (await q(db, `insert into medicines(branch_id,name,mrp,selling_price,tax_rate,base_unit_id) values ($1,'X',10,10,12,$2) returning id`, [IDS.branch, unit]))[0].id;
const inv = (await q(db, `insert into sales_invoices(branch_id,invoice_no,total,subtotal,status,created_by) values ($1,'T-1',100,100,'final',$2) returning id`, [IDS.branch, IDS.superAdmin]))[0].id;
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
let r = await as(IDS.billing, `select delivery_set_request($1,true)`, [inv]); ok('billing staff can request a delivery', !r.error, r.error);
r = await as(IDS.billing, `select delivery_settings_set(50)`); ok('billing staff cannot set the delivery fee', !!r.error);
r = await as(IDS.superAdmin, `select delivery_settings_set(50)`); ok('admin sets the delivery fee', !r.error, r.error);
r = await as(IDS.inventory, `select delivery_management_list_v2(30)`); ok('inventory staff cannot read the delivery list', !!r.error);
r = await as(IDS.billing, `select delivery_assign($1,$2)`, [inv, IDS.delivery]); ok('assign works', !r.error, r.error);
r = await as(IDS.billing, `select delivery_update_status_v2($1,'out')`, [inv]); ok('staff cannot update rider status', !!r.error);
r = await as(IDS.delivery, `select delivery_update_status($1,'out')`, [inv]); ok('old delivery_update_status still works (and is time-stamped)', !r.error, r.error);
r = await as(IDS.delivery, `select delivery_update_status_v2($1,'failed','')`, [inv]); ok('failed needs a reason', !!r.error);
r = await as(IDS.delivery, `select delivery_update_status_v2($1,'done')`, [inv]); ok('rider marks delivered', !r.error, r.error);
const j = (await q(db, `select status,out_at,delivered_at,fee_earned from delivery_jobs where invoice_id=$1`, [inv]))[0];
ok('times and fee recorded', j.status === 'done' && j.out_at && j.delivered_at && Number(j.fee_earned) === 50, JSON.stringify(j));
r = await as(IDS.delivery, `select delivery_my_jobs_v2()`); ok('rider list v2', !r.error && r.rows[0].delivery_my_jobs_v2.jobs.length === 1, r.error);
r = await as(IDS.billing, `select delivery_management_list()`); ok('old management list still works', !r.error, r.error);
console.log(`\n${pass} passed, ${fail} failed`);
