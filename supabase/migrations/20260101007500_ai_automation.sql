-- =========================================================================
-- Synergy Swift phase 14p: AI automation on Gemini.
--  * ai_usage: one row per AI request (school, person, task, tokens), written
--    by the server only. School admins see their own school's usage; the
--    platform team reads it through the service role.
--  * tenant_settings.ai_settings: how the school wants drafts written (report
--    comment tone and length) and which admissions jobs run on their own.
--    tenant_settings.ai_monthly_limit: requests a month (null = platform default).
--  * sales_leads.ai_brief / admission_leads.ai_brief: the latest AI briefing
--    on a lead (summary, next step, drafted message), kept until refreshed.
--  * applications.ai_summary: a short summary of an applicant for the officer.
-- Idempotent. Apply after 20260101007400.
-- =========================================================================

create table if not exists public.ai_usage (
  id             bigint generated always as identity primary key,
  tenant_id      uuid references public.tenants(id) on delete cascade,   -- null: platform work (sales)
  user_id        uuid,
  task           text not null check (length(task) between 1 and 60),
  provider       text not null check (provider in ('gemini','anthropic')),
  model          text not null,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  ok             boolean not null default true,
  at             timestamptz not null default now()
);
create index if not exists ai_usage_tenant_at on public.ai_usage(tenant_id, at desc);
create index if not exists ai_usage_at on public.ai_usage(at desc);
-- Each person's share of the allowance is checked against their own requests this month.
create index if not exists ai_usage_user_at on public.ai_usage(tenant_id, user_id, at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
drop policy if exists ai_usage_admin_read on public.ai_usage;
create policy ai_usage_admin_read on public.ai_usage for select
  using (tenant_id = (select public.my_tenant_id()) and (select public.is_school_admin()));

alter table public.tenant_settings add column if not exists ai_settings jsonb not null default '{}'::jsonb;
alter table public.tenant_settings add column if not exists ai_monthly_limit int;
do $$ begin
  alter table public.tenant_settings drop constraint if exists tenant_settings_ai_monthly_limit_check;
  alter table public.tenant_settings add constraint tenant_settings_ai_monthly_limit_check
    check (ai_monthly_limit is null or ai_monthly_limit between 0 and 1000000);
end $$;

alter table public.sales_leads add column if not exists ai_brief jsonb;
alter table public.sales_leads add column if not exists ai_brief_at timestamptz;
alter table public.admission_leads add column if not exists ai_brief jsonb;
alter table public.admission_leads add column if not exists ai_brief_at timestamptz;
alter table public.applications add column if not exists ai_summary text;
alter table public.applications add column if not exists ai_summary_at timestamptz;

-- AI-drafted messages waiting for a person to approve live in the activity
-- logs; let both logs say so.
do $$ begin
  alter table public.sales_activities drop constraint if exists sales_activities_kind_check;
  alter table public.sales_activities add constraint sales_activities_kind_check
    check (kind in ('note','call','email','whatsapp','meeting','demo','stage','quote','system','ai'));
  alter table public.lead_activities drop constraint if exists lead_activities_kind_check;
  alter table public.lead_activities add constraint lead_activities_kind_check
    check (kind in ('note','call','email','sms','whatsapp','meeting','stage','task','system','ai'));
end $$;

-- This month's AI requests for one school (the server checks it before each request). Failed requests don't count.
create or replace function public.ai_requests_this_month(p_tenant uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_usage
  where tenant_id = p_tenant and ok and at >= date_trunc('month', now());
$$;
revoke all on function public.ai_requests_this_month(uuid) from public, anon, authenticated;
grant execute on function public.ai_requests_this_month(uuid) to service_role;
