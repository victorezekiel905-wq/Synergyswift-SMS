// Phase 14m: a school day for 20,000 accounts, against STAGING only.
//   k6 run -e BASE_URL=https://staging.synergyswift.ng -e SUPABASE_URL=https://<staging>.supabase.co \
//          -e ANON_KEY=... -e PASSWORD=... scripts/load/k6-school-day.js
// Scenarios (peaks a real Nigerian school group sees):
//   morning   07:30 rush: teachers open registers and the gate kiosk signs children in
//   results   results day: parents open report cards all at once
//   exam      a CBT paper: students start, save answers every 20 s, submit
//   browsing  everyone else clicking around (dashboards, inbox, timetable)
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import encoding from "k6/encoding";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL, SB = __ENV.SUPABASE_URL, ANON = __ENV.ANON_KEY, PASSWORD = __ENV.PASSWORD;
const users = new SharedArray("users", () => open("./out/users.csv").split("\n").slice(1).filter(Boolean).map(l => { const [email, role, school] = l.split(","); return { email, role, school }; }));
const byRole = r => users.filter(u => u.role === r);
const pageTime = new Trend("page_api_ms", true);
const failures = new Rate("failed_requests");

// SCALE multiplies every crowd: 1 = the 20,000-account day (10 schools), 2.5 = 50,000 (25 schools).
const SCALE = Math.max(0.05, Number(__ENV.SCALE || 1));
const n = (x) => Math.max(1, Math.round(x * SCALE));

export const options = {
  scenarios: {
    morning: { executor: "ramping-vus", exec: "teacherMorning", startVUs: 0, stages: [{ duration: "2m", target: n(600) }, { duration: "5m", target: n(600) }, { duration: "1m", target: 0 }] },
    results: { executor: "ramping-arrival-rate", exec: "parentResults", startRate: n(5), timeUnit: "1s", preAllocatedVUs: n(500), maxVUs: n(3000),
      stages: [{ duration: "2m", target: n(80) }, { duration: "5m", target: n(80) }, { duration: "1m", target: 0 }], startTime: "8m" },
    exam: { executor: "constant-vus", exec: "studentExam", vus: n(1500), duration: "10m", startTime: "16m" },
    browsing: { executor: "constant-vus", exec: "browse", vus: n(300), duration: "26m" }
  },
  thresholds: {
    "http_req_failed": ["rate<0.01"],
    "http_req_duration{kind:api}": ["p(95)<800"],
    "page_api_ms": ["p(95)<800"]
  }
};

// Sign in once per virtual user and send the session the way the app's cookies carry it.
const sessions = {};
function session(u) {
  if (sessions[u.email]) return sessions[u.email];
  const r = http.post(`${SB}/auth/v1/token?grant_type=password`, JSON.stringify({ email: u.email, password: PASSWORD }), { headers: { apikey: ANON, "Content-Type": "application/json" }, tags: { kind: "auth" } });
  check(r, { "signed in": x => x.status === 200 });
  const ref = SB.replace(/^https:\/\//, "").split(".")[0];
  const cookie = `sb-${ref}-auth-token=base64-${encoding.b64encode(r.body, "rawurl")}`;
  sessions[u.email] = { cookie, token: r.json("access_token") };
  return sessions[u.email];
}
function api(u, path, method = "GET", body = null) {
  const s = session(u);
  const params = { headers: { Cookie: s.cookie, "Content-Type": "application/json" }, tags: { kind: "api", name: path.split("?")[0] } };
  const r = method === "GET" ? http.get(`${BASE}${path}`, params) : http.post(`${BASE}${path}`, body ? JSON.stringify(body) : null, params);
  pageTime.add(r.timings.duration);
  failures.add(r.status >= 500);
  check(r, { [`${path.split("?")[0]} ok`]: x => x.status < 500 });
  return r;
}
const any = list => list[Math.floor(Math.random() * list.length)];

export function teacherMorning() {
  const u = any(byRole("teacher"));
  api(u, "/api/me");
  api(u, "/api/attendance");
  sleep(2 + Math.random() * 3);
  api(u, "/api/gate/self");
  sleep(5);
}
export function parentResults() {
  const u = any(byRole("parent"));
  api(u, "/api/parent/overview");
  api(u, "/api/parent/portfolio");
}
export function studentExam() {
  const u = any(byRole("student"));
  api(u, "/api/student/portfolio");
  // A real run points EXAM_ID at a published paper on staging; without it this measures the dashboard only.
  if (__ENV.EXAM_ID) {
    api(u, `/api/student/exams/${__ENV.EXAM_ID}`, "POST", { action: "start", access_code: __ENV.EXAM_CODE ?? "" });
    for (let i = 0; i < 6; i++) { sleep(20); api(u, `/api/student/exams/${__ENV.EXAM_ID}`, "POST", { action: "save", answers: { q: String(i) } }); }
  } else sleep(20);
}
export function browse() {
  const u = any(users);
  api(u, "/api/me");
  api(u, u.role === "parent" ? "/api/parent/overview" : u.role === "student" ? "/api/student/portfolio" : "/api/school/overview");
  sleep(3 + Math.random() * 7);
}
