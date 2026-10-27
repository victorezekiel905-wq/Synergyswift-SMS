-- =========================================================================
-- Synergy Swift: row-level security that scales (Phase 14m, from the 20,000-user test).
--  * Every policy that calls my_tenant_id(), is_staff(), is_school_admin(),
--    is_hr(), my_staff_id(), is_exam_office() or has_role(array[...]) is
--    rewritten to call it once per query — "(select my_tenant_id())" — instead
--    of once per row. Same rules, same answers; the test showed a school's
--    attendance count taking about 1.2 s instead of 3 ms before this.
--  * Indexes for the busiest per-school reads.
-- Idempotent: an already-wrapped call is left alone, and a policy that cannot be
-- rewritten is skipped with a notice (it keeps working as before).
-- =========================================================================

-- The same three per-student checks as sets, worked out once per query: the children whose guardian I am,
-- my own student record, and the students in classes I teach or am form teacher of (same rules as
-- is_guardian_of, is_student_self and teaches_student).
create or replace function public.my_guardian_students()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(sg.student_id), '{}') from public.student_guardians sg join public.guardians g on g.id = sg.guardian_id where g.user_id = auth.uid()
$$;
create or replace function public.my_self_students()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.id), '{}') from public.students s where s.user_id = auth.uid()
$$;
create or replace function public.my_taught_students()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.id), '{}') from public.students s join public.class_groups g on g.id = s.class_group_id
  where g.form_teacher_id = auth.uid()
     or exists (select 1 from public.subject_offerings o where o.class_group_id = s.class_group_id and o.teacher_id = auth.uid())
$$;
-- Like the other helpers used inside policies, signed-out requests may call them too (they get empty lists),
-- so a table read without a session answers "nothing" instead of failing.
revoke all on function public.my_guardian_students(), public.my_self_students(), public.my_taught_students() from public;
grant execute on function public.my_guardian_students(), public.my_self_students(), public.my_taught_students() to anon, authenticated;

do $$
declare
  r record; q text; c text; n int := 0;
  pat text := '(?<!select )(?<![a-z_.])(public\.)?(my_tenant_id|is_staff|is_school_admin|is_hr|my_staff_id|is_exam_office)\(\)';
  hr  text := '(?<!select )(?<![a-z_.])(public\.)?has_role\((ARRAY\[[^\]]*\])\)';
  -- is_guardian_of(x) → (x = any ((select my_guardian_students())::uuid[])), and the same for the other two.
  per text := '(?<![a-z_.])(public\.)?(is_guardian_of|is_student_self|teaches_student)\(([a-z_]+\.)?([a-z_]+)\)';
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := r.qual; c := r.with_check;
    if q is not null then q := regexp_replace(regexp_replace(q, pat, '(select public.\2())', 'gi'), hr, '(select public.has_role(\2))', 'gi'); end if;
    if c is not null then c := regexp_replace(regexp_replace(c, pat, '(select public.\2())', 'gi'), hr, '(select public.has_role(\2))', 'gi'); end if;
    -- Only plain column arguments are rewritten (a policy passing an expression keeps the per-row check).
    if q is not null then
      q := regexp_replace(q, per, '(\3\4 = any ((select public.my_\2_set())::uuid[]))', 'gi');
      q := replace(replace(replace(q, 'my_is_guardian_of_set', 'my_guardian_students'), 'my_is_student_self_set', 'my_self_students'), 'my_teaches_student_set', 'my_taught_students');
    end if;
    if c is not null then
      c := regexp_replace(c, per, '(\3\4 = any ((select public.my_\2_set())::uuid[]))', 'gi');
      c := replace(replace(replace(c, 'my_is_guardian_of_set', 'my_guardian_students'), 'my_is_student_self_set', 'my_self_students'), 'my_teaches_student_set', 'my_taught_students');
    end if;
    if q is not distinct from r.qual and c is not distinct from r.with_check then continue; end if;
    begin
      if q is not null and c is not null then
        execute format('alter policy %I on %I.%I using (%s) with check (%s)', r.policyname, r.schemaname, r.tablename, q, c);
      elsif q is not null then
        execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, q);
      else
        execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, c);
      end if;
      n := n + 1;
    exception when others then
      raise notice 'policy % on % left as it was: %', r.policyname, r.tablename, sqlerrm;
    end;
  end loop;
  raise notice 'row-level security: % policies now check once per query', n;
end $$;

-- Busy per-school reads (dashboards, registers, change history).
create index if not exists class_attendance_tenant_date on public.class_attendance(tenant_id, date);
create index if not exists class_attendance_student_date on public.class_attendance(student_id, date);
create index if not exists audit_logs_tenant_ts on public.audit_logs(tenant_id, ts desc);
create index if not exists report_cards_student on public.report_cards(student_id, term_id);
create index if not exists student_guardians_guardian on public.student_guardians(guardian_id);
create index if not exists student_guardians_student on public.student_guardians(student_id);
create index if not exists guardians_user on public.guardians(user_id);
create index if not exists students_user on public.students(user_id);
create index if not exists students_tenant_status on public.students(tenant_id, status);
create index if not exists fee_invoices_tenant_status on public.fee_invoices(tenant_id, status);
create index if not exists message_outbox_status_created on public.message_outbox(status, created_at);
