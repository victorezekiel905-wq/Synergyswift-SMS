// Builds the free library (migration 9100) from the open catalogues, into
// supabase/seed/open-books/*.json.gz, which the owner console loads into open_books.
//
//   node scripts/library/build-open-books.mjs <folder with the downloads>
//
// The folder holds pg_catalog.csv (https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv)
// and storyweaver.json, otl.json, openstax.json (fetched by scripts/library/fetch-open.cjs).
// Only books suitable for schools: Gutenberg books come from allowed categories only,
// never from excluded ones, and never with unsuitable words in the title or subjects.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/library/build-open-books.mjs <downloads folder>"); process.exit(1); }
const out = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../supabase/seed/open-books");
fs.mkdirSync(out, { recursive: true });

// ---------- school subjects ----------
const SUBJECTS = [
  ["Mathematics", /\b(math|mathematics|algebra|geometry|calculus|arithmetic|trigonometry|statistics|probability|precalculus)\b|^QA\d/i],
  ["English Language", /\b(english language|grammar|composition|spelling|writing|rhetoric|reading|vocabulary|phonics|dictionar)/i],
  ["Literature", /\b(literature|poetry|poems|drama|plays|novel|fiction|short stories|shakespeare|folklore|fairy tales|myths)\b/i],
  ["Biology", /\b(biology|zoology|botany|anatomy|physiology|ecology|genetics|evolution|animals|plants|insects|birds|microbiolog)/i],
  ["Chemistry", /\bchemi(stry|cal)\b/i],
  ["Physics", /\b(physics|mechanics|electricity|magnetism|optics|astronomy|thermodynamics)\b/i],
  ["Basic Science", /\b(science|nature study|natural history)\b/i],
  ["Agriculture", /\b(agricultur|farming|horticultur|gardening|crops|livestock|soil)/i],
  ["Geography", /\b(geography|geology|earth science|maps|climate|weather|travel|voyages)\b/i],
  ["History", /\b(history|biography|ancient|medieval|civilization|archaeolog)/i],
  ["Economics", /\b(economics|economy|finance|money|banking|trade)\b/i],
  ["Civic Education", /\b(civics|citizenship|government|political science|constitution|law)\b/i],
  ["Business Studies", /\b(business|management|marketing|commerce|entrepreneur|accounting|bookkeeping)\b/i],
  ["Computer Studies", /\b(computer|computing|programming|software|information technology|data science|python|java)\b/i],
  ["Fine Arts", /\b(art|drawing|painting|sculpture|design|architecture|crafts)\b/i],
  ["Music", /\bmusic/i],
  ["Physical & Health Education", /\b(health|hygiene|physical education|sport|games|exercise|nutrition|first aid)\b/i],
  ["Home Economics", /\b(cooking|cookery|home economics|domestic|sewing|household|food)\b/i],
  ["Languages", /\b(french|spanish|german|latin|yoruba|hausa|igbo|swahili|language)\b/i],
  ["Psychology & Life Skills", /\b(psychology|self-help|conduct of life|success|character|motivation|habits|personal development|study skills)\b/i],
  ["Philosophy", /\b(philosophy|ethics|logic)\b/i]
];
const subjectsOf = text => SUBJECTS.filter(([, re]) => re.test(text)).map(([n]) => n).slice(0, 4);
const clean = s => String(s ?? "").replace(/\s+/g, " ").trim();
const rows = [];
const add = r => { if (r.title && r.read_url) rows.push({ ...r, title: clean(r.title).slice(0, 500), authors: clean(r.authors).slice(0, 300) || null, description: clean(r.description).slice(0, 800) || null }); };

