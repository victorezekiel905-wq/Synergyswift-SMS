-- =====================================================================
--  Phase 9b: budgets, petty cash and the general ledger.
--
--  * Budgets per period with income and expense lines; a second person approves.
--  * Petty cash floats with a custodian, top-ups, spends (each one an expense,
--    with an optional receipt), returns, cash counts and adjustments.
--  * A chart of accounts per school, mappings (fee items, expense categories,
--    payment methods to accounts) and manual journals that must balance.
--    Everything else in the ledger (fees billed and received, expenses, payroll,
--    wallet, petty cash) is derived from the records the school already keeps.
--  * Closing the books up to a date: expenses, petty cash and journals dated
--    on or before it can no longer be added, changed or removed.
-- =====================================================================

alter table public.expenses add column if not exists receipt_path text;
alter table public.tenant_settings add column if not exists books_closed_until date;
insert into storage.buckets (id, name, public) values ('expense-receipts', 'expense-receipts', false) on conflict (id) do nothing;

-- ---------- Closed periods ----------
-- Attach with the name of the row's date column. Server jobs (no signed-in user) are not blocked.
create or replace function public.books_closed_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_until date; v_tenant uuid; v_col text := tg_argv[0]; v_d date;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then v_tenant := old.tenant_id; else v_tenant := new.tenant_id; end if;
  select books_closed_until into v_until from public.tenant_settings where tenant_id = v_tenant;
  if v_until is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op <> 'INSERT' then
    v_d := (to_jsonb(old) ->> v_col)::date;
    if v_d <= v_until then raise exception 'the books are closed up to %; record a correction in an open period', to_char(v_until, 'DD Mon YYYY'); end if;
  end if;
  if tg_op <> 'DELETE' then
    v_d := (to_jsonb(new) ->> v_col)::date;
    if v_d <= v_until then raise exception 'the books are closed up to %; use a later date', to_char(v_until, 'DD Mon YYYY'); end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists expenses_books_closed on public.expenses;
create trigger expenses_books_closed before insert or update or delete on public.expenses
  for each row execute function public.books_closed_guard('spent_on');

-- ---------- Budgets ----------
create table if not exists public.budgets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  starts_on    date not null,
  ends_on      date not null,
  status       text not null default 'draft' check (status in ('draft','approved')),
  notes        text,
  created_by   uuid references public.users(id) on delete set null,
  approved_by  uuid references public.users(id) on delete set null,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (tenant_id, name)
);
create table if not exists public.budget_lines (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  budget_id  uuid not null references public.budgets(id) on delete cascade,
  kind       text not null check (kind in ('income','expense')),
  category   text not null check (length(trim(category)) between 1 and 80),
  amount     numeric(14,2) not null check (amount >= 0),
  note       text,
  unique (budget_id, kind, category)
);

-- Approval by a head or admin who did not prepare it; an approved budget is reopened before it changes.
create or replace function public.budget_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.status := 'draft'; new.approved_by := null; new.approved_at := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'approved' then raise exception 'reopen the budget before deleting it'; end if;
    return old;
  end if;
  if old.status = 'approved' and new.status = 'approved' then raise exception 'reopen the budget to change it'; end if;
  if new.status = 'approved' and old.status = 'draft' then
    if not public.has_role(array['school_admin','principal','platform_admin']) then raise exception 'only the principal or a school admin can approve a budget'; end if;
    if old.created_by = auth.uid() then raise exception 'a budget must be approved by someone other than the person who prepared it'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif new.status = 'draft' then
    if old.status = 'approved' and not public.has_role(array['school_admin','principal','platform_admin']) then raise exception 'only the principal or a school admin can reopen an approved budget'; end if;
    new.approved_by := null; new.approved_at := null;
  end if;
  new.created_by := old.created_by;
  return new;
end $$;
drop trigger if exists budget_guard on public.budgets;
create trigger budget_guard before insert or update or delete on public.budgets for each row execute function public.budget_guard();

create or replace function public.budget_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_budget uuid; v_status text; v_tenant uuid;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then v_budget := old.budget_id; else v_budget := new.budget_id; end if;
  select status, tenant_id into v_status, v_tenant from public.budgets where id = v_budget;
  if v_status = 'approved' then raise exception 'reopen the budget to change it'; end if;
  if tg_op <> 'DELETE' and v_tenant is distinct from new.tenant_id then raise exception 'budget not found'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists budget_line_guard on public.budget_lines;
create trigger budget_line_guard before insert or update or delete on public.budget_lines for each row execute function public.budget_line_guard();

