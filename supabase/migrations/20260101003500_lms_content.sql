-- =========================================================================
-- EduClass Fusion: learning management, part 2 (phase 6b).
--  * content_packages, content_attempts, xapi_statements, xapi_state:
--    SCORM 1.2 / 2004, xAPI (Tin Can), H5P and HTML packages with progress.
--  * learning_paths, learning_path_steps, learning_path_progress: ordered
--    paths with prerequisites and quiz steps.
--  * online_lessons (+ hosts, joins), integration_secrets: Zoom, Google Meet
--    and Microsoft Teams lessons with join tracking.
--  * rtc_rooms breakouts + breakout_members; live rooms limited to the
--    session's class (they were open to the whole school).
--  * tutor_conversations, tutor_messages: the AI tutor, visible to the
--    student's teachers and parents, with concerns flagged.
--  * attach_change_log(): change history on every school table, including
--    the ones added in 20260101003300 and 20260101003400.
--  * learning_activity: points are recorded once per item with a unique
--    constraint the API can use (the partial index could not be).
-- Apply AFTER 20260101003400. Idempotent.
-- =========================================================================

-- One row per student, kind and item. A plain unique constraint (nulls never clash) so
-- "insert … on conflict do nothing" from the API works; a partial index cannot be named there.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'learning_activity_once') then
    drop index if exists public.learning_activity_once;
    alter table public.learning_activity add constraint learning_activity_once unique (student_id, kind, ref_id);
  end if;
end $$;

-- Students (or their parents) linked to one of these classes.
create or replace function public.sees_class_content(p_classes uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    where s.tenant_id = public.my_tenant_id() and s.status = 'active' and s.class_group_id = any(p_classes)
      and (s.user_id = auth.uid() or public.is_guardian_of(s.id)));
$$;
grant execute on function public.sees_class_content(uuid[]) to authenticated;

-- ---------- content library ----------
create table if not exists public.content_packages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  title            text not null check (length(title) between 2 and 160),
  description      text,
  kind             text not null check (kind in ('scorm12','scorm2004','xapi','h5p','html')),
  subject_id       uuid references public.subjects(id) on delete set null,
  level            text,
  launch_path      text not null,
  files            jsonb not null default '[]'::jsonb,   -- [{ p: path, s: size, t: type }]
  size_bytes       bigint not null default 0,
  meta             jsonb not null default '{}'::jsonb,   -- manifest details: identifier, version, activity id, main library …
  mastery_score    numeric check (mastery_score between 0 and 100),
  class_group_ids  uuid[] not null default '{}',         -- classes that can open it on its own (paths add more)
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists content_packages_tenant on public.content_packages(tenant_id, created_at desc);

create table if not exists public.content_attempts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  package_id    uuid not null references public.content_packages(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  student_id    uuid references public.students(id) on delete cascade,
  status        text not null default 'not_attempted' check (status in ('not_attempted','incomplete','completed','passed','failed')),
  score         numeric check (score between 0 and 100),
  time_seconds  int not null default 0,
  data          jsonb not null default '{}'::jsonb,       -- SCORM data model values, or H5P state
  launches      int not null default 0,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  unique (package_id, user_id)
);

