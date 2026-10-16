-- =====================================================================
--  Phase 11d: stock, assets and procurement.
--
--  * Stock items with a size or colour (uniforms), a barcode and a selling
--    price; items issued to a student or member of staff; tuck-shop and
--    uniform-shop sales take stock off automatically.
--  * Assets: serial number, supplier, warranty and a maintenance schedule;
--    services and repairs logged; any member of staff can report a fault.
--  * Procurement: suppliers; quotes against a requisition; requisitions above
--    a set amount need a second approver; purchase orders, goods received
--    into stock or the asset register, and payment recorded as an expense.
-- =====================================================================

-- ---------- Stock ----------
alter table public.inventory_items add column if not exists variant text;          -- e.g. size 10, age 7–8, blue
alter table public.inventory_items add column if not exists barcode text;
alter table public.inventory_items add column if not exists sell_price numeric(14,2) check (sell_price >= 0);
alter table public.inventory_items drop constraint if exists inventory_items_tenant_id_name_key;
create unique index if not exists inventory_items_name_variant on public.inventory_items(tenant_id, lower(name), coalesce(lower(variant), ''));
create unique index if not exists inventory_items_barcode on public.inventory_items(tenant_id, barcode) where barcode is not null;

alter table public.inventory_moves add column if not exists student_id uuid references public.students(id) on delete set null;
alter table public.inventory_moves add column if not exists staff_id uuid references public.staff(id) on delete set null;
alter table public.inventory_moves add column if not exists unit_cost numeric(14,2);
alter table public.inventory_moves add column if not exists purchase_order_id uuid;

alter table public.shop_items add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;
alter table public.shop_items add column if not exists barcode text;
create unique index if not exists shop_items_barcode on public.shop_items(tenant_id, barcode) where barcode is not null;

