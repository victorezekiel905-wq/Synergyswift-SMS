-- =========================================================================
-- EduClass Fusion: core platform and security (phase 4).
--  * Roles: counsellor (pastoral staff) and alumni (former students; they
--    sign in to their own alumni page and see no school data).
--  * school_sections (Nursery, Primary, Secondary, Sixth form …) with a
--    curriculum framework each; classes belong to a section and may use a
--    different framework (mixed setups).
--  * Currency stored as an ISO code (NGN, GBP, USD …).
--  * data_changes: a record of every create, edit and delete in the
--    school's data, with who did it and what changed. Admins only.
--  * Password rules (length, character mix, expiry) and session rules (idle
--    time-out, maximum session length, sign out other devices).
--  * Staff access restrictions by network (IP allow-list) and/or approved
--    devices, enforced in the database through short-lived access grants.
--  * Single sign-on policy (Google Workspace, Microsoft 365) and phone
--    sign-in codes.
--  * Consent records for children's data (NDPA / GDPR) and a privacy notice.
-- Apply AFTER 20260101003100. Idempotent.
-- =========================================================================

-- ---------- roles ----------
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in (
  'student','teacher','school_admin','it_admin','parent','platform_admin',
  'principal','bursar','librarian','hr_manager','qa_officer','gate_officer',
  'transport_officer','hostel_warden','nurse','admissions_officer','cashier',
  'counsellor','alumni'
));
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['teacher','school_admin','it_admin','platform_admin','principal',
    'bursar','librarian','hr_manager','qa_officer','gate_officer','transport_officer',
    'hostel_warden','nurse','admissions_officer','cashier','counsellor']);
$$;
-- Second factor rules never apply to families or alumni.
create or replace function public.mfa_ok(p_setting text, p_role text, p_extra text[])
returns boolean language sql stable set search_path = public as $$
  select case
    when coalesce(p_setting, 'off') = 'off' then true
    when p_role in ('student','parent','alumni') then true
    when public.session_aal() = 'aal2' then true
    when p_setting = 'admins' then not ((array[p_role] || coalesce(p_extra, '{}'))
      && array['school_admin','principal','it_admin','bursar','hr_manager','platform_admin'])
    else false
  end;
$$;
-- Counsellors read health records alongside the nurse.
drop policy if exists medical_read on public.medical_profiles;
create policy medical_read on public.medical_profiles for select using (
  tenant_id = public.my_tenant_id() and (public.has_role(array['nurse','school_admin','principal','platform_admin','hostel_warden','counsellor'])
    or public.teaches_student(student_id) or public.is_guardian_of(student_id)));
drop policy if exists sickbay_read on public.sickbay_visits;
create policy sickbay_read on public.sickbay_visits for select using (
  tenant_id = public.my_tenant_id() and (public.has_role(array['nurse','school_admin','principal','platform_admin','hostel_warden','counsellor'])
    or public.is_guardian_of(student_id)));

alter table public.alumni add column if not exists user_id uuid unique references public.users(id) on delete set null;

