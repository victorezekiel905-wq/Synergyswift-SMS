/** Every term has two reports: the mid-term report and the end of term report (report_cards.kind). */
export type ReportKind = "midterm" | "term";

export const reportKindOf = (kind: string | null | undefined, data?: { kind?: string } | null): ReportKind =>
  (kind ?? data?.kind) === "midterm" ? "midterm" : "term";

export const REPORT_TITLE: Record<ReportKind, string> = { midterm: "Mid-term report", term: "End of term report" };

/** The term's name without the "(mid-term)" the card's own label carries. */
export const termName = (label: string | null | undefined) => String(label ?? "").replace(/\s*\(mid-term\)\s*$/i, "").trim();