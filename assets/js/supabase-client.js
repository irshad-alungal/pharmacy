
import { createClient } from
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

// =====================================================
// ALZA PHARMACY - SUPABASE CONFIGURATION
// =====================================================

export const SUPABASE_URL =
  'https://ofxpjlzcbdvlaufqrogr.supabase.co';

export const SUPABASE_ANON_KEY =
  'sb_publishable_xFHQGGRVyyDml6UA5niEsA_WVj4AK94';

export const sb = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  }
);


// =====================================================
// REQUIRE AUTHENTICATED STAFF PROFILE
// =====================================================

export async function requireProfile() {

  // 1. Check authentication session

  const {
    data: { session },
    error: sessionError
  } = await sb.auth.getSession();

  if (sessionError || !session) {
    location.replace('admin-login.html');
    return null;
  }


  // 2. Fetch existing ALZA staff profile

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


  // 3. Validate profile

  if (error || !profile) {
    console.error('Profile lookup failed:', error);

    await sb.auth.signOut();

    location.replace('admin-login.html');
    return null;
  }


  // 4. Check active status

  if (!profile.is_active) {
    console.error('Staff account is inactive');

    await sb.auth.signOut();

    location.replace('admin-login.html');
    return null;
  }


  // 5. Check staff branch

  if (!profile.branch_id) {
    console.error('Staff branch is not assigned');
    return null;
  }


  // 6. Resolve role from database function

  const {
    data: role,
    error: roleError
  } = await sb.rpc('my_role');

  if (roleError || !role) {
    console.error('Role lookup failed:', roleError);
    return null;
  }


  // 7. Mandatory password change

  const currentPage = location.pathname.split('/').pop();

  if (
    profile.must_change_password === true &&
    currentPage !== 'change-password.html'
  ) {
    location.replace('change-password.html');
    return null;
  }


  // 8. Return authenticated staff details

  return {
    ...profile,
    role,
    branch_id: profile.branch_id,
    user_id: session.user.id,
    email: session.user.email
  };
}


// =====================================================
// ROLE CHECK HELPER
// =====================================================

export function hasRole(profile, allowedRoles = []) {

  if (!profile || !profile.role) {
    return false;
  }

  return allowedRoles.includes(profile.role);
}


// =====================================================
// SUPER ADMIN CHECK
// =====================================================

export function isSuperAdmin(profile) {

  return hasRole(profile, ['super_admin']);
}


// =====================================================
// SHARED HTML ESCAPE UTILITY
// =====================================================

export const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));


// =====================================================
// INDIAN RUPEE FORMATTER
// =====================================================

export const inr = amount =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(Number(amount) || 0);


// =====================================================
// LOGOUT
// =====================================================

export async function logout() {

  const { error } = await sb.auth.signOut();

  if (error) {
    console.error('Logout failed:', error);
    throw error;
  }

  location.replace('admin-login.html');
}
