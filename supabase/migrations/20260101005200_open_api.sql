-- =====================================================================
--  Phase 13c: the open API, webhooks and the school website.
--
--  * API keys: admins create keys with chosen scopes for other systems
--    (a website, a data warehouse, a district office). Only a hash is kept;
--    the key is shown once.
--  * Webhooks: other systems are told when things happen (a student is
--    admitted, an application arrives, a payment is received, results are
--    published, news is posted). Events are queued by the database and sent,
--    signed, by the every-minute job, with retries.
--  * Website: news posts for the school's own site, and events marked to
--    show there, served as a JSON feed, RSS and an embeddable widget along
--    with the admissions and enquiry forms.
-- =====================================================================

create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 80),
  prefix        text not null unique,                 -- first characters, to recognise the key
  key_hash      text not null unique,                 -- sha-256 of the full key
  scopes        text[] not null default '{}',
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  check (scopes <@ array['students:read','classes:read','staff:read','attendance:read','results:read','fees:read','payments:read',
                         'applications:read','applications:write','events:read','news:read']::text[])
);
alter table public.api_keys enable row level security;
drop policy if exists api_keys_admin on public.api_keys;
create policy api_keys_admin on public.api_keys for all
  using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
grant all on public.api_keys to service_role;

create table if not exists public.webhook_endpoints (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  url              text not null check (url ~ '^https://[^\s/$.?#].[^\s]*$' and length(url) <= 500),
  description      text,
  events           text[] not null default '{*}',
  secret           text not null default encode(gen_random_bytes(24), 'hex'),
  active           boolean not null default true,
  failures         int not null default 0,              -- in a row; turned off after 20
  last_status      int,
  last_delivered_at timestamptz,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  check (events <@ array['*','student.created','student.updated','application.created','application.status_changed',
                         'payment.received','invoice.created','result.published','news.published']::text[] and cardinality(events) > 0)
);
alter table public.webhook_endpoints enable row level security;
drop policy if exists webhook_endpoints_admin on public.webhook_endpoints;
create policy webhook_endpoints_admin on public.webhook_endpoints for all
  using (tenant_id = public.my_tenant_id() and public.is_school_admin())
  with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
grant all on public.webhook_endpoints to service_role;

create table if not exists public.webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  endpoint_id      uuid not null references public.webhook_endpoints(id) on delete cascade,
  event            text not null,
  payload          jsonb not null,
  status           text not null default 'queued' check (status in ('queued','sending','delivered','failed')),
  attempts         int not null default 0,
  next_attempt_at  timestamptz not null default now(),
  response_code    int,
  last_error       text,
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz
);
create index if not exists webhook_deliveries_due on public.webhook_deliveries(next_attempt_at) where status = 'queued';
create index if not exists webhook_deliveries_endpoint on public.webhook_deliveries(endpoint_id, created_at desc);
alter table public.webhook_deliveries enable row level security;
drop policy if exists webhook_deliveries_read on public.webhook_deliveries;
create policy webhook_deliveries_read on public.webhook_deliveries for select
  using (tenant_id = public.my_tenant_id() and public.is_school_admin());
grant all on public.webhook_deliveries to service_role;

-- Queues an event for every active endpoint that wants it. Cheap when a school has none.
create or replace function public.queue_webhook(p_tenant uuid, p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.webhook_endpoints where tenant_id = p_tenant and active) then return; end if;
  insert into public.webhook_deliveries (tenant_id, endpoint_id, event, payload)
  select p_tenant, e.id, p_event, jsonb_build_object('id', gen_random_uuid(), 'event', p_event, 'created_at', now(), 'data', p_payload)
  from public.webhook_endpoints e
  where e.tenant_id = p_tenant and e.active and (p_event = any(e.events) or '*' = any(e.events));
