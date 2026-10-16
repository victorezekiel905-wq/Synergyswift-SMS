-- =====================================================================
--  Phase 11a: student welfare and pastoral care.
--
--  * Counselling: cases and session notes seen only by counsellors (and the
--    safeguarding team when the counsellor shares a case); teachers refer
--    students without seeing the notes; every opening of a record is logged.
--  * Safeguarding: concerns reported by any staff member, a chronology that is
--    never edited, acknowledgement, escalation to the head if nobody picks a
--    concern up in time, external referrals.
--  * Behaviour: incidents with everyone involved, detention sessions and
--    detentions served or missed.
--  * Health: allergy severity and care plans, clinic vitals and follow-up,
--    medication plans with a dose log, immunisations.
--  * Wellbeing: student check-ins (mood, feelings, "I'd like to talk"), named
--    or anonymous, followed up by the form teacher or a counsellor.
--  None of the confidential records go into the change history.
-- =====================================================================

-- ---------- Helpers ----------
create or replace function public.is_counsellor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['counsellor']);
$$;
grant execute on function public.is_counsellor() to authenticated;

create or replace function public.is_form_teacher_of(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s join public.class_groups g on g.id = s.class_group_id
                 where s.id = p_student and s.tenant_id = public.my_tenant_id() and g.form_teacher_id = auth.uid());
$$;
grant execute on function public.is_form_teacher_of(uuid) to authenticated;

-- Opening a confidential record is logged (who, what, when).
create table if not exists public.sensitive_access_log (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid references public.users(id) on delete set null,
  record_kind  text not null,
  record_id    uuid not null,
  student_id   uuid references public.students(id) on delete cascade,
  at           timestamptz not null default now()
);
create index if not exists sensitive_access_record on public.sensitive_access_log(record_kind, record_id, at desc);

-- ---------- Counselling ----------
create table if not exists public.pastoral_referrals (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  referred_by  uuid references public.users(id) on delete set null,
  reason       text not null check (length(trim(reason)) between 3 and 2000),
  urgency      text not null default 'routine' check (urgency in ('routine','soon','urgent')),
  status       text not null default 'new' check (status in ('new','accepted','declined')),
  case_id      uuid,
  decided_by   uuid references public.users(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create table if not exists public.counselling_cases (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  student_id       uuid not null references public.students(id) on delete cascade,
  counsellor_id    uuid references public.users(id) on delete set null,
  source           text not null default 'self' check (source in ('self','teacher','parent','safeguarding','other')),
  category         text not null default 'emotional' check (category in ('academic','emotional','family','peer','bereavement','behaviour','career','health','other')),
  summary          text,
  risk_level       text not null default 'low' check (risk_level in ('low','medium','high')),
  shared_with_dsl  boolean not null default false,     -- the safeguarding team may read it
  status           text not null default 'open' check (status in ('open','closed')),
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  created_by       uuid references public.users(id) on delete set null
);
alter table public.pastoral_referrals drop constraint if exists pastoral_referrals_case_fk;
alter table public.pastoral_referrals add constraint pastoral_referrals_case_fk foreign key (case_id) references public.counselling_cases(id) on delete set null;
create table if not exists public.counselling_sessions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  case_id          uuid not null references public.counselling_cases(id) on delete cascade,
  held_at          timestamptz not null default now(),
  duration_min     int check (duration_min between 1 and 480),
  mode             text not null default 'in_person' check (mode in ('in_person','group','phone','online')),
  notes            text,
  actions          text,
  next_session_at  timestamptz,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create or replace function public.can_read_counselling(p_case uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.counselling_cases c where c.id = p_case and c.tenant_id = public.my_tenant_id()
                 and (public.is_counsellor() or c.counsellor_id = auth.uid() or (c.shared_with_dsl and public.is_safeguarding_lead())));
$$;
grant execute on function public.can_read_counselling(uuid) to authenticated;

-- Session notes are kept as written: the author may correct them on the day, then they are fixed.
create or replace function public.counselling_session_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); return new; end if;
  if old.created_by is distinct from auth.uid() or old.created_at < now() - interval '24 hours' then
    raise exception 'session notes can only be corrected by their author on the day; add a new note instead';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists counselling_session_guard on public.counselling_sessions;
create trigger counselling_session_guard before insert or update or delete on public.counselling_sessions for each row execute function public.counselling_session_guard();

-- ---------- Safeguarding ----------
create table if not exists public.safeguarding_concerns (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  student_id         uuid not null references public.students(id) on delete cascade,
  reported_by        uuid references public.users(id) on delete set null,
  category           text not null check (category in ('physical','emotional','sexual','neglect','online','self_harm','bullying','exploitation','radicalisation','fgm','domestic','other')),
  severity           text not null default 'medium' check (severity in ('low','medium','high','critical')),
  description        text not null check (length(trim(description)) >= 10),
  observed_at        timestamptz not null default now(),
  location           text,
  immediate_action   text,
  status             text not null default 'new' check (status in ('new','acknowledged','investigating','referred','monitoring','closed')),
  assigned_to        uuid references public.users(id) on delete set null,
  acknowledged_at    timestamptz,
  escalated_at       timestamptz,
  external_agency    text,
  external_ref       text,
  parents_informed   text check (parents_informed in ('yes','no','not_appropriate')),
  outcome            text,
  closed_at          timestamptz,
  source_ref         text,              -- e.g. a flagged message the concern came from
  created_at         timestamptz not null default now()
);
create index if not exists safeguarding_open on public.safeguarding_concerns(tenant_id, status, created_at);
create table if not exists public.safeguarding_actions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  concern_id  uuid not null references public.safeguarding_concerns(id) on delete cascade,
  kind        text not null check (kind in ('note','acknowledged','assigned','status','contacted_parent','referred','meeting','escalated')),
  detail      text not null,
  by_user     uuid references public.users(id) on delete set null,
  at          timestamptz not null default now()
);
create index if not exists safeguarding_actions_concern on public.safeguarding_actions(concern_id, at);

