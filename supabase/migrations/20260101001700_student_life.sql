-- =========================================================================
-- EduClass Fusion — student life (v46)
-- Daily class register, behaviour and houses, homework, health and sick bay,
-- events and trips with consent, parent-teacher meetings, report-card
-- character and skills ratings, lesson notes with approval, interventions.
-- Apply AFTER 20260101001600_finance.sql. Idempotent.
-- =========================================================================

create or replace function public.is_student_self(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s where s.id = p_student and s.user_id = auth.uid());
$$;
grant execute on function public.is_student_self(uuid) to authenticated;

-- A teacher who teaches or is form teacher of the student's class.
create or replace function public.teaches_student(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    left join public.class_groups g on g.id = s.class_group_id
    where s.id = p_student and (
      g.form_teacher_id = auth.uid()
      or exists (select 1 from public.subject_offerings o where o.class_group_id = s.class_group_id and o.teacher_id = auth.uid())));
$$;
grant execute on function public.teaches_student(uuid) to authenticated;

-- ---------- Daily class register ----------
create table if not exists public.class_attendance (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  class_group_id  uuid references public.class_groups(id) on delete set null,
  date            date not null,
  status          text not null check (status in ('present','absent','late','excused')),
  reason          text,
  marked_by       uuid references public.users(id),
  marked_at       timestamptz not null default now(),
  parent_notified boolean not null default false,
  unique (student_id, date)
);
create index if not exists class_attendance_class_date on public.class_attendance(class_group_id, date);

-- ---------- Houses and behaviour ----------
create table if not exists public.houses (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  color      text not null default '#1d5ddb',
  unique (tenant_id, name)
);
alter table public.students add column if not exists house_id uuid references public.houses(id) on delete set null;

create table if not exists public.behaviour_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('positive','negative')),
  points     int not null,
  notify_parent boolean not null default false,
  unique (tenant_id, name)
);
create table if not exists public.behaviour_records (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  category_id  uuid references public.behaviour_categories(id) on delete set null,
  kind         text not null check (kind in ('positive','negative')),
  points       int not null,
  note         text,
  recorded_by  uuid references public.users(id),
  occurred_at  timestamptz not null default now()
);
create index if not exists behaviour_records_student on public.behaviour_records(student_id, occurred_at desc);

-- Automatic actions: e.g. "3 negative records in 14 days → detention + tell parents"
create table if not exists public.behaviour_rules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  kind         text not null check (kind in ('positive','negative')),
  measure      text not null default 'count' check (measure in ('count','points')),
  threshold    int not null check (threshold > 0),
  window_days  int not null default 14 check (window_days between 1 and 365),
  action       text not null,                       -- e.g. "Detention", "Head teacher commendation"
  notify_parent boolean not null default true,
  active       boolean not null default true
);
create table if not exists public.behaviour_actions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  rule_id      uuid references public.behaviour_rules(id) on delete set null,
  action       text not null,
  status       text not null default 'open' check (status in ('open','done','cancelled')),
  note         text,
  created_at   timestamptz not null default now(),
  resolved_by  uuid references public.users(id),
  resolved_at  timestamptz
);

