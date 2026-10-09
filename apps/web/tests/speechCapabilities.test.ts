import assert from "node:assert/strict";
import test from "node:test";
import { supportsDeferredVoiceSpeech } from "../src/lib/exhibitionVoiceConfig";

test("missing navigation config keeps deferred streaming STT available", () => {
  assert.equal(supportsDeferredVoiceSpeech(null), true);
  assert.equal(supportsDeferredVoiceSpeech(undefined), true);
  assert.equal(supportsDeferredVoiceSpeech({}), true);
});

test("explicit deferred speech capability remains authoritative", () => {
  assert.equal(supportsDeferredVoiceSpeech({ supports_deferred_speak: false }), false);
  assert.equal(supportsDeferredVoiceSpeech({ supports_deferred_speak: true }), true);
});
