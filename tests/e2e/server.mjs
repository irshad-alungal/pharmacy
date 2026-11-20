// End-to-end harness: serves the site and runs every Supabase call the pages make
// against the PGlite replica of the live database as the signed-in role (RLS,
// column grants and role checks apply). Usage (from the project root):
//   npm i @electric-sql/pglite && sh tests/e2e/build-site.sh && node tests/e2e/server.mjs
//   pip install playwright && python3 tests/e2e/flows.py && python3 tests/e2e/flows2.py
// End-to-end test server: serves the site and runs the app's Supabase calls
// against the PGlite replica of the live database (with migrations applied).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture, IDS, asUser, asOwner, q } from '../live-replica/fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));

const SITE = process.env.SITE || path.join(HERE, 'site');
const PORT = +(process.env.PORT || 8790);
const db = await makeFixture({ postgrest: true });
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0021_complete_backend_and_live_fixes.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0022_delivery_management_v2.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0023_inventory_stock_transfer.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0024_purchases_management.sql'), 'utf8'));
export const log = [];

// ---- seed realistic data through the real functions --------------------------
await asOwner(db);
await q(db, `insert into billing_settings(branch_id) values ($1) on conflict do nothing`, [IDS.branch]);
// a second branch of the same pharmacy, so stock transfers can be exercised
await q(db, `insert into branches(id,pharmacy_id,code,name,invoice_prefix,city) values ('0b000000-0000-0000-0000-000000000002',$1,'TOWN','Town Branch','TWN','Attingal') on conflict do nothing`, [IDS.pharmacy]);
await q(db, `update branches set address='Main Road', city='Pallikkal', state='Kerala', pincode='695604', phone='9847000000', gstin='32ABCDE1234F1Z5' where id=$1`, [IDS.branch]);
const dist = (await q(db, `insert into distributors(branch_id,name,phone,gstin) values ($1,'Kerala Pharma Distributors','9847011111','32AAACK1234L1Z2') returning id`, [IDS.branch]))[0].id;
await q(db, `insert into distributors(branch_id,name,phone) values ($1,'Malabar Medicals','9847022222')`, [IDS.branch]);
const unit = (await q(db, `insert into units(name,code) values ('Tablet','TAB') returning id`))[0].id;
await q(db, `insert into categories(name) values ('Tablets'),('Syrups')`);
await q(db, `insert into manufacturers(name) values ('Micro Labs'),('Cipla')`);
const meds = [];
for (const [name, strength, mrp, gst, rx] of [['Dolo', '650 mg', 30, 12, false], ['Pan', '40 mg', 150, 12, true], ['Azithral', '500 mg', 120, 12, true], ['Cetirizine', '10 mg', 18, 12, false]]) {
  meds.push((await q(db, `insert into medicines(branch_id,name,strength,mrp,selling_price,tax_rate,need_doctor_sheet,shelf_location,base_unit_id,reorder_level) values ($1,$2,$3,$4,$4,$5,$6,'A1',$7,50) returning id`, [IDS.branch, name, strength, mrp, gst, rx, unit]))[0].id);
}
const cust = (await q(db, `insert into customers(branch_id,name,phone,consent,credit_limit) values ($1,'Ravi Kumar','9847000001',true,2000) returning id`, [IDS.branch]))[0].id;
await q(db, `insert into customers(branch_id,name,phone,consent) values ($1,'Anu Thomas','9847000002',true),($1,'Joseph','9847000003',false)`, [IDS.branch]);
await asUser(db, IDS.superAdmin);
await q(db, `select record_daily_cash_opening($1::date, 500)`, [new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })]).catch(e => console.warn('opening', e.message));
const header = { distributor_id: dist, invoice_no: 'KPD-1001', invoice_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), discount: 0, freight: 0, round_off: 0 };
await q(db, `select confirm_purchase_v2($1::jsonb,$2::jsonb,null,null)`, [JSON.stringify(header), JSON.stringify([
  { medicine_id: meds[0], batch_no: 'D-A', expiry: '2027-01-31', qty: 1, pack: 10, price: 200, tax_rate: 12, mrp: 300 },
  { medicine_id: meds[0], batch_no: 'D-B', expiry: '2027-03-31', qty: 1, pack: 8, price: 160, tax_rate: 12, mrp: 256 },
  { medicine_id: meds[0], batch_no: 'D-C', expiry: '2027-08-31', qty: 2, pack: 10, price: 200, tax_rate: 12, mrp: 350 },
  { medicine_id: meds[1], batch_no: 'P-1', expiry: '2027-12-31', qty: 3, pack: 15, price: 1200, tax_rate: 12, mrp: 2250 },
  { medicine_id: meds[2], batch_no: 'Z-1', expiry: '2026-12-15', qty: 2, pack: 3, price: 250, tax_rate: 12, mrp: 360 },
  { medicine_id: meds[3], batch_no: 'C-1', expiry: '2028-06-30', qty: 5, pack: 10, price: 100, tax_rate: 12, mrp: 180 }
])]);
const exc = await q(db, `select expense_category_add('Electricity') id`).catch(e => console.warn('expense cat', e.message));
// A week of sales history so the dashboard chart and trends have data.
await asOwner(db);
await db.exec(`select set_config('request.jwt.claim.sub', '${IDS.superAdmin}', false)`);
const hist = [14820, 12960, 16110, 19340, 17020, 20750];
for (let i = 0; i < hist.length; i++) {
  const n = 18 + i * 3;
  for (let k = 0; k < n; k++) {
    await q(db, `insert into sales_invoices(branch_id, invoice_no, total, subtotal, status, created_by, created_at)
      values ($1, 'H' || $2::text || '-' || $3::text, $4, $4, 'final', $5, now() - make_interval(days => $6::int) - make_interval(mins => $3::int * 7))`,
      [IDS.branch, i, k, Math.round(hist[i] / n * 100) / 100, IDS.superAdmin, hist.length - i]).catch(e => { if (k === 0) console.warn('history', e.message); });
  }
}
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);

