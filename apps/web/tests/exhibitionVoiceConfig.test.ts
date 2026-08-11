import assert from "node:assert/strict";
import test from "node:test";

import {
  matchVoiceIntent,
  normalizeExhibitionVoiceConfig,
  normalizeVoiceText,
} from "../src/lib/exhibitionVoiceConfig";

test("voice text normalization removes punctuation and spacing", () => {
  assert.equal(normalizeVoiceText("  A1-08 展位？ "), "a108展位");
});

test("navigation intent prefers the longest matching configured keyword", () => {
  const config = normalizeExhibitionVoiceConfig({
    exhibition_id: "demo",
    keywords: {
      navigation: ["怎么走", "怎么去智能制造展区"],
      exhibition_content: ["展品", "展会"],
    },
  });

  assert.deepEqual(matchVoiceIntent("请问从入口怎么去智能制造展区？", config), {
    intent: "navigation",
    keyword: "怎么去智能制造展区",
  });
});

test("unmatched questions default to exhibition content", () => {
  const config = normalizeExhibitionVoiceConfig({
    exhibition_id: "demo",
    keyword_groups: { navigation: ["路线"], exhibitionContent: ["展品"] },
  });

  assert.deepEqual(matchVoiceIntent("这个机器人有什么功能？", config), {
    intent: "exhibition_content",
    keyword: null,
  });
});

test("navigation intent tolerates one ASR character error in a configured alias", () => {
  const config = normalizeExhibitionVoiceConfig({
    exhibition_id: "demo",
    keywords: { navigation: ["智造馆"], exhibition_content: [] },
    navigation_fuzzy_keywords: ["智造馆"],
  });

  assert.deepEqual(matchVoiceIntent("请问智照馆怎么走？", config), {
    intent: "navigation",
    keyword: "智造馆",
  });
});

test("generic navigation phrases are not fuzzily expanded", () => {
  const config = normalizeExhibitionVoiceConfig({
    exhibition_id: "demo",
    keywords: { navigation: ["怎么走"], exhibition_content: [] },
    navigation_fuzzy_keywords: [],
  });

  assert.equal(matchVoiceIntent("这个流程怎么做？", config).intent, "exhibition_content");
});

test("wake window uses the configured value", () => {
  const config = normalizeExhibitionVoiceConfig({
    exhibition_id: "demo",
    wake_word: { enabled: true, words: ["你好小展"], active_window_seconds: 60 },
  });

  assert.equal(config.wake_word.active_window_seconds, 60);
  assert.equal(normalizeExhibitionVoiceConfig({ wake_word: { enabled: true, words: ["你好小展"], active_window_seconds: 5 } }).wake_word.active_window_seconds, 30);
});
