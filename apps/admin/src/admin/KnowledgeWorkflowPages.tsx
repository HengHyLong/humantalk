import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "./api";
import { Badge, Button, Card, Detail, Field, Header, Modal } from "./CrudPages";
import { toUiError } from "./errors";
import { EmptyState, ErrorState, LoadingSkeleton, useToast } from "./ui";
import type { Exhibition, KnowledgeQa, MissPoolItem, PublishPackage, ScriptTemplate } from "./types";

const selectClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400";

const qaStatusLabels: Record<KnowledgeQa["status"], string> = {
  draft: "草稿",
  pending_review: "待审核",
  published: "已发布",
  archived: "已归档",
};

const packageStatusLabels: Record<PublishPackage["status"], string> = {
  draft: "草稿",
  pending_review: "待审核",
  published: "已发布",
  rolled_back: "已回滚",
};

const sceneLabels: Record<ScriptTemplate["scene"], string> = {
  welcome: "迎宾",
  explain: "讲解",
  shopping: "导购",
  emergency: "应急",
};

function preferredExhibition(items: Exhibition[]): string {
  return items.find((item) => /中国计算机大会|CNCC/i.test(`${item.name} ${item.code}`))?.id
    || items.find((item) => item.status === "operating")?.id
    || items[0]?.id
    || "";
}

function exhibitionName(items: Exhibition[], id: string): string {
  return items.find((item) => item.id === id)?.name || id;
}

function belongsToExhibition(item: { exhibitionId?: string; exhibition?: string }, id: string, exhibitions: Exhibition[]): boolean {
  if (!id) return false;
  if (item.exhibitionId) return item.exhibitionId === id;
  return Boolean(item.exhibition && item.exhibition === exhibitionName(exhibitions, id));
}

function errorMessage(error: unknown): string {
  const normalized = toUiError(error);
  return normalized.requestId ? `${normalized.message}（请求：${normalized.requestId}）` : normalized.message;
}

function ScopeSelect({ exhibitions, value, onChange }: { exhibitions: Exhibition[]; value: string; onChange: (value: string) => void }) {
  return <label className="block min-w-[260px] text-xs font-semibold text-slate-600">当前展会<select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>{exhibitions.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.code}）</option>)}</select></label>;
}

function PageError({ message }: { message: string }) {
  return message ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700" role="alert">{message}</p> : null;
}

function QaStatus({ status }: { status: KnowledgeQa["status"] }) {
  return <Badge tone={status === "published" ? "green" : status === "pending_review" ? "amber" : status === "archived" ? "slate" : "cyan"}>{qaStatusLabels[status]}</Badge>;
}

