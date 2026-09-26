-- =========================================================================
-- EduClass Fusion v47: security, family engagement, cashless and cover
--
--  * Two-factor sign-in: required for platform admins, optional per school
--    for admins or all staff. Enforced here, so an API bug cannot skip it.
--  * Two-way parent-staff messaging with a permanent, read-only record.
--  * Web push subscriptions and a "push" outbox channel.
--  * Cashless wallet (pocket money), tuck shop / canteen items and a till.
--  * Staff absence and cover.
--  * Live school-bus location.
-- Apply AFTER 20260101001900_suspension_lock.sql. Idempotent.
-- =========================================================================

-- ---------- Roles: cashier (tuck shop / canteen) ----------
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in (
  'student','teacher','school_admin','it_admin','parent','platform_admin',
  'principal','bursar','librarian','hr_manager','qa_officer','gate_officer',
  'transport_officer','hostel_warden','nurse','admissions_officer','cashier'
));
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['teacher','school_admin','it_admin','platform_admin','principal',
    'bursar','librarian','hr_manager','qa_officer','gate_officer','transport_officer',
    'hostel_warden','nurse','admissions_officer','cashier']);
$$;

-- ---------- Two-factor sign-in ----------
alter table public.tenant_settings add column if not exists require_mfa text not null default 'off'
  check (require_mfa in ('off','admins','staff'));
alter table public.tenant_settings add column if not exists default_language text not null default 'en';
alter table public.guardians add column if not exists language text;

-- Assurance level of the current session: aal2 once a second factor was verified.
create or replace function public.session_aal()
returns text language sql stable set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;
grant execute on function public.session_aal() to authenticated;

-- Roles that count as "admins" for the require_mfa = 'admins' setting.
create or replace function public.mfa_ok(p_setting text, p_role text, p_extra text[])
returns boolean language sql stable set search_path = public as $$
  select case
    when coalesce(p_setting, 'off') = 'off' then true
    when p_role in ('student','parent') then true
    when public.session_aal() = 'aal2' then true
    when p_setting = 'admins' then not ((array[p_role] || coalesce(p_extra, '{}'))
      && array['school_admin','principal','it_admin','bursar','hr_manager','platform_admin'])
    else false
  end;
$$;

-- The caller's school. Empty when the school is suspended, the user is
-- deactivated, or the school requires a second factor this session lacks.
create or replace function public.my_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u.tenant_id
  from public.users u
  join public.tenants t on t.id = u.tenant_id
  left join public.tenant_settings s on s.tenant_id = u.tenant_id
  where u.id = auth.uid() and t.status = 'active' and u.active
    and public.mfa_ok(s.require_mfa, u.role, u.extra_roles);
$$;

create or replace function public.my_account_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when u.id is null then jsonb_build_object('state', 'no_profile')
    when t.status <> 'active' then jsonb_build_object('state', 'suspended', 'school', t.name)
    when not u.active then jsonb_build_object('state', 'deactivated', 'school', t.name)
    when not public.mfa_ok(s.require_mfa, u.role, u.extra_roles) then jsonb_build_object('state', 'mfa_required', 'school', t.name)
    else jsonb_build_object('state', 'active')
  end
  from (select auth.uid() as uid) me
  left join public.users u on u.id = me.uid
  left join public.tenants t on t.id = u.tenant_id
  left join public.tenant_settings s on s.tenant_id = u.tenant_id;
$$;

-- Platform admins always need a second factor. This is the lesson of the 2024
-- PowerSchool breach, where a support login without MFA exposed every district.
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
     and public.session_aal() = 'aal2';
$$;
create or replace function public.platform_admin_state()
returns text language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.platform_admins where user_id = auth.uid()) then 'none'
    when public.session_aal() <> 'aal2' then 'mfa_required'
    else 'ok' end;
$$;
grant execute on function public.is_platform_admin(), public.platform_admin_state(), public.my_account_state() to authenticated;

