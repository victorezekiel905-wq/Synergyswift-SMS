// Phase 14n: builds "Synergy Swift Proposal.docx" and "Synergy Swift MoU.docx" (colourful, Naira prices from src/lib/saas.ts).
// Usage: npm i docx@9 --no-save && node scripts/sales/build-docs.cjs "<output folder>"; export PDFs with Word (File > Save as PDF).
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, BorderStyle,
  LevelFormat, PageBreak, Footer, Header, PageNumber, TableLayoutType, VerticalAlign, HeightRule
} = require("docx");

const OUT = process.argv[2];
const C = { navy: "1B2A4A", navy2: "2C3E66", teal: "0E8F80", tealLight: "E3F4F1", amber: "E89A2C", amberLight: "FDF1DE", rose: "C2415D", sky: "EAF0FA", ink: "1F2937", grey: "5B6475", line: "D6DCE6", white: "FFFFFF" };
const FONT = "Segoe UI";
const W = 9638; // A4 text width at 2 cm margins, in DXA

const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: o.size ?? 21, bold: o.bold, italics: o.italics, color: o.color ?? C.ink });
const rich = (parts, o = {}) => (Array.isArray(parts) ? parts : [parts]).map(p => typeof p === "string" ? run(p, o) : run(p.t, { ...o, ...p }));
const P = (parts, o = {}) => new Paragraph({ children: rich(parts, o), spacing: { after: o.after ?? 140, before: o.before ?? 0, line: 300 }, alignment: o.align });
const bullet = (parts, o = {}) => new Paragraph({ children: rich(parts, o), numbering: { reference: "dots", level: 0 }, spacing: { after: 80, line: 290 } });
const num = (parts, ref = "steps") => new Paragraph({ children: rich(parts), numbering: { reference: ref, level: 0 }, spacing: { after: 90, line: 290 } });

/** A coloured band heading. */
function band(title, fill = C.navy, kicker = null, breakBefore = false) {
  const out = [];
  if (kicker) out.push(new Paragraph({ children: [run(kicker.toUpperCase(), { size: 17, bold: true, color: fill === C.navy ? C.teal : fill })], spacing: { before: 280, after: 40 }, keepNext: true, pageBreakBefore: breakBefore }));
  out.push(new Paragraph({ children: [run(title, { size: 32, bold: true, color: C.white })], shading: { type: ShadingType.CLEAR, color: "auto", fill },
    keepNext: true, pageBreakBefore: breakBefore && !kicker, spacing: { before: kicker ? 0 : 280, after: 200 }, indent: { left: 120, right: 120 }, border: { left: { style: BorderStyle.SINGLE, size: 36, color: C.amber, space: 6 } } }));
  return out;
}
const h2 = (t, color = C.navy) => new Paragraph({ children: [run(t, { size: 25, bold: true, color })], spacing: { before: 220, after: 100 }, keepNext: true,
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.line, space: 2 } } });

const border = { style: BorderStyle.SINGLE, size: 4, color: C.line };
const borders = { top: border, bottom: border, left: border, right: border };
const none = { style: BorderStyle.NONE, size: 0, color: C.white };
const noBorders = { top: none, bottom: none, left: none, right: none };

