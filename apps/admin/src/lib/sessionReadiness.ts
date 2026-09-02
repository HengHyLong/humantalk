export type SessionRuntimeState = {
  state?: string;
  error_detail?: string;
};

type WaitForSessionReadyOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const READY_STATES = new Set(["worker_ready", "ready", "speaking"]);

export async function waitForSessionReady(
  sessionId: string,
  fetchSession: (sessionId: string) => Promise<SessionRuntimeState>,
  options: WaitForSessionReadyOptions = {},
): Promise<SessionRuntimeState> {
  const timeoutMs = options.timeoutMs ?? 3 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  }));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const session = await fetchSession(sessionId);
    const state = (session.state ?? "").trim().toLowerCase();
    if (READY_STATES.has(state)) return session;
    if (state === "error") {
      throw new Error(session.error_detail || "数字人运行时初始化失败，请查看后端日志。");
    }
    if (state === "closed" || state === "closing") {
      throw new Error("数字人会话在初始化完成前已关闭。");
    }
    await sleep(pollIntervalMs);
  }

  throw new Error("数字人运行时初始化超时，请检查模型服务和后端日志。");
}
