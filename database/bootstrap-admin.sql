
-- ALZA PHARMACY
-- FINAL SUPER ADMIN BOOTSTRAP

DO $$
DECLARE
    v_user_id uuid :=
        'b4d23fd6-8245-414d-970d-2600d3331b75';

    v_branch_id uuid;
    v_role_id uuid;

BEGIN

    -- Find existing Auth user

    IF NOT EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = v_user_id
    ) THEN
        RAISE EXCEPTION 'Auth user not found';
    END IF;

    -- Automatically find active Main Branch

    SELECT id INTO STRICT v_branch_id
    FROM public.branches
    WHERE code = 'MAIN'
      AND is_active = true;

    -- Find Super Admin role

    SELECT id INTO STRICT v_role_id
    FROM public.roles
    WHERE code = 'super_admin';

    -- Check duplicate staff ID

    IF EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE staff_id = 'owner'
          AND id <> v_user_id
    ) THEN
        RAISE EXCEPTION 'Owner staff ID already exists';
    END IF;

    -- Create or update Super Admin

    INSERT INTO public.profiles (
        id,
        branch_id,
        staff_id,
        full_name,
        role_id,
        is_active,
        must_change_password
    )
    VALUES (
        v_user_id,
        v_branch_id,
        'owner',
        'Owner',
        v_role_id,
        true,
        true
    )
    ON CONFLICT (id)
    DO UPDATE SET
        branch_id = EXCLUDED.branch_id,
        staff_id = EXCLUDED.staff_id,
        full_name = EXCLUDED.full_name,
        role_id = EXCLUDED.role_id,
        is_active = true,
        must_change_password = true,
        updated_at = now();

    RAISE NOTICE 'SUPER ADMIN CREATED SUCCESSFULLY';

END $$;

-- Verify installation

SELECT
    p.id,
    p.staff_id,
    p.full_name,
    r.code AS role,
    b.code AS branch_code,
    b.name AS branch_name,
    p.is_active,
    p.must_change_password
FROM public.profiles p
JOIN public.roles r ON r.id = p.role_id
JOIN public.branches b ON b.id = p.branch_id
WHERE p.id =
    'b4d23fd6-8245-414d-970d-2600d3331b75';
