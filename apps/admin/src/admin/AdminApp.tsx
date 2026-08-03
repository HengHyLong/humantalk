import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AvatarSummary } from "../lib/api";
import { DEFAULT_VOICES, adminApi } from "./api";
import { canAccess, canUseButton, roleLabel } from "./policy";
import { openTalkingClient } from "./openTalkingClient";
import { RealtimeTestWorkspace } from "./RealtimeTestWorkspace";
import { ExhibitionDetailPage, ExhibitionPage, ExhibitorPage, ExhibitPage, RoutePage, SchedulePage, VenuePage } from "./EventOperationsPages";
import { DocumentCenterPage, KnowledgeBasePage, MemoryCenterPage } from "./KnowledgeCenterPages";
import {
  EnhancedAvatarPage,
  EnhancedGifPage,
  EnhancedIdlePage,
  EnhancedPackagePage,
  EnhancedQaPage,
  EnhancedScenePage,
  EnhancedScriptPage,
  EnhancedVoicePage,
} from "./CrudPages";
import type {
  AdminRole,
  AdminUser,
  DashboardData,
  GifAssetMeta,
  IdleContent,
  KnowledgeDocument,
  KnowledgeQa,
  MenuItem,
  MissPoolItem,
  PublishPackage,
  SceneBinding,
  ScriptTemplate,
} from "./types";

type AdminPath = string;

const MENU_GROUPS: MenuItem[] = [
  { id: "dashboard", label: "首页", path: "/dashboard", permission: "dashboard:view" },
  {
    id: "event", label: "展会运营", children: [
      { id: "event-exhibition", label: "展会管理", path: "/event/exhibition", permission: "event:exhibition" },
      { id: "event-exhibitor", label: "展商管理", path: "/event/exhibitor", permission: "event:exhibitor" },
      { id: "event-exhibit", label: "展品管理", path: "/event/exhibit", permission: "event:exhibit" },
      { id: "event-venue", label: "场地管理", path: "/event/venue", permission: "event:venue" },
      { id: "event-route", label: "场地路线", path: "/event/route", permission: "event:route" },
      { id: "event-schedule", label: "活动排期", path: "/event/schedule", permission: "event:schedule" },
    ],
  },
  {
    id: "asset", label: "数字人中心", children: [
      { id: "asset-avatar", label: "数字人形象", path: "/asset/avatar", permission: "asset:avatar" },
      { id: "asset-voice", label: "声音配置", path: "/asset/voice", permission: "asset:voice" },
      { id: "asset-scene", label: "场景绑定", path: "/asset/scene", permission: "asset:scene" },
      { id: "asset-idle", label: "待机内容", path: "/asset/idle", permission: "asset:idle" },
    ],
  },
  {
    id: "knowledge", label: "知识中心", children: [
      { id: "knowledge-document", label: "文档资料", path: "/knowledge/document", permission: "knowledge:document" },
      { id: "knowledge-base", label: "知识库", path: "/knowledge/base", permission: "knowledge:base" },
      { id: "knowledge-memory", label: "记忆库", path: "/knowledge/memory", permission: "knowledge:memory" },
    ],
  },
  {
    id: "interact", label: "交互管理", children: [
      { id: "interact-test", label: "实时测试", path: "/interact/test", permission: "interact:test" },
      { id: "interact-welcome", label: "欢迎配置", path: "/interact/welcome", permission: "interact:welcome", enabled: false },
      { id: "interact-explain", label: "讲解流程", path: "/interact/explain", permission: "interact:explain", enabled: false },
      { id: "interact-shopping", label: "导购策略", path: "/interact/shopping", permission: "interact:shopping", enabled: false },
    ],
  },
  { id: "lead", label: "线索运营", path: "/lead", permission: "lead:view", enabled: false },
  { id: "report", label: "数据分析", path: "/report/interaction", permission: "report:interaction", enabled: false },
  { id: "system", label: "系统管理", path: "/system/user", permission: "system:user", enabled: false },
];

const PAGE_LABELS: Record<string, string> = {
  "/dashboard": "概览",
  "/dashboard/todo": "待办",
  "/event/exhibition": "展会管理",
  "/event/exhibition/detail": "展会详情",
  "/event/exhibitor": "展商管理",
  "/event/exhibit": "展品管理",
  "/event/venue": "场地管理",
  "/event/route": "场地路线",
  "/event/schedule": "活动排期",
  "/asset/avatar": "数字人形象",
  "/asset/gif": "动作素材",
  "/asset/voice": "声音配置",
  "/asset/scene": "场景绑定",
  "/asset/idle": "待机内容",
  "/knowledge/document": "文档资料",
  "/knowledge/base": "知识库",
  "/knowledge/memory": "记忆库",
  "/knowledge/qa": "问答知识",
  "/knowledge/script": "官方话术",
  "/knowledge/package": "发布审核",
  "/interact/test": "实时测试",
};

const GROUP_LABELS: Record<string, string> = { asset: "数字人中心", knowledge: "知识中心", interact: "交互管理" };

function useAdminPath(): [AdminPath, (next: string) => void] {
  const [path, setPath] = useState(() => window.location.pathname || "/dashboard");
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname || "/dashboard");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (next: string) => {
    const nextUrl = new URL(next, window.location.href);
    if (nextUrl.pathname === path && nextUrl.search === window.location.search) return;
    window.history.pushState({}, "", `${nextUrl.pathname}${nextUrl.search}`);
    setPath(nextUrl.pathname);
  };
  return [path, navigate];
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    calendar: "M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
    sparkle: "M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3zm6 12 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z",
    book: "M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2V5zm16 0a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2V5z",
    chat: "M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
    users: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m7-9a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm6-7a3 3 0 0 1 0 6m4 7v-1a4 4 0 0 0-3-3.87",
    chart: "M4 19V5m0 14h16M8 16v-4m4 4V8m4 8V6",
    settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v2m0 14v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M3 12h2m14 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    upload: "M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
    plus: "M12 5v14M5 12h14",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    chevron: "M9 5l7 7-7 7",
    logout: "M10 5H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h5m5-4 4-4-4-4m4 4H9",
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d={paths[name] ?? paths.grid} /></svg>;
}

