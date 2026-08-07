export const DEFAULT_INTERACTION_OPERATION_MEMORY_LIMIT = 256;

export type InteractionStatus = "idle" | "active" | "paused" | "interrupted" | "completed";

export type InteractionControllerState = {
  status: InteractionStatus;
  operationMemoryLimit: number;
  handledOperationKeys: readonly string[];
  latestObservedAtMs?: number;
  activeActivityKey?: string;
  lastRepeatableActivityKey?: string;
  languageKey: string;
  speedRatio: number;
};

export type InteractionControllerEvent =
  | { type: "start" | "pause" | "resume" | "interrupt" | "complete"; activityKey: string; operationKey: string; observedAtMs: number }
  | { type: "repeat-previous" | "reset"; operationKey: string; observedAtMs: number }
  | { type: "set-speed"; speedRatio: number; operationKey: string; observedAtMs: number }
  | { type: "set-language"; languageKey: string; operationKey: string; observedAtMs: number };

export type InteractionIgnoreReason =
  | "duplicate-operation"
  | "out-of-order"
  | "activity-mismatch"
  | "invalid-state"
  | "no-repeatable-activity"
  | "invalid-speed"
  | "empty-language";

export type InteractionDecision =
  | { type: "started" | "paused" | "resumed" | "interrupted" | "completed" | "repeat"; activityKey: string }
  | { type: "speed-updated"; speedRatio: number }
  | { type: "language-updated"; languageKey: string }
  | { type: "reset" }
  | { type: "ignore"; reason: InteractionIgnoreReason };

export type InteractionTransition = {
  state: InteractionControllerState;
  decision: InteractionDecision;
};

export function createInteractionController(
  operationMemoryLimit = DEFAULT_INTERACTION_OPERATION_MEMORY_LIMIT,
): InteractionControllerState {
  if (!Number.isInteger(operationMemoryLimit) || operationMemoryLimit <= 0) {
    throw new RangeError("operationMemoryLimit must be a positive integer");
  }
  return {
    status: "idle",
    operationMemoryLimit,
    handledOperationKeys: [],
    languageKey: "zh-CN",
    speedRatio: 1,
  };
}

function ignored(state: InteractionControllerState, reason: InteractionIgnoreReason): InteractionTransition {
  return { state, decision: { type: "ignore", reason } };
}

function remember(state: InteractionControllerState, operationKey: string): readonly string[] {
  return [...state.handledOperationKeys, operationKey].slice(-state.operationMemoryLimit);
}

function normalizeActivityKey(value: string): string {
  const result = value.trim();
  if (!result) throw new TypeError("activityKey must not be empty");
  return result;
}

function requireActivity(
  state: InteractionControllerState,
  activityKey: string,
  allowed: readonly InteractionStatus[],
): InteractionTransition | undefined {
  if (!state.activeActivityKey || !allowed.includes(state.status)) return ignored(state, "invalid-state");
  if (state.activeActivityKey !== activityKey) return ignored(state, "activity-mismatch");
  return undefined;
}

export function transitionInteraction(
  state: InteractionControllerState,
  event: InteractionControllerEvent,
): InteractionTransition {
  if (!event.operationKey.trim()) throw new TypeError("operationKey must not be empty");
  if (!Number.isFinite(event.observedAtMs)) throw new RangeError("observedAtMs must be finite");
  if (state.handledOperationKeys.includes(event.operationKey)) return ignored(state, "duplicate-operation");
  if (state.latestObservedAtMs !== undefined && event.observedAtMs < state.latestObservedAtMs) {
    return ignored(state, "out-of-order");
  }
  const current = {
    ...state,
    latestObservedAtMs: event.observedAtMs,
    handledOperationKeys: remember(state, event.operationKey),
  };

  switch (event.type) {
    case "start": {
      const activityKey = normalizeActivityKey(event.activityKey);
      if (!(current.status === "idle" || current.status === "interrupted" || current.status === "completed")) {
        return ignored(current, "invalid-state");
      }
      return { state: { ...current, status: "active", activeActivityKey: activityKey }, decision: { type: "started", activityKey } };
    }
    case "pause": {
      const activityKey = normalizeActivityKey(event.activityKey);
      const rejected = requireActivity(current, activityKey, ["active"]);
      if (rejected) return rejected;
      return { state: { ...current, status: "paused" }, decision: { type: "paused", activityKey } };
    }
    case "resume": {
      const activityKey = normalizeActivityKey(event.activityKey);
      const rejected = requireActivity(current, activityKey, ["paused"]);
      if (rejected) return rejected;
      return { state: { ...current, status: "active" }, decision: { type: "resumed", activityKey } };
    }
    case "interrupt": {
      const activityKey = normalizeActivityKey(event.activityKey);
      const rejected = requireActivity(current, activityKey, ["active", "paused"]);
      if (rejected) return rejected;
      return {
        state: { ...current, status: "interrupted", activeActivityKey: undefined, lastRepeatableActivityKey: activityKey },
        decision: { type: "interrupted", activityKey },
      };
    }
    case "complete": {
      const activityKey = normalizeActivityKey(event.activityKey);
      const rejected = requireActivity(current, activityKey, ["active"]);
      if (rejected) return rejected;
      return {
        state: { ...current, status: "completed", activeActivityKey: undefined, lastRepeatableActivityKey: activityKey },
        decision: { type: "completed", activityKey },
      };
    }
    case "repeat-previous":
      if (!(current.status === "idle" || current.status === "interrupted" || current.status === "completed")) return ignored(current, "invalid-state");
      if (!current.lastRepeatableActivityKey) return ignored(current, "no-repeatable-activity");
      return { state: { ...current, status: "active", activeActivityKey: current.lastRepeatableActivityKey }, decision: { type: "repeat", activityKey: current.lastRepeatableActivityKey } };
    case "set-speed":
      if (!Number.isFinite(event.speedRatio) || event.speedRatio <= 0) return ignored(current, "invalid-speed");
      return { state: { ...current, speedRatio: event.speedRatio }, decision: { type: "speed-updated", speedRatio: event.speedRatio } };
    case "set-language": {
      const languageKey = event.languageKey.trim();
      if (!languageKey) return ignored(current, "empty-language");
      return { state: { ...current, languageKey }, decision: { type: "language-updated", languageKey } };
    }
    case "reset":
      return {
        state: {
          ...createInteractionController(current.operationMemoryLimit),
          latestObservedAtMs: current.latestObservedAtMs,
          handledOperationKeys: current.handledOperationKeys,
        },
        decision: { type: "reset" },
      };
  }
}
