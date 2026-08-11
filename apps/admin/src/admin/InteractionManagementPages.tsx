import { useEffect, useMemo, useState, type ReactNode } from "react";
import { adminApi } from "./api";
import { Badge, Button, Card, Field, Header, Modal, Pagination, usePagination } from "./CrudPages";
import type { AdminUser, Exhibition, Exhibit, ExplainFlow, ScriptTemplate, ShoppingStrategy, WelcomeConfig } from "./types";

type Props = { user: AdminUser; canWrite: boolean; initialExhibitionId?: string };
const statusLabel = (status: "active" | "inactive") => status === "active" ? "已启用" : "已停用";
const statusTone = (status: "active" | "inactive") => status === "active" ? "green" as const : "slate" as const;
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) { return <label className="block text-xs font-semibold text-slate-600">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-cyan-400">{children}</select></label>; }
function ExhibitionPicker({ exhibitions, value, onChange }: { exhibitions: Exhibition[]; value: string; onChange: (value: string) => void }) { return <Select label="所属展会" value={value} onChange={onChange}><option value="all">全部展会</option>{exhibitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>; }
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) { return <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-cyan-600" : "bg-slate-200"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${checked ? "left-6" : "left-1"}`} /></button>; }
const splitLines = (value: string) => value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);

function ExhibitMultiSelect({ exhibits, selectedIds = [], onChange }: { exhibits: Exhibit[]; selectedIds?: string[]; onChange: (ids: string[]) => void }) {
  const [keyword, setKeyword] = useState("");
  const filtered = useMemo(() => exhibits.filter((item) => !keyword || `${item.name} ${item.category} ${item.modelNo}`.toLowerCase().includes(keyword.toLowerCase())), [exhibits, keyword]);
  const pagination = usePagination(filtered);
  const toggle = (id: string, checked: boolean) => onChange(checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((item) => item !== id));
  return <div className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-600">关联展品（分页多选）</p><span className="text-xs text-cyan-700">已选 {selectedIds.length} 件</span></div><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索展品名称、分类或型号" className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-cyan-400" /><div className="mt-3 divide-y divide-slate-100">{pagination.pageItems.map((item) => <label key={item.id} className="flex items-center gap-3 py-3 text-xs"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => toggle(item.id, event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-cyan-600" /><span className="min-w-0 flex-1"><span className="font-semibold text-slate-700">{item.name}</span><span className="ml-2 text-slate-400">{item.category} · {item.modelNo || "未填型号"}</span></span><span className="text-slate-400">{item.status === "published" ? "已发布" : "草稿"}</span></label>)}{!pagination.pageItems.length ? <p className="py-5 text-center text-xs text-slate-400">当前展会暂无匹配展品</p> : null}</div><Pagination page={pagination.page} pageCount={pagination.pageCount} total={filtered.length} onChange={pagination.setPage} /></div>;
}

function validateWakeWords(config: WelcomeConfig): string | null {
  if (!config.triggers.includes("唤醒词")) return null;
  if (!config.wakeWords.length) return "启用唤醒词后至少需要配置一个唤醒词。";
  if (config.wakeWords.length > 5) return "唤醒词最多配置 5 个。";
  if (config.wakeWords.some((word) => word.length < 2 || word.length > 12)) return "每个唤醒词应为 2～12 个字符。";
  if (!Number.isInteger(config.wakeActiveSeconds) || config.wakeActiveSeconds < 10 || config.wakeActiveSeconds > 600) return "休眠时间必须为 10～600 秒的整数。";
  return null;
}

