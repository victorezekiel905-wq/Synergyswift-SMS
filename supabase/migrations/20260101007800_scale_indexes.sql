-- =========================================================================
-- Synergy Swift: indexes found missing in the 50,000-user test.
--  users and guardians had no index by school, so "the staff of this school",
--  "parents with a sign-in" and the super admin's customer health read every
--  account on the platform. Idempotent. Apply after 20260101007700.
-- =========================================================================
create index if not exists users_tenant_role on public.users(tenant_id, role);
create index if not exists guardians_tenant on public.guardians(tenant_id) where user_id is not null;
create index if not exists invoices_tenant_open_due on public.invoices(tenant_id, due_at) where status = 'open';
