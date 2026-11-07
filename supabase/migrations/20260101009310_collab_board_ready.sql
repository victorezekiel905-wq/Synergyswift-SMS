-- =========================================================================
-- Collaborative boards open for students straight away.
--
-- A lesson's board was only created when the teacher's Responses tab showed it, so a
-- board launched from the Lesson tab (or before the teacher looked) left students on
-- "Waiting for your teacher to open the board", with nothing for the teacher to press.
-- And nothing stopped a second board for the same activity (two teacher tabs), after
-- which nobody's screen could find "the" board.
--
-- live.ensure_collab_board returns the lesson's board for the activity, creating it once
-- (owned by the lesson's teacher) when anyone in the lesson opens it: the teacher or a
-- student. Only a collaborative-board activity of the same school gets a board, and only
-- people in the lesson (or who run it) can ask. Apply AFTER 20260101006100. Idempotent.
-- =========================================================================

create or replace function live.ensure_collab_board(p_activity uuid, p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s   live.class_sessions;
  v_act live.activities;
  v_b   live.collab_boards;
begin
  select * into v_s from live.class_sessions where id = p_session;
  if v_s.id is null or not (live_app.can_manage_session(p_session) or live_app.in_session(p_session)) then
    raise exception 'Lesson not found.' using errcode = 'P0002';
  end if;
  select * into v_act from live.activities where id = p_activity and tenant_id = v_s.tenant_id;
  if v_act.id is null or v_act.kind <> 'collab_board' then
    raise exception 'That is not a collaborative board.' using errcode = '22023';
  end if;

  -- One board per activity per lesson, even when two screens open it at the same moment.
  perform pg_advisory_xact_lock(hashtextextended('collab_board:' || p_session::text || ':' || p_activity::text, 0));
  select * into v_b from live.collab_boards
   where activity_id = p_activity and session_id = p_session order by created_at, id limit 1;
  if v_b.id is null then
    insert into live.collab_boards (tenant_id, activity_id, session_id, owner_id, title)
    values (v_s.tenant_id, p_activity, p_session, v_s.teacher_id, left(coalesce(nullif(btrim(v_act.title), ''), 'Class board'), 200))
    returning * into v_b;
  end if;
  return jsonb_build_object('id', v_b.id, 'title', v_b.title, 'locked', v_b.locked, 'anonymous', v_b.anonymous, 'owner_id', v_b.owner_id);
end $$;

revoke execute on function live.ensure_collab_board(uuid, uuid) from public, anon;
grant execute on function live.ensure_collab_board(uuid, uuid) to authenticated;
