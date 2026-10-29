// The free library collection (migration 8500): added once per school, links kept safe.
export default async function ({ db, q, check, T }) {
  console.log("\nFree library collection");
  await db.exec(`insert into library_books (tenant_id, title, format, source_key, download_url, curricula, levels, licence, total_copies, available_copies)
    values ('${T.A}', 'Treasure Island', 'ebook', 'gutenberg:120', 'https://www.gutenberg.org/ebooks/120.epub3.images', '{NG,UK,US}', 'Junior secondary', 'Public domain', 0, 0)`);
  let twice = false;
  try { await q(`insert into library_books (tenant_id, title, format, source_key, total_copies, available_copies) values ('${T.A}', 'Treasure Island', 'ebook', 'gutenberg:120', 0, 0)`); } catch { twice = true; }
  check("a school gets each free title once", twice);
  await q(`insert into library_books (tenant_id, title, format, source_key, total_copies, available_copies) values ('${T.B}', 'Treasure Island', 'ebook', 'gutenberg:120', 0, 0)`);
  check("another school can have it too", (await q(`select count(*)::int n from library_books where source_key = 'gutenberg:120'`))[0].n === 2);
  let unsafe = false;
  try { await q(`update library_books set download_url = 'http://example.com/x.pdf' where source_key = 'gutenberg:120' and tenant_id = '${T.A}'`); } catch { unsafe = true; }
  check("download links must be https", unsafe);
  await db.exec(`delete from library_books where source_key = 'gutenberg:120'`);
}
