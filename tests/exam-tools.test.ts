import { describe, it, expect } from "vitest";
import { markQuestion, toPublicQuestion, validateQuestion, buildAttemptLayout, readNumber, passageWords, describeAnswer, QUESTION_TYPES, type Question } from "@/lib/exams/engine";
import { evaluate, formatResult, nCr, nPr, factorial, samplePlot } from "@/lib/exams/calc";
import { parseEquation, isBalanced, compareEquations, atomCounts, formatFormula } from "@/lib/exams/chem";
import { buildTable, normalCdf, normalTable, barLog, fourFigures } from "@/lib/exams/tables";
import { examTools, TOOL_PRESETS, TOOL_IDS } from "@/lib/exams/tools";
import { ELEMENTS, convertUnit } from "@/lib/exams/reference-data";

const q = (type: Question["type"], data: any, answer: any, points = 4): Question => ({ id: type, type, prompt: "Q", points, data, answer });

describe("calculator", () => {
  it("does arithmetic with the usual order of operations", () => {
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
    expect(evaluate("2^3^2")).toBe(512);
    expect(evaluate("-2^2")).toBe(-4);
    expect(evaluate("2(3+4)")).toBe(14);
    expect(evaluate("10÷4")).toBe(2.5);
    expect(evaluate("50%")).toBe(0.5);
  });
  it("does trigonometry in degrees by default and radians on request", () => {
    expect(evaluate("sin(30)")).toBe(0.5);
    expect(evaluate("cos 60")).toBe(0.5);
    expect(evaluate("tan(45)")).toBe(1);
    expect(evaluate("asin(0.5)")).toBe(30);
    expect(evaluate("sin(pi/2)", { angle: "rad" })).toBe(1);
    expect(() => evaluate("tan(90)")).toThrow();
  });
  it("does logs, roots, factorials and combinations", () => {
    expect(evaluate("log(1000)")).toBe(3);
    expect(evaluate("ln(e)")).toBe(1);
    expect(evaluate("sqrt(16)+√9")).toBe(7);
    expect(evaluate("5!")).toBe(120);
    expect(evaluate("nCr(5,2)")).toBe(10);
    expect(evaluate("nPr(5,2)")).toBe(20);
    expect(nCr(52, 5)).toBe(2598960);
    expect(nPr(4, 4)).toBe(24);
    expect(factorial(0)).toBe(1);
    expect(evaluate("6.02e23/2")).toBeCloseTo(3.01e23);
    expect(evaluate("2π")).toBeCloseTo(6.283185307);
  });
  it("uses Ans and x, and refuses bad input", () => {
    expect(evaluate("Ans*2", { ans: 21 })).toBe(42);
    expect(evaluate("2x+1", { x: 3 })).toBe(7);
    expect(() => evaluate("2+")).toThrow();
    expect(() => evaluate("1/0")).toThrow();
    expect(() => evaluate("sqrt(-1)")).toThrow();
    expect(() => evaluate("alert(1)")).toThrow();
  });
  it("formats results and samples graphs", () => {
    expect(formatResult(0.1 + 0.2)).toBe("0.3");
    expect(formatResult(6.02e23)).toBe("6.02 × 10^23");
    const pts = samplePlot("x^2", -2, 2, 4);
    expect(pts.map(p => p.y)).toEqual([4, 1, 0, 1, 4]);
    expect(Number.isNaN(samplePlot("sqrt(x)", -1, 1, 2)[0].y)).toBe(true);
  });
});

