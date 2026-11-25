-- 10900: the school admin locks the mid-term and the end of term scores of a term, so teachers can no
-- longer change them.
--
--   * Mid-term locked: teachers cannot change a score in a part that counts for the mid-term report
--     (CA 1, CA 2… whatever is ticked "On mid-term reports"); the other parts can still be entered.
--   * End of term locked: teachers cannot change any score of that term.
--
-- The lock is kept by the database, so it holds for every page, upload and exam result pushed to the
-- score sheet by a teacher. School admins (and principals) are not stopped: they can still correct a
-- score while it is locked. Only they can lock or unlock, and each change is recorded. Safe to run again.

alter table public.terms
  add column if not exists midterm_scores_locked_at timestamptz,
  add column if not exists midterm_scores_locked_by uuid references public.users(id) on delete set null,
  add column if not exists term_scores_locked_at timestamptz,
  add column if not exists term_scores_locked_by uuid references public.users(id) on delete set null;

create or replace function public.set_scores_lock(p_term uuid, p_kind text, p_locked boolean)
returns public.terms language plpgsql volatile security definer set search_path = '' as $$
declare t public.terms;
begin
  if not public.is_school_admin() then raise exception 'only a school admin can lock or unlock scores'; end if;
  if p_kind not in ('midterm', 'term') then raise exception 'choose the mid-term or the end of term scores'; end if;
  select * into t from public.terms where id = p_term and tenant_id = public.my_tenant_id();
  if not found then raise exception 'term not found'; end if;
  if p_kind = 'midterm' then
    update public.terms set midterm_scores_locked_at = case when p_locked then now() end,
                            midterm_scores_locked_by = case when p_locked then auth.uid() end
     where id = p_term returning * into t;
  else
    update public.terms set term_scores_locked_at = case when p_locked then now() end,
                            term_scores_locked_by = case when p_locked then auth.uid() end
     where id = p_term returning * into t;
  end if;
  insert into public.audit_logs (tenant_id, actor_id, action, target, meta)
    values (t.tenant_id, auth.uid(), case when p_locked then 'scores.locked' else 'scores.unlocked' end, p_term::text, jsonb_build_object('report', p_kind));
  return t;
end$$;
revoke execute on function public.set_scores_lock(uuid, text, boolean) from public, anon;
grant execute on function public.set_scores_lock(uuid, text, boolean) to authenticated;

-- Every change to a score checks the term's locks first.
create or replace function public.score_entries_report_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record := coalesce(new, old);
  t record;
  mid boolean;
begin
  -- Server housekeeping, and school admins correcting a score, are not stopped by the lock.
  if auth.uid() is null or public.is_school_admin() then return coalesce(new, old); end if;
  -- A score removed because its student, term or part is being deleted is not an edit: let it go.
  if tg_op = 'DELETE' and (not exists (select 1 from public.students where id = old.student_id)
                           or not exists (select 1 from public.terms where id = old.term_id)
                           or not exists (select 1 from public.grading_components where id = old.component_id)) then
    return old;
  end if;
  select midterm_scores_locked_at, term_scores_locked_at into t from public.terms where id = r.term_id;
  if t.term_scores_locked_at is not null then
    raise exception 'the end of term scores are locked by the school admin: ask an admin to correct a score';
  end if;
  if t.midterm_scores_locked_at is not null then
    select exists (select 1 from public.grading_components gc where gc.midterm
                    and gc.id in (r.component_id, case when tg_op = 'UPDATE' then old.component_id end)) into mid;
    if mid then raise exception 'the mid-term scores are locked by the school admin: ask an admin to correct a score'; end if;
  end if;
  return coalesce(new, old);
end$$;
drop trigger if exists score_entries_report_lock on public.score_entries;
create trigger score_entries_report_lock before insert or update or delete on public.score_entries
  for each row execute function public.score_entries_report_lock();
