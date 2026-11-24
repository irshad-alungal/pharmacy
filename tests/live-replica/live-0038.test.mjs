// Migration 0038 on the live-schema replica: the medicine's % or ₹ discount reaches billing,
// both after 0037 and on a database that never got 0037's billing functions.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture, IDS, asUser, asOwner, q } from './fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '../../database/migrations');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : '  → ' + String(x).slice(0, 500)}`); };
const m38 = fs.readFileSync(path.join(dir, '0038_billing_medicine_discount.sql'), 'utf8');
for (const with37 of [true, false]) {
  const tag = with37 ? '[after 0037]' : '[without 0037]';
  const db = await makeFixture({ postgrest: true });
  for (const f of fs.readdirSync(dir).filter(f => new RegExp(`^00(2[1-9]|3[0-${with37 ? 7 : 6}])_`).test(f)).sort()) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  try { await db.exec(m38); await db.exec(m38); ok(`${tag} 0038 runs twice`, true); } catch (e) { ok(`${tag} 0038 runs`, false, e.message); continue; }
  await asOwner(db);
  const B = IDS.branch;
  const mk = async (name, pct, amt) => {
    const id = (await q(db, `insert into medicines(branch_id,name,mrp,selling_price,tax_rate,discount_percentage,discount_amount) values ($1,$2,50,50,12,$3,$4) returning id`, [B, name, pct, amt]))[0].id;
    await q(db, `insert into medicine_batches(branch_id,medicine_id,batch_no,expiry,qty,mrp,tax_rate) values ($1,$2,$3,current_date + 400,20,50,12)`, [B, id, name + '-B']);
    return id;
  };
  const a = await mk('PctMed', 10, null), b = await mk('AmtMed', null, 5), c = await mk('ZeroPctAmt', 0, 5), d = await mk('NoDisc', null, null);
  const comp = async id => (await q(db, `select _billing_fefo_compute($1,$2,1,null,'{}'::jsonb) j`, [B, id]))[0].j;
  const first = j => (j.rows || j.allocation || j.candidates || [])[0] || {};
  const pick = async id => { const j = await comp(id); const r = (j.candidates || [])[0] || first(j); return r; };
  const ra = await pick(a), rb = await pick(b), rc = await pick(c), rd = await pick(d);
  ok(`${tag} 10% medicine → 10% in billing`, +ra.default_discount_pct === 10, JSON.stringify(ra));
  ok(`${tag} ₹5 on ₹50 → 10% and shown as ₹5`, +rb.default_discount_pct === 10 && +rb.discount_amount === 5, JSON.stringify(rb));
  ok(`${tag} 0% plus ₹5 → ₹5 is used`, +rc.default_discount_pct === 10, JSON.stringify(rc));
  ok(`${tag} no discount → 0`, +rd.default_discount_pct === 0, JSON.stringify(rd));
  const src = (await q(db, `select string_agg(proname, ',') s from pg_proc where proname in ('_billing_fefo_compute','finalize_sale_v3') and prosrc like '%billing_medicine_discount_pct%'`))[0].s || '';
  ok(`${tag} billing engine and bill saving both use the medicine discount`, src.includes('_billing_fefo_compute') && src.includes('finalize_sale_v3'), src);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
