-- =========================================================================
-- Found by the 100,000-account test and the live security check (2026-10-29).
--
--  * Classroom devices: three early "agent" policies let ANY signed-in user
--    read every school's queued device commands, edit any school's commands,
--    and edit (or move to another school) any device. The browser extension
--    never needed them: it works through the device_* functions, which check
--    the device themselves. Dropped; the original owner-only policies remain.
--  * device_ack_command(id) acknowledged any command by id alone. It now also
--    takes the device, and only acknowledges a command sent to the student on
--    that device. The old one-argument form is removed.
--  * my_taught_students(): "form teacher OR teaches a subject" was written so
--    that no index could be used, so every teacher and parent screen scanned
--    every student of every school. Same answer, read through two indexes.
--  * platform_customer_metrics() (the owner console's school list) read every
--    account on the platform once per school to count sign-ins: 4.7 s at
--    100,000 accounts and growing with the square of the platform. It now
--    reads the accounts once, grouped by school. Same columns, same answers.
--  * fee_invoices had the same index twice.
-- Idempotent. Apply after 20260101008500.
-- =========================================================================

drop policy if exists devices_agent_update on public.devices;
drop policy if exists teacher_commands_agent_read on public.teacher_commands;
drop policy if exists teacher_commands_agent_update on public.teacher_commands;

drop function if exists public.device_ack_command(uuid);
create or replace function public.device_ack_command(p_id uuid, p_device_uid text)
returns void language sql security definer set search_path = public as $$
  update public.teacher_commands tc set state = 'acked', acked_at = now()
  where tc.id = p_id and tc.state in ('queued', 'delivered')
    and tc.target_student_id = (
      select de.student_id from public.device_enrollments de join public.devices d on d.id = de.device_id
      where d.device_uid = p_device_uid and de.revoked_at is null
      order by de.enrolled_at desc limit 1);
$$;
revoke all on function public.device_ack_command(uuid, text) from public;
grant execute on function public.device_ack_command(uuid, text) to anon, authenticated;

create index if not exists class_groups_form_teacher on public.class_groups(form_teacher_id) where form_teacher_id is not null;
create index if not exists subject_offerings_teacher on public.subject_offerings(teacher_id) where teacher_id is not null;

create or replace function public.my_taught_students()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.id), '{}') from public.students s
  where s.class_group_id in (
    select g.id from public.class_groups g where g.form_teacher_id = auth.uid()
    union
    select o.class_group_id from public.subject_offerings o where o.teacher_id = auth.uid())
$$;

create or replace function public.platform_customer_metrics()
returns table (tenant_id uuid, name text, status text, created_at timestamptz, students int, staff int, parents_with_login int,
               staff_signed_in_30 int, users_signed_in_30 int, actions_30 int, actions_prev_30 int, last_action_at timestamptz,
               invoices_overdue int, oldest_overdue_days int, sub_status text, period_end timestamptz, plan_name text, custom_annual bigint)
language sql stable security definer set search_path = public as $$
  with sign_ins as (
    select u.tenant_id,
      count(*) filter (where u.role not in ('student','parent','alumni') and au.last_sign_in_at > now() - interval '30 days') as staff_30,
      count(*) filter (where au.last_sign_in_at > now() - interval '30 days') as users_30,
      max(au.last_sign_in_at) as last_sign_in
    from public.users u join auth.users au on au.id = u.id
    where u.tenant_id is not null
    group by u.tenant_id)
  select t.id, t.name, t.status, t.created_at,
    (select count(*) from public.students s where s.tenant_id = t.id and s.status = 'active')::int,
    (select count(*) from public.users u where u.tenant_id = t.id and u.role not in ('student','parent','alumni'))::int,
    (select count(*) from public.guardians g where g.tenant_id = t.id and g.user_id is not null)::int,
    coalesce(si.staff_30, 0)::int,
    coalesce(si.users_30, 0)::int,
    (select count(*) from public.audit_logs a where a.tenant_id = t.id and a.ts > now() - interval '30 days')::int,
    (select count(*) from public.audit_logs a where a.tenant_id = t.id and a.ts <= now() - interval '30 days' and a.ts > now() - interval '60 days')::int,
    greatest((select max(a.ts) from public.audit_logs a where a.tenant_id = t.id), si.last_sign_in),
    (select count(*) from public.invoices i where i.tenant_id = t.id and i.status = 'open' and i.due_at < now())::int,
    (select coalesce(max(extract(day from now() - i.due_at)), 0) from public.invoices i where i.tenant_id = t.id and i.status = 'open' and i.due_at < now())::int,
    sub.status, sub.period_end, p.name, sub.custom_annual
  from public.tenants t
  left join sign_ins si on si.tenant_id = t.id
  left join lateral (select * from public.subscriptions s where s.tenant_id = t.id order by s.created_at desc limit 1) sub on true
  left join public.plans p on p.id = sub.plan_id
$$;
revoke all on function public.platform_customer_metrics() from public, anon, authenticated;
grant execute on function public.platform_customer_metrics() to service_role;

drop index if exists public.fee_invoices_tenant;
