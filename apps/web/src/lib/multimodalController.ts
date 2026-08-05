export const DEFAULT_MULTIMODAL_OPERATION_MEMORY_LIMIT = 256;

export type PresentationKind = "map" | "list" | "card" | "qr-code";
export type MultimodalSlotStatus = "empty" | "ready" | "visible" | "hidden" | "degraded";

export type MultimodalContentReference = {
  contentKey: string;
  contentRevision: number;
  presentationKind: PresentationKind;
};

export type MultimodalSlotState = {
  slotKey: string;
  status: MultimodalSlotStatus;
  content?: MultimodalContentReference;
  degradedReason?: "invalid-content" | "presentation-failure";
};

export type MultimodalControllerState = {
  slots: Readonly<Record<string, MultimodalSlotState>>;
  operationMemoryLimit: number;
  handledOperationKeys: readonly string[];
  latestObservedAtMs?: number;
};

export type MultimodalControllerEvent =
  | { type: "load-content"; slotKey: string; content: MultimodalContentReference; operationKey: string; observedAtMs: number }
  | { type: "show-content" | "hide-content"; slotKey: string; contentKey: string; operationKey: string; observedAtMs: number }
  | { type: "empty-content" | "clear-slot"; slotKey: string; operationKey: string; observedAtMs: number }
  | { type: "invalidate-content" | "presentation-failed"; slotKey: string; contentKey: string; operationKey: string; observedAtMs: number }
  | { type: "reset"; operationKey: string; observedAtMs: number };

export type MultimodalIgnoreReason =
  | "duplicate-operation"
  | "out-of-order"
  | "invalid-content"
  | "stale-content"
  | "content-mismatch"
  | "invalid-state";

export type MultimodalDecision =
  | { type: "content-ready" | "content-updated"; slotKey: string; content: MultimodalContentReference }
  | { type: "content-replaced"; slotKey: string; previousContentKey: string; content: MultimodalContentReference }
  | { type: "show"; slotKey: string; contentKey: string; presentationKind: PresentationKind }
  | { type: "hide"; slotKey: string; contentKey: string }
  | { type: "slot-empty"; slotKey: string; reason: "no-content" | "cleared" }
  | { type: "degraded"; slotKey: string; contentKey: string; reason: "invalid-content" | "presentation-failure" }
  | { type: "reset" }
  | { type: "ignore"; reason: MultimodalIgnoreReason };

export type MultimodalTransition = { state: MultimodalControllerState; decision: MultimodalDecision };

export function createMultimodalController(operationMemoryLimit = DEFAULT_MULTIMODAL_OPERATION_MEMORY_LIMIT): MultimodalControllerState {
  if (!Number.isInteger(operationMemoryLimit) || operationMemoryLimit <= 0) throw new RangeError("operationMemoryLimit must be a positive integer");
  return { slots: {}, operationMemoryLimit, handledOperationKeys: [] };
}

function ignored(state: MultimodalControllerState, reason: MultimodalIgnoreReason): MultimodalTransition {
  return { state, decision: { type: "ignore", reason } };
}

function key(value: string, name: string): string {
  const result = value.trim();
  if (!result) throw new TypeError(`${name} must not be empty`);
  return result;
}

function updateSlot(state: MultimodalControllerState, slot: MultimodalSlotState): MultimodalControllerState {
  return { ...state, slots: { ...state.slots, [slot.slotKey]: slot } };
}

function matchContent(state: MultimodalControllerState, slotKey: string, contentKey: string): MultimodalSlotState | MultimodalTransition {
  const slot = state.slots[slotKey];
  if (!slot?.content) return ignored(state, "invalid-state");
  if (slot.content.contentKey !== contentKey) return ignored(state, "content-mismatch");
  return slot;
}

function isTransition(value: MultimodalSlotState | MultimodalTransition): value is MultimodalTransition {
  return "decision" in value;
}

