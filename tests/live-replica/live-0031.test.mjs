// Migration 0031 on the live-schema replica: staff list & details, roles, activation, attendance
// (manual marks + automatic from logins + leave), leaves, trend, register, activities, performance, visibility rules.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture, IDS as I, asUser, asOwner, q } from './fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const mig = n => fs.readFileSync(path.join(HERE, '../../database/migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : '  → ' + String(x).slice(0, 400)}`); };
const one = async (sql, p) => (await q(db, sql, p))[0];
const db = await makeFixture();
await db.exec(mig('0021_complete_backend_and_live_fixes.sql'));
await db.exec(mig('0031_staff_management.sql'));
try { await db.exec(mig('0031_staff_management.sql')); ok('0031 runs a second time', true); } catch (e) { ok('0031 runs a second time', false, e.message); }
await asOwner(db);
const today = (await one(`select (now() at time zone 'Asia/Kolkata')::date::text d`)).d;
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
const add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

let r = await as(I.superAdmin, `select * from staff_list()`);
const L = r.rows || [];
ok('super admin sees all 6 branch logins incl. admin and self', L.length === 6 && L.some(x => x.role === 'admin') && L.find(x => x.id === I.superAdmin)?.is_self === true, r.error || L.map(x => x.role));
ok('role names and default designation', L.find(x => x.role === 'billing_staff').role_name === 'Billing Staff' && L.find(x => x.role === 'delivery_person').designation === 'Delivery Staff');
ok('logins today count as present automatically', L.filter(x => x.today_status === 'present' && x.today_source === 'login').length === 6, JSON.stringify(L.map(x => [x.role, x.today_status])));
ok('cannot manage self or super admin; can manage staff', L.find(x => x.id === I.superAdmin).can_manage === false && L.find(x => x.role === 'pharmacist').can_manage === true);
r = await as(I.admin, `select * from staff_list()`);
ok('admin does not see Admin / Super Admin accounts', r.rows?.length === 4 && !r.rows.some(x => ['admin', 'super_admin'].includes(x.role)), r.error || r.rows?.map(x => x.role));
r = await as(I.pharmacist, `select * from staff_list()`);
ok('pharmacist cannot open staff management', /Not authorised/.test(r.error || ''), r.error);

// details
r = await as(I.admin, `select staff_update($1, $2::jsonb)`, [I.pharmacist, JSON.stringify({ full_name: 'Ajay Kumar', phone: '+91 98765 43210', designation: 'Pharmacist', join_date: '2023-03-15', address: 'MG Road', email: 'ajay@example.com', shift: 'morning', salary: '28000', licence_no: 'KL-PH-1234', photo_path: `${I.branch}/a.jpg` })]);
let d = (await as(I.admin, `select * from staff_list() where id=$1`, [I.pharmacist])).rows?.[0] || {};
ok('details saved (name/phone on the login, rest in staff_details)', !r.error && d.full_name === 'Ajay Kumar' && d.phone === '+91 98765 43210' && d.join_date && d.address === 'MG Road' && +d.salary === 28000 && d.shift === 'morning' && d.licence_no === 'KL-PH-1234', r.error || JSON.stringify(d));
const au = await one(`select before_data, after_data from audit_logs where action='staff_updated' order by id desc limit 1`);
ok('update logged without the salary amount', au && au.after_data.salary === 'changed' && !('salary' in (au.before_data || {})), JSON.stringify(au));
r = await as(I.admin, `select staff_update($1, '{"phone":"123"}'::jsonb)`, [I.pharmacist]);
ok('invalid phone refused', /valid phone/.test(r.error || ''), r.error);
r = await as(I.admin, `select staff_update($1, $2::jsonb)`, [I.pharmacist, JSON.stringify({ photo_path: 'other-branch/x.jpg' })]);
ok('photo must be in the branch folder', /branch/.test(r.error || ''), r.error);
r = await as(I.admin, `select staff_update($1, '{"full_name":"X"}'::jsonb)`, [I.superAdmin]);
ok('admin cannot edit the Super Admin', /not found/.test(r.error || ''), r.error);

// roles & status
r = await as(I.admin, `select staff_set_role($1,'inventory_staff')`, [I.billing]);
ok('admin changes a role (signed out, logged)', !r.error && (await one(`select r.code from profiles p join roles r on r.id=p.role_id where p.id=$1`, [I.billing])).code === 'inventory_staff'
  && (await one(`select count(*)::int n from work_sessions where user_id=$1 and logout_at is null`, [I.billing])).n === 0, r.error);
