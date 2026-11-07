-- =========================================================================
-- Lockdown back in live lessons.
--
-- Classroom monitoring (lockdown, students' screens, leave alerts, "lesson focus"
-- environments) came over from SwiftCipher as a per-school add-on that new schools
-- start without (live.tenant_settings.monitoring_enabled, default false, migration
-- 0870 inside 20260101006100). Synergy Swift never got a switch for it, so every
-- school added since then had no lockdown at all and nobody could turn it on.
--
-- Now it follows the school's modules, like the rest of the live engine:
--   * modules.live_monitoring when the platform has set it (on or off), otherwise
--   * the Live lessons module itself (modules.live): a school with live lessons has
--     lockdown, as it did in SwiftCipher.
-- Turning it off ends lockdown in that school's running lessons straight away.
-- Apply AFTER 20260101006110. Idempotent.
-- =========================================================================

create or replace function live_app.sync_tenant(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; v_mon boolean;
begin
  select id, name, slug, country, timezone, status, modules into t from public.tenants where id = p_id;
  if not found then return; end if;
  -- The engine refuses everything for a suspended school, so a closed school or one without
  -- the Live module (tenants.modules.live = false) is blocked in the database, not just in menus.
  insert into live.tenants (id, name, slug, plan_code, country, timezone, status)
  values (t.id, left(t.name, 200), t.slug, 'school', t.country, coalesce(t.timezone, 'UTC'),
          case when t.status = 'active' and coalesce(t.modules->>'live', 'true') <> 'false' then 'active' else 'suspended' end)
  on conflict (id) do update set name = excluded.name, slug = excluded.slug, country = excluded.country, timezone = excluded.timezone, status = excluded.status;
  insert into live.schools (id, tenant_id, name) values (t.id, t.id, left(t.name, 200))
  on conflict (id) do update set name = excluded.name;
  insert into live.tenant_settings (tenant_id) values (t.id) on conflict (tenant_id) do nothing;

  -- Classroom monitoring (lockdown and screens): its own module switch if set, else Live lessons'.
  v_mon := coalesce(t.modules->>'live_monitoring', t.modules->>'live', 'true') <> 'false';
  update live.tenant_settings set monitoring_enabled = v_mon
   where tenant_id = t.id and monitoring_enabled is distinct from v_mon;
  if not v_mon then
    -- Switched off: running lessons stop locking down now, not at the next lesson.
    update live.class_sessions set lockdown = false
     where tenant_id = t.id and status = 'live' and lockdown;
  end if;
end $$;

-- Every school now: those added since the move get lockdown back.
do $$
declare r record;
begin
  for r in select id from public.tenants loop
    perform live_app.sync_tenant(r.id);
  end loop;
end $$;
