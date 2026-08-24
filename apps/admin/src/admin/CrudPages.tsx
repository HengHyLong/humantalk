import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ApiError, apiGet, buildApiUrl, type AvatarSummary, type SceneBackgroundAsset, type SceneComposition } from "../lib/api";
import { DEFAULT_VOICES, adminApi } from "./api";
import { toUiError } from "./errors";
import { openTalkingClient } from "./openTalkingClient";
import { EmptyState, ErrorState, LoadingSkeleton } from "./ui";
import type { GifAssetMeta, IdleContent, KnowledgeDocument, KnowledgeQa, MissPoolItem, PublishPackage, ScriptTemplate, VoiceAsset } from "./types";

type Tone = "slate" | "cyan" | "green" | "amber" | "rose" | "violet";

type TtsHealthSummary = {
  tts_default_provider?: string;
  tts_enabled_providers?: string[];
};

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: Tone }) {
  const styles: Record<Tone, string> = { slate: "bg-slate-100 text-slate-600", cyan: "bg-cyan-50 text-cyan-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700", violet: "bg-violet-50 text-violet-700" };
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${styles[tone]}`}>{children}</span>;
}

export function Button({ children, onClick, variant = "primary", disabled = false, className = "" }: { children: ReactNode; onClick?: (event: MouseEvent<HTMLButtonElement>) => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; className?: string }) {
  const styles = { primary: "bg-cyan-600 text-white hover:bg-cyan-700", secondary: "border border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:text-cyan-700", ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-800", danger: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50" };
  return <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${styles[variant]} ${className}`}>{children}</button>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>; }

export function Header({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { const displayDescription = description.replace("GIF 类型需要同时上传等待聆听和张嘴讲话两张动图。", "视频驱动使用内置 listen.mp4 / talk.mp4，按聆听和说话状态切换。"); return <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600">{eyebrow}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{title}</h1><p className="mt-1 text-sm text-slate-500">{displayDescription}</p></div>{action ? <div>{action}</div> : null}</div>; }

export function Modal({ title, children, onClose, onSave, saveLabel = "保存", saving = false, error = "" }: { title: string; children: ReactNode; onClose: () => void; onSave?: () => void; saveLabel?: string; saving?: boolean; error?: string }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);
  onCloseRef.current = onClose;
  savingRef.current = saving;
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialogRef.current?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !savingRef.current) onCloseRef.current(); }; window.addEventListener("keydown", onKey); return () => { window.removeEventListener("keydown", onKey); previous?.focus?.(); }; }, []);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><div ref={dialogRef} tabIndex={-1} className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl outline-none" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title"><div className="flex items-center justify-between gap-3"><h2 id="admin-modal-title" className="text-lg font-semibold text-slate-950">{title}</h2><button ref={closeRef} type="button" onClick={onClose} disabled={saving} aria-label="关闭弹窗" className="rounded-lg px-2 text-2xl leading-none text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40">×</button></div><div className="mt-5">{children}</div>{error ? <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700" role="alert">{error}</p> : null}{onSave ? <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={saving}>取消</Button><Button onClick={onSave} disabled={saving}>{saving ? "保存中…" : saveLabel}</Button></div> : null}</div></div>;
}

export function Field({ label, value, onChange, placeholder, textarea = false, error = "", required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; textarea?: boolean; error?: string; required?: boolean }) { const fieldId = `field-${label}`; return <label htmlFor={fieldId} className="block text-xs font-semibold text-slate-600">{label}{required ? <span className="ml-1 text-rose-500" aria-hidden="true">*</span> : null}{textarea ? <textarea id={fieldId} rows={5} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : undefined} className={`mt-2 w-full rounded-xl border px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400 ${error ? "border-rose-300" : "border-slate-200"}`} /> : <input id={fieldId} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : undefined} className={`mt-2 w-full rounded-xl border px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400 ${error ? "border-rose-300" : "border-slate-200"}`} />}{error ? <span id={`${fieldId}-error`} className="mt-1 block text-[11px] font-normal text-rose-600">{error}</span> : null}</label>; }

export function Detail({ title, rows, onClose }: { title: string; rows: Array<[string, ReactNode]>; onClose: () => void }) { return <Modal title={title} onClose={onClose}><dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[120px_1fr] gap-3 px-4 py-3 text-xs"><dt className="text-slate-400">{label}</dt><dd className="break-words text-slate-700">{value}</dd></div>)}</dl></Modal>; }

const PAGE_SIZE = 9;

const CUSTOM_AVATAR_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const CUSTOM_AVATAR_VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "avi"];

function fileExtension(file: File): string {
  return file.name.toLowerCase().split(".").pop() || "";
}

function isCustomAvatarVideo(file: File | null): boolean {
  if (!file) return false;
  return file.type.toLowerCase().startsWith("video/") || CUSTOM_AVATAR_VIDEO_EXTENSIONS.includes(fileExtension(file));
}

function customAvatarFileError(file: File): string | null {
  const extension = fileExtension(file);
  const isImage = file.type.toLowerCase().startsWith("image/") || CUSTOM_AVATAR_IMAGE_EXTENSIONS.includes(extension);
  const isVideo = isCustomAvatarVideo(file);
  if (!isImage && !isVideo) return "仅支持 JPEG、PNG、WebP 图片或 MP4、WebM、MOV、AVI 视频。";
  const maxSize = isVideo ? 200 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size > maxSize) return `${isVideo ? "视频" : "图片"}不能超过 ${isVideo ? "200MB" : "10MB"}。`;
  return null;
}

function AvatarCardPreview({ avatar }: { avatar: AvatarSummary }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatar.id, avatar.has_preview_video]);
  if (failed) {
    return <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-white to-cyan-50 p-4 text-center" role="img" aria-label={`${avatar.name || avatar.id}预览不可用`}><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-2xl text-cyan-500 shadow-sm">✦</div><p className="mt-3 text-xs font-semibold text-slate-600">预览暂不可用</p><p className="mt-1 max-w-[14rem] truncate text-[11px] text-slate-400">{avatar.name || avatar.id}</p></div>;
  }
  const onPreviewError = () => setFailed(true);
  return avatar.has_preview_video ? (
    <video
      src={buildApiUrl(`/avatars/${encodeURIComponent(avatar.id)}/preview-video`)}
      className="h-full w-full object-contain"
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={avatar.name || avatar.id}
      onError={onPreviewError}
    />
  ) : (
    <img src={openTalkingClient.previewUrl(avatar.id)} alt={avatar.name || avatar.id} className="h-full w-full object-contain" onError={onPreviewError} />
  );
}

export function usePagination<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);
  return { page, setPage, pageCount, pageItems: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}