create table if not exists public.xapi_statements (
  id          uuid primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  package_id  uuid references public.content_packages(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  verb        text not null,
  object_id   text,
  result      jsonb,
  statement   jsonb not null,
  "timestamp" timestamptz,
  stored_at   timestamptz not null default now(),
  voided      boolean not null default false
);
create index if not exists xapi_statements_user on public.xapi_statements(tenant_id, user_id, stored_at desc);

create table if not exists public.xapi_state (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  activity_id   text not null,
  state_id      text not null,
  registration  text not null default '',
  content_type  text,
  doc           text,
  updated_at    timestamptz not null default now(),
  primary key (user_id, activity_id, state_id, registration)
);
insert into storage.buckets (id, name, public) values ('content', 'content', false) on conflict (id) do nothing;

-- ---------- learning paths ----------
create table if not exists public.learning_paths (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  title            text not null check (length(title) between 2 and 160),
  description      text,
  subject_id       uuid references public.subjects(id) on delete set null,
  class_group_ids  uuid[] not null default '{}',
  status           text not null default 'draft' check (status in ('draft','published','archived')),
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create table if not exists public.learning_path_steps (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  path_id       uuid not null references public.learning_paths(id) on delete cascade,
  position      int not null default 0,
  title         text not null check (length(title) between 1 and 160),
  kind          text not null check (kind in ('text','link','video','content','quiz','homework')),
  body          text,
  url           text check (url is null or url ~ '^https://'),
  package_id    uuid references public.content_packages(id) on delete set null,
  homework_id   uuid references public.homework(id) on delete set null,
  question_ids  uuid[] not null default '{}',
  pass_pct      int not null default 60 check (pass_pct between 0 and 100),
  requires      uuid[] not null default '{}',   -- steps that must be finished first
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists learning_path_steps_path on public.learning_path_steps(path_id, position);
create table if not exists public.learning_path_progress (
  step_id       uuid not null references public.learning_path_steps(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  path_id       uuid not null references public.learning_paths(id) on delete cascade,
  status        text not null check (status in ('done','passed','failed')),
  score         numeric,
  attempts      int not null default 1,
  answers       jsonb,
  completed_at  timestamptz not null default now(),
  primary key (step_id, student_id)
);

-- ---------- online lessons ----------
create table if not exists public.online_lessons (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete set null,
  title           text not null check (length(title) between 2 and 160),
  provider        text not null check (provider in ('zoom','meet','teams','other')),
  join_url        text not null check (join_url ~ '^https://'),
  passcode        text,
  starts_at       timestamptz not null,
  duration_min    int not null default 40 check (duration_min between 5 and 600),
  external_id     text,
  status          text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists online_lessons_class on public.online_lessons(tenant_id, class_group_id, starts_at);
-- The host link starts the meeting as the teacher: the server reads it, nobody else.
create table if not exists public.online_lesson_hosts (
  lesson_id  uuid primary key references public.online_lessons(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  start_url  text
);
create table if not exists public.online_lesson_joins (
  lesson_id   uuid not null references public.online_lessons(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid references public.students(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (lesson_id, user_id)
);
-- A school's own keys for outside services (Zoom). Server only.
create table if not exists public.integration_secrets (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  provider    text not null check (provider in ('zoom')),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, provider)
);

-- ---------- breakout rooms ----------
alter table public.rtc_rooms add column if not exists kind text not null default 'main';
alter table public.rtc_rooms add column if not exists name text;
alter table public.rtc_rooms add column if not exists parent_room_id uuid references public.rtc_rooms(id) on delete cascade;
alter table public.rtc_rooms add column if not exists notice text;
alter table public.rtc_rooms add column if not exists closes_at timestamptz;
do $$ begin
  alter table public.rtc_rooms drop constraint if exists rtc_rooms_kind_check;
  alter table public.rtc_rooms add constraint rtc_rooms_kind_check check (kind in ('main','breakout') and (kind = 'main') = (parent_room_id is null));
end $$;
create table if not exists public.breakout_members (
  room_id    uuid not null references public.rtc_rooms(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  primary key (room_id, user_id)
);

-- Who may be in a live session: its teacher, its class members, and school admins.
create or replace function public.can_join_session(p_session uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = p_session and c.tenant_id = public.my_tenant_id()
      and (c.teacher_id = auth.uid() or public.is_school_admin()
        or exists (select 1 from public.class_members m where m.class_id = c.id and m.user_id = auth.uid())));
$$;
create or replace function public.hosts_session(p_session uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = p_session and c.tenant_id = public.my_tenant_id()
      and (c.teacher_id = auth.uid() or public.is_school_admin()
        or exists (select 1 from public.class_members m where m.class_id = c.id and m.user_id = auth.uid() and m.role = 'teacher')));
$$;
-- Main rooms are open to the session; a breakout room only to its members and the hosts.
create or replace function public.can_enter_room(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rtc_rooms r
    where r.id = p_room and r.state = 'open' and public.can_join_session(r.session_id)
      and (r.kind = 'main' or public.hosts_session(r.session_id)
        or exists (select 1 from public.breakout_members b where b.room_id = r.id and b.user_id = auth.uid())));
$$;
grant execute on function public.can_join_session(uuid), public.hosts_session(uuid), public.can_enter_room(uuid) to authenticated;

drop policy if exists rtc_rooms_tenant on public.rtc_rooms;
drop policy if exists rtc_rooms_read on public.rtc_rooms;
create policy rtc_rooms_read on public.rtc_rooms for select using (tenant_id = public.my_tenant_id() and public.can_join_session(session_id));
drop policy if exists rtc_rooms_open on public.rtc_rooms;
create policy rtc_rooms_open on public.rtc_rooms for insert with check (tenant_id = public.my_tenant_id() and host_user_id = auth.uid() and public.hosts_session(session_id));
drop policy if exists rtc_rooms_manage on public.rtc_rooms;
create policy rtc_rooms_manage on public.rtc_rooms for update using (tenant_id = public.my_tenant_id() and public.hosts_session(session_id))
  with check (tenant_id = public.my_tenant_id() and public.hosts_session(session_id));
grant delete on public.rtc_rooms to authenticated;
drop policy if exists rtc_rooms_remove on public.rtc_rooms;
create policy rtc_rooms_remove on public.rtc_rooms for delete using (tenant_id = public.my_tenant_id() and kind = 'breakout' and public.hosts_session(session_id));

drop policy if exists rtc_peers_select on public.rtc_peers;
create policy rtc_peers_select on public.rtc_peers for select using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.rtc_rooms r where r.id = room_id and public.can_join_session(r.session_id)));
drop policy if exists rtc_peers_insert on public.rtc_peers;
create policy rtc_peers_insert on public.rtc_peers for insert with check (user_id = auth.uid() and tenant_id = public.my_tenant_id() and public.can_enter_room(room_id));
drop policy if exists rtc_peers_update on public.rtc_peers;
create policy rtc_peers_update on public.rtc_peers for update using (user_id = auth.uid() and tenant_id = public.my_tenant_id())
  with check (user_id = auth.uid() and tenant_id = public.my_tenant_id() and (state = 'left' or public.can_enter_room(room_id)));

alter table public.breakout_members enable row level security;
drop policy if exists breakout_members_read on public.breakout_members;
create policy breakout_members_read on public.breakout_members for select using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.rtc_rooms r where r.id = room_id and public.can_join_session(r.session_id)));
drop policy if exists breakout_members_host on public.breakout_members;
create policy breakout_members_host on public.breakout_members for all using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.rtc_rooms r where r.id = room_id and public.hosts_session(r.session_id)))
  with check (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.rtc_rooms r where r.id = room_id and public.hosts_session(r.session_id)));

-- ---------- AI tutor ----------
alter table public.tenant_settings add column if not exists ai_tutor_enabled boolean not null default false;
alter table public.tenant_settings add column if not exists ai_tutor_daily_limit int not null default 30;
do $$ begin
  alter table public.tenant_settings drop constraint if exists tenant_settings_tutor_limit_check;
  alter table public.tenant_settings add constraint tenant_settings_tutor_limit_check check (ai_tutor_daily_limit between 1 and 500);
end $$;
create table if not exists public.tutor_conversations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  title        text not null default 'New question',
  subject_id   uuid references public.subjects(id) on delete set null,
  context      jsonb not null default '{}'::jsonb,   -- { kind: homework|step, ref_id, title }
  concern      text check (concern in ('wellbeing','safety')),
  concern_at   timestamptz,
  reviewed_by  uuid references public.users(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tutor_conversations_student on public.tutor_conversations(tenant_id, student_id, updated_at desc);
create table if not exists public.tutor_messages (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  conversation_id  uuid not null references public.tutor_conversations(id) on delete cascade,
  role             text not null check (role in ('student','tutor')),
  content          text not null check (length(content) between 1 and 20000),
  created_at       timestamptz not null default now()
);
create index if not exists tutor_messages_conversation on public.tutor_messages(conversation_id, id);

-- Who reads a student's tutor chats: the student, their parents, their teachers, counsellors and admins.
create or replace function public.can_see_tutor(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_student_self(p_student) or public.is_guardian_of(p_student) or public.teaches_student(p_student)
    or public.is_school_admin() or public.has_role(array['counsellor']);
$$;
grant execute on function public.can_see_tutor(uuid) to authenticated;

-- ---------- RLS ----------
alter table public.content_packages enable row level security;
drop policy if exists content_packages_read on public.content_packages;
create policy content_packages_read on public.content_packages for select using (tenant_id = public.my_tenant_id() and (public.is_staff()
  or public.sees_class_content(class_group_ids)
  or exists (select 1 from public.learning_path_steps st join public.learning_paths p on p.id = st.path_id
             where st.package_id = content_packages.id and p.status = 'published' and public.sees_class_content(p.class_group_ids))));
drop policy if exists content_packages_insert on public.content_packages;
create policy content_packages_insert on public.content_packages for insert with check (tenant_id = public.my_tenant_id() and public.is_staff() and created_by = auth.uid());
drop policy if exists content_packages_change on public.content_packages;
create policy content_packages_change on public.content_packages for update using (tenant_id = public.my_tenant_id() and (created_by = auth.uid() or public.is_school_admin()))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists content_packages_delete on public.content_packages;
create policy content_packages_delete on public.content_packages for delete using (tenant_id = public.my_tenant_id() and (created_by = auth.uid() or public.is_school_admin()));

alter table public.content_attempts enable row level security;
drop policy if exists content_attempts_read on public.content_attempts;
create policy content_attempts_read on public.content_attempts for select using (tenant_id = public.my_tenant_id()
  and (user_id = auth.uid() or public.is_staff() or (student_id is not null and public.is_guardian_of(student_id))));

alter table public.xapi_statements enable row level security;
drop policy if exists xapi_statements_read on public.xapi_statements;
create policy xapi_statements_read on public.xapi_statements for select using (tenant_id = public.my_tenant_id() and (user_id = auth.uid() or public.is_staff()));
alter table public.xapi_state enable row level security;   -- server only

alter table public.learning_paths enable row level security;
drop policy if exists learning_paths_read on public.learning_paths;
create policy learning_paths_read on public.learning_paths for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or (status = 'published' and public.sees_class_content(class_group_ids))));
drop policy if exists learning_paths_insert on public.learning_paths;
create policy learning_paths_insert on public.learning_paths for insert with check (tenant_id = public.my_tenant_id() and public.is_staff() and created_by = auth.uid());
drop policy if exists learning_paths_change on public.learning_paths;
create policy learning_paths_change on public.learning_paths for update using (tenant_id = public.my_tenant_id() and public.is_staff() and (created_by = auth.uid() or public.is_school_admin()))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists learning_paths_delete on public.learning_paths;
create policy learning_paths_delete on public.learning_paths for delete using (tenant_id = public.my_tenant_id() and (created_by = auth.uid() or public.is_school_admin()));

alter table public.learning_path_steps enable row level security;
drop policy if exists learning_path_steps_read on public.learning_path_steps;
create policy learning_path_steps_read on public.learning_path_steps for select using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.learning_paths p where p.id = path_id and (public.is_staff() or (p.status = 'published' and public.sees_class_content(p.class_group_ids)))));
drop policy if exists learning_path_steps_write on public.learning_path_steps;
create policy learning_path_steps_write on public.learning_path_steps for all using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.learning_paths p where p.id = path_id and public.is_staff() and (p.created_by = auth.uid() or public.is_school_admin())))
  with check (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.learning_paths p where p.id = path_id and public.is_staff() and (p.created_by = auth.uid() or public.is_school_admin())));

