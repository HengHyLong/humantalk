import type { InteractionAdapterOutcome, InteractionCapabilities, InteractionCommandType } from "./interactionAdapter";
import type { InteractionControllerState } from "./interactionController";

export type InteractionPresentationState = {
  controller: InteractionControllerState;
  activityLabel: string | null;
  capabilities: InteractionCapabilities;
  adapterMode: "live" | "preview";
  busyCommand: InteractionCommandType | null;
  lastOutcome: InteractionAdapterOutcome | null;
};

export type InteractionViewModel = {
  mode: InteractionControllerState["status"];
  statusLabel: string;
  statusDescription: string;
  activityLabel: string;
  languageKey: string;
  speedRatio: number;
  busyCommand: InteractionCommandType | null;
  lastOutcome: InteractionAdapterOutcome | null;
  isDevelopmentPreview: boolean;
  canPause: boolean;
  canResume: boolean;
  canInterrupt: boolean;
  canRepeat: boolean;
  canSetSpeed: boolean;
  canSetLanguage: boolean;
  pendingProtocolActions: readonly InteractionCommandType[];
};

const STATUS_COPY: Record<InteractionControllerState["status"], { label: string; description: string }> = {
  idle: { label: "等待可控播报", description: "检测到新的播报活动后，控制按钮会按能力启用。" },
  active: { label: "播报进行中", description: "可以使用已接入的控制动作；最终结果以会话事件为准。" },
  paused: { label: "播报已暂停", description: "当前活动已保留，可以继续或直接打断。" },
  interrupted: { label: "播报已打断", description: "本轮活动已停止；协议允许时可以重复上一段。" },
  completed: { label: "播报已完成", description: "协议允许时可以重复刚刚完成的活动。" },
};

const COMMANDS: readonly InteractionCommandType[] = ["pause", "resume", "interrupt", "repeat", "set-speed", "set-language"];

export function buildInteractionViewModel(state: InteractionPresentationState): InteractionViewModel {
  const busy = state.busyCommand !== null;
  const copy = STATUS_COPY[state.controller.status];
  return {
    mode: state.controller.status,
    statusLabel: copy.label,
    statusDescription: state.adapterMode === "preview" ? "当前操作只更新前端开发预览，不会向业务服务发送控制命令。" : copy.description,
    activityLabel: state.activityLabel?.trim() || "当前数字人播报",
    languageKey: state.controller.languageKey,
    speedRatio: state.controller.speedRatio,
    busyCommand: state.busyCommand,
    lastOutcome: state.lastOutcome,
    isDevelopmentPreview: state.adapterMode === "preview",
    canPause: !busy && state.controller.status === "active" && state.capabilities.pause,
    canResume: !busy && state.controller.status === "paused" && state.capabilities.resume,
    canInterrupt: !busy && (state.controller.status === "active" || state.controller.status === "paused") && state.capabilities.interrupt,
    canRepeat: !busy && (state.controller.status === "idle" || state.controller.status === "interrupted" || state.controller.status === "completed") && Boolean(state.controller.lastRepeatableActivityKey) && state.capabilities.repeat,
    canSetSpeed: !busy && state.capabilities["set-speed"],
    canSetLanguage: !busy && state.capabilities["set-language"],
    pendingProtocolActions: COMMANDS.filter((command) => !state.capabilities[command]),
  };
}
