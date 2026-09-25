-- =========================================================================
-- EduClass Fusion — school operations (v45)
-- Messaging outbox (email + WhatsApp), gate sign-in/out, pickup codes,
-- library, requisitions, HR leave, quality assurance.
-- Apply AFTER 20260101001200_sims_results.sql. Idempotent.
-- =========================================================================

-- ---------- Messaging outbox ----------
-- Every outbound email / WhatsApp is a row here first, so nothing is lost if a
-- provider is down: the dispatcher retries with backoff and records the result.
create table if not exists public.message_outbox (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  channel              text not null check (channel in ('email','whatsapp')),
  to_address           text not null,
  to_name              text,
  kind                 text not null,                 -- result | gate_in | gate_out | pickup_code | pickup_done | broadcast | library_overdue | invite
  subject              text,
  body_text            text not null,
  body_html            text,
  template_name        text,                          -- WhatsApp approved template
  template_params      jsonb not null default '[]'::jsonb,
  ref_id               uuid,
  status               text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts             int not null default 0,
  last_error           text,
  provider_message_id  text,
  next_attempt_at      timestamptz not null default now(),
  sent_at              timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now()
);
create index if not exists message_outbox_due on public.message_outbox(status, next_attempt_at);
create index if not exists message_outbox_tenant on public.message_outbox(tenant_id, created_at desc);

-- Atomically claim a batch of due messages (dispatcher runs with service role).
create or replace function public.claim_outbox(p_limit int default 50)
returns setof public.message_outbox language sql security definer set search_path = public as $$
  -- next_attempt_at doubles as "claimed at" while sending, so stale claims can be requeued.
  update public.message_outbox m set status = 'sending', attempts = m.attempts + 1, next_attempt_at = now()
  where m.id in (
    select id from public.message_outbox
    where status = 'queued' and next_attempt_at <= now()
    order by created_at
    limit p_limit
    for update skip locked)
  returning m.*;
$$;
revoke all on function public.claim_outbox(int) from public, anon, authenticated;

-- ---------- Gate: sign in / sign out ----------
create table if not exists public.gate_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  person_type  text not null check (person_type in ('student','staff')),
  student_id   uuid references public.students(id) on delete cascade,
  staff_id     uuid references public.staff(id) on delete cascade,
  direction    text not null check (direction in ('in','out')),
  method       text not null default 'kiosk' check (method in ('kiosk','self','manual','pickup')),
  late         boolean not null default false,
  recorded_by  uuid references public.users(id),
  lat          double precision,
  lng          double precision,
  note         text,
  at           timestamptz not null default now(),
  check ((person_type = 'student' and student_id is not null) or (person_type = 'staff' and staff_id is not null))
);
create index if not exists gate_events_tenant_at on public.gate_events(tenant_id, at desc);
create index if not exists gate_events_student on public.gate_events(student_id, at desc);
create index if not exists gate_events_staff on public.gate_events(staff_id, at desc);

-- ---------- Pickup codes ----------
create table if not exists public.pickup_codes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  guardian_id     uuid not null references public.guardians(id) on delete cascade,
  code_hash       text not null,                  -- sha256(tenant_id:code); plain code never stored
  delegate_name   text,                           -- e.g. driver / aunt collecting on the parent's behalf
  delegate_phone  text,
  status          text not null default 'active' check (status in ('active','used','revoked','expired')),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  verified_by     uuid references public.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists pickup_codes_lookup on public.pickup_codes(tenant_id, code_hash) where status = 'active';

create table if not exists public.pickup_attempts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid,
  success    boolean not null,
  at         timestamptz not null default now()
);

-- ---------- Library ----------
create table if not exists public.library_books (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  isbn              text,
  title             text not null,
  author            text,
  publisher         text,
  category          text,
  shelf             text,
  total_copies      int not null default 1 check (total_copies >= 0),
  available_copies  int not null default 1 check (available_copies >= 0),
  created_at        timestamptz not null default now()
);
create index if not exists library_books_search on public.library_books(tenant_id, title);

create table if not exists public.library_loans (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  book_id       uuid not null references public.library_books(id) on delete cascade,
  student_id    uuid references public.students(id) on delete cascade,
  staff_id      uuid references public.staff(id) on delete cascade,
  issued_by     uuid references public.users(id),
  issued_at     timestamptz not null default now(),
  due_at        timestamptz not null,
  returned_at   timestamptz,
  fine_amount   numeric not null default 0,
  check (student_id is not null or staff_id is not null)
);
create index if not exists library_loans_open on public.library_loans(tenant_id) where returned_at is null;

