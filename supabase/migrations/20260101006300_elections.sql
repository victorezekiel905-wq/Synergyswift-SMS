-- =========================================================================
-- Synergy Swift: elections and voting (Phase 14f).
--  * elections: prefects, PTA, class reps, houses, staff or anything else, for
--    students, parents, staff or everyone (optionally only some classes), with
--    a voting window, one vote per family (PTA) option, a teacher-run kiosk,
--    live results for the election officers, and results published to voters.
--  * election_posts: the offices (Head girl, 2 seats …); election_candidates.
--  * The SECRET BALLOT: election_voters records THAT someone voted (and how:
--    online or at a kiosk); election_ballots + election_votes record WHAT was
--    chosen, with a random ballot id, no voter, no time. Nothing links them,
--    so not even school admins can see how anyone voted. Each voter gets a
--    receipt code to check their ballot was counted.
--  * Votes are cast only through cast_ballot() / cast_ballot_kiosk(), which
--    check eligibility, the window, the number of choices and "one vote".
-- Idempotent.
-- =========================================================================

create table if not exists public.elections (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  title                  text not null check (length(btrim(title)) between 2 and 160),
  kind                   text not null default 'prefects' check (kind in ('prefects','pta','class_rep','house','staff','other')),
  description            text,
  audience               text not null default 'students' check (audience in ('students','parents','staff','everyone')),
  class_group_ids        uuid[],                       -- null = the whole school
  one_per_family         boolean not null default false, -- parents: one vote for each family
  allow_kiosk            boolean not null default true,  -- teachers can run a voting tablet for their class
  live_results           boolean not null default false, -- officers see counts while voting is open
  publish_to_voters      boolean not null default true,
  status                 text not null default 'draft' check (status in ('draft','open','closed','published')),
  opens_at               timestamptz,
  closes_at              timestamptz,
  created_by             uuid references public.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint elections_window check (closes_at is null or opens_at is null or closes_at > opens_at)
);
create index if not exists elections_tenant on public.elections(tenant_id, created_at desc);

create table if not exists public.election_posts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  election_id  uuid not null references public.elections(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 120),
  description  text,
  seats        int not null default 1 check (seats between 1 and 50),
  position     int not null default 0
);
create index if not exists election_posts_election on public.election_posts(election_id, position);

create table if not exists public.election_candidates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  election_id  uuid not null references public.elections(id) on delete cascade,
  post_id      uuid not null references public.election_posts(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  student_id   uuid references public.students(id) on delete set null,
  user_id      uuid references public.users(id) on delete set null,
  photo_url    text,
  manifesto    text check (length(manifesto) <= 4000),
  position     int not null default 0
);
create index if not exists election_candidates_post on public.election_candidates(post_id, position);

-- Who voted (never what). voter_key: 'user:<id>', 'student:<id>' (kiosk or online) or 'family:<student id>'.
create table if not exists public.election_voters (
  election_id  uuid not null references public.elections(id) on delete cascade,
  voter_key    text not null,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid references public.users(id) on delete set null,   -- who was signed in (the voter, or the kiosk teacher)
  student_id   uuid references public.students(id) on delete set null,
  channel      text not null check (channel in ('online','kiosk')),
  voted_at     timestamptz not null default now(),
  primary key (election_id, voter_key)
);

