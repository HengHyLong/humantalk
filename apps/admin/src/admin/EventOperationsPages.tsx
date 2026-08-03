import { useEffect, useState, type ReactNode } from "react";
import { apiGet, type AvatarSummary, type KnowledgeBaseSummary } from "../lib/api";
import { openTalkingClient } from "./openTalkingClient";
import { adminApi } from "./api";
import { Button, Card, Detail, Field, Header, Modal, Pagination, usePagination } from "./CrudPages";
import type { EventSchedule, EventVenue, Exhibit, Exhibition, ExhibitionRoute, Exhibitor } from "./types";

type EventPageProps = { canWrite?: boolean; initialExhibitionId?: string };
type ExhibitionPageProps = EventPageProps & { onOpenDetail?: (id: string) => void };
type StatusTone = "slate" | "cyan" | "green" | "amber" | "rose";

function StatusBadge({ children, tone = "slate" }: { children: ReactNode; tone?: StatusTone }) {
  const styles: Record<StatusTone, string> = {
    slate: "bg-slate-100 text-slate-600",
    cyan: "bg-cyan-50 text-cyan-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
  };
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${styles[tone]}`}>{children}</span>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-cyan-400 sm:max-w-xs" />;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}<input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400" /></label>;
}

function DateTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const inputValue = value.replace(" ", "T").slice(0, 16);
  return <label className="block text-xs font-semibold text-slate-600">{label}<input type="datetime-local" step="60" value={inputValue} onChange={(event) => onChange(event.target.value.replace("T", " "))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400" /></label>;
}

function unitText(value: string): string {
  return value.trim() || "暂无";
}

function statusTone(status: string): StatusTone {
  if (["operating", "active", "published", "scheduled"].includes(status)) return "green";
  if (["preparing", "setup", "draft", "pending"].includes(status)) return "amber";
  if (["ended", "finished", "offline", "inactive", "cancelled", "archived"].includes(status)) return "slate";
  return "cyan";
}

function statusLabel(status: string): string {
  return {
    preparing: "筹备就绪",
    setup: "布展搭建",
    operating: "现场运营",
    teardown: "撤场收尾",
    draft: "筹备就绪",
    active: "现场运营",
    ended: "撤场收尾",
    archived: "撤场收尾",
    pending: "待审核",
    inactive: "停用",
    published: "已发布",
    offline: "已下线",
    scheduled: "已排期",
    finished: "已完成",
    cancelled: "已取消",
  }[status] ?? status;
}

function emptyExhibition(): Exhibition {
  return { id: `new-${Date.now()}`, name: "", code: "", venue: "", hostUnit: "", organizerUnit: "", coOrganizerUnits: "", startDate: "", endDate: "", status: "preparing", description: "", boundAvatarId: null, knowledgeBaseIds: [], createdAt: "", updatedAt: "" };
}

export function ExhibitionPage({ canWrite = true, onOpenDetail }: ExhibitionPageProps) {
  const [items, setItems] = useState<Exhibition[]>([]);
  const [editing, setEditing] = useState<Exhibition | null>(null);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const filtered = items.filter((item) => `${item.name} ${item.code} ${item.venue}`.toLowerCase().includes(keyword.toLowerCase()));
  const pagination = usePagination(filtered);
  const reload = () => { void adminApi.listExhibitions().then(setItems).catch(() => setError("展会数据读取失败。")); };
  useEffect(reload, []);
  const save = async () => {
    if (!editing?.name.trim() || !editing.code.trim() || !editing.venue.trim() || !editing.startDate || !editing.endDate) { setError("请完整填写展会名称、编码、场馆和起止日期。"); return; }
    if (editing.endDate < editing.startDate) { setError("结束日期不能早于开始日期。"); return; }
    const saved = await adminApi.saveExhibition({ ...editing, name: editing.name.trim(), code: editing.code.trim(), hostUnit: editing.hostUnit.trim(), organizerUnit: editing.organizerUnit.trim(), coOrganizerUnits: editing.coOrganizerUnits.trim() });
    setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    setEditing(null); setError("");
  };
  const remove = async (item: Exhibition) => { if (!window.confirm(`确认删除展会“${item.name}”？`)) return; await adminApi.deleteExhibition(item.id); setItems((current) => current.filter((candidate) => candidate.id !== item.id)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="展会运营 / 展会管理" title="展会管理" description="维护展会基本信息、展期和场馆，是其他运营数据的归属基础。" action={canWrite ? <Button onClick={() => setEditing(emptyExhibition())}>+ 新增展会</Button> : null} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><p className="text-xs text-slate-500">共 {filtered.length} 个展会</p><SearchBox value={keyword} onChange={setKeyword} placeholder="搜索展会名称、编码或场馆" /></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">展会</th><th className="px-5 py-3">展期</th><th className="px-5 py-3">场馆</th><th className="px-5 py-3">生命周期</th><th className="px-5 py-3">更新时间</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{pagination.pageItems.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-slate-400">{item.code}</p></td><td className="px-5 py-4 text-slate-500">{item.startDate} 至 {item.endDate}</td><td className="px-5 py-4 text-slate-500">{item.venue}</td><td className="px-5 py-4"><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></td><td className="px-5 py-4 text-slate-400">{item.updatedAt}</td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => onOpenDetail?.(item.id)}>详情</Button>{canWrite ? <><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => void remove(item)}>删除</Button></> : null}</td></tr>)}</tbody></table></div>{!filtered.length ? <p className="py-12 text-center text-xs text-slate-400">暂无展会数据</p> : null}</Card><Pagination page={pagination.page} pageCount={pagination.pageCount} total={filtered.length} onChange={pagination.setPage} />{editing ? <Modal title={editing.id.startsWith("new-") ? "新增展会" : "编辑展会"} onClose={() => setEditing(null)} onSave={() => void save()}><div className="grid gap-4 sm:grid-cols-2"><Field label="展会名称" value={editing.name} onChange={(value) => setEditing({ ...editing, name: value })} placeholder="例如：2026 西部博览会" /><Field label="展会编码" value={editing.code} onChange={(value) => setEditing({ ...editing, code: value.toUpperCase() })} placeholder="例如：XBH-2026" /><DateField label="开始日期" value={editing.startDate} onChange={(value) => setEditing({ ...editing, startDate: value })} /><DateField label="结束日期" value={editing.endDate} onChange={(value) => setEditing({ ...editing, endDate: value })} /><Field label="举办场馆" value={editing.venue} onChange={(value) => setEditing({ ...editing, venue: value })} /><SelectField label="生命周期" value={editing.status} onChange={(value) => setEditing({ ...editing, status: value as Exhibition["status"] })} options={[{ value: "preparing", label: "筹备就绪" }, { value: "setup", label: "布展搭建" }, { value: "operating", label: "现场运营" }, { value: "teardown", label: "撤场收尾" }]} /></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="主办单位（多个用“、”分隔）" value={editing.hostUnit} onChange={(value) => setEditing({ ...editing, hostUnit: value })} placeholder="例如：单位一、单位二" /><Field label="承办单位（多个用“、”分隔）" value={editing.organizerUnit} onChange={(value) => setEditing({ ...editing, organizerUnit: value })} placeholder="例如：单位一、单位二" /><div className="sm:col-span-2"><Field label="协办单位（多个用“、”分隔）" value={editing.coOrganizerUnits} onChange={(value) => setEditing({ ...editing, coOrganizerUnits: value })} placeholder="例如：单位一、单位二、单位三" /></div><div className="sm:col-span-2"><Field label="说明" value={editing.description} onChange={(value) => setEditing({ ...editing, description: value })} textarea /></div></div></Modal> : null}</div>;
}

function normalizeKnowledgeBases(response: { knowledge_base_summaries?: KnowledgeBaseSummary[]; knowledge_bases?: Array<string | KnowledgeBaseSummary> }): KnowledgeBaseSummary[] {
  return response.knowledge_base_summaries ?? (response.knowledge_bases ?? []).map((item) => typeof item === "string" ? { id: item, name: item, document_count: 0, ready_document_count: 0, error_document_count: 0, created_at: "", updated_at: "" } : item);
}

export function ExhibitionDetailPage({ exhibitionId, canWrite = true, onBack }: { exhibitionId: string; canWrite?: boolean; onBack: () => void }) {
  const [exhibition, setExhibition] = useState<Exhibition | null>(null);
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [avatarId, setAvatarId] = useState("");
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      adminApi.listExhibitions(),
      openTalkingClient.listAvatars(),
      apiGet<{ knowledge_base_summaries?: KnowledgeBaseSummary[]; knowledge_bases?: Array<string | KnowledgeBaseSummary> }>("/agent/knowledge-bases"),
    ]).then(([exhibitions, nextAvatars, knowledgeResponse]) => {
      if (cancelled) return;
      const current = exhibitions.find((item) => item.id === exhibitionId) ?? null;
      const nextKnowledgeBases = normalizeKnowledgeBases(knowledgeResponse);
      setExhibition(current);
      setAvatars(nextAvatars);
      setKnowledgeBases(nextKnowledgeBases);
      setAvatarId(current?.boundAvatarId ?? "");
      setKnowledgeBaseIds(current?.knowledgeBaseIds ?? []);
      if (!current) setError("未找到对应展会，请返回展会列表重新选择。 ");
    }).catch(() => {
      if (!cancelled) setError("展会详情、数字人或知识库数据读取失败，请确认后端服务已启动。 ");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [exhibitionId]);

  const saveBindings = async () => {
    if (!exhibition || !canWrite) return;
    setSaving(true);
    try {
      const saved = await adminApi.saveExhibition({ ...exhibition, boundAvatarId: avatarId || null, knowledgeBaseIds });
      setExhibition(saved);
      setError("");
    } catch {
      setError("绑定保存失败，请稍后重试。 ");
    } finally {
      setSaving(false);
    }
  };

  const selectedAvatar = avatars.find((item) => item.id === avatarId);
  return <div className="p-6 xl:p-8"><Header eyebrow="展会运营 / 展会详情" title={exhibition?.name || "展会详情"} description="在独立详情页维护展会信息，并绑定本展会使用的数字人形象和知识库。" action={<Button variant="secondary" onClick={onBack}>返回展会列表</Button>} />{loading ? <Card className="p-10 text-center text-sm text-slate-400">正在加载展会详情…</Card> : error && !exhibition ? <Card className="p-10 text-center"><p className="text-sm text-rose-600">{error}</p><Button className="mt-5" variant="secondary" onClick={onBack}>返回列表</Button></Card> : exhibition ? <><div className="grid gap-5 xl:grid-cols-[1fr_1fr]"><Card className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs text-slate-400">展会基本信息</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{exhibition.name}</h2></div><StatusBadge tone={statusTone(exhibition.status)}>{statusLabel(exhibition.status)}</StatusBadge></div><dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-400">展会编码</dt><dd className="mt-1 font-medium text-slate-700">{exhibition.code}</dd></div><div><dt className="text-xs text-slate-400">举办场馆</dt><dd className="mt-1 font-medium text-slate-700">{exhibition.venue}</dd></div><div><dt className="text-xs text-slate-400">展期</dt><dd className="mt-1 font-medium text-slate-700">{exhibition.startDate} 至 {exhibition.endDate}</dd></div><div><dt className="text-xs text-slate-400">更新时间</dt><dd className="mt-1 font-medium text-slate-700">{exhibition.updatedAt}</dd></div></dl><div className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">主办单位</p><p className="mt-1 leading-5 text-slate-700">{unitText(exhibition.hostUnit)}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">承办单位</p><p className="mt-1 leading-5 text-slate-700">{unitText(exhibition.organizerUnit)}</p></div><div className="rounded-xl bg-slate-50 p-3 sm:col-span-2"><p className="text-xs text-slate-400">协办单位</p><p className="mt-1 leading-5 text-slate-700">{unitText(exhibition.coOrganizerUnits)}</p></div></div><div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">{exhibition.description || "暂无展会说明"}</div></Card><Card className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs text-slate-400">实时交互配置</p><h2 className="mt-1 text-lg font-semibold text-slate-950">数字人和知识库绑定</h2><p className="mt-1 text-xs text-slate-500">实时测试和展会交互应使用这里绑定的默认配置。</p></div><StatusBadge tone={avatarId && knowledgeBaseIds.length ? "green" : "amber"}>{avatarId && knowledgeBaseIds.length ? "配置完整" : "待配置"}</StatusBadge></div><div className="mt-5"><SelectField label="默认数字人形象" value={avatarId} onChange={setAvatarId} options={[{ value: "", label: "不绑定数字人" }, ...avatars.map((item) => ({ value: item.id, label: `${item.name || item.id} · ${item.model_type || "数字人"}` }))]} />{selectedAvatar ? <div className="mt-3 flex items-center gap-3 rounded-xl border border-cyan-100 bg-cyan-50/60 p-3"><img src={openTalkingClient.previewUrl(selectedAvatar.id)} alt={selectedAvatar.name || selectedAvatar.id} className="h-16 w-12 rounded-lg bg-white object-contain" /><div><p className="text-sm font-semibold text-slate-800">{selectedAvatar.name || selectedAvatar.id}</p><p className="mt-1 text-xs text-slate-500">{selectedAvatar.id}</p></div></div> : null}</div><div className="mt-5"><p className="text-xs font-semibold text-slate-600">绑定知识库（可多选）</p><div className="mt-2 max-h-56 space-y-2 overflow-auto rounded-xl border border-slate-200 p-3">{knowledgeBases.length ? knowledgeBases.map((base) => <label key={base.id} className={`flex items-center gap-3 rounded-lg px-2 py-2 text-xs ${knowledgeBaseIds.includes(base.id) ? "bg-cyan-50 text-cyan-700" : "text-slate-600 hover:bg-slate-50"}`}><input type="checkbox" checked={knowledgeBaseIds.includes(base.id)} disabled={!canWrite} onChange={() => setKnowledgeBaseIds((current) => current.includes(base.id) ? current.filter((id) => id !== base.id) : [...current, base.id])} className="h-4 w-4 rounded border-slate-300 text-cyan-600" /><span className="min-w-0 flex-1"><span className="block font-semibold">{base.name}</span><span className="mt-0.5 block text-[11px] text-slate-400">{base.document_count} 份文档 · {base.ready_document_count} 已就绪</span></span></label>) : <p className="py-6 text-center text-xs text-slate-400">暂无可绑定知识库，请先到知识中心创建。</p>}</div></div>{error ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p> : null}<div className="mt-5 flex justify-end"><Button disabled={!canWrite || saving} onClick={() => void saveBindings()}>{saving ? "保存中…" : "保存绑定"}</Button></div></Card></div><div className="mt-5"><Card className="p-5"><h2 className="text-base font-semibold text-slate-900">当前绑定摘要</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">数字人</p><p className="mt-1 text-sm font-semibold text-slate-800">{selectedAvatar?.name || avatarId || "未绑定"}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">知识库</p><p className="mt-1 text-sm font-semibold text-slate-800">{knowledgeBaseIds.length ? knowledgeBaseIds.map((id) => knowledgeBases.find((item) => item.id === id)?.name || id).join("、") : "未绑定"}</p></div></div></Card></div></> : null}</div>;
}

function emptyVenue(exhibitionId: string): EventVenue {
  return { id: `new-${Date.now()}`, exhibitionId, name: "", address: "", description: "", status: "draft", createdAt: "", updatedAt: "" };
}

export function VenuePage({ canWrite = true, initialExhibitionId = "" }: EventPageProps) {
  const [items, setItems] = useState<EventVenue[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [editing, setEditing] = useState<EventVenue | null>(null);
  const [detail, setDetail] = useState<EventVenue | null>(null);
  const [keyword, setKeyword] = useState("");
  const [exhibitionFilter, setExhibitionFilter] = useState(initialExhibitionId || "all");
  const [error, setError] = useState("");
  const filtered = items.filter((item) => (exhibitionFilter === "all" || item.exhibitionId === exhibitionFilter) && `${item.name} ${item.address}`.toLowerCase().includes(keyword.toLowerCase()));
  const pagination = usePagination(filtered);
  const exhibitionName = (id: string) => exhibitions.find((item) => item.id === id)?.name ?? id;
  useEffect(() => { void Promise.all([adminApi.listVenues(), adminApi.listExhibitions()]).then(([nextItems, nextExhibitions]) => { setItems(nextItems); setExhibitions(nextExhibitions); }).catch(() => setError("场地数据读取失败。")); }, []);
  const save = async () => {
    if (!editing?.exhibitionId || !editing.name.trim() || !editing.address.trim()) { setError("请填写所属展会、场地名称和地址。 "); return; }
    const saved = await adminApi.saveVenue({ ...editing, name: editing.name.trim(), address: editing.address.trim() });
    setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setEditing(null); setError("");
  };
  const remove = async (item: EventVenue) => { const routes = await adminApi.listRoutes(); if (routes.some((route) => route.venueId === item.id)) { setError("该场地仍有关联路线，请先删除或迁移路线后再删除场地。 "); return; } if (!window.confirm(`确认删除场地“${item.name}”？`)) return; await adminApi.deleteVenue(item.id); setItems((current) => current.filter((candidate) => candidate.id !== item.id)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="展会运营 / 场地管理" title="场地管理" description="先按单次展会维护场馆、展厅和分会场，再在场地下配置地图路线。" action={canWrite ? <Button onClick={() => setEditing(emptyVenue(exhibitionFilter === "all" ? exhibitions[0]?.id ?? "" : exhibitionFilter))}>+ 新增场地</Button> : null} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<Card className="overflow-hidden"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-4"><div className="flex flex-wrap items-end gap-3"><div><p className="mb-2 text-xs font-semibold text-slate-500">当前展会</p><select value={exhibitionFilter} onChange={(event) => setExhibitionFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-cyan-400"><option value="all">全部展会</option>{exhibitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><p className="pb-2 text-xs text-slate-500">共 {filtered.length} 个场地</p></div><SearchBox value={keyword} onChange={setKeyword} placeholder="搜索场地名称或地址" /></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">场地</th><th className="px-5 py-3">所属展会</th><th className="px-5 py-3">地址</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{pagination.pageItems.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-slate-400">{item.description || "暂无说明"}</p></td><td className="px-5 py-4 text-slate-500">{exhibitionName(item.exhibitionId)}</td><td className="px-5 py-4 text-slate-500">{item.address}</td><td className="px-5 py-4"><StatusBadge tone={statusTone(item.status)}>{item.status === "active" ? "启用" : item.status === "inactive" ? "停用" : "草稿"}</StatusBadge></td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button>{canWrite ? <><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => void remove(item)}>删除</Button></> : null}</td></tr>)}</tbody></table></div>{!filtered.length ? <p className="py-12 text-center text-xs text-slate-400">暂无场地数据</p> : null}</Card><Pagination page={pagination.page} pageCount={pagination.pageCount} total={filtered.length} onChange={pagination.setPage} />{editing ? <Modal title={editing.id.startsWith("new-") ? "新增场地" : "编辑场地"} onClose={() => setEditing(null)} onSave={() => void save()}><div className="grid gap-4 sm:grid-cols-2"><SelectField label="所属展会" value={editing.exhibitionId} onChange={(value) => setEditing({ ...editing, exhibitionId: value })} options={exhibitions.map((item) => ({ value: item.id, label: item.name }))} /><Field label="场地名称" value={editing.name} onChange={(value) => setEditing({ ...editing, name: value })} placeholder="例如：1号馆主展厅" /><Field label="场地地址" value={editing.address} onChange={(value) => setEditing({ ...editing, address: value })} /><SelectField label="状态" value={editing.status} onChange={(value) => setEditing({ ...editing, status: value as EventVenue["status"] })} options={[{ value: "draft", label: "草稿" }, { value: "active", label: "启用" }, { value: "inactive", label: "停用" }]} /></div><div className="mt-4"><Field label="场地说明" value={editing.description} onChange={(value) => setEditing({ ...editing, description: value })} textarea /></div></Modal> : null}{detail ? <Detail title="场地详情" onClose={() => setDetail(null)} rows={[["场地名称", detail.name], ["所属展会", exhibitionName(detail.exhibitionId)], ["地址", detail.address], ["状态", detail.status === "active" ? "启用" : detail.status === "inactive" ? "停用" : "草稿"], ["说明", detail.description || "暂无"], ["更新时间", detail.updatedAt]]} /> : null}</div>;
}

function emptyExhibitor(exhibitionId: string): Exhibitor {
  return { id: `new-${Date.now()}`, exhibitionId, name: "", boothCode: "", category: "", contact: "", phone: "", status: "pending", description: "", createdAt: "", updatedAt: "" };
}

export function ExhibitorPage({ canWrite = true, initialExhibitionId = "" }: EventPageProps) {
  const [items, setItems] = useState<Exhibitor[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [editing, setEditing] = useState<Exhibitor | null>(null);
  const [detail, setDetail] = useState<Exhibitor | null>(null);
  const [keyword, setKeyword] = useState("");
  const [exhibitionFilter, setExhibitionFilter] = useState(initialExhibitionId || "all");
  const [error, setError] = useState("");
  const filtered = items.filter((item) => (exhibitionFilter === "all" || item.exhibitionId === exhibitionFilter) && `${item.name} ${item.boothCode} ${item.category} ${item.contact}`.toLowerCase().includes(keyword.toLowerCase()));
  const pagination = usePagination(filtered);
  const exhibitionName = (id: string) => exhibitions.find((item) => item.id === id)?.name ?? id;
  const reload = () => { void Promise.all([adminApi.listExhibitors(), adminApi.listExhibitions()]).then(([nextItems, nextExhibitions]) => { setItems(nextItems); setExhibitions(nextExhibitions); }).catch(() => setError("展商数据读取失败。")); };
  useEffect(reload, []);
  useEffect(() => { if (initialExhibitionId) setExhibitionFilter(initialExhibitionId); }, [initialExhibitionId]);
  const save = async () => {
    if (!editing?.exhibitionId || !editing.name.trim() || !editing.boothCode.trim() || !editing.contact.trim()) { setError("请填写所属展会、展商名称、展位号和联系人。"); return; }
    const saved = await adminApi.saveExhibitor({ ...editing, name: editing.name.trim(), boothCode: editing.boothCode.trim() });
    setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setEditing(null); setError("");
  };
  const remove = async (item: Exhibitor) => { if (!window.confirm(`确认删除展商“${item.name}”？`)) return; await adminApi.deleteExhibitor(item.id); setItems((current) => current.filter((candidate) => candidate.id !== item.id)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="展会运营 / 展商管理" title="展商管理" description="维护展商档案、展位号和联系人信息，为展品和导览数据提供归属。" action={canWrite ? <Button onClick={() => setEditing(emptyExhibitor(exhibitions[0]?.id ?? ""))}>+ 新增展商</Button> : null} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><p className="text-xs text-slate-500">共 {filtered.length} 家展商</p><SearchBox value={keyword} onChange={setKeyword} placeholder="搜索展商、展位或联系人" /></div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">展商</th><th className="px-5 py-3">所属展会</th><th className="px-5 py-3">展位 / 类别</th><th className="px-5 py-3">联系人</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{pagination.pageItems.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-slate-400">{item.phone}</p></td><td className="px-5 py-4 text-slate-500">{exhibitionName(item.exhibitionId)}</td><td className="px-5 py-4 text-slate-500"><p>{item.boothCode}</p><p className="mt-1 text-slate-400">{item.category}</p></td><td className="px-5 py-4 text-slate-500">{item.contact}</td><td className="px-5 py-4"><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button>{canWrite ? <><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => void remove(item)}>删除</Button></> : null}</td></tr>)}</tbody></table></div>{!filtered.length ? <p className="py-12 text-center text-xs text-slate-400">暂无展商数据</p> : null}</Card><Pagination page={pagination.page} pageCount={pagination.pageCount} total={filtered.length} onChange={pagination.setPage} />{editing ? <Modal title={editing.id.startsWith("new-") ? "新增展商" : "编辑展商"} onClose={() => setEditing(null)} onSave={() => void save()}><div className="grid gap-4 sm:grid-cols-2"><SelectField label="所属展会" value={editing.exhibitionId} onChange={(value) => setEditing({ ...editing, exhibitionId: value })} options={exhibitions.map((item) => ({ value: item.id, label: item.name }))} /><Field label="展商名称" value={editing.name} onChange={(value) => setEditing({ ...editing, name: value })} /><Field label="展位号" value={editing.boothCode} onChange={(value) => setEditing({ ...editing, boothCode: value })} placeholder="例如：A1-08" /><Field label="所属类别" value={editing.category} onChange={(value) => setEditing({ ...editing, category: value })} /><Field label="联系人" value={editing.contact} onChange={(value) => setEditing({ ...editing, contact: value })} /><Field label="联系电话" value={editing.phone} onChange={(value) => setEditing({ ...editing, phone: value })} /><SelectField label="状态" value={editing.status} onChange={(value) => setEditing({ ...editing, status: value as Exhibitor["status"] })} options={[{ value: "pending", label: "待审核" }, { value: "active", label: "启用" }, { value: "inactive", label: "停用" }]} /></div><div className="mt-4"><Field label="展商说明" value={editing.description} onChange={(value) => setEditing({ ...editing, description: value })} textarea /></div></Modal> : null}{detail ? <Detail title="展商详情" onClose={() => setDetail(null)} rows={[["展商名称", detail.name], ["所属展会", exhibitionName(detail.exhibitionId)], ["展位号", detail.boothCode], ["类别", detail.category], ["联系人", `${detail.contact} / ${detail.phone}`], ["状态", statusLabel(detail.status)], ["说明", detail.description || "暂无"], ["更新时间", detail.updatedAt]]} /> : null}</div>;
}

function emptyExhibit(exhibitionId: string, exhibitorId: string): Exhibit {
  return { id: `new-${Date.now()}`, exhibitionId, exhibitorId, name: "", category: "", modelNo: "", description: "", status: "draft", createdAt: "", updatedAt: "" };
}

export function ExhibitPage({ canWrite = true, initialExhibitionId = "" }: EventPageProps) {
  const [items, setItems] = useState<Exhibit[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [exhibitors, setExhibitors] = useState<Exhibitor[]>([]);
  const [editing, setEditing] = useState<Exhibit | null>(null);
  const [detail, setDetail] = useState<Exhibit | null>(null);
  const [keyword, setKeyword] = useState("");
  const [exhibitionFilter, setExhibitionFilter] = useState(initialExhibitionId || "all");
  const [error, setError] = useState("");
  const filtered = items.filter((item) => (exhibitionFilter === "all" || item.exhibitionId === exhibitionFilter) && `${item.name} ${item.category} ${item.modelNo}`.toLowerCase().includes(keyword.toLowerCase()));
  const pagination = usePagination(filtered);
  const exhibitionName = (id: string) => exhibitions.find((item) => item.id === id)?.name ?? id;
  const exhibitorName = (id: string) => exhibitors.find((item) => item.id === id)?.name ?? id;
  const availableExhibitors = editing ? exhibitors.filter((item) => item.exhibitionId === editing.exhibitionId) : exhibitors;
  const reload = () => { void Promise.all([adminApi.listExhibits(), adminApi.listExhibitions(), adminApi.listExhibitors()]).then(([nextItems, nextExhibitions, nextExhibitors]) => { setItems(nextItems); setExhibitions(nextExhibitions); setExhibitors(nextExhibitors); }).catch(() => setError("展品数据读取失败。")); };
  useEffect(reload, []);
  useEffect(() => { if (initialExhibitionId) setExhibitionFilter(initialExhibitionId); }, [initialExhibitionId]);
  const save = async () => {
    if (!editing?.exhibitionId || !editing.exhibitorId || !editing.name.trim() || !editing.category.trim()) { setError("请填写所属展会、展商、展品名称和类别。"); return; }
    const saved = await adminApi.saveExhibit({ ...editing, name: editing.name.trim(), category: editing.category.trim() });
    setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setEditing(null); setError("");
  };
  const remove = async (item: Exhibit) => { if (!window.confirm(`确认删除展品“${item.name}”？`)) return; await adminApi.deleteExhibit(item.id); setItems((current) => current.filter((candidate) => candidate.id !== item.id)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="展会运营 / 展品管理" title="展品管理" description="维护展品基础档案并关联展会、展商，作为数字人讲解和检索的内容入口。" action={canWrite ? <Button onClick={() => setEditing(emptyExhibit(exhibitions[0]?.id ?? "", exhibitors[0]?.id ?? ""))}>+ 新增展品</Button> : null} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><p className="text-xs text-slate-500">共 {filtered.length} 件展品</p><SearchBox value={keyword} onChange={setKeyword} placeholder="搜索展品、类别或型号" /></div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">展品</th><th className="px-5 py-3">所属展商</th><th className="px-5 py-3">展会</th><th className="px-5 py-3">类别 / 型号</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{pagination.pageItems.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-slate-400">{item.description}</p></td><td className="px-5 py-4 text-slate-500">{exhibitorName(item.exhibitorId)}</td><td className="px-5 py-4 text-slate-500">{exhibitionName(item.exhibitionId)}</td><td className="px-5 py-4 text-slate-500"><p>{item.category}</p><p className="mt-1 text-slate-400">{item.modelNo || "未填写型号"}</p></td><td className="px-5 py-4"><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button>{canWrite ? <><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => void remove(item)}>删除</Button></> : null}</td></tr>)}</tbody></table></div>{!filtered.length ? <p className="py-12 text-center text-xs text-slate-400">暂无展品数据</p> : null}</Card><Pagination page={pagination.page} pageCount={pagination.pageCount} total={filtered.length} onChange={pagination.setPage} />{editing ? <Modal title={editing.id.startsWith("new-") ? "新增展品" : "编辑展品"} onClose={() => setEditing(null)} onSave={() => void save()}><div className="grid gap-4 sm:grid-cols-2"><SelectField label="所属展会" value={editing.exhibitionId} onChange={(value) => setEditing({ ...editing, exhibitionId: value, exhibitorId: exhibitors.find((item) => item.exhibitionId === value)?.id ?? "" })} options={exhibitions.map((item) => ({ value: item.id, label: item.name }))} /><SelectField label="所属展商" value={editing.exhibitorId} onChange={(value) => setEditing({ ...editing, exhibitorId: value })} options={availableExhibitors.map((item) => ({ value: item.id, label: `${item.name} · ${item.boothCode}` }))} /><Field label="展品名称" value={editing.name} onChange={(value) => setEditing({ ...editing, name: value })} /><Field label="展品类别" value={editing.category} onChange={(value) => setEditing({ ...editing, category: value })} /><Field label="型号/编号" value={editing.modelNo} onChange={(value) => setEditing({ ...editing, modelNo: value })} /><SelectField label="状态" value={editing.status} onChange={(value) => setEditing({ ...editing, status: value as Exhibit["status"] })} options={[{ value: "draft", label: "草稿" }, { value: "published", label: "已发布" }, { value: "offline", label: "已下线" }]} /></div><div className="mt-4"><Field label="展品说明" value={editing.description} onChange={(value) => setEditing({ ...editing, description: value })} textarea /></div></Modal> : null}{detail ? <Detail title="展品详情" onClose={() => setDetail(null)} rows={[["展品名称", detail.name], ["所属展商", exhibitorName(detail.exhibitorId)], ["所属展会", exhibitionName(detail.exhibitionId)], ["类别", detail.category], ["型号/编号", detail.modelNo || "未填写"], ["状态", statusLabel(detail.status)], ["说明", detail.description || "暂无"], ["更新时间", detail.updatedAt]]} /> : null}</div>;
}

function emptyRoute(venueId: string): ExhibitionRoute {
  return { id: `new-${Date.now()}`, venueId, exhibitionId: venueId, name: "", from: "", to: "", distance: "", estimatedMinutes: 0, description: "", status: "draft", createdAt: "", updatedAt: "" };
}

export function RoutePage({ canWrite = true, initialExhibitionId = "" }: EventPageProps) {
  const [items, setItems] = useState<ExhibitionRoute[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [venues, setVenues] = useState<EventVenue[]>([]);
  const [editing, setEditing] = useState<ExhibitionRoute | null>(null);
  const [detail, setDetail] = useState<ExhibitionRoute | null>(null);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const filtered = items.filter((item) => {
    const venue = venues.find((candidate) => candidate.id === item.venueId);
    return (!initialExhibitionId || venue?.exhibitionId === initialExhibitionId) && `${item.name} ${item.from} ${item.to}`.toLowerCase().includes(keyword.toLowerCase());
  });
  const pagination = usePagination(filtered);
  const exhibitionName = (venueId: string) => { const venue = venues.find((item) => item.id === venueId); return exhibitions.find((item) => item.id === venueId)?.name ?? exhibitions.find((item) => item.id === venue?.exhibitionId)?.name ?? venue?.exhibitionId ?? ""; };
  const reload = () => { void Promise.all([adminApi.listRoutes(), adminApi.listExhibitions(), adminApi.listVenues()]).then(([nextItems, nextExhibitions, nextVenues]) => { setItems(nextItems.map((item) => ({ ...item, exhibitionId: item.venueId }))); setExhibitions(nextVenues.map((venue) => ({ id: venue.id, name: `${venue.name} · ${nextExhibitions.find((item) => item.id === venue.exhibitionId)?.name ?? venue.exhibitionId}` } as Exhibition))); setVenues(nextVenues); }).catch(() => setError("地图路线数据读取失败。")); };
  useEffect(reload, []);
  const save = async () => {
    const venueId = editing?.exhibitionId || editing?.venueId || "";
    if (!venueId || !editing?.name.trim() || !editing.from.trim() || !editing.to.trim()) { setError("请填写所属场地、路线名称、起点和终点。"); return; }
    const saved = await adminApi.saveRoute({ ...editing, venueId, name: editing.name.trim(), from: editing.from.trim(), to: editing.to.trim(), estimatedMinutes: Math.max(0, Number(editing.estimatedMinutes) || 0) });
    setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setEditing(null); setError("");
  };
  const remove = async (item: ExhibitionRoute) => { if (!window.confirm(`确认删除路线“${item.name}”？`)) return; await adminApi.deleteRoute(item.id); setItems((current) => current.filter((candidate) => candidate.id !== item.id)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="展会运营 / 地图路线" title="地图路线" description="维护展馆、入口、展区之间的路线信息，为数字人导览和问答提供基础数据。" action={canWrite ? <Button onClick={() => setEditing(emptyRoute(exhibitions[0]?.id ?? ""))}>+ 新增路线</Button> : null} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><p className="text-xs text-slate-500">共 {filtered.length} 条路线</p><SearchBox value={keyword} onChange={setKeyword} placeholder="搜索路线、起点或终点" /></div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">路线</th><th className="px-5 py-3">起点 → 终点</th><th className="px-5 py-3">展会</th><th className="px-5 py-3">距离 / 用时</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{pagination.pageItems.map((item) => <tr key={item.id}><td className="px-5 py-4 font-semibold text-slate-800">{item.name}</td><td className="px-5 py-4 text-slate-500">{item.from} → {item.to}</td><td className="px-5 py-4 text-slate-500">{exhibitionName(item.exhibitionId)}</td><td className="px-5 py-4 text-slate-500">{item.distance || "未填写"} / {item.estimatedMinutes} 分钟</td><td className="px-5 py-4"><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button>{canWrite ? <><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => void remove(item)}>删除</Button></> : null}</td></tr>)}</tbody></table></div>{!filtered.length ? <p className="py-12 text-center text-xs text-slate-400">暂无路线数据</p> : null}</Card><Pagination page={pagination.page} pageCount={pagination.pageCount} total={filtered.length} onChange={pagination.setPage} />{editing ? <Modal title={editing.id.startsWith("new-") ? "新增路线" : "编辑路线"} onClose={() => setEditing(null)} onSave={() => void save()}><div className="grid gap-4 sm:grid-cols-2"><SelectField label="所属展会" value={editing.exhibitionId} onChange={(value) => setEditing({ ...editing, exhibitionId: value })} options={exhibitions.map((item) => ({ value: item.id, label: item.name }))} /><Field label="路线名称" value={editing.name} onChange={(value) => setEditing({ ...editing, name: value })} /><Field label="起点" value={editing.from} onChange={(value) => setEditing({ ...editing, from: value })} /><Field label="终点" value={editing.to} onChange={(value) => setEditing({ ...editing, to: value })} /><Field label="距离" value={editing.distance} onChange={(value) => setEditing({ ...editing, distance: value })} /><Field label="预计用时（分钟）" value={String(editing.estimatedMinutes)} onChange={(value) => setEditing({ ...editing, estimatedMinutes: Number(value) || 0 })} /><SelectField label="状态" value={editing.status} onChange={(value) => setEditing({ ...editing, status: value as ExhibitionRoute["status"] })} options={[{ value: "draft", label: "草稿" }, { value: "published", label: "已发布" }, { value: "offline", label: "已下线" }]} /></div><div className="mt-4"><Field label="路线说明" value={editing.description} onChange={(value) => setEditing({ ...editing, description: value })} textarea /></div></Modal> : null}{detail ? <Detail title="路线详情" onClose={() => setDetail(null)} rows={[["路线名称", detail.name], ["所属展会", exhibitionName(detail.exhibitionId)], ["起点", detail.from], ["终点", detail.to], ["距离", detail.distance || "未填写"], ["预计用时", `${detail.estimatedMinutes} 分钟`], ["状态", statusLabel(detail.status)], ["说明", detail.description || "暂无"]]} /> : null}</div>;
}

function emptySchedule(exhibitionId: string): EventSchedule {
  return { id: `new-${Date.now()}`, exhibitionId, title: "", type: "论坛", startAt: "", endAt: "", location: "", speaker: "", description: "", status: "draft", createdAt: "", updatedAt: "" };
}

export function SchedulePage({ canWrite = true }: EventPageProps) {
  const [items, setItems] = useState<EventSchedule[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [editing, setEditing] = useState<EventSchedule | null>(null);
  const [detail, setDetail] = useState<EventSchedule | null>(null);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const filtered = items.filter((item) => `${item.title} ${item.type} ${item.location} ${item.speaker}`.toLowerCase().includes(keyword.toLowerCase()));
  const pagination = usePagination(filtered);
  const exhibitionName = (id: string) => exhibitions.find((item) => item.id === id)?.name ?? id;
  const reload = () => { void Promise.all([adminApi.listSchedules(), adminApi.listExhibitions()]).then(([nextItems, nextExhibitions]) => { setItems(nextItems); setExhibitions(nextExhibitions); }).catch(() => setError("活动排期数据读取失败。")); };
  useEffect(reload, []);
  const save = async () => {
    if (!editing?.exhibitionId || !editing.title.trim() || !editing.startAt || !editing.endAt || !editing.location.trim()) { setError("请填写所属展会、活动名称、时间和地点。"); return; }
    if (editing.endAt < editing.startAt) { setError("结束时间不能早于开始时间。"); return; }
    const saved = await adminApi.saveSchedule({ ...editing, title: editing.title.trim(), location: editing.location.trim() });
    setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setEditing(null); setError("");
  };
  const remove = async (item: EventSchedule) => { if (!window.confirm(`确认删除活动“${item.title}”？`)) return; await adminApi.deleteSchedule(item.id); setItems((current) => current.filter((candidate) => candidate.id !== item.id)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="展会运营 / 活动排期" title="活动排期" description="维护论坛、演示、发布会等展会活动的时间、地点和主讲信息。" action={canWrite ? <Button onClick={() => setEditing(emptySchedule(exhibitions[0]?.id ?? ""))}>+ 新增活动</Button> : null} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><p className="text-xs text-slate-500">共 {filtered.length} 场活动</p><SearchBox value={keyword} onChange={setKeyword} placeholder="搜索活动、地点或主讲方" /></div><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">活动</th><th className="px-5 py-3">时间</th><th className="px-5 py-3">地点</th><th className="px-5 py-3">主讲方</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{pagination.pageItems.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.title}</p><p className="mt-1 text-slate-400">{exhibitionName(item.exhibitionId)} · {item.type}</p></td><td className="px-5 py-4 text-slate-500">{item.startAt}<br />至 {item.endAt}</td><td className="px-5 py-4 text-slate-500">{item.location}</td><td className="px-5 py-4 text-slate-500">{item.speaker || "未填写"}</td><td className="px-5 py-4"><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button>{canWrite ? <><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => void remove(item)}>删除</Button></> : null}</td></tr>)}</tbody></table></div>{!filtered.length ? <p className="py-12 text-center text-xs text-slate-400">暂无活动排期</p> : null}</Card><Pagination page={pagination.page} pageCount={pagination.pageCount} total={filtered.length} onChange={pagination.setPage} />{editing ? <Modal title={editing.id.startsWith("new-") ? "新增活动" : "编辑活动"} onClose={() => setEditing(null)} onSave={() => void save()}><div className="grid gap-4 sm:grid-cols-2"><SelectField label="所属展会" value={editing.exhibitionId} onChange={(value) => setEditing({ ...editing, exhibitionId: value })} options={exhibitions.map((item) => ({ value: item.id, label: item.name }))} /><Field label="活动名称" value={editing.title} onChange={(value) => setEditing({ ...editing, title: value })} /><SelectField label="活动类型" value={editing.type} onChange={(value) => setEditing({ ...editing, type: value })} options={[{ value: "论坛", label: "论坛" }, { value: "演示", label: "演示" }, { value: "发布会", label: "发布会" }, { value: "签约", label: "签约" }]} /><Field label="活动地点" value={editing.location} onChange={(value) => setEditing({ ...editing, location: value })} /><DateTimeField label="开始时间" value={editing.startAt} onChange={(value) => setEditing({ ...editing, startAt: value })} /><DateTimeField label="结束时间" value={editing.endAt} onChange={(value) => setEditing({ ...editing, endAt: value })} /><Field label="主讲方" value={editing.speaker} onChange={(value) => setEditing({ ...editing, speaker: value })} /><SelectField label="状态" value={editing.status} onChange={(value) => setEditing({ ...editing, status: value as EventSchedule["status"] })} options={[{ value: "draft", label: "草稿" }, { value: "scheduled", label: "已排期" }, { value: "finished", label: "已完成" }, { value: "cancelled", label: "已取消" }]} /></div><div className="mt-4"><Field label="活动说明" value={editing.description} onChange={(value) => setEditing({ ...editing, description: value })} textarea /></div></Modal> : null}{detail ? <Detail title="活动详情" onClose={() => setDetail(null)} rows={[["活动名称", detail.title], ["所属展会", exhibitionName(detail.exhibitionId)], ["类型", detail.type], ["时间", `${detail.startAt} 至 ${detail.endAt}`], ["地点", detail.location], ["主讲方", detail.speaker || "未填写"], ["状态", statusLabel(detail.status)], ["说明", detail.description || "暂无"]]} /> : null}</div>;
}
