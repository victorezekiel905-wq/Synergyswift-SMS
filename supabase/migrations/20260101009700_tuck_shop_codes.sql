-- 9700: the tuck shop with one-time buy codes and fingerprints.
--
-- * A student (or their parent) makes a 6-character buy code (shown 7K3-PX9). It works once, and only today.
--   The seller types it, sees the child (name, photo, class; not the balance), then pays.
--   Sellers sell only in the school's selling times (shop_selling_windows). Wrong codes never stop a seller.
--   The school decides how many buys a day (shop_purchases_per_day), how long to wait after a
--   buy before the next (shop_gap_minutes), the times codes can be made (shop_code_windows,
--   e.g. "10:00-10:30, 12:30-13:15"; empty = any time) and a daily spending cap for every
--   student (shop_daily_cap, on top of any limit a parent set).
-- * The seller ticks what is bought; the total comes from the shop's own prices. The student
--   gives the code, or scans a finger on a fingerprint machine set to "Tuck shop" mode, and the
--   money leaves the wallet at once. Every refusal (limit, no money, bought already) is
--   recorded for the student, the parents and the admins to see.
-- * Shop items can keep stock: each sale takes it off; restocks are recorded.
-- * Only admins add money (shop_parent_topup turns on parents' online top-ups).
-- Safe to run more than once.

alter table public.tenant_settings
  add column if not exists shop_purchases_per_day int not null default 1,
  add column if not exists shop_gap_minutes int not null default 60,
  add column if not exists shop_code_windows text not null default '',
  add column if not exists shop_selling_windows text not null default '',
  add column if not exists shop_daily_cap numeric(14,2),
  add column if not exists shop_require_code boolean not null default true,
  add column if not exists shop_notify_each_purchase boolean not null default true,
  add column if not exists shop_parent_topup boolean not null default false;
do $$ begin
  alter table public.tenant_settings add constraint shop_settings_ok check (shop_purchases_per_day between 1 and 20 and shop_gap_minutes between 0 and 600
    and (shop_daily_cap is null or shop_daily_cap >= 0) and length(shop_code_windows) <= 200 and length(shop_selling_windows) <= 200);
exception when duplicate_object then null; end $$;

alter table public.shop_items
  add column if not exists stock int,          -- null: not counted
  add column if not exists stock_alert int;    -- warn the seller at or below this
do $$ begin
  alter table public.shop_items add constraint shop_items_stock_ok check ((stock is null or stock >= 0) and (stock_alert is null or stock_alert >= 0));
exception when duplicate_object then null; end $$;

create table if not exists public.shop_stock_moves (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  item_id     uuid not null references public.shop_items(id) on delete cascade,
  change      int not null,
  reason      text not null check (reason in ('restock', 'sale', 'count', 'damaged')),
  note        text,
  by_user     uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists shop_stock_moves_item on public.shop_stock_moves(item_id, created_at desc);

create table if not exists public.shop_codes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  code        text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  made_by     uuid references auth.users(id) on delete set null,
  made_as     text not null default 'student' check (made_as in ('student', 'parent', 'staff')),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_tx     uuid references public.wallet_transactions(id) on delete set null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
-- A live code is unique in its school; old ones are cleared when new ones are made.
create unique index if not exists shop_codes_live on public.shop_codes(tenant_id, code) where used_at is null and revoked_at is null;
create index if not exists shop_codes_student on public.shop_codes(student_id, created_at desc);

create table if not exists public.shop_finger_scans (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  device_id   uuid not null references public.attendance_devices(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  at          timestamptz not null default now(),
  used_at     timestamptz
);
create index if not exists shop_finger_scans_device on public.shop_finger_scans(device_id, at desc);

-- What happened at the shop, for the student's dashboard, the parents and the admins.
create table if not exists public.shop_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid references public.students(id) on delete cascade,
  kind        text not null check (kind in ('purchase', 'refused', 'code', 'exhausted', 'topup', 'bad_code', 'restock', 'low_stock', 'seller_alert')),
  amount      numeric(14,2),
  detail      jsonb not null default '{}'::jsonb,
  operator    uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists shop_events_tenant on public.shop_events(tenant_id, created_at desc);
create index if not exists shop_events_student on public.shop_events(student_id, created_at desc);

-- Fingerprint machines can be set to the tuck shop instead of the gate.
alter table public.attendance_devices drop constraint if exists attendance_devices_mode_check;
alter table public.attendance_devices add constraint attendance_devices_mode_check check (mode in ('auto', 'in', 'out', 'shop'));

alter table public.shop_stock_moves enable row level security;
alter table public.shop_codes enable row level security;
alter table public.shop_finger_scans enable row level security;
alter table public.shop_events enable row level security;
revoke all on public.shop_stock_moves, public.shop_codes, public.shop_finger_scans, public.shop_events from anon, authenticated;
grant select, insert, update, delete on public.shop_stock_moves, public.shop_codes, public.shop_finger_scans, public.shop_events to service_role;

/** Whether a local time falls in any of the school's times, written "10:00-10:30, 12:30-13:15" (empty: always). */
create or replace function public.shop_in_windows(p_windows text, p_local time) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_part text;
begin
  if btrim(coalesce(p_windows, '')) = '' then return true; end if;
  for v_part in select btrim(x) from regexp_split_to_table(p_windows, ',') x loop
    if v_part ~ '^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$'
       and p_local >= btrim(split_part(v_part, '-', 1))::time and p_local <= btrim(split_part(v_part, '-', 2))::time then
      return true;
    end if;
  end loop;
  return false;
end$$;

/** The school's day and settings for one student: buys left, the wait, the limits, the wallet. */create or replace function public.shop_status(p_tenant uuid, p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s        public.tenant_settings;
  w        public.wallets;
  v_tz     text;
  v_local  timestamp;
  v_start  timestamptz;
  v_used   int;
  v_spent  numeric;
  v_last   timestamptz;
  v_next   timestamptz;
  v_cap    numeric;
  v_open   boolean := true;
  v_code   public.shop_codes;
begin
  select * into s from public.tenant_settings where tenant_id = p_tenant;
  select coalesce(timezone, 'Africa/Lagos') into v_tz from public.tenants where id = p_tenant;
  v_local := now() at time zone v_tz;
  v_start := date_trunc('day', v_local) at time zone v_tz;
  select * into w from public.wallets where student_id = p_student and tenant_id = p_tenant;
  select count(*), coalesce(-sum(amount), 0), max(created_at) into v_used, v_spent, v_last
    from public.wallet_transactions where student_id = p_student and tenant_id = p_tenant and kind = 'purchase' and status = 'success' and created_at >= v_start;
  if v_last is not null and coalesce(s.shop_gap_minutes, 60) > 0 then
    v_next := v_last + make_interval(mins => coalesce(s.shop_gap_minutes, 60));
    if v_next <= now() then v_next := null; end if;
  end if;
  v_cap := case when w.daily_limit is null then s.shop_daily_cap when s.shop_daily_cap is null then w.daily_limit else least(w.daily_limit, s.shop_daily_cap) end;
  v_open := public.shop_in_windows(s.shop_code_windows, v_local::time);

  select * into v_code from public.shop_codes where student_id = p_student and tenant_id = p_tenant and used_at is null and revoked_at is null and expires_at > now()
    order by created_at desc limit 1;
  return jsonb_build_object(
    'max', coalesce(s.shop_purchases_per_day, 1), 'used', v_used, 'left', greatest(coalesce(s.shop_purchases_per_day, 1) - v_used, 0),
    'gap_minutes', coalesce(s.shop_gap_minutes, 60), 'last_at', v_last, 'next_at', v_next,
    'cap', v_cap, 'spent_today', v_spent, 'cap_left', case when v_cap is null then null else greatest(v_cap - v_spent, 0) end,
    'balance', coalesce(w.balance, 0), 'frozen', coalesce(w.frozen, false), 'has_wallet', w.student_id is not null,
    'window_open', v_open, 'windows', coalesce(s.shop_code_windows, ''), 'day_ends', v_start + interval '1 day',
    'selling_open', public.shop_in_windows(s.shop_selling_windows, v_local::time), 'selling_windows', coalesce(s.shop_selling_windows, ''),
    'code', v_code.code, 'code_expires', v_code.expires_at);
end$$;

/**
 * Makes (or returns the live) one-time buy code for a student. Refusals come back as values
 * ({ error: 'window' | 'bought_max' | 'wait' | 'empty' | 'frozen' }) with the details.
 */
create or replace function public.shop_make_code(p_tenant uuid, p_student uuid, p_by uuid, p_as text default 'student') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st     jsonb;
  a      text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c      text;
  i      int;
  v_exp  timestamptz;
begin
  if not exists (select 1 from public.students where id = p_student and tenant_id = p_tenant and status = 'active') then
    return jsonb_build_object('error', 'not_found');
  end if;
  -- Lock the student's codes so two taps can't make two codes.
  perform 1 from public.students where id = p_student for update;
  st := public.shop_status(p_tenant, p_student);
  if st ->> 'code' is not null then return st || jsonb_build_object('reused', true); end if;
  if (st ->> 'frozen')::boolean then return st || jsonb_build_object('error', 'frozen'); end if;
  if coalesce((st ->> 'balance')::numeric, 0) <= 0 then return st || jsonb_build_object('error', 'empty'); end if;
  if (st ->> 'left')::int <= 0 then return st || jsonb_build_object('error', 'bought_max'); end if;
  if st ->> 'next_at' is not null then return st || jsonb_build_object('error', 'wait'); end if;
  if not (st ->> 'window_open')::boolean then return st || jsonb_build_object('error', 'window'); end if;
  -- Codes from earlier days that were never used are cleared.
  update public.shop_codes set revoked_at = now() where tenant_id = p_tenant and used_at is null and revoked_at is null and expires_at <= now();
  loop
    c := '';
    for i in 0..5 loop
      c := c || substr(a, 1 + (('x' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), i * 3 + 1, 3))::bit(12)::int % 32), 1);
    end loop;
    exit when not exists (select 1 from public.shop_codes where tenant_id = p_tenant and code = c and used_at is null and revoked_at is null);
  end loop;
  v_exp := (st ->> 'day_ends')::timestamptz;
  insert into public.shop_codes (tenant_id, student_id, code, made_by, made_as, expires_at) values (p_tenant, p_student, c, p_by, coalesce(p_as, 'student'), v_exp);
  insert into public.shop_events (tenant_id, student_id, kind, detail) values (p_tenant, p_student, 'code', jsonb_build_object('made_as', p_as));
  return st || jsonb_build_object('code', c, 'code_expires', v_exp, 'reused', false);
end$$;

/** A refusal at the till: recorded for everyone to see, returned as a value (so the record stays). */
create or replace function public.shop_refuse(p_tenant uuid, p_student uuid, p_operator uuid, p_reason text, p_amount numeric, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.shop_events (tenant_id, student_id, kind, amount, detail, operator)
    values (p_tenant, p_student, case when p_reason = 'bad_code' then 'bad_code' else 'refused' end, p_amount, jsonb_build_object('reason', p_reason) || coalesce(p_extra, '{}'::jsonb), p_operator);
  return jsonb_build_object('error', p_reason, 'student_id', p_student, 'amount', p_amount) || coalesce(p_extra, '{}'::jsonb);
end$$;

/**
 * The seller types a code: the child it belongs to (name, photo, class; never the balance), so the
 * seller can check it's the child in front of them before paying. A wrong code is recorded.
 */
create or replace function public.shop_lookup_code(p_tenant uuid, p_operator uuid, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s     public.tenant_settings;
  v_tz  text;
  c     public.shop_codes;
  st    record;
begin
  select * into s from public.tenant_settings where tenant_id = p_tenant;
  select coalesce(timezone, 'Africa/Lagos') into v_tz from public.tenants where id = p_tenant;
  if not public.shop_in_windows(s.shop_selling_windows, (now() at time zone v_tz)::time) then
    return jsonb_build_object('error', 'closed', 'windows', s.shop_selling_windows);
  end if;
  select * into c from public.shop_codes where tenant_id = p_tenant and code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
    and used_at is null and revoked_at is null and expires_at > now();
  if c.id is null then return public.shop_refuse(p_tenant, null, p_operator, 'bad_code', null); end if;
  select s2.id, s2.first_name, s2.last_name, s2.photo_url, g.name as class_name into st
    from public.students s2 left join public.class_groups g on g.id = s2.class_group_id where s2.id = c.student_id;
  return jsonb_build_object('student_id', st.id, 'name', st.first_name || ' ' || st.last_name, 'photo_url', st.photo_url, 'class_name', st.class_name);
end$$;
/**
 * A sale at the till (server only). Pays with a buy code, a fingerprint scan, or (if the
 * school allows it) the ID card. Prices come from the shop; stock, limits, the wait, buys
 * left and the balance are all checked with the wallet locked. Refusals come back as values.
 */
create or replace function public.shop_sell(p_tenant uuid, p_operator uuid, p_items jsonb, p_amount numeric, p_method text,
  p_code text default null, p_scan uuid default null, p_student uuid default null, p_reference text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s        public.tenant_settings;
  v_sid    uuid := null;
  v_code   public.shop_codes;
  v_scan   public.shop_finger_scans;
  it       record;
  v_lines  jsonb := '[]'::jsonb;
  v_total  numeric := 0;
  w        public.wallets;
  st       jsonb;
  v_tx     uuid;
  v_tz     text;
  v_ref    text := coalesce(p_reference, 'SHOP-' || upper(substr(md5(gen_random_uuid()::text), 1, 10)));
begin
  select * into s from public.tenant_settings where tenant_id = p_tenant;
  -- Sellers sell only in the school's selling times. Wrong codes never stop a seller (the break is short);
  -- they are recorded, and admins are alerted when one seller types many.
  select coalesce(timezone, 'Africa/Lagos') into v_tz from public.tenants where id = p_tenant;
  if not public.shop_in_windows(s.shop_selling_windows, (now() at time zone v_tz)::time) then
    return jsonb_build_object('error', 'closed', 'windows', s.shop_selling_windows);
  end if;
  if p_method = 'code' then
    select * into v_code from public.shop_codes where tenant_id = p_tenant and code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
      and used_at is null and revoked_at is null for update;
    if v_code.id is null or v_code.expires_at <= now() then return public.shop_refuse(p_tenant, null, p_operator, 'bad_code', null); end if;
    v_sid := v_code.student_id;
  elsif p_method = 'fingerprint' then
    select * into v_scan from public.shop_finger_scans where id = p_scan and tenant_id = p_tenant and used_at is null and at > now() - interval '2 minutes' for update;
    if v_scan.id is null then return jsonb_build_object('error', 'scan_expired'); end if;
    v_sid := v_scan.student_id;
  elsif p_method = 'card' then
    if coalesce(s.shop_require_code, true) then return jsonb_build_object('error', 'code_required'); end if;
    v_sid := p_student;
  else
    raise exception 'unknown payment method' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students where id = v_sid and tenant_id = p_tenant) then return jsonb_build_object('error', 'not_found'); end if;

  -- The basket, priced by the shop.
  for it in select (e ->> 'id')::uuid as id, greatest(1, least(50, (e ->> 'qty')::int)) as qty from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e loop
    declare si public.shop_items;
    begin
      select * into si from public.shop_items where id = it.id and tenant_id = p_tenant for update;
      if si.id is null or not si.active then return public.shop_refuse(p_tenant, v_sid, p_operator, 'not_for_sale', null); end if;
      if si.stock is not null and si.stock < it.qty then
        return public.shop_refuse(p_tenant, v_sid, p_operator, 'out_of_stock', null, jsonb_build_object('item', si.name, 'left', si.stock));
      end if;
      v_lines := v_lines || jsonb_build_object('id', si.id, 'name', si.name, 'category', si.category, 'qty', it.qty, 'price', si.price);
      v_total := v_total + it.qty * si.price;
    end;
  end loop;
  if jsonb_array_length(v_lines) = 0 then v_total := round(coalesce(p_amount, 0), 2); end if;
  if v_total <= 0 then return jsonb_build_object('error', 'empty_basket'); end if;

  -- The wallet and the school's rules, with the wallet locked.
  select * into w from public.wallets where student_id = v_sid and tenant_id = p_tenant for update;
  st := public.shop_status(p_tenant, v_sid);
  if w.student_id is null or w.balance <= 0 then return public.shop_refuse(p_tenant, v_sid, p_operator, 'empty', v_total, jsonb_build_object('balance', coalesce(w.balance, 0))); end if;
  if w.frozen then return public.shop_refuse(p_tenant, v_sid, p_operator, 'frozen', v_total); end if;
  if (st ->> 'left')::int <= 0 then return public.shop_refuse(p_tenant, v_sid, p_operator, 'bought_max', v_total, jsonb_build_object('max', st -> 'max')); end if;
  if st ->> 'next_at' is not null then return public.shop_refuse(p_tenant, v_sid, p_operator, 'wait', v_total, jsonb_build_object('next_at', st -> 'next_at')); end if;
  if st ->> 'cap' is not null and (st ->> 'spent_today')::numeric + v_total > (st ->> 'cap')::numeric then
    return public.shop_refuse(p_tenant, v_sid, p_operator, 'over_limit', v_total, jsonb_build_object('cap', st -> 'cap', 'cap_left', st -> 'cap_left'));
  end if;
  if w.balance < v_total then return public.shop_refuse(p_tenant, v_sid, p_operator, 'not_enough', v_total, jsonb_build_object('balance', w.balance)); end if;

  update public.wallets set balance = balance - v_total, updated_at = now() where student_id = v_sid returning * into w;
  insert into public.wallet_transactions (tenant_id, student_id, kind, amount, balance_after, method, reference, description, items, recorded_by)
    values (p_tenant, v_sid, 'purchase', -v_total, w.balance, p_method, v_ref,
            coalesce((select string_agg((l ->> 'qty') || '× ' || (l ->> 'name'), ', ') from jsonb_array_elements(v_lines) l), 'Purchase'),
            v_lines, p_operator)
    returning id into v_tx;
  for it in select (l ->> 'id')::uuid as id, (l ->> 'qty')::int as qty from jsonb_array_elements(v_lines) l loop
    update public.shop_items set stock = stock - it.qty where id = it.id and stock is not null;
    if found then insert into public.shop_stock_moves (tenant_id, item_id, change, reason, by_user) values (p_tenant, it.id, -it.qty, 'sale', p_operator); end if;
  end loop;
  if v_code.id is not null then update public.shop_codes set used_at = now(), used_tx = v_tx where id = v_code.id; end if;
  if v_scan.id is not null then update public.shop_finger_scans set used_at = now() where id = v_scan.id; end if;
  insert into public.shop_events (tenant_id, student_id, kind, amount, detail, operator)
    values (p_tenant, v_sid, 'purchase', v_total, jsonb_build_object('method', p_method, 'items', v_lines, 'balance', w.balance, 'reference', v_ref), p_operator);
  if w.balance = 0 then
    insert into public.shop_events (tenant_id, student_id, kind, amount, detail) values (p_tenant, v_sid, 'exhausted', 0, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'student_id', v_sid, 'total', v_total, 'balance', w.balance, 'lines', v_lines, 'reference', v_ref, 'tx', v_tx,
    'exhausted', w.balance = 0, 'low', w.low_balance_alert is not null and w.balance < w.low_balance_alert,
    'left_today', greatest((st ->> 'left')::int - 1, 0));
end$$;

/** A fingerprint read by a machine in tuck shop mode: kept for the till to pick up (2 minutes). */
create or replace function public.shop_record_scan(p_device uuid, p_student uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid; v_id uuid;
begin
  select tenant_id into v_tenant from public.attendance_devices where id = p_device and mode = 'shop' and active;
  if v_tenant is null or not exists (select 1 from public.students where id = p_student and tenant_id = v_tenant) then return null; end if;
  delete from public.shop_finger_scans where tenant_id = v_tenant and at < now() - interval '1 day';
  insert into public.shop_finger_scans (tenant_id, device_id, student_id) values (v_tenant, p_device, p_student) returning id into v_id;
  return v_id;
end$$;

revoke execute on function public.shop_status(uuid, uuid), public.shop_make_code(uuid, uuid, uuid, text), public.shop_refuse(uuid, uuid, uuid, text, numeric, jsonb),
  public.shop_sell(uuid, uuid, jsonb, numeric, text, text, uuid, uuid, text), public.shop_record_scan(uuid, uuid), public.shop_lookup_code(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.shop_status(uuid, uuid), public.shop_make_code(uuid, uuid, uuid, text), public.shop_refuse(uuid, uuid, uuid, text, numeric, jsonb),
  public.shop_sell(uuid, uuid, jsonb, numeric, text, text, uuid, uuid, text), public.shop_record_scan(uuid, uuid), public.shop_lookup_code(uuid, uuid, text) to service_role;

-- Only admins add money now (the bursar no longer can, unless the school makes them an admin).
create or replace function public.wallet_credit(p_student uuid, p_amount numeric, p_kind text, p_method text, p_reference text, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.my_tenant_id();
  w public.wallets;
begin
  if v_tenant is null or not public.has_role(array['school_admin','principal','platform_admin']) then raise exception 'only a school admin can add money to wallets'; end if;
  if p_kind not in ('topup','refund') then raise exception 'invalid kind'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be more than zero'; end if;
  if not exists (select 1 from public.students where id = p_student and tenant_id = v_tenant) then raise exception 'student not found'; end if;
  insert into public.wallets (student_id, tenant_id) values (p_student, v_tenant) on conflict (student_id) do nothing;
  update public.wallets set balance = balance + p_amount, updated_at = now() where student_id = p_student returning * into w;
  insert into public.wallet_transactions (tenant_id, student_id, kind, amount, balance_after, method, reference, description, recorded_by)
  values (v_tenant, p_student, p_kind, p_amount, w.balance, p_method, p_reference, p_description, auth.uid());
  insert into public.shop_events (tenant_id, student_id, kind, amount, detail, operator) values (v_tenant, p_student, 'topup', p_amount, jsonb_build_object('kind', p_kind, 'balance', w.balance), auth.uid());
  return jsonb_build_object('balance', w.balance);
end $$;

-- Codes, scans and the shop log are not kept in the recycle bin (9400).
do $$ begin
  drop trigger if exists aaa_recycle_bin on public.shop_codes;
  drop trigger if exists aaa_recycle_bin_unlink on public.shop_codes;
  drop trigger if exists aaa_recycle_bin on public.shop_finger_scans;
  drop trigger if exists aaa_recycle_bin_unlink on public.shop_finger_scans;
  drop trigger if exists aaa_recycle_bin on public.shop_events;
  drop trigger if exists aaa_recycle_bin_unlink on public.shop_events;
  drop trigger if exists aaa_recycle_bin on public.shop_stock_moves;
  drop trigger if exists aaa_recycle_bin_unlink on public.shop_stock_moves;
end $$;
