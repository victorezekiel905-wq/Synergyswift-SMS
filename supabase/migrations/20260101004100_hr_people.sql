-- =====================================================================
--  Phase 10a: people.
--
--  * Staff records: line manager, personal and statutory details (NIN, TIN,
--    pension RSA PIN, NHF number, next of kin), documents, contracts and
--    qualifications (with expiry, e.g. TRCN licences).
--  * Recruitment: job postings on a public careers page, applications with
--    CVs, stages, interviews with a panel and each panellist's scores.
--  * Onboarding and offboarding checklists, ticked by whoever owns each item.
--  * Leave: policies per type (days, paid, carry-over), half days, the line
--    manager's recommendation before HR decides, a supporting document, and
--    approved leave feeding the cover planner.
-- =====================================================================

-- ---------- Helpers ----------
create or replace function public.is_hr()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['hr_manager','school_admin','principal','platform_admin']);
$$;
grant execute on function public.is_hr() to authenticated;

create or replace function public.my_staff_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.staff where user_id = auth.uid() and tenant_id = public.my_tenant_id() limit 1;
$$;
grant execute on function public.my_staff_id() to authenticated;

-- ---------- Staff records ----------
alter table public.staff add column if not exists line_manager_id uuid references public.staff(id) on delete set null;
alter table public.staff add column if not exists probation_ends_on date;
alter table public.staff add column if not exists exit_date date;
alter table public.staff add column if not exists exit_reason text;

-- The signed-in user is this staff member's line manager.
create or replace function public.manages_staff(p_staff uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s join public.staff m on m.id = s.line_manager_id
                 where s.id = p_staff and s.tenant_id = public.my_tenant_id() and m.user_id = auth.uid());
$$;
grant execute on function public.manages_staff(uuid) to authenticated;

create table if not exists public.staff_personal (
  staff_id                uuid primary key references public.staff(id) on delete cascade,
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  date_of_birth           date,
  gender                  text check (gender in ('female','male','other')),
  marital_status          text,
  address                 text,
  state_of_origin         text,
  nationality             text,
  nin                     text check (nin ~ '^\d{11}$'),             -- National Identification Number
  tin                     text,                                      -- tax ID for PAYE
  pfa_name                text,                                      -- pension fund administrator
  rsa_pin                 text check (rsa_pin ~* '^PEN\d{12}$'),     -- retirement savings account PIN
  nhf_number              text,                                      -- National Housing Fund
  next_of_kin_name        text,
  next_of_kin_relation    text,
  next_of_kin_phone       text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  medical_notes           text,
  updated_at              timestamptz not null default now()
);