-- ---------- Petty cash ----------
create table if not exists public.petty_cash_floats (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 80),
  custodian_id  uuid references public.users(id) on delete set null,
  imprest       numeric(14,2) not null default 0 check (imprest >= 0),   -- the amount it is topped back up to
  balance       numeric(14,2) not null default 0,                         -- kept by the trigger below
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, name)
);
create table if not exists public.petty_cash_moves (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  float_id     uuid not null references public.petty_cash_floats(id) on delete cascade,
  kind         text not null check (kind in ('topup','spend','return','adjust')),
  amount       numeric(14,2) not null check (amount <> 0 and (kind = 'adjust' or amount > 0)),   -- adjust: + over, - short
  on_date      date not null default current_date,
  note         text,
  expense_id   uuid references public.expenses(id) on delete cascade,
  recorded_by  uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check ((kind = 'spend') = (expense_id is not null))
);
create unique index if not exists petty_cash_moves_expense on public.petty_cash_moves(expense_id) where expense_id is not null;
create index if not exists petty_cash_moves_float on public.petty_cash_moves(float_id, on_date desc);
create table if not exists public.petty_cash_counts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  float_id    uuid not null references public.petty_cash_floats(id) on delete cascade,
  counted     numeric(14,2) not null check (counted >= 0),
  expected    numeric(14,2) not null default 0,     -- the float's balance when counted
  note        text,
  counted_by  uuid references public.users(id) on delete set null,
  counted_at  timestamptz not null default now()
);

create or replace function public.petty_cash_rebalance() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_float uuid; v_bal numeric;
begin
  if tg_op = 'DELETE' then v_float := old.float_id; else v_float := new.float_id; end if;
  select coalesce(sum(case when kind in ('topup','adjust') then amount else -amount end), 0) into v_bal
    from public.petty_cash_moves where float_id = v_float;
  update public.petty_cash_floats set balance = v_bal where id = v_float;
  if tg_op = 'INSERT' and v_bal < 0 then
    raise exception 'not enough in the petty cash float: it would be % short', to_char(-v_bal, 'FM999,999,999,990.00');
  end if;
  return null;
end $$;
drop trigger if exists petty_cash_rebalance on public.petty_cash_moves;
create trigger petty_cash_rebalance after insert or update or delete on public.petty_cash_moves
  for each row execute function public.petty_cash_rebalance();

-- Nobody types a balance: it only ever comes from the records (the rebalance trigger runs one level down).
create or replace function public.petty_cash_float_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then new.balance := 0; else new.balance := old.balance; end if;
  return new;
end $$;
drop trigger if exists petty_cash_float_guard on public.petty_cash_floats;
create trigger petty_cash_float_guard before insert or update on public.petty_cash_floats for each row execute function public.petty_cash_float_guard();

create or replace function public.petty_cash_move_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_active boolean; v_tenant uuid;
begin
  if auth.uid() is null then return new; end if;
  select active, tenant_id into v_active, v_tenant from public.petty_cash_floats where id = new.float_id;
  if v_tenant is distinct from new.tenant_id then raise exception 'petty cash float not found'; end if;
  if not v_active and new.kind in ('topup','spend') then raise exception 'this float is closed'; end if;
  new.recorded_by := auth.uid();
  return new;
end $$;
drop trigger if exists petty_cash_move_guard on public.petty_cash_moves;
create trigger petty_cash_move_guard before insert on public.petty_cash_moves for each row execute function public.petty_cash_move_guard();
drop trigger if exists petty_cash_books_closed on public.petty_cash_moves;
create trigger petty_cash_books_closed before insert or update or delete on public.petty_cash_moves
  for each row execute function public.books_closed_guard('on_date');

create or replace function public.petty_cash_count_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bal numeric; v_tenant uuid;
begin
  select balance, tenant_id into v_bal, v_tenant from public.petty_cash_floats where id = new.float_id;
  if v_tenant is distinct from new.tenant_id then raise exception 'petty cash float not found'; end if;
  new.expected := coalesce(v_bal, 0);
  if auth.uid() is not null then new.counted_by := auth.uid(); new.counted_at := now(); end if;
  return new;
end $$;
drop trigger if exists petty_cash_count_before on public.petty_cash_counts;
create trigger petty_cash_count_before before insert on public.petty_cash_counts for each row execute function public.petty_cash_count_before();

create or replace function public.is_custodian_of(p_float uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.petty_cash_floats f where f.id = p_float and f.tenant_id = public.my_tenant_id() and f.custodian_id = auth.uid());
$$;
grant execute on function public.is_custodian_of(uuid) to authenticated;

