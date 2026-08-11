import assert from "node:assert/strict";
import test from "node:test";

import { classifyRegistrationDecision } from "../src/lib/shoppingConversation";

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
