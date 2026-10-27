-- =============================================================================
-- Synergy Swift — live games rework (Phase 14d-3)
--
-- Game modes (settings.mode):
--   classic      the teacher moves the class through the questions together
--   team_battle  teams, scored by the AVERAGE of their players (a big team no longer wins by size)
--   survival     everyone starts with lives; a wrong or missed answer costs one; last ones standing win
--   race         the class races along a track: every right answer is one step to the finish line
--   self_paced   homework mode: no host, each player goes at their own pace until the game closes
-- Power-ups are earned (never bought): every 3 right answers in a row gives one (up to 3 held):
--   double  next right answer scores double     shield  next wrong answer keeps your streak and life
--   fifty   hides half of the wrong options on the current question
-- Comeback bonus: a right answer from the bottom half of the board scores +25% (max +250).
-- Characters: students collect the critters by earning XP; games now give XP for right answers.
-- Guests of a live lesson can play the Challenge the teacher launches from that lesson.
-- Leaderboards carry an opaque per-player key, so "you" is found by key, not by name
-- (two guests called "Sam", or anonymous names, used to break it).
-- Everything here replaces engine functions (20260101006100) in place.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
alter table live.game_sessions drop constraint if exists game_sessions_status_check;
alter table live.game_sessions add constraint game_sessions_status_check
  check (status in ('lobby','question','review','ended','open'));
alter table live.game_sessions add column if not exists closes_at timestamptz;

alter table live.game_players
  add column if not exists avatar          text check (avatar is null or avatar ~ '^[a-z]{2,16}$'),
  add column if not exists lives           int,
  add column if not exists out_at          timestamptz,
  add column if not exists powerups        text[] not null default '{}',
  add column if not exists active_powerup  text check (active_powerup is null or active_powerup in ('double','shield','fifty')),
  add column if not exists hidden_options  uuid[] not null default '{}',
  add column if not exists hidden_for      int,
  add column if not exists earned_powerup  text,
  add column if not exists earned_for      int,
  add column if not exists worst_rank      int,
  add column if not exists q_index         int not null default 0,
  add column if not exists q_started_at    timestamptz,
  add column if not exists finished_at     timestamptz;

alter table live.game_answers
  add column if not exists powerup        text,
  add column if not exists powerup_bonus  int not null default 0,
  add column if not exists comeback_bonus int not null default 0;

alter table live.xp_events drop constraint if exists xp_events_source_check;
alter table live.xp_events add constraint xp_events_source_check
  check (source in ('answer','reasoning','completion','perfect','game','teacher','question','game_result'));

-- Characters a student has collected, and the one they play as.
create table if not exists live.student_characters (
  student_id   uuid not null,
  tenant_id    uuid not null,
  critter      text not null check (critter ~ '^[a-z]{2,16}$'),
  unlocked_at  timestamptz not null default now(),
  primary key (student_id, critter),
  foreign key (student_id, tenant_id) references live.users(id, tenant_id) on delete cascade
);
alter table live.student_characters enable row level security;
drop policy if exists student_characters_read on live.student_characters;
create policy student_characters_read on live.student_characters for select to authenticated
  using (tenant_id = (select live_app.tenant_id())
         and (student_id = (select auth.uid()) or live_app.teaches_student(student_id) or live_app.is_parent_of(student_id)));
alter table live.student_profiles add column if not exists critter text check (critter is null or critter ~ '^[a-z]{2,16}$');

-- ---------------------------------------------------------------------------
-- 2. Characters: the collection, unlocked by XP
-- ---------------------------------------------------------------------------
-- Keep in step with src/live/components/live/avatars.ts (CHARACTERS).
create or replace function live_app.critters() returns table (critter text, unlock_xp int, rarity text)
language sql immutable set search_path = '' as $$
  values ('fox', 0, 'starter'), ('owl', 0, 'starter'), ('panda', 0, 'starter'), ('frog', 0, 'starter'),
         ('tiger', 100, 'common'), ('koala', 250, 'common'), ('penguin', 400, 'common'), ('rabbit', 600, 'common'),
         ('turtle', 900, 'rare'), ('lion', 1300, 'rare'), ('octopus', 1800, 'rare'), ('cat', 2400, 'rare'),
         ('unicorn', 3200, 'epic'), ('whale', 4200, 'epic'), ('dragon', 5500, 'legendary'), ('phoenix', 7500, 'legendary')
$$;

create or replace function live_app.critter_xp(p_key text) returns int
language sql immutable set search_path = '' as $$
  select c.unlock_xp from live_app.critters() c where c.critter = p_key
$$;

create or replace function live_app.student_xp(p_student uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(points), 0) from live.xp_events where student_id = p_student
$$;

