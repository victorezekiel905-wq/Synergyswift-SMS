-- =========================================================================
-- EduClass Fusion: communication (phase 8).
--  * notices, notice_recipients: announcements, circulars and emergency
--    alerts to the school, sections, classes, families, students or staff,
--    with read receipts and acknowledgements.
--  * message_templates: reusable wording with placeholders.
--  * student_threads, student_thread_messages: teacher-student messaging
--    under safeguarding rules, visible to safeguarding staff and parents.
--  * conversation_messages: safeguarding flags on parent messages too.
--  * pt_conferences: parent-teacher evenings that create every teacher's slots.
-- Apply AFTER 20260101003700. Idempotent.
-- =========================================================================

-- ---------- announcements, circulars, emergencies ----------
create table if not exists public.notices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  kind            text not null default 'announcement' check (kind in ('announcement','circular','emergency')),
  title           text not null check (length(title) between 2 and 160),
  body            text not null check (length(body) between 2 and 20000),
  audience        jsonb not null default '{"scope":"school"}'::jsonb,   -- { scope: school|sections|classes|people, ids: [...] }
  to_parents      boolean not null default true,
  to_students     boolean not null default false,
  to_staff        boolean not null default false,
  staff_roles     text[] not null default '{}',                          -- empty = all staff
  requires_ack    boolean not null default false,
  channels        text[] not null default '{push,email,whatsapp}',
  translate       boolean not null default true,
  status          text not null default 'draft' check (status in ('draft','scheduled','sending','sent','cancelled')),
  scheduled_for   timestamptz,
  sent_at         timestamptz,
  expires_at      timestamptz,
  pinned          boolean not null default false,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status <> 'scheduled' or scheduled_for is not null)
);
create index if not exists notices_tenant on public.notices(tenant_id, sent_at desc);

create table if not exists public.notice_recipients (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  notice_id        uuid not null references public.notices(id) on delete cascade,
  recipient_kind   text not null check (recipient_kind in ('guardian','student','staff')),
  guardian_id      uuid references public.guardians(id) on delete cascade,
  user_id          uuid references public.users(id) on delete cascade,
  student_ids      uuid[] not null default '{}',     -- the children it is about (families)
  read_token       text not null unique default encode(gen_random_bytes(18), 'hex'),
  delivered_at     timestamptz,
  read_at          timestamptz,
  acknowledged_at  timestamptz,
  reminded_at      timestamptz,
  created_at       timestamptz not null default now(),
  check ((recipient_kind = 'guardian' and guardian_id is not null) or (recipient_kind <> 'guardian' and user_id is not null))
);
create unique index if not exists notice_recipients_guardian on public.notice_recipients(notice_id, guardian_id) where guardian_id is not null;
create unique index if not exists notice_recipients_user on public.notice_recipients(notice_id, user_id) where guardian_id is null;
create index if not exists notice_recipients_user_idx on public.notice_recipients(user_id, created_at desc);
create index if not exists notice_recipients_guardian_idx on public.notice_recipients(guardian_id, created_at desc);

create or replace function public.can_send_notices()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or public.has_role(array['it_admin']);
$$;
grant execute on function public.can_send_notices() to authenticated;

-- Readers may only mark their own copy as read or acknowledged.
create or replace function public.notice_receipt_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.can_send_notices() then return new; end if;
  if new.notice_id <> old.notice_id or new.guardian_id is distinct from old.guardian_id or new.user_id is distinct from old.user_id
     or new.read_token <> old.read_token or new.delivered_at is distinct from old.delivered_at or new.reminded_at is distinct from old.reminded_at then
    raise exception 'only the read and acknowledged times can be changed';
  end if;
  if old.read_at is not null then new.read_at := old.read_at; end if;
  if old.acknowledged_at is not null then new.acknowledged_at := old.acknowledged_at; end if;
  return new;
end $$;
drop trigger if exists notice_receipt_guard on public.notice_recipients;
create trigger notice_receipt_guard before update on public.notice_recipients for each row execute function public.notice_receipt_guard();

