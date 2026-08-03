import { ROLE_BUTTON_PERMISSIONS, ROLE_PERMISSIONS } from "./policy";
import type {
  AdminUser,
  DashboardData,
  EventSchedule,
  EventVenue,
  Exhibit,
  Exhibition,
  ExhibitionRoute,
  Exhibitor,
  GifAssetMeta,
  IdleContent,
  KnowledgeDocument,
  KnowledgeQa,
  MissPoolItem,
  PublishPackage,
  SceneBinding,
  ScriptTemplate,
  VoiceAsset,
} from "./types";

const STORAGE_PREFIX = "opentalking-admin-";
const now = () => new Date().toISOString();

function buildAdminFetchUrl(path: string): string {
  const base = typeof window === "undefined" ? "http://127.0.0.1:5173/" : window.location.href;
  return new URL(`/api${path}`, base).toString();
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Mock data is best effort when browser storage is unavailable.
  }
}

const poster = (seed: string) => `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=800&q=80`;

const DEFAULT_GIFS: GifAssetMeta[] = [
  { id: "gif-welcome", name: "迎宾微笑", kind: "gif", previewUrl: poster("1535713875002-d1d0cf377fde"), scene: "welcome", tags: ["欢迎", "微笑"], status: "active", width: 640, height: 360, frames: 24, durationMs: 1200, fileName: "welcome-smile.gif", sizeBytes: 420_000, createdAt: now() },
  { id: "gif-explain", name: "讲解手势", kind: "gif", previewUrl: poster("1506794778202-cad84cf45f1d"), scene: "explain", tags: ["讲解", "手势"], status: "active", width: 640, height: 360, frames: 32, durationMs: 1600, fileName: "explain.gif", sizeBytes: 680_000, createdAt: now() },
  { id: "gif-idle", name: "待机呼吸", kind: "gif", previewUrl: poster("1534528741775-53994a69daeb"), scene: "idle", tags: ["待机", "轻量"], status: "active", width: 512, height: 512, frames: 18, durationMs: 900, fileName: "idle.gif", sizeBytes: 250_000, createdAt: now() },
];

const DEFAULT_DOCUMENTS: KnowledgeDocument[] = [
  { id: "doc-1", title: "四川博览会展商名录", fileName: "展商名录.pdf", type: "展商资料", exhibition: "2026 西部博览会", parseStatus: "parsed", vectorStatus: "indexed", chunks: 128, uploader: "张运营", uploadedAt: "2026-08-02 10:24" },
  { id: "doc-2", title: "官方服务设施口径", fileName: "服务设施.md", type: "服务设施", exhibition: "2026 西部博览会", parseStatus: "parsed", vectorStatus: "indexed", chunks: 46, uploader: "李内容", uploadedAt: "2026-08-01 16:40" },
];

const DEFAULT_QA: KnowledgeQa[] = [
  { id: "qa-1", question: "本届博览会在哪里举办？", keywords: ["地点", "场馆", "举办地"], answer: "本届博览会将在成都西部国际博览城举办。", category: "展会", exhibition: "2026 西部博览会", status: "published", version: 3, creator: "张运营", reviewer: "王管理员", updatedAt: "2026-08-02 09:30", history: [{ version: 3, answer: "本届博览会将在成都西部国际博览城举办。", editor: "王管理员", time: "2026-08-02 09:30", reason: "发布" }] },
  { id: "qa-2", question: "如何前往智能制造展区？", keywords: ["路线", "智能制造"], answer: "从一号入口进入后，沿中央通道向东步行约三分钟即可到达。", category: "服务", exhibition: "2026 西部博览会", status: "pending_review", version: 1, creator: "李内容", updatedAt: "2026-08-03 11:10", history: [{ version: 1, answer: "从一号入口进入后，沿中央通道向东步行约三分钟即可到达。", editor: "李内容", time: "2026-08-03 11:10", reason: "创建" }] },
];

const DEFAULT_SCRIPTS: ScriptTemplate[] = [
  { id: "script-1", name: "标准迎宾", scene: "welcome", content: "您好，欢迎来到{exhibition_name}。我是数字人讲解员，很高兴为您服务。", exhibition: "2026 西部博览会", status: "active", updatedAt: "2026-08-02" },
  { id: "script-2", name: "展区讲解开场", scene: "explain", content: "这里是{booth_code}展区，我可以为您介绍展商和展品信息。", exhibition: "2026 西部博览会", status: "active", updatedAt: "2026-08-01" },
];

