import assert from "node:assert/strict";
import test from "node:test";
import { createMultimodalController, transitionMultimodal } from "../src/lib/multimodalController";

const mapContent = {
  contentKey: "map-1",
  contentRevision: 1,
  presentationKind: "map" as const,
};

test("F02 controller loads, shows, hides and updates a slot by revision", () => {
  let state = createMultimodalController();
  let transition = transitionMultimodal(state, {
    type: "load-content",
    slotKey: "primary",
    content: mapContent,
    operationKey: "load-1",
    observedAtMs: 1,
  });
  assert.equal(transition.decision.type, "content-ready");
  state = transition.state;

  transition = transitionMultimodal(state, {
    type: "show-content",
    slotKey: "primary",
    contentKey: "map-1",
    operationKey: "show-1",
    observedAtMs: 2,
  });
  assert.equal(transition.decision.type, "show");
  assert.equal(transition.state.slots.primary?.status, "visible");
  state = transition.state;

  transition = transitionMultimodal(state, {
    type: "hide-content",
    slotKey: "primary",
    contentKey: "map-1",
    operationKey: "hide-1",
    observedAtMs: 3,
  });
  assert.equal(transition.decision.type, "hide");
  assert.equal(transition.state.slots.primary?.status, "hidden");
  state = transition.state;

  transition = transitionMultimodal(state, {
    type: "load-content",
    slotKey: "primary",
    content: { ...mapContent, contentRevision: 2 },
    operationKey: "load-2",
    observedAtMs: 4,
  });
  assert.equal(transition.decision.type, "content-updated");
  assert.equal(transition.state.slots.primary?.status, "hidden");
  assert.equal(transition.state.slots.primary?.content?.contentRevision, 2);
});

test("F02 controller ignores duplicate, out-of-order and stale operations", () => {
  const loaded = transitionMultimodal(createMultimodalController(), {
    type: "load-content",
    slotKey: "detail",
    content: { contentKey: "card-1", contentRevision: 3, presentationKind: "card" },
    operationKey: "load-card",
    observedAtMs: 10,
  });
  const duplicate = transitionMultimodal(loaded.state, {
    type: "load-content",
    slotKey: "detail",
    content: { contentKey: "card-1", contentRevision: 4, presentationKind: "card" },
    operationKey: "load-card",
    observedAtMs: 11,
  });
  assert.deepEqual(duplicate.decision, { type: "ignore", reason: "duplicate-operation" });

  const staleOrder = transitionMultimodal(loaded.state, {
    type: "show-content",
    slotKey: "detail",
    contentKey: "card-1",
    operationKey: "show-old",
    observedAtMs: 9,
  });
  assert.deepEqual(staleOrder.decision, { type: "ignore", reason: "out-of-order" });

  const staleRevision = transitionMultimodal(loaded.state, {
    type: "load-content",
    slotKey: "detail",
    content: { contentKey: "card-1", contentRevision: 2, presentationKind: "card" },
    operationKey: "load-old-revision",
    observedAtMs: 12,
  });
  assert.deepEqual(staleRevision.decision, { type: "ignore", reason: "stale-content" });
});