function cell(content, width, o = {}) {
  const kids = (Array.isArray(content) && content.length && content[0] instanceof Paragraph) ? content
    : [new Paragraph({ children: rich(content, { size: o.size ?? 19, bold: o.bold, color: o.color }), alignment: o.align, spacing: { after: 0, line: 270 } })];
  return new TableCell({ children: kids, width: { size: width, type: WidthType.DXA }, shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    borders: o.noBorders ? noBorders : borders, margins: { top: o.pad ?? 90, bottom: o.pad ?? 90, left: 120, right: 120 }, verticalAlign: o.v ?? VerticalAlign.CENTER, columnSpan: o.span });
}
function table(headers, rows, widths, o = {}) {
  const hdr = new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, widths[i], { fill: o.headFill ?? C.navy, color: C.white, bold: true, align: i && o.rightNums ? AlignmentType.RIGHT : undefined })) });
  const body = rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], {
    fill: o.firstColFill && i === 0 ? o.firstColFill : ri % 2 ? (o.stripe ?? "F6F8FB") : C.white, bold: (o.boldFirst && i === 0) || (o.boldCols ?? []).includes(i),
    align: i && o.rightNums ? AlignmentType.RIGHT : undefined, color: (o.colColors ?? {})[i] })) }));
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows: [hdr, ...body], layout: TableLayoutType.FIXED });
}
/** A shaded call-out box. */
function callout(title, lines, fill = C.tealLight, accent = C.teal) {
  const kids = [new Paragraph({ children: [run(title, { bold: true, size: 22, color: accent })], spacing: { after: 80 } }),
    ...lines.map(l => new Paragraph({ children: rich(l, { size: 20 }), spacing: { after: 60, line: 280 } }))];
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W], layout: TableLayoutType.FIXED,
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({ children: kids, width: { size: W, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: "auto", fill },
      borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 36, color: accent } }, margins: { top: 160, bottom: 160, left: 240, right: 200 } })] })] });
}
/** Coloured tiles in a row (title + text). */
function tiles(items, cols = 3) {
  const w = Math.floor(W / cols);
  const widths = Array(cols).fill(w); widths[cols - 1] = W - w * (cols - 1);
  const rows = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(new TableRow({ cantSplit: true, children: widths.map((cw, j) => {
      const it = items[i + j];
      if (!it) return cell("", cw, { noBorders: true });
      return new TableCell({ width: { size: cw, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: "auto", fill: it.fill },
        borders: { top: { style: BorderStyle.SINGLE, size: 24, color: it.accent }, bottom: { style: BorderStyle.SINGLE, size: 12, color: C.white }, left: { style: BorderStyle.SINGLE, size: 12, color: C.white }, right: { style: BorderStyle.SINGLE, size: 12, color: C.white } },
        margins: { top: 140, bottom: 140, left: 160, right: 140 }, verticalAlign: VerticalAlign.TOP,
        children: [new Paragraph({ children: [run(it.title, { bold: true, size: 21, color: it.accent })], spacing: { after: 60 } }),
          ...it.lines.map(l => new Paragraph({ children: rich(l, { size: 18 }), spacing: { after: 40, line: 260 } }))] });
    }) }));
  }
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows, layout: TableLayoutType.FIXED });
}
const spacer = (after = 120) => new Paragraph({ children: [], spacing: { after } });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

function cover(title, subtitle, lines) {
  const kids = [
    new Paragraph({ children: [run("SYNERGY SWIFT", { bold: true, size: 26, color: C.amber })], spacing: { before: 600, after: 40 } }),
    new Paragraph({ children: [run("Synergy Swift Technologies Limited (registration in progress)", { size: 18, color: "C9D3E6" })], spacing: { after: 1400 } }),
    new Paragraph({ children: [run(title, { bold: true, size: 64, color: C.white })], spacing: { after: 200, line: 260 } }),
    new Paragraph({ children: [run(subtitle, { size: 28, color: "DCE4F2" })], spacing: { after: 1600, line: 320 } }),
    ...lines.map(l => new Paragraph({ children: rich(l, { size: 20, color: C.white }), spacing: { after: 80 } })),
    new Paragraph({ children: [], spacing: { after: 900 } })
  ];
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W], layout: TableLayoutType.FIXED,
    rows: [new TableRow({ height: { value: 13600, rule: HeightRule.ATLEAST }, children: [new TableCell({ children: kids, width: { size: W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: C.navy }, borders: { top: none, right: none, left: { style: BorderStyle.SINGLE, size: 48, color: C.amber }, bottom: { style: BorderStyle.SINGLE, size: 48, color: C.teal } },
      margins: { top: 200, bottom: 200, left: 600, right: 500 } })] })] });
}

