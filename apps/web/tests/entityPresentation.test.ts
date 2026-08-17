import assert from "node:assert/strict";
import test from "node:test";

import { selectCurrentEntityPresentation } from "../src/lib/entityPresentation";
import type { ExhibitionEntityCard, Message } from "../src/types";

function entity(id: string): ExhibitionEntityCard {
  return {
    id,
    kind: "exhibit",
    name: id,
    description: "",
    spoken_text: "",
    image_urls: [],
    details: [],
    keywords: [id],
    fuzzy_keywords: [],
  };
}

test("entity presentation only uses the latest reply instead of merging history", () => {
  const messages: Message[] = [
    { id: "old", role: "assistant", text: "旧介绍", timestamp: 1, relatedEntities: [entity("智能导览终端")] },
    { id: "user", role: "user", text: "介绍协作机器人", timestamp: 2 },
    { id: "latest", role: "assistant", text: "当前介绍", timestamp: 3, relatedEntities: [entity("协作机器人工作站")] },
  ];

  assert.deepEqual(
    selectCurrentEntityPresentation(messages).flatMap((message) => message.relatedEntities?.map((item) => item.id) ?? []),
    ["协作机器人工作站"],
  );
});

test("entity presentation is hidden when the latest reply has no entity", () => {
  const messages: Message[] = [
    { id: "old", role: "assistant", text: "旧介绍", timestamp: 1, relatedEntities: [entity("智能导览终端")] },
    { id: "latest", role: "assistant", text: "路线回复", timestamp: 2 },
  ];

  assert.deepEqual(selectCurrentEntityPresentation(messages), []);
});
