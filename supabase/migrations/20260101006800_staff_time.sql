-- =========================================================================
-- Synergy Swift: staff time (Phase 14i-1).
--  * staff_shifts + staff_shift_assignments: shift patterns (day, evening and
--    overnight, e.g. security and boarding staff) with grace minutes and an
--    early-leaving threshold, given to staff for a period. A person cannot be
--    given two shifts whose hours overlap on the same weekday.
--  * staff_time_requests: "I will be late", "I need to leave early" and "I
--    forgot to clock in". The line manager or HR decides; an approved missed
--    clock adds the missing sign-in record, an approved late or early
--    departure is excused (no deduction).
--  * hr_settings: optional payroll deductions for unexcused lateness and
--    absence. Off by default.
--  * tenant_settings: campuses, and how staff may clock in from a phone (a
--    rotating QR code at the entrance, the school's geofence, or both).
--  * gate_events: the campus a sign-in happened at, and early departures.
-- Idempotent.
-- =========================================================================

-- ---------- shifts ----------
create table if not exists public.staff_shifts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  name                 text not null check (length(btrim(name)) between 2 and 60),
  starts_at            time not null,
  ends_at              time not null,                      -- earlier than starts_at = runs overnight
  days                 int[] not null default '{1,2,3,4,5}', -- ISO weekdays, 1 = Monday
  grace_minutes        int not null default 10 check (grace_minutes between 0 and 120),
  early_leave_minutes  int not null default 15 check (early_leave_minutes between 0 and 240),
  campus               text check (length(campus) <= 60),
  works_holidays       boolean not null default false,       -- security, boarding: the shift runs on school holidays too
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  unique (tenant_id, name),
  check (ends_at <> starts_at),
  check (cardinality(days) between 1 and 7 and days <@ '{1,2,3,4,5,6,7}'::int[])
);

create table if not exists public.staff_shift_assignments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  shift_id    uuid not null references public.staff_shifts(id) on delete cascade,
  starts_on   date not null default current_date,
  ends_on     date,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists staff_shift_assignments_staff on public.staff_shift_assignments(staff_id, starts_on);
create index if not exists staff_shift_assignments_tenant on public.staff_shift_assignments(tenant_id);

-- Do two daily time ranges overlap? Either may run past midnight.
create or replace function public.time_ranges_overlap(s1 time, e1 time, s2 time, e2 time)
returns boolean language sql immutable set search_path = public as $$
  with a as (select extract(epoch from s1) / 60 s, extract(epoch from e1) / 60 + case when e1 <= s1 then 1440 else 0 end e),
       b as (select extract(epoch from s2) / 60 s, extract(epoch from e2) / 60 + case when e2 <= s2 then 1440 else 0 end e)
  select exists (select 1 from a, b, (values (-1440), (0), (1440)) k(off) where a.s < b.e + k.off and b.s + k.off < a.e)
$$;

create or replace function public.staff_shift_clash()
returns trigger language plpgsql security definer set search_path = public as $$
declare n public.staff_shifts; c record;
begin
  -- Someone who may not assign shifts learns nothing here: row-level security turns them away.
  if auth.uid() is not null and not public.is_hr() then return new; end if;
  select * into n from public.staff_shifts where id = new.shift_id;
  if n.id is null or n.tenant_id <> new.tenant_id then raise exception 'shift not found'; end if;
  if not exists (select 1 from public.staff where id = new.staff_id and tenant_id = new.tenant_id) then raise exception 'staff member not found'; end if;
  for c in
    select s.name, s.starts_at, s.ends_at from public.staff_shift_assignments a join public.staff_shifts s on s.id = a.shift_id
    where a.staff_id = new.staff_id and a.id <> new.id and s.days && n.days
      and a.starts_on <= coalesce(new.ends_on, 'infinity'::date) and coalesce(a.ends_on, 'infinity'::date) >= new.starts_on
  loop
    if public.time_ranges_overlap(c.starts_at, c.ends_at, n.starts_at, n.ends_at) then
      raise exception 'clashes with the % shift this person already has', c.name;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists staff_shift_clash on public.staff_shift_assignments;
create trigger staff_shift_clash before insert or update on public.staff_shift_assignments for each row execute function public.staff_shift_clash();
revoke all on function public.staff_shift_clash() from public, anon, authenticated;

-- ---------- late, early and missed-clock requests ----------
create table if not exists public.staff_time_requests (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  staff_id       uuid not null references public.staff(id) on delete cascade,
  kind           text not null check (kind in ('late_arrival','early_departure','missed_clock')),
  on_date        date not null,
  at_time        time,                                     -- expected arrival, leaving time, or when the missed clock happened
  direction      text check (direction in ('in','out')),   -- missed clock only
  reason         text not null check (length(btrim(reason)) between 3 and 1000),
  status         text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  decided_by     uuid references public.users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text check (length(decision_note) <= 500),
  gate_event_id  uuid references public.gate_events(id) on delete set null,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (kind <> 'missed_clock' or (direction is not null and at_time is not null))
);
create index if not exists staff_time_requests_staff on public.staff_time_requests(tenant_id, staff_id, on_date desc);

