import assert from "node:assert/strict";
import test from "node:test";
import { getVoiceVadConfig } from "../src/config/voiceVad";

test("VAD defaults keep noise protection while shortening end detection", () => {
  const cfg = getVoiceVadConfig({});
  assert.equal(cfg.silenceMs, 600);
  assert.equal(cfg.minSegmentMs, 450);
  assert.ok(cfg.speechRms > cfg.silenceRms);
  assert.ok(cfg.bargeInSpeechRms > cfg.speechRms);
  assert.ok(cfg.attackFrames >= 2);
});

test("VAD empty and invalid settings use defaults; deployments can restore 800 ms", () => {
  assert.equal(getVoiceVadConfig({ VITE_VOICE_SILENCE_MS: "" }).silenceMs, 600);
  assert.equal(getVoiceVadConfig({ VITE_VOICE_SILENCE_MS: "invalid" }).silenceMs, 600);
  assert.equal(getVoiceVadConfig({ VITE_VOICE_SILENCE_MS: "800" }).silenceMs, 800);
});
