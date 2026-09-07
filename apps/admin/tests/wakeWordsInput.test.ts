import assert from "node:assert/strict";
import test from "node:test";
import { formatWakeWordsInput, parseWakeWordsInput } from "../src/admin/wakeWordsInput.ts";

test("wake words accept commas and line breaks", () => {
  assert.deepEqual(
    parseWakeWordsInput("你好小展, 小美小美\n展会助手"),
    ["你好小展", "小美小美", "展会助手"],
  );
});

test("wake words accept Chinese delimiters and remove duplicates", () => {
  assert.deepEqual(
    parseWakeWordsInput("你好小展，你好小展、小美小美\r\n展会助手"),
    ["你好小展", "小美小美", "展会助手"],
  );
});

test("stored wake words are formatted as editable lines and round-trip", () => {
  const wakeWords = ["你好小展", "小美小美"];
  const input = formatWakeWordsInput(wakeWords);
  assert.equal(input, "你好小展\n小美小美");
  assert.deepEqual(parseWakeWordsInput(input), wakeWords);
});
