-- =========================================================================
-- Synergy Swift: the exams office (Phase 14j).
--  * A new staff role, exam_officer, who runs the exam planner (halls,
--    timetable, seating, invigilators) alongside the admins.
--  * exam_requests: extra time, a late sitting, a resit, or a special
--    arrangement (reader, scribe, separate room…) for one candidate and one
--    exam, asked for by staff, a parent or the student, decided by the exams
--    office. Approved extra time, late sittings and resits apply to online
--    papers automatically.
--  * exam_attempt_archive: a resit keeps the first attempt, word for word.
-- Idempotent.
-- =========================================================================

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in (
  'student','teacher','school_admin','it_admin','parent','platform_admin',
  'principal','bursar','librarian','hr_manager','qa_officer','gate_officer',
  'transport_officer','hostel_warden','nurse','admissions_officer','cashier',
  'counsellor','alumni','exam_officer'
));
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['teacher','school_admin','it_admin','platform_admin','principal',
    'bursar','librarian','hr_manager','qa_officer','gate_officer','transport_officer',
    'hostel_warden','nurse','admissions_officer','cashier','counsellor','exam_officer']);
$$;

create or replace function public.is_exam_office()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or public.has_role(array['exam_officer']);
$$;
revoke all on function public.is_exam_office() from public, anon;
grant execute on function public.is_exam_office() to authenticated;

-- The exams office runs the planner too.
do $$
declare t text;
begin
  foreach t in array array['exam_halls','exam_series','exam_papers','exam_seats','exam_invigilations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_exam_office()) with check (tenant_id = public.my_tenant_id() and public.is_exam_office())', t || '_admin_write', t);
  end loop;
end $$;

-- ---------- requests ----------
create table if not exists public.exam_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  exam_id         uuid references public.exams(id) on delete cascade,          -- an online paper
  paper_id        uuid references public.exam_papers(id) on delete cascade,    -- or a timetabled paper
  student_id      uuid not null references public.students(id) on delete cascade,
  kind            text not null check (kind in ('extra_time','late_sitting','resit','special_arrangement')),
  minutes         int check (minutes between 1 and 240),
  opens_at        timestamptz,
  closes_at       timestamptz,
  arrangement     text check (length(arrangement) <= 200),
  reason          text not null check (length(btrim(reason)) between 3 and 1000),
  requested_by    uuid references public.users(id) on delete set null,
  requested_as    text not null default 'staff' check (requested_as in ('staff','parent','student')),
  status          text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  decided_by      uuid references public.users(id) on delete set null,
  decided_at      timestamptz,
  decision_note   text check (length(decision_note) <= 500),
  used_at         timestamptz,
  created_at      timestamptz not null default now(),
  check (exam_id is not null or paper_id is not null),
  check (kind <> 'extra_time' or minutes is not null),
  check (kind <> 'late_sitting' or (opens_at is not null and closes_at is not null and closes_at > opens_at)),
  check (kind <> 'special_arrangement' or arrangement is not null)
);
create index if not exists exam_requests_open on public.exam_requests(tenant_id, status, created_at desc);
create index if not exists exam_requests_student on public.exam_requests(student_id, exam_id);

create or replace function public.exam_request_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.status <> 'pending' then raise exception 'a new request starts as pending'; end if;
    return new;
  end if;
  if new.student_id <> old.student_id or new.kind <> old.kind or new.exam_id is distinct from old.exam_id or new.paper_id is distinct from old.paper_id
     or new.reason <> old.reason or new.requested_by is distinct from old.requested_by then
    raise exception 'a request cannot be changed; cancel it and ask again';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' then raise exception 'this request has already been decided'; end if;
    if new.status = 'cancelled' then
      if auth.uid() is not null and old.requested_by is distinct from auth.uid() and not public.is_exam_office() then
        raise exception 'only the person who asked can cancel this request';
      end if;
    elsif auth.uid() is not null and not public.is_exam_office() then
      raise exception 'only the exams office decides exam requests';
    else
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  elsif auth.uid() is not null and not public.is_exam_office() and (new.minutes is distinct from old.minutes or new.opens_at is distinct from old.opens_at
        or new.closes_at is distinct from old.closes_at or new.used_at is distinct from old.used_at) then
    raise exception 'only the exams office changes a request';
  end if;
  return new;
end $$;
drop trigger if exists exam_request_guard on public.exam_requests;
create trigger exam_request_guard before insert or update on public.exam_requests for each row execute function public.exam_request_guard();
revoke all on function public.exam_request_guard() from public, anon, authenticated;

alter table public.exam_requests enable row level security;
drop policy if exists exam_requests_read on public.exam_requests;
create policy exam_requests_read on public.exam_requests for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id) or public.is_student_self(student_id)));
drop policy if exists exam_requests_insert on public.exam_requests;
create policy exam_requests_insert on public.exam_requests for insert with check (
  tenant_id = public.my_tenant_id() and status = 'pending' and requested_by = auth.uid() and (
    (requested_as = 'staff' and public.is_staff())
    or (requested_as = 'parent' and public.is_guardian_of(student_id))
    or (requested_as = 'student' and public.is_student_self(student_id))));
drop policy if exists exam_requests_update on public.exam_requests;
create policy exam_requests_update on public.exam_requests for update using (
  tenant_id = public.my_tenant_id() and (public.is_exam_office() or requested_by = auth.uid()));
grant select, insert, update on public.exam_requests to authenticated;

-- ---------- a resit keeps the first attempt ----------
create table if not exists public.exam_attempt_archive (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  exam_id          uuid not null references public.exams(id) on delete cascade,
  student_user_id  uuid references public.users(id) on delete set null,
  request_id       uuid references public.exam_requests(id) on delete set null,
  attempt          jsonb not null,
  archived_at      timestamptz not null default now()
);
create index if not exists exam_attempt_archive_exam on public.exam_attempt_archive(exam_id, student_user_id);
alter table public.exam_attempt_archive enable row level security;
drop policy if exists exam_attempt_archive_read on public.exam_attempt_archive;
create policy exam_attempt_archive_read on public.exam_attempt_archive for select using (tenant_id = public.my_tenant_id() and public.is_staff());
grant select on public.exam_attempt_archive to authenticated;
