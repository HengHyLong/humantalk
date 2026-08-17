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

test("entity matcher keeps the most specific area or product alias first", () => {
  const area: ExhibitionEntityCard = {
    id: "point-robot-area",
    kind: "point",
    name: "机器人展区",
    description: "机器人主题展区。",
    spoken_text: "这是机器人展区介绍。",
    image_urls: [],
    details: [],
    keywords: ["机器人展区", "智能制造区"],
    fuzzy_keywords: [],
  };

  assert.equal(matchExhibitionEntities("介绍机器人展区", [entity, area])[0]?.id, area.id);
  assert.equal(matchExhibitionEntities("了解智能制造区", [entity, area])[0]?.id, area.id);
  assert.equal(matchExhibitionEntities("介绍一下小蓝", [entity, area])[0]?.id, entity.id);
});

test("entity matcher recognizes a specific leading part of the official name", () => {
  const workstation: ExhibitionEntityCard = {
    ...entity,
    id: "robot-workstation",
    name: "协作机器人工作站",
    keywords: ["机器人工作站"],
    fuzzy_keywords: [],
  };
  const terminal: ExhibitionEntityCard = {
    ...entity,
    id: "guide-terminal",
    name: "智能导览终端",
    keywords: ["导览终端"],
    fuzzy_keywords: [],
  };

  assert.equal(matchExhibitionEntities("介绍协作机器人", [terminal, workstation])[0]?.id, workstation.id);
});
