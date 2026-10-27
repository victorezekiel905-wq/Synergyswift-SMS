/**
 * Reference data behind the exam tools: periodic table, chemistry and physics
 * data sheets, maths formulae, unit conversions and language characters.
 * Values are the ones used in Nigerian and Cambridge secondary syllabuses.
 */

/* ---------------- Periodic table ---------------- */

// Symbol|Name|Relative atomic mass (brackets = mass number of the longest-lived isotope), in order of atomic number.
const ELEMENT_LIST = `H|Hydrogen|1.008 He|Helium|4.003 Li|Lithium|6.94 Be|Beryllium|9.012 B|Boron|10.81 C|Carbon|12.011 N|Nitrogen|14.007 O|Oxygen|15.999 F|Fluorine|18.998 Ne|Neon|20.180
Na|Sodium|22.990 Mg|Magnesium|24.305 Al|Aluminium|26.982 Si|Silicon|28.085 P|Phosphorus|30.974 S|Sulfur|32.06 Cl|Chlorine|35.45 Ar|Argon|39.95 K|Potassium|39.098 Ca|Calcium|40.078
Sc|Scandium|44.956 Ti|Titanium|47.867 V|Vanadium|50.942 Cr|Chromium|51.996 Mn|Manganese|54.938 Fe|Iron|55.845 Co|Cobalt|58.933 Ni|Nickel|58.693 Cu|Copper|63.546 Zn|Zinc|65.38
Ga|Gallium|69.723 Ge|Germanium|72.630 As|Arsenic|74.922 Se|Selenium|78.971 Br|Bromine|79.904 Kr|Krypton|83.798 Rb|Rubidium|85.468 Sr|Strontium|87.62 Y|Yttrium|88.906 Zr|Zirconium|91.224
Nb|Niobium|92.906 Mo|Molybdenum|95.95 Tc|Technetium|[98] Ru|Ruthenium|101.07 Rh|Rhodium|102.91 Pd|Palladium|106.42 Ag|Silver|107.87 Cd|Cadmium|112.41 In|Indium|114.82 Sn|Tin|118.71
Sb|Antimony|121.76 Te|Tellurium|127.60 I|Iodine|126.90 Xe|Xenon|131.29 Cs|Caesium|132.91 Ba|Barium|137.33 La|Lanthanum|138.91 Ce|Cerium|140.12 Pr|Praseodymium|140.91 Nd|Neodymium|144.24
Pm|Promethium|[145] Sm|Samarium|150.36 Eu|Europium|151.96 Gd|Gadolinium|157.25 Tb|Terbium|158.93 Dy|Dysprosium|162.50 Ho|Holmium|164.93 Er|Erbium|167.26 Tm|Thulium|168.93 Yb|Ytterbium|173.05
Lu|Lutetium|174.97 Hf|Hafnium|178.49 Ta|Tantalum|180.95 W|Tungsten|183.84 Re|Rhenium|186.21 Os|Osmium|190.23 Ir|Iridium|192.22 Pt|Platinum|195.08 Au|Gold|196.97 Hg|Mercury|200.59
Tl|Thallium|204.38 Pb|Lead|207.2 Bi|Bismuth|208.98 Po|Polonium|[209] At|Astatine|[210] Rn|Radon|[222] Fr|Francium|[223] Ra|Radium|[226] Ac|Actinium|[227] Th|Thorium|232.04
Pa|Protactinium|231.04 U|Uranium|238.03 Np|Neptunium|[237] Pu|Plutonium|[244] Am|Americium|[243] Cm|Curium|[247] Bk|Berkelium|[247] Cf|Californium|[251] Es|Einsteinium|[252] Fm|Fermium|[257]
Md|Mendelevium|[258] No|Nobelium|[259] Lr|Lawrencium|[266] Rf|Rutherfordium|[267] Db|Dubnium|[268] Sg|Seaborgium|[269] Bh|Bohrium|[270] Hs|Hassium|[269] Mt|Meitnerium|[278] Ds|Darmstadtium|[281]
Rg|Roentgenium|[282] Cn|Copernicium|[285] Nh|Nihonium|[286] Fl|Flerovium|[289] Mc|Moscovium|[290] Lv|Livermorium|[293] Ts|Tennessine|[294] Og|Oganesson|[294]`;

