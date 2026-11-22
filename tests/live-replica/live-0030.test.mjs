// Migration 0030 on the live-schema replica: WhatsApp invoice links (public page), message queue,
// conversations, campaigns, templates, settings, reminders and roles.
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
await db.exec(mig('0030_whatsapp_management.sql'));
try { await db.exec(mig('0030_whatsapp_management.sql')); ok('0030 runs a second time', true); } catch (e) { ok('0030 runs a second time', false, e.message); }
await asOwner(db);
const today = (await one(`select (now() at time zone 'Asia/Kolkata')::date::text d`)).d;
const dist = (await one(`insert into distributors(branch_id,name) values ($1,'Dist A') returning id`, [I.branch])).id;
const med = (await one(`insert into medicines(branch_id,name,strength,mrp,selling_price,tax_rate) values ($1,'Dolo','650 mg',30,30,12) returning id`, [I.branch])).id;
const ravi = (await one(`insert into customers(branch_id,name,phone,consent,credit_limit) values ($1,'Ravi Kumar','98470 00301',true,5000) returning id`, [I.branch])).id;
const meena = (await one(`insert into customers(branch_id,name,phone,consent,credit_limit) values ($1,'Meena','9847000302',false,5000) returning id`, [I.branch])).id;
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
await asUser(db, I.superAdmin);
await q(db, `select confirm_purchase_v2($1::jsonb,$2::jsonb,null,null)`, [JSON.stringify({ distributor_id: dist, invoice_no: 'PB-1', invoice_date: today, discount: 0, freight: 0, round_off: 0 }),
  JSON.stringify([{ medicine_id: med, batch_no: 'X1', expiry: '2028-06-30', qty: 10, pack: 10, price: 150, tax_rate: 12, discount: 0, mrp: 300 }])]);
const sell = async (cart, qty, pays, customer = null) => {
  await asUser(db, I.billing);
  const a = (await one(`select billing_allocate($1,$2,$3) a`, [cart, med, qty])).a;
  let t = 0; for (const x of a.rows) t += +(await one(`select total_amount from billing_calc_line($1,$2,$3,$4,$5)`, [x.mrp, x.qty, x.default_discount_pct, x.tax_rate, x.price_includes_tax])).total_amount;
  t = Math.round(t * 100) / 100;
  const id = (await one(`select finalize_sale_v3($1,$2::jsonb,$4::jsonb,0,$3,null,null) id`, [customer, JSON.stringify(a.rows.map(x => ({ batch_id: x.batch_id, qty: x.qty }))), cart, JSON.stringify(pays(t))])).id;
  await asOwner(db); return [id, t];
};
const [s1, t1] = await sell('11111111-0000-0000-0000-0000000000d1', 2, t => [{ method: 'cash', amount: t }], ravi);
const [s2] = await sell('11111111-0000-0000-0000-0000000000d2', 1, t => [{ method: 'cash', amount: t }]);
const [s3, t3] = await sell('11111111-0000-0000-0000-0000000000d3', 3, () => [], meena);
const no1 = (await one(`select invoice_no from sales_invoices where id=$1`, [s1])).invoice_no;

