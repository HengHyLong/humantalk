import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createInteractionPreviewAdapter, createLiveInteractionAdapter } from "../src/lib/interactionAdapter";

test("preview adapter exposes every F16 control without claiming service success", async () => {
  const adapter = createInteractionPreviewAdapter();
  assert.equal(adapter.mode, "preview");
  for (const command of [
    { type: "pause", activityKey: "speech-1" },
    { type: "resume", activityKey: "speech-1" },
    { type: "interrupt", activityKey: "speech-1" },
    { type: "repeat", activityKey: "speech-1" },
    { type: "set-speed", speedRatio: 1.2 },
    { type: "set-language", languageKey: "en-US" },
  ] as const) {
    const outcome = await adapter.execute(command);
    assert.equal(outcome.status, "previewed");
    assert.match(outcome.message, /开发预览/);
  }
});

test("live adapter only calls the reviewed interrupt command", async () => {
  let calls = 0;
  const adapter = createLiveInteractionAdapter({ requestInterrupt: async () => { calls += 1; } });
  const interrupt = await adapter.execute({ type: "interrupt", activityKey: "speech-1" });
  const pause = await adapter.execute({ type: "pause", activityKey: "speech-1" });
  assert.equal(interrupt.status, "applied");
  assert.equal(pause.status, "deferred");
  assert.equal(calls, 1);
});
