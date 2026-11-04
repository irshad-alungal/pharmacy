import { corsHeaders } from '../_shared/cors.ts';
// STUB: staff-login is not implemented yet. Secrets must be read via Deno.env.get(), never sent to the browser.
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return new Response(JSON.stringify({ error: 'not_implemented', function: 'staff-login' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
