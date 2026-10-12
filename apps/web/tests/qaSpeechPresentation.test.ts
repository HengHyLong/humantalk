import test from "node:test";
import assert from "node:assert/strict";
import { completedQaSpeech, generatedQaText, newQaSpeechPresentation, spokenQaText } from "../src/lib/qaSpeechPresentation";

test("generation and HTTP completion never reveal the full answer before playback", () => {
  const state = newQaSpeechPresentation("turn", "bubble");
  assert.equal(generatedQaText(state, "第一句。"), "");
  assert.equal(generatedQaText(state, "第一句。第二句。第三句。"), "");
  assert.equal(spokenQaText(state, "第一句。"), "第一句。");
  assert.equal(generatedQaText(state, "第一句。第二句。第三句。"), "第一句。");
  assert.equal(spokenQaText(state, "第一句。第二句。"), "第一句。第二句。");
  assert.equal(completedQaSpeech(state, ""), "第一句。第二句。第三句。");
  assert.equal(state.messageId, "bubble");
});

test("late HTTP completion fills the answer after playback ends", () => {
  const state = newQaSpeechPresentation("turn", "bubble");
  spokenQaText(state, "第一句。");
  assert.equal(completedQaSpeech(state, ""), "第一句。");
  assert.equal(generatedQaText(state, "第一句。第二句。"), "第一句。第二句。");
});

test("a new turn has independent generation and playback state", () => {
  const old = newQaSpeechPresentation("old", "old-bubble");
  generatedQaText(old, "旧回答。");
  completedQaSpeech(old, "");
  const next = newQaSpeechPresentation("new", "new-bubble");
  assert.equal(generatedQaText(next, "新回答。"), "");
  assert.equal(next.ended, false);
});
