-- =========================================================================
-- Synergy Swift: bus exceptions and exam-hall safety (Phase 14i-2).
--  * bus_exceptions: a child who boarded the morning bus but is not in
--    school, or boarded the afternoon bus and was never dropped off. Found
--    by the scheduler, sent to transport staff and the heads at once, and
--    closed by a person (with a note) or by itself when the child turns up.
--  * exam_checkins: candidates checked in at the hall door (card, code or by
--    hand) before the paper opens; a series can require it before an online
--    paper starts.
--  * exam_invigilations: invigilators confirm they are in the hall, and
--    cover is recorded when someone else takes the duty.
-- Idempotent.
-- =========================================================================

create table if not exists public.bus_exceptions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  date             date not null,
  student_id       uuid not null references public.students(id) on delete cascade,
  route_id         uuid references public.transport_routes(id) on delete set null,
  kind             text not null check (kind in ('boarded_not_in_school','not_dropped_off')),
  boarded_at       timestamptz,
  detected_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references public.users(id) on delete set null,
  resolution_note  text check (length(resolution_note) <= 500),
  unique (tenant_id, date, student_id, kind)
);
create index if not exists bus_exceptions_open on public.bus_exceptions(tenant_id, date desc) where resolved_at is null;

alter table public.exam_series add column if not exists require_checkin boolean not null default false;

create table if not exists public.exam_checkins (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  series_id      uuid not null references public.exam_series(id) on delete cascade,
  paper_id       uuid not null references public.exam_papers(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  hall_id        uuid references public.exam_halls(id) on delete set null,
  method         text not null default 'card' check (method in ('card','code','manual')),
  checked_in_by  uuid references public.users(id) on delete set null,
  checked_in_at  timestamptz not null default now(),
  unique (paper_id, student_id)
);
create index if not exists exam_checkins_series on public.exam_checkins(series_id, paper_id);

alter table public.exam_invigilations add column if not exists checked_in_at timestamptz;
alter table public.exam_invigilations add column if not exists cover_for uuid references public.users(id) on delete set null;

-- ---------- RLS: staff read; the server writes after its own checks ----------
alter table public.bus_exceptions enable row level security;
alter table public.exam_checkins enable row level security;
drop policy if exists bus_exceptions_staff_read on public.bus_exceptions;
create policy bus_exceptions_staff_read on public.bus_exceptions for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists exam_checkins_staff_read on public.exam_checkins;
create policy exam_checkins_staff_read on public.exam_checkins for select using (tenant_id = public.my_tenant_id() and public.is_staff());
-- A candidate (and their parents) can see that they were checked in.
drop policy if exists exam_checkins_own_read on public.exam_checkins;
create policy exam_checkins_own_read on public.exam_checkins for select using (
  tenant_id = public.my_tenant_id() and exists (select 1 from public.students s where s.id = exam_checkins.student_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id))));
grant select on public.bus_exceptions, public.exam_checkins to authenticated;
