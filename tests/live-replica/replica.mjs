// Rebuilds the live Supabase structure (from the read-only schema export) in PGlite.
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function makeReplica({ verbose = false, json = path.join(here, 'live-schema.json'), postgrest = false } = {}) {
  const d = JSON.parse(fs.readFileSync(json, 'utf8'));
  // postgrest: return values the way Supabase/PostgREST serialises them (dates as text, numerics as numbers).
  const iso = v => v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const parsers = postgrest ? { 20: Number, 1700: Number, 1082: v => v, 1114: v => v.replace(' ', 'T'), 1184: iso } : undefined;
  const db = new PGlite({ extensions: { citext, pgcrypto, uuid_ossp }, parsers });
  const log = (...a) => verbose && console.log(...a);
  await db.exec(`
    create extension if not exists citext; create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app; create schema storage;
    grant usage on schema public, auth, app, storage to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
    grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
    create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant select on storage.buckets to anon, authenticated;
  `);
  const by = s => d.filter(x => x.section === s);
  for (const s of by('sequence')) await db.exec(`create sequence if not exists ${s.name}`);
  // tables
  for (const t of by('table')) {
    const cols = t.detail.split(/, (?=[a-z_]+ (?:uuid|text|jsonb|inet|integer|USER-DEFINED|numeric|boolean|date|bigint|timestamp))/).map(c => {
      let [name, ...rest] = c.split(' ');
      let def = rest.join(' ').replace('USER-DEFINED', 'citext');
      return `"${name}" ${def}`;
    });
    await db.exec(`create table ${t.name} (${cols.join(', ')})`);
  }
  // constraints: pk/unique/check first, then fk
  const cons = by('constraint');
  const order = c => /^PRIMARY KEY/.test(c.detail) ? 0 : /^UNIQUE/.test(c.detail) ? 1 : /^CHECK/.test(c.detail) ? 2 : 3;
  for (const c of [...cons].sort((a, b) => order(a) - order(b))) {
    const parts = c.name.split('.'); const cname = parts.pop(); const tname = parts.join('.');
    try { await db.exec(`alter table ${tname} add constraint "${cname}" ${c.detail}`); }
    catch (e) { log('constraint fail', c.name, e.message); }
  }
  // functions (retry until stable; sql functions validate references)
  let pending = by('function').map(f => ({ name: f.name, sql: f.detail.slice(f.detail.indexOf('\n') + 1), grants: (f.detail.match(/grants: ([^\n]*)/) || [])[1] || '' }));
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    const next = [];
    for (const f of pending) {
      try { await db.exec(f.sql); f.ok = true; } catch (e) { f.err = e.message; next.push(f); }
    }
    pending = next;
  }
  for (const f of pending) console.warn('FUNCTION NOT CREATED', f.name, f.err);
  for (const f of by('function')) {
    const sig = f.name;
    const grants = (f.detail.match(/grants: ([^\n]*)/) || [])[1] || '';
    try {
      await db.exec(`revoke all on function ${sig} from public`);
      for (const g of grants.split(',').map(s => s.trim()).filter(g => ['PUBLIC', 'anon', 'authenticated', 'service_role'].includes(g)))
        await db.exec(`grant execute on function ${sig} to ${g === 'PUBLIC' ? 'public' : g}`);
    } catch (e) { log('grant fail', sig, e.message); }
  }
  // Indexes are not in the export; recreate the one implied by live ON CONFLICT clauses.
  await db.exec(`create unique index if not exists inventory_cost_layers_purchase_item_layer_uk on public.inventory_cost_layers(purchase_item_id, layer_type) where purchase_item_id is not null`);
  // triggers
  for (const t of by('trigger')) {
    const m = t.detail.match(/^(BEFORE|AFTER) ([A-Z/]+) → (.*)$/);
    const parts = t.name.split('.'); const tg = parts.pop(); const tbl = parts.join('.');
    const evs = m[2].split('/').join(' OR ');
    try { await db.exec(`create trigger "${tg}" ${m[1]} ${evs} on ${tbl} for each row ${m[3]}`); }
    catch (e) { console.warn('trigger fail', t.name, e.message); }
  }
  // rls
  for (const r of by('rls')) if (/enabled=true/.test(r.detail)) await db.exec(`alter table ${r.name} enable row level security`);
  // policies
  for (const p of by('policy')) {
    const m = p.detail.match(/^(\w+) to ([^|]+) \| using: ([\s\S]*?) \| check: ([\s\S]*)$/);
    const parts = p.name.split('.'); const pol = parts.pop(); const tbl = parts.join('.');
    let sql = `create policy "${pol}" on ${tbl} for ${m[1]} to ${m[2].trim()}`;
    if (m[3] !== '-') sql += ` using (${m[3]})`;
    if (m[4] !== '-') sql += ` with check (${m[4]})`;
    try { await db.exec(sql); } catch (e) { console.warn('policy fail', p.name, e.message); }
  }
  // grants
  for (const g of by('table_grant')) for (const item of g.detail.split(', ')) {
    const [role, priv] = item.split(':'); await db.exec(`grant ${priv} on ${g.name} to ${role}`);
  }
  for (const g of by('column_grant')) for (const item of g.detail.split(', ')) {
    const [role, priv, col] = item.split(':');
    try { await db.exec(`grant ${priv} ("${col}") on ${g.name} to ${role}`); } catch (e) { log('colgrant', e.message); }
  }
  for (const b of by('bucket')) {
    const id = b.name.replace('storage.', ''); const pub = /public=true/.test(b.detail);
    await db.exec(`insert into storage.buckets(id, name, public) values ('${id}', '${id}', ${pub})`);
  }
  await db.exec(`grant usage, select on all sequences in schema public to authenticated`);
  return db;
}

// Helpers for tests: act as a user (sets JWT claims + role) or as the owner.
export const asUser = async (db, uid) => {
  await db.exec('reset role');
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid || ''}', false), set_config('request.jwt.claim.role', '${uid ? 'authenticated' : ''}', false)`);
  if (uid) await db.exec('set role authenticated');
};
export const asOwner = async db => { await db.exec('reset role'); };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = await makeReplica({ verbose: true });
  const r = await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app')`);
  console.log('functions created:', r.rows[0].n);
}