function footer(label) {
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.line, space: 4 } },
    children: [run(`Synergy Swift · ${label} · page `, { size: 16, color: C.grey }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: C.grey })] })] });
}
const numbering = { config: [
  { reference: "dots", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } }, run: { color: C.teal } } }] },
  { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 440, hanging: 300 } }, run: { bold: true, color: C.navy } } }] },
  ...Array.from({ length: 20 }, (_, i) => ({ reference: `cl${i}`, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: `${i + 1}.%1`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 620, hanging: 520 } }, run: { color: C.navy, bold: true } } }] }))
] };
const page = { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } };
const naira = n => `₦${n.toLocaleString("en-NG")}`;

// ===================================================================== PROPOSAL
const BANDS = [100, 250, 500, 1000, 2000];
const PLANS = { Essentials: [250000, 530000, 950000, 1680000, 2800000], Growth: [800000, 1680000, 3040000, 5360000, 8800000], Complete: [1000000, 2100000, 3800000, 6700000, 11000000] };
const GROUPS = [
  ["Core (run the school)", [250000, 530000, 950000, 1680000, 2800000]],
  ["Learning (lessons, live lessons and games)", [300000, 630000, 1130000, 2000000, 3300000]],
  ["Exams (secure CBT, question bank, planner)", [250000, 530000, 950000, 1680000, 2800000]],
  ["Money (fees, payroll, HR, stores)", [125000, 265000, 475000, 840000, 1400000]],
  ["Safety (gate, pickup, buses, boarding, health)", [125000, 265000, 475000, 840000, 1400000]],
  ["Engagement (admissions, broadcasts, elections, SEN)", [100000, 210000, 375000, 660000, 1100000]]
];

