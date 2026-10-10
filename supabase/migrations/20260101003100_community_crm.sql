-- =========================================================================
-- EduClass Fusion: parent and community CRM (phase 3).
--  * crm_interactions: calls, meetings, visits and notes with families,
--    alumni and partners (the timeline behind the 360° family profile).
--  * tickets / ticket_messages: complaints and requests with SLAs,
--    assignment, escalation and a satisfaction rating when resolved.
--  * surveys / survey_invites / survey_responses: NPS and other surveys
--    answered from a private link; anonymous surveys keep no link to the
--    family.
--  * family_segments: saved family filters for campaigns.
--  * reenrolment_rounds / reenrolment_responses: "Will your child return
--    next session?" with reasons.
--  * referral_rewards: a reward per referred family that enrols.
--  * alumni: former students, from graduation or self-registration.
--  * crm_campaigns: email/SMS/WhatsApp campaigns and newsletters.
--  * crm_partners: vendors, suppliers, sponsors and partner organisations.
-- School admins and principals manage all of it. Any staff member can log a
-- ticket and works the tickets they raised or are assigned; the bursar also
-- sees vendors and referral rewards. Parents act only through the server.
-- Apply AFTER 20260101003000. Idempotent.
-- =========================================================================

alter table public.guardians add column if not exists marketing_opt_out boolean not null default false;
alter table public.guardians add column if not exists unsubscribe_token text;
update public.guardians set unsubscribe_token = encode(gen_random_bytes(16), 'hex') where unsubscribe_token is null;
alter table public.guardians alter column unsubscribe_token set default encode(gen_random_bytes(16), 'hex');
create unique index if not exists guardians_unsubscribe_token on public.guardians(unsubscribe_token);

alter table public.tenant_settings add column if not exists ticket_sla jsonb not null default '{}'::jsonb;   -- { "<priority>": { "respond": hours, "resolve": hours } }
alter table public.tenant_settings add column if not exists referral_reward_kind text not null default 'fee_discount';
alter table public.tenant_settings drop constraint if exists tenant_settings_referral_reward_kind_check;
alter table public.tenant_settings add constraint tenant_settings_referral_reward_kind_check check (referral_reward_kind in ('fee_discount','wallet_credit','gift','cash'));
alter table public.tenant_settings add column if not exists referral_reward_amount numeric(14,2) not null default 0;

create or replace function public.is_bursar_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['school_admin','principal','platform_admin','bursar']);
$$;
grant execute on function public.is_bursar_or_admin() to authenticated;

-- ---------- alumni and partners (interactions point at them) ----------
create table if not exists public.alumni (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  student_id        uuid references public.students(id) on delete set null,
  full_name         text not null check (length(full_name) between 2 and 160),
  graduation_year   int check (graduation_year between 1900 and 2200),
  last_class        text,
  email             text,
  phone             text,
  occupation        text,
  employer          text,
  further_study     text,             -- university / college and course
  city              text,
  country           text,
  linkedin          text,
  mentor            boolean not null default false,   -- happy to mentor current students
  consent_contact   boolean not null default true,
  status            text not null default 'active' check (status in ('pending','active','archived')),
  source            text not null default 'graduated' check (source in ('graduated','self','import','staff')),
  notes             text,
  update_token      text not null default encode(gen_random_bytes(16), 'hex'),   -- private self-update link
  unsubscribe_token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (update_token),
  unique (unsubscribe_token)
);
create unique index if not exists alumni_student on public.alumni(tenant_id, student_id) where student_id is not null;
create index if not exists alumni_year on public.alumni(tenant_id, graduation_year);

