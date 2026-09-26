-- =========================================================================
-- EduClass Fusion — logistics and growth (v46)
-- Timetable, transport, boarding (hostel + exeat), visitors, admissions,
-- and multi-branch school groups.
-- Apply AFTER 20260101001700_student_life.sql. Idempotent.
-- =========================================================================

-- ---------- Timetable ----------
create table if not exists public.timetable_periods (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  starts_at  time not null,
  ends_at    time not null,
  position   int not null default 1,
  is_break   boolean not null default false,
  check (ends_at > starts_at)
);
alter table public.subject_offerings add column if not exists periods_per_week int not null default 0 check (periods_per_week between 0 and 20);

create table if not exists public.timetable_entries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  day             int not null check (day between 1 and 7),       -- 1 = Monday
  period_id       uuid not null references public.timetable_periods(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete cascade,
  teacher_id      uuid references public.users(id) on delete set null,
  room            text,
  locked          boolean not null default false,                  -- generator keeps locked cells
  unique (class_group_id, day, period_id)
);
-- A teacher or a room cannot be in two places at once.
create unique index if not exists timetable_teacher_clash on public.timetable_entries(tenant_id, teacher_id, day, period_id) where teacher_id is not null;
create unique index if not exists timetable_room_clash on public.timetable_entries(tenant_id, lower(room), day, period_id) where room is not null and room <> '';

-- ---------- Transport ----------
create table if not exists public.transport_routes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  vehicle       text,
  driver_name   text,
  driver_phone  text,
  attendant_id  uuid references public.users(id) on delete set null,
  capacity      int,
  stops         jsonb not null default '[]'::jsonb,   -- [{ name, am, pm }]
  fee_item_id   uuid references public.fee_items(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, name)
);
create table if not exists public.transport_assignments (
  student_id  uuid primary key references public.students(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  route_id    uuid not null references public.transport_routes(id) on delete cascade,
  stop_name   text,
  direction   text not null default 'both' check (direction in ('both','morning','afternoon'))
);
create table if not exists public.transport_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  route_id     uuid not null references public.transport_routes(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  kind         text not null check (kind in ('boarded','alighted')),
  stop_name    text,
  recorded_by  uuid references public.users(id),
  lat          double precision,
  lng          double precision,
  at           timestamptz not null default now()
);
create index if not exists transport_events_route on public.transport_events(route_id, at desc);

-- ---------- Boarding ----------
create table if not exists public.hostels (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  gender     text check (gender in ('male','female','mixed')),
  warden_id  uuid references public.users(id) on delete set null,
  unique (tenant_id, name)
);
create table if not exists public.hostel_rooms (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  hostel_id  uuid not null references public.hostels(id) on delete cascade,
  name       text not null,
  capacity   int not null check (capacity > 0),
  unique (hostel_id, name)
);
create table if not exists public.hostel_allocations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  room_id       uuid not null references public.hostel_rooms(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  bed_label     text,
  allocated_at  timestamptz not null default now(),
  ended_at      timestamptz
);
create unique index if not exists hostel_one_active_bed on public.hostel_allocations(student_id) where ended_at is null;

-- Exeat (permission to leave the boarding house)
create table if not exists public.exeat_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  guardian_id     uuid references public.guardians(id) on delete set null,
  requested_by    text not null default 'guardian' check (requested_by in ('guardian','staff')),
  reason          text not null,
  leave_at        timestamptz not null,
  return_by       timestamptz not null,
  collector_name  text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected','out','returned','cancelled')),
  decided_by      uuid references public.users(id),
  decided_at      timestamptz,
  decision_note   text,
  checked_out_at  timestamptz,
  returned_at     timestamptz,
  created_at      timestamptz not null default now(),
  check (return_by > leave_at)
);

-- ---------- Visitors ----------
create table if not exists public.visitors (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  full_name       text not null,
  phone           text,
  organisation    text,
  purpose         text not null,
  host_name       text,
  host_user_id    uuid references public.users(id) on delete set null,
  badge_no        text,
  id_type         text,
  id_number       text,
  vehicle         text,
  signed_in_at    timestamptz not null default now(),
  signed_out_at   timestamptz,
  recorded_by     uuid references public.users(id)
);
create index if not exists visitors_open on public.visitors(tenant_id) where signed_out_at is null;

-- ---------- Admissions ----------
alter table public.tenant_settings add column if not exists admissions_open boolean not null default false;
alter table public.tenant_settings add column if not exists application_fee numeric(14,2) not null default 0;
alter table public.tenant_settings add column if not exists admissions_intro text;
alter table public.tenants add column if not exists public_slug text;
create unique index if not exists tenants_public_slug on public.tenants(lower(public_slug)) where public_slug is not null;