const proposal = new Document({
  creator: "Synergy Swift Technologies Limited", title: "Synergy Swift: proposal for schools",
  styles: { default: { document: { run: { font: FONT, size: 21, color: C.ink } } } }, numbering,
  sections: [
    { properties: { page }, children: [cover("One platform for the whole school.", "Results, fees, secure exams, live lessons, safety and families: run from one place, on any phone.", [
      [{ t: "Proposal for: ", bold: true }, "[School name]"], [{ t: "Prepared by: ", bold: true }, "Synergy Swift Technologies Limited (registration in progress)"],
      [{ t: "Date: ", bold: true }, "October 2026"], [{ t: "Valid for: ", bold: true }, "60 days"]])] },
    { properties: { page }, footers: { default: footer("Proposal for schools") }, children: [
      ...band("Why schools change", C.navy, "The problem"),
      P("Most Nigerian schools run on a patchwork: results in Excel, attendance on paper, fees chased on WhatsApp, exams that leak, parents who only hear from the school when something is wrong. Each tool works a little; together they cost time, money and trust."),
      tiles([
        { title: "Results take weeks", lines: ["Teachers re-type scores; a single error delays every report card."], fill: C.sky, accent: C.navy },
        { title: "Fees leak", lines: ["No clear picture of who owes what, and no gentle, consistent follow-up."], fill: C.amberLight, accent: C.amber },
        { title: "Exams are not secure", lines: ["Questions leak, papers are marked by hand, nobody can prove fairness."], fill: "FBE7EC", accent: C.rose },
        { title: "Parents are in the dark", lines: ["They hear about absence, results and fees late, and in pieces."], fill: C.tealLight, accent: C.teal },
        { title: "Safety is guesswork", lines: ["Who came in, who left, who is on the bus: written on paper, if at all."], fill: C.sky, accent: C.navy2 },
        { title: "Proprietors fly blind", lines: ["No live numbers across branches until the end of term."], fill: C.amberLight, accent: C.amber }
      ]),
      spacer(),
      callout("Synergy Swift in one sentence", ["Every part of running a school — students, results, fees, secure exams, lessons, safety and families — in one secure platform that works on any phone, priced in naira, built for Nigerian schools."]),
      ...band("What you get", C.teal, "The platform", true),
      P("Synergy Swift is organised in six groups. Choose a package or add groups as you grow; everything works together from day one."),
      tiles([
        { title: "Core: run the school", lines: ["Student records and history", "Results, report cards (signed and checkable online), transcripts", "Class registers and early warnings", "Timetable, events and consent forms", "Parent portal and two-way messages", "Behaviour, houses and staff cover"], fill: C.sky, accent: C.navy },
        { title: "Learning", lines: ["Lessons, homework and notes", "Live lessons with quiz games, team battles and rewards", "Classroom points and class story", "Library", "Early warning and results analysis"], fill: C.tealLight, accent: C.teal },
        { title: "Exams", lines: ["Secure CBT: 23 question types, maths and chemistry input", "Safe Exam Browser lock, face checks, network lock", "Question bank; import existing papers from PDF or Word", "Exam planner: timetable, seating, invigilators", "Hall check-in and live board; exams office"], fill: "FBE7EC", accent: C.rose },
        { title: "Money", lines: ["Fees with online payment (Paystack, Flutterwave, Remita)", "Promises to pay and gentle follow-up", "Payroll with 2025 PAYE, pension, NHF", "HR, leave, shifts and lateness", "Stores, assets and requisitions"], fill: C.amberLight, accent: C.amber },
        { title: "Safety", lines: ["Gate sign-in by card or phone code", "Parents alerted the moment a child arrives or leaves", "Pickup codes for collection", "Buses with live tracking and safety checks", "Visitors, boarding, exeat, sick bay"], fill: C.sky, accent: C.navy2 },
        { title: "Engagement", lines: ["Admissions and automatic entrance exams", "Email, WhatsApp and SMS broadcasts", "Two-way WhatsApp inbox", "Student and PTA elections (secret ballot)", "SEN support plans with families", "Scratch-card result checker PINs"], fill: C.tealLight, accent: C.teal }
      ]),
      ...band("What makes it different", C.navy, "Why Synergy Swift", true),
      table(["What you need", "What Synergy Swift does"], [
        [{ t: "Exams that are hard to cheat", bold: true }, "A full CBT engine with 23 question types, the Safe Exam Browser lock (switch on per exam or class), face checks, network locks, hall check-in before a paper opens, and automatic marking. Import your existing papers from PDF or Word in minutes."],
        [{ t: "Results parents trust", bold: true }, "Report cards are signed and carry a QR code anyone can check online. Parents can view results in the portal or with a scratch-card PIN, and transcripts are released per child (for example once fees are paid)."],
        [{ t: "Lessons children enjoy", bold: true }, "Live lessons with quiz games, team battles, survival rounds and collectable characters that level up — run from the teacher's phone and the class projector."],
        [{ t: "Families who are informed", bold: true }, "Parents are told on WhatsApp the moment their child signs in or out, gets on or off the bus, misses a lesson or receives a result. They reply in the school's shared inbox."],
        [{ t: "Staff who are on time", bold: true }, "Shifts, late and early-leave requests, and clock-in by scanning a code at the entrance with a phone — no machine to buy. Payroll can deduct unexcused lateness automatically."],
        [{ t: "Safety you can prove", bold: true }, "Automatic checks for a child who boarded the bus but is not in school, or was never dropped off, sent to the right staff at once."],
        [{ t: "One view of every branch", bold: true }, "Proprietors see enrolment, fee collection, attendance, results and staff punctuality for every branch side by side, ranked and downloadable."],
        [{ t: "Security and privacy", bold: true }, "Each school's data is walled off from every other school in the database itself (over 1,700 automated checks prove who can see what). Two-factor sign-in, device and network rules, a full change history, and support access that is time-limited and visible to the school."]
      ], [2900, W - 2900], { stripe: "F4F7FB" }),
      spacer(),
      ...band("A day with Synergy Swift", C.teal, "In practice"),
      tiles([
        { title: "07:30 · The gate", lines: ["Children tap their cards; parents get a WhatsApp message. Staff scan the code at the entrance with their phones."], fill: C.sky, accent: C.navy },
        { title: "08:00 · The class", lines: ["The register takes a minute. A live quiz game starts the lesson; the class story goes to parents."], fill: C.tealLight, accent: C.teal },
        { title: "11:00 · The exam hall", lines: ["Candidates check in at the door, the CBT paper opens, the exams office watches the live board."], fill: "FBE7EC", accent: C.rose },
        { title: "14:00 · The bursar", lines: ["Today's payments are in; families who promised to pay get a polite reminder automatically."], fill: C.amberLight, accent: C.amber },
        { title: "15:30 · The bus", lines: ["Parents see the bus approaching their stop. Every child scanned off is accounted for."], fill: C.sky, accent: C.navy2 },
        { title: "20:00 · The proprietor", lines: ["Every branch's numbers on one screen, from home."], fill: C.tealLight, accent: C.teal }
      ]),
      ...band("Prices in naira", C.amber, "Pricing", true),
      P("Prices are per school, per year, and depend only on the number of students. Staff and parents are always free and unlimited."),
      table(["Students (up to)", "Essentials", "Growth", "Complete"],
        BANDS.map((b, i) => [b.toLocaleString("en-NG"), naira(PLANS.Essentials[i]), naira(PLANS.Growth[i]), naira(PLANS.Complete[i])]).concat([["More than 2,000", "Quoted", "Quoted", "Quoted"]]),
        [2638, 2333, 2333, 2334], { rightNums: true, boldFirst: true, boldCols: [3], colColors: { 3: C.teal } }),
      spacer(80),
      tiles([
        { title: "Essentials", lines: ["Core: run the school, results, registers, parent portal and messaging."], fill: C.sky, accent: C.navy },
        { title: "Growth", lines: ["Essentials plus Learning, Exams and Money: lessons, live games, secure CBT, fees and payroll."], fill: C.tealLight, accent: C.teal },
        { title: "Complete (best value)", lines: ["Everything, including Safety and Engagement. About 13% less than buying the groups one by one."], fill: C.amberLight, accent: C.amber }
      ]),
      spacer(),
      h2("What that means per student"),
      P(["On Complete, the whole platform costs ", { t: "₦10,000 per student a year at 100 students, falling to ₦5,500 at 2,000", bold: true }, " — about ₦1,800 to ₦3,300 a term, about the price of one textbook."]),
      h2("Adding a group to a package"),
      table(["Group", "100", "250", "500", "1,000", "2,000"], GROUPS.map(([g, p]) => [g, ...p.map(x => (x / 1000).toLocaleString("en-NG") + "k")]),
        [3638, 1200, 1200, 1200, 1200, 1200], { rightNums: true, headFill: C.navy2 }),
      P("Figures in thousands of naira per year.", { size: 17, color: C.grey, before: 60 }),
      h2("Single-module options"),
      bullet([{ t: "Synergy Swift Exams on its own: ", bold: true }, "₦3,000 per student a year (minimum ₦300,000)."]),
      bullet([{ t: "Synergy Swift Learning (live lessons and games) on its own: ", bold: true }, "₦3,500 per student a year (minimum ₦350,000)."]),
      bullet([{ t: "Entrance examinations: ", bold: true }, "₦1,000 per candidate."]),
      h2("Terms that are easy to agree"),
      bullet([{ t: "Pay yearly, or by term: ", bold: true }, "termly is a third of the year plus 10%."]),
      bullet([{ t: "Setup, data import and training: ", bold: true }, "₦150,000 once, waived when you pay for the year."]),
      bullet([{ t: "SMS and WhatsApp messages: ", bold: true }, "at the provider's cost plus a small handling fee, from a prepaid balance you control."]),
      bullet([{ t: "Grace period: ", bold: true }, "14 days after an invoice falls due before anything is paused; your data is never deleted for late payment."]),
      bullet([{ t: "VAT: ", bold: true }, "added where it applies."]),
      spacer(),
      callout("Founding schools offer", ["The first five schools to sign get 50% off the first year on any package, in return for honest feedback and a short case study. Ask us whether a place is still open."], C.amberLight, C.amber),
      ...band("Getting started in four weeks", C.navy, "Implementation", true),
      table(["Week", "What happens", "Who"], [
        ["1", "Kick-off; your package and modules are switched on; we import students, classes, staff and parents from your spreadsheets.", "Synergy Swift with your admin"],
        ["2", "Results set-up (grading, report card design), fees and payment accounts, timetable.", "Synergy Swift with the bursar and exams officer"],
        ["3", "Training: admins (half a day), teachers (two hours), bursar and gate staff (one hour each). Parents get their sign-in by WhatsApp automatically.", "Synergy Swift trainers"],
        ["4", "Go live, with a named contact on WhatsApp and phone during school hours; a review meeting at the end of the first month.", "Both"]
      ], [900, 5838, 2900], { boldFirst: true, firstColFill: C.sky }),
      spacer(),
      ...band("Support and security", C.teal, "Peace of mind"),
      tiles([
        { title: "Support", lines: ["Named contact on WhatsApp and phone, 7:30–17:00 Monday to Friday", "Urgent issues (no sign-in, results day) answered within 2 hours", "Free refresher training each term"], fill: C.tealLight, accent: C.teal },
        { title: "Security", lines: ["Each school's data walled off in the database", "Two-factor sign-in and device rules for staff", "Every change recorded; daily backups"], fill: C.sky, accent: C.navy },
        { title: "Your data is yours", lines: ["Handled under the Nigeria Data Protection Act 2023", "Export everything at any time", "Support visits are time-limited and listed for you"], fill: C.amberLight, accent: C.amber }
      ]),
      spacer(),
      ...band("Next steps", C.amber, "Let's begin"),
      num("A 45-minute demonstration at your school or online, with your own class lists."),
      num("A written quote for your number of students and the modules you choose."),
      num("Sign the Memorandum of Understanding and choose your start date."),
      num("Go live within four weeks."),
      spacer(),
      callout("Talk to us", [[{ t: "Synergy Swift Technologies Limited ", bold: true }, "(registration in progress)"], "Phone / WhatsApp: [phone number]", "Email: [email address]", "Website: [website]"], C.sky, C.navy)
    ] }
  ]
});

