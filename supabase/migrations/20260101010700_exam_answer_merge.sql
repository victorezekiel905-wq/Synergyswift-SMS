-- 10700: saving exam answers in one step. An autosave and a file or voice upload used to each read
-- the attempt's answers, add their own and write the whole set back. When both happened at the same
-- moment (a slow server, a full class) the later write could wipe out the other's answer. This
-- function adds the new answers to whatever is saved at that instant, in a single statement, so
-- nothing is lost. Only the server (service role) may call it. Safe to run again.

create or replace function public.exam_merge_answers(p_attempt uuid, p_answers jsonb, p_statuses text[] default array['in_progress', 'locked'])
returns setof public.exam_attempts
language sql volatile security definer set search_path = '' as $$
  update public.exam_attempts
     set answers = coalesce(answers, '{}'::jsonb) || coalesce(p_answers, '{}'::jsonb),
         last_seen_at = now()
   where id = p_attempt and status = any(p_statuses)
  returning *
$$;

revoke execute on function public.exam_merge_answers(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.exam_merge_answers(uuid, jsonb, text[]) to service_role;
