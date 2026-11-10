-- Staff onboarding (migration 9800): the subjects each member of staff teaches (ticked when they
-- are added, before they have an account), the classes chosen for them before they sign up (put
-- in place by themselves the moment they do), and a staff number made for them when the school
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

-- Classes chosen for someone before they have signed up: a subject in a class, or (no subject)
-- form teacher of the class. When their account is made, these are put in place and removed.
create table if not exists public.staff_class_plans (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete cascade,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create unique index if not exists staff_class_plans_one on public.staff_class_plans
  (staff_id, class_group_id, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists staff_class_plans_tenant_idx on public.staff_class_plans(tenant_id);

create or replace function public.staff_class_plans_same_school() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff where id = new.staff_id and tenant_id = new.tenant_id)
     or not exists (select 1 from public.class_groups where id = new.class_group_id and tenant_id = new.tenant_id)
     or (new.subject_id is not null and not exists (select 1 from public.subjects where id = new.subject_id and tenant_id = new.tenant_id)) then
    raise exception 'staff member, class or subject not found in this school' using errcode = '23503';
  end if;
  return new;
end$$;
drop trigger if exists staff_class_plans_same_school on public.staff_class_plans;
create trigger staff_class_plans_same_school before insert or update on public.staff_class_plans
  for each row execute function public.staff_class_plans_same_school();

alter table public.staff_class_plans enable row level security;
drop policy if exists staff_class_plans_read on public.staff_class_plans;
create policy staff_class_plans_read on public.staff_class_plans for select using (
  tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists staff_class_plans_write on public.staff_class_plans;
create policy staff_class_plans_write on public.staff_class_plans for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin'])
) with check (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin']));

/** Puts a member of staff's chosen classes in place once they have an account. Returns how many. */
create or replace function public.apply_staff_class_plans(p_staff uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_tenant uuid; r record; n int := 0;
begin
  select user_id, tenant_id into v_user, v_tenant from public.staff where id = p_staff;
  if v_user is null then return 0; end if;
  for r in select * from public.staff_class_plans where staff_id = p_staff order by created_at loop
    if r.subject_id is null then
      update public.class_groups set form_teacher_id = v_user where id = r.class_group_id and tenant_id = v_tenant;
    else
      insert into public.subject_offerings (tenant_id, class_group_id, subject_id, teacher_id)
        values (v_tenant, r.class_group_id, r.subject_id, v_user)
        on conflict (class_group_id, subject_id) do update set teacher_id = excluded.teacher_id;
    end if;
    n := n + 1;
  end loop;
  delete from public.staff_class_plans where staff_id = p_staff;
  if n > 0 then
    insert into public.audit_logs (tenant_id, actor_id, action, target, meta)
      values (v_tenant, v_user, 'staff.classes_applied', v_user::text, jsonb_build_object('classes', n));
  end if;
  return n;
end$$;
revoke execute on function public.apply_staff_class_plans(uuid) from public, anon, authenticated;
grant execute on function public.apply_staff_class_plans(uuid) to service_role;

-- Whichever way they sign up (code, invitation link or one-time password), their record gets its
-- account here, and their classes follow.
create or replace function public.staff_joined_apply_plans() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.apply_staff_class_plans(new.id);
  return new;
end$$;
drop trigger if exists staff_joined_apply_plans on public.staff;
create trigger staff_joined_apply_plans after update of user_id on public.staff
  for each row when (old.user_id is null and new.user_id is not null) execute function public.staff_joined_apply_plans();

-- The recycle bin (9400) keeps a deleted staff member's subjects and planned classes with them.
do $$
declare t text;
begin
  if to_regprocedure('public.recycle_bin_capture()') is not null then
    foreach t in array array['staff_subjects', 'staff_class_plans'] loop
      execute format('drop trigger if exists aaa_recycle_bin on public.%I', t);
      execute format('drop trigger if exists aaa_recycle_bin_unlink on public.%I', t);
      execute format('create trigger aaa_recycle_bin before delete on public.%I for each row execute function public.recycle_bin_capture(%L)', t, 'child');
      execute format('create trigger aaa_recycle_bin_unlink before update on public.%I for each row when (pg_trigger_depth() > 0) execute function public.recycle_bin_capture(%L)', t, 'child');
    end loop;
  end if;
end $$;