-- ---------- settings ----------
update public.tenant_settings set currency = 'NGN' where currency is null or currency !~ '^[A-Z]{3}$';
alter table public.tenant_settings drop constraint if exists tenant_settings_currency_check;
alter table public.tenant_settings add constraint tenant_settings_currency_check check (currency ~ '^[A-Z]{3}$');
alter table public.tenant_settings add column if not exists curriculum text;
alter table public.tenant_settings add column if not exists password_min_length int not null default 8;
alter table public.tenant_settings add column if not exists password_require_mixed_case boolean not null default false;
alter table public.tenant_settings add column if not exists password_require_number boolean not null default true;
alter table public.tenant_settings add column if not exists password_require_symbol boolean not null default false;
alter table public.tenant_settings add column if not exists password_max_age_days int not null default 0;
alter table public.tenant_settings add column if not exists password_policy_scope text not null default 'staff';
alter table public.tenant_settings add column if not exists session_idle_minutes int not null default 0;
alter table public.tenant_settings add column if not exists session_max_hours int not null default 0;
alter table public.tenant_settings add column if not exists staff_access_mode text not null default 'off';
alter table public.tenant_settings add column if not exists staff_access_roles text not null default 'except_admins';
alter table public.tenant_settings add column if not exists staff_ip_allowlist text[] not null default '{}';
alter table public.tenant_settings add column if not exists sso_policy text not null default 'optional';
alter table public.tenant_settings add column if not exists sso_domains text[] not null default '{}';
alter table public.tenant_settings add column if not exists sso_auto_join boolean not null default false;
alter table public.tenant_settings add column if not exists allow_phone_login boolean not null default true;
alter table public.tenant_settings add column if not exists privacy_notice text;
alter table public.tenant_settings add column if not exists privacy_notice_version int not null default 1;
alter table public.tenant_settings add column if not exists audit_retention_days int not null default 730;
do $$
begin
  alter table public.tenant_settings drop constraint if exists tenant_settings_security_check;
  alter table public.tenant_settings add constraint tenant_settings_security_check check (
    password_min_length between 8 and 64 and password_max_age_days between 0 and 730
    and password_policy_scope in ('staff','all')
    and (session_idle_minutes = 0 or session_idle_minutes between 5 and 720)
    and (session_max_hours = 0 or session_max_hours between 1 and 720)
    and staff_access_mode in ('off','ip','device','ip_or_device')
    and staff_access_roles in ('all_staff','except_admins')
    and sso_policy in ('optional','required_staff')
    and audit_retention_days between 30 and 3650);
end $$;

alter table public.users add column if not exists password_changed_at timestamptz;
update public.users set password_changed_at = now() where password_changed_at is null;
alter table public.users alter column password_changed_at set default now();

-- Users cannot move their own password clock; only the server sets it after a change.
create or replace function public.users_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / SQL editor
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot be changed';
  end if;
  if new.password_changed_at is distinct from old.password_changed_at then
    raise exception 'password_changed_at is set by the server';
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

-- ---------- sections and curriculum ----------
create table if not exists public.school_sections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(name) between 1 and 60),
  kind          text not null default 'other' check (kind in ('nursery','primary','secondary','sixth_form','other')),
  curriculum    text,                          -- framework key, e.g. 'nigeria_ube', 'uk_eyfs', 'igcse'
  head_user_id  uuid references public.users(id) on delete set null,
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table public.class_groups add column if not exists section_id uuid references public.school_sections(id) on delete set null;
alter table public.class_groups add column if not exists curriculum text;     -- overrides the section's framework
create index if not exists class_groups_section on public.class_groups(section_id);
alter table public.school_sections enable row level security;
drop policy if exists school_sections_read on public.school_sections;
create policy school_sections_read on public.school_sections for select using (tenant_id = public.my_tenant_id());
drop policy if exists school_sections_admin on public.school_sections;
create policy school_sections_admin on public.school_sections for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

-- ---------- access restrictions, sessions, sign-in codes ----------
create table if not exists public.staff_devices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  device_hash  text not null,
  label        text,
  user_agent   text,
  last_ip      text,
  status       text not null default 'pending' check (status in ('pending','approved','revoked')),
  approved_by  uuid references public.users(id) on delete set null,
  approved_at  timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, device_hash)
);
alter table public.staff_devices enable row level security;
drop policy if exists staff_devices_admin on public.staff_devices;
create policy staff_devices_admin on public.staff_devices for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
drop policy if exists staff_devices_own on public.staff_devices;
create policy staff_devices_own on public.staff_devices for select using (user_id = auth.uid());

-- Written by the server after it has checked the request's network and device.
create table if not exists public.access_grants (
  user_id     uuid not null references public.users(id) on delete cascade,
  session_id  uuid not null,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  ip          text,
  expires_at  timestamptz not null,
  primary key (user_id, session_id)
);
alter table public.access_grants enable row level security;
revoke all on public.access_grants from anon, authenticated;

