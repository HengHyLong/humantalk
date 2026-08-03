import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostForm,
  buildApiDownloadUrl,
  type AvatarSummary,
  type KnowledgeBaseSummary,
  type KnowledgeBasesResponse,
  type KnowledgeDocument,
  type KnowledgeDocumentsResponse,
} from "../lib/api";
import { MemoryPanel } from "../components/MemoryPanel";
import { openTalkingClient } from "./openTalkingClient";
import type { MemoryLibrary } from "../types";

const PAGE_SIZE = 9;
const DOCUMENT_ACCEPT = ".doc,.docx,.pdf,.md,.markdown,.txt,.pptx";
const DOCUMENT_EXTENSIONS = new Set([".doc", ".docx", ".pdf", ".md", ".markdown", ".txt", ".pptx"]);

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.detail) return error.detail;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

function Header({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600">{eyebrow}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{title}</h1><p className="mt-1 text-sm text-slate-500">{description}</p></div>{action ? <div>{action}</div> : null}</div>;
}

function Button({ children, onClick, variant = "primary", disabled = false, className = "" }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; className?: string }) {
  const styles = { primary: "bg-cyan-600 text-white hover:bg-cyan-700", secondary: "border border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:text-cyan-700", ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-800", danger: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50" };
  return <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${styles[variant]} ${className}`}>{children}</button>;
}

function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "cyan" | "green" | "amber" | "rose" }) {
  const styles = { slate: "bg-slate-100 text-slate-600", cyan: "bg-cyan-50 text-cyan-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700" };
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${styles[tone]}`}>{children}</span>;
}

function Modal({ title, children, onClose, onSave, saveLabel = "保存" }: { title: string; children: ReactNode; onClose: () => void; onSave?: () => void; saveLabel?: string }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm"><Card className="max-h-[90vh] w-full max-w-xl overflow-auto p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-950">{title}</h2><button type="button" onClick={onClose} className="text-2xl leading-none text-slate-300 hover:text-slate-600">×</button></div><div className="mt-5">{children}</div>{onSave ? <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>取消</Button><Button onClick={onSave}>{saveLabel}</Button></div> : null}</Card></div>;
}

function usePagination<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return { page, pageCount, setPage, pageItems: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}

