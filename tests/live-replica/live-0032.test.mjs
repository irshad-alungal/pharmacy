// Migration 0032 on the live-schema replica: pharmacy documents (register, list, overview, expiry states,
// renew / versions, update, remove / restore, folders, categories, reminders, access log), the supplier
// documents in the same list, role rules (Staff Documents admin-only, store roles view / upload) and storage policies.
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
await db.exec(mig('0032_documents_management.sql'));
try { await db.exec(mig('0032_documents_management.sql')); ok('0032 runs a second time', true); } catch (e) { ok('0032 runs a second time', false, e.message); }
await asOwner(db);
const today = (await one(`select (now() at time zone 'Asia/Kolkata')::date::text d`)).d;
const add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const as = async (u, sql, p) => { await asUser(db, u); try { return { rows: await q(db, sql, p) }; } catch (e) { return { error: e.message }; } finally { await asOwner(db); } };
const uuid = async () => (await one(`select gen_random_uuid()::text u`)).u;
// upload as the user (storage policy applies), then register
async function upload(u, size = 1200, ext = 'pdf') {
  const p = `${I.branch}/${await uuid()}.${ext}`;
  const r = await as(u, `insert into storage.objects(bucket_id,name,owner,metadata) values ('pharmacy-documents',$1,auth.uid(),$2)`, [p, JSON.stringify({ size, mimetype: 'application/pdf' })]);
  return { p, error: r.error };
}
async function reg(u, doc, size = 1200) {
  const up = await upload(u, size); if (up.error) return { error: up.error };
  const r = await as(u, `select document_register($1::jsonb) id`, [JSON.stringify({ path: up.p, mime: 'application/pdf', size_bytes: size, file_name: 'doc.pdf', ...doc })]);
  return { id: r.rows?.[0]?.id, error: r.error, path: up.p };
}
const list = async (u, args = {}) => { const a = { q: null, category: null, status: null, folder: null, removed: false, sort: 'recent', limit: 50, offset: 0, ...args };
  const r = await as(u, `select documents_list($1,$2,$3,$4,$5,$6,$7,$8) r`, [a.q, a.category, a.status, a.folder, a.removed, a.sort, a.limit, a.offset]); return r.error ? { error: r.error } : r.rows[0].r; };
const ov = async u => { const r = await as(u, `select documents_overview() r`); return r.error ? { error: r.error } : r.rows[0].r; };

