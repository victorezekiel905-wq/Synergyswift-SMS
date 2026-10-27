-- =========================================================================
-- Phase 14d-1: classes, accounts that set themselves up, and classroom points.
--   * class_staff: teachers and assistants added to a class by an admin, with
--     privileges (live lessons, points, class story, parent messages, results);
--     subject teachers (subject_offerings) and form teachers stay as before.
--   * accounts: students get a login with a username (no email needed) and a
--     starting password they must change; parents are invited automatically.
--     Switches in tenant_settings; the work runs from the dispatch cron.
--   * classroom points (skills, positive and "needs work"), class story posts
--     for parents (photos only of children with photo consent, if the school
--     says so), likes.
-- Apply AFTER 20260101005900. Idempotent.
-- =========================================================================

-- ---------- settings ----------
alter table public.tenant_settings add column if not exists auto_student_logins boolean not null default true;
alter table public.tenant_settings add column if not exists auto_parent_invites boolean not null default true;
alter table public.tenant_settings add column if not exists points_allow_needs_work boolean not null default true;
alter table public.tenant_settings add column if not exists story_photo_consent boolean not null default true;
alter table public.tenant_settings add column if not exists weekly_points_summary boolean not null default true;

-- ---------- accounts ----------
alter table public.users add column if not exists username text;
alter table public.users add column if not exists must_change_password boolean not null default false;
create unique index if not exists users_username on public.users(lower(username)) where username is not null;
alter table public.students add column if not exists login_sent_at timestamptz;
alter table public.guardians add column if not exists invited_at timestamptz;

-- users_guard (as in 5800) also keeps must_change_password server-only.
create or replace function public.users_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / SQL editor
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot be changed';
  end if;
  if new.password_changed_at is distinct from old.password_changed_at or new.must_change_password is distinct from old.must_change_password
     or new.username is distinct from old.username then
    raise exception 'sign-in details are set by the server';
  end if;
  if (new.role is distinct from old.role or new.extra_roles is distinct from old.extra_roles
      or new.active is distinct from old.active or new.custom_role_id is distinct from old.custom_role_id) then
    if new.id = auth.uid() then
      raise exception 'you cannot change your own role or status';
    end if;
    if not public.is_school_admin() then
      raise exception 'only school admins can change roles';
    end if;
    if new.role = 'platform_admin' or 'platform_admin' = any(new.extra_roles) then
      raise exception 'platform_admin cannot be granted from a tenant';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.users_guard() from public, anon, authenticated;

-- ---------- class teams ----------
create table if not exists public.class_staff (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  class_group_id       uuid not null references public.class_groups(id) on delete cascade,
  subject_id           uuid references public.subjects(id) on delete cascade,     -- null = the whole class
  user_id              uuid not null references public.users(id) on delete cascade,
  role                 text not null default 'co_teacher' check (role in ('co_teacher','assistant','support')),
  can_teach_live       boolean not null default true,
  can_give_points      boolean not null default true,
  can_post_story       boolean not null default true,
  can_message_parents  boolean not null default false,
  can_see_results      boolean not null default false,
  added_by             uuid,
  created_at           timestamptz not null default now()
);
create unique index if not exists class_staff_one on public.class_staff(class_group_id, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), user_id);
create index if not exists class_staff_user on public.class_staff(user_id);
alter table public.class_staff enable row level security;
drop policy if exists class_staff_read on public.class_staff;
create policy class_staff_read on public.class_staff for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists class_staff_write on public.class_staff;
create policy class_staff_write on public.class_staff for all
  using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

-- Does the signed-in user teach this class (form teacher, a subject teacher, or on its team with the given privilege)?
create or replace function public.teaches_class(p_class uuid, p_privilege text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_groups g where g.id = p_class and g.tenant_id = public.my_tenant_id() and g.form_teacher_id = auth.uid())
      or exists (select 1 from public.subject_offerings o where o.class_group_id = p_class and o.tenant_id = public.my_tenant_id() and o.teacher_id = auth.uid())
      or exists (select 1 from public.class_staff s where s.class_group_id = p_class and s.tenant_id = public.my_tenant_id() and s.user_id = auth.uid()
                 and (p_privilege is null
                      or (p_privilege = 'points' and s.can_give_points)
                      or (p_privilege = 'story' and s.can_post_story)
                      or (p_privilege = 'live' and s.can_teach_live)
                      or (p_privilege = 'parents' and s.can_message_parents)
                      or (p_privilege = 'results' and s.can_see_results)));
$$;
revoke all on function public.teaches_class(uuid, text) from public, anon;
grant execute on function public.teaches_class(uuid, text) to authenticated, service_role;

-- ---------- classroom points ----------
create table if not exists public.point_skills (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(name) between 2 and 40),
  kind        text not null default 'positive' check (kind in ('positive','needs_work')),
  points      int not null default 1 check (points between -5 and 5 and points <> 0),
  icon        text not null default 'star' check (length(icon) <= 16),
  active      boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  check ((kind = 'positive' and points > 0) or (kind = 'needs_work' and points < 0))
);
create unique index if not exists point_skills_name on public.point_skills(tenant_id, lower(name));
alter table public.point_skills enable row level security;
drop policy if exists point_skills_read on public.point_skills;
create policy point_skills_read on public.point_skills for select using (tenant_id = public.my_tenant_id());
drop policy if exists point_skills_write on public.point_skills;
create policy point_skills_write on public.point_skills for all
  using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

