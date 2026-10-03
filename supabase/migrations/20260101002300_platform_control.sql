-- =========================================================================
-- EduClass Fusion: fuller super-admin control of schools.
--  * "paused" status (temporary closure) next to "suspended", with an
--    optional message shown to the school's users when they sign in.
--  * platform_delete_tenant(): removes a school and all of its data. Only the
--    server can call it, after checking the caller is a platform admin.
-- Apply AFTER 20260101002200. Idempotent.
-- =========================================================================

alter table public.tenants add column if not exists status_message text;
alter table public.tenants drop constraint if exists tenants_status_chk;
alter table public.tenants add constraint tenants_status_chk check (status in ('active','paused','suspended'));

-- Tell a signed-in user why they see nothing.
create or replace function public.my_account_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when u.id is null then jsonb_build_object('state', 'no_profile')
    when t.status <> 'active' then jsonb_build_object('state', t.status, 'school', t.name, 'message', t.status_message)
    when not u.active then jsonb_build_object('state', 'deactivated', 'school', t.name)
    when not public.mfa_ok(s.require_mfa, u.role, u.extra_roles) then jsonb_build_object('state', 'mfa_required', 'school', t.name)
    else jsonb_build_object('state', 'active')
  end
  from (select auth.uid() as uid) me
  left join public.users u on u.id = me.uid
  left join public.tenants t on t.id = u.tenant_id
  left join public.tenant_settings s on s.tenant_id = u.tenant_id;
$$;

-- Deletes every row that belongs to the school, then the school itself.
-- Tables are emptied in repeated passes, so foreign keys that do not cascade
-- are satisfied by deleting children before parents. Returns the ids of the
-- school's accounts so the server can remove their sign-in records too.
create or replace function public.platform_delete_tenant(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_users uuid[];
  v_pass int := 0;
  v_blocked text[];
begin
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'school not found'; end if;
  select coalesce(array_agg(id), '{}') into v_users from public.users where tenant_id = p_tenant;
  loop
    v_pass := v_pass + 1;
    v_blocked := '{}';
    for r in
      select c.table_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
        and c.table_name not in ('tenants', 'platform_audit_logs')   -- the platform keeps its history
      order by c.table_name
    loop
      begin
        execute format('delete from public.%I where tenant_id = $1', r.table_name) using p_tenant;
      exception when foreign_key_violation then
        v_blocked := v_blocked || r.table_name::text;
      end;
    end loop;
    exit when cardinality(v_blocked) = 0 or v_pass >= 15;
  end loop;
  if cardinality(v_blocked) > 0 then
    raise exception 'could not remove data from: %', array_to_string(v_blocked, ', ');
  end if;
  delete from public.tenants where id = p_tenant;
  return jsonb_build_object('users', to_jsonb(v_users), 'passes', v_pass);
end $$;
revoke all on function public.platform_delete_tenant(uuid) from public, anon, authenticated;
grant execute on function public.platform_delete_tenant(uuid) to service_role;