export type ElementCategory = "alkali" | "alkaline" | "transition" | "post_transition" | "metalloid" | "nonmetal" | "halogen" | "noble" | "lanthanide" | "actinide";
export type Element = { z: number; symbol: string; name: string; mass: string; period: number; group: number | null; category: ElementCategory; shells: string };

export const CATEGORY_LABELS: Record<ElementCategory, string> = {
  alkali: "Alkali metal", alkaline: "Alkaline earth metal", transition: "Transition metal", post_transition: "Other metal",
  metalloid: "Metalloid", nonmetal: "Non-metal", halogen: "Halogen", noble: "Noble gas", lanthanide: "Lanthanide", actinide: "Actinide"
};

const PERIOD_END = [2, 10, 18, 36, 54, 86, 118];
const METALLOIDS = new Set(["B", "Si", "Ge", "As", "Sb", "Te"]);
const NONMETALS = new Set(["H", "C", "N", "O", "P", "S", "Se"]);

/** Period and group from the atomic number. Lanthanides and actinides (57–71, 89–103) have no group here. */
function position(z: number): { period: number; group: number | null; f: boolean } {
  const period = PERIOD_END.findIndex(e => z <= e) + 1;
  const start = period === 1 ? 1 : PERIOD_END[period - 2] + 1;
  const k = z - start; // 0-based index within the period
  if (period === 1) return { period, group: z === 1 ? 1 : 18, f: false };
  if (period <= 3) return { period, group: k < 2 ? k + 1 : k + 11, f: false };
  if (period <= 5) return { period, group: k + 1, f: false };
  if (k < 2) return { period, group: k + 1, f: false };
  if (k < 17) return { period, group: null, f: true };
  return { period, group: k - 13, f: false };
}

/** Electrons per shell (2, 8, 8, 2 style) for the first 20 elements, as taught in secondary school. */
function shells(z: number): string {
  if (z > 20) return "";
  const caps = [2, 8, 8, 2];
  const out: number[] = [];
  let left = z;
  for (const c of caps) { if (left <= 0) break; out.push(Math.min(c, left)); left -= c; }
  return out.join(", ");
}

export const ELEMENTS: Element[] = ELEMENT_LIST.split(/\s+/).filter(Boolean).map((row, i) => {
  const [symbol, name, mass] = row.split("|");
  const z = i + 1;
  const { period, group, f } = position(z);
  let category: ElementCategory;
  if (f) category = period === 6 ? "lanthanide" : "actinide";
  else if (group === 18) category = "noble";
  else if (group === 17) category = "halogen";
  else if (METALLOIDS.has(symbol)) category = "metalloid";
  else if (NONMETALS.has(symbol)) category = "nonmetal";
  else if (group === 1) category = "alkali";
  else if (group === 2) category = "alkaline";
  else if (group !== null && group >= 3 && group <= 12) category = "transition";
  else category = "post_transition";
  return { z, symbol, name, mass, period, group, category, shells: shells(z) };
});

/* ---------------- Chemistry data ---------------- */

