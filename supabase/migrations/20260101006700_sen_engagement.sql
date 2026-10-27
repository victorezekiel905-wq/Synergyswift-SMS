-- =========================================================================
-- Synergy Swift: SEN engagement — parents, students and school (Phase 14h).
--  * Parents of a child on the SEN register (when the profile is shared with
--    them) see the support plan, say how each target is going at home, agree
--    the plan, write in a two-way home–school book (with how the day went) and
--    ask for a review meeting.
--  * Students see their own plan in plain words and say how each target is
--    going and what helps them. What the child writes reaches school staff
--    only, never the family (a child may disclose something about home).
--  * The handshake into live lessons: the SENCO's extra time, read-aloud,
--    easy-to-read font and calm mode reach the live-lesson engine
--    (live.student_supports) automatically.
-- Idempotent.
-- =========================================================================

alter table public.sen_profiles add column if not exists share_with_parents boolean not null default true;
alter table public.sen_profiles add column if not exists live_read_aloud boolean not null default false;
alter table public.sen_profiles add column if not exists live_readable_font boolean not null default false;
alter table public.sen_profiles add column if not exists live_calm_mode boolean not null default false;

alter table public.ieps add column if not exists parent_agreed_name text;
alter table public.ieps add column if not exists parent_agreed_by uuid references public.users(id) on delete set null;

create table if not exists public.sen_home_notes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  student_id         uuid not null references public.students(id) on delete cascade,
  author_kind        text not null check (author_kind in ('staff','parent','student')),
  author_user_id     uuid references public.users(id) on delete set null,
  author_name        text not null,
  kind               text not null default 'note' check (kind in ('note','meeting_request','praise')),
  body               text not null check (length(btrim(body)) between 1 and 4000),
  mood               int check (mood between 1 and 5),       -- how the day went (1 hard … 5 great)
  read_by_staff_at   timestamptz,
  read_by_family_at  timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists sen_home_notes_student on public.sen_home_notes(student_id, created_at desc);

create table if not exists public.iep_target_feedback (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  target_id       uuid not null references public.iep_targets(id) on delete cascade,
  author_kind     text not null check (author_kind in ('parent','student','staff')),
  author_user_id  uuid references public.users(id) on delete set null,
  author_name     text not null,
  rating          int not null check (rating between 1 and 5),
  comment         text check (length(comment) <= 1000),
  created_at      timestamptz not null default now()
);
create index if not exists iep_target_feedback_target on public.iep_target_feedback(target_id, created_at desc);