await as(I.admin, `select staff_set_role($1,'billing_staff')`, [I.billing]);
r = await as(I.admin, `select staff_set_role($1,'admin')`, [I.billing]);
ok('only super admin gives the Admin role', /Only Super Admin/.test(r.error || ''), r.error);
r = await as(I.superAdmin, `select staff_set_role($1,'admin')`, [I.superAdmin]);
ok('nobody changes their own role', /own role/.test(r.error || ''), r.error);
r = await as(I.admin, `select staff_set_active($1,false,null)`, [I.delivery]);
ok('deactivating needs a reason', /reason/.test(r.error || ''), r.error);
r = await as(I.admin, `select staff_set_active($1,false,'Left the job')`, [I.delivery]);
ok('deactivate: login off and signed out', !r.error && (await one(`select is_active from profiles where id=$1`, [I.delivery])).is_active === false, r.error);
r = await as(I.admin, `select staff_set_active($1,true,null)`, [I.delivery]);
ok('activate again', !r.error && (await one(`select is_active from profiles where id=$1`, [I.delivery])).is_active === true, r.error);

// attendance
r = await as(I.admin, `select staff_attendance_save($1::date, $2::jsonb) s`, [today, JSON.stringify([
  { profile_id: I.billing, status: 'absent' }, { profile_id: I.inventory, status: 'half_day', check_in: '09:00', check_out: '13:00' }])]);
const s1 = r.rows?.[0]?.s;
ok('manual marks win over logins (absent, half day)', s1 && s1.absent === 1 && s1.half_day === 1 && s1.saved === 2, r.error || JSON.stringify(s1));
r = await as(I.admin, `select * from staff_attendance_day($1::date)`, [today]);
const inv = (r.rows || []).find(x => x.profile_id === I.inventory) || {};
ok('day sheet shows manual mark, times, hours and the login time', inv.status === 'half_day' && inv.source === 'manual' && +inv.hours === 4 && inv.login_in, JSON.stringify(inv));
r = await as(I.admin, `select staff_attendance_save($1::date, $2::jsonb)`, [today, JSON.stringify([{ profile_id: I.inventory, status: 'present', check_in: '13:00', check_out: '09:00' }])]);
ok('out before in refused', /after in time/.test(r.error || ''), r.error);
r = await as(I.admin, `select staff_attendance_save($1::date, $2::jsonb)`, [add(today, 2), JSON.stringify([{ profile_id: I.inventory, status: 'present' }])]);
ok('future date: only leave / holiday / week off', /future/.test(r.error || ''), r.error);
r = await as(I.admin, `select staff_attendance_save($1::date, $2::jsonb)`, [today, JSON.stringify([{ profile_id: I.billing, status: '' }])]);
ok('clearing a mark falls back to the login (present)', (await as(I.admin, `select status, source from staff_attendance_day($1::date) where profile_id=$2`, [today, I.billing])).rows[0].source === 'login');
r = await as(I.admin, `select staff_overview() o`);
let o = r.rows?.[0]?.o || {};
ok('overview: total, active, present, half day', o.total === 4 && o.active === 4 && o.present === 3 && o.half_day === 1, r.error || JSON.stringify(o));
ok('overview: distribution by designation', o.distribution.some(x => x.label === 'Pharmacist' && x.count === 1), JSON.stringify(o.distribution));

// leaves
r = await as(I.admin, `select staff_leave_save(null,$1,'sick',$2::date,$2::date,false,'Fever','pending') id`, [I.billing, add(today, 1)]);
const lv = r.rows?.[0]?.id;
ok('leave request saved as pending', !!lv && (await one(`select status, days from staff_leaves where id=$1`, [lv])).status === 'pending', r.error);
r = await as(I.admin, `select staff_leave_save(null,$1,'casual',$2::date,$3::date,false,null,'approved')`, [I.billing, today, add(today, 2)]);
ok('overlapping leave refused', /already has a leave/.test(r.error || ''), r.error);
r = await as(I.admin, `select staff_leave_decide($1,'rejected',null)`, [lv]);
ok('rejecting needs a reason', /reason/.test(r.error || ''), r.error);
r = await as(I.admin, `select staff_leave_decide($1,'approved',null)`, [lv]);
ok('approve leave', !r.error && (await one(`select status from staff_leaves where id=$1`, [lv])).status === 'approved', r.error);
r = await as(I.admin, `select staff_leave_save(null,$1,'casual',$2::date,$2::date,false,'Family function','approved')`, [I.pharmacist, today]);
r = await as(I.admin, `select staff_overview() o`);
o = r.rows?.[0]?.o || {};
ok('approved leave today → On Leave (wins over login)', o.on_leave === 1 && o.present === 2, JSON.stringify(o));
r = await as(I.admin, `select * from staff_leaves_list(null,null,null)`);
ok('leaves list with days taken this year', r.rows?.length === 2 && r.rows.find(x => x.profile_id === I.pharmacist).taken_this_year >= 1, r.error || JSON.stringify(r.rows));
r = await as(I.admin, `select staff_leave_save(null,$1,'casual',$2::date,$3::date,true,null,'approved')`, [I.inventory, today, add(today, 1)]);
ok('half-day leave must be a single day', /single day/.test(r.error || ''), r.error);

