import assert from "node:assert/strict";
import test from "node:test";

import { matchWakeWord } from "../src/lib/wakeWord";

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
