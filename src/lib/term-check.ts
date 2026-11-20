/**
 * Things worth telling the school about its current term: it has ended but is still marked
 * current, or the session's name looks mistyped ("2026-2927"). Pure, unit tested.
 */
export type TermCheck = { ended_on: string | null; session_typo: string | null };

export function termCheck(term: { ends_on?: string | null; academic_sessions?: { name?: string | null } | null } | null, today: string): TermCheck | null {
  if (!term) return null;
  const ended_on = term.ends_on && term.ends_on < today ? term.ends_on : null;
  const name = term.academic_sessions?.name ?? "";
  const m = /(\d{4})\s*[-/–]\s*(\d{4})/.exec(name);
  const session_typo = m && Number(m[2]) !== Number(m[1]) + 1 ? `${m[1]}-${Number(m[1]) + 1}` : null;
  return ended_on || session_typo ? { ended_on, session_typo } : null;
}
