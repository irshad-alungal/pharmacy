// FEFO billing engine SQL tests (in-memory Postgres via PGlite; no Supabase needed).
//   npm i @electric-sql/pglite
//   node tests/sql-billing-fefo.test.mjs
// Builds a minimal stub of the live tables that 0020 depends on, applies the
// migration twice (idempotency), then checks FEFO, reservations, permissions,
// calculation parity and finalize_sale_v2().
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calcLine } from '../assets/js/billing-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = fs.readFileSync(path.join(here, '../database/migrations/0020_billing_fefo_gst_engine.sql'), 'utf8');
const db = new PGlite();

const BR = 'aaaaaaaa-0000-0000-0000-000000000001';
const ADM = 'bbbbbbbb-0000-0000-0000-000000000001';
const BIL = 'bbbbbbbb-0000-0000-0000-000000000002';
const BIL2 = 'bbbbbbbb-0000-0000-0000-000000000003';
const R_ADMIN = 'cccccccc-0000-0000-0000-000000000001';
const R_BILL = 'cccccccc-0000-0000-0000-000000000002';

await db.exec(`
create schema auth; create schema app;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create function app.session_ok() returns boolean language sql stable as $$ select true $$;
create role anon; create role authenticated;
grant usage on schema public, auth, app to anon, authenticated;
grant execute on all functions in schema app to authenticated;

create table branches(id uuid primary key, name text, invoice_prefix text, is_active boolean default true);
create table roles(id uuid primary key, code text);
create table profiles(id uuid primary key, role_id uuid references roles(id), branch_id uuid references branches(id), is_active boolean default true);
create table permissions(code text primary key, description text);
create table role_permissions(role_id uuid, permission_code text);
create function public.my_role() returns text language sql stable security definer as $$
  select r.code from profiles p join roles r on r.id = p.role_id where p.id = auth.uid() and p.is_active $$;
create function public.my_branch_id() returns uuid language sql stable security definer as $$
  select branch_id from profiles where id = auth.uid() and is_active $$;
create table medicines(id uuid primary key default gen_random_uuid(), branch_id uuid not null references branches(id), name text not null,
  mrp numeric(12,2) not null default 0, selling_price numeric(12,2) not null default 0, tax_rate numeric(5,2) not null default 12,
  discount_percentage numeric(5,2), active boolean not null default true, strength text, shelf_location text);
create table medicine_batches(id uuid primary key default gen_random_uuid(), branch_id uuid not null references branches(id),
  medicine_id uuid not null references medicines(id), batch_no text not null, expiry date not null,
  qty numeric(14,3) not null default 0 check (qty >= 0), quarantined boolean not null default false);
create table customers(id uuid primary key default gen_random_uuid(), branch_id uuid, name text, phone text, active boolean default true, credit_limit numeric default 0);
create sequence invoice_seq;
create table sales_invoices(id uuid primary key default gen_random_uuid(), branch_id uuid, invoice_no text unique, customer_id uuid,
  subtotal numeric(12,2) default 0, discount numeric(12,2) default 0, tax numeric(12,2) default 0, total numeric(12,2) default 0,
  status text default 'final', created_by uuid, created_at timestamptz default now());
create table sales_items(id uuid primary key default gen_random_uuid(), branch_id uuid, invoice_id uuid references sales_invoices(id),
  medicine_id uuid, batch_id uuid, qty numeric(14,3) check (qty > 0), unit_price numeric(12,2), tax_rate numeric(5,2), line_total numeric(12,2));
create table payments(id uuid primary key default gen_random_uuid(), branch_id uuid, invoice_id uuid, method text, amount numeric(12,2));
create table audit_logs(id bigserial primary key, branch_id uuid, user_id uuid, action text, entity_type text, entity_id text, reason text, before_data jsonb, after_data jsonb, created_at timestamptz default now());
create function public.customer_outstanding(p uuid) returns numeric language sql stable as $$ select 0::numeric $$;
create function public.finalize_sale(p_customer uuid, p_items jsonb, p_payments jsonb, p_discount numeric default 0) returns uuid language sql as $$ select null::uuid $$;
grant select on all tables in schema public to authenticated;
grant execute on function public.finalize_sale(uuid, jsonb, jsonb, numeric) to authenticated;

insert into branches values ('${BR}', 'Main', 'PP', true);
insert into roles values ('${R_ADMIN}', 'admin'), ('${R_BILL}', 'billing_staff');
insert into profiles values ('${ADM}', '${R_ADMIN}', '${BR}', true), ('${BIL}', '${R_BILL}', '${BR}', true), ('${BIL2}', '${R_BILL}', '${BR}', true);
`);

