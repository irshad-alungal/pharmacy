import fs from 'fs';
import { makeReplica, asUser, asOwner } from './replica.mjs';
export { asUser, asOwner };
export const IDS = {
  pharmacy: '0a000000-0000-0000-0000-000000000001', branch: '0b000000-0000-0000-0000-000000000001',
  superAdmin: '0c000000-0000-0000-0000-000000000001', billing: '0c000000-0000-0000-0000-000000000002',
  inventory: '0c000000-0000-0000-0000-000000000003', pharmacist: '0c000000-0000-0000-0000-000000000004',
  delivery: '0c000000-0000-0000-0000-000000000005', admin: '0c000000-0000-0000-0000-000000000006'
};
export async function makeFixture(opts = {}) {
  const db = await makeReplica(opts);
  const d = JSON.parse(fs.readFileSync(new URL('./live-schema.json', import.meta.url), 'utf8'));
  const I = IDS;
  await db.exec(`insert into pharmacies(id,name) values ('${I.pharmacy}','PALLIKKAL MEDICALS');
    insert into branches(id,pharmacy_id,code,name,invoice_prefix) values ('${I.branch}','${I.pharmacy}','MAIN','PALLIKKAL MEDICALS','INV');`);
  await db.exec(`insert into gst_rate_slabs(rate,label) values (0,'Nil'),(5,'5'),(12,'12'),(18,'18'),(28,'28'),(40,'40')`);
  const roles = d.filter(x => x.section === 'role_code').map(x => x.name.split('.')[1]);
  let rank = 1;
  for (const r of roles) await db.query(`insert into roles(code,name,rank) values ($1,$1,$2)`, [r, rank++]);
  const rps = d.filter(x => x.section === 'role_permission');
  for (const p of new Set(rps.flatMap(rp => rp.detail.split(', '))))
    await db.query(`insert into permissions(code,module) values ($1, split_part($1,'.',1)) on conflict do nothing`, [p]);
  for (const rp of rps) {
    const role = rp.name.split('.')[1];
    for (const p of rp.detail.split(', ')) {
      await db.query(`insert into role_permissions(role_id,permission_code) select id,$2 from roles where code=$1`, [role, p]);
    }
  }
  const users = [['superAdmin','super_admin','SA001'],['billing','billing_staff','BIL001'],['inventory','inventory_staff','INV001'],['pharmacist','pharmacist','PHA001'],['delivery','delivery_person','DEL001'],['admin','admin','ADM001']];
  for (const [k, role, sid] of users) {
    await db.exec(`insert into auth.users(id) values ('${I[k]}');
      insert into profiles(id,branch_id,staff_id,full_name,role_id,must_change_password) select '${I[k]}','${I.branch}','${sid}','${k} user',id,false from roles where code='${role}';`);
    await asUser(db, I[k]); await db.query('select start_work_session()'); await asOwner(db);
  }
  return db;
}
export const q = async (db, sql, p) => (await db.query(sql, p)).rows;
