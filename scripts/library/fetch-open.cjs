// Collects the free catalogues for the school library: StoryWeaver storybooks (English),
// the Open Textbook Library and OpenStax. Politely (one request at a time, a pause between).
const fs = require("fs");
const wait = ms => new Promise(r => setTimeout(r, ms));
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { "User-Agent": "SynergySwift-Library/1.0 (school library catalogue)" } }); if (r.ok) return await r.json(); }
    catch { /* retry */ }
    await wait(2000 * (i + 1));
  }
  return null;
}
(async () => {
  // StoryWeaver: 10,000 English storybooks, 50 a page.
  const sw = [];
  for (let p = 1; p <= 200; p++) {
    const j = await get(`https://storyweaver.org.in/api/v1/books-search?languages[]=English&page=${p}&per_page=50`);
    if (!j?.data?.length) { console.log("storyweaver stopped at page", p); break; }
    for (const b of j.data) sw.push({ id: b.id, title: b.title, level: b.level, slug: b.slug, authors: (b.authors ?? []).map(a => a.name).join(", "),
      description: b.description ?? "", cover: b.coverImage?.sizes?.[1]?.url ?? b.coverImage?.sizes?.[0]?.url ?? null, publisher: b.publisher?.name ?? null });
    if (p % 20 === 0) console.log("storyweaver page", p, sw.length);
    await wait(700);
  }
  fs.writeFileSync(__dirname + "/storyweaver.json", JSON.stringify(sw));
  console.log("storyweaver", sw.length);

  // Open Textbook Library: every textbook (paged).
  const otl = [];
  for (let p = 1; p <= 80; p++) {
    const j = await get(`https://open.umn.edu/opentextbooks/textbooks.json?page=${p}`);
    if (!j?.data?.length) break;
    for (const b of j.data) otl.push({ id: b.id, title: b.title, description: (b.description ?? "").slice(0, 600), license: b.license, year: b.copyright_year,
      subjects: (b.subjects ?? []).map(s => s.name), authors: (b.contributors ?? []).filter(c => /author/i.test(c.contribution ?? "author")).map(c => [c.first_name, c.last_name].filter(Boolean).join(" ")).join(", "),
      formats: (b.formats ?? []).map(f => ({ type: f.type, url: f.url })), language: b.language });
    await wait(700);
  }
  fs.writeFileSync(__dirname + "/otl.json", JSON.stringify(otl));
  console.log("open textbook library", otl.length);

  // OpenStax: every book, with its subjects.
  const os = await get("https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&fields=title,book_state,cover_url,high_resolution_pdf_url,low_resolution_pdf_url,webview_rex_link,description,book_subjects,book_categories&limit=250");
  fs.writeFileSync(__dirname + "/openstax.json", JSON.stringify(os?.items ?? []));
  console.log("openstax", (os?.items ?? []).length);
})();
