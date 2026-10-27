import { describe, it, expect } from "vitest";
import { usernameFor, startingPassword, studentKeyMessage } from "@/lib/accounts";
import { signInEmail, loginEmailFor, isUsernameEmail, STUDENT_LOGIN_DOMAIN } from "@/lib/login-name";
import { pointTotals, makeGroups, storyPhotoAllowed } from "@/lib/classroom";

describe("automatic sign-ins", () => {
  it("makes usernames parents can type", () => {
    expect(usernameFor({ admission_no: "GC/2026/014", first_name: "Ada", last_name: "Obi" }, "Greenfield-College")).toBe("gc2026014.greenfieldcollege");
    expect(usernameFor({ admission_no: null, first_name: "Chídí", last_name: "Okafor" }, "gc")).toBe("chidio.gc");
    const taken = new Set(["ada.gc", "ada.gc2"]);
    expect(usernameFor({ admission_no: "ADA", first_name: "A", last_name: "B" }, "gc", u => taken.has(u))).toBe("ada.gc3");
  });
  it("turns a username into its hidden sign-in email", () => {
    expect(signInEmail("Ada.GC ")).toBe(`ada.gc@${STUDENT_LOGIN_DOMAIN}`);
    expect(signInEmail("Head@School.ng")).toBe("head@school.ng");
    expect(isUsernameEmail(loginEmailFor("ada.gc"))).toBe(true);
    expect(isUsernameEmail("head@school.ng")).toBe(false);
  });
  it("starting passwords are readable and varied", () => {
    const p = startingPassword();
    expect(p).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    expect(new Set(Array.from({ length: 50 }, startingPassword)).size).toBeGreaterThan(45);
  });
  it("the parents' message carries the details and the link", () => {
    const m = studentKeyMessage({ schoolName: "Greenfield" }, { guardianName: "Mrs Obi", studentName: "Ada Obi", username: "ada.gc", password: "mango-river-1234", link: "https://x/login" });
    expect(m.text).toContain("ada.gc");
    expect(m.text).toContain("mango-river-1234");
    expect(m.wa.text).toContain("https://x/login");
    expect(m.html).not.toContain("<script");
  });
});

describe("classroom points and tools", () => {
  it("adds up points per student and for the class", () => {
    const t = pointTotals([{ student_id: "a", points: 2 }, { student_id: "a", points: -1 }, { student_id: "b", points: 1 }]);
    expect(t.byStudent.get("a")).toEqual({ positive: 2, needsWork: 1, net: 1 });
    expect(t.classNet).toBe(2);
    expect(t.positiveShare).toBe(75);
    expect(pointTotals([]).positiveShare).toBeNull();
  });
  it("makes fair groups", () => {
    const g = makeGroups(Array.from({ length: 10 }, (_, i) => i), 3, () => 0.5);
    expect(g.map(x => x.length).sort()).toEqual([3, 3, 4]);
    expect(g.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(makeGroups([], 4)).toEqual([[]]);
  });
  it("only shows children whose parents agreed to photos", () => {
    expect(storyPhotoAllowed(["a", "b"], new Set(["a"]), true)).toEqual({ ok: false, missing: ["b"] });
    expect(storyPhotoAllowed(["a", "b"], new Set(), false).ok).toBe(true);
  });
});
