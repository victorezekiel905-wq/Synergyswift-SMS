-- =========================================================================
-- EduClass Fusion — finance (v46)
-- Fees and invoices, payments (manual and online), receipts, expenses,
-- payroll, inventory and assets. Also: all new staff roles and SMS channel.
-- Apply AFTER 20260101001500_hardening.sql. Idempotent.
-- =========================================================================

-- ---------- Roles used by the v46 modules ----------
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in (
  'student','teacher','school_admin','it_admin','parent','platform_admin',
  'principal','bursar','librarian','hr_manager','qa_officer','gate_officer',
  'transport_officer','hostel_warden','nurse','admissions_officer'
));
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['teacher','school_admin','it_admin','platform_admin','principal',
    'bursar','librarian','hr_manager','qa_officer','gate_officer','transport_officer',
    'hostel_warden','nurse','admissions_officer']);
$$;
create or replace function public.is_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['bursar','school_admin','principal','platform_admin']);
$$;
grant execute on function public.is_finance() to authenticated;

-- ---------- SMS as a third channel ----------
alter table public.message_outbox drop constraint if exists message_outbox_channel_check;
alter table public.message_outbox add constraint message_outbox_channel_check check (channel in ('email','whatsapp','sms'));
alter table public.guardians add column if not exists notify_sms boolean not null default false;
alter table public.tenant_settings add column if not exists sms_mode text not null default 'fallback';
do $$ begin
  alter table public.tenant_settings add constraint tenant_settings_sms_mode_chk check (sms_mode in ('off','fallback','always'));
exception when duplicate_object then null; end $$;

-- ---------- Finance settings ----------
alter table public.tenant_settings add column if not exists withhold_results_for_debtors boolean not null default false;
alter table public.tenant_settings add column if not exists payment_provider text;            -- paystack | flutterwave | null (manual only)
alter table public.tenant_settings add column if not exists payment_subaccount text;          -- provider subaccount code: money settles to the school
alter table public.tenant_settings add column if not exists bank_details text;                -- shown on invoices for transfers

-- ---------- Document numbers (INV-2026-000001, RCT-2026-000001) ----------
create table if not exists public.doc_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind      text not null,
  year      int  not null,
  last      int  not null default 0,
  primary key (tenant_id, kind, year)
);
alter table public.doc_counters enable row level security;

create or replace function public.next_doc_no(p_tenant uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare v_year int := extract(year from now())::int; v_n int;
begin
  insert into public.doc_counters (tenant_id, kind, year, last) values (p_tenant, p_kind, v_year, 1)
  on conflict (tenant_id, kind, year) do update set last = public.doc_counters.last + 1
  returning last into v_n;
  return upper(p_kind) || '-' || v_year || '-' || lpad(v_n::text, 6, '0');
end $$;
revoke all on function public.next_doc_no(uuid, text) from public, anon, authenticated;

-- ---------- Fees ----------
create table if not exists public.fee_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.fee_schedules (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  term_id         uuid not null references public.terms(id) on delete cascade,
  class_group_id  uuid references public.class_groups(id) on delete cascade,   -- null = every class
  fee_item_id     uuid not null references public.fee_items(id) on delete cascade,
  amount          numeric(14,2) not null check (amount >= 0),
  optional        boolean not null default false,                               -- e.g. bus fee, only when added
  created_at      timestamptz not null default now(),
  unique nulls not distinct (term_id, class_group_id, fee_item_id)
);

create table if not exists public.fee_invoices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  term_id      uuid references public.terms(id) on delete set null,
  invoice_no   text not null,
  title        text not null default 'School fees',
  status       text not null default 'issued' check (status in ('issued','part_paid','paid','void')),
  total        numeric(14,2) not null default 0,
  amount_paid  numeric(14,2) not null default 0,
  due_date     date,
  notes        text,
  pay_token    text not null default encode(gen_random_bytes(24), 'hex'),
  created_by   uuid references public.users(id),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  unique (tenant_id, invoice_no),
  unique (pay_token)
);
create unique index if not exists fee_invoices_one_per_term on public.fee_invoices(student_id, term_id, title)
  where term_id is not null and status <> 'void';
