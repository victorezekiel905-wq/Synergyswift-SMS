import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { AVATARS, CHARACTERS } from "@/live/components/live/avatars";
import { BADGE, MODES } from "@/live/components/game/types";

const sql = readFileSync(path.resolve(__dirname, "../supabase/migrations/20260101006130_live_games.sql"), "utf8");

describe("live characters", () => {
  it("unlock at the same XP on screen as in the database", () => {
    const body = sql.match(/function live_app\.critters\(\)[\s\S]*?values([\s\S]*?)\n\$\$;/)?.[1] ?? "";
    const rows = [...body.matchAll(/\('([a-z]+)', (\d+), '([a-z]+)'\)/g)].map((m) => ({ key: m[1], unlock_xp: Number(m[2]), rarity: m[3] }));
    expect(rows.length).toBe(16);
    expect(CHARACTERS).toEqual(rows);
  });

  it("every character has a name and starters cost nothing", () => {
    for (const c of CHARACTERS) expect(AVATARS[c.key]).toBeTruthy();
    expect(CHARACTERS.filter((c) => c.unlock_xp === 0).map((c) => c.rarity)).toEqual(["starter", "starter", "starter", "starter"]);
  });
});

describe("live game modes and badges", () => {
  it("match the modes the database accepts", () => {
    const modes = sql.match(/p ->> 'mode' in \(([^)]*)\)/)?.[1].match(/'([a-z_]+)'/g)?.map((m) => m.slice(1, -1));
    expect(Object.keys(MODES).sort()).toEqual([...(modes ?? [])].sort());
  });

  it("name every badge the database awards", () => {
    const finish = sql.slice(sql.indexOf("function live_app.finish_game"), sql.indexOf("function live_app.game_rank"));
    const awarded = new Set([...finish.matchAll(/then '([a-z_0-9]+)'/g)].map((m) => m[1]));
    for (const b of awarded) expect(BADGE[b], b).toBeTruthy();
  });
});