function Pagination({ page, pageCount, total, onChange }: { page: number; pageCount: number; total: number; onChange: (page: number) => void }) {
  if (pageCount <= 1) return <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">共 {total} 条</div>;
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"><span>共 {total} 条，每页 {PAGE_SIZE} 条</span><div className="flex items-center gap-1"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-40">上一页</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((item) => <button type="button" key={item} onClick={() => onChange(item)} className={`min-w-8 rounded-lg px-2.5 py-1.5 font-semibold ${item === page ? "bg-cyan-600 text-white" : "border border-slate-200 text-slate-500"}`}>{item}</button>)}<button type="button" disabled={page >= pageCount} onClick={() => onChange(page + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-40">下一页</button></div></div>;
}

function documentStatus(document: KnowledgeDocument): { label: string; tone: "green" | "amber" | "rose" } {
  if (document.status === "ready") return { label: "已解析", tone: "green" };
  if (document.status === "error") return { label: "解析失败", tone: "rose" };
  return { label: "处理中", tone: "amber" };
}

export function DocumentCenterPage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<KnowledgeDocument | null>(null);
  const pagination = usePagination(documents);

  const reload = async () => {
    setLoading(true);
    try {
      const response = await apiGet<KnowledgeDocumentsResponse>("/agent/knowledge-documents");
      setDocuments(response.documents ?? []);
      setError("");
    } catch (caught) {
      setError(errorText(caught, "文档资料加载失败，请确认 OpenTalking 服务已启动。"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); }, []);

  const upload = async (files: File[]) => {
    const supported = files.filter((file) => DOCUMENT_EXTENSIONS.has(extensionOf(file.name)));
    if (!supported.length) { setError("支持 Word、PDF、Markdown、TXT、PPTX 文件。" ); return; }
    setUploading(true);
    try {
      const uploaded: KnowledgeDocument[] = [];
      for (const file of supported) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20MB 限制`);
        const form = new FormData();
        form.set("file", file);
        uploaded.push(await apiPostForm<KnowledgeDocument>("/agent/knowledge-documents", form));
      }
      setDocuments((current) => [...uploaded, ...current.filter((item) => !uploaded.some((next) => next.id === item.id))]);
      setError("");
    } catch (caught) {
      setError(errorText(caught, "文档上传失败，请检查文件格式和后端解析能力。"));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (document: KnowledgeDocument) => {
    if (!window.confirm(`确认删除文件“${document.filename}”？`)) return;
    try {
      await apiDelete(`/agent/knowledge-documents/${encodeURIComponent(document.id)}`);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (caught) {
      setError(errorText(caught, "删除失败；如果文件已加入知识库，请先移除知识库引用。"));
    }
  };

  return <div className="p-6 xl:p-8"><Header eyebrow="知识中心 / 文件池" title="文档资料" description="统一查看系统上传的 Word、PDF、Markdown、TXT、PPTX 等资料，上传后可在知识库中复用。" action={<label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-cyan-700 ${uploading ? "pointer-events-none opacity-50" : ""}`}>+ 上传文档<input type="file" multiple accept={DOCUMENT_ACCEPT} className="sr-only" disabled={uploading} onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void upload(files); event.currentTarget.value = ""; }} /></label>} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-slate-900">系统文档文件池</h2><p className="mt-1 text-xs text-slate-400">上传文件不会自动归属知识库，可在知识库中选择复用。</p></div><Badge tone="cyan">{documents.length} 个文件</Badge></div>{loading ? <div className="p-12 text-center text-sm text-slate-400">正在读取文档资料…</div> : !documents.length ? <div className="p-12 text-center text-sm text-slate-400">暂无文档，请上传 Word、PDF、Markdown 或 TXT 文件。</div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">文件</th><th className="px-5 py-3">格式 / 大小</th><th className="px-5 py-3">解析状态</th><th className="px-5 py-3">切片</th><th className="px-5 py-3">上传时间</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{pagination.pageItems.map((document) => { const status = documentStatus(document); return <tr key={document.id}><td className="max-w-[280px] px-5 py-4"><p className="truncate font-semibold text-slate-800">{document.filename}</p><p className="mt-1 truncate text-slate-400">{document.id}</p></td><td className="px-5 py-4 text-slate-500">{extensionOf(document.filename).toUpperCase().replace(".", "") || "文件"} · {formatSize(document.bytes)}</td><td className="px-5 py-4"><Badge tone={status.tone}>{status.label}</Badge>{document.error ? <p className="mt-1 max-w-[220px] truncate text-rose-500" title={document.error}>{document.error}</p> : null}</td><td className="px-5 py-4 text-slate-600">{document.chunk_count}</td><td className="px-5 py-4 text-slate-500">{formatDate(document.created_at)}</td><td className="whitespace-nowrap px-5 py-4"><a className="mr-2 text-cyan-700 hover:underline" href={buildApiDownloadUrl(`/agent/knowledge-documents/${encodeURIComponent(document.id)}/file`)} target="_blank" rel="noreferrer">查看</a><button type="button" className="mr-2 text-slate-500 hover:text-cyan-700" onClick={() => setDetail(document)}>详情</button><button type="button" className="text-rose-600 hover:text-rose-700" onClick={() => void remove(document)}>删除</button></td></tr>; })}</tbody></table></div>}</Card><Pagination page={pagination.page} pageCount={pagination.pageCount} total={documents.length} onChange={pagination.setPage} />{detail ? <Modal title="文档详情" onClose={() => setDetail(null)}><dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">{[["文件名", detail.filename], ["格式", detail.mime_type], ["文件大小", formatSize(detail.bytes)], ["解析状态", detail.status], ["切片数", detail.chunk_count], ["SHA256", detail.sha256], ["上传时间", formatDate(detail.created_at)]].map(([label, value]) => <div key={label} className="grid grid-cols-[120px_1fr] gap-3 px-4 py-3 text-xs"><dt className="text-slate-400">{label}</dt><dd className="break-all text-slate-700">{value}</dd></div>)}</dl></Modal> : null}</div>;
}

