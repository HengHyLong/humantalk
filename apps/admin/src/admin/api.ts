import { ROLE_BUTTON_PERMISSIONS, ROLE_PERMISSIONS } from "./policy";
import { EDGE_ZH_VOICES } from "../constants/edgeZhVoices";
import type {
  AdminUser,
  DashboardData,
  EventSchedule,
  EventVenue,
  EmergencyBroadcast,
  EventPoint,
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
  ExhibitionStatus,
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
  { id: "exhibition-1", name: "2026 西部博览会", code: "XBH-2026", mainVenueId: "venue-1", hostUnit: "四川博览集团", organizerUnit: "四川博览集团展览有限公司", coOrganizerUnits: "成都市人民政府、四川省商务厅", startDate: "2026-10-15", endDate: "2026-10-19", status: "operating", description: "四川博览集团年度综合展会。", boundAvatarId: null, boundModel: "QuickTalk", boundVoiceId: null, boundVoiceProvider: null, boundVoiceModel: null, boundSttProvider: "sensevoice", boundSttModel: "iic/SenseVoiceSmall", boundScene: "welcome", knowledgeBaseIds: [], lifecycleHistory: [{ from: "setup", to: "operating", operator: "系统管理员", time: "2026-08-03 10:00" }], createdAt: "2026-07-20 09:00", updatedAt: "2026-08-03 10:00" },
  { id: "exhibition-2", name: "2027 智能制造专题展", code: "IM-2027", mainVenueId: null, hostUnit: "四川博览集团", organizerUnit: "四川博览集团会展事业部", coOrganizerUnits: "四川省经济和信息化厅", startDate: "2027-04-08", endDate: "2027-04-11", status: "preparing", description: "面向智能制造和工业互联网的专题展会。", boundAvatarId: null, boundModel: "", boundVoiceId: null, boundVoiceProvider: null, boundVoiceModel: null, boundSttProvider: null, boundSttModel: null, boundScene: null, knowledgeBaseIds: [], lifecycleHistory: [], createdAt: "2026-08-01 14:20", updatedAt: "2026-08-01 14:20" },
];

const DEFAULT_VENUES: EventVenue[] = [
  { id: "venue-1", exhibitionId: "exhibition-1", name: "成都西部国际博览城主展馆", address: "成都市天府新区福州路88号", description: "本届展会主展馆，包含入口、展区和服务设施。", status: "active", createdAt: "2026-07-21 09:00", updatedAt: "2026-08-01 10:00" },
  { id: "venue-2", exhibitionId: "exhibition-1", name: "4号馆主论坛区", address: "成都西部国际博览城4号馆", description: "开幕式及主论坛使用场地。", status: "active", createdAt: "2026-07-21 09:20", updatedAt: "2026-08-01 10:00" },
];

const DEFAULT_POINTS: EventPoint[] = [
  { id: "point-entrance", venueId: "venue-1", code: "ENT-01", name: "1号入口", type: "entrance", floor: "1F", x: 12, y: 48, exhibitorId: null, exhibitId: null, description: "主入口和签到服务台。", status: "active", createdAt: "2026-07-21 10:00", updatedAt: "2026-08-01 10:00" },
  { id: "point-booth-a1", venueId: "venue-1", code: "BOOTH-A1-08", name: "A1馆智能制造展区", type: "booth", floor: "1F", x: 62, y: 36, exhibitorId: "exhibitor-1", exhibitId: "exhibit-1", description: "四川智造科技有限公司展位。", status: "active", createdAt: "2026-07-22 10:00", updatedAt: "2026-08-01 10:00" },
  { id: "point-rest", venueId: "venue-1", code: "SERVICE-REST", name: "中央休息区", type: "facility", floor: "1F", x: 45, y: 70, exhibitorId: null, exhibitId: null, description: "观众休息和饮水区域。", status: "active", createdAt: "2026-07-22 10:10", updatedAt: "2026-08-01 10:00" },
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
  { id: "route-1", venueId: "venue-1", name: "主入口到智能制造展区", type: "navigation", pointIds: ["point-entrance", "point-booth-a1"], directions: ["从1号入口沿中央通道向东直行。", "经过服务台后右转进入A1馆。"], estimatedMinutes: 4, description: "适合现场导航和数字人讲解。", status: "published", createdAt: "2026-07-28 09:00", updatedAt: "2026-08-01 17:20" },
  { id: "route-2", venueId: "venue-1", name: "主入口到休息区", type: "navigation", pointIds: ["point-entrance", "point-rest"], directions: ["沿中央通道直行至服务设施区域。"], estimatedMinutes: 2, description: "适合现场导航和数字人讲解。", status: "published", createdAt: "2026-07-28 09:20", updatedAt: "2026-07-28 09:20" },
];

