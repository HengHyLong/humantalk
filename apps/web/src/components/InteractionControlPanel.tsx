import type { InteractionCommandType } from "../lib/interactionAdapter";
import type { InteractionViewModel } from "../lib/interactionViewModel";

type InteractionControlPanelProps = {
  view: InteractionViewModel;
  onPause: () => void;
  onResume: () => void;
  onInterrupt: () => void;
  onRepeat: () => void;
  onSetSpeed: (speedRatio: number) => void;
  onSetLanguage: (languageKey: string) => void;
  onOpenPreview?: () => void;
  onClosePreview?: () => void;
  defaultOpen?: boolean;
};

const COMMAND_LABELS: Record<InteractionCommandType, string> = {
  pause: "暂停",
  resume: "继续",
  interrupt: "打断",
  repeat: "重复",
  "set-speed": "语速",
  "set-language": "语言",
};

const SPEED_OPTIONS = [0.8, 1, 1.2] as const;
const LANGUAGE_OPTIONS = [
  { key: "zh-CN", label: "中文" },
  { key: "en-US", label: "English" },
] as const;

const STATUS_TONE: Record<InteractionViewModel["mode"], string> = {
  idle: "border-slate-200 bg-white text-slate-800",
  active: "border-emerald-200 bg-emerald-50 text-emerald-900",
  paused: "border-amber-200 bg-amber-50 text-amber-900",
  interrupted: "border-rose-200 bg-rose-50 text-rose-900",
  completed: "border-cyan-200 bg-cyan-50 text-cyan-900",
};

function pendingLabel(view: InteractionViewModel): string {
  return view.pendingProtocolActions.map((command) => COMMAND_LABELS[command]).join("、");
}

export function InteractionControlPanel({
  view,
  onPause,
  onResume,
  onInterrupt,
  onRepeat,
  onSetSpeed,
  onSetLanguage,
  onOpenPreview,
  onClosePreview,
  defaultOpen = false,
}: InteractionControlPanelProps) {
  const outcomeIsError = view.lastOutcome?.status === "error";
  return (
    <details open={defaultOpen || undefined} className={`digital-display-interaction-panel ${STATUS_TONE[view.mode]}`}>
      <summary className="digital-display-interaction-summary">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold tracking-[0.08em]">F16 交互控制</span>
            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-semibold">
              {view.isDevelopmentPreview ? "开发预览" : "真实会话"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs font-semibold">{view.statusLabel} · {view.activityLabel}</p>
        </div>
        <span className="shrink-0 text-xs font-semibold opacity-70">展开控制</span>
      </summary>

      <div className="digital-display-interaction-body">
        <p role="status" aria-live="polite" className="text-xs leading-5 opacity-80">{view.statusDescription}</p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button type="button" disabled={!view.canPause} onClick={onPause} className="digital-display-interaction-button">
            {view.busyCommand === "pause" ? "暂停中…" : "暂停"}
          </button>
          <button type="button" disabled={!view.canResume} onClick={onResume} className="digital-display-interaction-button">
            {view.busyCommand === "resume" ? "继续中…" : "继续"}
          </button>
          <button type="button" disabled={!view.canRepeat} onClick={onRepeat} className="digital-display-interaction-button">
            {view.busyCommand === "repeat" ? "重复中…" : "重复上一段"}
          </button>
          <button type="button" disabled={!view.canInterrupt} onClick={onInterrupt} className="digital-display-interaction-button is-danger">
            {view.busyCommand === "interrupt" ? "打断中…" : "立即打断"}
          </button>
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs font-semibold">语言选择{!view.canSetLanguage ? " · 待正式协议" : ""}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={view.languageKey === option.key}
                disabled={!view.canSetLanguage}
                onClick={() => onSetLanguage(option.key)}
                className={`digital-display-interaction-option ${view.languageKey === option.key ? "is-selected" : ""}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-xs font-semibold">播报语速{!view.canSetSpeed ? " · 待正式协议" : ""}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {SPEED_OPTIONS.map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={view.speedRatio === speed}
                disabled={!view.canSetSpeed}
                onClick={() => onSetSpeed(speed)}
                className={`digital-display-interaction-option ${view.speedRatio === speed ? "is-selected" : ""}`}
              >
                {speed}x
              </button>
            ))}
          </div>
        </fieldset>

        {view.lastOutcome ? (
          <p role={outcomeIsError ? "alert" : "status"} aria-live={outcomeIsError ? "assertive" : "polite"} className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${outcomeIsError ? "border-rose-300 bg-rose-100 text-rose-900" : "border-current/15 bg-white/60"}`}>
            {view.lastOutcome.message}
          </p>
        ) : null}

        {view.pendingProtocolActions.length > 0 ? (
          <p className="mt-3 text-[11px] leading-5 opacity-75">待正式协议：{pendingLabel(view)}。这些操作不会在前端伪造成功。</p>
        ) : null}

        {view.isDevelopmentPreview ? (
          <div className="mt-3 flex justify-end">
            {onClosePreview ? <button type="button" className="digital-display-interaction-link" onClick={onClosePreview}>退出开发预览</button> : null}
          </div>
        ) : onOpenPreview ? (
          <div className="mt-3 flex justify-end">
            <button type="button" className="digital-display-interaction-link" onClick={onOpenPreview}>打开 F16 开发预览</button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
