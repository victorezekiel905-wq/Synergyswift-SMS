import { describe, it, expect } from "vitest";
import { applyEnvAliases } from "@/lib/env-aliases";

describe("settings typed under other names", () => {
  it("fills each setting from the names used on the Render dashboard", () => {
    const env: Record<string, string | undefined> = {
      "Service-Role-Key": "sb_secret_x", Gemini_API_Key: "g", Canva_Client_ID: "cid", Canva_Client_Secret: "cs", PixalbayAPI: "p", PORT: "3000"
    };
    applyEnvAliases(env);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("sb_secret_x");
    expect(env.GEMINI_API_KEY).toBe("g");
    expect(env.CANVA_CLIENT_ID).toBe("cid");
    expect(env.CANVA_CLIENT_SECRET).toBe("cs");
    expect(env.PIXABAY_API_KEY).toBe("p");
  });
  it("never overrides a setting given under its exact name, and ignores empty ones", () => {
    const env: Record<string, string | undefined> = { SUPABASE_SERVICE_ROLE_KEY: "exact", "Service-Role-Key": "other", Gemini_API_Key: "  " };
    expect(applyEnvAliases(env)).toEqual([]);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("exact");
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });
  it("doesn't take unrelated keys", () => {
    const env: Record<string, string | undefined> = { "Publishable-key": "sb_publishable_x", GiphyAPI: "y" };
    expect(applyEnvAliases(env)).toEqual([]);
  });
});
