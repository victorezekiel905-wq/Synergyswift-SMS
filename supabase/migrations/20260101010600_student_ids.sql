-- 10600: student IDs from the school's initials and a running number: Greenfield College →
-- GC-0001, GC-0002, … Every way a student is added (the form, a list upload, admissions, a class
-- code) gets the next number when no admission number is typed; a typed one is kept. The initials
-- come from the school's name (small words like "of" and "the" left out); a school can choose its
-- own (tenant_settings.student_id_prefix). Students already enrolled keep their numbers unless an
-- admin renumbers everyone (the old number is kept in previous_admission_no). Safe to run again.

alter table public.tenant_settings add column if not exists student_id_prefix text;
do $$ begin
  alter table public.tenant_settings add constraint student_id_prefix_ok check (student_id_prefix is null or student_id_prefix ~ '^[A-Z0-9]{1,8}$');
exception when duplicate_object then null; end $$;
alter table public.students add column if not exists previous_admission_no text;

/** The initials of a school's name: "Greenfield College" → GC, "Royal International School" → RIS, "Kings" → KIN. */
create or replace function public.school_acronym(p_name text) returns text
language sql immutable set search_path = '' as $$
  with w as (
    select x, ord from regexp_split_to_table(btrim(regexp_replace(upper(coalesce(p_name, '')), '[^A-Z0-9 ]', ' ', 'g')), '\s+') with ordinality t(x, ord)
    where x <> '' and x not in ('OF', 'THE', 'AND', 'FOR', 'AT', 'IN', 'A', 'AN', 'LTD', 'LIMITED')
  )
  select case
    when (select count(*) from w) >= 2 then left((select string_agg(left(x, 1), '' order by ord) from w), 6)
    when (select count(*) from w) = 1 then left((select x from w), 3)
    else 'SCH' end
$$;

/** The school's student ID prefix: its own choice, or the initials of its name. */
create or replace function public.student_id_prefix(p_tenant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(s.student_id_prefix, ''), public.school_acronym(coalesce(nullif(s.school_name, ''), t.name)))
  from public.tenants t left join public.tenant_settings s on s.tenant_id = t.id
  where t.id = p_tenant
$$;

/** The next free student ID in a school (PREFIX-0001, PREFIX-0002, …). Call inside the insert's transaction. */
create or replace function public.next_admission_no(p_tenant uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_prefix text; v_n bigint;
begin
  -- One number at a time per school, so two students added together never get the same one.
  perform pg_advisory_xact_lock(hashtext('admission_no:' || p_tenant::text));
  v_prefix := coalesce(public.student_id_prefix(p_tenant), 'SCH');
  select coalesce(max((substring(admission_no from '^' || v_prefix || '-(\d{1,9})$'))::bigint), 0) + 1 into v_n
    from public.students where tenant_id = p_tenant;
  return v_prefix || '-' || lpad(v_n::text, 4, '0');
end$$;

-- A student added without an admission number gets the next one.
create or replace function public.students_admission_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(new.admission_no), '') = '' then new.admission_no := public.next_admission_no(new.tenant_id); end if;
  return new;
end$$;
drop trigger if exists students_admission_no on public.students;
create trigger students_admission_no before insert on public.students for each row execute function public.students_admission_no();

/**
 * Gives every student in a school a new ID in the school's format, oldest first (by when they were
 * added). Each old number is kept in previous_admission_no. Server only; admins ask for it.
 */
create or replace function public.renumber_students(p_tenant uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_prefix text; r record; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('admission_no:' || p_tenant::text));
  v_prefix := coalesce(public.student_id_prefix(p_tenant), 'SCH');
  -- Out of the way first, so no new number clashes with an old one still in place.
  update public.students set previous_admission_no = coalesce(previous_admission_no, admission_no), admission_no = 'TMP-' || replace(id::text, '-', '')
    where tenant_id = p_tenant;
  for r in select id from public.students where tenant_id = p_tenant order by created_at, id loop
    n := n + 1;
    update public.students set admission_no = v_prefix || '-' || lpad(n::text, 4, '0') where id = r.id;
  end loop;
  insert into public.audit_logs (tenant_id, action, meta) values (p_tenant, 'students.renumbered', jsonb_build_object('prefix', v_prefix, 'students', n));
  return n;
end$$;

revoke execute on function public.student_id_prefix(uuid), public.next_admission_no(uuid), public.renumber_students(uuid), public.students_admission_no() from public, anon, authenticated;
grant execute on function public.student_id_prefix(uuid), public.next_admission_no(uuid), public.renumber_students(uuid) to service_role;
