import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: jsonHeaders });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail(405, 'Method not allowed');

  try {
    const body = await req.json();
    const staffId = String(body?.staff_id ?? '').trim();
    const password = String(body?.password ?? '');
    if (!staffId || staffId.length > 80 || !password || password.length > 256) {
      return fail(400, 'Enter a valid Staff ID and password.');
    }

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) {
      console.error('staff-login: required Supabase environment variables are missing');
      return fail(500, 'Staff login is not configured. Contact the administrator.');
    }

    // Service-role access is server-side only and is used solely to resolve an active
    // Staff ID to its Auth user. Password verification is always performed by Auth.
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id,is_active')
      .eq('staff_id', staffId)
      .maybeSingle();

    if (profileError) {
      console.error('staff-login profile lookup failed:', profileError.message);
      return fail(500, 'Unable to sign in. Please contact the administrator.');
    }
    if (!profile || profile.is_active !== true) return fail(401, 'Invalid Staff ID or password.');

    const { data: authData, error: authLookupError } = await admin.auth.admin.getUserById(profile.id);
    const email = authData?.user?.email;
    if (authLookupError || !email) {
      console.error('staff-login Auth account lookup failed:', authLookupError?.message ?? 'missing email');
      return fail(401, 'Invalid Staff ID or password.');
    }

    // Use the public Auth key to verify the password and issue a normal Supabase session.
    const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signIn, error: signInError } = await verifier.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session || signIn.user?.id !== profile.id) {
      return fail(401, 'Invalid Staff ID or password.');
    }

    return new Response(JSON.stringify({ session: signIn.session }), { status: 200, headers: jsonHeaders });
  } catch (error) {
    console.error('staff-login unexpected error:', error);
    return fail(400, 'Invalid login request.');
  }
});
