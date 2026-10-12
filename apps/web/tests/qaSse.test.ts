import test from "node:test";
import assert from "node:assert/strict";
import { connectSse } from "../src/lib/sse";

test("named Dify sentence events reach the frontend callback", () => {
  const previous = globalThis.EventSource;
  let source: FakeEventSource;
  class FakeEventSource {
    handlers = new Map<string, (event: { type: string; data: string }) => void>();
    closed = false;
    constructor() { source = this; }
    addEventListener(name: string, handler: (event: { type: string; data: string }) => void) { this.handlers.set(name, handler); }
    close() { this.closed = true; }
  }
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  try {
    const delivered: string[] = [];
    const stop = connectSse("/api/sessions/test/events", (name, data) => {
      delivered.push(name);
      assert.deepEqual(data, { turn_id: "turn", text: "完整句。" });
    });
    for (const name of ["qa.delta", "qa.completed", "qa.replace", "qa.error", "speech.synthesis_started", "speech.lip_sync_started"]) {
      const handler = source!.handlers.get(name);
      assert.ok(handler, `missing EventSource subscription: ${name}`);
      handler({ type: name, data: JSON.stringify({ turn_id: "turn", text: "完整句。" }) });
    }
    assert.equal(delivered.length, 6);
    stop();
    assert.equal(source!.closed, true);
  } finally { globalThis.EventSource = previous; }
});