describe("chemical equations", () => {
  it("parses, counts atoms and checks balance", () => {
    expect(atomCounts("Ca(OH)2")).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(atomCounts("CuSO4.5H2O")).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
    expect(atomCounts("K4[Fe(CN)6]")).toEqual({ K: 4, Fe: 1, C: 6, N: 6 });
    expect(isBalanced(parseEquation("2H2 + O2 -> 2H2O"))).toBe(true);
    expect(isBalanced(parseEquation("H2 + O2 -> H2O"))).toBe(false);
    expect(isBalanced(parseEquation("CaCO3(s) → CaO(s) + CO2(g)"))).toBe(true);
    expect(isBalanced(parseEquation("N₂ + 3H₂ ⇌ 2NH₃"))).toBe(true);
    expect(parseEquation("N2 + 3H2 ⇌ 2NH3").reversible).toBe(true);
  });
  it("handles ions and charges", () => {
    expect(isBalanced(parseEquation("Fe^3+ + 3OH^- -> Fe(OH)3"))).toBe(true);
    expect(isBalanced(parseEquation("Fe³⁺ + 3OH⁻ → Fe(OH)₃"))).toBe(true);
    expect(isBalanced(parseEquation("Ag+ + Cl- -> AgCl"))).toBe(true);
    expect(isBalanced(parseEquation("Cu^2+ + 2e^- -> Cu"))).toBe(true);
    expect(isBalanced(parseEquation("Cu^2+ + e^- -> Cu"))).toBe(false);
  });
  it("compares a student's equation with the key in any order", () => {
    const key = "2H2 + O2 -> 2H2O";
    expect(compareEquations("O2 + 2H2 → 2H2O", key)).toMatchObject({ species: true, coefficients: true });
    expect(compareEquations("H2 + O2 -> H2O", key)).toMatchObject({ species: true, coefficients: false });
    expect(compareEquations("4H2 + 2O2 -> 4H2O", key)).toMatchObject({ coefficients: false });
    expect(compareEquations("4H2 + 2O2 -> 4H2O", key, { acceptMultiples: true })).toMatchObject({ coefficients: true });
    expect(compareEquations("2H2 + O2 -> 2H2O2", key).species).toBe(false);
    expect(compareEquations("nonsense", key).species).toBe(false);
    expect(compareEquations("CaCO3 -> CaO + CO2", "CaCO3(s) -> CaO(s) + CO2(g)", { states: true }).species).toBe(false);
    expect(compareEquations("CaCO3(s) -> CaO(s) + CO2(g)", "CaCO3(s) -> CaO(s) + CO2(g)", { states: true }).coefficients).toBe(true);
  });
  it("formats formulae with subscripts", () => {
    expect(formatFormula("2H2O").filter(p => p.sub).map(p => p.t)).toEqual(["2"]);
    expect(formatFormula("SO4^2-").find(p => p.sup)?.t).toBe("2-");
  });
});

describe("four-figure tables", () => {
  it("prints logs the way the printed tables do", () => {
    const log = buildTable("log");
    const row25 = log.rows.find(r => r.label === "25")!;
    expect(row25.values[3]).toBe("4031"); // log 2.53 = 0.4031
    expect(row25.diffs[3]).toBeGreaterThanOrEqual(6); // + MD 4 ≈ 7 → 0.4038 for 2.534
    expect(row25.diffs[3]).toBeLessThanOrEqual(8);
    expect(log.rows).toHaveLength(90);
  });
  it("prints antilogs, squares, roots and reciprocals to four figures", () => {
    expect(buildTable("antilog").rows.find(r => r.label === ".30")!.values[1]).toBe("2000"); // 10^0.301 = 1.9999…
    expect(buildTable("square").rows.find(r => r.label === "2.5")!.values[0]).toBe("6.250");
    expect(buildTable("sqrt_1_10").rows.find(r => r.label === "2.0")!.values[0]).toBe("1.414");
    expect(buildTable("sqrt_10_100").rows.find(r => r.label === "20")!.values[0]).toBe("4.472");
    expect(buildTable("reciprocal").rows.find(r => r.label === "4.0")!.values[0]).toBe("0.2500");
  });
  it("prints natural trig values by degree and minutes", () => {
    const sin = buildTable("sin");
    expect(sin.rows[30].values[0]).toBe("0.5000");
    expect(sin.columns[1]).toBe("6′");
    expect(buildTable("cos").rows[60].values[0]).toBe("0.5000");
    expect(buildTable("tan").rows[45].values[0]).toBe("1.0000");
    expect(buildTable("log_sin").rows[30].values[0]).toBe("1̄.6990");
  });
  it("normal distribution and helpers", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalTable().rows[19].values[6]).toBe("0.9750");
    expect(barLog(0.02534)).toBe("2̄.4038");
    expect(fourFigures(123.456)).toBe("123.5");
  });
});

