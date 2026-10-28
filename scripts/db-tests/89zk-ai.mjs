// Phase 14p: AI usage is counted per school, readable only by that school's admins, and written by the server only.
export default async function ({ db, q, expectRows, expectError, check, U, T }) {
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };

  console.log("\nAI: usage log");
  await server("the server logs a request for school A", `insert into ai_usage (tenant_id, user_id, task, provider, model, input_tokens, output_tokens) values ('${T.A}', '${U.teacherA}', 'report_comments', 'gemini', 'gemini-2.5-flash', 1200, 400)`);
  await server("…and one for school B", `insert into ai_usage (tenant_id, task, provider, model) values ('${T.B}', 'slides', 'gemini', 'gemini-2.5-flash')`);
  await server("…and platform work with no school", `insert into ai_usage (task, provider, model) values ('sales_brief', 'gemini', 'gemini-2.5-flash')`);
  await server("any provider is named (Gemini, Groq, OpenRouter…)", `insert into ai_usage (tenant_id, task, provider, model) values ('${T.B}', 'x', 'groq', 'llama')`);
  await server("…but it must be named", `insert into ai_usage (tenant_id, task, provider, model) values ('${T.A}', 'x', '', 'm')`, /check/);
  await expectRows("school A's admin sees school A's usage", U.adminA, `select count(*) n from ai_usage`, 1);
  await expectRows("school B's admin sees only school B's", U.adminB, `select count(*) n from ai_usage where task = 'slides'`, 1);
  await expectRows("…and nothing of school A's", U.adminB, `select count(*) n from ai_usage where tenant_id = '${T.A}'`, 0);
  await expectRows("teachers don't see the usage log", U.teacherA, `select count(*) n from ai_usage`, 0);
  await expectRows("parents don't either", U.parentA, `select count(*) n from ai_usage`, 0);
  await expectError("nobody signed in can add usage", U.adminA, `insert into ai_usage (tenant_id, task, provider, model) values ('${T.A}', 'x', 'gemini', 'm')`, /permission denied|row-level security/);
  await expectError("…or wipe it", U.adminA, `delete from ai_usage`, /permission denied/);

  console.log("\nAI: monthly allowance");
  const n = await q(`select public.ai_requests_this_month('${T.A}') n`);
  check("this month's requests are counted per school", n[0]?.n === 1, n);
  await q(`insert into ai_usage (tenant_id, task, provider, model, ok) values ('${T.A}', 'quiz', 'gemini', 'm', false)`);
  const n2 = await q(`select public.ai_requests_this_month('${T.A}') n`);
  check("…and a request that failed doesn't use the allowance", n2[0]?.n === 1, n2);
  await expectError("schools can't call the counter for another school", U.adminA, `select public.ai_requests_this_month('${T.B}')`, /permission denied/);
  await server("a school can have its own limit", `update tenant_settings set ai_monthly_limit = 500, ai_settings = '{"comments":{"tone":"formal"}}' where tenant_id = '${T.A}'`);
  await server("…but not a negative one", `update tenant_settings set ai_monthly_limit = -1 where tenant_id = '${T.A}'`, /check/);

  console.log("\nAI: drafts waiting for a person");
  const lead = await q(`insert into sales_leads (school_name) values ('Test AI School') returning id`);
  await server("the sales log accepts AI drafts", `insert into sales_activities (lead_id, kind, body) values ('${lead[0].id}', 'ai', 'Drafted follow-up')`);
  await server("…and the brief is kept on the lead", `update sales_leads set ai_brief = '{"summary":"x"}', ai_brief_at = now() where id = '${lead[0].id}'`);
  const al = await q(`insert into admission_leads (tenant_id, parent_name) values ('${T.A}', 'Mrs Test') returning id`);
  await server("the admissions log accepts AI drafts", `insert into lead_activities (tenant_id, lead_id, kind, body) values ('${T.A}', '${al[0].id}', 'ai', 'Drafted reply')`);
  await server("…other kinds are still refused", `insert into lead_activities (tenant_id, lead_id, kind, body) values ('${T.A}', '${al[0].id}', 'telegram', 'x')`, /check/);

  await db.exec(`delete from ai_usage; delete from sales_leads where id = '${lead[0].id}'; delete from admission_leads where id = '${al[0].id}';
    update tenant_settings set ai_monthly_limit = null, ai_settings = '{}' where tenant_id = '${T.A}';`);
}