export const IONS: { group: string; items: [string, string][] }[] = [
  { group: "Positive ions (cations)", items: [
    ["Hydrogen", "H⁺"], ["Sodium", "Na⁺"], ["Potassium", "K⁺"], ["Ammonium", "NH₄⁺"], ["Silver", "Ag⁺"], ["Copper(I)", "Cu⁺"],
    ["Magnesium", "Mg²⁺"], ["Calcium", "Ca²⁺"], ["Barium", "Ba²⁺"], ["Zinc", "Zn²⁺"], ["Copper(II)", "Cu²⁺"], ["Iron(II)", "Fe²⁺"], ["Lead(II)", "Pb²⁺"], ["Manganese(II)", "Mn²⁺"],
    ["Aluminium", "Al³⁺"], ["Iron(III)", "Fe³⁺"], ["Chromium(III)", "Cr³⁺"]
  ] },
  { group: "Negative ions (anions)", items: [
    ["Hydroxide", "OH⁻"], ["Chloride", "Cl⁻"], ["Bromide", "Br⁻"], ["Iodide", "I⁻"], ["Fluoride", "F⁻"], ["Nitrate", "NO₃⁻"], ["Nitrite", "NO₂⁻"],
    ["Hydrogencarbonate", "HCO₃⁻"], ["Hydrogensulfate", "HSO₄⁻"], ["Ethanoate (acetate)", "CH₃COO⁻"], ["Manganate(VII)", "MnO₄⁻"],
    ["Oxide", "O²⁻"], ["Sulfide", "S²⁻"], ["Sulfate", "SO₄²⁻"], ["Sulfite", "SO₃²⁻"], ["Carbonate", "CO₃²⁻"], ["Dichromate(VI)", "Cr₂O₇²⁻"], ["Thiosulfate", "S₂O₃²⁻"],
    ["Phosphate", "PO₄³⁻"], ["Nitride", "N³⁻"]
  ] }
];

export const REACTIVITY_SERIES = ["Potassium (K)", "Sodium (Na)", "Calcium (Ca)", "Magnesium (Mg)", "Aluminium (Al)", "(Carbon, C)", "Zinc (Zn)", "Iron (Fe)", "Tin (Sn)", "Lead (Pb)", "(Hydrogen, H)", "Copper (Cu)", "Mercury (Hg)", "Silver (Ag)", "Gold (Au)"];

export const ELECTRODE_POTENTIALS: [string, string][] = [
  ["Li⁺ + e⁻ ⇌ Li", "−3.04"], ["K⁺ + e⁻ ⇌ K", "−2.92"], ["Ca²⁺ + 2e⁻ ⇌ Ca", "−2.87"], ["Na⁺ + e⁻ ⇌ Na", "−2.71"], ["Mg²⁺ + 2e⁻ ⇌ Mg", "−2.37"],
  ["Al³⁺ + 3e⁻ ⇌ Al", "−1.66"], ["Zn²⁺ + 2e⁻ ⇌ Zn", "−0.76"], ["Fe²⁺ + 2e⁻ ⇌ Fe", "−0.44"], ["Sn²⁺ + 2e⁻ ⇌ Sn", "−0.14"], ["Pb²⁺ + 2e⁻ ⇌ Pb", "−0.13"],
  ["2H⁺ + 2e⁻ ⇌ H₂", "0.00"], ["Cu²⁺ + 2e⁻ ⇌ Cu", "+0.34"], ["I₂ + 2e⁻ ⇌ 2I⁻", "+0.54"], ["Fe³⁺ + e⁻ ⇌ Fe²⁺", "+0.77"], ["Ag⁺ + e⁻ ⇌ Ag", "+0.80"],
  ["Br₂ + 2e⁻ ⇌ 2Br⁻", "+1.09"], ["O₂ + 4H⁺ + 4e⁻ ⇌ 2H₂O", "+1.23"], ["Cl₂ + 2e⁻ ⇌ 2Cl⁻", "+1.36"], ["Au³⁺ + 3e⁻ ⇌ Au", "+1.50"], ["MnO₄⁻ + 8H⁺ + 5e⁻ ⇌ Mn²⁺ + 4H₂O", "+1.51"], ["F₂ + 2e⁻ ⇌ 2F⁻", "+2.87"]
];

export const SOLUBILITY_RULES = [
  "All sodium, potassium and ammonium salts are soluble.",
  "All nitrates and ethanoates are soluble.",
  "Chlorides, bromides and iodides are soluble, except those of silver and lead(II).",
  "Sulfates are soluble, except barium, lead(II) and calcium sulfate (slightly soluble).",
  "Carbonates and phosphates are insoluble, except sodium, potassium and ammonium.",
  "Hydroxides are insoluble, except sodium, potassium, ammonium and (slightly) calcium."
];

