-- =====================================================================
--  Phase 11c: library.
--
--  * Catalogue: print and digital (e-book, audio, video, link) with cover,
--    description, year, edition, language, price and a barcode for books
--    without an ISBN; digital items open for everyone, staff or students.
--  * Reservations: a queue per title; a returned copy is held for the next
--    reader for a few days, and nobody else can borrow it meanwhile.
--  * Loans: a limit per student, renewals (not when someone is waiting),
--    lost books charged at the book's price, fines owed, paid or waived,
--    overdue reminders.
-- =====================================================================

alter table public.library_books add column if not exists format text not null default 'print' check (format in ('print','ebook','audio','video','link'));
alter table public.library_books add column if not exists barcode text;
alter table public.library_books add column if not exists cover_url text;
alter table public.library_books add column if not exists description text;
alter table public.library_books add column if not exists year int check (year between 1400 and 2200);
alter table public.library_books add column if not exists edition text;
alter table public.library_books add column if not exists language text;
alter table public.library_books add column if not exists price numeric(14,2) check (price >= 0);
alter table public.library_books add column if not exists digital_path text;      -- a file in the library-digital bucket
alter table public.library_books add column if not exists digital_url text;       -- or a link
alter table public.library_books add column if not exists access text not null default 'everyone' check (access in ('everyone','staff','students'));
alter table public.library_books add column if not exists views int not null default 0;
create unique index if not exists library_books_barcode on public.library_books(tenant_id, barcode) where barcode is not null;
create index if not exists library_books_isbn on public.library_books(tenant_id, isbn) where isbn is not null;
insert into storage.buckets (id, name, public) values ('library-digital', 'library-digital', false) on conflict (id) do nothing;

alter table public.library_loans add column if not exists renewals int not null default 0;
alter table public.library_loans add column if not exists fine_status text not null default 'none' check (fine_status in ('none','owed','paid','waived'));
alter table public.library_loans add column if not exists fine_settled_at timestamptz;
alter table public.library_loans add column if not exists fine_settled_by uuid references public.users(id) on delete set null;
alter table public.library_loans add column if not exists lost_at timestamptz;
alter table public.library_loans add column if not exists last_reminded_at timestamptz;

alter table public.tenant_settings add column if not exists library_max_loans int not null default 3 check (library_max_loans between 1 and 50);
alter table public.tenant_settings add column if not exists library_hold_days int not null default 3 check (library_hold_days between 1 and 30);
alter table public.tenant_settings add column if not exists library_max_renewals int not null default 2 check (library_max_renewals between 0 and 20);

create table if not exists public.library_reservations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  book_id      uuid not null references public.library_books(id) on delete cascade,
  student_id   uuid references public.students(id) on delete cascade,
  staff_id     uuid references public.staff(id) on delete cascade,
  status       text not null default 'waiting' check (status in ('waiting','ready','collected','cancelled','expired')),
  ready_at     timestamptz,
  expires_at   timestamptz,
  notified_at  timestamptz,                 -- the reader was told the book is waiting
  created_at   timestamptz not null default now(),
  check ((student_id is null) <> (staff_id is null))
);
create index if not exists library_reservations_queue on public.library_reservations(book_id, status, created_at);
create unique index if not exists library_reservations_once on public.library_reservations(book_id, coalesce(student_id, staff_id)) where status in ('waiting','ready');

create or replace function public.is_librarian()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['librarian','school_admin','principal','platform_admin']);
$$;
grant execute on function public.is_librarian() to authenticated;

