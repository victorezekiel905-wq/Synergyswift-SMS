-- 9600: sign-up codes for staff, students and parents, and parent codes to add a child.
--
-- * Every staff member, student and parent the school adds gets a personal sign-up
--   code at once (one use). With it they make their own account: their email as the
--   username and a password of their own. The account gets the role the school chose
--   (staff: the role an admin set, teacher until then; students: student; parents: parent)
--   and is joined to their record, so they land on the right dashboard.
-- * Every student also gets a parent code (up to 4 parents). A parent signs up with it,
--   or, already signed in, types it to add another child to their page.
-- * Codes are 8 characters with no look-alikes (no 0/O, 1/I), shown as ABCD-EFGH.
--   Nobody but the server reads this table; the school's admins see codes on their page.
-- * The other way in, a one-time password the school sends, uses users.must_change_password
--   (the person chooses a new password, twice, at the first sign-in).
-- Safe to run more than once.

create table if not exists public.account_codes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  kind         text not null check (kind in ('staff', 'student', 'guardian', 'parent_link')),
  staff_id     uuid references public.staff(id) on delete cascade,
  student_id   uuid references public.students(id) on delete cascade,
  guardian_id  uuid references public.guardians(id) on delete cascade,
  code         text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  role         text,                       -- staff: the role they sign up with
  extra_roles  text[] not null default '{}',
  max_uses     int not null default 1 check (max_uses between 1 and 20),
  uses         int not null default 0,
  used_at      timestamptz,                -- set when the last use is spent
  used_by      uuid references auth.users(id) on delete set null,
  revoked_at   timestamptz,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check ((kind = 'staff') = (staff_id is not null)),
  check ((kind in ('student', 'parent_link')) = (student_id is not null)),
  check ((kind = 'guardian') = (guardian_id is not null))
);
create index if not exists account_codes_tenant on public.account_codes(tenant_id, kind);
-- One live code per person and kind (a new one replaces the old).
create unique index if not exists account_codes_live on public.account_codes(kind, coalesce(staff_id, student_id, guardian_id)) where revoked_at is null;

alter table public.account_codes enable row level security;
revoke all on public.account_codes from anon, authenticated;
grant select, insert, update, delete on public.account_codes to service_role;

-- Wrong guesses, to slow down anyone trying codes (kept a day).
create table if not exists public.account_code_tries (
  id   bigint generated always as identity primary key,
  key  text not null,
  at   timestamptz not null default now()
);
create index if not exists account_code_tries_key on public.account_code_tries(key, at);
alter table public.account_code_tries enable row level security;
revoke all on public.account_code_tries from anon, authenticated;
grant select, insert, delete on public.account_code_tries to service_role;

/** A new code: 8 characters from 32 with no look-alikes, never used before. */
create or replace function public.new_account_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  h text; c text; i int;
begin
  loop
    h := md5(gen_random_uuid()::text || clock_timestamp()::text);
    c := '';
    for i in 0..7 loop
      c := c || substr(a, 1 + (('x' || substr(h, i * 3 + 1, 3))::bit(12)::int % 32), 1);
    end loop;
    exit when not exists (select 1 from public.account_codes where code = c);
  end loop;
  return c;
end$$;