const DEFAULT_PACKAGES: PublishPackage[] = [
  { id: "pkg-1", name: "西博会知识包 v3", exhibition: "2026 西部博览会", status: "published", version: 3, qaCount: 86, documentCount: 12, creator: "张运营", reviewer: "王管理员", updatedAt: "2026-08-02 18:00" },
  { id: "pkg-2", name: "智能制造增量包", exhibition: "2026 西部博览会", status: "pending_review", version: 1, qaCount: 14, documentCount: 2, creator: "李内容", updatedAt: "2026-08-03 10:10" },
];

const DEFAULT_MISS: MissPoolItem[] = [
  { id: "miss-1", question: "附近有哪些适合休息的地方？", count: 8, firstAskedAt: "2026-08-01 09:30", lastAskedAt: "2026-08-03 10:12", status: "pending" },
  { id: "miss-2", question: "无人机展品的预约方式是什么？", count: 4, firstAskedAt: "2026-08-02 13:20", lastAskedAt: "2026-08-03 09:40", status: "supplemented" },
];

const DEFAULT_EXHIBITIONS: Exhibition[] = [
  { id: "exhibition-1", name: "2026 西部博览会", code: "XBH-2026", venue: "成都西部国际博览城", hostUnit: "四川博览集团", organizerUnit: "四川博览集团展览有限公司", coOrganizerUnits: "成都市人民政府、四川省商务厅", startDate: "2026-10-15", endDate: "2026-10-19", status: "operating", description: "四川博览集团年度综合展会。", boundAvatarId: null, knowledgeBaseIds: [], createdAt: "2026-07-20 09:00", updatedAt: "2026-08-03 10:00" },
  { id: "exhibition-2", name: "2027 智能制造专题展", code: "IM-2027", venue: "成都世纪城新国际会展中心", hostUnit: "四川博览集团", organizerUnit: "四川博览集团会展事业部", coOrganizerUnits: "四川省经济和信息化厅", startDate: "2027-04-08", endDate: "2027-04-11", status: "preparing", description: "面向智能制造和工业互联网的专题展会。", boundAvatarId: null, knowledgeBaseIds: [], createdAt: "2026-08-01 14:20", updatedAt: "2026-08-01 14:20" },
];

const DEFAULT_VENUES: EventVenue[] = [
  { id: "venue-1", exhibitionId: "exhibition-1", name: "成都西部国际博览城主展馆", address: "成都市天府新区福州路88号", description: "本届展会主展馆，包含入口、展区和服务设施。", status: "active", createdAt: "2026-07-21 09:00", updatedAt: "2026-08-01 10:00" },
  { id: "venue-2", exhibitionId: "exhibition-1", name: "4号馆主论坛区", address: "成都西部国际博览城4号馆", description: "开幕式及主论坛使用场地。", status: "active", createdAt: "2026-07-21 09:20", updatedAt: "2026-08-01 10:00" },
];

const DEFAULT_EXHIBITORS: Exhibitor[] = [
  { id: "exhibitor-1", exhibitionId: "exhibition-1", name: "四川智造科技有限公司", boothCode: "A1-08", category: "智能制造", contact: "王强", phone: "028-88886666", status: "active", description: "工业机器人和数字化产线服务商。", createdAt: "2026-07-22 11:30", updatedAt: "2026-08-02 16:10" },
  { id: "exhibitor-2", exhibitionId: "exhibition-1", name: "西部文旅集团", boothCode: "B2-16", category: "文旅消费", contact: "陈琳", phone: "028-66668888", status: "active", description: "文旅项目和目的地运营机构。", createdAt: "2026-07-24 09:20", updatedAt: "2026-07-30 15:40" },
];