create table if not exists public.crm_partners (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null check (length(name) between 2 and 160),
  kind            text not null default 'vendor' check (kind in ('vendor','supplier','partner','sponsor','ngo','government','media','other')),
  category        text,               -- e.g. "uniforms", "catering", "ICT"
  status          text not null default 'active' check (status in ('prospect','active','inactive')),
  contact_name    text,
  email           text,
  phone           text,
  website         text,
  address         text,
  contract_start  date,
  contract_end    date,
  contract_value  numeric(14,2),
  rating          int check (rating between 1 and 5),
  tags            text[] not null default '{}',
  notes           text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists crm_partners_kind on public.crm_partners(tenant_id, kind);

-- ---------- interactions ----------
create table if not exists public.crm_interactions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  guardian_id  uuid references public.guardians(id) on delete cascade,
  student_id   uuid references public.students(id) on delete set null,
  alumni_id    uuid references public.alumni(id) on delete cascade,
  partner_id   uuid references public.crm_partners(id) on delete cascade,
  kind         text not null default 'note' check (kind in ('note','call','meeting','email','sms','whatsapp','visit','retention','other')),
  body         text not null check (length(body) between 1 and 4000),
  occurred_at  timestamptz not null default now(),
  follow_up_at timestamptz,
  actor_id     uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (num_nonnulls(guardian_id, alumni_id, partner_id) = 1)
);
create index if not exists crm_interactions_guardian on public.crm_interactions(guardian_id, occurred_at desc);
create index if not exists crm_interactions_alumni on public.crm_interactions(alumni_id, occurred_at desc);
create index if not exists crm_interactions_partner on public.crm_interactions(partner_id, occurred_at desc);

-- ---------- tickets ----------
create table if not exists public.tickets (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  ticket_no           text not null,
  guardian_id         uuid references public.guardians(id) on delete set null,
  student_id          uuid references public.students(id) on delete set null,
  kind                text not null default 'complaint' check (kind in ('complaint','request','enquiry','feedback')),
  category            text not null default 'other' check (category in ('academic','fees','transport','safety','bullying','facilities','food','health','staff','communication','admissions','other')),
  priority            text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  channel             text not null default 'portal' check (channel in ('portal','phone','email','walk_in','whatsapp','survey')),
  subject             text not null check (length(subject) between 2 and 160),
  body                text not null check (length(body) between 1 and 5000),
  status              text not null default 'open' check (status in ('open','in_progress','waiting','resolved','closed')),
  assigned_to         uuid references public.users(id) on delete set null,
  respond_due_at      timestamptz,
  resolve_due_at      timestamptz,
  first_response_at   timestamptz,
  resolved_at         timestamptz,
  closed_at           timestamptz,
  escalation_level    int not null default 0 check (escalation_level between 0 and 2),   -- 1 = response overdue, 2 = resolution overdue
  escalated_at        timestamptz,
  satisfaction        int check (satisfaction between 1 and 5),
  satisfaction_note   text,
  token               text not null default encode(gen_random_bytes(16), 'hex'),          -- lets the family rate the outcome from a link
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, ticket_no),
  unique (token)
);
create index if not exists tickets_open on public.tickets(tenant_id, status, resolve_due_at) where status not in ('resolved','closed');
create index if not exists tickets_guardian on public.tickets(guardian_id, created_at desc);
create index if not exists tickets_assigned on public.tickets(tenant_id, assigned_to) where status not in ('resolved','closed');

create table if not exists public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  author      text not null check (author in ('staff','family','system')),
  author_id   uuid references public.users(id) on delete set null,
  body        text not null check (length(body) between 1 and 5000),
  internal    boolean not null default false,     -- staff-only note, never shown to the family
  created_at  timestamptz not null default now()
);
create index if not exists ticket_messages_ticket on public.ticket_messages(ticket_id, created_at);

-- ---------- surveys ----------
create table if not exists public.surveys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null check (length(title) between 2 and 160),
  intro        text,
  questions    jsonb not null default '[]'::jsonb,    -- [{ id, type: nps|rating|choice|text, label, options?, required? }]
  audience     jsonb not null default '{}'::jsonb,    -- { class_group_ids?, segment_id? }
  anonymous    boolean not null default false,
  status       text not null default 'draft' check (status in ('draft','open','closed')),
  closes_at    timestamptz,
  sent_at      timestamptz,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.survey_invites (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  survey_id     uuid not null references public.surveys(id) on delete cascade,
  guardian_id   uuid not null references public.guardians(id) on delete cascade,
  token         text not null default encode(gen_random_bytes(16), 'hex'),
  sent_at       timestamptz not null default now(),
  reminded_at   timestamptz,
  responded_at  timestamptz,
  unique (survey_id, guardian_id),
  unique (token)
);

