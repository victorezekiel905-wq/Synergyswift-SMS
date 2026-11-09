import { describe, expect, it } from "vitest";
import { filesOf, kindOf, toEntries, KEEP_DAYS, BIN_ROLES } from "@/lib/recycle-bin";
import { NAV } from "@/lib/nav";

const T = "a1000000-0000-0000-0000-000000000000", OTHER = "b1000000-0000-0000-0000-000000000000";

describe("recycle bin", () => {
  it("names what was deleted in plain words", () => {
    expect(kindOf("public", "students")).toBe("Student");
    expect(kindOf("live", "lesson_media")).toBe("Lesson media");
    expect(kindOf("public", "bus_exceptions")).toBe("Bus exception");
  });

  it("finds the stored files of what is deleted for good, only this school's", () => {
    const f = filesOf([
      { schema_name: "public", table_name: "student_documents", op: "delete", data: { path: `${T}/s1/birth-1.pdf` } },
      { schema_name: "public", table_name: "student_documents", op: "delete", data: { path: `${OTHER}/s9/x.pdf` } },
      { schema_name: "public", table_name: "class_story_posts", op: "delete", data: { photos: [`${T}/c/1.jpg`, `${T}/c/2.jpg`, `${T}/../escape.jpg`] } },
      { schema_name: "live", table_name: "lesson_media", op: "delete", data: { storage_path: `${T}/u/clip.mp4` } },
      { schema_name: "public", table_name: "students", op: "unlink", data: { class_group_id: "x" } },
      { schema_name: "public", table_name: "content_packages", op: "delete", data: { id: "p1", tenant_id: T, files: [{ p: "index.html" }, { p: "a/b.js" }] } },
      { schema_name: "public", table_name: "content_packages", op: "delete", data: { id: "p2", tenant_id: OTHER, files: [{ p: "index.html" }] } }
    ], T);
    expect(f.buckets).toEqual({
      "student-documents": [`${T}/s1/birth-1.pdf`],
      "class-story": [`${T}/c/1.jpg`, `${T}/c/2.jpg`],
      "live-lesson-media": [`${T}/u/clip.mp4`]
    });
    expect(f.packages).toEqual([{ id: "p1", paths: ["index.html", "a/b.js"] }]);
  });

  it("shows each deletion with who did it and when it goes for good", () => {
    const at = "2026-11-01T10:00:00.000Z";
    const [e] = toEntries([{ batch: "t42", deleted_at: at, actor_id: "u1", actor: "user", linked: 3, unlinked: 2,
      items: [{ schema: "public", table: "class_groups", label: "JSS 1A" }] }], new Map([["u1", "Mrs Bello"]]));
    expect(e).toMatchObject({ batch: "t42", who: "Mrs Bello", linked: 3, unlinked: 2, more: 0, items: [{ kind: "Class", label: "JSS 1A" }] });
    expect(Date.parse(e!.expires_at) - Date.parse(at)).toBe(KEEP_DAYS * 86_400_000);
    const [gone] = toEntries([{ batch: "t1", deleted_at: at, actor_id: "nobody", actor: "user", linked: 0, unlinked: 0, items: [] }], new Map());
    expect(gone!.who).toBe("Former user");
  });

  it("is in the menu for school admins only", () => {
    const link = NAV.flatMap(g => g.links).find(l => l.href === "/school/recycle-bin");
    expect(link?.roles.sort()).toEqual([...BIN_ROLES].sort());
    expect(link?.roles).not.toContain("teacher");
    expect(link?.roles).not.toContain("principal");
  });
});
