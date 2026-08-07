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

        <label className="block text-sm font-semibold text-slate-200" htmlFor="exhibition-select">
          会展
        </label>
        <select
          id="exhibition-select"
          value={selectedExhibitionId}
          onChange={(event) => onChange(event.target.value)}
          disabled={loading}
          className="mt-3 w-full rounded-2xl border border-cyan-200/40 bg-slate-900 px-4 py-4 text-base text-white outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/15 disabled:cursor-wait disabled:opacity-60"
        >
          <option value="">{loading ? "正在读取会展..." : "请选择会展"}</option>
          {exhibitions.map((exhibition) => (
            <option key={exhibition.id} value={exhibition.id}>
              {exhibition.name}{exhibition.code ? `（${exhibition.code}）` : ""}
            </option>
          ))}
        </select>

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
