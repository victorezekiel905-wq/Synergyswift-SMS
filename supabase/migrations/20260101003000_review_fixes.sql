-- =========================================================================
-- EduClass Fusion: fixes from the full-spec review.
--  * The lead webhook key lived in tenant_settings, which every account in a
--    school (students and parents included) can read. It moves to
--    admission_secrets, which only the server can read.
--  * book_admission_event(): public tour / open-day booking checks capacity
--    and inserts in one locked step, so two families cannot both take the
--    last seats.
-- Apply AFTER 20260101002900. Idempotent.
-- =========================================================================

create table if not exists public.admission_secrets (
  tenant_id         uuid primary key references public.tenants(id) on delete cascade,
  lead_webhook_key  text unique,
  updated_at        timestamptz not null default now()
);
alter table public.admission_secrets enable row level security;
-- No policies: only the service role (server) reads or writes this table.
revoke all on public.admission_secrets from anon, authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_settings' and column_name = 'lead_webhook_key') then
    insert into public.admission_secrets (tenant_id, lead_webhook_key)
      select tenant_id, lead_webhook_key from public.tenant_settings where lead_webhook_key is not null
      on conflict (tenant_id) do update set lead_webhook_key = excluded.lead_webhook_key;
    alter table public.tenant_settings drop column lead_webhook_key;
  end if;
end $$;

-- Atomic booking (p_staff: staff may book unpublished or past sessions). Returns the booking token, or raises 'full' / 'not available' / 'already booked'.
create or replace function public.book_admission_event(p_event uuid, p_lead uuid, p_name text, p_phone text, p_email text, p_party int, p_staff boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  e public.admission_events;
  taken int;
  tok text;
begin
  select * into e from public.admission_events where id = p_event for update;
  if e.id is null or (not p_staff and (not e.published or e.starts_at < now())) then raise exception 'not available'; end if;
  if exists (select 1 from public.admission_bookings where event_id = p_event and status <> 'cancelled' and phone = p_phone) then raise exception 'already booked'; end if;
  select coalesce(sum(party_size), 0) into taken from public.admission_bookings where event_id = p_event and status <> 'cancelled';
  if taken + p_party > e.capacity then raise exception 'full'; end if;
  insert into public.admission_bookings (tenant_id, event_id, lead_id, name, phone, email, party_size)
    values (e.tenant_id, p_event, p_lead, p_name, p_phone, p_email, p_party) returning token into tok;
  return tok;
end $$;
revoke all on function public.book_admission_event(uuid, uuid, text, text, text, int, boolean) from public, anon, authenticated;
grant execute on function public.book_admission_event(uuid, uuid, text, text, text, int, boolean) to service_role;
grant all on public.admission_secrets to service_role;