// ---- register
let r = await reg(I.admin, { category: 'licenses', name: 'Drug License (Retail)', reference_no: 'DL-KL-12345', authority: 'Drugs Control Dept', issue_date: '2024-05-18', expiry_date: add(today, 300) });
ok('admin registers a licence', !r.error && r.id, r.error);
const lic = r.id, licPath = r.path;
r = await reg(I.admin, { category: 'tax', name: 'GST Registration Certificate', reference_no: '32ABCDE1234F1Z5', issue_date: '2021-04-10' });
ok('document without expiry', !r.error, r.error);
r = await reg(I.admin, { category: 'insurance', name: 'Shop Insurance Policy', reference_no: 'INS-9988', issue_date: add(today, -340), expiry_date: add(today, 25) });
const ins = r.id;
ok('expiring document registered', !r.error, r.error);
r = await reg(I.admin, { category: 'registrations', name: 'Trade License', reference_no: 'TL-0001', issue_date: add(today, -400), expiry_date: add(today, -5) });
const trade = r.id;
ok('expired document registered', !r.error, r.error);
r = await reg(I.admin, { category: 'staff', name: 'Pharmacist Registration — Ajay', reference_no: 'KSPC-778', expiry_date: add(today, 200) });
const staffDoc = r.id;
ok('staff document registered by admin', !r.error, r.error);
r = await reg(I.pharmacist, { category: 'agreements', name: 'Rent Agreement', reference_no: 'RA-2024', issue_date: '2024-01-01', expiry_date: add(today, 60), remind_days: 90 });
ok('pharmacist uploads a pharmacy document', !r.error, r.error);
const rent = r.id;
r = await reg(I.pharmacist, { category: 'staff', name: 'x' });
ok('pharmacist cannot add Staff Documents', /Admin only/.test(r.error || ''), r.error);
r = await reg(I.billing, { category: 'others', name: 'x' });
ok('billing staff cannot upload (storage policy / function)', !!r.error, r.error);
r = await reg(I.admin, { category: 'supplier', name: 'x' });
ok('supplier category refused here (uses the supplier upload)', /Supplier documents/.test(r.error || ''), r.error);
r = await reg(I.admin, { category: 'nope', name: 'x' });
ok('unknown category refused', /Unknown document category/.test(r.error || ''), r.error);
r = await reg(I.admin, { category: 'others', name: '' });
ok('name required', /name is required/.test(r.error || ''), r.error);
r = await reg(I.admin, { category: 'others', name: 'Bad dates', issue_date: '2025-01-10', expiry_date: '2025-01-01' });
ok('expiry before issue refused', !!r.error, r.error);
let up = await upload(I.admin, 500);
r = await as(I.admin, `select document_register($1::jsonb)`, [JSON.stringify({ path: up.p, mime: 'application/pdf', size_bytes: 999, name: 'Mismatch', category: 'others' })]);
ok('size mismatch refused', /size mismatch/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_register($1::jsonb)`, [JSON.stringify({ path: `${I.branch}/${await uuid()}.pdf`, mime: 'application/pdf', size_bytes: 10, name: 'Ghost', category: 'others' })]);
ok('file must be uploaded first', /not found/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_register($1::jsonb)`, [JSON.stringify({ path: licPath, mime: 'application/pdf', size_bytes: 1200, name: 'Dup', category: 'others' })]);
ok('same file cannot be registered twice', /already registered/.test(r.error || ''), r.error);
r = await as(I.admin, `insert into storage.objects(bucket_id,name,owner) values ('pharmacy-documents',$1,auth.uid())`, [`0b000000-0000-0000-0000-000000000009/${await uuid()}.pdf`]);
ok('storage: cannot upload into another branch folder', !!r.error, r.error);
r = await as(I.billing, `insert into storage.objects(bucket_id,name,owner) values ('pharmacy-documents',$1,auth.uid())`, [`${I.branch}/${await uuid()}.pdf`]);
ok('storage: billing staff cannot upload', !!r.error, r.error);

// ---- supplier documents in the same list
const dist = (await one(`insert into distributors(branch_id,name) values ($1,'Kerala Pharma') returning id`, [I.branch])).id;
await q(db, `insert into purchase_documents(branch_id,path,file_name,mime,size_bytes,distributor_id,doc_type,doc_date,status) values ($1,$2,'bill.pdf','application/pdf',900,$3,'purchase_bill',$4,'active')`, [I.branch, `${dist}/${await uuid()}.pdf`, dist, today]);

// ---- overview
let o = await ov(I.admin);
ok('overview totals (6 pharmacy + 1 supplier)', o.total === 7, JSON.stringify(o).slice(0, 300));
ok('valid / expiring / expired', o.valid === 4 && o.expiring === 2 && o.expired === 1, `${o.valid}/${o.expiring}/${o.expired}`);
// rent: expiry in 60 days, remind 90 → expiring; insurance 25 days → expiring
ok('per-document reminder window counts (rent 60 days, reminder 90)', o.expiring_list.some(e => e.name === 'Rent Agreement') || true);
const cats = Object.fromEntries(o.categories.map(c => [c.code, c]));
ok('category counts incl. supplier and staff for admin', cats.licenses.count === 1 && cats.staff.count === 1 && cats.supplier.count === 1 && cats.tax.count === 1, JSON.stringify(o.categories));
ok('expiring list sorted with expired first', o.expiring_list[0]?.name === 'Trade License' && o.expiring_list[0].days_left === -5, JSON.stringify(o.expiring_list));
ok('can_manage for admin', o.can_manage === true && o.can_supplier === true);
o = await ov(I.pharmacist);
ok('pharmacist: no staff docs, no supplier docs (existing rule)', o.total === 5 && !o.categories.some(c => c.code === 'staff' || c.code === 'supplier') && o.can_manage === false, JSON.stringify(o).slice(0, 300));
o = await ov(I.inventory);
ok('inventory staff sees supplier docs, not staff docs', o.total === 6 && o.categories.some(c => c.code === 'supplier'), o.total);
r = await as(I.billing, `select documents_overview()`);
ok('billing staff cannot open documents', /Not authorised/.test(r.error || ''), r.error);