function Logo() {
  return <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-cyan-300 shadow-sm"><Icon name="sparkle" /></div><div><p className="text-sm font-bold tracking-tight text-slate-950">四川博览集团数字人</p><p className="text-[11px] text-slate-500">项目运营管理后台</p></div></div>;
}

function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "cyan" | "green" | "amber" | "rose" | "violet" }) {
  const styles = { slate: "bg-slate-100 text-slate-600", cyan: "bg-cyan-50 text-cyan-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700", violet: "bg-violet-50 text-violet-700" };
  return <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold ${styles[tone]}`}>{children}</span>;
}

function Button({ children, onClick, variant = "primary", disabled = false, className = "", type = "button" }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; className?: string; type?: "button" | "submit" }) {
  const styles = { primary: "bg-cyan-600 text-white hover:bg-cyan-700", secondary: "border border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:text-cyan-700", ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-800", danger: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50" };
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${styles[variant]} ${className}`}>{children}</button>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600">{eyebrow}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{title}</h1><p className="mt-1 text-sm text-slate-500">{description}</p></div>{actions ? <div className="flex items-center gap-2">{actions}</div> : null}</div>;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>; }

function EmptyState({ title, description }: { title: string; description: string }) { return <div className="flex min-h-[240px] flex-col items-center justify-center text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Icon name="grid" /></div><h3 className="mt-4 text-sm font-semibold text-slate-800">{title}</h3><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{description}</p></div>; }

function DashboardPage({ navigate }: { navigate: (path: string) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => { void adminApi.getDashboard().then(setData); }, []);
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Overview" title="运营概览" description="掌握展会数字人运行状态与内容运营进度。" actions={<Button variant="secondary" onClick={() => navigate("/knowledge/base")}><Icon name="arrow" />查看待办</Button>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{(data?.metrics ?? []).map((metric) => <Card key={metric.id} className="p-5"><div className="flex items-start justify-between"><span className="text-xs font-medium text-slate-500">{metric.label}</span><span className={`h-2.5 w-2.5 rounded-full ${metric.tone === "green" ? "bg-emerald-400" : metric.tone === "amber" ? "bg-amber-400" : metric.tone === "rose" ? "bg-rose-400" : metric.tone === "violet" ? "bg-violet-400" : "bg-cyan-400"}`} /></div><p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{metric.value}</p><p className="mt-2 text-[11px] font-medium text-slate-400">{metric.trend}</p></Card>)}</div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]"><Card><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-slate-900">待办事项</h2><p className="mt-1 text-xs text-slate-400">需要运营团队关注的事项</p></div><Badge tone="amber">{data?.todos.length ?? 0} 项</Badge></div><div className="divide-y divide-slate-100">{(data?.todos ?? []).map((todo) => <button type="button" key={todo.id} onClick={() => navigate(todo.path)} className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600"><Icon name="arrow" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge tone="cyan">{todo.type}</Badge><p className="truncate text-sm font-medium text-slate-800">{todo.title}</p></div><p className="mt-1 text-xs text-slate-400">{todo.owner} · {todo.time}</p></div><Icon name="chevron" /></button>)}</div></Card><Card className="overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold text-slate-900">运行摘要</h2><p className="mt-1 text-xs text-slate-400">今日实时交互概况</p></div><div className="p-5"><div className="flex items-center gap-5"><div className="relative flex h-32 w-32 items-center justify-center rounded-full" style={{ background: "conic-gradient(#0e9fba 0 72%, #e2e8f0 72% 100%)" }}><div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white"><span className="text-2xl font-semibold text-slate-900">72%</span><span className="text-[11px] text-slate-400">命中率</span></div></div><div className="space-y-3 text-xs"><div><p className="text-slate-400">强控 QA 命中</p><p className="mt-1 font-semibold text-slate-800">46.8%</p></div><div><p className="text-slate-400">RAG 知识命中</p><p className="mt-1 font-semibold text-slate-800">25.2%</p></div><div><p className="text-slate-400">平均响应时长</p><p className="mt-1 font-semibold text-slate-800">1.8 s</p></div></div></div><div className="mt-6 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">当前展会：<span className="font-semibold text-slate-800">2026 西部博览会</span><br />18 台终端正在提供数字人服务。</div></div></Card></div>
  </div>;
}

export function AvatarPage() {
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { void openTalkingClient.listAvatars().then((items) => { setAvatars(items); setSelected(items[0]?.id ?? ""); }).catch(() => setAvatars([])).finally(() => setLoading(false)); }, []);
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Digital Human Center" title="数字人形象" description="管理可用于展会服务的数字人形象，并绑定 OpenTalking avatar_id。" actions={<Button variant="secondary"><Icon name="upload" />导入形象</Button>} />{loading ? <Card className="p-8"><EmptyState title="正在读取形象" description="正在从 OpenTalking 获取可用形象。" /></Card> : avatars.length === 0 ? <Card className="p-8"><EmptyState title="暂无可用形象" description="请先确认 OpenTalking 服务已启动，或从本地导入数字人形象。" /></Card> : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{avatars.map((avatar) => { const active = avatar.id === selected; return <Card key={avatar.id} className={`overflow-hidden transition ${active ? "border-cyan-400 ring-4 ring-cyan-50" : ""}`}><div className="relative h-52 bg-slate-100"><img src={openTalkingClient.previewUrl(avatar.id)} alt={avatar.name || avatar.id} className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /><div className="absolute left-3 top-3"><Badge tone={active ? "cyan" : "slate"}>{active ? "当前绑定" : avatar.is_custom ? "自定义" : "系统形象"}</Badge></div></div><div className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{avatar.name || avatar.id}</h3><p className="mt-1 text-xs text-slate-400">avatar_id：{avatar.id}</p></div><Badge tone="green">{avatar.model_type}</Badge></div><div className="mt-4 flex gap-2"><Button variant={active ? "primary" : "secondary"} onClick={() => setSelected(avatar.id)} className="flex-1">{active ? "已绑定" : "绑定形象"}</Button><Button variant="ghost">查看详情</Button></div></div></Card>; })}</div>}</div>;
}

