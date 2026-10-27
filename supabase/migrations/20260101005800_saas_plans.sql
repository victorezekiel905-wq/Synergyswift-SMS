-- =========================================================================
-- Phase 14b: Synergy Swift as a SaaS.
--   * plans with module groups and prices per school-size band
--   * per-school module overrides (inherit / on / off, with expiry)
--   * one subscription per school with billing period, grace and add-ons
--   * platform invoices (numbered), billing hold
--   * platform admin roles (owner / admin / support); the owner account
--     ekwuemevictor39@gmail.com is claimed automatically
--   * the roles a school may use (set by the platform) and custom roles
--     made by the school (grant roles, take away modules and actions)
--   * module requests from schools to the platform
-- The effective module map stays in tenants.modules and is rebuilt by the
-- server (src/lib/saas-server.ts) whenever any of this changes.
-- Apply AFTER 20260101005700. Idempotent.
-- =========================================================================

-- ---------- platform admins ----------
alter table public.platform_admins add column if not exists role text not null default 'admin';
alter table public.platform_admins add column if not exists email text;
alter table public.platform_admins add column if not exists added_by uuid;
alter table public.platform_admins drop constraint if exists platform_admins_role_check;
alter table public.platform_admins add constraint platform_admins_role_check check (role in ('owner','admin','support'));

create or replace function public.platform_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.platform_admins where user_id = auth.uid();
$$;
grant execute on function public.platform_role() to authenticated;

-- The platform owner: claimed now if the account exists, or when it is first created.
insert into public.platform_admins (user_id, role, email)
  select id, 'owner', lower(email) from auth.users where lower(email) = 'ekwuemevictor39@gmail.com'
  on conflict (user_id) do update set role = 'owner', email = excluded.email;

create or replace function public.claim_platform_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'ekwuemevictor39@gmail.com' then
    insert into public.platform_admins (user_id, role, email) values (new.id, 'owner', lower(new.email))
      on conflict (user_id) do update set role = 'owner';
  end if;
  return new;
end $$;
drop trigger if exists claim_platform_owner on auth.users;
create trigger claim_platform_owner after insert on auth.users for each row execute function public.claim_platform_owner();

-- There is always exactly one owner, and the owner cannot be removed or demoted from a tenant session.
create or replace function public.platform_admins_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' then raise exception 'the platform owner cannot be removed'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    raise exception 'the platform owner cannot be demoted';
  end if;
  return new;
end $$;
drop trigger if exists platform_admins_guard on public.platform_admins;
create trigger platform_admins_guard before update or delete on public.platform_admins
  for each row execute function public.platform_admins_guard();

-- ---------- settings the platform keeps (group prices, bank details for invoices) ----------
create table if not exists public.platform_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;

insert into public.platform_settings (key, value) values
  ('group_prices', '{"core":[250000,530000,950000,1680000,2800000],"learning":[300000,630000,1130000,2000000,3300000],"exams":[250000,530000,950000,1680000,2800000],"money":[125000,265000,475000,840000,1400000],"safety":[125000,265000,475000,840000,1400000],"engagement":[100000,210000,375000,660000,1100000]}'::jsonb),
  ('billing', '{"company":"Synergy Swift Technologies Limited","bank_details":"","grace_days":14,"vat_pct":0}'::jsonb)
on conflict (key) do nothing;

-- ---------- plans ----------
alter table public.plans add column if not exists code text;
alter table public.plans add column if not exists groups text[] not null default '{}';
alter table public.plans add column if not exists prices bigint[];      -- naira a year per size band; null = priced by hand
alter table public.plans add column if not exists blurb text;
alter table public.plans add column if not exists active boolean not null default true;
alter table public.plans add column if not exists sort int not null default 0;
create unique index if not exists plans_code on public.plans(code) where code is not null;
update public.plans set active = false where code is null;            -- the old per-teacher price list

insert into public.plans (code, name, groups, prices, blurb, sort, features, price_cents) values
  ('essentials', 'Essentials', '{core}', '{250000,530000,950000,1680000,2800000}', 'Run the school: students, classes, results, attendance and the parent portal.', 1, '{}', 0),
  ('growth', 'Growth', '{core,learning,exams,money}', '{800000,1680000,3040000,5360000,8800000}', 'Everything in Essentials, plus learning, secure exams and fees.', 2, '{}', 0),
  ('complete', 'Complete', '{core,learning,exams,money,safety,engagement}', '{1000000,2100000,3800000,6700000,11000000}', 'The whole platform, including safety, admissions, elections and SEN.', 3, '{}', 0),
  ('custom', 'Custom', '{core}', null, 'Agreed modules and price for large schools and groups.', 4, '{}', 0)