create table if not exists public.staff_documents (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  staff_id          uuid not null references public.staff(id) on delete cascade,
  kind              text not null check (kind in ('cv','id','offer_letter','contract','certificate','reference','medical','appraisal','exit','other')),
  title             text not null check (length(trim(title)) between 1 and 160),
  path              text not null,
  mime              text,
  size_bytes        int,
  visible_to_staff  boolean not null default true,     -- e.g. references stay with HR
  uploaded_by       uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists staff_documents_staff on public.staff_documents(staff_id);
insert into storage.buckets (id, name, public) values ('staff-documents', 'staff-documents', false) on conflict (id) do nothing;

create table if not exists public.staff_contracts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  staff_id           uuid not null references public.staff(id) on delete cascade,
  kind               text not null check (kind in ('permanent','fixed_term','probation','part_time','consultancy','internship')),
  position           text,
  starts_on          date not null,
  ends_on            date,
  probation_ends_on  date,
  notice_days        int check (notice_days between 0 and 365),
  salary_note        text,
  notes              text,
  document_id        uuid references public.staff_documents(id) on delete set null,
  status             text not null default 'active' check (status in ('draft','active','ended')),
  accepted_at        timestamptz,             -- the staff member accepted it in their portal
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists staff_contracts_staff on public.staff_contracts(staff_id, starts_on desc);

create table if not exists public.staff_qualifications (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  staff_id      uuid not null references public.staff(id) on delete cascade,
  kind          text not null check (kind in ('degree','diploma','certificate','professional','licence','other')),
  title         text not null check (length(trim(title)) between 1 and 160),
  institution   text,
  awarded_on    date,
  expires_on    date,
  reference_no  text,                    -- e.g. TRCN registration number
  document_id   uuid references public.staff_documents(id) on delete set null,
  verified_by   uuid references public.users(id) on delete set null,
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists staff_qualifications_staff on public.staff_qualifications(staff_id);

-- Staff add their own qualifications; only HR verifies, and a verified one is HR's to change.
create or replace function public.staff_qualification_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if public.is_hr() then
    if tg_op = 'DELETE' then return old; end if;
    if tg_op = 'INSERT' then
      if new.verified_at is not null then new.verified_by := auth.uid(); new.verified_at := now(); end if;
    elsif new.verified_at is not null and old.verified_at is null then
      new.verified_by := auth.uid(); new.verified_at := now();
    elsif new.verified_at is null then
      new.verified_by := null;
    end if;
    return new;
  end if;
  if tg_op <> 'INSERT' and old.verified_at is not null then raise exception 'HR has verified this qualification; ask HR to change it'; end if;
  if tg_op = 'DELETE' then return old; end if;
  new.verified_by := null; new.verified_at := null;
  return new;
end $$;
drop trigger if exists staff_qualification_guard on public.staff_qualifications;
create trigger staff_qualification_guard before insert or update or delete on public.staff_qualifications for each row execute function public.staff_qualification_guard();

-- ---------- Recruitment ----------
create table if not exists public.job_postings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  title            text not null check (length(trim(title)) between 2 and 160),
  department       text,
  employment_type  text not null default 'full_time' check (employment_type in ('full_time','part_time','contract','volunteer')),
  location         text,
  description      text not null default '',
  requirements     text,
  salary_range     text,
  positions        int not null default 1 check (positions between 1 and 100),
  closes_on        date,
  status           text not null default 'draft' check (status in ('draft','open','closed','filled')),
  internal_only    boolean not null default false,
  token            text not null default encode(gen_random_bytes(9), 'hex'),
  created_by       uuid references public.users(id) on delete set null,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  unique (token)
);

create table if not exists public.job_applications (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  posting_id        uuid not null references public.job_postings(id) on delete cascade,
  full_name         text not null,
  email             text not null,
  phone             text,
  cover_letter      text,
  cv_path           text,
  answers           jsonb not null default '{}'::jsonb,
  source            text,
  internal_staff_id uuid references public.staff(id) on delete set null,   -- a current member of staff applying
  stage             text not null default 'applied' check (stage in ('applied','shortlisted','interview','offer','hired','rejected','withdrawn')),
  rating            smallint check (rating between 1 and 5),
  notes             text,
  track_token       text not null default encode(gen_random_bytes(18), 'hex'),
  hired_staff_id    uuid references public.staff(id) on delete set null,
  stage_changed_at  timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (track_token)
);
create unique index if not exists job_applications_once on public.job_applications(posting_id, lower(email));
create index if not exists job_applications_stage on public.job_applications(tenant_id, stage);
insert into storage.buckets (id, name, public) values ('job-applications', 'job-applications', false) on conflict (id) do nothing;

create table if not exists public.job_interviews (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  application_id  uuid not null references public.job_applications(id) on delete cascade,
  scheduled_at    timestamptz not null,
  duration_min    int not null default 30 check (duration_min between 5 and 480),
  mode            text not null default 'in_person' check (mode in ('in_person','phone','video')),
  location        text,                 -- a room, or the video link
  panel           uuid[] not null default '{}',
  status          text not null default 'scheduled' check (status in ('scheduled','done','cancelled','no_show')),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists job_interviews_app on public.job_interviews(application_id);

create table if not exists public.interview_scores (
  interview_id    uuid not null references public.job_interviews(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  panelist_id     uuid not null references public.users(id) on delete cascade,
  score           smallint not null check (score between 1 and 5),
  recommendation  text not null check (recommendation in ('hire','maybe','no')),
  comments        text,
  created_at      timestamptz not null default now(),
  primary key (interview_id, panelist_id)
);

create or replace function public.on_interview_panel(p_application uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.job_interviews i where i.application_id = p_application
                 and i.tenant_id = public.my_tenant_id() and auth.uid() = any(i.panel));
$$;
grant execute on function public.on_interview_panel(uuid) to authenticated;

create or replace function public.interview_score_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not exists (select 1 from public.job_interviews i where i.id = new.interview_id and i.tenant_id = new.tenant_id and auth.uid() = any(i.panel)) then
    raise exception 'only members of the interview panel can score it';
  end if;
  new.panelist_id := auth.uid();
  return new;
end $$;
drop trigger if exists interview_score_guard on public.interview_scores;
create trigger interview_score_guard before insert or update on public.interview_scores for each row execute function public.interview_score_guard();

-- ---------- Onboarding and offboarding ----------
create table if not exists public.hr_checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null check (kind in ('onboarding','offboarding')),
  name        text not null check (length(trim(name)) between 1 and 120),
  items       jsonb not null default '[]'::jsonb,     -- [{ "label": "…", "owner": "hr_manager", "due_days": 3 }]
  created_at  timestamptz not null default now(),
  unique (tenant_id, kind, name)
);
create table if not exists public.staff_checklists (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  staff_id      uuid not null references public.staff(id) on delete cascade,
  kind          text not null check (kind in ('onboarding','offboarding')),
  name          text not null,
  started_on    date not null default current_date,
  completed_at  timestamptz,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists staff_checklists_staff on public.staff_checklists(staff_id);
create table if not exists public.staff_checklist_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  checklist_id  uuid not null references public.staff_checklists(id) on delete cascade,
  position      int not null default 0,
  label         text not null check (length(trim(label)) between 1 and 200),
  owner         text not null default 'hr_manager',    -- a role, 'staff' (the person themselves) or 'line_manager'
  due_on        date,
  done_at       timestamptz,
  done_by       uuid references public.users(id) on delete set null,
  note          text
);
create index if not exists staff_checklist_items_list on public.staff_checklist_items(checklist_id, position);

-- Who may tick an item: HR, anyone holding the owner role, the person themselves for 'staff', their manager for 'line_manager'.
create or replace function public.can_tick_item(p_checklist uuid, p_owner text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_hr()
    or (p_owner not in ('staff','line_manager') and public.has_role(array[p_owner]))
    or exists (select 1 from public.staff_checklists c join public.staff s on s.id = c.staff_id
               where c.id = p_checklist and c.tenant_id = public.my_tenant_id()
                 and ((p_owner = 'staff' and s.user_id = auth.uid()) or (p_owner = 'line_manager' and public.manages_staff(s.id))));
$$;
grant execute on function public.can_tick_item(uuid, text) to authenticated;

create or replace function public.checklist_item_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' or tg_op = 'INSERT' then
    if not public.is_hr() then raise exception 'only HR can change a checklist'; end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not public.is_hr() and (new.label is distinct from old.label or new.owner is distinct from old.owner or new.due_on is distinct from old.due_on
      or new.position is distinct from old.position or new.checklist_id is distinct from old.checklist_id) then
    raise exception 'you can tick items and add a note, nothing else';
  end if;
  if new.done_at is not null and old.done_at is null then new.done_by := auth.uid(); new.done_at := now(); end if;
  if new.done_at is null then new.done_by := null; end if;
  return new;
end $$;
drop trigger if exists checklist_item_guard on public.staff_checklist_items;
create trigger checklist_item_guard before insert or update or delete on public.staff_checklist_items for each row execute function public.checklist_item_guard();

create or replace function public.checklist_completion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_list uuid;
begin
  if tg_op = 'DELETE' then v_list := old.checklist_id; else v_list := new.checklist_id; end if;
  update public.staff_checklists c set completed_at = case
      when exists (select 1 from public.staff_checklist_items i where i.checklist_id = c.id)
       and not exists (select 1 from public.staff_checklist_items i where i.checklist_id = c.id and i.done_at is null)
      then coalesce(c.completed_at, now()) else null end
    where c.id = v_list;
  return null;
end $$;
drop trigger if exists checklist_completion on public.staff_checklist_items;
create trigger checklist_completion after insert or update or delete on public.staff_checklist_items for each row execute function public.checklist_completion();

-- ---------- Leave ----------
create table if not exists public.leave_policies (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  leave_type      text not null check (leave_type in ('annual','sick','maternity','paternity','compassionate','study','unpaid','other')),
  days_per_year   numeric check (days_per_year is null or days_per_year between 0 and 366),   -- null = no yearly limit
  paid            boolean not null default true,
  carry_over_max  numeric not null default 0 check (carry_over_max between 0 and 366),
  needs_document  boolean not null default false,
  min_notice_days int not null default 0 check (min_notice_days between 0 and 365),
  primary key (tenant_id, leave_type)
);

alter table public.leave_requests alter column days type numeric using days::numeric;
alter table public.leave_requests drop constraint if exists leave_requests_days_check;
alter table public.leave_requests add constraint leave_requests_days_check check (days > 0 and days * 2 = round(days * 2));
alter table public.leave_requests add column if not exists half_day boolean not null default false;
alter table public.leave_requests add column if not exists document_id uuid references public.staff_documents(id) on delete set null;
alter table public.leave_requests add column if not exists cover_note text;
alter table public.leave_requests add column if not exists manager_status text check (manager_status in ('pending','recommended','not_recommended'));
alter table public.leave_requests add column if not exists manager_id uuid references public.users(id) on delete set null;
alter table public.leave_requests add column if not exists manager_note text;
alter table public.leave_requests add column if not exists manager_at timestamptz;
alter table public.staff_absences add column if not exists leave_request_id uuid references public.leave_requests(id) on delete cascade;
create unique index if not exists staff_absences_leave on public.staff_absences(leave_request_id) where leave_request_id is not null;

-- Line managers see and recommend their team's leave; HR decides; staff only cancel their own.
drop policy if exists leave_read on public.leave_requests;
create policy leave_read on public.leave_requests for select using (
  tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id() or public.manages_staff(staff_id)));
drop policy if exists leave_update on public.leave_requests;
create policy leave_update on public.leave_requests for update using (
  tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id() or public.manages_staff(staff_id))
) with check (tenant_id = public.my_tenant_id());

create or replace function public.leave_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_self boolean; v_manager boolean;
begin
  if auth.uid() is null then return new; end if;
  v_self := new.staff_id = public.my_staff_id();
  v_manager := public.manages_staff(new.staff_id);
  if new.staff_id is distinct from old.staff_id or new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on
     or new.days is distinct from old.days or new.leave_type is distinct from old.leave_type then
    if not public.is_hr() or v_self then raise exception 'the dates and type of a request cannot be changed; cancel it and ask again'; end if;
  end if;
  if new.status is distinct from old.status then
    if new.status in ('approved','rejected') then
      if not public.is_hr() then raise exception 'only HR or admins can decide leave'; end if;
      if v_self then raise exception 'you cannot decide your own leave'; end if;
      new.decided_by := auth.uid(); new.decided_at := now();
    elsif new.status = 'cancelled' then
      if not (v_self or public.is_hr()) then raise exception 'only the person on leave or HR can cancel it'; end if;
    else
      raise exception 'leave cannot go back to pending';
    end if;
  elsif not public.is_hr() and (new.decided_by is distinct from old.decided_by or new.decision_note is distinct from old.decision_note) then
    raise exception 'only HR records the decision';
  end if;
  if new.manager_status is distinct from old.manager_status or new.manager_note is distinct from old.manager_note then
    if v_self then raise exception 'you cannot recommend your own leave'; end if;
    if not (v_manager or public.is_hr()) then raise exception 'only the line manager can recommend leave'; end if;
    if old.status <> 'pending' then raise exception 'this request is already decided'; end if;
    new.manager_id := auth.uid(); new.manager_at := now();
  end if;
  if v_self and not public.is_hr() and not v_manager then
    if new.cover_note is distinct from old.cover_note or new.reason is distinct from old.reason or new.document_id is distinct from old.document_id then
      if old.status <> 'pending' then raise exception 'this request is already decided'; end if;
    end if;
  end if;
  return new;
end $$;

-- ---------- RLS ----------
alter table public.staff_personal enable row level security;
drop policy if exists staff_personal_read on public.staff_personal;
create policy staff_personal_read on public.staff_personal for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id()));
drop policy if exists staff_personal_write on public.staff_personal;
create policy staff_personal_write on public.staff_personal for all using (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id()))
  with check (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id()));

