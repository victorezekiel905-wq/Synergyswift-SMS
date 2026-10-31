// Wikibooks' finished books: completed, print-ready, and Wikijunior (for children). Titles only; reading is on Wikibooks.
const fs = require("fs");
const wait = ms => new Promise(r => setTimeout(r, ms));
async function members(cat) {
  const out = []; let cont = "";
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`https://en.wikibooks.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=500&cmnamespace=0|102&format=json${cont ? `&cmcontinue=${encodeURIComponent(cont)}` : ""}`,
      { headers: { "User-Agent": "SynergySwift-Library/1.0 (school library catalogue)" } }).then(x => x.json()).catch(() => null);
    if (!r) break;
    out.push(...(r.query?.categorymembers ?? []).map(m => m.title));
    cont = r.continue?.cmcontinue ?? "";
    if (!cont) break;
    await wait(400);
  }
  return out;
}
(async () => {
  const completed = await members("Category:Completed books");
  const print = await members("Category:Books with print version");
  const junior = await members("Category:Wikijunior");
  const books = new Map();
  // A book's own page, not a chapter ("Book/Chapter") or a print page.
  const top = t => t.split("/")[0].replace(/^Wikijunior:/, "Wikijunior:");
  for (const [list, kind] of [[completed, "completed"], [print, "print"], [junior, "junior"]])
    for (const t of list) { const b = top(t); if (!books.has(b)) books.set(b, { title: b, kind, print: list === print }); else if (list === print) books.get(b).print = true; }
  fs.writeFileSync(__dirname + "/wikibooks.json", JSON.stringify([...books.values()]));
  console.log("completed", completed.length, "print", print.length, "junior", junior.length, "books", books.size);
})();