create table if not exists public.phone_login_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  phone       text not null,
  code_hash   text not null,
  attempts    int not null default 0,
  ip          text,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists phone_login_codes_phone on public.phone_login_codes(phone, created_at desc);
alter table public.phone_login_codes enable row level security;
revoke all on public.phone_login_codes from anon, authenticated;

-- The current session's id and sign-in method, from the access token.
create or replace function public.session_id()
returns uuid language sql stable set search_path = public as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;
create or replace function public.session_used_sso()
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
                 where e ->> 'method' in ('oauth','sso/saml'));
$$;

-- Why this session may not use the school's data right now, or null when it may.
create or replace function public.session_block(p_user public.users, p_s public.tenant_settings)
returns text language plpgsql stable security definer set search_path = public, auth as $$
declare
  staff boolean := p_user.role not in ('student','parent','alumni');
  admin boolean := (array[p_user.role] || coalesce(p_user.extra_roles, '{}')) && array['school_admin','principal','platform_admin'];
  started timestamptz;
begin
  if p_s.tenant_id is null then return null; end if;
  if coalesce(p_s.password_max_age_days, 0) > 0 and (staff or p_s.password_policy_scope = 'all')
     and coalesce(p_user.password_changed_at, 'epoch'::timestamptz) < now() - make_interval(days => p_s.password_max_age_days) then
    return 'password_expired';
  end if;
  if staff and p_s.sso_policy = 'required_staff' and not public.session_used_sso() then
    return 'sso_required';
  end if;
  if coalesce(p_s.session_max_hours, 0) > 0 and staff then
    begin
      select s.created_at into started from auth.sessions s where s.id = public.session_id();
    exception when others then
      started := now();   -- sign-in records unreadable: never lock a whole school out over it
    end;
    if started is null or started < now() - make_interval(hours => p_s.session_max_hours) then return 'session_expired'; end if;
  end if;
  if staff and coalesce(p_s.staff_access_mode, 'off') <> 'off' and not (p_s.staff_access_roles = 'except_admins' and admin) then
    if not exists (select 1 from public.access_grants g where g.user_id = p_user.id and g.session_id = public.session_id() and g.expires_at > now()) then
      return 'access_restricted';
    end if;
  end if;
  return null;
end $$;

-- The caller's school. Empty when the school is suspended, the user is
-- deactivated or an alumnus, a required second factor is missing, or a
-- password, sign-on, session or network rule blocks this session.
create or replace function public.my_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u.tenant_id
  from public.users u
  join public.tenants t on t.id = u.tenant_id
  left join public.tenant_settings s on s.tenant_id = u.tenant_id
  where u.id = auth.uid() and t.status = 'active' and u.active and u.role <> 'alumni'
    and public.mfa_ok(s.require_mfa, u.role, u.extra_roles)
    and public.session_block(u, s) is null;
$$;

create or replace function public.my_account_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when u.id is null then jsonb_build_object('state', 'no_profile')
    when t.status <> 'active' then jsonb_build_object('state', t.status, 'school', t.name, 'message', t.status_message)
    when not u.active then jsonb_build_object('state', 'deactivated', 'school', t.name)
    when u.role = 'alumni' then jsonb_build_object('state', 'alumni', 'school', t.name)
    when not public.mfa_ok(s.require_mfa, u.role, u.extra_roles) then jsonb_build_object('state', 'mfa_required', 'school', t.name)
    when public.session_block(u, s) is not null then jsonb_build_object('state', public.session_block(u, s), 'school', t.name)
    else jsonb_build_object('state', 'active')
  end
  from (select auth.uid() as uid) me
  left join public.users u on u.id = me.uid
  left join public.tenants t on t.id = u.tenant_id
  left join public.tenant_settings s on s.tenant_id = u.tenant_id;
