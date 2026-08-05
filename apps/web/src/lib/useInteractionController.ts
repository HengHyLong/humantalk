import { useCallback, useRef, useState } from "react";
import type { InteractionAdapter, InteractionAdapterOutcome, InteractionCommand, InteractionCommandType } from "./interactionAdapter";
import { createInteractionController, transitionInteraction, type InteractionControllerEvent, type InteractionControllerState } from "./interactionController";
import { buildInteractionViewModel, type InteractionPresentationState } from "./interactionViewModel";

type EventWithoutMeta =
  | { type: "start" | "pause" | "resume" | "interrupt" | "complete"; activityKey: string }
  | { type: "repeat-previous" | "reset" }
  | { type: "set-speed"; speedRatio: number }
  | { type: "set-language"; languageKey: string };

export function useInteractionController(adapter: InteractionAdapter) {
  const [controller, setController] = useState<InteractionControllerState>(() => createInteractionController());
  const [activityLabel, setActivityLabel] = useState<string | null>(null);
  const [busyCommand, setBusyCommand] = useState<InteractionCommandType | null>(null);
  const [lastOutcome, setLastOutcome] = useState<InteractionAdapterOutcome | null>(null);
  const controllerRef = useRef(controller);
  const busyRef = useRef<InteractionCommandType | null>(null);
  const sequenceRef = useRef(0);
  const activitySequenceRef = useRef(0);
  const commandTokenRef = useRef(0);

  const transition = useCallback((event: EventWithoutMeta) => transitionInteraction(controllerRef.current, {
    ...event,
    operationKey: `interaction-ui-${++sequenceRef.current}`,
    observedAtMs: Date.now(),
  } as InteractionControllerEvent), []);

  const commit = useCallback((result: ReturnType<typeof transition>) => {
    controllerRef.current = result.state;
    setController(result.state);
    return result.decision.type !== "ignore";
  }, []);

  const runCommand = useCallback(async (command: InteractionCommand, event: EventWithoutMeta) => {
    if (busyRef.current !== null) return false;
    const sourceState = controllerRef.current;
    const result = transition(event);
    if (result.decision.type === "ignore") {
      commit(result);
      return false;
    }
    const token = ++commandTokenRef.current;
    busyRef.current = command.type;
    setBusyCommand(command.type);
    let outcome: InteractionAdapterOutcome;
    try {
      outcome = await adapter.execute(command);
    } catch (error) {
      outcome = { status: "error", command: command.type, message: error instanceof Error ? error.message : "控制适配器执行失败，请重试。" };
    }
    if (token !== commandTokenRef.current) return false;
    setLastOutcome(outcome);
    busyRef.current = null;
    setBusyCommand(null);
    if (outcome.status !== "applied" && outcome.status !== "previewed") return false;
    if (controllerRef.current !== sourceState) return false;
    return commit(result);
  }, [adapter, commit, transition]);

  const startActivity = useCallback((label: string, activityKey?: string) => {
    const key = activityKey?.trim() || `local-activity-${++activitySequenceRef.current}`;
    const result = transition({ type: "start", activityKey: key });
    if (commit(result)) {
      setActivityLabel(label);
      setLastOutcome(null);
    }
  }, [commit, transition]);

  const completeActivity = useCallback(() => {
    if (busyRef.current !== null) return;
    const activityKey = controllerRef.current.activeActivityKey;
    if (!activityKey || controllerRef.current.status !== "active") return;
    commit(transition({ type: "complete", activityKey }));
  }, [commit, transition]);

  const pause = useCallback(() => {
    const activityKey = controllerRef.current.activeActivityKey;
    return activityKey ? runCommand({ type: "pause", activityKey }, { type: "pause", activityKey }) : Promise.resolve(false);
  }, [runCommand]);
  const resume = useCallback(() => {
    const activityKey = controllerRef.current.activeActivityKey;
    return activityKey ? runCommand({ type: "resume", activityKey }, { type: "resume", activityKey }) : Promise.resolve(false);
  }, [runCommand]);
  const interrupt = useCallback(() => {
    const activityKey = controllerRef.current.activeActivityKey;
    return activityKey ? runCommand({ type: "interrupt", activityKey }, { type: "interrupt", activityKey }) : Promise.resolve(false);
  }, [runCommand]);
  const repeat = useCallback(() => runCommand({ type: "repeat", activityKey: controllerRef.current.lastRepeatableActivityKey ?? "" }, { type: "repeat-previous" }), [runCommand]);
  const setSpeed = useCallback((speedRatio: number) => runCommand({ type: "set-speed", speedRatio }, { type: "set-speed", speedRatio }), [runCommand]);
  const setLanguage = useCallback((languageKey: string) => runCommand({ type: "set-language", languageKey }, { type: "set-language", languageKey }), [runCommand]);

  const reset = useCallback(() => {
    commandTokenRef.current += 1;
    commit(transition({ type: "reset" }));
    setActivityLabel(null);
    setLastOutcome(null);
    busyRef.current = null;
    setBusyCommand(null);
  }, [commit, transition]);

  const presentation: InteractionPresentationState = { controller, activityLabel, capabilities: adapter.capabilities, adapterMode: adapter.mode, busyCommand, lastOutcome };
  return { state: presentation, view: buildInteractionViewModel(presentation), startActivity, completeActivity, pause, resume, interrupt, repeat, setSpeed, setLanguage, reset };
}
