-- 10200: who in a school has actually signed in. An email invitation or a one-time password
-- makes the account at once, so "has an account" is not "has joined": onboarding needs to know
-- whether the person ever signed in, to show them as waiting, remind them and send again.
-- Server only (it reads the sign-in records). Safe to run again.

create or replace function public.tenant_sign_ins(p_tenant uuid)
returns table (user_id uuid, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, a.last_sign_in_at
  from public.users u join auth.users a on a.id = u.id
  where u.tenant_id = p_tenant
$$;
revoke execute on function public.tenant_sign_ins(uuid) from public, anon, authenticated;
grant execute on function public.tenant_sign_ins(uuid) to service_role;