$$;
grant execute on function public.my_account_state(), public.session_id(), public.session_used_sso() to authenticated;
revoke all on function public.session_block(public.users, public.tenant_settings) from public, anon, authenticated;

-- Families and alumni see staff names; alumni themselves are not listed to others.
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users for select using (
  (id = auth.uid() and public.my_tenant_id() is not null)
  or (tenant_id = public.my_tenant_id() and (public.is_staff() or role not in ('student','parent','alumni')))
);

-- Signed-in devices for the caller, and signing them out.
create or replace function public.my_sessions()
returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, ip text, current boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  return query select s.id, s.created_at, s.updated_at, s.user_agent::text, host(s.ip)::text, s.id = public.session_id()
    from auth.sessions s where s.user_id = auth.uid() order by s.updated_at desc nulls last;
end $$;
create or replace function public.end_my_sessions(p_session uuid default null, p_others boolean default false)
returns int language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.sessions s where s.user_id = auth.uid()
    and ((p_session is not null and s.id = p_session) or (p_others and s.id is distinct from public.session_id()));
  get diagnostics n = row_count;
  return n;
end $$;
-- An admin signs a member of their school out everywhere.
create or replace function public.end_user_sessions(p_user uuid)
returns int language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if not public.is_school_admin() or not exists (select 1 from public.users where id = p_user and tenant_id = public.my_tenant_id()) then
    raise exception 'not allowed';
  end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  delete from public.access_grants where user_id = p_user;
  return n;
end $$;
grant execute on function public.my_sessions(), public.end_my_sessions(uuid, boolean), public.end_user_sessions(uuid) to authenticated;

