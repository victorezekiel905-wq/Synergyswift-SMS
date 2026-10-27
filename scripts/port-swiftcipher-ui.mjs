#!/usr/bin/env node
/**
 * Copies SwiftCipher's live-lesson screens into Synergy Swift (src/live and
 * src/app/live/**, API routes under /api/swift/**), rewriting imports, links,
 * API paths, storage buckets and the database schema ("live").
 *
 * Usage: node scripts/port-swiftcipher-ui.mjs [path-to-swiftcipher]
 * Re-runnable: it replaces what it copied before. Files under src/live that
 * Synergy Swift changed by hand are listed in KEEP and never overwritten.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SC = resolve(process.argv[2] ?? join(process.cwd(), "..", "swiftcipher"));
const ROOT = process.cwd();

/** SwiftCipher source → Synergy Swift destination (folders copied whole). */
const COPY = [
  ["src/lib", "src/live/lib"],
  ["src/components", "src/live/components"],
  ["src/slides", "src/live/slides"],
  ["src/app/(app)/teacher/lessons", "src/app/live/teacher/lessons"],
  ["src/app/(app)/teacher/live", "src/app/live/teacher/live"],
  ["src/app/(app)/teacher/challenge", "src/app/live/teacher/challenge"],
  ["src/app/(app)/teacher/questions", "src/app/live/teacher/questions"],
  ["src/app/(app)/teacher/media", "src/app/live/teacher/media"],
  ["src/app/(app)/teacher/reports", "src/app/live/teacher/reports"],
  ["src/app/(app)/teacher/insights", "src/app/live/teacher/insights"],
  ["src/app/(app)/teacher/homework", "src/app/live/teacher/homework"],
  ["src/app/(app)/teacher/StartGuide.tsx", "src/app/live/teacher/StartGuide.tsx"],
  ["src/app/(app)/teacher/TeacherHomeView.tsx", "src/app/live/teacher/TeacherHomeView.tsx"],
  ["src/app/(app)/teacher/page.tsx", "src/app/live/teacher/page.tsx"],
  ["src/app/(app)/student/live", "src/app/live/student/live"],
  ["src/app/(app)/student/game", "src/app/live/student/game"],
  ["src/app/(app)/student/join", "src/app/live/student/join"],
  ["src/app/(app)/student/lesson", "src/app/live/student/lesson"],
  ["src/app/(app)/student/HomeworkList.tsx", "src/app/live/student/HomeworkList.tsx"],
  ["src/app/(app)/student/MyClasses.tsx", "src/app/live/student/MyClasses.tsx"],
  ["src/app/(app)/student/ProgressPanel.tsx", "src/app/live/student/ProgressPanel.tsx"],
  ["src/app/(app)/student/page.tsx", "src/app/live/student/page.tsx"],
  ["src/app/present", "src/app/live/present"],
  ["src/app/guest", "src/app/live/guest"],
  ["src/app/(public)/join", "src/app/live/join"],
  ["src/app/api/ai", "src/app/api/swift/ai"],
  ["src/app/api/lessons/import", "src/app/api/swift/lessons/import"],
  ["src/app/api/live", "src/app/api/swift/live"],
  ["src/app/api/reports", "src/app/api/swift/reports"],
  ["public/sandbox", "public/sandbox"]
];

/** Parts of SwiftCipher Synergy Swift already has (or does not use): not copied. */
const SKIP = [/^src\/live\/components\/marketing\//, /^src\/live\/components\/parent\//, /^src\/live\/components\/AppShell\.tsx$/, /^src\/live\/components\/auth\/AuthArt\.tsx$/,
  /^src\/live\/components\/TermsBanner\.tsx$/, /^src\/live\/components\/LegalPage\.tsx$/, /^src\/live\/lib\/legal\.ts$/, /^src\/live\/lib\/device-gateway\.ts$/];

/** Files Synergy Swift has edited by hand after porting (kept on re-run). */
const KEEP = new Set(["src/live/lib/supabase/client.ts", "src/live/lib/supabase/server.ts", "src/live/lib/supabase/service.ts", "src/live/lib/session.ts",
  "src/app/live/student/join/page.tsx", "src/app/live/teacher/live/[id]/ControlBar.tsx"]);

