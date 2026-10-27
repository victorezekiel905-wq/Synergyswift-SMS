-- =========================================================================
-- Phase 14d-2: keeps the live-lesson engine's schools, people and classes in
-- step with Synergy Swift (the "handshake": no separate accounts or rosters).
--   tenants            → live.tenants, one live.schools row, live.tenant_settings
--   users              → live.users (students, teachers, school admins/principals, IT admins)
--   students           → live.student_profiles + class membership
--   class_groups       → live.classes (teacher = form teacher, else a subject teacher)
--   subject_offerings  → live.class_subjects (subject teachers)
--   class_staff        → live.class_members role 'teacher' (co-teachers with live lessons)
-- Deactivated people are suspended, never deleted, so their lessons stay.
-- Apply AFTER 20260101006100. Idempotent.
-- =========================================================================

-- Which live role a Synergy Swift account gets (null = no live account).
create or replace function live_app.sync_role(p_role text, p_extra text[]) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_role in ('school_admin', 'principal') then 'school_admin'
    when p_role = 'it_admin' then 'it_admin'
    when p_role = 'student' then 'student'
    when p_role = 'teacher' or 'teacher' = any(coalesce(p_extra, '{}')) or 'principal' = any(coalesce(p_extra, '{}')) then 'teacher'
    else null end;
$$;

