-- =====================================================================
--  Phase 10b: statutory payroll, appraisals, lesson observation responses and CPD.
--
--  * HR and payroll settings per school: Nigerian PAYE (Nigeria Tax Act 2025
--    bands, or the school's own) or a flat rate; pension (employee and employer
--    shares on basic + housing + transport), NHF, NHIS, NSITF and ITF; rent
--    relief; leave year; CPD target hours.
--  * Pay grades; salary profiles linked to a grade, with rent, NHF and NHIS
--    choices; staff loans and salary advances repaid through payroll.
--  * Payslips keep PAYE, pension, NHF, employer contributions and loan
--    repayments; loans go down when a run is marked paid.
--  * Appraisal cycles with criteria; self-review, the reviewer's review (shown
--    to the person only at the discussion stage), goals and acknowledgement.
--  * Teachers acknowledge and answer lesson observations.
--  * CPD activities logged by staff and verified by HR.
-- =====================================================================

-- ---------- Settings ----------
create table if not exists public.hr_settings (
  tenant_id              uuid primary key references public.tenants(id) on delete cascade,
  tax_regime             text not null default 'nta2025' check (tax_regime in ('nta2025','flat')),
  tax_bands              jsonb,            -- [{ "upto": 800000, "rate": 0 }, …, { "upto": null, "rate": 25 }]; null = the Act's bands
  pension_employee_pct   numeric not null default 8  check (pension_employee_pct between 0 and 100),
  pension_employer_pct   numeric not null default 10 check (pension_employer_pct between 0 and 100),
  nhf_pct                numeric not null default 2.5 check (nhf_pct between 0 and 100),
  nhis_employee_pct      numeric not null default 0 check (nhis_employee_pct between 0 and 100),
  nhis_employer_pct      numeric not null default 0 check (nhis_employer_pct between 0 and 100),
  nsitf_pct              numeric not null default 1 check (nsitf_pct between 0 and 100),
  itf_pct                numeric not null default 0 check (itf_pct between 0 and 100),
  rent_relief_pct        numeric not null default 20 check (rent_relief_pct between 0 and 100),
  rent_relief_cap        numeric not null default 500000 check (rent_relief_cap >= 0),
  prorate_joiners        boolean not null default true,
  leave_year_start_month int not null default 1 check (leave_year_start_month between 1 and 12),
  cpd_target_hours       numeric not null default 20 check (cpd_target_hours between 0 and 1000),
  updated_at             timestamptz not null default now()
);

