import { useEffect, useState } from "react";

import { adminApi } from "./api";
import { Badge, Button, Card, Header } from "./CrudPages";
import type { ReportBucket, ReportOperations } from "./types";

function BucketList({ title, items }: { title: string; items: ReportBucket[] }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return <Card className="p-5"><div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">{title}</h2><span className="text-xs text-slate-400">{items.length} 个分组</span></div><div className="mt-4 space-y-3">{items.slice(0, 8).map((item) => <div key={item.key}><div className="flex justify-between gap-3 text-xs"><span className="truncate text-slate-600">{item.key}</span><span className="font-semibold text-slate-800">{item.count}</span></div><div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(4, item.count / max * 100)}%` }} /></div>{item.averageDurationMs !== undefined ? <p className="mt-1 text-[10px] text-slate-400">平均 {item.averageDurationMs} ms</p> : null}</div>)}{!items.length ? <p className="py-8 text-center text-xs text-slate-400">暂无真实事件数据</p> : null}</div></Card>;
}

export function ReportPage() {
  const [report, setReport] = useState<ReportOperations | null>(null);
  const [scene, setScene] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      setReport(await adminApi.getReport(scene ? { scene } : {}));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "报表读取失败");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [scene]);
  const hit = report?.hit;
  return <div className="p-6 xl:p-8"><Header eyebrow="数据分析 / P1" title="运营报表" description="统计真实会话事件、知识命中、线索转化和运行时资源用量。没有采集到的指标会明确显示为空。" action={<Button variant="secondary" onClick={() => void load()}>刷新</Button>} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<Card className="mb-5 p-4"><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-slate-600">场景<select value={scene} onChange={(event) => setScene(event.target.value)} className="mt-2 block rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="">全部场景</option><option value="welcome">welcome</option><option value="explain">explain</option><option value="qa">qa</option><option value="navigation">navigation</option><option value="shopping">shopping</option></select></label><Badge tone={loading ? "amber" : "green"}>{loading ? "正在读取" : `生成于 ${report?.generatedAt ?? "-"}`}</Badge></div></Card>{report ? <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Card className="p-5"><p className="text-xs text-slate-500">交互次数</p><p className="mt-2 text-3xl font-semibold text-slate-900">{report.interaction.total}</p></Card><Card className="p-5"><p className="text-xs text-slate-500">平均响应耗时</p><p className="mt-2 text-3xl font-semibold text-slate-900">{report.interaction.averageDurationMs}<span className="ml-1 text-sm font-normal">ms</span></p></Card><Card className="p-5"><p className="text-xs text-slate-500">命中率</p><p className="mt-2 text-3xl font-semibold text-slate-900">{(hit?.hitRate ?? 0) * 100}<span className="ml-1 text-sm font-normal">%</span></p></Card><Card className="p-5"><p className="text-xs text-slate-500">线索转化</p><p className="mt-2 text-3xl font-semibold text-slate-900">{report.lead.converted}<span className="ml-1 text-sm font-normal">/ {report.lead.total}</span></p></Card><Card className="p-5"><p className="text-xs text-slate-500">RAG 命中</p><p className="mt-2 text-3xl font-semibold text-slate-900">{hit?.ragHit ?? 0}</p></Card></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><BucketList title="按场景交互量" items={report.interaction.byScene} /><BucketList title="热点问题 / 展品" items={report.hotspot.items} /><BucketList title="按终端交互量" items={report.interaction.byTerminal} /><BucketList title="模型资源用量" items={report.resource.items} /></div></> : <Card className="p-12 text-center text-sm text-slate-400">正在读取报表…</Card>}</div>;
}