export function GifPage() {
  const [items, setItems] = useState<GifAssetMeta[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [scene, setScene] = useState("welcome");
  const [tags, setTags] = useState("欢迎,微笑");
  const [error, setError] = useState("");
  const reload = () => { void adminApi.listGifs().then(setItems); };
  useEffect(reload, []);
  const submit = async () => { if (!file || !name.trim()) { setError("请选择 Gif 文件并填写名称。"); return; } if (file.size > 20 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".gif")) { setError("仅支持 20MB 以内的 .gif 文件。"); return; } const previewUrl = URL.createObjectURL(file); await adminApi.createGif({ name: name.trim(), kind: "gif", previewUrl, scene, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), status: "active", width: 640, height: 360, frames: 24, durationMs: 1200, fileName: file.name, sizeBytes: file.size }); setShowForm(false); setFile(null); setName(""); setError(""); reload(); };
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Digital Human Center / Motion" title="动作素材" description="Gif 是展会数字人降级渲染和场景动作的核心素材。" actions={<Button onClick={() => setShowForm(true)}><Icon name="plus" />上传 Gif</Button>} />
    <Card className="mb-5 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-400" />已管理 {items.length} 个 Gif 动作素材</div><div className="flex gap-2"><select className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"><option>全部场景</option><option>迎宾 welcome</option><option>讲解 explain</option><option>待机 idle</option></select><input placeholder="搜索素材名称" className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-cyan-400" /></div></div></Card>
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <Card key={item.id} className="overflow-hidden"><div className="relative h-44 bg-slate-100"><img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" /><div className="absolute left-3 top-3"><Badge tone="cyan">{item.scene}</Badge></div></div><div className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{item.name}</h3><p className="mt-1 text-xs text-slate-400">{item.width} × {item.height} · {item.frames} 帧 · {item.durationMs} ms</p></div><Badge tone={item.status === "active" ? "green" : "slate"}>{item.status === "active" ? "启用" : "停用"}</Badge></div><div className="mt-3 flex flex-wrap gap-1.5">{item.tags.map((tag) => <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-500">#{tag}</span>)}</div><div className="mt-4 flex justify-end gap-2"><Button variant="ghost">预览</Button><Button variant="danger" onClick={() => { void adminApi.deleteGif(item.id).then(reload); }}>删除</Button></div></div></Card>)}</div>
    {showForm ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm"><Card className="w-full max-w-lg p-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-950">上传 Gif 动作素材</h2><p className="mt-1 text-xs text-slate-400">原始文件会保留，单个文件不超过 20MB。</p></div><button type="button" onClick={() => setShowForm(false)} className="text-2xl text-slate-300">×</button></div><label className="mt-5 block rounded-xl border border-dashed border-cyan-300 bg-cyan-50/50 p-5 text-center text-xs text-cyan-700"><Icon name="upload" /><span className="ml-2">选择 .gif 文件</span><input type="file" accept=".gif,image/gif" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />{file ? <p className="mt-2 font-semibold">{file.name}</p> : null}</label><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">素材名称<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-cyan-400" /></label><label className="text-xs font-semibold text-slate-600">关联场景<select value={scene} onChange={(event) => setScene(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-cyan-400"><option value="welcome">welcome 迎宾</option><option value="explain">explain 讲解</option><option value="qa">qa 问答</option><option value="navigation">navigation 导览</option><option value="idle">idle 待机</option></select></label></div><label className="mt-4 block text-xs font-semibold text-slate-600">分组标签<input value={tags} onChange={(event) => setTags(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-cyan-400" /></label>{error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}<div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={() => setShowForm(false)}>取消</Button><Button onClick={() => void submit()}>提交上传</Button></div></Card></div> : null}
  </div>;
}

export function VoicePage() {
  const [playing, setPlaying] = useState("");
  const preview = async (voiceId: string, text: string) => { setPlaying(voiceId); try { const blob = await openTalkingClient.previewTts({ text, voice: voiceId }); const audio = new Audio(URL.createObjectURL(blob)); audio.onended = () => setPlaying(""); await audio.play(); } catch { setPlaying(""); } };
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Digital Human Center / Voice" title="声音配置" description="管理 TTS provider 与音色，并在这里试听展会话术。" actions={<Button variant="secondary"><Icon name="plus" />添加音色配置</Button>} /><div className="grid gap-5 lg:grid-cols-2">{DEFAULT_VOICES.map((voice) => <Card key={voice.id} className="p-5"><div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600"><Icon name="chat" /></div><div><h3 className="font-semibold text-slate-900">{voice.name}</h3><p className="mt-1 text-xs text-slate-400">{voice.provider} · {voice.voiceId}</p></div></div><Badge tone="green">已启用</Badge></div><div className="mt-5 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">“{voice.previewText}”</div><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => void preview(voice.voiceId, voice.previewText)}>{playing === voice.voiceId ? "播放中…" : "试听"}</Button><Button variant="ghost">编辑</Button></div></Card>)}</div></div>;
}

