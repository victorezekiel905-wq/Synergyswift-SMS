-- =========================================================================
-- Security hardening: who may call the database functions directly.
--  Supabase's advisor flagged ~160 SECURITY DEFINER functions that anyone
--  with the public (anon) key could call through /rest/v1/rpc. Revoking from
--  anon alone is not enough: Postgres also grants EXECUTE to PUBLIC, which
--  every role inherits, so each revoke here names public as well.
--   * trigger functions: nobody calls these directly (triggers still fire,
--     EXECUTE is only checked when a trigger is created);
--   * app functions that are only used after sign-in: signed-in users only;
--   * next_platform_invoice_number(): server only (5800 meant this but left
--     the PUBLIC grant in place);
--   * the classroom extension's device calls (session_by_code, device_*)
--     stay public on purpose: the extension signs in with the anon key;
--   * access-check helpers used inside RLS policies (is_staff(),
--     my_tenant_id() …) stay callable by anon too, or anonymous requests
--     would fail with "permission denied" instead of seeing no rows. They
--     only answer from auth.uid(), which is null for anon.
--  Also pins search_path on the older functions that had none.
-- Apply AFTER 20260101005800. Idempotent.
-- =========================================================================

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'activity_questions(uuid)', 'class_lookup_by_code(text)', 'device_poll_commands(uuid, uuid)',
    'end_my_sessions(uuid, boolean)', 'end_user_sessions(uuid)', 'evaluate_environment(uuid, text)',
    'game_by_code(text)', 'game_grade_answer(uuid, uuid, text, text)', 'game_question(uuid, integer)',
    'inventory_issue(uuid, numeric, uuid, uuid, text)', 'inventory_move(uuid, text, numeric, text, text)',
    'is_hod_of_subject(uuid)', 'is_platform_admin()',
    'library_holds_for_others(uuid, uuid, uuid)', 'library_issue(uuid, uuid, uuid, integer)',
    'library_lost(uuid)', 'library_renew(uuid)', 'library_reserve(uuid, uuid, uuid)', 'library_return(uuid, numeric)',
    'moderate_score_sheet(uuid, uuid, uuid, text, text)', 'my_account_state()', 'my_group_ids()', 'my_roles()',
    'my_sessions()', 'platform_admin_state()', 'platform_role()', 'po_receive(uuid, numeric, text[])',
    'report_aggregate(uuid, text)', 'roster_csv_apply(uuid, jsonb)', 'session_activities(uuid)',
    'submit_activity_response(uuid, uuid, jsonb, integer)'
  ] loop
    if to_regprocedure('public.' || f) is not null then
      execute format('revoke all on function public.%s from public, anon', f);
      execute format('grant execute on function public.%s to authenticated, service_role', f);
    end if;
  end loop;
end $$;

revoke all on function public.next_platform_invoice_number() from public, anon, authenticated;
grant execute on function public.next_platform_invoice_number() to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'activity_questions(uuid)', 'class_lookup_by_code(text)', 'device_ack_command(uuid)', 'device_heartbeat(text)',
    'device_poll_commands(uuid, uuid)', 'device_poll_commands_by_device(text)',
    'device_post_event(text, text, text, uuid, text)', 'device_post_snapshot(text, uuid, text, text, text)',
    'evaluate_environment(uuid, text)', 'game_by_code(text)', 'game_grade_answer(uuid, uuid, text, text)',
    'game_question(uuid, integer)', 'news_posts_stamp()', 'session_activities(uuid)', 'session_by_code(text)',
    'submit_activity_response(uuid, uuid, jsonb, integer)'
  ] loop
    if to_regprocedure('public.' || f) is not null then
      execute format('alter function public.%s set search_path = public', f);
    end if;
  end loop;
end $$;