create or replace function live_app.sync_tenant(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select id, name, slug, country, timezone, status, modules into t from public.tenants where id = p_id;
  if not found then return; end if;
  -- The engine refuses everything for a suspended school, so a closed school or one without
  -- the Live module (tenants.modules.live = false) is blocked in the database, not just in menus.
  insert into live.tenants (id, name, slug, plan_code, country, timezone, status)
  values (t.id, left(t.name, 200), t.slug, 'school', t.country, coalesce(t.timezone, 'UTC'),
          case when t.status = 'active' and coalesce(t.modules->>'live', 'true') <> 'false' then 'active' else 'suspended' end)
  on conflict (id) do update set name = excluded.name, slug = excluded.slug, country = excluded.country, timezone = excluded.timezone, status = excluded.status;
  insert into live.schools (id, tenant_id, name) values (t.id, t.id, left(t.name, 200))
  on conflict (id) do update set name = excluded.name;
  insert into live.tenant_settings (tenant_id) values (t.id) on conflict (tenant_id) do nothing;
end $$;

create or replace function live_app.sync_user(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u record; v_role text; v_grade text; v_no text;
begin
  select id, tenant_id, email, full_name, role, extra_roles, active, username into u from public.users where id = p_id;
  if not found then return; end if;
  v_role := live_app.sync_role(u.role, u.extra_roles);
  if v_role is null then
    -- No live role (any more): keep their work, stop their access.
    update live.users set status = 'suspended' where id = p_id;
    return;
  end if;
  perform live_app.sync_tenant(u.tenant_id);
  insert into live.users (id, tenant_id, school_id, email, full_name, role, status, login_name)
  values (u.id, u.tenant_id, u.tenant_id, u.email, left(coalesce(nullif(btrim(u.full_name), ''), u.email), 200), v_role,
          case when u.active then 'active' else 'suspended' end,
          case when u.username ~ '^[a-z0-9][a-z0-9.]{2,40}$' then u.username end)
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status, login_name = excluded.login_name;
  if v_role = 'student' then
    select g.level, s.admission_no into v_grade, v_no from public.students s left join public.class_groups g on g.id = s.class_group_id where s.user_id = p_id limit 1;
    insert into live.student_profiles (user_id, tenant_id, grade_level, student_number) values (u.id, u.tenant_id, v_grade, v_no)
    on conflict (user_id) do update set grade_level = excluded.grade_level, student_number = excluded.student_number;
  end if;
end $$;

-- A fresh class code in the engine's format (A–Z, 0–9, 8 characters).
create or replace function live_app.sync_class_code() returns text
language sql volatile set search_path = '' as $$
  select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
$$;

create or replace function live_app.sync_class(p_class uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; v_teacher uuid; v_code text;
begin
  select id, tenant_id, name, level, form_teacher_id into g from public.class_groups where id = p_class;
  if not found then delete from live.classes where id = p_class; return; end if;
  perform live_app.sync_tenant(g.tenant_id);
  -- The class teacher: the form teacher if they have a live account, else the first subject teacher who does.
  select lu.id into v_teacher from live.users lu where lu.id = g.form_teacher_id and lu.role in ('teacher','school_admin') and lu.status = 'active';
  if v_teacher is null then
    select lu.id into v_teacher from public.subject_offerings o join live.users lu on lu.id = o.teacher_id and lu.role in ('teacher','school_admin') and lu.status = 'active'
    where o.class_group_id = p_class order by o.id limit 1;
  end if;
  if v_teacher is null then
    -- Nobody can run it yet; an existing live class keeps its last teacher.
    if exists (select 1 from live.classes where id = p_class) then
      update live.classes set name = left(g.name, 200), grade_level = g.level where id = p_class;
    else
      return;
    end if;
  else
    loop
      v_code := live_app.sync_class_code();
      begin
        insert into live.classes (id, tenant_id, school_id, teacher_id, name, grade_level, join_code)
        values (g.id, g.tenant_id, g.tenant_id, v_teacher, left(g.name, 200), g.level, v_code)
        on conflict (id) do update set teacher_id = excluded.teacher_id, name = excluded.name, grade_level = excluded.grade_level;
        exit;
      exception when unique_violation then
        -- Only the join code can clash (the id conflict is handled above): try another.
        null;
      end;
    end loop;
  end if;
  -- Subject teachers.
  delete from live.class_subjects cs where cs.class_id = p_class
    and not exists (select 1 from public.subject_offerings o where o.id = cs.id and o.teacher_id = cs.teacher_id);
  insert into live.class_subjects (id, tenant_id, class_id, teacher_id, subject)
  select o.id, g.tenant_id, p_class, o.teacher_id, left(s.name, 60)
  from public.subject_offerings o join public.subjects s on s.id = o.subject_id
  join live.users lu on lu.id = o.teacher_id and lu.role in ('teacher','school_admin')
  where o.class_group_id = p_class
    and not exists (select 1 from live.class_subjects x where x.class_id = p_class and lower(x.subject) = lower(left(s.name, 60)) and x.id <> o.id)
  on conflict (id) do update set teacher_id = excluded.teacher_id, subject = excluded.subject;
  -- Students in the class, and co-teachers who may run live lessons.
  delete from live.class_members m where m.class_id = p_class
    and not exists (select 1 from public.students s where s.user_id = m.user_id and s.class_group_id = p_class and s.status = 'active' and m.role = 'student')
    and not exists (select 1 from public.class_staff cs where cs.user_id = m.user_id and cs.class_group_id = p_class and cs.can_teach_live and m.role = 'teacher');
  insert into live.class_members (class_id, user_id, tenant_id, role)
  select p_class, s.user_id, g.tenant_id, 'student' from public.students s join live.users lu on lu.id = s.user_id and lu.role = 'student'
  where s.class_group_id = p_class and s.status = 'active'
  on conflict (class_id, user_id) do update set role = excluded.role;
  insert into live.class_members (class_id, user_id, tenant_id, role)
  select p_class, cs.user_id, g.tenant_id, 'teacher' from public.class_staff cs join live.users lu on lu.id = cs.user_id and lu.role in ('teacher','school_admin')
  where cs.class_group_id = p_class and cs.can_teach_live and cs.user_id <> v_teacher
  on conflict (class_id, user_id) do update set role = excluded.role;
end $$;

-- ---------- triggers on Synergy Swift's tables ----------
create or replace function live_app.on_tenant() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform live_app.sync_tenant(new.id); return new; end $$;

-- Deleting a school removes everything it had in the live engine (lessons, sessions, results) in one go.
-- BEFORE DELETE must return OLD, or the school's own delete is silently skipped.
create or replace function live_app.on_tenant_delete() returns trigger language plpgsql security definer set search_path = '' as $$
begin delete from live.tenants where id = old.id; return old; end $$;

create or replace function live_app.on_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- A teacher who still owns lessons cannot simply vanish: suspend them instead (deleting the school removes everything).
    begin delete from live.users where id = old.id;
    exception when foreign_key_violation then update live.users set status = 'suspended' where id = old.id;
    end;
    return old;
  end if;
  perform live_app.sync_user(new.id);
  -- A teacher's role change can make them a class's teacher, or stop it.
  if tg_op = 'UPDATE' and (new.role is distinct from old.role or new.extra_roles is distinct from old.extra_roles or new.active is distinct from old.active) then
    perform live_app.sync_class(g.id) from public.class_groups g where g.form_teacher_id = new.id;
    perform live_app.sync_class(o.class_group_id) from public.subject_offerings o where o.teacher_id = new.id;
  end if;
  return new;
end $$;

create or replace function live_app.on_student() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.class_group_id is not null then perform live_app.sync_class(old.class_group_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.user_id is not null then perform live_app.sync_user(new.user_id); end if;
    if new.class_group_id is not null then perform live_app.sync_class(new.class_group_id); end if;
  end if;
  return coalesce(new, old);
end $$;

create or replace function live_app.on_class_group() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then delete from live.classes where id = old.id; return old; end if;
  perform live_app.sync_class(new.id);
  return new;
end $$;

create or replace function live_app.on_class_child() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform live_app.sync_class(old.class_group_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.class_group_id is distinct from old.class_group_id or true) then perform live_app.sync_class(new.class_group_id); end if;
  return coalesce(new, old);
end $$;

revoke all on function live_app.sync_role(text, text[]), live_app.sync_tenant(uuid), live_app.sync_user(uuid), live_app.sync_class(uuid), live_app.sync_class_code(),
  live_app.on_tenant(), live_app.on_tenant_delete(), live_app.on_user(), live_app.on_student(), live_app.on_class_group(), live_app.on_class_child() from public, anon, authenticated;

drop trigger if exists live_sync on public.tenants;
create trigger live_sync after insert or update of name, slug, country, timezone, status, modules on public.tenants for each row execute function live_app.on_tenant();
drop trigger if exists live_sync_delete on public.tenants;
create trigger live_sync_delete before delete on public.tenants for each row execute function live_app.on_tenant_delete();
drop trigger if exists live_sync on public.users;
create trigger live_sync after insert or update of email, full_name, role, extra_roles, active, username or delete on public.users for each row execute function live_app.on_user();
drop trigger if exists live_sync on public.students;
create trigger live_sync after insert or update of class_group_id, user_id, status, admission_no or delete on public.students for each row execute function live_app.on_student();
drop trigger if exists live_sync on public.class_groups;
create trigger live_sync after insert or update of name, level, form_teacher_id or delete on public.class_groups for each row execute function live_app.on_class_group();
drop trigger if exists live_sync on public.subject_offerings;
create trigger live_sync after insert or update or delete on public.subject_offerings for each row execute function live_app.on_class_child();
drop trigger if exists live_sync on public.class_staff;
create trigger live_sync after insert or update or delete on public.class_staff for each row execute function live_app.on_class_child();

-- ---------- bring everything across once ----------
select live_app.sync_tenant(id) from public.tenants;
select live_app.sync_user(id) from public.users;
select live_app.sync_class(id) from public.class_groups;