/** Old SwiftCipher routes → where they live in Synergy Swift. Longest first. */
const ROUTES = [
  ["/teacher/lessons", "/live/teacher/lessons"], ["/teacher/live", "/live/teacher/live"], ["/teacher/challenge", "/live/teacher/challenge"],
  ["/teacher/questions", "/live/teacher/questions"], ["/teacher/media", "/live/teacher/media"], ["/teacher/reports", "/live/teacher/reports"],
  ["/teacher/insights", "/live/teacher/insights"], ["/teacher/homework", "/live/teacher/homework"], ["/teacher/classes", "/school/classroom"],
  ["/teacher/feedback", "/school/inbox"], ["/teacher/students", "/school/students"], ["/teacher", "/live/teacher"],
  ["/student/live", "/live/student/live"], ["/student/game", "/live/student/game"], ["/student/join", "/live/student/join"],
  ["/student/lesson", "/live/student/lesson"], ["/student/progress", "/student"], ["/student/device", "/student"], ["/student", "/live/student"],
  ["/present", "/live/present"], ["/guest", "/live/guest"], ["/join", "/live/join"],
  ["/admin", "/school"], ["/super", "/platform"], ["/account", "/account/security"], ["/signup", "/login"], ["/onboarding", "/dashboard"],
  ["/guard", "/teacher/guard"], ["/messages", "/school/inbox"], ["/notifications", "/dashboard"], ["/parent", "/parent"],
  ["/terms", "/"], ["/privacy", "/"], ["/dpa", "/"], ["/security", "/"]
];

function rewrite(code, file) {
  let s = code;
  // Imports.
  s = s.replace(/from "@\/lib\//g, 'from "@/live/lib/').replace(/import\("@\/lib\//g, 'import("@/live/lib/');
  s = s.replace(/from "@\/components\//g, 'from "@/live/components/').replace(/import\("@\/components\//g, 'import("@/live/components/');
  s = s.replace(/from "@\/slides\//g, 'from "@/live/slides/');
  s = s.replace(/from "@\/app\/\(app\)\/teacher\//g, 'from "@/app/live/teacher/').replace(/from "@\/app\/\(app\)\/student\//g, 'from "@/app/live/student/');
  s = s.replace(/from "@\/app\/present\//g, 'from "@/app/live/present/');
  // API calls.
  s = s.replace(/(["'`])\/api\/(?!swift\/)/g, "$1/api/swift/");
  // Page links (only string/template literals that start with a route).
  for (const [from, to] of ROUTES) {
    const re = new RegExp(`(["'\`])${from.replace(/\//g, "\\/")}(?=["'\`/?#$])`, "g");
    s = s.replace(re, `$1${to}`);
  }
  // Storage buckets shared by name with Synergy Swift's own.
  s = s.replace(/storage(\s*)\.from\("lesson-media"\)/g, 'storage$1.from("live-lesson-media")').replace(/storage(\s*)\.from\("submissions"\)/g, 'storage$1.from("live-submissions")');
  s = s.replace(/(["'])lesson-media\1/g, '"live-lesson-media"');
  // One product name: Synergy Swift (the live module's screens included).
  s = s.replace(/SwiftCipher (Studio|Live|Insights)/g, "Live lessons").replace(/SwiftCipher/g, "Synergy Swift");
  return s;
}

const copied = [];
function copyTree(srcRel, dstRel) {
  const from = join(SC, srcRel), to = join(ROOT, dstRel);
  if (!existsSync(from)) throw new Error(`missing in SwiftCipher: ${srcRel}`);
  const walk = (f, t) => {
    if (statSync(f).isDirectory()) { for (const n of readdirSync(f)) walk(join(f, n), join(t, n)); return; }
    const rel = relative(ROOT, t).replace(/\\/g, "/");
    if (SKIP.some(r => r.test(rel))) return;
    if (KEEP.has(rel) && existsSync(t)) return;
    mkdirSync(dirname(t), { recursive: true });
    if (/\.(ts|tsx|mts)$/.test(f)) writeFileSync(t, rewrite(readFileSync(f, "utf8").replace(/\r\n/g, "\n"), rel));
    else if (/^public\/sandbox\/.*\.js$/.test(rel)) writeFileSync(t, readFileSync(f, "utf8").replace(/SwiftCipher/g, "Synergy Swift"));
    else cpSync(f, t);
    copied.push(rel);
  };
  walk(from, to);
}

// Fresh copy each run (hand-edited KEEP files survive).
for (const [, dst] of COPY) {
  const p = join(ROOT, dst);
  if (!existsSync(p)) continue;
  if (statSync(p).isDirectory()) {
    for (const f of listFiles(p)) { const rel = relative(ROOT, f).replace(/\\/g, "/"); if (!KEEP.has(rel)) rmSync(f); }
  } else if (!KEEP.has(dst)) rmSync(p);
}
function listFiles(d) { return readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? listFiles(p) : [p]; }); }

for (const [src, dst] of COPY) copyTree(src, dst);
console.log(`port-swiftcipher-ui: ${copied.length} files copied from ${SC}`);
