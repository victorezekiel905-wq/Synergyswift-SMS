-- =========================================================================
-- EduClass Fusion: score moderation (teacher → head of department → principal).
--  * departments get a head (HOD); subjects belong to a department.
--    Departments were writable by every account in the school (students
--    included); now only school admins change them, since the head approves
--    scores.
--  * score_sheets: one row per term × class × subject with its approval
--    status. Changes go through moderate_score_sheet(), which checks who may
--    do what and logs every step in score_sheet_events.
--  * When a school turns moderation on (tenant_settings.require_moderation),
--    scores on a submitted or approved sheet are locked for everyone except
--    school admins, until the sheet is returned for correction.
-- Apply AFTER 20260101002600. Idempotent.
-- =========================================================================

alter table public.departments add column if not exists head_user_id uuid references public.users(id) on delete set null;
alter table public.subjects add column if not exists department_id uuid references public.departments(id) on delete set null;
alter table public.tenant_settings add column if not exists require_moderation boolean not null default false;

drop policy if exists departments_tenant on public.departments;
drop policy if exists departments_read on public.departments;
create policy departments_read on public.departments for select using (tenant_id = public.my_tenant_id());
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments for all using (
  tenant_id = public.my_tenant_id() and public.is_school_admin()
) with check (tenant_id = public.my_tenant_id() and public.is_school_admin());

create table if not exists public.score_sheets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  term_id         uuid not null references public.terms(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  status          text not null default 'draft' check (status in ('draft','submitted','hod_approved','approved','returned')),
  submitted_by    uuid references public.users(id) on delete set null,
  submitted_at    timestamptz,
  hod_by          uuid references public.users(id) on delete set null,
  hod_at          timestamptz,
  approved_by     uuid references public.users(id) on delete set null,
  approved_at     timestamptz,
  note            text,                                  -- latest return note
  updated_at      timestamptz not null default now(),
  unique (term_id, class_group_id, subject_id)
);
create table if not exists public.score_sheet_events (
  id         uuid primary key default gen_random_uuid(),
  sheet_id   uuid not null references public.score_sheets(id) on delete cascade,
  action     text not null,
  actor_id   uuid references public.users(id) on delete set null,
  note       text,
  at         timestamptz not null default now()
);
create index if not exists score_sheet_events_sheet on public.score_sheet_events(sheet_id, at);

alter table public.score_sheets enable row level security;
alter table public.score_sheet_events enable row level security;
drop policy if exists score_sheets_read on public.score_sheets;
create policy score_sheets_read on public.score_sheets for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists score_sheet_events_read on public.score_sheet_events;
create policy score_sheet_events_read on public.score_sheet_events for select using (
  exists (select 1 from public.score_sheets s where s.id = score_sheet_events.sheet_id and s.tenant_id = public.my_tenant_id() and public.is_staff()));
-- No insert/update/delete policies: all writes go through moderate_score_sheet().

/** Is the caller the head of the department this subject belongs to? */
create or replace function public.is_hod_of_subject(p_subject uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subjects s join public.departments d on d.id = s.department_id
                 where s.id = p_subject and d.head_user_id = auth.uid() and d.tenant_id = public.my_tenant_id());
$$;
grant execute on function public.is_hod_of_subject(uuid) to authenticated;

/**
 * One step of the moderation workflow. Actions:
 *   submit      subject teacher / form teacher / admin: draft|returned → submitted
 *   hod_approve head of the subject's department:     submitted → hod_approved
 *   approve     school admin (principal):             submitted|hod_approved → approved
 *   return      HOD (from submitted) or admin (any step after draft): → returned, with a note
 */
create or replace function public.moderate_score_sheet(p_term uuid, p_class uuid, p_subject uuid, p_action text, p_note text default null)
returns public.score_sheets language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.my_tenant_id();
  s public.score_sheets;
  teaches boolean;
  has_hod boolean;