-- The chronology is written once and never changed.
create or replace function public.safeguarding_action_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.by_user := auth.uid(); new.at := now(); end if;
    return new;
  end if;
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  raise exception 'the safeguarding chronology cannot be changed; add a new entry';
end $$;
drop trigger if exists safeguarding_action_guard on public.safeguarding_actions;
create trigger safeguarding_action_guard before insert or update or delete on public.safeguarding_actions for each row execute function public.safeguarding_action_guard();

-- Reporters write the concern; the safeguarding team manages it. Each change goes into the chronology.
create or replace function public.safeguarding_concern_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.reported_by := auth.uid(); new.status := 'new'; new.acknowledged_at := null; new.escalated_at := null; new.closed_at := null; new.assigned_to := null;
    end if;
    return new;
  end if;
  if auth.uid() is null then return new; end if;
  if not public.is_safeguarding_lead() then raise exception 'only the safeguarding team can update a concern'; end if;
  if new.description is distinct from old.description or new.student_id is distinct from old.student_id or new.reported_by is distinct from old.reported_by then
    raise exception 'the original report is kept as written; add a note instead';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'new' and new.acknowledged_at is null then new.acknowledged_at := now(); end if;
    if new.status = 'closed' then
      if coalesce(trim(new.outcome), '') = '' then raise exception 'record the outcome before closing'; end if;
      new.closed_at := now();
    else new.closed_at := null; end if;
    insert into public.safeguarding_actions (tenant_id, concern_id, kind, detail) values (new.tenant_id, new.id, 'status', old.status || ' → ' || new.status);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.safeguarding_actions (tenant_id, concern_id, kind, detail)
      values (new.tenant_id, new.id, 'assigned', coalesce((select full_name from public.users where id = new.assigned_to), 'nobody'));
  end if;
  if new.external_agency is distinct from old.external_agency and new.external_agency is not null then
    insert into public.safeguarding_actions (tenant_id, concern_id, kind, detail) values (new.tenant_id, new.id, 'referred', new.external_agency || coalesce(' (' || new.external_ref || ')', ''));
  end if;
  return new;
end $$;
drop trigger if exists safeguarding_concern_guard on public.safeguarding_concerns;
create trigger safeguarding_concern_guard before insert or update on public.safeguarding_concerns for each row execute function public.safeguarding_concern_guard();
alter table public.tenant_settings add column if not exists safeguarding_escalate_hours int not null default 4 check (safeguarding_escalate_hours between 1 and 72);