// trend, register
await as(I.admin, `select staff_update($1, '{"join_date":"2024-01-01"}'::jsonb)`, [I.billing]);
await q(db, `insert into staff_attendance(branch_id,profile_id,att_date,status) values ($1,$2,$3::date,'present'),($1,$4,$3::date,'absent')`, [I.branch, I.pharmacist, add(today, -1), I.billing]);
r = await as(I.admin, `select * from staff_attendance_trend($1::date,$2::date)`, [add(today, -6), today]);
const tr = r.rows || [];
const y = tr.find(x => String(x.day).slice(0, 10) === add(today, -1) || new Date(x.day).toISOString().slice(0, 10) === add(today, -1));
ok('trend: 7 days, yesterday 1 present / 1 absent', tr.length === 7 && y && y.present === 1 && y.absent === 1, r.error || JSON.stringify(tr.slice(-2)));
r = await as(I.admin, `select * from staff_attendance_register($1::date,$2::date)`, [add(today, -1), today]);
const rg = (r.rows || []).find(x => x.profile_id === I.billing) || {};
ok('register: day-wise codes and totals', rg.days?.[add(today, -1)] === 'absent' && rg.absent === 1, r.error || JSON.stringify(rg));

// activities, performance, roles
r = await as(I.admin, `select * from staff_activities(50)`);
const kinds = new Set((r.rows || []).map(x => x.kind));
ok('activities: staff added, attendance, leave, role, status, updates', ['added', 'attendance', 'leave', 'role', 'status', 'updated'].every(k => kinds.has(k)) && (r.rows || []).some(x => x.title === 'Leave request'), r.error || [...kinds]);
const am = (r.rows || []).find(x => x.kind === 'attendance');
ok('attendance activity text', /staff present/.test(am?.detail || ''), am?.detail);
r = await as(I.admin, `select * from staff_performance($1::date,$1::date)`, [today]);
ok('performance rows with attendance', (r.rows || []).length === 4 && r.rows.every(x => x.working_days >= 1), r.error || JSON.stringify(r.rows));
r = await as(I.admin, `select * from staff_roles_permissions()`);
const ad = (r.rows || []).find(x => x.code === 'admin'), ph = (r.rows || []).find(x => x.code === 'pharmacist');
ok('roles & permissions: admin role not assignable by admin; pharmacist permissions listed', ad && ad.assignable === false && ph.assignable === true && ph.permissions.includes('sales.create'), r.error || JSON.stringify(r.rows));
r = await as(I.superAdmin, `select * from staff_roles_permissions()`);
ok('super admin can assign Admin', r.rows.find(x => x.code === 'admin').assignable === true);
r = await as(I.admin, `select * from staff_login_history($1,10)`, [I.billing]);
ok('login history', (r.rows || []).length >= 1 && r.rows[0].logout_reason === 'admin', r.error || JSON.stringify(r.rows));
r = await as(I.admin, `select staff_log_event($1,'staff_password_reset',null)`, [I.billing]);
ok('password reset logged', !r.error && (await as(I.admin, `select * from staff_activities(5)`)).rows.some(x => x.kind === 'password'), r.error);
r = await q(db, `select has_table_privilege('authenticated','staff_details','select') a, has_table_privilege('authenticated','staff_attendance','select') b`);
ok('tables only through the functions', r[0].a === false && r[0].b === false);
r = await q(db, `select public from storage.buckets where id='staff-photos'`);
ok('staff-photos bucket is private', r[0]?.public === false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
