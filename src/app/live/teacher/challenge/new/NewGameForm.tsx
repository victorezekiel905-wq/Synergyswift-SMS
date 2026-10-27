"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select, Toggle } from "@/live/components/ui";
import { Flag, Heart, Hourglass, Play, Swords } from "lucide-react";
import { Icon, type IconName } from "@/live/components/Icon";
import { MODES } from "@/live/components/game/types";
import { cn } from "@/live/lib/utils";
import { errorText, rpc } from "@/live/lib/rpc";
import type { GameMode, GameSettings } from "@/live/lib/types";
import { useTeacherPresence } from "@/live/lib/teacher-presence";

// Game styles. Kahoot-style speed races suit some lessons, but reward fast guessing and
// stress careful thinkers, so "Think it through" (no timer, no speed points) is the default.
const STYLES: { id: string; name: string; icon: IconName; text: string; set: Partial<GameSettings> }[] = [
  { id: "think", name: "Think it through", icon: "idea", text: "No timer and no speed points. Accuracy wins, and you move on when the class is ready.",
    set: { question_seconds: 0, speed_bonus: false, streak_bonus: true, rank_visibility: "end_only", class_goal: false } },
  { id: "together", name: "Class goal", icon: "together", text: "Everyone works towards one target together. No rankings, so nobody is left at the bottom.",
    set: { question_seconds: 0, speed_bonus: false, streak_bonus: false, rank_visibility: "hidden", class_goal: true, goal_percent: 70 } },
  { id: "race", name: "Quick-fire race", icon: "zap", text: "20 seconds a question with speed and streak bonuses. Best for revision the class already knows well.",
    set: { question_seconds: 20, speed_bonus: true, streak_bonus: true, rank_visibility: "after_each", class_goal: false } }
];

const MODE_ICON: Record<GameMode, typeof Play> = { classic: Play, team_battle: Swords, survival: Heart, race: Flag, self_paced: Hourglass };