describe("tools and reference data", () => {
  it("reads the tools an exam allows, including old calculator exams", () => {
    expect(examTools({ allow_calculator: true })).toEqual(["calc_scientific"]);
    expect(examTools({ tools: ["periodic_table", "nope", "periodic_table"] })).toEqual(["periodic_table"]);
    expect(examTools(null)).toEqual([]);
    for (const p of TOOL_PRESETS) for (const t of p.tools) expect(TOOL_IDS).toContain(t);
  });
  it("has all 118 elements in the right places", () => {
    expect(ELEMENTS).toHaveLength(118);
    const by = (s: string) => ELEMENTS.find(e => e.symbol === s)!;
    expect(by("Na")).toMatchObject({ z: 11, period: 3, group: 1, category: "alkali" });
    expect(by("Cl")).toMatchObject({ z: 17, group: 17, category: "halogen" });
    expect(by("Fe")).toMatchObject({ z: 26, period: 4, group: 8, category: "transition" });
    expect(by("Au")).toMatchObject({ z: 79, period: 6, group: 11 });
    expect(by("Ce").category).toBe("lanthanide");
    expect(by("U").category).toBe("actinide");
    expect(by("Og")).toMatchObject({ z: 118, group: 18 });
    expect(by("Ca").shells).toBe("2, 8, 8, 2");
  });
  it("converts units", () => {
    expect(convertUnit("length", 1, "km", "m")).toBe(1000);
    expect(convertUnit("temperature", 100, "C", "F")).toBe(212);
    expect(convertUnit("temperature", 0, "C", "K")).toBeCloseTo(273.15);
    expect(convertUnit("speed", 72, "kmh", "ms")).toBeCloseTo(20);
  });
});

