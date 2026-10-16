-- =====================================================================
--  Phase 11b: boarding and transport.
--
--  * Exeats: a kind; requests made by staff or the student wait for a parent
--    to agree before the house decides; an alert when a student is late back.
--  * Roll calls for each boarding house (present, absent, on exeat, sick bay,
--    late) taken by house staff.
--  * House-parent notes about a boarder, some shared with the family.
--  * Menus by day and meal, and a dining register.
--  * Vehicles and drivers with their documents' expiry dates, linked to routes.
-- =====================================================================

-- ---------- Exeats ----------
alter table public.exeat_requests drop constraint if exists exeat_requests_status_check;
alter table public.exeat_requests add constraint exeat_requests_status_check check (status in ('awaiting_parent','pending','approved','rejected','out','returned','cancelled'));
alter table public.exeat_requests drop constraint if exists exeat_requests_requested_by_check;
alter table public.exeat_requests add constraint exeat_requests_requested_by_check check (requested_by in ('guardian','staff','student'));
alter table public.exeat_requests add column if not exists kind text not null default 'weekend' check (kind in ('weekend','day','medical','holiday','family','other'));
alter table public.exeat_requests add column if not exists parent_decided_by uuid references public.guardians(id) on delete set null;
alter table public.exeat_requests add column if not exists parent_decided_at timestamptz;
alter table public.exeat_requests add column if not exists overdue_alerted_at timestamptz;
alter table public.exeat_requests add column if not exists staff_created_by uuid references public.users(id) on delete set null;
create index if not exists exeat_out on public.exeat_requests(tenant_id, status, return_by);

-- ---------- Roll calls ----------
create table if not exists public.boarding_roll_calls (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  hostel_id   uuid not null references public.hostels(id) on delete cascade,
  kind        text not null default 'evening' check (kind in ('morning','evening','night','prep','other')),
  taken_at    timestamptz not null default now(),
  taken_by    uuid references public.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists roll_calls_hostel on public.boarding_roll_calls(hostel_id, taken_at desc);
create table if not exists public.boarding_roll_marks (
  roll_call_id  uuid not null references public.boarding_roll_calls(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  status        text not null check (status in ('present','absent','late','exeat','sick_bay','excused')),
  note          text,
  primary key (roll_call_id, student_id)
);

-- ---------- House-parent notes ----------
create table if not exists public.boarding_notes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  student_id         uuid not null references public.students(id) on delete cascade,
  kind               text not null default 'general' check (kind in ('general','welfare','behaviour','health','achievement','contact')),
  note               text not null check (length(trim(note)) between 2 and 4000),
  visible_to_parent  boolean not null default false,
  author_id          uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists boarding_notes_student on public.boarding_notes(student_id, created_at desc);

-- ---------- Dining ----------
create table if not exists public.meal_menus (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  hostel_id  uuid references public.hostels(id) on delete cascade,          -- null = the whole school
  on_date    date not null,
  meal       text not null check (meal in ('breakfast','lunch','supper','snack')),
  items      text not null check (length(trim(items)) between 1 and 1000),
  alternatives text,                                                         -- e.g. vegetarian or allergy-safe option
  unique nulls not distinct (tenant_id, hostel_id, on_date, meal)
);
create table if not exists public.dining_marks (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  on_date     date not null,
  meal        text not null check (meal in ('breakfast','lunch','supper','snack')),
  student_id  uuid not null references public.students(id) on delete cascade,
  status      text not null default 'ate' check (status in ('ate','missed','packed','special')),
  marked_by   uuid references public.users(id) on delete set null,
  at          timestamptz not null default now(),
  primary key (on_date, meal, student_id)
);

-- ---------- Vehicles and drivers ----------
create table if not exists public.vehicles (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  reg_no               text not null check (length(trim(reg_no)) between 2 and 20),
  make_model           text,
  seats                int check (seats between 1 and 200),
  insurance_expires    date,
  roadworthy_expires   date,
  licence_expires      date,                 -- vehicle licence / registration
  last_service_on      date,
  next_service_on      date,
  odometer_km          int check (odometer_km >= 0),
  status               text not null default 'active' check (status in ('active','repair','retired')),
  notes                text,
  created_at           timestamptz not null default now(),
  unique (tenant_id, reg_no)
);
create table if not exists public.drivers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  staff_id          uuid references public.staff(id) on delete set null,
  full_name         text not null check (length(trim(full_name)) between 2 and 120),
  phone             text,
  licence_no        text,
  licence_class     text,
  licence_expires   date,
  medical_expires   date,
  background_check_on date,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
alter table public.transport_routes add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.transport_routes add column if not exists driver_id uuid references public.drivers(id) on delete set null;

-- ---------- RLS ----------
create or replace function public.is_boarding_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['hostel_warden','school_admin','principal','platform_admin']);
$$;
grant execute on function public.is_boarding_staff() to authenticated;

alter table public.boarding_roll_calls enable row level security;
drop policy if exists roll_calls_read on public.boarding_roll_calls;
create policy roll_calls_read on public.boarding_roll_calls for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists roll_calls_write on public.boarding_roll_calls;
create policy roll_calls_write on public.boarding_roll_calls for all using (tenant_id = public.my_tenant_id() and public.is_boarding_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_boarding_staff());

alter table public.boarding_roll_marks enable row level security;
drop policy if exists roll_marks_read on public.boarding_roll_marks;
create policy roll_marks_read on public.boarding_roll_marks for select using (tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id)));
drop policy if exists roll_marks_write on public.boarding_roll_marks;
create policy roll_marks_write on public.boarding_roll_marks for all using (tenant_id = public.my_tenant_id() and public.is_boarding_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_boarding_staff());