-- ---------- Behaviour: incidents and detentions ----------
create table if not exists public.behaviour_incidents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  occurred_at  timestamptz not null default now(),
  location     text,
  category_id  uuid references public.behaviour_categories(id) on delete set null,
  severity     text not null default 'minor' check (severity in ('minor','moderate','serious')),
  description  text not null check (length(trim(description)) between 3 and 4000),
  action_taken text,
  status       text not null default 'open' check (status in ('open','resolved')),
  outcome      text,
  reported_by  uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create table if not exists public.behaviour_incident_students (
  incident_id         uuid not null references public.behaviour_incidents(id) on delete cascade,
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  student_id          uuid not null references public.students(id) on delete cascade,
  role                text not null default 'involved' check (role in ('responsible','involved','affected','witness')),
  behaviour_record_id uuid references public.behaviour_records(id) on delete set null,
  primary key (incident_id, student_id)
);
create table if not exists public.detention_sessions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  kind           text not null default 'detention' check (kind in ('detention','isolation','community_service')),
  starts_at      timestamptz not null,
  duration_min   int not null default 45 check (duration_min between 5 and 480),
  location       text,
  supervisor_id  uuid references public.users(id) on delete set null,
  capacity       int check (capacity between 1 and 500),
  created_at     timestamptz not null default now()
);
create table if not exists public.detentions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  student_id          uuid not null references public.students(id) on delete cascade,
  session_id          uuid references public.detention_sessions(id) on delete set null,
  reason              text not null,
  incident_id         uuid references public.behaviour_incidents(id) on delete set null,
  behaviour_action_id uuid references public.behaviour_actions(id) on delete set null,
  status              text not null default 'scheduled' check (status in ('scheduled','served','missed','cancelled')),
  set_by              uuid references public.users(id) on delete set null,
  marked_by           uuid references public.users(id) on delete set null,
  parent_notified_at  timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists detentions_session on public.detentions(session_id);
create index if not exists detentions_student on public.detentions(student_id, created_at desc);

-- ---------- Health ----------
alter table public.medical_profiles add column if not exists allergy_severity text check (allergy_severity in ('none','mild','moderate','severe','anaphylaxis'));
alter table public.medical_profiles add column if not exists has_epipen boolean not null default false;
alter table public.medical_profiles add column if not exists care_plan text;
alter table public.sickbay_visits add column if not exists pulse int check (pulse between 20 and 250);
alter table public.sickbay_visits add column if not exists blood_pressure text;
alter table public.sickbay_visits add column if not exists follow_up_on date;
alter table public.sickbay_visits add column if not exists left_at timestamptz;

create table if not exists public.medication_plans (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  medicine        text not null check (length(trim(medicine)) between 1 and 120),
  dose            text not null,
  route           text not null default 'oral',
  times           text[] not null default '{}',          -- e.g. {'08:00','13:00'}; empty = when needed
  as_needed       boolean not null default false,
  starts_on       date not null default current_date,
  ends_on         date,
  instructions    text,
  parent_consent  boolean not null default false,
  stock_note      text,
  active          boolean not null default true,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create table if not exists public.medication_doses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  plan_id     uuid references public.medication_plans(id) on delete set null,
  medicine    text not null,
  dose        text not null,
  status      text not null default 'given' check (status in ('given','refused','missed','not_available')),
  note        text,
  given_by    uuid references public.users(id) on delete set null,
  given_at    timestamptz not null default now()
);
create index if not exists medication_doses_student on public.medication_doses(student_id, given_at desc);
create table if not exists public.immunisations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  vaccine      text not null check (length(trim(vaccine)) between 1 and 80),
  dose_no      int check (dose_no between 1 and 10),
  given_on     date,
  provider     text,
  batch_no     text,
  next_due_on  date,
  recorded_by  uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists immunisations_student on public.immunisations(student_id);

-- The dose log is a record: written once by the person who gave it.
create or replace function public.medication_dose_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.given_by := auth.uid(); end if;
    return new;
  end if;
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  raise exception 'the medication log cannot be changed; record a correction';
end $$;
drop trigger if exists medication_dose_guard on public.medication_doses;
create trigger medication_dose_guard before insert or update or delete on public.medication_doses for each row execute function public.medication_dose_guard();

-- ---------- Wellbeing ----------
create table if not exists public.wellbeing_checkins (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  student_id        uuid references public.students(id) on delete cascade,     -- null when anonymous
  class_group_id    uuid references public.class_groups(id) on delete set null,
  mood              smallint not null check (mood between 1 and 5),
  feelings          text[] not null default '{}',
  note              text,
  wants_to_talk     boolean not null default false,
  check (not (wants_to_talk and student_id is null)),
  followed_up_by    uuid references public.users(id) on delete set null,
  followed_up_at    timestamptz,
  follow_up_note    text,
  created_at        timestamptz not null default now()
);
create index if not exists wellbeing_class_day on public.wellbeing_checkins(tenant_id, class_group_id, created_at desc);
create index if not exists wellbeing_student on public.wellbeing_checkins(student_id, created_at desc);
alter table public.tenant_settings add column if not exists wellbeing_checkins boolean not null default false;
alter table public.tenant_settings add column if not exists wellbeing_anonymous boolean not null default false;

