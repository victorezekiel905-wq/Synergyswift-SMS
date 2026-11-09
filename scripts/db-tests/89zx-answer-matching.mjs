// Live-lesson typed answers (migration 9500): compared like exam answers, so end punctuation,
// curly quotes and quotes around the answer don't make a right answer wrong.
export default async function ({ q, check }) {
  console.log("\nLive answers: forgiving comparison");
  const n = async (s, cs = false) => (await q(`select live_app.normalize_text(${s === null ? "null" : `$v$${s}$v$`}, ${cs}) v`))[0].v;
  check("\"Paris.\" is read as \"paris\"", (await n("Paris.")) === "paris", await n("Paris."));
  check("curly and straight quotes around it are ignored", (await n("‘Paris’")) === "paris" && (await n('"Paris"')) === "paris", [await n("‘Paris’"), await n('"Paris"')]);
  check("spaces and capitals are still ignored", (await n("  the   SEINE ")) === "the seine");
  check("case-sensitive blanks keep capitals", (await n("Paris!", true)) === "Paris");
  check("an apostrophe inside a word stays (curly made straight)", (await n("Earth’s")) === "earth's", await n("Earth’s"));
  check("a decimal number is left alone", (await n("3.5")) === "3.5");
  check("an empty answer is empty", (await n(null)) === "" && (await n("...")) === "");
}
