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

test("shopping intent is recognized from the configured guide keywords", () => {
  const config = normalizeExhibitionVoiceConfig({
    exhibition_id: "demo",
    keywords: { navigation: [], exhibition_content: [], shopping: ["推荐", "适合我"] },
  });

  assert.deepEqual(matchVoiceIntent("请推荐适合我的展品", config), {
    intent: "shopping",
    keyword: "适合我",
  });
});
