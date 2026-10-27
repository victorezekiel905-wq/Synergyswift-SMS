/**
 * Starter practice questions so a new school's bank and past-question
 * practice are not empty on day one. Written for Synergy Swift: these are NOT
 * official WAEC, NECO or JAMB past questions (those are the exam bodies'
 * copyright). They are tagged exam_body "Sample" and open for practice.
 * Schools add their own past questions with the spreadsheet import.
 */
type Diff = "easy" | "medium" | "hard";
type Bloom = "remember" | "understand" | "apply" | "analyse";
export type StarterQuestion = {
  subject: string; topic: string; difficulty: Diff; bloom: Bloom; type: string; prompt: string; points: number;
  data: Record<string, unknown>; answer: Record<string, unknown>; explanation: string;
};

const L = ["a", "b", "c", "d"];
function mcq(subject: string, topic: string, difficulty: Diff, bloom: Bloom, prompt: string, options: string[], correct: number, explanation: string): StarterQuestion {
  return { subject, topic, difficulty, bloom, type: "mcq_single", prompt, points: 1, data: { options: options.map((text, i) => ({ id: L[i], text })) }, answer: { correct: L[correct] }, explanation };
}
function num(subject: string, topic: string, difficulty: Diff, bloom: Bloom, prompt: string, value: number, unit: string, explanation: string, tolerance = 0): StarterQuestion {
  return { subject, topic, difficulty, bloom, type: "numeric", prompt, points: 1, data: { unit }, answer: { value, tolerance }, explanation };
}
function expr(subject: string, topic: string, difficulty: Diff, bloom: Bloom, prompt: string, expression: string, explanation: string): StarterQuestion {
  return { subject, topic, difficulty, bloom, type: "math", prompt, points: 1, data: { hint: null }, answer: { expression, alternatives: [] }, explanation };
}

const M = "Mathematics", E = "English", B = "Biology", C = "Chemistry", P = "Physics", EC = "Economics", G = "Government";

