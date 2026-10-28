-- =========================================================================
-- Synergy Swift: in the learning space, people see only their own classes.
--  A teacher sees and manages a class's homework, submissions, discussion,
--  online lessons, learning groups, class story and targets only if they teach
--  it (form teacher, subject teacher or class team: teaches_class()). Students
--  and parents already see only their own child's classes. School admins, the
--  principal, and the staff roles the school lists in
--  tenant_settings.all_classes_roles see every class.
--  School-wide items with no class (e.g. a whole-school forum) stay visible to staff.
-- Idempotent. Apply after 20260101008200.
-- =========================================================================

alter table public.tenant_settings add column if not exists all_classes_roles text[] not null default array['school_admin','principal']::text[];

create or replace function public.sees_all_classes()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or exists (
    select 1 from public.users u
      join public.tenant_settings ts on ts.tenant_id = u.tenant_id
     where u.id = auth.uid() and u.tenant_id = public.my_tenant_id() and u.active
       and (u.role = any(ts.all_classes_roles) or coalesce(u.extra_roles, '{}') && ts.all_classes_roles));
$$;
revoke all on function public.sees_all_classes() from public, anon;
grant execute on function public.sees_all_classes() to authenticated, service_role;

-- Staff who may see this class's learning content. A null class means school-wide.
create or replace function public.staff_sees_class(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and (p_class is null or public.sees_all_classes() or public.teaches_class(p_class));
$$;
revoke all on function public.staff_sees_class(uuid) from public, anon;
grant execute on function public.staff_sees_class(uuid) to authenticated, service_role;

-- Homework and what students hand in.
drop policy if exists homework_staff on public.homework;
create policy homework_staff on public.homework for all
  using (tenant_id = (select public.my_tenant_id()) and public.staff_sees_class(class_group_id))
  with check (tenant_id = (select public.my_tenant_id()) and public.staff_sees_class(class_group_id) and set_by = auth.uid());
drop policy if exists hw_subs_staff on public.homework_submissions;
create policy hw_subs_staff on public.homework_submissions for all
  using (tenant_id = (select public.my_tenant_id()) and exists (select 1 from public.homework h where h.id = homework_submissions.homework_id and public.staff_sees_class(h.class_group_id)))
  with check (tenant_id = (select public.my_tenant_id()) and exists (select 1 from public.homework h where h.id = homework_submissions.homework_id and public.staff_sees_class(h.class_group_id)));

-- Class discussions: a class forum is for that class's students and its teachers.
create or replace function public.can_use_forum(p_forum uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.forums f
    where f.id = p_forum and f.tenant_id = public.my_tenant_id()
      and (
        (public.is_staff() and (f.kind <> 'class' or public.sees_all_classes() or public.teaches_class(f.class_group_id)))
        or (f.kind = 'school' and public.has_role(array['student']))
        or (f.kind = 'class' and exists (select 1 from public.students s where s.user_id = auth.uid() and s.status = 'active' and s.class_group_id = f.class_group_id))
      )
      and (f.kind <> 'staff' or public.is_staff())
  );
$$;
grant execute on function public.can_use_forum(uuid) to authenticated;
drop policy if exists forums_staff on public.forums;
create policy forums_staff on public.forums for all
  using (tenant_id = (select public.my_tenant_id()) and public.is_staff() and (kind <> 'class' or public.sees_all_classes() or public.teaches_class(class_group_id)))
  with check (tenant_id = (select public.my_tenant_id()) and public.is_staff() and (kind <> 'class' or public.sees_all_classes() or public.teaches_class(class_group_id)));
drop policy if exists forum_threads_staff on public.forum_threads;
create policy forum_threads_staff on public.forum_threads for update
  using (tenant_id = (select public.my_tenant_id()) and public.is_staff() and public.can_use_forum(forum_id))
  with check (tenant_id = (select public.my_tenant_id()));
drop policy if exists forum_posts_update on public.forum_posts;
create policy forum_posts_update on public.forum_posts for update
  using (tenant_id = (select public.my_tenant_id()) and (author_id = auth.uid()
    or (public.is_staff() and exists (select 1 from public.forum_threads t where t.id = forum_posts.thread_id and public.can_use_forum(t.forum_id)))))
  with check (tenant_id = (select public.my_tenant_id()));

-- Online lessons, learning groups, class story and class targets.
drop policy if exists online_lessons_read on public.online_lessons;
create policy online_lessons_read on public.online_lessons for select
  using (tenant_id = (select public.my_tenant_id()) and (public.staff_sees_class(class_group_id) or public.sees_class_content(array[class_group_id])));
drop policy if exists learning_groups_staff on public.learning_groups;
create policy learning_groups_staff on public.learning_groups for all
  using (tenant_id = (select public.my_tenant_id()) and public.staff_sees_class(class_group_id))
  with check (tenant_id = (select public.my_tenant_id()) and public.staff_sees_class(class_group_id));
drop policy if exists learning_group_members_staff on public.learning_group_members;
create policy learning_group_members_staff on public.learning_group_members for all
  using (tenant_id = (select public.my_tenant_id()) and exists (select 1 from public.learning_groups g where g.id = learning_group_members.group_id and public.staff_sees_class(g.class_group_id)))
  with check (tenant_id = (select public.my_tenant_id()) and exists (select 1 from public.learning_groups g where g.id = learning_group_members.group_id and public.staff_sees_class(g.class_group_id)));
drop policy if exists story_read on public.class_story_posts;
create policy story_read on public.class_story_posts for select using (
  tenant_id = (select public.my_tenant_id()) and (
    public.staff_sees_class(class_group_id)
    or exists (select 1 from public.students s where s.class_group_id = class_story_posts.class_group_id and s.user_id = auth.uid())
    or exists (select 1 from public.students s where s.class_group_id = class_story_posts.class_group_id and public.is_guardian_of(s.id))));
drop policy if exists class_targets_read on public.class_targets;
create policy class_targets_read on public.class_targets for select using (
  tenant_id = (select public.my_tenant_id()) and (public.staff_sees_class(class_group_id) or exists (
    select 1 from public.students s where s.class_group_id = class_targets.class_group_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))));
