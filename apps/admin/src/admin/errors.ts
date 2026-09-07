export type UiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INTERNAL_ERROR"
  | "UNKNOWN_ERROR";

export type UiError = {
  code: UiErrorCode;
  message: string;
  requestId?: string;
  retryable: boolean;
};

export class AdminRequestError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(message: string, options: { status?: number; code?: string; requestId?: string } = {}) {
    super(message);
    this.name = "AdminRequestError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
  }
}

const SAFE_MESSAGES: Record<UiErrorCode, string> = {
  AUTH_REQUIRED: "登录状态已失效，请重新登录",
  FORBIDDEN: "当前账号没有权限执行此操作",
  NOT_FOUND: "数据不存在或已被删除",
  CONFLICT: "数据已发生变化，请刷新后重试",
  VALIDATION_ERROR: "请检查输入内容后重试",
  NETWORK_ERROR: "无法连接服务，请检查网络后重试",
  TIMEOUT: "服务响应超时，请稍后重试",
  INTERNAL_ERROR: "系统暂时无法完成操作，请稍后重试",
  UNKNOWN_ERROR: "操作未完成，请稍后重试",
};

const ADMIN_RESOURCE_LABELS: Record<string, string> = {
  exhibitions: "展会数据",
  venues: "场地数据",
  exhibitors: "展商数据",
  exhibits: "展品数据",
  schedules: "活动排期",
  routes: "路线数据",
  points: "点位数据",
  broadcasts: "应急播报",
  documents: "文档数据",
  users: "用户数据",
  roles: "角色数据",
  permissions: "权限数据",
  alerts: "告警数据",
  "audit-logs": "审计日志",
};

/** Build a user-facing label without exposing URL paths, ids or query values. */
export function toAdminRequestLabel(path: string, method: string): string {
  const pathname = path.split(/[?#]/, 1)[0] || "";
  if (pathname.includes("/gifs/upload")) return "GIF 文件上传";
  if (pathname.includes("/event/images/upload")) return "展会图片上传";
  if (pathname.includes("/import/preview")) return "Excel/ZIP 导入校验";

  const segments = pathname.split("/").filter(Boolean).reverse();
  const resourceLabel = segments.map((segment) => ADMIN_RESOURCE_LABELS[segment]).find(Boolean) ?? "数据";
  return method.toUpperCase() === "GET" ? `读取${resourceLabel}` : `${resourceLabel}操作`;
}

function codeFromStatus(status?: number): UiErrorCode | undefined {
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 422) return "VALIDATION_ERROR";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status && status >= 500) return "INTERNAL_ERROR";
  return undefined;
}

export function toUiError(input: unknown): UiError {
  const candidate = input as { status?: unknown; code?: unknown; requestId?: unknown; request_id?: unknown; name?: unknown } | null;
  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  const rawCode = typeof candidate?.code === "string" ? candidate.code.toUpperCase() : "";
  const code = codeFromStatus(status) ?? (rawCode === "VALIDATION_ERROR" || rawCode === "AUTH_REQUIRED" || rawCode === "FORBIDDEN" || rawCode === "NOT_FOUND" || rawCode === "CONFLICT" || rawCode === "NETWORK_ERROR" || rawCode === "TIMEOUT" || rawCode === "INTERNAL_ERROR" ? rawCode : undefined) ?? (candidate?.name === "TypeError" ? "NETWORK_ERROR" : "UNKNOWN_ERROR");
  const normalized = code as UiErrorCode;
  const requestId = typeof candidate?.requestId === "string" ? candidate.requestId : typeof candidate?.request_id === "string" ? candidate.request_id : undefined;
  return { code: normalized, message: SAFE_MESSAGES[normalized], requestId, retryable: normalized === "NETWORK_ERROR" || normalized === "TIMEOUT" || normalized === "INTERNAL_ERROR" || normalized === "UNKNOWN_ERROR" };
}

/**
 * Login is an unauthenticated surface. Never show a backend-provided message
 * here because it can contain request values, internal addresses or exception
 * details. Account lookup failures intentionally share one message to avoid
 * revealing whether a username exists.
 */
export function toLoginUiError(input: unknown): UiError {
  const error = toUiError(input);
  if (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT" || error.code === "INTERNAL_ERROR" || error.code === "UNKNOWN_ERROR") {
    return { ...error, message: "登录服务暂时不可用，请稍后重试" };
  }
  if (error.code === "VALIDATION_ERROR") {
    return { ...error, message: "登录信息格式不正确，请重新输入" };
  }
  return { ...error, message: "用户名或密码错误" };
}

export function toSafeRequestError(status: number, payload: unknown, requestId?: string): AdminRequestError {
  const body = payload as { code?: unknown; message?: unknown; detail?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : undefined;
  const message = status === 401 ? SAFE_MESSAGES.AUTH_REQUIRED : status === 403 ? SAFE_MESSAGES.FORBIDDEN : status === 404 ? SAFE_MESSAGES.NOT_FOUND : status === 409 ? SAFE_MESSAGES.CONFLICT : status === 422 ? SAFE_MESSAGES.VALIDATION_ERROR : status >= 500 ? SAFE_MESSAGES.INTERNAL_ERROR : typeof body?.message === "string" && body.message.length < 160 ? body.message : SAFE_MESSAGES.UNKNOWN_ERROR;
  return new AdminRequestError(message, { status, code, requestId });
}
