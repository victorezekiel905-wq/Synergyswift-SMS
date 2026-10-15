import { describe, it, expect } from "vitest";
import vm from "node:vm";
import {
  safeZipPath, commonRoot, mimeFor, readScormManifest, readTincan, readH5pJson, detectPackage, signToken, verifyToken, scorm12Seconds, isoSeconds,
  secondsTo12, secondsToIso, scormOutcome, bestStatus, keepValues, initialValues, scormRuntime, injectIntoHtml, xapiOutcome
} from "@/lib/content";
import { stepStates, pathSummary, prerequisiteCycle, markQuizStep, splitIntoRooms, meetingProvider, lessonWindow, zoomMeetingBody, toBankQuestion } from "@/lib/learning";

const SCORM12 = `<?xml version="1.0"?>
<manifest identifier="com.example.fractions" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1"><title>Fractions &amp; decimals</title>
      <item identifier="I1" identifierref="RES1"><title>Lesson 1</title><adlcp:masteryscore>70</adlcp:masteryscore></item>
    </organization>
  </organizations>
  <resources><resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="shared/launch.html"><file href="shared/launch.html"/></resource></resources>
</manifest>`;
const SCORM2004 = `<manifest identifier="M2" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="O"><organization identifier="O"><title>Cells</title>
    <item identifier="I" identifierref="R" parameters="?lang=en"><title>Cells 1</title>
      <imsss:sequencing><imsss:objectives><imsss:primaryObjective satisfiedByMeasure="true"><imsss:minNormalizedMeasure>0.8</imsss:minNormalizedMeasure></imsss:primaryObjective></imsss:objectives></imsss:sequencing>
    </item></organization></organizations>
  <resources xml:base="content/"><resource identifier="R" adlcp:scormType="sco" type="webcontent" href="index.html"/></resources>
</manifest>`;

describe("package files", () => {
  it("refuses unsafe zip paths", () => {
    expect(safeZipPath("a/b.html")).toBe("a/b.html");
    expect(safeZipPath("a\\b.html")).toBe("a/b.html");
    expect(safeZipPath("./index.html")).toBe("index.html");
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a/", "__MACOSX/a", "a/.DS_Store", "a//b"]) expect(safeZipPath(bad)).toBeNull();
  });
  it("finds a single top folder", () => {
    expect(commonRoot(["pkg/index.html", "pkg/a/b.js"])).toBe("pkg/");
    expect(commonRoot(["index.html", "pkg/a.js"])).toBe("");
  });
  it("knows content types", () => {
    expect(mimeFor("a/B.HTML")).toMatch(/text\/html/);
    expect(mimeFor("x.woff2")).toBe("font/woff2");
    expect(mimeFor("x.exe")).toBe("application/octet-stream");
  });
});

