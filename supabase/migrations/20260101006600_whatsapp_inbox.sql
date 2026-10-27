-- =========================================================================
-- Synergy Swift: two-way WhatsApp in the school inbox (Phase 14g-3).
--  * Parents' WhatsApp messages to the school's number arrive in the shared
--    school-office inbox as WhatsApp conversations; staff replies go back to the
--    parent's WhatsApp (within WhatsApp's 24-hour window; after it, the parent
--    gets the usual notification to open the portal).
--  * provider_id keeps each WhatsApp message once (webhooks are retried).
--  * whatsapp_unmatched keeps messages from numbers no school knows (platform only).
-- Idempotent.
-- =========================================================================

alter table public.conversations add column if not exists channel text not null default 'app';
alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check check (channel in ('app','whatsapp'));

alter table public.conversation_messages add column if not exists channel text not null default 'app';
alter table public.conversation_messages add column if not exists provider_id text;
alter table public.conversation_messages add column if not exists delivery text;
alter table public.conversation_messages drop constraint if exists conversation_messages_delivery_check;
alter table public.conversation_messages add constraint conversation_messages_delivery_check check (delivery is null or delivery in ('sent','failed','notified'));
create unique index if not exists conversation_messages_provider on public.conversation_messages(provider_id) where provider_id is not null;

alter table public.tenant_settings add column if not exists whatsapp_inbox boolean not null default true;

create table if not exists public.whatsapp_unmatched (
  id           bigint generated always as identity primary key,
  from_phone   text not null,
  name         text,
  body         text,
  provider_id  text unique,
  received_at  timestamptz not null default now()
);
alter table public.whatsapp_unmatched enable row level security;
revoke all on public.whatsapp_unmatched from anon, authenticated;

-- Families whose phone or WhatsApp number ends with the same ten digits (numbers are stored as
-- typed: spaces, 0803…, +234…), in schools that are active and use the WhatsApp inbox.
create or replace function public.guardians_by_phone(p_digits text)
returns table (guardian_id uuid, tenant_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select g.id, g.tenant_id, g.full_name
    from public.guardians g
    join public.tenants t on t.id = g.tenant_id and t.status = 'active'
    left join public.tenant_settings s on s.tenant_id = g.tenant_id
   where coalesce(s.whatsapp_inbox, true)
     and length(regexp_replace(p_digits, '\D', '', 'g')) >= 10
     and (right(regexp_replace(coalesce(g.whatsapp_phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(p_digits, '\D', '', 'g'), 10)
       or right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(p_digits, '\D', '', 'g'), 10))
$$;
revoke all on function public.guardians_by_phone(text) from public, anon, authenticated;
grant execute on function public.guardians_by_phone(text) to service_role;
