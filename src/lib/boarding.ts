/**
 * Boarding and transport: roll calls, late returns from exeat, meal numbers and diets,
 * vehicle and driver documents, and who is missing from the bus. Pure functions.
 */

export type RollStatus = "present" | "absent" | "late" | "exeat" | "sick_bay" | "excused";

/** The starting roll: boarders on exeat or resting in the sick bay are marked as such; everyone else present until the warden says otherwise. */
export function startingRoll(boarders: { student_id: string; name: string; room: string | null }[], outOnExeat: Set<string>, inSickBay: Set<string>) {
  return boarders.map(b => ({ ...b, status: (outOnExeat.has(b.student_id) ? "exeat" : inSickBay.has(b.student_id) ? "sick_bay" : "present") as RollStatus }))
    .sort((a, b) => String(a.room ?? "").localeCompare(String(b.room ?? ""), undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

export function rollSummary(marks: { status: RollStatus }[]) {
  const by = (s: RollStatus) => marks.filter(m => m.status === s).length;
  return { total: marks.length, present: by("present") + by("late"), absent: by("absent"), exeat: by("exeat"), sick_bay: by("sick_bay"), excused: by("excused"), late: by("late") };
}

/** A student signed out on exeat and not back by the agreed time (plus a grace period). */
export function exeatOverdue(e: { status: string; return_by: string; overdue_alerted_at: string | null }, now = new Date(), graceMinutes = 30) {
  return e.status === "out" && !e.overdue_alerted_at && now.getTime() > Date.parse(e.return_by) + graceMinutes * 60_000;
}

/** Who must agree an exeat next, and where it goes after the parent agrees. */
export function exeatAfterParent(requestedBy: "guardian" | "staff" | "student", approve: boolean) {
  if (!approve) return "rejected";
  return requestedBy === "staff" ? "approved" : "pending";      // staff asked already, so the house has agreed; a student's request still needs the house
}

/** Diet tags from free text ("vegetarian, no pork") and allergies, for the kitchen. */
export function dietTags(dietary: string | null, allergies: string | null) {
  const split = (s: string | null) => String(s ?? "").split(/[,;/\n]+/).map(x => x.trim().toLowerCase()).filter(x => x && !["none", "nil", "n/a", "no"].includes(x));
  return { diets: split(dietary), allergies: split(allergies) };
}

/** Meal numbers: boarders in residence, minus those away, with the special diets the kitchen must cater for. */
export function mealHeadcount(boarders: { student_id: string; dietary: string | null; allergies: string | null }[], away: Set<string>) {
  const here = boarders.filter(b => !away.has(b.student_id));
  const diets = new Map<string, number>(), allergies = new Map<string, number>();
  for (const b of here) {
    const t = dietTags(b.dietary, b.allergies);
    for (const d of t.diets) diets.set(d, (diets.get(d) ?? 0) + 1);
    for (const a of t.allergies) allergies.set(a, (allergies.get(a) ?? 0) + 1);
  }
  const list = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
  return { eating: here.length, away: boarders.length - here.length, diets: list(diets), allergies: list(allergies) };
}

/** Vehicle and driver documents expiring within a window, or already expired. */
export function expiringDocuments(today: string, within: number,
  vehicles: { id: string; reg_no: string; status: string; insurance_expires: string | null; roadworthy_expires: string | null; licence_expires: string | null; next_service_on: string | null }[],
  drivers: { id: string; full_name: string; active: boolean; licence_expires: string | null; medical_expires: string | null }[]) {
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + within * 86_400_000).toISOString().slice(0, 10);
  const out: { kind: "vehicle" | "driver"; id: string; name: string; what: string; date: string; expired: boolean }[] = [];
  const add = (kind: "vehicle" | "driver", id: string, name: string, what: string, date: string | null) => { if (date && date <= limit) out.push({ kind, id, name, what, date, expired: date < today }); };
  for (const v of vehicles) {
    if (v.status === "retired") continue;
    add("vehicle", v.id, v.reg_no, "insurance", v.insurance_expires); add("vehicle", v.id, v.reg_no, "roadworthiness", v.roadworthy_expires);
    add("vehicle", v.id, v.reg_no, "vehicle licence", v.licence_expires); add("vehicle", v.id, v.reg_no, "service", v.next_service_on);
  }
  for (const d of drivers) {
    if (!d.active) continue;
    add("driver", d.id, d.full_name, "driving licence", d.licence_expires); add("driver", d.id, d.full_name, "medical", d.medical_expires);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Does this vehicle have anything that stops it carrying children today? */
export function vehicleBlocked(v: { status: string; insurance_expires: string | null; roadworthy_expires: string | null }, today: string) {
  if (v.status !== "active") return `the vehicle is ${v.status === "repair" ? "in for repair" : "retired"}`;
  if (v.insurance_expires && v.insurance_expires < today) return "the insurance has expired";
  if (v.roadworthy_expires && v.roadworthy_expires < today) return "the roadworthiness certificate has expired";
  return null;
}

/** After a trip: riders who boarded and were never seen getting off, and (morning) riders who never boarded. */
export function tripCheck(riders: { student_id: string; name: string; direction: string }[], events: { student_id: string; kind: "boarded" | "alighted"; at: string }[], trip: "morning" | "afternoon") {
  const last = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) last.set(e.student_id, e.kind);
  const onTrip = riders.filter(r => r.direction === "both" || r.direction === trip);
  return {
    still_on_bus: onTrip.filter(r => last.get(r.student_id) === "boarded").map(r => r.name),
    not_boarded: onTrip.filter(r => !last.has(r.student_id)).map(r => r.name)
  };
}