export function KnowledgeQaPage() {
  const { pushToast } = useToast();
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [scope, setScope] = useState("");
  const [items, setItems] = useState<KnowledgeQa[]>([]);
  const [editing, setEditing] = useState<KnowledgeQa | null>(null);
  const [detail, setDetail] = useState<KnowledgeQa | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [nextExhibitions, nextItems] = await Promise.all([adminApi.listExhibitions(), adminApi.listQa()]);
      setExhibitions(nextExhibitions);
      setItems(nextItems);
      setScope((current) => current || preferredExhibition(nextExhibitions));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  const scopedItems = useMemo(() => items.filter((item) => belongsToExhibition(item, scope, exhibitions)), [items, scope, exhibitions]);

  const startCreate = () => {
    if (!scope) return;
    setEditing({ id: `qa-${Date.now()}`, exhibitionId: scope, exhibition: exhibitionName(exhibitions, scope), question: "", keywords: [], answer: "", category: "大会信息", status: "draft", version: 1, creator: "", updatedAt: "", history: [] });
    setActionError("");
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.exhibitionId || !editing.question.trim() || !editing.answer.trim()) {
      setActionError("请选择所属展会，并填写问题和官方答案。");
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      const saved = await adminApi.saveQa({ ...editing, exhibition: exhibitionName(exhibitions, editing.exhibitionId), updatedAt: new Date().toISOString() });
      setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setEditing(null);
      pushToast("问答已保存；新建问答保持草稿状态。", "success");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const transition = async (item: KnowledgeQa, status: KnowledgeQa["status"]) => {
    setBusyId(item.id);
    setActionError("");
    try {
      const saved = await adminApi.transitionQa(item.id, status);
      setItems((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      pushToast(`问答状态已更新为“${qaStatusLabels[saved.status]}”。`, "success");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyId("");
    }
  };

  return <div className="p-6 xl:p-8">
    <Header eyebrow="知识中心" title="问答知识" description="维护强控官方 QA。只有当前展会的“已发布”问答会优先参与数字人回答。" action={<Button onClick={startCreate} disabled={!scope}>+ 添加问答</Button>} />
    <Card className="mb-5 p-4"><div className="flex flex-wrap items-end justify-between gap-4"><ScopeSelect exhibitions={exhibitions} value={scope} onChange={setScope} /><p className="max-w-xl text-xs leading-5 text-slate-500">流程：草稿 → 待审核 → 已发布 → 已归档。修改已审核内容会自动生成新版本并退回草稿。</p></div></Card>
    <PageError message={actionError} />
    {loading ? <Card className="p-5"><LoadingSkeleton /></Card> : loadError ? <ErrorState description={loadError} onRetry={() => void reload()} /> : <Card className="overflow-hidden">
      {scopedItems.length === 0 ? <EmptyState title="当前展会暂无问答" description="添加并发布问答后，数字人会优先使用官方答案。" action={<Button onClick={startCreate}>添加第一条问答</Button>} /> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">问题 / 官方答案</th><th className="px-5 py-3">分类 / 关键词</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">版本</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{scopedItems.map((item) => <tr key={item.id} className="align-top"><td className="max-w-xl px-5 py-4"><p className="font-semibold text-slate-800">{item.question}</p><p className="mt-2 line-clamp-3 leading-5 text-slate-500">{item.answer}</p></td><td className="px-5 py-4 text-slate-600">{item.category}<p className="mt-1 max-w-56 text-slate-400">{item.keywords.join("、") || "无关键词"}</p></td><td className="px-5 py-4"><QaStatus status={item.status} /></td><td className="px-5 py-4 text-slate-600">v{item.version}</td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button><Button variant="ghost" onClick={() => { setEditing(item); setActionError(""); }}>编辑</Button>{item.status === "draft" ? <Button variant="secondary" disabled={busyId === item.id} onClick={() => void transition(item, "pending_review")}>提交审核</Button> : null}{item.status === "pending_review" ? <><Button disabled={busyId === item.id} onClick={() => void transition(item, "published")}>审核通过</Button><Button variant="secondary" disabled={busyId === item.id} onClick={() => void transition(item, "draft")}>退回草稿</Button></> : null}{item.status === "published" ? <Button variant="danger" disabled={busyId === item.id} onClick={() => void transition(item, "archived")}>归档</Button> : null}{item.status === "archived" ? <Button variant="secondary" disabled={busyId === item.id} onClick={() => void transition(item, "draft")}>恢复草稿</Button> : null}</td></tr>)}</tbody></table></div>}
    </Card>}
    {editing ? <Modal title={editing.id.startsWith("qa-") && !items.some((item) => item.id === editing.id) ? "添加问答" : "编辑问答"} onClose={() => { setEditing(null); setActionError(""); }} onSave={() => void save()} saving={saving} error={actionError}><label className="block text-xs font-semibold text-slate-600">所属展会<select value={editing.exhibitionId || scope} onChange={(event) => setEditing({ ...editing, exhibitionId: event.target.value, exhibition: exhibitionName(exhibitions, event.target.value) })} className={selectClass}>{exhibitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="mt-4"><Field label="问题" required value={editing.question} onChange={(value) => setEditing({ ...editing, question: value })} placeholder="例如：中国计算机大会由谁主办？" /></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="分类" value={editing.category} onChange={(value) => setEditing({ ...editing, category: value })} /><Field label="关键词" value={editing.keywords.join("，")} onChange={(value) => setEditing({ ...editing, keywords: value.split(/[,，、\n]/).map((word) => word.trim()).filter(Boolean) })} placeholder="CNCC，主办单位，CCF" /></div><div className="mt-4"><Field label="官方答案" required textarea value={editing.answer} onChange={(value) => setEditing({ ...editing, answer: value })} /></div></Modal> : null}
    {detail ? <Detail title="问答详情与版本历史" onClose={() => setDetail(null)} rows={[["所属展会", detail.exhibition], ["问题", detail.question], ["官方答案", detail.answer], ["关键词", detail.keywords.join("、") || "无"], ["状态", qaStatusLabels[detail.status]], ["当前版本", `v${detail.version}`], ["创建人", detail.creator || "系统管理员"], ["审核人", detail.reviewer || "—"], ["版本历史", detail.history.length ? <div className="space-y-2">{[...detail.history].reverse().map((history, index) => <div key={`${history.version}-${history.time}-${index}`} className="rounded-lg bg-slate-50 p-2">v{history.version} · {history.reason} · {history.editor}<br /><span className="text-slate-400">{history.time}</span></div>)}</div> : "暂无"]]} /> : null}
  </div>;
}

export function OfficialScriptPage() {
  const { pushToast } = useToast();
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [scope, setScope] = useState("");
  const [items, setItems] = useState<ScriptTemplate[]>([]);
  const [editing, setEditing] = useState<ScriptTemplate | null>(null);
  const [detail, setDetail] = useState<ScriptTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [nextExhibitions, nextItems] = await Promise.all([adminApi.listExhibitions(), adminApi.listScripts()]);
      setExhibitions(nextExhibitions);
      setItems(nextItems);
      setScope((current) => current || preferredExhibition(nextExhibitions));
    } catch (error) { setLoadError(errorMessage(error)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const scopedItems = useMemo(() => items.filter((item) => belongsToExhibition(item, scope, exhibitions)), [items, scope, exhibitions]);

  const startCreate = () => {
    if (!scope) return;
    setEditing({ id: `script-${Date.now()}`, exhibitionId: scope, exhibition: exhibitionName(exhibitions, scope), name: "", scene: "welcome", content: "", status: "active", updatedAt: "" });
    setActionError("");
  };
  const save = async () => {
    if (!editing) return;
    if (!editing.exhibitionId || !editing.name.trim() || !editing.content.trim()) { setActionError("请选择所属展会，并填写话术名称和内容。"); return; }
    setSaving(true);
    setActionError("");
    try {
      const saved = await adminApi.saveScript({ ...editing, exhibition: exhibitionName(exhibitions, editing.exhibitionId), updatedAt: new Date().toISOString() });
      setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setEditing(null);
      pushToast("官方话术已保存。", "success");
    } catch (error) { setActionError(errorMessage(error)); } finally { setSaving(false); }
  };
  const toggle = async (item: ScriptTemplate) => {
    setActionError("");
    try {
      const saved = await adminApi.saveScript({ ...item, status: item.status === "active" ? "inactive" : "active" });
      setItems((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      pushToast(`话术已${saved.status === "active" ? "启用" : "停用"}。`, "success");
    } catch (error) { setActionError(errorMessage(error)); }
  };
  const remove = async (item: ScriptTemplate) => {
    if (!window.confirm(`确认删除“${item.name}”？已被欢迎配置引用的话术应先解除引用。`)) return;
    try { await adminApi.deleteScript(item.id); setItems((current) => current.filter((candidate) => candidate.id !== item.id)); pushToast("话术已删除。", "success"); } catch (error) { setActionError(errorMessage(error)); }
  };

  return <div className="p-6 xl:p-8">
    <Header eyebrow="知识中心" title="官方话术" description="按展会维护迎宾、讲解、导购和应急模板；只有启用的话术可被交互配置引用。" action={<Button onClick={startCreate} disabled={!scope}>+ 添加话术</Button>} />
    <Card className="mb-5 p-4"><div className="flex flex-wrap items-end justify-between gap-4"><ScopeSelect exhibitions={exhibitions} value={scope} onChange={setScope} /><p className="max-w-xl text-xs leading-5 text-slate-500">迎宾话术保存后，还需在“交互管理 → 语音接待”中选择该模板，才能成为数字人的启动欢迎语。</p></div></Card>
    <PageError message={actionError} />
    {loading ? <Card className="p-5"><LoadingSkeleton /></Card> : loadError ? <ErrorState description={loadError} onRetry={() => void reload()} /> : scopedItems.length === 0 ? <Card><EmptyState title="当前展会暂无官方话术" description="先创建 CNCC 的迎宾或讲解话术。" action={<Button onClick={startCreate}>添加第一条话术</Button>} /></Card> : <div className="grid gap-5 lg:grid-cols-2">{scopedItems.map((item) => <Card key={item.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{item.name}</h3><p className="mt-1 text-xs text-slate-400">{sceneLabels[item.scene]} · {item.exhibition}</p></div><Badge tone={item.status === "active" ? "green" : "slate"}>{item.status === "active" ? "启用" : "停用"}</Badge></div><p className="mt-4 min-h-24 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">{item.content}</p><div className="mt-4 flex flex-wrap justify-end gap-1"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button><Button variant="secondary" onClick={() => { setEditing(item); setActionError(""); }}>编辑</Button><Button variant="secondary" onClick={() => void toggle(item)}>{item.status === "active" ? "停用" : "启用"}</Button><Button variant="danger" onClick={() => void remove(item)}>删除</Button></div></Card>)}</div>}
    {editing ? <Modal title="官方话术表单" onClose={() => { setEditing(null); setActionError(""); }} onSave={() => void save()} saving={saving} error={actionError}><label className="block text-xs font-semibold text-slate-600">所属展会<select value={editing.exhibitionId || scope} onChange={(event) => setEditing({ ...editing, exhibitionId: event.target.value, exhibition: exhibitionName(exhibitions, event.target.value) })} className={selectClass}>{exhibitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="mt-4"><Field label="话术名称" required value={editing.name} onChange={(value) => setEditing({ ...editing, name: value })} /></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">使用场景<select value={editing.scene} onChange={(event) => setEditing({ ...editing, scene: event.target.value as ScriptTemplate["scene"] })} className={selectClass}><option value="welcome">迎宾</option><option value="explain">讲解</option><option value="shopping">导购</option><option value="emergency">应急</option></select></label><label className="text-xs font-semibold text-slate-600">状态<select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as ScriptTemplate["status"] })} className={selectClass}><option value="active">启用</option><option value="inactive">停用</option></select></label></div><div className="mt-4"><Field label="话术内容" required textarea value={editing.content} onChange={(value) => setEditing({ ...editing, content: value })} placeholder="可使用 {exhibition_name} 等由交互端支持的占位符。" /></div></Modal> : null}
    {detail ? <Detail title="官方话术详情" onClose={() => setDetail(null)} rows={[["名称", detail.name], ["所属展会", detail.exhibition], ["场景", sceneLabels[detail.scene]], ["状态", detail.status === "active" ? "启用" : "停用"], ["内容", <span className="whitespace-pre-wrap">{detail.content}</span>], ["更新时间", detail.updatedAt]]} /> : null}
  </div>;
}

export function KnowledgePublishPage() {
  const { pushToast } = useToast();
  const [tab, setTab] = useState<"packages" | "miss">("packages");
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [scope, setScope] = useState("");
  const [packages, setPackages] = useState<PublishPackage[]>([]);
  const [miss, setMiss] = useState<MissPoolItem[]>([]);
  const [packageName, setPackageName] = useState("");
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<PublishPackage | MissPoolItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [nextExhibitions, nextPackages, nextMiss] = await Promise.all([adminApi.listExhibitions(), adminApi.listPackages(), adminApi.listMissPool()]);
      setExhibitions(nextExhibitions);
      setPackages(nextPackages);
      setMiss(nextMiss);
      setScope((current) => current || preferredExhibition(nextExhibitions));
    } catch (error) { setLoadError(errorMessage(error)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const scopedPackages = useMemo(() => packages.filter((item) => belongsToExhibition(item, scope, exhibitions)), [packages, scope, exhibitions]);
  const scopedMiss = useMemo(() => miss.filter((item) => !item.exhibitionId || item.exhibitionId === scope), [miss, scope]);

  const create = async () => {
    if (!scope || !packageName.trim()) { setActionError("请选择所属展会并填写发布包名称。"); return; }
    setBusyId("create");
    setActionError("");
    try {
      const saved = await adminApi.createPackage({ name: packageName.trim(), exhibitionId: scope, exhibition: exhibitionName(exhibitions, scope), qaCount: 0, documentCount: 0 });
      setPackages((current) => [saved, ...current]);
      setPackageName("");
      setCreating(false);
      pushToast("发布包快照已创建，请提交审核。", "success");
    } catch (error) { setActionError(errorMessage(error)); } finally { setBusyId(""); }
  };
  const transition = async (item: PublishPackage, status: PublishPackage["status"]) => {
    if (status === "rolled_back" && !window.confirm(`确认回滚“${item.name}”？回滚后该版本不再作为当前发布包。`)) return;
    setBusyId(item.id);
    setActionError("");
    try {
      const saved = await adminApi.transitionPackage(item.id, status);
      setPackages((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      if (status === "published") await reload();
      pushToast(`发布包状态已更新为“${packageStatusLabels[saved.status]}”。`, "success");
    } catch (error) { setActionError(errorMessage(error)); } finally { setBusyId(""); }
  };
  const resolve = async (item: MissPoolItem, status: MissPoolItem["status"]) => {
    setBusyId(item.id);
    try {
      const saved = await adminApi.resolveMiss(item.id, status);
      setMiss((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      pushToast("未命中问题状态已更新。", "success");
    } catch (error) { setActionError(errorMessage(error)); } finally { setBusyId(""); }
  };

  return <div className="p-6 xl:p-8">
    <Header eyebrow="知识中心" title="发布审核" description="为当前展会冻结已发布 QA、文档与知识库绑定快照，并完成审核和回滚。" action={<Button onClick={() => { setCreating(true); setActionError(""); }} disabled={!scope}>+ 新建发布包</Button>} />
    <Card className="mb-5 p-4"><div className="flex flex-wrap items-end justify-between gap-4"><ScopeSelect exhibitions={exhibitions} value={scope} onChange={setScope} /><p className="max-w-xl text-xs leading-5 text-slate-500">同一展会仅保留一个当前已发布版本；发布新版本时，旧版本会自动标记为已回滚。</p></div></Card>
    <PageError message={actionError} />
    <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setTab("packages")} className={`rounded-lg px-4 py-2 text-xs font-semibold ${tab === "packages" ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500"}`}>发布包</button><button type="button" onClick={() => setTab("miss")} className={`rounded-lg px-4 py-2 text-xs font-semibold ${tab === "miss" ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500"}`}>未命中池</button></div>
    {loading ? <Card className="p-5"><LoadingSkeleton /></Card> : loadError ? <ErrorState description={loadError} onRetry={() => void reload()} /> : <Card className="overflow-hidden">{tab === "packages" ? scopedPackages.length === 0 ? <EmptyState title="当前展会暂无发布包" description="发布包会记录当时的官方 QA、文档和 Dify 知识库绑定。" action={<Button onClick={() => setCreating(true)}>创建发布包</Button>} /> : <div className="overflow-x-auto"><table className="w-full min-w-[940px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">发布包</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">快照内容</th><th className="px-5 py-3">审核</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{scopedPackages.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-slate-400">v{item.version} · {item.creator}</p></td><td className="px-5 py-4"><Badge tone={item.status === "published" ? "green" : item.status === "pending_review" ? "amber" : "slate"}>{packageStatusLabels[item.status]}</Badge></td><td className="px-5 py-4 text-slate-500">{item.qaCount} 条 QA · {item.documentCount} 份后台文档 · {item.knowledgeBaseIds?.length || 0} 个 Dify 知识库</td><td className="px-5 py-4 text-slate-500">{item.reviewer || "—"}</td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button>{item.status === "draft" ? <Button variant="secondary" disabled={busyId === item.id} onClick={() => void transition(item, "pending_review")}>提交审核</Button> : null}{item.status === "pending_review" ? <><Button disabled={busyId === item.id} onClick={() => void transition(item, "published")}>审核发布</Button><Button variant="secondary" disabled={busyId === item.id} onClick={() => void transition(item, "draft")}>退回草稿</Button></> : null}{item.status === "published" ? <Button variant="danger" disabled={busyId === item.id} onClick={() => void transition(item, "rolled_back")}>回滚</Button> : null}{item.status === "rolled_back" ? <Button variant="secondary" disabled={busyId === item.id} onClick={() => void transition(item, "draft")}>恢复草稿</Button> : null}</td></tr>)}</tbody></table></div> : scopedMiss.length === 0 ? <EmptyState title="当前展会暂无未命中问题" description="数字人未命中知识时会在此沉淀问题。" /> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">问题</th><th className="px-5 py-3">次数</th><th className="px-5 py-3">最近询问</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{scopedMiss.map((item) => <tr key={item.id}><td className="px-5 py-4 font-medium text-slate-800">{item.question}</td><td className="px-5 py-4 text-slate-500">{item.count}</td><td className="px-5 py-4 text-slate-500">{item.lastAskedAt}</td><td className="px-5 py-4"><Badge tone={item.status === "pending" ? "amber" : "green"}>{item.status}</Badge></td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button>{item.status === "pending" ? <><Button variant="secondary" disabled={busyId === item.id} onClick={() => void resolve(item, "supplemented")}>标记已补齐</Button><Button variant="ghost" disabled={busyId === item.id} onClick={() => void resolve(item, "converted_qa")}>已转 QA</Button><Button variant="ghost" disabled={busyId === item.id} onClick={() => void resolve(item, "ignored")}>忽略</Button></> : null}</td></tr>)}</tbody></table></div>}</Card>}
    {creating ? <Modal title="新建发布包" onClose={() => { setCreating(false); setActionError(""); }} onSave={() => void create()} saving={busyId === "create"} error={actionError}><p className="mb-4 rounded-xl bg-cyan-50 px-3 py-2 text-xs leading-5 text-cyan-800">所属展会：{exhibitionName(exhibitions, scope)}。保存时自动冻结当前已发布 QA、后台文档和展会绑定的 Dify 知识库。</p><Field label="发布包名称" required value={packageName} onChange={setPackageName} placeholder="例如：CNCC2026 甲方演示版" /></Modal> : null}
    {detail && "question" in detail ? <Detail title="未命中问题详情" onClose={() => setDetail(null)} rows={[["问题", detail.question], ["询问次数", detail.count], ["首次询问", detail.firstAskedAt], ["最近询问", detail.lastAskedAt], ["状态", detail.status]]} /> : detail ? <Detail title="发布包快照" onClose={() => setDetail(null)} rows={[["名称", detail.name], ["所属展会", detail.exhibition], ["状态", packageStatusLabels[detail.status]], ["版本", `v${detail.version}`], ["QA 快照", `${detail.qaCount} 条`], ["后台文档", `${detail.documentCount} 份`], ["Dify 知识库", detail.knowledgeBaseIds?.join("、") || "未绑定"], ["创建人", detail.creator], ["审核人", detail.reviewer || "—"], ["快照时间", detail.snapshotAt || detail.updatedAt]]} /> : null}
  </div>;
}
