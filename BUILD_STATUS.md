# EduClass Fusion — Build Status

Contract for the active build. Stack: **Next.js 15 (App Router, TypeScript, Tailwind) + Supabase (PostgreSQL, RLS, Realtime)** + **MV3 browser extension (Chrome/Edge)**. Original implementation per `EduClass_Fusion_SaaS_Blueprint.docx` v1.0 — no cloned vendor code/UI.

## Blueprint inventory → build mapping

| Blueprint § | Module | Status |
|---|---|---|
| §3.1 | Lesson Studio (slides, versions, publish) | ✅ built — extended: duplicate, fixed studio create flow, real slides API, PPTX/PDF/DOCX/MD/TXT import |
| §3.2 | Activity/Assessment engine | ✅ built (v36) — extended: `activity_responses` (student answering), auto-mark MCQ |
| §3.3 | Game-based quiz (Fusion Challenge) | 🟡 v36 had lobby+leaderboard only — **added**: start, question flow, student answer screen, leaderboard API, per-question state on `game_sessions` |
| §3.4 | Live classroom | ✅ built — **extended**: raise-hand queue, environment alert feed w/ acknowledge, screen thumbnails on the wall, teacher/student A/V room join flow |
| §3.5 | Device monitoring (Fusion Guard) | 🟡 v36 enrollment UI only — **added**: real extension agent (enroll/heartbeat/tab events/snapshots), device metadata, command poll+execute+ack |
| §3.6 | Environment/leave detection | 🟡 schema existed — **added**: server evaluates blocked/required URLs via extension events; severity + dedup client-side; student-facing notice |
| §3.7 | Screen display / spotlight | 🟡 **added**: snapshot wall on LiveRoom + spotlight pick (privacy notice on student side) |
| §3.8 | Off-task detection (rule-based) | 🟡 **added**: blocked-domain → `warn`/`critical` event; no ML, no auto-discipline |
| §4 | RBAC + tenant isolation | 🟡 v36 RLS partial — **added**: `users_insert`, `tenants_insert`, `class_members` policies, security-definer class lookup |
| §5/§6 | Multi-tenant architecture / stack | ✅ Next.js + Supabase as specified |
| §7/§8 | Data model | ✅ 35+ tables; **added**: activity_responses, raise_hands, screen_snapshots, devices metadata, game question state |
| §10 | API blueprint | 🟡 v36 ~21 routes — **added**: auth/setup, classes CRUD+roster, games start/leaderboard/question, activities responses, session hands, env-events acknowledge, devices commands/snapshots, lessons duplicate, subscriptions |
| §11 | Teacher dashboard UX | 🟡 **added**: `/dashboard` (role-aware), `/teacher/classes` + roster, `/teacher/insights`, `/teacher/billing` |
| §12 | Student dashboard UX | 🟡 **added**: `/student/dashboard` (upcoming sessions, scores), `/student/game/[id]` play flow |
| §17 | Notifications | ✅ notifications table + banner feeds (mark-read policy added) |
| §18 | Analytics | 🟡 **added**: `/teacher/insights` — participation, question accuracy, response counts, environment alerts, device connectivity |
| §19 | School admin | ✅ classes/roster/policies on `/teacher/classes` + `/teacher/admin`; CSV roster import built, SSO pending |
| §21/§14 | Browser extension agent | 🟡 v36 popup/api.js were placeholders — **rewritten**: real agent (MV3) with enroll, heartbeat alarm, tab change reporting, snapshot capture, command execution, ack |
| §22 | MVP list | ✅ complete after this build |
| §25/§26 | Plans & billing metrics | 🟡 **added**: plans/subscription/invoices UI (`/teacher/billing`); real rows, sandbox checkout only |
| §30/§31 | Failure scenarios / metrics | ✅ design notes; connection-loss ≠ violation handled |
| §3.4 / §15 | WebRTC A/V | 🟡 before: local loopback proof only — **added**: tenant-scoped room/peer/signal API, student join page, teacher host/close controls, STUN-backed browser mesh |

## Known bugs fixed this build

1. `POST /api/lessons` no longer stranded users on a JSON response or risked missing tenant scope — it now creates tenant-scoped lessons and redirects Studio form submissions into the new lesson.
2. `/student/join` read `session_id` from `/api/class-sessions/lookup` which returns `id` → student join always failed. Fixed.
3. Device enrollment used `user.id` as `tenant_id` → wrong tenant. Now resolves tenant from the signed-in user's `users` row; optional `label`/`os`/`browser` metadata stored.
4. Signup created an `auth.users` row only — no `public.users` row → RLS denied everything afterwards. Added `users_insert` policy + `/api/auth/setup` bootstrap (teacher → creates tenant; student → joins class by code).
5. `class_members` had RLS enabled with **no policies** → no roster reads/writes. Added select/insert policies.

## Verified

- `npm run build` passes for the full Next.js app (type-check + compile).
- Added and build-verified `/api/webrtc/peers`, `/api/webrtc/signals`, `/teacher/live/[id]/webrtc`, `/student/live/[id]/webrtc`, and migration `20260101001000_webrtc_mesh.sql`.
- Extension is static MV3 (load unpacked; no build step).
- Two migrations: `20260101000000_init.sql` (base) + `20260101000200_saas_extend.sql` (this build). Seed optional.