alter table public.learning_path_progress enable row level security;
drop policy if exists learning_path_progress_read on public.learning_path_progress;
create policy learning_path_progress_read on public.learning_path_progress for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or public.is_student_self(student_id) or public.is_guardian_of(student_id)));

alter table public.online_lessons enable row level security;
drop policy if exists online_lessons_read on public.online_lessons;
create policy online_lessons_read on public.online_lessons for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or public.sees_class_content(array[class_group_id])));
drop policy if exists online_lessons_insert on public.online_lessons;
create policy online_lessons_insert on public.online_lessons for insert with check (tenant_id = public.my_tenant_id() and public.is_staff() and created_by = auth.uid());
drop policy if exists online_lessons_change on public.online_lessons;
create policy online_lessons_change on public.online_lessons for update using (tenant_id = public.my_tenant_id() and (created_by = auth.uid() or public.is_school_admin()))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists online_lessons_delete on public.online_lessons;
create policy online_lessons_delete on public.online_lessons for delete using (tenant_id = public.my_tenant_id() and (created_by = auth.uid() or public.is_school_admin()));
alter table public.online_lesson_hosts enable row level security;   -- server only
revoke all on public.online_lesson_hosts from anon, authenticated;
alter table public.online_lesson_joins enable row level security;
drop policy if exists online_lesson_joins_read on public.online_lesson_joins;
create policy online_lesson_joins_read on public.online_lesson_joins for select using (tenant_id = public.my_tenant_id() and (public.is_staff() or user_id = auth.uid()));
alter table public.integration_secrets enable row level security;   -- server only
revoke all on public.integration_secrets from anon, authenticated;

