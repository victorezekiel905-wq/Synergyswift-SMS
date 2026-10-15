-- =========================================================================
-- EduClass Fusion: timetabling and calendar (phase 7b).
--  * rooms: classrooms, labs, ICT suites, halls; class home rooms.
--  * timetable: rooms on lessons, subjects that need a kind of room,
--    double periods, and times a teacher cannot teach.
--  * room_bookings: booking labs, halls and other rooms, with no double
--    booking and approval where a room needs it.
--  * calendar_feeds: private links for Google Calendar / Outlook.
--  * school_events: a "pta" kind.
-- Apply AFTER 20260101003600. Idempotent.
-- =========================================================================

create table if not exists public.rooms (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null check (length(name) between 1 and 40),
  kind            text not null default 'classroom' check (kind in ('classroom','lab','ict','hall','library','sports','music','art','other')),
  capacity        int check (capacity between 1 and 5000),
  bookable        boolean not null default true,
  needs_approval  boolean not null default false,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.class_groups add column if not exists home_room_id uuid references public.rooms(id) on delete set null;
alter table public.timetable_entries add column if not exists room_id uuid references public.rooms(id) on delete set null;
alter table public.subject_offerings add column if not exists room_kind text;
alter table public.subject_offerings add column if not exists doubles int not null default 0;
do $$ begin
  alter table public.subject_offerings drop constraint if exists subject_offerings_room_rules_check;
  alter table public.subject_offerings add constraint subject_offerings_room_rules_check check (doubles between 0 and 5 and doubles * 2 <= greatest(periods_per_week, 0) + 1
    and (room_kind is null or room_kind in ('classroom','lab','ict','hall','library','sports','music','art','other')));
end $$;
create unique index if not exists timetable_room_id_clash on public.timetable_entries(tenant_id, room_id, day, period_id) where room_id is not null;

create table if not exists public.teacher_unavailability (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  day        int not null check (day between 1 and 7),
  period_id  uuid not null references public.timetable_periods(id) on delete cascade,
  reason     text,
  unique (user_id, day, period_id)
);

-- ---------- room bookings ----------
create table if not exists public.room_bookings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  room_id         uuid not null references public.rooms(id) on delete cascade,
  title           text not null check (length(title) between 2 and 160),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  booked_by       uuid not null references public.users(id) on delete cascade,
  class_group_id  uuid references public.class_groups(id) on delete set null,
  status          text not null default 'confirmed' check (status in ('pending','confirmed','declined','cancelled')),
  decided_by      uuid references public.users(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '14 days')
);
create index if not exists room_bookings_room_time on public.room_bookings(room_id, starts_at);

-- No two live bookings overlap; rooms that need approval start as pending; only admins approve.
create or replace function public.room_booking_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.rooms; admin boolean := auth.uid() is null or public.is_school_admin();
begin
  select * into r from public.rooms where id = new.room_id for update;   -- one booking at a time per room
  if r.id is null or r.tenant_id <> new.tenant_id then raise exception 'room not found'; end if;
  if tg_op = 'INSERT' then
    if not r.bookable or not r.active then raise exception 'this room cannot be booked'; end if;
    if not admin then new.status := case when r.needs_approval then 'pending' else 'confirmed' end; new.decided_by := null; end if;
  else
    if new.room_id <> old.room_id or new.booked_by <> old.booked_by then raise exception 'move a booking by cancelling it and booking again'; end if;
    if not admin and new.status is distinct from old.status and new.status <> 'cancelled' then raise exception 'only admins can approve or decline bookings'; end if;
    if admin and new.status is distinct from old.status and new.status in ('confirmed','declined') then new.decided_by := auth.uid(); end if;
  end if;
  if new.status in ('pending','confirmed') and exists (
    select 1 from public.room_bookings b where b.room_id = new.room_id and b.id <> new.id and b.status in ('pending','confirmed')
      and b.starts_at < new.ends_at and new.starts_at < b.ends_at) then
    raise exception 'this room is already booked at that time';
  end if;
  return new;
end $$;
drop trigger if exists room_booking_guard on public.room_bookings;
create trigger room_booking_guard before insert or update on public.room_bookings for each row execute function public.room_booking_guard();

-- ---------- calendar subscriptions ----------
create table if not exists public.calendar_feeds (
  user_id     uuid primary key references public.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

do $$ begin
  alter table public.school_events drop constraint if exists school_events_kind_check;
  alter table public.school_events add constraint school_events_kind_check check (kind in ('event','trip','club','holiday','exam','meeting','pta'));
end $$;

-- ---------- RLS ----------
alter table public.rooms enable row level security;
drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists rooms_admin on public.rooms;
create policy rooms_admin on public.rooms for all using (tenant_id = public.my_tenant_id() and public.is_school_admin()) with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

alter table public.teacher_unavailability enable row level security;
drop policy if exists unavailability_read on public.teacher_unavailability;
create policy unavailability_read on public.teacher_unavailability for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists unavailability_write on public.teacher_unavailability;
create policy unavailability_write on public.teacher_unavailability for all using (tenant_id = public.my_tenant_id() and (public.is_school_admin() or user_id = auth.uid()))
  with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or user_id = auth.uid()));

alter table public.room_bookings enable row level security;
drop policy if exists room_bookings_read on public.room_bookings;
create policy room_bookings_read on public.room_bookings for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists room_bookings_insert on public.room_bookings;
create policy room_bookings_insert on public.room_bookings for insert with check (tenant_id = public.my_tenant_id() and public.is_staff() and booked_by = auth.uid());
drop policy if exists room_bookings_update on public.room_bookings;
create policy room_bookings_update on public.room_bookings for update using (tenant_id = public.my_tenant_id() and (booked_by = auth.uid() or public.is_school_admin()))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists room_bookings_delete on public.room_bookings;
create policy room_bookings_delete on public.room_bookings for delete using (tenant_id = public.my_tenant_id() and public.is_school_admin());

alter table public.calendar_feeds enable row level security;   -- server only
revoke all on public.calendar_feeds from anon, authenticated;

grant all on public.rooms, public.teacher_unavailability, public.room_bookings, public.calendar_feeds to service_role;

-- Calendar links stay out of the change history.
create or replace function public.attach_change_log()
returns int language plpgsql security definer set search_path = public as $$
declare t text; n int := 0;
  skip text[] := array['data_changes','audit_logs','platform_audit_logs','message_outbox','exam_events','exam_attempts','practice_sessions',
        'browser_events','environment_events','screen_snapshots','student_presence','session_participants','raise_hands','rtc_rooms','rtc_peers','rtc_signals',
        'transport_live','push_subscriptions','doc_counters','lead_sequence_runs','access_grants','phone_login_codes','quiz_attempts','quiz_answers',
        'activity_responses','game_sessions','game_players','leaderboard_entries','conversation_messages','pickup_attempts','device_enrollments','devices',
        'teacher_commands','survey_invites','tenants',
        'learning_activity','content_attempts','xapi_statements','xapi_state','breakout_members','online_lesson_joins','tutor_messages','integration_secrets','online_lesson_hosts','admission_secrets',
        'calendar_feeds'];
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
