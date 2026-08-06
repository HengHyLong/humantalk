import test from "node:test";
import assert from "node:assert/strict";
import {
  createInputCaptureEvent,
  parseScanInputDetail,
} from "../src/lib/inputCapture";

test("input events carry the session, terminal, version and correlation metadata", () => {
  const event = createInputCaptureEvent({
    sessionId: "sess-1",
    terminalId: "terminal-a",
    source: "microphone",
    kind: "voice.ended",
    correlationId: "voice-1",
    payload: { reason: "silence", durationMs: 920 },
    now: Date.parse("2026-08-05T10:00:00.000Z"),
  });

  assert.equal(event.eventVersion, 1);
  assert.equal(event.sessionId, "sess-1");
  assert.equal(event.terminalId, "terminal-a");
  assert.equal(event.correlationId, "voice-1");
  assert.equal(event.occurredAt, "2026-08-05T10:00:00.000Z");
  assert.deepEqual(event.payload, { reason: "silence", durationMs: 920 });
});

test("scan bridge accepts identifiers but does not require raw QR content", () => {
  assert.deepEqual(parseScanInputDetail({
    target_id: "point-a1",
    routeId: "route-1",
    correlation_id: "scan-1",
    content: "sensitive-value-is-not-used",
  }), {
    targetId: "point-a1",
    routeId: "route-1",
    correlationId: "scan-1",
  });
  assert.equal(parseScanInputDetail({ content: "raw-only" }), null);
});

