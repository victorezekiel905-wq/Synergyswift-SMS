import { describe, expect, it } from "vitest";
import { accessAreas, classesFrom, roleLabel, teamPrivileges } from "@/lib/my-access";

const hrefs = (roles: string[], modules: Record<string, boolean> = {}, denied: string[] = []) =>
  accessAreas(new Set(roles), modules, denied).flatMap(g => g.links.map(l => l.href));

describe("my access: what a member of staff's roles open", () => {
  it("a teacher gets teaching pages, not the school office", () => {
    const h = hrefs(["teacher"]);
    expect(h).toContain("/teacher");
    expect(h).toContain("/school/results");
    expect(h).not.toContain("/school/setup");
    expect(h).not.toContain("/school/fees");
    expect(h).not.toContain("/dashboard");          // everyone has it: not listed
  });
  it("an extra role adds its pages", () => {
    expect(hrefs(["teacher"])).not.toContain("/school/exams-office");
    expect(hrefs(["teacher", "exam_officer"])).toContain("/school/exams-office");
    expect(hrefs(["bursar"])).toContain("/school/fees");
  });
  it("modules the school does not have, or took away from the role, are left out", () => {
    expect(hrefs(["bursar"], { fees: false })).not.toContain("/school/fees");
    expect(hrefs(["bursar"], {}, ["fees"])).not.toContain("/school/fees");
  });
  it("roles and class team privileges in words", () => {
    expect(roleLabel("exam_officer")).toBe("Exam officer");
    expect(roleLabel("new_role")).toBe("New role");
    expect(teamPrivileges({ can_teach_live: true, can_give_points: false, can_see_results: true })).toEqual(["Live lessons", "See results"]);
  });
});

describe("my access: classes", () => {
  it("one entry per class with form teacher, subjects and class team", () => {
    const c = classesFrom({
      forms: [{ id: "a", name: "JSS 1A" }],
      offerings: [{ class_group_id: "a", class_name: "JSS 1A", subject: "Maths" }, { class_group_id: "b", class_name: "JSS 2B", subject: "Physics" },
        { class_group_id: "b", class_name: "JSS 2B", subject: "Maths" }],
      team: [{ class_group_id: "c", class_name: "JSS 10C", role: "assistant", subject: null, row: { can_post_story: true } }]
    });
    expect(c.map(x => x.name)).toEqual(["JSS 1A", "JSS 2B", "JSS 10C"]);
    expect(c[0]).toMatchObject({ form: true, subjects: ["Maths"] });
    expect(c[1]).toMatchObject({ form: false, subjects: ["Maths", "Physics"] });
    expect(c[2].team).toEqual([{ role: "assistant", subject: null, privileges: ["Class story"] }]);
  });
});