-- HR, or the person's line manager, decides.
create or replace function public.can_decide_staff_time(p_staff uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_hr() or public.manages_staff(p_staff)
$$;
revoke all on function public.can_decide_staff_time(uuid) from public, anon;
grant execute on function public.can_decide_staff_time(uuid) to authenticated;

create or replace function public.staff_time_request_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tz text; v_ev uuid;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.status <> 'pending' then raise exception 'a new request starts as pending'; end if;
    return new;
  end if;
  if new.staff_id <> old.staff_id or new.kind <> old.kind or new.on_date <> old.on_date or new.at_time is distinct from old.at_time
     or new.direction is distinct from old.direction or new.reason <> old.reason then
    raise exception 'a request cannot be changed; cancel it and make a new one';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' then raise exception 'this request has already been decided'; end if;
    if new.status = 'cancelled' then
      if auth.uid() is not null and old.staff_id is distinct from public.my_staff_id() and not public.can_decide_staff_time(old.staff_id) then
        raise exception 'only the person who asked can cancel this request';
      end if;
    elsif new.status in ('approved','declined') then
      if auth.uid() is not null then
        if not public.can_decide_staff_time(old.staff_id) then raise exception 'only the line manager or HR can decide this request'; end if;
        if old.staff_id = public.my_staff_id() then raise exception 'you cannot decide your own request'; end if;
      end if;
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
      -- An approved missed clock adds the sign-in record that was missed.
      if new.status = 'approved' and old.kind = 'missed_clock' and old.gate_event_id is null then
        select timezone into v_tz from public.tenants where id = old.tenant_id;
        insert into public.gate_events (tenant_id, person_type, staff_id, direction, method, recorded_by, note, at)
          values (old.tenant_id, 'staff', old.staff_id, old.direction, 'manual', new.decided_by, 'Missed clock approved',
                  (old.on_date + old.at_time) at time zone coalesce(v_tz, 'Africa/Lagos'))
          returning id into v_ev;
        new.gate_event_id := v_ev;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists staff_time_request_guard on public.staff_time_requests;
create trigger staff_time_request_guard before insert or update on public.staff_time_requests for each row execute function public.staff_time_request_guard();
revoke all on function public.staff_time_request_guard() from public, anon, authenticated;

-- ---------- settings ----------
alter table public.hr_settings add column if not exists late_deduction_mode text not null default 'off';
alter table public.hr_settings add column if not exists late_deduction_amount numeric not null default 0;
alter table public.hr_settings add column if not exists late_free_per_month int not null default 3;
alter table public.hr_settings add column if not exists early_counts_as_late boolean not null default true;
alter table public.hr_settings add column if not exists absence_deduction boolean not null default false;
do $$ begin
  alter table public.hr_settings drop constraint if exists hr_settings_late_rules_check;
  alter table public.hr_settings add constraint hr_settings_late_rules_check check (late_deduction_mode in ('off','per_late','per_minute')
    and late_deduction_amount between 0 and 1000000 and late_free_per_month between 0 and 31);
end $$;

alter table public.tenant_settings add column if not exists campuses text[] not null default '{}';
alter table public.tenant_settings add column if not exists staff_self_clock text not null default 'auto';
do $$ begin
  alter table public.tenant_settings drop constraint if exists tenant_settings_staff_self_clock_check;
  alter table public.tenant_settings add constraint tenant_settings_staff_self_clock_check
    check (staff_self_clock in ('auto','qr','geofence','qr_or_geofence','qr_and_geofence') and cardinality(campuses) <= 20);
end $$;

alter table public.gate_events add column if not exists campus text check (length(campus) <= 60);
alter table public.gate_events add column if not exists early boolean not null default false;

-- ---------- RLS ----------
alter table public.staff_shifts enable row level security;
alter table public.staff_shift_assignments enable row level security;
alter table public.staff_time_requests enable row level security;

-- Rosters are visible to staff; HR keeps them.
drop policy if exists staff_shifts_read on public.staff_shifts;
create policy staff_shifts_read on public.staff_shifts for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists staff_shifts_write on public.staff_shifts;
create policy staff_shifts_write on public.staff_shifts for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());
drop policy if exists staff_shift_assignments_read on public.staff_shift_assignments;
create policy staff_shift_assignments_read on public.staff_shift_assignments for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists staff_shift_assignments_write on public.staff_shift_assignments;
create policy staff_shift_assignments_write on public.staff_shift_assignments for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());

-- Requests: the person, their line manager and HR.
drop policy if exists staff_time_requests_read on public.staff_time_requests;
create policy staff_time_requests_read on public.staff_time_requests for select using (
  tenant_id = public.my_tenant_id() and (staff_id = public.my_staff_id() or public.can_decide_staff_time(staff_id)));
drop policy if exists staff_time_requests_insert on public.staff_time_requests;
create policy staff_time_requests_insert on public.staff_time_requests for insert with check (
  tenant_id = public.my_tenant_id() and status = 'pending' and created_by = auth.uid()
  and (staff_id = public.my_staff_id() or public.is_hr()));
drop policy if exists staff_time_requests_update on public.staff_time_requests;
create policy staff_time_requests_update on public.staff_time_requests for update using (
  tenant_id = public.my_tenant_id() and (staff_id = public.my_staff_id() or public.can_decide_staff_time(staff_id)));

grant select, insert, update, delete on public.staff_shifts, public.staff_shift_assignments to authenticated;
grant select, insert, update on public.staff_time_requests to authenticated;