const DEFAULT_EXHIBITS: Exhibit[] = [
  { id: "exhibit-1", exhibitionId: "exhibition-1", exhibitorId: "exhibitor-1", name: "协作机器人工作站", category: "智能装备", modelNo: "CR-2400", description: "支持多工位协作和视觉识别的机器人工作站。", status: "published", createdAt: "2026-07-25 10:00", updatedAt: "2026-08-02 10:30" },
  { id: "exhibit-2", exhibitionId: "exhibition-1", exhibitorId: "exhibitor-2", name: "智慧文旅导览平台", category: "数字服务", modelNo: "WLT-01", description: "面向景区和展馆的智能导览平台。", status: "draft", createdAt: "2026-07-26 13:40", updatedAt: "2026-07-26 13:40" },
];

const DEFAULT_ROUTES: ExhibitionRoute[] = [
  { id: "route-1", venueId: "venue-1", exhibitionId: "venue-1", name: "主入口到智能制造展区", from: "1号入口", to: "A1馆智能制造展区", distance: "260米", estimatedMinutes: 4, description: "沿中央通道向东直行，经过服务台后右转。", status: "published", createdAt: "2026-07-28 09:00", updatedAt: "2026-08-01 17:20" },
  { id: "route-2", venueId: "venue-1", exhibitionId: "venue-1", name: "主入口到休息区", from: "1号入口", to: "中央休息区", distance: "120米", estimatedMinutes: 2, description: "沿中央通道直行至服务设施区域。", status: "published", createdAt: "2026-07-28 09:20", updatedAt: "2026-07-28 09:20" },
];

const DEFAULT_SCHEDULES: EventSchedule[] = [
  { id: "schedule-1", exhibitionId: "exhibition-1", title: "开幕式暨主论坛", type: "论坛", startAt: "2026-10-15 09:30", endAt: "2026-10-15 11:30", location: "4号馆主论坛区", speaker: "四川博览集团", description: "展会开幕及年度产业趋势分享。", status: "scheduled", createdAt: "2026-07-30 10:00", updatedAt: "2026-08-02 09:00" },
  { id: "schedule-2", exhibitionId: "exhibition-1", title: "机器人现场演示", type: "演示", startAt: "2026-10-16 14:00", endAt: "2026-10-16 15:00", location: "A1-08 展位", speaker: "四川智造科技有限公司", description: "协作机器人工作站现场演示和互动。", status: "draft", createdAt: "2026-08-01 11:00", updatedAt: "2026-08-01 11:00" },
];

export interface AdminApiClient {
  login(username: string, password: string): Promise<{ token: string; user: AdminUser }>;
  getDashboard(): Promise<DashboardData>;
  listGifs(): Promise<GifAssetMeta[]>;
  createGif(input: Omit<GifAssetMeta, "id" | "createdAt">): Promise<GifAssetMeta>;
  updateGif(id: string, patch: Partial<GifAssetMeta>): Promise<GifAssetMeta>;
  deleteGif(id: string): Promise<void>;
  listSceneBindings(): Promise<SceneBinding[]>;
  saveSceneBindings(bindings: SceneBinding[]): Promise<SceneBinding[]>;
  listIdle(): Promise<IdleContent[]>;
  saveIdle(item: IdleContent): Promise<IdleContent>;
  listDocuments(): Promise<KnowledgeDocument[]>;
  uploadDocument(input: Pick<KnowledgeDocument, "title" | "fileName" | "type" | "exhibition">): Promise<KnowledgeDocument>;
  updateDocument(id: string, patch: Partial<KnowledgeDocument>): Promise<KnowledgeDocument>;
  deleteDocument(id: string): Promise<void>;
  listQa(): Promise<KnowledgeQa[]>;
  saveQa(item: KnowledgeQa): Promise<KnowledgeQa>;
  transitionQa(id: string, status: KnowledgeQa["status"]): Promise<KnowledgeQa>;
  deleteQa(id: string): Promise<void>;
  listScripts(): Promise<ScriptTemplate[]>;
  saveScript(item: ScriptTemplate): Promise<ScriptTemplate>;
  deleteScript(id: string): Promise<void>;
  listPackages(): Promise<PublishPackage[]>;
  createPackage(input: Pick<PublishPackage, "name" | "exhibition" | "qaCount" | "documentCount">): Promise<PublishPackage>;
  transitionPackage(id: string, status: PublishPackage["status"]): Promise<PublishPackage>;
  listMissPool(): Promise<MissPoolItem[]>;
  resolveMiss(id: string, status: MissPoolItem["status"]): Promise<MissPoolItem>;
  listExhibitions(): Promise<Exhibition[]>;
  saveExhibition(item: Exhibition): Promise<Exhibition>;
  deleteExhibition(id: string): Promise<void>;
  listVenues(): Promise<EventVenue[]>;
  saveVenue(item: EventVenue): Promise<EventVenue>;
  deleteVenue(id: string): Promise<void>;
  listExhibitors(): Promise<Exhibitor[]>;
  saveExhibitor(item: Exhibitor): Promise<Exhibitor>;
  deleteExhibitor(id: string): Promise<void>;
  listExhibits(): Promise<Exhibit[]>;
  saveExhibit(item: Exhibit): Promise<Exhibit>;
  deleteExhibit(id: string): Promise<void>;
  listRoutes(): Promise<ExhibitionRoute[]>;
  saveRoute(item: ExhibitionRoute): Promise<ExhibitionRoute>;
  deleteRoute(id: string): Promise<void>;
  listSchedules(): Promise<EventSchedule[]>;
  saveSchedule(item: EventSchedule): Promise<EventSchedule>;
  deleteSchedule(id: string): Promise<void>;
}

