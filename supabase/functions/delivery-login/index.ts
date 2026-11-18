import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const headers = { ...corsHeaders, 'Content-Type': 'application/json' };
const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail(405, 'Method not allowed');

  try {
    const body = await req.json();
    const staffId = String(body?.delivery_id ?? '').trim();
    const password = String(body?.password ?? '');
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(staffId) || !password || password.length > 256) {
      return fail(400, 'Enter a valid Delivery ID and password.');
    }

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) {
      console.error('delivery-login: missing Supabase environment variables');
      return fail(500, 'Delivery login is not configured. Contact the administrator.');
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id,branch_id,is_active,role_id')
      .eq('staff_id', staffId)
      .maybeSingle();
    if (profileError) {
      console.error('delivery-login profile lookup failed:', profileError.message);
      return fail(500, 'Unable to sign in. Please contact the administrator.');
    }
    if (!profile || profile.is_active !== true || !profile.branch_id) {
      return fail(401, 'Invalid Delivery ID or password.');
    }

    const { data: role, error: roleError } = await admin
      .from('roles').select('code').eq('id', profile.role_id).maybeSingle();
    if (roleError || role?.code !== 'delivery_person') {
      return fail(403, 'This account is not authorized for the delivery portal.');
    }

    const { data: authData, error: authLookupError } = await admin.auth.admin.getUserById(profile.id);
    const email = authData?.user?.email;
    if (authLookupError || !email) return fail(401, 'Invalid Delivery ID or password.');

    const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signIn, error: signInError } = await verifier.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session || signIn.user?.id !== profile.id) {
      return fail(401, 'Invalid Delivery ID or password.');
    }

    return new Response(JSON.stringify({ session: signIn.session }), { status: 200, headers });
  } catch (error) {
    console.error('delivery-login unexpected error:', error);
    return fail(400, 'Invalid login request.');
  }
});
