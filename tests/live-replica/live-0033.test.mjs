// Migration 0033 on the live-schema replica: settings sections (defaults, save, validation, reset),
// billing rules, branding, system info, backup export / list, restore (settings, branch, masters), roles.
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
await db.exec(mig('0033_settings_management.sql'));
try { await db.exec(mig('0033_settings_management.sql')); ok('0033 runs a second time', true); } catch (e) { ok('0033 runs a second time', false, e.message); }
await asOwner(db);
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
const get = async u => { const r = await as(u, `select settings_get() s`); return r.error ? { error: r.error } : r.rows[0].s; };
const save = (u, sec, v) => as(u, `select settings_save($1, $2::jsonb) s`, [sec, JSON.stringify(v)]);

let s = await get(I.billing);
ok('everyone signed in can read settings (defaults)', s.general?.date_format === 'DD MMM YYYY' && s.payments.default_method === 'cash' && s.payments.enabled.length === 6 && s.is_admin === false, s.error || JSON.stringify(s).slice(0, 300));
ok('billing rules default when no row', +s.billing.max_discount_pct === 30 && s.billing.near_expiry_days === 90);
ok('branding from pharmacy and branch', s.branding.pharmacy_name === 'PALLIKKAL MEDICALS' && s.branding.branch_code === 'MAIN');
let r = await save(I.billing, 'general', { auto_backup: true });
ok('staff cannot change settings', /only Admin/.test(r.error || ''), r.error);

r = await save(I.admin, 'general', { date_format: 'DD/MM/YYYY', time_format: '24h', low_stock_alerts: false, auto_backup: true, bogus: 1 });
s = r.rows?.[0]?.s || {};
ok('admin saves general (unknown keys dropped, others default)', s.general?.date_format === 'DD/MM/YYYY' && s.general.time_format === '24h' && s.general.low_stock_alerts === false && s.general.expiry_alerts === true && !('bogus' in s.general), r.error || JSON.stringify(s.general));
ok('updated by / at recorded', s.updated?.general?.by === 'admin user');
r = await save(I.admin, 'general', { date_format: 'YYYY.MM.DD' }); ok('unknown date format refused', /date format/.test(r.error || ''), r.error);
r = await save(I.admin, 'general', { currency: 'USD' }); ok('only INR', /Indian Rupee/.test(r.error || ''), r.error);
r = await save(I.admin, 'general', { low_stock_alerts: 'yes' }); ok('wrong type refused', /Invalid value/.test(r.error || ''), r.error);
r = await save(I.admin, 'payments', { enabled: ['cash', 'upi'], default_method: 'upi', upi_id: 'pallikkal@okaxis', upi_name: 'Pallikkal Pharmacy' });
ok('payments saved', r.rows?.[0]?.s.payments.enabled.join() === 'cash,upi' && r.rows[0].s.payments.upi_id === 'pallikkal@okaxis', r.error);
r = await save(I.admin, 'payments', { enabled: [], default_method: 'cash' }); ok('at least one method', /at least one/.test(r.error || ''), r.error);
r = await save(I.admin, 'payments', { enabled: ['cash'], default_method: 'card' }); ok('default must be switched on', /default method/.test(r.error || ''), r.error);
r = await save(I.admin, 'payments', { enabled: ['cash', 'credit'], default_method: 'credit' }); ok('credit cannot be default', /default method/.test(r.error || ''), r.error);
r = await save(I.admin, 'payments', { enabled: ['cash', 'bitcoin'], default_method: 'cash' }); ok('unknown method refused', /Unknown payment method/.test(r.error || ''), r.error);
r = await save(I.admin, 'payments', { enabled: ['cash'], default_method: 'cash', upi_id: 'not-a-upi' }); ok('UPI ID validated', /valid UPI/.test(r.error || ''), r.error);
r = await save(I.admin, 'invoice', { default_format: 'a4', terms: 'Goods once sold cannot be taken back.', show_upi: true });
ok('invoice saved', r.rows?.[0]?.s.invoice.default_format === 'a4' && r.rows[0].s.invoice.show_gstin === true, r.error);
r = await save(I.admin, 'invoice', { default_format: 'a5' }); ok('paper validated', /Thermal 80mm or A4/.test(r.error || ''), r.error);
r = await save(I.admin, 'notifications', { expiry_days: 60.4 }); ok('notifications saved (rounded)', r.rows?.[0]?.s.notifications.expiry_days === 60, r.error);
r = await save(I.admin, 'notifications', { expiry_days: 3 }); ok('expiry window validated', /7 to 365/.test(r.error || ''), r.error);
r = await save(I.admin, 'license', { type: 'Enterprise' }); ok('licence is Super Admin only', /Only Super Admin/.test(r.error || ''), r.error);
r = await save(I.superAdmin, 'license', { type: 'Professional', valid_to: '2027-12-31', licensed_to: 'Pallikkal Pharmacy' });
ok('super admin saves licence', r.rows?.[0]?.s.license.valid_to === '2027-12-31', r.error);
r = await save(I.admin, 'support', { phone: '123' }); ok('support phone validated', /support phone/.test(r.error || ''), r.error);
r = await save(I.admin, 'support', { name: 'IT Desk', phone: '+91 98470 00000', email: 'help@example.com', website: 'https://example.com' });
ok('support contact saved', r.rows?.[0]?.s.support.email === 'help@example.com', r.error);
r = await save(I.admin, 'nonsense', {}); ok('unknown section refused', /Unknown settings section/.test(r.error || ''), r.error);
ok('audit written for settings', (await one(`select count(*)::int n from audit_logs where action='settings_saved'`)).n >= 6);

