
import { createClient } from
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

// Use your actual Supabase project details.
export const SUPABASE_URL =
  'https://ofxpjlzcbdvlaufqrogr.supabase.co';

export const SUPABASE_ANON_KEY =
  'sb_publishable_xFHQGGRVyyDml6UA5niEsA_WVj4AK94';

export const sb = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);


// Check authenticated staff profile
export async function requireProfile() {

  const {
    data: { session },
    error: sessionError
  } = await sb.auth.getSession();

  if (sessionError || !session) {
    location.href = 'index.html';
    return null;
  }

  // Read existing ALZA profile structure
  const { data: profile, error } = await sb
    .from('profiles')
    .select(`
      id,
      branch_id,
      staff_id,
      full_name,
      role_id,
      is_active,
      must_change_password
    `)
    .eq('id', session.user.id)
    .single();

  if (error || !profile || !profile.is_active) {
    console.error('Profile error:', error);
    await sb.auth.signOut();
    location.href = 'index.html';
    return null;
  }

  // Get role using existing database function
  const { data: role, error: roleError } =
    await sb.rpc('my_role');

  if (roleError || !role) {
    console.error('Role error:', roleError);
    await sb.auth.signOut();
    location.href = 'index.html';
    return null;
  }

  return {
    ...profile,
    role
  };
}


// Utilities
export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

export const inr = n =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(n);