const DEFAULT_SCHEDULES: EventSchedule[] = [
  { id: "schedule-1", exhibitionId: "exhibition-1", venueId: "venue-2", pointId: null, title: "开幕式暨主论坛", type: "论坛", startAt: "2026-10-15 09:30", endAt: "2026-10-15 11:30", location: "4号馆主论坛区", speaker: "四川博览集团", description: "展会开幕及年度产业趋势分享。", status: "scheduled", createdAt: "2026-07-30 10:00", updatedAt: "2026-08-02 09:00" },
  { id: "schedule-2", exhibitionId: "exhibition-1", venueId: "venue-1", pointId: "point-booth-a1", title: "机器人现场演示", type: "演示", startAt: "2026-10-16 14:00", endAt: "2026-10-16 15:00", location: "A1-08 展位", speaker: "四川智造科技有限公司", description: "协作机器人工作站现场演示和互动。", status: "draft", createdAt: "2026-08-01 11:00", updatedAt: "2026-08-01 11:00" },
];

const DEFAULT_BROADCASTS: EmergencyBroadcast[] = [
  { id: "broadcast-1", exhibitionId: "exhibition-1", title: "现场安全提示", content: "请观众按照现场工作人员指引有序参观。", priority: "normal", targetTerminals: "全部终端", effectiveAt: "2026-10-15 08:00", status: "draft", createdAt: "2026-08-02 09:00", updatedAt: "2026-08-02 09:00" },
];

