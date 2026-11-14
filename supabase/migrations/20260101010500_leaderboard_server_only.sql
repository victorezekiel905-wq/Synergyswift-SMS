-- 10500: leaderboard rows (the first games engine, before live lessons) are written only by the
-- server's grading function (game_grade_answer, which runs with the owner's rights). Anyone
-- signed in to a school could also add rows directly, and so give themselves points. That
-- direct door is closed; reading stays as it was. Safe to run again.
drop policy if exists leaderboard_insert on public.leaderboard_entries;
revoke insert, update, delete on public.leaderboard_entries from anon, authenticated;