-- ---------- consent ----------
create table if not exists public.consent_purposes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  key          text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  title        text not null check (length(title) between 2 and 120),
  description  text not null default '',
  per_child    boolean not null default true,      -- asked for each child, or once per family
  required     boolean not null default false,     -- needed to provide the service (recorded, not optional)
  version      int not null default 1,
  active       boolean not null default true,
  position     int not null default 0,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, key)
);
create table if not exists public.consent_records (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  purpose_id   uuid not null references public.consent_purposes(id) on delete cascade,
  version      int not null,
  guardian_id  uuid references public.guardians(id) on delete set null,
  student_id   uuid references public.students(id) on delete cascade,
  granted      boolean not null,
  method       text not null default 'portal' check (method in ('portal','link','paper','staff','email')),
  recorded_by  uuid references public.users(id) on delete set null,
  note         text,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index if not exists consent_records_lookup on public.consent_records(tenant_id, purpose_id, student_id, guardian_id, created_at desc);
alter table public.consent_purposes enable row level security;
alter table public.consent_records enable row level security;
drop policy if exists consent_purposes_read on public.consent_purposes;
create policy consent_purposes_read on public.consent_purposes for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists consent_purposes_admin on public.consent_purposes;
create policy consent_purposes_admin on public.consent_purposes for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
-- Staff read consents (e.g. photo permission before posting); records are added, never edited.
drop policy if exists consent_records_read on public.consent_records;
create policy consent_records_read on public.consent_records for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists consent_records_admin on public.consent_records;
create policy consent_records_admin on public.consent_records for insert with check (
  tenant_id = public.my_tenant_id() and public.is_school_admin() and recorded_by = auth.uid() and method in ('paper','staff','email'));

-- ---------- change history ----------
create table if not exists public.data_changes (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  table_name  text not null,
  row_id      text,
  op          text not null check (op in ('insert','update','delete')),
  actor_id    uuid,
  actor       text not null default 'system',     -- user, guardian:<id>, public, system
  changes     jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists data_changes_tenant_at on public.data_changes(tenant_id, at desc);
create index if not exists data_changes_row on public.data_changes(tenant_id, table_name, row_id);
create index if not exists data_changes_actor on public.data_changes(tenant_id, actor_id, at desc);
alter table public.data_changes enable row level security;
drop policy if exists data_changes_admin on public.data_changes;
create policy data_changes_admin on public.data_changes for select using (tenant_id = public.my_tenant_id() and public.is_school_admin());
revoke insert, update, delete on public.data_changes from anon, authenticated;

create or replace function public.log_data_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  src jsonb := coalesce(n, o);
  tid uuid := nullif(src ->> 'tenant_id', '')::uuid;
  diff jsonb := '{}'::jsonb;
  k text;
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  hdr jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  who uuid := auth.uid();
  label text := 'user';
  secret text[] := array['token','portal_token','pay_token','access_token','unsubscribe_token','update_token','card_code','code_hash',
    'secret','lead_webhook_key','offer_signature','p256dh','auth','endpoint','device_hash','referral_code'];
  noise text[] := array['updated_at','last_seen_at','last_message_at','staff_unread','guardian_unread','last_contact_at'];
  v jsonb;
begin
  if tid is null or tid::text = coalesce(current_setting('app.purging_tenant', true), '') then return null; end if;
  if not exists (select 1 from public.tenants where id = tid) then return null; end if;   -- the school itself is being deleted
  if who is null then
    -- The server acts for a person: it says who in a header, trusted only from the service role.
    if claims ->> 'role' = 'service_role' and coalesce(hdr ->> 'x-actor', '') <> '' then
      label := left(hdr ->> 'x-actor', 80);
      if label ~ '^user:[0-9a-f-]{36}$' then who := substr(label, 6)::uuid; label := 'user'; end if;
    else
      label := 'system';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k = any(noise) or (n -> k) is not distinct from (o -> k) then continue; end if;
      diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
    end loop;
    if diff = '{}'::jsonb then return null; end if;
  else
    diff := src;
  end if;
  for k in select jsonb_object_keys(diff) loop
    if k = any(secret) then diff := jsonb_set(diff, array[k], '"[hidden]"'::jsonb);
    else
      v := diff -> k;
      if length(v::text) > 600 then diff := jsonb_set(diff, array[k], to_jsonb(left(v::text, 600) || '…')); end if;
    end if;
  end loop;
  insert into public.data_changes (tenant_id, table_name, row_id, op, actor_id, actor, changes)
    values (tid, tg_table_name, src ->> 'id', lower(tg_op), who, label, diff);
  return null;
end $$;

-- Every table holding a school's data, except high-volume logs and machine state.
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and x.table_type = 'BASE TABLE'
      and c.table_name not in ('data_changes','audit_logs','platform_audit_logs','message_outbox','exam_events','exam_attempts','practice_sessions',
        'browser_events','environment_events','screen_snapshots','student_presence','session_participants','raise_hands','rtc_rooms','rtc_peers','rtc_signals',
        'transport_live','push_subscriptions','doc_counters','lead_sequence_runs','access_grants','phone_login_codes','quiz_attempts','quiz_answers',
        'activity_responses','game_sessions','game_players','leaderboard_entries','conversation_messages','pickup_attempts','device_enrollments','devices',
        'teacher_commands','survey_invites','tenants')
  loop
    execute format('drop trigger if exists zz_log_data_change on public.%I', t);
    execute format('create trigger zz_log_data_change after insert or update or delete on public.%I for each row execute function public.log_data_change()', t);
  end loop;
end $$;

-- Deleting a school skips the change history and removes it with everything else.
create or replace function public.platform_delete_tenant(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_users uuid[];
  v_pass int := 0;
  v_blocked text[];
begin
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'school not found'; end if;
  perform set_config('app.purging_tenant', p_tenant::text, true);
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
  perform set_config('app.purging_tenant', '', true);
  return jsonb_build_object('users', to_jsonb(v_users), 'passes', v_pass);
end $$;
revoke all on function public.platform_delete_tenant(uuid) from public, anon, authenticated;
grant execute on function public.platform_delete_tenant(uuid) to service_role;

grant all on public.school_sections, public.staff_devices, public.access_grants, public.phone_login_codes, public.consent_purposes,
  public.consent_records, public.data_changes to service_role;
