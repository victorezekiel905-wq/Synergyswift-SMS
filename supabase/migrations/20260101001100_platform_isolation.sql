-- =========================================================================
-- EduClass Fusion — platform layer + hard tenant isolation (v45)
--
-- Goals:
--   1. Tenants can never see, list or infer other tenants.
--   2. A hidden super-admin ("platform admin") layer that lives OUTSIDE every
--      tenant. Platform admins have no row in public.users, so no tenant query
--      can ever return them.
--   3. Close privilege-escalation holes on public.users (self-insert into any
--      tenant, self-update of role / tenant_id).
--   4. Shared helper functions every new module uses for RLS.
--
-- Idempotent. Apply AFTER 20260101001000_webrtc_mesh.sql.
-- =========================================================================

-- ---------- Platform admins (invisible to tenants) ----------
create table if not exists public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
-- No policies on purpose: only the service role and security-definer
-- functions can read this table.
revoke all on public.platform_admins from anon, authenticated;

create table if not exists public.platform_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  action      text not null,
  tenant_id   uuid,
  meta        jsonb not null default '{}'::jsonb,
  ts          timestamptz not null default now()
);
alter table public.platform_audit_logs enable row level security;
revoke all on public.platform_audit_logs from anon, authenticated;

-- ---------- Tenant lifecycle + module switches ----------
alter table public.tenants add column if not exists status text not null default 'active';
alter table public.tenants add column if not exists modules jsonb not null default
  '{"lms":true,"sims":true,"results":true,"exams":true,"gate":true,"pickup":true,"library":true,"requisitions":true,"hr":true,"qa":true,"messaging":true}'::jsonb;
alter table public.tenants add column if not exists contact_email text;
alter table public.tenants add column if not exists country text;
alter table public.tenants add column if not exists timezone text not null default 'Africa/Lagos';
alter table public.tenants add column if not exists student_limit int;
do $$ begin
  alter table public.tenants add constraint tenants_status_chk check (status in ('active','suspended'));
exception when duplicate_object then null; end $$;

-- ---------- Extended staff roles ----------
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in (
  'student','teacher','school_admin','it_admin','parent','platform_admin',
  'principal','bursar','librarian','hr_manager','qa_officer','gate_officer'
));
alter table public.users add column if not exists extra_roles text[] not null default '{}';
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists active boolean not null default true;

-- ---------- Helper functions (security definer → no RLS recursion) ----------
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- Tenant of the caller, regardless of tenant status (used for reading own tenant row).
create or replace function public.my_tenant_id_raw()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.users where id = auth.uid();
$$;

-- Tenant of the caller only while the tenant is active and the user is active.
-- Every new module's RLS keys on this, so suspending a tenant locks its data.
create or replace function public.my_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u.tenant_id
  from public.users u join public.tenants t on t.id = u.tenant_id
  where u.id = auth.uid() and t.status = 'active' and u.active;
$$;

create or replace function public.my_roles()
returns text[] language sql stable security definer set search_path = public as $$
  select array[u.role] || coalesce(u.extra_roles, '{}') from public.users u where u.id = auth.uid();
$$;

create or replace function public.has_role(roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_roles() && roles, false);
$$;

-- Anyone employed by the school (not a student / parent).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['teacher','school_admin','it_admin','platform_admin','principal',
                               'bursar','librarian','hr_manager','qa_officer','gate_officer']);
$$;

create or replace function public.is_school_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['school_admin','principal','platform_admin']);
$$;

grant execute on function public.is_platform_admin(), public.my_tenant_id_raw(), public.my_tenant_id(),
  public.my_roles(), public.has_role(text[]), public.is_staff(), public.is_school_admin()
  to authenticated;

-- ---------- tenants: see only your own ----------
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants for select using (id = public.my_tenant_id_raw());
drop policy if exists tenants_insert on public.tenants;   -- provisioning is service-role only
drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants for update
  using (id = public.my_tenant_id() and public.is_school_admin())
  with check (id = public.my_tenant_id());
-- School admins may rename / rebrand, but never change status or modules.
create or replace function public.tenants_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin() then
    if new.status is distinct from old.status
       or new.modules is distinct from old.modules
       or new.student_limit is distinct from old.student_limit
       or new.slug is distinct from old.slug then
      raise exception 'only the platform can change tenant status, modules, limits or slug';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tenants_guard on public.tenants;
create trigger tenants_guard before update on public.tenants
  for each row execute function public.tenants_guard();

-- ---------- users: no recursion, no escalation ----------
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users for select using (
  id = auth.uid() or tenant_id = public.my_tenant_id()
);
-- Self-insert let anyone join any tenant with any role. Profile rows are now
-- created server-side (service role) after verifying an invite or class code.
drop policy if exists users_insert on public.users;
drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists users_admin_update on public.users;
create policy users_admin_update on public.users for update
  using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id());

create or replace function public.users_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / SQL editor
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot be changed';
  end if;
  if (new.role is distinct from old.role or new.extra_roles is distinct from old.extra_roles
      or new.active is distinct from old.active) then
    if new.id = auth.uid() then
      raise exception 'you cannot change your own role or status';
    end if;
    if not public.is_school_admin() then
      raise exception 'only school admins can change roles';
    end if;
    if new.role = 'platform_admin' or 'platform_admin' = any(new.extra_roles) then
      raise exception 'platform_admin cannot be granted from a tenant';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists users_guard on public.users;
