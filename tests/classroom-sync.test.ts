import { describe, it, expect } from "vitest";
import { authorizeUrl, makeState, readState, googleCourseWork, teamsAssignment, oneNotePage, matchGrades } from "@/lib/classroom-sync";

describe("sign-in", () => {
  it("builds consent addresses", () => {
    const g = new URL(authorizeUrl("google", { clientId: "cid", redirectUri: "https://s/api/connect/google/callback", state: "st" }));
    expect(g.origin).toBe("https://accounts.google.com");
    expect(g.searchParams.get("access_type")).toBe("offline");
    expect(g.searchParams.get("scope")).toContain("classroom.coursework.students");
    const m = new URL(authorizeUrl("microsoft", { clientId: "cid", redirectUri: "https://s/cb", state: "st", msTenant: "contoso.onmicrosoft.com" }));
    expect(m.pathname).toBe("/contoso.onmicrosoft.com/oauth2/v2.0/authorize");
    expect(m.searchParams.get("scope")).toContain("offline_access");
  });
  it("signs and checks the state", () => {
    const s = makeState("secret", "u1", "google", 1_000_000);
    expect(readState("secret", s, 1_000_000 + 60_000)).toEqual({ userId: "u1", provider: "google" });
    expect(readState("other", s, 1_000_000)).toBeNull();
    expect(readState("secret", s, 1_000_000 + 11 * 60_000)).toBeNull();
    // Tampered: the signature's first character changed (always a different one).
    const [body, sig] = s.split(".");
    expect(readState("secret", `${body}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`, 1_000_000)).toBeNull();
    expect(readState("secret", "nonsense", 1_000_000)).toBeNull();
  });
});

describe("homework across", () => {
  const h = { title: "Fractions", instructions: "Do page 4 & 5", due_at: "2026-10-20T15:30:00Z", max_score: 20, attachment_url: "https://files/x.pdf", link: "https://s/student" };
  it("for Classroom", () => {
    const c = googleCourseWork(h);
    expect(c).toMatchObject({ title: "Fractions", workType: "ASSIGNMENT", state: "PUBLISHED", maxPoints: 20, dueDate: { year: 2026, month: 10, day: 20 }, dueTime: { hours: 15, minutes: 30 } });
    expect(c.materials).toHaveLength(2);
    expect(c.description).toContain("https://s/student");
    expect(googleCourseWork({ ...h, max_score: null, attachment_url: "http://insecure" }).materials).toHaveLength(1);
  });
  it("for Teams", () => {
    const t = teamsAssignment(h);
    expect(t.instructions.content).toContain("Do page 4 &amp; 5");
    expect(t.grading).toMatchObject({ maxPoints: 20 });
    expect(t.dueDateTime).toBe("2026-10-20T15:30:00.000Z");
  });
  it("lesson notes for OneNote", () => {
    const p = oneNotePage({ topic: "Photosynthesis <intro>", content: "Para one\nline two\n\nPara two", subject: "Biology", class_name: "SS1", week: 3 });
    expect(p).toContain("<title>Photosynthesis &lt;intro&gt;</title>");
    expect(p).toContain("<p>Para one<br/>line two</p><p>Para two</p>");
    expect(p).toContain("Biology · SS1 · Week 3");
  });
});

describe("marks back", () => {
  it("match by email and scale", () => {
    const r = matchGrades([
      { email: "Ada@School.edu", points: 8, max: 10 }, { email: "bayo@school.edu", points: null, max: 10 },
      { email: "stranger@x.com", points: 5, max: 10 }, { email: "chi@school.edu", points: 15, max: 20 }
    ], [{ id: "s1", email: "ada@school.edu" }, { id: "s2", email: "bayo@school.edu" }, { id: "s3", email: "chi@school.edu" }], 20);
    expect(r.matched).toEqual([{ student_id: "s1", score: 16 }, { student_id: "s3", score: 15 }]);
    expect(r.unmatched).toEqual(["stranger@x.com"]);
  });
});
