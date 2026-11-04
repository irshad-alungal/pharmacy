-- Links the EXISTING Auth user to a super_admin profile. Safe to re-run. Run after schema.sql.
do $$ begin
  if not exists (select 1 from auth.users where id='b4d23fd6-8245-414d-970d-2600d3331b75') then
    raise exception 'Auth user not found - check the UUID in Authentication > Users';
  end if;
  insert into profiles(id,staff_id,full_name,role,active)
  values('b4d23fd6-8245-414d-970d-2600d3331b75','owner','Owner','super_admin',true)
  on conflict (id) do update set role='super_admin', active=true;
end $$;