// ---------- Project Gutenberg ----------
function parseCsv(s) {
  const rs = []; let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rs.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rs.push(row); }
  return rs;
}
const SECTIONS = [
  ["children", /Children & Young Adult|Children's (Literature|Fiction|Book Series|Picture Books|Instructional|History|Myths|Verse|Anthologies)|Harper's Young People/],
  ["self_help", /How To|Philosophy & Ethics|Parenthood & Family/],
  ["science", /Science - |Mathematics|Engineering & Technology|Nature\/Gardening\/Animals|Animals-Wild|Environmental Issues|^Technology$/],
  ["history", /History - (Modern|American|British|Other|European|Early Modern|Ancient|Medieval|Schools)|Biographies|Archaeology/],
  ["education", /Teaching & Education|Language & Communication|Encyclopedias\/Dictionaries\/Reference|Journalism\/Media\/Writing/],
  ["arts", /^Category: (Art|Music|Architecture|Sports\/Hobbies|Cooking & Drinking|Nutrition)$|Plays\/Films\/Dramas/],
  ["poetry", /Poetry/],
  ["fiction", /Classics of Literature|Adventure|Science-Fiction & Fantasy|Historical Novels|Humour|Mythology, Legends & Folklore|Travel Writing|Harvard Classics|Best Books Ever/]
];
const EXCLUDE = /Romance|Gender & Sexuality|Drugs\/Alcohol|Banned Books|Erotic|Psychiatry|Law & Criminology|Crime, Thrillers|Slavery|Native America|History - Warfare|History - Religious|History - Royalty|Religion\/Spirituality|Christianity|Judaism|Latter Day Saints|American Missionary|Politics|World War|US Civil War|Health & Medicine|Detective Fiction|Western|Punch|Notes and Queries|Astounding Stories|Reports & Conference/;
const WORDS = /\b(sex|sexual|erotic|lust|harlot|prostitut|brothel|courtesan|mistress|seduc|nude|naked|rape|incest|whore|opium|cocaine|morphine|hashish|drunk|whisk(e)?y|gin|brandy|murder|assassin|torture|execution|massacre|suicide|ghost|vampire|witch|demon|devil|satan|occult|magic(k)? arts|necromancy|spiritualism|negro|nigger|darkey|coon|savage|heathen|slave|slavery|confederate|ku klux|aryan|race (problem|question)|eugenic|nazi|hitler|war of the|battle of|siege of|revolver|gun|pistol|duel|crime|criminal|prison|convict|gallows|hanging|vice|sin|divorce|adulter|bride|wedding night|love letters|kisses|passion)\b/i;
{
  const [h, ...data] = parseCsv(fs.readFileSync(path.join(src, "pg_catalog.csv"), "utf8"));
  const I = Object.fromEntries(h.map((k, i) => [k, i]));
  for (const r of data) {
    if (r[I.Type] !== "Text" || r[I.Language] !== "en") continue;
    const shelves = (r[I.Bookshelves] || "").split(";").map(x => x.trim()).filter(Boolean);
    if (!shelves.length || shelves.some(s => EXCLUDE.test(s))) continue;
    if (WORDS.test(`${r[I.Title]} ${r[I.Subjects]}`) || /^(Index of|The Project Gutenberg|Project Gutenberg)/i.test(r[I.Title])) continue;
    const sec = SECTIONS.find(([, re]) => shelves.some(s => re.test(s)));
    if (!sec) continue;
    const id = r[I["Text#"]];
    const subjects = subjectsOf(`${r[I.Subjects]} ${r[I.Bookshelves]} ${r[I.LoCC]} ${r[I.Title]}`);
    add({ id: `gutenberg:${id}`, source: "gutenberg", section: sec[0], title: r[I.Title], authors: r[I.Authors].replace(/, \d{4}\??-\d{0,4}\??/g, ""),
      description: null, subjects: subjects.length ? subjects : [sec[0] === "poetry" || sec[0] === "fiction" || sec[0] === "children" ? "Literature" : "General reading"],
      level: sec[0] === "children" ? "primary" : "secondary",
      read_url: `https://www.gutenberg.org/ebooks/${id}.html.images`, download_url: `https://www.gutenberg.org/ebooks/${id}.epub3.images`,
      cover_url: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`, licence: "Public domain" });
  }
}

// ---------- StoryWeaver (illustrated storybooks, CC BY) ----------
const read = f => { if (!fs.existsSync(path.join(src, f))) return []; const j = JSON.parse(fs.readFileSync(path.join(src, f), "utf8")); return Array.isArray(j) ? j : j.items ?? j.data ?? j.books ?? []; };
for (const b of read("storyweaver.json")) {
  add({ id: `storyweaver:${b.id}`, source: "storyweaver", section: "storybooks", title: b.title, authors: b.authors, description: b.description,
    subjects: [...new Set(["Literature", "English Language", ...subjectsOf(`${b.title} ${b.description}`)])].slice(0, 4),
    level: String(b.level) === "1" ? "early_years" : "primary", read_url: `https://storyweaver.org.in/en/stories/${b.slug}`, download_url: null,
    cover_url: /^https:\/\//.test(b.cover ?? "") ? b.cover : null, licence: "CC BY 4.0 (StoryWeaver)" });
}

// ---------- Open Textbook Library ----------
// Suitable for senior secondary (and A-level): introductory and general courses, as well as school-level books.
const SECONDARY = /\b(intro\w*|elementary|basic|fundamentals?|beginning|beginner\w*|pre-?algebra|prealgebra|pre-?calculus|high school|secondary|k-?12|ap|a-?level|gcse|igcse|essentials|principles of|college algebra|arithmetic|foundations?|general (chemistry|biology|physics|science)|(physics|chemistry|biology|calculus) (i|1)|survey of|concepts of|conceptual)\b/i;
for (const b of read("otl.json")) {
  if (b.language && !/^en/.test(b.language)) continue;
  const pdf = (b.formats ?? []).find(f => /pdf/i.test(f.type) && /^https:\/\//.test(f.url ?? ""));
  add({ id: `otl:${b.id}`, source: "open_textbook_library", section: "textbooks", title: b.title, authors: b.authors, description: b.description,
    subjects: (s => (s.length ? s : ["General reading"]))(subjectsOf(`${(b.subjects ?? []).join(" ")} ${b.title}`)),
    level: SECONDARY.test(b.title) ? "secondary" : "tertiary", read_url: `https://open.umn.edu/opentextbooks/textbooks/${b.id}`, download_url: pdf?.url ?? null,
    cover_url: null, licence: b.license ?? "Open licence" });
}

// ---------- OpenStax (CC BY) ----------
for (const b of read("openstax.json")) {
  if (b.book_state && !/live|new_edition_available|deprecated/.test(b.book_state)) continue;
  const slug = b.meta?.slug;
  const readUrl = /^https:\/\//.test(b.webview_rex_link ?? "") ? b.webview_rex_link : slug ? `https://openstax.org/details/books/${slug}` : null;
  if (!readUrl) continue;
  const subjectNames = (b.book_subjects ?? []).map(s => s.subject_name ?? s.name ?? "").join(" ");
  add({ id: `openstax:${b.id}`, source: "openstax", section: "textbooks", title: b.title, authors: "OpenStax", description: String(b.description ?? "").replace(/<[^>]+>/g, " "),
    subjects: (s => (s.length ? s : ["General reading"]))(subjectsOf(`${subjectNames} ${b.title}`)),
    level: /\b(high school|ap|k-?12|prealgebra|elementary)\b/i.test(`${b.title} ${JSON.stringify(b.book_categories ?? "")}`) ? "secondary" : "tertiary",
    read_url: readUrl, download_url: /^https:\/\//.test(b.high_resolution_pdf_url ?? "") ? b.high_resolution_pdf_url : null,
    cover_url: /^https:\/\//.test(b.cover_url ?? "") ? b.cover_url : null, licence: "CC BY 4.0 (OpenStax)" });
}

// ---------- LibreTexts (open textbooks; only those with a clear open licence) ----------
const OPEN = /^(ccby|ccbysa|ccbync|ccbyncsa|ccbynd|ccbyncnd|publicdomain|gnufdl|gnu|ck12)$/;
const LIBRARY = { bio: "Biology", chem: "Chemistry", phys: "Physics", math: "Mathematics", stats: "Mathematics", geo: "Geography", biz: "Business Studies",
  eng: "Computer Studies", med: "Physical & Health Education", workforce: "Business Studies" };
const lt = read("libretexts.json");
for (const b of lt) {
  if (!OPEN.test(b.license ?? "") || b.library === "espanol") continue;
  const text = `${b.title} ${b.subject ?? ""} ${b.summary ?? ""}`;
  if (WORDS.test(`${b.title} ${b.subject ?? ""}`) || /\b(sexuality|sexual health|reproductive health|human sexuality)\b/i.test(b.title)) continue;
  const online = b.links?.online;
  if (!/^https:\/\//.test(online ?? "")) continue;
  const subjects = [...new Set([LIBRARY[b.library], ...subjectsOf(text)].filter(Boolean))].slice(0, 4);
  add({ id: `libretexts:${b.bookID}`, source: "libretexts", section: "textbooks", title: b.title, authors: b.author, description: b.summary,
    subjects: subjects.length ? subjects : ["General reading"], level: b.library === "k12" || SECONDARY.test(b.title) ? "secondary" : "tertiary",
    read_url: online, download_url: /^https:\/\//.test(b.links?.pdf ?? "") ? b.links.pdf : null,
    cover_url: /^https:\/\//.test(b.thumbnail ?? "") ? b.thumbnail : null, licence: (b.license ?? "").toUpperCase().replace(/^CC/, "CC ").replace("PUBLICDOMAIN", "Public domain") });
}

// ---------- Wikibooks (finished books on school subjects only) ----------
for (const b of read("wikibooks.json")) {
  const subjects = subjectsOf(b.title);
  if (!subjects.length || WORDS.test(b.title)) continue;
  const page = encodeURIComponent(b.title.replace(/ /g, "_")).replace(/%2F/g, "/");
  add({ id: `wikibooks:${b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 120)}`, source: "wikibooks", section: "textbooks", title: b.title, authors: "Wikibooks contributors",
    description: b.kind === "completed" ? "A completed Wikibooks textbook." : "A Wikibooks textbook with a print version.",
    subjects, level: SECONDARY.test(b.title) ? "secondary" : "all",
    read_url: `https://en.wikibooks.org/wiki/${b.print ? `${page}/Print_version` : page}`, download_url: null, cover_url: null, licence: "CC BY-SA (Wikibooks)" });
}

// ---------- write, in files of 5,000 ----------
for (const f of fs.readdirSync(out)) if (f.endsWith(".json.gz")) fs.unlinkSync(path.join(out, f));
const bySource = rows.reduce((m, r) => ((m[r.source] = (m[r.source] ?? 0) + 1), m), {});
const bySection = rows.reduce((m, r) => ((m[r.section] = (m[r.section] ?? 0) + 1), m), {});
for (let i = 0, n = 1; i < rows.length; i += 5000, n++) fs.writeFileSync(path.join(out, `part-${String(n).padStart(2, "0")}.json.gz`), zlib.gzipSync(JSON.stringify(rows.slice(i, i + 5000))));
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify({ total: rows.length, bySource, bySection, built: new Date().toISOString().slice(0, 10) }, null, 2));
console.log("total", rows.length, bySource, bySection);
