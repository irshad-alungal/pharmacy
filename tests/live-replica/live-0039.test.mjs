// Migration 0039 on the live-schema replica: closing balance, invoices_for_day, purchase numbers, QR settings.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture, IDS, asUser, asOwner, q } from './fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '../../database/migrations');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : '  → ' + String(x).slice(0, 500)}`); };
const db = await makeFixture({ postgrest: true });
const B = IDS.branch;
for (const f of fs.readdirSync(dir).filter(f => /^00(2[1-9]|3[0-8])_/.test(f)).sort()) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
await asOwner(db);
// two purchases entered before 0039
const dist = (await q(db, `insert into distributors(branch_id,name) values ($1,'D1') returning id`, [B]))[0].id;
for (const [no, ago] of [['OLD-2', '1 day'], ['OLD-1', '2 days']])
  await q(db, `insert into purchase_invoices(branch_id,distributor_id,supplier_invoice_no,invoice_date,created_at) values ($1,$2,$3,current_date,now() - $4::interval)`, [B, dist, no, ago]);
const m39 = fs.readFileSync(path.join(dir, '0039_day_close_print_purchase_no.sql'), 'utf8');
try { await db.exec(m39); await db.exec(m39); ok('0039 runs twice', true); } catch (e) { ok('0039 runs', false, e.message); }
await asOwner(db);
const nos = await q(db, `select supplier_invoice_no n, purchase_no p from purchase_invoices order by purchase_no`);
ok('Existing purchases numbered in entry order (OLD-1 = 1, OLD-2 = 2)', nos[0].n === 'OLD-1' && nos[0].p === 1 && nos[1].p === 2, JSON.stringify(nos));
await q(db, `insert into purchase_invoices(branch_id,distributor_id,supplier_invoice_no,invoice_date) values ($1,$2,'NEW-1',current_date)`, [B, dist]);
ok('New purchase gets 3', (await q(db, `select purchase_no p from purchase_invoices where supplier_invoice_no='NEW-1'`))[0].p === 3);
await q(db, `update purchase_invoices set purchase_no = 77 where supplier_invoice_no='NEW-1'`);
ok('Number cannot be changed', (await q(db, `select purchase_no p from purchase_invoices where supplier_invoice_no='NEW-1'`))[0].p === 3);
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
ok('next_purchase_no = 4 for admin', (await as(IDS.superAdmin, `select next_purchase_no() n`)).rows?.[0]?.n === 4);
// closing balance
await db.exec(`update app_sessions set ok = true`).catch(() => {});
const today = (await q(db, `select (now() at time zone 'Asia/Kolkata')::date::text d`))[0].d;
await q(db, `insert into daily_cash_openings(branch_id,opening_date,amount,created_by) values ($1,$2,500,$3)`, [B, today, IDS.superAdmin]);
let r = await as(IDS.billing, `select record_daily_cash_closing($1::date, 650, 'ok') id`, [today]);
ok('Billing staff records the closing balance', !!r.rows?.[0]?.id, r.error);
r = await as(IDS.pharmacist, `select record_daily_cash_closing($1::date, 10) id`, [today]);
ok('Second closing the same day refused', /already recorded/.test(r.error || ''), r.error);
r = await as(IDS.billing, `select get_daily_cash_closing($1::date) j`, [today]);
ok('Staff sees amount, not expected', +r.rows[0].j.amount === 650 && r.rows[0].j.expected == null, JSON.stringify(r));
r = await as(IDS.superAdmin, `select get_daily_cash_closing($1::date) j`, [today]);
ok('Admin sees expected 500 and difference +150', +r.rows[0].j.expected === 500 && +r.rows[0].j.difference === 150, JSON.stringify(r.rows?.[0]));
r = await as(IDS.billing, `select correct_daily_cash_closing($1::date, 1, 'xx test')`, [today]);
ok('Staff cannot correct', /Only Admin/.test(r.error || ''));
r = await as(IDS.superAdmin, `select correct_daily_cash_closing($1::date, 500, 'Recount')`, [today]);
ok('Admin corrects', !r.error, r.error);
r = await as(IDS.superAdmin, `select * from cash_closing_list($1::date, $1::date)`, [today]);
ok('History row: closing 500, difference 0', r.rows?.length === 1 && +r.rows[0].closing === 500 && +r.rows[0].difference === 0, JSON.stringify(r));
ok('Direct table access blocked for staff', !!(await as(IDS.billing, `select * from daily_cash_closings`)).error);
// invoices_for_day
r = await as(IDS.billing, `select jsonb_array_length(invoices_for_day($1::date)) n`, [today]);
ok('invoices_for_day works for staff', !r.error && r.rows[0].n === 0, r.error);
ok('Visitors cannot call it', !(await q(db, `select has_function_privilege('anon','public.invoices_for_day(date,boolean)','EXECUTE') x`))[0].x);
// settings
ok('QR settings accepted', (await q(db, `select _settings_clean('invoice', '{"qr_mode":"link","qr_link":"https://x.in","qr_caption":"Rate us"}'::jsonb)->>'qr_mode' m`))[0].m === 'link');
let bad = ''; try { await q(db, `select _settings_clean('invoice', '{"qr_mode":"fax"}'::jsonb)`); } catch (e) { bad = e.message; }
ok('Unknown QR option refused', /Unknown QR/.test(bad), bad);
const src = (await q(db, `select prosrc from pg_proc where proname='record_party_opening_balance'`))[0]?.prosrc || '';
ok('Party opening balance uses India date', !/p_as_of_date\s*>\s*CURRENT_DATE/i.test(src) && src.includes('Asia/Kolkata'), src.slice(0, 200));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
