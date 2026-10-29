-- =========================================================================
-- Row-level security: read the signed-in person once per query, not once per row.
-- Supabase's advisor found 212 policies that call auth.uid() (or auth.jwt(),
-- auth.role()) directly, which Postgres re-evaluates for every row it checks.
-- Wrapped as (select auth.uid()) it is worked out once per query. Same rules,
-- same answers; migration 7400 did this for the school helpers, this does it
-- for auth.* in every remaining policy, in both the public and live schemas.
-- Idempotent (already-wrapped calls are left alone). Apply after 20260101008600.
-- =========================================================================
do $$
declare
  r record; q text; c text; n int := 0;
  pat text := '(?<!select )(?<![a-z_.])auth\.(uid|jwt|role)\(\)';
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname in ('public', 'live') loop
    q := case when r.qual is null then null else regexp_replace(r.qual, pat, '(select auth.\1())', 'gi') end;
    c := case when r.with_check is null then null else regexp_replace(r.with_check, pat, '(select auth.\1())', 'gi') end;
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
      raise notice 'policy % on %.% left as it was: %', r.policyname, r.schemaname, r.tablename, sqlerrm;
    end;
  end loop;
  raise notice 'row-level security: % more policies now read the signed-in person once per query', n;
end $$;
