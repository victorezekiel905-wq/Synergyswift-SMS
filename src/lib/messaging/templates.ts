/**
 * Message content for every notification kind, for both channels.
 *
 * WhatsApp templates must be approved in Meta Business Manager (or Twilio
 * Content). Register each template with EXACTLY the body text documented in
 * docs/MESSAGING.md and set its name in the matching WHATSAPP_TPL_* variable.
 * The `params` arrays below are sent in {{1}}, {{2}} … order.
 */

export type Rendered = {
  subject: string;
  text: string;
  html: string;
  wa: { template: string | null; params: string[]; text: string };
};

export type Brand = { schoolName: string; color?: string | null; logoUrl?: string | null; address?: string | null };

const tpl = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function layout(brand: Brand, title: string, bodyHtml: string, cta?: { href: string; label: string }) {
  const color = brand.color && /^#[0-9a-f]{3,8}$/i.test(brand.color) ? brand.color : "#1d5ddb";
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:${color};padding:18px 24px;color:#ffffff">
${brand.logoUrl ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" height="36" style="vertical-align:middle;margin-right:10px;border-radius:6px">` : ""}
<span style="font-size:17px;font-weight:700;vertical-align:middle">${escapeHtml(brand.schoolName)}</span></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:19px">${escapeHtml(title)}</h1>
${bodyHtml}
${cta ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(cta.href)}" style="background:${color};color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>
<p style="font-size:12px;color:#64748b;word-break:break-all">Or open: ${escapeHtml(cta.href)}</p>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafc;font-size:12px;color:#64748b">${escapeHtml(brand.address ?? "")}<br>You receive this because you are a registered parent or guardian.</td></tr>
</table></td></tr></table></body></html>`;
}

export function resultPublished(b: Brand, p: {
  guardianName: string; studentName: string; termName: string; average: number | null;
  position: number | null; classSize: number | null; showPosition: boolean; link: string;
  subjects: { subject: string; total: number | null; grade: string | null }[];
}): Rendered {
  const avg = p.average === null ? "—" : `${p.average}%`;
  const pos = p.showPosition && p.position ? `, position ${p.position} of ${p.classSize}` : "";
  const text = `Dear ${p.guardianName},\n\n${p.studentName}'s ${p.termName} result is ready at ${b.schoolName}.\nAverage: ${avg}${pos}.\n\n` +
    p.subjects.map(s => `${s.subject}: ${s.total ?? "—"} (${s.grade ?? "—"})`).join("\n") +
    `\n\nFull report card: ${p.link}`;
  const rows = p.subjects.map(s =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(s.subject)}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${s.total ?? "—"}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600">${escapeHtml(s.grade ?? "—")}</td></tr>`).join("");
  const html = layout(b, `${p.termName} result: ${p.studentName}`,
    `<p>Dear ${escapeHtml(p.guardianName)},</p><p><b>${escapeHtml(p.studentName)}</b>'s result has been published.</p>
<p style="font-size:15px">Average: <b>${escapeHtml(avg)}</b>${escapeHtml(pos)}</p>
<table width="100%" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-top:8px">
<tr style="background:#f1f5f9"><th align="left" style="padding:6px 8px">Subject</th><th align="right" style="padding:6px 8px">Total</th><th style="padding:6px 8px">Grade</th></tr>${rows}</table>`,
    { href: p.link, label: "Open full report card" });
  return {
    subject: `${p.studentName}: ${p.termName} result`,
    text, html,
    wa: {
      template: tpl("WHATSAPP_TPL_RESULT"),
      params: [p.guardianName, p.termName, p.studentName, b.schoolName, `${avg}${pos}`, p.link],
      text: `*${b.schoolName}*\nDear ${p.guardianName}, ${p.studentName}'s ${p.termName} result is ready.\nAverage: ${avg}${pos}\n\nView the full report card: ${p.link}`
    }
  };
}

export function gateEvent(b: Brand, p: { guardianName: string; studentName: string; direction: "in" | "out"; time: string; date: string; via?: string | null }): Rendered {
  const verb = p.direction === "in" ? "signed in at school" : "signed out of school";
  const via = p.via ? ` (${p.via})` : "";
  const line = `${p.studentName} ${verb} at ${p.time} on ${p.date}${via}.`;
  return {
    subject: `${p.studentName} ${verb}`,
    text: `Dear ${p.guardianName},\n\n${line}\n\n${b.schoolName}`,
    html: layout(b, p.direction === "in" ? "Safe arrival" : "Signed out", `<p>Dear ${escapeHtml(p.guardianName)},</p><p>${escapeHtml(line)}</p>`),
    wa: {
      template: tpl("WHATSAPP_TPL_GATE"),
      params: [b.schoolName, p.studentName, p.direction === "in" ? "in" : "out", p.time, p.date],
      text: `*${b.schoolName}*\n${line}`
    }
  };
}

export function pickupCode(b: Brand, p: { guardianName: string; studentName: string; code: string; expires: string; collector: string }): Rendered {
  const line = `Pickup code for ${p.studentName}: ${p.code}. Valid until ${p.expires}. Collector: ${p.collector}.`;
  return {
    subject: `Pickup code for ${p.studentName}`,
    text: `Dear ${p.guardianName},\n\n${line}\nShow this code at the school gate. Share it only with the person collecting your child.\n\n${b.schoolName}`,
    html: layout(b, "Pickup code", `<p>Dear ${escapeHtml(p.guardianName)},</p>
<p>Show this code at the gate to collect <b>${escapeHtml(p.studentName)}</b>:</p>
<p style="font-size:34px;letter-spacing:8px;font-weight:800;margin:12px 0">${escapeHtml(p.code)}</p>
<p>Valid until ${escapeHtml(p.expires)}. Collector: ${escapeHtml(p.collector)}.</p>
<p style="color:#b91c1c">Share it only with the person collecting your child.</p>`),
    wa: {
      template: tpl("WHATSAPP_TPL_PICKUP_CODE"),
      params: [b.schoolName, p.studentName, p.code, p.expires, p.collector],
      text: `*${b.schoolName}*\n${line}\nShare it only with the person collecting your child.`
    }
  };
}

export function pickupDone(b: Brand, p: { guardianName: string; studentName: string; collector: string; time: string }): Rendered {
  const line = `${p.studentName} was picked up by ${p.collector} at ${p.time}.`;
  return {
    subject: `${p.studentName} has been picked up`,
    text: `Dear ${p.guardianName},\n\n${line}\n\n${b.schoolName}`,
    html: layout(b, "Picked up", `<p>Dear ${escapeHtml(p.guardianName)},</p><p>${escapeHtml(line)}</p><p>If you did not authorise this, call the school immediately.</p>`),
    wa: {
      template: tpl("WHATSAPP_TPL_PICKUP_DONE"),
      params: [b.schoolName, p.studentName, p.collector, p.time],
      text: `*${b.schoolName}*\n${line}\nIf you did not authorise this, call the school immediately.`
    }
  };
}

export function broadcast(b: Brand, p: { guardianName: string; title: string; body: string }): Rendered {
  return {
    subject: p.title,
    text: `Dear ${p.guardianName},\n\n${p.body}\n\n${b.schoolName}`,
    html: layout(b, p.title, `<p>Dear ${escapeHtml(p.guardianName)},</p>${escapeHtml(p.body).split(/\n{2,}/).map(x => `<p>${x.replace(/\n/g, "<br>")}</p>`).join("")}`),
    wa: {
      template: tpl("WHATSAPP_TPL_BROADCAST"),
      params: [b.schoolName, `${p.title}: ${p.body}`.replace(/\s*\n+\s*/g, " ").slice(0, 900)],
      text: `*${b.schoolName}*\n*${p.title}*\n${p.body}`
    }
  };
}

export function portalLink(b: Brand, p: { guardianName: string; studentNames: string; link: string }): Rendered {
  return {
    subject: `Your ${b.schoolName} parent portal`,
    text: `Dear ${p.guardianName},\n\nUse this private link to see results, attendance and pickup codes for ${p.studentNames}:\n${p.link}\n\nDo not forward it.`,
    html: layout(b, "Your parent portal", `<p>Dear ${escapeHtml(p.guardianName)},</p><p>Use your private link to see results, attendance and pickup codes for <b>${escapeHtml(p.studentNames)}</b>. Do not forward it.</p>`,
      { href: p.link, label: "Open parent portal" }),
    wa: {
      template: tpl("WHATSAPP_TPL_PORTAL"),
      params: [b.schoolName, p.studentNames, p.link],
      text: `*${b.schoolName}*\nYour private parent portal for ${p.studentNames}: ${p.link}\nDo not forward this link.`
    }
  };
}

export function libraryOverdue(b: Brand, p: { guardianName: string; studentName: string; title: string; due: string }): Rendered {
  const line = `${p.studentName} has an overdue library book "${p.title}" (due ${p.due}).`;
  return {
    subject: `Overdue library book: ${p.title}`,
    text: `Dear ${p.guardianName},\n\n${line} Please help return it.\n\n${b.schoolName}`,
    html: layout(b, "Overdue library book", `<p>Dear ${escapeHtml(p.guardianName)},</p><p>${escapeHtml(line)} Please help return it.</p>`),
    wa: { template: tpl("WHATSAPP_TPL_LIBRARY"), params: [b.schoolName, p.studentName, p.title, p.due], text: `*${b.schoolName}*\n${line}` }
  };
}
