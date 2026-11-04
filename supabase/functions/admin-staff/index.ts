import { corsHeaders } from '../_shared/cors.ts';
// STUB: admin-staff is not implemented yet. Secrets must be read via Deno.env.get(), never sent to the browser.
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return new Response(JSON.stringify({ error: 'not_implemented', function: 'admin-staff' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