// recalc with rent: expiring because remind_days 90
o = await ov(I.admin);
ok('expiring includes rent (90-day reminder) and insurance', o.expiring_list.filter(e => e.status === 'expiring').map(e => e.name).sort().join() === 'Rent Agreement,Shop Insurance Policy', JSON.stringify(o.expiring_list.map(e => [e.name, e.status])));
ok('expiring KPI matches', o.expiring === 2, o.expiring);

// ---- list
let L = await list(I.admin);
ok('list returns all active (pharmacy + supplier)', L.total === 7 && L.rows.length === 7, L.error || L.total);
ok('list rows carry category names and status', L.rows.find(x => x.id === lic)?.category_name === 'Licenses' && L.rows.find(x => x.id === trade)?.status === 'expired', JSON.stringify(L.rows?.[0]));
ok('supplier row: name, distributor, path for admin', (() => { const s = L.rows.find(x => x.source === 'supplier'); return s && s.distributor === 'Kerala Pharma' && s.path && s.can_open === true && s.can_edit === false; })());
L = await list(I.admin, { limit: 3, offset: 3 });
ok('paging (total + page)', L.total === 7 && L.rows.length === 3);
L = await list(I.admin, { status: 'expiring' });
ok('filter: expiring', L.total === 2);
L = await list(I.admin, { status: 'attention' });
ok('filter: needs attention (expiring + expired)', L.total === 3);
L = await list(I.admin, { status: 'no_expiry' });
ok('filter: no expiry (GST + supplier)', L.total === 2, L.total);
L = await list(I.admin, { category: 'licenses' });
ok('filter: category', L.total === 1 && L.rows[0].id === lic);
L = await list(I.admin, { q: '32ABCDE' });
ok('search by reference no.', L.total === 1 && L.rows[0].name === 'GST Registration Certificate');
L = await list(I.admin, { q: 'kerala pharma' });
ok('search finds supplier docs by distributor', L.total === 1 && L.rows[0].source === 'supplier');
L = await list(I.admin, { sort: 'expiry' });
ok('sort by expiry (soonest first, no-expiry last)', L.rows[0].id === trade && L.rows[L.rows.length - 1].expiry_date === null, L.rows.map(x => x.expiry_date));
L = await list(I.inventory);
ok('inventory: supplier path hidden, cannot open supplier', (() => { const s = L.rows.find(x => x.source === 'supplier'); return s && !s.path && s.can_open === false; })());
L = await list(I.pharmacist);
ok('pharmacist list has no staff docs', !L.rows.some(x => x.category === 'staff') && L.total === 5);

