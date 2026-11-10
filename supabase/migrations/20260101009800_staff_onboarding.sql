-- Staff onboarding (migration 9800): the subjects each member of staff teaches (ticked when they
-- are added, before they have an account), and a staff number made for them when the school
-- leaves the ID number blank. Safe to run again.

create table if not exists public.staff_subjects (
  staff_id    uuid not null references public.staff(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (staff_id, subject_id)
);
create index if not exists staff_subjects_subject_idx on public.staff_subjects(subject_id);
create index if not exists staff_subjects_tenant_idx on public.staff_subjects(tenant_id);

-- The staff member and the subject must both be this school's.
create or replace function public.staff_subjects_same_school() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff where id = new.staff_id and tenant_id = new.tenant_id)
     or not exists (select 1 from public.subjects where id = new.subject_id and tenant_id = new.tenant_id) then
    raise exception 'staff member or subject not found in this school' using errcode = '23503';
  end if;
  return new;
end$$;
drop trigger if exists staff_subjects_same_school on public.staff_subjects;
create trigger staff_subjects_same_school before insert or update on public.staff_subjects
  for each row execute function public.staff_subjects_same_school();

alter table public.staff_subjects enable row level security;
drop policy if exists staff_subjects_read on public.staff_subjects;
create policy staff_subjects_read on public.staff_subjects for select using (
  tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists staff_subjects_write on public.staff_subjects;
create policy staff_subjects_write on public.staff_subjects for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','hr_manager'])
) with check (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','hr_manager']));

-- The next free staff number in the school: STF-0001, STF-0002, …
create or replace function public.next_staff_no(p_tenant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select 'STF-' || lpad((coalesce(max((substring(staff_no from '^STF-(\d{1,9})$'))::bigint), 0) + 1)::text, 4, '0')
  from public.staff where tenant_id = p_tenant
$$;
revoke execute on function public.next_staff_no(uuid) from public, anon, authenticated;
grant execute on function public.next_staff_no(uuid) to service_role;

-- The recycle bin (9400) keeps a deleted staff member's subjects with them.
do $$
begin
  if to_regprocedure('public.recycle_bin_capture()') is not null then
    drop trigger if exists aaa_recycle_bin on public.staff_subjects;
    drop trigger if exists aaa_recycle_bin_unlink on public.staff_subjects;
    create trigger aaa_recycle_bin before delete on public.staff_subjects for each row execute function public.recycle_bin_capture('child');
    create trigger aaa_recycle_bin_unlink before update on public.staff_subjects for each row when (pg_trigger_depth() > 0)
      execute function public.recycle_bin_capture('child');
  end if;
end $$;
