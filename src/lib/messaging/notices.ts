/**
 * v46 notification kinds. `simple` builds email, WhatsApp and SMS text from a
 * few lines so every message stays consistent. WhatsApp template bodies to
 * register are listed in docs/MESSAGING.md.
 */
import { escapeHtml, layout, tpl, type Brand, type Rendered } from "./templates";

function simple(b: Brand, o: { subject: string; title: string; greeting: string; lines: string[]; cta?: { href: string; label: string }; tplEnv: string; params: string[] }): Rendered {
  const body = o.lines.join("\n");
  const link = o.cta ? `\n${o.cta.label}: ${o.cta.href}` : "";
  return {
    subject: o.subject,
    text: `${o.greeting}\n\n${body}${link}\n\n${b.schoolName}`,
    html: layout(b, o.title, `<p>${escapeHtml(o.greeting)}</p>${o.lines.map(l => `<p>${escapeHtml(l)}</p>`).join("")}`, o.cta),
    wa: { template: tpl(o.tplEnv), params: o.params, text: `*${b.schoolName}*\n${body}${link}` }
  };
}

export function absence(b: Brand, p: { guardianName: string; studentName: string; date: string; status: "absent" | "late"; reason?: string | null }) {
  const line = p.status === "absent"
    ? `${p.studentName} was marked absent from class on ${p.date}.`
    : `${p.studentName} arrived late to class on ${p.date}.`;
  return simple(b, {
    subject: `${p.studentName}: ${p.status} today`, title: p.status === "absent" ? "Absence" : "Late arrival",
    greeting: `Dear ${p.guardianName},`,
    lines: [line, p.reason ? `Note: ${p.reason}` : "If this is unexpected, please contact the school."],
    tplEnv: "WHATSAPP_TPL_ABSENCE", params: [b.schoolName, p.studentName, p.status, p.date]
  });
}

export function feeReceipt(b: Brand, p: { guardianName: string; studentName: string; amount: string; receiptNo: string; balance: string; link: string }) {
  return simple(b, {
    subject: `Payment received: ${p.receiptNo}`, title: "Payment received", greeting: `Dear ${p.guardianName},`,
    lines: [`We received ${p.amount} for ${p.studentName}. Receipt ${p.receiptNo}.`, `Outstanding balance: ${p.balance}.`],
    cta: { href: p.link, label: "View invoice and receipt" },
    tplEnv: "WHATSAPP_TPL_FEE_RECEIPT", params: [b.schoolName, p.amount, p.studentName, p.receiptNo, p.balance, p.link]
  });
}

export function feeReminder(b: Brand, p: { guardianName: string; studentName: string; balance: string; title: string; due: string | null; link: string }) {
  return simple(b, {
    subject: `Fee reminder: ${p.studentName}`, title: "Fee reminder", greeting: `Dear ${p.guardianName},`,
    lines: [
      `${p.title} for ${p.studentName} has an outstanding balance of ${p.balance}${p.due ? `, due ${p.due}` : ""}.`,
      "You can pay securely online with the link below, or by transfer or at the bursary."
    ],
    cta: { href: p.link, label: "Pay now" },
    tplEnv: "WHATSAPP_TPL_FEE_REMINDER", params: [b.schoolName, p.studentName, p.balance, p.due ?? "now", p.link]
  });
}

export function behaviourNote(b: Brand, p: { guardianName: string; studentName: string; kind: "positive" | "negative"; what: string; note?: string | null }) {
  const line = p.kind === "positive"
    ? `${p.studentName} earned recognition: ${p.what}.`
    : `${p.studentName} has a behaviour concern: ${p.what}.`;
  return simple(b, {
    subject: `${p.studentName}: ${p.kind === "positive" ? "well done" : "behaviour note"}`,
    title: p.kind === "positive" ? "Well done" : "Behaviour note",
    greeting: `Dear ${p.guardianName},`, lines: [line, ...(p.note ? [p.note] : [])],
    tplEnv: "WHATSAPP_TPL_BEHAVIOUR", params: [b.schoolName, p.studentName, p.what]
  });
}

export function sickbayNote(b: Brand, p: { guardianName: string; studentName: string; complaint: string; outcome: string; time: string }) {
  return simple(b, {
    subject: `${p.studentName} visited the sick bay`, title: "Sick bay visit", greeting: `Dear ${p.guardianName},`,
    lines: [`${p.studentName} was seen at the sick bay at ${p.time} for: ${p.complaint}.`, `Outcome: ${p.outcome}.`],
    tplEnv: "WHATSAPP_TPL_HEALTH", params: [b.schoolName, p.studentName, p.time, p.complaint, p.outcome]
  });
}

