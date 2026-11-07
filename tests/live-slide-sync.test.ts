import { describe, expect, it } from "vitest";
import { pulseFromSession, withPulse } from "@/live/lib/live-state";
import type { SessionState } from "@/live/components/live/types";

// The teacher's screen moves on the server's own reply, so it is never behind the students
// (who move on the lesson broadcast) and never jumps back to the slide it just left.
const full = (slide: number, v: number) => ({
  session: { id: "s1", state_version: v, current_slide: slide, phase: "lobby", status: "live", mode: "live_participation", active_activity_id: null, responses_visible: false },
  activity: null, timer: null
}) as unknown as SessionState;

describe("teacher's slide in step with the students", () => {
  it("reads the slide and version from a set_session_state reply (a session row)", () => {
    const p = pulseFromSession({ state_version: 8, current_slide: 3, phase: "lobby", status: "live", mode: "live_participation", active_activity_id: null, responses_visible: false });
    expect(p).toMatchObject({ v: 8, slide: 3, phase: "lobby" });
  });

  it("ignores a reply that is not a session row", () => {
    expect(pulseFromSession(null)).toBeNull();
    expect(pulseFromSession({ ok: true })).toBeNull();
  });

  it("shows the new slide at once, before the slow full refresh arrives", () => {
    const p = pulseFromSession({ state_version: 8, current_slide: 3 })!;
    expect(withPulse(full(2, 7), p)!.session.current_slide).toBe(3);
  });

  it("an older refresh arriving late does not put the old slide back", () => {
    const p = pulseFromSession({ state_version: 8, current_slide: 3 })!;
    expect(withPulse(full(2, 7), p)!.session.current_slide).toBe(3);
    // The refresh that was already on its way (version 7, slide 2) changes nothing.
    expect(withPulse(full(2, 7), p)!.session.state_version).toBe(8);
  });

  it("a newer full state wins over an older reply", () => {
    const p = pulseFromSession({ state_version: 8, current_slide: 3 })!;
    expect(withPulse(full(4, 9), p)!.session.current_slide).toBe(4);
  });

  it("opening an activity shows at once too", () => {
    const p = pulseFromSession({ state_version: 8, current_slide: 2, active_activity_id: "a1" })!;
    expect(withPulse(full(2, 7), p)!.session.active_activity_id).toBe("a1");
  });
});
