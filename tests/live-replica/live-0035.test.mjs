// Migration 0035 on the live-schema replica: public site info (anonymous), opening hours / open now,
// offers expiry, medicine availability search (no quantities or prices), website settings save + validation.
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
await db.exec(mig('0035_public_website.sql'));
try { await db.exec(mig('0035_public_website.sql')); ok('0035 runs a second time', true); } catch (e) { ok('0035 runs a second time', false, e.message); }
await asOwner(db);
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
const anon = async (sql, p) => { await asUser(db, null); await db.exec('set role anon'); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
await q(db, `update branches set address='Pallikkal Road', city='Thrissur', pincode='680001', phone='9847000000', email='pharmacy@example.com', drug_licence_nos='["KL-TSR-20B-1"]' where id=$1`, [I.branch]);

let r = await anon(`select public_site_info() s`);
let s = r.rows?.[0]?.s || {};
ok('anonymous visitor reads site info', s.available === true && s.phone === '9847000000' && s.city === 'Thrissur' && s.drug_licence_nos[0] === 'KL-TSR-20B-1', r.error || JSON.stringify(s).slice(0, 300));
ok('defaults: hours for 7 days, delivery 5 km / ₹300, WhatsApp = phone', s.site.hours.length === 7 && +s.site.delivery.radius_km === 5 && +s.site.delivery.min_order === 300 && s.whatsapp === '9847000000');
ok('today and open-by-hours computed', s.today && typeof s.open_by_hours === 'boolean' && s.shop_open === s.open_by_hours && s.manual_status === false);
await q(db, `insert into branch_shop_status(branch_id,is_open) values ($1, true) on conflict (branch_id) do update set is_open = true`, [I.branch]);
s = (await anon(`select public_site_info() s`)).rows[0].s;
ok('counter Open / Closed switch wins', s.shop_open === true && s.manual_status === true);
r = await anon(`select * from pharmacy_settings`); ok('visitors cannot read settings tables', !!r.error || !r.rows.length);
r = await anon(`select website_settings_get()`); ok('visitors cannot read website settings', !!r.error);

// medicines
const m1 = (await one(`insert into medicines(branch_id,name,mrp,selling_price,strength,dosage_form,generic_name) values ($1,'Paracetamol 650',30,28,'650 mg','Tablet','Paracetamol') returning id`, [I.branch])).id;
await q(db, `insert into medicines(branch_id,name,mrp,selling_price,generic_name) values ($1,'Paracip 500',20,19,'Paracetamol')`, [I.branch]);
await q(db, `insert into medicine_batches(branch_id,medicine_id,batch_no,expiry,qty) values ($1,$2,'B1',current_date + 300, 40)`, [I.branch, m1]);
r = await anon(`select * from public_medicine_search('para')`);
ok('stock check: names with Available / not (no qty, no price)', r.rows?.length === 2 && r.rows.find(x => x.name === 'Paracetamol 650').available === true && r.rows.find(x => x.name === 'Paracip 500').available === false && !('qty' in r.rows[0]) && !('mrp' in r.rows[0]), r.error || JSON.stringify(r.rows));
r = await anon(`select * from public_medicine_search('pa')`); ok('needs at least 3 letters', r.rows?.length === 0);
r = await anon(`select * from public_medicine_search('%%%')`); ok('wildcards stripped', r.rows?.length === 0);

// settings
const base = { headline: 'Your Health. Our Priority.', hero_text: 'Care', about_text: 'About us', whatsapp: '+91 98470 11111',
  hours: [0, 1, 2, 3, 4, 5, 6].map(d => ({ day: d, open: '08:00', close: '21:00', closed: d === 0 })),
  delivery: { enabled: true, radius_km: 6, min_order: 250, note: 'Call first' },
  offers: [{ title: '10% off diabetes care', text: 'On selected products', tag: 'Offer', valid_till: '2099-12-31' }, { title: 'Expired deal', text: '', valid_till: '2000-01-01' }],
  ayurveda: { enabled: true, name: 'Pallikkal Ayurvedic Store', address: 'Pallikkal Road', phone: '9847022222', email: 'ayur@example.com', website: 'https://ayur.example' },
  socials: { facebook: 'https://facebook.com/pallikkal', instagram: '', youtube: '' }, images: {}, stock_check: true, show_drug_licence: false };
r = await as(I.pharmacist, `select website_settings_save($1::jsonb)`, [JSON.stringify(base)]); ok('pharmacist cannot change the website', /Not authorised/.test(r.error || ''), r.error);
r = await as(I.admin, `select website_settings_save($1::jsonb) s`, [JSON.stringify(base)]);
ok('admin saves website settings', r.rows?.[0]?.s.delivery.radius_km == 6 && r.rows[0].s.offers.length === 2, r.error);
s = (await anon(`select public_site_info() s`)).rows[0].s;
ok('public site: saved values, expired offer hidden, licence hidden, WhatsApp number', s.site.offers.length === 1 && s.site.offers[0].title === '10% off diabetes care' && s.drug_licence_nos.length === 0 && s.whatsapp === '+91 98470 11111' && s.site.ayurveda.email === 'ayur@example.com');
const bad = async (patch, re, label) => { const x = await as(I.admin, `select website_settings_save($1::jsonb)`, [JSON.stringify({ ...base, ...patch })]); ok(label, re.test(x.error || ''), x.error); };
await bad({ headline: 'x' }, /Headline/, 'headline validated');
await bad({ hours: base.hours.slice(0, 5) }, /all 7 days/, 'all 7 days needed');
await bad({ hours: base.hours.map(h => ({ ...h, closed: false, close: '07:00' })) }, /closing time/, 'closing after opening');
await bad({ whatsapp: '123' }, /WhatsApp/, 'WhatsApp number validated');
await bad({ offers: Array.from({ length: 13 }, (_, i) => ({ title: 'Offer ' + i })) }, /12 offers/, 'max 12 offers');
await bad({ socials: { facebook: 'http://x' } }, /https/, 'social links must be https');
await bad({ images: { hero: 'other/x.jpg' } }, /not uploaded/, 'photo must be uploaded for this branch');
await q(db, `insert into storage.objects(bucket_id,name) values ('pharmacy-branding',$1)`, [`${I.branch}/hero.jpg`]);
r = await as(I.admin, `select website_settings_save($1::jsonb) s`, [JSON.stringify({ ...base, images: { hero: `${I.branch}/hero.jpg` } })]);
ok('photo saved', r.rows?.[0]?.s.images.hero === `${I.branch}/hero.jpg`, r.error);
r = await as(I.admin, `select website_settings_save($1::jsonb)`, [JSON.stringify({ ...base, stock_check: false })]);
r = await anon(`select * from public_medicine_search('para')`); ok('stock check can be switched off', r.rows?.length === 0);
ok('website change audited', (await one(`select count(*)::int n from audit_logs where entity_id='website'`)).n >= 3);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