export function KnowledgeBasePage() {
  const [bases, setBases] = useState<KnowledgeBaseSummary[]>([]);
  const [poolDocuments, setPoolDocuments] = useState<KnowledgeDocument[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedPoolIds, setSelectedPoolIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const basePagination = usePagination(bases);
  const documentPagination = usePagination(documents);
  const selectedBase = useMemo(() => bases.find((item) => item.id === selectedId) ?? null, [bases, selectedId]);

  const loadBases = async () => {
    try {
      const [baseResponse, documentResponse] = await Promise.all([
        apiGet<KnowledgeBasesResponse>("/agent/knowledge-bases"),
        apiGet<KnowledgeDocumentsResponse>("/agent/knowledge-documents"),
      ]);
      const nextBases = baseResponse.knowledge_base_summaries ?? [];
      setBases(nextBases);
      setPoolDocuments(documentResponse.documents ?? []);
      setSelectedId((current) => current && nextBases.some((item) => item.id === current) ? current : nextBases[0]?.id ?? "");
    } catch (caught) {
      setError(errorText(caught, "知识库加载失败，请确认 OpenTalking 服务已启动。"));
    } finally {
      setLoading(false);
    }
  };
  const loadDocuments = async (baseId: string) => {
    if (!baseId) { setDocuments([]); return; }
    try {
      const response = await apiGet<KnowledgeDocumentsResponse>(`/agent/knowledge-bases/${encodeURIComponent(baseId)}/documents`);
      setDocuments(response.documents ?? []);
    } catch (caught) {
      setDocuments([]);
      setError(errorText(caught, "知识库文档加载失败。"));
    }
  };
  useEffect(() => { void loadBases(); }, []);
  useEffect(() => { void loadDocuments(selectedId); }, [selectedId]);

  const create = async () => {
    if (!name.trim() || (!selectedPoolIds.length && !files.length)) { setError("请填写知识库名称，并选择已有文档或上传文件。"); return; }
    try {
      const form = new FormData();
      form.set("name", name.trim());
      selectedPoolIds.forEach((id) => form.append("document_ids", id));
      files.forEach((file) => form.append("files", file));
      const created = await apiPostForm<KnowledgeBaseSummary>("/agent/knowledge-bases", form);
      setName(""); setFiles([]); setSelectedPoolIds([]); setCreateOpen(false); setSelectedId(created.id); setError(""); await loadBases(); await loadDocuments(created.id);
    } catch (caught) { setError(errorText(caught, "知识库创建失败。")); }
  };

  const rename = async () => {
    if (!selectedBase) return;
    const nextName = window.prompt("知识库名称", selectedBase.name)?.trim();
    if (!nextName || nextName === selectedBase.name) return;
    try { const updated = await apiPatch<KnowledgeBaseSummary>(`/agent/knowledge-bases/${encodeURIComponent(selectedBase.id)}`, { name: nextName }); setBases((current) => current.map((item) => item.id === updated.id ? updated : item)); } catch (caught) { setError(errorText(caught, "知识库重命名失败。")); }
  };

  const removeBase = async () => {
    if (!selectedBase || !window.confirm(`确认删除知识库“${selectedBase.name}”？`)) return;
    try { await apiDelete(`/agent/knowledge-bases/${encodeURIComponent(selectedBase.id)}`); setSelectedId(""); setDocuments([]); await loadBases(); } catch (caught) { setError(errorText(caught, "知识库删除失败。")); }
  };

  const addDocuments = async () => {
    if (!selectedId || (!selectedPoolIds.length && !files.length)) { setError("请选择文件池中的文档或上传新文件。"); return; }
    try {
      if (selectedPoolIds.length) await apiPost(`/agent/knowledge-bases/${encodeURIComponent(selectedId)}/documents/import`, { document_ids: selectedPoolIds });
      for (const file of files) { const form = new FormData(); form.set("file", file); await apiPostForm(`/agent/knowledge-bases/${encodeURIComponent(selectedId)}/documents`, form); }
      setSelectedPoolIds([]); setFiles([]); setAddOpen(false); setError(""); await loadBases(); await loadDocuments(selectedId);
    } catch (caught) { setError(errorText(caught, "文档加入知识库失败，可能存在重复文件或格式不支持。")); }
  };

  const removeDocument = async (document: KnowledgeDocument) => {
    if (!selectedId || !window.confirm(`确认从知识库移除“${document.filename}”？`)) return;
    try { await apiDelete(`/agent/knowledge-bases/${encodeURIComponent(selectedId)}/documents/${encodeURIComponent(document.id)}`); setDocuments((current) => current.filter((item) => item.id !== document.id)); await loadBases(); } catch (caught) { setError(errorText(caught, "知识库文档删除失败。")); }
  };
  const reindex = async (document: KnowledgeDocument) => {
    if (!selectedId) return;
    try { const updated = await apiPost<KnowledgeDocument>(`/agent/knowledge-bases/${encodeURIComponent(selectedId)}/documents/${encodeURIComponent(document.id)}/reindex`); setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item)); } catch (caught) { setError(errorText(caught, "文档重建索引失败。")); }
  };

  const filePicker = <><p className="mb-2 text-xs text-slate-500">支持 Word、PDF、Markdown、TXT、PPTX，单个文件不超过 20MB。</p><input type="file" multiple accept={DOCUMENT_ACCEPT} onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} className="block w-full rounded-xl border border-dashed border-cyan-300 bg-cyan-50 px-3 py-3 text-xs text-cyan-700" /></>;
  return <div className="p-6 xl:p-8"><Header eyebrow="知识中心 / 检索资产" title="知识库" description="管理知识库分类、复用文档资料，并查看解析和索引状态。" action={<Button onClick={() => setCreateOpen(true)}>+ 新建知识库</Button>} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-4"><div><h2 className="text-sm font-semibold text-slate-900">知识库分类</h2><p className="mt-1 text-xs text-slate-400">{bases.length} 个知识库</p></div></div><div className="space-y-2 p-3">{loading ? <p className="p-4 text-center text-xs text-slate-400">加载中…</p> : basePagination.pageItems.map((base) => <button type="button" key={base.id} onClick={() => setSelectedId(base.id)} className={`w-full rounded-xl border p-3 text-left transition ${base.id === selectedId ? "border-cyan-300 bg-cyan-50" : "border-slate-200 hover:border-cyan-200"}`}><p className="truncate text-sm font-semibold text-slate-800">{base.name}</p><p className="mt-1 text-xs text-slate-400">{base.document_count} 份文档 · {base.ready_document_count} 已就绪</p></button>)}{!loading && !bases.length ? <p className="p-4 text-center text-xs text-slate-400">暂无知识库</p> : null}<Pagination page={basePagination.page} pageCount={basePagination.pageCount} total={bases.length} onChange={basePagination.setPage} /></div></Card><Card className="overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-slate-900">{selectedBase?.name || "请选择知识库"}</h2><p className="mt-1 text-xs text-slate-400">{selectedBase ? `${selectedBase.document_count} 份文档 · ${selectedBase.updated_at ? formatDate(selectedBase.updated_at) : "暂无更新时间"}` : "知识库中的文档会参与检索"}</p></div>{selectedBase ? <div className="flex gap-2"><Button variant="secondary" onClick={() => setAddOpen(true)}>添加文档</Button><Button variant="ghost" onClick={() => void rename()}>重命名</Button><Button variant="danger" onClick={() => void removeBase()}>删除</Button></div> : null}</div>{selectedBase ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">文档</th><th className="px-5 py-3">格式 / 大小</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">切片</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{documentPagination.pageItems.map((document) => { const status = documentStatus(document); return <tr key={document.id}><td className="max-w-[300px] px-5 py-4"><p className="truncate font-semibold text-slate-800">{document.filename}</p><p className="mt-1 truncate text-slate-400">{formatDate(document.created_at)}</p></td><td className="px-5 py-4 text-slate-500">{extensionOf(document.filename).toUpperCase().replace(".", "")} · {formatSize(document.bytes)}</td><td className="px-5 py-4"><Badge tone={status.tone}>{status.label}</Badge></td><td className="px-5 py-4 text-slate-600">{document.chunk_count}</td><td className="whitespace-nowrap px-5 py-4"><a className="mr-2 text-cyan-700" href={buildApiDownloadUrl(`/agent/knowledge-bases/${encodeURIComponent(selectedId)}/documents/${encodeURIComponent(document.id)}/file`)} target="_blank" rel="noreferrer">查看</a><button type="button" className="mr-2 text-amber-700" onClick={() => void reindex(document)}>重建索引</button><button type="button" className="text-rose-600" onClick={() => void removeDocument(document)}>移除</button></td></tr>; })}</tbody></table></div> : <div className="flex min-h-[360px] items-center justify-center text-sm text-slate-400">请选择左侧知识库</div>}{selectedBase ? <div className="px-5 pb-5"><Pagination page={documentPagination.page} pageCount={documentPagination.pageCount} total={documents.length} onChange={documentPagination.setPage} /></div> : null}</Card></div>{createOpen ? <Modal title="新建知识库" onClose={() => setCreateOpen(false)} onSave={() => void create()} saveLabel="创建知识库"><label className="block text-xs font-semibold text-slate-600">知识库名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：西博会展商知识库" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><div className="mt-5"><p className="mb-2 text-xs font-semibold text-slate-600">选择文件池文档</p><div className="max-h-48 space-y-2 overflow-auto rounded-xl border border-slate-200 p-3">{poolDocuments.length ? poolDocuments.map((document) => <label key={document.id} className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={selectedPoolIds.includes(document.id)} onChange={() => setSelectedPoolIds((current) => current.includes(document.id) ? current.filter((id) => id !== document.id) : [...current, document.id])} />{document.filename}</label>) : <p className="text-xs text-slate-400">暂无文件池文档</p>}</div></div><div className="mt-5">{filePicker}</div></Modal> : null}{addOpen ? <Modal title={`向“${selectedBase?.name || "知识库"}”添加文档`} onClose={() => setAddOpen(false)} onSave={() => void addDocuments()} saveLabel="添加到知识库"><div><p className="mb-2 text-xs font-semibold text-slate-600">复用文件池文档</p><div className="max-h-48 space-y-2 overflow-auto rounded-xl border border-slate-200 p-3">{poolDocuments.filter((document) => !documents.some((item) => item.sha256 === document.sha256)).map((document) => <label key={document.id} className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={selectedPoolIds.includes(document.id)} onChange={() => setSelectedPoolIds((current) => current.includes(document.id) ? current.filter((id) => id !== document.id) : [...current, document.id])} />{document.filename}</label>)}</div></div><div className="mt-5">{filePicker}</div></Modal> : null}</div>;
}

