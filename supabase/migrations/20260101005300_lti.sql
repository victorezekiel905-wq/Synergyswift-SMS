-- =====================================================================
--  Phase 13d: LTI 1.3 (Learning Tools Interoperability).
--
--  The school system acts as the LTI platform: admins register outside
--  learning tools (Khan Academy, Labster, H5P.com, publisher content…);
--  teachers add a tool to a class (optionally tied to homework); students
--  open it signed in, with no extra password. Tools that support Assignment
--  and Grade Services send scores back; scores tied to homework become the
--  homework mark.
-- =====================================================================

-- The platform's signing keys (shared by every school; the private key never leaves the server).
create table if not exists public.lti_platform_keys (
  kid          text primary key,
  public_jwk   jsonb not null,
  private_pem  text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.lti_platform_keys enable row level security;   -- server only
grant all on public.lti_platform_keys to service_role;

create table if not exists public.lti_tools (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 120),
  description      text,
  client_id        text not null unique default replace(gen_random_uuid()::text, '-', ''),
  deployment_id    text not null default replace(gen_random_uuid()::text, '-', ''),
  oidc_login_url   text not null check (oidc_login_url ~ '^https://'),
  target_link_uri  text not null check (target_link_uri ~ '^https://'),
  redirect_uris    text[] not null default '{}',
  jwks_url         text check (jwks_url is null or jwks_url ~ '^https://'),
  public_key_pem   text,
  custom           jsonb not null default '{}'::jsonb,
  send_name        boolean not null default true,
  send_email       boolean not null default false,
  grades           boolean not null default true,
  active           boolean not null default true,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  check (jwks_url is not null or public_key_pem is not null or not grades)
);
alter table public.lti_tools enable row level security;
drop policy if exists lti_tools_read on public.lti_tools;
create policy lti_tools_read on public.lti_tools for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists lti_tools_write on public.lti_tools;
create policy lti_tools_write on public.lti_tools for all
  using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
grant all on public.lti_tools to service_role;

create table if not exists public.lti_links (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  tool_id         uuid not null references public.lti_tools(id) on delete cascade,
  title           text not null check (length(trim(title)) between 1 and 160),
  class_group_id  uuid references public.class_groups(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete set null,
  homework_id     uuid references public.homework(id) on delete set null,
  target_link_uri text check (target_link_uri is null or target_link_uri ~ '^https://'),   -- a deep link inside the tool
  custom          jsonb not null default '{}'::jsonb,
  score_maximum   numeric check (score_maximum is null or score_maximum > 0),
  open_in         text not null default 'window' check (open_in in ('window','frame')),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists lti_links_class on public.lti_links(class_group_id);

-- A student may see the tools added to their own class (or to everyone).
create or replace function public.in_my_class(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_class is null or exists (select 1 from public.students s where s.user_id = auth.uid() and s.tenant_id = public.my_tenant_id() and s.class_group_id = p_class);
$$;
grant execute on function public.in_my_class(uuid) to authenticated;

alter table public.lti_links enable row level security;
drop policy if exists lti_links_read on public.lti_links;
create policy lti_links_read on public.lti_links for select using (tenant_id = public.my_tenant_id() and (public.is_staff() or public.in_my_class(class_group_id)));
drop policy if exists lti_links_write on public.lti_links;
create policy lti_links_write on public.lti_links for all
  using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff()
    and exists (select 1 from public.lti_tools t where t.id = tool_id and t.tenant_id = public.my_tenant_id() and t.active));
grant all on public.lti_links to service_role;

-- One row per launch: the login hint is single-use and expires after five minutes.
create table if not exists public.lti_launches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  link_id     uuid not null references public.lti_links(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);
alter table public.lti_launches enable row level security;   -- server only
grant all on public.lti_launches to service_role;

create table if not exists public.lti_scores (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  link_id            uuid not null references public.lti_links(id) on delete cascade,
  user_id            uuid not null references public.users(id) on delete cascade,
  score_given        numeric,
  score_maximum      numeric,
  activity_progress  text,
  grading_progress   text,
  comment            text,
  tool_timestamp     timestamptz,
  received_at        timestamptz not null default now(),
  unique (link_id, user_id)
);
alter table public.lti_scores enable row level security;
drop policy if exists lti_scores_read on public.lti_scores;
create policy lti_scores_read on public.lti_scores for select using (tenant_id = public.my_tenant_id() and (public.is_staff() or user_id = auth.uid()));
grant all on public.lti_scores to service_role;

-- Launch records are a short-lived log and keys are secrets: neither belongs in the change history.
create or replace function public.attach_change_log()
returns int language plpgsql security definer set search_path = public as $$
declare t text; n int := 0;
  skip text[] := array['data_changes','audit_logs','platform_audit_logs','message_outbox','exam_events','exam_attempts','practice_sessions',
        'browser_events','environment_events','screen_snapshots','student_presence','session_participants','raise_hands','rtc_rooms','rtc_peers','rtc_signals',
        'transport_live','push_subscriptions','doc_counters','lead_sequence_runs','access_grants','phone_login_codes','quiz_attempts','quiz_answers',
        'activity_responses','game_sessions','game_players','leaderboard_entries','conversation_messages','pickup_attempts','device_enrollments','devices',
        'teacher_commands','survey_invites','tenants',
        'learning_activity','content_attempts','xapi_statements','xapi_state','breakout_members','online_lesson_joins','tutor_messages','integration_secrets','online_lesson_hosts','admission_secrets',
        'calendar_feeds','notice_recipients','student_thread_messages',
        'sensitive_access_log','pastoral_referrals','counselling_cases','counselling_sessions','safeguarding_concerns','safeguarding_actions','wellbeing_checkins',
        'kpi_snapshots',
        'api_keys','webhook_endpoints','webhook_deliveries',
        'lti_launches','lti_platform_keys'];
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and x.table_type = 'BASE TABLE'
  loop
    -- Re-running an older update re-attaches the trigger everywhere; this puts the exclusions back.
    execute format('drop trigger if exists zz_log_data_change on public.%I', t);
    if t = any(skip) then continue; end if;
    execute format('create trigger zz_log_data_change after insert or update or delete on public.%I for each row execute function public.log_data_change()', t);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.attach_change_log() from public, anon, authenticated;
select public.attach_change_log();
