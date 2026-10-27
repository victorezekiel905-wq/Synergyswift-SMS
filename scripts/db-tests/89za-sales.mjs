// Phase 14g-1: the platform's sales CRM — closed to every school; customer metrics for the platform team.
export default async function ({ db, q, expectError, check, U, T }) {
  console.log("\nSales CRM: only the platform team");
  const [lead] = await q(`insert into sales_leads (school_name, source, students_estimate) values ('Greenfield College', 'website', 600) returning id`);
  await q(`insert into sales_activities (lead_id, kind, body, actor_id) values ('${lead.id}', 'call', 'Spoke to the proprietor', '${U.platform}')`);
  const [num] = await q(`select public.next_sales_quote_number() n`);
  check("quotes are numbered Q-<year>-00001", /^Q-\d{4}-\d{5}$/.test(num.n), num);
  for (const t of ["sales_leads", "sales_activities", "sales_quotes", "tenant_onboarding", "demo_request_tries"]) {
    await expectError(`a school admin can't read ${t}`, U.adminA, `select * from ${t}`, /permission denied/);
  }
  await expectError("nor add a lead", U.adminA, `insert into sales_leads (school_name) values ('Sneaky')`, /permission denied/);
  await expectError("nor read customer metrics", U.adminA, `select * from public.platform_customer_metrics()`, /permission denied/);
  await expectError("nor number quotes", U.adminA, `select public.next_sales_quote_number()`, /permission denied/);

  console.log("\nSales CRM: customer health metrics");
  await db.exec(`update auth.users set last_sign_in_at = now() - interval '2 days' where id in ('${U.teacherA}', '${U.adminA}')`);
  await q(`insert into audit_logs (tenant_id, actor_id, action, ts) values ('${T.A}', '${U.adminA}', 'x', now() - interval '3 days'), ('${T.A}', '${U.adminA}', 'y', now() - interval '40 days')`);
  const rows = await q(`select * from public.platform_customer_metrics() where tenant_id = '${T.A}'`);
  const m = rows[0];
  check("one row per school", rows.length === 1, rows.length);
  check("counts staff and who signed in this month", m.staff >= 3 && m.staff_signed_in_30 === 2, m);
  check("compares this month's actions with last month's", m.actions_30 >= 1 && m.actions_prev_30 >= 1, { a30: m.actions_30, p30: m.actions_prev_30 });
  check("knows parents who can sign in", m.parents_with_login >= 1, m.parents_with_login);
  await q(`insert into tenant_onboarding (tenant_id, step) values ('${T.A}', 'school_created') on conflict do nothing`);
  await db.exec(`delete from sales_leads where id = '${lead.id}'; delete from tenant_onboarding where tenant_id = '${T.A}'; delete from audit_logs where action in ('x','y') and tenant_id = '${T.A}';`);
}