await db.exec(MIG);
await db.exec(MIG); // idempotent

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && extra ? '  → ' + extra : ''}`); };
const q = async (s, p) => (await db.query(s, p)).rows;
const as = async u => { await db.exec('reset role'); await db.exec(`select set_config('app.uid', '${u || ''}', false)`); if (u) await db.exec('set role authenticated'); };
const bad = async (n, sql, re, p) => { try { await db.query(sql, p); ok(n + ' (expected error)', false); } catch (e) { ok(`${n} -> ${e.message.slice(0, 70)}`, re.test(e.message), e.message); } };

// Fixture: example from the spec (A 10 Jan-27, B 8 Mar-27, C 20 Aug-27) plus ineligible stock.
const [{ id: MED }] = await q(`insert into medicines(branch_id, name, mrp, selling_price, tax_rate) values ('${BR}', 'Paracetamol 650', 30, 30, 12) returning id`);
const [{ id: MED2 }] = await q(`insert into medicines(branch_id, name, mrp, selling_price, tax_rate, price_includes_tax) values ('${BR}', 'Exclusive Med', 100, 100, 18, false) returning id`);
await db.exec(`insert into medicine_batches(branch_id, medicine_id, batch_no, expiry, qty, mrp) values
 ('${BR}', '${MED}', 'A', '2027-01-31', 10, 30),
 ('${BR}', '${MED}', 'B', '2027-03-31', 8, 32),
 ('${BR}', '${MED}', 'C', '2027-08-31', 20, 35),
 ('${BR}', '${MED}', 'EXP', '2020-01-01', 50, 30),
 ('${BR}', '${MED}', 'ZERO', '2026-12-31', 0, 30),
 ('${BR}', '${MED2}', 'X1', '2028-01-01', 5, null);
 insert into medicine_batches(branch_id, medicine_id, batch_no, expiry, qty, quarantined) values ('${BR}', '${MED}', 'QUAR', '2026-12-15', 40, true);
 insert into medicine_batches(branch_id, medicine_id, batch_no, expiry, qty, stock_status) values ('${BR}', '${MED}', 'RECALL', '2026-12-20', 40, 'recalled');`);
const bid = async n => (await q(`select id from medicine_batches where batch_no = $1`, [n]))[0].id;
const [A, B, C, X1, EXP, QUAR] = [await bid('A'), await bid('B'), await bid('C'), await bid('X1'), await bid('EXP'), await bid('QUAR')];
const CART1 = '11111111-aaaa-0000-0000-000000000001', CART2 = '11111111-aaaa-0000-0000-000000000002';

// ---- calc parity: SQL vs JS ------------------------------------------------
await as(BIL);
const cases = [
  [30, 10, 0, 12, true], [32, 8, 7.5, 12, true], [35, 7, 10, 5, false], [99.99, 3, 12.35, 18, true],
  [12.5, 1, 33.33, 28, false], [0, 5, 0, 5, true], [1.01, 999, 0.01, 12, true], [250, 2, 100, 18, false],
  [10.05, 3, 2.5, 5, false], [7.77, 13, 9.99, 0, true]
];
let parity = true; let detail = '';
for (const [mrp, qty, d, g, incl] of cases) {
  const [s] = await q(`select * from billing_calc_line($1, $2, $3, $4, $5)`, [mrp, qty, d, g, incl]);
  const j = calcLine({ mrp, qty, discountPct: d, gstPct: g, priceIncludesTax: incl });
  const same = +s.base_amount === j.base && +s.discount_amount === j.discount && +s.taxable_amount === j.net && +s.gst_amount === j.gst && +s.total_amount === j.total;
  if (!same) { parity = false; detail += JSON.stringify({ mrp, qty, d, g, incl, s, j }) + ' '; }
}
ok('billing_calc_line SQL == billing-engine.js for 10 cases (incl. & excl.)', parity, detail);
const [ex] = await q(`select * from billing_calc_line(100, 2, 10, 12, false)`);
ok('exclusive: 100x2, 10% disc, 12% GST -> net 180, gst 21.60, total 201.60', +ex.taxable_amount === 180 && +ex.gst_amount === 21.6 && +ex.total_amount === 201.6);
const [inc] = await q(`select * from billing_calc_line(112, 1, 0, 12, true)`);
ok('inclusive: 112 incl. 12% -> gst 12, taxable 100, total 112 (no double GST)', +inc.gst_amount === 12 && +inc.taxable_amount === 100 && +inc.total_amount === 112);
await bad('negative MRP rejected', `select * from billing_calc_line(-1, 1, 0, 12, true)`, /negative/i);
await bad('zero quantity rejected', `select * from billing_calc_line(10, 0, 0, 12, true)`, /greater than zero/i);
await bad('discount > 100 rejected', `select * from billing_calc_line(10, 1, 101, 12, true)`, /between 0 and 100/i);

// ---- FEFO preview ------------------------------------------------------------
const [{ billing_fefo_preview: pv }] = await q(`select billing_fefo_preview('${MED}', 25)`);
const split = Object.fromEntries(pv.rows.map(r => [r.batch_no, +r.qty]));
ok('spec example: 25 -> A 10, B 8, C 7', split.A === 10 && split.B === 8 && split.C === 7 && Object.keys(split).length === 3, JSON.stringify(split));
ok('expired / quarantined / recalled / zero excluded', pv.excluded.expired === 1 && pv.excluded.blocked_or_recalled === 2 && pv.excluded.zero_stock === 1, JSON.stringify(pv.excluded));
ok('each allocation carries its own batch MRP', pv.rows.map(r => +r.mrp).join(',') === '30,32,35');
const [{ billing_fefo_preview: pv2 }] = await q(`select billing_fefo_preview('${MED}', 50)`);
ok('shortage reported (requested 50, available 38, short 12)', +pv2.available_total === 38 && +pv2.shortage === 12 && +pv2.allocated === 38);

// ---- reservations & concurrency ------------------------------------------------
const [{ billing_allocate: a1 }] = await q(`select billing_allocate('${CART1}', '${MED}', 15)`);
ok('cart1 reserves 15 (A10 + B5)', a1.rows.map(r => `${r.batch_no}${+r.qty}`).join(',') === 'A10,B5');
await as(BIL2);
const [{ billing_allocate: a2 }] = await q(`select billing_allocate('${CART2}', '${MED}', 15)`);
ok('cart2 cannot take reserved stock: gets B3 + C12', a2.rows.map(r => `${r.batch_no}${+r.qty}`).join(',') === 'B3,C12', JSON.stringify(a2.rows.map(r => [r.batch_no, r.qty])));
await bad('cart2 user cannot hijack cart1 token', `select billing_allocate('${CART1}', '${MED}', 1)`, /another user/i);
await as(BIL);
const [{ billing_allocate: a1b }] = await q(`select billing_allocate('${CART1}', '${MED}', 12)`);
ok('re-allocating cart1 to 12 replaces its own reservation (A10 + B2)', a1b.rows.map(r => `${r.batch_no}${+r.qty}`).join(',') === 'A10,B2');

// ---- manual override permissions -----------------------------------------------
await bad('billing staff without permission cannot override', `select billing_allocate('${CART1}', '${MED}', 12, '[{"batch_id":"${C}","qty":5}]'::jsonb, 'customer request')`, /permission/i);
await db.exec('reset role');
await db.exec(`insert into role_permissions values ('${R_BILL}', 'sales.batch_override')`);
await as(BIL);
await bad('override needs a reason', `select billing_allocate('${CART1}', '${MED}', 12, '[{"batch_id":"${C}","qty":5}]'::jsonb, '')`, /reason/i);
await bad('override cannot pick an expired batch', `select billing_allocate('${CART1}', '${MED}', 12, '[{"batch_id":"${EXP}","qty":5}]'::jsonb, 'test reason')`, /expired|not eligible|blocked/i);
await bad('override cannot pick a quarantined batch', `select billing_allocate('${CART1}', '${MED}', 12, '[{"batch_id":"${QUAR}","qty":5}]'::jsonb, 'test reason')`, /expired|not eligible|blocked/i);
const [{ billing_allocate: mo }] = await q(`select billing_allocate('${CART1}', '${MED}', 12, '[{"batch_id":"${C}","qty":5}]'::jsonb, 'customer wants longer expiry')`);
ok('manual override C5 + FEFO remainder A7', mo.rows.map(r => `${r.batch_no}${+r.qty}${r.manual ? 'm' : ''}`).join(',') === 'A7,C5m', JSON.stringify(mo.rows.map(r => [r.batch_no, r.qty, r.manual])));
await db.exec('reset role');
ok('override written to audit log', (await q(`select count(*)::int c from audit_logs where action = 'billing_batch_override'`))[0].c === 1);
await as(BIL);
await q(`select billing_allocate('${CART1}', '${MED}', 12)`); // back to FEFO: A10 B2

// ---- finalize_sale_v2 ------------------------------------------------------------
const item = (batch, qty, extra = {}) => ({ batch_id: batch, qty, ...extra });
const fin = (items, payAmt, opts = {}) => q(
  `select finalize_sale_v2(null, $1::jsonb, $2::jsonb, 0, $3::uuid, $4::numeric) as id`,
  [JSON.stringify(items), JSON.stringify(payAmt == null ? [] : [{ method: 'cash', amount: payAmt }]), opts.cart ?? CART1, opts.expected ?? null]);

await bad('non-FEFO selection rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}')`, /FEFO|Stock changed/i, [JSON.stringify([item(C, 12)])]);
await bad('duplicate batch rows rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}')`, /Duplicate/i, [JSON.stringify([item(A, 5), item(A, 5), item(B, 2)])]);
await bad('GST edit without permission rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}')`, /permission to change GST/i, [JSON.stringify([item(A, 10, { gst_pct: 5 }), item(B, 2)])]);
await bad('discount edit without permission rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}')`, /permission to change discounts/i, [JSON.stringify([item(A, 10, { discount_pct: 5 }), item(B, 2)])]);
await bad('MRP edit without permission rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}')`, /permission to change MRP/i, [JSON.stringify([item(A, 10, { mrp: 25 }), item(B, 2)])]);
await db.exec('reset role');
await db.exec(`insert into role_permissions values ('${R_BILL}', 'sales.discount'), ('${R_BILL}', 'sales.gst_edit'), ('${R_BILL}', 'sales.mrp_edit')`);
await as(BIL);
await bad('MRP above printed MRP rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}')`, /cannot exceed the printed MRP/i, [JSON.stringify([item(A, 10, { mrp: 31 }), item(B, 2)])]);
await bad('discount above branch maximum rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}')`, /maximum/i, [JSON.stringify([item(A, 10, { discount_pct: 45 }), item(B, 2)])]);
await bad('unconfigured GST rate rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}')`, /not a configured GST rate/i, [JSON.stringify([item(A, 10, { gst_pct: 7 }), item(B, 2)])]);
await bad('screen total mismatch rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}', 1.00)`, /total changed/i, [JSON.stringify([item(A, 10), item(B, 2)])]);
await bad('selling more than available rejected', `select finalize_sale_v2(null, $1::jsonb, '[]'::jsonb, 0, '${CART1}')`, /Insufficient stock/i, [JSON.stringify([item(A, 10), item(B, 8), item(C, 50)])]);

