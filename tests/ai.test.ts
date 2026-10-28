import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";
import { generateJson, geminiSchema, extractJson, aiProvider, aiAllowed, AiUnavailable, AiDeclined, aiErrorMessage, resetAiAllowanceCache } from "@/lib/ai";
import { commentSystem, STOCK_PHRASES } from "@/lib/assist";
import { commentInputFor, type CardForComment } from "@/lib/comment-input";

// No database in unit tests: usage logging and allowance checks must quietly step aside.
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => { throw new Error("no database in tests"); } }));

const reply = (obj: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }, ...extra })
});
const Schema = z.object({ title: z.string(), points: z.array(z.string()) });

describe("AI provider", () => {
  const env = { ...process.env };
  beforeEach(() => { resetAiAllowanceCache(); delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
  afterEach(() => { process.env = { ...env }; vi.unstubAllGlobals(); });

  it("uses Gemini when its key is set, Claude only as a fallback, and nothing otherwise", () => {
    expect(aiProvider()).toBeNull();
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(aiProvider()).toBe("anthropic");
    process.env.GEMINI_API_KEY = "g-key";
    expect(aiProvider()).toBe("gemini");
    process.env.GEMINI_API_KEY = "replace-me";
    expect(aiProvider()).toBe("anthropic");
  });

  it("is off for a school without the AI module", () => {
    process.env.GEMINI_API_KEY = "g-key";
    expect(aiAllowed({ tenant: { modules: { ai: true } } })).toBe(true);
    expect(aiAllowed({ tenant: { modules: {} } })).toBe(true);
    expect(aiAllowed({ tenant: { modules: { ai: false } } })).toBe(false);
  });

  it("sends the schema to Gemini and returns checked JSON", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    const fetch = vi.fn(async () => reply({ title: "Fractions", points: ["halves", "quarters"] }));
    vi.stubGlobal("fetch", fetch);
    const out = await generateJson({ task: "t", system: "sys", prompt: "go", schema: Schema });
    expect(out).toEqual({ title: "Fractions", points: ["halves", "quarters"] });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("gemini-2.5-flash");
    expect(init.headers["x-goog-api-key"]).toBe("g-key");
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.properties.points.type).toBe("array");
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });

  it("uses the stronger model for heavy jobs when one is set", async () => {
    process.env.GEMINI_API_KEY = "g-key"; process.env.GEMINI_MODEL_PRO = "gemini-2.5-pro";
    const fetch = vi.fn(async () => reply({ title: "x", points: [] }));
    vi.stubGlobal("fetch", fetch);
    await generateJson({ task: "t", system: "s", prompt: "p", schema: Schema, quality: "best" });
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toContain("gemini-2.5-pro");
  });

  it("asks once more when the answer doesn't fit the schema, then gives a plain message", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    const fetch = vi.fn().mockResolvedValueOnce(reply({ wrong: true })).mockResolvedValueOnce(reply({ title: "ok", points: ["a"] }));
    vi.stubGlobal("fetch", fetch);
    expect(await generateJson({ task: "t", system: "s", prompt: "p", schema: Schema })).toEqual({ title: "ok", points: ["a"] });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ wrong: true })));
    await expect(generateJson({ task: "t", system: "s", prompt: "p", schema: Schema })).rejects.toBeInstanceOf(AiUnavailable);
  });

  it("falls back to describing the schema when the endpoint rejects responseJsonSchema", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { status: "INVALID_ARGUMENT", message: "Unknown name \"responseJsonSchema\"" } }) })
      .mockResolvedValueOnce(reply({ title: "ok", points: [] }));
    vi.stubGlobal("fetch", fetch);
    expect(await generateJson({ task: "t", system: "s", prompt: "p", schema: Schema })).toEqual({ title: "ok", points: [] });
    const second = JSON.parse((fetch.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    expect(second.generationConfig.responseJsonSchema).toBeUndefined();
    expect(second.systemInstruction.parts[0].text).toContain("JSON Schema");
  });

  it("turns Google's refusals and limits into messages people understand", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
    const busy = await generateJson({ task: "t", system: "s", prompt: "p", schema: Schema }).catch(e => e);
    expect(aiErrorMessage(busy)).toEqual({ message: expect.stringContaining("busy"), status: 429 });

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) })));
    await expect(generateJson({ task: "t", system: "s", prompt: "p", schema: Schema })).rejects.toBeInstanceOf(AiDeclined);

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { status: "INVALID_ARGUMENT", message: "API key not valid" } }) })));
    const bad = await generateJson({ task: "t", system: "s", prompt: "p", schema: Schema }).catch(e => e);
    expect(bad.message).toContain("refused");
  });

  it("sends PDFs and conversations in Gemini's shape", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    const fetch = vi.fn(async () => reply({ title: "x", points: [] }));
    vi.stubGlobal("fetch", fetch);
    await generateJson({ task: "t", system: "s", schema: Schema, files: [{ mimeType: "application/pdf", base64: "QUJD" }],
      turns: [{ role: "user", text: "hi" }, { role: "model", text: "hello" }, { role: "user", text: "help" }] });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: "application/pdf", data: "QUJD" });
  });

  it("says plainly when no key is set", async () => {
    await expect(generateJson({ task: "t", system: "s", prompt: "p", schema: Schema })).rejects.toThrow(/Gemini API key/);
  });

  it("reads JSON even when it comes wrapped in a code fence", () => {
    expect(extractJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(extractJson("Here you go: {\"a\":2} thanks")).toEqual({ a: 2 });
    expect(extractJson("nothing")).toBeUndefined();
    expect(geminiSchema(Schema).$schema).toBeUndefined();
  });
});