-- ---------- Web push ----------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid references public.users(id) on delete cascade,
  guardian_id  uuid references public.guardians(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  check (user_id is not null or guardian_id is not null)
);
create index if not exists push_subs_guardian on public.push_subscriptions(guardian_id);
create index if not exists push_subs_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
-- No policies: only the server reads or writes subscriptions.

alter table public.message_outbox drop constraint if exists message_outbox_channel_check;
alter table public.message_outbox add constraint message_outbox_channel_check
  check (channel in ('email','whatsapp','sms','push'));

-- ---------- Two-way messaging ----------
create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  guardian_id      uuid not null references public.guardians(id) on delete cascade,
  student_id       uuid references public.students(id) on delete set null,
  staff_user_id    uuid references public.users(id) on delete set null,   -- null = school office
  subject          text not null check (length(subject) between 1 and 160),
  status           text not null default 'open' check (status in ('open','closed')),
  started_by       text not null check (started_by in ('staff','guardian')),
  staff_unread     int not null default 0,
  guardian_unread  int not null default 0,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists conversations_staff on public.conversations(tenant_id, staff_user_id, last_message_at desc);
create index if not exists conversations_guardian on public.conversations(guardian_id, last_message_at desc);

create table if not exists public.conversation_messages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_kind      text not null check (sender_kind in ('staff','guardian')),
  sender_user_id   uuid references public.users(id) on delete set null,
  sender_name      text not null,
  body             text not null check (length(body) between 1 and 4000),
  translated_body  text,
  source_lang      text,
  target_lang      text,
  created_at       timestamptz not null default now()
);
create index if not exists conversation_messages_conv on public.conversation_messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

create or replace function public.is_my_guardian_record(p_guardian uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guardians where id = p_guardian and user_id = auth.uid());
$$;
grant execute on function public.is_my_guardian_record(uuid) to authenticated;

-- Staff see their own threads; admins see every thread for safeguarding;
-- a signed-in parent sees their own. Writes go through the server, and
-- nobody can edit or delete a message, so the record is permanent.
drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select using (
  tenant_id = public.my_tenant_id() and (
    staff_user_id = auth.uid() or public.is_school_admin() or public.is_my_guardian_record(guardian_id)));
drop policy if exists conversation_messages_read on public.conversation_messages;
create policy conversation_messages_read on public.conversation_messages for select using (
  tenant_id = public.my_tenant_id() and conversation_id in (select id from public.conversations));

-- ---------- Cashless wallet and tuck shop ----------
create table if not exists public.wallets (
  student_id         uuid primary key references public.students(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  balance            numeric(14,2) not null default 0 check (balance >= 0),
  daily_limit        numeric(14,2) check (daily_limit is null or daily_limit >= 0),
  low_balance_alert  numeric(14,2) check (low_balance_alert is null or low_balance_alert >= 0),
  frozen             boolean not null default false,
  updated_at         timestamptz not null default now()
);
create table if not exists public.wallet_transactions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  kind           text not null check (kind in ('topup','purchase','refund')),
  amount         numeric(14,2) not null check (amount <> 0),   -- credits positive, purchases negative
  balance_after  numeric(14,2),
  status         text not null default 'success' check (status in ('pending','success','failed')),
  method         text,
  provider       text,
  reference      text not null,
  description    text,
  items          jsonb not null default '[]'::jsonb,
  payer_email    text,
  recorded_by    uuid references public.users(id),
  created_at     timestamptz not null default now(),
  unique (tenant_id, reference)
);
create index if not exists wallet_tx_student on public.wallet_transactions(student_id, created_at desc);
create table if not exists public.shop_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  price       numeric(14,2) not null check (price >= 0),
  category    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.shop_items enable row level security;

create or replace function public.is_till_operator()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['cashier','bursar','school_admin','principal','platform_admin']);
$$;
grant execute on function public.is_till_operator() to authenticated;

drop policy if exists wallets_read on public.wallets;
create policy wallets_read on public.wallets for select using (
  tenant_id = public.my_tenant_id() and (public.is_till_operator() or public.is_guardian_of(student_id) or public.is_student_self(student_id)));
