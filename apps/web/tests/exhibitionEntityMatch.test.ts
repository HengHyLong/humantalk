import assert from "node:assert/strict";
import test from "node:test";

import { matchExhibitionEntities } from "../src/lib/exhibitionEntityMatch";
import type { ExhibitionEntityCard } from "../src/types";

const entity: ExhibitionEntityCard = {
  id: "exhibit-1",
  kind: "exhibit",
  name: "协作机器人",
  description: "用于柔性生产线。",
  spoken_text: "这是协作机器人介绍。",
  image_urls: [],
  details: [],
  keywords: ["协作机器人", "小蓝"],
  fuzzy_keywords: ["协作机器人", "小蓝"],
};

test("entity matcher matches configured alias after wake word is removed", () => {
  assert.equal(matchExhibitionEntities("介绍一下小蓝", [entity])[0]?.id, "exhibit-1");
});

test("entity matcher tolerates one ASR character error", () => {
  assert.equal(matchExhibitionEntities("介绍一下协做机器人", [entity])[0]?.id, "exhibit-1");
});

test("entity matcher does not fuzzily match two-character aliases", () => {
  assert.equal(matchExhibitionEntities("介绍一下小兰", [entity]).length, 0);
});