export const CHEM_CONSTANTS: [string, string][] = [
  ["Avogadro constant, Nᴀ", "6.02 × 10²³ mol⁻¹"], ["Molar volume of gas at s.t.p.", "22.4 dm³ mol⁻¹"], ["Molar volume at room temperature (r.t.p.)", "24.0 dm³ mol⁻¹"],
  ["Faraday constant, F", "96 500 C mol⁻¹"], ["Gas constant, R", "8.314 J K⁻¹ mol⁻¹"], ["Standard temperature and pressure", "273 K, 101 325 Pa (760 mmHg)"],
  ["Specific heat capacity of water", "4.2 J g⁻¹ K⁻¹"], ["Ionic product of water, Kw (25 °C)", "1.0 × 10⁻¹⁴ mol² dm⁻⁶"]
];

/* ---------------- Physics data ---------------- */

export const PHYSICS_CONSTANTS: [string, string][] = [
  ["Acceleration due to gravity, g", "9.8 m s⁻² (10 m s⁻² where the question says so)"], ["Speed of light in vacuum, c", "3.0 × 10⁸ m s⁻¹"],
  ["Speed of sound in air", "330–340 m s⁻¹"], ["Planck constant, h", "6.63 × 10⁻³⁴ J s"], ["Elementary charge, e", "1.6 × 10⁻¹⁹ C"],
  ["Mass of electron, mₑ", "9.11 × 10⁻³¹ kg"], ["Mass of proton, mₚ", "1.67 × 10⁻²⁷ kg"], ["Avogadro constant, Nᴀ", "6.02 × 10²³ mol⁻¹"],
  ["Gas constant, R", "8.31 J mol⁻¹ K⁻¹"], ["Boltzmann constant, k", "1.38 × 10⁻²³ J K⁻¹"], ["Gravitational constant, G", "6.67 × 10⁻¹¹ N m² kg⁻²"],
  ["Permittivity of free space, ε₀", "8.85 × 10⁻¹² F m⁻¹"], ["Permeability of free space, μ₀", "4π × 10⁻⁷ H m⁻¹"], ["1 electronvolt", "1.6 × 10⁻¹⁹ J"],
  ["Atmospheric pressure", "1.01 × 10⁵ Pa (760 mmHg)"], ["Density of water", "1000 kg m⁻³"], ["Specific heat capacity of water", "4200 J kg⁻¹ K⁻¹"],
  ["Specific latent heat of fusion of ice", "3.36 × 10⁵ J kg⁻¹"], ["Specific latent heat of vaporisation of water", "2.26 × 10⁶ J kg⁻¹"], ["Absolute zero", "0 K = −273 °C"]
];

export const SI_PREFIXES: [string, string, string][] = [
  ["tera", "T", "10¹²"], ["giga", "G", "10⁹"], ["mega", "M", "10⁶"], ["kilo", "k", "10³"], ["centi", "c", "10⁻²"], ["milli", "m", "10⁻³"],
  ["micro", "μ", "10⁻⁶"], ["nano", "n", "10⁻⁹"], ["pico", "p", "10⁻¹²"]
];

export type FormulaGroup = { title: string; items: [string, string][] };

