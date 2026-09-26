-- =========================================================================
-- EduClass Fusion — suspension locks every module (v46)
--
-- New modules key their policies on my_tenant_id(), which is empty for a
-- suspended school. The older LMS policies check membership through
-- public.users instead. Hiding a suspended school's user rows makes those
-- checks fail too, so suspension locks everything at the database level.
-- Apply AFTER 20260101001800_logistics_growth.sql. Idempotent.
-- =========================================================================

drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users for select using (
  (id = auth.uid() and public.my_tenant_id() is not null)
  or (tenant_id = public.my_tenant_id() and (public.is_staff() or role not in ('student','parent')))
);

-- Lets the app explain why a signed-in user sees nothing.
create or replace function public.my_account_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when u.id is null then jsonb_build_object('state', 'no_profile')
    when t.status <> 'active' then jsonb_build_object('state', 'suspended', 'school', t.name)
    when not u.active then jsonb_build_object('state', 'deactivated', 'school', t.name)
    else jsonb_build_object('state', 'active')
  end
  from (select auth.uid() as uid) me
  left join public.users u on u.id = me.uid
  left join public.tenants t on t.id = u.tenant_id;
$$;
grant execute on function public.my_account_state() to authenticated;