-- ---------- RLS ----------
alter table public.sensitive_access_log enable row level security;
drop policy if exists sensitive_access_read on public.sensitive_access_log;
create policy sensitive_access_read on public.sensitive_access_log for select using (tenant_id = public.my_tenant_id() and (public.is_safeguarding_lead() or public.is_counsellor()));
-- written by the server only

alter table public.pastoral_referrals enable row level security;
drop policy if exists referrals_read on public.pastoral_referrals;
create policy referrals_read on public.pastoral_referrals for select using (tenant_id = public.my_tenant_id() and (public.is_counsellor() or public.is_safeguarding_lead() or referred_by = auth.uid()));
drop policy if exists referrals_insert on public.pastoral_referrals;
create policy referrals_insert on public.pastoral_referrals for insert with check (tenant_id = public.my_tenant_id() and public.is_staff() and referred_by = auth.uid() and status = 'new');
drop policy if exists referrals_update on public.pastoral_referrals;
create policy referrals_update on public.pastoral_referrals for update using (tenant_id = public.my_tenant_id() and public.is_counsellor()) with check (tenant_id = public.my_tenant_id());

alter table public.counselling_cases enable row level security;
drop policy if exists counselling_cases_read on public.counselling_cases;
create policy counselling_cases_read on public.counselling_cases for select using (tenant_id = public.my_tenant_id() and public.can_read_counselling(id));
drop policy if exists counselling_cases_write on public.counselling_cases;
create policy counselling_cases_write on public.counselling_cases for all using (tenant_id = public.my_tenant_id() and public.is_counsellor())
  with check (tenant_id = public.my_tenant_id() and public.is_counsellor());

alter table public.counselling_sessions enable row level security;
drop policy if exists counselling_sessions_read on public.counselling_sessions;
create policy counselling_sessions_read on public.counselling_sessions for select using (tenant_id = public.my_tenant_id() and public.can_read_counselling(case_id));
drop policy if exists counselling_sessions_write on public.counselling_sessions;
create policy counselling_sessions_write on public.counselling_sessions for all using (tenant_id = public.my_tenant_id() and public.is_counsellor())
  with check (tenant_id = public.my_tenant_id() and public.is_counsellor());

alter table public.safeguarding_concerns enable row level security;
drop policy if exists safeguarding_read on public.safeguarding_concerns;
create policy safeguarding_read on public.safeguarding_concerns for select using (tenant_id = public.my_tenant_id() and (public.is_safeguarding_lead() or reported_by = auth.uid()));
drop policy if exists safeguarding_insert on public.safeguarding_concerns;
create policy safeguarding_insert on public.safeguarding_concerns for insert with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists safeguarding_update on public.safeguarding_concerns;
create policy safeguarding_update on public.safeguarding_concerns for update using (tenant_id = public.my_tenant_id() and public.is_safeguarding_lead()) with check (tenant_id = public.my_tenant_id());

alter table public.safeguarding_actions enable row level security;
drop policy if exists safeguarding_actions_read on public.safeguarding_actions;
create policy safeguarding_actions_read on public.safeguarding_actions for select using (tenant_id = public.my_tenant_id() and public.is_safeguarding_lead());
drop policy if exists safeguarding_actions_insert on public.safeguarding_actions;
create policy safeguarding_actions_insert on public.safeguarding_actions for insert with check (tenant_id = public.my_tenant_id() and public.is_safeguarding_lead());

alter table public.behaviour_incidents enable row level security;
drop policy if exists incidents_read on public.behaviour_incidents;
create policy incidents_read on public.behaviour_incidents for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists incidents_insert on public.behaviour_incidents;
create policy incidents_insert on public.behaviour_incidents for insert with check (tenant_id = public.my_tenant_id() and public.is_staff() and reported_by = auth.uid());
drop policy if exists incidents_update on public.behaviour_incidents;
create policy incidents_update on public.behaviour_incidents for update using (tenant_id = public.my_tenant_id() and (reported_by = auth.uid() or public.is_school_admin()))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists incidents_delete on public.behaviour_incidents;
create policy incidents_delete on public.behaviour_incidents for delete using (tenant_id = public.my_tenant_id() and public.is_school_admin());

alter table public.behaviour_incident_students enable row level security;
drop policy if exists incident_students_staff on public.behaviour_incident_students;
create policy incident_students_staff on public.behaviour_incident_students for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());

