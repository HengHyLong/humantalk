import assert from "node:assert/strict";
import test from "node:test";
import {
  bufferSubtitleChunk,
  classifyMediaFailure,
  createInitialMediaPlaybackState,
  createSubtitleTurnBuffer,
  decideMediaReconnect,
  endSubtitleTurn,
  getSubtitlePresentation,
  markSubtitleMediaStarted,
  mediaPlaybackReducer,
} from "../src/lib/mediaPlayback";

const chunk = (chunkKey: string, order: number, text: string, observedAtMs = 1_000) => ({
  scopeKey: "session-1",
  turnKey: "turn-1",
  chunkKey,
  order,
  text,
  observedAtMs,
});

test("F01 subtitle buffer orders chunks, rejects duplicates and gates on media start", () => {
  let buffer = bufferSubtitleChunk(createSubtitleTurnBuffer(), chunk("chunk-2", 2, "世界")).buffer;
  buffer = bufferSubtitleChunk(buffer, chunk("chunk-1", 1, "你好", 1_100)).buffer;
  assert.equal(getSubtitlePresentation(buffer, "session-1", "turn-1", 1_100).visible, false);
  assert.equal(getSubtitlePresentation(buffer, "session-1", "turn-1", 1_100).text, "你好世界");
  assert.equal(bufferSubtitleChunk(buffer, chunk("chunk-1", 3, "重复")).reason, "duplicate-chunk");

  buffer = markSubtitleMediaStarted(buffer, { scopeKey: "session-1", turnKey: "turn-1", observedAtMs: 1_200 }).buffer;
  const presentation = getSubtitlePresentation(buffer, "session-1", "turn-1", 1_200);
  assert.equal(presentation.visible, true);
  assert.equal(presentation.degraded, false);
  assert.equal(presentation.reason, "media-started");
});

test("F01 subtitle fallback exposes text when media-start signal is missing", () => {
  const buffer = bufferSubtitleChunk(createSubtitleTurnBuffer(), chunk("chunk-1", 1, "回退字幕")).buffer;
  const presentation = getSubtitlePresentation(buffer, "session-1", "turn-1", 2_500);
  assert.equal(presentation.visible, true);
  assert.equal(presentation.degraded, true);
  assert.equal(presentation.reason, "fallback");
});

test("F01 ended subtitle turns reject late chunks", () => {
  const buffer = bufferSubtitleChunk(createSubtitleTurnBuffer(), chunk("chunk-1", 1, "结束")).buffer;
  const ended = endSubtitleTurn(buffer, { scopeKey: "session-1", turnKey: "turn-1", observedAtMs: 1_100 }).buffer;
  assert.equal(bufferSubtitleChunk(ended, chunk("chunk-2", 2, "迟到", 1_200)).reason, "turn-ended");
});

test("F01 reconnect policy uses bounded retry and degrades after exhaustion", () => {
  const failure = classifyMediaFailure("connection-lost");
  assert.deepEqual(decideMediaReconnect(failure, 0, 0.5), { shouldRetry: true, attempt: 1, delayMs: 1_000 });
  assert.equal(decideMediaReconnect(failure, 3, 0.5).shouldRetry, false);
  assert.equal(decideMediaReconnect(classifyMediaFailure("authorization-required"), 0).shouldRetry, false);
});

test("F01 playback state records remote stream, first frame and recovery", () => {
  let state = createInitialMediaPlaybackState();
  state = mediaPlaybackReducer(state, { type: "negotiate" });
  state = mediaPlaybackReducer(state, { type: "remote-stream" });
  assert.equal(state.status, "buffering");
  state = mediaPlaybackReducer(state, { type: "first-frame" });
  assert.equal(state.status, "playing");
  state = mediaPlaybackReducer(state, { type: "stalled" });
  state = mediaPlaybackReducer(state, { type: "reconnect-requested", attempt: 1 });
  assert.equal(state.status, "reconnecting");
  state = mediaPlaybackReducer(state, { type: "reconnected" });
  assert.equal(state.status, "playing");
});
