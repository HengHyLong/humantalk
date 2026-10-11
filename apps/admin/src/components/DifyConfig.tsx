import { useEffect, useState } from "react";
import { testDifyConnection, type RuntimeConfigApplyInput, type RuntimeConfigResponse } from "../lib/api";

export function DifyConfig({ config, onApply, applying }: {
  config: RuntimeConfigResponse | null;
  onApply: (input: RuntimeConfigApplyInput) => Promise<void>;
  applying?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [timeout, setTimeoutValue] = useState(60);
  const [topK, setTopK] = useState(5);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setUrl(config?.dify_chat?.base_url || "");
    setTimeoutValue(config?.dify_chat?.timeout_sec || 60);
    setTopK(config?.dify_chat?.top_k || 5);
    setKey("");
  }, [config]);
  const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-cyan-300";
  return <section className="rounded-lg border border-slate-200 bg-white p-4">
    <h2 className="text-sm font-semibold text-slate-900">Dify 数字人问答</h2>
    <p className="my-2 text-xs text-slate-500">展商、展品和路线关键词明确命中时，直接播报数据库内容；未命中、存在歧义或缺少所需内容时，由 Dify 生成回答。模型与提示词在 Dify 中管理。</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-600">应用 API 地址（以 /v1 结尾）<input className={field} value={url} onChange={e => setUrl(e.target.value)} /></label>
      <label className="text-xs text-slate-600">应用 API Key{config?.dify_chat?.api_key_set ? "（已设置，留空保留）" : "（未设置）"}<input className={field} type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} /></label>
      <label className="text-xs text-slate-600">回答超时（秒）<input className={field} type="number" min={5} max={180} value={timeout} onChange={e => setTimeoutValue(Number(e.target.value))} /></label>
      <label className="text-xs text-slate-600">最多查询结果<input className={field} type="number" min={1} max={8} value={topK} onChange={e => setTopK(Number(e.target.value))} /></label>
    </div>
    <div className="mt-3 flex gap-3">
      <button disabled={applying || testing} className="rounded bg-cyan-700 px-4 py-2 text-sm text-white disabled:opacity-50" onClick={async () => {
        try {
          await onApply({ dify_chat_base_url: url.trim(), dify_chat_timeout_sec: timeout, dify_chat_top_k: topK, ...(key.trim() ? { dify_chat_api_key: key.trim() } : {}) });
          setKey(""); setMessage("配置已保存，下一轮问答生效。");
        } catch { setMessage("保存失败，请检查登录权限和配置。"); }
      }}>保存 Dify 配置</button>
      <button disabled={testing || applying} className="rounded border border-slate-300 px-4 py-2 text-sm" onClick={async () => {
        setTesting(true);
        try { const result = await testDifyConnection(); setMessage(result.compatible ? `连接成功：${result.name}` : `输入变量或应用类型不匹配：${result.missing_variables.join("、")}`); }
        catch { setMessage("连接失败，请检查已保存的 API 地址、Key 和服务状态。"); }
        finally { setTesting(false); }
      }}>{testing ? "测试中..." : "测试已保存的连接"}</button>
    </div>
    {message && <p role="status" className="mt-3 text-sm text-slate-600">{message}</p>}
  </section>;
}
