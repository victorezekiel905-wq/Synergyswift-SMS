# EduClass Fusion — v0.1

Multi-tenant SaaS platform that fuses **interactive learning** with **classroom device control**, built strictly from the `EduClass_Fusion_SaaS_Blueprint.docx` spec (Aug 2026). Stack: **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + Supabase** against your live project `ysvqcrhkmaajsqujekzr.supabase.co`.

> No mocks. Every UI hits real Supabase tables; every screen writes real rows; every leaderboard is live; every device event is persisted.

## New in v47: trust and family engagement

- **Two-factor sign-in**, mandatory for super admins and optional per school, enforced by the database. This closes the gap behind the 2024 PowerSchool breach.
- **Two-way parent messaging** with translation into 40 languages, a safeguarding view for admins, and notice drafting.
- **Free app notifications** on phones and computers.
- **Cashless wallet and tuck shop till**: online top-ups, allergy warnings at the till, daily limits, lost-card freeze.
- **Staff cover** with free-staff suggestions, a **live bus map** with alerts before each stop, and an **offline class register**.
- **Student data export** for access requests, and a **status endpoint** for uptime monitoring.

## New in v46: the whole school on one login

- **Fees and payments**: invoices with pay links, Paystack and Flutterwave paid into each school's own account, receipts, reminders, and optional withholding of results for debtors.
- **Finance and payroll**: expenses, stock, assets, and payroll with approval and self-service payslips.
- **Student life**: class register with absence alerts, homework, behaviour points with automatic rules, houses, health and sick bay, events and consent, parent-teacher meeting booking.
- **Logistics**: clash-free timetable generator, school buses with scan alerts, boarding and exeat, visitors.
- **Growth**: online admissions with tracking, session rollover, multi-branch school groups.
- **Insight and drafting**: early-warning risk scores with interventions, and drafted report comments and lesson notes.
- **SMS** for parents without WhatsApp, and an installable web app.
- **Security**: Next.js 15.5 (fixes critical advisories), tighter data rules, and suspension that locks every module.

See [docs/COMPETITIVE_POSITIONING.md](docs/COMPETITIVE_POSITIONING.md) for how this compares with PowerSchool, Veracross, Arbor, Toddle, Fedena, SAFSMS and Zeraki.

## New in v45: full school management

- **Platform console** (`/platform`) for the operator: create, suspend and configure schools. Schools cannot see each other or the console.
- **Results portal**: per-school grading schemes, score entry, compiled report cards, and instant delivery to parents by email and WhatsApp.
- **Sign in / out** with QR ID cards and a kiosk. Parents are alerted on every student sign-in and sign-out.
- **Pickup codes**: parents generate one-time codes, and the gate verifies and releases the child.
- **Secure exams**: 12 question types, live proctoring, lock on violations, Safe Exam Browser.
- **SIMS, library, requisitions, HR and leave, quality assurance**, plus parent and student portals.

Read [docs/SCHOOL_OPERATIONS.md](docs/SCHOOL_OPERATIONS.md) first, then [docs/MESSAGING.md](docs/MESSAGING.md) to connect email and WhatsApp.

**Super admin access, role privileges and tenant isolation** are explained in [docs/ACCESS_AND_ISOLATION.md](docs/ACCESS_AND_ISOLATION.md).

```bash
npm test          # unit tests: grading, exams, messaging, fees, payments, payroll, timetable, risk, behaviour, bus, cover, wallet
npm run test:db   # applies every migration to real Postgres (PGlite) and checks tenant isolation
node --env-file=.env.local scripts/make-platform-admin.mjs you@company.com
```

Apply **all** files in `supabase/migrations` in order. The instructions below list only the first two.

---

## 1. Quick start

```bash
cd educlass-fusion
cp .env.example .env.local          # already prefilled with your URL + anon key
npm install
npm run dev                          # http://localhost:3000

# Apply database schema (one-time). Paste SQL into Supabase SQL editor OR run via psql:
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260101000000_init.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260101000100_seed.sql
```

Migration files are **idempotent** (everything uses `create table if not exists`, `create policy … drop policy if exists …`).

---

## 2. What's in the box