-- Issue / return keep available_copies correct under concurrency.
create or replace function public.library_issue(p_book uuid, p_student uuid, p_staff uuid, p_days int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_id uuid;
begin
  if not public.has_role(array['librarian','school_admin','principal','platform_admin']) then
    raise exception 'forbidden';
  end if;
  update public.library_books set available_copies = available_copies - 1
   where id = p_book and tenant_id = public.my_tenant_id() and available_copies > 0
   returning tenant_id into v_tenant;
  if v_tenant is null then raise exception 'no copies available'; end if;
  insert into public.library_loans (tenant_id, book_id, student_id, staff_id, issued_by, due_at)
  values (v_tenant, p_book, p_student, p_staff, auth.uid(), now() + make_interval(days => greatest(p_days, 1)))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.library_return(p_loan uuid, p_fine_per_day numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_loan public.library_loans; v_fine numeric;
begin
  if not public.has_role(array['librarian','school_admin','principal','platform_admin']) then
    raise exception 'forbidden';
  end if;
  select * into v_loan from public.library_loans
   where id = p_loan and tenant_id = public.my_tenant_id() and returned_at is null for update;
  if v_loan.id is null then raise exception 'loan not found or already returned'; end if;
  v_fine := greatest(0, ceil(extract(epoch from (now() - v_loan.due_at)) / 86400.0)) * coalesce(p_fine_per_day, 0);
  update public.library_loans set returned_at = now(), fine_amount = v_fine where id = p_loan;
  update public.library_books set available_copies = least(total_copies, available_copies + 1) where id = v_loan.book_id;
  return v_fine;
end $$;
grant execute on function public.library_issue(uuid, uuid, uuid, int), public.library_return(uuid, numeric) to authenticated;

-- ---------- Requisitions ----------
create table if not exists public.requisitions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  requested_by    uuid not null references public.users(id),
  department      text,
  title           text not null,
  justification   text,
  needed_by       date,
  status          text not null default 'submitted' check (status in ('submitted','approved','rejected','fulfilled','cancelled')),
  total_amount    numeric not null default 0,
  decided_by      uuid references public.users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);
create table if not exists public.requisition_items (
  id              uuid primary key default gen_random_uuid(),
  requisition_id  uuid not null references public.requisitions(id) on delete cascade,
  description     text not null,
  quantity        numeric not null check (quantity > 0),
  unit_cost       numeric not null default 0 check (unit_cost >= 0)
);

-- ---------- HR: leave ----------
create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  staff_id      uuid not null references public.staff(id) on delete cascade,
  leave_type    text not null check (leave_type in ('annual','sick','maternity','paternity','compassionate','study','unpaid','other')),
  starts_on     date not null,
  ends_on       date not null,
  days          int not null check (days > 0),
  reason        text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by    uuid references public.users(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  check (ends_on >= starts_on)
);

-- ---------- Quality assurance ----------
create table if not exists public.qa_checklists (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  -- [{ "id": "c1", "label": "Lesson objectives stated", "max": 5 }]
  criteria    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create table if not exists public.qa_observations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  checklist_id    uuid not null references public.qa_checklists(id) on delete cascade,
  observer_id     uuid not null references public.users(id),
  staff_id        uuid not null references public.staff(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete set null,
  class_group_id  uuid references public.class_groups(id) on delete set null,
  observed_on     date not null default current_date,
  scores          jsonb not null default '{}'::jsonb,    -- { "c1": 4, ... }
  total           numeric not null default 0,
  max_total       numeric not null default 0,
  strengths       text,
  improvements    text,
  action_plan     text,
  follow_up_on    date,
  created_at      timestamptz not null default now()
);

-- ---------- RLS ----------
alter table public.message_outbox   enable row level security;
alter table public.gate_events      enable row level security;
alter table public.pickup_codes     enable row level security;
alter table public.pickup_attempts  enable row level security;
alter table public.library_books    enable row level security;
alter table public.library_loans    enable row level security;
alter table public.requisitions     enable row level security;
alter table public.requisition_items enable row level security;
alter table public.leave_requests   enable row level security;
alter table public.qa_checklists    enable row level security;
alter table public.qa_observations  enable row level security;

drop policy if exists outbox_read on public.message_outbox;
create policy outbox_read on public.message_outbox for select using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','it_admin','platform_admin']));
drop policy if exists outbox_retry on public.message_outbox;
create policy outbox_retry on public.message_outbox for update using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','it_admin','platform_admin'])
) with check (tenant_id = public.my_tenant_id());
-- inserts happen server-side through the service role after authorisation.

drop policy if exists gate_events_read on public.gate_events;
create policy gate_events_read on public.gate_events for select using (
  tenant_id = public.my_tenant_id() and (
    public.has_role(array['school_admin','principal','gate_officer','hr_manager','platform_admin','teacher','qa_officer'])
    or public.is_guardian_of(student_id)
    or exists (select 1 from public.staff s where s.id = gate_events.staff_id and s.user_id = auth.uid())));

drop policy if exists pickup_codes_read on public.pickup_codes;
create policy pickup_codes_read on public.pickup_codes for select using (
  tenant_id = public.my_tenant_id() and (
    public.has_role(array['school_admin','principal','gate_officer','platform_admin'])
    or exists (select 1 from public.guardians g where g.id = pickup_codes.guardian_id and g.user_id = auth.uid())));

drop policy if exists library_books_read on public.library_books;
create policy library_books_read on public.library_books for select using (tenant_id = public.my_tenant_id());
drop policy if exists library_books_write on public.library_books;
create policy library_books_write on public.library_books for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['librarian','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id());

drop policy if exists library_loans_read on public.library_loans;
create policy library_loans_read on public.library_loans for select using (
  tenant_id = public.my_tenant_id() and (
    public.has_role(array['librarian','school_admin','principal','platform_admin'])
    or public.is_guardian_of(student_id)
    or exists (select 1 from public.students s where s.id = library_loans.student_id and s.user_id = auth.uid())
    or exists (select 1 from public.staff s where s.id = library_loans.staff_id and s.user_id = auth.uid())));

drop policy if exists requisitions_read on public.requisitions;
create policy requisitions_read on public.requisitions for select using (
  tenant_id = public.my_tenant_id() and (requested_by = auth.uid()
    or public.has_role(array['school_admin','principal','bursar','platform_admin'])));
drop policy if exists requisitions_insert on public.requisitions;
create policy requisitions_insert on public.requisitions for insert with check (
  tenant_id = public.my_tenant_id() and requested_by = auth.uid() and public.is_staff() and status = 'submitted');
drop policy if exists requisitions_update on public.requisitions;
create policy requisitions_update on public.requisitions for update using (
  tenant_id = public.my_tenant_id() and (requested_by = auth.uid()
    or public.has_role(array['school_admin','principal','bursar','platform_admin']))
) with check (tenant_id = public.my_tenant_id());

create or replace function public.requisitions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.status is distinct from old.status then
    if new.status = 'cancelled' and old.requested_by = auth.uid() and old.status = 'submitted' then
      return new;
    end if;
    if not public.has_role(array['school_admin','principal','bursar','platform_admin']) then
      raise exception 'only approvers can change requisition status';
    end if;
    if old.requested_by = auth.uid() and new.status in ('approved','rejected') then
      raise exception 'you cannot approve your own requisition';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists requisitions_guard on public.requisitions;
create trigger requisitions_guard before update on public.requisitions
  for each row execute function public.requisitions_guard();

drop policy if exists requisition_items_rw on public.requisition_items;
create policy requisition_items_rw on public.requisition_items for all using (
  exists (select 1 from public.requisitions r where r.id = requisition_items.requisition_id
          and r.tenant_id = public.my_tenant_id()
          and (r.requested_by = auth.uid() or public.has_role(array['school_admin','principal','bursar','platform_admin'])))
) with check (
  exists (select 1 from public.requisitions r where r.id = requisition_items.requisition_id
          and r.tenant_id = public.my_tenant_id() and r.requested_by = auth.uid() and r.status = 'submitted'));

drop policy if exists leave_read on public.leave_requests;
create policy leave_read on public.leave_requests for select using (
  tenant_id = public.my_tenant_id() and (
    public.has_role(array['hr_manager','school_admin','principal','platform_admin'])
    or exists (select 1 from public.staff s where s.id = leave_requests.staff_id and s.user_id = auth.uid())));
drop policy if exists leave_insert on public.leave_requests;
create policy leave_insert on public.leave_requests for insert with check (
  tenant_id = public.my_tenant_id() and status = 'pending' and (
    exists (select 1 from public.staff s where s.id = leave_requests.staff_id and s.user_id = auth.uid())
    or public.has_role(array['hr_manager','school_admin','principal'])));
drop policy if exists leave_update on public.leave_requests;
create policy leave_update on public.leave_requests for update using (
  tenant_id = public.my_tenant_id() and (
    public.has_role(array['hr_manager','school_admin','principal','platform_admin'])
    or exists (select 1 from public.staff s where s.id = leave_requests.staff_id and s.user_id = auth.uid()))
) with check (tenant_id = public.my_tenant_id());

create or replace function public.leave_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    if not public.has_role(array['hr_manager','school_admin','principal','platform_admin']) then
      raise exception 'only HR or admins can decide leave';
    end if;
    if exists (select 1 from public.staff s where s.id = new.staff_id and s.user_id = auth.uid()) then
      raise exception 'you cannot decide your own leave';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leave_guard on public.leave_requests;
create trigger leave_guard before update on public.leave_requests
  for each row execute function public.leave_guard();

drop policy if exists qa_checklists_read on public.qa_checklists;
create policy qa_checklists_read on public.qa_checklists for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists qa_checklists_write on public.qa_checklists;
create policy qa_checklists_write on public.qa_checklists for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['qa_officer','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id());

drop policy if exists qa_obs_read on public.qa_observations;
create policy qa_obs_read on public.qa_observations for select using (
  tenant_id = public.my_tenant_id() and (
    public.has_role(array['qa_officer','school_admin','principal','platform_admin'])
    or exists (select 1 from public.staff s where s.id = qa_observations.staff_id and s.user_id = auth.uid())));
drop policy if exists qa_obs_write on public.qa_observations;
create policy qa_obs_write on public.qa_observations for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['qa_officer','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and observer_id = auth.uid());
