// Billing AI assistant (Supabase Edge Function).
//
// The model is only allowed to *use* deterministic, validated database functions
// through tools. It never computes amounts or chooses batches itself, and it can
// never change a bill: it returns suggested actions which the cashier applies in
// the billing screen, where the normal validation and finalize_sale_v2() checks run.
//
// Secrets (set with `supabase secrets set`):
//   ANTHROPIC_API_KEY=...            required
//   ANTHROPIC_MODEL=claude-sonnet-5-5 optional
// SUPABASE_URL / SUPABASE_ANON_KEY are provided by the Edge runtime.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';
const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const MAX_TURNS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SYSTEM = `You are the billing assistant inside a pharmacy point-of-sale screen (India, amounts in INR).

Hard rules:
- Never calculate amounts, GST, discounts or totals yourself. Use calculate_line or read the values in get_bill. Quote numbers exactly as tools return them.
- Never decide or invent batches, stock levels or expiry dates. Use fefo_preview (First-Expiry-First-Out, done by the database) and get_bill.
- You cannot change the bill. To change it, call propose_actions; the cashier reviews and applies each suggestion, and the system re-validates it.
- Only propose set_discount if permissions.discount is true and the value is within limits.max_discount_pct. Never propose GST or MRP changes, and never propose overriding batches.
- If a medicine name is ambiguous or not found, ask a short clarifying question instead of guessing. Mention when a medicine needs a prescription.
- Expired, recalled, blocked or quarantined stock can never be sold; do not suggest workarounds.
- For anomaly questions, explain the deterministic anomalies in get_bill and what the cashier could check. Do not accuse anyone.
- Be brief: a few short sentences or a short list.`;

const TOOLS = [
  {
    name: 'search_medicines',
    description: 'Search active medicines in this branch by name or barcode. Returns id, name, strength, MRP, GST %, prescription flag and eligible (unexpired, unblocked) stock.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Medicine name fragment or barcode' } }, required: ['query'] }
  },
  {
    name: 'fefo_preview',
    description: 'Ask the inventory engine how a quantity of a medicine would be allocated across batches (earliest expiry first), including shortage and why batches were skipped. Read-only.',
    input_schema: { type: 'object', properties: { medicine_id: { type: 'string' }, quantity: { type: 'number' } }, required: ['medicine_id', 'quantity'] }
  },
  {
    name: 'calculate_line',
    description: 'Deterministic billing calculation for one batch line. Returns base, discount, taxable (net), GST and total.',
    input_schema: {
      type: 'object',
      properties: {
        mrp: { type: 'number' }, quantity: { type: 'number' }, discount_pct: { type: 'number' },
        gst_pct: { type: 'number' }, price_includes_tax: { type: 'boolean' }
      },
      required: ['mrp', 'quantity', 'discount_pct', 'gst_pct', 'price_includes_tax']
    }
  },
  {
    name: 'get_bill',
    description: 'Current bill as computed by the deterministic billing engine on screen: medicines, batch allocations, per-line amounts, totals, permissions, limits and deterministic anomaly checks.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'propose_actions',
    description: 'Suggest bill changes for the cashier to review and apply. Allowed types: add_medicine (medicine_id, quantity), set_quantity (medicine_id, quantity), set_discount (medicine_id, discount_pct), remove_medicine (medicine_id).',
    input_schema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['add_medicine', 'set_quantity', 'set_discount', 'remove_medicine'] },
              medicine_id: { type: 'string' }, quantity: { type: 'integer' }, discount_pct: { type: 'number' }
            },
            required: ['type', 'medicine_id']
          }
        }
      },
      required: ['actions']
    }
  }
];