-- What was chosen (never who). No voter, no time.
create table if not exists public.election_ballots (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  election_id   uuid not null references public.elections(id) on delete cascade,
  receipt_hash  text not null unique
);
create table if not exists public.election_votes (
  ballot_id     uuid not null references public.election_ballots(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  election_id   uuid not null references public.elections(id) on delete cascade,
  post_id       uuid not null references public.election_posts(id) on delete cascade,
  candidate_id  uuid not null references public.election_candidates(id) on delete cascade,
  primary key (ballot_id, candidate_id)
);
create index if not exists election_votes_count on public.election_votes(election_id, candidate_id);

-- ---------- Helpers ----------
create or replace function public.is_election_officer()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin()
$$;

-- Where an election is: draft, scheduled (open but before its start), voting, closed or published.
create or replace function public.election_phase(e public.elections)
returns text language sql stable set search_path = public as $$
  select case
    when e.status = 'draft' then 'draft'
    when e.status = 'published' then 'published'
    when e.status = 'closed' or (e.closes_at is not null and now() >= e.closes_at) then 'closed'
    when e.opens_at is not null and now() < e.opens_at then 'scheduled'
    else 'voting' end
$$;

-- Is this student in the election's classes (active students only)?
create or replace function public.election_student_ok(e public.elections, p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s where s.id = p_student and s.tenant_id = e.tenant_id and s.status = 'active'
                   and (e.class_group_ids is null or s.class_group_id = any(e.class_group_ids)))
$$;

-- The signed-in person's vote key for an election, or null when they may not vote in it.
create or replace function public.election_voter_key(p_election uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare e public.elections; u public.users; v_student uuid; v_family uuid;
begin
  select * into e from public.elections where id = p_election;
  select * into u from public.users where id = auth.uid();
  if e.id is null or u.id is null or u.tenant_id <> e.tenant_id then return null; end if;
  if e.audience in ('students','everyone') and u.role = 'student' then
    select s.id into v_student from public.students s where s.user_id = u.id and s.tenant_id = e.tenant_id limit 1;
    if v_student is not null and public.election_student_ok(e, v_student) then return 'student:' || v_student; end if;
    return null;
  end if;
  if e.audience in ('parents','everyone') and (u.role = 'parent' or exists (select 1 from public.guardians g where g.user_id = u.id)) then
    -- A parent of an active child in the election's classes; for one vote per family, the family is the eldest such child's record.
    select min(s.id::text)::uuid into v_family
      from public.guardians g join public.student_guardians sg on sg.guardian_id = g.id join public.students s on s.id = sg.student_id
     where g.user_id = u.id and g.tenant_id = e.tenant_id and public.election_student_ok(e, s.id);
    if v_family is not null then
      return case when e.one_per_family then 'family:' || v_family else 'user:' || u.id end;
    end if;
    if u.role = 'parent' then return null; end if;
  end if;
  if e.audience in ('staff','everyone') and u.role not in ('student','parent','alumni') then return 'user:' || u.id; end if;
  return null;
end $$;

-- Records one ballot: the voter row (who) and the ballot with its votes (what), unlinked.
-- p_choices: {"<post id>": ["<candidate id>", ...], ...}; a post left out is an abstention.
create or replace function public.election_record(e public.elections, p_key text, p_choices jsonb, p_channel text, p_student uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_ballot uuid; v_receipt text := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12)); r record; v_n int; v_ok int;
begin
  if public.election_phase(e) <> 'voting' then raise exception 'Voting is not open for this election.' using errcode = 'P0001'; end if;
  if p_choices is null or jsonb_typeof(p_choices) <> 'object' then raise exception 'Choose your candidates.' using errcode = '22023'; end if;
  for r in select key, value from jsonb_each(p_choices) loop
    if jsonb_typeof(r.value) <> 'array' then raise exception 'Choose your candidates.' using errcode = '22023'; end if;
    if not exists (select 1 from public.election_posts p where p.id::text = r.key and p.election_id = e.id) then
      raise exception 'That post is not in this election.' using errcode = '22023';
    end if;
    select count(*), count(*) filter (where exists (select 1 from public.election_candidates c where c.id::text = x and c.post_id::text = r.key))
      into v_n, v_ok from jsonb_array_elements_text(r.value) x;
    if v_n <> v_ok then raise exception 'A choice is not a candidate for that post.' using errcode = '22023'; end if;
    if v_n > (select seats from public.election_posts where id::text = r.key) then
      raise exception 'Too many choices for one post.' using errcode = '22023';
    end if;
    if v_n <> (select count(distinct x) from jsonb_array_elements_text(r.value) x) then raise exception 'The same candidate twice.' using errcode = '22023'; end if;
  end loop;
  begin
    insert into public.election_voters (election_id, voter_key, tenant_id, user_id, student_id, channel)
      values (e.id, p_key, e.tenant_id, auth.uid(), p_student, p_channel);
  exception when unique_violation then
    raise exception 'This vote has already been cast.' using errcode = 'P0001';
  end;
  insert into public.election_ballots (tenant_id, election_id, receipt_hash)
    values (e.tenant_id, e.id, encode(sha256(convert_to('ballot:' || v_receipt, 'UTF8')), 'hex')) returning id into v_ballot;
  insert into public.election_votes (ballot_id, tenant_id, election_id, post_id, candidate_id)
    select v_ballot, e.tenant_id, e.id, ch.key::uuid, x::uuid from jsonb_each(p_choices) ch, jsonb_array_elements_text(ch.value) x;
  return v_receipt;
end $$;

-- Online vote by the signed-in student, parent or member of staff. Returns the receipt code.
create or replace function public.cast_ballot(p_election uuid, p_choices jsonb)
returns text language plpgsql volatile security definer set search_path = public as $$
declare e public.elections; v_key text;
begin
  select * into e from public.elections where id = p_election and tenant_id = public.my_tenant_id();
  if e.id is null then raise exception 'Election not found.' using errcode = 'P0002'; end if;
  v_key := public.election_voter_key(p_election);
  if v_key is null then raise exception 'You are not on the voters'' list for this election.' using errcode = '42501'; end if;
  return public.election_record(e, v_key, p_choices, 'online', case when v_key like 'student:%' then substr(v_key, 9)::uuid end);
end $$;

-- A teacher's voting tablet: the student votes on the teacher's device (the teacher never sees the choices).
create or replace function public.cast_ballot_kiosk(p_election uuid, p_student uuid, p_choices jsonb)
returns text language plpgsql volatile security definer set search_path = public as $$
declare e public.elections; s public.students;
begin
  select * into e from public.elections where id = p_election and tenant_id = public.my_tenant_id();
  if e.id is null then raise exception 'Election not found.' using errcode = 'P0002'; end if;
  if not e.allow_kiosk or e.audience not in ('students','everyone') then raise exception 'This election does not use voting tablets.' using errcode = 'P0001'; end if;
  select * into s from public.students where id = p_student and tenant_id = e.tenant_id;
  if s.id is null or not public.election_student_ok(e, s.id) then raise exception 'That student is not on the voters'' list.' using errcode = '42501'; end if;
  if not (public.is_election_officer() or public.teaches_class(s.class_group_id)) then
    raise exception 'Only the student''s teachers can run a voting tablet for them.' using errcode = '42501';
  end if;
  return public.election_record(e, 'student:' || s.id, p_choices, 'kiosk', s.id);
end $$;

-- How many may vote and how many have (by channel and class). Officers only.
create or replace function public.election_turnout(p_election uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e public.elections; v_students int := 0; v_parents int := 0; v_staff int := 0;
begin
  select * into e from public.elections where id = p_election and tenant_id = public.my_tenant_id();
  if e.id is null or not public.is_election_officer() then raise exception 'not allowed' using errcode = '42501'; end if;
  if e.audience in ('students','everyone') then
    select count(*) into v_students from public.students s where s.tenant_id = e.tenant_id and public.election_student_ok(e, s.id);
  end if;
  if e.audience in ('parents','everyone') then
    select case when e.one_per_family then count(distinct fam) else count(distinct gid) end into v_parents from (
      select g.user_id as gid, (select min(s2.id::text) from public.student_guardians sg2 join public.students s2 on s2.id = sg2.student_id
                                 join public.guardians g2 on g2.id = sg2.guardian_id where g2.user_id = g.user_id and public.election_student_ok(e, s2.id)) as fam
        from public.guardians g join public.student_guardians sg on sg.guardian_id = g.id join public.students s on s.id = sg.student_id
       where g.tenant_id = e.tenant_id and g.user_id is not null and public.election_student_ok(e, s.id)) x;
  end if;
  if e.audience in ('staff','everyone') then
    select count(*) into v_staff from public.users u where u.tenant_id = e.tenant_id and u.role not in ('student','parent','alumni')
      and coalesce(u.active, true);
  end if;
  return jsonb_build_object(
    'eligible', v_students + v_parents + v_staff,
    'voted', (select count(*) from public.election_voters where election_id = e.id),
    'online', (select count(*) from public.election_voters where election_id = e.id and channel = 'online'),
    'kiosk', (select count(*) from public.election_voters where election_id = e.id and channel = 'kiosk'),
    'by_class', (select coalesce(jsonb_agg(jsonb_build_object('class', g.name, 'voted', x.n) order by g.name), '[]'::jsonb)
                   from (select s.class_group_id, count(*) n from public.election_voters v join public.students s on s.id = v.student_id
                          where v.election_id = e.id group by 1) x join public.class_groups g on g.id = x.class_group_id));
end $$;

-- Counts per candidate and the winners. Officers: once voting closes (or live, when allowed);
-- voters: once published (when the election publishes to voters).
create or replace function public.election_results(p_election uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e public.elections; v_phase text;
begin
  select * into e from public.elections where id = p_election and tenant_id = public.my_tenant_id();
  if e.id is null then raise exception 'Election not found.' using errcode = 'P0002'; end if;
  v_phase := public.election_phase(e);
  if not ((public.is_election_officer() and (v_phase in ('closed','published') or e.live_results))
          or (v_phase = 'published' and e.publish_to_voters and public.election_voter_key(p_election) is not null)) then
    raise exception 'Results are not available yet.' using errcode = '42501';
  end if;
  return jsonb_build_object('phase', v_phase, 'ballots', (select count(*) from public.election_ballots where election_id = e.id),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'seats', p.seats,
      'abstained', (select count(*) from public.election_ballots b where b.election_id = e.id
                     and not exists (select 1 from public.election_votes v where v.ballot_id = b.id and v.post_id = p.id)),
      -- rk: place (equal votes share a place); ge: candidates with at least as many votes. Elected when
      -- ge fits the seats; a tie on the line (ge > seats while placed inside them) is flagged for a decision.
      'candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'photo_url', c.photo_url, 'votes', c.votes, 'rank', c.rk,
                       'elected', c.votes > 0 and c.ge <= p.seats, 'tie', c.votes > 0 and c.rk <= p.seats and c.ge > p.seats) order by c.votes desc, c.name), '[]'::jsonb)
                     from (select c1.id, c1.name, c1.photo_url, c1.votes, rank() over (order by c1.votes desc) as rk, count(*) over (order by c1.votes desc) as ge
                             from (select c0.*, (select count(*) from public.election_votes v where v.candidate_id = c0.id) as votes
                                     from public.election_candidates c0 where c0.post_id = p.id) c1) c)) order by p.position, p.title), '[]'::jsonb)
      from public.election_posts p where p.election_id = e.id));