-- May this person play as this character? Starters for everyone; the rest once earned.
create or replace function live_app.can_use_character(p_user uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(live_app.critter_xp(p_key) = 0, false)
      or exists (select 1 from live.student_characters c where c.student_id = p_user and c.critter = p_key)
$$;

-- After XP: collect every character the new total reaches, and say so.
create or replace function live_app.on_xp_characters() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_total bigint; r record;
begin
  v_total := live_app.student_xp(new.student_id);
  for r in
    insert into live.student_characters (student_id, tenant_id, critter)
      select new.student_id, new.tenant_id, c.critter from live_app.critters() c
       where c.unlock_xp > 0 and c.unlock_xp <= v_total
      on conflict do nothing
      returning critter
  loop
    perform live_app.notify(new.student_id, 'character', 'New character unlocked: ' || initcap(r.critter),
      'Play as it in your next game.', '/live/student/characters', 'info', jsonb_build_object('critter', r.critter));
  end loop;
  return null;
end$$;
drop trigger if exists xp_events_characters on live.xp_events;
create trigger xp_events_characters after insert on live.xp_events for each row execute function live_app.on_xp_characters();

create or replace function live.my_characters() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me live.users := live_app.me(); v_xp bigint;
begin
  if v_me.id is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_xp := live_app.student_xp(v_me.id);
  return jsonb_build_object(
    'xp', v_xp, 'level', live_app.xp_level(v_xp),
    'chosen', (select p.critter from live.student_profiles p where p.user_id = v_me.id),
    'characters', (select coalesce(jsonb_agg(jsonb_build_object('key', c.critter, 'unlock_xp', c.unlock_xp, 'rarity', c.rarity,
                     'unlocked', c.unlock_xp = 0 or s.critter is not null, 'unlocked_at', s.unlocked_at) order by c.unlock_xp, c.critter), '[]'::jsonb)
                   from live_app.critters() c
                   left join live.student_characters s on s.student_id = v_me.id and s.critter = c.critter),
    'next', (select jsonb_build_object('key', c.critter, 'unlock_xp', c.unlock_xp, 'to_go', c.unlock_xp - v_xp)
               from live_app.critters() c where c.unlock_xp > v_xp order by c.unlock_xp limit 1));
end$$;

create or replace function live.choose_character(p_key text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me live.users := live_app.me();
begin
  if v_me.id is null or v_me.role <> 'student' then raise exception 'Only students collect characters.' using errcode = '42501'; end if;
  if live_app.critter_xp(p_key) is null then raise exception 'Unknown character.' using errcode = '22023'; end if;
  if not live_app.can_use_character(v_me.id, p_key) then
    raise exception 'Earn % XP to unlock this character.', live_app.critter_xp(p_key) using errcode = 'P0001';
  end if;
  insert into live.student_profiles (user_id, tenant_id, critter) values (v_me.id, v_me.tenant_id, p_key)
    on conflict (user_id) do update set critter = excluded.critter;
end$$;

-- The lobby avatar: only characters this person has (guests: the starters).
create or replace function live.set_avatar(p_session uuid, p_avatar text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_avatar !~ '^[a-z]{2,16}$' or live_app.critter_xp(p_avatar) is null then raise exception 'Unknown avatar.' using errcode = '22023'; end if;
  if not live_app.can_use_character(auth.uid(), p_avatar) then
    raise exception 'Earn % XP to unlock this character.', live_app.critter_xp(p_avatar) using errcode = 'P0001';
  end if;
  update live.session_participants set avatar = p_avatar
   where session_id = p_session and user_id = auth.uid() and removed_at is null;
  if not found then raise exception 'Join the lesson first.' using errcode = 'P0002'; end if;
end$$;

-- Joining a game gives XP to students only (guests have no XP to keep).
create or replace function live_app.game_xp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_class uuid;
begin
  if new.user_id is null or not exists (select 1 from live.users u where u.id = new.user_id and u.role = 'student') then return null; end if;
  select class_id into v_class from live.game_sessions where id = new.game_id;
  perform live_app.give_xp(new.tenant_id, new.user_id, v_class, 'game', new.game_id, 10, 'Played a class game');
  return null;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Settings, access and helpers
-- ---------------------------------------------------------------------------
create or replace function live_app.game_settings(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with m as (select case when p ->> 'mode' in ('classic','team_battle','survival','race','self_paced') then p ->> 'mode' else 'classic' end as mode)
  select jsonb_build_object(
    'mode',             m.mode,
    -- 0 = untimed: the teacher moves on when the class is ready; no speed bonus.
    'question_seconds', case when coalesce((p ->> 'question_seconds')::int, 20) = 0 then 0
                             else least(greatest(coalesce((p ->> 'question_seconds')::int, 20), 5), 240) end,
    'speed_bonus',      coalesce((p ->> 'speed_bonus')::boolean, true) and coalesce((p ->> 'question_seconds')::int, 20) <> 0,
    'streak_bonus',     coalesce((p ->> 'streak_bonus')::boolean, true),
    'rank_visibility',  case when coalesce((p ->> 'class_goal')::boolean, false) then 'hidden'
                             when p ->> 'rank_visibility' in ('after_each','end_only','hidden') then p ->> 'rank_visibility' else 'after_each' end,
    'display_mode',     case when p ->> 'display_mode' in ('first_name_initial','nickname','anonymous') then p ->> 'display_mode' else 'first_name_initial' end,
    'team_mode',        m.mode = 'team_battle' or (m.mode <> 'self_paced' and coalesce((p ->> 'team_mode')::boolean, false)),
    'team_count',       least(greatest(coalesce((p ->> 'team_count')::int, 2), 2), 6),
    'shuffle_questions', coalesce((p ->> 'shuffle_questions')::boolean, false),
    'shuffle_options',  coalesce((p ->> 'shuffle_options')::boolean, true),
    'podium_size',      least(greatest(coalesce((p ->> 'podium_size')::int, 3), 1), 10),
    'certificates',     coalesce((p ->> 'certificates')::boolean, true),
    -- Whole class works towards one target: this share of all answers correct.
    'class_goal',       coalesce((p ->> 'class_goal')::boolean, false) and m.mode in ('classic','race'),
    'goal_percent',     least(greatest(coalesce((p ->> 'goal_percent')::int, 70), 30), 100),
    'locked',           coalesce((p ->> 'locked')::boolean, false),
    'lives',            least(greatest(coalesce((p ->> 'lives')::int, 3), 1), 5),
    'powerups',         coalesce((p ->> 'powerups')::boolean, true),
    'comeback',         coalesce((p ->> 'comeback')::boolean, true))
  from m
$$;

create or replace function live_app.game_mode(p_game live.game_sessions) returns text
language sql immutable set search_path = '' as $$
  select coalesce(p_game.settings ->> 'mode', 'classic')
$$;

-- Who may play: the class, plus guests of the live lesson the game was launched from.
create or replace function live_app.game_can_play(p_game live.game_sessions) returns boolean
language sql stable security definer set search_path = '' as $$
  select live_app.in_class(p_game.class_id) or (p_game.session_id is not null and live_app.is_session_guest(p_game.session_id))
$$;

-- An opaque, stable id for a player on a board (never their user id).
create or replace function live_app.board_key(p_scope uuid, p_user uuid) returns text
language sql immutable set search_path = '' as $$
  select left(encode(sha256(convert_to(p_scope::text || ':' || p_user::text, 'UTF8')), 'hex'), 16)
$$;

-- Who runs a game: whoever created it, the class teacher, co-teachers and school admins.
create or replace function live_app.can_host_game(p_class uuid, p_host uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_host = auth.uid() or live_app.can_manage_class(p_class)
$$;

create or replace function live_app.require_game_host(p_game uuid) returns live.game_sessions
language plpgsql stable security definer set search_path = '' as $$
declare v live.game_sessions;
begin
  select * into v from live.game_sessions where id = p_game;
  if v.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if not live_app.can_host_game(v.class_id, v.host_id) then raise exception 'Only the host can control this game.' using errcode = '42501'; end if;
  return v;
end$$;

-- The game tables follow the same rule (and guests of the lesson see their game).
drop policy if exists game_sessions_read on live.game_sessions;
create policy game_sessions_read on live.game_sessions for select to authenticated
  using (live_app.can_host_game(class_id, host_id) or live_app.in_class(class_id)
         or (session_id is not null and live_app.is_session_guest(session_id)));
drop policy if exists game_players_read on live.game_players;
create policy game_players_read on live.game_players for select to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from live.game_sessions g where g.id = game_id and live_app.can_host_game(g.class_id, g.host_id)));
drop policy if exists game_answers_read on live.game_answers;
create policy game_answers_read on live.game_answers for select to authenticated
  using (exists (select 1 from live.game_players p where p.id = player_id and p.user_id = (select auth.uid()))
         or exists (select 1 from live.game_sessions g where g.id = game_id and live_app.can_host_game(g.class_id, g.host_id)));
drop policy if exists leaderboard_entries_read on live.leaderboard_entries;
create policy leaderboard_entries_read on live.leaderboard_entries for select to authenticated
  using (exists (select 1 from live.game_sessions g where g.id = game_id and live_app.can_host_game(g.class_id, g.host_id)));
drop policy if exists game_flags_read on live.game_flags;
create policy game_flags_read on live.game_flags for select to authenticated
  using (exists (select 1 from live.game_sessions g where g.id = game_id and live_app.can_host_game(g.class_id, g.host_id)));

-- Question kinds a game can mark on the spot.
create or replace function live_app.game_kind(p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select p_kind in ('mcq','true_false','multi_select','fill_blank','matching','ordering','categorize')
$$;

-- Time's up: a question closes on the next look (after the same 1.5 s grace answers get),
-- and a self-paced game past its closing time is finished.
create or replace function live_app.game_tick(p_game uuid) returns live.game_sessions
language plpgsql volatile security definer set search_path = '' as $$
declare v live.game_sessions;
begin
  select * into v from live.game_sessions where id = p_game;
  if v.status = 'question' and now() > v.question_ends_at + interval '1500 milliseconds' then
    perform live_app.close_question(p_game);
  elsif v.status = 'open' and v.closes_at is not null and now() > v.closes_at then
    perform live_app.finish_game(p_game);
  end if;
  select * into v from live.game_sessions where id = p_game;
  return v;
end$$;

-- ---------------------------------------------------------------------------
-- 4. Create and join
-- ---------------------------------------------------------------------------
create or replace function live.create_game(
  p_class uuid, p_activity uuid, p_settings jsonb default '{}'::jsonb, p_session uuid default null, p_title text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me     live.users := live_app.me();
  v_act    live.activities;
  v_set    jsonb := live_app.game_settings(p_settings);
  v_order  uuid[];
  v_game   live.game_sessions;
  v_closes timestamptz;
  v_colors text[] := array['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#14b8a6'];
  v_names  text[] := array['Red Rockets','Blue Comets','Green Geckos','Gold Falcons','Purple Owls','Teal Tigers'];
begin
  -- Subject teachers run games for the classes they teach, not only the class teacher.
  if not live_app.can_teach_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if not live_app.feature(v_me.tenant_id, 'games') then raise exception 'Games are not included in your plan.' using errcode = 'P0001'; end if;
  select * into v_act from live.activities where id = p_activity and tenant_id = v_me.tenant_id;
  if v_act.id is null or not live_app.can_view_activity(p_activity) then raise exception 'Quiz not found.' using errcode = 'P0002'; end if;
  if p_session is not null and live_app.session_class(p_session) is distinct from p_class then
    raise exception 'That live session belongs to another class.' using errcode = '22023';
  end if;

  select array_agg(q.id order by case when (v_set ->> 'shuffle_questions')::boolean then md5(random()::text) else lpad(q.position::text, 6, '0') || q.created_at::text end)
    into v_order
  from live.questions q where q.activity_id = p_activity and live_app.game_kind(q.kind);
  if coalesce(array_length(v_order, 1), 0) = 0 then
    raise exception 'Games need at least one question that is marked automatically (choice, true/false, gap fill, matching, ordering or sorting).' using errcode = 'P0001';
  end if;

  if v_set ->> 'mode' = 'self_paced' then
    begin v_closes := (p_settings ->> 'closes_at')::timestamptz;
    exception when others then raise exception 'Choose when the game closes.' using errcode = '22023'; end;
    v_closes := coalesce(v_closes, now() + interval '7 days');
    if v_closes < now() + interval '10 minutes' or v_closes > now() + interval '60 days' then
      raise exception 'A self-paced game closes between 10 minutes and 60 days from now.' using errcode = '22023';
    end if;
  end if;

  insert into live.game_sessions (tenant_id, class_id, host_id, activity_id, session_id, title, join_code, settings, question_order,
                                  status, closes_at, started_at)
    values (v_me.tenant_id, p_class, v_me.id, p_activity, p_session, coalesce(nullif(btrim(p_title), ''), v_act.title),
            live_app.unique_code(6, 'game_sessions'), v_set, v_order,
            case when v_closes is null then 'lobby' else 'open' end, v_closes, case when v_closes is null then null else now() end)
    returning * into v_game;

  if (v_set ->> 'team_mode')::boolean then
    insert into live.game_teams (tenant_id, game_id, name, color)
      select v_me.tenant_id, v_game.id, v_names[i], v_colors[i] from generate_series(1, (v_set ->> 'team_count')::int) i;
  end if;

  perform live_app.audit('game.created', 'game', v_game.id::text, jsonb_build_object('class_id', p_class, 'activity_id', p_activity, 'mode', v_set ->> 'mode'));
  perform live_app.notify(m.user_id, 'game_created',
    case when v_closes is null then 'A Challenge is open: ' else 'New game to play by ' || to_char(v_closes, 'DD Mon') || ': ' end || v_game.title,
    'Join code ' || v_game.join_code, '/live/student/game/' || v_game.id, 'info', jsonb_build_object('game_id', v_game.id))
  from live.class_members m where m.class_id = p_class and m.role = 'student';
  return to_jsonb(v_game);
end$$;

create or replace function live.join_game(p_code text, p_nickname text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me     live.users := live_app.me();
  v_game   live.game_sessions;
  v_name   text;
  v_team   uuid;
  v_player live.game_players;
  v_n      int;
  v_avatar text;
begin
  select * into v_game from live.game_sessions where join_code = upper(btrim(p_code)) and status <> 'ended';
  if v_game.id is null then raise exception 'No open game with that code.' using errcode = 'P0002'; end if;
  if v_me.role not in ('student','guest') or not live_app.game_can_play(v_game) then
    raise exception 'This game is for students in another class.' using errcode = '42501';
  end if;
  if v_game.status = 'open' and v_game.closes_at is not null and now() > v_game.closes_at then
    raise exception 'This game has closed.' using errcode = 'P0001';
  end if;

  select * into v_player from live.game_players where game_id = v_game.id and user_id = v_me.id;
  if v_player.id is not null then return jsonb_build_object('game_id', v_game.id, 'player_id', v_player.id, 'display_name', v_player.display_name); end if;
  if coalesce((v_game.settings ->> 'locked')::boolean, false) then
    raise exception 'Your teacher has locked this game. Ask them to let you in.' using errcode = 'P0001';
  end if;

  case v_game.settings ->> 'display_mode'
    when 'nickname' then
      v_name := regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g');
      if v_name !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,19}$' then
        raise exception 'Nicknames are 2-20 letters, numbers, spaces, - or _.' using errcode = '22023';
      end if;
      if exists (select 1 from live.game_players where game_id = v_game.id and lower(display_name) = lower(v_name)) then
        raise exception 'That nickname is taken in this game.' using errcode = 'P0001';
      end if;
    when 'anonymous' then
      select count(*) + 1 into v_n from live.game_players where game_id = v_game.id;
      v_name := 'Player ' || v_n;
    else
      v_name := live_app.display_name(coalesce(
        (select g.display_name from live.session_guests g where g.session_id = v_game.session_id and g.user_id = v_me.id), v_me.full_name));
  end case;

  if (v_game.settings ->> 'team_mode')::boolean then
    select t.id into v_team from live.game_teams t
      left join live.game_players p on p.team_id = t.id
     where t.game_id = v_game.id group by t.id order by count(p.id), t.name limit 1;
  end if;

  -- Play as your chosen character, else the avatar picked in the lesson's lobby.
  v_avatar := coalesce((select p.critter from live.student_profiles p where p.user_id = v_me.id),
                       (select sp.avatar from live.session_participants sp where sp.session_id = v_game.session_id and sp.user_id = v_me.id));

  insert into live.game_players (tenant_id, game_id, user_id, display_name, team_id, avatar, lives)
    values (v_me.tenant_id, v_game.id, v_me.id, v_name, v_team, v_avatar,
            case when v_game.settings ->> 'mode' = 'survival' then (v_game.settings ->> 'lives')::int end)
    returning * into v_player;
  return jsonb_build_object('game_id', v_game.id, 'player_id', v_player.id, 'display_name', v_player.display_name);
end$$;

-- From a link or notification: the player screen knows the game, not its code.
create or replace function live.join_game_by_id(p_game uuid, p_nickname text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_code text;
begin
  select join_code into v_code from live.game_sessions where id = p_game and tenant_id = live_app.tenant_id();
  if v_code is null then raise exception 'No open game with that code.' using errcode = 'P0002'; end if;
  return live.join_game(v_code, p_nickname);
end$$;

-- ---------------------------------------------------------------------------
-- 5. Running the game
-- ---------------------------------------------------------------------------
create or replace function live_app.snapshot_leaderboard(p_game uuid, p_index int) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into live.leaderboard_entries (tenant_id, game_id, player_id, question_index, rank, score)
  select p.tenant_id, p.game_id, p.id, p_index,
         rank() over (order by p.score desc, p.correct_count desc), p.score
  from live.game_players p where p.game_id = p_game
  on conflict (game_id, question_index, player_id) do update set rank = excluded.rank, score = excluded.score;
  -- Lowest place each player has been in (for the comeback badge).
  update live.game_players p set worst_rank = greatest(coalesce(p.worst_rank, 0), e.rank)
    from live.leaderboard_entries e where e.game_id = p_game and e.question_index = p_index and e.player_id = p.id;
end$$;

-- Earn a power-up every third right answer in a row (at most three held).
create or replace function live_app.maybe_powerup(p_player uuid, p_index int) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v live.game_players; v_kind text;
begin
  select * into v from live.game_players where id = p_player;
  if v.streak = 0 or v.streak % 3 <> 0 or coalesce(array_length(v.powerups, 1), 0) >= 3 then return null; end if;
  v_kind := (array['double','shield','fifty'])[1 + (get_byte(decode(md5(p_player::text || p_index::text), 'hex'), 0) % 3)];
  update live.game_players set powerups = powerups || v_kind, earned_powerup = v_kind, earned_for = p_index where id = p_player;
  return v_kind;
end$$;

create or replace function live_app.close_question(p_game uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v live.game_sessions; r record;
begin
  update live.game_sessions set status = 'review', question_ends_at = least(question_ends_at, now())
   where id = p_game and status = 'question' returning * into v;
  if v.id is null then return; end if;

  -- No answer ends a streak, and in survival costs a life (a shield protects both, once).
  update live.game_players p set
      streak = case when p.active_powerup = 'shield' then p.streak else 0 end,
      lives = case when v.settings ->> 'mode' = 'survival' and p.active_powerup is distinct from 'shield'
                   then greatest(coalesce(p.lives, 1) - 1, 0) else p.lives end,
      out_at = case when v.settings ->> 'mode' = 'survival' and p.active_powerup is distinct from 'shield' and coalesce(p.lives, 1) <= 1
                    then now() else p.out_at end,
      active_powerup = case when p.active_powerup = 'shield' then null else p.active_powerup end
   where p.game_id = p_game and p.out_at is null
     and not exists (select 1 from live.game_answers a where a.player_id = p.id and a.question_index = v.current_index);

  if coalesce((v.settings ->> 'powerups')::boolean, true) then
    for r in select a.player_id from live.game_answers a where a.game_id = p_game and a.question_index = v.current_index and a.is_correct loop
      perform live_app.maybe_powerup(r.player_id, v.current_index);
    end loop;
  end if;
  perform live_app.snapshot_leaderboard(p_game, v.current_index);
end$$;

create or replace function live_app.finish_game(p_game uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v live.game_sessions; v_total int; v_podium int; v_n int; v_mode text; v_top_team uuid;
begin
  select * into v from live.game_sessions where id = p_game;
  if v.status = 'ended' then return; end if;
  -- Ending mid-question costs nobody a life or a streak: the round just stops.
  if v.status = 'question' then perform live_app.snapshot_leaderboard(p_game, v.current_index); end if;
  update live.game_sessions set status = 'ended', ended_at = now() where id = p_game;
  v_total := coalesce(array_length(v.question_order, 1), 0);
  v_podium := (v.settings ->> 'podium_size')::int;
  v_mode := live_app.game_mode(v);
  select count(*) into v_n from live.game_players where game_id = p_game;

  if (v.settings ->> 'team_mode')::boolean then
    select p.team_id into v_top_team from live.game_players p where p.game_id = p_game and p.team_id is not null
     group by p.team_id order by avg(p.score) desc, sum(p.correct_count) desc limit 1;
  end if;

  with ranked as (
    select p.id, p.user_id, p.tenant_id, p.correct_count, p.best_streak, p.worst_rank, p.out_at, p.team_id, p.finished_at,
           live_app.game_rank(v, p) as rk,
           (select avg(a.scored_elapsed_ms) from live.game_answers a where a.player_id = p.id and a.is_correct) as avg_ms,
           (select count(*) from live.game_answers a where a.player_id = p.id) as answered
    from live.game_players p where p.game_id = p_game),
  fastest as (select id from ranked where avg_ms is not null order by avg_ms limit 1)
  update live.game_players p set badges = array_remove(array[
      case when r.rk = 1 then 'gold' when r.rk = 2 then 'silver' when r.rk = 3 then 'bronze' end,
      case when r.rk <= v_podium then 'podium' end,
      case when v_total > 0 and r.correct_count = v_total then 'perfect' end,
      case when r.best_streak >= 10 then 'streak_10' when r.best_streak >= 5 then 'streak_5' end,
      case when r.id in (select id from fastest) then 'speedster' end,
      case when v_mode = 'survival' and r.out_at is null and r.answered > 0 then 'survivor' end,
      case when v_n >= 4 and r.rk <= 3 and coalesce(r.worst_rank, 0) > ceil(v_n / 2.0) then 'comeback' end,
      case when v_top_team is not null and r.team_id = v_top_team then 'team_win' end,
      case when v_mode = 'self_paced' and r.finished_at is not null then 'finisher' end], null)
  from ranked r where r.id = p.id;

  -- XP for students: 5 a right answer, plus a podium bonus (capped at 100 a game).
  perform live_app.give_xp(p.tenant_id, p.user_id, v.class_id, 'game_result', p_game,
            p.correct_count * 5 + case when 'gold' = any(p.badges) then 25 when 'silver' = any(p.badges) then 15
                                       when 'bronze' = any(p.badges) then 10 else 0 end
                                + case when 'comeback' = any(p.badges) then 10 else 0 end,
            'Game: ' || left(v.title, 150))
    from live.game_players p join live.users u on u.id = p.user_id
   where p.game_id = p_game and u.role = 'student';
end$$;

-- A player's place. Survival: still in beats out, and later out beats earlier out.
create or replace function live_app.game_rank(p_game live.game_sessions, p_player live.game_players) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) + 1 from live.game_players p
   where p.game_id = p_game.id and p.id <> p_player.id
     and case when live_app.game_mode(p_game) = 'survival' then
            (p.out_at is null and p_player.out_at is not null)
            or ((p.out_at is null) = (p_player.out_at is null)
                and (coalesce(p.out_at, 'infinity') > coalesce(p_player.out_at, 'infinity')
                     or (coalesce(p.out_at, 'infinity') = coalesce(p_player.out_at, 'infinity')
                         and (p.score > p_player.score or (p.score = p_player.score and p.correct_count > p_player.correct_count)))))
          else p.score > p_player.score or (p.score = p_player.score and p.correct_count > p_player.correct_count) end
$$;

create or replace function live.game_control(p_game uuid, p_action text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v live.game_sessions := live_app.require_game_host(p_game); v_total int;
begin
  v_total := coalesce(array_length(v.question_order, 1), 0);
  if live_app.game_mode(v) = 'self_paced' and p_action not in ('end','lock','unlock','extend') then
    raise exception 'Players go at their own pace in this game.' using errcode = 'P0001';
  end if;
  case p_action
    when 'start' then
      if v.status <> 'lobby' then raise exception 'The game has already started.' using errcode = 'P0001'; end if;
      perform live_app.open_question(v, 0);
    when 'close' then
      perform live_app.close_question(p_game);
    when 'next' then
      if v.status = 'question' then perform live_app.close_question(p_game); end if;
      if v.current_index + 1 >= v_total then perform live_app.finish_game(p_game);
      else perform live_app.open_question(v, v.current_index + 1); end if;
    when 'end' then
      perform live_app.finish_game(p_game);
    when 'lock' then
      update live.game_sessions set settings = settings || '{"locked": true}'::jsonb where id = p_game;
    when 'unlock' then
      update live.game_sessions set settings = settings || '{"locked": false}'::jsonb where id = p_game;
    when 'extend' then
      if v.status <> 'open' then raise exception 'Only an open self-paced game can be extended.' using errcode = 'P0001'; end if;
      update live.game_sessions set closes_at = least(greatest(closes_at, now()) + interval '1 day', now() + interval '60 days') where id = p_game;
    else raise exception 'Unknown action.' using errcode = '22023';
  end case;
  perform live_app.audit('game.' || p_action, 'game', p_game::text);
  select * into v from live.game_sessions where id = p_game;
  return jsonb_build_object('status', v.status, 'current_index', v.current_index, 'closes_at', v.closes_at,
                            'locked', coalesce((v.settings ->> 'locked')::boolean, false));
end$$;

-- Use a power-up on the current question (before answering it).
create or replace function live.game_use_powerup(p_game uuid, p_kind text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_game   live.game_sessions := live_app.game_tick(p_game);
  v_player live.game_players;
  v_index  int;
  v_q      live.questions;
  v_hide   uuid[];
begin
  if v_game.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  select * into v_player from live.game_players where game_id = p_game and user_id = auth.uid() for update;
  if v_player.id is null then raise exception 'Join the game first.' using errcode = '42501'; end if;
  if not coalesce((v_game.settings ->> 'powerups')::boolean, true) then raise exception 'Power-ups are off in this game.' using errcode = 'P0001'; end if;
  if p_kind is null or not (p_kind = any(v_player.powerups)) then raise exception 'You do not have that power-up.' using errcode = 'P0001'; end if;
  if v_player.active_powerup is not null then raise exception 'You already have a power-up running.' using errcode = 'P0001'; end if;
  if v_player.out_at is not null then raise exception 'You are out of lives.' using errcode = 'P0001'; end if;

  v_index := case when v_game.status = 'open' then v_player.q_index else v_game.current_index end;
  if not (v_game.status = 'question' or (v_game.status = 'open' and v_player.finished_at is null)) then
    raise exception 'Use power-ups while a question is open.' using errcode = 'P0001';
  end if;
  if exists (select 1 from live.game_answers where player_id = v_player.id and question_index = v_index) then
    raise exception 'You already answered this question.' using errcode = 'P0001';
  end if;

  if p_kind = 'fifty' then
    select * into v_q from live.questions where id = v_game.question_order[v_index + 1];
    if v_q.kind not in ('mcq','multi_select') then raise exception '50:50 works on multiple-choice questions.' using errcode = 'P0001'; end if;
    select array_agg(id) into v_hide from (
      select o.id from live.question_options o where o.question_id = v_q.id and not o.is_correct
       order by md5(o.id::text || v_player.id::text)
       limit (select floor(count(*) / 2.0)::int from live.question_options o2 where o2.question_id = v_q.id and not o2.is_correct)) h;
    if coalesce(array_length(v_hide, 1), 0) = 0 then raise exception 'There are too few options to halve.' using errcode = 'P0001'; end if;
  end if;

  -- Spend one copy (a player may hold the same power-up twice).
  update live.game_players set
      powerups = coalesce((select array_agg(u.k order by u.i) from unnest(powerups) with ordinality u(k, i)
                            where u.i <> array_position(powerups, p_kind)), '{}'),
      active_powerup = p_kind,
      hidden_options = coalesce(v_hide, '{}'), hidden_for = case when v_hide is not null then v_index end
   where id = v_player.id;
  return jsonb_build_object('active', p_kind, 'hidden_options', coalesce(to_jsonb(v_hide), '[]'::jsonb));
end$$;

create or replace function live.game_answer(p_game uuid, p_index int, p_choice jsonb, p_client_elapsed_ms int default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_game     live.game_sessions;
  v_player   live.game_players;
  v_q        live.questions;
  v_grade    jsonb;
  v_correct  boolean;
  v_server   int;
  v_scored   int;
  v_dur      int;
  v_pts      jsonb;
  v_self     boolean;
  v_started  timestamptz;
  v_timeout  boolean := coalesce((p_choice ->> 'timeout')::boolean, false);
  v_power    text;
  v_double   int := 0;
  v_comeback int := 0;
  v_shield   boolean;
  v_n        int;
  v_rank     int;
  v_lives    int;
  v_out      boolean := false;
  v_earned   text;
  v_total    int;
begin
  select * into v_game from live.game_sessions where id = p_game;
  if v_game.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  select * into v_player from live.game_players where game_id = p_game and user_id = auth.uid() for update;
  if v_player.id is null then raise exception 'Join the game first.' using errcode = '42501'; end if;
  if v_player.out_at is not null then raise exception 'You are out of lives. Watch the rest and cheer your class on!' using errcode = 'P0001'; end if;
  v_self := live_app.game_mode(v_game) = 'self_paced';
  v_total := coalesce(array_length(v_game.question_order, 1), 0);

  if v_self then
    if v_game.status <> 'open' or now() > v_game.closes_at then raise exception 'This game has closed.' using errcode = 'P0001'; end if;
    if v_player.finished_at is not null or v_player.q_index >= v_total then raise exception 'You have finished this game.' using errcode = 'P0001'; end if;
    if p_index <> v_player.q_index then raise exception 'The answer window is closed.' using errcode = 'P0001'; end if;
    v_started := coalesce(v_player.q_started_at, now());
    -- Past the time limit: it counts as no answer.
    if (v_game.settings ->> 'question_seconds')::int > 0
       and now() > v_started + make_interval(secs => (v_game.settings ->> 'question_seconds')::int) + interval '1500 milliseconds' then
      v_timeout := true;
    end if;
  else
    if v_game.status <> 'question' or v_game.current_index <> p_index
       or now() > v_game.question_ends_at + interval '1500 milliseconds' then
      raise exception 'The answer window is closed.' using errcode = 'P0001';
    end if;
    v_started := v_game.question_started_at;
  end if;
  if exists (select 1 from live.game_answers where player_id = v_player.id and question_index = p_index) then
    raise exception 'You already answered this question.' using errcode = 'P0001';
  end if;

  select * into v_q from live.questions where id = v_game.question_order[p_index + 1];
  if v_timeout then
    v_correct := false;
  else
    v_grade := live_app.grade_response(v_q, p_choice);
    v_correct := coalesce((v_grade ->> 'is_correct')::boolean, false);
  end if;
  v_server := greatest(0, (extract(epoch from (now() - v_started)) * 1000)::int);
  v_scored := live_app.normalize_elapsed(v_server, p_client_elapsed_ms);
  v_dur := (v_game.settings ->> 'question_seconds')::int * 1000;
  v_pts := live_app.game_points(v_correct, v_q.points, (v_game.settings ->> 'speed_bonus')::boolean,
                           (v_game.settings ->> 'streak_bonus')::boolean, v_scored, v_dur, v_player.streak);

  v_power := v_player.active_powerup;
  v_shield := coalesce(v_power = 'shield', false) and not v_correct;
  if v_power = 'double' and v_correct then
    v_double := (v_pts ->> 'base')::int + (v_pts ->> 'speed')::int + (v_pts ->> 'streak')::int;
  end if;
  -- Comeback: a right answer from the bottom half of a board of four or more.
  if v_correct and coalesce((v_game.settings ->> 'comeback')::boolean, true) then
    select count(*) into v_n from live.game_players where game_id = p_game;
    v_rank := live_app.game_rank(v_game, v_player);
    if v_n >= 4 and v_rank > ceil(v_n / 2.0) then v_comeback := least(250, round((v_pts ->> 'base')::int * 0.25)::int); end if;
  end if;

  insert into live.game_answers (tenant_id, game_id, player_id, question_id, question_index, choice, is_correct,
                                   base_points, speed_bonus, streak_bonus, server_elapsed_ms, scored_elapsed_ms,
                                   powerup, powerup_bonus, comeback_bonus)
    values (v_game.tenant_id, p_game, v_player.id, v_q.id, p_index, p_choice, v_correct,
            (v_pts ->> 'base')::int, (v_pts ->> 'speed')::int, (v_pts ->> 'streak')::int, v_server, v_scored,
            v_power, v_double, v_comeback);

  v_lives := v_player.lives;
  if live_app.game_mode(v_game) = 'survival' and not v_correct and not v_shield then
    v_lives := greatest(coalesce(v_lives, 1) - 1, 0);
    v_out := v_lives = 0;
  end if;

  update live.game_players set
    score = score + (v_pts ->> 'base')::int + (v_pts ->> 'speed')::int + (v_pts ->> 'streak')::int + v_double + v_comeback,
    correct_count = correct_count + case when v_correct then 1 else 0 end,
    streak = case when v_correct then streak + 1 when v_shield then streak else 0 end,
    best_streak = greatest(best_streak, case when v_correct then streak + 1 else 0 end),
    lives = v_lives,
    out_at = case when v_out then now() else out_at end,
    active_powerup = null,
    hidden_options = '{}', hidden_for = null,
    q_index = case when v_self then q_index + 1 else q_index end,
    q_started_at = case when v_self then null else q_started_at end,
    finished_at = case when v_self and (v_out or q_index + 1 >= v_total) then now() else finished_at end
  where id = v_player.id;

  -- Suspicious-pattern logging (never auto-penalised).
  if v_server < 400 and not v_timeout then
    insert into live.game_flags (tenant_id, game_id, player_id, kind, detail)
      values (v_game.tenant_id, p_game, v_player.id, 'answer_too_fast', jsonb_build_object('index', p_index, 'server_ms', v_server));
  end if;
  if p_client_elapsed_ms is not null and abs(p_client_elapsed_ms - v_server) > 5000 then
    insert into live.game_flags (tenant_id, game_id, player_id, kind, detail)
      values (v_game.tenant_id, p_game, v_player.id, 'clock_mismatch',
              jsonb_build_object('index', p_index, 'server_ms', v_server, 'client_ms', p_client_elapsed_ms));
  end if;

  if v_self then
    -- At your own pace you see how you did straight away.
    if v_correct and coalesce((v_game.settings ->> 'powerups')::boolean, true) then v_earned := live_app.maybe_powerup(v_player.id, p_index); end if;
    if (select finished_at from live.game_players where id = v_player.id) is not null then
      perform live_app.give_xp(v_player.tenant_id, v_player.user_id, v_game.class_id, 'game_result', p_game,
                               (select correct_count from live.game_players where id = v_player.id) * 5, 'Game: ' || left(v_game.title, 150))
        where exists (select 1 from live.users u where u.id = v_player.user_id and u.role = 'student');
    end if;
    return jsonb_build_object('accepted', true, 'is_correct', v_correct, 'timeout', v_timeout,
      'points', (v_pts ->> 'base')::int + (v_pts ->> 'speed')::int + (v_pts ->> 'streak')::int + v_double + v_comeback,
      'comeback', v_comeback, 'double', v_double, 'shielded', v_shield, 'lives', v_lives, 'out', v_out, 'earned', v_earned,
      'review', live_app.reveal_answer(v_q));
  end if;

  -- Everyone still in when the question opened has answered? Close early.
  if (select count(*) from live.game_answers a join live.game_players p on p.id = a.player_id
       where a.game_id = p_game and a.question_index = p_index and (p.out_at is null or p.out_at >= v_game.question_started_at))
     >= (select count(*) from live.game_players p where p.game_id = p_game and (p.out_at is null or p.out_at >= v_game.question_started_at)) then
    perform live_app.close_question(p_game);
  end if;
  return jsonb_build_object('accepted', true);
end$$;

-- ---------------------------------------------------------------------------
-- 6. What the screens see
-- ---------------------------------------------------------------------------
create or replace function live_app.game_teams_board(p_game live.game_sessions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(t order by (t ->> 'score')::int desc, t ->> 'name'), '[]'::jsonb) from (
    select jsonb_build_object('team_id', tm.id, 'name', tm.name, 'color', tm.color,
             -- Average per player, so team size never decides the winner.
             'score', coalesce((select round(avg(p.score))::int from live.game_players p where p.team_id = tm.id), 0),
             'total', coalesce((select sum(p.score)::int from live.game_players p where p.team_id = tm.id), 0),
             'members', (select count(*) from live.game_players p where p.team_id = tm.id)) as t
      from live.game_teams tm where tm.game_id = p_game.id) x
$$;

create or replace function live.game_leaderboard(p_game uuid, p_limit int default 10) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_game    live.game_sessions := live_app.game_tick(p_game);
  v_host    boolean;
  v_vis     text;
  v_show    boolean;
  v_me      live.game_players;
begin
  if v_game.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  v_host := live_app.can_host_game(v_game.class_id, v_game.host_id);
  if not v_host and not live_app.game_can_play(v_game) then raise exception 'Not your game.' using errcode = '42501'; end if;

  v_vis := v_game.settings ->> 'rank_visibility';
  v_show := v_host or (v_vis = 'after_each' and v_game.status in ('review','ended','open'))
                   or (v_vis = 'end_only' and v_game.status = 'ended');
  select * into v_me from live.game_players where game_id = p_game and user_id = auth.uid();

  return jsonb_build_object(
    'visible', v_show,
    'status', v_game.status,
    'mode', live_app.game_mode(v_game),
    'players', (select count(*) from live.game_players where game_id = p_game),
    'top', case when v_show then (
      select coalesce(jsonb_agg(row order by (row ->> 'rank')::int, row ->> 'name'), '[]'::jsonb) from (
        select jsonb_build_object('rank', live_app.game_rank(v_game, p),
               'player_id', p.id, 'key', live_app.board_key(p_game, p.user_id), 'avatar', p.avatar,
               'name', case when v_host then p.display_name || case when v_game.settings ->> 'display_mode' <> 'first_name_initial'
                                                                  then ' (' || u.full_name || ')' else '' end
                            else p.display_name end,
               'guest', u.role = 'guest',
               'score', p.score, 'correct', p.correct_count, 'streak', p.best_streak, 'badges', p.badges,
               'team_id', p.team_id, 'lives', p.lives, 'out', p.out_at is not null,
               'progress', case when v_game.status = 'open' then p.q_index end) as row
        from live.game_players p join live.users u on u.id = p.user_id
        where p.game_id = p_game
        order by live_app.game_rank(v_game, p) limit greatest(p_limit, 1)) s) else '[]'::jsonb end,
    'teams', case when (v_game.settings ->> 'team_mode')::boolean and v_show then live_app.game_teams_board(v_game) end,
    -- Players always see their own position, even when the board is hidden.
    'me', case when v_me.id is null then null else jsonb_build_object(
      'player_id', v_me.id, 'key', live_app.board_key(p_game, v_me.user_id), 'name', v_me.display_name, 'avatar', v_me.avatar,
      'score', v_me.score, 'streak', v_me.streak, 'correct', v_me.correct_count, 'badges', v_me.badges,
      'lives', v_me.lives, 'out', v_me.out_at is not null, 'rank', live_app.game_rank(v_game, v_me)) end);
end$$;

-- Everything a player or host screen needs, in one round trip.
create or replace function live.game_state(p_game uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_game   live.game_sessions := live_app.game_tick(p_game);
  v_host   boolean;
  v_q      live.questions;
  v_player live.game_players;
  v_answer live.game_answers;
  v_out    jsonb;
  v_mode   text;
  v_index  int;
  v_pub    jsonb;
  v_total  int;
  v_show   boolean;
begin
  if v_game.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  v_host := live_app.can_host_game(v_game.class_id, v_game.host_id);
  if not v_host and not live_app.game_can_play(v_game) then raise exception 'Not your game.' using errcode = '42501'; end if;
  v_mode := live_app.game_mode(v_game);
  v_total := coalesce(array_length(v_game.question_order, 1), 0);
  v_show := v_host or v_game.settings ->> 'rank_visibility' <> 'hidden';

  v_out := jsonb_build_object(
    'id', v_game.id, 'title', v_game.title, 'status', v_game.status, 'join_code', v_game.join_code, 'mode', v_mode,
    'current_index', v_game.current_index, 'total', v_total,
    'question_started_at', v_game.question_started_at, 'question_ends_at', v_game.question_ends_at, 'closes_at', v_game.closes_at,
    'server_now', now(), 'settings', v_game.settings, 'is_host', v_host,
    'players', (select count(*) from live.game_players where game_id = p_game),
    'alive', case when v_mode = 'survival' then (select count(*) from live.game_players where game_id = p_game and out_at is null) end,
    'teams', case when (v_game.settings ->> 'team_mode')::boolean and v_show then live_app.game_teams_board(v_game) end,
    -- The race track: every right answer is a step (the top 40 runners).
    'race', case when v_mode = 'race' and v_show and v_game.status <> 'lobby' then (
      select coalesce(jsonb_agg(jsonb_build_object('key', live_app.board_key(p_game, r.user_id), 'name', r.display_name, 'avatar', r.avatar,
                                                   'steps', r.correct_count, 'team_id', r.team_id) order by r.correct_count desc, r.score desc), '[]'::jsonb)
        from (select * from live.game_players where game_id = p_game order by correct_count desc, score desc limit 40) r) end);

  select * into v_player from live.game_players where game_id = p_game and user_id = auth.uid();
  v_index := case when v_mode = 'self_paced' then coalesce(v_player.q_index, 0) else v_game.current_index end;

  if (v_game.status in ('question','review') and v_index >= 0)
     or (v_game.status = 'open' and v_player.id is not null and v_player.finished_at is null and v_index < v_total) then
    select * into v_q from live.questions where id = v_game.question_order[v_index + 1];
    v_pub := live_app.sanitize_question(v_q, ('x' || left(md5(v_game.id::text), 8))::bit(32)::int, (v_game.settings ->> 'shuffle_options')::boolean);
    if v_player.id is not null and v_player.hidden_for = v_index and coalesce(array_length(v_player.hidden_options, 1), 0) > 0 then
      v_pub := jsonb_set(v_pub, '{options}', (select coalesce(jsonb_agg(o), '[]'::jsonb) from jsonb_array_elements(v_pub -> 'options') o
                                              where not ((o ->> 'id')::uuid = any(v_player.hidden_options))));
    end if;
    v_out := v_out || jsonb_build_object('question', v_pub, 'question_index', v_index);
    if v_mode = 'self_paced' then
      -- Your own clock starts when you first see the question.
      if v_player.q_started_at is null then
        update live.game_players set q_started_at = now() where id = v_player.id returning * into v_player;
      end if;
      v_out := v_out || jsonb_build_object('question_started_at', v_player.q_started_at,
        'question_ends_at', case when (v_game.settings ->> 'question_seconds')::int > 0
                                 then v_player.q_started_at + make_interval(secs => (v_game.settings ->> 'question_seconds')::int) end);
    else
      v_out := v_out || jsonb_build_object('answered',
        (select count(*) from live.game_answers where game_id = p_game and question_index = v_game.current_index));
    end if;
    if v_game.status = 'review' then
      v_out := v_out || jsonb_build_object('review', live_app.reveal_answer(v_q) || jsonb_build_object(
        'distribution', (select coalesce(jsonb_object_agg(o.id, (select count(*) from live.game_answers a
                           where a.game_id = p_game and a.question_index = v_game.current_index
                             and (a.choice ->> 'option_id' = o.id::text or a.choice -> 'option_ids' ? o.id::text))), '{}'::jsonb)
                         from live.question_options o where o.question_id = v_q.id),
        'right', (select count(*) from live.game_answers a where a.game_id = p_game and a.question_index = v_game.current_index and a.is_correct)));
    end if;
  end if;

  if v_host then
    v_out := v_out || jsonb_build_object(
      'roster', (select coalesce(jsonb_agg(jsonb_build_object('player_id', p.id, 'name', p.display_name, 'avatar', p.avatar,
                   'full_name', u.full_name, 'guest', u.role = 'guest', 'team_id', p.team_id, 'lives', p.lives, 'out', p.out_at is not null,
                   'progress', p.q_index, 'finished', p.finished_at is not null, 'score', p.score,
                   'answered', exists (select 1 from live.game_answers a where a.player_id = p.id and a.question_index = v_game.current_index))
                   order by p.joined_at), '[]'::jsonb)
                 from live.game_players p join live.users u on u.id = p.user_id where p.game_id = p_game),
      'flags', (select count(*) from live.game_flags where game_id = p_game));
  elsif v_player.id is not null then
    select * into v_answer from live.game_answers where player_id = v_player.id and question_index = v_index;
    v_out := v_out || jsonb_build_object('me', jsonb_build_object(
      'player_id', v_player.id, 'key', live_app.board_key(p_game, v_player.user_id), 'name', v_player.display_name, 'avatar', v_player.avatar,
      'score', v_player.score, 'streak', v_player.streak, 'correct', v_player.correct_count,
      'answered', v_answer.id is not null,
      'lives', v_player.lives, 'out', v_player.out_at is not null,
      'powerups', to_jsonb(v_player.powerups), 'active_powerup', v_player.active_powerup,
      'earned', case when v_player.earned_for = v_game.current_index and v_game.status = 'review' then v_player.earned_powerup end,
      'progress', v_player.q_index, 'finished', v_player.finished_at is not null,
      'rank', live_app.game_rank(v_game, v_player),
      'last', case when v_answer.id is not null and v_game.status in ('review','ended') then jsonb_build_object(
                'is_correct', v_answer.is_correct,
                'points', v_answer.base_points + v_answer.speed_bonus + v_answer.streak_bonus + v_answer.powerup_bonus + v_answer.comeback_bonus,
                'comeback', v_answer.comeback_bonus, 'double', v_answer.powerup_bonus, 'powerup', v_answer.powerup) end));
  end if;
  return v_out;
end$$;

create or replace function live.game_goal(p_game uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v live.game_sessions; v_players int; v_asked int; v_correct int;
begin
  select * into v from live.game_sessions where id = p_game;
  if v.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if not live_app.can_host_game(v.class_id, v.host_id) and not live_app.game_can_play(v) then raise exception 'Not your game.' using errcode = '42501'; end if;
  select count(*) into v_players from live.game_players where game_id = p_game;
  v_asked := greatest(v.current_index + 1, 0);
  select count(*) into v_correct from live.game_answers where game_id = p_game and is_correct;
  return jsonb_build_object('enabled', coalesce((v.settings ->> 'class_goal')::boolean, false),
    'correct', v_correct,
    'target', ceil(v_players * coalesce(array_length(v.question_order, 1), 0) * (v.settings ->> 'goal_percent')::numeric / 100),
    'possible_so_far', v_players * v_asked,
    'goal_percent', (v.settings ->> 'goal_percent')::int);
end$$;

-- Guests of the lesson may also listen to its game's channel (same as can_listen in the engine otherwise).
create or replace function live_app.can_listen(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := split_part(p_topic, ':', 1); v_id uuid; v_user uuid;
begin
  begin
    v_id := nullif(split_part(p_topic, ':', 2), '')::uuid;
    v_user := nullif(split_part(p_topic, ':', 3), '')::uuid;
  exception when others then return false; end;
  if v_id is null or live_app.tenant_id() is null then return false; end if;
  return case v_kind
    when 'session' then live_app.in_session(v_id) or live_app.can_manage_session(v_id)
    when 'staff'   then live_app.can_manage_session(v_id)
    -- teachers watch; the student may join only their own channel (to send frames)
    when 'screen'  then live_app.can_manage_session(v_id) or (v_user = auth.uid() and live_app.in_session(v_id))
    when 'user'    then v_id = auth.uid()
    -- parent threads: only the parent and the teacher (never the child, nor other staff)
    when 'thread'  then exists (select 1 from live.chat_threads t where t.id = v_id and t.tenant_id = live_app.tenant_id()
                                and case when t.kind = 'parent' then auth.uid() in (t.parent_id, t.teacher_id)
                                         else (t.student_id = auth.uid() or t.teacher_id = auth.uid()
                                               or (t.kind = 'group' and live_app.in_session(t.session_id)) or live_app.can_manage_class(t.class_id)) end)
    -- boards and games: exactly the people who can read the row (mirrors their RLS policies)
    when 'board'   then exists (select 1 from live.collab_boards b where b.id = v_id and b.tenant_id = live_app.tenant_id()
                                and (b.owner_id = auth.uid()
                                     or (b.session_id is not null and (live_app.can_manage_session(b.session_id) or live_app.in_session(b.session_id)))
                                     or (b.session_id is null and live_app.is_teacher())))
    when 'game'    then exists (select 1 from live.game_sessions g where g.id = v_id and g.tenant_id = live_app.tenant_id()
                                and (live_app.can_host_game(g.class_id, g.host_id) or live_app.game_can_play(g)))
    when 'annot'   then live_app.in_session(v_id) or live_app.can_manage_session(v_id)
    else false end;
end$$;

-- The lesson leaderboard (same as the engine's 1160), with each row's opaque key.
create or replace function live_app.snapshot_leaderboard(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_board jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('key', live_app.board_key(p_session, r.user_id), 'name', r.name, 'avatar', r.avatar,
                                               'score', r.score, 'rank', r.rank,
                                               'delta', coalesce(r.last_rank, r.rank) - r.rank) order by r.rank, r.name), '[]'::jsonb)
    into v_board
    from (select * from live_app.session_ranks(p_session) order by rank, name limit 500) r;
  update live.session_participants p set last_rank = r.rank
    from live_app.session_ranks(p_session) r where p.session_id = p_session and p.user_id = r.user_id;
  update live.class_sessions set show_leaderboard = true, leaderboard = jsonb_build_object('at', now(), 'top', v_board)
   where id = p_session;
  return v_board;
end$$;

-- My key on a lesson's leaderboard (the board itself is one snapshot shared by the class).
create or replace function live.my_board_key(p_session uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when live_app.in_session(p_session) or live_app.can_manage_session(p_session)
              then live_app.board_key(p_session, auth.uid()) end
$$;

-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------
revoke execute on function live_app.critters(), live_app.critter_xp(text), live_app.student_xp(uuid), live_app.can_use_character(uuid, text),
  live_app.on_xp_characters(), live_app.game_mode(live.game_sessions), live_app.game_can_play(live.game_sessions), live_app.board_key(uuid, uuid),
  live_app.game_kind(text), live_app.game_tick(uuid), live_app.maybe_powerup(uuid, int), live_app.game_rank(live.game_sessions, live.game_players),
  live_app.game_teams_board(live.game_sessions), live_app.snapshot_leaderboard(uuid, int), live_app.snapshot_leaderboard(uuid),
  live_app.close_question(uuid), live_app.finish_game(uuid), live_app.game_xp()
  from public, anon, authenticated;
revoke execute on function live.my_characters(), live.choose_character(text), live.set_avatar(uuid, text), live.join_game_by_id(uuid, text),
  live.game_use_powerup(uuid, text), live.my_board_key(uuid), live.create_game(uuid, uuid, jsonb, uuid, text), live.join_game(text, text),
  live.game_control(uuid, text), live.game_answer(uuid, int, jsonb, int), live.game_leaderboard(uuid, int), live.game_state(uuid), live.game_goal(uuid)
  from public, anon;
grant execute on function live.my_characters(), live.choose_character(text), live.set_avatar(uuid, text), live.join_game_by_id(uuid, text),
  live.game_use_powerup(uuid, text), live.my_board_key(uuid), live.create_game(uuid, uuid, jsonb, uuid, text), live.join_game(text, text),
  live.game_control(uuid, text), live.game_answer(uuid, int, jsonb, int), live.game_leaderboard(uuid, int), live.game_state(uuid), live.game_goal(uuid)
  to authenticated;
grant select on live.student_characters to authenticated;
grant execute on function live_app.can_host_game(uuid, uuid) to authenticated;