export const PHYSICS_FORMULAE: FormulaGroup[] = [
  { title: "Motion", items: [["v = u + at", "uniform acceleration"], ["s = ut + ½at²", ""], ["v² = u² + 2as", ""], ["s = ½(u + v)t", ""], ["F = ma", "Newton's second law"], ["p = mv", "momentum"], ["W = mg", "weight"], ["Ft = mv − mu", "impulse"]] },
  { title: "Energy and power", items: [["W = Fs", "work"], ["Eₖ = ½mv²", "kinetic energy"], ["Eₚ = mgh", "potential energy"], ["P = W/t", "power"], ["Efficiency = output ÷ input × 100%", ""], ["M.A. = load ÷ effort", "machines"], ["V.R. = distance moved by effort ÷ distance moved by load", ""]] },
  { title: "Pressure and heat", items: [["P = F/A", "pressure"], ["P = ρgh", "liquid pressure"], ["ρ = m/V", "density"], ["Q = mcθ", "heat capacity"], ["Q = mL", "latent heat"], ["P₁V₁/T₁ = P₂V₂/T₂", "gas law"], ["ΔL = αL₀θ", "linear expansion"]] },
  { title: "Waves and light", items: [["v = fλ", "wave equation"], ["T = 1/f", "period"], ["n = sin i / sin r", "refractive index"], ["n = real depth ÷ apparent depth", ""], ["1/f = 1/u + 1/v", "lens and mirror formula"], ["m = v/u", "magnification"], ["sin c = 1/n", "critical angle"]] },
  { title: "Electricity and magnetism", items: [["V = IR", "Ohm's law"], ["Q = It", "charge"], ["P = IV = I²R = V²/R", "power"], ["E = IVt", "energy"], ["R = R₁ + R₂ + …", "series"], ["1/R = 1/R₁ + 1/R₂ + …", "parallel"], ["E = I(R + r)", "e.m.f. with internal resistance"], ["Vₛ/Vₚ = Nₛ/Nₚ", "transformer"], ["F = BIL", "force on a conductor"], ["C = Q/V", "capacitance"]] },
  { title: "Modern physics", items: [["E = hf", "photon energy"], ["hf = W + ½mv²", "photoelectric equation"], ["E = mc²", "mass and energy"], ["N = N₀(½)^(t/T½)", "radioactive decay"], ["λ = h/p", "de Broglie"]] }
];

export const MATH_FORMULAE: FormulaGroup[] = [
  { title: "Mensuration", items: [["Area of triangle = ½bh = ½ab sin C", ""], ["Area of trapezium = ½(a + b)h", ""], ["Area of circle = πr²", "circumference 2πr"], ["Arc length = (θ/360) × 2πr", ""], ["Area of sector = (θ/360) × πr²", ""], ["Volume of cylinder = πr²h", "curved surface 2πrh"], ["Volume of cone = ⅓πr²h", "curved surface πrl"], ["Volume of sphere = ⁴⁄₃πr³", "surface 4πr²"], ["Volume of pyramid = ⅓ × base area × h", ""], ["Hero's formula: A = √(s(s−a)(s−b)(s−c))", "s = ½(a + b + c)"]] },
  { title: "Algebra", items: [["x = (−b ± √(b² − 4ac)) / 2a", "quadratic formula"], ["(a + b)² = a² + 2ab + b²", ""], ["a² − b² = (a + b)(a − b)", ""], ["aᵐ × aⁿ = aᵐ⁺ⁿ", ""], ["aᵐ ÷ aⁿ = aᵐ⁻ⁿ", ""], ["a⁰ = 1, a⁻ⁿ = 1/aⁿ", ""], ["log ab = log a + log b", ""], ["log (a/b) = log a − log b", ""], ["log aⁿ = n log a", ""], ["Sum of roots = −b/a, product = c/a", ""]] },
  { title: "Sequences and finance", items: [["Tₙ = a + (n − 1)d", "arithmetic progression"], ["Sₙ = n/2 (2a + (n − 1)d)", ""], ["Tₙ = arⁿ⁻¹", "geometric progression"], ["Sₙ = a(rⁿ − 1)/(r − 1)", ""], ["S∞ = a/(1 − r), |r| < 1", ""], ["Simple interest I = PRT/100", ""], ["Compound amount A = P(1 + r/100)ⁿ", ""]] },
  { title: "Trigonometry", items: [["sin θ = opp/hyp, cos θ = adj/hyp, tan θ = opp/adj", "SOH CAH TOA"], ["sin²θ + cos²θ = 1", ""], ["a/sin A = b/sin B = c/sin C", "sine rule"], ["a² = b² + c² − 2bc cos A", "cosine rule"], ["sin(180° − θ) = sin θ", ""], ["cos(180° − θ) = −cos θ", ""], ["Exact: sin 30° = ½, cos 60° = ½, tan 45° = 1, sin 60° = √3/2", ""]] },
  { title: "Coordinate geometry", items: [["Gradient m = (y₂ − y₁)/(x₂ − x₁)", ""], ["y − y₁ = m(x − x₁)", "line through a point"], ["Distance = √((x₂ − x₁)² + (y₂ − y₁)²)", ""], ["Mid-point = ((x₁ + x₂)/2, (y₁ + y₂)/2)", ""], ["Parallel: m₁ = m₂; perpendicular: m₁m₂ = −1", ""]] },
  { title: "Statistics and probability", items: [["Mean x̄ = Σfx / Σf", ""], ["Variance = Σf(x − x̄)² / Σf", "standard deviation = √variance"], ["P(A) = favourable outcomes ÷ total outcomes", ""], ["P(A or B) = P(A) + P(B) − P(A and B)", ""], ["P(A and B) = P(A) × P(B)", "independent events"], ["ⁿCᵣ = n! / (r!(n − r)!)", "ⁿPᵣ = n! / (n − r)!"]] }
];