-- A spend is an expense paid from the float, recorded by the custodian or the bursary.
create or replace function public.petty_cash_spend(p_float uuid, p_amount numeric, p_category text, p_description text,
  p_payee text default null, p_on date default null, p_receipt text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare f public.petty_cash_floats%rowtype; v_exp uuid; v_amt numeric := round(p_amount, 2);
begin
  select * into f from public.petty_cash_floats where id = p_float and tenant_id = public.my_tenant_id();
  if f.id is null then raise exception 'petty cash float not found'; end if;
  if not (public.is_finance() or f.custodian_id = auth.uid()) then raise exception 'only the custodian or the bursary can spend from this float'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'enter an amount'; end if;
  if coalesce(trim(p_category), '') = '' or coalesce(trim(p_description), '') = '' then raise exception 'say what the money was spent on'; end if;
  if p_receipt is not null and p_receipt not like f.tenant_id::text || '/%' then raise exception 'receipt not found'; end if;
  insert into public.expenses (tenant_id, category, description, amount, spent_on, payee, method, receipt_path, recorded_by)
    values (f.tenant_id, left(trim(p_category), 60), left(trim(p_description), 200), v_amt, coalesce(p_on, current_date),
            nullif(left(trim(coalesce(p_payee, '')), 120), ''), 'petty_cash', p_receipt, auth.uid())
    returning id into v_exp;
  insert into public.petty_cash_moves (tenant_id, float_id, kind, amount, on_date, note, expense_id)
    values (f.tenant_id, f.id, 'spend', v_amt, coalesce(p_on, current_date), left(trim(p_description), 200), v_exp);
  return v_exp;
end $$;
revoke all on function public.petty_cash_spend(uuid, numeric, text, text, text, date, text) from public, anon;
grant execute on function public.petty_cash_spend(uuid, numeric, text, text, text, date, text) to authenticated;

-- ---------- Chart of accounts and journals ----------
create table if not exists public.ledger_accounts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null check (code ~ '^[0-9A-Za-z.-]{1,20}$'),
  name        text not null check (length(trim(name)) between 1 and 120),
  type        text not null check (type in ('asset','liability','equity','income','expense')),
  system_key  text,          -- built-in accounts the ledger posts to (bank, receivables, fee_income …)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, system_key)
);
create table if not exists public.ledger_mappings (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  source      text not null check (source in ('fee_item','expense_category','payment_method')),
  key         text not null,
  account_id  uuid not null references public.ledger_accounts(id) on delete cascade,
  primary key (tenant_id, source, key)
);
create table if not exists public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  entry_no    text,
  entry_date  date not null,
  memo        text not null check (length(trim(memo)) between 1 and 300),
  status      text not null default 'draft' check (status in ('draft','posted')),
  reverses    uuid references public.journal_entries(id) on delete set null,
  created_by  uuid references public.users(id) on delete set null,
  posted_by   uuid references public.users(id) on delete set null,
  posted_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (tenant_id, entry_no)
);
create index if not exists journal_entries_date on public.journal_entries(tenant_id, entry_date);
create table if not exists public.journal_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  entry_id     uuid not null references public.journal_entries(id) on delete cascade,
  account_id   uuid not null references public.ledger_accounts(id),
  debit        numeric(14,2) not null default 0 check (debit >= 0),
  credit       numeric(14,2) not null default 0 check (credit >= 0),
  description  text,
  check ((debit > 0) <> (credit > 0))
);
create index if not exists journal_lines_entry on public.journal_lines(entry_id);

create or replace function public.ledger_account_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then
    if new.system_key is not null then raise exception 'built-in accounts are added by the system'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.system_key is not null then raise exception 'built-in accounts can be renamed or hidden but not deleted'; end if;
    if exists (select 1 from public.journal_lines l where l.account_id = old.id) then raise exception 'this account has journal lines; hide it instead'; end if;
    return old;
  end if;
  if old.system_key is not null and (new.type is distinct from old.type or new.system_key is distinct from old.system_key) then
    raise exception 'the type of a built-in account cannot change';
  end if;
  if old.system_key is null and new.system_key is not null then raise exception 'built-in accounts are added by the system'; end if;
  return new;
end $$;
drop trigger if exists ledger_account_guard on public.ledger_accounts;
create trigger ledger_account_guard before insert or update or delete on public.ledger_accounts for each row execute function public.ledger_account_guard();