-- ---------- Pay ----------
create table if not exists public.pay_grades (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  basic       numeric(14,2) not null check (basic >= 0),
  allowances  jsonb not null default '[]'::jsonb,     -- [{ name, amount, pensionable?, taxable? }]
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table public.salary_profiles add column if not exists grade_id uuid references public.pay_grades(id) on delete set null;
alter table public.salary_profiles add column if not exists annual_rent numeric(14,2) not null default 0 check (annual_rent >= 0);
alter table public.salary_profiles add column if not exists nhf boolean not null default false;
alter table public.salary_profiles add column if not exists nhis boolean not null default false;
alter table public.salary_profiles add column if not exists pension_exempt boolean not null default false;

create table if not exists public.staff_loans (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  staff_id           uuid not null references public.staff(id) on delete cascade,
  kind               text not null default 'loan' check (kind in ('loan','advance')),
  principal          numeric(14,2) not null check (principal > 0),
  monthly_deduction  numeric(14,2) not null check (monthly_deduction > 0),
  balance            numeric(14,2) not null check (balance >= 0),
  start_period       text not null check (start_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status             text not null default 'active' check (status in ('active','settled','cancelled')),
  note               text,
  created_by         uuid references public.users(id) on delete set null,
  approved_by        uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists staff_loans_staff on public.staff_loans(staff_id, status);

alter table public.payslips add column if not exists paye numeric(14,2) not null default 0;
alter table public.payslips add column if not exists taxable_income numeric(14,2) not null default 0;     -- annualised, after reliefs
alter table public.payslips add column if not exists pension_employee numeric(14,2) not null default 0;
alter table public.payslips add column if not exists pension_employer numeric(14,2) not null default 0;
alter table public.payslips add column if not exists nhf numeric(14,2) not null default 0;
alter table public.payslips add column if not exists employer_contributions jsonb not null default '[]'::jsonb;
alter table public.payslips add column if not exists employer_total numeric(14,2) not null default 0;
alter table public.payslips add column if not exists loan_repayments jsonb not null default '[]'::jsonb;   -- [{ loan_id, amount }]
alter table public.payslips add column if not exists days_worked numeric;      -- set when pay was prorated (joined or left mid-month)
alter table public.payroll_runs add column if not exists employer_total numeric(14,2) not null default 0;

-- A loan is approved by someone other than the person who entered it; a staff member never approves their own.
create or replace function public.staff_loan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Repayments are booked by the payroll trigger (one level down), not by a person.
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.approved_by := null; new.balance := new.principal;
    return new;
  end if;
  if new.approved_by is distinct from old.approved_by then
    if new.approved_by is not null then
      if not public.has_role(array['school_admin','principal','platform_admin']) then raise exception 'only the principal or a school admin can approve a loan'; end if;
      if old.created_by = auth.uid() then raise exception 'a loan must be approved by someone other than the person who entered it'; end if;
      if exists (select 1 from public.staff s where s.id = new.staff_id and s.user_id = auth.uid()) then raise exception 'you cannot approve your own loan'; end if;
      new.approved_by := auth.uid();
    end if;
  end if;
  if old.approved_by is not null and (new.principal is distinct from old.principal or new.balance is distinct from old.balance) then
    raise exception 'an approved loan changes only through payroll; cancel it and enter a new one';
  end if;
  return new;
end $$;
drop trigger if exists staff_loan_guard on public.staff_loans;
create trigger staff_loan_guard before insert or update on public.staff_loans for each row execute function public.staff_loan_guard();

-- When a run is paid, its loan repayments come off the balances (once: a run is paid only once).
create or replace function public.payroll_paid_loans() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    for r in select (x ->> 'loan_id')::uuid as loan_id, sum((x ->> 'amount')::numeric) as amount
             from public.payslips p, jsonb_array_elements(p.loan_repayments) x where p.run_id = new.id group by 1 loop
      update public.staff_loans set balance = greatest(0, balance - r.amount),
        status = case when balance - r.amount <= 0 then 'settled' else status end
        where id = r.loan_id and tenant_id = new.tenant_id;
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists payroll_paid_loans on public.payroll_runs;
create trigger payroll_paid_loans after update on public.payroll_runs for each row execute function public.payroll_paid_loans();

-- ---------- Appraisals ----------
create table if not exists public.appraisal_cycles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  starts_on    date not null,
  ends_on      date not null,
  status       text not null default 'draft' check (status in ('draft','open','closed')),
  criteria     jsonb not null default '[]'::jsonb,   -- [{ "id": "c1", "label": "Planning", "weight": 20 }]
  self_review  boolean not null default true,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (tenant_id, name)
);
create table if not exists public.appraisals (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  cycle_id           uuid not null references public.appraisal_cycles(id) on delete cascade,
  staff_id           uuid not null references public.staff(id) on delete cascade,
  reviewer_id        uuid references public.users(id) on delete set null,
  status             text not null default 'self_review' check (status in ('self_review','review','discussion','completed')),
  self_scores        jsonb not null default '{}'::jsonb,
  self_comments      text,
  self_submitted_at  timestamptz,
  goals              jsonb not null default '[]'::jsonb,   -- [{ text, measure, due_on, status }]
  staff_comment      text,
  acknowledged_at    timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (cycle_id, staff_id)
);
create table if not exists public.appraisal_reviews (
  appraisal_id    uuid primary key references public.appraisals(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  scores          jsonb not null default '{}'::jsonb,
  overall         numeric check (overall between 0 and 5),
  strengths       text,
  development     text,
  recommendation  text check (recommendation in ('confirm','promote','increment','support_plan','none')),
  submitted_at    timestamptz,
  updated_at      timestamptz not null default now()
);

create or replace function public.is_appraisal_reviewer(p_appraisal uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.appraisals a where a.id = p_appraisal and a.tenant_id = public.my_tenant_id() and a.reviewer_id = auth.uid());
$$;
-- The person sees the reviewer's view once it reaches the discussion.
create or replace function public.appraisal_shared(p_appraisal uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.appraisals a where a.id = p_appraisal and a.tenant_id = public.my_tenant_id()
                 and a.staff_id = public.my_staff_id() and a.status in ('discussion','completed'));
$$;
grant execute on function public.is_appraisal_reviewer(uuid) to authenticated;
grant execute on function public.appraisal_shared(uuid) to authenticated;

-- Who moves an appraisal on, and what each person may write.
create or replace function public.appraisal_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_self boolean; v_reviewer boolean; v_hr boolean;
begin
  if auth.uid() is null then return new; end if;
  v_hr := public.is_hr();
  v_self := new.staff_id = public.my_staff_id();
  v_reviewer := old.reviewer_id = auth.uid();
  if v_self and v_reviewer then raise exception 'you cannot review yourself'; end if;
  if v_hr and not v_self then
    if new.status = 'completed' and old.status <> 'completed' then new.completed_at := now(); end if;
    return new;
  end if;
  if new.staff_id is distinct from old.staff_id or new.cycle_id is distinct from old.cycle_id or new.reviewer_id is distinct from old.reviewer_id then
    raise exception 'only HR assigns appraisals';
  end if;
  if v_self then
    if (new.self_scores is distinct from old.self_scores or new.self_comments is distinct from old.self_comments) and old.status <> 'self_review' then
      raise exception 'your self-review has been sent';
    end if;
    if new.goals is distinct from old.goals then raise exception 'goals are agreed with your reviewer'; end if;
    if new.status is distinct from old.status then
      if old.status = 'self_review' and new.status = 'review' then new.self_submitted_at := now();
      elsif old.status = 'discussion' and new.status = 'completed' then new.acknowledged_at := now(); new.completed_at := now();
      else raise exception 'you cannot move your appraisal to %', new.status; end if;
    end if;
    if new.staff_comment is distinct from old.staff_comment and old.status <> 'discussion' then raise exception 'you can comment once you have discussed the review'; end if;
    return new;
  end if;
  if v_reviewer then
    if new.self_scores is distinct from old.self_scores or new.self_comments is distinct from old.self_comments or new.staff_comment is distinct from old.staff_comment
       or new.acknowledged_at is distinct from old.acknowledged_at then
      raise exception 'that part belongs to the person being appraised';
    end if;
    if new.status is distinct from old.status then
      if old.status in ('self_review','review') and new.status = 'discussion' then
        if not exists (select 1 from public.appraisal_reviews r where r.appraisal_id = new.id and r.submitted_at is not null) then
          raise exception 'finish your review before sharing it';
        end if;
      elsif old.status = 'self_review' and new.status = 'review' then null;   -- go ahead without a self-review
      else raise exception 'you cannot move this appraisal to %', new.status; end if;
    end if;
    if old.status = 'completed' then raise exception 'this appraisal is complete'; end if;
    return new;
  end if;
  raise exception 'this appraisal is not yours';
end $$;
drop trigger if exists appraisal_guard on public.appraisals;
create trigger appraisal_guard before update on public.appraisals for each row execute function public.appraisal_guard();

create or replace function public.appraisal_review_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text; v_tenant uuid;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  select status, tenant_id into v_status, v_tenant from public.appraisals where id = case when tg_op = 'DELETE' then old.appraisal_id else new.appraisal_id end;
  if v_status = 'completed' and not public.is_hr() then raise exception 'this appraisal is complete'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if v_tenant is distinct from new.tenant_id then raise exception 'appraisal not found'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists appraisal_review_guard on public.appraisal_reviews;
create trigger appraisal_review_guard before insert or update or delete on public.appraisal_reviews for each row execute function public.appraisal_review_guard();

-- ---------- Lesson observations: the teacher's reply ----------
alter table public.qa_observations add column if not exists acknowledged_at timestamptz;
alter table public.qa_observations add column if not exists teacher_response text;
create or replace function public.acknowledge_observation(p_id uuid, p_response text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.qa_observations set acknowledged_at = coalesce(acknowledged_at, now()), teacher_response = nullif(left(trim(coalesce(p_response, '')), 2000), '')
    where id = p_id and tenant_id = public.my_tenant_id() and staff_id = public.my_staff_id();
  if not found then raise exception 'observation not found'; end if;
end $$;
revoke all on function public.acknowledge_observation(uuid, text) from public, anon;
grant execute on function public.acknowledge_observation(uuid, text) to authenticated;

-- ---------- CPD ----------
create table if not exists public.cpd_activities (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  title        text not null check (length(trim(title)) between 1 and 200),
  provider     text,
  kind         text not null default 'workshop' check (kind in ('workshop','course','conference','in_house','online','mentoring','reading','other')),
  starts_on    date not null,
  ends_on      date,
  hours        numeric not null check (hours > 0 and hours <= 1000),
  cost         numeric(14,2) check (cost >= 0),
  document_id  uuid references public.staff_documents(id) on delete set null,
  status       text not null default 'completed' check (status in ('planned','completed')),
  reflection   text,
  verified_by  uuid references public.users(id) on delete set null,
  verified_at  timestamptz,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists cpd_staff on public.cpd_activities(staff_id, starts_on desc);

create or replace function public.cpd_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  if public.is_hr() then
    if tg_op <> 'DELETE' then
      if tg_op = 'INSERT' then
        if new.verified_at is not null then new.verified_by := auth.uid(); new.verified_at := now(); end if;
      elsif new.verified_at is not null and old.verified_at is null then new.verified_by := auth.uid(); new.verified_at := now();
      elsif new.verified_at is null then new.verified_by := null; end if;
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'INSERT' and old.verified_at is not null then raise exception 'HR has verified this activity; ask HR to change it'; end if;
  if tg_op = 'DELETE' then return old; end if;
  new.verified_by := null; new.verified_at := null;
  return new;
end $$;
drop trigger if exists cpd_guard on public.cpd_activities;
create trigger cpd_guard before insert or update or delete on public.cpd_activities for each row execute function public.cpd_guard();

-- ---------- RLS ----------
alter table public.hr_settings enable row level security;
drop policy if exists hr_settings_read on public.hr_settings;
create policy hr_settings_read on public.hr_settings for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists hr_settings_write on public.hr_settings;
create policy hr_settings_write on public.hr_settings for all using (tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin']))
  with check (tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin']));

alter table public.pay_grades enable row level security;
drop policy if exists pay_grades_rw on public.pay_grades;
create policy pay_grades_rw on public.pay_grades for all using (tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin']))
  with check (tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin']));

alter table public.staff_loans enable row level security;
drop policy if exists staff_loans_read on public.staff_loans;
create policy staff_loans_read on public.staff_loans for select using (tenant_id = public.my_tenant_id()
  and (public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin']) or staff_id = public.my_staff_id()));
drop policy if exists staff_loans_write on public.staff_loans;
create policy staff_loans_write on public.staff_loans for all using (tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin']))
  with check (tenant_id = public.my_tenant_id() and public.has_role(array['hr_manager','bursar','school_admin','principal','platform_admin']));

alter table public.appraisal_cycles enable row level security;
drop policy if exists appraisal_cycles_read on public.appraisal_cycles;
create policy appraisal_cycles_read on public.appraisal_cycles for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or (public.is_staff() and status <> 'draft')));
drop policy if exists appraisal_cycles_write on public.appraisal_cycles;
create policy appraisal_cycles_write on public.appraisal_cycles for all using (tenant_id = public.my_tenant_id() and public.is_hr())
  with check (tenant_id = public.my_tenant_id() and public.is_hr());

alter table public.appraisals enable row level security;
drop policy if exists appraisals_read on public.appraisals;
create policy appraisals_read on public.appraisals for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id() or reviewer_id = auth.uid()));
drop policy if exists appraisals_insert on public.appraisals;
create policy appraisals_insert on public.appraisals for insert with check (tenant_id = public.my_tenant_id() and public.is_hr());
drop policy if exists appraisals_update on public.appraisals;
create policy appraisals_update on public.appraisals for update using (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id() or reviewer_id = auth.uid()))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists appraisals_delete on public.appraisals;
create policy appraisals_delete on public.appraisals for delete using (tenant_id = public.my_tenant_id() and public.is_hr());

alter table public.appraisal_reviews enable row level security;
drop policy if exists appraisal_reviews_read on public.appraisal_reviews;
create policy appraisal_reviews_read on public.appraisal_reviews for select using (tenant_id = public.my_tenant_id()
  and (public.is_hr() or public.is_appraisal_reviewer(appraisal_id) or public.appraisal_shared(appraisal_id)));
drop policy if exists appraisal_reviews_write on public.appraisal_reviews;
create policy appraisal_reviews_write on public.appraisal_reviews for all using (tenant_id = public.my_tenant_id() and (public.is_hr() or public.is_appraisal_reviewer(appraisal_id)))
  with check (tenant_id = public.my_tenant_id() and (public.is_hr() or public.is_appraisal_reviewer(appraisal_id)));

alter table public.cpd_activities enable row level security;
drop policy if exists cpd_read on public.cpd_activities;
create policy cpd_read on public.cpd_activities for select using (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id() or public.manages_staff(staff_id)));
drop policy if exists cpd_write on public.cpd_activities;
create policy cpd_write on public.cpd_activities for all using (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id()))
  with check (tenant_id = public.my_tenant_id() and (public.is_hr() or staff_id = public.my_staff_id()));

grant all on public.hr_settings, public.pay_grades, public.staff_loans, public.appraisal_cycles, public.appraisals, public.appraisal_reviews, public.cpd_activities to service_role;

select public.attach_change_log();