export function MemoryCenterPage() {
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [libraries, setLibraries] = useState<MemoryLibrary[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void openTalkingClient.listAvatars().then((items) => { setAvatars(items); setCharacterId((current) => current || items[0]?.id || ""); }).catch((caught) => setError(errorText(caught, "数字人形象加载失败，无法读取对应记忆库。"))); }, []);
  return <div className="p-6 xl:p-8"><Header eyebrow="知识中心 / 记忆资产" title="记忆库" description="沿用现有记忆接口，按数字人管理记忆库和记忆条目。" action={<div className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-500">当前数字人</span><select value={characterId} onChange={(event) => { setCharacterId(event.target.value); setSelectedLibraryId(null); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"><option value="">请选择数字人</option>{avatars.map((avatar) => <option key={avatar.id} value={avatar.id}>{avatar.name || avatar.id}</option>)}</select></div>} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<div className="mb-4 flex gap-3"><Badge tone="cyan">{libraries.length} 个记忆库</Badge><Badge tone="green">{libraries.reduce((sum, library) => sum + library.memory_count, 0)} 条记忆</Badge></div><MemoryPanel characterId={characterId || null} selectedLibraryId={selectedLibraryId} profileId="default" mode="manage" onLibrarySelect={setSelectedLibraryId} onLibrariesChange={setLibraries} /></div>;
}