export function ScenePage() {
  const scenes = ["welcome", "explain", "qa", "navigation", "shopping", "idle", "emergency"];
  const [scene, setScene] = useState("welcome");
  const [gifs, setGifs] = useState<GifAssetMeta[]>([]);
  const [bindings, setBindings] = useState<SceneBinding[]>([]);
  useEffect(() => { void Promise.all([adminApi.listGifs(), adminApi.listSceneBindings()]).then(([items, saved]) => { setGifs(items); setBindings(saved); }); }, []);
  const current = bindings.find((item) => item.scene === scene) ?? { scene, assets: [] };
  const save = (next: SceneBinding) => { const all = [...bindings.filter((item) => item.scene !== scene), next]; setBindings(all); void adminApi.saveSceneBindings(all); };
  const add = (assetId: string) => { if (!assetId || current.assets.some((item) => item.assetId === assetId)) return; save({ ...current, assets: [...current.assets, { assetId, isPrimary: current.assets.length === 0, order: current.assets.length }] }); };
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Digital Human Center / Scenes" title="场景绑定" description="把动作素材绑定到迎宾、讲解、问答和待机场景，并设置主资产。" /><div className="grid gap-5 xl:grid-cols-[220px_1fr]"><Card className="p-2"><div className="space-y-1">{scenes.map((item) => <button type="button" key={item} onClick={() => setScene(item)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition ${scene === item ? "bg-cyan-50 text-cyan-700" : "text-slate-500 hover:bg-slate-50"}`}><span>{item}</span><Icon name="chevron" /></button>)}</div></Card><Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">{scene} 场景资产</h2><p className="mt-1 text-xs text-slate-400">已绑定 {current.assets.length} 个资产，主资产用于默认播放。</p></div><select onChange={(event) => add(event.target.value)} value="" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"><option value="">添加资产</option>{gifs.map((gif) => <option key={gif.id} value={gif.id} disabled={current.assets.some((item) => item.assetId === gif.id)}>{gif.name}</option>)}</select></div><div className="mt-5 space-y-3">{current.assets.length ? current.assets.sort((a, b) => a.order - b.order).map((binding) => { const gif = gifs.find((item) => item.id === binding.assetId); if (!gif) return null; return <div key={binding.assetId} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><img src={gif.previewUrl} alt={gif.name} className="h-14 w-20 rounded-lg object-cover" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{gif.name}</p><p className="mt-1 text-xs text-slate-400">{gif.tags.join(" · ")}</p></div>{binding.isPrimary ? <Badge tone="cyan">主资产</Badge> : <Button variant="ghost" onClick={() => save({ ...current, assets: current.assets.map((item) => ({ ...item, isPrimary: item.assetId === binding.assetId })) })}>设为主资产</Button>}<Button variant="danger" onClick={() => save({ ...current, assets: current.assets.filter((item) => item.assetId !== binding.assetId).map((item, index) => ({ ...item, order: index })) })}>解绑</Button></div>; }) : <EmptyState title="暂无绑定资产" description="从右上角添加动作素材，建立当前场景的播放资产。" />}</div></Card></div></div>;
}

export function IdlePage() {
  const [items, setItems] = useState<IdleContent[]>([]);
  const [editing, setEditing] = useState<IdleContent | null>(null);
  useEffect(() => { void adminApi.listIdle().then(setItems); }, []);
  const save = async () => { if (!editing) return; const saved = await adminApi.saveIdle(editing); setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setEditing(null); };
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Digital Human Center / Idle" title="待机内容" description="配置终端无交互时的宣传内容、标语轮播和活动主题。" actions={<Button onClick={() => setEditing({ id: `idle-${Date.now()}`, type: "标语轮播", title: "", content: "", interval: 8, exhibition: "2026 西部博览会", enabled: true })}><Icon name="plus" />新增内容</Button>} /><Card className="overflow-hidden"><div className="divide-y divide-slate-100">{items.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-4 px-5 py-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600"><Icon name="sparkle" /></div><div className="min-w-[180px] flex-1"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-slate-900">{item.title}</h3><Badge tone={item.enabled ? "green" : "slate"}>{item.enabled ? "启用" : "停用"}</Badge></div><p className="mt-1 text-xs text-slate-400">{item.type} · 每 {item.interval} 秒轮播 · {item.exhibition}</p><p className="mt-2 text-sm text-slate-600">{item.content}</p></div><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button></div>)}</div></Card>{editing ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4"><Card className="w-full max-w-lg p-6"><h2 className="text-lg font-semibold text-slate-950">编辑待机内容</h2><div className="mt-5 space-y-4"><input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} placeholder="内容名称" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400" /><select value={editing.type} onChange={(event) => setEditing({ ...editing, type: event.target.value as IdleContent["type"] })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option>宣传片</option><option>标语轮播</option><option>活动主题</option></select><textarea value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} placeholder="待机内容" rows={4} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400" /><label className="text-xs text-slate-500">轮播间隔（秒）<input type="number" value={editing.interval} onChange={(event) => setEditing({ ...editing, interval: Number(event.target.value) })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label></div><div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditing(null)}>取消</Button><Button onClick={() => void save()}>保存</Button></div></Card></div> : null}</div>;
}