end $$;

-- "Was my ballot counted?" Anyone in the school with the receipt code.
create or replace function public.election_check_receipt(p_election uuid, p_receipt text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.election_ballots b join public.elections e on e.id = b.election_id
                  where b.election_id = p_election and e.tenant_id = public.my_tenant_id()
                    and b.receipt_hash = encode(sha256(convert_to('ballot:' || upper(btrim(p_receipt)), 'UTF8')), 'hex'))
$$;

-- Elections the signed-in person can vote in (or see results of), with whether they have voted.
create or replace function public.my_elections()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'kind', e.kind, 'description', e.description,
           'opens_at', e.opens_at, 'closes_at', e.closes_at, 'phase', public.election_phase(e),
           'voted', exists (select 1 from public.election_voters v where v.election_id = e.id and v.voter_key = public.election_voter_key(e.id)),
           'results', public.election_phase(e) = 'published' and e.publish_to_voters) order by e.closes_at nulls last), '[]'::jsonb)
    from public.elections e
   where e.tenant_id = public.my_tenant_id() and e.status <> 'draft'
     and (e.closes_at is null or e.closes_at > now() - interval '60 days')
     and public.election_voter_key(e.id) is not null
$$;

-- For a teacher's voting tablet: which of their class's students have voted (any way), never how.
create or replace function public.election_class_voted(p_election uuid, p_class uuid)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.elections where id = p_election and tenant_id = public.my_tenant_id())
     or not (public.is_election_officer() or public.teaches_class(p_class)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select array_agg(v.student_id) from public.election_voters v join public.students s on s.id = v.student_id
                    where v.election_id = p_election and s.class_group_id = p_class), '{}');
