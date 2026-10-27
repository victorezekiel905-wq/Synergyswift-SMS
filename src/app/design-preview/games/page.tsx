"use client";
import { useState } from "react";
import { ToastProvider, Card, Button } from "@/live/components/ui";
import { AnswerResult, AnswerTiles, StreakChip } from "@/live/components/game/LiveGame";
import { Lives, MomentOverlay, PowerUpBar, RaceTrack, TeamBars, type Moment } from "@/live/components/game/GameBits";
import { QuestionInput, type Answer } from "@/live/components/activities/QuestionInput";
import { Critter } from "@/live/components/live/Critter";
import { CHARACTERS } from "@/live/components/live/avatars";
import { NewGameForm } from "@/app/live/teacher/challenge/new/NewGameForm";
import { CharacterCollection, type Mine } from "@/app/live/student/characters/CharacterCollection";
import type { PublicQuestion } from "@/live/lib/types";

/**
 * Sample game screens (modes, power-ups, lives, race, teams, characters) for reviewing
 * the design. Only available in builds made with NEXT_PUBLIC_DESIGN_PREVIEW=1.
 */
const MCQ: PublicQuestion = { id: "q1", kind: "mcq", prompt: "What is 3/4 of 20?", media: {}, config: {}, points: 1,
  options: [{ id: "a", label: "12" }, { id: "b", label: "15" }, { id: "c", label: "16" }, { id: "d", label: "5" }] };
const ORDER: PublicQuestion = { id: "q2", kind: "ordering", prompt: "Put these fractions from smallest to largest.", media: {}, points: 1, options: [],
  config: { items: [{ id: "x", label: "3/4" }, { id: "y", label: "1/2" }, { id: "z", label: "2/3" }] } };
const GAP: PublicQuestion = { id: "q3", kind: "fill_blank", prompt: "Half of 10 is ___.", media: {}, points: 1, options: [], config: { blanks: 1 } };
const RUNNERS = [
  { key: "1", name: "Ada O.", avatar: "tiger", steps: 5, team_id: null }, { key: "2", name: "Chidi E.", avatar: "fox", steps: 4, team_id: null },
  { key: "3", name: "Sam (guest)", avatar: "owl", steps: 4, team_id: null }, { key: "4", name: "Dayo B.", avatar: "dragon", steps: 2, team_id: null },
  { key: "5", name: "Efe O.", avatar: "panda", steps: 1, team_id: null }
];
const TEAMS = [
  { team_id: "r", name: "Red Rockets", color: "#ef4444", score: 2650, total: 7950, members: 3 },
  { team_id: "b", name: "Blue Comets", color: "#3b82f6", score: 2400, total: 9600, members: 4 }
];
const MINE: Mine = {
  xp: 1460, level: 5, chosen: "lion", next: { key: "octopus", unlock_xp: 1800, to_go: 340 },
  characters: CHARACTERS.map((c) => ({ ...c, unlocked: c.unlock_xp <= 1460, unlocked_at: null }))
};

export default function GamesPreview() {
  const [moment, setMoment] = useState<Moment | null>(null);
  const [order, setOrder] = useState<Answer | undefined>(undefined);
  const [gap, setGap] = useState<Answer | undefined>(undefined);
  if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") return <p className="p-8">Not available.</p>;
  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-100 pb-16">
        <MomentOverlay moment={moment} onDone={() => setMoment(null)} />
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <p className="font-semibold">Sample game screens</p>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMoment({ kind: "powerup", text: "Power-up!", power: "shield" })}>Power-up moment</Button>
            <Button size="sm" variant="secondary" onClick={() => setMoment({ kind: "streak", text: "5 in a row! On fire" })}>Streak moment</Button>
            <Button size="sm" variant="secondary" onClick={() => setMoment({ kind: "out", text: "Out of lives!" })}>Knocked out</Button>
          </div>
        </header>
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-2">
          <section id="new-game" className="lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Teacher: new game</h2>
            <NewGameForm classes={[{ id: "c1", name: "JSS1 Gold" }]} activities={[{ id: "a1", title: "Fractions quiz", kind: "quiz", lessons: { title: "Fractions" }, questions: [{ count: 8 }] }]} defaults={{}} />
          </section>

          <section id="player" className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-500">Student: survival question with power-ups</h2>
            <div className="flex items-center justify-between">
              <div><p className="text-[13px] font-semibold text-ink-500">Survival</p><h1 className="text-lg font-bold">Fractions quiz</h1></div>
              <div className="text-right"><p className="flex items-center justify-end gap-1.5 text-xs text-ink-500"><Critter name="lion" className="h-5 w-5" />Ada O.</p>
                <p className="font-display text-2xl font-extrabold tabular-nums">3,300</p><Lives lives={2} max={3} /></div>
            </div>
            <StreakChip streak={3} />
            <Card>
              <p className="mb-1 text-sm text-ink-500">Question 4 of 8</p>
              <p className="text-xl font-bold">{MCQ.prompt}</p>
              <div className="my-3"><PowerUpBar held={["double", "fifty"]} active={null} onUse={() => {}} canFifty /></div>
              <AnswerTiles options={MCQ.options} onPick={() => {}} />
            </Card>
            <Card>
              <p className="text-xl font-bold">{ORDER.prompt}</p>
              <div className="my-3"><PowerUpBar held={["fifty"]} active="shield" onUse={() => {}} canFifty={false} /></div>
              <QuestionInput q={ORDER} value={order} onChange={setOrder} reasoning={false} />
            </Card>
            <Card>
              <p className="text-sm font-semibold text-ink-500">Fill in the gap</p>
              <div className="mt-1"><QuestionInput q={GAP} value={gap} onChange={setGap} reasoning={false} /></div>
            </Card>
          </section>

          <section id="results" className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-500">Student: results</h2>
            <AnswerResult correct title="Correct!" points={1650} streak={4} extras="+250 comeback" />
            <AnswerResult correct={false} title="Not this time" points={0} answer={{ label: "15", index: 1 }} />
            <h2 className="pt-2 text-sm font-semibold text-slate-500">Race mode</h2>
            <RaceTrack runners={RUNNERS} total={8} me={{ key: "3" }} />
            <h2 className="pt-2 text-sm font-semibold text-slate-500">Team battle</h2>
            <Card><TeamBars teams={TEAMS} /></Card>
          </section>

          <section id="characters" className="lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Student: my characters</h2>
            <CharacterCollection sample={MINE} />
          </section>
        </div>
      </div>
    </ToastProvider>
  );
}