// ===================================================================== MoU
let clauseNo = 0;
function clause(title, items) {
  const ref = `cl${clauseNo++}`;
  return [new Paragraph({ children: [run(`${clauseNo}. ${title}`, { size: 23, bold: true, color: C.navy })], spacing: { before: 260, after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.teal, space: 2 } } }),
    ...items.map(t => new Paragraph({ children: rich(t, { size: 20 }), numbering: { reference: ref, level: 0 }, spacing: { after: 90, line: 285 } }))];
}
const sign = (who) => new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W / 2, W / 2], layout: TableLayoutType.FIXED, rows: [new TableRow({ cantSplit: true, children: who.map(w => new TableCell({
  width: { size: W / 2, type: WidthType.DXA }, borders: noBorders, margins: { top: 120, bottom: 120, left: 120, right: 240 }, shading: { type: ShadingType.CLEAR, color: "auto", fill: "F6F8FB" },
  children: [new Paragraph({ children: [run(w, { bold: true, size: 21, color: C.navy })], spacing: { after: 360 } }),
    ...["Name", "Position", "Signature", "Date", "Witness"].map(l => new Paragraph({ children: [run(`${l}:`, { size: 19, color: C.grey }), run(" " + "_".repeat(l === "Witness" ? 34 : 36 - l.length), { size: 19, color: "9AA3B2" })], spacing: { after: 320 } }))] })) })] });