// Expected: A 10 x 30 @10% -> 270 ; B 2 x 32 @0 -> 64 ; total 334 (inclusive 12% -> gst 28.93 + 6.86)
const la = calcLine({ mrp: 30, qty: 10, discountPct: 10, gstPct: 12 });
const lb = calcLine({ mrp: 32, qty: 2, discountPct: 0, gstPct: 12 });
const expected = la.total + lb.total;
const [{ id: INV }] = await fin([item(A, 10, { discount_pct: 10 }), item(B, 2)], expected, { expected });
await db.exec('reset role');
const [inv] = await q(`select * from sales_invoices where id = $1`, [INV]);
ok(`invoice total ${expected} matches JS engine`, +inv.total === expected && +inv.tax === la.gst + lb.gst && +inv.line_discount === la.discount, JSON.stringify(inv));
const stock = Object.fromEntries((await q(`select batch_no, qty from medicine_batches where medicine_id = $1`, [MED])).map(r => [r.batch_no, +r.qty]));
ok('stock deducted from exact batches (A 0, B 6, C 20)', stock.A === 0 && stock.B === 6 && stock.C === 20, JSON.stringify(stock));
ok('cart1 reservations released after finalize', (await q(`select count(*)::int c from stock_reservations where cart_token = '${CART1}'`))[0].c === 0);
ok('cart2 reservations still held', (await q(`select coalesce(sum(qty),0)::int s from stock_reservations where cart_token = '${CART2}'`))[0].s === 15);
const items = await q(`select b.batch_no, si.discount_pct, si.gst_amount, si.taxable_amount, si.line_total from sales_items si join medicine_batches b on b.id = si.batch_id where invoice_id = $1 order by b.batch_no`, [INV]);
ok('line detail stored (discount %, GST, taxable)', +items[0].discount_pct === 10 && +items[0].gst_amount === la.gst && +items[0].taxable_amount === la.net);
ok('discount change audited on finalize', (await q(`select count(*)::int c from audit_logs where action = 'billing_line_overrides' and entity_id = $1`, [INV]))[0].c === 1);

