import assert from "node:assert/strict";
import test from "node:test";
import { selectCurrentConversation } from "../src/lib/currentConversation";
import type { Message } from "../src/types";

const message = (id: string, role: Message["role"], text = id): Message => ({ id, role, text, timestamp: 0 });

test("shows only the latest user and answer without changing history", () => {
  const history = [message("u1", "user"), message("a1", "assistant"), message("u2", "user"), message("a2", "assistant")];
  assert.deepEqual(selectCurrentConversation(history).map((item) => item.id), ["u2", "a2"]);
  assert.equal(history.length, 4);
});

test("a new question clears the displayed previous answer", () => {
  assert.deepEqual(selectCurrentConversation([message("u1", "user"), message("a1", "assistant"), message("u2", "user")]).map((item) => item.id), ["u2"]);
});

test("multiple assistant events still produce one answer", () => {
  assert.deepEqual(selectCurrentConversation([message("u1", "user"), message("a1", "assistant"), message("a2", "assistant")]).map((item) => item.id), ["u1", "a2"]);
});

test("handles an empty conversation and an initial assistant greeting", () => {
  assert.deepEqual(selectCurrentConversation([]), []);
  assert.deepEqual(selectCurrentConversation([message("a1", "assistant")]).map((item) => item.id), ["a1"]);
});
