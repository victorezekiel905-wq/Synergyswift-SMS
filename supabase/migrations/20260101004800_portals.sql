-- =====================================================================
--  Phase 12a: portals and dashboards.
--
--  * Students already see their own fees (balance, what is due); the school
--    can now turn this off.
--  * A daily snapshot of the school's key numbers, so the head's dashboard
--    shows trends (attendance, fee collection, behaviour, admissions), with
--    targets the school sets.
-- =====================================================================

alter table public.tenant_settings add column if not exists student_sees_fees boolean not null default true;
-- e.g. {"attendance_rate": 95, "collection_rate": 90}
alter table public.tenant_settings add column if not exists kpi_targets jsonb not null default '{}'::jsonb;

create or replace function public.students_see_fees()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.student_sees_fees from public.tenant_settings s where s.tenant_id = public.my_tenant_id()), true);
$$;
grant execute on function public.students_see_fees() to authenticated;

-- Students already read their own invoices; the school can now turn that off (parents and the bursar are unaffected).
drop policy if exists fee_invoices_student_read on public.fee_invoices;
drop policy if exists fee_invoice_lines_student_read on public.fee_invoice_lines;
drop policy if exists fee_invoices_read on public.fee_invoices;
create policy fee_invoices_read on public.fee_invoices for select using (
  tenant_id = public.my_tenant_id() and (public.is_finance() or public.is_guardian_of(student_id)
    or (public.students_see_fees() and exists (select 1 from public.students s where s.id = fee_invoices.student_id and s.user_id = auth.uid()))));
drop policy if exists fee_lines_read on public.fee_invoice_lines;
create policy fee_lines_read on public.fee_invoice_lines for select using (
  exists (select 1 from public.fee_invoices i where i.id = fee_invoice_lines.invoice_id and i.tenant_id = public.my_tenant_id()
          and (public.is_finance() or public.is_guardian_of(i.student_id)
               or (public.students_see_fees() and exists (select 1 from public.students s where s.id = i.student_id and s.user_id = auth.uid())))));

-- One row per school per day, written by the daily job.
create table if not exists public.kpi_snapshots (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  day         date not null,
  metrics     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, day)
);
alter table public.kpi_snapshots enable row level security;
drop policy if exists kpi_snapshots_read on public.kpi_snapshots;
create policy kpi_snapshots_read on public.kpi_snapshots for select
  using (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.is_finance()));
-- No write policies: only the server writes snapshots.
grant all on public.kpi_snapshots to service_role;

-- Snapshots are written by the server once a day; no need to log every one in the change history.
create or replace function public.attach_change_log()
returns int language plpgsql security definer set search_path = public as $$
declare t text; n int := 0;
  skip text[] := array['data_changes','audit_logs','platform_audit_logs','message_outbox','exam_events','exam_attempts','practice_sessions',
        'browser_events','environment_events','screen_snapshots','student_presence','session_participants','raise_hands','rtc_rooms','rtc_peers','rtc_signals',
        'transport_live','push_subscriptions','doc_counters','lead_sequence_runs','access_grants','phone_login_codes','quiz_attempts','quiz_answers',
        'activity_responses','game_sessions','game_players','leaderboard_entries','conversation_messages','pickup_attempts','device_enrollments','devices',
        'teacher_commands','survey_invites','tenants',
        'learning_activity','content_attempts','xapi_statements','xapi_state','breakout_members','online_lesson_joins','tutor_messages','integration_secrets','online_lesson_hosts','admission_secrets',
        'calendar_feeds','notice_recipients','student_thread_messages',
        'sensitive_access_log','pastoral_referrals','counselling_cases','counselling_sessions','safeguarding_concerns','safeguarding_actions','wellbeing_checkins',
        'kpi_snapshots'];
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and x.table_type = 'BASE TABLE'
  loop
    -- Re-running an older update re-attaches the trigger everywhere; this puts the exclusions back.
    execute format('drop trigger if exists zz_log_data_change on public.%I', t);
    if t = any(skip) then continue; end if;
    execute format('create trigger zz_log_data_change after insert or update or delete on public.%I for each row execute function public.log_data_change()', t);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.attach_change_log() from public, anon, authenticated;
select public.attach_change_log();
