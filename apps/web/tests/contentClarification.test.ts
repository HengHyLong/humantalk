import assert from "node:assert/strict";
import test from "node:test";

import { classifyContentClarification, classifyContentClarificationTurn, classifyExplicitContentRequest } from "../src/lib/contentClarification";

test("explicit route wording always takes navigation priority", () => {
  for (const text of [
    "机器人展区路线",
    "怎么去机器人展区",
    "如何去机器人展区",
    "我想去机器人展区",
    "我要去机器人展区",
    "机器人展区怎么走",
    "介绍一下去机器人展区的路线",
  ]) {
    assert.equal(classifyExplicitContentRequest(text), "route", text);
  }
});

test("introduction wording selects exhibition entities", () => {
  for (const text of [
    "介绍机器人展区",
    "了解机器人展台",
    "讲解一下协作机器人工作站",
    "我想了解机器人这个商品",
  ]) {
    assert.equal(classifyExplicitContentRequest(text), "entity", text);
  }
});

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
    classifyContentClarification("去机器人展区的路线", "机器人展区", "机器人展区"),
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

test("pending content clarification releases a different question", () => {
  assert.equal(
    classifyContentClarificationTurn("介绍另一家公司", "协作机器人工作站", "机器人展区", true),
    "new_topic",
  );
  assert.equal(
    classifyContentClarificationTurn("怎么去卫生间", "协作机器人工作站", "机器人展区"),
    "new_topic",
  );
  assert.equal(
    classifyContentClarificationTurn("今天天气如何", "协作机器人工作站", "机器人展区"),
    "new_topic",
  );
});

test("pending content clarification accepts explicit choices", () => {
  assert.equal(
    classifyContentClarificationTurn("了解展品", "协作机器人工作站", "机器人展区"),
    "entity",
  );
  assert.equal(
    classifyContentClarificationTurn("我想了解展品", "协作机器人工作站", "机器人展区"),
    "entity",
  );
  assert.equal(
    classifyContentClarificationTurn("查看路线", "协作机器人工作站", "机器人展区"),
    "route",
  );
  assert.equal(
    classifyContentClarificationTurn("我要查看路线", "协作机器人工作站", "机器人展区"),
    "route",
  );
  assert.equal(
    classifyContentClarificationTurn("我要去机器人展区", "协作机器人工作站", "机器人展区"),
    "route",
  );
});
