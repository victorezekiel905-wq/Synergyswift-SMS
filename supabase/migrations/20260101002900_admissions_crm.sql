-- =========================================================================
-- EduClass Fusion: admissions CRM.
--  * admission_leads: every enquiry from first contact to enrolled or lost,
--    with source, campaign, referral, owner, score and next follow-up.
--  * lead_activities: notes, calls, messages, meetings, stage changes, tasks.
--  * admission_events + admission_bookings: tours, open days, assessments
--    and interviews with capacity and public booking.
--  * admission_sequences / _steps / lead_sequence_runs: automatic follow-ups
--    by email, SMS, WhatsApp, or a task for staff.
--  * admission_templates: offer, waitlist and regret letters.
--  * application_documents, admission_payments (application and acceptance
--    fees online), admission_capacity (seats per level, for the waitlist),
--    admission_costs (marketing spend, for cost per enrolment),
--    entrance_attempts (online entrance tests taken from a private link).
--  * applications: waitlist, interview notes and score, signed offer letters,
--    acceptance fee, campaign and referral tracking.
--  * guardians.referral_code: each family's referral link.
-- Admissions staff and admins only; the public pages go through the API.
-- Apply AFTER 20260101002800. Idempotent.
-- =========================================================================

create or replace function public.is_admissions()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admissions_officer','school_admin','principal','platform_admin']);
$$;
grant execute on function public.is_admissions() to authenticated;

-- ---------- applications: more statuses and fields ----------
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check check (status in
  ('new','reviewing','assessment','interview','offered','accepted','enrolled','rejected','withdrawn','waitlisted','declined','expired'));
alter table public.applications drop constraint if exists applications_source_check;
alter table public.applications add constraint applications_source_check check (source in
  ('online','walk_in','referral','agent','website','whatsapp','facebook','instagram','phone','open_day','email','other'));
alter table public.applications add column if not exists lead_id uuid;
alter table public.applications add column if not exists waitlist_position int;
alter table public.applications add column if not exists interview_notes text;
alter table public.applications add column if not exists interview_score numeric;
alter table public.applications add column if not exists interviewer_id uuid references public.users(id) on delete set null;
alter table public.applications add column if not exists offer_letter jsonb;          -- { subject, body, issued_at, acceptance_fee, expires_on }
alter table public.applications add column if not exists offer_issued_at timestamptz;
alter table public.applications add column if not exists offer_accepted_at timestamptz;
alter table public.applications add column if not exists offer_signer_name text;
alter table public.applications add column if not exists offer_signature text;         -- PNG data URL of the drawn signature
alter table public.applications add column if not exists offer_sign_meta jsonb;        -- { ip, user_agent, letter_hash }
alter table public.applications add column if not exists acceptance_fee numeric(14,2) not null default 0;
alter table public.applications add column if not exists acceptance_paid boolean not null default false;
alter table public.applications add column if not exists utm jsonb not null default '{}'::jsonb;
alter table public.applications add column if not exists referral_code text;

alter table public.tenant_settings add column if not exists lead_webhook_key text;
alter table public.tenant_settings add column if not exists acceptance_fee numeric(14,2) not null default 0;
alter table public.tenant_settings add column if not exists offer_valid_days int not null default 14;
alter table public.tenant_settings add column if not exists admissions_whatsapp text;

alter table public.guardians add column if not exists referral_code text;
update public.guardians set referral_code = upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8)) where referral_code is null;
alter table public.guardians alter column referral_code set default upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));
create unique index if not exists guardians_referral_code on public.guardians(tenant_id, referral_code);