const mou = new Document({
  creator: "Synergy Swift Technologies Limited", title: "Memorandum of Understanding",
  styles: { default: { document: { run: { font: FONT, size: 20, color: C.ink } } } }, numbering,
  sections: [
    { properties: { page }, children: [cover("Memorandum of Understanding", "For the provision of the Synergy Swift school management platform", [
      [{ t: "Between: ", bold: true }, "Synergy Swift Technologies Limited (registration in progress)"], [{ t: "And: ", bold: true }, "[School name]"], [{ t: "Date: ", bold: true }, "[date]"]])] },
    { properties: { page }, footers: { default: footer("Memorandum of Understanding") }, children: [
      ...band("Memorandum of Understanding", C.navy, "Agreement"),
      P([{ t: "This Memorandum of Understanding (\"MoU\") is made on ", }, { t: "[date]", bold: true }, " between:"]),
      table(["", "Party"], [
        [{ t: "The Provider", bold: true }, ["Synergy Swift Technologies Limited (registration in progress), of [address], (\"Synergy Swift\"). Until registration is complete, the Provider acts through its promoter, ", { t: "[name]", bold: true }, ", who will assign this MoU to the company on registration."]],
        [{ t: "The School", bold: true }, ["[School name], of [address], represented by [name and position] (\"the School\")."]]
      ], [2300, W - 2300], { headFill: C.teal, firstColFill: C.tealLight }),
      spacer(),
      callout("Purpose", ["The parties record their agreement for the School to use the Synergy Swift platform: what will be provided, what each party will do, the price, and how the School's data will be protected."]),
      ...clause("Services", [
        "Synergy Swift will provide the School with access to the Synergy Swift platform with the package and modules set out in Schedule 1, for the School's staff, students and parents.",
        "Synergy Swift will host, maintain, secure and update the platform. New features added to the modules in the School's package are included at no extra cost.",
        "Synergy Swift will set up the School, import its data and train its staff as set out in Schedule 3."
      ]),
      ...clause("Term", [
        "This MoU starts on [start date] and runs for twelve (12) months.",
        "It renews for further twelve-month periods unless either party gives written notice at least thirty (30) days before the end of the current period.",
        "Prices for a renewal period will be confirmed in writing at least forty-five (45) days before it starts."
      ]),
      ...clause("Fees and payment", [
        "The School will pay the fees in Schedule 1. Fees are based on the number of students on roll; staff and parent accounts are free and unlimited.",
        "Invoices are payable within fourteen (14) days. If an invoice remains unpaid fourteen (14) days after it falls due, Synergy Swift may pause access after giving written notice; the School's data is kept safe and access is restored as soon as payment is received.",
        "If the School's number of students rises above its size band during the year, the difference for the rest of the year will be invoiced. No refund is due if numbers fall during the year.",
        "Text and WhatsApp messages are charged at the provider's cost plus a handling fee, from a prepaid balance the School controls.",
        "Fees exclude VAT, which will be added where it applies."
      ]),
      ...clause("What Synergy Swift will do", [
        "Keep the platform available at least 99.5% of each month, outside announced maintenance (normally outside school hours).",
        "Provide support as set out in Schedule 2.",
        "Back up the School's data every day and keep backups for at least thirty (30) days.",
        "Keep each school's data separate from every other school's, and keep a record of changes made in the School's account.",
        "Only access the School's account to provide support, through a time-limited support session that is recorded and shown to the School's administrators."
      ]),
      ...clause("What the School will do", [
        "Name an administrator who is the main contact for Synergy Swift and manages staff accounts and permissions.",
        "Provide accurate data, and keep it up to date.",
        "Obtain any consents needed from parents and staff for the School's use of their information (for example photographs and messages).",
        "Provide internet access and devices for staff and, where online exams are used, for candidates.",
        "Keep passwords private and tell Synergy Swift promptly of any suspected misuse."
      ]),
      ...clause("Data protection", [
        "The School is the data controller of the personal data it puts on the platform. Synergy Swift processes that data only on the School's instructions and to provide the services, as a data processor under the Nigeria Data Protection Act 2023.",
        "Synergy Swift will keep the data confidential, protect it with appropriate technical and organisational measures, and ensure its staff are bound by confidentiality.",
        "Synergy Swift will tell the School without undue delay, and in any case within seventy-two (72) hours, after becoming aware of a personal data breach affecting the School's data.",
        "Synergy Swift will help the School respond to requests from parents, students and staff to see, correct or delete their information.",
        "Synergy Swift will not sell the School's data or use it for advertising. Anonymised, aggregated statistics may be used to improve the platform.",
        "At the end of this MoU the School may export its data at any time during the following thirty (30) days; after that, Synergy Swift will delete it from the platform (backups expire within a further thirty (30) days)."
      ]),
      ...clause("Intellectual property", [
        "The platform, its software and its design belong to Synergy Swift. The School receives the right to use them during this MoU.",
        "The School's data and content (including question papers and lesson materials it creates) belong to the School."
      ]),
      ...clause("Confidentiality", [
        "Each party will keep the other's confidential information private and use it only for this MoU, during this MoU and for three (3) years after it ends."
      ]),
      ...clause("Liability", [
        "Neither party is liable for indirect or consequential loss.",
        "Each party's total liability under this MoU in any year is limited to the fees paid or payable for that year, except for breaches of confidentiality or data protection caused by wilful misconduct or gross negligence."
      ]),
      ...clause("Ending this MoU", [
        "Either party may end this MoU by thirty (30) days' written notice if the other seriously breaks it and does not put it right within that notice period.",
        "Fees paid in advance for a period after the end date will be refunded pro rata if Synergy Swift ends the MoU other than for the School's breach."
      ]),
      ...clause("Disputes and governing law", [
        "The parties will first try in good faith to settle any dispute through their senior representatives within fourteen (14) days.",
        "If that fails, the dispute will be referred to mediation in Lagos before either party goes to court or arbitration.",
        "This MoU is governed by the laws of the Federal Republic of Nigeria."
      ]),
      ...clause("General", [
        "This MoU, with its schedules, is the whole agreement between the parties about the services, and replaces earlier discussions.",
        "Changes must be agreed in writing and signed by both parties.",
        "Notices must be in writing and sent to the addresses above or by email to the named contacts."
      ]),
      spacer(),
      ...band("Signed by the parties", C.teal),
      sign(["For Synergy Swift Technologies Limited (registration in progress)", "For the School"]),
      ...band("Schedule 1: package and fees", C.amber, "Schedules", true),
      table(["Item", "Details"], [
        ["Package", "[Essentials / Growth / Complete / Custom]"],
        ["Additional groups", "[e.g. Safety]"],
        ["Students on roll (size band)", "[number] (up to [band])"],
        ["Yearly fee", "₦[amount]"],
        ["Billing", "[Yearly in advance / termly: a third of the year plus 10%]"],
        ["Setup, data import and training", "₦150,000, waived for yearly payment"],
        ["Founding schools offer (if applicable)", "50% off the first year"],
        ["Messages (SMS, WhatsApp)", "Provider cost plus handling fee, prepaid"]
      ], [3600, W - 3600], { boldFirst: true, headFill: C.amber, firstColFill: C.amberLight }),
      spacer(80),
      P("Published prices per year (naira) for reference:", { bold: true }),
      table(["Students (up to)", "Essentials", "Growth", "Complete"],
        BANDS.map((b, i) => [b.toLocaleString("en-NG"), naira(PLANS.Essentials[i]), naira(PLANS.Growth[i]), naira(PLANS.Complete[i])]),
        [2638, 2333, 2333, 2334], { rightNums: true, boldFirst: true }),
      spacer(),
      ...band("Schedule 2: support and service levels", C.navy),
      table(["Priority", "Example", "First response", "Aim to fix"], [
        [{ t: "Urgent", bold: true, color: C.rose }, "Nobody can sign in; results or an exam cannot open", "2 hours (school hours)", "Same day"],
        [{ t: "High", bold: true, color: C.amber }, "A module is not working for a group of users", "4 hours", "2 working days"],
        [{ t: "Normal", bold: true, color: C.teal }, "A question, a change to a setting, training", "1 working day", "5 working days"]
      ], [1500, 3738, 2200, 2200]),
      P("Support hours: 07:30–17:00, Monday to Friday (Lagos time), on WhatsApp, phone and email; urgent issues on results and exam days are also covered outside these hours by arrangement.", { before: 120, size: 19 }),
      ...band("Schedule 3: implementation", C.teal),
      table(["Week", "Activity"], [
        ["1", "Kick-off, modules switched on, data import (students, classes, staff, parents)"],
        ["2", "Results, fees, payment accounts and timetable set up"],
        ["3", "Training for administrators, teachers, bursar and gate staff; parents invited automatically"],
        ["4", "Go live; review meeting after the first month"]
      ], [1200, W - 1200], { boldFirst: true, headFill: C.teal, firstColFill: C.tealLight })
    ] }
  ]
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "Synergy Swift Proposal.docx"), await Packer.toBuffer(proposal));
  fs.writeFileSync(path.join(OUT, "Synergy Swift MoU.docx"), await Packer.toBuffer(mou));
  console.log("written");
})();
