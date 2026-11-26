-- =========================================================================
-- Row-level security: work out "who is asking" once per query, everywhere.
--
-- Migrations 7400 and 8700 rewrote the policies that existed when they ran,
-- but policies added later went back to calling my_tenant_id(), is_staff(),
-- auth.uid() and friends directly. Postgres re-runs such a call for every row
-- it checks. Supabase's advisor counted ~900 of these on the live database
-- (my_tenant_id() alone appeared 558 times unwrapped).
--
-- This pass is general rather than a fixed list: it wraps a call as
-- "(select f())" when f takes no arguments, returns a single value and is
-- STABLE or IMMUTABLE (same answer for the whole query), in the public, auth and
-- live_app schemas. A name that also has a VOLATILE no-argument version is left
-- alone. It also repeats 7400's two special cases: has_role(ARRAY[...]) with a
-- fixed list, and is_guardian_of / is_student_self / teaches_student(column)
-- rewritten as membership of the matching my_*_students() set.
--
-- Same rules, same answers. Covers policies in the public and live schemas.
-- Idempotent: already-wrapped calls are skipped (re-run after any migration that
-- adds policies). A policy that cannot be rewritten keeps working as before and
-- is reported with a notice. Apply after 20260101011200.
-- =========================================================================
do $$
declare
  r record; q text; c text; n int := 0; skipped int := 0;
  schemas regnamespace[] := array_remove(array[to_regnamespace('public'), to_regnamespace('auth'), to_regnamespace('live_app')], null);
  names text; zero text; per_names text; per text;
  hr text := '(?<!select )(?<![a-z_.])(public\.)?has_role\((ARRAY\[[^\]]*\])\)';
begin
  select string_agg(distinct p.proname, '|') into names
  from pg_proc p
  where p.pronamespace = any (schemas)
    and p.prokind = 'f' and p.pronargs = 0 and not p.proretset
    and p.provolatile in ('s', 'i')
    and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    and not exists (select 1 from pg_proc v
                    where v.proname = p.proname and v.pronargs = 0 and v.provolatile = 'v' and v.pronamespace = any (schemas));
  zero := '(?<!select )(?<![a-z_.])((?:public|auth|live_app)\.)?(' || coalesce(names, 'no_such_function_') || ')\(\)';

  -- 7400's per-student rewrite, only for the set helpers that exist here.
  select string_agg(f, '|') into per_names from (values
    ('is_guardian_of', 'my_guardian_students'), ('is_student_self', 'my_self_students'), ('teaches_student', 'my_taught_students')) v(f, s)
  where to_regprocedure('public.' || s || '()') is not null;
  per := '(?<![a-z_.])(public\.)?(' || coalesce(per_names, 'no_such_function_') || ')\(([a-z_]+\.)?([a-z_]+)\)';

  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname in ('public', 'live') loop
    q := r.qual; c := r.with_check;
    if q is not null then
      q := regexp_replace(regexp_replace(q, zero, '(select \1\2())', 'gi'), hr, '(select public.has_role(\2))', 'gi');
      q := regexp_replace(q, per, '(\3\4 = any ((select public.my_\2_set())::uuid[]))', 'gi');
      q := replace(replace(replace(q, 'my_is_guardian_of_set', 'my_guardian_students'), 'my_is_student_self_set', 'my_self_students'), 'my_teaches_student_set', 'my_taught_students');
    end if;
    if c is not null then
      c := regexp_replace(regexp_replace(c, zero, '(select \1\2())', 'gi'), hr, '(select public.has_role(\2))', 'gi');
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
      skipped := skipped + 1;
      raise notice 'policy % on %.% left as it was: %', r.policyname, r.schemaname, r.tablename, sqlerrm;
    end;
  end loop;
  raise notice 'row-level security: % policies now work out who is asking once per query (% left as they were)', n, skipped;
end $$;