alter table public.boarding_notes enable row level security;
drop policy if exists boarding_notes_read on public.boarding_notes;
create policy boarding_notes_read on public.boarding_notes for select using (tenant_id = public.my_tenant_id()
  and (public.is_boarding_staff() or public.is_counsellor() or (visible_to_parent and public.is_guardian_of(student_id))));
drop policy if exists boarding_notes_write on public.boarding_notes;
create policy boarding_notes_write on public.boarding_notes for insert with check (tenant_id = public.my_tenant_id() and public.is_boarding_staff() and author_id = auth.uid());
drop policy if exists boarding_notes_update on public.boarding_notes;
create policy boarding_notes_update on public.boarding_notes for update using (tenant_id = public.my_tenant_id() and author_id = auth.uid()) with check (tenant_id = public.my_tenant_id());
drop policy if exists boarding_notes_delete on public.boarding_notes;
create policy boarding_notes_delete on public.boarding_notes for delete using (tenant_id = public.my_tenant_id() and (author_id = auth.uid() or public.is_school_admin()));

-- Menus are for everyone in the school, families included.
alter table public.meal_menus enable row level security;
drop policy if exists meal_menus_read on public.meal_menus;
create policy meal_menus_read on public.meal_menus for select using (tenant_id = public.my_tenant_id());
drop policy if exists meal_menus_write on public.meal_menus;
create policy meal_menus_write on public.meal_menus for all using (tenant_id = public.my_tenant_id() and public.is_boarding_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_boarding_staff());

alter table public.dining_marks enable row level security;
drop policy if exists dining_read on public.dining_marks;
create policy dining_read on public.dining_marks for select using (tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id)));
drop policy if exists dining_write on public.dining_marks;
create policy dining_write on public.dining_marks for all using (tenant_id = public.my_tenant_id() and public.is_boarding_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_boarding_staff());

do $$
declare t text;
begin
  foreach t in array array['vehicles','drivers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.my_tenant_id() and public.is_staff())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.has_role(array['transport_officer','school_admin','principal','platform_admin'])) with check (tenant_id = public.my_tenant_id() and public.has_role(array['transport_officer','school_admin','principal','platform_admin']))$p$, t || '_write', t);
  end loop;
end $$;

grant all on public.boarding_roll_calls, public.boarding_roll_marks, public.boarding_notes, public.meal_menus, public.dining_marks, public.vehicles, public.drivers to service_role;

select public.attach_change_log();
