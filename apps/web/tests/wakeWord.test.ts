import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateWakeWordGate, matchWakeWord } from "../src/lib/wakeWord";

const appSource = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf8");
const displaySource = readFileSync(fileURLToPath(new URL("../src/components/DigitalHumanDisplay.tsx", import.meta.url)), "utf8");

test("wake word matcher ignores punctuation and returns the remaining command", () => {
  assert.deepEqual(matchWakeWord("你好，小展！A1 馆怎么走？", ["你好小展"]), {
    word: "你好小展",
    remainder: "A1 馆怎么走",
  });
});

test("wake word matcher handles wake-only and longest configured words", () => {
  assert.deepEqual(matchWakeWord("小展小展", ["小展", "小展小展"]), {
    word: "小展小展",
    remainder: "",
  });
});

test("wake word matcher returns null when sleeping speech has no wake word", () => {
  assert.equal(matchWakeWord("A1 馆怎么走", ["你好小展"]), null);
});

test("sleeping wake gate rejects speech without a wake word", () => {
  assert.deepEqual(evaluateWakeWordGate({
    text: "A1 馆怎么走",
    words: ["你好小展"],
    now: 10_000,
    awakeUntil: 0,
    sleepTimeoutSeconds: 30,
  }), {
    accepted: false,
    wakeOnly: false,
    text: "",
    matchedWord: null,
    awakeUntil: 0,
  });
});

test("wake word opens the configured conversation window", () => {
  assert.deepEqual(evaluateWakeWordGate({
    text: "你好小展，A1 馆怎么走",
    words: ["你好小展"],
    now: 10_000,
    awakeUntil: 0,
    sleepTimeoutSeconds: 30,
  }), {
    accepted: true,
    wakeOnly: false,
    text: "A1 馆怎么走",
    matchedWord: "你好小展",
    awakeUntil: 40_000,
  });
});

test("accepted conversation refreshes sleep timeout and expires strictly", () => {
  const active = evaluateWakeWordGate({
    text: "主论坛几点开始",
    words: ["你好小展"],
    now: 39_000,
    awakeUntil: 40_000,
    sleepTimeoutSeconds: 30,
  });
  assert.equal(active.accepted, true);
  assert.equal(active.text, "主论坛几点开始");
  assert.equal(active.awakeUntil, 69_000);

  const expired = evaluateWakeWordGate({
    text: "主论坛在哪里",
    words: ["你好小展"],
    now: 69_000,
    awakeUntil: active.awakeUntil,
    sleepTimeoutSeconds: 30,
  });
  assert.equal(expired.accepted, false);
});

test("wake-only speech is accepted without producing a command", () => {
  const result = evaluateWakeWordGate({
    text: "你好，小展",
    words: ["你好小展"],
    now: 5_000,
    awakeUntil: 0,
    sleepTimeoutSeconds: 60,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.wakeOnly, true);
  assert.equal(result.text, "");
  assert.equal(result.awakeUntil, 65_000);
});

test("recognized voice is actually blocked by the wake gate while sleeping", () => {
  assert.match(appSource, /const gate = evaluateWakeWordGate\(/);
  assert.match(appSource, /if \(!gate\.accepted\) return;/);
  assert.doesNotMatch(appSource, /未命中唤醒词时仍保留普通对话兜底/);
});

test("wake prompt is shown initially and returns when the active window expires", () => {
  assert.match(appSource, /setWakeSleeping\(normalized\.wake_word\.enabled && normalized\.wake_word\.words\.length > 0\)/);
  assert.match(appSource, /keepWakeSessionActiveUntil\(gate\.awakeUntil\)/);
  assert.match(appSource, /currentWakeConfig\?\.enabled && currentWakeConfig\.words\.length > 0/);
  assert.match(appSource, /setWakeSleeping\(true\)/);
  assert.match(displaySource, /wakeSleeping && wakePrompt\.trim\(\)/);
  assert.match(displaySource, /digital-display-wake-prompt/);
});