-- ---------- Homework ----------
create table if not exists public.homework (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete set null,
  set_by          uuid not null references public.users(id),
  title           text not null,
  instructions    text,
  attachment_url  text,
  due_at          timestamptz not null,
  max_score       numeric,
  allow_late      boolean not null default true,
  created_at      timestamptz not null default now()
);
create table if not exists public.homework_submissions (
  id            uuid primary key default gen_random_uuid(),
  homework_id   uuid not null references public.homework(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  body          text,
  file_path     text,
  submitted_at  timestamptz not null default now(),
  late          boolean not null default false,
  score         numeric,
  feedback      text,
  marked_by     uuid references public.users(id),
  marked_at     timestamptz,
  unique (homework_id, student_id)
);

-- ---------- Health ----------
create table if not exists public.medical_profiles (
  student_id         uuid primary key references public.students(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  blood_group        text,
  genotype           text,
  allergies          text,
  conditions         text,
  medications        text,
  dietary            text,
  emergency_contact  text,
  doctor             text,
  updated_by         uuid references public.users(id),
  updated_at         timestamptz not null default now()
);
create table if not exists public.sickbay_visits (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  complaint     text not null,
  temperature   numeric,
  treatment     text,
  outcome       text not null default 'returned_to_class' check (outcome in ('returned_to_class','resting','sent_home','hospital')),
  parent_notified boolean not null default false,
  recorded_by   uuid references public.users(id),
  at            timestamptz not null default now()
);

-- ---------- Events, trips and consent ----------
create table if not exists public.school_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  title            text not null,
  description      text,
  kind             text not null default 'event' check (kind in ('event','trip','club','holiday','exam','meeting')),
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  location         text,
  class_group_ids  uuid[] not null default '{}',     -- empty = whole school
  requires_consent boolean not null default false,
  fee              numeric(14,2) not null default 0,
  fee_item_id      uuid references public.fee_items(id) on delete set null,
  capacity         int,
  respond_by       timestamptz,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now()
);
create table if not exists public.event_responses (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.school_events(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  guardian_id  uuid references public.guardians(id) on delete set null,
  consent      boolean not null,
  note         text,
  invoice_id   uuid references public.fee_invoices(id) on delete set null,
  responded_at timestamptz not null default now(),
  unique (event_id, student_id)
);

-- ---------- Parent–teacher meetings ----------
create table if not exists public.consultation_slots (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  staff_user_id uuid not null references public.users(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  location      text,                  -- room or video link
  guardian_id   uuid references public.guardians(id) on delete set null,
  student_id    uuid references public.students(id) on delete set null,
  booked_at     timestamptz,
  note          text,
  check (ends_at > starts_at)
);
create index if not exists consultation_slots_staff on public.consultation_slots(staff_user_id, starts_at);

-- ---------- Report-card character and skills ratings ----------
create table if not exists public.trait_definitions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  domain     text not null check (domain in ('affective','psychomotor')),
  name       text not null,
  position   int not null default 1,
  unique (tenant_id, domain, name)
);
create table if not exists public.trait_ratings (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  term_id     uuid not null references public.terms(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  trait_id    uuid not null references public.trait_definitions(id) on delete cascade,
  rating      int not null check (rating between 1 and 5),
  rated_by    uuid references public.users(id),
  primary key (term_id, student_id, trait_id)
);

-- ---------- Lesson notes with approval ----------
create table if not exists public.lesson_notes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  author_id        uuid not null references public.users(id),
  subject_id       uuid references public.subjects(id) on delete set null,
  class_group_id   uuid references public.class_groups(id) on delete set null,
  term_id          uuid references public.terms(id) on delete set null,
  week             int check (week between 1 and 20),
  topic            text not null,
  content          text not null default '',
  status           text not null default 'draft' check (status in ('draft','submitted','approved','returned')),
  ai_generated     boolean not null default false,
  reviewer_id      uuid references public.users(id),
  review_comment   text,
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function public.lesson_notes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.status is distinct from old.status and new.status in ('approved','returned') then
    if not public.has_role(array['school_admin','principal','qa_officer','platform_admin']) then
      raise exception 'only the principal, admins or QA can approve lesson notes';
    end if;
    if old.author_id = auth.uid() then raise exception 'you cannot approve your own lesson note'; end if;
  end if;
  if old.status = 'approved' and new.status = 'approved' and new.content is distinct from old.content then
    raise exception 'approved lesson notes are locked; ask for it to be returned first';
  end if;
  return new;
end $$;
drop trigger if exists lesson_notes_guard on public.lesson_notes;
create trigger lesson_notes_guard before update on public.lesson_notes for each row execute function public.lesson_notes_guard();

-- ---------- Early-warning interventions ----------
create table if not exists public.student_interventions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  reason      text not null,
  plan        text,
  owner_id    uuid references public.users(id),
  status      text not null default 'open' check (status in ('open','closed')),
  review_on   date,
  outcome     text,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);

-- ---------- RLS ----------
alter table public.class_attendance       enable row level security;
alter table public.houses                 enable row level security;
alter table public.behaviour_categories   enable row level security;
alter table public.behaviour_records      enable row level security;
alter table public.behaviour_rules        enable row level security;
alter table public.behaviour_actions      enable row level security;
alter table public.homework               enable row level security;
alter table public.homework_submissions   enable row level security;
alter table public.medical_profiles       enable row level security;
alter table public.sickbay_visits         enable row level security;
alter table public.school_events          enable row level security;
alter table public.event_responses        enable row level security;
alter table public.consultation_slots     enable row level security;
alter table public.trait_definitions      enable row level security;
alter table public.trait_ratings          enable row level security;
alter table public.lesson_notes           enable row level security;
alter table public.student_interventions  enable row level security;

-- Attendance: staff read; teachers of the class (or admins) write; family reads own.
drop policy if exists class_attendance_read on public.class_attendance;
create policy class_attendance_read on public.class_attendance for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id) or public.is_student_self(student_id)));
drop policy if exists class_attendance_write on public.class_attendance;
create policy class_attendance_write on public.class_attendance for all using (
  tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.teaches_student(student_id))
) with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.teaches_student(student_id)));