/* ---------------- Unit converter ---------------- */

export type UnitCategory = { id: string; label: string; units: { id: string; label: string; toBase: number }[] };

/** Factors convert to the first (base) unit. Temperature is handled separately. */
export const UNIT_CATEGORIES: UnitCategory[] = [
  { id: "length", label: "Length", units: [{ id: "m", label: "metre (m)", toBase: 1 }, { id: "km", label: "kilometre (km)", toBase: 1000 }, { id: "cm", label: "centimetre (cm)", toBase: 0.01 }, { id: "mm", label: "millimetre (mm)", toBase: 0.001 }, { id: "um", label: "micrometre (μm)", toBase: 1e-6 }, { id: "nm", label: "nanometre (nm)", toBase: 1e-9 }, { id: "in", label: "inch", toBase: 0.0254 }, { id: "ft", label: "foot", toBase: 0.3048 }, { id: "mi", label: "mile", toBase: 1609.344 }] },
  { id: "mass", label: "Mass", units: [{ id: "kg", label: "kilogram (kg)", toBase: 1 }, { id: "g", label: "gram (g)", toBase: 0.001 }, { id: "mg", label: "milligram (mg)", toBase: 1e-6 }, { id: "t", label: "tonne (t)", toBase: 1000 }, { id: "lb", label: "pound (lb)", toBase: 0.45359237 }] },
  { id: "area", label: "Area", units: [{ id: "m2", label: "square metre (m²)", toBase: 1 }, { id: "cm2", label: "square centimetre (cm²)", toBase: 1e-4 }, { id: "km2", label: "square kilometre (km²)", toBase: 1e6 }, { id: "ha", label: "hectare (ha)", toBase: 1e4 }, { id: "acre", label: "acre", toBase: 4046.8564224 }] },
  { id: "volume", label: "Volume", units: [{ id: "m3", label: "cubic metre (m³)", toBase: 1 }, { id: "dm3", label: "litre / dm³", toBase: 1e-3 }, { id: "cm3", label: "millilitre / cm³", toBase: 1e-6 }] },
  { id: "time", label: "Time", units: [{ id: "s", label: "second (s)", toBase: 1 }, { id: "min", label: "minute", toBase: 60 }, { id: "h", label: "hour", toBase: 3600 }, { id: "day", label: "day", toBase: 86400 }, { id: "ms", label: "millisecond (ms)", toBase: 0.001 }] },
  { id: "speed", label: "Speed", units: [{ id: "ms", label: "m/s", toBase: 1 }, { id: "kmh", label: "km/h", toBase: 1000 / 3600 }, { id: "mph", label: "miles per hour", toBase: 0.44704 }] },
  { id: "temperature", label: "Temperature", units: [{ id: "C", label: "Celsius (°C)", toBase: 1 }, { id: "K", label: "Kelvin (K)", toBase: 1 }, { id: "F", label: "Fahrenheit (°F)", toBase: 1 }] },
  { id: "pressure", label: "Pressure", units: [{ id: "Pa", label: "pascal (Pa)", toBase: 1 }, { id: "kPa", label: "kilopascal (kPa)", toBase: 1000 }, { id: "atm", label: "atmosphere (atm)", toBase: 101325 }, { id: "mmHg", label: "mmHg", toBase: 133.322 }, { id: "bar", label: "bar", toBase: 1e5 }] },
  { id: "energy", label: "Energy", units: [{ id: "J", label: "joule (J)", toBase: 1 }, { id: "kJ", label: "kilojoule (kJ)", toBase: 1000 }, { id: "cal", label: "calorie", toBase: 4.184 }, { id: "kWh", label: "kilowatt-hour (kWh)", toBase: 3.6e6 }, { id: "eV", label: "electronvolt (eV)", toBase: 1.602176634e-19 }] },
  { id: "power", label: "Power", units: [{ id: "W", label: "watt (W)", toBase: 1 }, { id: "kW", label: "kilowatt (kW)", toBase: 1000 }, { id: "hp", label: "horsepower (hp)", toBase: 745.7 }] }
];

