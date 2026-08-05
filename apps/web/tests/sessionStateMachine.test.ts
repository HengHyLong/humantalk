import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  conversationPhaseLabel,
  conversationStateReducer,
  createInitialConversationState,
} from "../src/lib/sessionStateMachine";

function transition(
  state: ReturnType<typeof createInitialConversationState>,
  ...events: Parameters<typeof conversationStateReducer>[1][]
) {
  return events.reduce(conversationStateReducer, state);
}

test("conversation state machine covers a normal conversation turn", () => {
  const state = transition(
    createInitialConversationState(),
    { type: "start_requested" },
    { type: "session_created", sessionId: "sess-1" },
    { type: "transport_connected" },
    { type: "input_submitted" },
    { type: "assistant_started" },
    { type: "assistant_finished" },
  );

  assert.deepEqual(state, {
    phase: "listening",
    sessionId: "sess-1",
    reconnectAttempt: 0,
    error: null,
  });
});

test("conversation state machine keeps the session while reconnecting", () => {
  const state = transition(
    createInitialConversationState(),
    { type: "start_requested" },
    { type: "session_created", sessionId: "sess-2" },
    { type: "transport_connected" },
    { type: "transport_lost", message: "network interrupted" },
    { type: "reconnect_requested", attempt: 1 },
    { type: "reconnected" },
  );

  assert.equal(state.phase, "listening");
  assert.equal(state.sessionId, "sess-2");
  assert.equal(state.reconnectAttempt, 0);
  assert.equal(state.error, null);
});

test("invalid events do not bypass business state guards", () => {
  const idle = createInitialConversationState();
  assert.deepEqual(
    conversationStateReducer(idle, { type: "assistant_started" }),
    idle,
  );

  const connecting = conversationStateReducer(idle, { type: "start_requested" });
  assert.deepEqual(
    conversationStateReducer(connecting, { type: "assistant_finished" }),
    connecting,
  );
});

test("failure can be retried and session expiration returns to idle", () => {
  const failed = transition(
    createInitialConversationState(),
    { type: "start_requested" },
    { type: "failed", code: "WEBRTC_FAILED", message: "视频通道失败" },
  );
  assert.equal(failed.phase, "error");
  assert.equal(failed.error?.code, "WEBRTC_FAILED");

  const idle = transition(failed, { type: "start_requested" }, { type: "session_expired" });
  assert.deepEqual(idle, createInitialConversationState());
});

test("phase labels expose the seven user-facing business states", () => {
  assert.deepEqual(
    ["idle", "connecting", "listening", "thinking", "speaking", "error", "reconnecting"].map(conversationPhaseLabel),
    ["待机", "连接中", "聆听中", "思考中", "播报中", "异常", "重连中"],
  );
});
