-- =========================================================================
-- Onboarding codes for a school the owner has already created.
-- The owner creates the school on the platform console without anyone's
-- email, makes a code for it, and gives the code to the school. Whoever signs
-- up with it becomes that school's admin (at the first sign-in), instead of a
-- new school being created. No invitation email is needed.
--  * school_signup_codes.for_tenant_id: the school the code joins (null: the
--    code creates a new school, as before). tenant_id stays "the school this
--    code ended up with", set when it is used.
-- Idempotent. Apply after 20260101008800.
-- =========================================================================
alter table public.school_signup_codes add column if not exists for_tenant_id uuid references public.tenants(id) on delete cascade;
-- Every link has an index behind it (migration 8800).
create index if not exists school_signup_codes_for_tenant_id_fk on public.school_signup_codes(for_tenant_id);