function buildUser(username: string, role: AdminUser["role"]): AdminUser {
  return { id: `user-${username}`, username, displayName: username === "admin" ? "管理员" : username, role, permissions: ROLE_PERMISSIONS[role], buttonPermissions: ROLE_BUTTON_PERMISSIONS[role] };
}

export class MockAdminApiClient implements AdminApiClient {
  async login(username: string, password: string) {
    if (username !== "admin" || password !== "Admin@123456") throw new Error("账号或密码不正确");
    return { token: `mock-jwt-${Date.now()}`, user: buildUser(username, "sys_admin") };
  }

  async getDashboard(): Promise<DashboardData> {
    return {
      metrics: [
        { id: "interactions", label: "今日交互量", value: "1,286", trend: "+18.6%", tone: "cyan" },
        { id: "terminals", label: "在线终端", value: "18 / 24", trend: "75% 在线", tone: "green" },
        { id: "pending", label: "待审知识", value: "12", trend: "需及时处理", tone: "amber" },
        { id: "leads", label: "新增线索", value: "86", trend: "+12.4%", tone: "violet" },
        { id: "alerts", label: "当前告警", value: "3", trend: "1 条高优先级", tone: "rose" },
      ],
      todos: [
        { id: "todo-1", type: "待审知识", title: "审核 12 条展会知识内容", owner: "李内容", time: "10 分钟前", path: "/knowledge/base" },
        { id: "todo-2", type: "知识文档", title: "智能制造资料等待整理入库", owner: "李内容", time: "35 分钟前", path: "/knowledge/document" },
        { id: "todo-3", type: "未命中池", title: "4 个高频问题需要补齐", owner: "系统", time: "1 小时前", path: "/knowledge/memory" },
        { id: "todo-4", type: "运行告警", title: "2 号终端连接延迟升高", owner: "运维", time: "2 小时前", path: "/interact/test" },
      ],
    };
  }

