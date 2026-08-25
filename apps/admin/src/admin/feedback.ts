export type AdminToastTone = "success" | "error" | "info";

export type AdminProgressEvent = {
  id: string;
  label: string;
  progress: number | null;
  phase: "start" | "progress" | "success" | "error";
};

export function notifyAdmin(message: string, tone: AdminToastTone = "info"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("opentalking-admin-toast", { detail: { message, tone } }));
}

export function updateAdminProgress(detail: AdminProgressEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("opentalking-admin-progress", { detail }));
}

export function beginAdminProgress(label: string): string {
  const id = `admin-progress-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  updateAdminProgress({ id, label, progress: 0, phase: "start" });
  return id;
}

export function finishAdminProgress(id: string, label: string, success: boolean): void {
  updateAdminProgress({ id, label, progress: success ? 100 : null, phase: success ? "success" : "error" });
}

export async function runAdminOperation<T>(label: string, operation: () => Promise<T>): Promise<T> {
  try {
    const result = await operation();
    notifyAdmin(`${label}成功`, "success");
    return result;
  } catch (error) {
    notifyAdmin(`${label}失败：${error instanceof Error ? error.message : "请稍后重试"}`, "error");
    throw error;
  }
}

