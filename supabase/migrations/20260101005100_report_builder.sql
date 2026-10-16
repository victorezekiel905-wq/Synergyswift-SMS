-- =====================================================================
--  Phase 13b: custom reports.
--
--  * Saved reports: a dataset (students, attendance, results, fees,
--    payments, applications, staff, library, behaviour…), the columns,
--    filters, grouping and totals chosen in the report builder.
--  * Kept private to their author or shared with colleagues (who still
--    only see datasets their role allows).
--  * Sent on a schedule (daily, weekly or monthly) to members of staff of
--    the same school, never to outside addresses or families.
-- =====================================================================

create table if not exists public.saved_reports (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  owner_id       uuid references public.users(id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 120),
  description    text,
  dataset        text not null check (dataset ~ '^[a-z_]{2,40}$'),
  spec           jsonb not null default '{}'::jsonb,
  shared         boolean not null default false,
  schedule       text not null default 'none' check (schedule in ('none','daily','weekly','monthly')),
  schedule_day   int check (schedule_day between 1 and 28),       -- weekday 1–7 (Mon–Sun) for weekly, day of month for monthly
  schedule_hour  int not null default 7 check (schedule_hour between 0 and 23),
  recipient_ids  uuid[] not null default '{}',
  next_run_at    timestamptz,
  last_sent_at   timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (schedule = 'none' or cardinality(recipient_ids) between 1 and 50),
  check (schedule <> 'weekly' or schedule_day between 1 and 7),
  check (schedule <> 'monthly' or schedule_day is not null)
);
create index if not exists saved_reports_due on public.saved_reports(next_run_at) where schedule <> 'none';

-- Scheduled copies go only to staff of the same school.
create or replace function public.saved_reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from unnest(new.recipient_ids) r(id)
    where not exists (select 1 from public.users u where u.id = r.id and u.tenant_id = new.tenant_id
                        and u.active and u.role not in ('parent','student'))
  ) then
    raise exception 'reports can only be sent to staff of this school';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and new.owner_id is distinct from old.owner_id and not public.is_school_admin() then
    raise exception 'only admins can hand a report to someone else';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists saved_reports_guard on public.saved_reports;
create trigger saved_reports_guard before insert or update on public.saved_reports for each row execute function public.saved_reports_guard();

alter table public.saved_reports enable row level security;
drop policy if exists saved_reports_read on public.saved_reports;
create policy saved_reports_read on public.saved_reports for select
  using (tenant_id = public.my_tenant_id() and public.is_staff() and (owner_id = auth.uid() or shared or public.is_school_admin()));
drop policy if exists saved_reports_insert on public.saved_reports;
create policy saved_reports_insert on public.saved_reports for insert
  with check (tenant_id = public.my_tenant_id() and public.is_staff() and owner_id = auth.uid());
drop policy if exists saved_reports_update on public.saved_reports;
create policy saved_reports_update on public.saved_reports for update
  using (tenant_id = public.my_tenant_id() and (owner_id = auth.uid() or public.is_school_admin()))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists saved_reports_delete on public.saved_reports;
create policy saved_reports_delete on public.saved_reports for delete
  using (tenant_id = public.my_tenant_id() and (owner_id = auth.uid() or public.is_school_admin()));
grant all on public.saved_reports to service_role;

select public.attach_change_log();
