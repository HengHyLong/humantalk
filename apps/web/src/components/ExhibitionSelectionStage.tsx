import { useEffect, useRef, useState } from "react";
import type { ExhibitionSummary } from "../lib/api";

type ExhibitionSelectionStageProps = {
  exhibitions: ExhibitionSummary[];
  selectedExhibitionId: string;
  loading: boolean;
  error?: string | null;
  onChange: (id: string) => void;
  onConfirm: () => void;
};

export function ExhibitionSelectionStage({
  exhibitions,
  selectedExhibitionId,
  loading,
  error,
  onChange,
  onConfirm,
}: ExhibitionSelectionStageProps) {
  const selected = exhibitions.find((item) => item.id === selectedExhibitionId) ?? null;
  const canContinue = Boolean(selected && selected.bound_avatar_id && !loading);
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: MouseEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[radial-gradient(circle_at_top,#164e63_0%,#082f49_35%,#020617_100%)] px-5 py-8 text-white">
      <section className="w-full max-w-2xl rounded-3xl border border-cyan-300/30 bg-slate-950/75 p-6 shadow-2xl shadow-cyan-950/40 backdrop-blur-xl sm:p-10">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold tracking-[0.35em] text-cyan-300">SICHUAN EXPO · DIGITAL HUMAN</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">请选择会展</h1>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
            选择会展后，系统将读取该会展绑定的数字人形象和模型，再进入数字人加载与 WebRTC 对话页面。
          </p>
        </div>

        <label className="block text-sm font-semibold text-slate-200" id="exhibition-select-label">
          会展
        </label>
        <div ref={selectorRef} className="relative mt-3">
          <button
            id="exhibition-select"
            type="button"
            role="combobox"
            aria-labelledby="exhibition-select-label exhibition-select"
            aria-controls="exhibition-options"
            aria-expanded={open}
            aria-haspopup="listbox"
            disabled={loading}
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-[68px] w-full items-center justify-between gap-4 rounded-2xl border border-cyan-200/40 bg-slate-900 px-5 py-4 text-left text-white outline-none transition hover:border-cyan-200/70 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/15 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold sm:text-lg">
                {loading ? "正在读取会展..." : selected?.name ?? "请选择会展"}
              </span>
              {selected?.code ? (
                <span className="mt-1 block truncate text-xs text-slate-400">{selected.code}</span>
              ) : null}
            </span>
            <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-cyan-200">
              {open ? "收起" : "选择"}
            </span>
          </button>

          {open ? (
            <div
              id="exhibition-options"
              role="listbox"
              aria-labelledby="exhibition-select-label"
              className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-cyan-200/30 bg-slate-900/95 p-2 shadow-2xl shadow-slate-950/60 backdrop-blur-xl"
            >
              {exhibitions.length ? exhibitions.map((exhibition) => {
                const active = exhibition.id === selectedExhibitionId;
                return (
                  <button
                    key={exhibition.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(exhibition.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-start justify-between gap-4 rounded-xl px-4 py-3 text-left transition ${active ? "bg-cyan-300/15 text-cyan-100" : "text-slate-200 hover:bg-white/5"}`}
                  >
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold sm:text-base">{exhibition.name}</span>
                      <span className="mt-1 block break-all text-xs text-slate-400">{exhibition.code || exhibition.id}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${active ? "bg-cyan-300 text-slate-950" : "bg-white/5 text-slate-400"}`}>
                      {active ? "已选择" : "选择"}
                    </span>
                  </button>
                );
              }) : (
                <p className="px-4 py-5 text-center text-sm text-slate-400">暂无可用会展</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-4 min-h-12 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          {error ? (
            <span className="text-rose-300">{error}</span>
          ) : selected ? (
            selected.bound_avatar_id ? (
              <span className="text-emerald-300">已绑定数字人，确认后进入加载流程。</span>
            ) : (
              <span className="text-amber-300">该会展尚未绑定数字人，请先在 Admin 会展配置中完成绑定。</span>
            )
          ) : (
            <span>请选择一个会展后继续。</span>
          )}
        </div>

        <button
          type="button"
          onClick={onConfirm}
          disabled={!canContinue}
          className="mt-6 w-full rounded-2xl bg-cyan-300 px-5 py-4 text-base font-bold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          进入数字人体验
        </button>
      </section>
    </main>
  );
}