create table if not exists public.applications (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  application_no     text not null,
  status             text not null default 'new' check (status in ('new','reviewing','assessment','interview','offered','accepted','enrolled','rejected','withdrawn')),
  first_name         text not null,
  last_name          text not null,
  other_names        text,
  gender             text check (gender in ('male','female','other')),
  date_of_birth      date,
  applying_for       text not null,                 -- level / class wanted, e.g. JSS1
  class_group_id     uuid references public.class_groups(id) on delete set null,
  previous_school    text,
  guardian_name      text not null,
  guardian_email     text,
  guardian_phone     text not null,
  guardian_relation  text not null default 'parent',
  address            text,
  notes              text,
  source             text not null default 'online' check (source in ('online','walk_in','referral','agent')),
  assessment_at      timestamptz,
  assessment_score   numeric,
  interview_at       timestamptz,
  decision_note      text,
  offer_expires_on   date,
  fee_paid           boolean not null default false,
  fee_reference      text,
  tracking_token     text not null default encode(gen_random_bytes(18), 'hex'),
  student_id         uuid references public.students(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, application_no),
  unique (tracking_token)
);
create index if not exists applications_status on public.applications(tenant_id, status);

-- ---------- Multi-branch school groups (proprietor view) ----------
create table if not exists public.tenant_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);
alter table public.tenants add column if not exists group_id uuid references public.tenant_groups(id) on delete set null;
create table if not exists public.group_admins (
  group_id  uuid not null references public.tenant_groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  primary key (group_id, user_id)
);
alter table public.tenant_groups enable row level security;
alter table public.group_admins enable row level security;
revoke all on public.tenant_groups, public.group_admins from anon, authenticated;
create or replace function public.my_group_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(group_id), '{}') from public.group_admins where user_id = auth.uid();
$$;
grant execute on function public.my_group_ids() to authenticated;

-- ---------- RLS ----------
alter table public.timetable_periods      enable row level security;
alter table public.timetable_entries      enable row level security;
alter table public.transport_routes       enable row level security;
alter table public.transport_assignments  enable row level security;
alter table public.transport_events       enable row level security;
alter table public.hostels                enable row level security;
alter table public.hostel_rooms           enable row level security;
alter table public.hostel_allocations     enable row level security;
alter table public.exeat_requests         enable row level security;
alter table public.visitors               enable row level security;
alter table public.applications           enable row level security;

-- Timetable: everyone in the school reads; admins write.
drop policy if exists tt_periods_read on public.timetable_periods;
create policy tt_periods_read on public.timetable_periods for select using (tenant_id = public.my_tenant_id());
drop policy if exists tt_periods_write on public.timetable_periods;
create policy tt_periods_write on public.timetable_periods for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
drop policy if exists tt_entries_read on public.timetable_entries;
create policy tt_entries_read on public.timetable_entries for select using (tenant_id = public.my_tenant_id());
drop policy if exists tt_entries_write on public.timetable_entries;
create policy tt_entries_write on public.timetable_entries for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

-- Transport: staff read, transport officer / admins write, family sees own child's.
drop policy if exists routes_read on public.transport_routes;
create policy routes_read on public.transport_routes for select using (tenant_id = public.my_tenant_id());
drop policy if exists routes_write on public.transport_routes;
create policy routes_write on public.transport_routes for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['transport_officer','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['transport_officer','school_admin','principal','platform_admin']));
drop policy if exists t_assign_read on public.transport_assignments;
create policy t_assign_read on public.transport_assignments for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id) or public.is_student_self(student_id)));
drop policy if exists t_assign_write on public.transport_assignments;
create policy t_assign_write on public.transport_assignments for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['transport_officer','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['transport_officer','school_admin','principal','platform_admin']));
drop policy if exists t_events_read on public.transport_events;
create policy t_events_read on public.transport_events for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id)));
-- transport_events are written by the API (service role) so parents are alerted.

-- Boarding
do $$
declare t text;
begin
  foreach t in array array['hostels','hostel_rooms'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.my_tenant_id() and public.is_staff())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.has_role(array[''hostel_warden'',''school_admin'',''principal'',''platform_admin''])) with check (tenant_id = public.my_tenant_id() and public.has_role(array[''hostel_warden'',''school_admin'',''principal'',''platform_admin'']))', t || '_write', t);
  end loop;
end $$;
drop policy if exists alloc_read on public.hostel_allocations;
create policy alloc_read on public.hostel_allocations for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id)));
drop policy if exists alloc_write on public.hostel_allocations;
create policy alloc_write on public.hostel_allocations for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['hostel_warden','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['hostel_warden','school_admin','principal','platform_admin']));
drop policy if exists exeat_read on public.exeat_requests;
create policy exeat_read on public.exeat_requests for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id)));
-- exeat writes go through the API so parents are notified at every step.

-- Visitors: gate and admins.
drop policy if exists visitors_rw on public.visitors;
create policy visitors_rw on public.visitors for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['gate_officer','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['gate_officer','school_admin','principal','platform_admin']));
drop policy if exists visitors_host on public.visitors;
create policy visitors_host on public.visitors for select using (tenant_id = public.my_tenant_id() and host_user_id = auth.uid());

-- Admissions: admissions officers and admins. Public applications are inserted by the API.
drop policy if exists applications_rw on public.applications;
create policy applications_rw on public.applications for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['admissions_officer','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['admissions_officer','school_admin','principal','platform_admin']));
