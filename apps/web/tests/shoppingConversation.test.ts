import assert from "node:assert/strict";
import test from "node:test";

import { classifyProductInterestDecision, classifyRegistrationDecision, classifyRegistrationFollowupDecision, selectShoppingPresentationEntities } from "../src/lib/shoppingConversation";
import type { ExhibitionEntityCard } from "../src/types";

const confirms = ["需要", "好的", "可以", "登记", "要"];
const declines = ["不需要", "不用", "不要", "暂不", "不登记"];

test("registration decision recognizes an explicit confirmation", () => {
  assert.equal(classifyRegistrationDecision("好的，请帮我登记", confirms, declines), "confirm");
});

test("registration decision gives negative phrases priority", () => {
  assert.equal(classifyRegistrationDecision("我不需要登记", confirms, declines), "decline");
  assert.equal(classifyRegistrationDecision("不要", confirms, declines), "decline");
});

test("registration decision keeps an ambiguous reply in the confirmation round", () => {
  assert.equal(classifyRegistrationDecision("我再看看产品参数", confirms, declines), "unknown");
});

test("company product follow-up releases a new question instead of matching its acknowledgement", () => {
  const confirms = ["想了解", "想看", "好的", "可以"];
  const declines = ["不想", "不用", "不需要"];

  assert.equal(classifyProductInterestDecision("好的，请问卫生间在哪里？", confirms, declines), "unknown");
  assert.equal(classifyProductInterestDecision("我想了解另一家公司", confirms, declines, true), "unknown");
  assert.equal(classifyProductInterestDecision("我想了解人工智能", confirms, declines), "unknown");
  assert.equal(classifyProductInterestDecision("不用了，卫生间在哪里？", confirms, declines), "unknown");
  assert.equal(classifyProductInterestDecision("讲个笑话", confirms, declines), "unknown");
  assert.equal(classifyProductInterestDecision("好的，讲个笑话", confirms, declines), "unknown");
});

test("company product follow-up still accepts direct product answers", () => {
  const confirms = ["想了解", "想看", "好的", "可以"];
  const declines = ["不想", "不用", "不需要"];

  assert.equal(classifyProductInterestDecision("好的", confirms, declines), "confirm");
  assert.equal(classifyProductInterestDecision("我想了解一下", confirms, declines), "confirm");
  assert.equal(classifyProductInterestDecision("请介绍一下这家公司的产品", confirms, declines), "confirm");
  assert.equal(classifyProductInterestDecision("我不想了解这些产品", confirms, declines), "decline");
  assert.equal(classifyProductInterestDecision("暂时不用", confirms, declines), "decline");
});

test("registration follow-up releases unrelated questions", () => {
  const confirms = ["需要", "好的", "可以", "同意", "登记"];
  const declines = ["不需要", "不用", "取消"];

  assert.equal(classifyRegistrationFollowupDecision("好的，请问卫生间在哪里？", confirms, declines), "new_topic");
  assert.equal(classifyRegistrationFollowupDecision("今天有哪些会议？", confirms, declines), "new_topic");
  assert.equal(classifyRegistrationFollowupDecision("介绍另一件展品", confirms, declines, true), "new_topic");
  assert.equal(classifyRegistrationFollowupDecision("不用了，卫生间在哪里？", confirms, declines), "new_topic");
});

test("registration follow-up keeps direct confirmation answers", () => {
  const confirms = ["需要", "好的", "可以", "同意", "登记"];
  const declines = ["不需要", "不用", "取消"];

  assert.equal(classifyRegistrationFollowupDecision("好的", confirms, declines), "confirm");
  assert.equal(classifyRegistrationFollowupDecision("请打开登记二维码", confirms, declines), "confirm");
  assert.equal(classifyRegistrationFollowupDecision("暂时不用", confirms, declines), "decline");
});

test("shopping confirmation only presents the explicitly introduced product", () => {
  const product = (id: string): ExhibitionEntityCard => ({
    id,
    kind: "exhibit",
    name: id,
    description: "",
    spoken_text: "",
    image_urls: [],
    details: [],
    keywords: [id],
    fuzzy_keywords: [],
  });
  const terminal = product("智能导览终端");
  const robot = product("协作机器人工作站");

  assert.deepEqual(selectShoppingPresentationEntities(robot, [terminal, robot]).map((entity) => entity.id), [robot.id]);
});
