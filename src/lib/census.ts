/**
 * The annual school census (the state ministry / UBEC return): enrolment by
 * class and sex, ages, new entrants, repeaters, children with special needs,
 * staff by sex, role and qualification, classrooms and ratios. Worked out
 * from the school's own records; the admin checks and edits before sending.
 * Pure and unit tested.
 */

export type CensusStudent = { id: string; gender: string | null; date_of_birth: string | null; level: string; admitted_on: string | null };
export type CensusStaff = { id: string; gender: string | null; teaching: boolean; qualifications: { kind: string; title: string; reference_no: string | null }[] };
export type CensusInput = {
  period: string;          // 2026/2027
  asOf: string;            // census day, YYYY-MM-DD
  yearStarts: string;      // first day of the school year, for new entrants
  profile: Record<string, string>;
  students: CensusStudent[];
  repeaters: Set<string>;
  sen: { student_id: string; needs: string[] }[];
  staff: CensusStaff[];
  classrooms: number;
};

type MF = { male: number; female: number; other: number; total: number };
const mf = (): MF => ({ male: 0, female: 0, other: 0, total: 0 });
const add = (t: MF, g: string | null) => {
  const k = g === "male" || g === "female" ? g : "other";
  t[k]++; t.total++;
};

/** Age in whole years on a date. */
export function ageOn(dob: string | null, on: string): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const [y, m, d] = dob.slice(0, 10).split("-").map(Number), [Y, M, D] = on.split("-").map(Number);
  let a = Y - y;
  if (M < m || (M === m && D < d)) a--;
  return a >= 0 && a < 120 ? a : null;
}

export const AGE_BANDS = ["under 6", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "over 18", "not recorded"] as const;
export function ageBand(age: number | null): (typeof AGE_BANDS)[number] {
  if (age === null) return "not recorded";
  if (age < 6) return "under 6";
  if (age > 18) return "over 18";
  return String(age) as (typeof AGE_BANDS)[number];
}

