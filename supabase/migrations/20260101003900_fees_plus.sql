-- =========================================================================
-- EduClass Fusion: fees (phase 9a).
--  * fee categories (day, boarding, staff child …) and optional extras a
--    family chooses (bus, lunch, clubs, uniform) on fee schedules.
--  * fee_discount_rules (sibling, staff child, category) and fee_awards
--    (scholarships, bursaries, waivers) applied when invoices are made.
--  * installment_plans and invoice_installments; late fees; automatic
--    reminders before and after due dates.
--  * payment_claims: parents report a bank transfer with proof; the bursary confirms.
--  * Remita and Stripe keys per school (integration_secrets).
-- Apply AFTER 20260101003800. Idempotent.
-- =========================================================================

alter table public.students add column if not exists fee_category text;
alter table public.fee_schedules add column if not exists category text;     -- null = every category
do $$ begin
  alter table public.fee_schedules drop constraint if exists fee_schedules_term_id_class_group_id_fee_item_id_key;
exception when undefined_object then null; end $$;
drop index if exists public.fee_schedules_term_id_class_group_id_fee_item_id_key;
create unique index if not exists fee_schedules_unique on public.fee_schedules(term_id, class_group_id, fee_item_id, category) nulls not distinct;

-- Optional extras a family has chosen (term null = every term until removed).
create table if not exists public.fee_optional_choices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  fee_item_id  uuid not null references public.fee_items(id) on delete cascade,
  term_id      uuid references public.terms(id) on delete cascade,
  chosen_by    text not null default 'school' check (chosen_by in ('school','parent')),
  created_at   timestamptz not null default now()
);
create unique index if not exists fee_optional_choices_once on public.fee_optional_choices(student_id, fee_item_id, term_id) nulls not distinct;

create table if not exists public.fee_discount_rules (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  name           text not null check (length(name) between 2 and 80),
  kind           text not null check (kind in ('sibling','staff_child','category')),
  percent        numeric check (percent > 0 and percent <= 100),
  amount         numeric check (amount > 0),
  nth_child      int check (nth_child between 2 and 10),     -- sibling: from this child on (2 = second child)
  category       text,                                         -- kind category: students in this fee category
  item_ids       uuid[] not null default '{}',                  -- empty = every charge
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  check ((percent is not null) <> (amount is not null)),
  check (kind <> 'sibling' or nth_child is not null),
  check (kind <> 'category' or category is not null)
);

create table if not exists public.fee_awards (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  kind         text not null default 'scholarship' check (kind in ('scholarship','bursary','waiver','discount')),
  name         text not null check (length(name) between 2 and 120),
  percent      numeric check (percent > 0 and percent <= 100),
  amount       numeric check (amount > 0),
  item_ids     uuid[] not null default '{}',
  valid_from   date not null default current_date,
  valid_to     date,
  note         text,
  approved_by  uuid references public.users(id) on delete set null,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check ((percent is not null) <> (amount is not null)),
  check (valid_to is null or valid_to >= valid_from)
);
create index if not exists fee_awards_student on public.fee_awards(student_id);

-- An award takes effect once someone other than the person who entered it approves it.
create or replace function public.fee_award_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.approved_by := null; return new; end if;
  if new.approved_by is distinct from old.approved_by then
    if new.approved_by is not null and (new.approved_by <> auth.uid() or old.created_by = auth.uid()) then
      raise exception 'a scholarship or waiver must be approved by someone other than the person who entered it';
    end if;
  end if;
  if old.approved_by is not null and (new.percent is distinct from old.percent or new.amount is distinct from old.amount or new.item_ids <> old.item_ids or new.student_id <> old.student_id) then
    new.approved_by := null;   -- changing an approved award needs approving again
  end if;
  return new;
end $$;
drop trigger if exists fee_award_guard on public.fee_awards;
create trigger fee_award_guard before insert or update on public.fee_awards for each row execute function public.fee_award_guard();

-- ---------- instalments, late fees, reminders ----------
create table if not exists public.installment_plans (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(name) between 2 and 80),
  parts       jsonb not null,             -- [{ label, percent, days_after }]
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
create table if not exists public.invoice_installments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  invoice_id        uuid not null references public.fee_invoices(id) on delete cascade,
  seq               int not null check (seq between 1 and 24),
  label             text not null,
  amount            numeric(14,2) not null check (amount > 0),
  due_date          date not null,
  late_fee_applied  boolean not null default false,
  reminded_at       timestamptz,
  unique (invoice_id, seq)
);

alter table public.fee_invoices add column if not exists late_fee_applied_at timestamptz;
alter table public.fee_invoices add column if not exists last_reminded_at timestamptz;
do $$ begin
  alter table public.fee_invoice_lines drop constraint if exists fee_invoice_lines_kind_check;
  alter table public.fee_invoice_lines add constraint fee_invoice_lines_kind_check check (kind in ('charge','discount','scholarship','adjustment','late_fee'));
end $$;
alter table public.fee_invoice_lines add column if not exists source text;   -- e.g. rule:<id>, award:<id>

