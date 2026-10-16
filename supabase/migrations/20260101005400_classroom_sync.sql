-- =====================================================================
--  Phase 13e: Google Classroom and Microsoft Teams / OneNote.
--
--  * Each teacher connects their own Google or Microsoft school account
--    (tokens are kept on the server only).
--  * A class (and subject) is linked to a Classroom course or a Teams class.
--  * Homework is sent across as an assignment, and marks are brought back
--    into the homework, matched by email.
--  * Lesson notes can be sent to the teacher's OneNote.
-- =====================================================================

create table if not exists public.oauth_connections (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  provider       text not null check (provider in ('google','microsoft')),
  account_email  text,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  scopes         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, provider)
);
alter table public.oauth_connections enable row level security;   -- server only: tokens never reach the browser
grant all on public.oauth_connections to service_role;

create table if not exists public.class_links (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete cascade,
  provider        text not null check (provider in ('google','microsoft')),
  external_id     text not null check (length(external_id) between 1 and 200),
  external_name   text,
  external_url    text,
  linked_by       uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create unique index if not exists class_links_once on public.class_links(class_group_id, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), provider);
alter table public.class_links enable row level security;
drop policy if exists class_links_read on public.class_links;
create policy class_links_read on public.class_links for select using (tenant_id = public.my_tenant_id() and public.is_staff());
grant all on public.class_links to service_role;   -- written by the server after checking the teacher teaches the class

create table if not exists public.homework_external (
  homework_id     uuid not null references public.homework(id) on delete cascade,
  provider        text not null check (provider in ('google','microsoft')),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_link_id   uuid references public.class_links(id) on delete set null,
  external_id     text not null,
  external_url    text,
  pushed_by       uuid references public.users(id) on delete set null,
  pushed_at       timestamptz not null default now(),
  grades_pulled_at timestamptz,
  primary key (homework_id, provider)
);
alter table public.homework_external enable row level security;
drop policy if exists homework_external_read on public.homework_external;
create policy homework_external_read on public.homework_external for select using (tenant_id = public.my_tenant_id() and public.is_staff());
grant all on public.homework_external to service_role;

alter table public.lesson_notes add column if not exists onenote_url text;

-- Tokens are secrets: keep them out of the change history.
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
        'lti_launches','lti_platform_keys',
        'oauth_connections'];
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