export function DocumentPage() {
  const [items, setItems] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { void adminApi.listDocuments().then(setItems); }, []);
  const upload = async (file: File) => { setUploading(true); const item = await adminApi.uploadDocument({ title: file.name.replace(/\.[^.]+$/, ""), fileName: file.name, type: "展商资料", exhibition: "2026 西部博览会" }); setItems((current) => [item, ...current]); setUploading(false); };
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Knowledge Center" title="文档资料" description="上传展商、展品、论坛与服务设施资料，完成解析和向量化。" actions={<label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-cyan-700"><Icon name="upload" />{uploading ? "处理中…" : "上传文档"}<input type="file" accept=".txt,.md,.csv,.doc,.docx,.pdf,.xls,.xlsx" className="sr-only" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>} /><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 font-semibold">文档</th><th className="px-5 py-3 font-semibold">类型 / 展会</th><th className="px-5 py-3 font-semibold">解析状态</th><th className="px-5 py-3 font-semibold">向量化</th><th className="px-5 py-3 font-semibold">切片数</th><th className="px-5 py-3 font-semibold">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.title}</p><p className="mt-1 text-slate-400">{item.fileName} · {item.uploader}</p></td><td className="px-5 py-4 text-slate-500"><p>{item.type}</p><p className="mt-1 text-slate-400">{item.exhibition}</p></td><td className="px-5 py-4"><Badge tone={item.parseStatus === "parsed" ? "green" : item.parseStatus === "parsing" ? "amber" : "rose"}>{item.parseStatus === "parsed" ? "已解析" : item.parseStatus === "parsing" ? "解析中" : item.parseStatus}</Badge></td><td className="px-5 py-4"><Badge tone={item.vectorStatus === "indexed" ? "green" : "amber"}>{item.vectorStatus === "indexed" ? "已完成" : "处理中"}</Badge></td><td className="px-5 py-4 text-slate-600">{item.chunks}</td><td className="px-5 py-4"><Button variant="ghost">查看切片</Button><Button variant="danger" onClick={() => { void adminApi.deleteDocument(item.id).then(() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))); }}>删除</Button></td></tr>)}</tbody></table></div></Card></div>;
}

export function QaPage() {
  const [items, setItems] = useState<KnowledgeQa[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  useEffect(() => { void adminApi.listQa().then(setItems); }, []);
  const saveNew = async () => { if (!question.trim() || !answer.trim()) return; const item: KnowledgeQa = { id: `qa-${Date.now()}`, question, keywords: [], answer, category: "展会", exhibition: "2026 西部博览会", status: "draft", version: 1, creator: "当前用户", updatedAt: new Date().toISOString(), history: [{ version: 1, answer, editor: "当前用户", time: new Date().toISOString(), reason: "创建" }] }; const saved = await adminApi.saveQa(item); setItems((current) => [saved, ...current]); setQuestion(""); setAnswer(""); setShowForm(false); };
  const transition = async (id: string, status: KnowledgeQa["status"]) => { const item = await adminApi.transitionQa(id, status); setItems((current) => current.map((candidate) => candidate.id === id ? item : candidate)); };
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Knowledge Center" title="问答知识" description="管理强控 QA，确保展会官方口径稳定命中。" actions={<Button onClick={() => setShowForm(true)}><Icon name="plus" />新增问答</Button>} /><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 font-semibold">问题 / 答案</th><th className="px-5 py-3 font-semibold">分类</th><th className="px-5 py-3 font-semibold">状态</th><th className="px-5 py-3 font-semibold">版本</th><th className="px-5 py-3 font-semibold">更新信息</th><th className="px-5 py-3 font-semibold">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id} className="align-top"><td className="max-w-md px-5 py-4"><p className="font-semibold text-slate-800">{item.question}</p><p className="mt-2 leading-5 text-slate-500">{item.answer}</p></td><td className="px-5 py-4 text-slate-500">{item.category}<p className="mt-1 text-slate-400">{item.exhibition}</p></td><td className="px-5 py-4"><Badge tone={item.status === "published" ? "green" : item.status === "pending_review" ? "amber" : "slate"}>{item.status}</Badge></td><td className="px-5 py-4 text-slate-600">v{item.version}</td><td className="px-5 py-4 text-slate-500">{item.creator}<p className="mt-1 text-slate-400">{item.updatedAt}</p></td><td className="whitespace-nowrap px-5 py-4">{item.status === "draft" ? <Button variant="secondary" onClick={() => void transition(item.id, "pending_review")}>提交审核</Button> : item.status === "pending_review" ? <Button onClick={() => void transition(item.id, "published")}>通过发布</Button> : <Button variant="ghost" onClick={() => void transition(item.id, "archived")}>归档</Button>}<Button variant="ghost">版本历史</Button></td></tr>)}</tbody></table></div></Card>{showForm ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4"><Card className="w-full max-w-xl p-6"><h2 className="text-lg font-semibold text-slate-950">新增强控问答</h2><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="问题" className="mt-5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400" /><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="官方口径答案" rows={5} className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400" /><div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={() => setShowForm(false)}>取消</Button><Button onClick={() => void saveNew()}>保存草稿</Button></div></Card></div> : null}</div>;
}

export function ScriptPage() {
  const [items, setItems] = useState<ScriptTemplate[]>([]);
  const [editing, setEditing] = useState<ScriptTemplate | null>(null);
  useEffect(() => { void adminApi.listScripts().then(setItems); }, []);
  const save = async () => { if (!editing) return; const saved = await adminApi.saveScript({ ...editing, updatedAt: new Date().toISOString().slice(0, 10) }); setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setEditing(null); };
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Knowledge Center" title="官方话术" description="维护迎宾、讲解、导购和应急场景的话术模板。" actions={<Button onClick={() => setEditing({ id: `script-${Date.now()}`, name: "", scene: "welcome", content: "", exhibition: "2026 西部博览会", status: "active", updatedAt: "" })}><Icon name="plus" />新增话术</Button>} /><div className="grid gap-5 lg:grid-cols-2">{items.map((item) => <Card key={item.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-900">{item.name}</h3><Badge tone="cyan">{item.scene}</Badge></div><p className="mt-1 text-xs text-slate-400">{item.exhibition} · 更新于 {item.updatedAt}</p></div><Badge tone={item.status === "active" ? "green" : "slate"}>{item.status === "active" ? "启用" : "停用"}</Badge></div><p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">{item.content}</p><div className="mt-4 flex justify-end"><Button variant="secondary" onClick={() => setEditing(item)}>编辑模板</Button></div></Card>)}</div>{editing ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4"><Card className="w-full max-w-xl p-6"><h2 className="text-lg font-semibold text-slate-950">编辑话术模板</h2><input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="模板名称" className="mt-5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /><select value={editing.scene} onChange={(event) => setEditing({ ...editing, scene: event.target.value as ScriptTemplate["scene"] })} className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="welcome">welcome 迎宾</option><option value="explain">explain 讲解</option><option value="shopping">shopping 导购</option><option value="emergency">emergency 应急</option></select><textarea value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} rows={6} placeholder="话术内容，可使用 {exhibition_name} 等变量" className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /><div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditing(null)}>取消</Button><Button onClick={() => void save()}>保存模板</Button></div></Card></div> : null}</div>;
}

