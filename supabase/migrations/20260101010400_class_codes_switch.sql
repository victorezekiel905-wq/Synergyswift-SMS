-- 10400: students sign up with their own code. A class's shared code (10300) works only when the
-- school turns it on (for example for a supervised session where the teacher confirms each
-- student in the room). Off by default. Safe to run again.
alter table public.tenant_settings add column if not exists class_signup_enabled boolean not null default false;
