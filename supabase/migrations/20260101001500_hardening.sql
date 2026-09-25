-- =========================================================================
-- EduClass Fusion — hardening pass (v46)
-- Closes data leaks found in review and repairs pre-existing broken SQL.
-- Apply AFTER 20260101001400_exams.sql. Idempotent.
-- =========================================================================

-- ---------- Extra roles for transport and boarding ----------
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in (
  'student','teacher','school_admin','it_admin','parent','platform_admin',
  'principal','bursar','librarian','hr_manager','qa_officer','gate_officer',
  'transport_officer','hostel_warden'
));

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['teacher','school_admin','it_admin','platform_admin','principal',
                               'bursar','librarian','hr_manager','qa_officer','gate_officer',
                               'transport_officer','hostel_warden']);
$$;

-- ---------- Users: students and parents only see staff, not each other ----------
-- Previously any student or parent could list every user in the school,
-- including other parents' emails and phone numbers.
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users for select using (
  id = auth.uid()
  or (tenant_id = public.my_tenant_id() and (public.is_staff() or role not in ('student','parent')))
);

-- ---------- Exams: students read nothing directly ----------
-- The exams row holds the access code, SEB keys and quit password, and
-- attempts hold marks before release. Students use the API, which strips these.
drop policy if exists exams_student_read on public.exams;
drop policy if exists exam_attempts_read on public.exam_attempts;
create policy exam_attempts_read on public.exam_attempts for select using (
  tenant_id = public.my_tenant_id() and public.is_staff());

-- ---------- Device ingestion: no anonymous direct writes ----------
-- The extension writes through security-definer RPCs (device_post_event,
-- device_post_snapshot), so open "with check (true)" inserts are not needed.
drop policy if exists devices_insert on public.devices;
create policy devices_insert on public.devices for insert with check (tenant_id = public.my_tenant_id());
drop policy if exists browser_events_insert on public.browser_events;
create policy browser_events_insert on public.browser_events for insert with check (
  exists (select 1 from public.devices d where d.id = browser_events.device_id and d.tenant_id = public.my_tenant_id()));
drop policy if exists screen_snapshots_insert on public.screen_snapshots;
create policy screen_snapshots_insert on public.screen_snapshots for insert with check (
  exists (select 1 from public.devices d where d.id = screen_snapshots.device_id and d.tenant_id = public.my_tenant_id()));
drop policy if exists env_events_insert on public.environment_events;
create policy env_events_insert on public.environment_events for insert with check (
  exists (select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
          where s.id = environment_events.session_id and c.tenant_id = public.my_tenant_id()));

-- Device enrolment upserts on device_id; give it a constraint to target.
do $$ begin
  create unique index if not exists device_enrollments_device_uidx on public.device_enrollments(device_id);
exception when unique_violation then
  raise notice 'device_enrollments has duplicate device_id rows; unique index skipped';
end $$;

