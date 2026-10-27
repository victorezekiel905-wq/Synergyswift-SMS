-- =========================================================================
-- Synergy Swift: entrance exam automation (Phase 14e).
--  * entrance_plans: the rules for one intake (level + intake): which test,
--    when it is assigned (on applying, once the form fee is paid, or by hand),
--    where it is taken (online at home, at a centre, or the family chooses),
--    face checks at home, Safe Exam Browser at centres, weights for the test,
--    interview and previous school report, pass marks (overall and per
--    section), the borderline band that leads to an interview, automatic or
--    approve-first decisions, the waiting list size, when results are released,
--    and the class new students join.
--  * entrance_sittings: online windows and centre sessions with seats.
--  * entrance_attempts gain a sitting, a one-time PIN (hashed) for centre
--    computers, check-in, absence, section scores and face-check flags.
--  * applications gain the intake, the report score, the weighted score,
--    merit rank and the proposed decision with its reason.
--  * entrance_events: camera photos and face-check flags during home tests.
--  * entrance_lookups: wrong PIN / results-checker tries, for throttling.
-- The test is assigned the moment an application arrives (or its fee is paid)
-- by a trigger; messages, PINs, reminders, absences and decisions are sent by
-- the dispatch job (src/lib/entrance-server.ts). Idempotent.
-- =========================================================================

create table if not exists public.entrance_plans (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 120),
  level               text not null check (length(btrim(level)) between 1 and 60),
  intake              text not null default '',
  exam_id             uuid references public.exams(id) on delete set null,
  status              text not null default 'open' check (status in ('draft','open','closed')),
  assign_on           text not null default 'fee_paid' check (assign_on in ('submitted','fee_paid','manual')),
  where_mode          text not null default 'online' check (where_mode in ('online','centre','choice')),
  face_check          boolean not null default false,
  seb_at_centre       boolean not null default true,
  test_weight         int not null default 100 check (test_weight between 0 and 100),
  interview_weight    int not null default 0 check (interview_weight between 0 and 100),
  report_weight       int not null default 0 check (report_weight between 0 and 100),
  pass_mark           numeric(5,2) not null default 50 check (pass_mark between 0 and 100),
  section_pass_marks  jsonb not null default '{}'::jsonb,
  borderline_band     numeric(5,2) not null default 5 check (borderline_band between 0 and 50),
  interview_for       text not null default 'borderline' check (interview_for in ('none','borderline','passed','everyone')),
  decision_mode       text not null default 'approve' check (decision_mode in ('auto','approve')),
  waitlist_size       int not null default 10 check (waitlist_size between 0 and 10000),
  release_at          timestamptz,
  show_scores         boolean not null default false,
  offer_valid_days    int check (offer_valid_days between 1 and 120),
  acceptance_fee      numeric(14,2) check (acceptance_fee >= 0),
  class_group_id      uuid references public.class_groups(id) on delete set null,
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint entrance_plans_weights check (test_weight + interview_weight + report_weight = 100 and test_weight > 0)
);
create unique index if not exists entrance_plans_intake on public.entrance_plans(tenant_id, lower(level), lower(intake));

create table if not exists public.entrance_sittings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  plan_id           uuid not null references public.entrance_plans(id) on delete cascade,
  kind              text not null default 'centre' check (kind in ('online','centre')),
  centre            text,
  address           text,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  seats             int check (seats between 1 and 100000),
  created_at        timestamptz not null default now(),
  constraint entrance_sittings_window check (ends_at > starts_at),
  constraint entrance_sittings_centre check (kind = 'online' or length(btrim(coalesce(centre, ''))) > 0)
);
create index if not exists entrance_sittings_plan on public.entrance_sittings(plan_id, starts_at);

alter table public.entrance_attempts add column if not exists sitting_id uuid references public.entrance_sittings(id) on delete set null;
alter table public.entrance_attempts add column if not exists pin_hash text;
alter table public.entrance_attempts add column if not exists pin_expires_at timestamptz;
alter table public.entrance_attempts add column if not exists checked_in_at timestamptz;
alter table public.entrance_attempts add column if not exists notified_at timestamptz;
alter table public.entrance_attempts add column if not exists reminded_at timestamptz;
alter table public.entrance_attempts add column if not exists absent boolean not null default false;
alter table public.entrance_attempts add column if not exists section_scores jsonb not null default '{}'::jsonb;
alter table public.entrance_attempts add column if not exists face_flags int not null default 0;
create unique index if not exists entrance_attempts_pin on public.entrance_attempts(pin_hash) where pin_hash is not null;
create index if not exists entrance_attempts_sitting on public.entrance_attempts(sitting_id);

