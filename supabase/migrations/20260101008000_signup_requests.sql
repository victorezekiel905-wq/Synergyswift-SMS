-- =========================================================================
-- Synergy Swift: account confirmation in the app, not in Supabase.
--  Sign-ups are made by the app (/api/auth/register), which sends the
--  confirmation email itself (SendGrid or Resend). Each new account waits
--  here until it is confirmed: by the person clicking the link, or by an
--  admin pressing Confirm (the platform team for any account, a school's
--  admins only for accounts joining their school).
--  auth_mail_log counts the emails sent, so nobody can flood an inbox.
-- Idempotent. Apply after 20260101007900.
-- =========================================================================

create table if not exists public.signup_requests (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  tenant_id     uuid references public.tenants(id) on delete cascade,   -- the school being joined; null for a new school
  email         text not null,
  full_name     text not null default '',
  kind          text not null check (kind in ('school', 'student', 'parent', 'staff', 'member')),
  detail        text check (length(detail) <= 200),                     -- e.g. the name of the new school
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz,
  sent_count    int not null default 0,
  ip            text,
  confirmed_at  timestamptz,
  confirmed_by  uuid references auth.users(id) on delete set null,
  confirmed_how text check (confirmed_how in ('email', 'school_admin', 'platform'))
);
create index if not exists signup_requests_pending on public.signup_requests(tenant_id, created_at desc) where confirmed_at is null;
create index if not exists signup_requests_ip on public.signup_requests(ip, created_at);
create index if not exists signup_requests_email on public.signup_requests(email) where confirmed_at is null;
alter table public.signup_requests enable row level security;
revoke all on public.signup_requests from anon, authenticated;

create table if not exists public.auth_mail_log (
  id         bigint generated always as identity primary key,
  email      text not null,
  ip         text,
  kind       text not null check (kind in ('confirm', 'reset', 'invite', 'code_miss')),   -- code_miss: a wrong sign-up code (slows guessing)
  at         timestamptz not null default now()
);
create index if not exists auth_mail_log_email on public.auth_mail_log(email, at);
create index if not exists auth_mail_log_ip on public.auth_mail_log(ip, at);
alter table public.auth_mail_log enable row level security;
revoke all on public.auth_mail_log from anon, authenticated;
