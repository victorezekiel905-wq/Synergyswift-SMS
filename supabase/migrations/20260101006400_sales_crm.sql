-- =========================================================================
-- Synergy Swift: the platform's own sales CRM (Phase 14g-1).
--  * sales_leads: prospect schools from first contact (or the website's
--    "Book a demo" form) to won (a school created) or lost, with size, value,
--    owner, next action and a score.
--  * sales_activities: calls, notes, WhatsApp, meetings, demos, stage changes.
--  * sales_quotes: priced from the platform's plans and size bands.
--  * tenant_onboarding: the go-live checklist for a new school (created, data
--    imported, staff trained, parents invited, live).
--  * demo_request_tries: throttling for the public form.
-- Only the platform team, through the server (service role). Schools never see
-- any of it. Idempotent.
-- =========================================================================

create table if not exists public.sales_leads (
  id                 uuid primary key default gen_random_uuid(),
  school_name        text not null check (length(btrim(school_name)) between 2 and 200),
  contact_name       text,
  contact_role       text,
  phone              text,
  email              text,
  city               text,
  state              text,
  students_estimate  int check (students_estimate between 0 and 100000),
  source             text not null default 'other' check (source in ('website','referral','event','cold_call','social','partner','other')),
  stage              text not null default 'new' check (stage in ('new','contacted','demo_booked','demo_done','trial','proposal','won','lost')),
  owner_id           uuid references auth.users(id) on delete set null,      -- platform team (no school profile)
  next_action        text,
  next_action_at     timestamptz,
  demo_at            timestamptz,
  package_code       text,
  value_estimate     bigint,                       -- naira a year
  score              int not null default 0,
  lost_reason        text,
  tenant_id          uuid references public.tenants(id) on delete set null,
  needs              text,                         -- what they asked for on the form
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  stage_changed_at   timestamptz not null default now()
);
create index if not exists sales_leads_stage on public.sales_leads(stage, next_action_at);
create index if not exists sales_leads_tenant on public.sales_leads(tenant_id);

create table if not exists public.sales_activities (
  id        uuid primary key default gen_random_uuid(),
  lead_id   uuid not null references public.sales_leads(id) on delete cascade,
  kind      text not null check (kind in ('note','call','email','whatsapp','meeting','demo','stage','quote','system')),
  body      text not null check (length(body) <= 4000),
  actor_id  uuid references auth.users(id) on delete set null,
  at        timestamptz not null default now()
);
create index if not exists sales_activities_lead on public.sales_activities(lead_id, at desc);

create table if not exists public.sales_quotes (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.sales_leads(id) on delete cascade,
  number          text not null unique,
  plan_code       text not null,
  band            int,
  students        int,
  add_on_groups   text[] not null default '{}',
  cycle           text not null default 'annual' check (cycle in ('annual','termly')),
  custom_annual   bigint,
  discount_pct    numeric not null default 0 check (discount_pct between 0 and 100),
  lines           jsonb not null default '[]'::jsonb,
  annual          bigint,
  valid_until     date,
  status          text not null default 'draft' check (status in ('draft','sent','accepted','declined','expired')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  decided_at      timestamptz
);

create table if not exists public.tenant_onboarding (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  step       text not null check (step in ('school_created','data_imported','staff_trained','parents_invited','go_live')),
  done_at    timestamptz not null default now(),
  done_by    uuid references auth.users(id) on delete set null,
  auto       boolean not null default false,
  note       text,
  primary key (tenant_id, step)
);

create table if not exists public.demo_request_tries (
  id   bigint generated always as identity primary key,
  ip   text not null,
  at   timestamptz not null default now()
);
create index if not exists demo_request_tries_ip on public.demo_request_tries(ip, at desc);

create sequence if not exists public.sales_quote_seq;
create or replace function public.next_sales_quote_number()
returns text language sql volatile security definer set search_path = public as $$
  select 'Q-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.sales_quote_seq')::text, 5, '0')
$$;

-- Customer health, per school: size, sign-ins and actions this month against last month,
-- overdue platform invoices, the subscription and its renewal. For the platform team only.
create or replace function public.platform_customer_metrics()
returns table (tenant_id uuid, name text, status text, created_at timestamptz, students int, staff int, parents_with_login int,
               staff_signed_in_30 int, users_signed_in_30 int, actions_30 int, actions_prev_30 int, last_action_at timestamptz,
               invoices_overdue int, oldest_overdue_days int, sub_status text, period_end timestamptz, plan_name text, custom_annual bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.status, t.created_at,
    (select count(*) from public.students s where s.tenant_id = t.id and s.status = 'active')::int,
    (select count(*) from public.users u where u.tenant_id = t.id and u.role not in ('student','parent','alumni'))::int,
    (select count(*) from public.guardians g where g.tenant_id = t.id and g.user_id is not null)::int,
    (select count(*) from public.users u join auth.users au on au.id = u.id
      where u.tenant_id = t.id and u.role not in ('student','parent','alumni') and au.last_sign_in_at > now() - interval '30 days')::int,
    (select count(*) from public.users u join auth.users au on au.id = u.id where u.tenant_id = t.id and au.last_sign_in_at > now() - interval '30 days')::int,
    (select count(*) from public.audit_logs a where a.tenant_id = t.id and a.ts > now() - interval '30 days')::int,
    (select count(*) from public.audit_logs a where a.tenant_id = t.id and a.ts <= now() - interval '30 days' and a.ts > now() - interval '60 days')::int,
    greatest((select max(a.ts) from public.audit_logs a where a.tenant_id = t.id),
             (select max(au.last_sign_in_at) from public.users u join auth.users au on au.id = u.id where u.tenant_id = t.id)),
    (select count(*) from public.invoices i where i.tenant_id = t.id and i.status = 'open' and i.due_at < now())::int,
    (select coalesce(max(extract(day from now() - i.due_at)), 0) from public.invoices i where i.tenant_id = t.id and i.status = 'open' and i.due_at < now())::int,
    sub.status, sub.period_end, p.name, sub.custom_annual
  from public.tenants t
  left join lateral (select * from public.subscriptions s where s.tenant_id = t.id order by s.created_at desc limit 1) sub on true
  left join public.plans p on p.id = sub.plan_id
$$;
revoke all on function public.platform_customer_metrics() from public, anon, authenticated;
grant execute on function public.platform_customer_metrics() to service_role;

-- Platform only: RLS on, no policies, no grants to signed-in users.
do $$
declare t text;
begin
  foreach t in array array['sales_leads','sales_activities','sales_quotes','tenant_onboarding','demo_request_tries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.sales_quote_seq from anon, authenticated;
revoke all on function public.next_sales_quote_number() from public, anon, authenticated;
grant execute on function public.next_sales_quote_number() to service_role;
