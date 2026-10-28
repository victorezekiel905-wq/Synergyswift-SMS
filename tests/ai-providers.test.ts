import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => { throw new Error("no database in tests"); } }));
import { generateJson, extraProviders, providerChain, aiProvider, AiDeclined, resetAiAllowanceCache } from "@/lib/ai";

const Schema = z.object({ title: z.string() });
const gemini = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
const geminiOk = (title: string) => gemini({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title }) }] }, finishReason: "STOP" }] });
const chat = (title: string, status = 200) => ({ ok: status < 300, status, json: async () => status < 300 ? { choices: [{ message: { content: JSON.stringify({ title }) }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 4 } } : { error: { message: "rate limited" } } });
const ask = (extra: Record<string, unknown> = {}) => generateJson({ task: "t", system: "s", prompt: "p", schema: Schema, ...extra });

describe("several AI providers, one after another", () => {
  const keep = { ...process.env };
  beforeEach(() => {
    resetAiAllowanceCache();
    for (const k of Object.keys(process.env)) if (/^(AI_EXTRA_|AI_ROTATE$|GRO[QG]|OPENROUTER)/i.test(k)) delete process.env[k];
    process.env.GEMINI_API_KEY = "g";
    Object.assign(process.env, {
      AI_EXTRA_1_NAME: "Groq", AI_EXTRA_1_URL: "https://api.groq.com/openai/v1/", AI_EXTRA_1_KEY: "gk", AI_EXTRA_1_MODEL: "llama-3.3-70b-versatile",
      AI_EXTRA_2_NAME: "OpenRouter", AI_EXTRA_2_URL: "https://openrouter.ai/api/v1", AI_EXTRA_2_KEY: "ok", AI_EXTRA_2_MODEL: "some/free-model"
    });
  });
  afterEach(() => { process.env = { ...keep }; vi.unstubAllGlobals(); });

  it("reads the extra providers from the numbered settings, skipping incomplete or unsafe ones", () => {
    process.env.AI_EXTRA_3_URL = "http://insecure.example/v1"; process.env.AI_EXTRA_3_KEY = "k"; process.env.AI_EXTRA_3_MODEL = "m";
    process.env.AI_EXTRA_4_URL = "https://x.example/v1"; process.env.AI_EXTRA_4_MODEL = "m";   // no key
    expect(extraProviders().map(p => [p.name, p.url])).toEqual([["groq", "https://api.groq.com/openai/v1"], ["openrouter", "https://openrouter.ai/api/v1"]]);
    expect(providerChain().map(x => (x.kind === "openai" ? x.p.name : x.kind))).toEqual(["gemini", "groq", "openrouter"]);
    delete process.env.GEMINI_API_KEY;
    expect(aiProvider()).toBe("groq");
  });

  it("takes Groq and OpenRouter from just their key, whatever the setting is called", () => {
    for (let i = 1; i <= 2; i++) for (const k of ["NAME", "URL", "KEY", "MODEL"]) delete process.env[`AI_EXTRA_${i}_${k}`];
    process.env.Grog_API = "gk"; process.env.Openrouter_Api = "ok";
    expect(extraProviders()).toEqual([
      { name: "groq", url: "https://api.groq.com/openai/v1", key: "gk", model: "openai/gpt-oss-120b" },
      { name: "openrouter", url: "https://openrouter.ai/api/v1", key: "ok", model: "openrouter/free" }
    ]);
    process.env.GROQ_MODEL = "qwen/qwen3.6-27b";
    expect(extraProviders()[0].model).toBe("qwen/qwen3.6-27b");
    // Set up both ways: the numbered settings win and the service is not added twice.
    process.env.AI_EXTRA_1_URL = "https://api.groq.com/openai/v1"; process.env.AI_EXTRA_1_KEY = "gk2"; process.env.AI_EXTRA_1_MODEL = "m";
    expect(extraProviders().map(p => [p.name, p.key])).toEqual([["extra1", "gk2"], ["openrouter", "ok"]]);
    process.env.Openrouter_Api = "replace-me";
    expect(extraProviders().map(p => p.name)).toEqual(["extra1"]);
  });

  it("moves to the next provider when Gemini is out of free quota", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(gemini({}, 429))
      .mockResolvedValueOnce(chat("From Groq"));
    vi.stubGlobal("fetch", fetch);
    expect(await ask()).toEqual({ title: "From Groq" });
    const [url, init] = fetch.mock.calls[1] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer gk");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("llama-3.3-70b-versatile");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain("JSON Schema");
  });

  it("keeps going down the list, and only gives up when all are busy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(gemini({}, 429)).mockResolvedValueOnce(chat("", 429)).mockResolvedValueOnce(chat("From OpenRouter")));
    expect(await ask()).toEqual({ title: "From OpenRouter" });
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).includes("googleapis") ? gemini({}, 429) : chat("", 429))));
    await expect(ask()).rejects.toThrow(/busy/);
  });

  it("doesn't shop a refusal around other providers", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(gemini({ promptFeedback: { blockReason: "SAFETY" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(ask()).rejects.toBeInstanceOf(AiDeclined);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends PDFs only to providers that can read them", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(ask({ files: [{ mimeType: "application/pdf", base64: "QUJD" }] })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("can spread requests across the providers", async () => {
    process.env.AI_ROTATE = "1";
    const fetch = vi.fn(async (u: string) => (String(u).includes("googleapis") ? geminiOk("g") : chat(String(u).includes("groq") ? "groq" : "openrouter")));
    vi.stubGlobal("fetch", fetch);
    const answers = [(await ask()).title, (await ask()).title, (await ask()).title];
    expect(new Set(answers)).toEqual(new Set(["g", "groq", "openrouter"]));
  });
});
