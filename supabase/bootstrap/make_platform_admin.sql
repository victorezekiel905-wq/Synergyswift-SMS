-- =========================================================================
-- Make yourself the platform (super) admin.
--
-- 1. Supabase dashboard → Authentication → Users → "Add user" →
--    enter YOUR email and a strong password, tick "Auto confirm user".
--    Use an email that is NOT a member of any school on the platform.
-- 2. Supabase dashboard → SQL editor → paste this file, change the email
--    on the marked line, and run it.
-- 3. Sign in at https://your-domain.com/login with that email and password.
--    You are asked to set up an authenticator app (required for super admins),
--    then you land on /platform (the super-admin console).
-- =========================================================================

do $$
declare
  v_email text := 'you@your-company.com';   -- ← change this
  v_user  uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'No account for %: create it first under Authentication → Users', v_email;
  end if;
  if exists (select 1 from public.users where id = v_user) then
    raise exception '% belongs to a school. Use a separate email for the platform console.', v_email;
  end if;
  insert into public.platform_admins (user_id) values (v_user) on conflict do nothing;
  insert into public.platform_audit_logs (actor_id, action, meta)
    values (v_user, 'platform_admin.granted', jsonb_build_object('email', v_email, 'via', 'sql'));
  raise notice '% is now a platform admin', v_email;
end $$;

-- See who has platform access:
--   select u.email, p.created_at from public.platform_admins p join auth.users u on u.id = p.user_id;
-- Remove someone's platform access:
--   delete from public.platform_admins where user_id = (select id from auth.users where lower(email) = lower('them@example.com'));
