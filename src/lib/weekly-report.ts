/**
 * The weekly report to parents (phase 14q), the pure part: when it is due, the
 * school week it covers, and the message. One message per family, a short
 * section per child: points, attendance, homework, class story. No AI: plain
 * facts from the school's records, so it costs nothing and never invents.
 */
import { localParts } from "@/lib/attendance";
import { layout, escapeHtml, tpl, type Brand, type Rendered } from "@/lib/messaging/templates";

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => ymd(new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS));
/** 1 = Monday … 7 = Sunday, for a calendar date. */
const isoDay = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** ISO week key, e.g. "2026-W44", for a calendar date. */
export function weekKey(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const thursday = new Date(d.getTime() + (4 - isoDay(date)) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1, 12);
  const week = Math.floor((thursday.getTime() - jan1) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Is the report due now at this school? From Friday 15:00 until Saturday noon, school time
 * (so a missed Friday run still goes out). Returns the week it covers: Monday to Friday.
 */
export function dueWeek(now: Date, timeZone: string): { key: string; from: string; to: string } | null {
  const { date, minutes } = localParts(now, timeZone);
  const day = isoDay(date);
  if (!((day === 5 && minutes >= 15 * 60) || (day === 6 && minutes < 12 * 60))) return null;
  const monday = addDays(date, 1 - day);
  return { key: weekKey(monday), from: monday, to: addDays(monday, 4) };
}

export type ChildWeek = {
  name: string; className: string | null;
  points: number; skills: string[];
  present: number; late: number; absent: number; excused: number;
  homeworkSet: number; homeworkDone: number;
  storyPosts: number;
};

/** Anything worth telling the family about this child this week? */
export const hasNews = (c: ChildWeek) => c.points !== 0 || c.present + c.late + c.absent + c.excused > 0 || c.homeworkSet > 0 || c.storyPosts > 0;

/** The lines for one child, in plain words. */
export function childLines(c: ChildWeek): string[] {
  const out: string[] = [];
  if (c.points !== 0) out.push(`${c.points} point${Math.abs(c.points) === 1 ? "" : "s"} this week${c.skills.length ? ` (${c.skills.join(", ")})` : ""}`);
  const days = c.present + c.late + c.absent + c.excused;
  if (days) {
    const parts = [`${c.present + c.late} of ${days} day${days === 1 ? "" : "s"} in school`];
    if (c.late) parts.push(`${c.late} late`);
    if (c.absent) parts.push(`${c.absent} absent`);
    if (c.excused) parts.push(`${c.excused} excused`);
    out.push(`Attendance: ${parts.join(", ")}`);
  }
  if (c.homeworkSet) out.push(`Homework: ${c.homeworkDone} of ${c.homeworkSet} handed in`);
  if (c.storyPosts) out.push(`${c.storyPosts} new post${c.storyPosts === 1 ? "" : "s"} on the class story`);
  return out;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** Something to praise at home, when the week gives one. */
export function praise(c: ChildWeek): string | null {
  if (c.skills.length && c.points > 0) return `${firstName(c.name)} earned points for ${c.skills[0].toLowerCase()}.`;
  if (c.homeworkSet > 0 && c.homeworkDone >= c.homeworkSet) return `${firstName(c.name)} handed in every piece of homework.`;
  if (c.present + c.late > 0 && !c.absent && !c.late) return `${firstName(c.name)} was in school on time every day.`;
  return null;
}

export function renderWeekly(b: Brand, p: { guardianName: string; weekLabel: string; children: ChildWeek[]; link: string }): Rendered {
  const title = `${p.children.length === 1 ? `${firstName(p.children[0].name)}'s` : "Your children's"} week at school`;
  const sections = p.children.map(c => ({ head: `${c.name}${c.className ? ` (${c.className})` : ""}`, lines: childLines(c), praise: praise(c) }));
  const text = [`Dear ${p.guardianName},`, `Here is the week of ${p.weekLabel}.`,
    ...sections.map(s => [s.head, ...s.lines.map(l => `- ${l}`), ...(s.praise ? [`To praise at home: ${s.praise}`] : [])].join("\n")),
    `See more in the parent app: ${p.link}`, b.schoolName].join("\n\n");
  const html = layout(b, title, `<p>Dear ${escapeHtml(p.guardianName)},</p><p>Here is the week of ${escapeHtml(p.weekLabel)}.</p>${sections.map(s =>
    `<h2 style="margin:20px 0 6px;font-size:16px">${escapeHtml(s.head)}</h2><ul style="margin:0;padding-left:20px">${s.lines.map(l => `<li style="margin:3px 0">${escapeHtml(l)}</li>`).join("")}</ul>${
      s.praise ? `<p style="margin:8px 0 0;color:#475569"><b>To praise at home:</b> ${escapeHtml(s.praise)}</p>` : ""}`).join("")}`, { href: p.link, label: "Open the parent app" });
  const waBody = sections.map(s => `*${s.head}*\n${s.lines.map(l => `- ${l}`).join("\n")}${s.praise ? `\nTo praise at home: ${s.praise}` : ""}`).join("\n\n");
  return {
    subject: `${title}: ${p.weekLabel}`, text, html,
    wa: { template: tpl("WHATSAPP_TPL_BROADCAST"), params: [b.schoolName, `${title} (${p.weekLabel}). ${waBody}`.replace(/\s*\n+\s*/g, " ").slice(0, 900)],
      text: `*${b.schoolName}*\n*${title}* (${p.weekLabel})\n\n${waBody}\n\n${p.link}` }
  };
}

/** "27 Oct to 31 Oct" for a Monday–Friday week. */
export function weekLabel(from: string, to: string): string {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${f(from)} to ${f(to)}`;
}
