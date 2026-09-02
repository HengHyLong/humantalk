import assert from "node:assert/strict";
import test from "node:test";

import { waitForSessionReady } from "../src/lib/sessionReadiness";

test("waits for a newly uploaded avatar runtime before WebRTC starts", async () => {
  const states = ["created", "created", "worker_ready"];
  const seen: string[] = [];

  const result = await waitForSessionReady(
    "sess-new-avatar",
    async (sessionId) => {
      seen.push(sessionId);
      return { state: states.shift() };
    },
    { timeoutMs: 1_000, pollIntervalMs: 0, sleep: async () => undefined },
  );

  assert.equal(result.state, "worker_ready");
  assert.deepEqual(seen, ["sess-new-avatar", "sess-new-avatar", "sess-new-avatar"]);
});

test("surfaces the avatar initialization error instead of opening WebRTC", async () => {
  await assert.rejects(
    waitForSessionReady(
      "sess-broken-avatar",
      async () => ({ state: "error", error_detail: "reference image is invalid" }),
      { timeoutMs: 1_000, pollIntervalMs: 0, sleep: async () => undefined },
    ),
    /reference image is invalid/,
  );
});
