// Migration 9100: the free library every school sees. Readable by everyone signed in, changed only by the platform.
export default async function ({ db, q, expectRows, expectError, check, U }) {
  console.log("\nThe free library (shared by every school)");
  await db.exec(`insert into open_books (id, source, section, title, authors, subjects, level, read_url, download_url, licence) values
    ('gutenberg:11', 'gutenberg', 'children', 'Alice''s Adventures in Wonderland', 'Lewis Carroll', '{Literature}', 'primary', 'https://www.gutenberg.org/ebooks/11.html.images', 'https://www.gutenberg.org/ebooks/11.epub3.images', 'Public domain'),
    ('openstax:1', 'openstax', 'textbooks', 'Biology 2e', 'OpenStax', '{Biology}', 'secondary', 'https://openstax.org/details/books/biology-2e', null, 'CC BY 4.0')
    on conflict (id) do nothing;`);
  await expectRows("a student in one school sees the free library", U.studentA, "select count(*) n from open_books", 2);
  await expectRows("…and so does another school's admin", U.adminB, "select count(*) n from open_books", 2);
  await expectRows("search by subject", U.teacherA, "select id from open_books where subjects @> '{Biology}'", 1);
  await expectRows("search by words", U.teacherA, "select id from open_books where search @@ to_tsquery('simple', 'alice & wonderland')", 1);
  await expectError("a school can't add books to everyone's library", U.adminA,
    "insert into open_books (id, source, section, title, read_url) values ('gutenberg:999', 'gutenberg', 'fiction', 'Mine', 'https://example.org')", /permission denied|row-level security/);
  await expectError("…or change one", U.adminA, "update open_books set title = 'Changed' where id = 'gutenberg:11'", /permission denied/);
  await expectError("…or delete one", U.adminA, "delete from open_books where id = 'openstax:1'", /permission denied/);
  try {
    await db.exec("insert into open_books (id, source, section, title, read_url) values ('gutenberg:998', 'gutenberg', 'fiction', 'Bad', 'javascript:alert(1)')");
    check("links must be https", false, "a javascript: link was accepted");
  } catch (e) { check("links must be https", /check constraint/.test(e.message), e.message); }
  await db.exec(`delete from open_books where id in ('gutenberg:11', 'openstax:1')`);
  void q;
}
