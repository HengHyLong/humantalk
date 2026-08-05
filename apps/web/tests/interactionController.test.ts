import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createInteractionController, transitionInteraction } from "../src/lib/interactionController";

function event(event: Record<string, unknown>, key: string, time: number) {
  return transitionInteraction(createInteractionController(), { ...event, operationKey: key, observedAtMs: time } as never);
}

test("F16 controller supports start, pause, resume, interrupt and repeat", () => {
  let state = createInteractionController();
  state = transitionInteraction(state, { type: "start", activityKey: "speech-1", operationKey: "start", observedAtMs: 1 }).state;
  state = transitionInteraction(state, { type: "pause", activityKey: "speech-1", operationKey: "pause", observedAtMs: 2 }).state;
  assert.equal(state.status, "paused");
  state = transitionInteraction(state, { type: "resume", activityKey: "speech-1", operationKey: "resume", observedAtMs: 3 }).state;
  state = transitionInteraction(state, { type: "interrupt", activityKey: "speech-1", operationKey: "interrupt", observedAtMs: 4 }).state;
  assert.equal(state.status, "interrupted");
  const repeated = transitionInteraction(state, { type: "repeat-previous", operationKey: "repeat", observedAtMs: 5 });
  assert.equal(repeated.decision.type, "repeat");
  assert.equal(repeated.state.activeActivityKey, "speech-1");
});

test("F16 controller rejects duplicates, stale events and invalid preferences", () => {
  const started = event({ type: "start", activityKey: "speech-1" }, "same", 2);
  const duplicate = transitionInteraction(started.state, { type: "start", activityKey: "speech-2", operationKey: "same", observedAtMs: 3 });
  assert.deepEqual(duplicate.decision, { type: "ignore", reason: "duplicate-operation" });
  const stale = transitionInteraction(started.state, { type: "pause", activityKey: "speech-1", operationKey: "stale", observedAtMs: 1 });
  assert.deepEqual(stale.decision, { type: "ignore", reason: "out-of-order" });
  const invalidSpeed = transitionInteraction(started.state, { type: "set-speed", speedRatio: 0, operationKey: "speed", observedAtMs: 4 });
  assert.deepEqual(invalidSpeed.decision, { type: "ignore", reason: "invalid-speed" });
  const invalidLanguage = transitionInteraction(started.state, { type: "set-language", languageKey: "  ", operationKey: "language", observedAtMs: 5 });
  assert.deepEqual(invalidLanguage.decision, { type: "ignore", reason: "empty-language" });
});