## Not built (Phase 2/3, per blueprint)

- Interactive video with timestamped questions already built; next media slice is binary asset ingest/transcoding for uploaded videos/images.
- Matching/drag-drop/collab-board/code-execution activity kinds are built; the next slice is richer grading/rubrics and teacher review UX.
- WebRTC audio/video hardening · SSO/OIDC · real payment processing · AI generation · ML off-task classification
- AI lesson/question generation · ML off-task classification (explicitly gated behind privacy/accuracy testing in blueprint §3.8/§24)

## v45: school operations platform

| Area | Status |
|---|---|
| Platform console, hidden super admin, tenant create / suspend / modules / limits | ✅ built |
| Hard tenant isolation (tenants list, users self-insert and self-promotion, audit, invoices, announcements, leaderboards) | ✅ fixed and verified by `npm run test:db` |
| SIMS: students, guardians, CSV import, portal links, logins, ID cards | ✅ built |
| Per-school grading schemes, score entry, report cards, publish to parents by email and WhatsApp | ✅ built |
| Gate sign-in/out kiosk (QR, camera, typed), staff self sign-in with geofence, parent alerts | ✅ built |
| Pickup codes (hashed, single-use, delegate collector, rate-limited verification) | ✅ built |
| Secure exams: 12 question types, SEB, lockdown, live monitor, marking, push to results | ✅ built |
| Library, requisitions, HR and leave, QA observations and indicators, messaging console | ✅ built |
| Message outbox with retries and cron worker | ✅ built |

Also fixed: migration `000800` referenced a column that does not exist (`activities.owner_id`), so every fresh install failed from that file onward.

Verified: `npm test` (49 unit tests), `npm run test:db` (14 migrations on a fresh database, the 4 new ones re-run for idempotency, 42 RLS scenario checks), `next build`.

Not verified here: live delivery through Resend, SendGrid, Meta or Twilio (needs real credentials), and a real Safe Exam Browser client.

## v46: full school ERP, security fixes and access guide

| Area | Status |
|---|---|
| Next.js 14.2 → 15.5.26 (fixes critical advisories), React 19, async request APIs | ✅ upgraded |
| Security fixes: students and parents could list each other, students could read exam keys, cross-tenant device inserts, broken report aggregate and roster import | ✅ fixed in `001500_hardening` |
| Suspension now locks the older LMS tables too; deactivated staff lose access at once; sign-in explains why | ✅ `001900_suspension_lock` |
| Fees, invoices, receipts, Paystack / Flutterwave with verified amounts, debtor reminders, withhold results | ✅ built |
| Expenses, stock, assets, payroll with approval and self-service payslips | ✅ built |
| Class register, homework, behaviour rules and houses, health and sick bay, events and consent, meeting booking, traits, lesson notes | ✅ built |
| Timetable generator, school buses, boarding and exeat, visitors | ✅ built |
| Admissions with public form and tracking, session rollover, school groups | ✅ built |
| Early-warning risk scores with interventions, AI report comments and lesson notes | ✅ built |
| SMS channel (Termii, Twilio, Africa's Talking) with fallback and per-parent opt-in | ✅ built |
| Parent portal tabs, student homework and timetable, installable web app | ✅ built |
| Super admin access, role matrix and isolation guide | ✅ [docs/ACCESS_AND_ISOLATION.md](docs/ACCESS_AND_ISOLATION.md) |
| Competitor comparison | ✅ [docs/COMPETITIVE_POSITIONING.md](docs/COMPETITIVE_POSITIONING.md) |

Also fixed: ESLint had never run because no config existed. It now runs, and the rule-of-hooks errors it found in the activity renderer are fixed.

Verified: `npm test` (66 unit tests), `npm run test:db` (19 migrations on a fresh database, the new ones re-run for idempotency, 104 checks), `npm run lint`, `next build`.

Not verified here: live email, WhatsApp, SMS, payment and AI calls (these need real keys), and a real Safe Exam Browser client.

## v47: trust and family engagement

Built from research into about 25 leading school systems (see [docs/COMPETITIVE_POSITIONING.md](docs/COMPETITIVE_POSITIONING.md)).

| Area | Status |
|---|---|
| Two-factor sign-in (authenticator app): mandatory for super admins, optional per school for admins or all staff, enforced by the database | ✅ built |
| Two-way parent-staff messaging, safeguarding view for admins, permanent record, rate limits | ✅ built |
| Translation of broadcasts and messages into 40 home languages; AI-drafted notices | ✅ built |
| Free app push notifications for parents and staff | ✅ built |
| Cashless wallet: online and bursary top-ups, tuck shop till with allergy warnings, daily limits, lost-card freeze, new cashier role | ✅ built |
| Staff absence and cover with free-staff suggestions | ✅ built |
| Live bus location during trips, and alerts about five minutes before each stop | ✅ built |
| Offline class register | ✅ built |
| Student data export (GDPR, NDPA), uptime status endpoint | ✅ built |
| Platform console lists every module (19 were missing) | ✅ fixed |

Verified: `npm test` (78 unit tests), `npm run test:db` (20 migrations on a fresh database, the new ones re-run for idempotency, 152 checks), `npm run lint`, `next build`.

Not verified here: live email, WhatsApp, SMS, payment, AI and push delivery (these need real keys and devices), and a real Safe Exam Browser client.
