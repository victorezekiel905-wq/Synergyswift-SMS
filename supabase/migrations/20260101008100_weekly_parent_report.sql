-- =========================================================================
-- Synergy Swift: the weekly report to parents (phase 14q).
--  Every Friday afternoon (school time) each family gets one short message:
--  points earned, attendance, homework handed in and class story posts for
--  each child that week. Schools can switch it off. weekly_report_runs makes
--  each school's week go out once, however often the scheduler runs.
-- Idempotent. Apply after 20260101008000.
-- =========================================================================

alter table public.tenant_settings add column if not exists weekly_parent_report boolean not null default true;

create table if not exists public.weekly_report_runs (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  week_key     text not null check (week_key ~ '^\d{4}-W\d{2}$'),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  families     int not null default 0,
  messages     int not null default 0,
  primary key (tenant_id, week_key)
);
alter table public.weekly_report_runs enable row level security;
revoke all on public.weekly_report_runs from anon, authenticated;
grant all on public.weekly_report_runs to service_role;