create trigger users_guard before update on public.users
  for each row execute function public.users_guard();

-- ---------- audit_logs: tenant-scoped ----------
create or replace function public.audit_fill_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then new.tenant_id := public.my_tenant_id_raw(); end if;
  if new.actor_id is null then new.actor_id := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists audit_fill_tenant on public.audit_logs;
create trigger audit_fill_tenant before insert on public.audit_logs
  for each row execute function public.audit_fill_tenant();
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select using (
  tenant_id = public.my_tenant_id()
  and public.has_role(array['school_admin','principal','it_admin','platform_admin','qa_officer','teacher'])
);
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs for insert with check (
  tenant_id = public.my_tenant_id_raw() and actor_id = auth.uid()
);

-- ---------- Previously world-readable tables ----------
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select using (
  exists (select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
          where s.id = announcements.session_id and c.tenant_id = public.my_tenant_id())
);
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert with check (
  user_id = auth.uid() and exists (
    select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = announcements.session_id and c.tenant_id = public.my_tenant_id())
);

drop policy if exists leaderboard_select on public.leaderboard_entries;
create policy leaderboard_select on public.leaderboard_entries for select using (
  exists (select 1 from public.game_sessions g where g.id = leaderboard_entries.game_id
          and g.tenant_id = public.my_tenant_id())
);
drop policy if exists leaderboard_insert on public.leaderboard_entries;
create policy leaderboard_insert on public.leaderboard_entries for insert with check (
  exists (select 1 from public.game_sessions g where g.id = leaderboard_entries.game_id
          and g.tenant_id = public.my_tenant_id())
);

drop policy if exists env_policies_insert on public.environment_policies;
create policy env_policies_insert on public.environment_policies for insert with check (
  public.is_staff() and (tenant_id is null or tenant_id = public.my_tenant_id())
);
drop policy if exists env_policies_update on public.environment_policies;
create policy env_policies_update on public.environment_policies for update using (
  public.is_staff() and tenant_id = public.my_tenant_id()
);

-- Tables that shipped with RLS disabled (readable across tenants).
alter table public.invoices enable row level security;
drop policy if exists invoices_tenant on public.invoices;
create policy invoices_tenant on public.invoices for select using (tenant_id = public.my_tenant_id());
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert with check (
  tenant_id = public.my_tenant_id() and public.is_staff()
);

alter table public.feature_flags enable row level security;
drop policy if exists feature_flags_read on public.feature_flags;
create policy feature_flags_read on public.feature_flags for select using (
  tenant_id is null or tenant_id = public.my_tenant_id()
);

alter table public.plans enable row level security;
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (true); -- public price list

do $$
declare t text;
begin
  foreach t in array array['schools','departments','rubrics','assignments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id()) with check (tenant_id = public.my_tenant_id())', t || '_tenant', t);
  end loop;
end $$;

alter table public.student_profiles enable row level security;
alter table public.teacher_profiles enable row level security;
drop policy if exists student_profiles_rw on public.student_profiles;
create policy student_profiles_rw on public.student_profiles for all using (
  user_id = auth.uid() or exists (select 1 from public.users u where u.id = student_profiles.user_id and u.tenant_id = public.my_tenant_id() and public.is_staff())
) with check (user_id = auth.uid() or public.is_staff());
drop policy if exists teacher_profiles_rw on public.teacher_profiles;
create policy teacher_profiles_rw on public.teacher_profiles for all using (
  user_id = auth.uid() or exists (select 1 from public.users u where u.id = teacher_profiles.user_id and u.tenant_id = public.my_tenant_id())
) with check (user_id = auth.uid());

alter table public.lesson_media enable row level security;
drop policy if exists lesson_media_rw on public.lesson_media;
create policy lesson_media_rw on public.lesson_media for all using (
  exists (select 1 from public.lessons l where l.id = lesson_media.lesson_id and l.tenant_id = public.my_tenant_id())
) with check (
  exists (select 1 from public.lessons l where l.id = lesson_media.lesson_id and l.owner_id = auth.uid())
);

-- lesson_versions had RLS on but no policies, so publish/import snapshots silently failed.
drop policy if exists lesson_versions_rw on public.lesson_versions;
create policy lesson_versions_rw on public.lesson_versions for all using (
  exists (select 1 from public.lessons l where l.id = lesson_versions.lesson_id and l.tenant_id = public.my_tenant_id())
) with check (
  exists (select 1 from public.lessons l where l.id = lesson_versions.lesson_id and l.owner_id = auth.uid())
);

alter table public.submissions enable row level security;
drop policy if exists submissions_rw on public.submissions;
create policy submissions_rw on public.submissions for all using (
  student_id = auth.uid() or exists (select 1 from public.assignments a where a.id = submissions.assignment_id and a.tenant_id = public.my_tenant_id() and public.is_staff())
) with check (student_id = auth.uid());

alter table public.grades enable row level security;
drop policy if exists grades_rw on public.grades;
create policy grades_rw on public.grades for all using (
  exists (select 1 from public.submissions s join public.assignments a on a.id = s.assignment_id
          where s.id = grades.submission_id and a.tenant_id = public.my_tenant_id()
          and (s.student_id = auth.uid() or public.is_staff()))
) with check (public.is_staff());

-- Unused legacy tables: lock them (service role only) rather than leave them open.
alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.student_presence enable row level security;