describe("report comments", () => {
  const card = (over: Partial<CardForComment> = {}): CardForComment => ({
    id: "c1", student_id: "s1", average: "68.5", position: 4, class_size: 30, status: "draft", teacher_comment: "Ada has worked steadily.",
    data: {
      student_name: "Ada Obi", scheme: { pass_mark: 40, show_position: false },
      days_present: 54, days_opened: 60,
      subjects: [
        { subject_id: "m", subject: "Mathematics", total: 82, grade: "A", effort: "A" },
        { subject_id: "e", subject: "English", total: 71, grade: "B" },
        { subject_id: "b", subject: "Basic Science", total: 48, grade: "D" },
        { subject_id: "c", subject: "CRS", total: 50, grade: "C" }
      ],
      traits: [{ name: "Punctuality", rating: 5 }, { name: "Neatness", rating: 4 }, { name: "Teamwork", rating: 3 }, { name: "Leadership", rating: 2 }, { name: "Honesty", rating: 5 }]
    },
    ...over
  });
  const prev = { average: 60, data: { subjects: [{ subject_id: "m", subject: "Mathematics", total: 64 }, { subject_id: "b", subject: "Basic Science", total: 59 }] } };

  it("gives the AI the facts that make a comment personal, and nothing private", () => {
    const i = commentInputFor(card(), prev, "female", "form_teacher");
    expect(i.first_name).toBe("Ada");
    expect(i.gender).toBe("female");
    expect(i.trend).toBe("up");
    expect(i.previous_average).toBe(60);
    expect(i.movers).toEqual(["Mathematics +18", "Basic Science -11"]);
    expect(i.attendance_rate).toBe(90);
    expect(i.strongest[0]).toBe("Mathematics (82, A)");
    expect(i.weakest).toEqual(["Basic Science (48, D)", "CRS (50, C)"]);
    expect(i.position).toBeNull();                       // the school hides positions
    expect(i.traits).toEqual(["Punctuality 5/5", "Honesty 5/5", "Teamwork 3/5", "Leadership 2/5"]);
    expect(i.effort).toEqual(["Mathematics: effort A"]);
    expect(i.teacher_comment).toBeNull();
    expect(JSON.stringify(i)).not.toContain("Obi");     // no surname
  });

  it("lets the principal see the teacher's comment so the two differ", () => {
    expect(commentInputFor(card(), null, null, "principal").teacher_comment).toBe("Ada has worked steadily.");
    expect(commentInputFor(card(), null, "other", "principal").gender).toBeNull();
    expect(commentInputFor(card(), null, null, "principal").trend).toBe("new");
  });

  it("asks for varied, specific comments in the school's tone", () => {
    const s = commentSystem("form_teacher", { tone: "formal", length: "medium" });
    expect(s).toContain("formal");
    expect(s).toContain("40–70 words");
    expect(s).toContain("Never start two comments with the same word");
    for (const p of STOCK_PHRASES) expect(s).toContain(p);
    expect(commentSystem("principal")).toContain("never repeats the form teacher's wording");
  });
});