export function convertUnit(category: string, value: number, from: string, to: string): number {
  if (category === "temperature") {
    const c = from === "C" ? value : from === "K" ? value - 273.15 : ((value - 32) * 5) / 9;
    return to === "C" ? c : to === "K" ? c + 273.15 : (c * 9) / 5 + 32;
  }
  const cat = UNIT_CATEGORIES.find(c => c.id === category);
  const f = cat?.units.find(u => u.id === from), t = cat?.units.find(u => u.id === to);
  if (!f || !t) throw new Error("unknown unit");
  return (value * f.toBase) / t.toBase;
}

/* ---------------- Symbols and characters ---------------- */

export const MATH_SYMBOLS: { group: string; chars: string[] }[] = [
  { group: "Operations", chars: ["×", "÷", "±", "∓", "√", "∛", "²", "³", "ⁿ", "⁻¹", "½", "⅓", "¼", "¾", "%", "‰"] },
  { group: "Relations", chars: ["=", "≠", "≈", "≡", "<", ">", "≤", "≥", "∝", "∞", "∴", "∵"] },
  { group: "Geometry", chars: ["°", "′", "″", "∠", "△", "⊥", "∥", "≅", "∼", "⌒", "π", "θ"] },
  { group: "Sets and logic", chars: ["∈", "∉", "⊂", "⊆", "∪", "∩", "∅", "ξ", "→", "⇒", "⇔", "¬"] },
  { group: "Calculus and sums", chars: ["Σ", "∫", "∂", "Δ", "∇", "lim", "dx", "dy/dx", "x̄", "ȳ"] },
  { group: "Greek", chars: ["α", "β", "γ", "δ", "ε", "λ", "μ", "ρ", "σ", "τ", "φ", "ω", "Ω"] },
  { group: "Subscripts", chars: ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉", "⁺", "⁻"] }
];

export const LANGUAGE_CHARACTERS: { language: string; chars: string[] }[] = [
  { language: "Yorùbá", chars: ["ẹ", "ọ", "ṣ", "Ẹ", "Ọ", "Ṣ", "à", "á", "è", "é", "ì", "í", "ò", "ó", "ù", "ú", "ẹ̀", "ẹ́", "ọ̀", "ọ́", "ń", "ǹ", "m̀", "ḿ"] },
  { language: "Igbo", chars: ["ị", "ọ", "ụ", "ṅ", "Ị", "Ọ", "Ụ", "Ṅ", "à", "á", "è", "é", "ì", "í", "ò", "ó", "ù", "ú", "m̄", "ǹ"] },
  { language: "Hausa", chars: ["ɓ", "ɗ", "ƙ", "ƴ", "Ɓ", "Ɗ", "Ƙ", "Ƴ", "ʼ", "â", "ê", "î", "ô", "û"] },
  { language: "French", chars: ["é", "è", "ê", "ë", "à", "â", "ç", "î", "ï", "ô", "û", "ù", "ü", "œ", "æ", "É", "È", "À", "Ç", "«", "»"] },
  { language: "Spanish", chars: ["á", "é", "í", "ó", "ú", "ñ", "ü", "Ñ", "¿", "¡"] },
  { language: "German", chars: ["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü"] }
];

