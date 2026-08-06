export type WelcomePhase =
  | "idle"
  | "eligible"
  | "scheduled"
  | "speaking"
  | "cooldown"
  | "interrupted"
  | "failed";

export type WelcomeState = {
  phase: WelcomePhase;
  sessionId: string | null;
  exhibitionId: string | null;
  lastStartedAt: number | null;
  cooldownUntil: number | null;
  cooldownMs: number;
  error: string | null;
  attempt: number;
  autoStart: boolean;
};

export type WelcomeEvent =
  | { type: "session_connected"; sessionId: string; exhibitionId?: string | null; now?: number }
  | { type: "scheduled" }
  | { type: "started"; now?: number }
  | { type: "finished" }
  | { type: "user_input" }
  | { type: "interrupted" }
  | { type: "failed"; message: string }
  | { type: "retry_requested"; now?: number }
  | { type: "cooldown_elapsed"; now?: number }
  | { type: "session_closed" }
  | { type: "reset" };

export const DEFAULT_WELCOME_COOLDOWN_MS = 60_000;

/**
 * Generic fallback copy only. Exhibition facts and official scripts must come
 * from the published exhibition configuration when that contract is available.
 */
export const DEFAULT_WELCOME_OVERVIEW = {
  title: "欢迎来到智能展厅",
  summary: "我可以为你提供展馆导航、展品介绍和会议服务。",
  speechText: "您好，欢迎来到智能展厅。您可以问我展馆导航、展品信息或会议服务。",
  suggestions: ["展馆导航", "展品问答", "会议服务"],
} as const;

export const INITIAL_WELCOME_STATE: WelcomeState = {
  phase: "idle",
  sessionId: null,
  exhibitionId: null,
  lastStartedAt: null,
  cooldownUntil: null,
  cooldownMs: DEFAULT_WELCOME_COOLDOWN_MS,
  error: null,
  attempt: 0,
  autoStart: false,
};

export function createInitialWelcomeState(
  cooldownMs = DEFAULT_WELCOME_COOLDOWN_MS,
): WelcomeState {
  return { ...INITIAL_WELCOME_STATE, cooldownMs };
}

function cooldownActive(state: WelcomeState, now: number): boolean {
  return state.cooldownUntil !== null && now < state.cooldownUntil;
}

export function canStartWelcome(state: WelcomeState, now = Date.now()): boolean {
  if (!state.sessionId) return false;
  if (state.phase === "eligible") return true;
  return state.phase === "cooldown" && !cooldownActive(state, now);
}

export function canReplayWelcome(state: WelcomeState, now = Date.now()): boolean {
  if (!state.sessionId) return false;
  if (state.phase === "eligible") return true;
  if (state.phase !== "interrupted" && state.phase !== "failed") return false;
  return !cooldownActive(state, now);
}

export function welcomeCooldownRemaining(state: WelcomeState, now = Date.now()): number {
  if (state.cooldownUntil === null) return 0;
  return Math.max(0, state.cooldownUntil - now);
}

export function welcomeStateReducer(
  state: WelcomeState,
  event: WelcomeEvent,
): WelcomeState {
  switch (event.type) {
    case "session_connected": {
      if (state.sessionId === event.sessionId && state.phase !== "idle") return state;
      const now = event.now ?? Date.now();
      const activeCooldown = cooldownActive(state, now);
      return {
        ...state,
        phase: activeCooldown ? "cooldown" : "eligible",
        sessionId: event.sessionId,
        exhibitionId: event.exhibitionId?.trim() || null,
        error: null,
        attempt: 0,
        autoStart: true,
      };
    }

    case "scheduled":
      return canStartWelcome(state)
        ? { ...state, phase: "scheduled", error: null }
        : state;

    case "started": {
      if (state.phase !== "scheduled" && !canStartWelcome(state, event.now ?? Date.now())) {
        return state;
      }
      const now = event.now ?? Date.now();
      return {
        ...state,
        phase: "speaking",
        lastStartedAt: now,
        cooldownUntil: now + state.cooldownMs,
        error: null,
        attempt: state.attempt + 1,
        autoStart: false,
      };
    }

    case "finished":
      return state.phase === "speaking" ? { ...state, phase: "cooldown", error: null } : state;

    case "user_input":
      return state.phase === "eligible" || state.phase === "scheduled" || state.phase === "speaking"
        ? { ...state, phase: "interrupted", error: null, autoStart: false }
        : state;

    case "interrupted":
      return state.phase === "scheduled" || state.phase === "speaking"
        ? { ...state, phase: "interrupted", error: null, autoStart: false }
        : state;

    case "failed":
      return state.phase === "scheduled" || state.phase === "speaking"
        ? { ...state, phase: "failed", error: event.message, autoStart: false }
        : state;

    case "retry_requested": {
      if (!canReplayWelcome(state, event.now ?? Date.now())) return state;
      return { ...state, phase: "eligible", error: null, autoStart: true };
    }

    case "cooldown_elapsed":
      return state.phase === "cooldown" && !cooldownActive(state, event.now ?? Date.now())
        ? { ...state, phase: "eligible", error: null, autoStart: false }
        : state;

    case "session_closed":
      return {
        ...state,
        phase: "idle",
        sessionId: null,
        exhibitionId: null,
        error: null,
        attempt: 0,
        autoStart: false,
      };

    case "reset":
      return createInitialWelcomeState(state.cooldownMs);

    default:
      return state;
  }
}

export const WELCOME_PHASE_LABELS: Record<WelcomePhase, string> = {
  idle: "待机",
  eligible: "等待迎宾",
  scheduled: "准备迎宾",
  speaking: "正在迎宾",
  cooldown: "可继续提问",
  interrupted: "迎宾已暂停",
  failed: "迎宾暂不可用",
};

export function welcomePhaseLabel(phase: WelcomePhase): string {
  return WELCOME_PHASE_LABELS[phase];
}