describe("manifests", () => {
  it("reads SCORM 1.2", () => {
    const r = readScormManifest(SCORM12)!;
    expect(r.kind).toBe("scorm12");
    expect(r.launch).toBe("shared/launch.html");
    expect(r.mastery).toBe(70);
    expect(r.title).toBe("Fractions & decimals");
  });
  it("reads SCORM 2004 with a base folder and parameters", () => {
    const r = readScormManifest(SCORM2004)!;
    expect(r.kind).toBe("scorm2004");
    expect(r.launch).toBe("content/index.html?lang=en");
    expect(r.mastery).toBe(80);
    expect(r.title).toBe("Cells");
  });
  it("reads xAPI and H5P packages", () => {
    const t = readTincan(`<tincan><activities><activity id="http://x.org/act/1" type="http://adlnet.gov/expapi/activities/course"><name>Volcanoes</name><launch lang="en-US">story.html</launch></activity></activities></tincan>`)!;
    expect(t).toMatchObject({ kind: "xapi", launch: "story.html", title: "Volcanoes", meta: { activity_id: "http://x.org/act/1" } });
    const h = readH5pJson(JSON.stringify({ title: "Quiz", mainLibrary: "H5P.MultiChoice", preloadedDependencies: [{}, {}] }))!;
    expect(h).toMatchObject({ kind: "h5p", launch: "__h5p", title: "Quiz", meta: { libraries: 2 } });
    expect(readH5pJson("not json")).toBeNull();
  });
  it("detects the kind and checks the launch page exists", async () => {
    const files: Record<string, string> = { "imsmanifest.xml": SCORM12, "shared/launch.html": "<html>" };
    const read = async (p: string) => files[p] ?? null;
    expect(await detectPackage(Object.keys(files), read)).toMatchObject({ kind: "scorm12" });
    expect(await detectPackage(["imsmanifest.xml"], read)).toMatchObject({ error: expect.stringMatching(/missing/) });
    expect(await detectPackage(["h5p.json"], async () => JSON.stringify({ mainLibrary: "X" }))).toMatchObject({ error: expect.stringMatching(/content.json/) });
    expect(await detectPackage(["a/page.html", "b.html"], read)).toMatchObject({ kind: "html", launch: "b.html" });
    expect(await detectPackage(["notes.txt"], read)).toHaveProperty("error");
  });
});

describe("launch tokens", () => {
  const key = Buffer.from("k".repeat(32));
  const tok = { t: "T", p: "P", u: "U", a: "A", k: "scorm12" as const, e: Math.floor(Date.now() / 1000) + 60 };
  it("round-trips and resists tampering or expiry", () => {
    const s = signToken(tok, key);
    expect(verifyToken(s, key)).toEqual(tok);
    expect(verifyToken(s, Buffer.from("x".repeat(32)))).toBeNull();
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ ...tok, u: "someone-else" })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, key)).toBeNull();
    expect(verifyToken(`${body}.`, key)).toBeNull();
    expect(verifyToken(signToken({ ...tok, e: 1 }, key), key)).toBeNull();
    expect(verifyToken(signToken({ ...tok, e: 1 }, key), key, Date.now(), true)).toMatchObject({ u: "U" });
  });
});

