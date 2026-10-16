-- =====================================================================
--  Phase 11e: co-curricular life.
--
--  * Clubs, societies and teams: who leads them, who may join (open, by
--    approval, or closed), members with roles, sessions and attendance, and a
--    fee for the group linked to fees.
--  * Competitions and events entered, with results that become achievements.
--  * Trips: departure and return, staff going, meeting point, risk
--    assessment, and a roster ticked on the day (gone, back), with an alert if
--    anyone is not back on time.
-- =====================================================================

create table if not exists public.cc_groups (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  name              text not null check (length(trim(name)) between 1 and 120),
  kind              text not null default 'club' check (kind in ('club','society','sport','team','choir','band','drama','other')),
  description       text,
  meets             text,                                  -- e.g. Wednesdays 3–4pm
  location          text,
  capacity          int check (capacity between 1 and 2000),
  lead_id           uuid references public.users(id) on delete set null,
  assistant_ids     uuid[] not null default '{}',
  open_to_class_ids uuid[] not null default '{}',          -- empty = every class
  joining           text not null default 'approval' check (joining in ('open','approval','closed')),
  fee_item_id       uuid references public.fee_items(id) on delete set null,
  house_id          uuid references public.houses(id) on delete set null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (tenant_id, name)
);
create table if not exists public.cc_members (
  group_id      uuid not null references public.cc_groups(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  role          text not null default 'member' check (role in ('member','captain','vice_captain','secretary','treasurer','other')),
  status        text not null default 'active' check (status in ('requested','active','left','declined')),
  requested_at  timestamptz not null default now(),
  joined_on     date,
  left_on       date,
  primary key (group_id, student_id)
);
create index if not exists cc_members_student on public.cc_members(student_id);
create table if not exists public.cc_sessions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  group_id    uuid not null references public.cc_groups(id) on delete cascade,
  held_on     date not null,
  kind        text not null default 'meeting' check (kind in ('meeting','training','rehearsal','match','performance','other')),
  notes       text,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (group_id, held_on, kind)
);
create table if not exists public.cc_attendance (
  session_id  uuid not null references public.cc_sessions(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  status      text not null check (status in ('present','absent','late','excused')),
  primary key (session_id, student_id)
);

create table if not exists public.competitions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  title       text not null check (length(trim(title)) between 2 and 160),
  kind        text not null default 'sports' check (kind in ('sports','academic','arts','debate','quiz','other')),
  level       text not null default 'school' check (level in ('house','school','local','state','national','international')),
  held_on     date not null,
  venue       text,
  organiser   text,
  group_id    uuid references public.cc_groups(id) on delete set null,
  notes       text,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create table if not exists public.competition_entries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  competition_id  uuid not null references public.competitions(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  event           text,                       -- e.g. 100 m, under-14 chess
  team_name       text,
  position        int check (position between 1 and 1000),
  score           text,
  award           text,
  notes           text,
  achievement_id  uuid references public.student_achievements(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists competition_entries_comp on public.competition_entries(competition_id);
create unique index if not exists competition_entries_once on public.competition_entries(competition_id, student_id, coalesce(event, ''));

alter table public.school_events add column if not exists departs_at timestamptz;
alter table public.school_events add column if not exists returns_at timestamptz;
alter table public.school_events add column if not exists meeting_point text;
alter table public.school_events add column if not exists staff_ids uuid[] not null default '{}';
alter table public.school_events add column if not exists risk_assessment text;
alter table public.school_events add column if not exists emergency_contact text;
alter table public.school_events add column if not exists late_alerted_at timestamptz;
create table if not exists public.trip_roster (
  event_id     uuid not null references public.school_events(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  status       text not null default 'going' check (status in ('going','departed','returned','absent','cancelled')),
  departed_at  timestamptz,
  returned_at  timestamptz,
  note         text,
  primary key (event_id, student_id)
);

-- ---------- Helpers ----------
create or replace function public.leads_group(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or exists (select 1 from public.cc_groups g where g.id = p_group and g.tenant_id = public.my_tenant_id()
    and (g.lead_id = auth.uid() or auth.uid() = any(g.assistant_ids)));
$$;
create or replace function public.on_trip_staff(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or exists (select 1 from public.school_events e where e.id = p_event and e.tenant_id = public.my_tenant_id() and auth.uid() = any(e.staff_ids));
$$;
grant execute on function public.leads_group(uuid), public.on_trip_staff(uuid) to authenticated;

-- Roster times are stamped as the status moves.
create or replace function public.trip_roster_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'departed' and (tg_op = 'INSERT' or old.status is distinct from 'departed') then new.departed_at := coalesce(new.departed_at, now()); end if;
  if new.status = 'returned' and (tg_op = 'INSERT' or old.status is distinct from 'returned') then new.returned_at := coalesce(new.returned_at, now()); end if;
  return new;
end $$;
drop trigger if exists trip_roster_stamp on public.trip_roster;
create trigger trip_roster_stamp before insert or update on public.trip_roster for each row execute function public.trip_roster_stamp();

-- Leads run their group day to day; who leads it and what it costs stay with admins.
create or replace function public.cc_groups_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_school_admin() then return new; end if;
  if new.lead_id is distinct from old.lead_id or new.assistant_ids is distinct from old.assistant_ids or new.fee_item_id is distinct from old.fee_item_id then
    raise exception 'only admins change who leads a group or its fee';
  end if;
  return new;
end $$;
drop trigger if exists cc_groups_guard on public.cc_groups;
create trigger cc_groups_guard before update on public.cc_groups for each row execute function public.cc_groups_guard();

-- ---------- RLS ----------
alter table public.cc_groups enable row level security;
drop policy if exists cc_groups_read on public.cc_groups;
create policy cc_groups_read on public.cc_groups for select using (tenant_id = public.my_tenant_id());
drop policy if exists cc_groups_write on public.cc_groups;
create policy cc_groups_write on public.cc_groups for insert with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
drop policy if exists cc_groups_update on public.cc_groups;
create policy cc_groups_update on public.cc_groups for update using (tenant_id = public.my_tenant_id() and public.leads_group(id)) with check (tenant_id = public.my_tenant_id());
drop policy if exists cc_groups_delete on public.cc_groups;
create policy cc_groups_delete on public.cc_groups for delete using (tenant_id = public.my_tenant_id() and public.is_school_admin());

alter table public.cc_members enable row level security;
drop policy if exists cc_members_read on public.cc_members;
create policy cc_members_read on public.cc_members for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or public.is_student_self(student_id) or public.is_guardian_of(student_id)));
drop policy if exists cc_members_write on public.cc_members;
create policy cc_members_write on public.cc_members for all using (tenant_id = public.my_tenant_id() and public.leads_group(group_id))
  with check (tenant_id = public.my_tenant_id() and public.leads_group(group_id));
-- students ask to join through the server, which checks the group is open to them

alter table public.cc_sessions enable row level security;
drop policy if exists cc_sessions_read on public.cc_sessions;
create policy cc_sessions_read on public.cc_sessions for select using (tenant_id = public.my_tenant_id());
drop policy if exists cc_sessions_write on public.cc_sessions;
create policy cc_sessions_write on public.cc_sessions for all using (tenant_id = public.my_tenant_id() and public.leads_group(group_id))
  with check (tenant_id = public.my_tenant_id() and public.leads_group(group_id));

alter table public.cc_attendance enable row level security;
drop policy if exists cc_attendance_read on public.cc_attendance;
create policy cc_attendance_read on public.cc_attendance for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or public.is_student_self(student_id) or public.is_guardian_of(student_id)));
drop policy if exists cc_attendance_write on public.cc_attendance;
create policy cc_attendance_write on public.cc_attendance for all using (tenant_id = public.my_tenant_id()
  and public.leads_group((select s.group_id from public.cc_sessions s where s.id = session_id)))
  with check (tenant_id = public.my_tenant_id() and public.leads_group((select s.group_id from public.cc_sessions s where s.id = session_id)));

-- Competitions are public in the school; results for a child are seen by staff, the child and their family.
alter table public.competitions enable row level security;
drop policy if exists competitions_read on public.competitions;
create policy competitions_read on public.competitions for select using (tenant_id = public.my_tenant_id());
drop policy if exists competitions_write on public.competitions;
create policy competitions_write on public.competitions for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());
alter table public.competition_entries enable row level security;
drop policy if exists competition_entries_read on public.competition_entries;
create policy competition_entries_read on public.competition_entries for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or public.is_student_self(student_id) or public.is_guardian_of(student_id)));
drop policy if exists competition_entries_write on public.competition_entries;
create policy competition_entries_write on public.competition_entries for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());

alter table public.trip_roster enable row level security;
drop policy if exists trip_roster_read on public.trip_roster;
create policy trip_roster_read on public.trip_roster for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or public.is_guardian_of(student_id) or public.is_student_self(student_id)));
drop policy if exists trip_roster_write on public.trip_roster;
create policy trip_roster_write on public.trip_roster for all using (tenant_id = public.my_tenant_id() and public.on_trip_staff(event_id))
  with check (tenant_id = public.my_tenant_id() and public.on_trip_staff(event_id));

grant all on public.cc_groups, public.cc_members, public.cc_sessions, public.cc_attendance, public.competitions, public.competition_entries, public.trip_roster to service_role;
select public.attach_change_log();
