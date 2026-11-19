// Browser-side stand-in for supabase-js used only by the end-to-end harness.
// Every call is sent to the local test server, which runs it against the
// PGlite replica of the live database as the signed-in user (RLS applies).
const api = async (path, body) => {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: localStorage.getItem('e2e_user') || null, ...body }) });
  return r.json();
};
class Query {
  constructor(table) { this.d = { table, op: 'select', cols: '*', filters: [], order: [], single: null, count: null, limit: null, offset: null, values: null, returning: null }; }
  select(cols = '*', opts = {}) { if (this.d.op === 'select') this.d.cols = cols; else this.d.returning = cols; if (opts.count) this.d.count = opts.count; if (opts.head) this.d.head = true; return this; }
  insert(v) { this.d.op = 'insert'; this.d.values = v; return this; }
  upsert(v) { this.d.op = 'insert'; this.d.values = v; this.d.upsert = true; return this; }
  update(v) { this.d.op = 'update'; this.d.values = v; return this; }
  delete() { this.d.op = 'delete'; return this; }
  _f(type, col, val) { this.d.filters.push([type, col, val]); return this; }
  eq(c, v) { return this._f('eq', c, v); } neq(c, v) { return this._f('neq', c, v); }
  gt(c, v) { return this._f('gt', c, v); } gte(c, v) { return this._f('gte', c, v); }
  lt(c, v) { return this._f('lt', c, v); } lte(c, v) { return this._f('lte', c, v); }
  like(c, v) { return this._f('like', c, v); } ilike(c, v) { return this._f('ilike', c, v); }
  in(c, v) { return this._f('in', c, v); } is(c, v) { return this._f('is', c, v); }
  not(c, op, v) { return this._f('not_' + op, c, v); }
  or(expr) { return this._f('or', null, expr); }
  contains(c, v) { return this._f('contains', c, v); }
  order(c, o = {}) { this.d.order.push([c, o.ascending !== false]); return this; }
  limit(n) { this.d.limit = n; return this; }
  range(a, b) { this.d.offset = a; this.d.limit = b - a + 1; return this; }
  single() { this.d.single = 'single'; return this; }
  maybeSingle() { this.d.single = 'maybe'; return this; }
  then(res, rej) { return api('query', { q: this.d }).then(res, rej); }
}
export function createClient() {
  const listeners = [];
  const session = () => { const u = localStorage.getItem('e2e_user'); return u ? { access_token: 'e2e', user: { id: u, email: 'e2e@test' } } : null; };
  return {
    from: t => new Query(t),
    rpc: (name, args = {}) => api('rpc', { name, args }),
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      getUser: async () => ({ data: { user: session()?.user || null }, error: null }),
      onAuthStateChange: cb => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => { localStorage.removeItem('e2e_user'); return { error: null }; },
      signInWithPassword: async ({ email }) => { localStorage.setItem('e2e_user', email); return { data: { user: { id: email }, session: session() }, error: null }; },
      updateUser: async () => ({ data: {}, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null })
    },
    storage: { from: bucket => ({
      upload: (path, file) => api('storage', { op: 'upload', bucket, path, size: file?.size || 1, type: file?.type }),
      remove: paths => api('storage', { op: 'remove', bucket, paths }),
      createSignedUrl: (path) => Promise.resolve({ data: { signedUrl: 'data:text/plain,signed:' + encodeURIComponent(path) }, error: null }),
      getPublicUrl: path => ({ data: { publicUrl: 'data:text/plain,public:' + encodeURIComponent(path) } }),
      list: async () => ({ data: [], error: null })
    }) },
    functions: { invoke: (name, opts) => api('function', { name, body: opts?.body }) }
  };
}