/** A week from now at 6 pm, for <input type="datetime-local">. */
function defaultClose() {
  const d = new Date(Date.now() + 7 * 864e5);
  d.setHours(18, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Act = { id: string; title: string; kind: string; lessons: { title: string } | null; questions: { count: number }[] };

export function NewGameForm({ classes, activities, defaults }: { classes: { id: string; name: string }[]; activities: Act[]; defaults: { classId?: string; activityId?: string; sessionId?: string } }) {
  const router = useRouter();
  // Setting up a game from a live lesson keeps that lesson open.
  useTeacherPresence(defaults.sessionId);
  // From a live lesson: its class, if it is one of yours (a lesson without a class has none).
  const lessonClass = classes.some((c) => c.id === defaults.classId) ? defaults.classId : undefined;
  const [cls, setCls] = useState(lessonClass ?? classes[0]?.id ?? "");
  const [act, setAct] = useState(defaults.activityId ?? activities[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("think");
  const [closes, setCloses] = useState(defaultClose);
  const [set, setSet] = useState<GameSettings>({
    mode: "classic", lives: 3, powerups: true, comeback: true,
    question_seconds: 0, speed_bonus: false, streak_bonus: true, rank_visibility: "end_only", display_mode: "first_name_initial",
    team_mode: false, team_count: 2, shuffle_questions: false, shuffle_options: true, podium_size: 3, certificates: true,
    class_goal: false, goal_percent: 70
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const patch = (p: Partial<GameSettings>) => setSet({ ...set, ...p });
  const mode = set.mode ?? "classic";
  const pickMode = (m: GameMode) => patch({
    mode: m,
    team_mode: m === "team_battle" ? true : m === "self_paced" ? false : set.team_mode && set.mode !== "team_battle",
    ...(m === "self_paced" ? { class_goal: false, question_seconds: set.question_seconds || 30, rank_visibility: "after_each" as const } : {}),
    ...(m === "team_battle" || m === "survival" ? { class_goal: false } : {})
  });

  if (!classes.length) return <Alert>Create a class first.</Alert>;
  const chosen = activities.find((a) => a.id === act);
  const empty = !!chosen && (chosen.questions[0]?.count ?? 0) === 0;
  if (!activities.length) return <Alert>Create a quiz or multiple-choice activity in a <Link href="/live/teacher/lessons">lesson</Link> first.</Alert>;

  return (
    <Card>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Class"><Select value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Questions from"><Select value={act} onChange={(e) => setAct(e.target.value)}>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.title}{a.lessons ? ` (${a.lessons.title})` : ""}, {a.questions[0]?.count ?? 0} questions</option>)}
          </Select></Field>
          <Field label="Game title (optional)" className="sm:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        </div>

        <fieldset>
          <legend className="label mb-2">Game mode</legend>
          <div className="grid gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Game mode">
            {(Object.keys(MODES) as GameMode[]).map((m) => { const I = MODE_ICON[m]; return (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => pickMode(m)}
                className={cn("rounded-xl border p-3 text-left transition-colors", mode === m ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white hover:border-ink-400")}>
                <span className={cn("grid h-8 w-8 place-items-center rounded-lg", mode === m ? "bg-accent-500 text-accent-ink" : "bg-ink-100 text-ink-800")}><I className="h-4 w-4" aria-hidden /></span>
                <span className="mt-2 block font-display text-sm font-bold">{MODES[m].name}</span>
                <span className={cn("mt-1 block text-[12px] leading-snug", mode === m ? "text-ink-300" : "text-ink-600")}>{MODES[m].text}</span>
              </button>
            ); })}
          </div>
        </fieldset>

        {mode === "self_paced" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Closes" hint="Students can play any time until then. You can add a day later."><Input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} /></Field>
          </div>
        )}
        {mode === "survival" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lives each" hint="A wrong or missed answer costs one."><Select value={set.lives ?? 3} onChange={(e) => patch({ lives: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select></Field>
          </div>
        )}

        {mode !== "self_paced" && <fieldset>
          <legend className="label mb-2">Game style</legend>
          <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Game style">
            {STYLES.map((st) => (
              <button key={st.id} type="button" role="radio" aria-checked={style === st.id}
                onClick={() => { setStyle(st.id); patch(st.set); }}
                className={cn("rounded-xl border p-4 text-left transition-colors",
                  style === st.id ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white hover:border-ink-400")}>
                <span className="flex items-start justify-between gap-2">
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", style === st.id ? "bg-accent-500 text-accent-ink" : "bg-ink-100 text-ink-800")}><Icon name={st.icon} className="h-4 w-4" /></span>
                  {st.id === "think" && <span className={cn("whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-bold", style === st.id ? "bg-accent-500 text-accent-ink" : "bg-ink-100 text-ink-700")}>Recommended</span>}
                </span>
                <span className="mt-3 block font-display font-bold">{st.name}</span>
                <span className={cn("mt-2 block text-[13px] leading-snug", style === st.id ? "text-ink-300" : "text-ink-600")}>{st.text}</span>
              </button>
            ))}
          </div>
        </fieldset>}

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label mb-2">Scoring</legend>
          <div className="space-y-3">
            <Toggle checked={set.question_seconds === 0} onChange={(v) => patch({ question_seconds: v ? 0 : 20, ...(v ? { speed_bonus: false } : {}) })}
              label="No timer" description="Questions stay open until everyone has answered or you move on. Fairer for careful thinkers and English learners." />
            {set.question_seconds > 0 && <Field label="Seconds per question"><Input type="number" min={5} max={240} value={set.question_seconds} onChange={(e) => patch({ question_seconds: Number(e.target.value) })} /></Field>}
            {set.class_goal && <Field label="Class goal: share of answers correct" hint="The class wins together when it reaches this."><Select value={set.goal_percent} onChange={(e) => patch({ goal_percent: Number(e.target.value) })}>
              {[50, 60, 70, 80, 90].map((n) => <option key={n} value={n}>{n}%</option>)}
            </Select></Field>}
          </div>
          <div className="space-y-3">
            <Toggle checked={set.speed_bonus} disabled={set.question_seconds === 0} onChange={(v) => patch({ speed_bonus: v })} label="Speed bonus" description={set.question_seconds === 0 ? "Needs a timer." : "Up to +50% for fast correct answers. Network lag is not counted against students."} />
            <Toggle checked={set.streak_bonus} onChange={(v) => patch({ streak_bonus: v })} label="Streak bonus" description="+100 per answer in a row (max +500)." />
            <Toggle checked={set.powerups !== false} onChange={(v) => patch({ powerups: v })} label="Power-ups" description="Every 3 right in a row earns one: double points, a shield, or 50:50." />
            <Toggle checked={set.comeback !== false} onChange={(v) => patch({ comeback: v })} label="Comeback bonus" description="+25% for right answers from the bottom half, so nobody is out of it." />
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label mb-2">Leaderboard & privacy</legend>
          <Field label="Show rankings to students"><Select disabled={set.class_goal} value={set.rank_visibility} onChange={(e) => patch({ rank_visibility: e.target.value as GameSettings["rank_visibility"] })}>
            <option value="after_each">After every question</option><option value="end_only">Only at the end</option><option value="hidden">Never (students see only their own rank)</option>
          </Select></Field>
          <Field label="Names on the leaderboard"><Select value={set.display_mode} onChange={(e) => patch({ display_mode: e.target.value as GameSettings["display_mode"] })}>
            <option value="first_name_initial">First name + last initial</option><option value="nickname">Nicknames (you can rename or remove)</option><option value="anonymous">Anonymous (Player 1, 2…)</option>
          </Select></Field>
          <Field label="Podium size"><Input type="number" min={1} max={10} value={set.podium_size} onChange={(e) => patch({ podium_size: Number(e.target.value) })} /></Field>
          <Toggle checked={set.certificates} onChange={(v) => patch({ certificates: v })} label="Badges & certificates" description="Podium, perfect score, streak and speed badges." />
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label mb-2">Format</legend>
          <div className="space-y-3">
            {mode !== "self_paced" && mode !== "team_battle" && <Toggle checked={set.team_mode} onChange={(v) => patch({ team_mode: v })} label="Team mode" description="Players are balanced across teams automatically, scored by average." />}
            {set.team_mode && <Field label="Teams"><Input type="number" min={2} max={6} value={set.team_count} onChange={(e) => patch({ team_count: Number(e.target.value) })} /></Field>}
          </div>
          <div className="space-y-3">
            <Toggle checked={set.shuffle_questions} onChange={(v) => patch({ shuffle_questions: v })} label="Randomise question order" />
            <Toggle checked={set.shuffle_options} onChange={(v) => patch({ shuffle_options: v })} label="Shuffle answer options" />
          </div>
        </fieldset>

        {empty && <Alert tone="warn">“{chosen!.title}” has no questions yet. Add choice, true/false, gap-fill, matching, ordering or sorting questions to it in its <Link href="/live/teacher/lessons">lesson</Link>, or choose another quiz.</Alert>}
        {err && <Alert tone="error">{err}</Alert>}
        <Button size="lg" loading={busy} disabled={empty} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            const settings = mode === "self_paced" ? { ...set, closes_at: new Date(closes).toISOString() } : set;
            const g = await rpc<{ id: string }>("create_game", { p_class: cls, p_activity: act, p_settings: settings, p_session: lessonClass && cls === lessonClass ? defaults.sessionId ?? null : null, p_title: title || null });
            router.push(`/live/teacher/challenge/${g.id}`);
          } catch (e) { setErr(errorText(e)); setBusy(false); }
        }}>{mode === "self_paced" ? "Open the game" : "Open lobby"}</Button>
      </div>
    </Card>
  );
}
