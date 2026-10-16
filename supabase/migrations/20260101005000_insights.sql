-- =====================================================================
--  Phase 13a: analytics and statutory returns.
--
--  * The school's census details (EMIS/school code, state, LGA, ownership…)
--    used on government returns.
--  * Statutory returns (the annual school census for the state ministry /
--    UBEC): figures worked out from the school's records, checked and edited
--    by an admin, then marked submitted with the ministry's reference. A
--    submitted return is kept as sent and cannot be changed.
-- =====================================================================

-- e.g. {"school_code":"LA/IKJ/123","state":"Lagos","lga":"Ikeja","ownership":"private","school_type":"junior_senior_secondary","location":"urban"}
alter table public.tenant_settings add column if not exists census_profile jsonb not null default '{}'::jsonb;

create table if not exists public.statutory_returns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  kind          text not null default 'annual_school_census' check (kind in ('annual_school_census','enrolment_return','staff_return')),
  period        text not null check (length(trim(period)) between 4 and 20),   -- e.g. 2026/2027
  data          jsonb not null default '{}'::jsonb,
  status        text not null default 'draft' check (status in ('draft','submitted')),
  prepared_by   uuid references public.users(id) on delete set null,
  prepared_at   timestamptz not null default now(),
  submitted_by  uuid references public.users(id) on delete set null,
  submitted_at  timestamptz,
  reference     text,              -- the ministry's acknowledgement number
  notes         text,
  unique (tenant_id, kind, period)
);

-- Once submitted, the return stays as it was sent; only the acknowledgement reference and notes may be added.
create or replace function public.statutory_returns_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'submitted' and auth.uid() is not null then raise exception 'a submitted return cannot be deleted'; end if;
    return old;
  end if;
  if old.status = 'submitted' and (new.status <> 'submitted' or new.data is distinct from old.data or new.period <> old.period
     or new.kind <> old.kind or new.submitted_at is distinct from old.submitted_at or new.submitted_by is distinct from old.submitted_by) then
    raise exception 'a submitted return cannot be changed';
  end if;
  if new.status = 'submitted' and old.status = 'draft' then
    new.submitted_at := coalesce(new.submitted_at, now());
    new.submitted_by := coalesce(new.submitted_by, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists statutory_returns_guard on public.statutory_returns;
create trigger statutory_returns_guard before update or delete on public.statutory_returns for each row execute function public.statutory_returns_guard();

alter table public.statutory_returns enable row level security;
drop policy if exists statutory_returns_rw on public.statutory_returns;
create policy statutory_returns_rw on public.statutory_returns for all
  using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
grant all on public.statutory_returns to service_role;

select public.attach_change_log();