end $$;
revoke all on function public.queue_webhook(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.webhook_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'students' then
    if tg_op = 'INSERT' then
      perform public.queue_webhook(new.tenant_id, 'student.created', jsonb_build_object('student_id', new.id, 'admission_no', new.admission_no,
        'first_name', new.first_name, 'last_name', new.last_name, 'class_group_id', new.class_group_id, 'status', new.status));
    elsif new.status is distinct from old.status or new.class_group_id is distinct from old.class_group_id then
      perform public.queue_webhook(new.tenant_id, 'student.updated', jsonb_build_object('student_id', new.id, 'admission_no', new.admission_no,
        'class_group_id', new.class_group_id, 'status', new.status, 'previous_status', old.status));
    end if;
  elsif tg_table_name = 'applications' then
    if tg_op = 'INSERT' then
      perform public.queue_webhook(new.tenant_id, 'application.created', jsonb_build_object('application_id', new.id, 'application_no', new.application_no,
        'applying_for', new.applying_for, 'status', new.status, 'source', new.source));
    elsif new.status is distinct from old.status then
      perform public.queue_webhook(new.tenant_id, 'application.status_changed', jsonb_build_object('application_id', new.id, 'application_no', new.application_no,
        'status', new.status, 'previous_status', old.status));
    end if;
  elsif tg_table_name = 'fee_payments' then
    if new.status = 'success' and (tg_op = 'INSERT' or old.status is distinct from 'success') then
      perform public.queue_webhook(new.tenant_id, 'payment.received', jsonb_build_object('payment_id', new.id, 'invoice_id', new.invoice_id, 'student_id', new.student_id,
        'amount', new.amount, 'currency', new.currency, 'method', new.method, 'receipt_no', new.receipt_no, 'paid_at', coalesce(new.paid_at, new.created_at)));
    end if;
  elsif tg_table_name = 'fee_invoices' then
    perform public.queue_webhook(new.tenant_id, 'invoice.created', jsonb_build_object('invoice_id', new.id, 'invoice_no', new.invoice_no, 'student_id', new.student_id,
      'term_id', new.term_id, 'total', new.total, 'due_date', new.due_date));
  elsif tg_table_name = 'report_cards' then
    if new.status = 'published' and old.status is distinct from 'published' then
      perform public.queue_webhook(new.tenant_id, 'result.published', jsonb_build_object('report_card_id', new.id, 'student_id', new.student_id, 'term_id', new.term_id,
        'average', new.average, 'position', new.position));
    end if;
  elsif tg_table_name = 'news_posts' then
    if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
      perform public.queue_webhook(new.tenant_id, 'news.published', jsonb_build_object('news_id', new.id, 'title', new.title, 'slug', new.slug, 'published_at', new.published_at));
    end if;
  end if;
  return null;
end $$;

-- ---------- News for the school website ----------
create table if not exists public.news_posts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  title         text not null check (length(trim(title)) between 2 and 160),
  slug          text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  summary       text check (length(summary) <= 400),
  body          text not null default '' check (length(body) <= 50000),
  image_url     text check (image_url is null or image_url ~ '^https://'),
  status        text not null default 'draft' check (status in ('draft','published')),
  published_at  timestamptz,
  author_id     uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, slug)
);
create or replace function public.news_posts_stamp() returns trigger language plpgsql as $$
begin
  if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists news_posts_stamp on public.news_posts;
create trigger news_posts_stamp before insert or update on public.news_posts for each row execute function public.news_posts_stamp();
alter table public.news_posts enable row level security;
drop policy if exists news_posts_read on public.news_posts;
create policy news_posts_read on public.news_posts for select using (tenant_id = public.my_tenant_id());
drop policy if exists news_posts_write on public.news_posts;
create policy news_posts_write on public.news_posts for all
  using (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['admissions_officer'])))
  with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['admissions_officer'])));
grant all on public.news_posts to service_role;

alter table public.school_events add column if not exists show_on_website boolean not null default false;

drop trigger if exists webhook_events on public.students;
create trigger webhook_events after insert or update on public.students for each row execute function public.webhook_events();
drop trigger if exists webhook_events on public.applications;
create trigger webhook_events after insert or update on public.applications for each row execute function public.webhook_events();
drop trigger if exists webhook_events on public.fee_payments;
create trigger webhook_events after insert or update on public.fee_payments for each row execute function public.webhook_events();
drop trigger if exists webhook_events on public.fee_invoices;
create trigger webhook_events after insert on public.fee_invoices for each row execute function public.webhook_events();
drop trigger if exists webhook_events on public.report_cards;
create trigger webhook_events after update on public.report_cards for each row execute function public.webhook_events();
drop trigger if exists webhook_events on public.news_posts;
create trigger webhook_events after insert or update on public.news_posts for each row execute function public.webhook_events();

-- Deliveries are a queue; keys and endpoints hold secrets. None of them belong in the change history.
create or replace function public.attach_change_log()
returns int language plpgsql security definer set search_path = public as $$
declare t text; n int := 0;
  skip text[] := array['data_changes','audit_logs','platform_audit_logs','message_outbox','exam_events','exam_attempts','practice_sessions',
        'browser_events','environment_events','screen_snapshots','student_presence','session_participants','raise_hands','rtc_rooms','rtc_peers','rtc_signals',
        'transport_live','push_subscriptions','doc_counters','lead_sequence_runs','access_grants','phone_login_codes','quiz_attempts','quiz_answers',
        'activity_responses','game_sessions','game_players','leaderboard_entries','conversation_messages','pickup_attempts','device_enrollments','devices',
        'teacher_commands','survey_invites','tenants',
        'learning_activity','content_attempts','xapi_statements','xapi_state','breakout_members','online_lesson_joins','tutor_messages','integration_secrets','online_lesson_hosts','admission_secrets',
        'calendar_feeds','notice_recipients','student_thread_messages',
        'sensitive_access_log','pastoral_referrals','counselling_cases','counselling_sessions','safeguarding_concerns','safeguarding_actions','wellbeing_checkins',
        'kpi_snapshots',
        'api_keys','webhook_endpoints','webhook_deliveries'];
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and x.table_type = 'BASE TABLE'
  loop
    -- Re-running an older update re-attaches the trigger everywhere; this puts the exclusions back.
    execute format('drop trigger if exists zz_log_data_change on public.%I', t);
    if t = any(skip) then continue; end if;
    execute format('create trigger zz_log_data_change after insert or update or delete on public.%I for each row execute function public.log_data_change()', t);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.attach_change_log() from public, anon, authenticated;
select public.attach_change_log();