export function WelcomeConfigPage({ canWrite, initialExhibitionId }: Props) {
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [scripts, setScripts] = useState<ScriptTemplate[]>([]);
  const [items, setItems] = useState<WelcomeConfig[]>([]);
  const [exhibitionId, setExhibitionId] = useState(initialExhibitionId || "all");
  const [editing, setEditing] = useState<WelcomeConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const [events, scriptItems, configs] = await Promise.all([
      adminApi.listExhibitions(),
      adminApi.listScripts(),
      adminApi.listWelcomeConfigs(exhibitionId),
    ]);
    setExhibitions(events);
    setScripts(scriptItems);
    setItems(configs);
    setEditing(configs[0] || null);
    setError("");
  };
  useEffect(() => { void load(); }, [exhibitionId]);

  const current = editing || items[0];
  const create = () => {
    const event = exhibitions.find((item) => item.id === (exhibitionId === "all" ? exhibitions[0]?.id : exhibitionId)) || exhibitions[0];
    if (!event) return;
    setEditing({
      id: `welcome-config-${Date.now()}`,
      exhibitionId: event.id,
      exhibitionName: event.name,
      triggers: ["终端启动"],
      wakeWords: ["你好小展"],
      wakeActiveSeconds: 30,
      scriptId: scripts.find((script) => script.scene === "welcome")?.id || "",
      highlights: [],
      checkInGuide: "",
      notices: "",
      routingStrategy: "",
      status: "inactive",
      updatedAt: "",
    });
    setError("");
  };
  const save = async () => {
    if (!current) return;
    const validationError = validateWakeWords(current);
    if (validationError) { setError(validationError); return; }
    try {
      const next = await adminApi.saveWelcomeConfig(current);
      setItems((list) => [next, ...list.filter((item) => item.id !== next.id)]);
      setEditing(next);
      setError("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "欢迎配置保存失败。");
    }
  };

  return <div className="p-6 xl:p-8">
    <Header eyebrow="交互管理 / 场景策略" title="欢迎配置" description="配置终端启动、用户靠近和唤醒词触发的迎宾内容及现场分流。" action={<div className="flex gap-2"><Button variant="secondary" onClick={create} disabled={!canWrite}>+ 新建配置</Button><Button onClick={() => void save()} disabled={!canWrite || !current}>保存配置</Button></div>} />
    {saved ? <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">欢迎配置已通过 Admin API 保存到 SQLite。</p> : null}
    {error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}
    <Card className="p-4"><ExhibitionPicker exhibitions={exhibitions} value={exhibitionId} onChange={(value) => { setExhibitionId(value); setEditing(null); }} /></Card>
    {current ? <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-slate-400">当前配置 · {current.exhibitionName}</p><h2 className="mt-1 text-lg font-semibold text-slate-900">迎宾触发与内容编排</h2></div><div className="flex items-center gap-2 text-xs text-slate-500"><Toggle checked={current.status === "active"} disabled={!canWrite} onChange={(value) => setEditing({ ...current, status: value ? "active" : "inactive" })} /><span>{statusLabel(current.status)}</span></div></div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-600">迎宾触发条件</p>
          <div className="grid gap-2 sm:grid-cols-3">{["终端启动", "用户靠近", "唤醒词"].map((trigger) => <label key={trigger} className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-xs ${current.triggers.includes(trigger) ? "border-cyan-300 bg-cyan-50 text-cyan-700" : "border-slate-200 text-slate-500"}`}><input type="checkbox" checked={current.triggers.includes(trigger)} disabled={!canWrite} onChange={(event) => { const next = current.triggers.filter((item) => item !== trigger); setEditing({ ...current, triggers: event.target.checked ? [...next, trigger] : next }); setError(""); }} />{trigger}</label>)}</div>
          {current.triggers.includes("唤醒词") ? <div className="space-y-4"><div><Field label="唤醒词（逗号或换行分隔）" value={current.wakeWords.join("、")} onChange={(value) => { setEditing({ ...current, wakeWords: [...new Set(splitLines(value))] }); setError(""); }} placeholder="你好小展、小展小展" /><p className="mt-2 text-[11px] text-slate-400">最多 5 个，每个 2～12 个字符。</p></div><label className="block text-xs font-semibold text-slate-600">休眠时间（秒）<input type="number" min={10} max={600} step={1} value={current.wakeActiveSeconds} onChange={(event) => { setEditing({ ...current, wakeActiveSeconds: Number(event.target.value) }); setError(""); }} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400" /><p className="mt-2 text-[11px] font-normal text-slate-400">连续无对话达到该时长后进入休眠，范围 10～600 秒。</p></label></div> : null}
          <Select label="迎宾话术模板" value={current.scriptId} onChange={(value) => setEditing({ ...current, scriptId: value })}>{scripts.filter((item) => item.scene === "welcome").map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}</Select>
          <Field label="展会亮点（逗号或换行分隔）" value={current.highlights.join("、")} onChange={(value) => setEditing({ ...current, highlights: splitLines(value) })} placeholder="智能制造展区、主论坛活动" />
        </div>
        <div className="space-y-4"><Field label="签到流程指引" value={current.checkInGuide} onChange={(value) => setEditing({ ...current, checkInGuide: value })} textarea placeholder="描述观众如何签到、领取资料或咨询服务" /><Field label="入场须知" value={current.notices} onChange={(value) => setEditing({ ...current, notices: value })} textarea /><Field label="分流策略" value={current.routingStrategy} onChange={(value) => setEditing({ ...current, routingStrategy: value })} placeholder="按时段、展馆或终端位置推荐" /></div>
      </div>
    </Card> : <Card className="mt-4 p-12 text-center text-sm text-slate-400">当前展会暂无欢迎配置，请新建配置。</Card>}
  </div>;
}

function ExplainForm({ item, scripts, onChange }: { item: ExplainFlow; scripts: ScriptTemplate[]; onChange: (item: ExplainFlow) => void }) { const [exhibitions, setExhibitions] = useState<Exhibition[]>([]); useEffect(() => { void adminApi.listExhibitions().then(setExhibitions); }, []); return <div className="space-y-4"><ExhibitionPicker exhibitions={exhibitions} value={item.exhibitionId} onChange={(value) => { const event = exhibitions.find((candidate) => candidate.id === value); onChange({ ...item, exhibitionId: value, exhibitionName: event?.name || item.exhibitionName }); }} /><Field label="流程名称" value={item.name} onChange={(value) => onChange({ ...item, name: value })} /><Field label="意图关键词（逗号分隔）" value={item.keywords.join("、")} onChange={(value) => onChange({ ...item, keywords: splitLines(value) })} placeholder="机器人、智能制造、产线" /><Field label="关联知识分类（逗号分隔）" value={item.knowledgeCategories.join("、")} onChange={(value) => onChange({ ...item, knowledgeCategories: splitLines(value) })} /><Select label="打断策略" value={item.interruptionPolicy} onChange={(value) => onChange({ ...item, interruptionPolicy: value as ExplainFlow["interruptionPolicy"] })}><option value="allow">允许打断</option><option value="block">禁止打断</option><option value="sensitive_filter">敏感词拦截后允许</option></Select><Select label="关联话术模板" value={item.scriptId} onChange={(value) => onChange({ ...item, scriptId: value })}>{scripts.filter((script) => script.scene === "explain").map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}</Select></div>; }

export function ExplainFlowPage({ canWrite, initialExhibitionId }: Props) {
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]); const [scripts, setScripts] = useState<ScriptTemplate[]>([]); const [items, setItems] = useState<ExplainFlow[]>([]); const [exhibitionId, setExhibitionId] = useState(initialExhibitionId || "all"); const [editing, setEditing] = useState<ExplainFlow | null>(null); const [keyword, setKeyword] = useState("");
  const load = async () => { const [events, scriptItems, flows] = await Promise.all([adminApi.listExhibitions(), adminApi.listScripts(), adminApi.listExplainFlows(exhibitionId)]); setExhibitions(events); setScripts(scriptItems); setItems(flows); }; useEffect(() => { void load(); }, [exhibitionId]); const filtered = useMemo(() => items.filter((item) => !keyword || `${item.name} ${item.keywords.join(" ")}`.toLowerCase().includes(keyword.toLowerCase())), [items, keyword]); const add = () => { const event = exhibitions.find((item) => item.id === (exhibitionId === "all" ? exhibitions[0]?.id : exhibitionId)) || exhibitions[0]; if (event) setEditing({ id: `explain-flow-${Date.now()}`, exhibitionId: event.id, exhibitionName: event.name, name: "新讲解流程", keywords: [], knowledgeCategories: ["展商", "展品"], interruptionPolicy: "sensitive_filter", scriptId: scripts.find((script) => script.scene === "explain")?.id || "", status: "inactive", updatedAt: "" }); }; const save = async () => { if (!editing) return; const next = await adminApi.saveExplainFlow(editing); setItems((list) => [next, ...list.filter((item) => item.id !== next.id)]); setEditing(null); }; const toggle = async (item: ExplainFlow) => { const next = await adminApi.saveExplainFlow({ ...item, status: item.status === "active" ? "inactive" : "active" }); setItems((list) => list.map((candidate) => candidate.id === next.id ? next : candidate)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="交互管理 / 场景策略" title="讲解流程" description="将观众意图、关键词、知识分类和打断策略组合成可复用的讲解路由。" action={<Button onClick={add} disabled={!canWrite}>+ 新增流程</Button>} /><Card className="p-4"><div className="grid gap-3 md:grid-cols-2"><ExhibitionPicker exhibitions={exhibitions} value={exhibitionId} onChange={setExhibitionId} /><Field label="搜索流程或关键词" value={keyword} onChange={setKeyword} placeholder="例如：机器人、论坛" /></div></Card><div className="mt-4 grid gap-4 lg:grid-cols-2">{filtered.map((item) => <Card key={item.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{item.name}</h2><p className="mt-1 text-xs text-slate-400">{item.exhibitionName} · 更新于 {item.updatedAt}</p></div><Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge></div><div className="mt-4 flex flex-wrap gap-2">{item.keywords.map((value) => <span key={value} className="rounded-lg bg-cyan-50 px-2.5 py-1 text-xs text-cyan-700">{value}</span>)}</div><div className="mt-4 grid gap-2 text-xs text-slate-500"><p>知识分类：{item.knowledgeCategories.join("、") || "未配置"}</p><p>打断策略：{item.interruptionPolicy === "allow" ? "允许打断" : item.interruptionPolicy === "block" ? "禁止打断" : "敏感词拦截"}</p></div><div className="mt-5 flex justify-end gap-1"><Button variant="ghost" disabled={!canWrite} onClick={() => setEditing(item)}>编辑</Button><Button variant="secondary" disabled={!canWrite} onClick={() => void toggle(item)}>{item.status === "active" ? "停用" : "启用"}</Button><Button variant="danger" disabled={!canWrite} onClick={() => { if (window.confirm(`确认删除“${item.name}”？`)) void adminApi.deleteExplainFlow(item.id).then(() => setItems((list) => list.filter((candidate) => candidate.id !== item.id))); }}>删除</Button></div></Card>)}{!filtered.length ? <Card className="p-12 text-center text-sm text-slate-400">暂无讲解流程</Card> : null}</div>{editing ? <Modal title="讲解流程配置" onClose={() => setEditing(null)} onSave={canWrite ? () => void save() : undefined}><ExplainForm item={editing} scripts={scripts} onChange={setEditing} /></Modal> : null}</div>;
}

function ShoppingForm({ item, onChange }: { item: ShoppingStrategy; onChange: (item: ShoppingStrategy) => void }) { const [exhibitions, setExhibitions] = useState<Exhibition[]>([]); const [exhibits, setExhibits] = useState<Exhibit[]>([]); useEffect(() => { void Promise.all([adminApi.listExhibitions(), adminApi.listExhibits()]).then(([events, exhibitItems]) => { setExhibitions(events); setExhibits(exhibitItems); }); }, []); return <div className="space-y-4"><ExhibitionPicker exhibitions={exhibitions} value={item.exhibitionId} onChange={(value) => { const event = exhibitions.find((candidate) => candidate.id === value); onChange({ ...item, exhibitionId: value, exhibitionName: event?.name || item.exhibitionName, exhibitIds: [] }); }} /><Field label="策略名称" value={item.name} onChange={(value) => onChange({ ...item, name: value })} /><Field label="匹配关键词（逗号或换行分隔）" value={item.tags.join("、")} onChange={(value) => onChange({ ...item, tags: splitLines(value) })} placeholder="协作机器人、智能制造、产线" /><Field label="关键词别名（逗号或换行分隔）" value={item.aliases.join("、")} onChange={(value) => onChange({ ...item, aliases: splitLines(value) })} placeholder="机器人工作站、CR-2400" /><label className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600"><input type="checkbox" checked={item.fuzzyMatch} onChange={(event) => onChange({ ...item, fuzzyMatch: event.target.checked })} />允许语音识别近似结果进行模糊匹配</label><Field label="导购介绍播报文本" value={item.spokenText} onChange={(value) => onChange({ ...item, spokenText: value })} textarea placeholder="关键词命中后原样播报，不调用大模型生成" /><Field label="登记询问话术" value={item.registrationPrompt} onChange={(value) => onChange({ ...item, registrationPrompt: value })} textarea /><Field label="未明确回答时的追问话术" value={item.confirmationRetryPrompt} onChange={(value) => onChange({ ...item, confirmationRetryPrompt: value })} /><Field label="二维码弹出后的播报话术" value={item.registrationSuccessText} onChange={(value) => onChange({ ...item, registrationSuccessText: value })} /><div className="grid gap-4 sm:grid-cols-2"><Field label="同意登记关键词" value={item.confirmKeywords.join("、")} onChange={(value) => onChange({ ...item, confirmKeywords: splitLines(value) })} placeholder="需要、好的、登记" /><Field label="拒绝登记关键词" value={item.declineKeywords.join("、")} onChange={(value) => onChange({ ...item, declineKeywords: splitLines(value) })} placeholder="不需要、不用、暂不" /></div><Field label="标签匹配权重（0-1）" value={String(item.tagWeight)} onChange={(value) => onChange({ ...item, tagWeight: Math.min(1, Math.max(0, Number(value) || 0)) })} /><Field label="对比表维度（逗号分隔）" value={item.compareDimensions.join("、")} onChange={(value) => onChange({ ...item, compareDimensions: splitLines(value) })} placeholder="适用场景、部署周期、服务能力" /><Field label="触发线索登记的意向分数（0-100）" value={String(item.intentThreshold)} onChange={(value) => onChange({ ...item, intentThreshold: Math.min(100, Math.max(0, Number(value) || 0)) })} /><Field label="关联展品分类（逗号分隔）" value={item.exhibitCategories.join("、")} onChange={(value) => onChange({ ...item, exhibitCategories: splitLines(value) })} /><ExhibitMultiSelect exhibits={exhibits.filter((exhibit) => exhibit.exhibitionId === item.exhibitionId)} selectedIds={item.exhibitIds} onChange={(exhibitIds) => onChange({ ...item, exhibitIds })} /></div>; }

export function ShoppingStrategyPage({ canWrite, initialExhibitionId }: Props) {
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]); const [exhibits, setExhibits] = useState<Exhibit[]>([]); const [items, setItems] = useState<ShoppingStrategy[]>([]); const [exhibitionId, setExhibitionId] = useState(initialExhibitionId || "all"); const [editing, setEditing] = useState<ShoppingStrategy | null>(null); const load = async () => { const [events, exhibitItems, strategies] = await Promise.all([adminApi.listExhibitions(), adminApi.listExhibits(), adminApi.listShoppingStrategies(exhibitionId)]); setExhibitions(events); setExhibits(exhibitItems); setItems(strategies); }; useEffect(() => { void load(); }, [exhibitionId]); const add = () => { const event = exhibitions.find((item) => item.id === (exhibitionId === "all" ? exhibitions[0]?.id : exhibitionId)) || exhibitions[0]; if (event) setEditing({ id: `shopping-strategy-${Date.now()}`, exhibitionId: event.id, exhibitionName: event.name, name: "新导购策略", tags: [], aliases: [], fuzzyMatch: true, spokenText: "", registrationPrompt: "需要为您弹出登记二维码吗？", confirmationRetryPrompt: "请回答需要或不需要登记。", registrationSuccessText: "好的，登记二维码已为您打开，请使用手机扫码填写信息。", confirmKeywords: ["需要", "好的", "可以", "同意", "登记", "我要登记"], declineKeywords: ["不需要", "不用", "不要", "暂不", "取消", "不登记"], tagWeight: 0.5, compareDimensions: [], intentThreshold: 70, exhibitCategories: [], exhibitIds: [], status: "inactive", updatedAt: "" }); }; const save = async () => { if (!editing) return; const next = await adminApi.saveShoppingStrategy(editing); setItems((list) => [next, ...list.filter((item) => item.id !== next.id)]); setEditing(null); }; const toggle = async (item: ShoppingStrategy) => { const next = await adminApi.saveShoppingStrategy({ ...item, status: item.status === "active" ? "inactive" : "active" }); setItems((list) => list.map((candidate) => candidate.id === next.id ? next : candidate)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="交互管理 / 场景策略" title="导购策略" description="配置推荐标签权重、对比维度和线索登记意向阈值，支撑展品导购与线索转化。" action={<Button onClick={add} disabled={!canWrite}>+ 新增策略</Button>} /><Card className="p-4"><ExhibitionPicker exhibitions={exhibitions} value={exhibitionId} onChange={setExhibitionId} /></Card><div className="mt-4 grid gap-4 lg:grid-cols-2">{items.map((item) => <Card key={item.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{item.name}</h2><p className="mt-1 text-xs text-slate-400">{item.exhibitionName} · 更新于 {item.updatedAt}</p></div><Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge></div><div className="mt-4 flex flex-wrap gap-2">{item.tags.map((tag) => <span key={tag} className="rounded-lg bg-violet-50 px-2.5 py-1 text-xs text-violet-700">{tag}</span>)}</div><div className="mt-4 grid gap-2 text-xs text-slate-500"><p>标签权重：{item.tagWeight.toFixed(2)} · 意向阈值：{item.intentThreshold} 分</p><p>对比维度：{item.compareDimensions.join("、") || "未配置"}</p><p>展品分类：{item.exhibitCategories.join("、") || "未配置"}</p><p>关联展品：{(item.exhibitIds || []).map((id) => exhibits.find((exhibit) => exhibit.id === id)?.name).filter(Boolean).join("、") || "未选择"}</p></div><div className="mt-5 flex justify-end gap-1"><Button variant="ghost" disabled={!canWrite} onClick={() => setEditing(item)}>编辑</Button><Button variant="secondary" disabled={!canWrite} onClick={() => void toggle(item)}>{item.status === "active" ? "停用" : "启用"}</Button><Button variant="danger" disabled={!canWrite} onClick={() => { if (window.confirm(`确认删除“${item.name}”？`)) void adminApi.deleteShoppingStrategy(item.id).then(() => setItems((list) => list.filter((candidate) => candidate.id !== item.id))); }}>删除</Button></div></Card>)}{!items.length ? <Card className="p-12 text-center text-sm text-slate-400">暂无导购策略</Card> : null}</div>{editing ? <Modal title="导购策略配置" onClose={() => setEditing(null)} onSave={canWrite ? () => void save() : undefined}><ShoppingForm item={editing} onChange={setEditing} /></Modal> : null}</div>;
}