// invoice link + message
let r = await as(I.billing, `select whatsapp_queue_invoice($1, 'https://shop.example/app/billing.html?x=1') j`, [s1]);
const j = r.rows?.[0]?.j || {};
ok('billing staff prepares the invoice message right after the bill', j.status === 'queued' && j.phone === '919847000301' && j.body.includes(no1) && j.body.includes('Ravi') && /₹[\d,]+\.\d\d/.test(j.body), r.error || JSON.stringify(j));
ok('message carries a private invoice link (64-hex token)', /^https:\/\/shop\.example\/app\/invoice-view\.html\?t=[0-9a-f]{64}$/.test(j.link) && j.body.includes(j.link), j.link);
ok('hosting address remembered in settings', (await one(`select base_url from whatsapp_settings`)).base_url === 'https://shop.example/app/');
r = await as(I.billing, `select whatsapp_queue_invoice($1, null) j`, [s1]);
ok('preparing again returns the same message (no duplicates)', r.rows[0].j.id === j.id && r.rows[0].j.already === true && (await q(db, `select 1 from whatsapp_messages where kind='invoice'`)).length === 1);
r = await as(I.billing, `select whatsapp_queue_invoice($1, null) j`, [s2]);
ok('walk-in bill without a phone → no_phone, nothing queued', r.rows?.[0]?.j?.status === 'no_phone', r.error || JSON.stringify(r.rows));
await q(db, `update sales_invoices set patient_phone='9847000399', patient_name='Anu' where id=$1`, [s2]);
r = await as(I.billing, `select whatsapp_queue_invoice($1, null) j`, [s2]);
ok('walk-in with patient phone → queued to the patient (link uses remembered address)', r.rows?.[0]?.j?.phone === '919847000399' && r.rows[0].j.link.startsWith('https://shop.example/app/invoice-view.html?t='), JSON.stringify(r.rows?.[0]?.j));
// public page
await db.exec(`reset role; set role anon`);
let pub;
try { pub = (await q(db, `select public_invoice($1) p`, [j.token]))[0].p; } catch (e) { pub = { error: e.message }; }
await asOwner(db);
ok('public invoice opens without login (anon)', pub?.invoice?.invoice_no === no1 && +pub.invoice.total === t1 && pub.items.length >= 1 && pub.items[0].name === 'Dolo', JSON.stringify(pub).slice(0, 300));
ok('public invoice masks the phone and hides diagnosis / doctor / address', pub?.customer?.phone === '******0301' && !('diagnosis' in pub.invoice) && !('doctor_name' in pub.invoice) && !('patient_address' in pub.invoice));
ok('link views counted', (await one(`select views from invoice_share_links where token=$1`, [j.token])).views === 1);
await db.exec(`reset role; set role anon`);
let bad; try { await q(db, `select public_invoice($1)`, ['0'.repeat(64)]); bad = 'no error'; } catch (e) { bad = e.message; }
let anonOv; try { await q(db, `select whatsapp_overview(current_date, current_date)`); anonOv = 'no error'; } catch (e) { anonOv = e.message; }
await asOwner(db);
ok('unknown token refused', /not valid/.test(bad), bad);
ok('anon cannot read anything else (overview)', /permission denied/.test(anonOv), anonOv);
r = await as(I.billing, `select whatsapp_invoice_link_revoke($1)`, [s1]);
ok('billing staff cannot revoke links (admin only)', /Not authorised/.test(r.error || ''), r.error);
r = await as(I.superAdmin, `select whatsapp_invoice_link_revoke($1) n`, [s1]);
let rev; try { await q(db, `select public_invoice($1)`, [j.token]); rev = 'opened'; } catch (e) { rev = e.message; }
ok('revoked link no longer opens', r.rows?.[0]?.n === 1 && /expired/.test(rev), rev);

// mark sent → overview
r = await as(I.billing, `select whatsapp_mark(array[$1]::uuid[], 'sent') n`, [j.id]);
ok('tap to send marks the message Sent (time + staff)', r.rows?.[0]?.n === 1 && (await one(`select sent_by from whatsapp_messages where id=$1`, [j.id])).sent_by === I.billing, r.error);
r = await as(I.superAdmin, `select whatsapp_overview($1::date,$1::date) o`, [today]);
let o = r.rows?.[0]?.o || {};
ok('overview: 1 sent, 3 bills (all with a phone), 1 shared, 1 pending invoice', o.sent === 1 && o.bills === 3 && o.bills_with_phone === 3 && o.bills_shared === 1 && o.pending === 1 && o.pending_invoices === 1, r.error || JSON.stringify(o));

// messages
r = await as(I.billing, `select whatsapp_queue_message($1,null,null,'offer','Hi {{name}}',null,null,null,'{}') m`, [meena]);
ok('offer to a customer without consent is refused', /not agreed/.test(r.error || ''), r.error);
r = await as(I.billing, `select whatsapp_queue_message(null,'12345',null,'custom','Hello',null,null,null,'{}') m`);
ok('invalid number refused', /valid WhatsApp number/.test(r.error || ''), r.error);
r = await as(I.billing, `select whatsapp_queue_message($1,null,null,'order_update','Your order is ready',$2,null,null,'{}') m`, [ravi, s1]);
const upd = r.rows?.[0]?.m;
ok('order update queued for the customer and bill', upd?.phone === '919847000301' && !r.error, r.error);
r = await as(I.billing, `select whatsapp_log_reply('9847000301','Is Paracetamol 500 in stock?') id`);
ok('customer reply logged and linked to the customer', !r.error && (await one(`select customer_id, direction, status from whatsapp_messages where id=$1`, [r.rows[0].id])).customer_id === ravi, r.error);
r = await as(I.billing, `select * from whatsapp_conversations(null, 10)`);
const cv = (r.rows || []).find(x => x.phone === '919847000301') || {};
ok('conversations: Ravi first, last message is his reply, 1 pending, 1 reply', r.rows?.[0]?.phone === '919847000301' && cv.last_direction === 'in' && cv.pending === 1 && cv.replies === 1 && cv.name === 'Ravi Kumar', r.error || JSON.stringify(r.rows));
r = await as(I.billing, `select * from whatsapp_conversations('anu', 10)`);
ok('conversations: search by name', r.rows?.length === 1 && r.rows[0].name === 'Anu', JSON.stringify(r.rows));
r = await as(I.billing, `select * from whatsapp_thread('9847000301')`);
ok('thread has 3 messages, newest first', r.rows?.length === 3 && r.rows[0].direction === 'in', r.error || JSON.stringify(r.rows?.map(x => x.kind)));
r = await as(I.billing, `select * from whatsapp_activity($1::date,$1::date,null,null,'ravi',50,0)`, [today]);
ok('activity: search, total count, invoice number', r.rows?.length === 3 && +r.rows[0].total_count === 3 && r.rows.some(x => x.invoice_no === no1), r.error || JSON.stringify(r.rows));
r = await as(I.billing, `select * from whatsapp_bills($1::date,$1::date,true)`, [today]);
ok('bills not yet shared: excludes the shared bill, includes Meena and the patient bill', r.rows?.length === 2 && !r.rows.some(x => x.invoice_id === s1), r.error || JSON.stringify(r.rows));

