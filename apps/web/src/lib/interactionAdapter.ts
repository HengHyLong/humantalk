export type InteractionCommandType = "pause" | "resume" | "interrupt" | "repeat" | "set-speed" | "set-language";

export type InteractionCommand =
  | { type: "pause" | "resume" | "interrupt" | "repeat"; activityKey: string }
  | { type: "set-speed"; speedRatio: number }
  | { type: "set-language"; languageKey: string };

export type InteractionCapabilities = Readonly<Record<InteractionCommandType, boolean>>;

export type InteractionAdapterOutcome =
  | { status: "applied" | "previewed" | "deferred" | "error"; command: InteractionCommandType; message: string };

export type InteractionAdapter = {
  mode: "live" | "preview";
  capabilities: InteractionCapabilities;
  execute: (command: InteractionCommand) => Promise<InteractionAdapterOutcome>;
};

const ALL_CAPABILITIES: InteractionCapabilities = {
  pause: true,
  resume: true,
  interrupt: true,
  repeat: true,
  "set-speed": true,
  "set-language": true,
};

const INTERRUPT_ONLY_CAPABILITIES: InteractionCapabilities = {
  pause: false,
  resume: false,
  interrupt: true,
  repeat: false,
  "set-speed": false,
  "set-language": false,
};

export function createInteractionPreviewAdapter(): InteractionAdapter {
  return {
    mode: "preview",
    capabilities: ALL_CAPABILITIES,
    execute: async (command) => ({
      status: "previewed",
      command: command.type,
      message: "已更新前端开发预览；没有向业务服务发送控制命令。",
    }),
  };
}

export function createLiveInteractionAdapter(options: { requestInterrupt: () => Promise<void> }): InteractionAdapter {
  return {
    mode: "live",
    capabilities: INTERRUPT_ONLY_CAPABILITIES,
    execute: async (command) => {
      if (command.type !== "interrupt") {
        return {
          status: "deferred",
          command: command.type,
          message: "正式控制协议尚未评审，当前不会伪造服务端已生效。",
        };
      }
      try {
        await options.requestInterrupt();
        return { status: "applied", command: command.type, message: "打断请求已发送，最终状态以服务端事件为准。" };
      } catch (error) {
        return {
          status: "error",
          command: command.type,
          message: error instanceof Error && error.message.trim() ? error.message : "打断请求失败，请检查当前会话后重试。",
        };
      }
    },
  };
}