alter table public.staff_documents enable row level security;
drop policy if exists staff_documents_read on public.staff_documents;
create policy staff_documents_read on public.staff_documents for select using (tenant_id = public.my_tenant_id()
  and (public.is_hr() or (staff_id = public.my_staff_id() and visible_to_staff)));
drop policy if exists staff_documents_write on public.staff_documents;
create policy staff_documents_write on public.staff_documents for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());
-- Staff upload their own documents through the server, which checks the file and the kind.

alter table public.staff_contracts enable row level security;
drop policy if exists staff_contracts_read on public.staff_contracts;
create policy staff_contracts_read on public.staff_contracts for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or (staff_id = public.my_staff_id() and status <> 'draft')));
drop policy if exists staff_contracts_write on public.staff_contracts;
create policy staff_contracts_write on public.staff_contracts for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());

alter table public.staff_qualifications enable row level security;
drop policy if exists staff_qualifications_read on public.staff_qualifications;
create policy staff_qualifications_read on public.staff_qualifications for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id()));
drop policy if exists staff_qualifications_write on public.staff_qualifications;
create policy staff_qualifications_write on public.staff_qualifications for all using (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id()))
  with check (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id()));

alter table public.job_postings enable row level security;
drop policy if exists job_postings_read on public.job_postings;
create policy job_postings_read on public.job_postings for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or (public.is_staff() and status = 'open')));
drop policy if exists job_postings_write on public.job_postings;
create policy job_postings_write on public.job_postings for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());

