-- =========================================================================
-- Synergy Swift: fee collections and fundraising (Phase 14g-2).
--  * fee_promises: a parent's promise to pay an amount by a date; checked
--    daily against payments since the promise: kept or broken.
--  * fee_collection_cases: one per family that owes: escalation level
--    (0 none … 4 final notice), owner, next step.
--  * fundraising_campaigns + donations: appeals with a goal and dates, a public
--    giving page (online payment through the school's provider), pledges, cash,
--    transfer and cheque gifts, receipts and donor lists (alumni and parents).
-- Finance staff (bursar, admins) only; the public giving page goes through the
-- server. Idempotent.
-- =========================================================================

create table if not exists public.fee_promises (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,
  student_ids  uuid[] not null default '{}',
  amount       numeric(14,2) not null check (amount > 0),
  promised_by  date not null,
  status       text not null default 'open' check (status in ('open','kept','broken','cancelled')),
  paid         numeric(14,2) not null default 0,
  note         text check (length(note) <= 1000),
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index if not exists fee_promises_open on public.fee_promises(tenant_id, status, promised_by);
create index if not exists fee_promises_guardian on public.fee_promises(guardian_id, created_at desc);

create table if not exists public.fee_collection_cases (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  guardian_id     uuid not null references public.guardians(id) on delete cascade,
  level           int not null default 0 check (level between 0 and 4),
  owner_id        uuid references public.users(id) on delete set null,
  next_action_at  timestamptz,
  note            text check (length(note) <= 1000),
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, guardian_id)
);

create table if not exists public.fundraising_campaigns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  title         text not null check (length(btrim(title)) between 2 and 160),
  slug          text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  purpose       text check (length(purpose) <= 4000),
  goal          numeric(14,2) check (goal > 0),
  starts_on     date,
  ends_on       date,
  status        text not null default 'draft' check (status in ('draft','open','closed')),
  show_donors   boolean not null default true,     -- donor names on the public page (never anonymous ones)
  show_raised   boolean not null default true,     -- progress bar on the public page
  cover_url     text,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists public.donations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  campaign_id   uuid references public.fundraising_campaigns(id) on delete set null,
  donor_name    text not null check (length(btrim(donor_name)) between 1 and 160),
  email         text,
  phone         text,
  guardian_id   uuid references public.guardians(id) on delete set null,
  alumni_id     uuid references public.alumni(id) on delete set null,
  amount        numeric(14,2) not null check (amount > 0),
  currency      text not null default 'NGN',
  kind          text not null default 'gift' check (kind in ('gift','pledge')),
  status        text not null default 'pending' check (status in ('pending','paid','failed','pledged','cancelled')),
  method        text not null default 'online' check (method in ('online','cash','transfer','cheque','pos')),
  anonymous     boolean not null default false,
  message       text check (length(message) <= 1000),
  reference     text unique,
  provider      text,
  receipt_no    text,
  pledge_due    date,
  paid_at       timestamptz,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists donations_campaign on public.donations(campaign_id, status);
create index if not exists donations_tenant on public.donations(tenant_id, created_at desc);

-- ---------- RLS: finance staff ----------
do $$
declare t text;
begin
  foreach t in array array['fee_promises','fee_collection_cases','fundraising_campaigns','donations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_finance', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_finance()) with check (tenant_id = public.my_tenant_id() and public.is_finance())', t || '_finance', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- Online gifts are confirmed by the server only (verified with the payment provider).
drop policy if exists donations_finance on public.donations;
drop policy if exists donations_read on public.donations;
create policy donations_read on public.donations for select using (tenant_id = public.my_tenant_id() and public.is_finance());
drop policy if exists donations_offline on public.donations;
create policy donations_offline on public.donations for insert
  with check (tenant_id = public.my_tenant_id() and public.is_finance() and method <> 'online');
drop policy if exists donations_offline_update on public.donations;
create policy donations_offline_update on public.donations for update
  using (tenant_id = public.my_tenant_id() and public.is_finance() and method <> 'online')
  with check (tenant_id = public.my_tenant_id() and public.is_finance() and method <> 'online');

-- Raised so far per campaign (paid gifts), and pledged but not yet paid.
create or replace function public.campaign_totals(p_campaign uuid)
returns table (raised numeric, pledged numeric, donors bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount) filter (where status = 'paid'), 0),
         coalesce(sum(amount) filter (where status = 'pledged'), 0),
         count(distinct coalesce(lower(email), lower(donor_name))) filter (where status in ('paid','pledged'))
    from public.donations where campaign_id = p_campaign
$$;
revoke all on function public.campaign_totals(uuid) from public, anon, authenticated;
grant execute on function public.campaign_totals(uuid) to service_role;