alter table public.applications add column if not exists entrance_plan_id uuid references public.entrance_plans(id) on delete set null;
alter table public.applications add column if not exists report_score numeric(5,2) check (report_score between 0 and 100);
alter table public.applications add column if not exists composite_score numeric(5,2);
alter table public.applications add column if not exists merit_rank int;
alter table public.applications add column if not exists proposed_decision text check (proposed_decision in ('offer','interview','waitlist','regret'));
alter table public.applications add column if not exists decision_reason text;
alter table public.applications add column if not exists decided_at timestamptz;
create index if not exists applications_entrance_plan on public.applications(entrance_plan_id);

create table if not exists public.entrance_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  attempt_id  uuid not null references public.entrance_attempts(id) on delete cascade,
  kind        text not null check (kind in ('snapshot','no_face','multiple_faces','camera_off','blur','checked_in','seb_refused')),
  meta        jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists entrance_events_attempt on public.entrance_events(attempt_id, at desc);

create table if not exists public.entrance_lookups (
  id     bigint generated always as identity primary key,
  ip     text not null,
  kind   text not null check (kind in ('pin','results')),
  ok     boolean not null default false,
  at     timestamptz not null default now()
);
create index if not exists entrance_lookups_ip on public.entrance_lookups(ip, kind, at desc);

-- ---------- RLS: admissions staff only; the public pages go through the server ----------
alter table public.entrance_plans enable row level security;
alter table public.entrance_sittings enable row level security;
alter table public.entrance_events enable row level security;
alter table public.entrance_lookups enable row level security;
drop policy if exists entrance_plans_admissions on public.entrance_plans;
create policy entrance_plans_admissions on public.entrance_plans for all
  using (tenant_id = public.my_tenant_id() and public.is_admissions())
  with check (tenant_id = public.my_tenant_id() and public.is_admissions());
drop policy if exists entrance_sittings_admissions on public.entrance_sittings;
create policy entrance_sittings_admissions on public.entrance_sittings for all
  using (tenant_id = public.my_tenant_id() and public.is_admissions())
  with check (tenant_id = public.my_tenant_id() and public.is_admissions()
              and exists (select 1 from public.entrance_plans p where p.id = plan_id and p.tenant_id = public.my_tenant_id()));
-- Camera photos and flags are written only by the server.
drop policy if exists entrance_events_read on public.entrance_events;
create policy entrance_events_read on public.entrance_events for select
  using (tenant_id = public.my_tenant_id() and public.is_admissions());
-- entrance_lookups: no policies (server only).
revoke all on public.entrance_lookups from anon, authenticated;
revoke insert, update, delete on public.entrance_events from anon, authenticated;

-- ---------- Assignment ----------
-- The intake an application belongs to: same level; a named intake wins over the default ('').
create or replace function public.entrance_plan_for(p_tenant uuid, p_level text)
returns public.entrance_plans language sql stable security definer set search_path = public as $$
  select p.* from public.entrance_plans p
   where p.tenant_id = p_tenant and lower(p.level) = lower(btrim(p_level)) and p.status = 'open'
   order by (p.intake = ''), p.created_at desc limit 1
$$;

