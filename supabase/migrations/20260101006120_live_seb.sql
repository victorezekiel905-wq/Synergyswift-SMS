-- =========================================================================
-- Phase 14d-2: Safe Exam Browser lock for live classes and lessons.
--   * live.classes.require_seb: the class's default ("lock this class")
--   * live.class_sessions.require_seb: the lesson's own Locked/Unlocked switch
--     (copied from the class when the lesson starts; teachers can change it)
--   * live.seb_passes: written only by the server after it has checked the
--     student's Safe Exam Browser request headers (or user agent)
--   * joining a locked lesson (live.session_participants) is refused in the
--     database without a pass; locking a running lesson sends everyone who is
--     not in Safe Exam Browser back to the join screen
-- Apply AFTER 20260101006110. Idempotent.
-- =========================================================================

alter table live.classes add column if not exists require_seb boolean not null default false;
alter table live.class_sessions add column if not exists require_seb boolean not null default false;
alter table public.tenant_settings add column if not exists live_seb_config_keys text[] not null default '{}';

create table if not exists live.seb_passes (
  session_id  uuid not null references live.class_sessions(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  level       text not null default 'user_agent' check (level in ('hash','user_agent')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table live.seb_passes enable row level security;
revoke all on live.seb_passes from anon, authenticated;
drop policy if exists seb_passes_own on live.seb_passes;
create policy seb_passes_own on live.seb_passes for select to authenticated using (user_id = auth.uid());
grant select on live.seb_passes to authenticated;

-- New lessons take the class's lock.
create or replace function live_app.session_seb_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.class_id is not null and not new.require_seb then
    select c.require_seb into new.require_seb from live.classes c where c.id = new.class_id;
    new.require_seb := coalesce(new.require_seb, false);
  end if;
  return new;
end $$;
drop trigger if exists session_seb_default on live.class_sessions;
create trigger session_seb_default before insert on live.class_sessions for each row execute function live_app.session_seb_default();

-- Nobody joins a locked lesson without a current Safe Exam Browser pass (teachers on the lesson excepted).
create or replace function live_app.participant_seb_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select require_seb, teacher_id, class_id into s from live.class_sessions where id = new.session_id;
  if not coalesce(s.require_seb, false) or new.user_id = s.teacher_id then return new; end if;
  if exists (select 1 from live.class_members m where m.class_id = s.class_id and m.user_id = new.user_id and m.role = 'teacher') then return new; end if;
  if not exists (select 1 from live.seb_passes p where p.session_id = new.session_id and p.user_id = new.user_id and p.expires_at > now()) then
    raise exception 'safe_exam_browser_required' using hint = 'This lesson must be opened in Safe Exam Browser.';
  end if;
  return new;
end $$;
drop trigger if exists participant_seb_check on live.session_participants;
create trigger participant_seb_check before insert on live.session_participants for each row execute function live_app.participant_seb_check();

-- May the caller change this lesson's or class's lock? (its teacher, a co-teacher, or a school admin)
create or replace function live_app.can_lock(p_class uuid, p_teacher uuid, p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() = p_teacher
      or exists (select 1 from live.classes c where c.id = p_class and c.teacher_id = auth.uid())
      or exists (select 1 from live.class_members m where m.class_id = p_class and m.user_id = auth.uid() and m.role = 'teacher')
      or exists (select 1 from live.class_subjects cs where cs.class_id = p_class and cs.teacher_id = auth.uid())
      or exists (select 1 from live.users u where u.id = auth.uid() and u.tenant_id = p_tenant and u.role = 'school_admin' and u.status = 'active');
$$;

/** Lock or unlock a running (or scheduled) lesson. Locking sends students without a pass back to the join screen. */
create or replace function live.set_session_seb(p_session uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record; v_removed int := 0;
begin
  select id, class_id, teacher_id, tenant_id, status into s from live.class_sessions where id = p_session;
  if not found or not live_app.can_lock(s.class_id, s.teacher_id, s.tenant_id) then raise exception 'not allowed'; end if;
  update live.class_sessions set require_seb = p_on where id = p_session;
  if p_on then
    with gone as (
      delete from live.session_participants sp where sp.session_id = p_session and sp.user_id <> s.teacher_id
        and not exists (select 1 from live.seb_passes p where p.session_id = p_session and p.user_id = sp.user_id and p.expires_at > now())
        and not exists (select 1 from live.class_members m where m.class_id = s.class_id and m.user_id = sp.user_id and m.role = 'teacher')
      returning 1)
    select count(*) into v_removed from gone;
  end if;
  return jsonb_build_object('require_seb', p_on, 'sent_back', v_removed);
end $$;

/** Lock or unlock a class: every new lesson in it starts locked (or not). */
create or replace function live.set_class_seb(p_class uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select id, teacher_id, tenant_id into c from live.classes where id = p_class;
  if not found or not live_app.can_lock(c.id, c.teacher_id, c.tenant_id) then raise exception 'not allowed'; end if;
  update live.classes set require_seb = p_on where id = p_class;
  return jsonb_build_object('require_seb', p_on);
end $$;

revoke all on function live_app.session_seb_default(), live_app.participant_seb_check() from public, anon, authenticated;
revoke all on function live_app.can_lock(uuid, uuid, uuid) from public, anon;
grant execute on function live_app.can_lock(uuid, uuid, uuid) to authenticated, service_role;
revoke all on function live.set_session_seb(uuid, boolean), live.set_class_seb(uuid, boolean) from public, anon;
grant execute on function live.set_session_seb(uuid, boolean), live.set_class_seb(uuid, boolean) to authenticated, service_role;
