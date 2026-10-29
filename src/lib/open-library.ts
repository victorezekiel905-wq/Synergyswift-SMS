/**
 * The free Synergy Swift library collection (phase 14q): books every school may
 * add with one click, to read online and download. Only books that are free to
 * share: public-domain classics and inspirational works from Project Gutenberg,
 * openly licensed textbooks from OpenStax (read on OpenStax and download its own
 * PDF; most are CC BY-NC-SA, so we link to OpenStax's copies rather than host
 * them), and free learning sites. Copyrighted textbooks (e.g. the Nigerian,
 * British and American publishers' books) are not included: schools upload the
 * copies they have bought. Every link here was checked on 28 October 2026.
 */
export type OpenBook = {
  key: string; title: string; author: string;
  kind: "Novel" | "Play" | "Poetry and stories" | "Inspirational" | "Textbook" | "Learning site";
  subject: string; levels: string; curricula: ("NG" | "UK" | "US")[];
  read_url: string; download_url: string | null; licence: string; source: string;
};

const ALL: OpenBook["curricula"] = ["NG", "UK", "US"];
const PRIMARY = "Primary (KS1–KS2, Grades 1–6)", JUNIOR = "Junior secondary (JSS1–3, KS3, Grades 6–8)", SENIOR = "Senior secondary (SS1–3, GCSE, Grades 9–12)", UPPER = "SS3 and A level (Grades 11–12, AP)";

const gutenberg = (id: number, title: string, author: string, kind: OpenBook["kind"], subject: string, levels: string): OpenBook => ({
  key: `gutenberg:${id}`, title, author, kind, subject, levels, curricula: ALL,
  read_url: `https://www.gutenberg.org/ebooks/${id}.html.images`, download_url: `https://www.gutenberg.org/ebooks/${id}.epub3.images`,
  licence: "Public domain", source: "Project Gutenberg"
});
const openstax = (slug: string, title: string, subject: string, levels: string, readPage: string, pdf: string, licence = "CC BY-NC-SA 4.0"): OpenBook => ({
  key: `openstax:${slug}`, title, author: "OpenStax", kind: "Textbook", subject, levels, curricula: ALL,
  read_url: `https://openstax.org/books/${slug}/pages/${readPage}`, download_url: `https://assets.openstax.org/oscms-prodcms/media/documents/${pdf}`, licence, source: "OpenStax (Rice University)"
});
const site = (key: string, title: string, author: string, subject: string, levels: string, curricula: OpenBook["curricula"], url: string, licence: string): OpenBook => ({
  key: `site:${key}`, title, author, kind: "Learning site", subject, levels, curricula, read_url: url, download_url: null, licence, source: author
});

