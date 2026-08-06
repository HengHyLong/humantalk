import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  canReplayWelcome,
  canStartWelcome,
  createInitialWelcomeState,
  welcomePhaseLabel,
  welcomeStateReducer,
} from "../src/lib/welcomeExperience";

function transition(
  state: ReturnType<typeof createInitialWelcomeState>,
  ...events: Parameters<typeof welcomeStateReducer>[1][]
) {
  return events.reduce(welcomeStateReducer, state);
}

test("a connected session becomes eligible and completes one welcome turn", () => {
  const state = transition(
    createInitialWelcomeState(1_000),
    { type: "session_connected", sessionId: "sess-1", exhibitionId: "expo-1", now: 100 },
    { type: "scheduled" },
    { type: "started", now: 200 },
    { type: "finished" },
  );

  assert.equal(state.phase, "cooldown");
  assert.equal(state.sessionId, "sess-1");
  assert.equal(state.exhibitionId, "expo-1");
  assert.equal(state.cooldownUntil, 1_200);
  assert.equal(canStartWelcome(state, 1_199), false);
  assert.equal(canStartWelcome(state, 1_200), true);
  const elapsed = welcomeStateReducer(state, { type: "cooldown_elapsed", now: 1_200 });
  assert.equal(elapsed.phase, "eligible");
  assert.equal(elapsed.autoStart, false);
});

test("duplicate connection events do not replay the same session", () => {
  const connected = transition(
    createInitialWelcomeState(),
    { type: "session_connected", sessionId: "sess-1", now: 0 },
    { type: "started", now: 1 },
  );

  assert.deepEqual(
    welcomeStateReducer(connected, { type: "session_connected", sessionId: "sess-1", now: 2 }),
    connected,
  );
});

test("user input cancels a scheduled or speaking welcome", () => {
  const scheduled = transition(
    createInitialWelcomeState(),
    { type: "session_connected", sessionId: "sess-1", now: 0 },
    { type: "scheduled" },
    { type: "user_input" },
  );
  assert.equal(scheduled.phase, "interrupted");

  const speaking = transition(
    createInitialWelcomeState(),
    { type: "session_connected", sessionId: "sess-2", now: 0 },
    { type: "started", now: 10 },
    { type: "user_input" },
  );
  assert.equal(speaking.phase, "interrupted");
  assert.equal(canReplayWelcome(speaking, 10), false);
  assert.equal(canReplayWelcome(speaking, 60_010), true);
});

test("failure can be retried after the welcome cooldown", () => {
  const failed = transition(
    createInitialWelcomeState(500),
    { type: "session_connected", sessionId: "sess-1", now: 0 },
    { type: "started", now: 10 },
    { type: "failed", message: "speech unavailable" },
  );
  assert.equal(failed.phase, "failed");
  assert.equal(canReplayWelcome(failed, 100), false);
  const retried = welcomeStateReducer(failed, { type: "retry_requested", now: 510 });
  assert.equal(retried.phase, "eligible");
});

test("session close clears the active session but preserves cooldown protection", () => {
  const closed = transition(
    createInitialWelcomeState(1_000),
    { type: "session_connected", sessionId: "sess-1", now: 0 },
    { type: "started", now: 100 },
    { type: "session_closed" },
  );
  assert.equal(closed.phase, "idle");
  assert.equal(closed.sessionId, null);
  const next = welcomeStateReducer(closed, {
    type: "session_connected",
    sessionId: "sess-2",
    now: 500,
  });
  assert.equal(next.phase, "cooldown");
});

test("phase labels expose all welcome states", () => {
  assert.deepEqual(
    ["idle", "eligible", "scheduled", "speaking", "cooldown", "interrupted", "failed"].map(
      (phase) => welcomePhaseLabel(phase as Parameters<typeof welcomePhaseLabel>[0]),
    ),
    ["待机", "等待迎宾", "准备迎宾", "正在迎宾", "可继续提问", "迎宾已暂停", "迎宾暂不可用"],
  );
});