describe("SCORM", () => {
  it("converts times", () => {
    expect(scorm12Seconds("0001:02:03.50")).toBe(3724);
    expect(scorm12Seconds("junk")).toBe(0);
    expect(isoSeconds("PT1H2M3.5S")).toBe(3724);
    expect(isoSeconds("P1DT1M")).toBe(86460);
    expect(secondsTo12(3724)).toBe("0001:02:04");
    expect(secondsTo12(3725)).toBe("0001:02:05");
    expect(secondsToIso(3725)).toBe("PT1H2M5S");
  });
  it("reads SCORM 1.2 results and applies the mastery score", () => {
    expect(scormOutcome("scorm12", { "cmi.core.lesson_status": "completed", "cmi.core.score.raw": "8", "cmi.core.score.max": "10", "cmi.core.session_time": "0000:05:00" }))
      .toEqual({ status: "completed", score: 80, seconds: 300 });
    expect(scormOutcome("scorm12", { "cmi.core.lesson_status": "completed", "cmi.core.score.raw": "60" }, 70).status).toBe("failed");
    expect(scormOutcome("scorm12", { "cmi.core.lesson_status": "incomplete", "cmi.core.score.raw": "75" }, 70).status).toBe("passed");
    expect(scormOutcome("scorm12", { "cmi.core.lesson_status": "browsed" }).status).toBe("incomplete");
  });
  it("reads SCORM 2004 results", () => {
    expect(scormOutcome("scorm2004", { "cmi.completion_status": "completed", "cmi.success_status": "passed", "cmi.score.scaled": "0.92", "cmi.session_time": "PT10M" }))
      .toEqual({ status: "passed", score: 92, seconds: 600 });
    expect(scormOutcome("scorm2004", { "cmi.completion_status": "incomplete", "cmi.score.raw": "3", "cmi.score.max": "4" })).toMatchObject({ status: "incomplete", score: 75 });
  });
  it("never moves backwards", () => {
    expect(bestStatus("passed", "incomplete")).toBe("passed");
    expect(bestStatus("failed", "passed")).toBe("passed");
    expect(bestStatus("not_attempted", "incomplete")).toBe("incomplete");
  });
  it("keeps only data-model values, within limits", () => {
    const k = keepValues({ "cmi.core.lesson_location": "p1" }, { "cmi.core.lesson_location": "p2", "cmi.core.session_time": "0000:01:00", "cmi.core.exit": "suspend", "evil.key": "x", "cmi.suspend_data": "a".repeat(70000) });
    expect(k["cmi.core.lesson_location"]).toBe("p2");
    expect(k).not.toHaveProperty("cmi.core.session_time");
    expect(k).not.toHaveProperty("evil.key");
    expect(k["cmi.suspend_data"]).toHaveLength(64000);
    expect(() => keepValues({}, Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`cmi.interactions.${i}.learner_response`, "x".repeat(3000)])))).toThrow(/too much/);
  });
  it("starts and resumes", () => {
    const first = initialValues("scorm12", { values: {}, status: "not_attempted", seconds: 0, learnerId: "u1", learnerName: "Obi, Ada", mastery: 70 });
    expect(first).toMatchObject({ "cmi.core.entry": "ab-initio", "cmi.core.lesson_status": "not attempted", "cmi.student_data.mastery_score": "70", "cmi.core.student_name": "Obi, Ada" });
    const again = initialValues("scorm2004", { values: { "cmi.location": "5" }, status: "incomplete", seconds: 65, learnerId: "u1", learnerName: "Ada", mastery: 80 });
    expect(again).toMatchObject({ "cmi.entry": "resume", "cmi.location": "5", "cmi.total_time": "PT0H1M5S", "cmi.scaled_passing_score": "0.8" });
  });
  it("the runtime answers the package and reports changes to the player", () => {
    const run = (kind: "scorm12" | "scorm2004", values: Record<string, string>) => {
      const sent: any[] = [];
      const win: any = { addEventListener() {} };
      win.top = { postMessage: (m: unknown) => sent.push(m) };
      const code = scormRuntime(kind, values, "N1").replace(/^<script>|<\/script>$/g, "");
      vm.runInNewContext(code, { window: win });
      return { win, sent };
    };
    const { win, sent } = run("scorm12", { "cmi.core.lesson_status": "not attempted", "cmi.interactions.0.id": "q1", "cmi.interactions.1.id": "q2" });
    const api = win.API;
    expect(api.LMSInitialize("")).toBe("true");
    expect(api.LMSGetValue("cmi.core.lesson_status")).toBe("not attempted");
    expect(api.LMSGetValue("cmi.interactions._count")).toBe("2");
    expect(api.LMSSetValue("cmi.core.lesson_status", "completed")).toBe("true");
    expect(api.LMSSetValue("window.location", "x")).toBe("false");
    expect(api.LMSCommit("")).toBe("true");
    expect(sent[0]).toEqual({ type: "ecf-scorm", n: "N1", values: { "cmi.core.lesson_status": "completed" }, finish: false });
    api.LMSSetValue("cmi.core.score.raw", "90");
    expect(api.LMSFinish("")).toBe("true");
    expect(sent[1]).toMatchObject({ values: { "cmi.core.score.raw": "90" }, finish: true });
    expect(api.LMSSetValue("cmi.core.score.raw", "10")).toBe("false");
    const v2 = run("scorm2004", {}).win.API_1484_11;
    expect(v2.Initialize("")).toBe("true");
    expect(v2.GetValue("cmi._version")).toBe("1.0");
  });
  it("puts the runtime first in the page and cannot be broken out of", () => {
    expect(injectIntoHtml("<html><head><title>x</title></head></html>", "<s>")).toBe("<html><head><s><title>x</title></head></html>");
    expect(injectIntoHtml("<p>hi</p>", "<s>")).toBe("<s><p>hi</p>");
    expect(scormRuntime("scorm12", { "cmi.suspend_data": "</script><script>alert(1)</script>" }, "n")).not.toMatch(/<\/script><script>alert/);
  });
});