create table if not exists public.survey_responses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  survey_id    uuid not null references public.surveys(id) on delete cascade,
  guardian_id  uuid references public.guardians(id) on delete set null,   -- null when the survey is anonymous
  nps          int check (nps between 0 and 10),
  answers      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists survey_responses_survey on public.survey_responses(survey_id);
create index if not exists survey_responses_guardian on public.survey_responses(guardian_id, created_at desc);

-- ---------- segments ----------
create table if not exists public.family_segments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(name) between 2 and 80),
  rules       jsonb not null default '{}'::jsonb,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ---------- re-enrolment ----------
create table if not exists public.reenrolment_rounds (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  title            text not null check (length(title) between 2 and 120),      -- e.g. "2027/2028 session"
  message          text,
  class_group_ids  uuid[] not null default '{}',     -- empty = every class
  deadline         date,
  status           text not null default 'open' check (status in ('draft','open','closed')),
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create table if not exists public.reenrolment_responses (
  round_id      uuid not null references public.reenrolment_rounds(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  guardian_id   uuid references public.guardians(id) on delete set null,
  intent        text not null check (intent in ('returning','not_returning','undecided')),
  reason        text check (reason in ('fees','relocation','academics','distance','another_school','dissatisfied','graduating','other')),
  note          text,
  responded_at  timestamptz not null default now(),
  primary key (round_id, student_id)
);

-- ---------- referral rewards ----------
create table if not exists public.referral_rewards (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,
  lead_id      uuid references public.admission_leads(id) on delete set null,
  kind         text not null default 'fee_discount' check (kind in ('fee_discount','wallet_credit','gift','cash')),
  amount       numeric(14,2) not null default 0 check (amount >= 0),
  status       text not null default 'pending' check (status in ('pending','approved','issued','cancelled')),
  note         text,
  approved_by  uuid references public.users(id) on delete set null,
  issued_at    timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists referral_rewards_lead on public.referral_rewards(lead_id) where lead_id is not null;

-- A referred family that enrols earns the referrer the school's standard reward, once.
create or replace function public.referral_reward_on_enrol()
returns trigger language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if new.stage = 'enrolled' and new.referred_by is not null and (tg_op = 'INSERT' or old.stage is distinct from 'enrolled') then
    select referral_reward_kind, referral_reward_amount into s from public.tenant_settings where tenant_id = new.tenant_id;
    if s is not null and coalesce(s.referral_reward_amount, 0) > 0 then
      insert into public.referral_rewards (tenant_id, guardian_id, lead_id, kind, amount)
        values (new.tenant_id, new.referred_by, new.id, s.referral_reward_kind, s.referral_reward_amount)
        on conflict (lead_id) where lead_id is not null do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists admission_leads_referral_reward on public.admission_leads;
create trigger admission_leads_referral_reward after insert or update of stage on public.admission_leads
  for each row execute function public.referral_reward_on_enrol();

-- ---------- campaigns and newsletters ----------
create table if not exists public.crm_campaigns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(name) between 2 and 120),
  kind          text not null default 'campaign' check (kind in ('campaign','newsletter')),
  subject       text not null check (length(subject) between 2 and 160),
  body          text not null default '',
  blocks        jsonb not null default '[]'::jsonb,       -- newsletter sections: [{ heading, text, image_url, link_url, link_label }]
  channels      text[] not null default '{email}',
  audience      jsonb not null default '{"type":"parents"}'::jsonb,
  status        text not null default 'draft' check (status in ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  recipients    int not null default 0,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists crm_campaigns_due on public.crm_campaigns(scheduled_at) where status = 'scheduled';

-- Attendance per student over a window, for retention flags (server only).
create or replace function public.attendance_rates(p_tenant uuid, p_since date)
returns table (student_id uuid, present int, total int) language sql stable security definer set search_path = public as $$
  select a.student_id, count(*) filter (where a.status in ('present','late'))::int, count(*)::int
  from public.class_attendance a where a.tenant_id = p_tenant and a.date >= p_since group by a.student_id;
$$;
revoke all on function public.attendance_rates(uuid, date) from public, anon, authenticated;
grant execute on function public.attendance_rates(uuid, date) to service_role;

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['alumni','surveys','survey_invites','survey_responses','family_segments','reenrolment_rounds',
                           'reenrolment_responses','crm_campaigns'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_school_admin()) with check (tenant_id = public.my_tenant_id() and public.is_school_admin())', t || '_admin', t);
  end loop;
  foreach t in array array['crm_partners','referral_rewards'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_bursar_or_admin()) with check (tenant_id = public.my_tenant_id() and public.is_bursar_or_admin())', t || '_admin', t);
  end loop;
end $$;

-- Responses and invites are written by the server (from the family's private link).
drop policy if exists survey_responses_admin on public.survey_responses;
drop policy if exists survey_responses_read on public.survey_responses;
create policy survey_responses_read on public.survey_responses for select using (tenant_id = public.my_tenant_id() and public.is_school_admin());
drop policy if exists survey_invites_admin on public.survey_invites;
drop policy if exists survey_invites_read on public.survey_invites;
create policy survey_invites_read on public.survey_invites for select using (tenant_id = public.my_tenant_id() and public.is_school_admin());

-- Interactions: admins see every one; other staff log and see their own.
alter table public.crm_interactions enable row level security;
drop policy if exists crm_interactions_admin on public.crm_interactions;
create policy crm_interactions_admin on public.crm_interactions for all
  using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
drop policy if exists crm_interactions_own on public.crm_interactions;
create policy crm_interactions_own on public.crm_interactions for all
  using (tenant_id = public.my_tenant_id() and public.is_staff() and actor_id = auth.uid())
  with check (tenant_id = public.my_tenant_id() and public.is_staff() and actor_id = auth.uid() and alumni_id is null and partner_id is null);

-- Tickets: admins see all; other staff see the ones they raised or are assigned.
-- New tickets are numbered by the server, so inserts go through the API.
alter table public.tickets enable row level security;
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets for select using (
  tenant_id = public.my_tenant_id() and (public.is_school_admin() or (public.is_staff() and (assigned_to = auth.uid() or created_by = auth.uid()))));
drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update using (
  tenant_id = public.my_tenant_id() and (public.is_school_admin() or (public.is_staff() and assigned_to = auth.uid())))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets for delete using (tenant_id = public.my_tenant_id() and public.is_school_admin());

-- Only admins may reassign a ticket; the assignee may not hand it to someone else or change its number.
create or replace function public.tickets_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_school_admin() then return new; end if;
  if new.assigned_to is distinct from old.assigned_to or new.ticket_no <> old.ticket_no or new.tenant_id <> old.tenant_id
     or new.guardian_id is distinct from old.guardian_id or new.token <> old.token then
    raise exception 'only a school admin can reassign or re-file a ticket';
  end if;
  return new;
end $$;
drop trigger if exists tickets_guard on public.tickets;
create trigger tickets_guard before update on public.tickets for each row execute function public.tickets_guard();

alter table public.ticket_messages enable row level security;
drop policy if exists ticket_messages_rw on public.ticket_messages;
create policy ticket_messages_rw on public.ticket_messages for select using (
  tenant_id = public.my_tenant_id() and exists (select 1 from public.tickets t where t.id = ticket_messages.ticket_id));
drop policy if exists ticket_messages_insert on public.ticket_messages;
create policy ticket_messages_insert on public.ticket_messages for insert with check (
  tenant_id = public.my_tenant_id() and author = 'staff' and author_id = auth.uid()
  and exists (select 1 from public.tickets t where t.id = ticket_messages.ticket_id and t.tenant_id = public.my_tenant_id()
              and (public.is_school_admin() or t.assigned_to = auth.uid() or t.created_by = auth.uid())));

grant all on public.alumni, public.crm_partners, public.crm_interactions, public.tickets, public.ticket_messages, public.surveys,
  public.survey_invites, public.survey_responses, public.family_segments, public.reenrolment_rounds, public.reenrolment_responses,
  public.referral_rewards, public.crm_campaigns to service_role;