// Exclusive-tax medicine: GST added on top
await as(BIL);
const CART3 = '11111111-aaaa-0000-0000-000000000003';
await q(`select billing_allocate('${CART3}', '${MED2}', 2)`);
const lx = calcLine({ mrp: 100, qty: 2, discountPct: 0, gstPct: 18, priceIncludesTax: false });
const [{ id: INV2 }] = await fin([item(X1, 2)], lx.total, { cart: CART3, expected: lx.total });
await db.exec('reset role');
ok('exclusive-tax medicine billed 236.00 (200 + 18% GST)', +(await q(`select total from sales_invoices where id = $1`, [INV2]))[0].total === 236 && lx.total === 236);

// Release & legacy
await as(BIL2);
ok('billing_release frees cart2 stock', (await q(`select billing_release('${CART2}') n`))[0].n === 2);
await bad('legacy finalize_sale no longer executable by browsers', `select finalize_sale(null, '[]'::jsonb, '[]'::jsonb, 0)`, /permission denied/i);
await bad('stock_reservations not directly readable', `select * from stock_reservations`, /permission denied/i);
const [{ billing_my_config: cfg }] = await q(`select billing_my_config()`);
ok('billing_my_config returns permissions and GST slabs', cfg.permissions.batch_override === true && Array.isArray(cfg.gst_rates) && cfg.gst_rates.map(Number).includes(5));

// Recall a batch: excluded from FEFO and its reservations dropped
await as(ADM);
await db.exec(`select set_batch_stock_status('${C}', 'recalled', 'manufacturer recall notice')`);
const [{ billing_fefo_preview: pr }] = await q(`select billing_fefo_preview('${MED}', 5)`);
ok('recalled batch no longer allocated', !pr.rows.some(r => r.batch_no === 'C'));
await db.exec('reset role');
ok('recall audited', (await q(`select count(*)::int c from audit_logs where action = 'batch_stock_status_changed'`))[0].c === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
