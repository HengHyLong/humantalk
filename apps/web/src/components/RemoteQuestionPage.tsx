import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost } from "../lib/api";

type PairInfo = { exhibition_name: string; online: boolean };

export function RemoteQuestionPage({ token }: { token: string }) {
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiGet<PairInfo>(`/remote-questions/${encodeURIComponent(token)}`)
      .then((value) => { if (active) setInfo(value); })
      .catch(() => { if (active) setError("二维码已失效，请扫描数字人屏幕上的最新二维码。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      const response = await apiPost<{ status: string; position: number }>(
        `/remote-questions/${encodeURIComponent(token)}/questions`, { question: text },
      );
      setQuestion("");
      setMessage(response.position > 1
        ? `问题已发送，前面还有 ${response.position - 1} 个问题，请留意数字人屏幕。`
        : "问题已发送，数字人将在屏幕上回答。请留意现场播报。");
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : "发送失败，请稍后重试。");
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] flex-col bg-[#f4f7fb] text-slate-900">
      <header className="border-b border-slate-200 bg-white px-5 py-4 text-center text-lg font-semibold">扫码提问</header>
      <section className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 pb-6 pt-10">
        <div className="mb-6 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${info?.online ? "bg-emerald-500" : "bg-slate-300"}`} />
          <div className="min-w-0 flex-1"><strong className="block truncate">{info?.exhibition_name || "四川博览集团数字人"}</strong><span className="text-xs text-slate-500">{info?.online ? "数字人在线 · 可以提问" : loading ? "正在连接数字人…" : "当前不可提问"}</span></div>
        </div>
        <div className="rounded-3xl bg-white px-6 py-10 text-center shadow-sm">
          <div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-700 text-4xl text-white shadow-lg shadow-blue-200">?</div>
          <h1 className="text-2xl font-bold">想了解什么？</h1>
          <p className="mt-3 text-sm leading-7 text-slate-500">在下方输入问题并发送，数字人会在现场屏幕上回答和播报。</p>
        </div>
        <form onSubmit={submit} className="mt-auto pt-8">
          {message ? <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">{message}</p> : null}
          {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
          <label htmlFor="remote-question" className="mb-2 block text-sm font-semibold">输入你想问的问题</label>
          <textarea id="remote-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={3} disabled={!info?.online || sending} placeholder="例如：科技展台怎么走？" className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:opacity-60" />
          <button type="submit" disabled={!info?.online || !question.trim() || sending} className="mt-3 w-full rounded-2xl bg-cyan-600 px-5 py-3.5 text-base font-semibold text-white shadow-lg shadow-cyan-600/20 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">{sending ? "发送中…" : "发送给数字人"}</button>
        </form>
        <p className="pt-6 text-center text-xs text-slate-400">四川博览集团数字人展会服务</p>
      </section>
    </main>
  );
}