begin
  if t is null then raise exception 'not signed in to a school'; end if;
  if not exists (select 1 from public.terms where id = p_term and tenant_id = t)
     or not exists (select 1 from public.class_groups where id = p_class and tenant_id = t)
     or not exists (select 1 from public.subjects where id = p_subject and tenant_id = t) then
    raise exception 'term, class or subject not found';
  end if;
  insert into public.score_sheets (tenant_id, term_id, class_group_id, subject_id) values (t, p_term, p_class, p_subject)
    on conflict (term_id, class_group_id, subject_id) do nothing;
  select * into s from public.score_sheets where term_id = p_term and class_group_id = p_class and subject_id = p_subject for update;

  teaches := public.is_school_admin()
    or exists (select 1 from public.subject_offerings o where o.class_group_id = p_class and o.subject_id = p_subject and o.teacher_id = auth.uid())
    or exists (select 1 from public.class_groups g where g.id = p_class and g.form_teacher_id = auth.uid());
  has_hod := exists (select 1 from public.subjects x join public.departments d on d.id = x.department_id where x.id = p_subject and d.head_user_id is not null);

  if p_action = 'submit' then
    if not teaches then raise exception 'only the subject teacher, the form teacher or an admin can submit these scores'; end if;
    if s.status not in ('draft','returned') then raise exception 'these scores are already %', replace(s.status, '_', ' '); end if;
    update public.score_sheets set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), note = null, updated_at = now() where id = s.id returning * into s;
  elsif p_action = 'hod_approve' then
    if not public.is_hod_of_subject(p_subject) then raise exception 'only the head of this subject''s department can give the first approval'; end if;
    if s.status <> 'submitted' then raise exception 'only submitted scores can be approved by the head of department'; end if;
    if s.submitted_by = auth.uid() then raise exception 'you cannot approve scores you submitted; the principal can approve them'; end if;
    update public.score_sheets set status = 'hod_approved', hod_by = auth.uid(), hod_at = now(), updated_at = now() where id = s.id returning * into s;
  elsif p_action = 'approve' then
    if not public.is_school_admin() then raise exception 'only the principal or a school admin can give final approval'; end if;
    if s.status not in ('submitted','hod_approved') then raise exception 'submit the scores before approving them'; end if;
    if s.status = 'submitted' and has_hod and coalesce(p_note, '') = '' then
      raise exception 'the head of department has not approved these scores yet; add a note to approve anyway';
    end if;
    update public.score_sheets set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = s.id returning * into s;
  elsif p_action = 'return' then
    if coalesce(trim(p_note), '') = '' then raise exception 'say what needs correcting'; end if;
    if public.is_school_admin() then
      if s.status = 'draft' then raise exception 'these scores have not been submitted'; end if;
    elsif public.is_hod_of_subject(p_subject) then
      if s.status <> 'submitted' then raise exception 'the head of department can only return submitted scores'; end if;
    else
      raise exception 'only the head of department or an admin can return scores';
    end if;
    update public.score_sheets set status = 'returned', note = p_note, updated_at = now() where id = s.id returning * into s;
  else
    raise exception 'unknown action %', p_action;
  end if;
  insert into public.score_sheet_events (sheet_id, action, actor_id, note) values (s.id, p_action, auth.uid(), nullif(trim(coalesce(p_note, '')), ''));
  return s;
end $$;
revoke all on function public.moderate_score_sheet(uuid, uuid, uuid, text, text) from public;
grant execute on function public.moderate_score_sheet(uuid, uuid, uuid, text, text) to authenticated;

-- Lock scores on sheets that are under review or approved (when the school uses moderation).
create or replace function public.score_entries_moderation_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record := coalesce(new, old);
  st text;
begin
  if auth.uid() is null or public.is_school_admin() then return coalesce(new, old); end if;
  if not coalesce((select require_moderation from public.tenant_settings where tenant_id = r.tenant_id), false) then return coalesce(new, old); end if;
  select ss.status into st from public.score_sheets ss join public.students stu on stu.id = r.student_id
    where ss.term_id = r.term_id and ss.subject_id = r.subject_id and ss.class_group_id = stu.class_group_id;
  if st in ('submitted','hod_approved','approved') then
    raise exception 'these scores are locked: they have been submitted for approval (ask the head of department or principal to return them)';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists score_entries_moderation_lock on public.score_entries;
create trigger score_entries_moderation_lock before insert or update or delete on public.score_entries
  for each row execute function public.score_entries_moderation_lock();
