import assert from "node:assert/strict";
import test from "node:test";

import { pickNextSource, shouldLoopSourcePool, sourcePoolFor } from "../src/lib/motionPlaylist";

test("talk state mixes normal and emphasis clips", () => {
  const sources = sourcePoolFor("talk", {
    listen_url: "/listen",
    talk_url: "/legacy-talk",
    states: {
      talk: ["/talk-a", "/talk-b"],
      emphasis: ["/emphasis-a"],
    },
  });

  assert.equal(sources.length, 4);
  assert.ok(sources.some((source) => source.endsWith("/talk-a")));
  assert.ok(sources.some((source) => source.endsWith("/emphasis-a")));
});

test("playlist selection avoids an immediate repeat when alternatives exist", () => {
  const pool = ["a", "b", "c"];
  for (let index = 0; index < 20; index += 1) {
    assert.notEqual(pickNextSource(pool, "a"), "a");
  }
});

test("welcome falls back to avatar-specific listening clips", () => {
  const sources = sourcePoolFor("welcome", {
    listen_url: "/legacy-listen",
    talk_url: "/legacy-talk",
    states: { listen: ["/listen-a"] },
  });

  assert.ok(sources.some((source) => source.endsWith("/listen-a")));
  assert.ok(sources.some((source) => source.endsWith("/legacy-listen")));
});

test("a duplicated single idle source uses the native video loop", () => {
  const sources = sourcePoolFor("listen", {
    listen_url: "/idle-a",
    states: {
      idle: ["/idle-a"],
      listen: ["/idle-a"],
    },
  });

  assert.deepEqual(sources, ["/idle-a"]);
  assert.equal(shouldLoopSourcePool(sources), true);
  assert.equal(shouldLoopSourcePool(["/idle-a", "/idle-b"]), false);
});