// reset
r = await as(I.admin, `select settings_reset('general') s`);
ok('reset general to defaults', r.rows?.[0]?.s.general.date_format === 'DD MMM YYYY' && !(await q(db, `select 1 from pharmacy_settings where key='general'`)).length, r.error);
r = await as(I.admin, `select settings_reset('license')`); ok('admin cannot reset licence', /Only Super Admin/.test(r.error || ''), r.error);

// billing rules
r = await as(I.admin, `select settings_save_billing(20, 10, 120) s`);
ok('billing rules saved', +r.rows?.[0]?.s.billing.max_discount_pct === 20 && r.rows[0].s.billing.near_expiry_days === 120, r.error);
r = await as(I.admin, `select settings_save_billing(120, 10, 120)`); ok('discount validated', /between 0 and 100/.test(r.error || ''), r.error);
r = await as(I.pharmacist, `select settings_save_billing(10, 10, 10)`); ok('pharmacist cannot change billing rules', /only Admin/.test(r.error || ''), r.error);
r = await as(I.admin, `select settings_reset('billing') s`); ok('reset billing rules', +r.rows?.[0]?.s.billing.max_discount_pct === 30, r.error);

// branding
const logo = `${I.branch}/logo.png`;
r = await as(I.admin, `insert into storage.objects(bucket_id,name,owner) values ('pharmacy-branding',$1,auth.uid())`, [logo]);
ok('admin uploads logo into branch folder', !r.error, r.error);
r = await as(I.pharmacist, `insert into storage.objects(bucket_id,name,owner) values ('pharmacy-branding',$1,auth.uid())`, [`${I.branch}/x.png`]);
ok('pharmacist cannot upload logo', !!r.error);
r = await as(I.admin, `select settings_save_branding('Your health, our care', $1) s`, [logo]);
ok('branding saved', r.rows?.[0]?.s.branding.logo_path === logo && r.rows[0].s.branding.tagline === 'Your health, our care', r.error);
r = await as(I.admin, `select settings_save_branding('', 'other/logo.png')`); ok('logo path must be this branch', /this branch/.test(r.error || ''), r.error);
r = await as(I.admin, `select settings_save_branding('', $1)`, [`${I.branch}/missing.png`]); ok('logo must exist', /not found/.test(r.error || ''), r.error);

// system info
r = await as(I.admin, `select settings_system_info() s`);
let si = r.rows?.[0]?.s || {};
ok('system info: counts, db size, no backup yet', si.counts && si.counts.staff === 6 && 'database_size' in si && si.last_backup === null && si.backups === 0, r.error || JSON.stringify(si));
r = await as(I.billing, `select settings_system_info()`); ok('system info is admin only', /only Admin/.test(r.error || ''), r.error);

