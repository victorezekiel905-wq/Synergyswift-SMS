-- =========================================================================
-- EduClass Fusion: student information system (phase 5).
--  * students: admission and leaving details (date admitted, previous
--    school, date left, how and why, destination school).
--  * student_movements: the enrolment history: admitted, promoted,
--    repeated, moved class, transferred in or out, withdrawn, graduated,
--    suspended, reinstated.
--  * student_documents: birth certificates, reports, medical and other
--    papers, stored privately; some may be shared with the family.
--  * sen_profiles, ieps, iep_targets, iep_reviews: special educational
--    needs, access arrangements (extra exam time and so on) and individual
--    education plans with targets and reviews.
--  * student_achievements and portfolio_items: awards, positions and
--    pieces of work.
--  * certificates: numbered, signed certificates (awards, transfer
--    certificates, testimonials) with a public verification link.
-- Apply AFTER 20260101003200. Idempotent.
-- =========================================================================

alter table public.students add column if not exists admitted_on date;
alter table public.students add column if not exists previous_school text;
alter table public.students add column if not exists left_on date;
alter table public.students add column if not exists leaving_kind text;
alter table public.students add column if not exists leaving_reason text;
alter table public.students add column if not exists destination_school text;
update public.students set admitted_on = created_at::date where admitted_on is null;
alter table public.students drop constraint if exists students_leaving_kind_check;
alter table public.students add constraint students_leaving_kind_check check (leaving_kind is null or leaving_kind in ('transferred','withdrawn','graduated','expelled','deceased','other'));

-- Who coordinates special educational needs (SENCO): admins, counsellors and named coordinators.
create or replace function public.is_sen_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['school_admin','principal','platform_admin','counsellor']);
$$;
grant execute on function public.is_sen_staff() to authenticated;