drop policy if exists wallet_tx_read on public.wallet_transactions;
create policy wallet_tx_read on public.wallet_transactions for select using (
  tenant_id = public.my_tenant_id() and (public.is_till_operator() or public.is_guardian_of(student_id) or public.is_student_self(student_id)));
drop policy if exists shop_items_read on public.shop_items;
create policy shop_items_read on public.shop_items for select using (tenant_id = public.my_tenant_id());
drop policy if exists shop_items_write on public.shop_items;
create policy shop_items_write on public.shop_items for all using (tenant_id = public.my_tenant_id() and public.is_till_operator())
  with check (tenant_id = public.my_tenant_id() and public.is_till_operator());

-- Till purchase: row-locked, never below zero, respects the parent's daily limit and freeze.
create or replace function public.wallet_charge(p_student uuid, p_amount numeric, p_items jsonb, p_description text, p_reference text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.my_tenant_id();
  w public.wallets;
  v_tz text;
  v_spent numeric := 0;
begin
  if v_tenant is null or not public.is_till_operator() then raise exception 'forbidden'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be more than zero'; end if;
  select * into w from public.wallets where student_id = p_student and tenant_id = v_tenant for update;
  if not found then raise exception 'this student has no wallet yet'; end if;
  if w.frozen then raise exception 'this wallet is frozen by the parent or school'; end if;
  if w.balance < p_amount then raise exception 'insufficient balance'; end if;
  select coalesce(timezone, 'Africa/Lagos') into v_tz from public.tenants where id = v_tenant;
  select coalesce(-sum(amount), 0) into v_spent from public.wallet_transactions
    where student_id = p_student and kind = 'purchase' and status = 'success'
      and created_at >= (date_trunc('day', now() at time zone v_tz) at time zone v_tz);
  if w.daily_limit is not null and v_spent + p_amount > w.daily_limit then
    raise exception 'daily spending limit reached';
  end if;
  update public.wallets set balance = balance - p_amount, updated_at = now() where student_id = p_student returning * into w;
  insert into public.wallet_transactions (tenant_id, student_id, kind, amount, balance_after, method, reference, description, items, recorded_by)
  values (v_tenant, p_student, 'purchase', -p_amount, w.balance, 'card', p_reference, p_description, coalesce(p_items, '[]'::jsonb), auth.uid());
  return jsonb_build_object('balance', w.balance, 'spent_today', v_spent + p_amount, 'low', w.low_balance_alert is not null and w.balance < w.low_balance_alert);
end $$;

-- Cash or transfer top-up, or a refund, recorded by finance staff.
create or replace function public.wallet_credit(p_student uuid, p_amount numeric, p_kind text, p_method text, p_reference text, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.my_tenant_id();
  w public.wallets;
begin
  if v_tenant is null or not public.is_finance() then raise exception 'forbidden'; end if;
  if p_kind not in ('topup','refund') then raise exception 'invalid kind'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be more than zero'; end if;
  if not exists (select 1 from public.students where id = p_student and tenant_id = v_tenant) then raise exception 'student not found'; end if;
  insert into public.wallets (student_id, tenant_id) values (p_student, v_tenant) on conflict (student_id) do nothing;
  update public.wallets set balance = balance + p_amount, updated_at = now() where student_id = p_student returning * into w;
  insert into public.wallet_transactions (tenant_id, student_id, kind, amount, balance_after, method, reference, description, recorded_by)
  values (v_tenant, p_student, p_kind, p_amount, w.balance, p_method, p_reference, p_description, auth.uid());
  return jsonb_build_object('balance', w.balance);
end $$;

-- Online top-up confirmed by the server after the provider verified it. Idempotent.
create or replace function public.wallet_settle(p_tx uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.wallet_transactions; w public.wallets;
begin
  select * into t from public.wallet_transactions where id = p_tx for update;
  if not found or t.kind <> 'topup' then raise exception 'not found'; end if;
  if t.status <> 'pending' then return jsonb_build_object('status', t.status); end if;
  insert into public.wallets (student_id, tenant_id) values (t.student_id, t.tenant_id) on conflict (student_id) do nothing;
  update public.wallets set balance = balance + t.amount, updated_at = now() where student_id = t.student_id returning * into w;
  update public.wallet_transactions set status = 'success', balance_after = w.balance where id = p_tx;
  return jsonb_build_object('status', 'success', 'balance', w.balance);
end $$;

revoke all on function public.wallet_charge(uuid, numeric, jsonb, text, text) from public, anon;
revoke all on function public.wallet_credit(uuid, numeric, text, text, text, text) from public, anon;
revoke all on function public.wallet_settle(uuid) from public, anon, authenticated;
grant execute on function public.wallet_charge(uuid, numeric, jsonb, text, text), public.wallet_credit(uuid, numeric, text, text, text, text) to authenticated;
grant execute on function public.wallet_settle(uuid) to service_role;

-- ---------- Staff absence and cover ----------
create table if not exists public.staff_absences (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  starts_on    date not null,
  ends_on      date not null,
  reason       text,
  recorded_by  uuid references public.users(id),
  created_at   timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists staff_absences_dates on public.staff_absences(tenant_id, starts_on, ends_on);
create table if not exists public.cover_assignments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  date                date not null,
  timetable_entry_id  uuid not null references public.timetable_entries(id) on delete cascade,
  period_id           uuid not null references public.timetable_periods(id) on delete cascade,
  absent_user_id      uuid references public.users(id) on delete set null,
  cover_user_id       uuid not null references public.users(id) on delete cascade,
  note                text,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  unique (tenant_id, date, timetable_entry_id)
);
create unique index if not exists cover_no_double_booking on public.cover_assignments(tenant_id, date, period_id, cover_user_id);
alter table public.staff_absences enable row level security;
alter table public.cover_assignments enable row level security;

drop policy if exists staff_absences_read on public.staff_absences;
create policy staff_absences_read on public.staff_absences for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists staff_absences_write on public.staff_absences;
create policy staff_absences_write on public.staff_absences for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
drop policy if exists cover_read on public.cover_assignments;
create policy cover_read on public.cover_assignments for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists cover_write on public.cover_assignments;
create policy cover_write on public.cover_assignments for all using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

-- A cover teacher must be free: not teaching then, and not absent that day.
create or replace function public.cover_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select e.period_id into new.period_id from public.timetable_entries e where e.id = new.timetable_entry_id and e.tenant_id = new.tenant_id;
  if new.period_id is null then raise exception 'lesson not found'; end if;
  if exists (select 1 from public.timetable_entries e where e.tenant_id = new.tenant_id and e.teacher_id = new.cover_user_id
             and e.day = extract(isodow from new.date)::int and e.period_id = new.period_id) then
    raise exception 'that teacher is teaching their own lesson in this period';
  end if;
  if exists (select 1 from public.staff_absences a where a.tenant_id = new.tenant_id and a.user_id = new.cover_user_id
             and new.date between a.starts_on and a.ends_on) then
    raise exception 'that teacher is absent on this day';
  end if;
  return new;
end $$;
drop trigger if exists cover_guard on public.cover_assignments;
create trigger cover_guard before insert or update on public.cover_assignments for each row execute function public.cover_guard();

-- ---------- Live school-bus location ----------
create table if not exists public.transport_live (
  route_id        uuid primary key references public.transport_routes(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  trip            text not null check (trip in ('morning','afternoon')),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  lat             double precision,
  lng             double precision,
  accuracy        double precision,
  speed           double precision,
  updated_at      timestamptz,
  notified_stops  text[] not null default '{}',
  started_by      uuid references public.users(id)
);
alter table public.transport_live enable row level security;
drop policy if exists transport_live_read on public.transport_live;
create policy transport_live_read on public.transport_live for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or exists (
    select 1 from public.transport_assignments a where a.route_id = transport_live.route_id
      and (public.is_guardian_of(a.student_id) or public.is_student_self(a.student_id)))));
