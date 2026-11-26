-- 11100: an error log for the platform team. Every crash on the server (any page or API) and on a
-- browser is recorded once per kind (a fingerprint of where and what), with how many times and when
-- it was first and last seen, so a problem is known before a school calls. The first time a kind is
-- seen (and again if it comes back after a day) record_error answers true, and the server emails the
-- platform admins. Only the server reads or writes it. Kinds not seen for 30 days are removed.
-- Safe to run again.

create table if not exists public.error_events (
  fingerprint text primary key check (length(fingerprint) <= 64),
  source      text not null check (source in ('server', 'browser')),
  message     text not null check (length(message) <= 500),
  location    text check (length(location) <= 200),
  detail      text check (length(detail) <= 2000),
  count       bigint not null default 1,
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  alerted_at  timestamptz
);
create index if not exists error_events_recent on public.error_events(last_at desc);
alter table public.error_events enable row level security; -- no policies: the server (service role) only
revoke all on public.error_events from anon, authenticated;

create or replace function public.record_error(p_fingerprint text, p_source text, p_message text, p_location text, p_detail text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare e record; alert boolean;
begin
  insert into public.error_events as x (fingerprint, source, message, location, detail)
    values (left(p_fingerprint, 64), p_source, left(p_message, 500), left(p_location, 200), left(p_detail, 2000))
  on conflict (fingerprint) do update
    set count = x.count + 1, last_at = now(), message = excluded.message, detail = coalesce(excluded.detail, x.detail)
  returning * into e;
  alert := e.alerted_at is null or e.alerted_at < now() - interval '1 day';
  if alert then update public.error_events set alerted_at = now() where fingerprint = e.fingerprint; end if;
  if random() < 0.01 then delete from public.error_events where last_at < now() - interval '30 days'; end if;
  return alert;
end$$;
revoke execute on function public.record_error(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_error(text, text, text, text, text) to service_role;
