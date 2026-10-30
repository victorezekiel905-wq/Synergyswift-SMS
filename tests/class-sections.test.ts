import { describe, it, expect } from "vitest";
import { organiseStudentList, splitName, className, looksLikeClass } from "@/lib/class-sections";
import { fillAdmissionNumbers } from "@/lib/admission-numbers";
import { parseGrid } from "@/lib/spreadsheet";
import { autoMap, entity } from "@/lib/importers";

const students = entity("students")!;
const col = (t: { headers: string[] }, k: string) => autoMap(students, t.headers)[k];

describe("a whole school's student list, organised by class", () => {
  it("class headings with the column names repeated under each class", () => {
    const grid = parseGrid([
      "GREENFIELD COLLEGE, STUDENT LIST 2026",
      "JSS 1A", "Adm No,Surname,First Name,Gender", "001,Obi,Ada,F", "002,Bello,Tunde,M",
      "JSS 1B", "Adm No,Surname,First Name,Gender", "003,Okafor,Chidi,M"
    ].join("\n"));
    const o = organiseStudentList(grid)!;
    expect(o.classes).toEqual([{ name: "JSS 1A", students: 2 }, { name: "JSS 1B", students: 1 }]);   // the title isn't a class
    expect(o.table.rows).toHaveLength(3);
    const c = col(o.table, "class"), f = col(o.table, "first_name"), l = col(o.table, "last_name");
    expect(o.table.rows.map(r => `${r[f]} ${r[l]} / ${r[c]}`)).toEqual(["Ada Obi / JSS 1A", "Tunde Bello / JSS 1A", "Chidi Okafor / JSS 1B"]);
  });

  it("column names once at the top, then each class as a heading (semicolons, counts after the name)", () => {
    const grid = parseGrid(["Surname;First name;Date of birth", "Primary 3 Gold (2 pupils)", "Adeyemi;Tobi;21/03/2016", "Eze;Amaka;02/07/2016", "Class: Primary 4 Blue", "Musa;Ibrahim;11/11/2015"].join("\n"));
    const o = organiseStudentList(grid)!;
    expect(o.classes.map(c => c.name)).toEqual(["Primary 3 Gold", "Primary 4 Blue"]);
    expect(o.table.rows.map(r => r[col(o.table, "date_of_birth")])).toEqual(["21/03/2016", "02/07/2016", "11/11/2015"]);
  });

  it("just names under each class, with no column names at all", () => {
    const o = organiseStudentList(parseGrid(["JSS1 Gold", "OBI Ada Chiamaka", "Tunde Bello", "SSS 2 Science", "Okafor, Chidi"].join("\n")))!;
    expect(o.namesSplit).toBe(true);
    expect(o.classes).toEqual([{ name: "JSS1 Gold", students: 2 }, { name: "SSS 2 Science", students: 1 }]);
    const f = col(o.table, "first_name"), l = col(o.table, "last_name"), x = col(o.table, "other_names");
    expect(o.table.rows.map(r => [r[f], r[l], r[x]])).toEqual([["Ada", "OBI", "Chiamaka"], ["Tunde", "Bello", ""], ["Chidi", "Okafor", ""]]);
  });

  it("a single Name column is split into first and last names", () => {
    const o = organiseStudentList(parseGrid(["S/N,Student Name,Gender", "Year 7 Blue", "1,Ada Obi,F", "Year 8 Red", "2,Musa Ibrahim,M"].join("\n")))!;
    expect(o.namesSplit).toBe(true);
    expect(o.table.rows.map(r => `${r[col(o.table, "first_name")]}|${r[col(o.table, "last_name")]}|${r[col(o.table, "class")]}`)).toEqual(["Ada|Obi|Year 7 Blue", "Musa|Ibrahim|Year 8 Red"]);
  });

  it("an ordinary spreadsheet with a Class column is left as it is", () => {
    expect(organiseStudentList(parseGrid(["Adm No,Surname,First Name,Class", "001,Obi,Ada,JSS 1A", "002,Bello,Tunde,JSS 1B"].join("\n")))).toBeNull();
  });

  it("reads a file whose first line is a class heading (the separator comes from the next line)", () => {
    const grid = parseGrid(["JSS 1A", "Adm No;Surname;First Name", "001;Obi;Ada"].join("\n"));
    expect(grid[1]).toEqual(["Adm No", "Surname", "First Name"]);
    expect(organiseStudentList(grid)!.classes).toEqual([{ name: "JSS 1A", students: 1 }]);
  });
});

describe("names and class headings", () => {
  it("splits names written the ways registers write them", () => {
    expect(splitName("Obi, Ada Chiamaka")).toEqual({ first: "Ada", last: "Obi", other: "Chiamaka" });
    expect(splitName("OBI Ada Chiamaka")).toEqual({ first: "Ada", last: "OBI", other: "Chiamaka" });
    expect(splitName("Ada Chiamaka Obi")).toEqual({ first: "Ada", last: "Obi", other: "Chiamaka" });
  });
  it("tidies class headings", () => {
    expect(className("Class: JSS 1A")).toBe("JSS 1A");
    expect(className("YEAR 7 BLUE (28 students)")).toBe("YEAR 7 BLUE");
    expect(className("Primary 4 - 31 pupils")).toBe("Primary 4");
  });
  it("tells a class from a pupil in a list of names", () => {
    for (const s of ["JSS 1", "SS2 Art", "Primary 3", "Year 7 Blue", "Grade 5", "Nursery 2", "Reception", "Basic 4"]) expect(looksLikeClass(s), s).toBe(true);
    for (const s of ["Ada Obi", "Tunde Bello", "Grace Joseph"]) expect(looksLikeClass(s), s).toBe(false);
  });
});

describe("admission numbers for a list without them", () => {
  const existing = [{ admission_no: "2026/0007", first_name: "Ada", last_name: "Obi", class_name: "JSS 1A" }, { admission_no: "OLD-1", first_name: "X", last_name: "Y", class_name: null }];
  it("a student already in the school keeps their number; new ones continue the year's series", () => {
    const r = fillAdmissionNumbers([
      { admission_no: "", first_name: "Ada", last_name: "Obi", class_name: "jss 1a" },
      { admission_no: "", first_name: "Tunde", last_name: "Bello", class_name: "JSS 1A" },
      { admission_no: "GFC/9", first_name: "Chidi", last_name: "Okafor", class_name: "JSS 1B" },
      { admission_no: "", first_name: "Musa", last_name: "Ibrahim", class_name: "JSS 1B" }
    ], existing, 2026);
    expect(r.numbers).toEqual(["2026/0007", "2026/0008", "GFC/9", "2026/0009"]);
    expect(r).toMatchObject({ reused: 1, made: 2 });
  });
  it("never gives a number that is already taken", () => {
    const r = fillAdmissionNumbers([{ admission_no: "2026/0001", first_name: "A", last_name: "B", class_name: "" }, { admission_no: "", first_name: "C", last_name: "D", class_name: "" }], [], 2026);
    expect(r.numbers).toEqual(["2026/0001", "2026/0002"]);
  });
});
