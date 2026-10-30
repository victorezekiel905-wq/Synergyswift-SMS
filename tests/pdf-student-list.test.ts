import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pdfRows } from "@/lib/pdf-rows";
import { organiseStudentList } from "@/lib/class-sections";
import { autoMap, entity } from "@/lib/importers";

// tests/fixtures/student-list.pdf: a title, then JSS 1A, JSS 1B and SSS 2 Science, each a heading with a table under it.
describe("a school's student list as a PDF", () => {
  it("is read line by line and organised by class", async () => {
    const rows = await pdfRows(new Uint8Array(readFileSync(join(__dirname, "fixtures", "student-list.pdf"))));
    const o = organiseStudentList(rows)!;
    expect(o).not.toBeNull();
    expect(o.classes).toEqual([{ name: "JSS 1A", students: 3 }, { name: "JSS 1B", students: 2 }, { name: "SSS 2 Science", students: 1 }]);
    const m = autoMap(entity("students")!, o.table.headers);
    expect(o.table.rows.map(r => `${r[m.admission_no]} ${r[m.first_name]} ${r[m.last_name]} ${r[m.gender]} / ${r[m.class]}`)).toEqual([
      "001 Ada Obi F / JSS 1A", "002 Tunde Bello M / JSS 1A", "003 Amaka Eze F / JSS 1A",
      "004 Chidi Okafor M / JSS 1B", "005 Ibrahim Musa M / JSS 1B", "006 Tobi Adeyemi M / SSS 2 Science"
    ]);
  });
});