-- Reference tables readable school-wide, admins write.
do $$
declare t text;
begin
  foreach t in array array['houses','behaviour_categories','behaviour_rules','trait_definitions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.my_tenant_id())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_school_admin()) with check (tenant_id = public.my_tenant_id() and public.is_school_admin())', t || '_write', t);
  end loop;
end $$;

-- Behaviour: any teacher records; family sees their own child's.
drop policy if exists behaviour_records_read on public.behaviour_records;
create policy behaviour_records_read on public.behaviour_records for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id) or public.is_student_self(student_id)));
drop policy if exists behaviour_records_insert on public.behaviour_records;
create policy behaviour_records_insert on public.behaviour_records for insert with check (
  tenant_id = public.my_tenant_id() and public.is_staff() and recorded_by = auth.uid());
drop policy if exists behaviour_records_delete on public.behaviour_records;
create policy behaviour_records_delete on public.behaviour_records for delete using (
  tenant_id = public.my_tenant_id() and (recorded_by = auth.uid() or public.is_school_admin()));

drop policy if exists behaviour_actions_rw on public.behaviour_actions;
create policy behaviour_actions_rw on public.behaviour_actions for all using (
  tenant_id = public.my_tenant_id() and public.is_staff()) with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists behaviour_actions_family on public.behaviour_actions;
create policy behaviour_actions_family on public.behaviour_actions for select using (
  tenant_id = public.my_tenant_id() and (public.is_guardian_of(student_id) or public.is_student_self(student_id)));

-- Homework: staff manage; students of the class read; families read.
drop policy if exists homework_staff on public.homework;
create policy homework_staff on public.homework for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff() and set_by = auth.uid());
drop policy if exists homework_family on public.homework;
create policy homework_family on public.homework for select using (
  tenant_id = public.my_tenant_id() and exists (
    select 1 from public.students s where s.class_group_id = homework.class_group_id
      and (s.user_id = auth.uid() or public.is_guardian_of(s.id))));

drop policy if exists hw_subs_staff on public.homework_submissions;
create policy hw_subs_staff on public.homework_submissions for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists hw_subs_family on public.homework_submissions;
create policy hw_subs_family on public.homework_submissions for select using (
  tenant_id = public.my_tenant_id() and (public.is_student_self(student_id) or public.is_guardian_of(student_id)));
-- Students submit through the API (service role) so lateness and marks cannot be forged.