export function PackagePage() {
  const [tab, setTab] = useState<"packages" | "miss">("packages");
  const [packages, setPackages] = useState<PublishPackage[]>([]);
  const [miss, setMiss] = useState<MissPoolItem[]>([]);
  useEffect(() => { void Promise.all([adminApi.listPackages(), adminApi.listMissPool()]).then(([nextPackages, nextMiss]) => { setPackages(nextPackages); setMiss(nextMiss); }); }, []);
  const transition = async (id: string, status: PublishPackage["status"]) => { const item = await adminApi.transitionPackage(id, status); setPackages((current) => current.map((candidate) => candidate.id === id ? item : candidate)); };
  const resolve = async (id: string, status: MissPoolItem["status"]) => { const item = await adminApi.resolveMiss(id, status); setMiss((current) => current.map((candidate) => candidate.id === id ? item : candidate)); };
  return <div className="p-6 xl:p-8"><PageHeader eyebrow="Knowledge Center" title="发布审核" description="管理发布包、审核流程、展会知识切换与未命中问题。" actions={<Button variant="secondary"><Icon name="plus" />新建发布包</Button>} /><div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setTab("packages")} className={`rounded-lg px-4 py-2 text-xs font-semibold ${tab === "packages" ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500"}`}>发布包</button><button type="button" onClick={() => setTab("miss")} className={`rounded-lg px-4 py-2 text-xs font-semibold ${tab === "miss" ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500"}`}>未命中池 <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">{miss.filter((item) => item.status === "pending").length}</span></button></div><Card className="overflow-hidden">{tab === "packages" ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 font-semibold">发布包</th><th className="px-5 py-3 font-semibold">展会</th><th className="px-5 py-3 font-semibold">状态</th><th className="px-5 py-3 font-semibold">内容</th><th className="px-5 py-3 font-semibold">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{packages.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-slate-400">v{item.version} · {item.creator}</p></td><td className="px-5 py-4 text-slate-500">{item.exhibition}</td><td className="px-5 py-4"><Badge tone={item.status === "published" ? "green" : item.status === "pending_review" ? "amber" : "slate"}>{item.status}</Badge></td><td className="px-5 py-4 text-slate-500">{item.qaCount} 条 QA · {item.documentCount} 份文档</td><td className="px-5 py-4">{item.status === "pending_review" ? <Button onClick={() => void transition(item.id, "published")}>审核发布</Button> : item.status === "published" ? <Button variant="danger" onClick={() => void transition(item.id, "rolled_back")}>回滚</Button> : <Button variant="secondary" onClick={() => void transition(item.id, "pending_review")}>提交审核</Button>}</td></tr>)}</tbody></table></div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 font-semibold">未命中问题</th><th className="px-5 py-3 font-semibold">询问次数</th><th className="px-5 py-3 font-semibold">最近询问</th><th className="px-5 py-3 font-semibold">状态</th><th className="px-5 py-3 font-semibold">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{miss.map((item) => <tr key={item.id}><td className="px-5 py-4 font-medium text-slate-800">{item.question}</td><td className="px-5 py-4 text-slate-500">{item.count}</td><td className="px-5 py-4 text-slate-500">{item.lastAskedAt}</td><td className="px-5 py-4"><Badge tone={item.status === "pending" ? "amber" : "green"}>{item.status}</Badge></td><td className="px-5 py-4">{item.status === "pending" ? <><Button variant="secondary" onClick={() => void resolve(item.id, "supplemented")}>补齐</Button><Button variant="ghost" onClick={() => void resolve(item.id, "converted_qa")}>转为 QA</Button></> : null}</td></tr>)}</tbody></table></div>}</Card></div>;
}