alter table public.detention_sessions enable row level security;
drop policy if exists detention_sessions_staff on public.detention_sessions;
create policy detention_sessions_staff on public.detention_sessions for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists detention_sessions_family on public.detention_sessions;
create policy detention_sessions_family on public.detention_sessions for select using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.detentions d where d.session_id = detention_sessions.id and (public.is_guardian_of(d.student_id) or public.is_student_self(d.student_id))));

alter table public.detentions enable row level security;
drop policy if exists detentions_staff on public.detentions;
create policy detentions_staff on public.detentions for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists detentions_family on public.detentions;
create policy detentions_family on public.detentions for select using (tenant_id = public.my_tenant_id() and (public.is_guardian_of(student_id) or public.is_student_self(student_id)));

-- Health records follow the medical profile: nurse and admins manage; wardens and counsellors read; families read their own.
do $$
declare t text;
begin
  foreach t in array array['medication_plans','medication_doses','immunisations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select using (tenant_id = public.my_tenant_id() and (public.has_role(array['nurse','school_admin','principal','platform_admin','hostel_warden','counsellor']) or public.is_guardian_of(student_id)))$p$, t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.has_role(array['nurse','school_admin','principal','platform_admin','hostel_warden'])) with check (tenant_id = public.my_tenant_id() and public.has_role(array['nurse','school_admin','principal','platform_admin','hostel_warden']))$p$, t || '_write', t);
  end loop;
end $$;

-- Check-ins come in through the server; the student reads their own; counsellors, the safeguarding team and the form teacher follow up.
alter table public.wellbeing_checkins enable row level security;
drop policy if exists wellbeing_read on public.wellbeing_checkins;
create policy wellbeing_read on public.wellbeing_checkins for select using (tenant_id = public.my_tenant_id()
  and (public.is_counsellor() or public.is_safeguarding_lead() or (student_id is not null and (public.is_student_self(student_id) or public.is_form_teacher_of(student_id)))));
drop policy if exists wellbeing_follow_up on public.wellbeing_checkins;
create policy wellbeing_follow_up on public.wellbeing_checkins for update using (tenant_id = public.my_tenant_id() and student_id is not null
  and (public.is_counsellor() or public.is_safeguarding_lead() or public.is_form_teacher_of(student_id))) with check (tenant_id = public.my_tenant_id());

create or replace function public.wellbeing_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.mood is distinct from old.mood or new.feelings is distinct from old.feelings or new.note is distinct from old.note or new.wants_to_talk is distinct from old.wants_to_talk
     or new.student_id is distinct from old.student_id then
    raise exception 'a check-in is kept as the student wrote it';
  end if;
  if new.followed_up_at is not null and old.followed_up_at is null then new.followed_up_by := auth.uid(); new.followed_up_at := now(); end if;
  return new;
end $$;
drop trigger if exists wellbeing_guard on public.wellbeing_checkins;
create trigger wellbeing_guard before update on public.wellbeing_checkins for each row execute function public.wellbeing_guard();

grant all on public.sensitive_access_log, public.pastoral_referrals, public.counselling_cases, public.counselling_sessions, public.safeguarding_concerns, public.safeguarding_actions,
  public.behaviour_incidents, public.behaviour_incident_students, public.detention_sessions, public.detentions, public.medication_plans, public.medication_doses, public.immunisations,
  public.wellbeing_checkins to service_role;

-- ---------- Change history: keep confidential records out ----------
create or replace function public.attach_change_log()
returns int language plpgsql security definer set search_path = public as $$
declare t text; n int := 0;
  skip text[] := array['data_changes','audit_logs','platform_audit_logs','message_outbox','exam_events','exam_attempts','practice_sessions',
        'browser_events','environment_events','screen_snapshots','student_presence','session_participants','raise_hands','rtc_rooms','rtc_peers','rtc_signals',
        'transport_live','push_subscriptions','doc_counters','lead_sequence_runs','access_grants','phone_login_codes','quiz_attempts','quiz_answers',
        'activity_responses','game_sessions','game_players','leaderboard_entries','conversation_messages','pickup_attempts','device_enrollments','devices',
        'teacher_commands','survey_invites','tenants',
        'learning_activity','content_attempts','xapi_statements','xapi_state','breakout_members','online_lesson_joins','tutor_messages','integration_secrets','online_lesson_hosts','admission_secrets',
        'calendar_feeds','notice_recipients','student_thread_messages',
        'sensitive_access_log','pastoral_referrals','counselling_cases','counselling_sessions','safeguarding_concerns','safeguarding_actions','wellbeing_checkins'];
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
