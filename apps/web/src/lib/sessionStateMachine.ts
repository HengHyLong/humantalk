export type ConversationPhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "reconnecting";

export type ConversationError = {
  code?: string;
  message: string;
};

export type ConversationState = {
  phase: ConversationPhase;
  sessionId: string | null;
  reconnectAttempt: number;
  error: ConversationError | null;
};

export type ConversationEvent =
  | { type: "start_requested" }
  | { type: "session_created"; sessionId: string }
  | { type: "transport_connected"; sessionId?: string }
  | { type: "input_submitted" }
  | { type: "assistant_started" }
  | { type: "assistant_finished" }
  | { type: "assistant_interrupted" }
  | { type: "transport_lost"; message?: string }
  | { type: "reconnect_requested"; attempt?: number }
  | { type: "reconnected"; sessionId?: string }
  | { type: "failed"; message: string; code?: string }
  | { type: "session_expired" }
  | { type: "stopped" }
  | { type: "reset" };

export const INITIAL_CONVERSATION_STATE: ConversationState = {
  phase: "idle",
  sessionId: null,
  reconnectAttempt: 0,
  error: null,
};

export function createInitialConversationState(): ConversationState {
  return { ...INITIAL_CONVERSATION_STATE };
}

function withPhase(
  state: ConversationState,
  phase: ConversationPhase,
  patch: Partial<ConversationState> = {},
): ConversationState {
  return { ...state, ...patch, phase };
}

/**
 * Business session state is intentionally separate from WebRTC's transport
 * state. A peer connection can reconnect while the conversation remains in
 * the same session, and a speech turn can change independently of media.
 */
export function conversationStateReducer(
  state: ConversationState,
  event: ConversationEvent,
): ConversationState {
  switch (event.type) {
    case "start_requested":
      if (state.phase !== "idle" && state.phase !== "error") return state;
      return withPhase(state, "connecting", {
        sessionId: null,
        reconnectAttempt: 0,
        error: null,
      });

    case "session_created":
      if (state.phase !== "connecting") return state;
      return { ...state, sessionId: event.sessionId, error: null };

    case "transport_connected":
      if (state.phase !== "connecting" && state.phase !== "reconnecting") return state;
      return withPhase(state, "listening", {
        sessionId: event.sessionId ?? state.sessionId,
        reconnectAttempt: 0,
        error: null,
      });

    case "input_submitted":
      if (
        state.phase !== "listening"
        && state.phase !== "speaking"
        && state.phase !== "thinking"
        && !(state.phase === "error" && state.sessionId)
      ) return state;
      return withPhase(state, "thinking", { error: null });

    case "assistant_started":
      if (state.phase !== "thinking" && state.phase !== "listening") return state;
      return withPhase(state, "speaking", { error: null });

    case "assistant_finished":
      if (state.phase !== "speaking" && state.phase !== "thinking") return state;
      return withPhase(state, "listening", { error: null });

    case "assistant_interrupted":
      if (state.phase !== "speaking") return state;
      return withPhase(state, "listening", { error: null });

    case "transport_lost":
      if (state.phase === "idle" || (state.phase === "error" && !state.sessionId)) return state;
      return withPhase(state, "reconnecting", {
        error: event.message ? { message: event.message } : null,
      });

    case "reconnect_requested":
      if (state.phase !== "reconnecting") return state;
      return {
        ...state,
        reconnectAttempt: Math.max(
          1,
          event.attempt ?? state.reconnectAttempt + 1,
        ),
        error: null,
      };

    case "reconnected":
      if (state.phase !== "reconnecting") return state;
      return withPhase(state, "listening", {
        sessionId: event.sessionId ?? state.sessionId,
        reconnectAttempt: 0,
        error: null,
      });

    case "failed":
      return withPhase(state, "error", {
        error: { code: event.code, message: event.message },
      });

    case "session_expired":
    case "stopped":
    case "reset":
      return createInitialConversationState();

    default:
      return state;
  }
}

export const CONVERSATION_PHASE_LABELS: Record<ConversationPhase, string> = {
  idle: "待机",
  connecting: "连接中",
  listening: "聆听中",
  thinking: "思考中",
  speaking: "播报中",
  error: "异常",
  reconnecting: "重连中",
};

export function conversationPhaseLabel(phase: ConversationPhase): string {
  return CONVERSATION_PHASE_LABELS[phase];
}