create table if not exists public.point_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  class_group_id  uuid references public.class_groups(id) on delete set null,
  subject_id      uuid references public.subjects(id) on delete set null,
  skill_id        uuid references public.point_skills(id) on delete set null,
  skill_name      text not null,
  points          int not null check (points between -5 and 5 and points <> 0),
  note            text check (length(note) <= 200),
  given_by        uuid references public.users(id) on delete set null,
  batch_id        uuid,                                  -- the same award to a group or the class
  created_at      timestamptz not null default now()
);
create index if not exists point_events_student on public.point_events(tenant_id, student_id, created_at desc);
create index if not exists point_events_class on public.point_events(class_group_id, created_at desc);
alter table public.point_events enable row level security;
drop policy if exists point_events_read on public.point_events;
create policy point_events_read on public.point_events for select using (
  tenant_id = public.my_tenant_id() and (
    public.is_school_admin() or given_by = auth.uid()
    or (class_group_id is not null and public.teaches_class(class_group_id))
    or exists (select 1 from public.students s where s.id = point_events.student_id and s.user_id = auth.uid())
    or public.is_guardian_of(student_id)));
drop policy if exists point_events_insert on public.point_events;
create policy point_events_insert on public.point_events for insert with check (
  tenant_id = public.my_tenant_id() and given_by = auth.uid()
  and (public.is_school_admin() or (class_group_id is not null and public.teaches_class(class_group_id, 'points')))
  and exists (select 1 from public.students s where s.id = point_events.student_id and s.tenant_id = point_events.tenant_id
              and (point_events.class_group_id is null or s.class_group_id = point_events.class_group_id)));
-- Undo: the giver within 15 minutes, or an admin.
drop policy if exists point_events_delete on public.point_events;
create policy point_events_delete on public.point_events for delete using (
  tenant_id = public.my_tenant_id() and (public.is_school_admin() or (given_by = auth.uid() and created_at > now() - interval '15 minutes')));

-- ---------- class story ----------
insert into storage.buckets (id, name, public) values ('class-story', 'class-story', false) on conflict (id) do nothing;

create table if not exists public.class_story_posts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  author_id       uuid references public.users(id) on delete set null,
  body            text check (length(body) <= 2000),
  photos          text[] not null default '{}',          -- storage paths in class-story
  tagged          uuid[] not null default '{}',          -- students in the photos
  created_at      timestamptz not null default now(),
  check (coalesce(length(body), 0) > 0 or cardinality(photos) > 0),
  check (cardinality(photos) <= 6)
);
create index if not exists class_story_class on public.class_story_posts(class_group_id, created_at desc);
alter table public.class_story_posts enable row level security;
drop policy if exists story_read on public.class_story_posts;
create policy story_read on public.class_story_posts for select using (
  tenant_id = public.my_tenant_id() and (
    public.is_staff()
    or exists (select 1 from public.students s where s.class_group_id = class_story_posts.class_group_id and s.user_id = auth.uid())
    or exists (select 1 from public.students s where s.class_group_id = class_story_posts.class_group_id and public.is_guardian_of(s.id))));
drop policy if exists story_insert on public.class_story_posts;
create policy story_insert on public.class_story_posts for insert with check (
  tenant_id = public.my_tenant_id() and author_id = auth.uid() and (public.is_school_admin() or public.teaches_class(class_group_id, 'story')));
drop policy if exists story_delete on public.class_story_posts;
create policy story_delete on public.class_story_posts for delete using (
  tenant_id = public.my_tenant_id() and (author_id = auth.uid() or public.is_school_admin()));

create table if not exists public.class_story_likes (
  post_id     uuid not null references public.class_story_posts(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.class_story_likes enable row level security;
drop policy if exists story_likes_read on public.class_story_likes;
create policy story_likes_read on public.class_story_likes for select using (tenant_id = public.my_tenant_id());
drop policy if exists story_likes_mine on public.class_story_likes;
create policy story_likes_mine on public.class_story_likes for all using (user_id = auth.uid() and tenant_id = public.my_tenant_id())
  with check (user_id = auth.uid() and tenant_id = public.my_tenant_id()
              and exists (select 1 from public.class_story_posts p where p.id = class_story_likes.post_id and p.tenant_id = class_story_likes.tenant_id));

-- Starter skills for every school, now and when a school is created (they can rename, add and switch off).
create or replace function public.seed_point_skills(p_tenant uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.point_skills (tenant_id, name, kind, points, icon, position)
  select p_tenant, s.name, s.kind, s.points, s.icon, s.pos
  from (values ('Helping others', 'positive', 1, 'hand', 1), ('Working hard', 'positive', 1, 'flame', 2), ('Teamwork', 'positive', 1, 'people', 3),
               ('Great answer', 'positive', 1, 'star', 4), ('Kindness', 'positive', 1, 'medal', 5), ('Leadership', 'positive', 2, 'cap', 6),
               ('Off task', 'needs_work', -1, 'alert', 10), ('Unprepared', 'needs_work', -1, 'note', 11), ('Disrespect', 'needs_work', -1, 'x', 12))
       as s(name, kind, points, icon, pos)
  on conflict do nothing;
$$;
revoke all on function public.seed_point_skills(uuid) from public, anon, authenticated;
grant execute on function public.seed_point_skills(uuid) to service_role;

create or replace function public.tenants_seed_skills() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_point_skills(new.id);
  return new;
end $$;
revoke all on function public.tenants_seed_skills() from public, anon, authenticated;
drop trigger if exists tenants_seed_skills on public.tenants;
create trigger tenants_seed_skills after insert on public.tenants for each row execute function public.tenants_seed_skills();

select public.seed_point_skills(id) from public.tenants;