export function Pagination({ page, pageCount, total, onChange }: { page: number; pageCount: number; total: number; onChange: (page: number) => void }) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  return <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"><span>共 {total} 条，每页 {PAGE_SIZE} 条</span><div className="flex items-center gap-1"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-40">上一页</button>{pages.map((item) => <button type="button" key={item} onClick={() => onChange(item)} className={`min-w-8 rounded-lg px-2.5 py-1.5 font-semibold ${item === page ? "bg-cyan-600 text-white" : "border border-slate-200 text-slate-500 hover:border-cyan-300 hover:text-cyan-700"}`}>{item}</button>)}<button type="button" disabled={page >= pageCount} onClick={() => onChange(page + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-40">下一页</button></div></div>;
}

export function EnhancedAvatarPage({ onDebug }: { onDebug?: (avatarId: string) => void }) {
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<{ file: File | null; listenVideo: File | null; thinkVideo: File | null; talkVideo: File | null; name: string; baseAvatarId: string; model: string; removeBackground: boolean }>({ file: null, listenVideo: null, thinkVideo: null, talkVideo: null, name: "", baseAvatarId: "", model: "", removeBackground: false });
  const [error, setError] = useState("");
  const avatarPagination = usePagination(avatars);
  const reload = useCallback(() => {
    setLoading(true);
    setLoadError("");
    void Promise.allSettled([openTalkingClient.listAvatars(), openTalkingClient.listModels()]).then(([avatarResult, modelResult]) => {
      if (avatarResult.status === "rejected") {
        throw avatarResult.reason;
      }
      const items = avatarResult.value;
      setAvatars(items);
      if (modelResult.status === "fulfilled") {
        const modelResponse = modelResult.value;
        setModels(Array.from(new Set([...modelResponse.models, "video"])));
        setForm((current) => ({
          ...current,
          model: current.model || modelResponse.defaultModel || modelResponse.models[0] || "",
        }));
      } else {
        setModels([]);
        setError(toUiError(modelResult.reason).message);
      }
      setSelected((current) => current || items[0]?.id || "");
      setForm((current) => ({
        ...current,
        // OpenTalking 现行接口仍需要模板 avatar_id；这里自动使用系统形象，运营人员无需选择。
        baseAvatarId: current.baseAvatarId || items.find((avatar) => !avatar.is_custom)?.id || "",
      }));
    }).catch((requestError) => setLoadError(toUiError(requestError).message)).finally(() => setLoading(false));
  }, []);
  useEffect(reload, []);
  const add = async () => {
    if (!form.name.trim()) {
      setError("请填写形象名称。");
      return;
    }
    const baseAvatarId = form.baseAvatarId || avatars.find((avatar) => !avatar.is_custom)?.id || "";
    if (!baseAvatarId) {
      setError("后端没有可用于创建形象的系统模板，请先检查形象列表。");
      return;
    }
    if (form.model === "video") {
      if (!form.listenVideo || !form.thinkVideo || !form.talkVideo) {
        setError("视频驱动必须同时上传聆听、思考和讲话视频。");
        return;
      }
      const videoError = [form.listenVideo, form.thinkVideo, form.talkVideo].map(customAvatarFileError).find(Boolean);
      if (videoError) {
        setError(videoError as string);
        return;
      }
    } else {
      if (!form.file) {
        setError("请选择 JPEG、PNG、WebP 图片或 MP4、WebM、MOV、AVI 视频。");
        return;
      }
      const fileError = customAvatarFileError(form.file);
      if (fileError) {
        setError(fileError);
        return;
      }
    }
    try {
      const item = await openTalkingClient.createCustomAvatar({ file: isCustomAvatarVideo(form.file) ? undefined : form.file ?? undefined, video: isCustomAvatarVideo(form.file) ? form.file ?? undefined : undefined, listenVideo: form.listenVideo ?? undefined, thinkVideo: form.thinkVideo ?? undefined, talkVideo: form.talkVideo ?? undefined, name: form.name.trim(), baseAvatarId, model: form.model || null, personMode: "single", removeBackground: form.removeBackground });
      setAvatars((current) => [...current, item]);
      setSelected(item.id);
      setForm({ file: null, listenVideo: null, thinkVideo: null, talkVideo: null, name: "", baseAvatarId, model: form.model, removeBackground: false });
      setError("");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "导入失败，请检查图片格式和后端处理状态。");
    }
  };
  const remove = async (avatar: AvatarSummary) => {
    if (!avatar.is_custom || !window.confirm(`确认删除自定义形象“${avatar.name || avatar.id}”？`)) return;
    try {
      await openTalkingClient.deleteAvatar(avatar.id);
      setAvatars((current) => current.filter((item) => item.id !== avatar.id));
      setSelected((current) => current === avatar.id ? "" : current);
    } catch {
      setError("删除失败：系统形象不可删除，或后端未允许删除该自定义形象。");
    }
  };
  const importModal = form.name ? <Modal title="导入数字人形象" onClose={() => { setForm((current) => ({ ...current, file: null, listenVideo: null, thinkVideo: null, talkVideo: null, name: "", removeBackground: false })); setError(""); }} onSave={() => void add()} saveLabel="上传并创建"><Field label="形象名称" value={form.name} onChange={(value) => setForm({ ...form, name: value })} placeholder="例如：古装美女" /><label className="mt-4 block text-xs font-semibold text-slate-600">模型<select value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="">使用后端默认模型</option>{models.map((model) => <option key={model} value={model}>{model === "video" ? "视频驱动（上传聆听 + 思考 + 讲话视频）" : model}</option>)}</select></label>{form.model === "video" ? <div className="mt-4 space-y-3"><p className="rounded-xl bg-cyan-50 px-4 py-3 text-xs leading-5 text-cyan-700">请分别上传选中数字人的聆听、思考和讲话视频。保存后会生成可绑定的 video 数字人，运行时按状态播放对应视频。</p><label className="block rounded-xl border border-dashed border-cyan-300 bg-cyan-50 p-5 text-center text-xs text-cyan-700">上传聆听视频（listen）<input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo,.mp4,.webm,.mov,.avi" className="sr-only" onChange={(event) => setForm({ ...form, listenVideo: event.target.files?.[0] ?? null })} />{form.listenVideo ? <p className="mt-2 font-semibold">{form.listenVideo.name}</p> : null}</label><label className="block rounded-xl border border-dashed border-cyan-300 bg-cyan-50 p-5 text-center text-xs text-cyan-700">上传思考视频（think）<input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo,.mp4,.webm,.mov,.avi" className="sr-only" onChange={(event) => setForm({ ...form, thinkVideo: event.target.files?.[0] ?? null })} />{form.thinkVideo ? <p className="mt-2 font-semibold">{form.thinkVideo.name}</p> : null}</label><label className="block rounded-xl border border-dashed border-cyan-300 bg-cyan-50 p-5 text-center text-xs text-cyan-700">上传讲话视频（talk）<input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo,.mp4,.webm,.mov,.avi" className="sr-only" onChange={(event) => setForm({ ...form, talkVideo: event.target.files?.[0] ?? null })} />{form.talkVideo ? <p className="mt-2 font-semibold">{form.talkVideo.name}</p> : null}</label></div> : <div className="mt-4"><label className="block rounded-xl border border-dashed border-cyan-300 bg-cyan-50 p-5 text-center text-xs text-cyan-700">选择图片或视频（图片 ≤ 10MB，视频 ≤ 200MB）<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,video/x-msvideo,.mov,.avi" className="sr-only" onChange={(event) => setForm({ ...form, file: event.target.files?.[0] ?? null })} />{form.file ? <p className="mt-2 font-semibold">{form.file.name}{isCustomAvatarVideo(form.file) ? " · 视频源" : " · 图片源"}</p> : null}</label><label className={`mt-4 flex items-center gap-2 text-xs font-semibold text-slate-600 ${isCustomAvatarVideo(form.file) ? "opacity-50" : ""}`}><input type="checkbox" checked={form.removeBackground} disabled={isCustomAvatarVideo(form.file)} onChange={(event) => setForm({ ...form, removeBackground: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-cyan-600" />上传时抠除背景（视频源不支持）</label></div>}</Modal> : null;
  return <div className="p-6 xl:p-8"><Header eyebrow="数字人中心 / 真实后端" title="数字人形象" description="从 OpenTalking 读取形象和模型；新增时自动使用系统模板，支持图片或视频源文件。GIF 类型需要同时上传等待聆听和张嘴讲话两张动图。" action={<Button onClick={() => setForm((current) => ({ ...current, name: current.name || "新数字人", baseAvatarId: current.baseAvatarId || avatars.find((avatar) => !avatar.is_custom)?.id || "", model: current.model || models[0] || "" }))}>+ 导入形象</Button>} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700" role="alert">{error}</p> : null}{importModal}{loading ? <Card className="p-8"><LoadingSkeleton rows={4} /></Card> : loadError ? <ErrorState title="数字人形象暂时无法加载" description={loadError} onRetry={reload} /> : !avatars.length ? <Card className="p-8"><EmptyState title="暂无可用形象" description="当前 OpenTalking 没有返回可用形象，请先确认形象资产目录和服务配置。" /></Card> : <><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{avatarPagination.pageItems.map((avatar) => <Card key={avatar.id} className={`overflow-hidden ${selected === avatar.id ? "border-cyan-400 ring-4 ring-cyan-50" : ""}`}><div className="relative flex h-64 items-center justify-center bg-slate-100 p-3"><AvatarCardPreview avatar={avatar} /><div className="absolute left-3 top-3"><Badge tone={selected === avatar.id ? "cyan" : "slate"}>{selected === avatar.id ? "当前绑定" : avatar.is_custom ? "自定义" : "系统形象"}</Badge></div></div><div className="p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{avatar.name || avatar.id}</h3><p className="mt-1 text-xs text-slate-400">{avatar.id}</p></div><Badge tone="green">{avatar.model_type}</Badge></div><div className="mt-4 flex gap-2"><Button variant={selected === avatar.id ? "primary" : "secondary"} onClick={() => setSelected(avatar.id)} className="flex-1">{selected === avatar.id ? "已绑定" : "绑定"}</Button><Button variant="ghost" onClick={() => onDebug?.(avatar.id)}>直接调试</Button>{avatar.is_custom ? <Button variant="danger" onClick={() => void remove(avatar)}>删除</Button> : null}</div></div></Card>)}</div><Pagination page={avatarPagination.page} pageCount={avatarPagination.pageCount} total={avatars.length} onChange={avatarPagination.setPage} /></> }</div>;
}

function GifThumb({ item }: { item: GifAssetMeta }) {
  const isDirect = item.previewUrl.startsWith("blob:") || item.previewUrl.startsWith("data:") || item.previewUrl.startsWith("http");
  const [src, setSrc] = useState(isDirect ? item.previewUrl : "");
  useEffect(() => {
    if (isDirect || !item.previewUrl) return;
    let revoke = "";
    let cancelled = false;
    void adminApi.fetchGifBlobUrl(item.id).then((url) => { if (cancelled) { URL.revokeObjectURL(url); return; } revoke = url; setSrc(url); }).catch(() => setSrc(""));
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [item.id, item.previewUrl, isDirect]);
  if (!src) return <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">{item.previewUrl ? "加载中…" : "暂无预览"}</div>;
  return <img src={src} alt={item.name} className="h-full w-full object-cover" />;
}

export function EnhancedGifPage() {
  const [items, setItems] = useState<GifAssetMeta[]>([]);
  const [editing, setEditing] = useState<GifAssetMeta | null>(null);
  const [detail, setDetail] = useState<GifAssetMeta | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ name: "", scene: "welcome", tags: "欢迎,微笑" });
  const [error, setError] = useState("");
  const pagination = usePagination(items);
  const reload = () => { void adminApi.listGifs().then(setItems); };
  useEffect(reload, []);
  const save = async () => { if (!file || !form.name.trim()) { setError("请选择 Gif 文件并填写名称。"); return; } if (!file.name.toLowerCase().endsWith(".gif") || file.size > 20 * 1024 * 1024) { setError("仅支持 20MB 以内的 .gif 文件。"); return; } try { await adminApi.uploadGif(file, { name: form.name.trim(), scene: form.scene, tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Gif 上传失败。"); return; } setFile(null); setForm({ name: "", scene: "welcome", tags: "欢迎,微笑" }); setError(""); reload(); };
  const update = async () => { if (!editing) return; const item = await adminApi.updateGif(editing.id, { name: editing.name, scene: editing.scene, tags: editing.tags, status: editing.status }); setItems((current) => current.map((candidate) => candidate.id === item.id ? item : candidate)); setEditing(null); };
  return <div className="p-6 xl:p-8"><Header eyebrow="数字人中心 / 动作素材" title="Gif 动作素材" description="管理迎宾、讲解、问答、待机和应急场景的动图资产。" action={<Button onClick={() => setForm((current) => ({ ...current, name: current.name || "新动作素材" }))}>+ 添加 Gif</Button>} />{form.name ? <Modal title="添加 Gif 动作素材" onClose={() => setForm({ name: "", scene: "welcome", tags: "欢迎,微笑" })} onSave={() => void save()} saveLabel="上传素材"><Field label="素材名称" value={form.name} onChange={(value) => setForm({ ...form, name: value })} /><label className="mt-4 block rounded-xl border border-dashed border-cyan-300 bg-cyan-50 p-5 text-center text-xs text-cyan-700">选择 .gif 文件<input type="file" accept=".gif,image/gif" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />{file ? <p className="mt-2 font-semibold">{file.name}</p> : null}</label><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">场景<select value={form.scene} onChange={(event) => setForm({ ...form, scene: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="welcome">welcome</option><option value="explain">explain</option><option value="qa">qa</option><option value="idle">idle</option><option value="emergency">emergency</option></select></label><Field label="标签（逗号分隔）" value={form.tags} onChange={(value) => setForm({ ...form, tags: value })} /></div>{error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}</Modal> : null}<div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{pagination.pageItems.map((item) => <Card key={item.id} className="overflow-hidden"><div className="relative h-44 bg-slate-100"><GifThumb item={item} /><div className="absolute left-3 top-3"><Badge tone="cyan">{item.scene}</Badge></div></div><div className="p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{item.name}</h3><p className="mt-1 text-xs text-slate-400">{item.width} × {item.height} · {item.frames} 帧</p></div><Badge tone={item.status === "active" ? "green" : "slate"}>{item.status === "active" ? "启用" : "停用"}</Badge></div><div className="mt-3 flex flex-wrap gap-1">{item.tags.map((tag) => <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-500">#{tag}</span>)}</div><div className="mt-4 flex justify-end gap-1"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button><Button variant="ghost" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => { if (window.confirm(`确认删除“${item.name}”？`)) void adminApi.deleteGif(item.id).then(reload); }}>删除</Button></div></div></Card>)}</div><Pagination page={pagination.page} pageCount={pagination.pageCount} total={items.length} onChange={pagination.setPage} />{editing ? <Modal title="编辑 Gif 元数据" onClose={() => setEditing(null)} onSave={() => void update()}><Field label="素材名称" value={editing.name} onChange={(value) => setEditing({ ...editing, name: value })} /><label className="mt-4 block text-xs font-semibold text-slate-600">场景<select value={editing.scene} onChange={(event) => setEditing({ ...editing, scene: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="welcome">welcome</option><option value="explain">explain</option><option value="qa">qa</option><option value="idle">idle</option><option value="emergency">emergency</option></select></label><Field label="标签" value={editing.tags.join(",")} onChange={(value) => setEditing({ ...editing, tags: value.split(",").map((tag) => tag.trim()).filter(Boolean) })} /></Modal> : null}{detail ? <Detail title="Gif 素材详情" onClose={() => setDetail(null)} rows={[["名称", detail.name], ["文件", detail.fileName], ["场景", detail.scene], ["标签", detail.tags.join("、")], ["尺寸", `${detail.width} × ${detail.height}`], ["帧数", detail.frames], ["时长", `${detail.durationMs} ms`], ["大小", `${Math.round(detail.sizeBytes / 1024)} KB`]]} /> : null}</div>;
}

function voiceCategoryKey(voice: VoiceAsset): string {
  return voice.targetModel?.trim() || voice.provider;
}

function voiceCategoryLabel(voice: VoiceAsset): string {
  if (voice.targetModel) return voice.targetModel;
  return { edge: "Edge TTS", dashscope: "DashScope", cosyvoice: "CosyVoice", sambert: "Sambert", local_cosyvoice: "本地 CosyVoice", indextts: "IndexTTS", local_f5_tts: "本地 F5-TTS", xiaomi_mimo: "小米 MiMo", openai_compatible: "OpenAI 兼容" }[voice.provider] ?? voice.provider;
}

function backendVoiceAsset(item: Awaited<ReturnType<typeof openTalkingClient.listVoices>>[number]): VoiceAsset {
  return { id: `backend-${item.provider}-${item.id}`, backendId: item.id, provider: item.provider, targetModel: item.target_model, voiceId: item.voice_id, name: item.display_label, previewText: "您好，欢迎来到四川博览集团数字人项目。", status: "active", source: item.source };
}

function mergeVoiceAssets(...groups: VoiceAsset[][]): VoiceAsset[] {
  return Array.from(new Map(groups.flat().map((voice) => [`${voice.provider}:${voice.voiceId}`, voice])).values());
}

export function EnhancedVoicePage() {
  const [voices, setVoices] = useState<VoiceAsset[]>(DEFAULT_VOICES);
  const [editing, setEditing] = useState<VoiceAsset | null>(null);
  const [detail, setDetail] = useState<VoiceAsset | null>(null);
  const [playing, setPlaying] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      const [backendResult, localConfigs, health] = await Promise.all([
        openTalkingClient.listVoices(),
        adminApi.listVoiceConfigs(),
        apiGet<TtsHealthSummary>("/health").catch(() => ({} as TtsHealthSummary)),
      ]);
      const backendVoices = backendResult.map(backendVoiceAsset);
      const enabledProviders = health.tts_enabled_providers ?? [];
      const edgeEnabled = !enabledProviders.length || enabledProviders.includes("edge");
      setVoices(mergeVoiceAssets(localConfigs, backendVoices, edgeEnabled ? DEFAULT_VOICES : []));
      setError("");
    } catch (caught) {
      const localConfigs = await adminApi.listVoiceConfigs().catch(() => [] as VoiceAsset[]);
      setVoices(mergeVoiceAssets(localConfigs, DEFAULT_VOICES));
      setError(caught instanceof ApiError ? caught.message : "音色目录读取失败，当前显示本地配置。 ");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const categoryItems = Array.from(new Map(voices.map((voice) => [voiceCategoryKey(voice), { key: voiceCategoryKey(voice), label: voiceCategoryLabel(voice) }])).values());
  const filteredVoices = category === "all" ? voices : voices.filter((voice) => voiceCategoryKey(voice) === category);
  const pagination = usePagination(filteredVoices);
  const preview = async (voice: VoiceAsset) => { setPlaying(voice.id); setError(""); try { const blob = await openTalkingClient.previewTts({ text: voice.previewText, voice: voice.voiceId, provider: voice.provider, model: voice.targetModel }); const audio = new Audio(URL.createObjectURL(blob)); audio.onended = () => { URL.revokeObjectURL(audio.src); setPlaying(""); }; await audio.play(); } catch (caught) { setPlaying(""); setError(caught instanceof ApiError ? caught.message : `“${voice.name}”试听失败，请检查该模型的服务配置。`); } };
  const save = async () => { if (!editing?.name.trim() || !editing.voiceId.trim() || !editing.provider.trim()) { setError("请填写名称、Provider 和音色 ID。 "); return; } try { const saved = await adminApi.saveVoiceConfig({ ...editing, id: editing.id.startsWith("voice-local-") ? editing.id : `voice-local-${Date.now()}`, name: editing.name.trim(), provider: editing.provider.trim(), targetModel: editing.targetModel?.trim() || null, voiceId: editing.voiceId.trim(), source: "local" }); setVoices((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setEditing(null); setError(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "声音配置保存失败。 "); } };
  const remove = async (voice: VoiceAsset) => { if (voice.source === "system") { setError("系统音色由后端统一维护，不能在此删除。 "); return; } if (!window.confirm(`确认删除“${voice.name}”配置？`)) return; try { if (voice.source === "clone" && typeof voice.backendId === "number") await openTalkingClient.deleteVoiceEntry(voice.backendId); else await adminApi.deleteVoiceConfig(voice.id); await load(); } catch (caught) { setError(caught instanceof ApiError ? caught.message : "音色删除失败，请确认后端服务状态。 "); } };
  const isLocal = (voice: VoiceAsset) => voice.source !== "system" && voice.source !== "clone";
  return <div className="p-6 xl:p-8"><Header eyebrow="数字人中心 / 声音配置" title="声音配置" description="音色目录按模型类别分组；试听会携带对应 Provider 和模型参数，系统音色只读，本地配置可持久化管理。" action={<Button onClick={() => setEditing({ id: `voice-local-${Date.now()}`, provider: "local_cosyvoice", targetModel: "FunAudioLLM/Fun-CosyVoice3-0.5B-2512", voiceId: "", name: "", previewText: "您好，欢迎来到四川博览集团数字人项目。", status: "active", source: "local" })}>+ 添加本地配置</Button>} />{error ? <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">{error}</p> : null}<Card className="mb-5 p-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setCategory("all")} className={`rounded-xl px-3 py-2 text-xs font-semibold ${category === "all" ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-600"}`}>全部模型 <span className="ml-1 opacity-70">{voices.length}</span></button>{categoryItems.map((item) => <button type="button" key={item.key} onClick={() => setCategory(item.key)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${category === item.key ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-600"}`}>{item.label} <span className="ml-1 opacity-70">{voices.filter((voice) => voiceCategoryKey(voice) === item.key).length}</span></button>)}</div></Card>{loading ? <Card className="p-10 text-center text-sm text-slate-400">正在读取后端音色目录…</Card> : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{pagination.pageItems.map((voice) => <Card key={voice.id} className="p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-semibold text-slate-900">{voice.name}</h3><p className="mt-1 text-xs text-slate-400">{voice.provider} · {voice.voiceId}</p><p className="mt-1 truncate text-[11px] text-cyan-700">模型类别：{voiceCategoryLabel(voice)}</p></div><Badge tone={voice.source === "clone" ? "violet" : voice.source === "system" ? "green" : "cyan"}>{voice.source === "clone" ? "复刻音色" : voice.source === "system" ? "系统音色" : "本地配置"}</Badge></div><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">{voice.previewText}</p><div className="mt-4 flex flex-wrap justify-end gap-1"><Button variant="secondary" className="whitespace-nowrap" onClick={() => void preview(voice)} disabled={playing === voice.id}>{playing === voice.id ? "试听中…" : "试听"}</Button><Button variant="ghost" className="whitespace-nowrap" onClick={() => setDetail(voice)}>详情</Button>{isLocal(voice) ? <><Button variant="ghost" className="whitespace-nowrap" onClick={() => setEditing(voice)}>编辑配置</Button><Button variant="danger" className="whitespace-nowrap" onClick={() => void remove(voice)}>删除配置</Button></> : voice.source === "clone" ? <Button variant="danger" className="whitespace-nowrap" onClick={() => void remove(voice)}>删除后端音色</Button> : null}</div></Card>)}</div>}{!loading ? <Pagination page={pagination.page} pageCount={pagination.pageCount} total={filteredVoices.length} onChange={pagination.setPage} /> : null}{editing ? <Modal title="本地声音配置" onClose={() => setEditing(null)} onSave={() => void save()}><Field label="配置名称" value={editing.name} onChange={(value) => setEditing({ ...editing, name: value })} placeholder="例如：展会中文女声" /><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-600">Provider<select value={editing.provider} onChange={(event) => setEditing({ ...editing, provider: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="edge">Edge TTS</option><option value="dashscope">DashScope</option><option value="cosyvoice">CosyVoice</option><option value="sambert">Sambert</option><option value="local_cosyvoice">本地 CosyVoice</option><option value="indextts">IndexTTS</option><option value="local_f5_tts">本地 F5-TTS</option><option value="xiaomi_mimo">小米 MiMo</option><option value="openai_compatible">OpenAI 兼容</option></select></label><Field label="模型类别 / tts_model" value={editing.targetModel ?? ""} onChange={(value) => setEditing({ ...editing, targetModel: value })} placeholder="例如：mimo-v2.5-tts" /></div><div className="mt-4"><Field label="音色 ID" value={editing.voiceId} onChange={(value) => setEditing({ ...editing, voiceId: value })} placeholder="例如：mimo_default" /></div><div className="mt-4"><Field label="试听文本" value={editing.previewText} onChange={(value) => setEditing({ ...editing, previewText: value })} textarea /></div></Modal> : null}{detail ? <Detail title="声音详情" onClose={() => setDetail(null)} rows={[["名称", detail.name], ["模型类别", voiceCategoryLabel(detail)], ["Provider", detail.provider], ["tts_model", detail.targetModel || "无需单独指定"], ["音色 ID", detail.voiceId], ["后端 ID", detail.backendId ?? "本地配置"], ["来源", detail.source ?? "本地配置"], ["试听文本", detail.previewText], ["状态", detail.status]]} /> : null}</div>;
}

export function EnhancedScenePage() {
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [backgrounds, setBackgrounds] = useState<SceneBackgroundAsset[]>([]);
  const [compositions, setCompositions] = useState<SceneComposition[]>([]);
  const [composition, setComposition] = useState<SceneComposition | null>(null);
  const [backgroundForm, setBackgroundForm] = useState<{ file: File | null; name: string }>({ file: null, name: "" });
  const [error, setError] = useState("");
  const compositionPagination = usePagination(compositions);
  const backgroundPagination = usePagination(backgrounds);
  const reload = () => void Promise.all([openTalkingClient.listAvatars(), openTalkingClient.listSceneBackgrounds(), openTalkingClient.listSceneCompositions()]).then(([nextAvatars, nextBackgrounds, nextCompositions]) => {
    setAvatars(nextAvatars);
    setBackgrounds(nextBackgrounds);
    setCompositions(nextCompositions);
  }).catch(() => setError("无法读取真实后端场景资产，请检查服务状态。"));
  useEffect(reload, []);
  const saveBackground = async () => {
    if (!backgroundForm.file) { setError("请选择背景文件。"); return; }
    try {
      await openTalkingClient.uploadSceneBackground({ file: backgroundForm.file, name: backgroundForm.name });
      setBackgroundForm({ file: null, name: "" });
      reload();
    } catch { setError("背景上传失败，请检查文件格式和后端权限。"); }
  };
  const saveComposition = async () => {
    if (!composition?.name.trim() || !composition.avatar_id) return;
    const payload = { name: composition.name.trim(), avatar_id: composition.avatar_id, background_id: composition.background_id, background_color: composition.background_color, avatar_fit: composition.avatar_fit, avatar_scale: composition.avatar_scale, avatar_anchor: composition.avatar_anchor, matting_required: composition.matting_required, subtitle_style: composition.subtitle_style };
    try {
      const saved = composition.id.startsWith("new-") ? await openTalkingClient.createSceneComposition(payload) : await openTalkingClient.updateSceneComposition(composition.id, payload);
      setCompositions((current) => [saved, ...current.filter((item) => item.id !== composition.id)]);
      setComposition(null);
    } catch { setError("场景组合保存失败，请确认 avatar_id 和背景资产有效。"); }
  };
  const removeComposition = async (item: SceneComposition) => { if (!window.confirm(`确认删除场景组合“${item.name}”？`)) return; try { await openTalkingClient.deleteSceneComposition(item.id); setCompositions((current) => current.filter((candidate) => candidate.id !== item.id)); } catch { setError("场景组合删除失败。"); } };
  const removeBackground = async (item: SceneBackgroundAsset) => { if (!window.confirm(`确认删除背景“${item.name}”？`)) return; try { await openTalkingClient.deleteSceneBackground(item.id); setBackgrounds((current) => current.filter((candidate) => candidate.id !== item.id)); } catch { setError("背景删除失败，可能仍被场景组合引用。"); } };
  const newComposition = () => setComposition({ id: `new-${Date.now()}`, name: "新场景组合", avatar_id: avatars[0]?.id ?? "", background_id: backgrounds[0]?.id ?? null, background_color: "#0f172a", avatar_fit: "contain", avatar_scale: 1, avatar_anchor: "center", matting_required: false, subtitle_style: "lower-third", created_at: "", updated_at: "" });
  return <div className="p-6 xl:p-8"><Header eyebrow="数字人中心 / 真实后端" title="场景绑定" description="真实管理 /scene-assets/backgrounds 与 /scene-assets/compositions，支持新增、编辑、详情和删除。" action={<Button onClick={newComposition}>+ 新建场景组合</Button>} />{error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}<div className="grid gap-5 xl:grid-cols-[1fr_1fr]"><Card className="p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">场景组合</h2><p className="mt-1 text-xs text-slate-400">{compositions.length} 个真实后端配置</p></div></div><div className="mt-4 space-y-3">{compositionPagination.pageItems.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-xs text-slate-400">形象：{item.avatar_id} · 背景：{item.background_id || "纯色背景"}</p></div><Badge tone="cyan">已发布配置</Badge></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500"><span>适配：{item.avatar_fit}</span><span>缩放：{item.avatar_scale}</span><span>锚点：{item.avatar_anchor}</span><span>字幕：{item.subtitle_style}</span></div><div className="mt-4 flex justify-end gap-1"><Button variant="ghost" onClick={() => setComposition(item)}>编辑</Button><Button variant="ghost" onClick={() => setComposition(item)}>详情</Button><Button variant="danger" onClick={() => void removeComposition(item)}>删除</Button></div></div>)}{!compositions.length ? <p className="py-12 text-center text-xs text-slate-400">后端暂无场景组合，可新建一条。</p> : null}</div><Pagination page={compositionPagination.page} pageCount={compositionPagination.pageCount} total={compositions.length} onChange={compositionPagination.setPage} /></Card><Card className="p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">背景资产</h2><p className="mt-1 text-xs text-slate-400">{backgrounds.length} 个真实后端背景</p></div><Button variant="secondary" onClick={() => setBackgroundForm({ file: null, name: "新背景" })}>+ 上传背景</Button></div><div className="mt-4 space-y-3">{backgroundPagination.pageItems.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><img src={openTalkingClient.assetUrl(item.url)} alt={item.name} className="h-16 w-24 rounded-lg bg-slate-100 object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-xs text-slate-400">{item.filename} · {Math.round(item.size_bytes / 1024)} KB</p></div><Button variant="danger" onClick={() => void removeBackground(item)}>删除</Button></div>)}{!backgrounds.length ? <p className="py-12 text-center text-xs text-slate-400">后端暂无背景资产。</p> : null}</div><Pagination page={backgroundPagination.page} pageCount={backgroundPagination.pageCount} total={backgrounds.length} onChange={backgroundPagination.setPage} /></Card></div>{composition ? <Modal title={composition.id.startsWith("new-") ? "新建场景组合" : "编辑场景组合"} onClose={() => setComposition(null)} onSave={() => void saveComposition()}><Field label="组合名称" value={composition.name} onChange={(value) => setComposition({ ...composition, name: value })} /><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">数字人形象<select value={composition.avatar_id} onChange={(event) => setComposition({ ...composition, avatar_id: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal">{avatars.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">背景<select value={composition.background_id ?? ""} onChange={(event) => setComposition({ ...composition, background_id: event.target.value || null })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="">纯色背景</option>{backgrounds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">适配方式<select value={composition.avatar_fit} onChange={(event) => setComposition({ ...composition, avatar_fit: event.target.value as SceneComposition["avatar_fit"] })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="contain">contain</option><option value="cover">cover</option></select></label><Field label="缩放比例" value={String(composition.avatar_scale)} onChange={(value) => setComposition({ ...composition, avatar_scale: Number(value) || 1 })} /></div><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">锚点<select value={composition.avatar_anchor} onChange={(event) => setComposition({ ...composition, avatar_anchor: event.target.value as SceneComposition["avatar_anchor"] })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="center">center</option><option value="bottom">bottom</option><option value="left">left</option><option value="right">right</option></select></label><label className="text-xs font-semibold text-slate-600">字幕样式<select value={composition.subtitle_style} onChange={(event) => setComposition({ ...composition, subtitle_style: event.target.value as SceneComposition["subtitle_style"] })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="none">none</option><option value="compact">compact</option><option value="lower-third">lower-third</option></select></label></div></Modal> : null}{backgroundForm.name ? <Modal title="上传背景资产" onClose={() => setBackgroundForm({ file: null, name: "" })} onSave={() => void saveBackground()} saveLabel="上传到后端"><Field label="背景名称" value={backgroundForm.name} onChange={(value) => setBackgroundForm({ ...backgroundForm, name: value })} /><label className="mt-4 block rounded-xl border border-dashed border-cyan-300 bg-cyan-50 p-5 text-center text-xs text-cyan-700">选择图片或视频<input type="file" accept="image/*,video/*" className="sr-only" onChange={(event) => setBackgroundForm({ ...backgroundForm, file: event.target.files?.[0] ?? null })} />{backgroundForm.file ? <p className="mt-2 font-semibold">{backgroundForm.file.name}</p> : null}</label></Modal> : null}</div>;
}

export function EnhancedIdlePage() {
  const [items, setItems] = useState<IdleContent[]>([]);
  const [editing, setEditing] = useState<IdleContent | null>(null);
  const [detail, setDetail] = useState<IdleContent | null>(null);
  const pagination = usePagination(items);
  useEffect(() => { void adminApi.listIdle().then(setItems); }, []);
  const save = async () => { if (!editing?.title.trim() || !editing.content.trim()) return; const item = await adminApi.saveIdle(editing); setItems((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)]); setEditing(null); };
  return <div className="p-6 xl:p-8"><Header eyebrow="数字人中心 / 待机内容" title="待机内容" description="配置宣传片、标语轮播和活动主题。" action={<Button onClick={() => setEditing({ id: `idle-${Date.now()}`, type: "标语轮播", title: "", content: "", interval: 8, exhibition: "2026 西部博览会", enabled: true })}>+ 添加内容</Button>} /><Card className="divide-y divide-slate-100">{pagination.pageItems.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-4 px-5 py-4"><div className="min-w-[180px] flex-1"><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-900">{item.title}</h3><Badge tone={item.enabled ? "green" : "slate"}>{item.enabled ? "启用" : "停用"}</Badge></div><p className="mt-1 text-xs text-slate-400">{item.type} · {item.interval}s · {item.exhibition}</p><p className="mt-2 text-sm text-slate-600">{item.content}</p></div><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => { if (window.confirm(`确认删除“${item.title}”？`)) setItems((current) => current.filter((candidate) => candidate.id !== item.id)); }}>删除</Button></div>)}</Card><Pagination page={pagination.page} pageCount={pagination.pageCount} total={items.length} onChange={pagination.setPage} />{editing ? <Modal title="待机内容表单" onClose={() => setEditing(null)} onSave={() => void save()}><Field label="标题" value={editing.title} onChange={(value) => setEditing({ ...editing, title: value })} /><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">类型<select value={editing.type} onChange={(event) => setEditing({ ...editing, type: event.target.value as IdleContent["type"] })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option>宣传片</option><option>标语轮播</option><option>活动主题</option></select></label><label className="text-xs font-semibold text-slate-600">轮播间隔<input type="number" value={editing.interval} onChange={(event) => setEditing({ ...editing, interval: Number(event.target.value) })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label></div><div className="mt-4"><Field label="内容" value={editing.content} onChange={(value) => setEditing({ ...editing, content: value })} textarea /></div></Modal> : null}{detail ? <Detail title="待机内容详情" onClose={() => setDetail(null)} rows={[["标题", detail.title], ["类型", detail.type], ["内容", detail.content], ["轮播间隔", `${detail.interval} 秒`], ["状态", detail.enabled ? "启用" : "停用"]]} /> : null}</div>;
}

export function EnhancedDocumentPage() {
  const [items, setItems] = useState<KnowledgeDocument[]>([]);
  const [detail, setDetail] = useState<KnowledgeDocument | null>(null);
  const [editing, setEditing] = useState<KnowledgeDocument | null>(null);
  const reload = () => { void adminApi.listDocuments().then(setItems); };
  useEffect(reload, []);
  const upload = async (file: File) => { const item = await adminApi.uploadDocument({ title: file.name.replace(/\.[^.]+$/, ""), fileName: file.name, type: "展商资料", exhibition: "2026 西部博览会" }); setItems((current) => [item, ...current]); };
  const update = async () => { if (!editing) return; const item = await adminApi.updateDocument(editing.id, { title: editing.title, type: editing.type, exhibition: editing.exhibition }); setItems((current) => current.map((candidate) => candidate.id === item.id ? item : candidate)); setEditing(null); };
  return <div className="p-6 xl:p-8"><Header eyebrow="知识中心" title="文档资料" description="管理文档、解析进度、向量化状态和切片信息。" action={<label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-cyan-700">+ 上传文档<input type="file" accept=".txt,.md,.csv,.doc,.docx,.pdf,.xls,.xlsx" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>} /><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">文档</th><th className="px-5 py-3">类型 / 展会</th><th className="px-5 py-3">解析</th><th className="px-5 py-3">向量化</th><th className="px-5 py-3">切片</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.title}</p><p className="mt-1 text-slate-400">{item.fileName} · {item.uploader}</p></td><td className="px-5 py-4 text-slate-500">{item.type}<p className="mt-1 text-slate-400">{item.exhibition}</p></td><td className="px-5 py-4"><Badge tone={item.parseStatus === "parsed" ? "green" : "amber"}>{item.parseStatus}</Badge></td><td className="px-5 py-4"><Badge tone={item.vectorStatus === "indexed" ? "green" : "amber"}>{item.vectorStatus}</Badge></td><td className="px-5 py-4 text-slate-600">{item.chunks}</td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button><Button variant="ghost" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => { if (window.confirm(`确认删除“${item.title}”？`)) void adminApi.deleteDocument(item.id).then(() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))); }}>删除</Button></td></tr>)}</tbody></table></div></Card>{editing ? <Modal title="编辑文档信息" onClose={() => setEditing(null)} onSave={() => void update()}><Field label="标题" value={editing.title} onChange={(value) => setEditing({ ...editing, title: value })} /><div className="mt-4 grid grid-cols-2 gap-3"><Field label="文档类型" value={editing.type} onChange={(value) => setEditing({ ...editing, type: value })} /><Field label="所属展会" value={editing.exhibition} onChange={(value) => setEditing({ ...editing, exhibition: value })} /></div></Modal> : null}{detail ? <Detail title="文档详情" onClose={() => setDetail(null)} rows={[["标题", detail.title], ["文件名", detail.fileName], ["类型", detail.type], ["展会", detail.exhibition], ["解析状态", detail.parseStatus], ["向量状态", detail.vectorStatus], ["切片数", detail.chunks], ["上传人", detail.uploader], ["上传时间", detail.uploadedAt]]} /> : null}</div>;
}

export function EnhancedQaPage() {
  const [items, setItems] = useState<KnowledgeQa[]>([]);
  const [editing, setEditing] = useState<KnowledgeQa | null>(null);
  const [detail, setDetail] = useState<KnowledgeQa | null>(null);
  useEffect(() => { void adminApi.listQa().then(setItems); }, []);
  const save = async () => { if (!editing?.question.trim() || !editing.answer.trim()) return; const item = await adminApi.saveQa({ ...editing, updatedAt: new Date().toISOString() }); setItems((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)]); setEditing(null); };
  const transition = async (id: string, status: KnowledgeQa["status"]) => { const item = await adminApi.transitionQa(id, status); setItems((current) => current.map((candidate) => candidate.id === id ? item : candidate)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="知识中心" title="问答知识" description="维护强控 QA、审核状态和版本历史。" action={<Button onClick={() => setEditing({ id: `qa-${Date.now()}`, question: "", keywords: [], answer: "", category: "展会", exhibition: "2026 西部博览会", status: "draft", version: 1, creator: "当前用户", updatedAt: "", history: [] })}>+ 添加问答</Button>} /><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">问题 / 答案</th><th className="px-5 py-3">分类</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">版本</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id} className="align-top"><td className="max-w-md px-5 py-4"><p className="font-semibold text-slate-800">{item.question}</p><p className="mt-2 leading-5 text-slate-500">{item.answer}</p></td><td className="px-5 py-4 text-slate-500">{item.category}<p className="mt-1 text-slate-400">{item.keywords.join("、") || "无关键词"}</p></td><td className="px-5 py-4"><Badge tone={item.status === "published" ? "green" : item.status === "pending_review" ? "amber" : "slate"}>{item.status}</Badge></td><td className="px-5 py-4 text-slate-600">v{item.version}</td><td className="whitespace-nowrap px-5 py-4"> <Button variant="ghost" onClick={() => setDetail(item)}>详情</Button><Button variant="ghost" onClick={() => setEditing(item)}>编辑</Button>{item.status === "draft" ? <Button variant="secondary" onClick={() => void transition(item.id, "pending_review")}>提交审核</Button> : item.status === "pending_review" ? <Button onClick={() => void transition(item.id, "published")}>通过</Button> : <Button variant="danger" onClick={() => void adminApi.deleteQa(item.id).then(() => setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "archived" } : candidate)))}>归档</Button>}</td></tr>)}</tbody></table></div></Card>{editing ? <Modal title="问答知识表单" onClose={() => setEditing(null)} onSave={() => void save()}><Field label="问题" value={editing.question} onChange={(value) => setEditing({ ...editing, question: value })} /><div className="mt-4 grid grid-cols-2 gap-3"><Field label="分类" value={editing.category} onChange={(value) => setEditing({ ...editing, category: value })} /><Field label="关键词" value={editing.keywords.join(",")} onChange={(value) => setEditing({ ...editing, keywords: value.split(",").map((item) => item.trim()).filter(Boolean) })} /></div><div className="mt-4"><Field label="官方答案" value={editing.answer} onChange={(value) => setEditing({ ...editing, answer: value })} textarea /></div></Modal> : null}{detail ? <Detail title="问答详情 / 版本历史" onClose={() => setDetail(null)} rows={[["问题", detail.question], ["答案", detail.answer], ["关键词", detail.keywords.join("、") || "无"], ["状态", detail.status], ["版本", `v${detail.version}`], ["创建人", detail.creator], ["历史版本", detail.history.length ? detail.history.map((history) => `v${history.version} · ${history.editor} · ${history.reason}`).join("；") : "暂无"]]} /> : null}</div>;
}

export function EnhancedScriptPage() {
  const [items, setItems] = useState<ScriptTemplate[]>([]);
  const [editing, setEditing] = useState<ScriptTemplate | null>(null);
  const [detail, setDetail] = useState<ScriptTemplate | null>(null);
  useEffect(() => { void adminApi.listScripts().then(setItems); }, []);
  const save = async () => { if (!editing?.name.trim() || !editing.content.trim()) return; const item = await adminApi.saveScript({ ...editing, updatedAt: new Date().toISOString().slice(0, 10) }); setItems((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)]); setEditing(null); };
  return <div className="p-6 xl:p-8"><Header eyebrow="知识中心" title="官方话术" description="维护迎宾、讲解、导购和应急话术模板。" action={<Button onClick={() => setEditing({ id: `script-${Date.now()}`, name: "", scene: "welcome", content: "", exhibition: "2026 西部博览会", status: "active", updatedAt: "" })}>+ 添加话术</Button>} /><div className="grid gap-5 lg:grid-cols-2">{items.map((item) => <Card key={item.id} className="p-5"><div className="flex items-start justify-between"><div><h3 className="font-semibold text-slate-900">{item.name}</h3><p className="mt-1 text-xs text-slate-400">{item.scene} · {item.exhibition}</p></div><Badge tone={item.status === "active" ? "green" : "slate"}>{item.status === "active" ? "启用" : "停用"}</Badge></div><p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">{item.content}</p><div className="mt-4 flex justify-end gap-1"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button><Button variant="danger" onClick={() => { if (window.confirm(`确认删除“${item.name}”？`)) void adminApi.deleteScript(item.id).then(() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))); }}>删除</Button></div></Card>)}</div>{editing ? <Modal title="官方话术表单" onClose={() => setEditing(null)} onSave={() => void save()}><Field label="模板名称" value={editing.name} onChange={(value) => setEditing({ ...editing, name: value })} /><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">场景<select value={editing.scene} onChange={(event) => setEditing({ ...editing, scene: event.target.value as ScriptTemplate["scene"] })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="welcome">welcome 迎宾</option><option value="explain">explain 讲解</option><option value="shopping">shopping 导购</option><option value="emergency">emergency 应急</option></select></label><Field label="所属展会" value={editing.exhibition} onChange={(value) => setEditing({ ...editing, exhibition: value })} /></div><div className="mt-4"><Field label="话术内容" value={editing.content} onChange={(value) => setEditing({ ...editing, content: value })} textarea /></div></Modal> : null}{detail ? <Detail title="话术详情" onClose={() => setDetail(null)} rows={[["模板名称", detail.name], ["场景", detail.scene], ["内容", detail.content], ["展会", detail.exhibition], ["状态", detail.status]]} /> : null}</div>;
}

export function EnhancedPackagePage() {
  const [tab, setTab] = useState<"packages" | "miss">("packages");
  const [packages, setPackages] = useState<PublishPackage[]>([]);
  const [miss, setMiss] = useState<MissPoolItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [detail, setDetail] = useState<PublishPackage | MissPoolItem | null>(null);
  useEffect(() => { void Promise.all([adminApi.listPackages(), adminApi.listMissPool()]).then(([nextPackages, nextMiss]) => { setPackages(nextPackages); setMiss(nextMiss); }); }, []);
  const create = async () => { if (!name.trim()) return; const item = await adminApi.createPackage({ name, exhibition: "2026 西部博览会", qaCount: 0, documentCount: 0 }); setPackages((current) => [item, ...current]); setName(""); setEditing(false); };
  const transition = async (id: string, status: PublishPackage["status"]) => { const item = await adminApi.transitionPackage(id, status); setPackages((current) => current.map((candidate) => candidate.id === id ? item : candidate)); };
  const resolve = async (id: string, status: MissPoolItem["status"]) => { const item = await adminApi.resolveMiss(id, status); setMiss((current) => current.map((candidate) => candidate.id === id ? item : candidate)); };
  return <div className="p-6 xl:p-8"><Header eyebrow="知识中心" title="发布审核" description="管理发布包、审核流程、展会知识切换和未命中池。" action={<Button onClick={() => setEditing(true)}>+ 新建发布包</Button>} /><div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setTab("packages")} className={`rounded-lg px-4 py-2 text-xs font-semibold ${tab === "packages" ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500"}`}>发布包</button><button type="button" onClick={() => setTab("miss")} className={`rounded-lg px-4 py-2 text-xs font-semibold ${tab === "miss" ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500"}`}>未命中池</button></div><Card className="overflow-hidden">{tab === "packages" ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">发布包</th><th className="px-5 py-3">展会</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">内容</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{packages.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-slate-400">v{item.version} · {item.creator}</p></td><td className="px-5 py-4 text-slate-500">{item.exhibition}</td><td className="px-5 py-4"><Badge tone={item.status === "published" ? "green" : item.status === "pending_review" ? "amber" : "slate"}>{item.status}</Badge></td><td className="px-5 py-4 text-slate-500">{item.qaCount} QA · {item.documentCount} 文档</td><td className="whitespace-nowrap px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button>{item.status === "pending_review" ? <Button onClick={() => void transition(item.id, "published")}>发布</Button> : item.status === "published" ? <Button variant="danger" onClick={() => void transition(item.id, "rolled_back")}>回滚</Button> : <Button variant="secondary" onClick={() => void transition(item.id, "pending_review")}>提交审核</Button>}</td></tr>)}</tbody></table></div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3">问题</th><th className="px-5 py-3">次数</th><th className="px-5 py-3">最近询问</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{miss.map((item) => <tr key={item.id}><td className="px-5 py-4 font-medium text-slate-800">{item.question}</td><td className="px-5 py-4 text-slate-500">{item.count}</td><td className="px-5 py-4 text-slate-500">{item.lastAskedAt}</td><td className="px-5 py-4"><Badge tone={item.status === "pending" ? "amber" : "green"}>{item.status}</Badge></td><td className="px-5 py-4"><Button variant="ghost" onClick={() => setDetail(item)}>详情</Button>{item.status === "pending" ? <><Button variant="secondary" onClick={() => void resolve(item.id, "supplemented")}>补齐</Button><Button variant="ghost" onClick={() => void resolve(item.id, "converted_qa")}>转为 QA</Button></> : null}</td></tr>)}</tbody></table></div>}</Card>{editing ? <Modal title="新建发布包" onClose={() => setEditing(false)} onSave={() => void create()}><Field label="发布包名称" value={name} onChange={setName} placeholder="例如：西博会知识包 v4" /><p className="mt-3 text-xs text-slate-400">创建后可继续选择已发布 QA 与已解析文档。</p></Modal> : null}{detail && "question" in detail ? <Detail title="未命中问题详情" onClose={() => setDetail(null)} rows={[["问题", detail.question], ["询问次数", detail.count], ["首次询问", detail.firstAskedAt], ["最近询问", detail.lastAskedAt], ["状态", detail.status]]} /> : detail ? <Detail title="发布包详情" onClose={() => setDetail(null)} rows={[["名称", detail.name], ["展会", detail.exhibition], ["状态", detail.status], ["版本", `v${detail.version}`], ["QA 数", detail.qaCount], ["文档数", detail.documentCount], ["创建人", detail.creator], ["更新时间", detail.updatedAt]]} /> : null}</div>;
}
