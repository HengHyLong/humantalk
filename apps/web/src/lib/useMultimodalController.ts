import { useCallback, useMemo, useReducer, useRef } from "react";
import { createMultimodalController, transitionMultimodal, type MultimodalControllerEvent } from "./multimodalController";
import { buildMultimodalCompositionView, type MultimodalPresentation, type MultimodalPresentationState } from "./multimodalViewModel";

type EventWithoutMeta =
  | { type: "show-content" | "hide-content"; slotKey: string; contentKey: string }
  | { type: "empty-content" | "clear-slot"; slotKey: string }
  | { type: "invalidate-content" | "presentation-failed"; slotKey: string; contentKey: string }
  | { type: "reset" };

export type MultimodalPreviewItem = { slotKey: string; presentation: MultimodalPresentation };
export type MultimodalAction =
  | { type: "publish"; slotKey: string; presentation: MultimodalPresentation; operationKey: string; observedAtMs: number }
  | { type: "event"; event: MultimodalControllerEvent }
  | { type: "begin-load" }
  | { type: "fail"; message: string }
  | { type: "reset" };

export function createMultimodalState(): MultimodalPresentationState {
  return { controller: createMultimodalController(), presentations: {}, phase: "loading" };
}

function compact(state: MultimodalPresentationState, controller: MultimodalPresentationState["controller"], additions: readonly MultimodalPresentation[] = []) {
  const presentations = { ...state.presentations };
  for (const presentation of additions) presentations[presentation.contentKey] = presentation;
  const activeKeys = new Set(Object.values(controller.slots).map((slot) => slot.content?.contentKey).filter((value): value is string => Boolean(value)));
  return Object.fromEntries(Object.entries(presentations).filter(([contentKey]) => activeKeys.has(contentKey)));
}

export function reduceMultimodal(state: MultimodalPresentationState, action: MultimodalAction): MultimodalPresentationState {
  if (action.type === "begin-load") return { ...state, phase: "loading", errorMessage: undefined };
  if (action.type === "fail") return { ...state, phase: "error", errorMessage: action.message };
  if (action.type === "reset") return createMultimodalState();
  if (action.type === "publish") {
    const loaded = transitionMultimodal(state.controller, { type: "load-content", slotKey: action.slotKey, content: { contentKey: action.presentation.contentKey, contentRevision: action.presentation.revision, presentationKind: action.presentation.kind }, operationKey: action.operationKey, observedAtMs: action.observedAtMs });
    const loadedState = { ...state, controller: loaded.state, presentations: compact(state, loaded.state, [action.presentation]), phase: "stable" as const, errorMessage: undefined };
    const slot = loaded.state.slots[action.slotKey];
    if (loaded.decision.type === "ignore" || slot.status !== "ready") return loadedState;
    const shown = transitionMultimodal(loaded.state, { type: "show-content", slotKey: action.slotKey, contentKey: action.presentation.contentKey, operationKey: `${action.operationKey}:show`, observedAtMs: action.observedAtMs });
    return { ...loadedState, controller: shown.state, presentations: compact(loadedState, shown.state) };
  }
  const transition = transitionMultimodal(state.controller, action.event);
  return { ...state, controller: transition.state, presentations: compact(state, transition.state), phase: "stable", errorMessage: undefined };
}

export function useMultimodalController() {
  const [state, dispatch] = useReducer(reduceMultimodal, undefined, createMultimodalState);
  const sequenceRef = useRef(0);
  const metadata = useCallback(() => ({ operationKey: `multimodal-ui-${++sequenceRef.current}`, observedAtMs: Date.now() }), []);
  const publish = useCallback((slotKey: string, presentation: MultimodalPresentation) => dispatch({ type: "publish", slotKey, presentation, ...metadata() }), [metadata]);
  const publishMany = useCallback((items: readonly MultimodalPreviewItem[]) => { dispatch({ type: "begin-load" }); for (const item of items) publish(item.slotKey, item.presentation); }, [publish]);
  const send = useCallback((event: EventWithoutMeta) => dispatch({ type: "event", event: { ...event, ...metadata() } as MultimodalControllerEvent }), [metadata]);
  const show = useCallback((slotKey: string, contentKey: string) => send({ type: "show-content", slotKey, contentKey }), [send]);
  const hide = useCallback((slotKey: string, contentKey: string) => send({ type: "hide-content", slotKey, contentKey }), [send]);
  const clear = useCallback((slotKey: string) => send({ type: "clear-slot", slotKey }), [send]);
  const degrade = useCallback((slotKey: string, contentKey: string) => send({ type: "presentation-failed", slotKey, contentKey }), [send]);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const fail = useCallback((message: string) => dispatch({ type: "fail", message }), []);
  return { state, view: useMemo(() => buildMultimodalCompositionView(state), [state]), publish, publishMany, show, hide, clear, degrade, reset, fail };
}