alter table public.tenant_settings add column if not exists late_fee_percent numeric not null default 0;
alter table public.tenant_settings add column if not exists late_fee_amount numeric not null default 0;
alter table public.tenant_settings add column if not exists late_fee_grace_days int not null default 7;
alter table public.tenant_settings add column if not exists remind_days_before int not null default 3;
alter table public.tenant_settings add column if not exists remind_every_days int not null default 7;     -- after the due date; 0 = off
alter table public.tenant_settings add column if not exists auto_fee_reminders boolean not null default false;
alter table public.tenant_settings add column if not exists accept_transfer_claims boolean not null default true;
do $$ begin
  alter table public.tenant_settings drop constraint if exists tenant_settings_fee_rules_check;
  alter table public.tenant_settings add constraint tenant_settings_fee_rules_check check (late_fee_percent between 0 and 50 and late_fee_amount >= 0
    and late_fee_grace_days between 0 and 90 and remind_days_before between 0 and 30 and remind_every_days between 0 and 60);
end $$;

-- ---------- bank transfers reported by parents ----------
create table if not exists public.payment_claims (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  invoice_id     uuid not null references public.fee_invoices(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  amount         numeric(14,2) not null check (amount > 0),
  paid_on        date not null,
  bank_reference text not null check (length(bank_reference) between 3 and 80),
  payer_name     text,
  proof_path     text,
  status         text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  payment_id     uuid references public.fee_payments(id) on delete set null,
  decided_by     uuid references public.users(id) on delete set null,
  decided_at     timestamptz,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists payment_claims_pending on public.payment_claims(tenant_id, status, created_at);
insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false) on conflict (id) do nothing;

do $$ begin
  alter table public.integration_secrets drop constraint if exists integration_secrets_provider_check;
  alter table public.integration_secrets add constraint integration_secrets_provider_check check (provider in ('zoom','remita','stripe'));
end $$;

-- ---------- RLS ----------
-- is_finance() (bursar, admins, principal) comes from 20260101001600; cashiers stay at the till.

alter table public.fee_optional_choices enable row level security;
drop policy if exists fee_optional_read on public.fee_optional_choices;
create policy fee_optional_read on public.fee_optional_choices for select using (tenant_id = public.my_tenant_id() and (public.is_finance() or public.is_guardian_of(student_id)));
drop policy if exists fee_optional_write on public.fee_optional_choices;
create policy fee_optional_write on public.fee_optional_choices for all using (tenant_id = public.my_tenant_id() and public.is_finance()) with check (tenant_id = public.my_tenant_id() and public.is_finance());

alter table public.fee_discount_rules enable row level security;
drop policy if exists fee_rules_read on public.fee_discount_rules;
create policy fee_rules_read on public.fee_discount_rules for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists fee_rules_write on public.fee_discount_rules;
create policy fee_rules_write on public.fee_discount_rules for all using (tenant_id = public.my_tenant_id() and public.has_role(array['bursar','school_admin','principal','platform_admin']))
  with check (tenant_id = public.my_tenant_id() and public.has_role(array['bursar','school_admin','principal','platform_admin']));

alter table public.fee_awards enable row level security;
drop policy if exists fee_awards_read on public.fee_awards;
create policy fee_awards_read on public.fee_awards for select using (tenant_id = public.my_tenant_id() and (public.has_role(array['bursar','school_admin','principal','platform_admin']) or public.is_guardian_of(student_id)));
drop policy if exists fee_awards_write on public.fee_awards;
create policy fee_awards_write on public.fee_awards for all using (tenant_id = public.my_tenant_id() and public.has_role(array['bursar','school_admin','principal','platform_admin']))
  with check (tenant_id = public.my_tenant_id() and public.has_role(array['bursar','school_admin','principal','platform_admin']));

alter table public.installment_plans enable row level security;
drop policy if exists installment_plans_read on public.installment_plans;
create policy installment_plans_read on public.installment_plans for select using (tenant_id = public.my_tenant_id());
drop policy if exists installment_plans_write on public.installment_plans;
create policy installment_plans_write on public.installment_plans for all using (tenant_id = public.my_tenant_id() and public.has_role(array['bursar','school_admin','principal','platform_admin']))
  with check (tenant_id = public.my_tenant_id() and public.has_role(array['bursar','school_admin','principal','platform_admin']));

alter table public.invoice_installments enable row level security;
drop policy if exists invoice_installments_read on public.invoice_installments;
create policy invoice_installments_read on public.invoice_installments for select using (tenant_id = public.my_tenant_id()
  and (public.is_finance() or exists (select 1 from public.fee_invoices i where i.id = invoice_id and (public.is_guardian_of(i.student_id) or public.is_student_self(i.student_id)))));
drop policy if exists invoice_installments_write on public.invoice_installments;
create policy invoice_installments_write on public.invoice_installments for all using (tenant_id = public.my_tenant_id() and public.has_role(array['bursar','school_admin','principal','platform_admin']))
  with check (tenant_id = public.my_tenant_id() and public.has_role(array['bursar','school_admin','principal','platform_admin']));

alter table public.payment_claims enable row level security;
drop policy if exists payment_claims_read on public.payment_claims;
create policy payment_claims_read on public.payment_claims for select using (tenant_id = public.my_tenant_id() and (public.is_finance() or public.is_guardian_of(student_id)));
-- Claims are made through the pay link and settled by the server after a finance check.

grant all on public.fee_optional_choices, public.fee_discount_rules, public.fee_awards, public.installment_plans, public.invoice_installments, public.payment_claims to service_role;

select public.attach_change_log();