function ComingSoonPage({ title }: { title: string }) { return <div className="flex min-h-full items-center justify-center p-8"><Card className="w-full max-w-lg p-10 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Icon name="settings" /></div><h1 className="mt-5 text-lg font-semibold text-slate-900">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-500">该模块已纳入 Admin 菜单规划，将在 P2/P3 阶段接入真实业务能力。原 Studio 组件已保留，可继续复用。</p><Badge tone="amber">规划中</Badge></Card></div>; }

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("Admin@123456");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setLoading(true); setError(""); try { await onLogin(username, password); } catch (caught) { setError(caught instanceof Error ? caught.message : "登录失败"); } finally { setLoading(false); } };
  return <div className="flex min-h-screen items-center justify-center bg-[#f3f7f9] px-5"><div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70 lg:grid-cols-[1.1fr_0.9fr]"><div className="hidden bg-slate-950 p-12 text-white lg:block"><div className="flex h-full flex-col justify-between"><div><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-300"><Icon name="sparkle" /></div><p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">四川博览集团数字人</p><h1 className="mt-3 max-w-md text-4xl font-semibold leading-tight">让每一次展会交互，都可运营、可追踪、可复用。</h1><p className="mt-5 max-w-md text-sm leading-7 text-slate-400">统一管理展会内容、数字人资产、知识发布与实时联调，让数字人服务真正进入运营闭环。</p></div><p className="text-xs text-slate-500">四川博览集团数字人项目 · Admin v0.1</p></div></div><form onSubmit={submit} className="p-8 sm:p-12"><Logo /><div className="mt-12"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-600">Welcome back</p><h2 className="mt-2 text-2xl font-semibold text-slate-950">登录管理后台</h2><p className="mt-2 text-sm text-slate-500">使用运营账号进入项目管理工作区。</p></div><div className="mt-8 space-y-4"><label className="block text-xs font-semibold text-slate-600">用户名<input value={username} onChange={(event) => setUsername(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-50" /></label><label className="block text-xs font-semibold text-slate-600">密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-50" /></label>{error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p> : null}<Button type="submit" className="mt-2 w-full py-3" disabled={loading}>{loading ? "登录中…" : "进入管理后台"}<Icon name="arrow" /></Button></div><p className="mt-6 text-center text-xs text-slate-400">原型账号：admin / Admin@123456</p></form></div></div>;
}

function Sidebar({ user, path, navigate, collapsed, onCollapse, mobileOpen, onClose }: { user: AdminUser; path: string; navigate: (path: string) => void; collapsed: boolean; onCollapse: () => void; mobileOpen: boolean; onClose: () => void }) {
  const visible = MENU_GROUPS.filter((item) => item.permission ? canAccess(user.role, item.permission) : item.children?.some((child) => canAccess(user.role, child.permission)));
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const activeGroup = visible.find((item) => item.children?.some((child) => child.path && (path === child.path || path.startsWith(`${child.path}/`))));
    if (activeGroup) setCollapsedGroups((current) => ({ ...current, [activeGroup.id]: false }));
  }, [path]);

  const toggleGroup = (id: string) => setCollapsedGroups((current) => ({ ...current, [id]: !current[id] }));
  const goTo = (nextPath: string) => {
    navigate(nextPath);
    onClose();
  };

  return <aside aria-label="主菜单" className={`${collapsed ? "lg:w-[78px]" : "lg:w-[260px]"} fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 -translate-x-full flex-col border-r border-slate-200 bg-white shadow-xl transition-all duration-200 lg:static lg:translate-x-0 lg:shadow-none ${mobileOpen ? "translate-x-0" : ""}`}>
    <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-slate-100 px-5">
      {collapsed ? <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-cyan-300"><Icon name="sparkle" /></div> : <Logo />}
      <button type="button" onClick={onClose} aria-label="关闭菜单" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:hidden"><span className="text-xl leading-none">×</span></button>
    </div>
    <div className="flex-1 overflow-y-auto px-3 py-5">
      {visible.map((item) => {
        const groupCollapsed = Boolean(collapsedGroups[item.id]);
        return <div key={item.id} className="mb-5">
          {item.children ? <>
            <button type="button" onClick={() => !collapsed && toggleGroup(item.id)} aria-expanded={!groupCollapsed} title={collapsed ? item.label : undefined} className={`${collapsed ? "justify-center" : "justify-between px-3"} mb-2 flex w-full items-center rounded-lg py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 hover:bg-slate-50 hover:text-slate-600`}>
              <span>{collapsed ? "•" : item.label}</span>
              {!collapsed ? <span className={`transition-transform ${groupCollapsed ? "-rotate-90" : "rotate-90"}`}><Icon name="chevron" /></span> : null}
            </button>
            {!collapsed && !groupCollapsed ? <div className="space-y-1">{item.children.filter((child) => canAccess(user.role, child.permission)).map((child) => <NavButton key={child.id} item={child} path={path} navigate={goTo} collapsed={collapsed} />)}</div> : null}
          </> : <NavButton item={item} path={path} navigate={goTo} collapsed={collapsed} />}
        </div>;
      })}
    </div>
    <div className="shrink-0 border-t border-slate-100 p-3"><button type="button" onClick={onCollapse} title={collapsed ? "展开侧栏" : "收起侧栏"} className="flex w-full items-center justify-center rounded-xl py-2 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-700"><span className={`text-xl leading-none transition ${collapsed ? "rotate-180" : ""}`}>‹</span>{collapsed ? null : <span className="ml-2">收起侧栏</span>}</button></div>
  </aside>;
}

function NavButton({ item, path, navigate, collapsed }: { item: MenuItem; path: string; navigate: (path: string) => void; collapsed: boolean }) {
  const active = Boolean(item.path && (path === item.path || path.startsWith(`${item.path}/`)));
  const disabled = item.enabled === false;
  return <button type="button" disabled={disabled} onClick={() => item.path && navigate(item.path)} title={disabled ? `${item.label}（规划中）` : item.label} className={`group flex w-full items-center rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition ${collapsed ? "justify-center" : "gap-3"} ${active ? "bg-cyan-50 text-cyan-700" : disabled ? "cursor-not-allowed text-slate-300" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}><span className={active ? "text-cyan-600" : "text-slate-400"}><Icon name={item.id.includes("knowledge") ? "book" : item.id.includes("asset") ? "sparkle" : item.id.includes("interact") ? "chat" : item.id.includes("event") ? "calendar" : item.id === "report" ? "chart" : item.id === "system" ? "settings" : item.id === "lead" ? "users" : "grid"} /></span>{collapsed ? null : <><span className="flex-1">{item.label}</span>{disabled ? <span className="text-[10px] font-normal text-slate-300">Soon</span> : active ? <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" /> : null}</>}</button>;
}

function MobileNav({ user, path, navigate }: { user: AdminUser; path: string; navigate: (path: string) => void }) { const links = MENU_GROUPS.flatMap((item) => item.children ?? (item.path ? [item] : [])).filter((item) => item.path && item.enabled !== false && canAccess(user.role, item.permission)).slice(0, 6); return <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden">{links.map((item) => <button type="button" key={item.id} onClick={() => item.path && navigate(item.path)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${path === item.path ? "bg-cyan-50 text-cyan-700" : "text-slate-500"}`}>{item.label}</button>)}</div>; }

