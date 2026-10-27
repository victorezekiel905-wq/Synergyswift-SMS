-- =========================================================================
-- Synergy Swift: the super admin centre (Phase 14k).
--  * Support access, instead of signing in as a real person: a platform
--    admin opens a short, audited session in one school (15–60 minutes)
--    with a reason. It is a separate account named "Synergy Swift support",
--    so everything it does is recorded under that name, the school can see
--    every visit, and the database stops honouring it the moment it expires
--    (my_tenant_id checks users.support_until).
--  * platform_module_usage(), platform_db_size(): numbers for the centre,
--    service role only.
-- Idempotent.
-- =========================================================================

alter table public.users add column if not exists support_until timestamptz;

create table if not exists public.platform_support_sessions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  support_user_id  uuid references auth.users(id) on delete set null,
  started_by       uuid references auth.users(id) on delete set null,
  started_by_name  text not null,
  reason           text not null check (length(btrim(reason)) between 10 and 500),
  role             text not null default 'school_admin',
  starts_at        timestamptz not null default now(),
  expires_at       timestamptz not null,
  ended_at         timestamptz,
  ended_by         uuid references auth.users(id) on delete set null,
  check (expires_at > starts_at and expires_at <= starts_at + interval '61 minutes')
);
create index if not exists platform_support_sessions_tenant on public.platform_support_sessions(tenant_id, starts_at desc);
alter table public.platform_support_sessions enable row level security;
revoke all on public.platform_support_sessions from anon, authenticated;

-- The school sees every support visit (who, why, when), never anything about other schools.
create or replace function public.my_support_sessions()
returns table (id uuid, started_by_name text, reason text, starts_at timestamptz, expires_at timestamptz, ended_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.started_by_name, s.reason, s.starts_at, s.expires_at, s.ended_at
  from public.platform_support_sessions s
  where s.tenant_id = public.my_tenant_id() and public.is_school_admin()
  order by s.starts_at desc limit 50
$$;
revoke all on function public.my_support_sessions() from public, anon;
grant execute on function public.my_support_sessions() to authenticated;

-- A support account counts only until its session ends. Support sessions are opened by the
-- platform with a one-time link, so the school's second-factor and device rules do not apply to them.
create or replace function public.my_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u.tenant_id
  from public.users u
  join public.tenants t on t.id = u.tenant_id
  left join public.tenant_settings s on s.tenant_id = u.tenant_id
  where u.id = auth.uid() and t.status = 'active' and u.active and u.role <> 'alumni'
    and (u.support_until is null or u.support_until > now())
    and (u.support_until is not null or (public.mfa_ok(s.require_mfa, u.role, u.extra_roles) and public.session_block(u, s) is null));
$$;

-- Numbers for the centre: in how many schools each module was actually used lately (a row written in the
-- module's main table), and the database size. A table that does not exist is skipped.
create or replace function public.platform_module_activity(p_days int default 30)
returns table (module text, tenants int)
language plpgsql stable security definer set search_path = public as $$
declare m record; n int;
begin
  for m in select * from (values
    ('exams','exam_attempts','started_at'), ('attendance','class_attendance','marked_at'), ('fees','fee_payments','created_at'),
    ('gate','gate_events','at'), ('transport','transport_events','at'), ('library','library_loans','issued_at'),
    ('hr','leave_requests','created_at'), ('payroll','payroll_runs','created_at'), ('lms','assignments','created_at'),
    ('homework','homework','created_at'), ('inbox','conversation_messages','created_at'), ('messaging','message_outbox','created_at'),
    ('admissions','applications','created_at'), ('elections','elections','created_at'), ('sen','sen_profiles','updated_at'),
    ('classroom','point_events','created_at'), ('pickup','pickup_codes','created_at'), ('events','school_events','created_at'),
    ('cover','cover_assignments','created_at'), ('requisitions','requisitions','created_at'), ('hostel','exeat_requests','created_at'),
    ('wallet','wallet_transactions','created_at'), ('lesson_notes','lesson_notes','created_at'), ('inventory','inventory_items','created_at')
  ) v(module, tbl, col)
  loop
    begin
      execute format('select count(distinct tenant_id)::int from public.%I where %I > now() - make_interval(days => $1)', m.tbl, m.col) into n using greatest(1, least(p_days, 365));
      module := m.module; tenants := n; return next;
    exception when others then null;
    end;
  end loop;
end $$;
create or replace function public.platform_db_size()
returns bigint language sql stable security definer set search_path = public as $$
  select pg_database_size(current_database())
$$;
revoke all on function public.platform_module_activity(int), public.platform_db_size() from public, anon, authenticated;
grant execute on function public.platform_module_activity(int), public.platform_db_size() to service_role;