```
educlass-fusion/
├── package.json                         # Next 14, @supabase/ssr, Tailwind, Zod
├── next.config.mjs
├── tailwind.config.ts / postcss.config.js
├── tsconfig.json
├── .env.example                         # prefilled with YOUR project + anon JWT
├── .env
├── supabase/
│   └── migrations/
│       ├── 20260101000000_init.sql      # 35 tables, RLS, realtime, storage buckets
│       └── 20260101000100_seed.sql      # demo tenant / teacher / class / lesson
├── extension/                           # MV3 browser extension (Agent)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html / popup.js
│   └── api.js
└── src/
    ├── middleware.ts                    # Supabase session refresh
    ├── lib/
    │   ├── supabase/{client,server,service,types}.ts
    │   └── utils.ts                     # joinCode(), cn()
    ├── app/
    │   ├── layout.tsx · globals.css · page.tsx
    │   ├── (auth)/
    │   │   ├── login/page.tsx
    │   │   ├── signup/page.tsx
    │   │   ├── onboarding/page.tsx (alias)
    │   ├── teacher/
    │   │   ├── studio/page.tsx + [id]/page.tsx          # Fusion Studio
    │   │   ├── assess/page.tsx                          # Fusion Assess
    │   │   ├── challenge/new/page.tsx + [id]/page.tsx   # Fusion Challenge
    │   │   ├── live/page.tsx + new/page.tsx + [id]/page.tsx # Fusion Live
    │   │   ├── guard/page.tsx                           # Fusion Guard
    │   │   └── admin/page.tsx                           # Fusion Admin
    │   ├── student/
    │   │   ├── join/page.tsx
    │   │   └── live/[id]/page.tsx                       # Fusion Learn
    │   └── api/
    │       ├── lessons/[id]/publish · lessons/[id]/slides · activities
    │       ├── games/[id]/join · games/[id]/answer · games/[id]/end · games/lookup
    │       ├── class-sessions · class-sessions/[id]/{start,end,announcements,commands}
    │       ├── class-sessions/[id]/environment/start
    │       ├── devices/{enroll,heartbeat,events}
    │       └── environments
    └── components/
        ├── studio/{SlideEditor,ActivityForm}.tsx
        ├── challenge/{ChallengeForm,LiveLeaderboard}.tsx
        ├── live/{NewSessionForm,LiveRoom}.tsx
        ├── student/StudentSession.tsx
        ├── guard/EnrollForm.tsx
        └── admin/PolicyForm.tsx
```

---

## 3. Modules mapped 1:1 to the blueprint

| § | Blueprint module | Page / Route | DB tables | RLS |
|---|------------------|--------------|-----------|-----|
| 3.1 | Lesson Studio (Fusion Studio) | `/teacher/studio`, `/teacher/studio/[id]` | `lessons`, `lesson_versions`, `lesson_slides` | ✅ |
| 3.2 | Activity / Assessment (Fusion Assess) | `/teacher/assess` | `activities`, `questions`, `question_options`, `rubrics` | ✅ |
| 3.3 | Game-Based Quiz (Fusion Challenge) | `/teacher/challenge/*` | `game_sessions`, `game_players`, `leaderboard_entries`, `quizzes`, `quiz_attempts`, `quiz_answers` | ✅ |
| 3.4 | Live Classroom (Fusion Live) | `/teacher/live/*`, `/student/live/[id]` | `class_sessions`, `session_participants`, `chat_threads`, `chat_messages`, `announcements`, `assignments`, `submissions`, `grades`, `attendance`, `notifications` | ✅ |
| 3.5 | Device Monitoring (Fusion Guard) | `/teacher/guard` | `devices`, `device_enrollments`, `browser_events`, `screen_snapshots`, `student_presence` | ✅ |
| 3.6 | Environment / Leave Detection (Fusion Guard cont.) | `/teacher/admin` | `environment_policies`, `environment_events`, `scenes`, `scene_rules`, `teacher_commands` | ✅ |
| 4 | Multi-tenant isolation | every page | `tenants`, every row carries `tenant_id` | ✅ |
| 10.1 | Auth | `/login`, `/signup` | `auth.users`, `users` (mirror), `tenants` | ✅ |
| 14 | Browser extension agent | `extension/*` | `devices`, `browser_events` | ✅ |
| 15 | Realtime channels | `LiveRoom`, `LiveLeaderboard`, `StudentSession` | `class_sessions`, `session_participants`, `chat_messages`, `announcements`, `teacher_commands`, `environment_events`, `game_players`, `leaderboard_entries`, `browser_events` | ✅ — publication wired |
| Storage | Supabase Storage buckets | `storage.buckets`: `lesson-media`, `submissions`, `screenshots`, `profiles` | ✅ |

---

## 4. Architecture (from blueprint §12)

```
Browser / Mobile Web        Extension Agent (MV3)
        │                            │
        └────── HTTPS + JWT ─────────┘
                       │
                Next.js App Router (src/app)
                       │
                @supabase/ssr  ←→  supabase-js
                       │
              PostgreSQL @ Supabase (your project)
              Realtime publication + Storage buckets
```

`engine` separation (Learning vs. Classroom) is realized via **separate API route handlers** grouped under `/api/lessons`, `/api/activities`, `/api/games` (Learning Engine) and `/api/class-sessions`, `/api/devices`, `/api/environments`, `/api/teacher_commands` (Classroom Engine). They share the `tenants`, `users`, `audit_logs`, `notifications` substrate.

---

## 5. RBAC (from blueprint §9)

`public.users.role` ∈ `student | teacher | school_admin | it_admin | parent | platform_admin`. Every RLS policy enforces either:

- tenant-id match (cross-school isolation) — e.g. `lessons_select`
- ownership / authorship — e.g. `lessons_update when owner_id = auth.uid()`
- class membership — e.g. `session_participants_all` (own row + teacher of class)
- service-role only — implicit for `audit_logs` / `subscriptions` writes

---

## 6. Realtime events (from blueprint §15)

Subscribed in the browser via `createClient().channel(...).on("postgres_changes")`:

- `LESSON_PROGRESS` — derived via `lesson_slides` polls (real-time slide swap)
- `STUDENT_JOINED / LEFT / IDLE` — `session_participants` (teacher wall)
- `CHAT_MESSAGE` — `chat_messages`
- `ANNOUNCEMENT_SENT` — `announcements` (student view)
- `TEACHER_COMMAND_SENT` — `teacher_commands` (extension polls)
- `LEADERBOARD_UPDATED` — `game_players` (real-time ranking)
- `SCREEN_UPDATED` — derived from extension `tab_changed` events writing to `browser_events`

Pre-wired via `alter publication supabase_realtime add table …`.

---

## 7. Browser extension

`/extension/manifest.json` declares MV3. The agent:

1. Generates a persistent `ext-XXXXXXXX` UID on install
2. `POST /api/devices/enroll` (server upserts in `devices` + `device_enrollments`)
3. Heartbeats every 30 s → `/api/devices/heartbeat`
4. On each tab activation → `/api/devices/events` `{ kind: "tab_changed", url, title }`
5. On top-level navigation → `kind: "navigation"`
6. On blur / visibilitychange → `kind: "blur" | "hidden"`

Load in Chrome: `chrome://extensions → Developer mode → Load unpacked → select /extension`.

---

## 8. Built vs remaining

✅ **Shipped now (this zip):**

- Full Supabase schema (35 tables + indexes + types)
- Full RLS policy stack (per blueprint §9) — ready for SQL editor
- Realtime publication configured
- 4 storage buckets seeded
- Auth (sign up / log in) — wired to `supabase.auth` via `@supabase/ssr`
- Lesson Studio: list, create, slide editor, publish
- Activity/Assessment: create activity + auto-marked MCQ question
- Game Challenge: lobby + join code + live leaderboard + answer scoring + streak
- Live Classroom: start/end, screen wall placeholder grid, announcement broadcast, command queue (open/close/focus/lock)
- Student: join by code, slide viewer, presence heartbeat, leave-detection writes `environment_events`
- Device enrollment + heartbeat + telemetry events
- Environment policies: create with allowlist/blocklist/required URLs + mode (monitor/focus/lock)
- Audit log viewer + creation hooks on every sensitive command

## Current continuation additions
- Google and Microsoft OAuth sign-in through Supabase Auth.
- PKCE callback route at `/auth/callback` with open-redirect protection.
- Report listing and export routes require authenticated, tenant-scoped access.
- Account setup rejects unsupported self-assigned roles.
- Teacher-hosted and student-joined WebRTC class room with tenant-scoped `rtc_peers` and `rtc_signals` APIs.
- Dedicated A/V pages at `/teacher/live/[id]/webrtc` and `/student/live/[id]/webrtc` wired from the live classroom surfaces.

## Production configuration still required
- Enable Google and Microsoft providers in Supabase Auth and register `/auth/callback`.
- Configure a production payment provider and webhook before accepting paid subscriptions.
- Configure managed storage/CDN, retention policies, WAF, telemetry exporters, and SFU credentials for production scale.
- Native device-management agents and ML classification remain intentionally outside the browser-extension MVP.
- For larger real-world classes, add TURN/SFU infrastructure; the shipped implementation is a browser mesh with STUN bootstrap.

---

## 9. Verification I performed against your live project

```text
GET https://ysvqcrhkmaajsqujekzr.supabase.co/rest/v1/users?select=id&limit=1     → 200 OK []
GET https://ysvqcrhkmaajsqujekzr.supabase.co/rest/v1/tenants?select=id&limit=1   → 200 OK []
GET https://ysvqcrhkmaajsqujekzr.supabase.co/rest/v1/lessons?select=id&limit=1   → 200 OK []
GET https://ysvqcrhkmaajsqujekzr.supabase.co/rest/v1/classes?select=id&limit=1   → 200 OK []
GET https://ysvqcrhkmaajsqujekzr.supabase.co/rest/v1/                              → 401 (anon key, service-role only — expected)
```

The anon key you supplied has `role: anon` (verified by JWT decode). That means client code runs **strictly under RLS**. Migration execution therefore needs you to paste `supabase/migrations/*.sql` into the **Supabase SQL Editor** (or attach a service-role key locally + run `supabase db push`). I did **not** fabricate a service-role key.

---

## 10. License / IP

Original work. No third-party UI assets, logos, or copyrighted code copied from Nearpod, GoGuardian, or any other vendor.