end $$;

-- ---------- RLS ----------
alter table public.elections enable row level security;
alter table public.election_posts enable row level security;
alter table public.election_candidates enable row level security;
alter table public.election_voters enable row level security;
alter table public.election_ballots enable row level security;
alter table public.election_votes enable row level security;

drop policy if exists elections_officers on public.elections;
create policy elections_officers on public.elections for all
  using (tenant_id = public.my_tenant_id() and public.is_election_officer())
  with check (tenant_id = public.my_tenant_id() and public.is_election_officer());
drop policy if exists elections_voters on public.elections;
create policy elections_voters on public.elections for select
  using (tenant_id = public.my_tenant_id() and status <> 'draft' and (public.election_voter_key(id) is not null or public.is_staff()));
drop policy if exists election_posts_officers on public.election_posts;
create policy election_posts_officers on public.election_posts for all
  using (tenant_id = public.my_tenant_id() and public.is_election_officer())
  with check (tenant_id = public.my_tenant_id() and public.is_election_officer()
              and exists (select 1 from public.elections e where e.id = election_id and e.tenant_id = public.my_tenant_id()));
drop policy if exists election_posts_read on public.election_posts;
create policy election_posts_read on public.election_posts for select
  using (tenant_id = public.my_tenant_id() and exists (select 1 from public.elections e where e.id = election_id));