export interface AdminApiClient {
  login(username: string, password: string): Promise<{ token: string; user: AdminUser }>;
  getDashboard(): Promise<DashboardData>;
  listGifs(): Promise<GifAssetMeta[]>;
  createGif(input: Omit<GifAssetMeta, "id" | "createdAt">): Promise<GifAssetMeta>;
  updateGif(id: string, patch: Partial<GifAssetMeta>): Promise<GifAssetMeta>;
  deleteGif(id: string): Promise<void>;
  listVoiceConfigs(): Promise<VoiceAsset[]>;
  saveVoiceConfig(item: VoiceAsset): Promise<VoiceAsset>;
  deleteVoiceConfig(id: string): Promise<void>;
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
  transitionExhibition(id: string, status: ExhibitionStatus): Promise<Exhibition>;
  listVenues(): Promise<EventVenue[]>;
  saveVenue(item: EventVenue): Promise<EventVenue>;
  deleteVenue(id: string): Promise<void>;
  listPoints(): Promise<EventPoint[]>;
  savePoint(item: EventPoint): Promise<EventPoint>;
  deletePoint(id: string): Promise<void>;
  listExhibitors(): Promise<Exhibitor[]>;
  saveExhibitor(item: Exhibitor): Promise<Exhibitor>;
  deleteExhibitor(id: string): Promise<void>;
  listExhibits(): Promise<Exhibit[]>;
  saveExhibit(item: Exhibit): Promise<Exhibit>;
  deleteExhibit(id: string): Promise<void>;
  listRoutes(): Promise<ExhibitionRoute[]>;
  saveRoute(item: ExhibitionRoute): Promise<ExhibitionRoute>;
  deleteRoute(id: string): Promise<void>;
  listBroadcasts(): Promise<EmergencyBroadcast[]>;
  saveBroadcast(item: EmergencyBroadcast): Promise<EmergencyBroadcast>;
  transitionBroadcast(id: string, status: EmergencyBroadcast["status"]): Promise<EmergencyBroadcast>;
  deleteBroadcast(id: string): Promise<void>;
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
    const [qa, packages, documents, missPool] = await Promise.all([this.listQa(), this.listPackages(), this.listDocuments(), this.listMissPool()]);
    const pendingKnowledge = qa.filter((item) => item.status === "pending_review").length;
    const pendingPackages = packages.filter((item) => item.status === "pending_review").length;
    const processingDocuments = documents.filter((item) => item.parseStatus !== "parsed" || item.vectorStatus !== "indexed").length;
    const pendingMisses = missPool.filter((item) => item.status === "pending").length;
    const backlog = pendingKnowledge + pendingPackages + processingDocuments + pendingMisses;
    const todos = [
      pendingKnowledge > 0 ? { id: "todo-1", type: "待审知识", title: `${pendingKnowledge} 条展会知识内容等待审核`, owner: "内容运营", time: "当前快照", path: "/knowledge/base" } : null,
      processingDocuments > 0 ? { id: "todo-2", type: "知识文档", title: `${processingDocuments} 份知识文档仍在处理`, owner: "内容运营", time: "当前快照", path: "/knowledge/document" } : null,
      pendingMisses > 0 ? { id: "todo-3", type: "未命中池", title: `${pendingMisses} 个高频问题需要补齐`, owner: "系统", time: "当前快照", path: "/knowledge/memory" } : null,
      { id: "todo-4", type: "运行状态", title: "查看数字人终端实时联调状态", owner: "运维", time: "快捷入口", path: "/interact/test" },
    ].filter((item): item is { id: string; type: string; title: string; owner: string; time: string; path: string } => Boolean(item));
    return {
      metrics: [
        { id: "interactions", label: "今日交互量", value: "1,286", trend: "+18.6%", tone: "cyan" },
        { id: "terminals", label: "在线终端", value: "18 / 24", trend: "75% 在线", tone: "green" },
        { id: "pending", label: "待审知识", value: String(pendingKnowledge), trend: pendingKnowledge > 0 ? "需及时处理" : "当前无待审", tone: pendingKnowledge > 0 ? "amber" : "green" },
        { id: "leads", label: "新增线索", value: "86", trend: "+12.4%", tone: "violet" },
        { id: "backlog", label: "运营待处理", value: String(backlog), trend: `${pendingPackages} 个发布包 · ${processingDocuments} 份文档`, tone: backlog > 0 ? "rose" : "green" },
      ],
      todos,
    };
  }

  async listGifs() { return readStore("gifs", DEFAULT_GIFS); }
  async createGif(input: Omit<GifAssetMeta, "id" | "createdAt">) { const item = { ...input, id: `gif-${Date.now()}`, createdAt: now() }; writeStore("gifs", [item, ...await this.listGifs()]); return item; }
  async updateGif(id: string, patch: Partial<GifAssetMeta>) { const items = await this.listGifs(); const next = items.map((item) => item.id === id ? { ...item, ...patch } : item); writeStore("gifs", next); return next.find((item) => item.id === id) ?? items[0]; }
  async deleteGif(id: string) { writeStore("gifs", (await this.listGifs()).filter((item) => item.id !== id)); }
  async listVoiceConfigs() { return readStore<VoiceAsset[]>("voice-configs", []); }
  async saveVoiceConfig(item: VoiceAsset) { const saved = { ...item, id: item.id || `voice-config-${Date.now()}` }; writeStore("voice-configs", [saved, ...(await this.listVoiceConfigs()).filter((candidate) => candidate.id !== saved.id)]); return saved; }
  async deleteVoiceConfig(id: string) { writeStore("voice-configs", (await this.listVoiceConfigs()).filter((item) => item.id !== id)); }
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
    return (await readStore<Exhibition[]>("exhibitions", DEFAULT_EXHIBITIONS)).map((item) => ({ ...item, mainVenueId: item.mainVenueId ?? null, status: legacyStatus[item.status] ?? item.status, boundModel: item.boundModel ?? "", boundVoiceId: item.boundVoiceId ?? null, boundVoiceProvider: item.boundVoiceProvider ?? null, boundVoiceModel: item.boundVoiceModel ?? null, boundSttProvider: item.boundSttProvider ?? null, boundSttModel: item.boundSttModel ?? null, boundScene: item.boundScene ?? null, lifecycleHistory: item.lifecycleHistory ?? [] }));
  }
  async saveExhibition(item: Exhibition) {
    const list = await this.listExhibitions();
    const current = list.find((candidate) => candidate.id === item.id);
    if (current && current.status !== item.status) throw new Error("生命周期只能通过阶段推进操作变更");
    if (item.mainVenueId) {
      const venue = (await this.listVenues()).find((candidate) => candidate.id === item.mainVenueId);
      if (!venue || venue.exhibitionId !== item.id) throw new Error("主场地必须属于当前展会");
    }
    const saved = { ...item, updatedAt: now() };
    writeStore("exhibitions", [saved, ...list.filter((candidate) => candidate.id !== item.id)]);
    return saved;
  }
  async transitionExhibition(id: string, status: Exhibition["status"]) {
    const list = await this.listExhibitions();
    const current = list.find((item) => item.id === id);
    if (!current) throw new Error("展会不存在");
    const order: Exhibition["status"][] = ["preparing", "setup", "operating", "teardown"];
    if (order.indexOf(status) !== order.indexOf(current.status) + 1) throw new Error("展会生命周期必须按顺序推进");
    const saved = { ...current, status, lifecycleHistory: [...current.lifecycleHistory, { from: current.status, to: status, operator: "当前用户", time: now() }], updatedAt: now() };
    writeStore("exhibitions", [saved, ...list.filter((item) => item.id !== id)]);
    return saved;
  }
  async deleteExhibition(id: string) {
    const [exhibitions, exhibitors, exhibits, venues, schedules, broadcasts, points] = await Promise.all([this.listExhibitions(), this.listExhibitors(), this.listExhibits(), this.listVenues(), this.listSchedules(), this.listBroadcasts(), this.listPoints()]);
    const venueIds = new Set(venues.filter((item) => item.exhibitionId === id).map((item) => item.id));
    const exhibitIds = new Set(exhibits.filter((item) => item.exhibitionId === id).map((item) => item.id));
    const exhibitorIds = new Set(exhibitors.filter((item) => item.exhibitionId === id).map((item) => item.id));
    const relatedPointIds = new Set(points.filter((item) => venueIds.has(item.venueId)).map((item) => item.id));
    const rawRoutes = await readStore<Array<ExhibitionRoute & { exhibitionId?: string }>>("routes", DEFAULT_ROUTES);
    writeStore("exhibitions", exhibitions.filter((item) => item.id !== id));
    writeStore("venues", venues.filter((item) => !venueIds.has(item.id)));
    writeStore("points", points.filter((item) => !relatedPointIds.has(item.id)));
    writeStore("routes", rawRoutes.filter((item) => !venueIds.has(item.venueId) && item.exhibitionId !== id));
    writeStore("schedules", schedules.filter((item) => item.exhibitionId !== id));
    writeStore("broadcasts", broadcasts.filter((item) => item.exhibitionId !== id));
    writeStore("exhibits", exhibits.filter((item) => !exhibitIds.has(item.id)));
    writeStore("exhibitors", exhibitors.filter((item) => !exhibitorIds.has(item.id)));
  }
  async listVenues() { return readStore<EventVenue[]>("venues", DEFAULT_VENUES); }
  async saveVenue(item: EventVenue) { if (!(await this.listExhibitions()).some((exhibition) => exhibition.id === item.exhibitionId)) throw new Error("场地所属展会不存在"); const saved = { ...item, updatedAt: now() }; writeStore("venues", [saved, ...(await this.listVenues()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteVenue(id: string) { if ((await this.listPoints()).some((item) => item.venueId === id) || (await this.listRoutes()).some((item) => item.venueId === id) || (await this.listSchedules()).some((item) => item.venueId === id) || (await this.listExhibitions()).some((item) => item.mainVenueId === id)) throw new Error("该场地仍有关联点位、路线、排期或主场地配置，请先处理后再删除。"); writeStore("venues", (await this.listVenues()).filter((item) => item.id !== id)); }
  async listPoints() { return readStore<EventPoint[]>("points", DEFAULT_POINTS); }
  async savePoint(item: EventPoint) {
    const venue = (await this.listVenues()).find((candidate) => candidate.id === item.venueId);
    if (!venue) throw new Error("点位所属场地不存在");
    const [exhibitors, exhibits] = await Promise.all([this.listExhibitors(), this.listExhibits()]);
    if (item.exhibitorId) {
      const exhibitor = exhibitors.find((candidate) => candidate.id === item.exhibitorId);
      if (!exhibitor || exhibitor.exhibitionId !== venue.exhibitionId) throw new Error("点位关联的展商必须属于当前场地所属展会");
    }
    if (item.exhibitId) {
      const exhibit = exhibits.find((candidate) => candidate.id === item.exhibitId);
      const exhibitor = item.exhibitorId ? exhibitors.find((candidate) => candidate.id === item.exhibitorId) : null;
      if (!exhibit || exhibit.exhibitionId !== venue.exhibitionId || (item.exhibitorId && exhibit.exhibitorId !== item.exhibitorId) || (!item.exhibitorId && exhibitor === null)) throw new Error("点位关联的展品必须属于当前展会和所选展商");
    }
    const saved = { ...item, updatedAt: now() };
    writeStore("points", [saved, ...(await this.listPoints()).filter((candidate) => candidate.id !== item.id)]);
    return saved;
  }
  async deletePoint(id: string) { if ((await this.listRoutes()).some((route) => route.pointIds.includes(id)) || (await this.listSchedules()).some((schedule) => schedule.pointId === id)) throw new Error("该点位仍被路线或活动排期使用，请先解除关联后再删除。"); writeStore("points", (await this.listPoints()).filter((item) => item.id !== id)); }
  async listExhibitors() { return readStore<Exhibitor[]>("exhibitors", DEFAULT_EXHIBITORS); }
  async saveExhibitor(item: Exhibitor) { const saved = { ...item, updatedAt: now() }; writeStore("exhibitors", [saved, ...(await this.listExhibitors()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteExhibitor(id: string) { if ((await this.listExhibits()).some((item) => item.exhibitorId === id) || (await this.listPoints()).some((item) => item.exhibitorId === id)) throw new Error("该展商仍有关联展品或点位，请先处理后再删除。"); writeStore("exhibitors", (await this.listExhibitors()).filter((item) => item.id !== id)); }
  async listExhibits() { return readStore<Exhibit[]>("exhibits", DEFAULT_EXHIBITS); }
  async saveExhibit(item: Exhibit) { const exhibitor = (await this.listExhibitors()).find((candidate) => candidate.id === item.exhibitorId); if (!exhibitor || exhibitor.exhibitionId !== item.exhibitionId) throw new Error("展品与展商必须属于同一场展会"); const saved = { ...item, updatedAt: now() }; writeStore("exhibits", [saved, ...(await this.listExhibits()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteExhibit(id: string) { if ((await this.listPoints()).some((item) => item.exhibitId === id)) throw new Error("该展品仍被点位关联，请先解除关联后再删除。"); writeStore("exhibits", (await this.listExhibits()).filter((item) => item.id !== id)); }
  async listRoutes() {
    const routes = await readStore<Array<ExhibitionRoute & { exhibitionId?: string; from?: string; to?: string }>>("routes", DEFAULT_ROUTES);
    const points = await this.listPoints();
    return routes.map((route) => {
      if (route.pointIds?.length) return route;
      const venueId = route.venueId ?? DEFAULT_VENUES.find((venue) => venue.exhibitionId === route.exhibitionId)?.id ?? route.exhibitionId ?? "";
      const pointIds = [route.from, route.to].map((name) => points.find((point) => point.venueId === venueId && point.name === name)?.id).filter((id): id is string => Boolean(id));
      return { id: route.id, venueId, name: route.name, type: "navigation" as const, pointIds, directions: route.directions ?? [], estimatedMinutes: route.estimatedMinutes, description: route.description, status: route.status, createdAt: route.createdAt, updatedAt: route.updatedAt };
    });
  }
  async saveRoute(item: ExhibitionRoute) { const venue = (await this.listVenues()).find((candidate) => candidate.id === item.venueId); if (!venue) throw new Error("路线所属场地不存在"); const points = await this.listPoints(); if (item.pointIds.length < 2 || item.pointIds.some((id) => points.find((point) => point.id === id)?.venueId !== item.venueId)) throw new Error("路线至少需要两个属于同一场地的点位"); const saved = { ...item, updatedAt: now() }; writeStore("routes", [saved, ...(await this.listRoutes()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteRoute(id: string) { writeStore("routes", (await this.listRoutes()).filter((item) => item.id !== id)); }
  async listBroadcasts() { return readStore<EmergencyBroadcast[]>("broadcasts", DEFAULT_BROADCASTS); }
  async saveBroadcast(item: EmergencyBroadcast) { const saved = { ...item, updatedAt: now() }; writeStore("broadcasts", [saved, ...(await this.listBroadcasts()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async transitionBroadcast(id: string, status: EmergencyBroadcast["status"]) { const list = await this.listBroadcasts(); const next = list.map((item) => item.id === id ? { ...item, status, updatedAt: now() } : item); writeStore("broadcasts", next); return next.find((item) => item.id === id) ?? list[0]; }
  async deleteBroadcast(id: string) { writeStore("broadcasts", (await this.listBroadcasts()).filter((item) => item.id !== id)); }
  async listSchedules() { return readStore<EventSchedule[]>("schedules", DEFAULT_SCHEDULES); }
  async saveSchedule(item: EventSchedule) { if (!(await this.listExhibitions()).some((exhibition) => exhibition.id === item.exhibitionId)) throw new Error("活动所属展会不存在"); if (item.venueId) { const venue = (await this.listVenues()).find((candidate) => candidate.id === item.venueId); if (!venue || venue.exhibitionId !== item.exhibitionId) throw new Error("活动场地必须属于所属展会"); if (item.pointId && !(await this.listPoints()).some((point) => point.id === item.pointId && point.venueId === item.venueId)) throw new Error("活动点位必须属于所选场地"); } else if (item.pointId) throw new Error("选择活动点位前必须先选择场地"); const saved = { ...item, updatedAt: now() }; writeStore("schedules", [saved, ...(await this.listSchedules()).filter((candidate) => candidate.id !== item.id)]); return saved; }
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

export const DEFAULT_VOICES: VoiceAsset[] = EDGE_ZH_VOICES.map((voice) => ({
  id: `voice-edge-${voice.id}`,
  provider: "edge",
  targetModel: null,
  voiceId: voice.id,
  name: voice.label,
  previewText: "您好，欢迎来到四川博览集团数字人项目。",
  status: "active" as const,
  source: "system" as const,
}));