-- Applications arrive through the careers page (server); HR manages them; the interview panel reads the ones it meets.
alter table public.job_applications enable row level security;
drop policy if exists job_applications_read on public.job_applications;
create policy job_applications_read on public.job_applications for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or public.on_interview_panel(id)));
drop policy if exists job_applications_write on public.job_applications;
create policy job_applications_write on public.job_applications for update using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());
drop policy if exists job_applications_delete on public.job_applications;
create policy job_applications_delete on public.job_applications for delete using (tenant_id = public.my_tenant_id() and public.is_hr());

alter table public.job_interviews enable row level security;
drop policy if exists job_interviews_read on public.job_interviews;
create policy job_interviews_read on public.job_interviews for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or auth.uid() = any(panel)));
drop policy if exists job_interviews_write on public.job_interviews;
create policy job_interviews_write on public.job_interviews for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());

-- Each panellist scores alone; HR sees every score.
alter table public.interview_scores enable row level security;
drop policy if exists interview_scores_read on public.interview_scores;
create policy interview_scores_read on public.interview_scores for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or panelist_id = auth.uid()));
drop policy if exists interview_scores_write on public.interview_scores;
create policy interview_scores_write on public.interview_scores for all using (tenant_id = public.my_tenant_id() and panelist_id = auth.uid())
  with check (tenant_id = public.my_tenant_id());

