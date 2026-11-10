-- 9900: adding a record needs the same role as changing one.
--
-- These rules checked the role for reading, changing and deleting, but only the school when a
-- row was added (Postgres uses a rule's WITH CHECK part, not its USING part, for new rows). So
-- anyone signed in to a school, a student or a parent included, could add students, staff or
-- parents straight through the database, or link a parent account to any child and then see
-- that child's records. Two older rules (grades, student profiles) also did not check the school
-- at all when staff added a row. The app's own pages were never affected (they check roles
-- first); this closes the door for anyone going around them. Safe to run again.

alter policy students_write on public.students with check (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','it_admin']));
alter policy guardians_write on public.guardians with check (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','it_admin']));
alter policy student_guardians_write on public.student_guardians with check (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','it_admin']));
alter policy staff_write on public.staff with check (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','hr_manager']));
alter policy library_books_write on public.library_books with check (
  tenant_id = public.my_tenant_id() and public.has_role(array['librarian','school_admin','principal','platform_admin']));
alter policy qa_checklists_write on public.qa_checklists with check (
  tenant_id = public.my_tenant_id() and public.has_role(array['qa_officer','school_admin','principal','platform_admin']));
-- A panel member scores only as themselves.
alter policy interview_scores_write on public.interview_scores with check (
  tenant_id = public.my_tenant_id() and panelist_id = (select auth.uid()));
-- Anyone reports a post as themselves (forum_reports_insert); only staff handle reports.
alter policy forum_reports_staff on public.forum_reports with check (
  tenant_id = public.my_tenant_id() and public.is_staff());
-- Staff mark only their own school's submissions.
alter policy grades_rw on public.grades with check (
  public.is_staff() and exists (select 1 from public.submissions s join public.assignments a on a.id = s.assignment_id
    where s.id = grades.submission_id and a.tenant_id = public.my_tenant_id()));
-- A student's own profile, or staff for students in their own school.
alter policy student_profiles_rw on public.student_profiles with check (
  user_id = (select auth.uid())
  or (public.is_staff() and exists (select 1 from public.users u where u.id = student_profiles.user_id and u.tenant_id = public.my_tenant_id())));