create index if not exists fee_invoices_tenant on public.fee_invoices(tenant_id, status);

create table if not exists public.fee_invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.fee_invoices(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  fee_item_id  uuid references public.fee_items(id) on delete set null,
  kind         text not null default 'charge' check (kind in ('charge','discount','scholarship','adjustment')),
  description  text not null,
  amount       numeric(14,2) not null   -- negative for discounts / scholarships
);

create table if not exists public.fee_payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  invoice_id   uuid not null references public.fee_invoices(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  amount       numeric(14,2) not null check (amount > 0),
  currency     text not null default 'NGN',
  method       text not null check (method in ('cash','transfer','pos','cheque','online')),
  provider     text,
  reference    text not null,
  status       text not null default 'success' check (status in ('pending','success','failed','reversed')),
  receipt_no   text,
  payer_name   text,
  payer_email  text,
  recorded_by  uuid references public.users(id),
  meta         jsonb not null default '{}'::jsonb,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (tenant_id, reference)
);
create index if not exists fee_payments_invoice on public.fee_payments(invoice_id);

-- Totals and status are always derived, never typed in.
create or replace function public.fee_recalc(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_paid numeric; v_status text;
begin
  select coalesce(sum(amount), 0) into v_total from public.fee_invoice_lines where invoice_id = p_invoice;
  select coalesce(sum(amount), 0) into v_paid from public.fee_payments where invoice_id = p_invoice and status = 'success';
  select status into v_status from public.fee_invoices where id = p_invoice;
  if v_status is null then return; end if;
  if v_status <> 'void' then
    v_status := case when v_paid >= greatest(v_total, 0) and v_total > 0 then 'paid'
                     when v_total <= 0 then 'paid'
                     when v_paid > 0 then 'part_paid' else 'issued' end;
  end if;
  update public.fee_invoices set total = greatest(v_total, 0), amount_paid = v_paid, status = v_status where id = p_invoice;
end $$;
revoke all on function public.fee_recalc(uuid) from public, anon, authenticated;

create or replace function public.fee_lines_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.fee_recalc(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;
drop trigger if exists fee_lines_changed on public.fee_invoice_lines;
create trigger fee_lines_changed after insert or update or delete on public.fee_invoice_lines
  for each row execute function public.fee_lines_changed();

create or replace function public.fee_payment_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'success' and new.receipt_no is null then
    new.receipt_no := public.next_doc_no(new.tenant_id, 'rct');
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  return new;
end $$;
drop trigger if exists fee_payment_before on public.fee_payments;
create trigger fee_payment_before before insert or update on public.fee_payments
  for each row execute function public.fee_payment_before();
drop trigger if exists fee_payments_changed on public.fee_payments;
create trigger fee_payments_changed after insert or update or delete on public.fee_payments
  for each row execute function public.fee_lines_changed();

-- ---------- Expenses ----------
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  category        text not null,
  description     text not null,
  amount          numeric(14,2) not null check (amount > 0),
  spent_on        date not null default current_date,
  payee           text,
  method          text,
  reference       text,
  requisition_id  uuid references public.requisitions(id) on delete set null,
  recorded_by     uuid references public.users(id),
  created_at      timestamptz not null default now()
);

-- ---------- Payroll ----------
create table if not exists public.salary_profiles (
  staff_id         uuid primary key references public.staff(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  basic            numeric(14,2) not null default 0 check (basic >= 0),
  allowances       jsonb not null default '[]'::jsonb,   -- [{ name, amount }]
  deductions       jsonb not null default '[]'::jsonb,   -- [{ name, amount } | { name, percent }]  percent of basic
  tax_percent      numeric not null default 0 check (tax_percent between 0 and 100),
  pension_percent  numeric not null default 0 check (pension_percent between 0 and 100),
  bank_name        text,
  account_no       text,
  account_name     text,
  updated_at       timestamptz not null default now()
);

create table if not exists public.payroll_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  period        text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status        text not null default 'draft' check (status in ('draft','approved','paid')),
  gross         numeric(14,2) not null default 0,
  deductions    numeric(14,2) not null default 0,
  net           numeric(14,2) not null default 0,
  created_by    uuid references public.users(id),
  approved_by   uuid references public.users(id),
  approved_at   timestamptz,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, period)
);

