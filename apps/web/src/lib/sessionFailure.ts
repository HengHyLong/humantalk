/** Map session failures to safe UI messages, preserving speech-only answers. */
export function sessionFailure(data: unknown, currentTurnId: string, english = false) {
  const payload = data && typeof data === "object" ? data as { code?: unknown; turn_id?: unknown } : {};
  if (typeof payload.turn_id === "string" && payload.turn_id && currentTurnId && payload.turn_id !== currentTurnId) return null;
  const speech = payload.code === "SPEAK_FAILED";
  return {
    speech,
    message: speech
      ? english ? "Voice or avatar playback is temporarily unavailable. Please try again." : "语音或数字人播报暂不可用，请稍后重试。"
      : english ? "The conversation was interrupted. Please try again." : "对话暂时中断，请稍后重试。",
    title: speech ? english ? "Playback failed" : "播报失败" : english ? "Conversation failed" : "对话失败",
  };
}
