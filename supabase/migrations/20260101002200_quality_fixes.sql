-- =========================================================================
-- EduClass Fusion: quality fixes found in review.
--  * Browsing policies must belong to the creator's school. Rows without a
--    school were invisible to everyone (and so looked lost to the teacher).
-- Apply AFTER 20260101002100. Idempotent.
-- =========================================================================

drop policy if exists env_policies_insert on public.environment_policies;
create policy env_policies_insert on public.environment_policies for insert with check (
  public.is_staff() and tenant_id = public.my_tenant_id()
);