export const OPEN_LIBRARY: OpenBook[] = [
  // Stories and novels for younger readers
  gutenberg(21, "Aesop's Fables", "Aesop", "Poetry and stories", "Literature", PRIMARY),
  gutenberg(2591, "Grimms' Fairy Tales", "Jacob and Wilhelm Grimm", "Poetry and stories", "Literature", PRIMARY),
  gutenberg(11, "Alice's Adventures in Wonderland", "Lewis Carroll", "Novel", "Literature", PRIMARY),
  gutenberg(55, "The Wonderful Wizard of Oz", "L. Frank Baum", "Novel", "Literature", PRIMARY),
  gutenberg(16, "Peter Pan", "J. M. Barrie", "Novel", "Literature", PRIMARY),
  gutenberg(113, "The Secret Garden", "Frances Hodgson Burnett", "Novel", "Literature", JUNIOR),
  gutenberg(120, "Treasure Island", "Robert Louis Stevenson", "Novel", "Literature", JUNIOR),
  gutenberg(74, "The Adventures of Tom Sawyer", "Mark Twain", "Novel", "Literature", JUNIOR),
  gutenberg(514, "Little Women", "Louisa May Alcott", "Novel", "Literature", JUNIOR),
  gutenberg(46, "A Christmas Carol", "Charles Dickens", "Novel", "Literature", JUNIOR),
  gutenberg(41, "The Legend of Sleepy Hollow", "Washington Irving", "Poetry and stories", "Literature", JUNIOR),
  gutenberg(829, "Gulliver's Travels", "Jonathan Swift", "Novel", "Literature", JUNIOR),
  gutenberg(35, "The Time Machine", "H. G. Wells", "Novel", "Literature", JUNIOR),
  gutenberg(36, "The War of the Worlds", "H. G. Wells", "Novel", "Literature", JUNIOR),
  gutenberg(1661, "The Adventures of Sherlock Holmes", "Arthur Conan Doyle", "Novel", "Literature", JUNIOR),
  gutenberg(2097, "The Sign of the Four", "Arthur Conan Doyle", "Novel", "Literature", SENIOR),
  // Classic novels and plays for senior secondary literature
  gutenberg(1342, "Pride and Prejudice", "Jane Austen", "Novel", "Literature", SENIOR),
  gutenberg(158, "Emma", "Jane Austen", "Novel", "Literature", SENIOR),
  gutenberg(1260, "Jane Eyre", "Charlotte Brontë", "Novel", "Literature", SENIOR),
  gutenberg(768, "Wuthering Heights", "Emily Brontë", "Novel", "Literature", SENIOR),
  gutenberg(1400, "Great Expectations", "Charles Dickens", "Novel", "Literature", SENIOR),
  gutenberg(98, "A Tale of Two Cities", "Charles Dickens", "Novel", "Literature", SENIOR),
  gutenberg(84, "Frankenstein", "Mary Shelley", "Novel", "Literature", SENIOR),
  gutenberg(345, "Dracula", "Bram Stoker", "Novel", "Literature", SENIOR),
  gutenberg(76, "Adventures of Huckleberry Finn", "Mark Twain", "Novel", "Literature", SENIOR),
  gutenberg(2701, "Moby Dick", "Herman Melville", "Novel", "Literature", SENIOR),
  gutenberg(1184, "The Count of Monte Cristo", "Alexandre Dumas", "Novel", "Literature", SENIOR),
  gutenberg(5200, "Metamorphosis", "Franz Kafka", "Novel", "Literature", UPPER),
  gutenberg(219, "Heart of Darkness", "Joseph Conrad", "Novel", "Literature", UPPER),
  gutenberg(1513, "Romeo and Juliet", "William Shakespeare", "Play", "Literature", SENIOR),
  gutenberg(1533, "Macbeth", "William Shakespeare", "Play", "Literature", SENIOR),
  gutenberg(1524, "Hamlet", "William Shakespeare", "Play", "Literature", UPPER),
  gutenberg(1727, "The Odyssey", "Homer", "Poetry and stories", "Literature", SENIOR),
  // Inspirational lives and ideas
  gutenberg(15399, "The Interesting Narrative of the Life of Olaudah Equiano", "Olaudah Equiano", "Inspirational", "History", SENIOR),
  gutenberg(2376, "Up from Slavery", "Booker T. Washington", "Inspirational", "History", SENIOR),
  gutenberg(23, "Narrative of the Life of Frederick Douglass", "Frederick Douglass", "Inspirational", "History", SENIOR),
  gutenberg(408, "The Souls of Black Folk", "W. E. B. Du Bois", "Inspirational", "History", UPPER),
  gutenberg(20203, "Autobiography of Benjamin Franklin", "Benjamin Franklin", "Inspirational", "History", SENIOR),
  gutenberg(935, "Self-Help", "Samuel Smiles", "Inspirational", "Personal development", SENIOR),
  gutenberg(4507, "As a Man Thinketh", "James Allen", "Inspirational", "Personal development", SENIOR),
  gutenberg(2680, "Meditations", "Marcus Aurelius", "Inspirational", "Philosophy", UPPER),
  gutenberg(132, "The Art of War", "Sun Tzu", "Inspirational", "Philosophy", UPPER),
  gutenberg(205, "Walden", "Henry David Thoreau", "Inspirational", "Philosophy", UPPER),
  // Textbooks
  openstax("prealgebra-2e", "Prealgebra 2e", "Mathematics", JUNIOR, "1-introduction", "prealgebra-2e_-_WEB.pdf"),
  openstax("elementary-algebra-2e", "Elementary Algebra 2e", "Mathematics", JUNIOR, "1-introduction", "elementary-algebra-2e_-_WEB.pdf"),
  openstax("intermediate-algebra-2e", "Intermediate Algebra 2e", "Mathematics", SENIOR, "1-introduction", "intermediate-algebra-2e_-_WEB.pdf"),
  openstax("contemporary-mathematics", "Contemporary Mathematics", "Mathematics", SENIOR, "1-introduction", "contemporary-mathematics_-_WEB.pdf"),
  openstax("algebra-and-trigonometry-2e", "Algebra and Trigonometry 2e", "Further mathematics", UPPER, "1-introduction-to-prerequisites", "algebra-and-trigonometry-2e_-_WEB.pdf"),
  openstax("precalculus-2e", "Precalculus 2e", "Further mathematics", UPPER, "1-introduction-to-functions", "precalculus-2e_-_WEB.pdf"),
  openstax("calculus-volume-1", "Calculus Volume 1", "Further mathematics", UPPER, "1-introduction", "calculus-volume-1_-_WEB.pdf"),
  openstax("statistics", "Statistics (high school)", "Mathematics", SENIOR, "1-introduction", "high-school-statistics_-_WEB.pdf", "CC BY 4.0"),
  openstax("introductory-statistics-2e", "Introductory Statistics 2e", "Mathematics", UPPER, "1-introduction", "introductory-statistics-2e_-_WEB.pdf"),
  openstax("physics", "Physics (high school)", "Physics", SENIOR, "1-introduction", "Physics_-_WEB.pdf", "CC BY 4.0"),
  openstax("college-physics-2e", "College Physics 2e", "Physics", UPPER, "1-introduction-to-science-and-the-realm-of-physics-physical-quantities-and-units", "college-physics-2e_-_WEB.pdf"),
  openstax("chemistry-2e", "Chemistry 2e", "Chemistry", UPPER, "1-introduction", "chemistry-2e_-_WEB.pdf"),
  openstax("concepts-biology", "Concepts of Biology", "Biology", SENIOR, "1-introduction", "Concepts-Biology_-_WEB.pdf"),
  openstax("biology-ap-courses", "Biology for AP Courses", "Biology", UPPER, "1-introduction", "Biology-AP-Courses_-_WEB.pdf"),
  openstax("biology-2e", "Biology 2e", "Biology", UPPER, "1-introduction", "Biology-2e_-_WEB.pdf"),
  openstax("astronomy-2e", "Astronomy 2e", "Physics", SENIOR, "1-introduction", "astronomy-2e_-_WEB.pdf"),
  openstax("introduction-computer-science", "Introduction to Computer Science", "Computer studies", SENIOR, "1-introduction", "Introduction_To_Computer_Science_-_WEB.pdf"),
  openstax("principles-economics-3e", "Principles of Economics 3e", "Economics", SENIOR, "1-introduction", "principles-economics-3e_-_WEB.pdf"),
  openstax("principles-financial-accounting", "Principles of Accounting, Volume 1", "Financial accounting", SENIOR, "1-why-it-matters", "principles-financial-accounting_-_WEB.pdf"),
  openstax("introduction-business-2e", "Introduction to Business 2e", "Commerce and business studies", SENIOR, "1-introduction", "Introduction_to_Business_2e_-_WEB.pdf"),
  openstax("world-history-volume-1", "World History, Volume 1: to 1500", "History", SENIOR, "1-introduction", "World_History_Volume_1-WEB.pdf"),
  openstax("world-history-volume-2", "World History, Volume 2: from 1400", "History", SENIOR, "1-introduction", "World_History_Volume_2-WEB.pdf"),
  openstax("us-history", "U.S. History", "History", SENIOR, "1-introduction", "US_History_-_WEB.pdf"),
  openstax("introduction-sociology-3e", "Introduction to Sociology 3e", "Social studies", UPPER, "1-introduction", "introduction-sociology-3e_-_WEB.pdf"),
  openstax("psychology-2e", "Psychology 2e", "Social studies", UPPER, "1-introduction", "Psychology2e_WEB.pdf"),
  openstax("introduction-philosophy", "Introduction to Philosophy", "Philosophy", UPPER, "1-introduction", "Introduction_to_Philosophy-WEB.pdf"),
  openstax("writing-guide", "Writing Guide with Handbook", "English language", UPPER, "1-introduction", "WritingGuide-WEB.pdf"),
  // Free learning sites for every subject and class
  site("nigeria-learning-passport", "Nigeria Learning Passport", "UNICEF and the Federal Ministry of Education", "All subjects", "Primary to senior secondary", ["NG"], "https://nigeria.learningpassport.org/", "Free for learners in Nigeria"),
  site("oak-national-academy", "Oak National Academy", "Oak National Academy", "All subjects", "KS1 to KS4", ["UK"], "https://www.thenational.academy/", "Open Government Licence"),
  site("bbc-bitesize", "BBC Bitesize", "BBC", "All subjects", "KS1 to GCSE", ["UK"], "https://www.bbc.co.uk/bitesize", "Free to use"),
  site("khan-academy", "Khan Academy", "Khan Academy", "Mathematics, science, computing, economics", "Grades 1–12", ["US", "NG", "UK"], "https://www.khanacademy.org/", "Free, non-profit"),
  site("ck12", "CK-12 FlexBooks", "CK-12 Foundation", "Mathematics and science", "Grades 1–12", ["US"], "https://www.ck12.org/", "Free (CC BY-NC)"),
  site("siyavula", "Siyavula Mathematics and Science", "Siyavula", "Mathematics and physical sciences", "Grades 10–12", ["NG", "UK", "US"], "https://www.siyavula.com/", "CC BY"),
  site("storyweaver", "StoryWeaver picture books", "Pratham Books", "Reading", PRIMARY, ["NG", "UK", "US"], "https://storyweaver.org.in/en/", "CC BY 4.0"),
  site("openstax-k12", "OpenStax for high school", "OpenStax (Rice University)", "Mathematics and science", "Grades 9–12", ["US", "NG", "UK"], "https://openstax.org/k12", "CC BY")
];

export const OPEN_KINDS = [...new Set(OPEN_LIBRARY.map(b => b.kind))];