// campaigns
r = await as(I.billing, `select whatsapp_campaign_create('X','',  'offer','Hi',null,null,120,array[$1]::uuid[])`, [ravi]);
ok('billing staff cannot create campaigns', /only Admin/.test(r.error || ''), r.error);
r = await as(I.superAdmin, `select whatsapp_campaign_create('Winter Health Offer','Up to 20% off','offer','Hello {{name}}, 20% off at {{shop}}!','https://cdn.example/offer.jpg',null,60,array[$1,$2]::uuid[]) id`, [ravi, meena]);
const camp = r.rows?.[0]?.id;
const cq = (await as(I.superAdmin, `select * from whatsapp_campaign_queue($1)`, [camp])).rows || [];
ok('offer campaign: only consented customers, personalised, photo link added', cq.length === 1 && cq[0].body.startsWith('Hello Ravi, 20% off at PALLIKKAL MEDICALS!') && cq[0].body.includes('https://cdn.example/offer.jpg'), r.error || JSON.stringify(cq));
r = await as(I.superAdmin, `select whatsapp_campaign_create('Dues','','payment_reminder','Hi {{name}}, ₹{{due}} is pending',null,null,60,array[$1]::uuid[]) id`, [meena]);
const dq = (await as(I.superAdmin, `select * from whatsapp_campaign_queue($1)`, [r.rows?.[0]?.id])).rows || [];
ok(`payment reminder campaign reaches dues customers and fills the due (₹${t3})`, dq.length === 1 && dq[0].body.includes(t3.toFixed(2)), r.error || JSON.stringify(dq));
r = await as(I.billing, `select whatsapp_mark(array[$1]::uuid[], 'sent') n`, [cq[0].id]);
let cl = (await as(I.superAdmin, `select * from whatsapp_campaigns_list(10)`)).rows || [];
const c1 = cl.find(x => x.id === camp) || {};
ok('campaign completes when every message is sent (Sent: 1)', c1.status === 'completed' && c1.sent === 1 && c1.queued === 0, JSON.stringify(c1));
r = await as(I.superAdmin, `select whatsapp_campaign_status($1,'paused')`, [camp]);
ok('completed campaign cannot be paused', /already completed/.test(r.error || ''), r.error);
const dues = cl.find(x => x.name === 'Dues');
r = await as(I.superAdmin, `select whatsapp_campaign_status($1,'paused') s`, [dues.id]);
ok('pause a running campaign', r.rows?.[0]?.s === 'paused', r.error);
r = await as(I.superAdmin, `select whatsapp_campaign_status($1,'cancelled') s`, [dues.id]);
ok('cancel: remaining messages skipped', r.rows?.[0]?.s === 'cancelled' && (await one(`select status from whatsapp_messages where campaign_id=$1`, [dues.id])).status === 'skipped', r.error);

