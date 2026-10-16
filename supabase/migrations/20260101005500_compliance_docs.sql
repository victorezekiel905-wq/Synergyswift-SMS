-- =====================================================================
--  Phase 13f: compliance documents and inspection readiness.
--
--  * A document library for policies, certificates, inspection files,
--    minutes and risk assessments: versions, approval, review dates for
--    policies, expiry dates for certificates, who may see each, and
--    policies staff must read and confirm.
--  * The single central record: pre-employment and safeguarding checks on
--    every member of staff (identity, right to work, qualifications,
--    references, police checks, medical fitness, training) with dates.
--  * Inspection readiness: progress on each requirement of the frameworks
--    the school follows (MoE/SUBEB minimum standards, BSO, COBIS,
--    Cambridge centre), with owners, notes and the documents that show it.
-- =====================================================================

insert into storage.buckets (id, name, public) values ('school-documents', 'school-documents', false) on conflict (id) do nothing;

create table if not exists public.school_documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  family_id       uuid not null default gen_random_uuid(),     -- every version of the same document shares this
  version         int not null default 1 check (version >= 1),
  title           text not null check (length(trim(title)) between 2 and 200),
  category        text not null check (category in ('policy','certificate','inspection','minutes','risk_assessment','procedure','report','plan','other')),
  description     text,
  path            text,                                         -- private storage path (null for a link-only record)
  mime            text,
  size_bytes      int,
  visibility      text not null default 'staff' check (visibility in ('leaders','staff','parents')),
  status          text not null default 'draft' check (status in ('draft','approved','superseded','archived')),
  approved_by     uuid references public.users(id) on delete set null,
  approved_at     timestamptz,
  review_due_on   date,                                         -- policies: next review
  expires_on      date,                                         -- certificates: when it runs out
  issued_by       text,                                         -- e.g. Lagos State Fire Service
  reference_no    text,
  tags            text[] not null default '{}',
  requires_ack    boolean not null default false,               -- staff must confirm they have read it
  reminded_at     timestamptz,
  owner_id        uuid references public.users(id) on delete set null,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (family_id, version)
);
create index if not exists school_documents_tenant on public.school_documents(tenant_id, category, status);

-- Approving a new version retires the old one; approval is stamped.
create or replace function public.school_documents_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    new.approved_at := coalesce(new.approved_at, now());
    new.approved_by := coalesce(new.approved_by, auth.uid());
    update public.school_documents set status = 'superseded', updated_at = now()
      where family_id = new.family_id and id <> new.id and status = 'approved';
  end if;
  return new;
end $$;
drop trigger if exists school_documents_stamp on public.school_documents;
create trigger school_documents_stamp before insert or update on public.school_documents for each row execute function public.school_documents_stamp();

create or replace function public.can_see_document(p_visibility text, p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or public.has_role(array['qa_officer','hr_manager'])
    or (p_status = 'approved' and (p_visibility = 'staff' and public.is_staff() or p_visibility = 'parents' and (public.is_staff() or public.has_role(array['parent']))));
$$;
grant execute on function public.can_see_document(text, text) to authenticated;

alter table public.school_documents enable row level security;
drop policy if exists school_documents_read on public.school_documents;
create policy school_documents_read on public.school_documents for select using (tenant_id = public.my_tenant_id() and public.can_see_document(visibility, status));
drop policy if exists school_documents_write on public.school_documents;
create policy school_documents_write on public.school_documents for all
  using (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['qa_officer','hr_manager'])))
  with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['qa_officer','hr_manager'])));
grant all on public.school_documents to service_role;

create table if not exists public.document_acknowledgements (
  document_id      uuid not null references public.school_documents(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  acknowledged_at  timestamptz not null default now(),
  primary key (document_id, user_id)
);
alter table public.document_acknowledgements enable row level security;
drop policy if exists document_ack_read on public.document_acknowledgements;
create policy document_ack_read on public.document_acknowledgements for select
  using (tenant_id = public.my_tenant_id() and (user_id = auth.uid() or public.is_school_admin() or public.has_role(array['qa_officer','hr_manager'])));
drop policy if exists document_ack_insert on public.document_acknowledgements;
create policy document_ack_insert on public.document_acknowledgements for insert
  with check (tenant_id = public.my_tenant_id() and user_id = auth.uid() and public.is_staff()
    and exists (select 1 from public.school_documents d where d.id = document_id and d.tenant_id = public.my_tenant_id() and d.status = 'approved' and d.requires_ack));
grant all on public.document_acknowledgements to service_role;

-- ---------- Single central record ----------
create table if not exists public.staff_checks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  staff_id      uuid not null references public.staff(id) on delete cascade,
  kind          text not null check (kind in ('identity','right_to_work','qualifications','references','police_check','overseas_police_check',
                                               'prohibition_check','medical_fitness','safeguarding_training','first_aid_training','other')),
  outcome       text not null default 'clear' check (outcome in ('clear','concern','pending','not_required')),
  checked_on    date,
  expires_on    date,
  reference_no  text,
  checked_by    uuid references public.users(id) on delete set null,
  document_id   uuid references public.staff_documents(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  check (outcome = 'pending' or outcome = 'not_required' or checked_on is not null)
);
create index if not exists staff_checks_staff on public.staff_checks(staff_id, kind);
alter table public.staff_checks enable row level security;
drop policy if exists staff_checks_rw on public.staff_checks;
create policy staff_checks_rw on public.staff_checks for all
  using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());
drop policy if exists staff_checks_own on public.staff_checks;
create policy staff_checks_own on public.staff_checks for select using (tenant_id = public.my_tenant_id() and staff_id = public.my_staff_id());
grant all on public.staff_checks to service_role;

-- ---------- Inspection readiness ----------
create table if not exists public.inspection_progress (
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  framework        text not null check (framework ~ '^[a-z_]{2,30}$'),
  requirement_key  text not null check (requirement_key ~ '^[a-z0-9_.]{2,60}$'),
  status           text not null default 'not_started' check (status in ('not_started','in_progress','met','not_applicable')),
  owner_id         uuid references public.users(id) on delete set null,
  notes            text,
  document_ids     uuid[] not null default '{}',
  review_on        date,
  updated_by       uuid references public.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, framework, requirement_key)
);
alter table public.inspection_progress enable row level security;
drop policy if exists inspection_progress_read on public.inspection_progress;
create policy inspection_progress_read on public.inspection_progress for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists inspection_progress_write on public.inspection_progress;
create policy inspection_progress_write on public.inspection_progress for all
  using (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['qa_officer']) or owner_id = auth.uid()))
  with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['qa_officer']) or owner_id = auth.uid()));
grant all on public.inspection_progress to service_role;

alter table public.tenant_settings add column if not exists inspection_frameworks text[] not null default '{}';

select public.attach_change_log();