on conflict (code) where code is not null do nothing;

-- ---------- tenants ----------
alter table public.tenants add column if not exists allowed_roles text[];          -- null = every staff role
alter table public.tenants add column if not exists billing_hold boolean not null default false;  -- paused for an unpaid bill

-- ---------- module overrides ----------
create table if not exists public.tenant_module_overrides (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  module      text not null check (module ~ '^[a-z_]{2,40}$'),
  mode        text not null check (mode in ('on','off')),
  expires_at  timestamptz,
  note        text check (length(note) <= 300),
  set_by      uuid,
  set_at      timestamptz not null default now(),
  primary key (tenant_id, module)
);
alter table public.tenant_module_overrides enable row level security;
drop policy if exists tmo_read on public.tenant_module_overrides;
create policy tmo_read on public.tenant_module_overrides for select using (tenant_id = public.my_tenant_id() and public.is_school_admin());
create index if not exists tmo_expiry on public.tenant_module_overrides(expires_at) where expires_at is not null;

-- Older schools had modules switched off by hand: keep those as overrides.
insert into public.tenant_module_overrides (tenant_id, module, mode, note)
  select t.id, m.key, 'off', 'switched off before plans existed'
  from public.tenants t, jsonb_each(t.modules) m
  where m.value = 'false'::jsonb and m.key ~ '^[a-z_]{2,40}$'
on conflict do nothing;

-- ---------- subscriptions ----------
-- Keep only the newest subscription row per school, then allow one.
delete from public.subscriptions s using public.subscriptions s2
  where s.tenant_id = s2.tenant_id and (s.created_at, s.id) < (s2.created_at, s2.id);
create unique index if not exists subscriptions_one_per_tenant on public.subscriptions(tenant_id);
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
update public.subscriptions set status = 'cancelled' where status = 'canceled';
alter table public.subscriptions add constraint subscriptions_status_check check (status in ('trial','active','past_due','suspended','cancelled'));
alter table public.subscriptions add column if not exists plan_id uuid references public.plans(id);
alter table public.subscriptions add column if not exists cycle text not null default 'annual';
alter table public.subscriptions add column if not exists band int;                       -- index into the size bands; null = above them
alter table public.subscriptions add column if not exists add_on_groups text[] not null default '{}';
alter table public.subscriptions add column if not exists custom_annual bigint;            -- agreed yearly price in naira
alter table public.subscriptions add column if not exists discount_pct numeric not null default 0;
alter table public.subscriptions add column if not exists period_start timestamptz;
alter table public.subscriptions add column if not exists period_end timestamptz;
alter table public.subscriptions add column if not exists grace_days int not null default 14;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions add column if not exists notes text;
alter table public.subscriptions add column if not exists updated_at timestamptz not null default now();
alter table public.subscriptions drop constraint if exists subscriptions_cycle_check;
alter table public.subscriptions add constraint subscriptions_cycle_check check (cycle in ('annual','termly'));
alter table public.subscriptions drop constraint if exists subscriptions_band_check;
alter table public.subscriptions add constraint subscriptions_band_check check (band is null or band between 0 and 4);
alter table public.subscriptions drop constraint if exists subscriptions_grace_check;
alter table public.subscriptions add constraint subscriptions_grace_check check (grace_days between 0 and 90);
alter table public.subscriptions drop constraint if exists subscriptions_discount_check;
alter table public.subscriptions add constraint subscriptions_discount_check check (discount_pct between 0 and 100);
-- Schools only read their subscription; the platform writes it.
drop policy if exists subscriptions_self on public.subscriptions;
create policy subscriptions_self on public.subscriptions for select using (tenant_id = public.my_tenant_id() and public.is_school_admin());

