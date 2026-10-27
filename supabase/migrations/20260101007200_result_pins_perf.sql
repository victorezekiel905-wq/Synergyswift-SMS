-- =========================================================================
-- Synergy Swift: result PINs and performance budgets (Phase 14l).
--  * result_pin_batches / result_pins: scratch cards a school prints or sells.
--    A parent enters the admission number and the PIN on the school's result
--    checker page and sees the published report card. Each PIN works a set
--    number of times, belongs to the first student it is used for, and is
--    stored only as a hash (the school prints PINs when the batch is made).
--  * result_pin_tries: slows down guessing (per address and per student).
--  * perf_samples: page speed from real browsers (web vitals) and slow
--    database calls, for the super admin centre's performance budgets.
-- Idempotent.
-- =========================================================================

create table if not exists public.result_pin_batches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 80),
  term_id     uuid references public.terms(id) on delete set null,   -- null: any published term
  max_uses    int not null default 5 check (max_uses between 1 and 50),
  price       numeric not null default 0 check (price >= 0),
  pins        int not null check (pins between 1 and 5000),
  expires_on  date,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.result_pins (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  batch_id       uuid not null references public.result_pin_batches(id) on delete cascade,
  serial         text not null,
  pin_hash       text not null,
  student_id     uuid references public.students(id) on delete set null,
  uses           int not null default 0,
  status         text not null default 'active' check (status in ('active','void')),
  first_used_at  timestamptz,
  last_used_at   timestamptz,
  unique (tenant_id, serial),
  unique (tenant_id, pin_hash)
);
create index if not exists result_pins_batch on public.result_pins(batch_id);
create sequence if not exists public.result_pin_serial_seq;
revoke all on sequence public.result_pin_serial_seq from anon, authenticated;

create table if not exists public.result_pin_tries (
  id    bigint generated always as identity primary key,
  key   text not null,
  at    timestamptz not null default now()
);
create index if not exists result_pin_tries_key on public.result_pin_tries(key, at desc);

-- Staff who run results and fees see batches and PIN use; the server makes and checks PINs.
alter table public.result_pin_batches enable row level security;
alter table public.result_pins enable row level security;
alter table public.result_pin_tries enable row level security;
revoke all on public.result_pin_tries from anon, authenticated;
drop policy if exists result_pin_batches_read on public.result_pin_batches;
create policy result_pin_batches_read on public.result_pin_batches for select using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','bursar','exam_officer']));
drop policy if exists result_pins_read on public.result_pins;
create policy result_pins_read on public.result_pins for select using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','bursar','exam_officer']));
grant select on public.result_pin_batches, public.result_pins to authenticated;

-- ---------- performance ----------
create table if not exists public.perf_samples (
  id        bigint generated always as identity primary key,
  kind      text not null check (kind in ('vital','slow_call')),
  name      text not null check (length(name) <= 60),     -- LCP, INP, CLS, TTFB, FCP; or the table / function called
  path      text check (length(path) <= 200),             -- the page (with ids replaced) or the API route
  value     double precision not null,                    -- milliseconds (CLS: unitless)
  rating    text check (rating in ('good','needs-improvement','poor')),
  at        timestamptz not null default now()
);
create index if not exists perf_samples_recent on public.perf_samples(kind, at desc);
alter table public.perf_samples enable row level security;
revoke all on public.perf_samples from anon, authenticated;