export const STARTER_QUESTIONS: StarterQuestion[] = [
  // Mathematics
  mcq(M, "Algebra", "easy", "apply", "Simplify 3x + 5x − 2x.", ["6x", "10x", "4x", "8x"], 0, "3x + 5x = 8x, and 8x − 2x = 6x."),
  mcq(M, "Linear equations", "easy", "apply", "Solve 2x + 7 = 19.", ["5", "6", "7", "13"], 1, "2x = 19 − 7 = 12, so x = 6."),
  expr(M, "Algebra", "medium", "apply", "Expand (x + 3)(x − 3).", "x^2 - 9", "This is a difference of two squares: (x + 3)(x − 3) = x² − 9."),
  num(M, "Mensuration", "easy", "apply", "Find the area of a rectangle 8 cm long and 5 cm wide.", 40, "cm²", "Area = length × width = 8 × 5 = 40 cm²."),
  mcq(M, "Indices", "easy", "apply", "Simplify 2³ × 2⁴.", ["2¹²", "2⁷", "4⁷", "2¹"], 1, "When multiplying powers of the same base, add the indices: 3 + 4 = 7."),
  mcq(M, "Fractions and decimals", "easy", "understand", "Express 0.75 as a fraction in its lowest terms.", ["3/4", "7/5", "1/4", "75/10"], 0, "0.75 = 75/100 = 3/4."),
  num(M, "Statistics", "easy", "apply", "Find the mean of 4, 8, 6, 10 and 12.", 8, "", "Sum = 40 and there are 5 numbers, so the mean is 40 ÷ 5 = 8."),
  mcq(M, "Geometry", "easy", "remember", "What is the sum of the interior angles of a triangle?", ["90°", "180°", "270°", "360°"], 1, "The interior angles of any triangle add up to 180°."),
  mcq(M, "Percentages", "easy", "apply", "Find 15% of 240.", ["24", "36", "30", "40"], 1, "15% of 240 = 0.15 × 240 = 36."),
  num(M, "Coordinate geometry", "medium", "apply", "Find the gradient of the straight line through (1, 2) and (3, 8).", 3, "", "Gradient = (8 − 2) ÷ (3 − 1) = 6 ÷ 2 = 3."),
  mcq(M, "Algebra", "medium", "apply", "Factorise x² + 5x + 6.", ["(x + 2)(x + 3)", "(x + 1)(x + 6)", "(x − 2)(x − 3)", "(x + 5)(x + 1)"], 0, "Find two numbers that multiply to 6 and add to 5: 2 and 3."),
  mcq(M, "Probability", "easy", "understand", "A fair coin is tossed once. What is the probability of getting a head?", ["1", "1/2", "1/4", "0"], 1, "There are two equally likely outcomes and one of them is a head."),
  mcq(M, "Standard form", "medium", "apply", "Write 1,250,000 in standard form.", ["1.25 × 10⁶", "12.5 × 10⁵", "1.25 × 10⁵", "125 × 10⁴"], 0, "Standard form is A × 10ⁿ with 1 ≤ A < 10: 1,250,000 = 1.25 × 10⁶."),
  num(M, "Mensuration", "medium", "apply", "Find the circumference of a circle of radius 7 cm. (Take π = 22/7.)", 44, "cm", "C = 2πr = 2 × 22/7 × 7 = 44 cm."),
  mcq(M, "Simultaneous equations", "medium", "apply", "Solve x + y = 10 and x − y = 4.", ["x = 7, y = 3", "x = 6, y = 4", "x = 3, y = 7", "x = 5, y = 5"], 0, "Adding the equations gives 2x = 14, so x = 7 and y = 3."),

  // English
  mcq(E, "Vocabulary", "easy", "remember", "Choose the word nearest in meaning to RAPID.", ["slow", "quick", "heavy", "quiet"], 1, "Rapid means fast or quick."),
  mcq(E, "Vocabulary", "easy", "remember", "Choose the word opposite in meaning to GENEROUS.", ["kind", "stingy", "wealthy", "helpful"], 1, "A generous person gives freely; a stingy person does not."),
  mcq(E, "Concord", "easy", "apply", "She ___ to school every day.", ["go", "goes", "going", "gone"], 1, "A singular subject (she) takes the -s form in the simple present: goes."),
  mcq(E, "Spelling", "medium", "remember", "Which word is spelt correctly?", ["accomodate", "accommodate", "acommodate", "accommadate"], 1, "Accommodate has a double c and a double m."),
  mcq(E, "Nouns", "easy", "remember", "What is the plural of CHILD?", ["childs", "children", "childrens", "childes"], 1, "Child has an irregular plural: children."),
  mcq(E, "Parts of speech", "easy", "understand", "In \"He ran quickly\", what part of speech is QUICKLY?", ["noun", "verb", "adjective", "adverb"], 3, "Quickly describes how he ran, so it modifies a verb: it is an adverb."),
  mcq(E, "Prepositions", "easy", "apply", "The book is ___ the table.", ["on", "of", "from", "to"], 0, "We say a thing rests on a surface."),
  mcq(E, "Verbs", "easy", "remember", "What is the simple past tense of WRITE?", ["writed", "wrote", "written", "writes"], 1, "Write is irregular: write, wrote, written."),
  mcq(E, "Sentences", "medium", "analyse", "Which of these is a complete sentence?", ["Running in the rain.", "Because I was late.", "The dog barked loudly.", "After the meeting ended."], 2, "A complete sentence needs a subject and a finite verb and must express a complete thought."),
  mcq(E, "Concord", "hard", "apply", "Neither the teacher nor the students ___ present.", ["was", "were", "is", "has been"], 1, "With neither … nor, the verb agrees with the nearer subject (students), which is plural."),
  mcq(E, "Idioms", "medium", "understand", "What does \"to break the ice\" mean?", ["to start a conversation in an awkward situation", "to destroy something cold", "to end a friendship", "to make a mistake"], 0, "Breaking the ice means easing tension so people start talking."),
  mcq(E, "Prepositions", "medium", "apply", "I have lived here ___ 2015.", ["for", "since", "from", "at"], 1, "Since is used with a point in time; for is used with a length of time."),
  mcq(E, "Adjectives", "easy", "remember", "What is the comparative form of GOOD?", ["gooder", "better", "best", "more good"], 1, "Good is irregular: good, better, best."),
  mcq(E, "Parts of speech", "easy", "remember", "Which of these words is a conjunction?", ["and", "table", "happy", "slowly"], 0, "And joins words or clauses: it is a conjunction."),
  mcq(E, "Voice", "medium", "apply", "Change to the passive: \"The boy kicked the ball.\"", ["The ball was kicked by the boy.", "The ball kicked the boy.", "The ball is kicked by the boy.", "The boy was kicked by the ball."], 0, "The object becomes the subject and the tense stays simple past: was kicked."),

  // Biology
  mcq(B, "Cell biology", "easy", "remember", "Which organelle releases energy from food in the cell?", ["nucleus", "mitochondrion", "ribosome", "cell wall"], 1, "Aerobic respiration takes place in the mitochondria."),
  mcq(B, "Plant nutrition", "easy", "remember", "The process by which green plants make their own food is called", ["respiration", "photosynthesis", "transpiration", "digestion"], 1, "Plants use light energy to make glucose from carbon dioxide and water."),
  mcq(B, "Plant nutrition", "easy", "remember", "Which pigment traps light energy for photosynthesis?", ["haemoglobin", "melanin", "chlorophyll", "keratin"], 2, "Chlorophyll in the chloroplasts absorbs light."),
  mcq(B, "Blood", "easy", "remember", "Which blood cells help the body fight infection?", ["red blood cells", "white blood cells", "platelets", "plasma"], 1, "White blood cells engulf germs and make antibodies."),
  mcq(B, "Cell biology", "easy", "remember", "What is the basic unit of life?", ["tissue", "organ", "cell", "system"], 2, "All living things are made of one or more cells."),
  mcq(B, "Circulation", "easy", "remember", "Which organ pumps blood round the body?", ["lungs", "liver", "heart", "kidney"], 2, "The heart is a muscular pump."),
  mcq(B, "Plant nutrition", "easy", "remember", "Which gas is given off during photosynthesis?", ["oxygen", "carbon dioxide", "nitrogen", "hydrogen"], 0, "Oxygen is released as a by-product of photosynthesis."),
  mcq(B, "Classification", "medium", "understand", "Which of these is a fungus?", ["mushroom", "fern", "moss", "alga"], 0, "Mushrooms are fungi; ferns and mosses are plants."),
  mcq(B, "Health and disease", "medium", "remember", "Malaria is spread by the bite of", ["the housefly", "the female Anopheles mosquito", "the tsetse fly", "the male Aedes mosquito"], 1, "The female Anopheles mosquito carries the malaria parasite (Plasmodium)."),
  mcq(B, "Plant structure", "easy", "remember", "Which part of a plant mainly absorbs water from the soil?", ["leaf", "flower", "root hairs", "stem"], 2, "Root hairs give a large surface area for taking in water."),
  mcq(B, "Digestion", "medium", "remember", "Which enzyme in saliva begins the digestion of starch?", ["pepsin", "salivary amylase", "lipase", "trypsin"], 1, "Salivary amylase breaks starch down into maltose."),
  num(B, "Circulation", "easy", "remember", "How many chambers does the human heart have?", 4, "", "Two atria and two ventricles."),
  mcq(B, "Genetics", "easy", "remember", "Which molecule carries genetic information?", ["ATP", "DNA", "glucose", "starch"], 1, "Genes are sections of DNA."),
  mcq(B, "Classification", "easy", "understand", "Which of these animals is a vertebrate?", ["earthworm", "snail", "frog", "spider"], 2, "A frog has a backbone; the others do not."),
  mcq(B, "Nutrition", "medium", "remember", "Scurvy is caused by a lack of", ["vitamin A", "vitamin C", "vitamin D", "vitamin K"], 1, "Vitamin C is needed to make collagen; without it gums bleed and wounds heal slowly."),

  // Chemistry
  mcq(C, "Symbols", "easy", "remember", "What is the chemical symbol for sodium?", ["S", "So", "Na", "Sd"], 2, "Na comes from the Latin name natrium."),
  num(C, "Acids and bases", "easy", "remember", "What is the pH of pure water at 25 °C?", 7, "", "Pure water is neutral, pH 7."),
  num(C, "Atomic structure", "easy", "remember", "What is the atomic number of carbon?", 6, "", "A carbon atom has 6 protons."),
  mcq(C, "Formulae", "easy", "remember", "What is the chemical formula of water?", ["HO", "H₂O", "H₂O₂", "OH₂"], 1, "Each water molecule has two hydrogen atoms and one oxygen atom."),
  mcq(C, "Gases", "easy", "remember", "Which gas turns limewater milky?", ["oxygen", "hydrogen", "carbon dioxide", "nitrogen"], 2, "Carbon dioxide forms insoluble calcium carbonate with limewater."),
  mcq(C, "Atomic structure", "easy", "remember", "Which particle carries a negative charge?", ["proton", "neutron", "electron", "nucleus"], 2, "Electrons are negative, protons positive and neutrons neutral."),
  mcq(C, "Separation", "easy", "apply", "Which method recovers salt from salt solution?", ["filtration", "evaporation", "sublimation", "decantation"], 1, "Heating drives off the water and leaves the salt."),
  mcq(C, "Air", "easy", "remember", "Which gas makes up most of the air?", ["oxygen", "nitrogen", "carbon dioxide", "argon"], 1, "Air is about 78% nitrogen."),
  mcq(C, "Acids and bases", "medium", "remember", "Which acid is found in the human stomach?", ["sulphuric acid", "nitric acid", "hydrochloric acid", "ethanoic acid"], 2, "The stomach secretes hydrochloric acid."),
  mcq(C, "Periodic table", "easy", "remember", "Which of these is a noble gas?", ["neon", "chlorine", "oxygen", "sodium"], 0, "Neon is in Group 0 (Group 18)."),
  num(C, "Mole concept", "medium", "apply", "Calculate the relative molecular mass of CO₂. (C = 12, O = 16)", 44, "", "12 + 2 × 16 = 44."),
  mcq(C, "Bonding", "medium", "understand", "What type of bond holds sodium chloride together?", ["covalent", "ionic", "metallic", "hydrogen"], 1, "Sodium gives an electron to chlorine, forming oppositely charged ions."),
  mcq(C, "Rates of reaction", "easy", "remember", "A substance that speeds up a reaction without being used up is a", ["reactant", "catalyst", "product", "solvent"], 1, "Catalysts lower the activation energy and are left unchanged."),
  mcq(C, "Rusting", "medium", "understand", "Iron rusts when it is exposed to", ["oxygen only", "water and oxygen", "water only", "carbon dioxide only"], 1, "Rusting needs both water and oxygen."),
  num(C, "Mole concept", "medium", "apply", "How many moles are in 18 g of water? (H = 1, O = 16)", 1, "mol", "Molar mass of H₂O = 18 g/mol, so 18 g is 1 mol."),

  // Physics
  mcq(P, "Units", "easy", "remember", "What is the SI unit of force?", ["joule", "newton", "watt", "pascal"], 1, "Force is measured in newtons (N)."),
  num(P, "Motion", "easy", "apply", "A car travels 100 m in 20 s. What is its average speed?", 5, "m/s", "Speed = distance ÷ time = 100 ÷ 20 = 5 m/s."),
  mcq(P, "Units", "easy", "remember", "What is the SI unit of electric current?", ["volt", "ohm", "ampere", "coulomb"], 2, "Current is measured in amperes (A)."),
  num(P, "Electricity", "easy", "apply", "A current of 2 A flows through a 5 Ω resistor. What is the voltage across it?", 10, "V", "V = IR = 2 × 5 = 10 V."),
  mcq(P, "Gravity", "easy", "remember", "The acceleration due to gravity near the Earth's surface is about", ["1 m/s²", "9.8 m/s²", "98 m/s²", "0.98 m/s²"], 1, "g ≈ 9.8 m/s² (often taken as 10 m/s²)."),
  mcq(P, "Scalars and vectors", "medium", "understand", "Which of these is a vector quantity?", ["mass", "speed", "velocity", "time"], 2, "Velocity has both size and direction."),
  num(P, "Mass and weight", "easy", "apply", "What is the weight of a 5 kg mass? (g = 10 m/s²)", 50, "N", "W = mg = 5 × 10 = 50 N."),
  mcq(P, "Light", "medium", "remember", "Which mirror is used as a car's side mirror to give a wide view?", ["plane", "concave", "convex", "parabolic"], 2, "A convex mirror gives a wider field of view."),
  mcq(P, "Energy", "easy", "remember", "The energy a body has because it is moving is called", ["potential energy", "kinetic energy", "heat energy", "chemical energy"], 1, "Kinetic energy is energy of motion."),
  mcq(P, "Sound", "easy", "understand", "Sound cannot travel through", ["water", "steel", "air", "a vacuum"], 3, "Sound needs a medium; a vacuum has no particles to vibrate."),
  mcq(P, "Waves", "easy", "remember", "What is the SI unit of frequency?", ["hertz", "metre", "second", "decibel"], 0, "Frequency is measured in hertz (Hz)."),
  num(P, "Work and power", "medium", "apply", "A machine does 600 J of work in 30 s. What is its power?", 20, "W", "Power = work ÷ time = 600 ÷ 30 = 20 W."),
  mcq(P, "Light", "medium", "remember", "Which colour of visible light has the longest wavelength?", ["violet", "blue", "green", "red"], 3, "Red light has the longest wavelength in the visible spectrum."),
  mcq(P, "Electricity", "easy", "remember", "Which device changes chemical energy into electrical energy?", ["electric motor", "battery", "generator", "bulb"], 1, "A cell or battery converts chemical energy to electrical energy."),
  num(P, "Density", "medium", "apply", "A block has a mass of 200 g and a volume of 50 cm³. What is its density?", 4, "g/cm³", "Density = mass ÷ volume = 200 ÷ 50 = 4 g/cm³."),

  // Economics
  mcq(EC, "Basic concepts", "easy", "understand", "The basic economic problem arises because of", ["scarcity", "inflation", "taxation", "trade"], 0, "Wants are unlimited but resources are scarce, so choices must be made."),
  mcq(EC, "Basic concepts", "medium", "understand", "Opportunity cost is", ["the price of a good", "the next best alternative given up", "the cost of production", "money spent on imports"], 1, "It is the value of the best alternative forgone when a choice is made."),
  mcq(EC, "Demand", "easy", "understand", "According to the law of demand, other things being equal, when price rises", ["quantity demanded rises", "quantity demanded falls", "supply falls", "demand stays the same"], 1, "Price and quantity demanded move in opposite directions."),
  mcq(EC, "Factors of production", "easy", "remember", "The reward for land as a factor of production is", ["wages", "interest", "rent", "profit"], 2, "Land earns rent."),
  mcq(EC, "Factors of production", "easy", "remember", "The reward for labour is", ["rent", "wages", "profit", "interest"], 1, "Labour earns wages or salaries."),
  mcq(EC, "Factors of production", "easy", "remember", "The reward for the entrepreneur is", ["profit", "rent", "interest", "wages"], 0, "The entrepreneur bears risk and earns profit."),
  mcq(EC, "Inflation", "medium", "understand", "Inflation is best described as", ["a fall in the general price level", "a persistent rise in the general price level", "a rise in the price of one good", "an increase in exports"], 1, "Inflation is a sustained increase in the general level of prices."),
  mcq(EC, "Money and banking", "medium", "remember", "One function of the Central Bank of Nigeria is", ["issuing the national currency", "collecting income tax", "running public schools", "selling petrol"], 0, "The CBN issues the naira and manages monetary policy."),
  mcq(EC, "Market structures", "easy", "remember", "A market with only one seller is called", ["perfect competition", "oligopoly", "monopoly", "duopoly"], 2, "A monopoly has a single seller."),
  mcq(EC, "National income", "easy", "remember", "GDP stands for", ["Gross Domestic Product", "General Development Plan", "Gross Daily Price", "Government Debt Payment"], 0, "GDP is the value of all goods and services produced in a country in a period."),
  mcq(EC, "Taxation", "medium", "understand", "Which of these is a direct tax?", ["personal income tax", "value added tax", "excise duty", "import duty"], 0, "A direct tax is paid straight to the government by the person it is levied on."),
  mcq(EC, "Production", "medium", "understand", "Division of labour usually leads to", ["higher output per worker", "less specialisation", "higher prices", "fewer goods"], 0, "Specialising lets workers become faster and more skilled."),

  // Government
  mcq(G, "Arms of government", "easy", "remember", "Which arm of government makes laws?", ["executive", "legislature", "judiciary", "civil service"], 1, "The legislature (parliament or national assembly) makes laws."),
  mcq(G, "Arms of government", "easy", "remember", "Which arm of government interprets laws?", ["executive", "legislature", "judiciary", "police"], 2, "Courts interpret the law."),
  mcq(G, "Arms of government", "easy", "remember", "Which arm of government carries out laws?", ["executive", "legislature", "judiciary", "press"], 0, "The executive implements laws."),
  mcq(G, "Democracy", "medium", "remember", "Who described democracy as government of the people, by the people, for the people?", ["Abraham Lincoln", "Aristotle", "Montesquieu", "John Locke"], 0, "Abraham Lincoln, in the Gettysburg Address (1863)."),
  mcq(G, "Nigerian history", "easy", "remember", "In which year did Nigeria gain independence?", ["1957", "1960", "1963", "1966"], 1, "Nigeria became independent on 1 October 1960."),
  mcq(G, "Nigerian history", "medium", "remember", "In which year did Nigeria become a republic?", ["1960", "1963", "1966", "1979"], 1, "Nigeria became a republic on 1 October 1963."),
  mcq(G, "Constitution", "easy", "remember", "The highest law of a country is its", ["constitution", "bye-law", "decree", "edict"], 0, "Every other law must agree with the constitution."),
  mcq(G, "Separation of powers", "medium", "remember", "The theory of separation of powers is most associated with", ["Montesquieu", "Karl Marx", "Thomas Hobbes", "Plato"], 0, "Montesquieu set it out in The Spirit of the Laws (1748)."),
  mcq(G, "Federalism", "medium", "understand", "Federalism is a system in which power is", ["held only by the central government", "shared between a central government and component units", "held by the military", "held by traditional rulers"], 1, "Powers are divided between the federal and state governments."),
  mcq(G, "Elections", "easy", "remember", "Franchise means", ["the right to vote", "a political party", "a court order", "a type of tax"], 0, "Franchise (suffrage) is the right to vote in elections."),
  num(G, "Nigerian federation", "easy", "remember", "How many states are there in Nigeria?", 36, "", "Nigeria has 36 states and the Federal Capital Territory."),
  mcq(G, "Rule of law", "medium", "remember", "The concept of the rule of law is most associated with", ["A. V. Dicey", "Adam Smith", "Karl Marx", "Rousseau"], 0, "A. V. Dicey popularised the rule of law in 1885.")
];

/** Matches a school's subject name to a starter subject ("Maths", "English Language", "Civic Education" …). */
export function starterSubjectFor(name: string): string | null {
  const n = name.toLowerCase();
  if (/math/.test(n) && !/further/.test(n)) return M;
  if (/english/.test(n)) return E;
  if (/biolog/.test(n)) return B;
  if (/chemi/.test(n)) return C;
  if (/physic/.test(n) && !/education|health/.test(n)) return P;
  if (/econom/.test(n)) return EC;
  if (/govern/.test(n)) return G;
  return null;
}