create table if not exists public.payslips (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.payroll_runs(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  staff_id           uuid not null references public.staff(id) on delete cascade,
  basic              numeric(14,2) not null,
  allowances         jsonb not null default '[]'::jsonb,
  deductions         jsonb not null default '[]'::jsonb,
  gross              numeric(14,2) not null,
  total_deductions   numeric(14,2) not null,
  net                numeric(14,2) not null,
  unpaid_leave_days  numeric not null default 0,
  bank_name          text,
  account_no         text,
  account_name       text,
  unique (run_id, staff_id)
);

create or replace function public.payroll_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      if not public.has_role(array['school_admin','principal','platform_admin']) then
        raise exception 'only the principal or a school admin can approve payroll';
      end if;
      if old.created_by = auth.uid() then raise exception 'payroll must be approved by someone other than its preparer'; end if;
    end if;
    if new.status = 'paid' and old.status <> 'approved' then raise exception 'approve payroll before marking it paid'; end if;
    if new.status = 'draft' and old.status = 'paid' then raise exception 'a paid payroll cannot be reopened'; end if;
  end if;
  return new;
end $$;
drop trigger if exists payroll_guard on public.payroll_runs;
create trigger payroll_guard before update on public.payroll_runs for each row execute function public.payroll_guard();

-- ---------- Inventory and assets ----------
create table if not exists public.inventory_items (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  name           text not null,
  sku            text,
  category       text,
  unit           text not null default 'pcs',
  quantity       numeric not null default 0,
  reorder_level  numeric not null default 0,
  unit_cost      numeric(14,2) not null default 0,
  location       text,
  created_at     timestamptz not null default now(),
  unique (tenant_id, name)
);
create table if not exists public.inventory_moves (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  item_id      uuid not null references public.inventory_items(id) on delete cascade,
  kind         text not null check (kind in ('in','out','adjust')),
  quantity     numeric not null,
  reason       text,
  reference    text,
  recorded_by  uuid references public.users(id),
  at           timestamptz not null default now()
);

create or replace function public.inventory_move(p_item uuid, p_kind text, p_qty numeric, p_reason text, p_ref text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_new numeric; v_tenant uuid;
begin
  if not public.has_role(array['bursar','school_admin','principal','platform_admin']) then raise exception 'forbidden'; end if;
  if p_kind not in ('in','out','adjust') then raise exception 'bad kind'; end if;
  if p_kind <> 'adjust' and p_qty <= 0 then raise exception 'quantity must be positive'; end if;
  update public.inventory_items
     set quantity = case p_kind when 'in' then quantity + p_qty when 'out' then quantity - p_qty else p_qty end
   where id = p_item and tenant_id = public.my_tenant_id()
   returning quantity, tenant_id into v_new, v_tenant;
  if v_tenant is null then raise exception 'item not found'; end if;
  if v_new < 0 then raise exception 'not enough stock'; end if;
  insert into public.inventory_moves (tenant_id, item_id, kind, quantity, reason, reference, recorded_by)
  values (v_tenant, p_item, p_kind, p_qty, p_reason, p_ref, auth.uid());
  return v_new;
end $$;
grant execute on function public.inventory_move(uuid, text, numeric, text, text) to authenticated;

create table if not exists public.assets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  tag             text not null,
  name            text not null,
  category        text,
  location        text,
  assigned_staff  uuid references public.staff(id) on delete set null,
  condition       text not null default 'good' check (condition in ('new','good','fair','poor','broken')),
  status          text not null default 'in_use' check (status in ('in_use','in_store','repair','retired','lost')),
  purchase_date   date,
  cost            numeric(14,2),
  notes           text,
  created_at      timestamptz not null default now(),
  unique (tenant_id, tag)
);

-- ---------- RLS ----------
alter table public.fee_items         enable row level security;
alter table public.fee_schedules     enable row level security;
alter table public.fee_invoices      enable row level security;
alter table public.fee_invoice_lines enable row level security;
alter table public.fee_payments      enable row level security;
alter table public.expenses          enable row level security;
alter table public.salary_profiles   enable row level security;
alter table public.payroll_runs      enable row level security;
alter table public.payslips          enable row level security;
alter table public.inventory_items   enable row level security;
alter table public.inventory_moves   enable row level security;
alter table public.assets            enable row level security;

do $$
declare t text;
begin
  -- finance-only tables: read and write by bursar / admins
  foreach t in array array['fee_items','fee_schedules','expenses','inventory_moves'] loop
    execute format('drop policy if exists %I on public.%I', t || '_finance', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_finance()) with check (tenant_id = public.my_tenant_id() and public.is_finance())', t || '_finance', t);
  end loop;
  -- stock and assets: every staff member can look things up; finance edits
  foreach t in array array['inventory_items','assets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.my_tenant_id() and public.is_staff())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_finance()) with check (tenant_id = public.my_tenant_id() and public.is_finance())', t || '_write', t);
  end loop;
end $$;

-- invoices: finance manages; the student and their guardians can read theirs
drop policy if exists fee_invoices_read on public.fee_invoices;
create policy fee_invoices_read on public.fee_invoices for select using (
  tenant_id = public.my_tenant_id() and (public.is_finance() or public.is_guardian_of(student_id)
    or exists (select 1 from public.students s where s.id = fee_invoices.student_id and s.user_id = auth.uid())));
drop policy if exists fee_invoices_write on public.fee_invoices;
create policy fee_invoices_write on public.fee_invoices for all using (tenant_id = public.my_tenant_id() and public.is_finance())
  with check (tenant_id = public.my_tenant_id() and public.is_finance());

drop policy if exists fee_lines_read on public.fee_invoice_lines;
create policy fee_lines_read on public.fee_invoice_lines for select using (
  exists (select 1 from public.fee_invoices i where i.id = fee_invoice_lines.invoice_id and i.tenant_id = public.my_tenant_id()
          and (public.is_finance() or public.is_guardian_of(i.student_id)
               or exists (select 1 from public.students s where s.id = i.student_id and s.user_id = auth.uid()))));
drop policy if exists fee_lines_write on public.fee_invoice_lines;
create policy fee_lines_write on public.fee_invoice_lines for all using (tenant_id = public.my_tenant_id() and public.is_finance())
  with check (tenant_id = public.my_tenant_id() and public.is_finance());

-- payments: written only by the server (after provider verification or by a bursar through the API)
drop policy if exists fee_payments_read on public.fee_payments;
create policy fee_payments_read on public.fee_payments for select using (
  tenant_id = public.my_tenant_id() and (public.is_finance() or public.is_guardian_of(student_id)
    or exists (select 1 from public.students s where s.id = fee_payments.student_id and s.user_id = auth.uid())));

-- payroll: HR and finance manage; staff read their own finished payslips
drop policy if exists salary_profiles_rw on public.salary_profiles;
create policy salary_profiles_rw on public.salary_profiles for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin']));
drop policy if exists salary_profiles_self on public.salary_profiles;
create policy salary_profiles_self on public.salary_profiles for select using (
  exists (select 1 from public.staff s where s.id = salary_profiles.staff_id and s.user_id = auth.uid()));

drop policy if exists payroll_runs_rw on public.payroll_runs;
create policy payroll_runs_rw on public.payroll_runs for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin']));

drop policy if exists payslips_rw on public.payslips;
create policy payslips_rw on public.payslips for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin'])
) with check (tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin'])
  and exists (select 1 from public.payroll_runs r where r.id = payslips.run_id and r.status = 'draft'));
-- Staff cannot read payroll_runs, so the release check runs as definer.
create or replace function public.payroll_run_released(p_run uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payroll_runs where id = p_run and status in ('approved','paid'));
$$;
grant execute on function public.payroll_run_released(uuid) to authenticated;
drop policy if exists payslips_self on public.payslips;
create policy payslips_self on public.payslips for select using (
  exists (select 1 from public.staff s where s.id = payslips.staff_id and s.user_id = auth.uid())
  and public.payroll_run_released(run_id));
