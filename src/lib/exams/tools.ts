/**
 * Exam tools a teacher can switch on per exam (stored in exams.settings.tools),
 * with one-click presets per subject. Pure, unit tested.
 */
export const EXAM_TOOLS = [
  { id: "calc_basic", label: "Basic calculator", group: "Maths", hint: "Add, subtract, multiply, divide, %, √ and memory." },
  { id: "calc_scientific", label: "Scientific calculator", group: "Maths", hint: "Trig in degrees or radians, logs, powers, roots, factorials, nCr and nPr." },
  { id: "graph_plotter", label: "Graph plotter", group: "Maths", hint: "Draws graphs of up to three functions. Leave off when students must plot by hand." },
  { id: "four_figure_tables", label: "Four-figure tables", group: "Maths", hint: "Logs, antilogs, squares, square roots, reciprocals, sines, cosines and tangents with mean differences." },
  { id: "statistical_tables", label: "Normal distribution table", group: "Maths", hint: "Φ(z) for z = 0.00 to 3.99." },
  { id: "geometry_set", label: "Mathematical set", group: "Maths", hint: "On-screen ruler, protractor and two set squares that students can move and turn." },
  { id: "math_formulae", label: "Maths formula sheet", group: "Maths", hint: "Mensuration, algebra, trigonometry, coordinate geometry, sequences and statistics." },
  { id: "math_symbols", label: "Maths symbols keyboard", group: "Maths", hint: "Types ², √, π, θ, ≤, ≥, ±, ∠ and more into any answer box." },
  { id: "periodic_table", label: "Periodic table", group: "Science", hint: "All 118 elements with atomic number, relative atomic mass, group and period." },
  { id: "chemistry_data", label: "Chemistry data sheet", group: "Science", hint: "Common ions and valencies, reactivity series, electrode potentials, solubility rules and constants." },
  { id: "physics_data", label: "Physics data and formulae", group: "Science", hint: "Physical constants, SI prefixes and the standard formulae." },
  { id: "unit_converter", label: "Unit converter", group: "Science", hint: "Length, mass, volume, time, speed, temperature, pressure, energy and power." },
  { id: "special_characters", label: "Language characters", group: "Languages", hint: "Accents and letters for French, Yoruba, Igbo, Hausa, Spanish and German." },
  { id: "read_aloud", label: "Read question aloud", group: "Access", hint: "Reads the question text aloud. Leave off for reading and listening tests." },
  { id: "text_size", label: "Larger text and contrast", group: "Access", hint: "Students can enlarge the text and switch to high contrast." },
  { id: "rough_work", label: "Rough work pad", group: "Access", hint: "A notepad and sketch pad for working. Never marked or sent to the teacher." },
  { id: "reference_sheet", label: "Teacher's reference sheet", group: "Access", hint: "Your own text shown to students, such as data, a key or a case study." }
] as const;

export type ToolId = (typeof EXAM_TOOLS)[number]["id"];
export const TOOL_IDS = EXAM_TOOLS.map(t => t.id) as [ToolId, ...ToolId[]];

export const TOOL_PRESETS: { id: string; label: string; tools: ToolId[] }[] = [
  { id: "mathematics", label: "Mathematics", tools: ["calc_scientific", "four_figure_tables", "geometry_set", "math_formulae", "math_symbols", "rough_work"] },
  { id: "further_maths", label: "Further Mathematics", tools: ["calc_scientific", "four_figure_tables", "statistical_tables", "geometry_set", "math_formulae", "math_symbols", "rough_work"] },
  { id: "physics", label: "Physics", tools: ["calc_scientific", "four_figure_tables", "physics_data", "geometry_set", "math_symbols", "rough_work"] },
  { id: "chemistry", label: "Chemistry", tools: ["calc_scientific", "periodic_table", "chemistry_data", "four_figure_tables", "math_symbols", "rough_work"] },
  { id: "biology", label: "Biology / Agric", tools: ["calc_basic", "rough_work"] },
  { id: "basic_science", label: "Basic Science / Technology", tools: ["calc_basic", "periodic_table", "geometry_set", "unit_converter", "rough_work"] },
  { id: "english", label: "English", tools: ["rough_work", "text_size"] },
  { id: "languages", label: "French / Nigerian languages", tools: ["special_characters", "rough_work", "text_size"] },
  { id: "commercial", label: "Accounting / Economics / Commerce", tools: ["calc_basic", "rough_work"] },
  { id: "geography", label: "Geography / Technical drawing", tools: ["calc_scientific", "geometry_set", "rough_work"] },
  { id: "computing", label: "Computer Studies", tools: ["calc_basic", "rough_work"] },
  { id: "primary", label: "Primary / Common Entrance", tools: ["read_aloud", "text_size", "rough_work"] }
];

/**
 * The tools an exam actually offers. Older exams only had allow_calculator,
 * which becomes the scientific calculator. Unknown ids are dropped.
 */
export function examTools(settings: Record<string, any> | null | undefined): ToolId[] {
  const s = settings ?? {};
  const raw: unknown[] = Array.isArray(s.tools) ? s.tools : s.allow_calculator ? ["calc_scientific"] : [];
  const known = new Set<string>(TOOL_IDS);
  return [...new Set(raw.filter((t): t is ToolId => typeof t === "string" && known.has(t)))];
}

export function toolLabel(id: string): string {
  return EXAM_TOOLS.find(t => t.id === id)?.label ?? id;
}
