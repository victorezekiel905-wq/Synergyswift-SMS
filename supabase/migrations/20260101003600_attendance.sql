-- =========================================================================
-- EduClass Fusion: attendance (phase 7a).
--  * lesson_attendance: a register for each lesson, marked by the teacher
--    (or the cover teacher) of that lesson.
--  * attendance_devices, attendance_identifiers: RFID cards, fingerprint and
--    face-recognition clocking machines (ZKTeco push protocol or a webhook).
--  * student_absence_requests: parents ask for absences; the form teacher or
--    an admin approves, and approved days are marked as excused.
--  * tenant_settings: chronic-absence threshold, school weekdays, lesson alerts.
-- Apply AFTER 20260101003500. Idempotent.
-- =========================================================================

-- ---------- per-lesson registers ----------
create table if not exists public.lesson_attendance (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  student_id          uuid not null references public.students(id) on delete cascade,
  date                date not null,
  timetable_entry_id  uuid references public.timetable_entries(id) on delete set null,
  period_id           uuid not null references public.timetable_periods(id) on delete cascade,
  class_group_id      uuid references public.class_groups(id) on delete set null,
  subject_id          uuid references public.subjects(id) on delete set null,
  status              text not null check (status in ('present','absent','late','excused')),
  note                text,
  marked_by           uuid references public.users(id) on delete set null,
  marked_at           timestamptz not null default now(),
  parent_notified     boolean not null default false,
  unique (student_id, date, period_id)
);
create index if not exists lesson_attendance_class_date on public.lesson_attendance(tenant_id, class_group_id, date);

-- The lesson's teacher, its cover teacher that day, the form teacher, or an admin.
create or replace function public.can_mark_lesson(p_entry uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or exists (
    select 1 from public.timetable_entries e left join public.class_groups g on g.id = e.class_group_id
    where e.id = p_entry and e.tenant_id = public.my_tenant_id()
      and (e.teacher_id = auth.uid() or g.form_teacher_id = auth.uid()
        or exists (select 1 from public.cover_assignments c where c.timetable_entry_id = e.id and c.date = p_date and c.cover_user_id = auth.uid())));
$$;
grant execute on function public.can_mark_lesson(uuid, date) to authenticated;

-- ---------- clocking machines ----------
do $$ begin
  alter table public.gate_events drop constraint if exists gate_events_method_check;
  alter table public.gate_events add constraint gate_events_method_check check (method in ('kiosk','self','manual','pickup','card','fingerprint','face','device'));
end $$;

create table if not exists public.attendance_devices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(name) between 2 and 80),
  kind          text not null default 'zkteco' check (kind in ('zkteco','webhook')),
  serial        text unique,                  -- the machine's serial number (ZKTeco)
  secret        text,                         -- webhook devices: hash of the key they send (hidden in the change history)
  location      text,
  mode          text not null default 'auto' check (mode in ('auto','in','out')),
  active        boolean not null default true,
  last_seen_at  timestamptz,
  last_error    text,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (kind <> 'zkteco' or serial is not null)
);

create table if not exists public.attendance_identifiers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  person_type  text not null check (person_type in ('student','staff')),
  student_id   uuid references public.students(id) on delete cascade,
  staff_id     uuid references public.staff(id) on delete cascade,
  kind         text not null check (kind in ('card','device_pin')),   -- RFID card number, or the user number on a clocking machine
  value        text not null check (length(value) between 1 and 64),
  created_at   timestamptz not null default now(),
  unique (tenant_id, kind, value),
  check ((person_type = 'student' and student_id is not null and staff_id is null) or (person_type = 'staff' and staff_id is not null and student_id is null))
);

