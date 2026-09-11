const STATUS_MESSAGES: Record<number, string> = {
  401: "登录状态已失效，请重新登录",
  403: "当前账号没有权限执行此操作",
  404: "请求的数据不存在或已被删除",
  409: "数据已发生变化，请刷新后重试",
};

export function toSafeApiMessage(status: number, payload: unknown): string {
  if (status >= 500) {
    const detail = payload && typeof payload === "object" ? (payload as { detail?: unknown }).detail : null;
    if (detail && typeof detail === "object") {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    return "系统暂时不可用，请稍后重试";
  }
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (!payload || typeof payload !== "object") return "请求未能完成，请稍后重试";
  const detail = (payload as { detail?: unknown; message?: unknown }).detail;
  const topLevelMessage = (payload as { message?: unknown }).message;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const message = (detail as { message?: unknown; detail?: unknown }).message
      ?? (detail as { detail?: unknown }).detail;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof topLevelMessage === "string" && topLevelMessage.trim()) return topLevelMessage.trim();
  if (status === 400 || status === 422) return "提交内容不符合要求，请检查后重试";
  return "请求未能完成，请稍后重试";
}