alter table public.hr_checklist_templates enable row level security;
drop policy if exists hr_templates_hr on public.hr_checklist_templates;
create policy hr_templates_hr on public.hr_checklist_templates for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());

-- A checklist is visible to HR, the person, their manager, and anyone with a task on it (checked as definer so the two tables' policies do not call each other).
create or replace function public.checklist_visible(p_checklist uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_hr() or exists (
    select 1 from public.staff_checklists c where c.id = p_checklist and c.tenant_id = public.my_tenant_id()
      and (c.staff_id = public.my_staff_id() or public.manages_staff(c.staff_id)
           or exists (select 1 from public.staff_checklist_items i where i.checklist_id = c.id and i.owner not in ('staff','line_manager') and public.has_role(array[i.owner]))));
$$;
grant execute on function public.checklist_visible(uuid) to authenticated;

alter table public.staff_checklists enable row level security;
drop policy if exists staff_checklists_read on public.staff_checklists;
create policy staff_checklists_read on public.staff_checklists for select using (tenant_id = public.my_tenant_id() and public.checklist_visible(id));
drop policy if exists staff_checklists_write on public.staff_checklists;
create policy staff_checklists_write on public.staff_checklists for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());

alter table public.staff_checklist_items enable row level security;
drop policy if exists checklist_items_read on public.staff_checklist_items;
create policy checklist_items_read on public.staff_checklist_items for select using (tenant_id = public.my_tenant_id() and public.checklist_visible(checklist_id));
drop policy if exists checklist_items_insert on public.staff_checklist_items;
create policy checklist_items_insert on public.staff_checklist_items for insert with check (tenant_id = public.my_tenant_id() and public.is_hr());
drop policy if exists checklist_items_update on public.staff_checklist_items;
create policy checklist_items_update on public.staff_checklist_items for update using (tenant_id = public.my_tenant_id() and public.can_tick_item(checklist_id, owner))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists checklist_items_delete on public.staff_checklist_items;
create policy checklist_items_delete on public.staff_checklist_items for delete using (tenant_id = public.my_tenant_id() and public.is_hr());

alter table public.leave_policies enable row level security;
drop policy if exists leave_policies_read on public.leave_policies;
create policy leave_policies_read on public.leave_policies for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists leave_policies_write on public.leave_policies;
create policy leave_policies_write on public.leave_policies for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());

grant all on public.staff_personal, public.staff_documents, public.staff_contracts, public.staff_qualifications, public.job_postings, public.job_applications,
  public.job_interviews, public.interview_scores, public.hr_checklist_templates, public.staff_checklists, public.staff_checklist_items, public.leave_policies to service_role;

select public.attach_change_log();
