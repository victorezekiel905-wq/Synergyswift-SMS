import type { GameMode, GameSettings, PublicQuestion } from "@/live/lib/types";

export type PowerUp = "double" | "shield" | "fifty";

export type GameState = {
  id: string; title: string; status: "lobby" | "question" | "review" | "ended" | "open"; join_code: string; mode: GameMode;
  current_index: number; total: number; question_started_at: string | null; question_ends_at: string | null; closes_at: string | null;
  server_now: string; settings: GameSettings; is_host: boolean; players: number;
  /** Survival: players still in. */
  alive?: number | null;
  question?: PublicQuestion; question_index?: number; answered?: number;
  review?: Reveal & { distribution: Record<string, number>; right?: number };
  teams?: TeamScore[] | null;
  /** Race: every right answer is one step. */
  race?: { key: string; name: string; avatar: string | null; steps: number; team_id: string | null }[] | null;
  roster?: { player_id: string; name: string; full_name: string; avatar: string | null; guest: boolean; team_id: string | null; answered: boolean;
    lives: number | null; out: boolean; progress: number; finished: boolean; score: number }[];
  flags?: number;
  me?: { player_id: string; key: string; name: string; avatar: string | null; score: number; streak: number; correct: number; answered: boolean; rank: number;
    lives: number | null; out: boolean; powerups: PowerUp[]; active_powerup: PowerUp | null; earned: PowerUp | null; progress: number; finished: boolean;
    last?: { is_correct: boolean; points: number; comeback: number; double: number; powerup: PowerUp | null } };
};

/** The right answer, after a question closes (or straight away when self-paced). */
export type Reveal = { correct_option_ids: string[]; answer_key: Record<string, unknown> | null; explanation: string | null };

export type TeamScore = { team_id: string; name: string; color: string; score: number; total: number; members: number };

export type BoardRow = { rank: number; player_id: string; key: string; name: string; avatar: string | null; guest?: boolean; score: number; correct: number;
  streak: number; badges: string[]; team_id: string | null; lives: number | null; out: boolean; progress: number | null };

export type Leaderboard = {
  visible: boolean; status: string; mode: GameMode; players: number;
  top: BoardRow[];
  teams: TeamScore[] | null;
  me: { player_id: string; key: string; name: string; avatar: string | null; score: number; streak: number; correct: number; rank: number; badges: string[]; lives: number | null; out: boolean } | null;
};

/** Self-paced answers come back marked straight away. */
export type InstantResult = { accepted: true; is_correct: boolean; timeout: boolean; points: number; comeback: number; double: number; shielded: boolean;
  lives: number | null; out: boolean; earned: PowerUp | null; review: Reveal };

export const BADGE: Record<string, string> = {
  gold: "1st place", silver: "2nd place", bronze: "3rd place", podium: "Podium",
  perfect: "Perfect score", streak_5: "5-answer streak", streak_10: "10-answer streak", speedster: "Fastest correct answers",
  survivor: "Survivor", comeback: "Comeback", team_win: "Winning team", finisher: "Finished every question"
};

export const POWERUP: Record<PowerUp, { name: string; text: string }> = {
  double: { name: "Double", text: "Your next right answer scores double." },
  shield: { name: "Shield", text: "Your next wrong answer keeps your streak (and your life)." },
  fifty: { name: "50:50", text: "Hides half of the wrong answers on this question." }
};

export const MODES: Record<GameMode, { name: string; text: string }> = {
  classic: { name: "Classic", text: "The class answers each question together; you move them on." },
  team_battle: { name: "Team battle", text: "Teams scored by their average, so team size never decides it." },
  survival: { name: "Survival", text: "Everyone starts with lives. A wrong or missed answer costs one. Last ones standing win." },
  race: { name: "Race", text: "Every right answer is a step along the track. First to the finish line wins." },
  self_paced: { name: "Self-paced", text: "Homework mode: students play on their own until the closing time. No host needed." }
};

// Synergy Swift's answer tiles: bolt, star, hexagon, moon, heart, cloud, each with its own colour
// (tailwind "tile"). Each class sets the text colour too (ink on the lime star), so put it after
// any text colour in cn(). The lime star has a darker edge so it holds up on white.
// Every answer has a shape, so colour is never the only cue.
export const OPTION_COLORS = ["bg-tile-bolt text-white", "bg-tile-star text-ink-950 border border-[#9DBB22]", "bg-tile-hex text-white", "bg-tile-moon text-white", "bg-tile-heart text-white", "bg-tile-cloud text-white"];
export const OPTION_SHAPES = ["bolt", "star", "hexagon", "moon", "heart", "cloud"] as const;

export type GameGoal = { enabled: boolean; correct: number; target: number; possible_so_far: number; goal_percent: number };
