import assert from "node:assert/strict";
import test from "node:test";

import { isEnglishConversation, normalizeConversationLanguage } from "../src/lib/conversationLanguage";

test("conversation language accepts English and defaults unknown values to Chinese", () => {
  assert.equal(normalizeConversationLanguage("en-US"), "en-US");
  assert.equal(normalizeConversationLanguage("zh-CN"), "zh-CN");
  assert.equal(normalizeConversationLanguage("fr-FR"), "zh-CN");
  assert.equal(isEnglishConversation("en-US"), true);
});
