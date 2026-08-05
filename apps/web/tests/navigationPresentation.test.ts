import test from "node:test";
import assert from "node:assert/strict";
import { navigationProgress, normalizeNavigationPresentation } from "../src/lib/navigationPresentation";

test("documented navigation directions become stable numbered steps", () => {
  const presentation = normalizeNavigationPresentation({
    title: "前往智能制造展区",
    spoken_text: "从入口前往展区。",
    image_url: "https://example.test/route.png",
    route: {
      from: "一号入口",
      to: "智能制造展区",
      directions: ["从一号入口进入", "沿中央通道直行", "右转进入展区"],
      estimated_minutes: 4,
    },
  });

  assert.equal(presentation.steps.length, 3);
  assert.equal(presentation.steps[1]?.id, "step-2");
  assert.equal(presentation.steps[2]?.spokenText, "右转进入展区");
  assert.equal(presentation.imageUrl, "https://example.test/route.png");
});

test("optional reviewed map payload is clamped and keeps step identity", () => {
  const presentation = normalizeNavigationPresentation({
    spoken_text: "按路线前往。",
    route: {
      id: "route-a1",
      steps: [
        { id: "leave", instruction: "从入口出发", point_id: "entrance" },
        { id: "arrive", instruction: "到达展区", point_id: "booth" },
      ],
      markers: [
        { id: "entrance", name: "入口", x: -5, y: 30, step_index: 0 },
        { id: "booth", name: "展区", x: 120, y: 75, step_index: 1 },
      ],
    },
  });

  assert.equal(presentation.routeId, "route-a1");
  assert.deepEqual(presentation.steps.map((step) => step.id), ["leave", "arrive"]);
  assert.deepEqual(presentation.markers.map((marker) => [marker.x, marker.y]), [[0, 30], [100, 75]]);
});

test("navigation presentation falls back to a usable single step", () => {
  const presentation = normalizeNavigationPresentation({ spoken_text: "当前暂无详细分步说明。" });

  assert.equal(presentation.steps.length, 1);
  assert.equal(presentation.steps[0]?.instruction, "当前暂无详细分步说明。");
  assert.equal(navigationProgress(0, 1), 100);
  assert.equal(navigationProgress(2, 4), 67);
});