// backup
await q(db, `insert into categories(name) values ('Tablets'),('Syrups')`);
await q(db, `insert into units(name, code) values ('Tablet','TAB'),('Strip','STRIP')`);
await q(db, `insert into unit_conversions(from_unit_id,to_unit_id,factor) select s.id, t.id, 10 from units s, units t where s.code='STRIP' and t.code='TAB'`);
await q(db, `insert into expense_categories(branch_id,name) values ($1,'Electricity')`, [I.branch]);
r = await as(I.admin, `select settings_backup_export(false, 'manual') b`);
const bk = r.rows?.[0]?.b || {};
ok('backup export: format, tables, rows', bk.format === 'pallikkal-pharmacy-backup' && bk.tables?.pharmacy_settings?.length >= 4 && bk.tables.categories.length === 2 && bk.tables.branches.length === 1 && !('audit_logs' in bk.tables), r.error || Object.keys(bk.tables || {}).join());
ok('backup excludes audit logs unless asked; includes branch tables', 'profiles' in bk.tables && 'billing_settings' in bk.tables);
r = await as(I.admin, `select settings_backup_export(true, 'auto') b`);
ok('backup with audit logs', (r.rows?.[0]?.b.tables.audit_logs || []).length > 0, r.error);
r = await as(I.admin, `select * from settings_backup_list(10)`);
ok('backup log (2 backups, auto + manual)', r.rows?.length === 2 && r.rows[0].kind === 'auto' && +r.rows[1].size_bytes > 0 && r.rows[0].by_name === 'admin user', r.error || JSON.stringify(r.rows));
si = (await as(I.admin, `select settings_system_info() s`)).rows[0].s;
ok('last backup in system info', si.last_backup?.kind === 'auto' && si.backups === 2);
r = await as(I.pharmacist, `select settings_backup_export(false,'manual')`); ok('pharmacist cannot export', /only Admin/.test(r.error || ''), r.error);

// restore
await db.exec(`delete from pharmacy_settings; delete from unit_conversions; delete from units where code='STRIP'; delete from categories where name='Syrups'; delete from expense_categories`);
await q(db, `update branches set phone = null where id = $1`, [I.branch]);
const file = JSON.parse(JSON.stringify(bk));
file.tables.branches[0].phone = '9847000000';
r = await as(I.admin, `select settings_restore($1::jsonb, $2::text[]) r`, [JSON.stringify(file), ['settings', 'branch', 'masters', 'expense_categories']]);
const rr = r.rows?.[0]?.r || {};
ok('restore: settings, branch, masters, expense categories', rr.settings >= 4 && rr.branch === 1 && rr.categories === 1 && rr.units === 1 && rr.unit_conversions === 1 && rr.expense_categories === 1, r.error || JSON.stringify(rr));
ok('restore: values back', (await one(`select value->>'upi_id' u from pharmacy_settings where key='payments'`))?.u === 'pallikkal@okaxis' && (await one(`select phone from branches where id=$1`, [I.branch])).phone === '9847000000');
ok('restore: licence not restored from a file', !(await q(db, `select 1 from pharmacy_settings where key='license'`)).length);
r = await as(I.admin, `select settings_restore($1::jsonb, $2::text[]) r`, [JSON.stringify(file), ['masters']]);
ok('restore twice adds nothing', r.rows?.[0]?.r.categories === 0 && r.rows[0].r.units === 0, r.error);
r = await as(I.admin, `select settings_restore('{"format":"x"}'::jsonb, array['masters'])`); ok('wrong file refused', /not a Pallikkal/.test(r.error || ''), r.error);
r = await as(I.admin, `select settings_restore($1::jsonb, array['sales'])`, [JSON.stringify(file)]); ok('unknown restore part refused', /Unknown restore option/.test(r.error || ''), r.error);
ok('restore logged', (await one(`select count(*)::int n from audit_logs where action='backup_restored'`)).n === 2);
r = await as(I.billing, `select settings_restore($1::jsonb, array['masters'])`, [JSON.stringify(file)]); ok('staff cannot restore', /only Admin/.test(r.error || ''), r.error);
r = await as(null, `select settings_get()`); ok('anonymous cannot read settings', !!r.error);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
