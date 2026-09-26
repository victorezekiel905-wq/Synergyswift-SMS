/** Home languages parents can choose for translated messages. Codes are ISO 639-1. */
export const LANGUAGES: Record<string, string> = {
  en: "English", fr: "French", ar: "Arabic", pt: "Portuguese", es: "Spanish", sw: "Swahili",
  yo: "Yoruba", ha: "Hausa", ig: "Igbo", zu: "Zulu", xh: "Xhosa", af: "Afrikaans", am: "Amharic",
  so: "Somali", rw: "Kinyarwanda", tw: "Twi", hi: "Hindi", ur: "Urdu", bn: "Bengali", pa: "Punjabi",
  ta: "Tamil", zh: "Chinese (Simplified)", ja: "Japanese", ko: "Korean", vi: "Vietnamese", th: "Thai",
  id: "Indonesian", ms: "Malay", tl: "Filipino", tr: "Turkish", fa: "Persian", ru: "Russian",
  uk: "Ukrainian", pl: "Polish", ro: "Romanian", de: "German", it: "Italian", nl: "Dutch", el: "Greek", he: "Hebrew"
};

export function languageName(code: string | null | undefined): string {
  return (code && LANGUAGES[code]) || "English";
}

/** True when a message for this reader should be translated from the school's language. */
export function needsTranslation(readerLang: string | null | undefined, schoolLang: string | null | undefined): boolean {
  const r = (readerLang || "").toLowerCase(), s = (schoolLang || "en").toLowerCase();
  return Boolean(r) && r !== s && r in LANGUAGES;
}