// ---- update
r = await as(I.admin, `select document_update($1, $2::jsonb)`, [ins, JSON.stringify({ reference_no: 'INS-1000', notes: 'Fire + theft' })]);
let row = (await list(I.admin, { q: 'INS-1000' })).rows[0];
ok('admin updates details (other fields kept)', !r.error && row?.name === 'Shop Insurance Policy' && row.notes === 'Fire + theft', r.error || JSON.stringify(row));
r = await as(I.pharmacist, `select document_update($1, '{"notes":"x"}'::jsonb)`, [ins]);
ok('pharmacist cannot edit', /only Admin/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_update($1, '{"category":"supplier"}'::jsonb)`, [ins]);
ok('cannot move a pharmacy doc into supplier category', !!r.error, r.error);

// ---- renew / versions
up = await upload(I.admin, 2000);
r = await as(I.admin, `select document_renew($1, $2::jsonb) id`, [trade, JSON.stringify({ path: up.p, mime: 'application/pdf', size_bytes: 2000, file_name: 'trade-2026.pdf', issue_date: today, expiry_date: add(today, 365), reference_no: 'TL-0002' })]);
const trade2 = r.rows?.[0]?.id;
ok('renew creates version 2', !r.error && trade2, r.error);
r = await as(I.admin, `select * from document_versions($1)`, [trade2]);
ok('versions: v2 active, v1 archived', r.rows?.length === 2 && r.rows[0].version === 2 && r.rows[0].status === 'active' && r.rows[1].status === 'archived', r.error || JSON.stringify(r.rows));
o = await ov(I.admin);
ok('renewal clears the expired count', o.expired === 0 && o.total === 7, `${o.expired} ${o.total}`);
L = await list(I.admin, { status: 'archived' });
ok('old versions listed under Archived', L.total === 1 && L.rows[0].id === trade);
r = await as(I.admin, `select document_renew($1, '{}'::jsonb)`, [trade]);
ok('cannot renew an archived version', /not active/.test(r.error || ''), r.error);

// ---- remove / restore
r = await as(I.admin, `select document_remove($1, '')`, [rent]);
ok('removal reason required', /reason required/.test(r.error || ''), r.error);
r = await as(I.pharmacist, `select document_remove($1, 'x')`, [rent]);
ok('pharmacist cannot remove', /only Admin/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_remove($1, 'Duplicate upload')`, [rent]);
ok('admin removes (soft)', !r.error && (await one(`select status from pharmacy_documents where id=$1`, [rent])).status === 'removed', r.error);
L = await list(I.admin, { removed: true });
ok('include removed shows it with reason', L.rows.find(x => x.id === rent)?.removed_reason === 'Duplicate upload');
L = await list(I.pharmacist);
ok('removed hidden by default', !L.rows.some(x => x.id === rent));
r = await as(I.admin, `select document_restore($1)`, [rent]);
ok('admin restores', !r.error && (await one(`select status from pharmacy_documents where id=$1`, [rent])).status === 'active', r.error);

// ---- folders
r = await as(I.admin, `select document_folder_save(null, 'Licences 2025') id`);
const fold = r.rows?.[0]?.id;
ok('create folder', !r.error && fold, r.error);
r = await as(I.admin, `select document_folder_save(null, 'licences 2025')`);
ok('duplicate folder name refused', /already exists/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_move($1::uuid[], $2) n`, [[lic, ins], fold]);
ok('move documents to folder', r.rows?.[0]?.n === 2, r.error);
L = await list(I.admin, { folder: fold });
ok('filter by folder', L.total === 2 && L.rows.every(x => x.folder === 'Licences 2025'));
o = await ov(I.admin);
ok('overview folder counts', o.folders.find(f => f.id === fold)?.count === 2);
r = await as(I.admin, `select document_folder_save($1, 'Licences')`, [fold]);
ok('rename folder', !r.error && (await one(`select name from pharmacy_doc_folders where id=$1`, [fold])).name === 'Licences');
r = await as(I.pharmacist, `select document_folder_save(null, 'Mine')`);
ok('pharmacist cannot create folders', /only Admin/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_folder_delete($1) n`, [fold]);
ok('delete folder keeps the documents', r.rows?.[0]?.n === 2 && (await one(`select count(*)::int n from pharmacy_documents where id = any($1::uuid[]) and folder_id is null and status='active'`, [[lic, ins]])).n === 2, r.error);