-- Health: nurse and admins manage, form/subject teachers read (allergies matter in class), family reads.
drop policy if exists medical_read on public.medical_profiles;
create policy medical_read on public.medical_profiles for select using (
  tenant_id = public.my_tenant_id() and (public.has_role(array['nurse','school_admin','principal','platform_admin','hostel_warden'])
    or public.teaches_student(student_id) or public.is_guardian_of(student_id)));
drop policy if exists medical_write on public.medical_profiles;
create policy medical_write on public.medical_profiles for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['nurse','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['nurse','school_admin','principal','platform_admin']));
drop policy if exists medical_guardian_update on public.medical_profiles;
create policy medical_guardian_update on public.medical_profiles for update using (
  tenant_id = public.my_tenant_id() and public.is_guardian_of(student_id))
  with check (tenant_id = public.my_tenant_id() and public.is_guardian_of(student_id));

drop policy if exists sickbay_read on public.sickbay_visits;
create policy sickbay_read on public.sickbay_visits for select using (
  tenant_id = public.my_tenant_id() and (public.has_role(array['nurse','school_admin','principal','platform_admin','hostel_warden'])
    or public.is_guardian_of(student_id)));
drop policy if exists sickbay_write on public.sickbay_visits;
create policy sickbay_write on public.sickbay_visits for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['nurse','school_admin','principal','platform_admin','hostel_warden'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['nurse','school_admin','principal','platform_admin','hostel_warden']));

-- Events: whole school reads; admins write. Responses via API (parents) with family read.
drop policy if exists events_read on public.school_events;
create policy events_read on public.school_events for select using (tenant_id = public.my_tenant_id());
drop policy if exists events_write on public.school_events;
create policy events_write on public.school_events for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
drop policy if exists event_responses_read on public.event_responses;
create policy event_responses_read on public.event_responses for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id)));

-- Meetings: teachers manage their own slots; staff see all; parents book through the API.
drop policy if exists slots_staff_read on public.consultation_slots;
create policy slots_staff_read on public.consultation_slots for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists slots_own on public.consultation_slots;
create policy slots_own on public.consultation_slots for all using (tenant_id = public.my_tenant_id() and staff_user_id = auth.uid())
  with check (tenant_id = public.my_tenant_id() and staff_user_id = auth.uid());

-- Traits: teachers of the student rate; staff read.
drop policy if exists trait_ratings_read on public.trait_ratings;
create policy trait_ratings_read on public.trait_ratings for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists trait_ratings_write on public.trait_ratings;
create policy trait_ratings_write on public.trait_ratings for all using (
  tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.teaches_student(student_id))
) with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.teaches_student(student_id)));

-- Lesson notes: authors manage own drafts; reviewers read all and approve.
drop policy if exists lesson_notes_read on public.lesson_notes;
create policy lesson_notes_read on public.lesson_notes for select using (
  tenant_id = public.my_tenant_id() and (author_id = auth.uid() or public.has_role(array['school_admin','principal','qa_officer','platform_admin'])));
drop policy if exists lesson_notes_insert on public.lesson_notes;
create policy lesson_notes_insert on public.lesson_notes for insert with check (
  tenant_id = public.my_tenant_id() and author_id = auth.uid() and public.is_staff() and status in ('draft','submitted'));
drop policy if exists lesson_notes_update on public.lesson_notes;
create policy lesson_notes_update on public.lesson_notes for update using (
  tenant_id = public.my_tenant_id() and (author_id = auth.uid() or public.has_role(array['school_admin','principal','qa_officer','platform_admin'])))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists lesson_notes_delete on public.lesson_notes;
create policy lesson_notes_delete on public.lesson_notes for delete using (
  tenant_id = public.my_tenant_id() and author_id = auth.uid() and status in ('draft','returned'));

-- Interventions: staff only.
drop policy if exists interventions_rw on public.student_interventions;
create policy interventions_rw on public.student_interventions for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());