-- ---------- platform invoices ----------
create sequence if not exists public.platform_invoice_seq;
alter table public.invoices alter column amount_cents type bigint;
alter table public.invoices add column if not exists number text;
alter table public.invoices add column if not exists currency text not null default 'NGN';
alter table public.invoices add column if not exists kind text not null default 'renewal';
alter table public.invoices add column if not exists lines jsonb not null default '[]'::jsonb;
alter table public.invoices add column if not exists period_start timestamptz;
alter table public.invoices add column if not exists period_end timestamptz;
alter table public.invoices add column if not exists due_at timestamptz;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices add column if not exists method text;
alter table public.invoices add column if not exists reference text;
alter table public.invoices add column if not exists notes text;
alter table public.invoices add column if not exists created_by uuid;
update public.invoices set status = 'void' where status not in ('draft','open','paid','void');
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check check (status in ('draft','open','paid','void'));
alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check check (kind in ('new','renewal','add_on','adjustment'));
create unique index if not exists invoices_number on public.invoices(number) where number is not null;
create index if not exists invoices_tenant_status on public.invoices(tenant_id, status);

create or replace function public.next_platform_invoice_number()
returns text language sql security definer set search_path = public as $$
  select 'SS-' || to_char(now() at time zone 'Africa/Lagos', 'YYYY') || '-' || lpad(nextval('public.platform_invoice_seq')::text, 5, '0');
$$;
revoke all on function public.next_platform_invoice_number() from anon, authenticated;

-- Schools could insert their own invoice rows before: only the platform writes them now.
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_tenant on public.invoices;
create policy invoices_tenant on public.invoices for select using (tenant_id = public.my_tenant_id() and public.is_school_admin());

-- ---------- custom roles inside a school ----------
create table if not exists public.tenant_roles (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  name              text not null check (length(name) between 2 and 60),
  description       text check (length(description) <= 300),
  grants            text[] not null default '{}',
  deny_modules      text[] not null default '{}',
  deny_permissions  text[] not null default '{}',
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (not ('platform_admin' = any(grants)))
);
create unique index if not exists tenant_roles_name on public.tenant_roles(tenant_id, lower(name));
alter table public.tenant_roles enable row level security;
drop policy if exists tenant_roles_read on public.tenant_roles;
create policy tenant_roles_read on public.tenant_roles for select using (tenant_id = public.my_tenant_id());
drop policy if exists tenant_roles_write on public.tenant_roles;
create policy tenant_roles_write on public.tenant_roles for all
  using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

alter table public.users add column if not exists custom_role_id uuid references public.tenant_roles(id) on delete set null;

-- A custom role must belong to the same school as the person given it.
create or replace function public.users_custom_role_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.custom_role_id is not null and not exists (select 1 from public.tenant_roles r where r.id = new.custom_role_id and r.tenant_id = new.tenant_id) then
    raise exception 'that role belongs to another school';
  end if;
  return new;
end $$;
drop trigger if exists users_custom_role_check on public.users;
create trigger users_custom_role_check before insert or update of custom_role_id on public.users
  for each row execute function public.users_custom_role_check();

-- users_guard: as before (5 3200), and nobody gives themselves a custom role.
create or replace function public.users_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / SQL editor
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot be changed';
  end if;
  if new.password_changed_at is distinct from old.password_changed_at then
    raise exception 'password_changed_at is set by the server';
  end if;
  if (new.role is distinct from old.role or new.extra_roles is distinct from old.extra_roles
      or new.active is distinct from old.active or new.custom_role_id is distinct from old.custom_role_id) then
    if new.id = auth.uid() then
      raise exception 'you cannot change your own role or status';
    end if;
    if not public.is_school_admin() then
      raise exception 'only school admins can change roles';
    end if;
    if new.role = 'platform_admin' or 'platform_admin' = any(new.extra_roles) then
      raise exception 'platform_admin cannot be granted from a tenant';
    end if;
  end if;
  return new;
end $$;

-- ---------- requests from schools ----------
create table if not exists public.module_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  module        text not null check (module ~ '^[a-z_]{2,40}$'),
  action        text not null check (action in ('add','remove')),
  note          text check (length(note) <= 500),
  status        text not null default 'pending' check (status in ('pending','done','declined')),
  requested_by  uuid references public.users(id) on delete set null,
  handled_by    uuid,
  handled_at    timestamptz,
  reply         text check (length(reply) <= 500),
  created_at    timestamptz not null default now()
);
create index if not exists module_requests_pending on public.module_requests(status, created_at);
alter table public.module_requests enable row level security;
drop policy if exists module_requests_read on public.module_requests;
create policy module_requests_read on public.module_requests for select using (tenant_id = public.my_tenant_id() and public.is_school_admin());
drop policy if exists module_requests_insert on public.module_requests;
create policy module_requests_insert on public.module_requests for insert with check (
  tenant_id = public.my_tenant_id() and public.is_school_admin() and requested_by = auth.uid() and status = 'pending' and handled_by is null);