-- ---------- enrolment history ----------
create table if not exists public.student_movements (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  student_id          uuid not null references public.students(id) on delete cascade,
  kind                text not null check (kind in ('admitted','promoted','repeated','class_change','transferred_in','transferred_out','withdrawn','graduated','suspended','reinstated','expelled','other')),
  effective_on        date not null default current_date,
  from_class          text,
  to_class            text,
  session_name        text,
  school              text,                 -- previous school (transferred in) or destination (transferred out)
  reason              text,
  notes               text,
  recorded_by         uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists student_movements_student on public.student_movements(student_id, effective_on desc);
create index if not exists student_movements_kind on public.student_movements(tenant_id, kind, effective_on desc);

-- ---------- documents ----------
create table if not exists public.student_documents (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  student_id         uuid not null references public.students(id) on delete cascade,
  kind               text not null default 'other' check (kind in ('birth_certificate','passport_photo','previous_report','transfer_letter','medical','immunisation','id_document','court_order','sen_report','certificate','agreement','other')),
  name               text not null,
  path               text not null,
  size               int,
  content_type       text,
  notes              text,
  shared_with_family boolean not null default false,
  confidential       boolean not null default false,   -- court orders, SEN and medical reports: admins, counsellors and nurse only
  uploaded_by        uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists student_documents_student on public.student_documents(student_id, created_at desc);
insert into storage.buckets (id, name, public) values ('student-documents', 'student-documents', false) on conflict (id) do nothing;

-- ---------- SEN and IEPs ----------
create table if not exists public.sen_profiles (
  student_id          uuid primary key references public.students(id) on delete cascade,
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  status              text not null default 'monitoring' check (status in ('monitoring','sen_support','ehcp','closed')),
  areas               text[] not null default '{}',   -- cognition_learning, communication_interaction, semh, sensory_physical
  needs               text[] not null default '{}',   -- dyslexia, adhd, autism, hearing, visual …
  summary             text,
  strengths           text,
  strategies          text,                            -- what helps in class: shared with the child's teachers
  extra_time_pct      int not null default 0 check (extra_time_pct between 0 and 100),
  arrangements        text[] not null default '{}',   -- reader, scribe, rest_breaks, separate_room, enlarged_print, assistive_tech, prompter
  agencies            text,                            -- outside professionals involved
  coordinator_id      uuid references public.users(id) on delete set null,
  share_with_teachers boolean not null default true,
  updated_by          uuid references public.users(id) on delete set null,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create table if not exists public.ieps (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  student_id       uuid not null references public.students(id) on delete cascade,
  title            text not null default 'Individual education plan',
  starts_on        date not null default current_date,
  review_on        date,
  status           text not null default 'draft' check (status in ('draft','active','closed')),
  student_voice    text,                       -- what the child says helps
  parent_views     text,
  parent_agreed_at timestamptz,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ieps_student on public.ieps(student_id, starts_on desc);
create index if not exists ieps_review on public.ieps(tenant_id, review_on) where status = 'active';

create table if not exists public.iep_targets (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  iep_id            uuid not null references public.ieps(id) on delete cascade,
  area              text,
  target            text not null check (length(target) between 2 and 1000),
  strategies        text,
  success_criteria  text,
  owner_id          uuid references public.users(id) on delete set null,
  progress          text not null default 'not_started' check (progress in ('not_started','emerging','developing','secure','achieved')),
  notes             text,
  position          int not null default 0,
  updated_at        timestamptz not null default now()
);

create table if not exists public.iep_reviews (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  iep_id        uuid not null references public.ieps(id) on delete cascade,
  reviewed_on   date not null default current_date,
  summary       text not null,
  attendees     text,
  next_review   date,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------- achievements and portfolio ----------
create table if not exists public.student_achievements (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  student_id         uuid not null references public.students(id) on delete cascade,
  kind               text not null default 'academic' check (kind in ('academic','sports','arts','leadership','service','competition','attendance','character','other')),
  title              text not null check (length(title) between 2 and 160),
  description        text,
  level              text not null default 'school' check (level in ('class','school','local','state','national','international')),
  award              text,                  -- e.g. 1st place, Gold, Head Girl
  achieved_on        date not null default current_date,
  shared_with_family boolean not null default true,
  recorded_by        uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists student_achievements_student on public.student_achievements(student_id, achieved_on desc);

create table if not exists public.portfolio_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  title        text not null check (length(title) between 2 and 160),
  description  text,
  kind         text not null default 'work' check (kind in ('work','project','artwork','writing','photo','video','audio','other')),
  subject_id   uuid references public.subjects(id) on delete set null,
  path         text,                         -- file in student-documents storage
  content_type text,
  link_url     text,                         -- or a link (video, website)
  status       text not null default 'approved' check (status in ('submitted','approved','returned')),
  shared_with_family boolean not null default true,
  added_by     uuid references public.users(id) on delete set null,
  reviewed_by  uuid references public.users(id) on delete set null,
  feedback     text,
  created_at   timestamptz not null default now()
);
create index if not exists portfolio_items_student on public.portfolio_items(student_id, created_at desc);

-- ---------- certificates ----------
create table if not exists public.certificates (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  kind            text not null check (kind in ('award','transfer','testimonial','completion','attendance','participation','custom')),
  serial_no       text not null,
  title           text not null,
  body            text not null default '',
  data            jsonb not null default '{}'::jsonb,   -- the facts printed (snapshotted when issued)
  achievement_id  uuid references public.student_achievements(id) on delete set null,
  issued_on       date not null default current_date,
  signer_name     text,
  signer_title    text,
  status          text not null default 'issued' check (status in ('issued','revoked')),
  revoked_reason  text,
  revoked_at      timestamptz,
  signature       text,
  verify_token    text not null default encode(gen_random_bytes(16), 'hex'),
  shared_with_family boolean not null default true,
  issued_by       uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (tenant_id, serial_no),
  unique (verify_token)
);
create index if not exists certificates_student on public.certificates(student_id, issued_on desc);

-- ---------- RLS ----------
alter table public.student_movements enable row level security;
drop policy if exists student_movements_read on public.student_movements;
create policy student_movements_read on public.student_movements for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists student_movements_admin on public.student_movements;
create policy student_movements_admin on public.student_movements for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

-- Documents: staff see ordinary ones; confidential ones only admins, counsellors and the nurse. Families via the server.
alter table public.student_documents enable row level security;
drop policy if exists student_documents_read on public.student_documents;
create policy student_documents_read on public.student_documents for select using (
  tenant_id = public.my_tenant_id() and public.is_staff()
  and (not confidential or public.has_role(array['school_admin','principal','platform_admin','counsellor','nurse'])));
drop policy if exists student_documents_write on public.student_documents;
create policy student_documents_write on public.student_documents for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','it_admin','counsellor','nurse']))
  with check (tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','it_admin','counsellor','nurse']));

-- SEN: the SEN team manages; the named coordinator too; the child's teachers read the profile when it is shared with them.
alter table public.sen_profiles enable row level security;
drop policy if exists sen_profiles_team on public.sen_profiles;
create policy sen_profiles_team on public.sen_profiles for all using (
  tenant_id = public.my_tenant_id() and (public.is_sen_staff() or coordinator_id = auth.uid()))
  with check (tenant_id = public.my_tenant_id() and (public.is_sen_staff() or coordinator_id = auth.uid()));
drop policy if exists sen_profiles_teachers on public.sen_profiles;
create policy sen_profiles_teachers on public.sen_profiles for select using (
  tenant_id = public.my_tenant_id() and share_with_teachers and public.teaches_student(student_id));

create or replace function public.can_manage_sen(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_sen_staff() or exists (select 1 from public.sen_profiles where student_id = p_student and coordinator_id = auth.uid());
$$;
create or replace function public.can_read_sen(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_sen(p_student)
    or (public.teaches_student(p_student) and exists (select 1 from public.sen_profiles where student_id = p_student and share_with_teachers));
$$;
grant execute on function public.can_manage_sen(uuid), public.can_read_sen(uuid) to authenticated;

alter table public.ieps enable row level security;
drop policy if exists ieps_manage on public.ieps;
create policy ieps_manage on public.ieps for all using (tenant_id = public.my_tenant_id() and public.can_manage_sen(student_id))
  with check (tenant_id = public.my_tenant_id() and public.can_manage_sen(student_id));
drop policy if exists ieps_read on public.ieps;
create policy ieps_read on public.ieps for select using (tenant_id = public.my_tenant_id() and status <> 'draft' and public.can_read_sen(student_id));

do $$
declare t text;
begin
  foreach t in array array['iep_targets','iep_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_manage', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and exists (select 1 from public.ieps i where i.id = %I.iep_id and public.can_manage_sen(i.student_id))) with check (tenant_id = public.my_tenant_id() and exists (select 1 from public.ieps i where i.id = %I.iep_id and public.can_manage_sen(i.student_id)))', t || '_manage', t, t, t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.my_tenant_id() and exists (select 1 from public.ieps i where i.id = %I.iep_id and i.status <> %L and public.can_read_sen(i.student_id)))', t || '_read', t, t, 'draft');
  end loop;
end $$;
-- Teachers who own a target record progress on it.
drop policy if exists iep_targets_owner on public.iep_targets;
create policy iep_targets_owner on public.iep_targets for update using (tenant_id = public.my_tenant_id() and owner_id = auth.uid())
  with check (tenant_id = public.my_tenant_id() and owner_id = auth.uid());

-- Achievements: any staff member records; everyone on staff reads; families through the server.
alter table public.student_achievements enable row level security;
drop policy if exists student_achievements_read on public.student_achievements;
create policy student_achievements_read on public.student_achievements for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or (shared_with_family and (public.is_guardian_of(student_id) or public.is_student_self(student_id)))));
drop policy if exists student_achievements_write on public.student_achievements;
create policy student_achievements_write on public.student_achievements for insert with check (tenant_id = public.my_tenant_id() and public.is_staff() and recorded_by = auth.uid());
drop policy if exists student_achievements_edit on public.student_achievements;
create policy student_achievements_edit on public.student_achievements for update using (tenant_id = public.my_tenant_id() and (recorded_by = auth.uid() or public.is_school_admin()))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists student_achievements_delete on public.student_achievements;
create policy student_achievements_delete on public.student_achievements for delete using (tenant_id = public.my_tenant_id() and (recorded_by = auth.uid() or public.is_school_admin()));

-- Portfolio: staff manage; students see and add their own work through the server (it waits for a teacher).
alter table public.portfolio_items enable row level security;
drop policy if exists portfolio_staff on public.portfolio_items;
create policy portfolio_staff on public.portfolio_items for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists portfolio_own on public.portfolio_items;
create policy portfolio_own on public.portfolio_items for select using (tenant_id = public.my_tenant_id()
  and (public.is_student_self(student_id) or (status = 'approved' and shared_with_family and public.is_guardian_of(student_id))));

-- Certificates are numbered and signed by the server; staff read them, admins revoke through the server.
alter table public.certificates enable row level security;
drop policy if exists certificates_read on public.certificates;
create policy certificates_read on public.certificates for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or (shared_with_family and status = 'issued' and (public.is_guardian_of(student_id) or public.is_student_self(student_id)))));

grant all on public.student_movements, public.student_documents, public.sen_profiles, public.ieps, public.iep_targets, public.iep_reviews,
  public.student_achievements, public.portfolio_items, public.certificates to service_role;

-- Every new student starts their history with "admitted", however they were created.
alter table public.students alter column admitted_on set default current_date;
create or replace function public.student_admitted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.student_movements (tenant_id, student_id, kind, effective_on, to_class, school, recorded_by)
  values (new.tenant_id, new.id, 'admitted', coalesce(new.admitted_on, current_date),
          (select name from public.class_groups where id = new.class_group_id), new.previous_school, auth.uid());
  return new;
end $$;
drop trigger if exists students_admitted on public.students;
create trigger students_admitted after insert on public.students for each row execute function public.student_admitted();
-- Students who were here before the history began.
insert into public.student_movements (tenant_id, student_id, kind, effective_on, to_class, notes)
select s.tenant_id, s.id, 'admitted', coalesce(s.admitted_on, s.created_at::date), c.name, 'Recorded when the enrolment history began'
from public.students s left join public.class_groups c on c.id = s.class_group_id
where not exists (select 1 from public.student_movements m where m.student_id = s.id);
