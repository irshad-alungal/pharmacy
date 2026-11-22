// Migration 0034 on the live-schema replica: unified activity (audit entries + logins / logouts), module / kind /
// critical classification, details text, overview, filters, paging, user report, login history, export log,
// settings, IP capture and access rules.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture, IDS as I, asUser, asOwner, q } from './fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const mig = n => fs.readFileSync(path.join(HERE, '../../database/migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : '  → ' + String(x).slice(0, 500)}`); };
const one = async (sql, p) => (await q(db, sql, p))[0];
const db = await makeFixture();
await db.exec(mig('0021_complete_backend_and_live_fixes.sql'));
await db.exec(mig('0034_audit_logs.sql'));
try { await db.exec(mig('0034_audit_logs.sql')); ok('0034 runs a second time', true); } catch (e) { ok('0034 runs a second time', false, e.message); }
await asOwner(db);
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
const today = (await one(`select (now() at time zone 'Asia/Kolkata')::date::text d`)).d;
const ins = (u, action, ent, id, after, before = null, reason = null, ago = '0') => q(db, `insert into audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,before_data,reason,at) values ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 || ' minutes')::interval)`,
  [I.branch, u, action, ent, id, after && JSON.stringify(after), before && JSON.stringify(before), reason, ago]);
await ins(I.admin, 'sale_finalized', 'sales_invoice', 'x1', { invoice_no: 'INV-01456', total: 1280 }, null, null, '1');
await ins(I.inventory, 'stock_adjusted', 'medicine_batch', 'b1', { name: 'Paracetamol 500 mg', qty: 1182 }, { qty: 1200 }, 'Count', '2');
await ins(I.admin, 'sales_return_created', 'sales_return', 'r1', { return_no: 'RET-0067', total: 120 }, null, null, '3');
await ins(I.pharmacist, 'medicine_updated', 'medicine', 'm1', { name: 'Amoxicillin 500 mg', mrp: 98 }, { mrp: 95 }, null, '4');
await ins(I.superAdmin, 'settings_saved', 'settings', 'general', { low_stock_alerts: true }, null, null, '5');
await ins(I.admin, 'purchase_document_removed', 'purchase_document', 'd1', null, { file_name: 'bill.pdf' }, 'Wrong file', '6');
await ins(I.admin, 'billing_settings_changed', 'settings', 'billing', { max_discount_pct: 20 }, null, null, '7');
await ins(I.admin, 'sale_finalized', 'sales_invoice', 'old', { invoice_no: 'INV-OLD', total: 50 }, null, null, String(60 * 24 * 10));
// a branch-2 entry that must not show
await q(db, `insert into branches(id,pharmacy_id,code,name,invoice_prefix) values ('0b000000-0000-0000-0000-000000000002',$1,'T2','Town','T')`, [I.pharmacy]);
await q(db, `insert into audit_logs(branch_id,user_id,action,entity_type) values ('0b000000-0000-0000-0000-000000000002',$1,'sale_finalized','sales_invoice')`, [I.admin]);
await q(db, `update work_sessions set logout_at = now(), logout_reason = 'idle' where user_id = $1`, [I.billing]);
await q(db, `insert into login_attempts(staff_id, portal, success, reason) values ('ADM001','admin',true,null),('BAD01','staff',false,'Invalid credentials')`);

let r = await as(I.admin, `select audit_list($1::date, $1::date, null, null, null, null, false, 100, 0) r`, [today]);
const L = r.rows?.[0]?.r || {};
ok('list today: 7 entries + 6 logins + 1 logout, other branch and old excluded', L.total === 14, r.error || L.total);
const by = a => L.rows.find(x => x.action === a);
ok('sale: Sales / created / details with amount', by('sale_finalized')?.module === 'Sales' && by('sale_finalized').kind === 'created' && /INV-01456 \(₹1,280\.00\)/.test(by('sale_finalized').details), JSON.stringify(by('sale_finalized')));
ok('stock adjust: Inventory / updated', by('stock_adjusted')?.module === 'Inventory' && by('stock_adjusted').kind === 'updated' && /Paracetamol/.test(by('stock_adjusted').details));
ok('return: Returns / created', by('sales_return_created')?.module === 'Returns' && by('sales_return_created').kind === 'created');
ok('medicine: Medicines / updated', by('medicine_updated')?.module === 'Medicines' && by('medicine_updated').kind === 'updated');
ok('settings: Settings / critical', by('settings_saved')?.module === 'Settings' && by('settings_saved').critical === true);
ok('removed document: Documents / deleted / critical with reason', by('purchase_document_removed')?.module === 'Documents' && by('purchase_document_removed').kind === 'deleted' && by('purchase_document_removed').critical && /bill\.pdf — Wrong file/.test(by('purchase_document_removed').details), JSON.stringify(by('purchase_document_removed')));
ok('billing settings → Settings module', by('billing_settings_changed')?.module === 'Settings');
const lo = L.rows.find(x => x.kind === 'logout');
ok('logout row from work session (reason)', lo && lo.module === 'System' && /idle/.test(lo.details) && lo.user_name === 'billing user', JSON.stringify(lo));
ok('login rows with user names', L.rows.filter(x => x.kind === 'login').length === 6 && L.rows.find(x => x.kind === 'login').details === 'User logged in');
ok('newest first', L.rows[0].at >= L.rows[1].at);

