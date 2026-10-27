/**
 * The school calendar: one list of dated items (terms, holidays, events,
 * exams, meetings, lessons, bookings) and an iCalendar feed that Google
 * Calendar, Outlook and phone calendars can subscribe to. Pure, unit tested.
 */
import { addDays, weekday, zonedToUtc } from "./attendance";

export type CalKind = "term" | "holiday" | "event" | "trip" | "club" | "exam" | "meeting" | "pta" | "lesson" | "cover" | "booking" | "online" | "homework" | "deadline";
export type CalItem = {
  id: string; kind: CalKind; title: string;
  start: string;            // ISO instant, or YYYY-MM-DD for all-day
  end?: string | null;      // ISO instant, or YYYY-MM-DD (inclusive last day) for all-day
  allDay?: boolean; location?: string | null; description?: string | null; url?: string | null;
};

export const KIND_LABEL: Record<CalKind, string> = {
  term: "Term", holiday: "Holiday", event: "Event", trip: "Trip", club: "Club", exam: "Exam", meeting: "Meeting", pta: "PTA meeting", lesson: "Lesson",
  cover: "Cover", booking: "Room booking", online: "Online lesson", homework: "Homework due", deadline: "Deadline"
};

/** Weekly timetable lessons as dated items between two dates, skipping closed days and days outside term. */
export function expandTimetable(entries: { id: string; day: number; title: string; location?: string | null; starts_at: string; ends_at: string }[],
  from: string, to: string, timeZone: string, opts: { closed?: Iterable<string>; terms?: { starts_on: string | null; ends_on: string | null }[] } = {}): CalItem[] {
  const closed = new Set(opts.closed ?? []);
  const inTerm = (d: string) => !opts.terms?.length || opts.terms.some(t => (!t.starts_on || t.starts_on <= d) && (!t.ends_on || d <= t.ends_on));
  const out: CalItem[] = [];
  for (let d = from, i = 0; d <= to && i < 120; d = addDays(d, 1), i++) {
    if (closed.has(d) || !inTerm(d)) continue;
    const w = weekday(d);
    for (const e of entries) {
      if (e.day !== w) continue;
      const s = zonedToUtc(`${d} ${e.starts_at.slice(0, 5)}`, timeZone), en = zonedToUtc(`${d} ${e.ends_at.slice(0, 5)}`, timeZone);
      if (!s || !en) continue;
      out.push({ id: `${e.id}-${d}`, kind: "lesson", title: e.title, start: s.toISOString(), end: en.toISOString(), location: e.location ?? null });
    }
  }
  return out;
}

/** Items that touch a date (all-day items cover every day from start to end). */
export function onDay(items: CalItem[], date: string, timeZone: string): CalItem[] {
  const local = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return items.filter(i => {
    const s = i.allDay ? i.start : local(i.start);
    const e = i.end ? (i.allDay ? i.end : local(i.end)) : s;
    return s <= date && date <= e;
  });
}

// ---------------- iCalendar ----------------

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (d: string) => d.replace(/-/g, "");

/** Lines longer than 75 octets are folded, as the standard requires. */
export function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "", len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; len = 0; }
    cur += ch; len += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** An iCalendar document. `uidDomain` makes event ids stable across refreshes. */
export function toIcs(items: CalItem[], opts: { name: string; uidDomain: string; now?: Date }): string {
  const stamp = utc((opts.now ?? new Date()).toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synergy Swift//School calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const i of items) {
    lines.push("BEGIN:VEVENT", `UID:${i.id.replace(/[^\w.-]/g, "")}@${opts.uidDomain}`, `DTSTAMP:${stamp}`);
    if (i.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(i.start)}`, `DTEND;VALUE=DATE:${dateOnly(addDays(i.end ?? i.start, 1))}`);
    } else {
      lines.push(`DTSTART:${utc(i.start)}`, `DTEND:${utc(i.end ?? new Date(Date.parse(i.start) + 3600_000).toISOString())}`);
    }
    lines.push(`SUMMARY:${esc(i.title)}`, `CATEGORIES:${esc(KIND_LABEL[i.kind])}`);
    if (i.location) lines.push(`LOCATION:${esc(i.location)}`);
    if (i.description) lines.push(`DESCRIPTION:${esc(i.description.slice(0, 2000))}`);
    if (i.url) lines.push(`URL:${i.url}`);
    lines.push("TRANSP:" + (i.allDay ? "TRANSPARENT" : "OPAQUE"), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Links that add a subscription in Google Calendar and Outlook. */
export function subscribeLinks(feedUrl: string, name: string) {
  const webcal = feedUrl.replace(/^https?:/, "webcal:");
  return {
    webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent(name)}`,
    office365: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent(name)}`
  };
}

// ---------------- room bookings ----------------

/** Whether two time ranges overlap (touching ends do not). */
export const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