-- ---------- leads ----------
create table if not exists public.admission_leads (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  stage              text not null default 'enquiry' check (stage in ('enquiry','tour_booked','applied','assessed','offered','accepted','enrolled','lost')),
  parent_name        text not null,
  email              text,
  phone              text,
  child_name         text,
  child_dob          date,
  applying_for       text,
  intake             text,                                   -- e.g. "September 2027"
  source             text not null default 'website' check (source in ('website','whatsapp','facebook','instagram','walk_in','phone','open_day','referral','agent','email','other')),
  utm                jsonb not null default '{}'::jsonb,     -- utm_source, utm_medium, utm_campaign, utm_content
  referral_code      text,
  referred_by        uuid references public.guardians(id) on delete set null,
  owner_id           uuid references public.users(id) on delete set null,
  score              int not null default 0,
  notes              text,
  lost_reason        text,
  application_id     uuid references public.applications(id) on delete set null,
  next_follow_up_at  timestamptz,
  last_contact_at    timestamptz,
  first_response_at  timestamptz,
  consent            boolean not null default false,          -- agreed to be contacted
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists admission_leads_stage on public.admission_leads(tenant_id, stage);
create index if not exists admission_leads_phone on public.admission_leads(tenant_id, phone);
create index if not exists admission_leads_email on public.admission_leads(tenant_id, lower(email));
alter table public.applications drop constraint if exists applications_lead_fk;
alter table public.applications add constraint applications_lead_fk foreign key (lead_id) references public.admission_leads(id) on delete set null;

create table if not exists public.lead_activities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lead_id     uuid not null references public.admission_leads(id) on delete cascade,
  kind        text not null check (kind in ('note','call','email','sms','whatsapp','meeting','stage','task','system')),
  body        text,
  due_at      timestamptz,                -- tasks
  done_at     timestamptz,
  assigned_to uuid references public.users(id) on delete set null,
  actor_id    uuid references public.users(id) on delete set null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists lead_activities_lead on public.lead_activities(lead_id, created_at desc);
create index if not exists lead_activities_tasks on public.lead_activities(tenant_id, assigned_to, due_at) where kind = 'task' and done_at is null;

-- ---------- tours, open days, assessments, interviews ----------
create table if not exists public.admission_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  kind         text not null default 'tour' check (kind in ('tour','open_day','assessment','interview')),
  title        text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  capacity     int not null default 10 check (capacity between 1 and 5000),
  location     text,
  details      text,
  published    boolean not null default true,         -- bookable on the public page
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists admission_events_when on public.admission_events(tenant_id, starts_at);

create table if not exists public.admission_bookings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  event_id    uuid not null references public.admission_events(id) on delete cascade,
  lead_id     uuid references public.admission_leads(id) on delete set null,
  name        text not null,
  email       text,
  phone       text,
  party_size  int not null default 1 check (party_size between 1 and 20),
  status      text not null default 'booked' check (status in ('booked','attended','no_show','cancelled')),
  token       text not null default encode(gen_random_bytes(16), 'hex'),
  reminded_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (token)
);
create index if not exists admission_bookings_event on public.admission_bookings(event_id);

-- ---------- follow-up sequences ----------
create table if not exists public.admission_sequences (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  stage       text not null check (stage in ('enquiry','tour_booked','applied','assessed','offered','accepted')),  -- starts when a lead enters this stage
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create table if not exists public.admission_sequence_steps (
  id           uuid primary key default gen_random_uuid(),
  sequence_id  uuid not null references public.admission_sequences(id) on delete cascade,
  position     int not null,
  delay_hours  int not null default 24 check (delay_hours between 0 and 2160),   -- after the previous step (or entering the stage)
  channel      text not null check (channel in ('email','sms','whatsapp','task')),
  subject      text,
  body         text not null,
  unique (sequence_id, position)
);
create table if not exists public.lead_sequence_runs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  lead_id      uuid not null references public.admission_leads(id) on delete cascade,
  sequence_id  uuid not null references public.admission_sequences(id) on delete cascade,
  next_step    int not null default 1,
  next_at      timestamptz not null,
  status       text not null default 'active' check (status in ('active','done','stopped')),
  started_at   timestamptz not null default now(),
  unique (lead_id, sequence_id)
);
create index if not exists lead_sequence_runs_due on public.lead_sequence_runs(status, next_at);