export function transitionMultimodal(state: MultimodalControllerState, event: MultimodalControllerEvent): MultimodalTransition {
  if (!event.operationKey.trim()) throw new TypeError("operationKey must not be empty");
  if (!Number.isFinite(event.observedAtMs)) throw new RangeError("observedAtMs must be finite");
  if (state.handledOperationKeys.includes(event.operationKey)) return ignored(state, "duplicate-operation");
  if (state.latestObservedAtMs !== undefined && event.observedAtMs < state.latestObservedAtMs) return ignored(state, "out-of-order");
  const current = {
    ...state,
    latestObservedAtMs: event.observedAtMs,
    handledOperationKeys: [...state.handledOperationKeys, event.operationKey].slice(-state.operationMemoryLimit),
  };

  switch (event.type) {
    case "load-content": {
      const slotKey = key(event.slotKey, "slotKey");
      const contentKey = key(event.content.contentKey, "contentKey");
      if (!Number.isSafeInteger(event.content.contentRevision) || event.content.contentRevision < 0) return ignored(current, "invalid-content");
      const content = { ...event.content, contentKey };
      const existing = current.slots[slotKey];
      if (existing?.content?.contentKey === contentKey && content.contentRevision <= existing.content.contentRevision) return ignored(current, "stale-content");
      const next: MultimodalSlotState = {
        slotKey,
        status: existing?.content?.contentKey === contentKey && (existing.status === "visible" || existing.status === "hidden") ? existing.status : "ready",
        content,
      };
      const stateWithSlot = updateSlot(current, next);
      if (!existing?.content) return { state: stateWithSlot, decision: { type: "content-ready", slotKey, content } };
      if (existing.content.contentKey === contentKey) return { state: stateWithSlot, decision: { type: "content-updated", slotKey, content } };
      return { state: stateWithSlot, decision: { type: "content-replaced", slotKey, previousContentKey: existing.content.contentKey, content } };
    }
    case "show-content": {
      const slotKey = key(event.slotKey, "slotKey");
      const contentKey = key(event.contentKey, "contentKey");
      const matching = matchContent(current, slotKey, contentKey);
      if (isTransition(matching)) return matching;
      if (matching.status !== "ready" && matching.status !== "hidden") return ignored(current, "invalid-state");
      return { state: updateSlot(current, { ...matching, status: "visible" }), decision: { type: "show", slotKey, contentKey, presentationKind: matching.content!.presentationKind } };
    }
    case "hide-content": {
      const slotKey = key(event.slotKey, "slotKey");
      const contentKey = key(event.contentKey, "contentKey");
      const matching = matchContent(current, slotKey, contentKey);
      if (isTransition(matching)) return matching;
      if (matching.status !== "visible") return ignored(current, "invalid-state");
      return { state: updateSlot(current, { ...matching, status: "hidden" }), decision: { type: "hide", slotKey, contentKey } };
    }
    case "empty-content": {
      const slotKey = key(event.slotKey, "slotKey");
      return { state: updateSlot(current, { slotKey, status: "empty" }), decision: { type: "slot-empty", slotKey, reason: "no-content" } };
    }
    case "clear-slot": {
      const slotKey = key(event.slotKey, "slotKey");
      const existing = current.slots[slotKey];
      if (!existing || existing.status === "empty") return ignored(current, "invalid-state");
      return { state: updateSlot(current, { slotKey, status: "empty" }), decision: { type: "slot-empty", slotKey, reason: "cleared" } };
    }
    case "invalidate-content":
    case "presentation-failed": {
      const slotKey = key(event.slotKey, "slotKey");
      const contentKey = key(event.contentKey, "contentKey");
      const matching = matchContent(current, slotKey, contentKey);
      if (isTransition(matching)) return matching;
      const reason = event.type === "invalidate-content" ? "invalid-content" : "presentation-failure";
      return { state: updateSlot(current, { slotKey, status: "degraded", content: reason === "presentation-failure" ? matching.content : undefined, degradedReason: reason }), decision: { type: "degraded", slotKey, contentKey, reason } };
    }
    case "reset":
      return { state: { ...createMultimodalController(current.operationMemoryLimit), latestObservedAtMs: current.latestObservedAtMs, handledOperationKeys: current.handledOperationKeys }, decision: { type: "reset" } };
  }
}
