-- =========================================================================
-- EduClass Fusion: exam logistics.
--  * exam_halls: rooms with a capacity and a rows × columns layout.
--  * exam_series: one exam period (e.g. first-term examinations) with its
--    dates, daily sessions and planning rules.
--  * exam_papers: what is sat, by which classes, and when. A paper can link
--    to a CBT exam.
--  * exam_seats: seating plan per paper (hall, row, column, label).
--  * exam_invigilations: who supervises which hall in which session.
-- Admins plan; staff read everything; students read their own published
-- timetable and seats.
-- Apply AFTER 20260101002500. Idempotent.
-- =========================================================================

create table if not exists public.exam_halls (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  capacity    int not null check (capacity between 1 and 5000),
  rows        int not null default 0 check (rows between 0 and 200),
  cols        int not null default 0 check (cols between 0 and 200),
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.exam_series (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  term_id            uuid references public.terms(id) on delete set null,
  name               text not null,
  starts_on          date not null,
  ends_on            date not null,
  -- [{ "label": "Morning", "start": "09:00", "minutes": 150 }, …]
  sessions           jsonb not null default '[{"label":"Morning","start":"09:00","minutes":150},{"label":"Afternoon","start":"12:30","minutes":120}]'::jsonb,
  skip_dates         jsonb not null default '[]'::jsonb,
  max_per_day        int not null default 2 check (max_per_day between 1 and 6),
  invigilator_ratio  int not null default 30 check (invigilator_ratio between 5 and 200),
  spacing            text not null default 'every_seat' check (spacing in ('every_seat','alternate')),
  status             text not null default 'draft' check (status in ('draft','published')),
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table if not exists public.exam_papers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  series_id         uuid not null references public.exam_series(id) on delete cascade,
  subject_id        uuid references public.subjects(id) on delete set null,
  title             text not null,
  class_group_ids   uuid[] not null default '{}',
  duration_minutes  int not null default 120 check (duration_minutes between 5 and 600),
  slot_date         date,
  slot_session      int,
  locked            boolean not null default false,   -- keep this slot when regenerating
  exam_id           uuid references public.exams(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists exam_papers_series on public.exam_papers(series_id, slot_date, slot_session);

create table if not exists public.exam_seats (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  series_id   uuid not null references public.exam_series(id) on delete cascade,
  paper_id    uuid not null references public.exam_papers(id) on delete cascade,
  hall_id     uuid not null references public.exam_halls(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  row         int not null,
  col         int not null,
  label       text not null,
  unique (paper_id, student_id)
);
create index if not exists exam_seats_series on public.exam_seats(series_id, hall_id);
create index if not exists exam_seats_student on public.exam_seats(student_id);

create table if not exists public.exam_invigilations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  series_id      uuid not null references public.exam_series(id) on delete cascade,
  slot_date      date not null,
  slot_session   int not null,
  hall_id        uuid not null references public.exam_halls(id) on delete cascade,
  staff_user_id  uuid not null references public.users(id) on delete cascade,
  chief          boolean not null default false,
  unique (series_id, slot_date, slot_session, staff_user_id)
);

alter table public.exam_halls          enable row level security;
alter table public.exam_series         enable row level security;
alter table public.exam_papers         enable row level security;
alter table public.exam_seats          enable row level security;
alter table public.exam_invigilations  enable row level security;

-- Staff read everything in their school; only school admins change plans.
do $$
declare t text;
begin
  foreach t in array array['exam_halls','exam_series','exam_papers','exam_seats','exam_invigilations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.my_tenant_id() and public.is_staff())', t || '_staff_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_school_admin()) with check (tenant_id = public.my_tenant_id() and public.is_school_admin())', t || '_admin_write', t);
  end loop;
end $$;

-- Students (and their guardians) see published papers for their class and their own seats.
drop policy if exists exam_series_student_read on public.exam_series;
create policy exam_series_student_read on public.exam_series for select using (
  tenant_id = public.my_tenant_id() and status = 'published');
drop policy if exists exam_papers_student_read on public.exam_papers;
create policy exam_papers_student_read on public.exam_papers for select using (
  tenant_id = public.my_tenant_id()
  and exists (select 1 from public.exam_series s where s.id = exam_papers.series_id and s.status = 'published')
  and exists (select 1 from public.students st where st.class_group_id = any(exam_papers.class_group_ids)
              and (st.user_id = auth.uid() or public.is_guardian_of(st.id))));
drop policy if exists exam_seats_student_read on public.exam_seats;
create policy exam_seats_student_read on public.exam_seats for select using (
  tenant_id = public.my_tenant_id()
  and exists (select 1 from public.exam_series s where s.id = exam_seats.series_id and s.status = 'published')
  and exists (select 1 from public.students st where st.id = exam_seats.student_id and (st.user_id = auth.uid() or public.is_guardian_of(st.id))));
drop policy if exists exam_halls_student_read on public.exam_halls;
create policy exam_halls_student_read on public.exam_halls for select using (
  tenant_id = public.my_tenant_id()
  and exists (select 1 from public.exam_seats x join public.students st on st.id = x.student_id
              where x.hall_id = exam_halls.id and (st.user_id = auth.uid() or public.is_guardian_of(st.id))));
