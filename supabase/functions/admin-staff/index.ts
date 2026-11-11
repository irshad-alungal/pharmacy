
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

const headers = {
  ...corsHeaders,
  'Content-Type': 'application/json'
};

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers
  });

const ok = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return fail(405, 'Method not allowed');
  }

  let admin: ReturnType<typeof createClient> | null = null;
  let createdAuthId: string | null = null;

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !anonKey || !serviceKey) {
      console.error('admin-staff: missing environment configuration');
      return fail(500, 'Staff management is not configured.');
    }

    const authHeader = req.headers.get('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return fail(401, 'Authentication required.');
    }

    const callerClient = createClient(url, anonKey, {
      global: {
        headers: { Authorization: authHeader }
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const { data: authData, error: authError } =
      await callerClient.auth.getUser();

    if (authError || !authData.user) {
      return fail(401, 'Invalid or expired session.');
    }

    const callerId = authData.user.id;

    admin = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const { data: caller, error: callerError } = await admin
      .from('profiles')
      .select('id,branch_id,staff_id,role_id,is_active')
      .eq('id', callerId)
      .maybeSingle();

    if (callerError || !caller || caller.is_active !== true || !caller.branch_id) {
      return fail(403, 'Active staff profile and branch required.');
    }

    const { data: callerRole, error: callerRoleError } = await admin
      .from('roles')
      .select('code,rank')
      .eq('id', caller.role_id)
      .maybeSingle();

    if (callerRoleError || !callerRole) {
      return fail(403, 'Unable to verify your staff role.');
    }

    const isSuperAdmin = callerRole.code === 'super_admin';
    const isAdmin = callerRole.code === 'admin';

    if (!isSuperAdmin && !isAdmin) {
      return fail(403, 'Staff management is restricted to administrators.');
    }

    const body = await req.json();
    const action = String(body?.action ?? '').trim();

    // LIST STAFF
    if (action === 'list') {
      const { data: profiles, error } = await admin
        .from('profiles')
        .select('id,staff_id,full_name,phone,role_id,is_active,must_change_password,created_at')
        .eq('branch_id', caller.branch_id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('admin-staff list error:', error.message);
        return fail(500, 'Unable to load staff.');
      }

      const roleIds = [...new Set((profiles || []).map(p => p.role_id))];

      const { data: roles, error: rolesError } = await admin
        .from('roles')
        .select('id,code,name,rank')
        .in('id', roleIds);

      if (rolesError) {
        return fail(500, 'Unable to load staff roles.');
      }

      const roleMap = new Map((roles || []).map(r => [r.id, r]));

      const visibleProfiles = (profiles || [])
        .filter(p => {
          const role = roleMap.get(p.role_id);
          if (!role) return false;

          // Admins cannot view or manage other Admin or Super Admin accounts.
          if (isAdmin && role.rank <= callerRole.rank) return false;

          return true;
        })
        .map(p => ({
          id: p.id,
          staff_id: p.staff_id,
          full_name: p.full_name,
          phone: p.phone,
          role: roleMap.get(p.role_id)?.code,
          role_name: roleMap.get(p.role_id)?.name,
          is_active: p.is_active,
          must_change_password: p.must_change_password,
          created_at: p.created_at
        }));

      return ok({ staff: visibleProfiles });
    }

    // CREATE STAFF
    if (action === 'create') {
      const staffId = String(body?.staff_id ?? '').trim();
      const fullName = String(body?.full_name ?? '').trim();
      const phone = String(body?.phone ?? '').trim();
      const password = String(body?.password ?? '');
      const roleCode = String(body?.role ?? '').trim();

      if (!/^[A-Za-z0-9_-]{2,40}$/.test(staffId)) {
        return fail(400, 'Staff ID must contain 2–40 letters, numbers, underscores or hyphens.');
      }

      if (!fullName || fullName.length > 120) {
        return fail(400, 'Enter a valid staff name.');
      }

      if (phone.length > 30) {
        return fail(400, 'Phone number is too long.');
      }

      if (password.length < 12 || password.length > 128) {
        return fail(400, 'Temporary password must be 12–128 characters.');
      }

      const allowedRoles = [
        'pharmacist',
        'billing_staff',
        'inventory_staff',
        'admin'
      ];

      if (!allowedRoles.includes(roleCode)) {
        return fail(400, 'Invalid staff role.');
      }

      // Only Super Admin may create Admin accounts.
      if (roleCode === 'admin' && !isSuperAdmin) {
        return fail(403, 'Only Super Admin can create Admin accounts.');
      }

      const { data: targetRole, error: targetRoleError } = await admin
        .from('roles')
        .select('id,code,rank')
        .eq('code', roleCode)
        .maybeSingle();

      if (targetRoleError || !targetRole) {
        return fail(400, 'Selected role was not found.');
      }

      if (targetRole.rank <= callerRole.rank) {
        return fail(403, 'You cannot create an account at your own level or above.');
      }

      const { data: existing, error: existingError } = await admin
        .from('profiles')
        .select('id')
        .eq('staff_id', staffId)
        .maybeSingle();

      if (existingError) {
        return fail(500, 'Unable to check Staff ID.');
      }

      if (existing) {
        return fail(409, 'This Staff ID is already in use.');
      }

      // Random internal address: no personal staff email is required.
      const internalEmail =
        `staff-${crypto.randomUUID()}@alza-pharmacy.invalid`;

      const { data: newAuth, error: createAuthError } =
        await admin.auth.admin.createUser({
          email: internalEmail,
          password,
          email_confirm: true,
          user_metadata: {
            account_type: 'pharmacy_staff'
          }
        });

      if (createAuthError || !newAuth.user) {
        console.error('admin-staff Auth creation error:', createAuthError?.message);
        return fail(400, 'Unable to create the login account.');
      }

      createdAuthId = newAuth.user.id;

      const { error: profileError } = await admin
        .from('profiles')
        .insert({
          id: createdAuthId,
          branch_id: caller.branch_id,
          staff_id: staffId,
          full_name: fullName,
          phone: phone || null,
          role_id: targetRole.id,
          is_active: true,
          must_change_password: true,
          created_by: callerId
        });

      if (profileError) {
        console.error('admin-staff profile creation error:', profileError.message);

        // Remove the Auth account if the profile could not be created.
        const { error: cleanupError } =
          await admin.auth.admin.deleteUser(createdAuthId);

        if (cleanupError) {
          console.error('admin-staff cleanup error:', cleanupError.message);
        }

        createdAuthId = null;
        return fail(400, 'Staff profile could not be created. Please check the Staff ID and try again.');
      }

      createdAuthId = null;

      return ok({
        success: true,
        message: 'Staff account created successfully.',
        staff: {
          staff_id: staffId,
          full_name: fullName,
          role: roleCode,
          is_active: true,
          must_change_password: true
        }
      });
    }

    return fail(400, 'Unknown staff management action.');

  } catch (error) {
    console.error('admin-staff unexpected error:', error);

    // Best-effort cleanup if an unexpected failure occurred after Auth creation.
    if (admin && createdAuthId) {
      const { error: cleanupError } =
        await admin.auth.admin.deleteUser(createdAuthId);

      if (cleanupError) {
        console.error('admin-staff cleanup error:', cleanupError.message);
      }
    }

    return fail(500, 'Staff management request failed.');
  }
});
