-- 10300: one sign-up code per class, with the class teacher's confirmation.
--
-- * Every class has one shared sign-up code. A student types it with their name, a username
--   and a password. That makes a sign-in and a request that waits; the student can see
--   nothing yet.
-- * The class teacher (or a school admin) confirms each request: they match it to the
--   student's record in that class, or add the student as new. Only then does the student's
--   account open, in that class. A request can also be declined.
-- * Each student's personal sign-up code (9600) still works.
-- Nobody but the server reads these tables. Safe to run more than once.

create table if not exists public.class_signup_codes (
  class_group_id uuid primary key references public.class_groups(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  code           text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  created_at     timestamptz not null default now()
);
create index if not exists class_signup_codes_tenant on public.class_signup_codes(tenant_id);

create table if not exists public.class_signups (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  class_group_id uuid not null references public.class_groups(id) on delete cascade,
  user_id        uuid not null unique references auth.users(id) on delete cascade,
  full_name      text not null,
  username       text,
  email          text not null,
  status         text not null default 'pending' check (status in ('pending', 'approved')),
  student_id     uuid references public.students(id) on delete set null,
  decided_by     uuid references public.users(id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists class_signups_class on public.class_signups(tenant_id, class_group_id, status);

alter table public.class_signup_codes enable row level security;
alter table public.class_signups enable row level security;
revoke all on public.class_signup_codes, public.class_signups from anon, authenticated;
grant select, insert, update, delete on public.class_signup_codes, public.class_signups to service_role;

/** A new code: 8 characters from 32 with no look-alikes, used by no person and no class. */
create or replace function public.new_account_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  h text; c text; i int;
begin
  loop
    h := md5(gen_random_uuid()::text || clock_timestamp()::text);
    c := '';
    for i in 0..7 loop
      c := c || substr(a, 1 + (('x' || substr(h, i * 3 + 1, 3))::bit(12)::int % 32), 1);
    end loop;
    exit when not exists (select 1 from public.account_codes where code = c)
          and not exists (select 1 from public.class_signup_codes where code = c);
  end loop;
  return c;
end$$;

/** Makes (or replaces) a class's sign-up code. Returns the code. Server only. */
create or replace function public.issue_class_code(p_class uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid; v_code text;
begin
  select tenant_id into v_tenant from public.class_groups where id = p_class;
  if v_tenant is null then raise exception 'class not found' using errcode = 'P0002'; end if;
  v_code := public.new_account_code();
  insert into public.class_signup_codes (class_group_id, tenant_id, code) values (p_class, v_tenant, v_code)
    on conflict (class_group_id) do update set code = excluded.code, created_at = now();
  return v_code;
end$$;

-- A new class gets its code at once.
create or replace function public.class_code_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.issue_class_code(new.id);
  return new;
end$$;
drop trigger if exists class_code_new on public.class_groups;
create trigger class_code_new after insert on public.class_groups for each row execute function public.class_code_on_insert();

-- Classes already there get theirs now.
do $$
declare r record;
begin
  for r in select g.id from public.class_groups g where not exists (select 1 from public.class_signup_codes c where c.class_group_id = g.id) loop
    perform public.issue_class_code(r.id);
  end loop;
end$$;

revoke execute on function public.new_account_code(), public.issue_class_code(uuid), public.class_code_on_insert() from public, anon, authenticated;
grant execute on function public.new_account_code(), public.issue_class_code(uuid) to service_role;

-- Codes and waiting requests are never kept in the recycle bin (the list in 9600 names them too).
drop trigger if exists aaa_recycle_bin on public.class_signup_codes;
drop trigger if exists aaa_recycle_bin_unlink on public.class_signup_codes;
drop trigger if exists aaa_recycle_bin on public.class_signups;
drop trigger if exists aaa_recycle_bin_unlink on public.class_signups;
