/** Words of a highlight passage, numbered from 0. Students pick words by number; punctuation stays with its word. */
export function passageWords(text: string): string[] {
  return String(text ?? "").split(/\s+/).filter(Boolean);
}