describe("xAPI", () => {
  const V = "http://adlnet.gov/expapi/verbs/";
  it("reads progress from statements", () => {
    expect(xapiOutcome({ verb: { id: `${V}passed` }, result: { score: { scaled: 0.85 } } })).toEqual({ status: "passed", score: 85 });
    expect(xapiOutcome({ verb: { id: `${V}completed` }, result: { success: false, score: { raw: 4, max: 10 } } })).toEqual({ status: "failed", score: 40 });
    expect(xapiOutcome({ verb: { id: `${V}completed` } }).status).toBe("completed");
    expect(xapiOutcome({ verb: { id: `${V}experienced` } }).status).toBe("incomplete");
    expect(xapiOutcome({ verb: { id: "http://example.com/verbs/liked" } }).status).toBeNull();
  });
});

describe("learning paths", () => {
  const steps = [
    { id: "a", position: 0, kind: "text", requires: [], pass_pct: 0 },
    { id: "b", position: 1, kind: "quiz", requires: ["a"], pass_pct: 60 },
    { id: "c", position: 2, kind: "content", requires: ["a", "b"], pass_pct: 0 },
    { id: "d", position: 3, kind: "link", requires: ["gone"], pass_pct: 0 }
  ];
  it("locks steps until their prerequisites are finished", () => {
    let s = stepStates(steps, []);
    expect(s.map(x => x.state)).toEqual(["open", "locked", "locked", "open"]);
    s = stepStates(steps, [{ step_id: "a", status: "done", score: null }, { step_id: "b", status: "failed", score: 40 }]);
    expect(s.map(x => x.state)).toEqual(["done", "open", "locked", "open"]);
    expect(s[2].waiting).toEqual(["b"]);
    s = stepStates(steps, [{ step_id: "a", status: "done", score: null }, { step_id: "b", status: "passed", score: 80 }]);
    expect(s[2].state).toBe("open");
    expect(pathSummary(steps, [{ step_id: "a", status: "done", score: null }, { step_id: "x", status: "done", score: null }])).toEqual({ done: 1, total: 4, pct: 25, complete: false });
  });
  it("finds prerequisite loops", () => {
    expect(prerequisiteCycle(steps)).toBeNull();
    expect(prerequisiteCycle([{ id: "a", requires: ["c"] }, { id: "b", requires: ["a"] }, { id: "c", requires: ["b"] }])).toEqual(["a", "c", "b", "a"]);
    expect(prerequisiteCycle([{ id: "a", requires: ["a"] }])).toEqual(["a", "a"]);
  });
  it("marks quiz steps", () => {
    const qs = [
      { id: "q1", type: "mcq_single", prompt: "?", points: 1, data: { options: [{ id: "a", text: "1" }, { id: "b", text: "2" }] }, answer: { correct: "b" } },
      { id: "q2", type: "numeric", prompt: "?", points: 1, data: {}, answer: { value: 0.5, tolerance: 0.01 } },
      { id: "q3", type: "essay", prompt: "?", points: 5, data: {}, answer: {} }
    ] as any;
    expect(markQuizStep(qs, { q1: "b", q2: "0.5" }, 60)).toMatchObject({ pct: 100, passed: true, right: { q1: true, q2: true } });
    expect(markQuizStep(qs, { q1: "a", q2: "0.5" }, 60)).toMatchObject({ pct: 50, passed: false, right: { q1: false } });
  });
});