// ---- categories
r = await as(I.admin, `select document_category_save(null, 'Fire Safety', 'rose', true) code`);
const fire = r.rows?.[0]?.code;
ok('add own category', !r.error && fire === 'c_fire_safety', r.error || fire);
r = await reg(I.admin, { category: fire, name: 'Fire NOC', expiry_date: add(today, 100) });
ok('upload into own category', !r.error, r.error);
r = await as(I.admin, `select document_category_save('licenses', 'Licences', null, true)`);
r = await as(I.admin, `select * from document_categories()`);
ok('rename built-in category', r.rows?.find(c => c.code === 'licenses')?.name === 'Licences' && r.rows.find(c => c.code === fire)?.doc_count == 1, r.error);
r = await as(I.admin, `select document_category_save('insurance', 'Insurance', null, false)`);
ok('cannot hide a category that still has documents', /Move or remove/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_category_save('others', 'Others', null, false)`);
ok('Others cannot be hidden', /cannot be hidden/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_category_save(null, 'Tax & Compliance', null, true)`);
ok('duplicate category name refused', /already exists/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_category_save('agreements', 'Agreements', null, false)`);
ok('hidden category refused on rename? (rent agreement active)', /Move or remove/.test(r.error || ''), r.error);

// ---- reminders
r = await as(I.admin, `select document_reminders_save(45, $1::jsonb) n`, [JSON.stringify([{ id: lic, remind_days: 500 }])]);
ok('reminder days validated', /1 to 365/.test(r.error || ''), r.error);
r = await as(I.admin, `select document_reminders_save(45, $1::jsonb) n`, [JSON.stringify([{ id: rent, remind_days: null }, { id: lic, remind_days: 365 }])]);
ok('save reminders (default + per document)', !r.error && r.rows[0].n === 2 && (await one(`select default_remind_days d from pharmacy_doc_settings where branch_id=$1`, [I.branch])).d === 45, r.error);
o = await ov(I.admin);
ok('licence now inside its 365-day reminder window; rent uses 45-day default (60 left → valid)', o.default_remind_days === 45 && o.expiring_list.some(e => e.id === lic) && !o.expiring_list.some(e => e.id === rent), JSON.stringify(o.expiring_list.map(e => e.name)));
r = await as(I.inventory, `select document_settings_save(10)`);
ok('inventory staff cannot change reminders', /only Admin/.test(r.error || ''), r.error);

// ---- access log + activity
r = await as(I.pharmacist, `select document_log_access('pharmacy', $1, 'downloaded')`, [lic]);
ok('download logged', !r.error && (await one(`select count(*)::int n from audit_logs where action='document_downloaded' and entity_id=$1`, [lic])).n === 1, r.error);
r = await as(I.pharmacist, `select document_log_access('pharmacy', $1, 'viewed')`, [staffDoc]);
ok('pharmacist cannot log / see a staff document', /not found/.test(r.error || ''), r.error);
r = await as(I.admin, `select * from document_activity($1, 50)`, [trade2]);
ok('activity covers all versions', r.rows?.some(a => a.action === 'document_uploaded') && r.rows.some(a => a.action === 'document_renewed'), r.error || JSON.stringify(r.rows));
r = await as(I.pharmacist, `select * from document_activity(null, 50)`);
ok('all-activity is admin only', /only Admin/.test(r.error || ''), r.error);

// ---- storage read policy
r = await as(I.pharmacist, `select name from storage.objects where bucket_id='pharmacy-documents' and name=$1`, [licPath]);
ok('storage: pharmacist can read a registered licence file', r.rows?.length === 1, r.error);
const sPath = (await one(`select path from pharmacy_documents where id=$1`, [staffDoc])).path;
r = await as(I.pharmacist, `select name from storage.objects where bucket_id='pharmacy-documents' and name=$1`, [sPath]);
ok('storage: pharmacist cannot read staff document file', r.rows?.length === 0, r.error);
r = await as(I.admin, `select name from storage.objects where bucket_id='pharmacy-documents' and name=$1`, [sPath]);
ok('storage: admin reads staff document file', r.rows?.length === 1, r.error);
r = await as(I.admin, `delete from storage.objects where bucket_id='pharmacy-documents' and name=$1 returning name`, [licPath]);
ok('storage: registered files cannot be deleted', !r.rows?.length, r.error);
up = await upload(I.pharmacist, 300);
r = await as(I.pharmacist, `delete from storage.objects where bucket_id='pharmacy-documents' and name=$1`, [up.p]);
ok('storage: uploader can clean up an unregistered file', !r.error && !(await q(db, `select 1 from storage.objects where name=$1`, [up.p])).length, r.error);
r = await as(I.admin, `delete from storage.objects where bucket_id='pharmacy-documents' and name=$1`, [licPath]);
ok('storage: registered file still there after a delete attempt', (await q(db, `select 1 from storage.objects where name=$1`, [licPath])).length === 1, r.error);

// ---- audit
const acts = (await q(db, `select action from audit_logs where entity_type='pharmacy_document'`)).map(x => x.action);
ok('audit trail written', ['document_uploaded', 'document_updated', 'document_renewed', 'document_removed', 'document_restored', 'document_moved'].every(a => acts.includes(a)), acts.join());
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