r = await as(I.admin, `select audit_list(null, null, null, null, null, null, false, 100, 0) r`);
ok('all time includes the old entry', r.rows[0].r.total === 15);
r = await as(I.admin, `select audit_list($1::date, null, 'paracetamol', null, null, null, false, 100, 0) r`, [today]);
ok('search in details / data', r.rows[0].r.total === 1);
r = await as(I.admin, `select audit_list($1::date, null, null, $2, null, null, false, 100, 0) r`, [today, I.admin]);
ok('filter by user', r.rows[0].r.total === 5, r.rows[0].r.total);
r = await as(I.admin, `select audit_list($1::date, null, null, null, 'Sales', null, false, 100, 0) r`, [today]);
ok('filter by module', r.rows[0].r.total === 1);
r = await as(I.admin, `select audit_list($1::date, null, null, null, null, 'deleted', false, 100, 0) r`, [today]);
ok('filter by action type', r.rows[0].r.total === 1);
r = await as(I.admin, `select audit_list($1::date, null, null, null, null, null, true, 100, 0) r`, [today]);
ok('critical only', r.rows[0].r.total === 3, r.rows[0].r.total);
r = await as(I.admin, `select audit_list($1::date, null, null, null, null, null, false, 5, 5) r`, [today]);
ok('paging', r.rows[0].r.total === 14 && r.rows[0].r.rows.length === 5);

r = await as(I.admin, `select audit_overview($1::date, $1::date) o`, [today]);
const o = r.rows?.[0]?.o || {};
ok('overview: totals, active users, critical, login events', o.total === 14 && o.active_users === 6 && o.critical === 3 && o.login_events === 7 && o.logins === 6 && o.logouts === 1, r.error || JSON.stringify(o).slice(0, 400));
ok('overview: previous period and failed logins', o.previous_total === 0 && o.failed_logins === 1, `${o.previous_total} ${o.failed_logins}`);
ok('overview: modules add up', o.modules.reduce((a, m) => a + m.count, 0) === 14 && o.modules[0].module === 'System');
ok('overview: recent critical newest first', o.critical_recent.length === 3 && o.critical_recent[0].action === 'settings_saved');
ok('overview: users who did something', o.users.length === 6 && o.all_users.length === 6);

r = await as(I.admin, `select * from audit_user_report($1::date, $1::date)`, [today]);
const ad = r.rows?.find(x => x.user_id === I.admin);
ok('user report: per user counts', ad && +ad.total === 5 && +ad.created === 2 && +ad.deleted === 1 && +ad.critical === 2 && +ad.logins === 1 && ad.top_module, r.error || JSON.stringify(ad));

r = await as(I.admin, `select audit_login_history($1::date, $1::date, 50) h`, [today]);
const h = r.rows?.[0]?.h || {};
ok('login history: sessions and attempts', h.sessions?.length === 6 && h.attempts?.length === 2 && h.attempts.find(a => a.staff_id === 'BAD01').known === false && h.attempts.find(a => a.staff_id === 'ADM001').known === true, r.error || JSON.stringify(h).slice(0, 300));

r = await as(I.admin, `select audit_log_export('csv', 14, '{"range":"today"}'::jsonb)`);
ok('export is itself audited (Reports / exported)', !r.error && (await as(I.admin, `select audit_list($1::date, null, null, null, 'Reports', 'exported', false, 10, 0) r`, [today])).rows[0].r.total === 1, r.error);
r = await as(I.admin, `select audit_log_export('xls', 1, null)`); ok('export format validated', /Invalid export format/.test(r.error || ''), r.error);

r = await as(I.admin, `select audit_settings_get() s`); ok('settings defaults', r.rows?.[0]?.s.page_size === 10 && r.rows[0].s.default_range === '7d');
r = await as(I.admin, `select audit_settings_save('{"page_size":25,"default_range":"30d","alert_critical":false}'::jsonb) s`);
ok('settings saved', r.rows?.[0]?.s.page_size === 25 && (await as(I.admin, `select audit_settings_get() s`)).rows[0].s.alert_critical === false, r.error);
r = await as(I.admin, `select audit_settings_save('{"page_size":7}'::jsonb)`); ok('page size validated', /10, 25, 50 or 100/.test(r.error || ''), r.error);

for (const u of [I.pharmacist, I.billing, I.inventory]) {
  r = await as(u, `select audit_overview(null, null)`);
  if (!/Not authorised/.test(r.error || '')) { ok('staff cannot read audit logs', false, r.error); break; }
}
ok('staff cannot read audit logs', true);
r = await as(null, `select audit_list()`); ok('anonymous refused', !!r.error);

// IP capture from request headers
await asUser(db, I.admin);
await db.exec(`select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9, 10.0.0.1"}', false)`);
await q(db, `select audit_log_export('print', 1, '{}'::jsonb)`);
await db.exec(`select set_config('request.headers', '', false)`);
await asOwner(db);
ok('IP saved from X-Forwarded-For on new entries', (await one(`select host(ip) ip from audit_logs where entity_id='print'`)).ip === '203.0.113.9');
r = await as(I.admin, `select audit_list(null, null, '203.0.113.9', null, null, null, false, 10, 0) r`);
ok('IP searchable and listed', r.rows[0].r.total === 1 && r.rows[0].r.rows[0].ip === '203.0.113.9');
let blocked = false; try { await q(db, `update audit_logs set reason='x' where id = (select min(id) from audit_logs)`); } catch { blocked = true; }
ok('audit entries stay append-only', blocked);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