-- Journals are drafted, then posted once debits equal credits. Posted journals never change: reverse them.
create or replace function public.journal_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_dr numeric; v_cr numeric; v_n int;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.status := 'draft'; new.entry_no := null; new.posted_by := null; new.posted_at := null;
    return new;
  end if;
  if old.status = 'posted' then raise exception 'posted journals cannot be changed or deleted; post a reversing journal instead'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.status = 'posted' then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into v_dr, v_cr, v_n from public.journal_lines where entry_id = new.id;
    if v_n < 2 then raise exception 'a journal needs at least two lines'; end if;
    if v_dr <> v_cr then raise exception 'debits (%) and credits (%) must be equal', v_dr, v_cr; end if;
    if v_dr = 0 then raise exception 'a journal must move some money'; end if;
    new.entry_no := public.next_doc_no(new.tenant_id, 'jnl'); new.posted_by := auth.uid(); new.posted_at := now();
  end if;
  new.created_by := old.created_by;
  return new;
end $$;
drop trigger if exists journal_guard on public.journal_entries;
create trigger journal_guard before insert or update or delete on public.journal_entries for each row execute function public.journal_guard();
drop trigger if exists journal_books_closed on public.journal_entries;
create trigger journal_books_closed before insert or update or delete on public.journal_entries
  for each row execute function public.books_closed_guard('entry_date');

create or replace function public.journal_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_status text; v_tenant uuid;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then v_entry := old.entry_id; else v_entry := new.entry_id; end if;
  select status, tenant_id into v_status, v_tenant from public.journal_entries where id = v_entry;
  if v_status = 'posted' then raise exception 'posted journals cannot be changed; post a reversing journal instead'; end if;
  if tg_op <> 'DELETE' then
    if v_tenant is distinct from new.tenant_id then raise exception 'journal not found'; end if;
    if not exists (select 1 from public.ledger_accounts a where a.id = new.account_id and a.tenant_id = new.tenant_id) then raise exception 'account not found'; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists journal_line_guard on public.journal_lines;
create trigger journal_line_guard before insert or update or delete on public.journal_lines for each row execute function public.journal_line_guard();

-- Mappings point at this school's accounts only.
create or replace function public.ledger_mapping_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ledger_accounts a where a.id = new.account_id and a.tenant_id = new.tenant_id) then raise exception 'account not found'; end if;
  return new;
end $$;
drop trigger if exists ledger_mapping_guard on public.ledger_mappings;
create trigger ledger_mapping_guard before insert or update on public.ledger_mappings for each row execute function public.ledger_mapping_guard();

-- ---------- RLS ----------
alter table public.budgets enable row level security;
alter table public.budget_lines enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_mappings enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
do $$
declare t text;
begin
  foreach t in array array['budgets','budget_lines','ledger_accounts','ledger_mappings','journal_entries','journal_lines'] loop
    execute format('drop policy if exists %I on public.%I', t || '_finance', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_finance()) with check (tenant_id = public.my_tenant_id() and public.is_finance())', t || '_finance', t);
  end loop;
end $$;

alter table public.petty_cash_floats enable row level security;
drop policy if exists petty_floats_read on public.petty_cash_floats;
create policy petty_floats_read on public.petty_cash_floats for select using (tenant_id = public.my_tenant_id() and (public.is_finance() or custodian_id = auth.uid()));
drop policy if exists petty_floats_write on public.petty_cash_floats;
create policy petty_floats_write on public.petty_cash_floats for all using (tenant_id = public.my_tenant_id() and public.is_finance())
  with check (tenant_id = public.my_tenant_id() and public.is_finance());

-- Moves are a ledger: added, never edited. Spends come through petty_cash_spend(); a spend goes away only with its expense.
alter table public.petty_cash_moves enable row level security;
drop policy if exists petty_moves_read on public.petty_cash_moves;
create policy petty_moves_read on public.petty_cash_moves for select using (tenant_id = public.my_tenant_id() and (public.is_finance() or public.is_custodian_of(float_id)));
drop policy if exists petty_moves_insert on public.petty_cash_moves;
create policy petty_moves_insert on public.petty_cash_moves for insert with check (tenant_id = public.my_tenant_id() and public.is_finance() and kind <> 'spend');

alter table public.petty_cash_counts enable row level security;
drop policy if exists petty_counts_read on public.petty_cash_counts;
create policy petty_counts_read on public.petty_cash_counts for select using (tenant_id = public.my_tenant_id() and (public.is_finance() or public.is_custodian_of(float_id)));
drop policy if exists petty_counts_insert on public.petty_cash_counts;
create policy petty_counts_insert on public.petty_cash_counts for insert with check (tenant_id = public.my_tenant_id() and (public.is_finance() or public.is_custodian_of(float_id)));

grant all on public.budgets, public.budget_lines, public.petty_cash_floats, public.petty_cash_moves, public.petty_cash_counts,
  public.ledger_accounts, public.ledger_mappings, public.journal_entries, public.journal_lines to service_role;

select public.attach_change_log();
