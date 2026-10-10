-- =========================================================================
-- EduClass Fusion: lock down report cards.
--  Before this, any staff account (gate officer, cashier, nurse, any teacher)
--  could rewrite a card's grades, average and position, write the principal's
--  comment, or delete cards, published ones included, by calling the database
--  API directly. Now:
--   * school admins can do everything (publishing still goes through them);
--   * the form teacher of the student's class can compile cards and write the
--     form teacher's comment, but cannot touch published cards;
--   * nobody else can change report cards;
--   * only school admins can delete them.
-- Apply AFTER 20260101002300. Idempotent.
-- =========================================================================

drop policy if exists report_cards_write on public.report_cards;
drop policy if exists report_cards_insert on public.report_cards;
create policy report_cards_insert on public.report_cards for insert
  with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists report_cards_update on public.report_cards;
create policy report_cards_update on public.report_cards for update
  using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists report_cards_delete on public.report_cards;
create policy report_cards_delete on public.report_cards for delete
  using (tenant_id = public.my_tenant_id() and public.is_school_admin());

create or replace function public.report_cards_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_school_admin() then return new; end if;
  if (tg_op = 'INSERT' and new.status <> 'draft') or
     (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    raise exception 'only school admins can approve or publish results';
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then
    raise exception 'only school admins can change a published report card';
  end if;
  if (tg_op = 'INSERT' and new.principal_comment is not null) or
     (tg_op = 'UPDATE' and new.principal_comment is distinct from old.principal_comment) then
    raise exception 'only school admins can write the principal''s comment';
  end if;
  -- Everything else (compiling, the form teacher's comment): the form teacher
  -- of the class the student is in now, for a card filed under that class.
  if not exists (
    select 1 from public.students s join public.class_groups g on g.id = s.class_group_id
    where s.id = new.student_id and g.tenant_id = new.tenant_id
      and g.form_teacher_id = auth.uid() and new.class_group_id = g.id
  ) then
    raise exception 'only the form teacher or a school admin can change this report card';
  end if;
  return new;
end $$;
drop trigger if exists report_cards_guard on public.report_cards;
create trigger report_cards_guard before insert or update on public.report_cards
  for each row execute function public.report_cards_guard();
