import { useEffect, useState } from "react";
import { Button, Card } from "./CrudPages";
import { adminApi, FetchAdminApiClient } from "./api";
import type { EventPoint } from "./types";

type Config = { terminalPointId?: string; keywords?: { navigation?: string[]; exhibition_content?: string[] }; [key: string]: unknown };
type Issue = { code: string; severity: string; id?: string; name?: string; message: string };
const matchingApi = new FetchAdminApiClient();

export function ExhibitionMatchingConfig({ exhibitionId, canWrite }: { exhibitionId: string; canWrite: boolean }) {
  const [config, setConfig] = useState<Config>({});
  const [points, setPoints] = useState<EventPoint[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    setReady(false);
    Promise.all([matchingApi.exhibitionMatchingConfig<Config>(exhibitionId, "GET"), adminApi.listPoints(), adminApi.listVenues()]).then(([value, allPoints, venues]) => {
      if (!active) return;
      setConfig(value); setPoints(allPoints.filter((p) => venues.some((v) => v.id === p.venueId && v.exhibitionId === exhibitionId))); setReady(true);
    }).catch((error) => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, [exhibitionId]);
  const validate = async () => {
    try {
      const result = await matchingApi.exhibitionMatchingConfig<{ valid: boolean; issues: Issue[] }>(exhibitionId, "POST", config);
      setIssues(result.issues); setMessage(result.valid ? "校验完成，请核对下方提示。" : "检测到路线配置冲突，修复前将拦截导航。");
    } catch (error) { setMessage(String(error)); }
  };
  const save = async () => {
    try { setConfig(await matchingApi.exhibitionMatchingConfig<Config>(exhibitionId, "PUT", config)); setMessage("已保存关键词与终端起点。"); }
    catch (error) { setMessage(String(error)); }
  };
  return <Card className="mt-5 p-5">
    <h2 className="text-lg font-semibold">数据库匹配与导航配置</h2>
    <p className="mt-2 text-xs text-slate-500">唯一完整命中且能回答当前问题时直接播报；其他问题由 Dify 回答。导航必须使用有效起点。关键词仅识别意图，不能替代目的地。</p>
    <label className="mt-4 block text-sm">终端所在点位
      <select disabled={!ready || !canWrite} className="ml-3 rounded border p-2" value={config.terminalPointId || ""} onChange={(e) => setConfig({ ...config, terminalPointId: e.target.value })}>
        <option value="">未配置，导航时询问起点</option>
        {points.filter((p) => !["offline", "inactive"].includes(p.status)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">{(["navigation", "exhibition_content"] as const).map((key) => <label key={key} className="text-sm">{key === "navigation" ? "导航意图关键词（每行一个）" : "展会内容意图关键词（每行一个）"}
      <textarea disabled={!ready || !canWrite} className="mt-2 block w-full rounded border p-2" value={(config.keywords?.[key] || []).join("\n")} onChange={(e) => setConfig({ ...config, keywords: { ...config.keywords, [key]: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean) } })} />
    </label>)}</div>
    <div className="mt-4 flex gap-3"><Button disabled={!ready || !canWrite} onClick={() => void save()}>保存匹配配置</Button><Button disabled={!ready} variant="secondary" onClick={() => void validate()}>检查本届数据配置</Button></div>
    {message ? <p className="mt-3 text-sm">{message}</p> : null}
    <ul className="mt-3 space-y-2 text-xs">{issues.map((item, index) => <li key={`${item.code}-${item.id}-${index}`} className={item.severity === "error" ? "text-rose-700" : "text-slate-600"}>{item.name || item.id || "关键词"}：{item.message}（{item.code}）</li>)}</ul>
  </Card>;
}