-- Copies held for readers who reserved the book (not for this borrower).
create or replace function public.library_holds_for_others(p_book uuid, p_student uuid, p_staff uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.library_reservations r
   where r.book_id = p_book and r.status = 'ready' and r.expires_at > now()
     and coalesce(r.student_id, r.staff_id) is distinct from coalesce(p_student, p_staff);
$$;

-- Issue: copies available after holds, digital items never, within the loan limit; a borrower's own hold is collected.
create or replace function public.library_issue(p_book uuid, p_student uuid, p_staff uuid, p_days int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_book public.library_books; v_id uuid; v_max int; v_open int;
begin
  perform set_config('app.library_fn', 'on', true);
  if not public.is_librarian() then raise exception 'forbidden'; end if;
  select * into v_book from public.library_books where id = p_book and tenant_id = public.my_tenant_id() for update;
  if v_book.id is null then raise exception 'book not found'; end if;
  if v_book.format <> 'print' then raise exception 'digital items are read online, not lent'; end if;
  if v_book.available_copies <= public.library_holds_for_others(p_book, p_student, p_staff) then
    raise exception '%', case when v_book.available_copies > 0 then 'the copies left are held for readers who reserved this book' else 'no copies available; reserve it instead' end;
  end if;
  if p_student is not null then
    select library_max_loans into v_max from public.tenant_settings where tenant_id = v_book.tenant_id;
    select count(*) into v_open from public.library_loans where student_id = p_student and returned_at is null;
    if v_open >= coalesce(v_max, 3) then raise exception 'this student already has % books out (the most allowed)', v_open; end if;
  end if;
  update public.library_books set available_copies = available_copies - 1 where id = p_book;
  insert into public.library_loans (tenant_id, book_id, student_id, staff_id, issued_by, due_at)
  values (v_book.tenant_id, p_book, p_student, p_staff, auth.uid(), now() + make_interval(days => greatest(p_days, 1)))
  returning id into v_id;
  update public.library_reservations set status = 'collected'
   where book_id = p_book and status in ('waiting','ready') and coalesce(student_id, staff_id) = coalesce(p_student, p_staff);
  return v_id;
end $$;

-- Return: fine for late days; the copy goes to the next reader in the queue, held for them.
create or replace function public.library_return(p_loan uuid, p_fine_per_day numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_loan public.library_loans; v_fine numeric; v_hold int; v_next uuid;
begin
  perform set_config('app.library_fn', 'on', true);
  if not public.is_librarian() then raise exception 'forbidden'; end if;
  select * into v_loan from public.library_loans where id = p_loan and tenant_id = public.my_tenant_id() and returned_at is null for update;
  if v_loan.id is null then raise exception 'loan not found or already returned'; end if;
  v_fine := greatest(0, ceil(extract(epoch from (now() - v_loan.due_at)) / 86400.0)) * coalesce(p_fine_per_day, 0);
  update public.library_loans set returned_at = now(), fine_amount = v_fine, fine_status = case when v_fine > 0 then 'owed' else 'none' end where id = p_loan;
  update public.library_books set available_copies = least(total_copies, available_copies + 1) where id = v_loan.book_id;
  select library_hold_days into v_hold from public.tenant_settings where tenant_id = v_loan.tenant_id;
  select id into v_next from public.library_reservations where book_id = v_loan.book_id and status = 'waiting' order by created_at limit 1 for update skip locked;
  if v_next is not null then
    update public.library_reservations set status = 'ready', ready_at = now(), expires_at = now() + make_interval(days => coalesce(v_hold, 3)), notified_at = null where id = v_next;
  end if;
  return v_fine;
end $$;

-- Renew: not overdue by a lot, not past the renewal limit, and nobody waiting for the book.
create or replace function public.library_renew(p_loan uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_loan public.library_loans; v_days int; v_max int; v_due timestamptz;
begin
  perform set_config('app.library_fn', 'on', true);
  select * into v_loan from public.library_loans where id = p_loan and tenant_id = public.my_tenant_id() and returned_at is null for update;
  if v_loan.id is null then raise exception 'loan not found'; end if;
  if not (public.is_librarian() or public.is_student_self(v_loan.student_id)
          or exists (select 1 from public.staff s where s.id = v_loan.staff_id and s.user_id = auth.uid())) then raise exception 'forbidden'; end if;
  select library_loan_days, library_max_renewals into v_days, v_max from public.tenant_settings where tenant_id = v_loan.tenant_id;
  if v_loan.renewals >= coalesce(v_max, 2) then raise exception 'this book has been renewed the most times allowed; please return it'; end if;
  if exists (select 1 from public.library_reservations where book_id = v_loan.book_id and status = 'waiting') then raise exception 'someone is waiting for this book; please return it'; end if;
  if not public.is_librarian() and v_loan.due_at < now() - interval '7 days' then raise exception 'this book is well overdue; please bring it to the library'; end if;
  v_due := greatest(v_loan.due_at, now()) + make_interval(days => coalesce(v_days, 14));
  update public.library_loans set due_at = v_due, renewals = renewals + 1 where id = p_loan;
  return v_due;
end $$;

-- Reserve: for yourself (or by the librarian for a reader). If a copy is free now, it is held straight away.
create or replace function public.library_reserve(p_book uuid, p_student uuid, p_staff uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_book public.library_books; v_hold int; v_status text;
begin
  if not (public.is_librarian() or (p_student is not null and public.is_student_self(p_student))
          or (p_staff is not null and exists (select 1 from public.staff s where s.id = p_staff and s.user_id = auth.uid()))) then raise exception 'forbidden'; end if;
  select * into v_book from public.library_books where id = p_book and tenant_id = public.my_tenant_id();
  if v_book.id is null then raise exception 'book not found'; end if;
  if v_book.format <> 'print' then raise exception 'digital items can be read now; no need to reserve'; end if;
  if exists (select 1 from public.library_loans where book_id = p_book and returned_at is null and coalesce(student_id, staff_id) = coalesce(p_student, p_staff)) then
    raise exception 'you already have this book';
  end if;
  select library_hold_days into v_hold from public.tenant_settings where tenant_id = v_book.tenant_id;
  v_status := case when v_book.available_copies > public.library_holds_for_others(p_book, p_student, p_staff) then 'ready' else 'waiting' end;
  insert into public.library_reservations (tenant_id, book_id, student_id, staff_id, status, ready_at, expires_at)
  values (v_book.tenant_id, p_book, p_student, p_staff, v_status, case when v_status = 'ready' then now() end,
          case when v_status = 'ready' then now() + make_interval(days => coalesce(v_hold, 3)) end);
  return v_status;
exception when unique_violation then raise exception 'you have already reserved this book';
end $$;

-- Lost: the loan closes, the reader owes the book's price (plus any late fine), and the library has one copy fewer.
create or replace function public.library_lost(p_loan uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_loan public.library_loans; v_price numeric;
begin
  perform set_config('app.library_fn', 'on', true);
  if not public.is_librarian() then raise exception 'forbidden'; end if;
  select * into v_loan from public.library_loans where id = p_loan and tenant_id = public.my_tenant_id() and returned_at is null for update;
  if v_loan.id is null then raise exception 'loan not found or already closed'; end if;
  select coalesce(price, 0) into v_price from public.library_books where id = v_loan.book_id;
  update public.library_loans set returned_at = now(), lost_at = now(), fine_amount = v_price, fine_status = case when v_price > 0 then 'owed' else 'none' end where id = p_loan;
  update public.library_books set total_copies = greatest(0, total_copies - 1) where id = v_loan.book_id;
  return v_price;
end $$;

-- Holds not collected in time lapse, and the next reader gets the copy.
create or replace function public.library_expire_holds()
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_next uuid; v_hold int; n int := 0;
begin
  for r in update public.library_reservations set status = 'expired' where status = 'ready' and expires_at < now() returning book_id, tenant_id loop
    select library_hold_days into v_hold from public.tenant_settings where tenant_id = r.tenant_id;
    select id into v_next from public.library_reservations where book_id = r.book_id and status = 'waiting' order by created_at limit 1;
    if v_next is not null then
      update public.library_reservations set status = 'ready', ready_at = now(), expires_at = now() + make_interval(days => coalesce(v_hold, 3)) where id = v_next;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.library_expire_holds() from public, anon, authenticated;
grant execute on function public.library_expire_holds() to service_role;
grant execute on function public.library_renew(uuid), public.library_reserve(uuid, uuid, uuid), public.library_lost(uuid) to authenticated;

-- Fines are settled by the library (paid or waived) and nothing else about a loan changes by hand.
drop policy if exists library_loans_settle on public.library_loans;
create policy library_loans_settle on public.library_loans for update using (tenant_id = public.my_tenant_id() and public.is_librarian()) with check (tenant_id = public.my_tenant_id());
create or replace function public.library_loan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  -- Issue, return, renew and lost go through the library functions, which set this flag for their own statement.
  if (new.book_id, new.student_id, new.staff_id, new.issued_at, new.due_at, new.returned_at, new.fine_amount, new.renewals, new.lost_at)
     is distinct from (old.book_id, old.student_id, old.staff_id, old.issued_at, old.due_at, old.returned_at, old.fine_amount, old.renewals, old.lost_at)
     and current_setting('app.library_fn', true) is distinct from 'on' then
    raise exception 'loans change only by issuing, returning, renewing or marking lost';
  end if;
  if new.fine_status is distinct from old.fine_status and current_setting('app.library_fn', true) is distinct from 'on' then
    if new.fine_status not in ('paid','waived') or old.fine_status <> 'owed' then raise exception 'a fine can only be marked paid or waived'; end if;
    new.fine_settled_at := now(); new.fine_settled_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists library_loan_guard on public.library_loans;
create trigger library_loan_guard before update on public.library_loans for each row execute function public.library_loan_guard();

alter table public.library_reservations enable row level security;
drop policy if exists library_reservations_read on public.library_reservations;
create policy library_reservations_read on public.library_reservations for select using (tenant_id = public.my_tenant_id() and (public.is_librarian()
  or (student_id is not null and (public.is_student_self(student_id) or public.is_guardian_of(student_id)))
  or exists (select 1 from public.staff s where s.id = library_reservations.staff_id and s.user_id = auth.uid())));
drop policy if exists library_reservations_manage on public.library_reservations;
create policy library_reservations_manage on public.library_reservations for update using (tenant_id = public.my_tenant_id() and public.is_librarian()) with check (tenant_id = public.my_tenant_id());
-- readers reserve and cancel through the functions and the server

grant all on public.library_reservations to service_role;
select public.attach_change_log();
