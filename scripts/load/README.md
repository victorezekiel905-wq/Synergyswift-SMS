# Load testing Synergy Swift (phase 14m)

Three tools, from cheapest to most realistic. **Never point the second and third at the live project.**

## 1. Database at 20,000 users (runs anywhere, no accounts needed)

```
node scripts/load/scale-bench.mjs            # 10 schools x 2,000 accounts, about 10 minutes
node scripts/load/scale-bench.mjs --quick    # 2 schools, about 1 minute
node scripts/load/scale-bench.mjs --before   # without the row-level security speed-up (migration 7400)
```

Builds the full schema in an in-memory Postgres, seeds students, parents, staff, a month of
attendance, gate sign-ins, report cards, invoices and change history, then times the busiest
queries as real signed-in users with row-level security on. Results go to `scripts/load/out/`.
PGlite is single-threaded: absolute times are slower than Supabase; compare ratios and plans.

## 2. Seed a staging project

Make a separate Supabase project (Pro plan, same region as production), run
`supabase/updates/RUN_THIS_UPDATE.sql` in it, then:

```
STAGING=yes NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<staging service key> \
LOAD_PASSWORD='<a long password>' node scripts/load/seed-staging.mjs
```

It refuses to run against the live project and writes `scripts/load/out/users.csv`.
Deploy a staging copy of the app on Render pointing at the staging project.

## 3. A school day with k6

Install k6 (https://k6.io), then:

```
k6 run -e BASE_URL=https://<staging app> -e SUPABASE_URL=https://<staging-ref>.supabase.co \
       -e ANON_KEY=<staging anon key> -e PASSWORD='<the same password>' \
       [-e EXAM_ID=<published paper id> -e EXAM_CODE=<its code>] scripts/load/k6-school-day.js
```

Four scenarios over 26 minutes: the 07:30 register and gate rush (600 teachers), results day
(80 parents a second), a CBT paper (1,500 students saving every 20 seconds) and general browsing
(300 people). It fails if more than 1% of requests fail or the 95th percentile is over 800 ms.
Watch Supabase → Reports (CPU, connections, API requests) and Render → Metrics while it runs.