drop policy if exists election_candidates_officers on public.election_candidates;
create policy election_candidates_officers on public.election_candidates for all
  using (tenant_id = public.my_tenant_id() and public.is_election_officer())
  with check (tenant_id = public.my_tenant_id() and public.is_election_officer()
              and exists (select 1 from public.election_posts p where p.id = post_id and p.election_id = election_candidates.election_id and p.tenant_id = public.my_tenant_id()));
drop policy if exists election_candidates_read on public.election_candidates;
create policy election_candidates_read on public.election_candidates for select
  using (tenant_id = public.my_tenant_id() and exists (select 1 from public.elections e where e.id = election_id));
-- Who voted: officers (turnout) and each voter's own row. Never written directly.
drop policy if exists election_voters_read on public.election_voters;
create policy election_voters_read on public.election_voters for select
  using (tenant_id = public.my_tenant_id() and (public.is_election_officer() or user_id = auth.uid()));
-- Ballots and votes: no policies at all. Only the counting functions read them.
revoke all on public.election_ballots, public.election_votes from anon, authenticated;
revoke insert, update, delete on public.election_voters from anon, authenticated;
grant select, insert, update, delete on public.elections, public.election_posts, public.election_candidates to authenticated;
grant select on public.election_voters to authenticated;

-- Candidates and posts can't change once voting has started (the ballot paper is fixed).
create or replace function public.election_paper_fixed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.elections where id = coalesce(new.election_id, old.election_id);
  if v_status is not null and v_status <> 'draft' and exists (select 1 from public.election_voters where election_id = coalesce(new.election_id, old.election_id)) then
    raise exception 'Votes have been cast; the ballot paper can no longer change.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists election_posts_fixed on public.election_posts;
create trigger election_posts_fixed before insert or update or delete on public.election_posts for each row execute function public.election_paper_fixed();
drop trigger if exists election_candidates_fixed on public.election_candidates;
create trigger election_candidates_fixed before insert or update or delete on public.election_candidates for each row execute function public.election_paper_fixed();

revoke all on function public.is_election_officer(), public.election_phase(public.elections), public.election_student_ok(public.elections, uuid),
  public.election_voter_key(uuid), public.election_record(public.elections, text, jsonb, text, uuid), public.cast_ballot(uuid, jsonb),
  public.cast_ballot_kiosk(uuid, uuid, jsonb), public.election_turnout(uuid), public.election_results(uuid), public.election_check_receipt(uuid, text),
  public.my_elections(), public.election_paper_fixed(), public.election_class_voted(uuid, uuid) from public, anon;
revoke all on function public.election_record(public.elections, text, jsonb, text, uuid), public.election_paper_fixed() from authenticated;
grant execute on function public.is_election_officer(), public.election_phase(public.elections), public.election_student_ok(public.elections, uuid),
  public.election_voter_key(uuid), public.cast_ballot(uuid, jsonb), public.cast_ballot_kiosk(uuid, uuid, jsonb), public.election_turnout(uuid),
  public.election_results(uuid), public.election_check_receipt(uuid, text), public.my_elections(), public.election_class_voted(uuid, uuid) to authenticated;