-- ---------- report_aggregate: referenced columns that do not exist ----------
create or replace function public.report_aggregate(p_class uuid, p_kind text)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_tenant uuid; v_payload jsonb;
begin
  select tenant_id into v_tenant from public.classes where id = p_class;
  if v_tenant is null then return jsonb_build_object('error','class_not_found'); end if;
  if v_tenant is distinct from public.my_tenant_id() then return jsonb_build_object('error','forbidden'); end if;

  if p_kind = 'participation' then
    select jsonb_build_object(
      'students',  (select count(*) from public.class_members where class_id = p_class and role = 'student'),
      'responses', (select count(*) from public.activity_responses r join public.class_sessions s on s.id = r.session_id where s.class_id = p_class),
      'correct',   (select count(*) from public.activity_responses r join public.class_sessions s on s.id = r.session_id where s.class_id = p_class and r.correct),
      'in_class',  (select count(distinct p.student_id) from public.student_presence p join public.class_sessions s on s.id = p.session_id where s.class_id = p_class)
    ) into v_payload;
  elsif p_kind = 'env_alerts' then
    select jsonb_build_object(
      'informational', (select count(*) from public.environment_events e join public.class_sessions s on s.id = e.session_id where s.class_id = p_class and e.severity = 'info'),
      'warning',       (select count(*) from public.environment_events e join public.class_sessions s on s.id = e.session_id where s.class_id = p_class and e.severity = 'warn'),
      'critical',      (select count(*) from public.environment_events e join public.class_sessions s on s.id = e.session_id where s.class_id = p_class and e.severity = 'critical'),
      'last',          (select jsonb_agg(x) from (select e.id, e.kind, e.severity, e.ts from public.environment_events e
                          join public.class_sessions s on s.id = e.session_id where s.class_id = p_class order by e.ts desc limit 10) x)
    ) into v_payload;
  elsif p_kind = 'devices' then
    select jsonb_build_object(
      'active',  (select count(*) from public.devices d where d.tenant_id = v_tenant and d.status = 'active'),
      'idle',    (select count(*) from public.devices d where d.tenant_id = v_tenant and d.status = 'idle'),
      'offline', (select count(*) from public.devices d where d.tenant_id = v_tenant and d.status = 'offline')
    ) into v_payload;
  elsif p_kind = 'attendance' then
    select jsonb_build_object(
      'present', (select count(*) from public.attendance where class_id = p_class and status = 'present'),
      'tardy',   (select count(*) from public.attendance where class_id = p_class and status = 'tardy'),
      'excused', (select count(*) from public.attendance where class_id = p_class and status = 'excused'),
      'absent',  (select count(*) from public.attendance where class_id = p_class and status = 'absent'),
      'last',    (select jsonb_agg(a) from (select student_id, date, status from public.attendance where class_id = p_class order by date desc limit 20) a)
    ) into v_payload;
  else
    return jsonb_build_object('error','unknown_kind');
  end if;
  return v_payload;
end $$;
grant execute on function public.report_aggregate(uuid, text) to authenticated;

-- ---------- roster_csv_apply: created users with random ids (FK to auth.users failed) ----------
-- Now only links people who already have an account in this school; unknown
-- emails are reported so the admin can invite them through School → Students / HR.
create or replace function public.roster_csv_apply(p_class_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid; v_tenant uuid; v_added int := 0; v_errs jsonb := '[]'::jsonb;
  r jsonb; v_email text; v_user uuid; v_role text;
begin
  select teacher_id, tenant_id into v_teacher, v_tenant from public.classes where id = p_class_id;
  if v_teacher is null then return jsonb_build_object('error','class not found'); end if;
  if v_tenant is distinct from public.my_tenant_id() then return jsonb_build_object('error','forbidden'); end if;
  if v_teacher <> auth.uid() and not public.has_role(array['school_admin','principal','it_admin','platform_admin']) then
    return jsonb_build_object('error','forbidden');
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_email := lower(trim(coalesce(r->>'email','')));
    select id, role into v_user, v_role from public.users where email = v_email and tenant_id = v_tenant limit 1;
    if v_user is null then
      v_errs := v_errs || jsonb_build_object('row', r, 'error', 'no account with this email in this school; invite them first');
      continue;
    end if;
    insert into public.class_members (class_id, user_id, role)
      values (p_class_id, v_user, case when v_role = 'student' then 'student' else 'teacher' end)
      on conflict (class_id, user_id) do nothing;
    v_added := v_added + 1;
  end loop;
  insert into public.roster_imports (tenant_id, class_id, uploaded_by, filename, rows_total, rows_added, rows_errored, errors)
  values (v_tenant, p_class_id, auth.uid(), 'upload.csv', jsonb_array_length(p_rows), v_added, jsonb_array_length(v_errs), v_errs);
  return jsonb_build_object('total', jsonb_array_length(p_rows), 'added', v_added, 'updated', 0,
                            'errored', jsonb_array_length(v_errs), 'errors', v_errs);
end $$;
grant execute on function public.roster_csv_apply(uuid, jsonb) to authenticated;