type Ctx = {
  cart_token?: string;
  permissions?: Record<string, boolean>;
  limits?: { max_discount_pct?: number };
  groups?: Array<{ medicine_id: string; name: string }>;
  [k: string]: unknown;
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!API_KEY) return json({ error: 'AI assistant is not configured (ANTHROPIC_API_KEY missing).' }, 503);

  const auth = req.headers.get('Authorization') || '';
  // Every database call runs as the signed-in staff member, so RLS, branch
  // scoping and role checks in the SQL functions all apply.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false }
  });
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);

  let body: { message?: string; context?: Ctx; history?: Array<{ role: string; content: string }> };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const message = String(body.message || '').trim().slice(0, 600);
  if (!message) return json({ error: 'Empty message' }, 400);
  const ctxText = JSON.stringify(body.context || {});
  if (ctxText.length > 60000) return json({ error: 'Bill is too large for the assistant' }, 413);
  const ctx: Ctx = body.context || {};
  const cart = typeof ctx.cart_token === 'string' && UUID.test(ctx.cart_token) ? ctx.cart_token : null;

  // Confirms staff role/session and gives the branch's limits (server truth).
  const cfgRes = await sb.rpc('billing_my_config');
  if (cfgRes.error) return json({ error: cfgRes.error.message }, 403);
  const serverCfg = cfgRes.data as { permissions: Record<string, boolean>; max_discount_pct: number };

  const { data: prof } = await sb.from('profiles').select('branch_id').eq('id', userData.user.id).maybeSingle();
  const branchId = prof?.branch_id;

  const actions: Array<Record<string, unknown>> = [];

  async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'search_medicines': {
        const q = String(input.query || '').replace(/[%,()*\\]/g, '').trim().slice(0, 60);
        if (q.length < 2) return { error: 'Query too short' };
        let query = sb.from('medicines')
          .select('id,name,strength,barcode,mrp,tax_rate,need_doctor_sheet')
          .eq('active', true)
          .or(`name.ilike.%${q}%,barcode.eq.${q}`)
          .limit(8);
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error } = await query;
        if (error) return { error: error.message };
        const results = [];
        for (const m of data || []) {
          const pv = await sb.rpc('billing_fefo_preview', { p_medicine: m.id, p_qty: 1, p_cart: cart });
          results.push({
            medicine_id: m.id, name: m.name, strength: m.strength, mrp: m.mrp, gst_pct: m.tax_rate,
            prescription_required: m.need_doctor_sheet === true,
            eligible_stock: pv.error ? null : (pv.data as { available_total: number }).available_total
          });
        }
        return { results };
      }
      case 'fefo_preview': {
        const id = String(input.medicine_id || '');
        const qty = Number(input.quantity);
        if (!UUID.test(id) || !(qty > 0)) return { error: 'Invalid medicine_id or quantity' };
        const { data, error } = await sb.rpc('billing_fefo_preview', { p_medicine: id, p_qty: qty, p_cart: cart });
        if (error) return { error: error.message };
        const d = data as Record<string, unknown> & { rows: Array<Record<string, unknown>> };
        return {
          medicine: d.medicine_name, requested: d.requested, allocated: d.allocated,
          available_total: d.available_total, shortage: d.shortage, excluded: d.excluded,
          allocation: d.rows.map(r => ({ batch_no: r.batch_no, expiry: r.expiry, qty: r.qty, mrp: r.mrp, gst_pct: r.tax_rate, near_expiry: r.near_expiry }))
        };
      }
      case 'calculate_line': {
        const { data, error } = await sb.rpc('billing_calc_line', {
          p_mrp: input.mrp, p_qty: input.quantity, p_discount_pct: input.discount_pct,
          p_gst_pct: input.gst_pct, p_price_includes_tax: input.price_includes_tax
        });
        if (error) return { error: error.message };
        return Array.isArray(data) ? data[0] : data;
      }
      case 'get_bill':
        return { ...ctx, permissions: serverCfg.permissions, limits: { ...(ctx.limits || {}), max_discount_pct: serverCfg.max_discount_pct } };
      case 'propose_actions': {
        const list = Array.isArray(input.actions) ? input.actions.slice(0, 10) : [];
        const accepted: unknown[] = [], rejected: unknown[] = [];
        for (const raw of list as Array<Record<string, unknown>>) {
          const type = String(raw.type || '');
          const id = String(raw.medicine_id || '');
          if (!UUID.test(id)) { rejected.push({ raw, reason: 'invalid medicine_id' }); continue; }
          const a: Record<string, unknown> = { type, medicine_id: id };
          if (type === 'add_medicine' || type === 'set_quantity') {
            const qn = Math.floor(Number(raw.quantity));
            if (!(qn >= 1 && qn <= 10000)) { rejected.push({ raw, reason: 'quantity must be 1–10000' }); continue; }
            a.quantity = qn;
          } else if (type === 'set_discount') {
            const d = Number(raw.discount_pct);
            if (!serverCfg.permissions.discount) { rejected.push({ raw, reason: 'user lacks discount permission' }); continue; }
            if (!(d >= 0 && d <= serverCfg.max_discount_pct)) { rejected.push({ raw, reason: `discount must be 0–${serverCfg.max_discount_pct}%` }); continue; }
            a.discount_pct = Math.round(d * 100) / 100;
          } else if (type !== 'remove_medicine') { rejected.push({ raw, reason: 'unsupported type' }); continue; }
          // Resolve the name from the database, never from the model.
          let q = sb.from('medicines').select('name,strength').eq('id', id).eq('active', true);
          if (branchId) q = q.eq('branch_id', branchId);
          const { data: med } = await q.maybeSingle();
          if (!med) { rejected.push({ raw, reason: 'medicine not found in this branch' }); continue; }
          a.medicine_name = `${med.name}${med.strength ? ' ' + med.strength : ''}`;
          actions.push(a); accepted.push(a);
        }
        return { accepted, rejected, note: 'Suggestions are shown to the cashier to apply; nothing has changed yet.' };
      }
      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(h => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content)
    .slice(-6)
    .map(h => ({ role: h.role, content: h.content.slice(0, 2000) }));
  // Messages must alternate and start with the user.
  while (history.length && history[0].role !== 'user') history.shift();
  const messages: Array<Record<string, unknown>> = [...history, { role: 'user', content: message }];

  let reply = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages })
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('Anthropic API error', res.status, t.slice(0, 500));
      return json({ error: `AI service error (${res.status})` }, 502);
    }
    const out = await res.json() as { content: Array<Record<string, unknown>>; stop_reason: string };
    messages.push({ role: 'assistant', content: out.content });
    const toolUses = out.content.filter(b => b.type === 'tool_use');
    reply = out.content.filter(b => b.type === 'text').map(b => String(b.text)).join('\n').trim();
    if (out.stop_reason !== 'tool_use' || !toolUses.length) break;
    const results = [];
    for (const tu of toolUses) {
      let result: unknown;
      try { result = await runTool(String(tu.name), (tu.input || {}) as Record<string, unknown>); }
      catch (e) { result = { error: String((e as Error)?.message || e) }; }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 20000) });
    }
    messages.push({ role: 'user', content: results });
  }

  return json({ reply: reply || (actions.length ? 'Here are my suggestions.' : 'I could not complete that request.'), actions });
});
