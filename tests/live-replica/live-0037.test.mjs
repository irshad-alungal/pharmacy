// Migration 0037 on the live-schema replica (after 0021..0036): contact details, all-day sessions,
// discount rules, 4-digit bill numbers, WhatsApp for every staff role, staff parity, idempotency.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture, IDS, asUser, asOwner, q } from './fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '../../database/migrations');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : '  → ' + String(x).slice(0, 500)}`); };
const db = await makeFixture({ postgrest: true });
for (const f of fs.readdirSync(dir).filter(f => /^00(2[1-9]|3[0-6])_/.test(f)).sort()) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
const m37 = fs.readFileSync(path.join(dir, '0037_final_requirements.sql'), 'utf8');
try { await db.exec(m37); ok('0037 runs', true); } catch (e) { ok('0037 runs', false, e.message); }
try { await db.exec(m37); ok('0037 runs a second time', true); } catch (e) { ok('0037 runs a second time', false, e.message); }
await asOwner(db);
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };

const br = (await q(db, `select phone,email,address,city,pincode from branches where id=$1`, [IDS.branch]))[0];
ok('Branch contact: 8848642677 · pallikkalpharmacy@gmail.com · Pallikkal Bazar 673634', br.phone === '8848642677' && br.email === 'pallikkalpharmacy@gmail.com' && br.address.startsWith('Pallikkal Bazar') && br.pincode === '673634', JSON.stringify(br));
const ws = (await q(db, `select value v from pharmacy_settings where branch_id=$1 and key='website'`, [IDS.branch]))[0]?.v;
ok('Website: Ayurvedic phone 9895843039, WhatsApp = pharmacy number', ws?.ayurveda?.phone === '9895843039' && ws?.whatsapp === '8848642677', JSON.stringify(ws).slice(0, 300));

const d = (sql) => q(db, sql).then(r => Object.values(r[0])[0]);
ok('Discount %: 10% stays 10', +(await d(`select billing_medicine_discount_pct(10,null,50,50,50)`)) === 10);
ok('Discount ₹5 on a ₹50 unit = 10%', +(await d(`select billing_medicine_discount_pct(null,5,50,50,50)`)) === 10);
ok('No discount set → 0', +(await d(`select billing_medicine_discount_pct(null,null,50,50,50)`)) === 0);
ok('Medicine GST defaults to 0', (await d(`select column_default from information_schema.columns where table_name='medicines' and column_name='tax_rate'`)) === '0');

await db.exec(`set session_replication_role = origin`);
const no = (await q(db, `insert into sales_invoices(branch_id,invoice_no,total,subtotal,tax,discount,status,created_by) values ($1,'x',10,10,0,0,'final',$2) returning invoice_no`, [IDS.branch, IDS.billing]))[0].invoice_no;
ok(`Bill number YYYY-MM-DD-#### (${no})`, /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(no), no);

await db.exec(`grant execute on function _wa_guard(boolean) to authenticated`);
for (const [who, id] of [['inventory staff', IDS.inventory], ['pharmacist', IDS.pharmacist], ['billing staff', IDS.billing]]) {
  const r = await as(id, `select _wa_guard(false) b`);
  ok(`WhatsApp sending allowed for ${who}`, r.rows?.[0]?.b === IDS.branch, r.error);
}
const r1 = await as(IDS.inventory, `select _wa_guard(true) b`);
ok('WhatsApp campaigns/settings stay Admin-only', /only Admin/.test(r1.error || ''), r1.error);
await db.exec(`revoke execute on function _wa_guard(boolean) from authenticated`);

await q(db, `update profiles set must_change_password=false where id=$1`, [IDS.billing]);
const before = +(await d(`select count(*) from work_sessions where user_id='${IDS.billing}' and logout_at is null`));
await as(IDS.billing, `select start_work_session()`);
await as(IDS.billing, `select start_work_session()`);
const open = +(await d(`select count(*) from work_sessions where user_id='${IDS.billing}' and logout_at is null`));
ok('Second login the same day keeps the first session (no auto logout)', open === before + 2, [before, open]);
await q(db, `update work_sessions set work_date = work_date - 1 where user_id=$1`, [IDS.billing]);
await as(IDS.billing, `select start_work_session()`);
const left = await q(db, `select count(*) filter (where logout_at is null) o, count(*) filter (where logout_reason='new_login') c from work_sessions where user_id=$1`, [IDS.billing]);
ok('Next day: yesterday\'s sessions closed, one new open session', +left[0].o === 1 && +left[0].c === before + 2, JSON.stringify(left));

const ss = await as(IDS.pharmacist, `select sales_summary(current_date, current_date) s`);
ok('Staff cannot read sales totals (sales_summary)', !!ss.error, JSON.stringify(ss).slice(0, 200));
const cs = await as(IDS.inventory, `select count(*) from customer_outstanding()`);
ok('Inventory staff can use Customers (customer_outstanding)', !cs.error || !/authori/i.test(cs.error), cs.error);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