-- ---------- who may see what ----------
-- A parent of the child, when the school shares the SEN profile with parents.
create or replace function public.sen_family_can(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_guardian_of(p_student)
     and exists (select 1 from public.sen_profiles p where p.student_id = p_student and p.share_with_parents and p.status <> 'closed')
$$;
-- The child themself.
create or replace function public.sen_is_me(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s where s.id = p_student and s.user_id = auth.uid() and s.tenant_id = public.my_tenant_id())
$$;
create or replace function public.iep_target_student(p_target uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select i.student_id from public.iep_targets t join public.ieps i on i.id = t.iep_id where t.id = p_target and t.tenant_id = public.my_tenant_id()
$$;
revoke all on function public.sen_family_can(uuid), public.sen_is_me(uuid), public.iep_target_student(uuid) from public, anon;
grant execute on function public.sen_family_can(uuid), public.sen_is_me(uuid), public.iep_target_student(uuid) to authenticated;

alter table public.sen_home_notes enable row level security;
alter table public.iep_target_feedback enable row level security;
drop policy if exists sen_home_notes_staff on public.sen_home_notes;
create policy sen_home_notes_staff on public.sen_home_notes for select using (tenant_id = public.my_tenant_id() and public.can_read_sen(student_id));
drop policy if exists sen_home_notes_staff_write on public.sen_home_notes;
create policy sen_home_notes_staff_write on public.sen_home_notes for insert
  with check (tenant_id = public.my_tenant_id() and public.can_read_sen(student_id) and author_kind = 'staff' and author_user_id = auth.uid());
drop policy if exists sen_home_notes_family on public.sen_home_notes;
create policy sen_home_notes_family on public.sen_home_notes for select
  using (tenant_id = public.my_tenant_id() and public.sen_family_can(student_id) and author_kind <> 'student');
drop policy if exists sen_home_notes_family_write on public.sen_home_notes;
create policy sen_home_notes_family_write on public.sen_home_notes for insert
  with check (tenant_id = public.my_tenant_id() and public.sen_family_can(student_id) and author_kind = 'parent' and author_user_id = auth.uid());
-- Students see what they wrote and praise from staff.
drop policy if exists sen_home_notes_student on public.sen_home_notes;
create policy sen_home_notes_student on public.sen_home_notes for select
  using (tenant_id = public.my_tenant_id() and public.sen_is_me(student_id) and (author_user_id = auth.uid() or kind = 'praise'));
drop policy if exists sen_home_notes_student_write on public.sen_home_notes;
create policy sen_home_notes_student_write on public.sen_home_notes for insert
  with check (tenant_id = public.my_tenant_id() and public.sen_is_me(student_id) and author_kind = 'student' and author_user_id = auth.uid() and kind = 'note');

drop policy if exists iep_target_feedback_read on public.iep_target_feedback;
create policy iep_target_feedback_read on public.iep_target_feedback for select using (
  tenant_id = public.my_tenant_id() and (public.can_read_sen(public.iep_target_student(target_id))
    or (author_kind <> 'student' and public.sen_family_can(public.iep_target_student(target_id))) or author_user_id = auth.uid()));
drop policy if exists iep_target_feedback_write on public.iep_target_feedback;
create policy iep_target_feedback_write on public.iep_target_feedback for insert with check (
  tenant_id = public.my_tenant_id() and author_user_id = auth.uid() and (
    (author_kind = 'staff' and public.can_read_sen(public.iep_target_student(target_id)))
    or (author_kind = 'parent' and public.sen_family_can(public.iep_target_student(target_id)))
    or (author_kind = 'student' and public.sen_is_me(public.iep_target_student(target_id)))));
grant select, insert on public.sen_home_notes, public.iep_target_feedback to authenticated;

-- ---------- the handshake into live lessons ----------
create or replace function public.sen_live_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.sen_profiles := coalesce(new, old); v_user uuid; v_pct int;
begin
  if to_regclass('live.student_supports') is null then return null; end if;
  select user_id into v_user from public.students where id = r.student_id;
  if v_user is null or not exists (select 1 from live.users where id = v_user) then return null; end if;
  if tg_op = 'DELETE' or r.status = 'closed' then
    delete from live.student_supports where student_id = v_user and note = 'From the SEN register';
    return null;
  end if;
  v_pct := case when r.extra_time_pct <= 0 then 0 when r.extra_time_pct <= 25 then 25 when r.extra_time_pct <= 50 then 50 else 100 end;
  insert into live.student_supports (student_id, tenant_id, read_aloud, readable_font, extra_time_pct, calm_mode, note, updated_at)
    values (v_user, r.tenant_id, r.live_read_aloud or 'reader' = any(r.arrangements), r.live_readable_font or 'enlarged_print' = any(r.arrangements),
            v_pct, r.live_calm_mode, 'From the SEN register', now())
    on conflict (student_id) do update set read_aloud = excluded.read_aloud, readable_font = excluded.readable_font, extra_time_pct = excluded.extra_time_pct,
      calm_mode = excluded.calm_mode, note = excluded.note, updated_at = now();
  return null;
exception when others then
  return null; -- the live engine is an add-on: never block the SEN register
end $$;
drop trigger if exists sen_profiles_live on public.sen_profiles;
create trigger sen_profiles_live after insert or update or delete on public.sen_profiles for each row execute function public.sen_live_sync();
revoke all on function public.sen_live_sync() from public, anon, authenticated;
