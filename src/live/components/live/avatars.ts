/** Lobby avatars: the stored word (database check ^[a-z]{2,16}$) and its name. Drawn by <Critter>. */
export const AVATARS: Record<string, string> = {
  fox: "Fox", owl: "Owl", panda: "Panda", frog: "Frog", tiger: "Tiger", koala: "Koala",
  penguin: "Penguin", rabbit: "Rabbit", turtle: "Turtle", lion: "Lion", octopus: "Octopus", cat: "Cat",
  unicorn: "Unicorn", whale: "Whale", dragon: "Dragon", phoenix: "Phoenix"
};

export type Rarity = "starter" | "common" | "rare" | "epic" | "legendary";

/**
 * The collection: XP a student needs to unlock each character. Keep in step with
 * live_app.critters() in migration 20260101006130_live_games.sql.
 */
export const CHARACTERS: { key: string; unlock_xp: number; rarity: Rarity }[] = [
  { key: "fox", unlock_xp: 0, rarity: "starter" }, { key: "owl", unlock_xp: 0, rarity: "starter" },
  { key: "panda", unlock_xp: 0, rarity: "starter" }, { key: "frog", unlock_xp: 0, rarity: "starter" },
  { key: "tiger", unlock_xp: 100, rarity: "common" }, { key: "koala", unlock_xp: 250, rarity: "common" },
  { key: "penguin", unlock_xp: 400, rarity: "common" }, { key: "rabbit", unlock_xp: 600, rarity: "common" },
  { key: "turtle", unlock_xp: 900, rarity: "rare" }, { key: "lion", unlock_xp: 1300, rarity: "rare" },
  { key: "octopus", unlock_xp: 1800, rarity: "rare" }, { key: "cat", unlock_xp: 2400, rarity: "rare" },
  { key: "unicorn", unlock_xp: 3200, rarity: "epic" }, { key: "whale", unlock_xp: 4200, rarity: "epic" },
  { key: "dragon", unlock_xp: 5500, rarity: "legendary" }, { key: "phoenix", unlock_xp: 7500, rarity: "legendary" }
];

export const RARITY: Record<Rarity, { name: string; ring: string }> = {
  starter: { name: "Starter", ring: "ring-ink-200" },
  common: { name: "Common", ring: "ring-sky-300" },
  rare: { name: "Rare", ring: "ring-violet-400" },
  epic: { name: "Epic", ring: "ring-fuchsia-500" },
  legendary: { name: "Legendary", ring: "ring-amber-400" }
};

/** The avatar word if it is one of ours, else null (Critter then draws the default face). */
export function avatarFor(key: string | null | undefined): string | null {
  return key && AVATARS[key] ? key : null;
}
