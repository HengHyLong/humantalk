import assert from "node:assert/strict";
import test from "node:test";

import { mergeMotionDrivers, pickNextSource, shouldLoopSourcePool, sourcePoolFor } from "../src/lib/motionPlaylist";

test("motion-only avatars provide their clips to the video driver", () => {
  const driver = mergeMotionDrivers(null, {
    states: {
      listen: [{ url: "/listen-a" }, { url: "/listen-b" }],
      talk: [{ url: "/talk-a" }],
    },
  });

  assert.deepEqual(sourcePoolFor("listen", driver), ["/listen-a", "/listen-b"]);
  assert.deepEqual(sourcePoolFor("talk", driver), ["/talk-a"]);
});

test("a motion-only avatar remains visible when the current state has no dedicated clip", () => {
  const driver = mergeMotionDrivers(null, {
    states: { talk: [{ url: "/talk-a" }] },
  });

  assert.deepEqual(sourcePoolFor("listen", driver), ["/talk-a"]);
  assert.deepEqual(sourcePoolFor("think", driver), ["/talk-a"]);
});

test("motion clips augment legacy video-driver clips without duplicates", () => {
  const driver = mergeMotionDrivers({
    listen_url: "/legacy-listen",
    states: { talk: ["/talk-a"] },
  }, {
    states: { talk: [{ url: "/talk-a" }, { url: "/talk-b" }] },
  });

  assert.deepEqual(driver?.states?.talk, ["/talk-a", "/talk-b"]);
});

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

test("think falls back to avatar-specific idle clips", () => {
  const sources = sourcePoolFor("think", {
    states: { idle: ["/idle-a"] },
  });

  assert.deepEqual(sources, ["/idle-a"]);
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