// templates & settings
r = await as(I.billing, `select * from whatsapp_templates_list()`);
ok('8 ready templates (invoice, order, delivery, payment, refill, offer, health)', r.rows?.length === 8 && r.rows[0].code === 'invoice', r.error || r.rows?.length);
const tInv = r.rows.find(x => x.code === 'invoice');
r = await as(I.billing, `select whatsapp_template_save($1,'Invoice','invoice','x',true)`, [tInv.id]);
ok('billing staff cannot edit templates', /only Admin/.test(r.error || ''), r.error);
r = await as(I.superAdmin, `select whatsapp_template_save($1,'Invoice','invoice','Bill {{order_no}} ₹{{amount}} {{link}}',true)`, [tInv.id]);
r = await as(I.billing, `select whatsapp_queue_invoice($1, null) j`, [s3]);
ok('edited invoice template used for the next bill', r.rows?.[0]?.j?.body.startsWith('Bill ') && r.rows[0].j.body.includes(t3.toFixed(2)), r.error || JSON.stringify(r.rows?.[0]));
r = await as(I.superAdmin, `select whatsapp_template_delete($1)`, [tInv.id]);
ok('"delete" on a ready template resets its text', (await one(`select body = default_body s from whatsapp_templates where id=$1`, [tInv.id])).s === true);
r = await as(I.superAdmin, `select whatsapp_template_save(null,'Festival','offer','Happy Onam {{name}}!',true) id`);
const tc = r.rows?.[0]?.id;
r = await as(I.superAdmin, `select whatsapp_template_delete($1)`, [tc]);
ok('own template created and deleted', tc && !r.error && (await q(db, `select 1 from whatsapp_templates where id=$1`, [tc])).length === 0, r.error);
r = await as(I.superAdmin, `select whatsapp_settings_save(false, false, true, '— Pallikkal Pharmacy, Ph 0471-2000000') s`);
ok('admin saves settings (logged in audit)', r.rows?.[0]?.s?.auto_invoice === false && (await q(db, `select 1 from audit_logs where action='whatsapp_settings_saved'`)).length === 1, r.error);
r = await as(I.billing, `select whatsapp_queue_message(null,'9847000500','Guest','custom','Hello there',null,null,null,'{}') m`);
ok('signature added to every message', r.rows?.[0]?.m?.body.endsWith('— Pallikkal Pharmacy, Ph 0471-2000000'), JSON.stringify(r.rows?.[0]));
r = await as(I.billing, `select whatsapp_settings_save(true,true,true,null)`);
ok('billing staff cannot change settings', /only Admin/.test(r.error || ''), r.error);

// reminders
r = await as(I.billing, `select * from whatsapp_due_customers()`);
ok('payment reminders: Meena owes the credit bill', r.rows?.length === 1 && r.rows[0].customer_id === meena && +r.rows[0].outstanding === t3, r.error || JSON.stringify(r.rows));
await q(db, `update sales_invoices set created_at = now() - interval '30 days' where id=$1`, [s3]);
r = await as(I.billing, `select * from whatsapp_refill_candidates(30, 3)`);
ok('refill reminder: Meena\'s Dolo 650 mg bought 30 days ago is due', r.rows?.length === 1 && r.rows[0].customer_id === meena && r.rows[0].medicine === 'Dolo 650 mg' && r.rows[0].days_since === 30 && r.rows[0].reminded_at === null, r.error || JSON.stringify(r.rows));
r = await as(I.billing, `select whatsapp_queue_message($1,null,null,'refill_reminder','Refill Dolo',null,null,null,$2::jsonb) m`, [meena, JSON.stringify({ medicine_id: med })]);
await as(I.billing, `select whatsapp_mark(array[$1]::uuid[], 'sent')`, [r.rows[0].m.id]);
r = await as(I.billing, `select * from whatsapp_refill_candidates(30, 3)`);
ok('refill reminder recorded against that medicine', r.rows?.[0]?.reminded_at !== null, JSON.stringify(r.rows));
r = await as(I.billing, `select whatsapp_mark(array[$1]::uuid[], 'queued') n`, [j.id]);
ok('a sent message can be put back in the queue', r.rows?.[0]?.n === 1 && (await one(`select status, sent_at from whatsapp_messages where id=$1`, [j.id])).sent_at === null);

// roles & privacy
r = await as(I.pharmacist, `select whatsapp_queue_message($1,null,null,'custom','Hi',null,null,null,'{}') m`, [ravi]);
ok('pharmacist can send customer messages', !r.error, r.error);
r = await as(I.inventory, `select * from whatsapp_conversations(null, 5)`);
ok('inventory staff cannot read WhatsApp', /Not authorised/.test(r.error || ''), r.error);
r = await q(db, `select has_table_privilege('authenticated','whatsapp_messages','select') a, has_table_privilege('anon','invoice_share_links','select') b`);
ok('tables only through the functions', r[0].a === false && r[0].b === false, JSON.stringify(r));
r = await q(db, `select count(*)::int n from storage.buckets where id='whatsapp-media' and public`);
ok('whatsapp-media bucket for offer photos', r[0].n === 1);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