describe("breakout rooms and online lessons", () => {
  it("splits evenly", () => {
    const rooms = splitIntoRooms(["a", "b", "c", "d", "e", "f", "g"], 3);
    expect(rooms.map(r => r.length).sort()).toEqual([2, 2, 3]);
    expect(rooms.flat().sort()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(splitIntoRooms(["a", "b"], 5)).toHaveLength(2);
    expect(splitIntoRooms([], 3)).toEqual([[]]);
    expect(splitIntoRooms(["a", "b", "c"], 2, false)).toEqual([["a", "c"], ["b"]]);
  });
  it("recognises meeting links", () => {
    expect(meetingProvider("https://us02web.zoom.us/j/123?pwd=x")).toBe("zoom");
    expect(meetingProvider("https://meet.google.com/abc-defg-hij")).toBe("meet");
    expect(meetingProvider("https://teams.microsoft.com/l/meetup-join/x")).toBe("teams");
    expect(meetingProvider("https://example.org/room")).toBe("other");
    expect(meetingProvider("http://zoom.us/j/1")).toBeNull();
    expect(meetingProvider("javascript:alert(1)")).toBeNull();
    expect(meetingProvider("https://user:pw@zoom.us/j/1")).toBeNull();
    expect(meetingProvider("https://zoom.us.evil.com/j/1")).toBe("other");
  });
  it("opens 15 minutes early and closes at the end", () => {
    const at = "2026-05-04T09:00:00Z";
    expect(lessonWindow(at, 40, new Date("2026-05-04T08:40:00Z"))).toBe("upcoming");
    expect(lessonWindow(at, 40, new Date("2026-05-04T08:46:00Z"))).toBe("open");
    expect(lessonWindow(at, 40, new Date("2026-05-04T09:39:00Z"))).toBe("open");
    expect(lessonWindow(at, 40, new Date("2026-05-04T09:41:00Z"))).toBe("ended");
  });
  it("asks Zoom for a safe meeting", () => {
    const b = zoomMeetingBody({ title: "JSS1 Maths", startsAt: "2026-05-04T09:00:00.000Z", durationMin: 40, timezone: "Africa/Lagos" });
    expect(b).toMatchObject({ type: 2, start_time: "2026-05-04T09:00:00Z", duration: 40, settings: { waiting_room: true, join_before_host: false } });
  });
});

describe("drafted questions", () => {
  const base = { prompt: "What is 1/2 + 1/4?", options: [], correct_option: null, correct_true: null, accepted_answers: [], numeric_answer: null, tolerance: null, unit: null,
    explanation: "Use a common denominator.", difficulty: "easy" as const, bloom: "apply", objective: null };
  it("converts each type to the question bank's format", () => {
    expect(toBankQuestion({ ...base, type: "mcq_single", options: ["1/6", "3/4", "2/6", "1/8"], correct_option: 1 })).toMatchObject({ data: { options: [{ id: "a" }, { id: "b", text: "3/4" }, {}, {}] }, answer: { correct: "b" } });
    expect(toBankQuestion({ ...base, type: "true_false", correct_true: false })).toMatchObject({ answer: { correct: false } });
    expect(toBankQuestion({ ...base, type: "short_answer", accepted_answers: ["3/4", " three quarters ", "3/4"] })).toMatchObject({ answer: { accepted: ["3/4", "three quarters"] } });
    expect(toBankQuestion({ ...base, type: "numeric", numeric_answer: 0.75, tolerance: -0.01, unit: "" })).toMatchObject({ data: { unit: null }, answer: { value: 0.75, tolerance: 0.01 } });
  });
  it("drops questions that cannot be marked", () => {
    expect(toBankQuestion({ ...base, type: "mcq_single", options: ["a", "b"], correct_option: 5 })).toBeNull();
    expect(toBankQuestion({ ...base, type: "mcq_single", options: ["same", "Same"], correct_option: 0 })).toBeNull();
    expect(toBankQuestion({ ...base, type: "true_false" })).toBeNull();
    expect(toBankQuestion({ ...base, type: "short_answer", accepted_answers: [" "] })).toBeNull();
    expect(toBankQuestion({ ...base, type: "numeric" })).toBeNull();
  });
});
