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
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0025_customers_management.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0026_sales_management.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0027_returns_management.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0028_finance_management.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0029_reports_analytics.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0030_whatsapp_management.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0031_staff_management.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0032_documents_management.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0033_settings_management.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0034_audit_logs.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0035_public_website.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0036_invoice_view.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0037_final_requirements.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '../../database/migrations/0038_billing_medicine_discount.sql'), 'utf8'));
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
  // public website (0035): offers, sister store, WhatsApp and map for the home page
  {
    await asOwner(db);
    await q(db, `update branches set address='Near KSRTC Bus Stand, MG Road', city='Thrissur', state='Kerala', pincode='680001', email='info@pallikkalpharmacy.in', drug_licence_nos='["KL-TSR-20B-1023","KL-TSR-21B-1024"]' where id=$1`, [IDS.branch]);
    const till = new Date(Date.now() + 20 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await q(db, `insert into pharmacy_settings(branch_id,key,value,updated_by) values ($1,'website',$2,$3) on conflict (branch_id,key) do update set value=excluded.value`, [IDS.branch, JSON.stringify({
      whatsapp: '9847000000', map_query: 'Pallikkal Pharmacy, MG Road, Thrissur',
      offers: [
        { title: 'Up to 20% off on wellness products', text: 'Vitamins, supplements and personal care — this month only.', tag: 'Up to 20%', valid_till: till },
        { title: 'Free BP check every Saturday', text: 'Walk in between 10 AM and 1 PM. No appointment needed.', tag: 'Free', valid_till: '' },
        { title: 'Old offer', text: 'Should not show', tag: '', valid_till: '2020-01-01' }],
      ayurveda: { enabled: true, name: 'Pallikkal Ayurvedic Store', text: 'Traditional Ayurvedic products and wellness essentials for a natural and healthier lifestyle.', address: 'Near Thekkinkadu Maidan, Round North, Thrissur, Kerala 680001', phone: '+91 98470 12345', email: 'ayurveda@pallikkalpharmacy.in', website: 'https://www.pallikkalayurveda.in', map_query: 'Round North, Thrissur' },
      socials: { facebook: 'https://facebook.com/', instagram: 'https://instagram.com/', youtube: 'https://youtube.com/' }
    }), IDS.superAdmin]);
  }
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
  // Customers demo: 40 customers joined over 8 months, loyalty, birthdays, bills
  const cnames = ['Ajay Kumar', 'Revathi Nair', 'Suresh Babu', 'Anitha Menon', 'Mohammed Rafi', 'Deepak Verma', 'Kiran Joseph', 'Meera Nair', 'Vishnu Prasad', 'Sneha Thomas', 'Fathima Beevi', 'Rahul Krishnan', 'Lakshmi Devi', 'Arjun Das', 'Shabeer Ali', 'Divya Mohan', 'Abdul Rahman', 'Gopika Suresh', 'Nikhil Varghese', 'Hari Shankar', 'Sajna K', 'Jithin George', 'Bindu Pillai', 'Faisal Ahmed', 'Reshma Rajan', 'Ashraf P', 'Sreeja Unni', 'Manu Mathew', 'Najma Hussain', 'Pradeep Kumar', 'Shiny Jose', 'Rasheed M', 'Kavya Ramesh', 'Unnikrishnan', 'Haseena T', 'Biju Antony', 'Ammu Sasi', 'Noufal K', 'Ramla Beevi', 'Sudheer V'];
  const cids = [];
  for (const [k, n] of cnames.entries()) {
    const ph = '9' + String(876543210 - k * 1111111).padStart(9, '0');
    const r = await q(db, `insert into customers(branch_id,name,phone,email,age,gender,consent,loyalty_member,dob,address,credit_limit,active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [IDS.branch, n, ph, n.toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.$/, '') + '@email.com', 20 + (k * 7) % 55, k % 3 === 1 ? 'female' : 'male', k % 4 !== 3, k % 3 === 0, k % 5 === 0 ? `19${70 + k % 25}-${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(5, 7)}-${String(1 + k % 27).padStart(2, '0')}` : null, ['Pallikkal Bazar', 'Kondotty', 'Kottakkal', 'Malappuram'][k % 4], k % 6 === 0 ? 5000 : 0, n !== 'Meera Nair']).catch(e => { console.warn('demo cust', e.message); return [{}]; });
    if (r[0].id) { cids.push(r[0].id); await q(db, `update customers set created_at = now() - make_interval(days => $2::int) where id=$1`, [r[0].id, Math.round((cnames.length - k) * 6.2)]); }
  }
  const allInv = await q(db, `select id from sales_invoices where branch_id=$1 and status='final' order by created_at`, [IDS.branch]);
  for (const [k, inv] of allInv.entries()) { const w = Math.floor(Math.pow((k * 7919) % 1000 / 1000, 2.2) * cids.length); await q(db, `update sales_invoices set customer_id=$2 where id=$1 and customer_id is null`, [inv.id, cids[w]]); }
  // Purchases demo: distributors, two months of bills, payments, open and partly received orders
  const dnames = [['Sun Pharma Distributors', '9847100001'], ['Cipla Healthcare', '9847100002'], ['Alkem Labs', '9847100003'], ['Abbott India Ltd.', '9847100004'], ['Mankind Pharma', '9847100005'], ["Dr. Reddy's Labs", '9847100006'], ['Zydus Healthcare', '9847100007'], ['Glenmark Pharma', '9847100008'], ['Lupin Ltd.', '9847100009'], ['Torrent Pharma', '9847100010']];
  const dids = [];
  const contacts = ['Rajesh Kumar', 'Anil Sharma', 'Deepak Verma', 'Manoj Nair', 'Vivek Gupta', 'Suresh Iyer', 'Prakash Menon', 'Arun Joseph', 'Nitin Desai', 'Kiran Reddy'];
  for (const [k, [n, ph]] of dnames.entries()) dids.push((await q(db, `insert into distributors(branch_id,name,phone,gstin,contact_person,email,drug_licence,address) values ($1,$2,$3,'32AAAC' || upper(substr(md5($2),1,5)) || '1Z2',$4,$5,$6,$7) returning id`, [IDS.branch, n, ph, contacts[k], n.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10) + '@dist.com', k % 4 === 3 ? null : 'KL-MLP-' + (130500 + k), ['Kottakkal', 'Malappuram', 'Manjeri', 'Tirur', 'Perinthalmanna'][k % 5] + ', Kerala']))[0].id);
  await q(db, `update distributors set active=false where name='Glenmark Pharma'`);
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
  // Sales demo: today's bills, and items + payments on every demo bill (test data only — triggers skipped)
  {
    await asOwner(db);
    const cnow = (await q(db, `select extract(hour from now() at time zone 'Asia/Kolkata')::int * 60 + extract(minute from now() at time zone 'Asia/Kolkata')::int m`))[0].m;
    const nToday = Math.max(6, Math.min(34, Math.floor((cnow - 30) / 14)));
    const allC = (await q(db, `select id from customers where branch_id=$1 and active order by created_at`, [IDS.branch])).map(r => r.id);
    for (let k = 0; k < nToday; k++) await q(db, `insert into sales_invoices(branch_id, invoice_no, total, subtotal, status, created_by, customer_id, created_at) values ($1, 'D-' || $2::text, 0, 0, 'final', $3, $4, now() - make_interval(mins => $5::int))`, [IDS.branch, k, IDS.billing, k % 5 === 4 ? null : allC[(k * 7) % allC.length], 5 + Math.floor(k * (cnow - 20) / nToday)]);
    const bats = await q(db, `select b.id, b.medicine_id, greatest(b.mrp, 5)::float mrp from medicine_batches b join medicines m on m.id=b.medicine_id where b.branch_id=$1 and m.active order by m.name, b.expiry`, [IDS.branch]);
    const pop = bats.map((b, i) => ({ ...b, w: 1 / (1 + i * .35) }));
    const tw = pop.reduce((a, b) => a + b.w, 0);
    let sd = 11; const r2 = () => (sd = (sd * 9301 + 49297) % 233280) / 233280;
    const pick = () => { let t = r2() * tw; for (const b of pop) { t -= b.w; if (t <= 0) return b; } return pop[0]; };
    const invs2 = await q(db, `select i.id, i.customer_id from sales_invoices i where i.branch_id=$1 and i.status='final' and not exists (select 1 from sales_items s where s.invoice_id=i.id) order by i.created_at`, [IDS.branch]);
    await db.exec(`set session_replication_role = replica`);
    for (const [k, inv] of invs2.entries()) {
      const nl = 1 + Math.floor(r2() * 5), used = new Set(); let tot = 0;
      for (let j = 0; j < nl; j++) {
        const b = pick(); if (used.has(b.id)) continue; used.add(b.id);
        const qty = [1, 2, 3, 5, 10, 10, 15][Math.floor(r2() * 7)], price = Math.round(b.mrp / 10 * 100) / 100 || 5, lt = Math.round(qty * price * 100) / 100;
        tot += lt;
        await q(db, `insert into sales_items(branch_id,invoice_id,medicine_id,batch_id,qty,unit_price,tax_rate,line_total,base_qty,mrp) values ($1,$2,$3,$4,$5,$6,12,$7,$5,$6)`, [IDS.branch, inv.id, b.medicine_id, b.id, qty, price, lt]);
      }
      tot = Math.round(tot);
      await q(db, `update sales_invoices set total=$2, subtotal=$2, taxable_total=round($2/1.12,2), tax=round($2-$2/1.12,2) where id=$1`, [inv.id, tot]);
      const u = r2(), m = u < .44 ? 'cash' : u < .78 ? 'upi' : u < .95 ? 'card' : (inv.customer_id ? 'credit' : 'cash');
      if (tot > 0) await q(db, `insert into payments(branch_id,invoice_id,method,amount) values ($1,$2,$3,$4)`, [IDS.branch, inv.id, m, tot]);
      if (k % 8 === 5 && tot > 30) {
        const si = (await q(db, `select id, medicine_id, batch_id, qty, unit_price from sales_items where invoice_id=$1 order by unit_price desc limit 1`, [inv.id]))[0];
        const rq = Math.max(1, Math.ceil(+si.qty / 2)), val = Math.round(rq * +si.unit_price * 100) / 100;
        const codes = ['wrong_medicine', 'wrong_medicine', 'wrong_medicine', 'adverse_reaction', 'adverse_reaction', 'expired', 'damaged', 'doctor_changed', 'not_needed', 'other'];
        const why = { wrong_medicine: 'Wrong strength given', adverse_reaction: 'Patient developed a rash', expired: 'Strip close to expiry', damaged: 'Blister pack torn', doctor_changed: 'Doctor changed the prescription', not_needed: 'Course stopped, unused strips', other: 'Customer request' };
        const code = codes[Math.floor(r2() * codes.length)], type = r2() < .22 ? 'exchange' : 'refund';
        const rid = (await q(db, `insert into sales_returns(branch_id,return_no,invoice_id,customer_id,reason,refund_method,total,tax,created_by,created_at,reason_code,refund_type) select $1,'CN-' || to_char(now(),'YYMM') || '-' || lpad($2::text,6,'0'),$3,customer_id,$4,$5,$6::numeric,round($6::numeric*12/112,2),$7,least(created_at + interval '3 hours', now()),$8,$9 from sales_invoices where id=$3 returning id`, [IDS.branch, 100 + k, inv.id, why[code], r2() < .7 ? 'cash' : 'upi', val, IDS.billing, code, type]))[0].id;
        await q(db, `insert into sales_return_items(branch_id,return_id,sales_item_id,medicine_id,batch_id,qty,base_qty,disposition,line_total) values ($1,$2,$3,$4,$5,$6,$6,$7,$8)`, [IDS.branch, rid, si.id, si.medicine_id, si.batch_id, rq, ['damaged', 'expired'].includes(code) ? 'damaged' : 'restock', val]);
      }
    }
    const pis = await q(db, `select p.id, p.invoice_id, p.medicine_id, p.batch_id, p.unit_factor, p.unit_price, pi.distributor_id, pi.invoice_date from purchase_items p join purchase_invoices pi on pi.id=p.invoice_id where p.branch_id=$1 order by pi.invoice_date desc, p.id`, [IDS.branch]);
    const pcodes = [['expired', 'Near expiry, distributor agreed to credit'], ['damaged', 'Cartons damaged in transit'], ['wrong_item', 'Wrong strength supplied'], ['excess', 'Slow-moving, returned for credit'], ['expired', 'Expired stock'], ['recall', 'Batch recall notice']];
    for (let k = 0; k < Math.min(9, pis.length); k++) {
      const it = pis[k * 4 % pis.length], [code, why] = pcodes[k % pcodes.length], qty = 1 + k % 2, val = Math.round(qty * +it.unit_price * 1.12 * 100) / 100;
      const rid = (await q(db, `insert into purchase_returns(branch_id,purchase_invoice_id,distributor_id,return_no,reason,total_value,created_by,created_at,reason_code) values ($1,$2,$3,'PR-DEMO-' || $4::text,$5,$6,$7,now() - make_interval(days => $8::int, hours => 3),$9) returning id`, [IDS.branch, it.invoice_id, it.distributor_id, 100 + k, why, val, IDS.superAdmin, k * 3, code]))[0].id;
      await q(db, `insert into purchase_return_items(branch_id,purchase_return_id,purchase_item_id,medicine_id,batch_id,qty,unit_factor,base_qty,unit_price,line_value) values ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$6::numeric * $7::numeric,$8,$9)`, [IDS.branch, rid, it.id, it.medicine_id, it.batch_id, qty, +it.unit_factor || 1, it.unit_price, val]);
    }
    await db.exec(`set session_replication_role = origin`);
  }
  // Expenses demo: 14 months of rent, salary, utilities, maintenance, logistics and office costs
  {
    await asOwner(db);
    const ec = {};
    for (const n of ['Rent', 'Salary', 'Utilities', 'Maintenance', 'Logistics', 'Office', 'Supplies', 'Software']) ec[n] = (await q(db, `insert into expense_categories(branch_id,name,active) values ($1,$2,true) returning id`, [IDS.branch, n]))[0].id;
    const plan = [['Rent', 'Shop Rent', 15000, 'bank', 1], ['Salary', 'Staff Salary', 12000, 'bank', 2], ['Utilities', 'Electricity Bill', 4800, 'upi', 19], ['Utilities', 'Internet & Wi-Fi', 1250, 'upi', 17], ['Maintenance', 'Store Maintenance', 2400, 'cash', 15],
      ['Maintenance', 'Medical Waste Disposal', 850, 'cash', 16], ['Office', 'Office Stationery', 780, 'upi', 14], ['Logistics', 'Delivery Charges', 1320, 'cash', 13], ['Supplies', 'Cleaning Supplies', 960, 'cash', 12], ['Software', 'Software Subscription', 2900, 'card', 11]];
    let sx = 3, n = 1; const rx = () => (sx = (sx * 9301 + 49297) % 233280) / 233280;
    const istT = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await db.exec(`set session_replication_role = replica`);
    for (let m = 13; m >= 0; m--) {
      const base = new Date(Date.UTC(+istT.slice(0, 4), +istT.slice(5, 7) - 1 - m, 1));
      for (const [cat, title, amt, pay, day] of plan) {
        const d = new Date(base); d.setUTCDate(day); const ds = d.toISOString().slice(0, 10);
        if (ds > istT) continue;
        const amount = Math.round(amt * .3 * (cat === 'Rent' ? 1 : .8 + rx() * .45));
        const st = m === 0 && title === 'Office Stationery' ? 'draft' : m === 1 && title === 'Cleaning Supplies' ? 'cancelled' : 'posted';
        await q(db, `insert into expenses(branch_id,expense_no,expense_date,category_id,description,amount,payment_method,reference,status,created_by,created_at,posted_at,posted_by,cancelled_at,cancellation_reason) values ($1,'EXP-DEMO-' || lpad($2::text,4,'0'),$3::date,$4,$5,$6,$7,$8,$9,$10,($3::date + time '10:15' + make_interval(mins => $2::int * 37 % 400)) at time zone 'Asia/Kolkata',case when $9 <> 'draft' then now() end,case when $9 <> 'draft' then $10::uuid end,case when $9 = 'cancelled' then now() end,case when $9 = 'cancelled' then 'Entered twice' end)`,
          [IDS.branch, n++, ds, ec[cat], title + (title === 'Staff Salary' && m === 0 ? ' (Partial)' : ''), amount, pay, pay === 'bank' ? 'NEFT' + (40000 + n) : pay === 'upi' ? 'UPI' + (880000 + n) : null, st, IDS.superAdmin]);
      }
    }
    await db.exec(`set session_replication_role = origin`);
  }
  // Finance demo: FIFO cost for demo sales (test data only)
  {
    await asOwner(db);
    await db.exec(`set session_replication_role = replica`);
    await q(db, `insert into inventory_sale_allocations(branch_id,sales_item_id,cost_layer_id,qty,unit_cost,total_cost)
      select si.branch_id, si.id, l.id, si.qty, coalesce(l.unit_cost, si.unit_price * .68), si.qty * coalesce(l.unit_cost, si.unit_price * .68)
      from sales_items si join lateral (select id, unit_cost from inventory_cost_layers c where c.batch_id = si.batch_id order by c.received_at limit 1) l on true
      where not exists (select 1 from inventory_sale_allocations a where a.sales_item_id = si.id)`).catch(e => console.warn('demo cogs', e.message));
    await q(db, `update inventory_sale_allocations a set unit_cost = round(si.unit_price * .68, 4), total_cost = round(si.unit_price * .68 * a.qty, 2) from sales_items si where si.id = a.sales_item_id and a.unit_cost > si.unit_price`).catch(() => {});
    await db.exec(`set session_replication_role = origin`);
  }
  // Finance demo: sale journals, bank opening, customer receipts, 3 weeks of morning cash openings
  {
    await asOwner(db);
    await db.exec(`select set_config('request.jwt.claim.sub', '${IDS.superAdmin}', false)`);
    const invs = await q(db, `select id from sales_invoices where branch_id=$1 and status='final'`, [IDS.branch]);
    for (const i of invs) await q(db, `select finance_post_sale_journal($1)`, [i.id]).catch(e => console.warn('demo journal', e.message));
    await asUser(db, IDS.superAdmin);
    const istT = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await q(db, `select record_account_opening('bank', 1250000, ($1::date - 60), 'HDFC Bank - A/c ****2034', 'Pass book balance')`, [istT]).catch(e => console.warn('bank opening', e.message));
    const dues = await q(db, `select customer_id, outstanding from customer_dues() order by outstanding desc limit 4`);
    for (const [k, d] of dues.entries()) await q(db, `select record_customer_receipt($1, $2, $3, 'Part payment')`, [d.customer_id, Math.max(1, Math.round(+d.outstanding / 2)), k % 2 ? 'upi' : 'cash']).catch(e => console.warn('receipt', e.message));
    await asOwner(db);
    await q(db, `delete from daily_cash_openings where branch_id=$1`, [IDS.branch]);
    await asUser(db, IDS.superAdmin);
    let open = 5000;
    for (let k = 20; k >= 0; k--) {
      const d = (await q(db, `select ($1::date - $2::int)::text d`, [istT, k]))[0].d;
      await asOwner(db);
      await q(db, `insert into daily_cash_openings(branch_id,opening_date,amount,created_by,created_at) values ($1,$2::date,$3,$4,($2::date + time '08:55') at time zone 'Asia/Kolkata')`, [IDS.branch, d, open, k % 3 ? IDS.billing : IDS.superAdmin]);
      await asUser(db, IDS.superAdmin);
      const cb = (await q(db, `select expected_close from cash_book($1::date,$1::date)`, [d]))[0];
      const diff = [0, 0, -50, 0, 20, 0, 0, -120, 0][k % 9];
      open = Math.max(0, Math.round(+cb.expected_close + diff));
    }
    await asOwner(db);
  }
  // Reports demo: recent report history
  {
    await asOwner(db);
    const istT = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const runs = [['sales', 'Sales Summary Report', 'sales', 20, 0, 0, IDS.superAdmin, 148], ['purchases', 'Purchase Report', 'purchase', 20, 0, 1, IDS.admin, 37],
      ['stock', 'Inventory Valuation Report', 'inventory', null, null, 2, IDS.superAdmin, 64], ['customers', 'Customer Sales Report', 'customer', 20, 0, 3, IDS.admin, 22],
      ['expenses', 'Expense Report', 'expense', 20, 0, 4, IDS.superAdmin, 41], ['pnl', 'Profit & Loss (estimated)', 'finance', 30, 0, 6, IDS.superAdmin, 7]];
    for (const [id, title, cat, f, t, ago, by, n] of runs)
      await q(db, `insert into report_runs(branch_id,report_id,title,category,p_from,p_to,params,row_count,created_by,created_at) values ($1,$2,$3,$4,case when $5::int is null then null else $6::date - $5::int end,case when $7::int is null then null else $6::date - $7::int end,'{}',$8,$9,now() - make_interval(days => $10::int, hours => 2))`, [IDS.branch, id, title, cat, f, istT, t, n, by, ago]);
  }
  // WhatsApp demo: invoices shared, order updates, replies, reminders, 3 campaigns
  {
    await asUser(db, IDS.superAdmin);
    const base = 'https://pallikkal.example/app/';
    const bills = await q(db, `select i.id from sales_invoices i join customers c on c.id=i.customer_id where i.branch_id=$1 and i.status='final' order by i.created_at desc limit 60`, [IDS.branch]);
    for (const b of bills) await q(db, `select whatsapp_queue_invoice($1,$2)`, [b.id, base]).catch(e => console.warn('wa invoice', e.message));
    await asOwner(db);
    // most invoice messages were sent a few minutes after their bill; the newest 3 are still waiting
    await q(db, `update whatsapp_messages w set status='sent', sent_by=$1, sent_at=i.created_at + interval '2 min', queued_at=i.created_at
                 from sales_invoices i where i.id=w.invoice_id and w.id not in (select w2.id from whatsapp_messages w2 join sales_invoices i2 on i2.id=w2.invoice_id order by i2.created_at desc limit 3)`, [IDS.billing]);
    await q(db, `update whatsapp_messages w set queued_at=i.created_at from sales_invoices i where i.id=w.invoice_id and w.status='queued'`);
    await asUser(db, IDS.superAdmin);
    const custs = await q(db, `select id, name, phone from customers where branch_id=$1 and active and consent order by name limit 40`, [IDS.branch]);
    const replies = ['My order is confirmed?', 'Please let me know if Paracetamol 500 mg is in stock.', 'Thank you! I have received the medicines.', 'Do you have Amoxicillin 500 mg?', 'Please send the total amount and payment link.'];
    for (const [k, c] of custs.slice(0, 5).entries()) {
      const m = await q(db, `select whatsapp_queue_message($1,null,null,'order_update',$2,null,null,null,'{}') m`, [c.id, `Hello ${c.name.split(' ')[0]}, your order has been confirmed. We will let you know when it is ready.`]);
      await q(db, `select whatsapp_mark(array[$1]::uuid[],'sent')`, [m[0].m.id]);
      const rid = (await q(db, `select whatsapp_log_reply($1,$2) id`, [c.phone, replies[k]]))[0].id;
      await asOwner(db);
      await q(db, `update whatsapp_messages set sent_at=now() - make_interval(mins => $2::int), queued_at=now() - make_interval(mins => $2::int) where id=$1`, [m[0].m.id, 40 + k * 25]);
      await q(db, `update whatsapp_messages set sent_at=now() - make_interval(mins => $2::int), queued_at=now() - make_interval(mins => $2::int) where id=$1`, [rid, 20 + k * 25]);
      await asUser(db, IDS.superAdmin);
    }
    const ids = custs.map(c => c.id);
    for (const [name, desc, kind, body, n, sentAll, ago] of [
      ['Wellness & Immunity', 'Health tips and special offers', 'health', 'Hello {{name}}, boost your immunity this season with vitamin C and zinc supplements — 15% off at {{shop}} this week!', 30, true, 25],
      ['Diabetes Care Reminder', 'Refill your regular medicines', 'health', 'Hello {{name}}, keep your sugar levels in check: refill your diabetes medicines and get a free sugar test at {{shop}}.', 24, true, 12],
      ['Winter Health Offer', 'Up to 20% off on selected medicines', 'offer', 'Hello {{name}}! Winter Health Offer at {{shop}}: up to 20% off on selected medicines, cough syrups and vitamins. Valid till Sunday.', 36, false, 1]]) {
      const cid = (await q(db, `select whatsapp_campaign_create($1,$2,$3,$4,$5,null,120,$6::uuid[]) id`, [name, desc, kind, body, kind === 'offer' ? 'https://pallikkal.example/offers/winter.jpg' : null, ids.slice(0, n)]))[0].id;
      const ms = await q(db, `select id from whatsapp_campaign_queue($1)`, [cid]);
      const send = sentAll ? ms : ms.slice(0, Math.floor(ms.length * 0.6));
      if (send.length) await q(db, `select whatsapp_mark($1::uuid[],'sent')`, [send.map(x => x.id)]);
      await asOwner(db);
      await q(db, `update whatsapp_campaigns set created_at=now() - make_interval(days => $2::int), started_at=now() - make_interval(days => $2::int), completed_at=case when completed_at is not null then now() - make_interval(days => $2::int) + interval '3 hours' end where id=$1`, [cid, ago]);
      await q(db, `update whatsapp_messages set queued_at=now() - make_interval(days => $2::int), sent_at=case when sent_at is not null then now() - make_interval(days => $2::int) + make_interval(mins => (abs(hashtext(id::text)) % 170)::int) end where campaign_id=$1`, [cid, ago]);
      await asUser(db, IDS.superAdmin);
    }
    const dues = await q(db, `select customer_id, name, outstanding from whatsapp_due_customers() limit 3`);
    for (const d of dues) {
      const m = await q(db, `select whatsapp_queue_message($1,null,null,'payment_reminder',$2,null,null,null,'{}') m`, [d.customer_id, `Hello ${d.name.split(' ')[0]}, a gentle reminder that ₹${(+d.outstanding).toFixed(2)} is pending. Thank you!`]);
      await q(db, `select whatsapp_mark(array[$1]::uuid[],'sent')`, [m[0].m.id]);
    }
    await asOwner(db);
    await q(db, `update whatsapp_messages set sent_at=now() - interval '3 hours', queued_at=now() - interval '3 hours' where kind='payment_reminder'`);
  }
  // Staff demo: 12-member team with designations, 30 days of attendance, leaves, activity
  {
    await asOwner(db);
    const ren = [[IDS.pharmacist, 'EMP-001', 'Ajay Kumar', '+91 98765 43210', 'Pharmacist', '2023-03-15'], [IDS.billing, 'EMP-002', 'Revathi Nair', '+91 98765 43211', 'Sales Staff', '2023-04-20'],
      [IDS.inventory, 'EMP-003', 'Suresh Babu', '+91 98765 43212', 'Store Keeper', '2023-05-10'], [IDS.delivery, 'EMP-005', 'Mohammed Rafi', '+91 98765 43214', 'Delivery Staff', '2023-06-15'],
      [IDS.admin, 'EMP-012', 'Deepa Thomas', '+91 98765 43221', 'Manager', '2022-11-01']];
    for (const [id, sid, name, ph, des, jd] of ren) {
      await q(db, `update profiles set staff_id=$2, full_name=$3, phone=$4 where id=$1`, [id, sid, name, ph]);
      await q(db, `insert into staff_details(profile_id,branch_id,designation,join_date,address,shift) values ($1,$2,$3,$4,'Thodupuzha, Idukki','morning') on conflict (profile_id) do update set designation=excluded.designation, join_date=excluded.join_date`, [id, IDS.branch, des, jd]);
    }
    await q(db, `update profiles set full_name='Admin' where id=$1`, [IDS.superAdmin]);
    const extra = [['EMP-004', 'Anitha Menon', 'billing_staff', 'Cashier', '2023-06-01'], ['EMP-006', 'Vishnu Prasad', 'pharmacist', 'Pharmacist', '2023-08-01'],
      ['EMP-007', 'Divya Mohan', 'billing_staff', 'Sales Staff', '2023-09-12'], ['EMP-008', 'Arjun Das', 'billing_staff', 'Sales Staff', '2024-01-08'],
      ['EMP-009', 'Bindu Pillai', 'billing_staff', 'Cashier', '2024-03-18'], ['EMP-010', 'Sanjay Varma', 'inventory_staff', 'Store Keeper', '2024-07-01'],
      ['EMP-011', 'Rahul Krishnan', 'delivery_person', 'Delivery Staff', TODAY_ISO()]];
    function TODAY_ISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }
    for (const [k, [sid, name, role, des, jd]] of extra.entries()) {
      const uid = (await q(db, `insert into auth.users(id) values (gen_random_uuid()) returning id`))[0].id;
      const id = (await q(db, `insert into profiles(id,branch_id,staff_id,full_name,phone,role_id,is_active,must_change_password,created_by,created_at) select $9,$1,$2,$3,$4,id,$6,false,$7,($8::date + time '10:24') at time zone 'Asia/Kolkata' from roles where code=$5 returning id`,
        [IDS.branch, sid, name, `+91 98765 ${k === 0 ? 43213 : 43215 + k}`, role, sid !== 'EMP-010', IDS.superAdmin, jd, uid]))[0].id;
      await q(db, `insert into staff_details(profile_id,branch_id,designation,join_date,address,shift) values ($1,$2,$3,$4,'Thodupuzha, Idukki',$5)`, [id, IDS.branch, des, jd, k % 2 ? 'evening' : 'morning']);
    }
    // 30 days of attendance (Sundays week off), a few absences and half days
    await q(db, `insert into staff_attendance(branch_id,profile_id,att_date,status,check_in,check_out,marked_by,marked_at)
      select p.branch_id, p.id, d::date,
        case when extract(dow from d) = 0 then 'week_off' when abs(hashtext(p.id::text || d::text)) % 23 = 0 then 'absent' when abs(hashtext(p.id::text || d::text)) % 29 = 1 then 'half_day' else 'present' end,
        time '09:00' + make_interval(mins => abs(hashtext(d::text || p.id::text)) % 25), time '18:00' + make_interval(mins => abs(hashtext(p.id::text)) % 40), $2, d + time '09:05'
      from profiles p join staff_details sd on sd.profile_id = p.id, generate_series((now() at time zone 'Asia/Kolkata')::date - 30, (now() at time zone 'Asia/Kolkata')::date - 1, interval '1 day') d
      where p.branch_id = $1 and p.is_active and d::date >= sd.join_date`, [IDS.branch, IDS.superAdmin]);
    const anitha = (await q(db, `select id from profiles where staff_id='EMP-004'`))[0].id, revathi = IDS.billing, divya = (await q(db, `select id from profiles where staff_id='EMP-007'`))[0].id;
    await q(db, `update staff_attendance set status='present' where att_date >= (now() at time zone 'Asia/Kolkata')::date - 7 and status <> 'week_off'`);
    await q(db, `update staff_attendance set status='absent' where att_date in ((now() at time zone 'Asia/Kolkata')::date - 6, (now() at time zone 'Asia/Kolkata')::date - 5) and profile_id = $1 and status <> 'week_off'`, [divya]);
    await q(db, `update staff_attendance set status='absent' where att_date = (now() at time zone 'Asia/Kolkata')::date - 3 and profile_id = $1 and status <> 'week_off'`, [anitha]);
    // today: marked present (other than those who logged in), one on leave, one not marked yet
    await q(db, `insert into staff_attendance(branch_id,profile_id,att_date,status,check_in,marked_by,marked_at)
      select p.branch_id, p.id, (now() at time zone 'Asia/Kolkata')::date, 'present', time '09:02', $2, now() - interval '3 hours'
      from profiles p join staff_details sd on sd.profile_id = p.id where p.branch_id = $1 and p.is_active and p.staff_id not in ('EMP-007','EMP-011','EMP-001','EMP-002','EMP-003','EMP-005','EMP-012')`, [IDS.branch, IDS.superAdmin]);
    await asUser(db, IDS.superAdmin);
    await q(db, `select staff_leave_save(null,$1,'casual',(now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date,false,'Family function','approved')`, [divya]);
    await q(db, `select staff_leave_save(null,$1,'casual',(now() at time zone 'Asia/Kolkata')::date + 1,(now() at time zone 'Asia/Kolkata')::date + 1,false,'Personal work','pending')`, [revathi]);
    await q(db, `select staff_leave_save(null,$1,'sick',(now() at time zone 'Asia/Kolkata')::date - 12,(now() at time zone 'Asia/Kolkata')::date - 11,false,'Fever','approved')`, [anitha]);
    await q(db, `select staff_update($1,'{"address":"Muttom, Thodupuzha","emergency_name":"Rajan Menon","emergency_phone":"9847011122"}'::jsonb)`, [anitha]);
    await q(db, `select staff_attendance_save((now() at time zone 'Asia/Kolkata')::date - 1, '[]'::jsonb)`);
    await q(db, `select staff_attendance_save((now() at time zone 'Asia/Kolkata')::date, '[]'::jsonb)`);
    await asOwner(db);
    await db.exec('set session_replication_role = replica');
    await q(db, `update audit_logs set at = case when action='staff_updated' then now() - interval '1 day 2 hours' when action='staff_leave_added' and after_data->>'status'='pending' then now() - interval '1 day 5 hours' else at end where entity_type='staff'`);
    await q(db, `update audit_logs set at = ((now() at time zone 'Asia/Kolkata')::date + time '09:05') at time zone 'Asia/Kolkata' where action='staff_attendance_marked' and after_data->>'date' = (now() at time zone 'Asia/Kolkata')::date::text`);
    await q(db, `update audit_logs set at = (((now() at time zone 'Asia/Kolkata')::date - 1) + time '09:04') at time zone 'Asia/Kolkata' where action='staff_attendance_marked' and after_data->>'date' <> (now() at time zone 'Asia/Kolkata')::date::text`);
    await db.exec('set session_replication_role = origin');
    // documents (0032): licences, registrations, tax, agreements, insurance, staff and other documents
    const fLic = (await q(db, `insert into pharmacy_doc_folders(branch_id,name,created_by) values ($1,'Licences & Registrations',$2) returning id`, [IDS.branch, IDS.superAdmin]))[0].id;
    const fAgr = (await q(db, `insert into pharmacy_doc_folders(branch_id,name,created_by) values ($1,'Agreements',$2) returning id`, [IDS.branch, IDS.superAdmin]))[0].id;
    await q(db, `insert into pharmacy_doc_folders(branch_id,name,created_by) values ($1,'Audit 2025-26',$2)`, [IDS.branch, IDS.superAdmin]);
    const DOCS = [
      // category, name, ref, authority, issue offset (days), expiry offset (days, null = none), folder, created days ago
      ['licenses', 'Drug License (Retail)', 'DL-KL-12345-2024', 'Drugs Control Department, Kerala', -560, 170, fLic, 3],
      ['licenses', 'Drug License (Wholesale)', 'DL-KL-WH-5521', 'Drugs Control Department, Kerala', -700, 28, fLic, 6],
      ['licenses', 'Narcotic Drugs License', 'NDPS-KL-0912', 'Excise Department', -330, 35, fLic, 9],
      ['licenses', 'Schedule X Permission', 'SCHX-2208', 'Drugs Control Department, Kerala', -420, 310, fLic, 14],
      ['registrations', 'Pharmacy Council Registration', 'KSPC-2023-4578', 'Kerala State Pharmacy Council', -620, 110, fLic, 4],
      ['registrations', 'Trade License', 'TL-PKL-2024-778', 'Pallikkal Grama Panchayat', -380, -15, fLic, 11],
      ['registrations', 'Shop & Establishment Registration', 'SE-TVM-55120', 'Labour Department', -900, 465, fLic, 21],
      ['registrations', 'FSSAI Registration', '21324018000456', 'FSSAI', -500, 230, fLic, 35],
      ['registrations', 'Udyam (MSME) Registration', 'UDYAM-KL-12-0045678', 'Ministry of MSME', -800, null, null, 52],
      ['tax', 'GST Registration Certificate', '32ABCDE1234F1Z5', 'GST Department', -1200, null, null, 2],
      ['tax', 'PAN Card (Firm)', 'ABCDE1234F', 'Income Tax Department', -2000, null, null, 60],
      ['tax', 'Professional Tax Certificate', 'PT-PKL-9921', 'Pallikkal Grama Panchayat', -300, 65, null, 18],
      ['tax', 'GST Return Acknowledgement (Oct)', 'ARN-AA3211250012', 'GST Department', -20, null, null, 1],
      ['tax', 'TDS Certificate (Form 16A) Q2', 'TDS-Q2-2025', 'Income Tax Department', -45, null, null, 40],
      ['agreements', 'Shop Rent Agreement', 'RA-2024-PKL-01', 'Registered at SRO Attingal', -330, 400, fAgr, 7],
      ['agreements', 'Distributor Agreement — Kerala Pharma', 'AGR-KPD-2025', 'Kerala Pharma Distributors', -150, 215, fAgr, 13],
      ['agreements', 'Software AMC Agreement', 'AMC-PP-2025', 'Pallikkal Pharmacy IT', -200, 20, fAgr, 27],
      ['agreements', 'Waste Disposal Agreement', 'BMW-TVM-883', 'Kerala Enviro Infrastructure', -340, -3, fAgr, 33],
      ['insurance', 'Shop Insurance Policy', 'INS-NIA-778812', 'New India Assurance', -340, 25, null, 5],
      ['insurance', 'Stock Insurance (Fire & Burglary)', 'INS-ORI-55102', 'Oriental Insurance', -120, 245, null, 16],
      ['insurance', 'Public Liability Insurance', 'PLI-2025-0091', 'United India Insurance', -390, -25, null, 44],
      ['staff', 'Pharmacist Registration — Ajay Kumar', 'KSPC-PH-7781', 'Kerala State Pharmacy Council', -420, 300, null, 10],
      ['staff', 'Pharmacist Registration — Anitha Menon', 'KSPC-PH-8120', 'Kerala State Pharmacy Council', -300, 60, null, 19],
      ['staff', 'Appointment Letter — Suresh Babu', 'HR-2023-014', 'Pallikkal Pharmacy', -560, null, null, 70],
      ['staff', 'Aadhaar & ID Proofs — Staff', 'HR-ID-2025', null, -100, null, null, 75],
      ['others', 'Pollution Clearance Certificate', 'KSPCB-CTO-4471', 'Kerala State Pollution Control Board', -680, 50, null, 8],
      ['others', 'Fire NOC', 'FIRE-NOC-TVM-221', 'Fire & Rescue Services', -360, 5, null, 12],
      ['others', 'Electrical Safety Certificate', 'ELEC-2025-118', 'Electrical Inspectorate', -200, 165, null, 24],
      ['others', 'Weights & Measures Certificate', 'LM-TVM-5512', 'Legal Metrology Department', -300, 65, null, 38],
      ['others', 'Building Ownership Certificate', 'BOC-PKL-1190', 'Pallikkal Grama Panchayat', -900, null, null, 90]];
    let k = 0;
    for (const [cat, name, ref, auth, iss, exp, folder, ago] of DOCS) {
      k++;
      const dpath = `${IDS.branch}/${(await q(db, `select gen_random_uuid()::text u`))[0].u}.pdf`;
      const size = 180000 + k * 23117;
      await q(db, `insert into storage.objects(bucket_id,name,owner,metadata) values ('pharmacy-documents',$1,$2,$3)`, [dpath, IDS.superAdmin, JSON.stringify({ size, mimetype: 'application/pdf' })]);
      const did = (await q(db, `insert into pharmacy_documents(branch_id,category,folder_id,name,reference_no,authority,issue_date,expiry_date,path,file_name,mime,size_bytes,uploaded_by,updated_by,created_at,updated_at)
        values ($1,$2,$3,$4,$5,$6,(now() at time zone 'Asia/Kolkata')::date + $7::int,(now() at time zone 'Asia/Kolkata')::date + $8::int,$9,$10,'application/pdf',$11,$12,$12,now() - make_interval(days => $13::int, hours => $14::int),now() - make_interval(days => $13::int, hours => $14::int)) returning id`,
        [IDS.branch, cat, folder, name, ref, auth, iss, exp, dpath, name.replace(/[^A-Za-z0-9]+/g, '_') + '.pdf', size, k % 3 ? IDS.superAdmin : IDS.admin, ago, k % 7]))[0].id;
      await q(db, `update pharmacy_documents set root_id = id where id = $1`, [did]);
      await q(db, `insert into audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,at) values ($1,$2,'document_uploaded','pharmacy_document',$3,$4,now() - make_interval(days => $5::int, hours => $6::int))`, [IDS.branch, k % 3 ? IDS.superAdmin : IDS.admin, did, JSON.stringify({ name, category: cat }), ago, k % 7]);
    }
    // one renewed licence (old version kept) and supplier documents
    const old = (await q(db, `select id, path from pharmacy_documents where name = 'Drug License (Retail)'`))[0];
    const opath = `${IDS.branch}/${(await q(db, `select gen_random_uuid()::text u`))[0].u}.pdf`;
    await q(db, `insert into storage.objects(bucket_id,name,owner,metadata) values ('pharmacy-documents',$1,$2,'{"size":210000}')`, [opath, IDS.superAdmin]);
    const v1 = (await q(db, `insert into pharmacy_documents(branch_id,category,folder_id,name,reference_no,authority,issue_date,expiry_date,path,file_name,mime,size_bytes,status,version,root_id,replaced_by,uploaded_by,created_at)
      values ($1,'licenses',$2,'Drug License (Retail)','DL-KL-12345-2019','Drugs Control Department, Kerala',(now() at time zone 'Asia/Kolkata')::date - 2390,(now() at time zone 'Asia/Kolkata')::date - 560,$3,'Drug_License_Retail_2019.pdf','application/pdf',210000,'archived',1,$4,$4,$5,now() - interval '560 days') returning id`, [IDS.branch, fLic, opath, old.id, IDS.superAdmin]))[0].id;
    await q(db, `update pharmacy_documents set version = 2 where id = $1`, [old.id]);
    for (const [dname, dt, ago] of [['Kerala Pharma Distributors', 'purchase_bill', 2], ['Malabar Medicals', 'delivery_challan', 4], ['Kerala Pharma Distributors', 'credit_note', 9]]) {
      const did = (await q(db, `select id from distributors where name=$1`, [dname]))[0].id;
      const sp = `${did}/${(await q(db, `select gen_random_uuid()::text u`))[0].u}.pdf`;
      await q(db, `insert into storage.objects(bucket_id,name,owner,metadata) values ('purchase-documents',$1,$2,'{"size":96000}')`, [sp, IDS.inventory]);
      await q(db, `insert into purchase_documents(branch_id,path,file_name,mime,size_bytes,distributor_id,doc_type,doc_date,uploaded_by,created_at) values ($1,$2,$3,'application/pdf',96000,$4,$5,(now() at time zone 'Asia/Kolkata')::date - $6::int,$7,now() - make_interval(days => $6::int))`,
        [IDS.branch, sp, `${dt}_${ago}.pdf`, did, dt, ago, IDS.inventory]);
    }
    void v1;
    // audit logs (0034): activity by different staff with IP addresses, some critical, plus logins / logouts
    {
      const pid = async sid => (await q(db, `select id from profiles where staff_id = $1`, [sid]))[0]?.id;
      const AUD = [
        ['EMP-001', 'stock_adjusted', 'medicine_batch', { name: 'Paracetamol 500 mg', qty: 1182 }, { qty: 1200 }, 'Damaged strips', 22, '192.168.1.15'],
        ['EMP-002', 'customer_created', 'customer', { name: 'Sunil Mathew', phone: '9847055501' }, null, null, 36, '192.168.1.18'],
        ['SA001', 'sales_return_deleted', 'sales_return', null, { return_no: 'RET-0067', total: 220 }, 'Entered twice', 38, '192.168.1.10'],
        ['EMP-003', 'medicine_price_updated', 'medicine', { name: 'Amoxicillin 500 mg', mrp: 98 }, { name: 'Amoxicillin 500 mg', mrp: 95 }, null, 48, '192.168.1.22'],
        ['EMP-004', 'purchase_confirmed', 'purchase_invoice', { supplier_invoice_no: 'PUR-0089', total: 24560 }, null, null, 73, '192.168.1.19'],
        ['EMP-005', 'settings_saved', 'settings', { low_stock_alerts: true }, { low_stock_alerts: false }, null, 97, '192.168.1.25'],
        ['SA001', 'report_exported', 'report', { name: 'Sales report (Last 7 days, PDF)' }, null, null, 114, '192.168.1.10'],
        ['EMP-001', 'billing_line_overrides', 'billing', { name: 'MRP override on INV-01451', mrp: 120 }, { mrp: 125 }, 'Old stock price', 190, '192.168.1.15'],
        ['EMP-007', 'customer_receipt_reversed', 'customer_receipt', { receipt_no: 'RCPT-0031', amount: 500 }, null, 'Cheque bounced', 260, '192.168.1.31'],
        ['EMP-005', 'staff_role_changed', 'staff', { name: 'Arjun Das', role: 'pharmacist' }, { role: 'billing_staff' }, null, 420, '192.168.1.25'],
        ['EMP-002', 'delivery_assigned', 'delivery', { name: 'INV-01440 to Sajid' }, null, null, 610, '192.168.1.18'],
        ['EMP-004', 'expense_posted', 'expense', { expense_no: 'EXP-0102', amount: 1850 }, null, null, 1500, '192.168.1.19'],
        ['SA001', 'whatsapp_settings_saved', 'whatsapp_settings', { signature: 'Pallikkal Pharmacy' }, null, null, 2900, '192.168.1.10']];
      for (const [sid, action, ent, after, before, reason, mins, ip] of AUD)
        await q(db, `insert into audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,before_data,reason,ip,at) values ($1,$2,$3,$4,null,$5,$6,$7,$8::inet,now() - make_interval(mins => $9::int))`,
          [IDS.branch, await pid(sid), action, ent, after && JSON.stringify(after), before && JSON.stringify(before), reason, ip, mins]);
      for (const [sid, mins, out, ip] of [['EMP-001', 30, null, '192.168.1.15'], ['EMP-002', 200, 60, '192.168.1.18'], ['EMP-003', 600, 300, '192.168.1.22'], ['EMP-005', 1600, 1200, '192.168.1.25'], ['EMP-004', 3000, 2500, '192.168.1.19']])
        await q(db, `insert into work_sessions(user_id,branch_id,work_date,login_at,last_activity_at,logout_at,logout_reason,ip) values ($1,$2,((now() - make_interval(mins => $3::int)) at time zone 'Asia/Kolkata')::date, now() - make_interval(mins => $3::int), now() - make_interval(mins => coalesce($4::int, 1)), case when $4::int is null then null else now() - make_interval(mins => $4::int) end, case when $4::int is null then null else 'manual' end, $5::inet)`,
          [await pid(sid), IDS.branch, mins, out, ip]).catch(e => console.warn('demo session', e.message));
      await q(db, `insert into login_attempts(staff_id, portal, success, reason, ip, at) values ('EMP-009','staff',false,'Invalid credentials','192.168.1.40', now() - interval '3 hours'),('ADMIN1','admin',false,'Unknown staff ID','103.21.4.7', now() - interval '5 hours'),('EMP-001','staff',true,null,'192.168.1.15', now() - interval '30 minutes')`).catch(e => console.warn('demo attempts', e.message));
    }
  }
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
    // PostgREST sends JSON arrays for array parameters (uuid[], text[]): pass them as Postgres arrays
    params.push(type.endsWith('[]') && Array.isArray(args[k]) ? args[k] : val(args[k]));
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
        // visitors (no session) run as the anon role, like the real PostgREST
        if (!b.user && (kind === 'query' || kind === 'rpc')) await db.exec('set role anon');
        if (kind === 'query') return await runQuery(b.q);
        if (kind === 'rpc') return await runRpc(b.name, b.args);
        if (kind === 'ownersql') { await asOwner(db); return { data: await q(db, b.sql, b.params || []), error: null }; }   // test-only cross-branch checks
        if (kind === 'storage') return await runStorage(b);
        if (kind === 'function') {
          if (b.name === 'admin-staff') {
            // Stand-in for the Edge Function (service role): list, create, reset_password.
            const body = b.body || {};
            const caller = (await q(db, `select p.branch_id, r.code from profiles p join roles r on r.id = p.role_id where p.id = $1`, [b.user]))[0];
            await asOwner(db);
            if (!caller || !['super_admin', 'admin'].includes(caller.code)) return { data: null, error: { message: 'Staff management is restricted to administrators.' } };
            if (body.action === 'create') {
              if (!/^[A-Za-z0-9._-]{3,32}$/.test(body.staff_id || '')) return { data: { error: 'Staff ID must be 3–32 letters, numbers, dots, underscores or hyphens.' }, error: null };
              if (String(body.password || '').length < 12) return { data: { error: 'Temporary password must be 12–128 characters.' }, error: null };
              if (body.role === 'admin' && caller.code !== 'super_admin') return { data: { error: 'Only Super Admin can create Admin accounts.' }, error: null };
              if ((await q(db, `select 1 from profiles where lower(staff_id::text) = lower($1)`, [body.staff_id])).length) return { data: { error: 'This Staff ID is already in use.' }, error: null };
              const uid = (await q(db, `insert into auth.users(id) values (gen_random_uuid()) returning id`))[0].id;
              const id = (await q(db, `insert into profiles(id,branch_id,staff_id,full_name,phone,role_id,is_active,must_change_password,created_by) select $7,$1,$2,$3,$4,id,true,true,$6 from roles where code=$5 returning id`,
                [caller.branch_id, body.staff_id, body.full_name, body.phone || null, body.role, b.user, uid]))[0].id;
              if (body.address || body.designation || body.join_date) await q(db, `insert into staff_details(profile_id,branch_id,address,designation,join_date) values ($1,$2,$3,$4,$5)`, [id, caller.branch_id, body.address || null, body.designation || null, body.join_date || null]).catch(() => {});
              await q(db, `insert into audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data) values ($1,$2,'staff_created','staff',$3,$4)`, [caller.branch_id, b.user, id, JSON.stringify({ staff_id: body.staff_id })]);
              return { data: { success: true, message: 'Staff account created successfully.', staff: { id, staff_id: body.staff_id } }, error: null };
            }
            if (body.action === 'reset_password') {
              if (String(body.password || '').length < 12) return { data: { error: 'Temporary password must be 12–128 characters.' }, error: null };
              if (body.profile_id === b.user) return { data: { error: 'Use Change password to change your own password.' }, error: null };
              await q(db, `update profiles set must_change_password = true where id = $1 and branch_id = $2`, [body.profile_id, caller.branch_id]);
              await q(db, `insert into audit_logs(branch_id,user_id,action,entity_type,entity_id) values ($1,$2,'staff_password_reset','staff',$3)`, [caller.branch_id, b.user, body.profile_id]);
              return { data: { success: true, message: 'Temporary password set. The staff member must change it at the next login.' }, error: null };
            }
            const staff = await q(db, `select p.id, p.staff_id, p.full_name, p.phone, r.code as role, r.name as role_name, p.is_active, p.must_change_password, p.created_at from profiles p join roles r on r.id = p.role_id where p.branch_id = $1`, [caller.branch_id]);
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