-- ---------- parents' absence requests ----------
create table if not exists public.student_absence_requests (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  guardian_id    uuid not null references public.guardians(id) on delete cascade,
  kind           text not null check (kind in ('sick','medical','family','religious','bereavement','travel','other')),
  starts_on      date not null,
  ends_on        date not null,
  reason         text not null check (length(reason) between 3 and 1000),
  status         text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  decided_by     uuid references public.users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists student_absence_requests_student on public.student_absence_requests(tenant_id, student_id, starts_on);

-- Who decides: admins and the child's form teacher.
create or replace function public.can_decide_absence(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or exists (
    select 1 from public.students s join public.class_groups g on g.id = s.class_group_id
    where s.id = p_student and s.tenant_id = public.my_tenant_id() and g.form_teacher_id = auth.uid());
$$;
grant execute on function public.can_decide_absence(uuid) to authenticated;

create or replace function public.absence_request_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.student_id <> old.student_id or new.guardian_id <> old.guardian_id or new.starts_on <> old.starts_on or new.ends_on <> old.ends_on or new.kind <> old.kind then
    raise exception 'an absence request cannot be changed; cancel it and make a new one';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' then raise exception 'this request has already been decided'; end if;
    if new.status = 'cancelled' then
      if not exists (select 1 from public.guardians g where g.id = old.guardian_id and g.user_id = auth.uid()) and not public.can_decide_absence(old.student_id) then
        raise exception 'only the parent who asked can cancel this request';
      end if;
    elsif new.status in ('approved','declined') then
      if not public.can_decide_absence(old.student_id) then raise exception 'only the form teacher or an admin can decide absence requests'; end if;
      new.decided_by := auth.uid();
      new.decided_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists absence_request_guard on public.student_absence_requests;
create trigger absence_request_guard before update on public.student_absence_requests for each row execute function public.absence_request_guard();

-- ---------- settings ----------
alter table public.tenant_settings add column if not exists chronic_absence_pct int not null default 90;
alter table public.tenant_settings add column if not exists school_weekdays int[] not null default '{1,2,3,4,5}';
alter table public.tenant_settings add column if not exists lesson_absence_alerts boolean not null default true;
do $$ begin
  alter table public.tenant_settings drop constraint if exists tenant_settings_chronic_check;
  alter table public.tenant_settings add constraint tenant_settings_chronic_check check (chronic_absence_pct between 50 and 100);
end $$;

-- ---------- RLS ----------
alter table public.lesson_attendance enable row level security;
drop policy if exists lesson_attendance_read on public.lesson_attendance;
create policy lesson_attendance_read on public.lesson_attendance for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or public.is_guardian_of(student_id) or public.is_student_self(student_id)));
drop policy if exists lesson_attendance_write on public.lesson_attendance;
create policy lesson_attendance_write on public.lesson_attendance for all using (tenant_id = public.my_tenant_id()
  and (public.is_school_admin() or (timetable_entry_id is not null and public.can_mark_lesson(timetable_entry_id, date))))
  with check (tenant_id = public.my_tenant_id()
  and (public.is_school_admin() or (timetable_entry_id is not null and public.can_mark_lesson(timetable_entry_id, date)
    and exists (select 1 from public.students s join public.timetable_entries e on e.class_group_id = s.class_group_id where s.id = student_id and e.id = timetable_entry_id))));

alter table public.attendance_devices enable row level security;
drop policy if exists attendance_devices_admin on public.attendance_devices;
create policy attendance_devices_admin on public.attendance_devices for all using (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['it_admin'])))
  with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['it_admin'])));

alter table public.attendance_identifiers enable row level security;
drop policy if exists attendance_identifiers_admin on public.attendance_identifiers;
create policy attendance_identifiers_admin on public.attendance_identifiers for all using (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['it_admin','gate_officer'])))
  with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['it_admin','gate_officer'])));

alter table public.student_absence_requests enable row level security;
drop policy if exists absence_requests_read on public.student_absence_requests;
create policy absence_requests_read on public.student_absence_requests for select using (tenant_id = public.my_tenant_id()
  and (public.is_guardian_of(student_id) or public.is_student_self(student_id) or public.is_school_admin() or public.teaches_student(student_id) or public.has_role(array['counsellor'])));
drop policy if exists absence_requests_insert on public.student_absence_requests;
create policy absence_requests_insert on public.student_absence_requests for insert with check (tenant_id = public.my_tenant_id() and status = 'pending'
  and public.is_guardian_of(student_id) and exists (select 1 from public.guardians g where g.id = guardian_id and g.user_id = auth.uid()));
drop policy if exists absence_requests_update on public.student_absence_requests;
create policy absence_requests_update on public.student_absence_requests for update using (tenant_id = public.my_tenant_id()
  and (public.can_decide_absence(student_id) or exists (select 1 from public.guardians g where g.id = guardian_id and g.user_id = auth.uid())))
  with check (tenant_id = public.my_tenant_id());

grant all on public.lesson_attendance, public.attendance_devices, public.attendance_identifiers, public.student_absence_requests to service_role;

-- Registers, devices (key hashes hidden) and requests are logged.
select public.attach_change_log();