export function busEvent(b: Brand, p: { guardianName: string; studentName: string; kind: "boarded" | "alighted"; route: string; stop: string | null; time: string }) {
  const verb = p.kind === "boarded" ? "boarded" : "got off";
  const line = `${p.studentName} ${verb} the ${p.route} bus${p.stop ? ` at ${p.stop}` : ""} at ${p.time}.`;
  return simple(b, {
    subject: `${p.studentName} ${verb} the bus`, title: "School bus", greeting: `Dear ${p.guardianName},`,
    lines: [line], tplEnv: "WHATSAPP_TPL_BUS", params: [b.schoolName, p.studentName, verb, p.route, p.time]
  });
}

const EXEAT_WORDS: Record<string, string> = {
  approved: "has been approved", rejected: "was not approved",
  out: "has left the boarding house", returned: "has returned to the boarding house"
};

export function exeatUpdate(b: Brand, p: { guardianName: string; studentName: string; status: string; when: string; note?: string | null }) {
  const words = EXEAT_WORDS[p.status] ?? p.status;
  return simple(b, {
    subject: `Exeat for ${p.studentName}: ${p.status}`, title: "Exeat", greeting: `Dear ${p.guardianName},`,
    lines: [`The exeat for ${p.studentName} ${words} (${p.when}).`, ...(p.note ? [p.note] : [])],
    tplEnv: "WHATSAPP_TPL_EXEAT", params: [b.schoolName, p.studentName, words, p.when]
  });
}

export function eventInvite(b: Brand, p: { guardianName: string; title: string; when: string; needsConsent: boolean; fee: string | null; link: string }) {
  return simple(b, {
    subject: p.needsConsent ? `Consent needed: ${p.title}` : p.title, title: p.title, greeting: `Dear ${p.guardianName},`,
    lines: [
      `${p.title} on ${p.when}.`,
      ...(p.fee ? [`Cost: ${p.fee}.`] : []),
      ...(p.needsConsent ? ["Please give or decline consent using the link below."] : [])
    ],
    cta: { href: p.link, label: p.needsConsent ? "Respond" : "Details" },
    tplEnv: "WHATSAPP_TPL_EVENT", params: [b.schoolName, p.title, p.when, p.link]
  });
}

export function meetingBooked(b: Brand, p: { name: string; teacher: string; studentName: string; when: string; where: string | null; toTeacher?: boolean }) {
  const line = p.toTeacher
    ? `${p.name} booked a meeting about ${p.studentName} on ${p.when}.`
    : `Your meeting with ${p.teacher} about ${p.studentName} is booked for ${p.when}${p.where ? ` (${p.where})` : ""}.`;
  return simple(b, {
    subject: "Parent-teacher meeting booked", title: "Meeting booked", greeting: `Dear ${p.name},`, lines: [line],
    tplEnv: "WHATSAPP_TPL_MEETING", params: [b.schoolName, p.teacher, p.studentName, p.when]
  });
}

const ADMISSION_WORDS: Record<string, string> = {
  new: "has been received", reviewing: "is being reviewed", assessment: "has an entrance assessment scheduled",
  interview: "has an interview scheduled", offered: "has been offered a place", accepted: "has been accepted",
  enrolled: "is now enrolled", rejected: "was not successful this time", withdrawn: "has been withdrawn"
};

export function admissionUpdate(b: Brand, p: { guardianName: string; childName: string; applicationNo: string; status: string; note?: string | null; link: string }) {
  const words = ADMISSION_WORDS[p.status] ?? p.status;
  return simple(b, {
    subject: `Application ${p.applicationNo}: ${p.childName}`, title: "Admission update", greeting: `Dear ${p.guardianName},`,
    lines: [`The application for ${p.childName} (${p.applicationNo}) ${words}.`, ...(p.note ? [p.note] : [])],
    cta: { href: p.link, label: "Track application" },
    tplEnv: "WHATSAPP_TPL_ADMISSION", params: [b.schoolName, p.childName, p.applicationNo, words, p.link]
  });
}

/** Staff invitation to rate or act (used for lesson-note returns etc.). */
export function staffNotice(b: Brand, p: { name: string; subject: string; line: string; link?: string }) {
  return simple(b, {
    subject: p.subject, title: p.subject, greeting: `Hello ${p.name},`, lines: [p.line],
    cta: p.link ? { href: p.link, label: "Open" } : undefined, tplEnv: "WHATSAPP_TPL_STAFF", params: [b.schoolName, p.line]
  });
}