-- Issue stock to a person (uniform, textbooks, a laptop charger …).
create or replace function public.inventory_issue(p_item uuid, p_qty numeric, p_student uuid, p_staff uuid, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_new numeric; v_tenant uuid;
begin
  if not public.has_role(array['bursar','school_admin','principal','platform_admin']) then raise exception 'forbidden'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be positive'; end if;
  if (p_student is null) = (p_staff is null) then raise exception 'choose who receives it'; end if;
  update public.inventory_items set quantity = quantity - p_qty where id = p_item and tenant_id = public.my_tenant_id() returning quantity, tenant_id into v_new, v_tenant;
  if v_tenant is null then raise exception 'item not found'; end if;
  if v_new < 0 then raise exception 'not enough stock'; end if;
  insert into public.inventory_moves (tenant_id, item_id, kind, quantity, reason, recorded_by, student_id, staff_id)
  values (v_tenant, p_item, 'out', p_qty, coalesce(nullif(trim(p_reason), ''), 'Issued'), auth.uid(), p_student, p_staff);
  return v_new;
end $$;
grant execute on function public.inventory_issue(uuid, numeric, uuid, uuid, text) to authenticated;

-- A shop sale takes the stock it sold; a sale cannot sell what is not on the shelf.
create or replace function public.shop_sale_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare line jsonb; v_item uuid; v_name text; v_left numeric;
begin
  if new.kind <> 'purchase' or new.status <> 'success' then return null; end if;
  for line in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
    select s.inventory_item_id, s.name into v_item, v_name from public.shop_items s where s.id = (line ->> 'id')::uuid and s.tenant_id = new.tenant_id;
    if v_item is null then continue; end if;
    update public.inventory_items set quantity = quantity - coalesce((line ->> 'qty')::numeric, 1) where id = v_item returning quantity into v_left;
    if v_left < 0 then raise exception 'not enough % in stock', v_name; end if;
    insert into public.inventory_moves (tenant_id, item_id, kind, quantity, reason, reference, recorded_by, student_id)
    values (new.tenant_id, v_item, 'out', coalesce((line ->> 'qty')::numeric, 1), 'Shop sale', new.reference, new.recorded_by, new.student_id);
  end loop;
  return null;
exception when invalid_text_representation then return null;
end $$;
drop trigger if exists shop_sale_stock on public.wallet_transactions;
create trigger shop_sale_stock after insert on public.wallet_transactions for each row execute function public.shop_sale_stock();

-- ---------- Assets ----------
alter table public.assets add column if not exists serial_no text;
alter table public.assets add column if not exists supplier text;
alter table public.assets add column if not exists warranty_expires date;
alter table public.assets add column if not exists maintenance_every_days int check (maintenance_every_days between 1 and 3650);
alter table public.assets add column if not exists last_maintenance_on date;
alter table public.assets add column if not exists next_maintenance_on date;
alter table public.assets add column if not exists purchase_order_id uuid;

create table if not exists public.asset_maintenance (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  asset_id     uuid not null references public.assets(id) on delete cascade,
  kind         text not null default 'service' check (kind in ('service','repair','inspection','calibration','cleaning','fault')),
  status       text not null default 'done' check (status in ('reported','scheduled','done','cancelled')),
  description  text,
  due_on       date,
  done_on      date,
  cost         numeric(14,2) check (cost >= 0),
  vendor       text,
  reported_by  uuid references public.users(id) on delete set null,
  done_by      uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists asset_maintenance_asset on public.asset_maintenance(asset_id, created_at desc);

-- Work done moves the asset's next service date on; a fault puts it in for repair.
create or replace function public.asset_maintenance_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and new.done_on is not null and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    update public.assets set last_maintenance_on = new.done_on,
      next_maintenance_on = case when maintenance_every_days is not null then new.done_on + maintenance_every_days else next_maintenance_on end,
      status = case when status = 'repair' and new.kind in ('repair','fault') then 'in_use' else status end
     where id = new.asset_id;
  elsif new.status = 'reported' and tg_op = 'INSERT' then
    update public.assets set condition = case when condition in ('new','good') then 'fair' else condition end where id = new.asset_id;
  end if;
  return null;
end $$;
drop trigger if exists asset_maintenance_after on public.asset_maintenance;
create trigger asset_maintenance_after after insert or update on public.asset_maintenance for each row execute function public.asset_maintenance_after();

-- ---------- Procurement ----------
create table if not exists public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 160),
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  category      text,
  tax_id        text,
  bank_name     text,
  account_no    text,
  account_name  text,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.requisitions drop constraint if exists requisitions_status_check;
alter table public.requisitions add constraint requisitions_status_check check (status in ('submitted','endorsed','approved','rejected','fulfilled','cancelled'));
alter table public.requisitions add column if not exists endorsed_by uuid references public.users(id) on delete set null;
alter table public.requisitions add column if not exists endorsed_at timestamptz;
alter table public.tenant_settings add column if not exists procurement_second_approval_over numeric(14,2) not null default 500000 check (procurement_second_approval_over >= 0);

-- Small requisitions need one approver; larger ones are endorsed first, then approved by the principal or an admin who did not endorse them.
create or replace function public.requisitions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_limit numeric;
begin
  if auth.uid() is null then return new; end if;
  if new.status is distinct from old.status then
    if new.status = 'cancelled' and old.requested_by = auth.uid() and old.status in ('submitted','endorsed') then return new; end if;
    if not public.has_role(array['school_admin','principal','bursar','platform_admin']) then raise exception 'only approvers can change requisition status'; end if;
    if old.requested_by = auth.uid() and new.status in ('endorsed','approved','rejected') then raise exception 'you cannot approve your own requisition'; end if;
    select procurement_second_approval_over into v_limit from public.tenant_settings where tenant_id = new.tenant_id;
    if new.status = 'endorsed' then
      if old.status <> 'submitted' then raise exception 'only a new requisition can be endorsed'; end if;
      new.endorsed_by := auth.uid(); new.endorsed_at := now();
    elsif new.status = 'approved' then
      if old.status not in ('submitted','endorsed') then raise exception 'this requisition is %', old.status; end if;
      if new.total_amount > coalesce(v_limit, 500000) then
        if old.status <> 'endorsed' then raise exception 'requisitions over % need endorsing first, then a second approver', coalesce(v_limit, 500000); end if;
        if old.endorsed_by = auth.uid() then raise exception 'the second approval must come from someone other than the endorser'; end if;
        if not public.has_role(array['school_admin','principal','platform_admin']) then raise exception 'the principal or a school admin gives the second approval'; end if;
      end if;
    elsif new.status = 'fulfilled' and old.status <> 'approved' then
      raise exception 'only approved requisitions are fulfilled';
    end if;
  end if;
  if new.total_amount is distinct from old.total_amount and old.status <> 'submitted' then raise exception 'the amount cannot change after approval has started'; end if;
  return new;
end $$;

create table if not exists public.supplier_quotes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  requisition_id  uuid not null references public.requisitions(id) on delete cascade,
  supplier_id     uuid not null references public.suppliers(id) on delete cascade,
  amount          numeric(14,2) not null check (amount >= 0),
  delivery_days   int check (delivery_days between 0 and 365),
  notes           text,
  chosen          boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (requisition_id, supplier_id)
);

