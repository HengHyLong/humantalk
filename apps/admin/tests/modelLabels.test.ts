import assert from "node:assert/strict";
import test from "node:test";

import { modelLabel } from "../src/lib/modelLabels";
import {
  ensureSelectableModelIds,
  ensureSelectableModelStatuses,
} from "../src/lib/modelStatus";

test("shared model labels hide the internal mock identifier", () => {
  assert.equal(modelLabel("mock"), "轻量模式");
  assert.equal(modelLabel("wav2lip"), "Wav2Lip");
  assert.equal(modelLabel("video"), "视频驱动");
  assert.equal(modelLabel("future-model"), "future-model");
});

test("Vidu stays discoverable when an older API omits it", () => {
  assert.deepEqual(ensureSelectableModelIds(["mock"], true), ["mock", "vidu", "video"]);
  assert.deepEqual(
    ensureSelectableModelStatuses([{ id: "mock", connected: true }], ["mock"], true),
    [
      { id: "mock", connected: true },
      {
        id: "vidu",
        backend: "vidu_live",
        connected: false,
        reason: "runtime_not_reported",
      },
      {
        id: "video",
        backend: "browser",
        connected: true,
        reason: "browser_local",
      },
    ],
  );
});
