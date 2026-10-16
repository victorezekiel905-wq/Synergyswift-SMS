// Open API: keys and webhooks are admin-only, events are queued by the database for the endpoints that want them, and website news is edited by admins.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001";
  const EP = "f2000000-0000-0000-0000-000000000001", EP2 = "f2000000-0000-0000-0000-000000000002", N = "f2000000-0000-0000-0000-000000000003";

  console.log("\nAPI keys");
  await expectOk("an admin creates a key with scopes", U.adminA,
    `insert into api_keys (tenant_id, name, prefix, key_hash, scopes) values ('${T.A}', 'Website', 'ssk_test0001', 'hash1', array['news:read','applications:write'])`);
  await expectError("unknown scopes are refused", U.adminA,
    `insert into api_keys (tenant_id, name, prefix, key_hash, scopes) values ('${T.A}', 'Bad', 'ssk_test0002', 'hash2', array['everything'])`, /check constraint/);
  await expectError("teachers cannot create keys", U.teacherA,
    `insert into api_keys (tenant_id, name, prefix, key_hash) values ('${T.A}', 'Mine', 'ssk_test0003', 'hash3')`, /row-level security/);
  await expectRows("teachers cannot see keys", U.teacherA, "select count(*) n from api_keys", 0);
  await expectRows("another school cannot see them", U.adminB, "select count(*) n from api_keys", 0);

  console.log("\nWebhooks");
  await expectOk("an admin adds an endpoint for payments", U.adminA,
    `insert into webhook_endpoints (id, tenant_id, url, events) values ('${EP}', '${T.A}', 'https://example.org/hooks', array['payment.received','student.updated'])`);
  await expectOk("…and one for everything", U.adminA, `insert into webhook_endpoints (id, tenant_id, url) values ('${EP2}', '${T.A}', 'https://example.org/all')`);
  await expectError("endpoints must use https", U.adminA, `insert into webhook_endpoints (tenant_id, url) values ('${T.A}', 'http://example.org/x')`, /check constraint/);
  await expectError("…and known events", U.adminA, `insert into webhook_endpoints (tenant_id, url, events) values ('${T.A}', 'https://example.org/y', array['student.deleted'])`, /check constraint/);
  await expectRows("teachers cannot see endpoints (or their secrets)", U.teacherA, "select count(*) n from webhook_endpoints", 0);
  const sec = await q(`select length(secret) l from webhook_endpoints where id = '${EP}'`);
  check("each endpoint gets a signing secret", Number(sec[0].l) === 48, sec[0]);

  await q(`update students set status = 'suspended' where id = '${KID}'`);
  await q(`update students set status = 'active' where id = '${KID}'`);
  const d1 = await q(`select endpoint_id, event, payload->'data'->>'status' s from webhook_deliveries where event = 'student.updated' order by created_at`);
  check("a student's status change is queued for both endpoints, twice", d1.length === 4 && d1.filter(x => x.endpoint_id === EP).length === 2, d1);
  check("…with the new status in the payload", d1.some(x => x.s === "suspended"), d1);
  await q(`update students set first_name = first_name where id = '${KID}'`);
  const d2 = await q(`select count(*) n from webhook_deliveries where event = 'student.updated'`);
  check("unrelated edits send nothing", Number(d2[0].n) === 4, d2[0]);
  await expectRows("admins see the delivery log", U.adminA, "select count(*) n from webhook_deliveries", 4);
  await expectError("nobody writes deliveries by hand", U.adminA, `insert into webhook_deliveries (tenant_id, endpoint_id, event, payload) values ('${T.A}', '${EP}', 'x', '{}')`, /row-level security/);
  await expectError("authenticated users cannot queue events", U.adminA, `select queue_webhook('${T.A}', 'student.created', '{}')`, /permission denied/);
  await q(`update webhook_endpoints set active = false where tenant_id = '${T.A}'`);
  await q(`update students set status = 'suspended' where id = '${KID}'`);
  await q(`update students set status = 'active' where id = '${KID}'`);
  const d3 = await q(`select count(*) n from webhook_deliveries where event = 'student.updated'`);
  check("turned-off endpoints get nothing", Number(d3[0].n) === 4, d3[0]);

  console.log("\nWebsite news");
  await q(`update webhook_endpoints set active = true where id = '${EP2}'`);
  await expectOk("an admin drafts a news post", U.adminA, `insert into news_posts (id, tenant_id, title, slug) values ('${N}', '${T.A}', 'Inter-house sports', 'inter-house-sports')`);
  await expectError("teachers cannot post news", U.teacherA, `insert into news_posts (tenant_id, title, slug) values ('${T.A}', 'Hello', 'hello')`, /row-level security/);
  await expectError("slugs are web-safe", U.adminA, `insert into news_posts (tenant_id, title, slug) values ('${T.A}', 'Bad', 'Bad Slug!')`, /check constraint/);
  await expectOk("…publishes it", U.adminA, `update news_posts set status = 'published' where id = '${N}'`);
  const p = await q(`select published_at is not null p from news_posts where id = '${N}'`);
  check("…stamped with the time", p[0].p, p[0]);
  const w = await q(`select count(*) n from webhook_deliveries where event = 'news.published' and endpoint_id = '${EP2}'`);
  check("…and the website is told", Number(w[0].n) === 1, w[0]);
  await expectRows("other schools do not see it", U.adminB, "select count(*) n from news_posts", 0);
  const ev = await q(`select show_on_website from school_events limit 1`);
  check("events stay off the website unless chosen", ev.length === 0 || ev[0].show_on_website === false, ev[0]);

  await db.exec(`delete from news_posts; delete from webhook_endpoints; delete from api_keys;`);
}