export function AdminApp() {
  const [path, navigate] = useAdminPath();
  const [user, setUser] = useState<AdminUser | null>(() => { try { const raw = window.localStorage.getItem("opentalking-admin-session"); return raw ? (JSON.parse(raw) as { user: AdminUser }).user : null; } catch { return null; } });
  const [collapsed, setCollapsed] = useState(() => { try { return window.localStorage.getItem("opentalking-admin-sidebar-collapsed") === "true"; } catch { return false; } });
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { window.localStorage.setItem("opentalking-admin-sidebar-collapsed", String(collapsed)); }, [collapsed]);
  useEffect(() => { setMobileOpen(false); }, [path]);
  const login = async (username: string, password: string) => { const result = await adminApi.login(username, password); setUser(result.user); window.localStorage.setItem("opentalking-admin-session", JSON.stringify(result)); navigate("/dashboard"); };
  const logout = () => { window.localStorage.removeItem("opentalking-admin-session"); setUser(null); };
  if (!user) return <LoginScreen onLogin={login} />;
  const title = PAGE_LABELS[path] ?? "管理模块";
  const isKnown = Boolean(PAGE_LABELS[path]);
  const eventCanWrite = (permission: Parameters<typeof canUseButton>[1]) => canUseButton(user.role, permission);
  const searchParams = new URLSearchParams(window.location.search);
  const exhibitionId = searchParams.get("id") ?? "";
  const initialExhibitionId = searchParams.get("exhibitionId") ?? "";
  return <div className="flex min-h-screen bg-[#f3f7f9] text-slate-900">{mobileOpen ? <button type="button" aria-label="关闭菜单" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-950/25 lg:hidden" /> : null}<Sidebar user={user} path={path} navigate={navigate} collapsed={collapsed} onCollapse={() => setCollapsed((value) => !value)} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} /><div className="flex min-w-0 flex-1 flex-col"><header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur lg:px-8"><div className="flex min-w-0 items-center gap-3"><button type="button" onClick={() => setMobileOpen(true)} aria-label="打开菜单" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 lg:hidden"><span className="text-lg">☰</span></button><div className="hidden lg:block"><p className="text-xs text-slate-400">当前工作区</p><div className="mt-1 flex items-center gap-2"><span className="text-sm font-semibold text-slate-900">{GROUP_LABELS[path.split("/")[1]] || "运营总览"}</span><span className="text-slate-300">/</span><span className="text-sm text-slate-500">{title}</span></div></div><div className="lg:hidden"><Logo /></div></div><div className="flex items-center gap-2 sm:gap-4"><button type="button" onClick={() => { window.location.search = "mode=studio"; }} className="hidden rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-cyan-300 hover:text-cyan-700 sm:inline-flex">旧 Studio</button><div className="hidden h-7 w-px bg-slate-200 sm:block" /><div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-100 text-xs font-bold text-cyan-700">{user.displayName.slice(0, 1)}</div><div className="hidden text-right sm:block"><p className="text-xs font-semibold text-slate-800">{user.displayName}</p><p className="text-[10px] text-slate-400">{roleLabel(user.role)}</p></div></div><button type="button" onClick={logout} title="退出登录" className="rounded-xl p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Icon name="logout" /></button></div></header><MobileNav user={user} path={path} navigate={navigate} /><main className="min-h-0 flex-1 overflow-auto">{!isKnown ? <ComingSoonPage title={title} /> : path === "/dashboard" || path === "/dashboard/todo" ? <DashboardPage navigate={navigate} /> : path === "/event/exhibition/detail" ? <ExhibitionDetailPage exhibitionId={exhibitionId} canWrite={eventCanWrite("event:exhibition:write")} onBack={() => navigate("/event/exhibition")} /> : path === "/event/exhibition" ? <ExhibitionPage canWrite={eventCanWrite("event:exhibition:write")} onOpenDetail={(id) => navigate(`/event/exhibition/detail?id=${encodeURIComponent(id)}`)} /> : path === "/event/exhibitor" ? <ExhibitorPage canWrite={eventCanWrite("event:exhibitor:write")} initialExhibitionId={initialExhibitionId} /> : path === "/event/exhibit" ? <ExhibitPage canWrite={eventCanWrite("event:exhibit:write")} initialExhibitionId={initialExhibitionId} /> : path === "/event/venue" ? <VenuePage canWrite={eventCanWrite("event:venue:write")} initialExhibitionId={initialExhibitionId} /> : path === "/event/route" ? <RoutePage canWrite={eventCanWrite("event:route:write")} initialExhibitionId={initialExhibitionId} /> : path === "/event/schedule" ? <SchedulePage canWrite={eventCanWrite("event:schedule:write")} /> : path === "/asset/avatar" ? <EnhancedAvatarPage onDebug={(avatarId) => navigate(`/interact/test?avatarId=${encodeURIComponent(avatarId)}`)} /> : path === "/asset/gif" ? <EnhancedGifPage /> : path === "/asset/voice" ? <EnhancedVoicePage /> : path === "/asset/scene" ? <EnhancedScenePage /> : path === "/asset/idle" ? <EnhancedIdlePage /> : path === "/knowledge/document" ? <DocumentCenterPage /> : path === "/knowledge/base" ? <KnowledgeBasePage /> : path === "/knowledge/memory" ? <MemoryCenterPage /> : path === "/knowledge/qa" ? <EnhancedQaPage /> : path === "/knowledge/script" ? <EnhancedScriptPage /> : path === "/knowledge/package" ? <EnhancedPackagePage /> : path === "/interact/test" ? <RealtimeTestWorkspace /> : <ComingSoonPage title={title} />}</main></div></div>;
}

export function adminRoleCanWrite(user: AdminUser, permission: Parameters<typeof canUseButton>[1]): boolean { return canUseButton(user.role, permission); }

export function adminRoleCanAccess(user: AdminUser, permission: Parameters<typeof canAccess>[1]): boolean { return canAccess(user.role, permission); }

export const ADMIN_ROLES: AdminRole[] = ["sys_admin", "content_ops", "data_viewer", "security_audit", "readonly"];
