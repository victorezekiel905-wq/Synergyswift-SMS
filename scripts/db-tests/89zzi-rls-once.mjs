// Migrations 11200 and 11300: no duplicate indexes, and every security rule works out "who is asking"
// once per query (wrapped as "(select f())") instead of once per row.
export default async function ({ q, check }) {
  console.log("\nSecurity rules work out who is asking once per query");
  const bare = await q(`select count(*)::int n, string_agg(distinct tablename || '.' || policyname, ', ') sample
    from pg_policies where schemaname in ('public','live')
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~* '(?<!select )(?<![a-z_.])(public\\.)?my_tenant_id\\(\\)'`);
  check("no rule calls my_tenant_id() once per row", bare[0].n === 0, bare[0].sample);
  const uid = await q(`select count(*)::int n from pg_policies where schemaname in ('public','live')
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~* '(?<!select )(?<![a-z_.])auth\\.uid\\(\\)'`);
  check("no rule calls auth.uid() once per row", uid[0].n === 0, uid[0].n);
  const dup = await q(`select count(*)::int n from pg_indexes where schemaname = 'public'
      and indexname in ('students_user','guardians_user','class_attendance_student_date')`);
  check("the three duplicate indexes are gone", dup[0].n === 0);
}