create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(name) between 2 and 80),
  kind        text not null default 'announcement' check (kind in ('announcement','circular','emergency','message')),
  title       text,
  body        text not null check (length(body) between 2 and 10000),
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ---------- teacher-student messaging ----------
alter table public.tenant_settings add column if not exists student_messaging boolean not null default false;
alter table public.tenant_settings add column if not exists student_messaging_from time not null default '07:00';
alter table public.tenant_settings add column if not exists student_messaging_to time not null default '18:00';
alter table public.tenant_settings add column if not exists student_messaging_parents_see boolean not null default true;

create table if not exists public.student_threads (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  student_id       uuid not null references public.students(id) on delete cascade,
  staff_user_id    uuid not null references public.users(id) on delete cascade,
  subject          text not null check (length(subject) between 1 and 160),
  status           text not null default 'open' check (status in ('open','closed')),
  student_unread   int not null default 0,
  staff_unread     int not null default 0,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists student_threads_student on public.student_threads(student_id, last_message_at desc);
create index if not exists student_threads_staff on public.student_threads(staff_user_id, last_message_at desc);

create table if not exists public.student_thread_messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  thread_id       uuid not null references public.student_threads(id) on delete cascade,
  sender_kind     text not null check (sender_kind in ('staff','student')),
  sender_user_id  uuid references public.users(id) on delete set null,
  body            text not null check (length(body) between 1 and 4000),
  flagged         boolean not null default false,
  flag_reason     text,
  reviewed_by     uuid references public.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists student_thread_messages_thread on public.student_thread_messages(thread_id, created_at);
create index if not exists student_thread_messages_flagged on public.student_thread_messages(tenant_id, flagged, created_at desc) where flagged;

alter table public.conversation_messages add column if not exists flagged boolean not null default false;
alter table public.conversation_messages add column if not exists flag_reason text;
alter table public.conversation_messages add column if not exists reviewed_by uuid references public.users(id) on delete set null;
alter table public.conversation_messages add column if not exists reviewed_at timestamptz;

-- Safeguarding leads: admins, the principal and counsellors.
create or replace function public.is_safeguarding_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or public.has_role(array['counsellor']);
$$;
grant execute on function public.is_safeguarding_lead() to authenticated;

-- Who may read a thread: the student, the teacher in it, safeguarding leads, and (if the school allows) the parents.
create or replace function public.can_read_student_thread(p_thread uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.student_threads t
    where t.id = p_thread and t.tenant_id = public.my_tenant_id()
      and (t.staff_user_id = auth.uid() or public.is_student_self(t.student_id) or public.is_safeguarding_lead()
        or (public.is_guardian_of(t.student_id) and coalesce((select s.student_messaging_parents_see from public.tenant_settings s where s.tenant_id = t.tenant_id), true))));
$$;
grant execute on function public.can_read_student_thread(uuid) to authenticated;

-- Messages are never edited or deleted, except a safeguarding lead marking a flag as reviewed.
create or replace function public.thread_message_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The server (and deleting a whole school) may remove rows; NEW is empty for a delete, so return OLD.
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then raise exception 'messages cannot be deleted'; end if;
  if not public.is_safeguarding_lead() then raise exception 'messages cannot be changed'; end if;
  if new.body <> old.body or new.sender_user_id is distinct from old.sender_user_id or new.thread_id <> old.thread_id or new.created_at <> old.created_at then
    raise exception 'messages cannot be changed';
  end if;
  new.reviewed_by := auth.uid(); new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists thread_message_guard on public.student_thread_messages;
create trigger thread_message_guard before update or delete on public.student_thread_messages for each row execute function public.thread_message_guard();

-- ---------- parent-teacher evenings ----------
create table if not exists public.pt_conferences (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  title             text not null check (length(title) between 2 and 160),
  date              date not null,
  starts_at         time not null,
  ends_at           time not null,
  slot_minutes      int not null default 10 check (slot_minutes between 5 and 60),
  gap_minutes       int not null default 0 check (gap_minutes between 0 and 30),
  location          text,
  class_group_ids   uuid[] not null default '{}',
  staff_user_ids    uuid[] not null default '{}',
  booking_closes_at timestamptz,
  status            text not null default 'open' check (status in ('open','closed','cancelled')),
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.consultation_slots add column if not exists conference_id uuid references public.pt_conferences(id) on delete cascade;
create index if not exists consultation_slots_conference on public.consultation_slots(conference_id, staff_user_id, starts_at);

-- ---------- RLS ----------
alter table public.notices enable row level security;
drop policy if exists notices_read on public.notices;
create policy notices_read on public.notices for select using (tenant_id = public.my_tenant_id() and (public.can_send_notices()
  or (status = 'sent' and exists (select 1 from public.notice_recipients r where r.notice_id = notices.id
      and (r.user_id = auth.uid() or (r.guardian_id is not null and exists (select 1 from public.guardians g where g.id = r.guardian_id and g.user_id = auth.uid())))))));
drop policy if exists notices_write on public.notices;
create policy notices_write on public.notices for all using (tenant_id = public.my_tenant_id() and public.can_send_notices())
  with check (tenant_id = public.my_tenant_id() and public.can_send_notices());

alter table public.notice_recipients enable row level security;
drop policy if exists notice_recipients_read on public.notice_recipients;
create policy notice_recipients_read on public.notice_recipients for select using (tenant_id = public.my_tenant_id() and (public.can_send_notices() or user_id = auth.uid()
  or (guardian_id is not null and exists (select 1 from public.guardians g where g.id = guardian_id and g.user_id = auth.uid()))));
drop policy if exists notice_recipients_mark on public.notice_recipients;
create policy notice_recipients_mark on public.notice_recipients for update using (tenant_id = public.my_tenant_id() and (public.can_send_notices() or user_id = auth.uid()
  or (guardian_id is not null and exists (select 1 from public.guardians g where g.id = guardian_id and g.user_id = auth.uid()))))
  with check (tenant_id = public.my_tenant_id());

alter table public.message_templates enable row level security;
drop policy if exists message_templates_read on public.message_templates;
create policy message_templates_read on public.message_templates for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists message_templates_write on public.message_templates;
create policy message_templates_write on public.message_templates for all using (tenant_id = public.my_tenant_id() and public.can_send_notices())
  with check (tenant_id = public.my_tenant_id() and public.can_send_notices());

alter table public.student_threads enable row level security;
drop policy if exists student_threads_read on public.student_threads;
create policy student_threads_read on public.student_threads for select using (tenant_id = public.my_tenant_id() and public.can_read_student_thread(id));
-- Threads and messages are written by the server, which applies the safeguarding rules.

alter table public.student_thread_messages enable row level security;
drop policy if exists student_thread_messages_read on public.student_thread_messages;
create policy student_thread_messages_read on public.student_thread_messages for select using (tenant_id = public.my_tenant_id() and public.can_read_student_thread(thread_id));
drop policy if exists student_thread_messages_review on public.student_thread_messages;
create policy student_thread_messages_review on public.student_thread_messages for update using (tenant_id = public.my_tenant_id() and public.is_safeguarding_lead())
  with check (tenant_id = public.my_tenant_id());

alter table public.pt_conferences enable row level security;
drop policy if exists pt_conferences_read on public.pt_conferences;
create policy pt_conferences_read on public.pt_conferences for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or (status <> 'cancelled' and public.sees_class_content(class_group_ids))));
drop policy if exists pt_conferences_admin on public.pt_conferences;
create policy pt_conferences_admin on public.pt_conferences for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

grant all on public.notices, public.notice_recipients, public.message_templates, public.student_threads, public.student_thread_messages, public.pt_conferences to service_role;

-- Read tokens are hidden in the change history; receipts are high-volume, so they are not logged.
create or replace function public.attach_change_log()
returns int language plpgsql security definer set search_path = public as $$
declare t text; n int := 0;
  skip text[] := array['data_changes','audit_logs','platform_audit_logs','message_outbox','exam_events','exam_attempts','practice_sessions',
        'browser_events','environment_events','screen_snapshots','student_presence','session_participants','raise_hands','rtc_rooms','rtc_peers','rtc_signals',
        'transport_live','push_subscriptions','doc_counters','lead_sequence_runs','access_grants','phone_login_codes','quiz_attempts','quiz_answers',
        'activity_responses','game_sessions','game_players','leaderboard_entries','conversation_messages','pickup_attempts','device_enrollments','devices',
        'teacher_commands','survey_invites','tenants',
        'learning_activity','content_attempts','xapi_statements','xapi_state','breakout_members','online_lesson_joins','tutor_messages','integration_secrets','online_lesson_hosts','admission_secrets',
        'calendar_feeds','notice_recipients','student_thread_messages'];
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