/** Highest qualification, in the order the census asks. */
const QUAL_ORDER: [string, RegExp][] = [
  ["PhD", /\bph\.?\s?d|doctor/i], ["Master's", /\bm\.?\s?(sc|a|ed|phil)\b|master/i], ["PGDE", /pgde|post.?graduate diploma/i],
  ["B.Ed / degree in education", /\bb\.?\s?ed\b|b\.?\s?a\.?\s?\(ed|b\.?\s?sc\.?\s?\(ed|education/i], ["Other degree", /\bb\.?\s?(sc|a|eng|tech)\b|bachelor|degree|hnd/i],
  ["NCE", /\bnce\b|national certificate in education/i], ["OND / diploma", /\bond\b|diploma/i], ["SSCE / below", /ssce|waec|neco|gce|primary/i]
];
export function highestQualification(q: CensusStaff["qualifications"]): string {
  const titles = q.map(x => `${x.kind} ${x.title}`);
  for (const [label, re] of QUAL_ORDER) if (titles.some(t => re.test(t))) return label;
  return q.some(x => x.kind === "degree") ? "Other degree" : q.length ? "Other" : "Not recorded";
}
/** TRCN registration is recorded as a professional qualification with its number. */
export const trcnRegistered = (q: CensusStaff["qualifications"]) => q.some(x => /trcn|teachers registration council/i.test(`${x.title} ${x.reference_no ?? ""}`) && Boolean(x.reference_no));

const levelSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function censusReturn(i: CensusInput) {
  const levels = [...new Set(i.students.map(s => s.level))].sort(levelSort);
  const enrolment: Record<string, MF> = {}, entrants: Record<string, MF> = {}, repeaters: Record<string, MF> = {};
  const ages: Record<string, Record<string, MF>> = {};
  const all = mf();
  for (const l of levels) { enrolment[l] = mf(); entrants[l] = mf(); repeaters[l] = mf(); ages[l] = Object.fromEntries(AGE_BANDS.map(b => [b, mf()])); }
  const byId = new Map(i.students.map(s => [s.id, s]));
  for (const s of i.students) {
    add(enrolment[s.level], s.gender); add(all, s.gender);
    add(ages[s.level][ageBand(ageOn(s.date_of_birth, i.asOf))], s.gender);
    if (s.admitted_on && s.admitted_on >= i.yearStarts && s.admitted_on <= i.asOf) add(entrants[s.level], s.gender);
    if (i.repeaters.has(s.id)) add(repeaters[s.level], s.gender);
  }
  const special: Record<string, MF> = {};
  for (const p of i.sen) {
    const s = byId.get(p.student_id);
    if (!s) continue;
    for (const need of p.needs.length ? p.needs : ["other"]) { special[need] ??= mf(); add(special[need], s.gender); }
  }
  const teaching = mf(), nonTeaching = mf();
  const quals: Record<string, MF> = {};
  let trcn = 0;
  for (const st of i.staff) {
    add(st.teaching ? teaching : nonTeaching, st.gender);
    if (st.teaching) {
      const q = highestQualification(st.qualifications);
      quals[q] ??= mf(); add(quals[q], st.gender);
      if (trcnRegistered(st.qualifications)) trcn++;
    }
  }
  const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 10) / 10 : null);
  return {
    kind: "annual_school_census" as const, period: i.period, as_of: i.asOf, school: i.profile,
    enrolment: { by_level: enrolment, total: all },
    ages, new_entrants: entrants, repeaters, special_needs: special,
    staff: { teaching, non_teaching: nonTeaching, teachers_by_qualification: quals, teachers_trcn_registered: trcn },
    facilities: { classrooms: i.classrooms },
    ratios: { pupils_per_teacher: ratio(all.total, teaching.total), pupils_per_classroom: ratio(all.total, i.classrooms) }
  };
}
export type CensusReturn = ReturnType<typeof censusReturn>;

/** The return as rows for a spreadsheet (section, item, male, female, other, total). */
export function censusRows(r: CensusReturn): (string | number)[][] {
  const out: (string | number)[][] = [["Section", "Item", "Male", "Female", "Other / not recorded", "Total"]];
  const push = (section: string, item: string, t: MF) => out.push([section, item, t.male, t.female, t.other, t.total]);
  for (const [k, v] of Object.entries(r.school ?? {})) out.push(["School", k.replace(/_/g, " "), "", "", "", String(v)]);
  for (const [l, t] of Object.entries(r.enrolment.by_level)) push("Enrolment", l, t);
  push("Enrolment", "All classes", r.enrolment.total);
  for (const [l, bands] of Object.entries(r.ages)) for (const [b, t] of Object.entries(bands)) if (t.total) push("Enrolment by age", `${l}, age ${b}`, t);
  for (const [l, t] of Object.entries(r.new_entrants)) if (t.total) push("New entrants", l, t);
  for (const [l, t] of Object.entries(r.repeaters)) if (t.total) push("Repeaters", l, t);
  for (const [n, t] of Object.entries(r.special_needs)) push("Special needs", n.replace(/_/g, " "), t);
  push("Staff", "Teaching", r.staff.teaching);
  push("Staff", "Non-teaching", r.staff.non_teaching);
  for (const [q, t] of Object.entries(r.staff.teachers_by_qualification)) push("Teachers by highest qualification", q, t);
  out.push(["Staff", "Teachers registered with TRCN", "", "", "", r.staff.teachers_trcn_registered]);
  out.push(["Facilities", "Classrooms", "", "", "", r.facilities.classrooms]);
  out.push(["Ratios", "Pupils per teacher", "", "", "", r.ratios.pupils_per_teacher ?? ""]);
  out.push(["Ratios", "Pupils per classroom", "", "", "", r.ratios.pupils_per_classroom ?? ""]);
  return out;
}