/** Issues (or replaces) the live code of one kind for one person. Returns the code. */
create or replace function public.issue_account_code(p_kind text, p_id uuid, p_by uuid default null, p_role text default null, p_extra text[] default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid; v_code text; v_old public.account_codes;
begin
  if p_kind = 'staff' then select tenant_id into v_tenant from public.staff where id = p_id;
  elsif p_kind in ('student', 'parent_link') then select tenant_id into v_tenant from public.students where id = p_id;
  elsif p_kind = 'guardian' then select tenant_id into v_tenant from public.guardians where id = p_id;
  else raise exception 'unknown code kind %', p_kind using errcode = '22023'; end if;
  if v_tenant is null then raise exception 'not found' using errcode = 'P0002'; end if;
  -- A staff code keeps the role chosen for it unless a new one is given.
  select * into v_old from public.account_codes where kind = p_kind and coalesce(staff_id, student_id, guardian_id) = p_id and revoked_at is null;
  update public.account_codes set revoked_at = now() where id = v_old.id;
  v_code := public.new_account_code();
  insert into public.account_codes (tenant_id, kind, staff_id, student_id, guardian_id, code, role, extra_roles, max_uses, created_by)
    values (v_tenant, p_kind,
            case when p_kind = 'staff' then p_id end,
            case when p_kind in ('student', 'parent_link') then p_id end,
            case when p_kind = 'guardian' then p_id end,
            v_code,
            case when p_kind = 'staff' then coalesce(p_role, v_old.role, 'teacher') end,
            coalesce(p_extra, v_old.extra_roles, '{}'),
            case when p_kind = 'parent_link' then 4 else 1 end,
            (select id from public.users where id = p_by));
  return v_code;
end$$;

-- New people get their codes as they are added (only those without an account yet).
create or replace function public.account_codes_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'staff' then
    if new.user_id is null then perform public.issue_account_code('staff', new.id); end if;
  elsif tg_table_name = 'students' then
    if new.user_id is null then perform public.issue_account_code('student', new.id); end if;
    perform public.issue_account_code('parent_link', new.id);
  elsif tg_table_name = 'guardians' then
    if new.user_id is null then perform public.issue_account_code('guardian', new.id); end if;
  end if;
  return new;
end$$;

drop trigger if exists account_codes_new on public.staff;
create trigger account_codes_new after insert on public.staff for each row execute function public.account_codes_on_insert();
drop trigger if exists account_codes_new on public.students;
create trigger account_codes_new after insert on public.students for each row execute function public.account_codes_on_insert();
drop trigger if exists account_codes_new on public.guardians;
create trigger account_codes_new after insert on public.guardians for each row execute function public.account_codes_on_insert();

-- People already on the books get theirs now.
do $$
declare r record;
begin
  for r in select s.id from public.staff s where s.user_id is null and s.status <> 'exited'
             and not exists (select 1 from public.account_codes c where c.kind = 'staff' and c.staff_id = s.id and c.revoked_at is null) loop
    perform public.issue_account_code('staff', r.id);
  end loop;
  for r in select s.id, s.user_id from public.students s where s.status = 'active' loop
    if r.user_id is null and not exists (select 1 from public.account_codes c where c.kind = 'student' and c.student_id = r.id and c.revoked_at is null) then
      perform public.issue_account_code('student', r.id);
    end if;
    if not exists (select 1 from public.account_codes c where c.kind = 'parent_link' and c.student_id = r.id and c.revoked_at is null) then
      perform public.issue_account_code('parent_link', r.id);
    end if;
  end loop;
  for r in select g.id from public.guardians g where g.user_id is null
             and not exists (select 1 from public.account_codes c where c.kind = 'guardian' and c.guardian_id = g.id and c.revoked_at is null) loop
    perform public.issue_account_code('guardian', r.id);
  end loop;
end$$;

/** A typed code as stored: capitals, letters and numbers only (dashes and spaces dropped). */
create or replace function public.clean_account_code(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

/**
 * Uses a sign-up code for a sign-in account that was just made (server only). Locks the
 * code, makes the profile with the role the school chose, joins it to the person's record
 * and spends one use. Errors are worded for the person signing up.
 */
create or replace function public.claim_account_code(p_code text, p_user uuid, p_email text, p_full_name text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c        public.account_codes;
  v_status text;
  v_role   text;
  v_extra  text[] := '{}';
  v_name   text;
  v_gid    uuid;
  v_target uuid;
  v_email  text := lower(btrim(coalesce(p_email, '')));
begin
  select * into c from public.account_codes where code = public.clean_account_code(p_code) for update;
  if c.id is null or c.revoked_at is not null then
    raise exception 'That code is not right. Check it, or ask the school for a new one.' using errcode = 'P0002';
  end if;
  if c.used_at is not null or c.uses >= c.max_uses then
    raise exception 'That code has already been used. Sign in instead, or ask the school for a new one.' using errcode = 'P0001';
  end if;
  select status into v_status from public.tenants where id = c.tenant_id;
  if v_status is distinct from 'active' then raise exception 'That code is not right. Check it, or ask the school for a new one.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.users where id = p_user) then
    raise exception 'This sign-in already has an account.' using errcode = 'P0001';
  end if;

  if c.kind = 'staff' then
    select full_name, user_id into v_name, v_target from public.staff where id = c.staff_id;
    if v_target is not null then raise exception 'This person already has an account. Sign in instead.' using errcode = 'P0001'; end if;
    v_role := coalesce(c.role, 'teacher'); v_extra := coalesce(c.extra_roles, '{}');
  elsif c.kind = 'student' then
    select first_name || ' ' || last_name, user_id into v_name, v_target from public.students where id = c.student_id;
    if v_target is not null then raise exception 'This student already has an account. Sign in instead.' using errcode = 'P0001'; end if;
    v_role := 'student';
  elsif c.kind = 'guardian' then
    select full_name, user_id into v_name, v_target from public.guardians where id = c.guardian_id;
    if v_target is not null then raise exception 'This parent already has an account. Sign in instead.' using errcode = 'P0001'; end if;
    v_role := 'parent';
  else
    -- A parent signing up with their child's parent code: their parent record if the school
    -- already has one with this email (and no account), else a new one.
    v_role := 'parent';
    select id, full_name into v_gid, v_name from public.guardians
      where tenant_id = c.tenant_id and user_id is null and lower(email) = v_email order by created_at limit 1;
    if v_gid is null then
      v_name := coalesce(nullif(btrim(p_full_name), ''), split_part(v_email, '@', 1));
      insert into public.guardians (tenant_id, full_name, email) values (c.tenant_id, v_name, v_email) returning id into v_gid;
      -- (the insert trigger gave the new record its own code; it is not needed now)
      update public.account_codes set revoked_at = now() where kind = 'guardian' and guardian_id = v_gid and revoked_at is null;
    end if;
  end if;

  insert into public.users (id, tenant_id, email, full_name, role, extra_roles)
    values (p_user, c.tenant_id, v_email, coalesce(v_name, 'User'), v_role, v_extra);

  if c.kind = 'staff' then update public.staff set user_id = p_user, email = coalesce(nullif(email, ''), v_email) where id = c.staff_id;
  elsif c.kind = 'student' then update public.students set user_id = p_user where id = c.student_id;
  elsif c.kind = 'guardian' then update public.guardians set user_id = p_user, email = coalesce(nullif(email, ''), v_email) where id = c.guardian_id;
  else
    update public.guardians set user_id = p_user where id = v_gid;
    insert into public.student_guardians (tenant_id, student_id, guardian_id, relation)
      values (c.tenant_id, c.student_id, v_gid, 'parent') on conflict (student_id, guardian_id) do nothing;
  end if;
  -- A personal code is spent; a parent code counts one more parent.
  if c.kind <> 'parent_link' then
    update public.account_codes set uses = c.max_uses, used_at = now(), used_by = p_user where id = c.id;
  else
    update public.account_codes set uses = uses + 1, used_by = p_user, used_at = case when uses + 1 >= max_uses then now() end where id = c.id;
  end if;
  insert into public.audit_logs (tenant_id, actor_id, action, target, meta)
    values (c.tenant_id, p_user, 'account.signed_up_with_code', p_user::text, jsonb_build_object('kind', c.kind, 'role', v_role));
  return jsonb_build_object('tenant_id', c.tenant_id, 'role', v_role, 'kind', c.kind, 'name', v_name,
    'next', case v_role when 'parent' then '/parent' when 'student' then '/student' else '/dashboard' end);
end$$;

/**
 * A signed-in parent adds a child with the child's parent code (server only). The child
 * must be in the parent's own school. Returns the child's name.
 */
create or replace function public.link_child_with_code(p_code text, p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c      public.account_codes;
  u      public.users;
  v_gid  uuid;
  v_name text;
begin
  select * into u from public.users where id = p_user;
  if u.id is null or not (u.role = 'parent' or 'parent' = any(coalesce(u.extra_roles, '{}'))) then
    raise exception 'Only parents add children with a parent code.' using errcode = '42501';
  end if;
  select * into c from public.account_codes where code = public.clean_account_code(p_code) and kind = 'parent_link' for update;
  if c.id is null or c.revoked_at is not null or c.tenant_id <> u.tenant_id then
    raise exception 'That parent code is not right. Check it with the school.' using errcode = 'P0002';
  end if;
  if c.used_at is not null or c.uses >= c.max_uses then
    raise exception 'That parent code has been used by as many parents as it allows. Ask the school for a new one.' using errcode = 'P0001';
  end if;
  select id into v_gid from public.guardians where tenant_id = u.tenant_id and user_id = p_user order by created_at limit 1;
  if v_gid is null then
    insert into public.guardians (tenant_id, full_name, email, user_id) values (u.tenant_id, u.full_name, u.email, p_user) returning id into v_gid;
    update public.account_codes set revoked_at = now() where kind = 'guardian' and guardian_id = v_gid and revoked_at is null;
  end if;
  select first_name || ' ' || last_name into v_name from public.students where id = c.student_id;
  if exists (select 1 from public.student_guardians where student_id = c.student_id and guardian_id = v_gid) then
    return jsonb_build_object('already', true, 'student_id', c.student_id, 'name', v_name);
  end if;
  insert into public.student_guardians (tenant_id, student_id, guardian_id, relation) values (u.tenant_id, c.student_id, v_gid, 'parent');
  update public.account_codes set uses = uses + 1, used_by = p_user, used_at = case when uses + 1 >= max_uses then now() end where id = c.id;
  insert into public.audit_logs (tenant_id, actor_id, action, target, meta)
    values (u.tenant_id, p_user, 'parent.child_linked_with_code', c.student_id::text, jsonb_build_object('guardian_id', v_gid));
  return jsonb_build_object('already', false, 'student_id', c.student_id, 'name', v_name);
end$$;

revoke execute on function public.new_account_code(), public.issue_account_code(text, uuid, uuid, text, text[]),
  public.claim_account_code(text, uuid, text, text), public.link_child_with_code(text, uuid) from public, anon, authenticated;
grant execute on function public.new_account_code(), public.issue_account_code(text, uuid, uuid, text, text[]),
  public.claim_account_code(text, uuid, text, text), public.link_child_with_code(text, uuid) to service_role;

-- Codes are secrets: never kept in the recycle bin (9400), now or when its set-up is run again.
create or replace function public.recycle_bin_skip_tables() returns text[] language sql immutable as $$
  select array[
    'public.recycle_bin','public.data_changes','public.audit_logs','public.platform_audit_logs','public.message_outbox','public.browser_events',
    'public.environment_events','public.screen_snapshots','public.student_presence','public.raise_hands','public.rtc_rooms','public.rtc_peers',
    'public.rtc_signals','public.transport_live','public.push_subscriptions','public.doc_counters','public.lead_sequence_runs','public.access_grants',
    'public.phone_login_codes','public.device_enrollments','public.devices','public.teacher_commands','public.tenants','public.users','public.perf_samples',
    'public.result_pin_tries','public.cron_locks','public.demo_request_tries','public.auth_mail_log','public.api_keys','public.integration_secrets',
    'public.admission_secrets','public.oauth_connections','public.canva_connections','public.lti_platform_keys','public.sensitive_access_log','public.ai_usage',
    'public.notifications','public.webhook_deliveries','public.webhook_endpoints','public.kpi_snapshots','public.platform_support_sessions',
    'public.platform_admins','public.plans','public.platform_settings','public.entrance_lookups','public.staff_devices','public.signup_requests',
    'public.tenant_module_overrides','public.subscriptions','public.feature_flags','public.weekly_report_runs','public.tenant_groups','public.group_admins',
    'public.sales_leads','public.sales_activities','public.sales_quotes','public.whatsapp_unmatched','public.open_books',
    'public.account_codes','public.account_code_tries',
    'live.audit_logs','live.browser_events','live.browser_sessions','live.environment_events','live.error_events','live.screen_snapshots','live.rtc_rooms',
    'live.rtc_peers','live.rtc_signals','live.raise_hands','live.teacher_commands','live.device_enrollments','live.device_pairing_codes','live.devices',
    'live.rate_buckets','live.platform_admins','live.platform_audit','live.platform_config','live.platform_stats','live.notifications','live.users',
    'live.tenants','live.schools','live.feature_flags','live.seb_passes','live.invites','live.subscriptions','live.invoices','live.plans','live.roles',
    'live.support_accounts','live.monitoring_consents','live.consents','live.off_task_feedback','live.off_task_mutes','live.spotlights','live.domain_categories',
    'live.library_lessons','live.tenant_settings'
  ]::text[]
$$;
drop trigger if exists aaa_recycle_bin on public.account_codes;
drop trigger if exists aaa_recycle_bin_unlink on public.account_codes;
drop trigger if exists aaa_recycle_bin on public.account_code_tries;
drop trigger if exists aaa_recycle_bin_unlink on public.account_code_tries;
