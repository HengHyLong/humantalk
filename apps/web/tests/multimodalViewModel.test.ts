import assert from "node:assert/strict";
import test from "node:test";
import { buildMultimodalCompositionView, validateMultimodalPresentation } from "../src/lib/multimodalViewModel";
import { createMultimodalState, reduceMultimodal } from "../src/lib/useMultimodalController";

test("F02 view model renders structured map/list/card data and flags development preview", () => {
  const map = {
    contentKey: "map-preview",
    revision: 1,
    kind: "map" as const,
    title: "展区地图",
    isDevelopmentPreview: true,
    points: [{ pointId: "entrance", label: "入口", xPercent: 10, yPercent: 80 }],
  };
  let state = createMultimodalState();
  state = reduceMultimodal(state, { type: "publish", slotKey: "primary", presentation: map, operationKey: "publish-map", observedAtMs: 1 });
  const view = buildMultimodalCompositionView(state);
  assert.equal(view.visibleSlots.length, 1);
  assert.equal(view.visibleSlots[0]?.presentation?.contentKey, "map-preview");
  assert.equal(view.hasDevelopmentPreview, true);
});

test("F02 validation rejects unsafe trusted QR and invalid map points", () => {
  const qr = {
    contentKey: "qr-1",
    revision: 1,
    kind: "qr-code" as const,
    title: "资料二维码",
    description: "待服务端提供",
    sourceStatus: "trusted" as const,
    imageSrc: "javascript:alert(1)",
  };
  assert.ok(validateMultimodalPresentation(qr).length > 0);

  const invalidMap = {
    contentKey: "map-1",
    revision: 1,
    kind: "map" as const,
    title: "地图",
    points: [{ pointId: "same", label: "A", xPercent: -1, yPercent: 101 }],
  };
  assert.ok(validateMultimodalPresentation(invalidMap).length > 0);
});