create table if not exists public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  po_no           text,
  requisition_id  uuid references public.requisitions(id) on delete set null,
  supplier_id     uuid not null references public.suppliers(id),
  status          text not null default 'draft' check (status in ('draft','sent','partly_received','received','cancelled')),
  total           numeric(14,2) not null default 0,
  ordered_on      date,
  expected_on     date,
  notes           text,
  paid_at         timestamptz,
  expense_id      uuid references public.expenses(id) on delete set null,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (tenant_id, po_no)
);
create table if not exists public.purchase_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  po_id              uuid not null references public.purchase_orders(id) on delete cascade,
  description        text not null check (length(trim(description)) between 1 and 200),
  quantity           numeric not null check (quantity > 0),
  unit_cost          numeric(14,2) not null check (unit_cost >= 0),
  inventory_item_id  uuid references public.inventory_items(id) on delete set null,
  is_asset           boolean not null default false,
  received_qty       numeric not null default 0 check (received_qty >= 0),
  check (received_qty <= quantity)
);
alter table public.inventory_moves drop constraint if exists inventory_moves_po_fk;
alter table public.inventory_moves add constraint inventory_moves_po_fk foreign key (purchase_order_id) references public.purchase_orders(id) on delete set null;
alter table public.assets drop constraint if exists assets_po_fk;
alter table public.assets add constraint assets_po_fk foreign key (purchase_order_id) references public.purchase_orders(id) on delete set null;
alter table public.expenses add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null;

-- Order totals follow their lines; numbers are given when the order is first sent.
create or replace function public.po_lines_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_po uuid;
begin
  if tg_op = 'DELETE' then v_po := old.po_id; else v_po := new.po_id; end if;
  update public.purchase_orders set total = (select coalesce(sum(round(quantity * unit_cost, 2)), 0) from public.purchase_order_lines where po_id = v_po) where id = v_po;
  return null;
end $$;
drop trigger if exists po_lines_changed on public.purchase_order_lines;
create trigger po_lines_changed after insert or update or delete on public.purchase_order_lines for each row execute function public.po_lines_changed();

create or replace function public.po_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); new.status := 'draft'; new.po_no := null; new.paid_at := null; new.expense_id := null; end if;
    return new;
  end if;
  -- Receiving goods (po_receive) moves the status itself.
  if auth.uid() is null or current_setting('app.po_fn', true) = 'on' then return new; end if;
  if new.status = 'sent' and old.status = 'draft' then
    if not exists (select 1 from public.purchase_order_lines where po_id = new.id) then raise exception 'add the items before sending the order'; end if;
    new.po_no := coalesce(old.po_no, public.next_doc_no(new.tenant_id, 'po')); new.ordered_on := coalesce(new.ordered_on, current_date);
  elsif new.status is distinct from old.status and new.status in ('partly_received','received') then
    raise exception 'orders are marked received by receiving the goods';
  elsif new.status = 'cancelled' and old.status in ('partly_received','received') then
    raise exception 'goods have been received against this order';
  end if;
  if old.status <> 'draft' and (new.supplier_id is distinct from old.supplier_id) then raise exception 'the supplier cannot change after the order is sent'; end if;
  return new;
end $$;
drop trigger if exists po_guard on public.purchase_orders;
create trigger po_guard before insert or update on public.purchase_orders for each row execute function public.po_guard();

create or replace function public.po_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is null or current_setting('app.po_fn', true) = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  select status into v_status from public.purchase_orders where id = case when tg_op = 'DELETE' then old.po_id else new.po_id end;
  if v_status <> 'draft' then
    if tg_op <> 'UPDATE' or (new.description, new.quantity, new.unit_cost, new.inventory_item_id, new.is_asset) is distinct from (old.description, old.quantity, old.unit_cost, old.inventory_item_id, old.is_asset)
       or new.received_qty is distinct from old.received_qty then
      raise exception 'a sent order cannot be changed; cancel it and raise another';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists po_line_guard on public.purchase_order_lines;
