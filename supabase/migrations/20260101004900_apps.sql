-- =====================================================================
--  Phase 12b: the apps.
--
--  * Notification choices: each person can turn off groups of messages
--    (never safety alerts) and set quiet hours, when app, WhatsApp and SMS
--    messages wait until the morning. Email is not held.
--  * Outbox messages remember who they are for, so those choices apply
--    when they are sent.
--  * Phones running the native app (Android, iPhone) register for push
--    through Firebase Cloud Messaging alongside web push.
-- =====================================================================

create table if not exists public.notification_prefs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid references public.users(id) on delete cascade,          -- staff and students
  guardian_id  uuid references public.guardians(id) on delete cascade,      -- parents (set by the server)
  muted        text[] not null default '{}',
  quiet_from   time,
  quiet_to     time,
  updated_at   timestamptz not null default now(),
  check ((user_id is not null) <> (guardian_id is not null)),
  check (muted <@ array['attendance','learning','fees','messages','transport','activities','work','other']::text[]),
  check ((quiet_from is null) = (quiet_to is null) and (quiet_from is null or quiet_from <> quiet_to))
);
create unique index if not exists notification_prefs_user on public.notification_prefs(user_id) where user_id is not null;
create unique index if not exists notification_prefs_guardian on public.notification_prefs(guardian_id) where guardian_id is not null;

alter table public.notification_prefs enable row level security;
drop policy if exists notification_prefs_own on public.notification_prefs;
create policy notification_prefs_own on public.notification_prefs for all
  using (tenant_id = public.my_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.my_tenant_id() and user_id = auth.uid() and guardian_id is null);
-- Parents' choices are saved by the server after it identifies them (signed in or by their private link).
grant all on public.notification_prefs to service_role;

alter table public.message_outbox add column if not exists recipient_user_id uuid;
alter table public.message_outbox add column if not exists recipient_guardian_id uuid;
create index if not exists message_outbox_recipient_user on public.message_outbox(recipient_user_id) where recipient_user_id is not null;
create index if not exists message_outbox_recipient_guardian on public.message_outbox(recipient_guardian_id) where recipient_guardian_id is not null;

-- Native app devices: the endpoint holds the Firebase registration token.
alter table public.push_subscriptions add column if not exists kind text not null default 'web';
alter table public.push_subscriptions add column if not exists platform text;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_kind_check;
alter table public.push_subscriptions add constraint push_subscriptions_kind_check check (kind in ('web','fcm'));
alter table public.push_subscriptions drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions add constraint push_subscriptions_platform_check check (platform is null or platform in ('android','ios','web'));
alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth drop not null;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_keys_check;
alter table public.push_subscriptions add constraint push_subscriptions_keys_check check (kind = 'fcm' or (p256dh is not null and auth is not null));

select public.attach_change_log();