describe("new question types", () => {
  it("reads typed numbers and significant figures", () => {
    expect(readNumber("1,250")).toEqual({ value: 1250, sigFigs: 3 });
    expect(readNumber("9.80 m/s")).toEqual({ value: 9.8, sigFigs: 3 });
    expect(readNumber("6.02 × 10^23")!.value).toBeCloseTo(6.02e23);
    expect(readNumber("6.02x10^-3")!.value).toBeCloseTo(0.00602);
    expect(readNumber("0.0050")).toEqual({ value: 0.005, sigFigs: 2 });
    expect(readNumber("abc")).toBeNull();
  });
  it("numeric: percentage tolerance and significant figures", () => {
    const m = q("numeric", {}, { value: 9.81, tolerance_pct: 1, sig_figs: 3 });
    expect(markQuestion(m, "9.81").points).toBe(4);
    expect(markQuestion(m, "9.75 m/s²").points).toBe(4);
    expect(markQuestion(m, "9.8").points).toBe(2);
    expect(markQuestion(m, "10.5").points).toBe(0);
    expect(markQuestion(q("numeric", {}, { value: 1.5e-7 }), "1.5 × 10^-7").points).toBe(4);
  });
  it("matrix", () => {
    const m = q("matrix", { rows: [{ id: "r1", text: "Fe is a metal" }, { id: "r2", text: "O is a metal" }], cols: [{ id: "t", text: "True" }, { id: "f", text: "False" }] }, { correct: { r1: "t", r2: "f" } });
    expect(markQuestion(m, { r1: "t", r2: "f" }).points).toBe(4);
    expect(markQuestion(m, { r1: "t", r2: "t" }).points).toBe(2);
    expect(validateQuestion(m)).toEqual([]);
  });
  it("highlight words", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    expect(passageWords(text)).toHaveLength(9);
    const m = q("highlight", { text }, { correct: [1, 2, 7] });
    expect(markQuestion(m, [1, 2, 7]).points).toBe(4);
    expect(markQuestion(m, [1, 2, 7, 0]).points).toBeCloseTo(2.67, 2);
    expect(markQuestion(m, [0, 3, 4, 5]).points).toBe(0);
    expect(describeAnswer(m)).toBe("quick, brown, lazy");
  });
  it("label the diagram, with labels shuffled", () => {
    const m = q("label_image", { image_url: "/heart.png", pins: [{ id: "p1", x: 10, y: 10 }, { id: "p2", x: 50, y: 50 }], labels: [{ id: "a", text: "Aorta" }, { id: "b", text: "Ventricle" }, { id: "c", text: "Valve" }] }, { placement: { p1: "a", p2: "b" } });
    expect(markQuestion(m, { p1: "a", p2: "b" }).points).toBe(4);
    expect(markQuestion(m, { p1: "a", p2: "c" }).points).toBe(2);
    expect(validateQuestion(m)).toEqual([]);
    const layout = buildAttemptLayout([m], {});
    expect(layout.option_orders.label_image.sort()).toEqual(["a", "b", "c"]);
    expect(JSON.stringify(toPublicQuestion(m))).not.toContain("placement");
  });
  it("graph plotting with tolerance", () => {
    const m = q("graph_plot", { x_min: -5, x_max: 5, y_min: -5, y_max: 5, step: 1 }, { points: [{ x: 0, y: 1 }, { x: 1, y: 3 }], tolerance: 0.25 });
    expect(markQuestion(m, [{ x: 1, y: 3 }, { x: 0, y: 1 }]).points).toBe(4);
    expect(markQuestion(m, [{ x: 0.2, y: 1.1 }]).points).toBe(2);
    expect(markQuestion(m, [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }]).points).toBe(2);
    const pub = toPublicQuestion(m) as any;
    expect(pub.data.count).toBe(2);
    expect(JSON.stringify(pub)).not.toContain('"y":3');
  });
  it("chemical equation question", () => {
    const m = q("chem_equation", {}, { equation: "2Mg + O2 -> 2MgO" });
    expect(markQuestion(m, "O2 + 2Mg → 2MgO").points).toBe(4);
    const half = markQuestion(m, "Mg + O2 -> MgO");
    expect(half.points).toBe(2);
    expect(half.feedback).toMatch(/balanced/);
    expect(markQuestion(m, "Mg + O -> MgO2").points).toBe(0);
    expect(validateQuestion(q("chem_equation", {}, { equation: "Mg + O2 -> MgO" }))[0]).toMatch(/not balanced/);
    expect(JSON.stringify(toPublicQuestion(m))).not.toContain("MgO");
  });
  it("rating, passage, drawing and audio", () => {
    expect(markQuestion(q("rating", { min: 1, max: 5 }, {}), 3).points).toBe(4);
    expect(markQuestion(q("rating", { min: 1, max: 5 }, { correct: 4 }), 3).points).toBe(0);
    const p = q("passage", {}, {}, 0);
    expect(markQuestion(p, undefined)).toMatchObject({ points: 0, max: 0 });
    expect(validateQuestion(q("passage", {}, {}, 2))[0]).toMatch(/no marks/);
    expect(markQuestion(q("drawing", {}, {}), { strokes: [{ t: "pen", p: [1, 2, 3, 4] }] }).points).toBeNull();
    expect(markQuestion(q("audio_response", { max_seconds: 60 }, {}), { path: "x" }).points).toBeNull();
    expect(QUESTION_TYPES).toHaveLength(23);
  });
});