-- ---------- letters, documents, payments, capacity, costs ----------
create table if not exists public.admission_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null check (kind in ('offer','waitlist','regret')),
  subject     text not null,
  body        text not null,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, kind)
);

create table if not exists public.application_documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  application_id  uuid not null references public.applications(id) on delete cascade,
  kind            text not null check (kind in ('birth_certificate','previous_report','passport_photo','transfer_letter','medical','other')),
  path            text not null,
  name            text not null,
  size            int not null,
  content_type    text,
  uploaded_at     timestamptz not null default now()
);
create index if not exists application_documents_app on public.application_documents(application_id);

create table if not exists public.admission_payments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  application_id  uuid not null references public.applications(id) on delete cascade,
  kind            text not null check (kind in ('application_fee','acceptance_fee')),
  amount          numeric(14,2) not null check (amount > 0),
  currency        text not null default 'NGN',
  provider        text,
  reference       text not null,
  status          text not null default 'pending' check (status in ('pending','success','failed')),
  payer_email     text,
  paid_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (reference)
);

create table if not exists public.admission_capacity (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  level       text not null,
  intake      text not null default '',
  seats       int not null check (seats >= 0),
  primary key (tenant_id, level, intake)
);

create table if not exists public.admission_costs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  month       date not null,                 -- first day of the month
  source      text not null,
  campaign    text,
  amount      numeric(14,2) not null check (amount >= 0),
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.entrance_attempts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  application_id  uuid not null references public.applications(id) on delete cascade,
  exam_id         uuid not null references public.exams(id) on delete cascade,
  token           text not null default encode(gen_random_bytes(18), 'hex'),
  status          text not null default 'assigned' check (status in ('assigned','in_progress','submitted','graded')),
  opens_at        timestamptz,
  closes_at       timestamptz,
  started_at      timestamptz,
  deadline_at     timestamptz,
  submitted_at    timestamptz,
  question_order  jsonb not null default '[]'::jsonb,
  option_orders   jsonb not null default '{}'::jsonb,
  answers         jsonb not null default '{}'::jsonb,
  marks           jsonb not null default '{}'::jsonb,
  total_score     numeric,
  max_score       numeric,
  violations      int not null default 0,
  created_at      timestamptz not null default now(),
  unique (token),
  unique (application_id, exam_id)
);

-- ---------- RLS: admissions staff only (public pages use the server) ----------
do $$
declare t text;
begin
  foreach t in array array['admission_leads','lead_activities','admission_events','admission_bookings','admission_sequences',
                           'lead_sequence_runs','admission_templates','application_documents','admission_payments','admission_capacity',
                           'admission_costs','entrance_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admissions', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_admissions()) with check (tenant_id = public.my_tenant_id() and public.is_admissions())', t || '_admissions', t);
  end loop;
end $$;
alter table public.admission_sequence_steps enable row level security;
drop policy if exists admission_sequence_steps_admissions on public.admission_sequence_steps;
create policy admission_sequence_steps_admissions on public.admission_sequence_steps for all using (
  exists (select 1 from public.admission_sequences s where s.id = admission_sequence_steps.sequence_id and s.tenant_id = public.my_tenant_id() and public.is_admissions())
) with check (
  exists (select 1 from public.admission_sequences s where s.id = admission_sequence_steps.sequence_id and s.tenant_id = public.my_tenant_id() and public.is_admissions()));

-- Payments and entrance results are written only by the server (verified with the provider / marked by the engine).
drop policy if exists admission_payments_admissions on public.admission_payments;
drop policy if exists admission_payments_read on public.admission_payments;
create policy admission_payments_read on public.admission_payments for select using (tenant_id = public.my_tenant_id() and public.is_admissions());
drop policy if exists entrance_attempts_admissions on public.entrance_attempts;
drop policy if exists entrance_attempts_read on public.entrance_attempts;
create policy entrance_attempts_read on public.entrance_attempts for select using (tenant_id = public.my_tenant_id() and public.is_admissions());

insert into storage.buckets (id, name, public) values ('admissions', 'admissions', false) on conflict (id) do nothing;