alter table public.tutor_conversations enable row level security;
drop policy if exists tutor_conversations_read on public.tutor_conversations;
create policy tutor_conversations_read on public.tutor_conversations for select using (tenant_id = public.my_tenant_id() and public.can_see_tutor(student_id));
drop policy if exists tutor_conversations_review on public.tutor_conversations;
create policy tutor_conversations_review on public.tutor_conversations for update using (tenant_id = public.my_tenant_id() and public.is_staff() and public.can_see_tutor(student_id))
  with check (tenant_id = public.my_tenant_id());
alter table public.tutor_messages enable row level security;
drop policy if exists tutor_messages_read on public.tutor_messages;
create policy tutor_messages_read on public.tutor_messages for select using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.tutor_conversations c where c.id = conversation_id and public.can_see_tutor(c.student_id)));
-- Staff may only mark a conversation as reviewed.
create or replace function public.tutor_review_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.student_id <> old.student_id or new.user_id <> old.user_id or new.title <> old.title or new.context <> old.context
     or new.concern is distinct from old.concern then
    raise exception 'tutor conversations can only be marked as reviewed';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists tutor_review_guard on public.tutor_conversations;
create trigger tutor_review_guard before update on public.tutor_conversations for each row execute function public.tutor_review_guard();

grant all on public.content_packages, public.content_attempts, public.xapi_statements, public.xapi_state, public.learning_paths, public.learning_path_steps,
  public.learning_path_progress, public.online_lessons, public.online_lesson_hosts, public.online_lesson_joins, public.integration_secrets,
  public.breakout_members, public.tutor_conversations, public.tutor_messages to service_role;

-- ---------- change history on every school table ----------
-- One place for the list of tables that are not logged (high-volume logs and machine state).
-- Run again after adding tables: select public.attach_change_log();
create or replace function public.attach_change_log()
returns int language plpgsql security definer set search_path = public as $$
declare t text; n int := 0;
  skip text[] := array['data_changes','audit_logs','platform_audit_logs','message_outbox','exam_events','exam_attempts','practice_sessions',
        'browser_events','environment_events','screen_snapshots','student_presence','session_participants','raise_hands','rtc_rooms','rtc_peers','rtc_signals',
        'transport_live','push_subscriptions','doc_counters','lead_sequence_runs','access_grants','phone_login_codes','quiz_attempts','quiz_answers',
        'activity_responses','game_sessions','game_players','leaderboard_entries','conversation_messages','pickup_attempts','device_enrollments','devices',
        'teacher_commands','survey_invites','tenants',
        'learning_activity','content_attempts','xapi_statements','xapi_state','breakout_members','online_lesson_joins','tutor_messages','integration_secrets','online_lesson_hosts','admission_secrets'];
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