-- Books a sitting for a test that hasn't started. The sitting row is locked, so two
-- families can never take the last seat at the same moment. A new sitting clears the
-- PIN and the "sent" mark, so the family is told the new time and place.
create or replace function public.entrance_book_sitting(p_attempt uuid, p_sitting uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare s public.entrance_sittings; t public.entrance_attempts;
begin
  select * into t from public.entrance_attempts where id = p_attempt;
  select * into s from public.entrance_sittings where id = p_sitting for update;
  if t.id is null or s.id is null or t.status <> 'assigned' or s.ends_at <= now() or s.tenant_id <> t.tenant_id then return false; end if;
  if t.sitting_id = s.id then return true; end if;
  if s.seats is not null and (select count(*) from public.entrance_attempts x where x.sitting_id = s.id) >= s.seats then return false; end if;
  update public.entrance_attempts set sitting_id = s.id,
         opens_at = case when s.kind = 'online' then s.starts_at end, closes_at = case when s.kind = 'online' then s.ends_at end,
         pin_hash = null, pin_expires_at = null, notified_at = null, reminded_at = null, absent = false
   where id = t.id;
  update public.applications set assessment_at = s.starts_at, updated_at = now() where id = t.application_id;
  return true;
end $$;

-- Puts a test in the earliest sitting of its intake that has a free seat (online windows for
-- online intakes, centres for centre intakes; families choose for themselves in 'choice').
create or replace function public.entrance_seat(p_attempt uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare t public.entrance_attempts; p public.entrance_plans; r record;
begin
  select * into t from public.entrance_attempts where id = p_attempt;
  select pl.* into p from public.entrance_plans pl join public.applications a on a.entrance_plan_id = pl.id where a.id = t.application_id;
  if t.id is null or p.id is null or p.where_mode = 'choice' or t.sitting_id is not null then return t.sitting_id is not null; end if;
  for r in select st.id from public.entrance_sittings st
            where st.plan_id = p.id and st.kind = case when p.where_mode = 'online' then 'online' else 'centre' end and st.ends_at > now()
            order by st.starts_at loop
    if public.entrance_book_sitting(t.id, r.id) then return true; end if;
  end loop;
  return false;
end $$;

-- Assigns the intake's entrance test to an application and seats it.
-- Returns the attempt id, or null when the intake has no test or the application is past testing.
create or replace function public.entrance_assign(p_app uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.applications; p public.entrance_plans; v_id uuid;
begin
  select * into a from public.applications where id = p_app;
  if a.id is null or a.status not in ('new','reviewing','assessment') then return null; end if;
  p := public.entrance_plan_for(a.tenant_id, a.applying_for);
  if p.id is null or p.exam_id is null then return null; end if;
  update public.applications set entrance_plan_id = p.id,
         status = case when status in ('new','reviewing') then 'assessment' else status end, updated_at = now()
   where id = a.id;
  insert into public.entrance_attempts (tenant_id, application_id, exam_id)
    values (a.tenant_id, a.id, p.exam_id)
    on conflict (application_id, exam_id) do nothing
    returning id into v_id;
  if v_id is not null then perform public.entrance_seat(v_id); end if;
  return v_id;
end $$;

-- Seats every waiting test of an intake (after a sitting is added or seats are raised).
create or replace function public.entrance_seat_waiting(p_plan uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select t.id from public.entrance_attempts t join public.applications a on a.id = t.application_id
            where a.entrance_plan_id = p_plan and t.status = 'assigned' and t.sitting_id is null order by a.created_at loop
    if public.entrance_seat(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- The handshake: an application that arrives (or whose form fee is paid) gets its test at once.
create or replace function public.entrance_auto_assign()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.entrance_plans;
begin
  p := public.entrance_plan_for(new.tenant_id, new.applying_for);
  if p.id is null then return null; end if;
  if (p.assign_on = 'submitted' and tg_op = 'INSERT')
     or (p.assign_on = 'fee_paid' and new.fee_paid and (tg_op = 'INSERT' or not coalesce(old.fee_paid, false))) then
    perform public.entrance_assign(new.id);
  elsif tg_op = 'INSERT' then
    update public.applications set entrance_plan_id = p.id where id = new.id and entrance_plan_id is null;
  end if;
  return null;
end $$;
drop trigger if exists applications_entrance_assign on public.applications;
create trigger applications_entrance_assign after insert or update of fee_paid on public.applications
  for each row execute function public.entrance_auto_assign();

-- Staff actions (checked against their own school).
create or replace function public.entrance_staff_assign(p_app uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admissions() or not exists (select 1 from public.applications where id = p_app and tenant_id = public.my_tenant_id()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.entrance_assign(p_app);
end $$;
create or replace function public.entrance_staff_seat_waiting(p_plan uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admissions() or not exists (select 1 from public.entrance_plans where id = p_plan and tenant_id = public.my_tenant_id()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.entrance_seat_waiting(p_plan);
end $$;
create or replace function public.entrance_staff_book(p_attempt uuid, p_sitting uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admissions() or not exists (select 1 from public.entrance_attempts where id = p_attempt and tenant_id = public.my_tenant_id()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.entrance_book_sitting(p_attempt, p_sitting);
end $$;

revoke all on function public.entrance_plan_for(uuid, text), public.entrance_book_sitting(uuid, uuid), public.entrance_seat(uuid),
  public.entrance_assign(uuid), public.entrance_seat_waiting(uuid), public.entrance_auto_assign() from public, anon, authenticated;
grant execute on function public.entrance_book_sitting(uuid, uuid), public.entrance_seat(uuid), public.entrance_assign(uuid),
  public.entrance_seat_waiting(uuid) to service_role;
revoke all on function public.entrance_staff_assign(uuid), public.entrance_staff_seat_waiting(uuid), public.entrance_staff_book(uuid, uuid) from public, anon;
grant execute on function public.entrance_staff_assign(uuid), public.entrance_staff_seat_waiting(uuid), public.entrance_staff_book(uuid, uuid) to authenticated;

grant select, insert, update, delete on public.entrance_plans, public.entrance_sittings to authenticated;
grant select on public.entrance_events to authenticated;

