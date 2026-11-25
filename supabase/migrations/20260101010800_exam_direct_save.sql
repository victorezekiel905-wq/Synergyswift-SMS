-- 10800: exam autosaves straight to the database. While a hall sits an exam, autosaves are most of the
-- traffic; going through the app server made that one small server the bottleneck. A signed-in student
-- now saves their own answers here directly, with the same rules the server applies:
--   * only their own attempt for that exam, only while it is in progress (a locked attempt says so);
--   * not after the deadline plus 30 seconds' grace (the device then hands in through the server,
--     which keeps late answers for the teacher);
--   * only questions on their own paper, merged into what is saved (one step: an upload or another
--     save at the same moment is never lost), and at most 500 KB of answers in all.
-- Exams tied to the school network or Safe Exam Browser keep saving through the server, which is the
-- only place those can be checked. Safe to run again.

create or replace function public.exam_student_save(p_exam uuid, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a record;
  v_valid text[];
  v_new jsonb;
  v_n int;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'signed_out'); end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then return jsonb_build_object('status', 'invalid'); end if;
  if octet_length(p_answers::text) > 500000 then return jsonb_build_object('status', 'too_large'); end if;

  select t.id, t.status, t.deadline_at, t.question_order, t.answers, e.settings
    into a
    from public.exam_attempts t join public.exams e on e.id = t.exam_id
   where t.exam_id = p_exam and t.student_user_id = auth.uid()
   for update of t;
  if not found then return jsonb_build_object('status', 'not_started'); end if;
  -- The network and Safe Exam Browser rules are checked only by the server.
  if coalesce((a.settings->>'require_seb')::boolean, false) or jsonb_array_length(coalesce(a.settings->'allowed_ips', '[]'::jsonb)) > 0 then
    return jsonb_build_object('status', 'use_server');
  end if;
  if a.status = 'locked' then return jsonb_build_object('status', 'locked'); end if;
  if a.status <> 'in_progress' then return jsonb_build_object('status', a.status); end if;
  if now() > a.deadline_at + interval '30 seconds' then return jsonb_build_object('status', 'time_up'); end if;

  if jsonb_typeof(a.question_order) = 'array' and jsonb_array_length(a.question_order) > 0 then
    select array_agg(x) into v_valid from jsonb_array_elements_text(a.question_order) x;
  else
    select array_agg(q.id::text) into v_valid from public.exam_questions q where q.exam_id = p_exam;
  end if;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb), count(*) into v_new, v_n
    from jsonb_each(p_answers) as j(k, v) where k = any(coalesce(v_valid, '{}'));
  if octet_length((coalesce(a.answers, '{}'::jsonb) || v_new)::text) > 500000 then return jsonb_build_object('status', 'too_large'); end if;

  if v_n > 0 then
    update public.exam_attempts set answers = coalesce(answers, '{}'::jsonb) || v_new, last_seen_at = now() where id = a.id;
  end if;
  return jsonb_build_object('status', 'in_progress', 'saved', v_n, 'deadline_at', a.deadline_at, 'saved_at', now());
end$$;

revoke execute on function public.exam_student_save(uuid, jsonb) from public, anon;
grant execute on function public.exam_student_save(uuid, jsonb) to authenticated;
