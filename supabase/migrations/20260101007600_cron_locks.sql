-- =========================================================================
-- Synergy Swift: one scheduled run at a time (20,000-user report, finding 5).
--  The every-minute dispatcher, the 5-minute slow jobs and the 10-minute AI
--  jobs each take a lock before they start. A run that is still going when
--  the next one is due makes the next one skip, instead of both doing the
--  same work (double alerts, double drafts). A lock expires by itself, so a
--  crashed run never blocks the scheduler for long.
-- Idempotent. Apply after 20260101007500.
-- =========================================================================

create table if not exists public.cron_locks (
  key           text primary key check (length(key) between 1 and 60),
  locked_until  timestamptz not null,
  run_id        uuid,
  last_started  timestamptz,
  last_finished timestamptz
);
alter table public.cron_locks enable row level security;
revoke all on public.cron_locks from anon, authenticated;

-- Returns a run id when the lock was free (or had expired), otherwise null.
create or replace function public.take_cron_lock(p_key text, p_seconds int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_run uuid := gen_random_uuid();
begin
  insert into public.cron_locks (key, locked_until, run_id, last_started)
  values (p_key, now() + make_interval(secs => greatest(5, least(p_seconds, 3600))), v_run, now())
  on conflict (key) do update
    set locked_until = excluded.locked_until, run_id = excluded.run_id, last_started = excluded.last_started
    where public.cron_locks.locked_until < now();
  if found then return v_run; end if;
  return null;
end $$;

-- Frees the lock, but only for the run that holds it.
create or replace function public.release_cron_lock(p_key text, p_run uuid)
returns void language sql security definer set search_path = public as $$
  update public.cron_locks set locked_until = now(), last_finished = now() where key = p_key and run_id = p_run;
$$;

revoke all on function public.take_cron_lock(text, int) from public, anon, authenticated;
revoke all on function public.release_cron_lock(text, uuid) from public, anon, authenticated;
grant execute on function public.take_cron_lock(text, int) to service_role;
grant execute on function public.release_cron_lock(text, uuid) to service_role;
