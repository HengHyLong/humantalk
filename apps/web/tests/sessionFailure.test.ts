import test from "node:test";
import assert from "node:assert/strict";
import { sessionFailure } from "../src/lib/sessionFailure";
import { completedQaSpeech, generatedQaText, newQaSpeechPresentation } from "../src/lib/qaSpeechPresentation";

test("speech errors are separate from conversation errors and hide raw details", () => {
  const result = sessionFailure({ code: "SPEAK_FAILED", message: "secret upstream URL", turn_id: "current" }, "current");
  assert.equal(result?.speech, true);
  assert.equal(result?.title, "播报失败");
  assert.ok(!result?.message.includes("secret"));
  assert.equal(sessionFailure({ code: "OTHER" }, "current")?.speech, false);
});

test("late failures from an interrupted turn do not affect the new answer", () => {
  assert.equal(sessionFailure({ code: "SPEAK_FAILED", turn_id: "old" }, "current"), null);
  assert.equal(sessionFailure({ code: "SPEAK_FAILED", turn_id: null }, "current")?.speech, true);
});

test("speech failure can reveal generated text and retain late answer completion", () => {
  const state = newQaSpeechPresentation("turn", "bubble");
  assert.equal(generatedQaText(state, "第一句。"), "");
  assert.equal(completedQaSpeech(state, ""), "第一句。");
  assert.equal(generatedQaText(state, "第一句。第二句。"), "第一句。第二句。");
  assert.equal(state.messageId, "bubble");
});

test("unknown payloads remain safe and speech errors support English", () => {
  assert.equal(sessionFailure(null, "current")?.title, "对话失败");
  assert.equal(sessionFailure({ code: "SPEAK_FAILED" }, "current", true)?.title, "Playback failed");
});
