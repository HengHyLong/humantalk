import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AdminProgressEvent, AdminToastTone } from "./feedback";

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3" role="status" aria-label="正在加载"><span className="sr-only">正在加载</span>{Array.from({ length: rows }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}</div>;
}

export function ErrorState({ title = "数据加载失败", description = "系统暂时无法读取数据，请稍后重试。", onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/60 p-6 text-center" role="alert"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-lg font-bold text-rose-600">!</div><h3 className="mt-3 text-sm font-semibold text-slate-800">{title}</h3><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{description}</p>{onRetry ? <button type="button" onClick={onRetry} className="mt-4 rounded-xl bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-cyan-700">重新加载</button> : null}</div>;
}

export function EmptyState({ title = "暂无数据", description = "当前还没有可展示的内容。", action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="flex min-h-[220px] flex-col items-center justify-center p-6 text-center"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">∅</div><h3 className="mt-3 text-sm font-semibold text-slate-800">{title}</h3><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{description}</p>{action ? <div className="mt-4">{action}</div> : null}</div>;
}

type Toast = { id: number; tone: AdminToastTone; message: string };
type ToastContextValue = { pushToast: (message: string, tone?: Toast["tone"]) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [progresses, setProgresses] = useState<Record<string, AdminProgressEvent>>({});
  const pushToast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4500);
  }, []);
  useEffect(() => {
    const onToast = (event: Event) => { const detail = (event as CustomEvent<{ message?: string; tone?: Toast["tone"] }>).detail; if (detail?.message) pushToast(detail.message, detail.tone); };
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<AdminProgressEvent>).detail;
      if (!detail?.id) return;
      if (detail.phase === "start" || detail.phase === "progress") {
        setProgresses((current) => ({ ...current, [detail.id]: detail }));
        return;
      }
      setProgresses((current) => { const next = { ...current }; delete next[detail.id]; return next; });
    };
    window.addEventListener("opentalking-admin-toast", onToast);
    window.addEventListener("opentalking-admin-progress", onProgress);
    return () => { window.removeEventListener("opentalking-admin-toast", onToast); window.removeEventListener("opentalking-admin-progress", onProgress); };
  }, [pushToast]);
  const activeProgresses = Object.values(progresses);
  return <ToastContext.Provider value={{ pushToast }}>{children}<div className="fixed right-4 top-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`rounded-xl border px-4 py-3 text-xs font-medium shadow-lg ${toast.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : toast.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-cyan-200 bg-white text-slate-700"}`}>{toast.message}</div>)}</div><div className="fixed bottom-4 left-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">{activeProgresses.map((item) => <div key={item.id} className="rounded-xl border border-cyan-100 bg-white px-4 py-3 text-xs shadow-lg"><div className="flex items-center justify-between gap-3"><span className="truncate font-semibold text-slate-700">{item.label}</span><span className="shrink-0 text-cyan-700">{item.progress == null ? "处理中" : `${Math.round(item.progress)}%`}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress ?? undefined} aria-label={item.label}><div className={`h-full rounded-full bg-cyan-500 transition-[width] duration-200 ${item.progress == null ? "w-1/2 animate-pulse" : ""}`} style={item.progress == null ? undefined : { width: `${Math.max(2, item.progress)}%` }} /></div></div>)}</div></ToastContext.Provider>;
}

export function useToast() { const context = useContext(ToastContext); if (!context) throw new Error("useToast must be used inside ToastProvider"); return context; }

export function ConfirmDialog({ title, description, confirmLabel = "确认", onConfirm, onClose, danger = false, children, confirmDisabled = false }: { title: string; description: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void; danger?: boolean; children?: ReactNode; confirmDisabled?: boolean }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => { confirmRef.current?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title"><h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-950">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>{children ? <div className="mt-4">{children}</div> : null}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600">取消</button><button ref={confirmRef} type="button" disabled={confirmDisabled} onClick={onConfirm} className={`rounded-xl px-3.5 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-cyan-600 hover:bg-cyan-700"}`}>{confirmLabel}</button></div></div></div>;
}

export function MutationButton({ children, onClick, loading = false, disabled = false, className = "" }: { children: ReactNode; onClick: () => void | Promise<void>; loading?: boolean; disabled?: boolean; className?: string }) {
  return <button type="button" onClick={() => void onClick()} disabled={disabled || loading} aria-busy={loading} className={`inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-45 ${className}`}>{loading ? "处理中…" : children}</button>;
}

export class AdminErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: unknown) { window.dispatchEvent(new CustomEvent("opentalking-admin-client-error", { detail: error })); }
  render() { return this.state.hasError ? <div className="flex min-h-screen items-center justify-center bg-[#f3f7f9] p-6"><ErrorState title="页面暂时无法显示" description="页面发生了意外错误，已安全拦截。请重新加载或返回概览。" onRetry={() => window.location.reload()} /></div> : this.props.children; }
}
