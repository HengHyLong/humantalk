import assert from "node:assert/strict";
import test from "node:test";

import { classifyContentClarification } from "../src/lib/contentClarification";

test("content clarification selects the product introduction", () => {
  assert.equal(
    classifyContentClarification("请介绍协作机器人工作站", "协作机器人工作站", "机器人展区"),
    "entity",
  );
  assert.equal(
    classifyContentClarification("我要了解展品", "协作机器人工作站", "机器人展区"),
    "entity",
  );
  assert.equal(classifyContentClarification("展品", "协作机器人工作站", "机器人展区"), "entity");
  assert.equal(classifyContentClarification("了解机器人展区的介绍", "机器人展区", "机器人展区"), "entity");
});

test("content clarification selects navigation", () => {
  assert.equal(
    classifyContentClarification("我要去机器人展区", "协作机器人工作站", "机器人展区"),
    "route",
  );
  assert.equal(
    classifyContentClarification("查看路线", "协作机器人工作站", "机器人展区"),
    "route",
  );
  assert.equal(classifyContentClarification("我要去机器人展区", "机器人展区", "机器人展区"), "route");
});

test("content clarification keeps ambiguous answers pending", () => {
  assert.equal(
    classifyContentClarification("机器人", "协作机器人工作站", "机器人展区"),
    "unknown",
  );
  assert.equal(
    classifyContentClarification("展品路线", "协作机器人工作站", "机器人展区"),
    "unknown",
  );
});