create trigger po_line_guard before insert or update or delete on public.purchase_order_lines for each row execute function public.po_line_guard();

-- Goods received: stock goes up, assets are registered, and the order (and its requisition) is closed when everything has arrived.
create or replace function public.po_receive(p_line uuid, p_qty numeric, p_tags text[] default null)
returns text language plpgsql security definer set search_path = public as $$
declare l public.purchase_order_lines; po public.purchase_orders; v_sup text; v_all boolean; i int;
begin
  if not public.is_finance() then raise exception 'forbidden'; end if;
  perform set_config('app.po_fn', 'on', true);
  select * into l from public.purchase_order_lines where id = p_line and tenant_id = public.my_tenant_id() for update;
  if l.id is null then raise exception 'order line not found'; end if;
  select * into po from public.purchase_orders where id = l.po_id for update;
  if po.status not in ('sent','partly_received') then raise exception 'send the order before receiving goods'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'enter the quantity received'; end if;
  if l.received_qty + p_qty > l.quantity then raise exception 'only % more were ordered', l.quantity - l.received_qty; end if;
  update public.purchase_order_lines set received_qty = received_qty + p_qty where id = l.id;
  if l.inventory_item_id is not null then
    update public.inventory_items set quantity = quantity + p_qty, unit_cost = l.unit_cost where id = l.inventory_item_id;
    insert into public.inventory_moves (tenant_id, item_id, kind, quantity, reason, reference, recorded_by, unit_cost, purchase_order_id)
    values (l.tenant_id, l.inventory_item_id, 'in', p_qty, 'Received', po.po_no, auth.uid(), l.unit_cost, po.id);
  end if;
  if l.is_asset then
    select name into v_sup from public.suppliers where id = po.supplier_id;
    for i in 1 .. floor(p_qty)::int loop
      insert into public.assets (tenant_id, tag, name, cost, purchase_date, supplier, status, purchase_order_id)
      values (l.tenant_id, coalesce(p_tags[i], po.po_no || '-' || substr(l.id::text, 1, 4) || '-' || (l.received_qty::int + i)), l.description, l.unit_cost, current_date, v_sup, 'in_store', po.id);
    end loop;
  end if;
  select bool_and(received_qty >= quantity) into v_all from public.purchase_order_lines where po_id = po.id;
  update public.purchase_orders set status = case when v_all then 'received' else 'partly_received' end where id = po.id;
  if v_all and po.requisition_id is not null then
    update public.requisitions set status = 'fulfilled' where id = po.requisition_id and status = 'approved';
  end if;
  return case when v_all then 'received' else 'partly_received' end;
end $$;
grant execute on function public.po_receive(uuid, numeric, text[]) to authenticated;

-- ---------- RLS ----------
alter table public.asset_maintenance enable row level security;
drop policy if exists asset_maintenance_read on public.asset_maintenance;
create policy asset_maintenance_read on public.asset_maintenance for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists asset_maintenance_write on public.asset_maintenance;
create policy asset_maintenance_write on public.asset_maintenance for all using (tenant_id = public.my_tenant_id() and public.is_finance())
  with check (tenant_id = public.my_tenant_id() and public.is_finance());
drop policy if exists asset_fault_report on public.asset_maintenance;
create policy asset_fault_report on public.asset_maintenance for insert with check (tenant_id = public.my_tenant_id() and public.is_staff()
  and status = 'reported' and kind = 'fault' and reported_by = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['suppliers','supplier_quotes','purchase_orders','purchase_order_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_finance', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_finance()) with check (tenant_id = public.my_tenant_id() and public.is_finance())', t || '_finance', t);
  end loop;
end $$;
-- Requesters follow their own requisition's quotes and orders.
drop policy if exists purchase_orders_requester on public.purchase_orders;
create policy purchase_orders_requester on public.purchase_orders for select using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.requisitions r where r.id = purchase_orders.requisition_id and r.requested_by = auth.uid()));

grant all on public.asset_maintenance, public.suppliers, public.supplier_quotes, public.purchase_orders, public.purchase_order_lines to service_role;
select public.attach_change_log();