// Optional demo data for screenshots: DEMO=1 node tests/e2e/server.mjs
if (process.env.DEMO) {
  await asOwner(db);
  await q(db, `update profiles set full_name='Rafeeq', phone='9847012345' where id=$1`, [IDS.delivery]);
  await q(db, `update customers set address='M.G. Road, Thodupuzha' where name='Ravi Kumar'`);
  await q(db, `update customers set address='Pallikkal Garden, Thodupuzha' where name='Anu Thomas'`);
  await q(db, `update customers set address='Manakkad P.O., Thodupuzha' where name='Joseph'`);
  const riders = [['0c000000-0000-0000-0000-0000000000d2', 'Sajid', 'DEL002', 'available'], ['0c000000-0000-0000-0000-0000000000d3', 'Manu', 'DEL003', 'available'], ['0c000000-0000-0000-0000-0000000000d4', 'Arun', 'DEL004', 'offline']];
  for (const [id, name, sid] of riders) {
    await db.exec(`insert into auth.users(id) values ('${id}') on conflict do nothing`);
    await q(db, `insert into profiles(id,branch_id,staff_id,full_name,role_id,must_change_password,phone) select $1,$2,$3,$4,id,false,$5 from roles where code='delivery_person' on conflict do nothing`, [id, IDS.branch, sid, name, '98470' + sid.slice(-3) + '111']);
  }
  const pres = [[IDS.delivery, 'available'], ...riders.map(r => [r[0], r[3]])];
  for (const [id, st] of pres) await q(db, `insert into delivery_person_presence(profile_id,branch_id,status) values ($1,$2,$3) on conflict (profile_id) do update set status=excluded.status`, [id, IDS.branch, st]);
  await q(db, `insert into delivery_settings(branch_id,fee_per_delivery) values ($1,40) on conflict (branch_id) do update set fee_per_delivery=40`, [IDS.branch]);
  const custs = await q(db, `select id from customers where branch_id=$1 order by name`, [IDS.branch]);
  const invs = await q(db, `select id, created_at from sales_invoices where branch_id=$1 and status='final' order by created_at desc limit 40`, [IDS.branch]);
  const people = [IDS.delivery, riders[0][0], riders[1][0], null];
  const plan = ['out', 'done', 'out', 'pending', 'done', 'done', 'failed', 'out', 'done', 'pending', 'done', 'done', 'out', 'done', 'pending', 'done', 'done', 'failed', 'done', 'out', 'done', 'done', 'pending', 'done'];
  for (let k = 0; k < plan.length && k < invs.length; k++) {
    const inv = invs[k], st = plan[k], who = st === 'pending' && k % 2 ? null : people[k % 3];
    await q(db, `update sales_invoices set customer_id=$2 where id=$1`, [inv.id, custs[k % custs.length].id]);
    await q(db, `insert into delivery_jobs(branch_id,invoice_id,is_requested,requested_at,assigned_to,assigned_at,status) values ($1,$2,true,$3::timestamptz,$4,$3::timestamptz + interval '5 min','pending') on conflict (branch_id, invoice_id) do nothing`, [IDS.branch, inv.id, inv.created_at, who]);
    if (who && st !== 'pending') {
      await q(db, `update delivery_jobs set status='out' where invoice_id=$1`, [inv.id]);
      if (st !== 'out') await q(db, `update delivery_jobs set status=$2, failure_reason=case when $2='failed' then 'Customer not reachable on phone' end where invoice_id=$1`, [inv.id, st]);
      await q(db, `update delivery_jobs set out_at=assigned_at + interval '12 min', delivered_at=case when status='done' then assigned_at + interval '38 min' end, failed_at=case when status='failed' then assigned_at + interval '45 min' end where invoice_id=$1`, [inv.id]);
    }
  }
  // Medicines catalogue demo
  const cats = {}; for (const c of ['Analgesic', 'Antibiotic', 'Gastro', 'Antihistamine', 'Antidiabetic', 'Cardiovascular', 'Respiratory', 'Pain Relief']) cats[c] = (await q(db, `insert into categories(name) values ($1) returning id`, [c]))[0].id;
  const mans = {}; for (const m of ['Sun Pharma', 'Alkem', "Dr. Reddy's", 'Abbott', 'Zydus', 'Lupin', 'Glenmark', 'Torrent']) mans[m] = (await q(db, `insert into manufacturers(name) values ($1) returning id`, [m]))[0].id;
  mans.Cipla = (await q(db, `select id from manufacturers where name='Cipla'`))[0].id;
  const upd = [['Dolo', 'Micro Labs', 'Analgesic', 'Tablet', '8901112345678'], ['Pan', 'Alkem', 'Gastro', 'Tablet', '8901112345001'], ['Azithral', 'Alembic', 'Antibiotic', 'Tablet', '8901112345002'], ['Cetirizine', "Dr. Reddy's", 'Antihistamine', 'Tablet', '8901112345003']];
  for (const [n, man, cat, form, bc] of upd) await q(db, `update medicines set manufacturer_id=(select id from manufacturers where name=$2 limit 1), category_id=$3, dosage_form=$4, barcode=$5 where name=$1 and branch_id=$6`, [n, man, cats[cat], form, bc, IDS.branch]);
  const extra = [['Paracetamol', '500 mg', 'Cipla', 'Analgesic', 'Tablet', 50, 450, 100], ['Amoxicillin', '500 mg', 'Sun Pharma', 'Antibiotic', 'Capsule', 120, 240, 50], ['Pantoprazole', '40 mg', 'Alkem', 'Gastro', 'Tablet', 85, 20, 50], ['Metformin', '500 mg', 'Abbott', 'Antidiabetic', 'Tablet', 75, 22, 40], ['Azithromycin', '500 mg', 'Zydus', 'Antibiotic', 'Tablet', 180, 0, 20], ['Atorvastatin', '10 mg', 'Lupin', 'Cardiovascular', 'Tablet', 95, 320, 50], ['Omeprazole', '20 mg', 'Glenmark', 'Gastro', 'Capsule', 70, 56, 30], ['Diclofenac', '50 mg', 'Torrent', 'Pain Relief', 'Tablet', 45, 18, 30], ['Montelukast', '10 mg', 'Cipla', 'Respiratory', 'Tablet', 160, 75, 30]];
  let bc = 8901112345100;
  for (const [n, st, man, cat, form, mrp, qty, lvl] of extra) {
    const id = (await q(db, `insert into medicines(branch_id,name,strength,mrp,selling_price,tax_rate,manufacturer_id,category_id,dosage_form,barcode,reorder_level,discount_percentage,rack,shelf_location) values ($1,$2,$3,0,0,12,$4,$5,$6,$7,$8,10,'B-02','B-02') returning id`, [IDS.branch, n, st, mans[man], cats[cat], form, String(bc++), lvl]))[0].id;
    if (qty > 0) await q(db, `insert into medicine_batches(branch_id,medicine_id,batch_no,expiry,qty,mrp,unit_cost,tax_rate,price_includes_tax) values ($1,$2,$3,'2027-06-30',$4,$5,$6,12,true)`, [IDS.branch, id, n.slice(0, 2).toUpperCase() + '5001', qty, mrp, mrp * .7]);
  }
  // Purchases demo: distributors, two months of bills, payments, open and partly received orders
  const dnames = [['Sun Pharma Distributors', '9847100001'], ['Cipla Healthcare', '9847100002'], ['Alkem Labs', '9847100003'], ['Abbott India Ltd.', '9847100004'], ['Mankind Pharma', '9847100005'], ["Dr. Reddy's Labs", '9847100006'], ['Zydus Healthcare', '9847100007'], ['Glenmark Pharma', '9847100008'], ['Lupin Ltd.', '9847100009'], ['Torrent Pharma', '9847100010']];
  const dids = [];
  for (const [n, ph] of dnames) dids.push((await q(db, `insert into distributors(branch_id,name,phone,gstin) values ($1,$2,$3,'32AAAC' || substr(md5($2),1,5) || '1Z2') returning id`, [IDS.branch, n, ph]))[0].id);
  const allMeds = (await q(db, `select id, name from medicines where branch_id=$1 order by name`, [IDS.branch])).map(r => r.id);
  const istToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const dayBefore = n => { const d = new Date(istToday + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  await asUser(db, IDS.superAdmin);
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  let bn = 1;
  const weights = [6, 5, 4, 3, 3, 2, 2, 1, 1, 1];
  const pickDist = () => { let t = rnd() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < weights.length; i++) { t -= weights[i]; if (t <= 0) return i; } return 0; };
  for (let k = 0; k < 46; k++) {
    const di = pickDist(), day = Math.floor(k * 58 / 46 + rnd() * 1.5);
    const lines = [], nl = 2 + Math.floor(rnd() * 4), used = new Set();
    for (let j = 0; j < nl; j++) {
      const mi = Math.floor(rnd() * allMeds.length); if (used.has(mi)) continue; used.add(mi);
      const pack = [10, 10, 15, 6, 1][Math.floor(rnd() * 5)], qty = 5 + Math.floor(rnd() * 40), price = Math.round((40 + rnd() * 600) * 100) / 100;
      lines.push({ medicine_id: allMeds[mi], batch_no: 'B' + String(bn++).padStart(4, '0'), expiry: dayBefore(-(300 + Math.floor(rnd() * 500))), qty, free_qty: rnd() < .3 ? 1 : 0, pack, price, tax_rate: 12, discount: 0, mrp: Math.round(price * 1.45 * 100) / 100 });
    }
    const date = dayBefore(day);
    const inv = (await q(db, `select confirm_purchase_v2($1::jsonb,$2::jsonb,null,null) id`, [JSON.stringify({ distributor_id: dids[di], invoice_no: 'PUR-' + String(1500 - k).padStart(5, '0'), invoice_date: date, due_date: dayBefore(day - 21), payment_terms: 'credit', discount: 0, freight: 0, round_off: 0 }), JSON.stringify(lines)]).catch(e => { console.warn('demo purchase', e.message); return [{}]; }))[0].id;
    if (inv && rnd() < .65) await q(db, `select record_supplier_payment($1,(select total from purchase_invoices where id=$2) * $3,'upi','UTR' || $4,null,$2)`, [dids[di], inv, rnd() < .8 ? 1 : .5, String(900000 + k)]).catch(e => console.warn('demo pay', e.message));
  }
  const o1 = (await q(db, `select purchase_order_save(null,$1::jsonb,$2::jsonb) id`, [JSON.stringify({ distributor_id: dids[6], order_date: dayBefore(3), expected_date: dayBefore(-2), notes: 'Monthly antibiotic stock' }), JSON.stringify(allMeds.slice(0, 4).map((m, i) => ({ medicine_id: m, qty: 10 + i * 5, pack: 10, rate: 120 + i * 30 })))]))[0].id;
  const o2 = (await q(db, `select purchase_order_save(null,$1::jsonb,$2::jsonb) id`, [JSON.stringify({ distributor_id: dids[3], order_date: dayBefore(6), expected_date: dayBefore(1) }), JSON.stringify(allMeds.slice(4, 7).map((m, i) => ({ medicine_id: m, qty: 20, pack: 10, rate: 200 + i * 50 })))]))[0].id;
  await q(db, `select confirm_purchase_v3($1::jsonb,$2::jsonb,null,null,$3)`, [JSON.stringify({ distributor_id: dids[3], invoice_no: 'PUR-01453', invoice_date: dayBefore(2), discount: 0, freight: 0, round_off: 0 }), JSON.stringify([{ medicine_id: allMeds[4], batch_no: 'PO-B1', expiry: dayBefore(-500), qty: 20, pack: 10, price: 200, tax_rate: 12, discount: 0, mrp: 300 }]), o2]).catch(e => console.warn('demo receive', e.message));
  await q(db, `select purchase_order_save(null,$1::jsonb,$2::jsonb) id`, [JSON.stringify({ distributor_id: dids[1], order_date: dayBefore(1) }), JSON.stringify(allMeds.slice(7, 9).map(m => ({ medicine_id: m, qty: 15, pack: 15, rate: 95 })))]);
  await q(db, `select purchase_draft_save(null,$1::jsonb)`, [JSON.stringify({ distributor_id: dids[2], invoice_no: 'ALK-2291', invoice_date: istToday, items: [{ medicine_id: allMeds[0], medicine_label: 'Amoxicillin 500 mg', qty: 5, pack: 10 }] })]);
  await asOwner(db);
  console.log('demo data seeded');
}
console.log('seeded');

// ---- SQL translation -----------------------------------------------------------
const ID = /^[a-z_][a-z0-9_]*$/;
const ident = s => { s = String(s).trim(); if (!ID.test(s)) throw new Error('Bad identifier ' + s); return `"${s}"`; };
let lock = Promise.resolve();
const serial = fn => { const r = lock.then(fn, fn); lock = r.catch(() => {}); return r; };
const fnCache = new Map();

async function fnInfo(name) {
  if (fnCache.has(name)) return fnCache.get(name);
  const rows = await q(db, `select p.proretset, pg_get_function_result(p.oid) res, p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) types, p.pronargs
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [name]);
  fnCache.set(name, rows);
  return rows;
}

function splitTop(s) { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }

function filterSql([type, col, val], params) {
  const p = v => { params.push(v); return `$${params.length}`; };
  const c = col ? ident(col) : null;
  switch (type) {
    case 'eq': return val === null ? `${c} is null` : `${c}::text = ${p(String(val))}`;
    case 'neq': return `${c}::text <> ${p(String(val))}`;
    case 'gt': return `${c} > ${p(val)}`;
    case 'gte': return `${c} >= ${p(val)}`;
    case 'lt': return `${c} < ${p(val)}`;
    case 'lte': return `${c} <= ${p(val)}`;
    case 'like': return `${c}::text like ${p(val)}`;
    case 'ilike': return `${c}::text ilike ${p(val)}`;
    case 'in': return `${c}::text = any(${p(val.map(String))}::text[])`;
    case 'is': return val === null ? `${c} is null` : `${c} is ${val ? 'true' : 'false'}`;
    case 'not_is': return val === null ? `${c} is not null` : `${c} is not ${val ? 'true' : 'false'}`;
    case 'or': return '(' + splitTop(val).map(part => {
      const [col2, op, ...rest] = part.split('.'); const v = rest.join('.');
      const map = { eq: 'eq', neq: 'neq', ilike: 'ilike', like: 'like', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte', is: 'is' };
      if (!map[op]) throw new Error('or op ' + op);
      return filterSql([map[op], col2, op === 'is' ? (v === 'null' ? null : v === 'true') : v.replace(/\*/g, '%')], params);
    }).join(' or ') + ')';
    default: throw new Error('filter ' + type);
  }
}

// Foreign keys for PostgREST-style embedded selects: table(col,...)
const FKS = (await q(db, `select c.conrelid::regclass::text src, c.confrelid::regclass::text dst, a.attname col, af.attname ref
  from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  join pg_attribute af on af.attrelid=c.confrelid and af.attnum=c.confkey[1]
  where c.contype='f' and array_length(c.conkey,1)=1 and c.connamespace='public'::regnamespace`)).map(r => ({ ...r, src: r.src.replace('public.', ''), dst: r.dst.replace('public.', '') }));
function cols(s, table, alias = 't.') {
  const list = splitTop(String(s || '*').replace(/\s+/g, '')).filter(Boolean);
  return list.map(x => {
    const m = x.match(/^([a-z_]+)(?:!([a-z_]+))?\((.*)\)$/);
    if (m) {
      const rel = m[1], inner = cols(m[3] || '*', rel, '');
      const fwd = FKS.find(f => f.src === table && f.dst === rel);
      if (fwd) return `(select row_to_json(e) from (select ${inner} from public.${ident(rel)} where ${ident(fwd.ref)} = t.${ident(fwd.col)}) e) as ${ident(rel)}`;
      const back = FKS.find(f => f.src === rel && f.dst === table);
      if (back) return `(select coalesce(json_agg(e), '[]'::json) from (select ${inner} from public.${ident(rel)} where ${ident(back.col)} = t.${ident(back.ref)}) e) as ${ident(rel)}`;
      throw new Error('No relationship ' + table + ' -> ' + rel);
    }
    if (x === '*') return alias + '*';
    const [a, b] = x.split(':');
    return b ? `${alias}${ident(b)} as ${ident(a)}` : `${alias}${ident(a)}`;
  }).join(',');
}
const retCols = s => String(s || '*').replace(/\s+/g, '').split(',').map(x => x === '*' ? '*' : ident(x)).join(',');
const val = v => (v !== null && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;

async function runQuery(d) {
  const t = ident(d.table);
  const params = [];
  const where = d.op === 'update' || d.op === 'insert' ? '' : (d.filters.length ? ' where ' + d.filters.map(f => filterSql(f, params)).join(' and ') : '');
  let sql, countSql = null;
  if (d.op === 'select') {
    sql = `select ${cols(d.cols, d.table)} from public.${t} t${where}`;
    if (d.count) countSql = `select count(*)::int n from public.${t} t${where}`;
    if (d.order.length) sql += ' order by ' + d.order.map(([c, asc]) => `t.${ident(c)} ${asc ? 'asc' : 'desc'}`).join(',');
    if (d.limit != null) sql += ` limit ${+d.limit}`;
    if (d.offset != null) sql += ` offset ${+d.offset}`;
  } else if (d.op === 'insert') {
    const rows = Array.isArray(d.values) ? d.values : [d.values];
    const keys = Object.keys(rows[0]);
    const vals = rows.map(r => '(' + keys.map(k => { params.push(val(r[k])); return `$${params.length}`; }).join(',') + ')').join(',');
    sql = `insert into public.${t} (${keys.map(ident).join(',')}) values ${vals}${d.returning ? ' returning ' + retCols(d.returning) : ''}`;
  } else if (d.op === 'update') {
    const keys = Object.keys(d.values);
    const sets = keys.map(k => { params.push(val(d.values[k])); return `${ident(k)} = $${params.length}`; }).join(',');
    const params2 = [...params];
    const where2 = d.filters.length ? ' where ' + d.filters.map(f => filterSql(f, params2)).join(' and ') : '';
    params.length = 0; params.push(...params2);
    sql = `update public.${t} set ${sets}${where2}${d.returning ? ' returning ' + retCols(d.returning) : ''}`;
  } else if (d.op === 'delete') {
    sql = `delete from public.${t}${where}`;
  }
  let data = (await db.query(sql, params)).rows;
  let count = null;
  if (countSql) count = (await db.query(countSql, params)).rows[0].n;
  if (d.op !== 'select' && !d.returning) data = null;
  if (d.single) {
    if (!data || data.length === 0) {
      if (d.single === 'maybe') return { data: null, error: null, count };
      return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count };
    }
    if (data.length > 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count };
    data = data[0];
  }
  return { data, error: null, count };
}

async function runRpc(name, args) {
  if (!ID.test(name)) throw new Error('bad fn');
  const infos = await fnInfo(name);
  if (!infos.length) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } };
  const keys = Object.keys(args || {});
  // choose overload whose argument names cover the provided keys
  const info = infos.find(i => keys.every(k => (i.proargnames || []).includes(k))) || infos[0];
  const params = [];
  const call = keys.map(k => {
    const idx = (info.proargnames || []).indexOf(k);
    const type = info.types[idx] || 'text';
    params.push(val(args[k]));
    return `${ident(k)} => $${params.length}::${type}`;
  }).join(', ');
  if (info.proretset) {
    const rows = (await db.query(`select * from public.${ident(name)}(${call})`, params)).rows;
    return { data: rows, error: null };
  }
  const rows = (await db.query(`select public.${ident(name)}(${call}) as r`, params)).rows;
  return { data: rows[0].r, error: null };
}

async function runStorage(b) {
  if (b.op === 'upload') {
    await db.query(`insert into storage.objects(bucket_id,name,owner,metadata) values ($1,$2,auth.uid(),$3)`, [b.bucket, b.path, JSON.stringify({ size: b.size, mimetype: b.type })]);
    return { data: { path: b.path }, error: null };
  }
  if (b.op === 'remove') { await db.query(`delete from storage.objects where bucket_id=$1 and name = any($2::text[])`, [b.bucket, b.paths]); return { data: [], error: null }; }
  return { data: null, error: { message: 'unsupported storage op' } };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    let body = '';
    for await (const ch of req) body += ch;
    const b = JSON.parse(body || '{}');
    const kind = req.url.slice(5);
    const out = await serial(async () => {
      try {
        await asUser(db, b.user);
        if (kind === 'query') return await runQuery(b.q);
        if (kind === 'rpc') return await runRpc(b.name, b.args);
        if (kind === 'ownersql') { await asOwner(db); return { data: await q(db, b.sql, b.params || []), error: null }; }   // test-only cross-branch checks
        if (kind === 'storage') return await runStorage(b);
        if (kind === 'function') {
          if (b.name === 'admin-staff') {
            const staff = await q(db, `select p.id, p.staff_id, p.full_name, p.phone, r.code as role, r.name as role_name, p.is_active, p.must_change_password, p.created_at from profiles p join roles r on r.id = p.role_id`);
            return { data: { ok: true, staff }, error: null };
          }
          if (b.name === 'billing-assistant') return { data: { reply: 'Test reply', actions: [] }, error: null };
          return { data: null, error: { message: 'function not available in test' } };
        }
        return { data: null, error: { message: 'unknown api' } };
      } catch (e) {
        log.push({ kind, detail: b.q?.table || b.name, msg: e.message });
        return { data: null, error: { message: e.message, code: e.code || 'P0001', details: e.detail || null } };
      } finally { await asOwner(db); }
    });
    if (out?.error) log.push({ kind, detail: b.q ? `${b.q.op} ${b.q.table}` : b.name, msg: out.error.message, user: b.user });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
    return;
  }
  if (req.url === '/__log') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(log.splice(0))); return; }
  const p = path.join(SITE, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log('e2e server on', PORT));