  async listGifs() { return readStore("gifs", DEFAULT_GIFS); }
  async createGif(input: Omit<GifAssetMeta, "id" | "createdAt">) { const item = { ...input, id: `gif-${Date.now()}`, createdAt: now() }; writeStore("gifs", [item, ...await this.listGifs()]); return item; }
  async updateGif(id: string, patch: Partial<GifAssetMeta>) { const items = await this.listGifs(); const next = items.map((item) => item.id === id ? { ...item, ...patch } : item); writeStore("gifs", next); return next.find((item) => item.id === id) ?? items[0]; }
  async deleteGif(id: string) { writeStore("gifs", (await this.listGifs()).filter((item) => item.id !== id)); }
  async listSceneBindings() { return readStore<SceneBinding[]>("scene-bindings", [{ scene: "welcome", assets: [{ assetId: "gif-welcome", isPrimary: true, order: 0 }] }, { scene: "explain", assets: [{ assetId: "gif-explain", isPrimary: true, order: 0 }] }, { scene: "idle", assets: [{ assetId: "gif-idle", isPrimary: true, order: 0 }] }]); }
  async saveSceneBindings(bindings: SceneBinding[]) { writeStore("scene-bindings", bindings); return bindings; }
  async listIdle() { return readStore<IdleContent[]>("idle", [{ id: "idle-1", type: "标语轮播", title: "西博会欢迎语", content: "欢迎来到 2026 西部博览会", interval: 8, exhibition: "2026 西部博览会", enabled: true }]); }
  async saveIdle(item: IdleContent) { const items = (await this.listIdle()).filter((candidate) => candidate.id !== item.id); const next = [item, ...items]; writeStore("idle", next); return item; }
  async listDocuments() { return readStore("documents", DEFAULT_DOCUMENTS); }
  async uploadDocument(input: Pick<KnowledgeDocument, "title" | "fileName" | "type" | "exhibition">) { const item: KnowledgeDocument = { ...input, id: `doc-${Date.now()}`, parseStatus: "parsing", vectorStatus: "pending", chunks: 0, uploader: "当前用户", uploadedAt: now() }; writeStore("documents", [item, ...await this.listDocuments()]); window.setTimeout(() => { void this.patchDocument(item.id, { parseStatus: "parsed", vectorStatus: "indexed", chunks: 32 }); }, 1200); return item; }
  private async patchDocument(id: string, patch: Partial<KnowledgeDocument>) { const next = (await this.listDocuments()).map((item) => item.id === id ? { ...item, ...patch } : item); writeStore("documents", next); }
  async updateDocument(id: string, patch: Partial<KnowledgeDocument>) { await this.patchDocument(id, patch); return (await this.listDocuments()).find((item) => item.id === id) ?? (await this.listDocuments())[0]; }
  async deleteDocument(id: string) { writeStore("documents", (await this.listDocuments()).filter((item) => item.id !== id)); }
  async listQa() { return readStore("qa", DEFAULT_QA); }
  async saveQa(item: KnowledgeQa) { const list = await this.listQa(); const next = [item, ...list.filter((candidate) => candidate.id !== item.id)]; writeStore("qa", next); return item; }
  async transitionQa(id: string, status: KnowledgeQa["status"]) { const list = await this.listQa(); const next = list.map((item) => item.id === id ? { ...item, status, reviewer: status === "published" ? "当前用户" : item.reviewer, updatedAt: now() } : item); writeStore("qa", next); return next.find((item) => item.id === id) ?? list[0]; }
  async deleteQa(id: string) { await this.transitionQa(id, "archived"); }
  async listScripts() { return readStore("scripts", DEFAULT_SCRIPTS); }
  async saveScript(item: ScriptTemplate) { const next = [item, ...(await this.listScripts()).filter((candidate) => candidate.id !== item.id)]; writeStore("scripts", next); return item; }
  async deleteScript(id: string) { writeStore("scripts", (await this.listScripts()).filter((item) => item.id !== id)); }
  async listPackages() { return readStore("packages", DEFAULT_PACKAGES); }
  async createPackage(input: Pick<PublishPackage, "name" | "exhibition" | "qaCount" | "documentCount">) { const item: PublishPackage = { ...input, id: `pkg-${Date.now()}`, status: "draft", version: 1, creator: "当前用户", updatedAt: now() }; writeStore("packages", [item, ...await this.listPackages()]); return item; }
  async transitionPackage(id: string, status: PublishPackage["status"]) { const list = await this.listPackages(); const next = list.map((item) => item.id === id ? { ...item, status, reviewer: status === "published" ? "当前用户" : item.reviewer, updatedAt: now() } : item); writeStore("packages", next); return next.find((item) => item.id === id) ?? list[0]; }
  async listMissPool() { return readStore("miss-pool", DEFAULT_MISS); }
  async resolveMiss(id: string, status: MissPoolItem["status"]) { const list = await this.listMissPool(); const next = list.map((item) => item.id === id ? { ...item, status } : item); writeStore("miss-pool", next); return next.find((item) => item.id === id) ?? list[0]; }
  async listExhibitions() {
    const legacyStatus: Record<string, Exhibition["status"]> = { draft: "preparing", active: "operating", ended: "teardown", archived: "teardown" };
    return (await readStore<Exhibition[]>("exhibitions", DEFAULT_EXHIBITIONS)).map((item) => ({ ...item, status: legacyStatus[item.status] ?? item.status }));
  }
  async saveExhibition(item: Exhibition) { const saved = { ...item, updatedAt: now() }; writeStore("exhibitions", [saved, ...(await this.listExhibitions()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteExhibition(id: string) { writeStore("exhibitions", (await this.listExhibitions()).filter((item) => item.id !== id)); }
  async listVenues() { return readStore<EventVenue[]>("venues", DEFAULT_VENUES); }
  async saveVenue(item: EventVenue) { const saved = { ...item, updatedAt: now() }; writeStore("venues", [saved, ...(await this.listVenues()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteVenue(id: string) { writeStore("venues", (await this.listVenues()).filter((item) => item.id !== id)); }
  async listExhibitors() { return readStore<Exhibitor[]>("exhibitors", DEFAULT_EXHIBITORS); }
  async saveExhibitor(item: Exhibitor) { const saved = { ...item, updatedAt: now() }; writeStore("exhibitors", [saved, ...(await this.listExhibitors()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteExhibitor(id: string) { writeStore("exhibitors", (await this.listExhibitors()).filter((item) => item.id !== id)); }
  async listExhibits() { return readStore<Exhibit[]>("exhibits", DEFAULT_EXHIBITS); }
  async saveExhibit(item: Exhibit) { const saved = { ...item, updatedAt: now() }; writeStore("exhibits", [saved, ...(await this.listExhibits()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteExhibit(id: string) { writeStore("exhibits", (await this.listExhibits()).filter((item) => item.id !== id)); }
  async listRoutes() {
    const routes = await readStore<ExhibitionRoute[]>("routes", DEFAULT_ROUTES);
    return routes.map((route) => {
      if (route.venueId) return route;
      const venueId = DEFAULT_VENUES.find((venue) => venue.exhibitionId === route.exhibitionId)?.id ?? route.exhibitionId;
      return { ...route, venueId, exhibitionId: venueId };
    });
  }
  async saveRoute(item: ExhibitionRoute) { const saved = { ...item, updatedAt: now() }; writeStore("routes", [saved, ...(await this.listRoutes()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteRoute(id: string) { writeStore("routes", (await this.listRoutes()).filter((item) => item.id !== id)); }
  async listSchedules() { return readStore<EventSchedule[]>("schedules", DEFAULT_SCHEDULES); }
  async saveSchedule(item: EventSchedule) { const saved = { ...item, updatedAt: now() }; writeStore("schedules", [saved, ...(await this.listSchedules()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteSchedule(id: string) { writeStore("schedules", (await this.listSchedules()).filter((item) => item.id !== id)); }
}

export class FetchAdminApiClient extends MockAdminApiClient {
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = window.localStorage.getItem(`${STORAGE_PREFIX}token`);
    const response = await fetch(buildAdminFetchUrl(`/v1${path}`), { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } });
    if (!response.ok) throw new Error(`Admin API ${response.status}`);
    return response.json() as Promise<T>;
  }

  override async login(username: string, password: string) {
    return this.request<{ token: string; user: AdminUser }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  }

  override async getDashboard() { return this.request<DashboardData>("/admin/report"); }

  override async listGifs() { return this.request<GifAssetMeta[]>("/admin/assets?kind=gif"); }
  override async deleteGif(id: string) { await this.request(`/admin/assets/${encodeURIComponent(id)}`, { method: "DELETE" }); }
}

const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
export const adminApi: AdminApiClient = runtimeEnv.VITE_ADMIN_API_MODE === "real" ? new FetchAdminApiClient() : new MockAdminApiClient();

export const DEFAULT_VOICES: VoiceAsset[] = [
  { id: "voice-xiaoxiao", provider: "edge", voiceId: "zh-CN-XiaoxiaoNeural", name: "晓晓（女·温和）", previewText: "您好，欢迎来到西部博览会。", status: "active" },
  { id: "voice-yunxi", provider: "edge", voiceId: "zh-CN-YunxiNeural", name: "云希（男·沉稳）", previewText: "很高兴为您介绍本次展会。", status: "active" },
];
