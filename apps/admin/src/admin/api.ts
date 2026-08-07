import { ROLE_BUTTON_PERMISSIONS, ROLE_PERMISSIONS } from "./policy";
import { EDGE_ZH_VOICES } from "../constants/edgeZhVoices";
import type {
  AdminUser,
  DashboardData,
  OperationsReport,
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
  Lead,
  LeadStatus,
  Feedback,
  AdminUserRecord,
  RoleRecord,
  PermissionNode,
  AuditLog,
  SystemMonitor,
  AlertEvent,
  WelcomeConfig,
  ExplainFlow,
  ShoppingStrategy,
  GatewayPolicy,
  ReportFilters,
  ReportOperations,
} from "./types";

const STORAGE_PREFIX = "opentalking-admin-";
const now = () => new Date().toISOString();
export type DownloadData = string | Blob;
export type GifCreateInput = Omit<GifAssetMeta, "id" | "createdAt"> & { file?: File };

const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
type AdminBackend = "business" | "assets";

function buildAdminFetchUrl(path: string, backend: AdminBackend = "business"): string {
  const base = typeof window === "undefined" ? "http://127.0.0.1:5173/" : window.location.href;
  const proxyPrefix = backend === "assets" && runtimeEnv.VITE_ASSET_BACKEND_URL ? "/api-assets" : "/api";
  return new URL(`${proxyPrefix}${path}`, base).toString();
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

function readStoredSessionToken(): string {
  try {
    const raw = window.localStorage.getItem("opentalking-admin-session");
    const session = raw ? JSON.parse(raw) as { token?: unknown } : null;
    return typeof session?.token === "string" ? session.token : "";
  } catch {
    return "";
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
  { id: "script-3", name: "论坛活动介绍", scene: "explain", content: "本届展会围绕产业协同与技术创新安排了主题论坛和现场活动，我可以为您介绍活动时间、地点和议程。", exhibition: "2026 西部博览会", status: "active", updatedAt: "2026-08-03" },
];

const DEFAULT_WELCOME_CONFIGS: WelcomeConfig[] = [
  { id: "welcome-config-1", exhibitionId: "exhibition-1", exhibitionName: "2026 西部博览会", triggers: ["终端启动", "用户靠近", "唤醒词：你好小展"], scriptId: "script-1", highlights: ["智能制造展区", "主论坛活动", "现场签到服务"], checkInGuide: "请前往1号入口签到台，出示预约二维码完成入场。", notices: "请按照现场工作人员指引有序参观，保管好随身物品。", routingStrategy: "按时段优先推荐当前开放展馆", status: "active", updatedAt: "2026-08-03 16:20:00" },
];

const DEFAULT_EXPLAIN_FLOWS: ExplainFlow[] = [
  { id: "explain-flow-1", exhibitionId: "exhibition-1", exhibitionName: "2026 西部博览会", name: "智能制造展区讲解", keywords: ["协作机器人", "智能制造", "A1馆"], knowledgeCategories: ["展商", "展品", "活动排期"], interruptionPolicy: "sensitive_filter", scriptId: "script-2", status: "active", updatedAt: "2026-08-03 15:10:00" },
  { id: "explain-flow-2", exhibitionId: "exhibition-1", exhibitionName: "2026 西部博览会", name: "论坛活动讲解", keywords: ["主论坛", "开幕式", "活动排期"], knowledgeCategories: ["活动排期", "展区"], interruptionPolicy: "allow", scriptId: "script-3", status: "inactive", updatedAt: "2026-08-02 11:30:00" },
];

const DEFAULT_SHOPPING_STRATEGIES: ShoppingStrategy[] = [
  { id: "shopping-strategy-1", exhibitionId: "exhibition-1", exhibitionName: "2026 西部博览会", name: "协作机器人展品推荐", tags: ["协作机器人", "智能制造", "产线"], tagWeight: 0.7, compareDimensions: ["适用场景", "部署周期", "服务能力"], intentThreshold: 70, exhibitCategories: ["智能装备"], exhibitIds: ["exhibit-1"], status: "active", updatedAt: "2026-08-03 14:40:00" },
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

const DEFAULT_LEADS: Lead[] = [
  { id: "lead-1001", exhibitionId: "exhibition-1", exhibitionName: "2026 西部博览会", terminalId: "terminal-a01", terminalName: "A馆迎宾终端", companyName: "成都未来智造有限公司", contactName: "李明", phone: "13800138000", email: "liming@example.com", intentSummary: "关注协作机器人和数字化产线方案，希望安排商务洽谈。", status: "new", interestedExhibitorIds: ["exhibitor-1"], interestedExhibitIds: ["exhibit-1"], qrToken: "qr-lead-1001", createdAt: "2026-08-03 10:24:00", statusHistory: [{ status: "new", operator: "系统", time: "2026-08-03 10:24:00" }] },
  { id: "lead-1002", exhibitionId: "exhibition-1", exhibitionName: "2026 西部博览会", terminalId: "terminal-b02", terminalName: "B馆服务终端", companyName: "重庆文旅发展集团", contactName: "周芳", phone: "13900139000", email: "zhoufang@example.com", intentSummary: "希望了解智慧文旅导览平台的合作模式。", status: "contacted", interestedExhibitorIds: ["exhibitor-2"], interestedExhibitIds: ["exhibit-2"], qrToken: "qr-lead-1002", createdAt: "2026-08-02 15:12:00", statusHistory: [{ status: "new", operator: "系统", time: "2026-08-02 15:12:00" }, { status: "contacted", operator: "张运营", time: "2026-08-03 09:30:00", note: "已发送产品资料" }] },
  { id: "lead-1003", exhibitionId: "exhibition-2", exhibitionName: "2027 智能制造专题展", terminalId: "terminal-preview", terminalName: "专题展预览终端", companyName: "绵阳工业服务中心", contactName: "王凯", phone: "13700137000", email: "wangkai@example.com", intentSummary: "预约专题展展商入驻咨询。", status: "converted", interestedExhibitorIds: [], interestedExhibitIds: [], qrToken: "qr-lead-1003", createdAt: "2026-08-01 11:08:00", statusHistory: [{ status: "new", operator: "系统", time: "2026-08-01 11:08:00" }, { status: "converted", operator: "李运营", time: "2026-08-02 14:20:00" }] },
];

const DEFAULT_FEEDBACK: Feedback[] = [
  { id: "feedback-1", exhibitionId: "exhibition-1", type: "服务反馈", score: 5, content: "咨询转人工很顺畅，资料很有帮助。", traceId: "trace-20260803-001", status: "pending", createdAt: "2026-08-03 10:31:00" },
  { id: "feedback-2", exhibitionId: "exhibition-1", type: "体验问题", score: 3, content: "B馆终端扫码后页面加载稍慢。", traceId: "trace-20260802-018", status: "handled", createdAt: "2026-08-02 16:14:00", handledAt: "2026-08-03 09:00:00", handledBy: "系统管理员", note: "已纳入终端网络巡检" },
];

const DEFAULT_ADMIN_USERS: AdminUserRecord[] = [
  { id: "admin-user-1", username: "admin", displayName: "系统管理员", gender: "男", phone: "18888888888", email: "admin@example.com", department: "研发部", status: "active", roleIds: ["role-admin"], createdAt: "2026-07-20 09:00:00", lastLoginAt: "2026-08-04 09:45:42", lastLoginIp: "117.176.129.180" },
  { id: "admin-user-2", username: "content.ops", displayName: "内容运营", gender: "女", phone: "13900001111", email: "content@example.com", department: "运营部", status: "active", roleIds: ["role-content"], createdAt: "2026-07-22 14:20:00", lastLoginAt: "2026-08-04 09:20:12", lastLoginIp: "34.150.63.218" },
  { id: "admin-user-3", username: "audit", displayName: "安全审计", gender: "男", phone: "13600002222", email: "audit@example.com", department: "安全部", status: "active", roleIds: ["role-audit"], createdAt: "2026-07-23 11:12:00", lastLoginAt: "2026-08-03 18:10:02", lastLoginIp: "10.0.0.18" },
];

const DEFAULT_ROLES: RoleRecord[] = [
  { id: "role-admin", code: "sys_admin", name: "系统管理员", dataScope: "全部数据", level: 1, description: "拥有全部管理权限", permissionIds: ["dashboard:view", "event:exhibition", "event:exhibitor", "event:exhibit", "event:schedule", "event:venue", "event:point", "event:route", "event:broadcast", "lead:view", "asset:avatar", "asset:voice", "asset:scene", "asset:idle", "knowledge:document", "knowledge:base", "knowledge:memory", "interact:test", "report:interaction", "system:user", "system:role", "system:audit", "system:ops"], createdAt: "2026-07-20 09:00:00" },
  { id: "role-content", code: "content_ops", name: "内容运营", dataScope: "自定义", level: 2, description: "负责展会内容和线索运营", permissionIds: ["dashboard:view", "event:exhibition", "event:exhibitor", "event:exhibit", "event:schedule", "event:venue", "event:point", "event:route", "event:broadcast", "lead:view", "asset:avatar", "asset:voice", "asset:scene", "asset:idle", "knowledge:document", "knowledge:base", "knowledge:memory", "interact:test"], createdAt: "2026-07-22 14:20:00" },
  { id: "role-audit", code: "security_audit", name: "安全审计", dataScope: "全部数据", level: 3, description: "查看审计日志与调用链路", permissionIds: ["dashboard:view", "report:interaction", "system:audit"], createdAt: "2026-07-23 11:12:00" },
];

const DEFAULT_PERMISSION_TREE: PermissionNode[] = [
  { id: "menu-dashboard", parentId: null, name: "首页", code: "dashboard:view", type: "menu", path: "/dashboard", apiPattern: "" },
  { id: "menu-event", parentId: null, name: "展会运营", code: "event:view", type: "menu", path: "/event", apiPattern: "" },
  ...[
    ["展会列表", "event:exhibition", "/event/exhibition"], ["展商管理", "event:exhibitor", "/event/exhibitor"], ["展品管理", "event:exhibit", "/event/exhibit"], ["活动排期", "event:schedule", "/event/schedule"], ["场地管理", "event:venue", "/event/venue"], ["点位管理", "event:point", "/event/point"], ["路线规划", "event:route", "/event/route"], ["应急播报", "event:broadcast", "/event/broadcast"], ["线索运营", "lead:view", "/lead"],
  ].map(([name, code, path]) => ({ id: `menu-${code}`, parentId: "menu-event", name, code, type: "menu" as const, path, apiPattern: "" })),
  { id: "menu-asset", parentId: null, name: "数字人中心", code: "asset:view", type: "menu", path: "/asset", apiPattern: "" },
  ...[["数字人形象", "asset:avatar", "/asset/avatar"], ["声音配置", "asset:voice", "/asset/voice"], ["场景绑定", "asset:scene", "/asset/scene"], ["待机内容", "asset:idle", "/asset/idle"]].map(([name, code, path]) => ({ id: `menu-${code}`, parentId: "menu-asset", name, code, type: "menu" as const, path, apiPattern: "" })),
  { id: "menu-knowledge", parentId: null, name: "知识中心", code: "knowledge:view", type: "menu", path: "/knowledge", apiPattern: "" },
  ...[["文档资料", "knowledge:document", "/knowledge/document"], ["知识库", "knowledge:base", "/knowledge/base"], ["记忆库", "knowledge:memory", "/knowledge/memory"], ["问答知识", "knowledge:qa", "/knowledge/qa"], ["官方话术", "knowledge:script", "/knowledge/script"], ["发布审核", "knowledge:package", "/knowledge/package"]].map(([name, code, path]) => ({ id: `menu-${code}`, parentId: "menu-knowledge", name, code, type: "menu" as const, path, apiPattern: "" })),
  { id: "menu-interact", parentId: null, name: "交互管理", code: "interact:view", type: "menu", path: "/interact", apiPattern: "" },
  ...[["实时测试", "interact:test", "/interact/test"], ["欢迎配置", "interact:welcome", "/interact/welcome"], ["讲解流程", "interact:explain", "/interact/explain"], ["导购策略", "interact:shopping", "/interact/shopping"]].map(([name, code, path]) => ({ id: `menu-${code}`, parentId: "menu-interact", name, code, type: "menu" as const, path, apiPattern: "" })),
  { id: "menu-report", parentId: null, name: "数据分析", code: "report:interaction", type: "menu", path: "/report/interaction", apiPattern: "" },
  { id: "menu-system", parentId: null, name: "系统管理", code: "system:view", type: "menu", path: "/system", apiPattern: "" },
  ...[["用户管理", "system:user", "/system/user"], ["角色管理", "system:role", "/system/role"], ["审计日志", "system:audit", "/system/audit"], ["监控告警", "system:ops", "/system/ops"]].map(([name, code, path]) => ({ id: `menu-${code}`, parentId: "menu-system", name, code, type: "menu" as const, path, apiPattern: "" })),
];

const DEFAULT_AUDIT_LOGS: AuditLog[] = [
  { id: "audit-1", traceId: "trace-20260803-001", username: "admin", ip: "117.176.129.180", ipLocation: "中国四川省成都市", description: "用户登录", browser: "Chrome 150", durationMs: 78, createdAt: "2026-08-04 09:45:42", resource: "认证服务", action: "login", spans: [{ id: "span-1", parentId: null, service: "gateway", operation: "POST /auth/login", startAt: "2026-08-04 09:45:42.012", durationMs: 78, status: "ok", attributes: { method: "POST", path: "/api/v1/auth/login" } }, { id: "span-2", parentId: "span-1", service: "user-service", operation: "查询用户", startAt: "2026-08-04 09:45:42.026", durationMs: 41, status: "ok", attributes: { user: "admin" } }] },
  { id: "audit-2", traceId: "trace-20260802-018", username: "content.ops", ip: "34.150.63.218", ipLocation: "美国德克萨斯州奥斯汀", description: "新增线索", browser: "Chrome 150", durationMs: 9, createdAt: "2026-08-04 09:43:01", resource: "线索管理", action: "create", after: { leadId: "lead-1001", status: "new" }, spans: [{ id: "span-3", parentId: null, service: "lead-service", operation: "POST /leads", startAt: "2026-08-04 09:43:01.102", durationMs: 9, status: "ok", attributes: { exhibitionId: "exhibition-1" } }] },
  { id: "audit-3", traceId: "trace-20260802-017", username: "admin", ip: "34.150.63.218", ipLocation: "美国德克萨斯州奥斯汀", description: "更新菜单权限", browser: "Chrome 150", durationMs: 75, createdAt: "2026-08-04 09:42:12", resource: "角色管理", action: "update", before: { permissionCount: 4 }, after: { permissionCount: 8 }, spans: [{ id: "span-4", parentId: null, service: "admin-service", operation: "PUT /roles/role-admin", startAt: "2026-08-04 09:42:12.210", durationMs: 75, status: "ok", attributes: { role: "sys_admin" } }] },
];

const DEFAULT_MONITOR: SystemMonitor = { os: "GNU/Linux Debian GNU/Linux 11 (bullseye) build 5.10.0-44-cloud-amd64", ip: "172.17.0.1", uptime: "56天18小时", refreshedAt: "2026-08-04 09:46:31", cpuPercent: 8, memoryPercent: 82.18, swapPercent: 6.65, diskPercent: 43.96, cpuHistory: [4, 2, 7, 1, 1], memoryHistory: [82, 82, 82, 82, 82], services: [{ id: "svc-admin", name: "管理后台", status: "ok", latencyMs: 32, checkedAt: "2026-08-04 09:46:31", description: "管理 API 与权限服务" }, { id: "svc-lead", name: "线索服务", status: "ok", latencyMs: 48, checkedAt: "2026-08-04 09:46:30", description: "线索采集与反馈服务" }, { id: "svc-knowledge", name: "知识服务", status: "warn", latencyMs: 126, checkedAt: "2026-08-04 09:46:29", description: "知识检索服务" }], terminals: [{ id: "terminal-a01", name: "A馆迎宾终端", exhibitionId: "exhibition-1", location: "A馆 1号入口", status: "online", lastHeartbeatAt: "2026-08-04 09:46:28", version: "1.4.2", cpuPercent: 18, memoryPercent: 46 }, { id: "terminal-b02", name: "B馆服务终端", exhibitionId: "exhibition-1", location: "B馆 服务台", status: "online", lastHeartbeatAt: "2026-08-04 09:46:27", version: "1.4.2", cpuPercent: 24, memoryPercent: 52 }, { id: "terminal-preview", name: "专题展预览终端", exhibitionId: "exhibition-2", location: "运营中心", status: "offline", lastHeartbeatAt: "2026-08-04 09:38:10", version: "1.3.8", cpuPercent: 0, memoryPercent: 0 }] };

const DEFAULT_ALERTS: AlertEvent[] = [
  { id: "alert-1", type: "服务延迟", severity: "normal", target: "知识服务", content: "近 5 分钟平均响应时间超过 100ms", status: "active", occurredAt: "2026-08-04 09:40:12" },
  { id: "alert-2", type: "终端离线", severity: "high", target: "专题展预览终端", content: "超过 5 分钟未收到心跳", status: "acknowledged", occurredAt: "2026-08-04 09:20:08", acknowledgedBy: "admin", acknowledgedAt: "2026-08-04 09:22:31" },
];

export interface AdminApiClient {
  login(username: string, password: string): Promise<{ token: string; user: AdminUser }>;
  getDashboard(): Promise<DashboardData>;
  getReport(filters?: ReportFilters): Promise<ReportOperations>;
  getOperationsReport(filters?: { exhibitionId?: string; from?: string; to?: string; groupBy?: "day" | "terminal" | "scene" | "intent" }): Promise<OperationsReport>;
  exportReport(exhibitionId?: string, format?: "xlsx" | "csv", filters?: { from?: string; to?: string; groupBy?: "day" | "terminal" | "scene" | "intent" }): Promise<DownloadData>;
  listGifs(): Promise<GifAssetMeta[]>;
  createGif(input: GifCreateInput): Promise<GifAssetMeta>;
  uploadGif(file: File, input: Pick<GifAssetMeta, "name" | "scene" | "tags" | "status">): Promise<GifAssetMeta>;
  updateGif(id: string, patch: Partial<GifAssetMeta>): Promise<GifAssetMeta>;
  deleteGif(id: string): Promise<void>;
  listVoiceConfigs(): Promise<VoiceAsset[]>;
  saveVoiceConfig(item: VoiceAsset): Promise<VoiceAsset>;
  deleteVoiceConfig(id: string): Promise<void>;
  listSceneBindings(): Promise<SceneBinding[]>;
  saveSceneBindings(bindings: SceneBinding[]): Promise<SceneBinding[]>;
  getSceneBinding(scene: string): Promise<SceneBinding>;
  saveSceneBinding(binding: SceneBinding): Promise<SceneBinding>;
  listIdle(): Promise<IdleContent[]>;
  saveIdle(item: IdleContent): Promise<IdleContent>;
  deleteIdle(id: string): Promise<void>;
  listDocuments(): Promise<KnowledgeDocument[]>;
  uploadDocument(input: Pick<KnowledgeDocument, "title" | "fileName" | "type" | "exhibition">): Promise<KnowledgeDocument>;
  updateDocument(id: string, patch: Partial<KnowledgeDocument>): Promise<KnowledgeDocument>;
  deleteDocument(id: string): Promise<void>;
  listQa(): Promise<KnowledgeQa[]>;
  saveQa(item: KnowledgeQa): Promise<KnowledgeQa>;
  transitionQa(id: string, status: KnowledgeQa["status"]): Promise<KnowledgeQa>;
  listQaVersions(id: string): Promise<Array<Record<string, unknown>>>;
  rollbackQa(id: string, version: number, reason: string): Promise<KnowledgeQa>;
  deleteQa(id: string): Promise<void>;
  listScripts(): Promise<ScriptTemplate[]>;
  saveScript(item: ScriptTemplate): Promise<ScriptTemplate>;
  deleteScript(id: string): Promise<void>;
  listWelcomeConfigs(exhibitionId?: string): Promise<WelcomeConfig[]>;
  saveWelcomeConfig(item: WelcomeConfig): Promise<WelcomeConfig>;
  listExplainFlows(exhibitionId?: string): Promise<ExplainFlow[]>;
  saveExplainFlow(item: ExplainFlow): Promise<ExplainFlow>;
  deleteExplainFlow(id: string): Promise<void>;
  listShoppingStrategies(exhibitionId?: string): Promise<ShoppingStrategy[]>;
  saveShoppingStrategy(item: ShoppingStrategy): Promise<ShoppingStrategy>;
  deleteShoppingStrategy(id: string): Promise<void>;
  listPackages(): Promise<PublishPackage[]>;
  createPackage(input: Pick<PublishPackage, "name" | "exhibition" | "qaCount" | "documentCount">): Promise<PublishPackage>;
  transitionPackage(id: string, status: PublishPackage["status"]): Promise<PublishPackage>;
  submitPackage(id: string, reason?: string): Promise<PublishPackage>;
  publishPackage(id: string, reason?: string): Promise<PublishPackage>;
  rollbackPackage(id: string, targetPackageId?: string, reason?: string): Promise<PublishPackage>;
  listMissPool(): Promise<MissPoolItem[]>;
  resolveMiss(id: string, status: MissPoolItem["status"]): Promise<MissPoolItem>;
  resolveMissAction(id: string, action: "ignore" | "handled" | "create_qa", reason?: string, qa?: Record<string, unknown>): Promise<MissPoolItem>;
  listExhibitions(): Promise<Exhibition[]>;
  saveExhibition(item: Exhibition): Promise<Exhibition>;
  saveExhibitionRuntimeConfig(item: Exhibition): Promise<Exhibition>;
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
  listLeads(filters?: { exhibitionId?: string; keyword?: string; status?: LeadStatus | ""; from?: string; to?: string }): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | null>;
  saveLead(item: Lead): Promise<Lead>;
  updateLeadStatus(id: string, status: LeadStatus, note?: string): Promise<Lead>;
  exportLeads(filters?: { exhibitionId?: string; keyword?: string; status?: string; from?: string; to?: string }, format?: "xlsx" | "csv"): Promise<DownloadData>;
  listFeedback(filters?: { exhibitionId?: string; keyword?: string; status?: Feedback["status"] }): Promise<Feedback[]>;
  resolveFeedback(id: string, note: string, operator?: string): Promise<Feedback>;
  listAdminUsers(filters?: { keyword?: string; status?: AdminUserRecord["status"] }): Promise<AdminUserRecord[]>;
  saveAdminUser(item: AdminUserRecord): Promise<AdminUserRecord>;
  deleteAdminUser(id: string): Promise<void>;
  resetAdminPassword(id: string): Promise<void>;
  exportAdminUsers(filters?: { keyword?: string; status?: AdminUserRecord["status"] }): Promise<string>;
  listRoles(): Promise<RoleRecord[]>;
  saveRole(item: RoleRecord): Promise<RoleRecord>;
  deleteRole(id: string): Promise<void>;
  listPermissionTree(): Promise<PermissionNode[]>;
  savePermissionNode(item: PermissionNode): Promise<PermissionNode>;
  deletePermissionNode(id: string): Promise<void>;
  listAuditLogs(filters?: { username?: string; ip?: string; keyword?: string; from?: string; to?: string }): Promise<AuditLog[]>;
  getTraceRecord(id: string): Promise<AuditLog | null>;
  exportAuditLogs(filters?: { username?: string; ip?: string; keyword?: string; from?: string; to?: string }): Promise<string>;
  clearAuditLogs(): Promise<void>;
  getSystemMonitor(): Promise<SystemMonitor>;
  listAlerts(): Promise<AlertEvent[]>;
  acknowledgeAlert(id: string, operator?: string): Promise<AlertEvent>;
  getGatewayPolicy(): Promise<GatewayPolicy>;
  saveGatewayPolicy(policy: GatewayPolicy): Promise<GatewayPolicy>;
}

function buildUser(username: string, role: AdminUser["role"]): AdminUser {
  return { id: `user-${username}`, username, displayName: username === "admin" ? "管理员" : username, role, permissions: ROLE_PERMISSIONS[role], buttonPermissions: ROLE_BUTTON_PERMISSIONS[role] };
}

const INTERACTION_MOCK_VERSION = "2026-08-04-v2";

function migrateInteractionMockData(): void {
  if (readStore<string>("interaction-mock-version", "") === INTERACTION_MOCK_VERSION) return;
  const exhibitions = readStore<Exhibition[]>("exhibitions", DEFAULT_EXHIBITIONS);
  const exhibitionName = new Map(exhibitions.map((item) => [item.id, item.name]));
  const fallbackExhibitionId = exhibitions.find((item) => item.status === "operating")?.id || exhibitions[0]?.id || "exhibition-1";
  const scripts = readStore<ScriptTemplate[]>("scripts", DEFAULT_SCRIPTS);
  const nextScripts = [...scripts, ...DEFAULT_SCRIPTS.filter((item) => !scripts.some((current) => current.id === item.id))];
  const scriptById = new Map(nextScripts.map((item) => [item.id, item]));
  const welcomeScriptId = nextScripts.find((item) => item.scene === "welcome")?.id || "";
  const explainScriptId = nextScripts.find((item) => item.scene === "explain")?.id || "";
  const normalizeExhibition = (id: string | undefined) => exhibitionName.has(id || "") ? id as string : fallbackExhibitionId;
  const welcomeConfigs = readStore<WelcomeConfig[]>("welcome-configs", DEFAULT_WELCOME_CONFIGS).map((item) => {
    const itemExhibitionId = normalizeExhibition(item.exhibitionId);
    return { ...item, exhibitionId: itemExhibitionId, exhibitionName: exhibitionName.get(itemExhibitionId) || item.exhibitionName, scriptId: scriptById.get(item.scriptId)?.scene === "welcome" ? item.scriptId : welcomeScriptId };
  });
  const explainFlows = readStore<ExplainFlow[]>("explain-flows", DEFAULT_EXPLAIN_FLOWS).map((item) => ({
    ...item,
    exhibitionId: normalizeExhibition(item.exhibitionId),
    exhibitionName: exhibitionName.get(normalizeExhibition(item.exhibitionId)) || item.exhibitionName,
    scriptId: item.id === "explain-flow-2" && item.scriptId === "script-2" ? "script-3" : scriptById.get(item.scriptId)?.scene === "explain" ? item.scriptId : explainScriptId,
    knowledgeCategories: item.id === "explain-flow-2" && item.knowledgeCategories.includes("论坛") ? ["活动排期", "展区"] : item.knowledgeCategories,
  }));
  const exhibitById = new Map(readStore<Exhibit[]>("exhibits", DEFAULT_EXHIBITS).map((item) => [item.id, item]));
  const shoppingStrategies = readStore<ShoppingStrategy[]>("shopping-strategies", DEFAULT_SHOPPING_STRATEGIES).map((item) => {
    const itemExhibitionId = normalizeExhibition(item.exhibitionId);
    const validExhibitIds = (item.exhibitIds || []).filter((id) => exhibitById.get(id)?.exhibitionId === itemExhibitionId);
    return {
      ...item,
      exhibitionId: itemExhibitionId,
      exhibitionName: exhibitionName.get(itemExhibitionId) || item.exhibitionName,
      exhibitIds: validExhibitIds,
      exhibitCategories: item.id === "shopping-strategy-1" && item.exhibitCategories.includes("工业软件") ? ["智能装备"] : item.exhibitCategories,
      tags: item.id === "shopping-strategy-1" && item.tags.includes("机器人") ? ["协作机器人", "智能制造", "产线"] : item.tags,
    };
  });
  writeStore("scripts", nextScripts);
  writeStore("welcome-configs", welcomeConfigs);
  writeStore("explain-flows", explainFlows);
  writeStore("shopping-strategies", shoppingStrategies);
  writeStore("interaction-mock-version", INTERACTION_MOCK_VERSION);
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

  async getOperationsReport(_filters?: { exhibitionId?: string; from?: string; to?: string; groupBy?: "day" | "terminal" | "scene" | "intent" }): Promise<OperationsReport> {
    const dashboard = await this.getDashboard();
    return {
      summary: {
        exhibition_id: "exhibition-1",
        interaction_count: Number(dashboard.metrics.find((item) => item.id === "interactions")?.value.replace(/,/g, "") || 0),
        online_terminals: Number(dashboard.metrics.find((item) => item.id === "terminals")?.value.split("/")[0].trim() || 0),
        pending_knowledge: Number(dashboard.metrics.find((item) => item.id === "pending")?.value || 0),
        new_leads: Number(dashboard.metrics.find((item) => item.id === "leads")?.value || 0),
        alerts: Number(dashboard.metrics.find((item) => item.id === "backlog")?.value || 0),
        todo: dashboard.todos,
      },
      series: [],
      dimensions: { interaction: [], hotspot: [], lead: [], resource: [] },
    };
  }

  async exportReport(): Promise<DownloadData> {
    const report = await this.getOperationsReport();
    return JSON.stringify(report, null, 2);
  }

  async getReport(filters: ReportFilters = {}): Promise<ReportOperations> {
    return {
      generatedAt: now(),
      filters,
      interaction: { total: 0, averageDurationMs: 0, byScene: [], byTerminal: [], byHour: [] },
      hotspot: { items: [] },
      hit: { total: 0, hit: 0, miss: 0, hitRate: 0, strongQaHit: 0, ragHit: 0 },
      lead: { total: 0, converted: 0, conversionRate: 0, byStatus: [] },
      resource: { items: [] },
    };
  }

  async listGifs() { return readStore("gifs", DEFAULT_GIFS); }
  async createGif(input: Omit<GifAssetMeta, "id" | "createdAt">) { const item = { ...input, id: `gif-${Date.now()}`, createdAt: now() }; writeStore("gifs", [item, ...await this.listGifs()]); return item; }
  async uploadGif(file: File, input: Pick<GifAssetMeta, "name" | "scene" | "tags" | "status">) {
    const previewUrl = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : `mock://${file.name}`;
    return this.createGif({ ...input, kind: "gif", previewUrl, width: 0, height: 0, frames: 0, durationMs: 0, fileName: file.name, sizeBytes: file.size });
  }
  async updateGif(id: string, patch: Partial<GifAssetMeta>) { const items = await this.listGifs(); const next = items.map((item) => item.id === id ? { ...item, ...patch } : item); writeStore("gifs", next); return next.find((item) => item.id === id) ?? items[0]; }
  async deleteGif(id: string) { writeStore("gifs", (await this.listGifs()).filter((item) => item.id !== id)); }
  async listVoiceConfigs() { return readStore<VoiceAsset[]>("voice-configs", []); }
  async saveVoiceConfig(item: VoiceAsset) { const saved = { ...item, id: item.id || `voice-config-${Date.now()}` }; writeStore("voice-configs", [saved, ...(await this.listVoiceConfigs()).filter((candidate) => candidate.id !== saved.id)]); return saved; }
  async deleteVoiceConfig(id: string) { writeStore("voice-configs", (await this.listVoiceConfigs()).filter((item) => item.id !== id)); }
  async listSceneBindings() { return readStore<SceneBinding[]>("scene-bindings", [{ scene: "welcome", assets: [{ assetId: "gif-welcome", isPrimary: true, order: 0 }] }, { scene: "explain", assets: [{ assetId: "gif-explain", isPrimary: true, order: 0 }] }, { scene: "idle", assets: [{ assetId: "gif-idle", isPrimary: true, order: 0 }] }]); }
  async saveSceneBindings(bindings: SceneBinding[]) { writeStore("scene-bindings", bindings); return bindings; }
  async getSceneBinding(scene: string) { return (await this.listSceneBindings()).find((item) => item.scene === scene) ?? { scene, assets: [] }; }
  async saveSceneBinding(binding: SceneBinding) { await this.saveSceneBindings([...(await this.listSceneBindings()).filter((item) => item.scene !== binding.scene), binding]); return binding; }
  async listIdle() { return readStore<IdleContent[]>("idle", [{ id: "idle-1", type: "标语轮播", title: "西博会欢迎语", content: "欢迎来到 2026 西部博览会", interval: 8, exhibition: "2026 西部博览会", enabled: true }]); }
  async saveIdle(item: IdleContent) { const items = (await this.listIdle()).filter((candidate) => candidate.id !== item.id); const next = [item, ...items]; writeStore("idle", next); return item; }
  async deleteIdle(id: string) { writeStore("idle", (await this.listIdle()).filter((item) => item.id !== id)); }
  async listDocuments() { return readStore("documents", DEFAULT_DOCUMENTS); }
  async uploadDocument(input: Pick<KnowledgeDocument, "title" | "fileName" | "type" | "exhibition">) { const item: KnowledgeDocument = { ...input, id: `doc-${Date.now()}`, parseStatus: "parsing", vectorStatus: "pending", chunks: 0, uploader: "当前用户", uploadedAt: now() }; writeStore("documents", [item, ...await this.listDocuments()]); window.setTimeout(() => { void this.patchDocument(item.id, { parseStatus: "parsed", vectorStatus: "indexed", chunks: 32 }); }, 1200); return item; }
  private async patchDocument(id: string, patch: Partial<KnowledgeDocument>) { const next = (await this.listDocuments()).map((item) => item.id === id ? { ...item, ...patch } : item); writeStore("documents", next); }
  async updateDocument(id: string, patch: Partial<KnowledgeDocument>) { await this.patchDocument(id, patch); return (await this.listDocuments()).find((item) => item.id === id) ?? (await this.listDocuments())[0]; }
  async deleteDocument(id: string) { writeStore("documents", (await this.listDocuments()).filter((item) => item.id !== id)); }
  async listQa() { return readStore("qa", DEFAULT_QA); }
  async saveQa(item: KnowledgeQa) { const list = await this.listQa(); const next = [item, ...list.filter((candidate) => candidate.id !== item.id)]; writeStore("qa", next); return item; }
  async transitionQa(id: string, status: KnowledgeQa["status"]) { const list = await this.listQa(); const next = list.map((item) => item.id === id ? { ...item, status, reviewer: status === "published" ? "当前用户" : item.reviewer, updatedAt: now() } : item); writeStore("qa", next); return next.find((item) => item.id === id) ?? list[0]; }
  async listQaVersions(id: string) { const item = (await this.listQa()).find((candidate) => candidate.id === id); return item ? [...item.history, { version: item.version, question: item.question, answer: item.answer, status: item.status, updatedAt: item.updatedAt }] : []; }
  async rollbackQa(id: string, version: number, reason: string) { const item = (await this.listQa()).find((candidate) => candidate.id === id); const target = item?.history.find((candidate) => candidate.version === version); if (!item || !target) throw new Error("QA 版本不存在"); return this.saveQa({ ...item, version, answer: target.answer, status: "draft", updatedAt: now(), history: [...item.history, { ...target, version: item.version + 1, reason }] }); }
  async deleteQa(id: string) { await this.transitionQa(id, "archived"); }
  async listScripts() { migrateInteractionMockData(); return readStore("scripts", DEFAULT_SCRIPTS); }
  async saveScript(item: ScriptTemplate) { const next = [item, ...(await this.listScripts()).filter((candidate) => candidate.id !== item.id)]; writeStore("scripts", next); return item; }
  async deleteScript(id: string) { writeStore("scripts", (await this.listScripts()).filter((item) => item.id !== id)); }
  async listWelcomeConfigs(exhibitionId?: string) { migrateInteractionMockData(); return (await readStore<WelcomeConfig[]>("welcome-configs", DEFAULT_WELCOME_CONFIGS)).filter((item) => !exhibitionId || exhibitionId === "all" || item.exhibitionId === exhibitionId); }
  async saveWelcomeConfig(item: WelcomeConfig) { const exhibition = (await this.listExhibitions()).find((candidate) => candidate.id === item.exhibitionId); if (!exhibition) throw new Error("欢迎配置所属展会不存在"); const scripts = await this.listScripts(); if (!scripts.some((script) => script.id === item.scriptId && script.scene === "welcome")) throw new Error("欢迎配置必须关联迎宾话术"); const saved = { ...item, exhibitionName: exhibition.name, updatedAt: now() }; writeStore("welcome-configs", [saved, ...(await this.listWelcomeConfigs()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async listExplainFlows(exhibitionId?: string) { migrateInteractionMockData(); return (await readStore<ExplainFlow[]>("explain-flows", DEFAULT_EXPLAIN_FLOWS)).filter((item) => !exhibitionId || exhibitionId === "all" || item.exhibitionId === exhibitionId); }
  async saveExplainFlow(item: ExplainFlow) { const exhibition = (await this.listExhibitions()).find((candidate) => candidate.id === item.exhibitionId); if (!exhibition) throw new Error("讲解流程所属展会不存在"); const scripts = await this.listScripts(); if (!scripts.some((script) => script.id === item.scriptId && script.scene === "explain")) throw new Error("讲解流程必须关联讲解话术"); const saved = { ...item, exhibitionName: exhibition.name, updatedAt: now() }; writeStore("explain-flows", [saved, ...(await this.listExplainFlows()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteExplainFlow(id: string) { writeStore("explain-flows", (await this.listExplainFlows()).filter((item) => item.id !== id)); }
  async listShoppingStrategies(exhibitionId?: string) { migrateInteractionMockData(); return (await readStore<ShoppingStrategy[]>("shopping-strategies", DEFAULT_SHOPPING_STRATEGIES)).map((item) => ({ ...item, exhibitIds: item.exhibitIds ?? [] })).filter((item) => !exhibitionId || exhibitionId === "all" || item.exhibitionId === exhibitionId); }
  async saveShoppingStrategy(item: ShoppingStrategy) { const exhibition = (await this.listExhibitions()).find((candidate) => candidate.id === item.exhibitionId); if (!exhibition) throw new Error("导购策略所属展会不存在"); const exhibits = await this.listExhibits(); const exhibitIds = (item.exhibitIds || []).filter((id) => exhibits.some((exhibit) => exhibit.id === id && exhibit.exhibitionId === item.exhibitionId)); if (exhibitIds.length !== (item.exhibitIds || []).length) throw new Error("导购策略关联的展品必须属于所选展会"); const saved = { ...item, exhibitionName: exhibition.name, exhibitIds, updatedAt: now() }; writeStore("shopping-strategies", [saved, ...(await this.listShoppingStrategies()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteShoppingStrategy(id: string) { writeStore("shopping-strategies", (await this.listShoppingStrategies()).filter((item) => item.id !== id)); }
  async listPackages() { return readStore("packages", DEFAULT_PACKAGES); }
  async createPackage(input: Pick<PublishPackage, "name" | "exhibition" | "qaCount" | "documentCount">) { const item: PublishPackage = { ...input, id: `pkg-${Date.now()}`, status: "draft", version: 1, creator: "当前用户", updatedAt: now() }; writeStore("packages", [item, ...await this.listPackages()]); return item; }
  async transitionPackage(id: string, status: PublishPackage["status"]) { const list = await this.listPackages(); const next = list.map((item) => item.id === id ? { ...item, status, reviewer: status === "published" ? "当前用户" : item.reviewer, updatedAt: now() } : item); writeStore("packages", next); return next.find((item) => item.id === id) ?? list[0]; }
  async submitPackage(id: string, reason?: string) { void reason; return this.transitionPackage(id, "pending_review"); }
  async publishPackage(id: string, reason?: string) { void reason; return this.transitionPackage(id, "published"); }
  async rollbackPackage(id: string, targetPackageId?: string, reason?: string) { void reason; const current = await this.transitionPackage(id, "rolled_back"); if (targetPackageId) await this.transitionPackage(targetPackageId, "published"); return current; }
  async listMissPool() { return readStore("miss-pool", DEFAULT_MISS); }
  async resolveMiss(id: string, status: MissPoolItem["status"]) { const list = await this.listMissPool(); const next = list.map((item) => item.id === id ? { ...item, status } : item); writeStore("miss-pool", next); return next.find((item) => item.id === id) ?? list[0]; }
  async resolveMissAction(id: string, action: "ignore" | "handled" | "create_qa", reason?: string, qa?: Record<string, unknown>) { void reason; void qa; return this.resolveMiss(id, action === "ignore" ? "ignored" : action === "create_qa" ? "converted_qa" : "supplemented"); }
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
  async saveExhibitionRuntimeConfig(item: Exhibition) { return this.saveExhibition(item); }
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
  async listLeads(filters: { exhibitionId?: string; keyword?: string; status?: LeadStatus | ""; from?: string; to?: string } = {}) {
    const keyword = filters.keyword?.trim().toLowerCase();
    return (await readStore<Lead[]>("leads", DEFAULT_LEADS)).filter((item) => (!filters.exhibitionId || filters.exhibitionId === "all" || item.exhibitionId === filters.exhibitionId) && (!filters.status || item.status === filters.status) && (!keyword || [item.id, item.companyName, item.contactName].some((value) => value.toLowerCase().includes(keyword))) && (!filters.from || item.createdAt.slice(0, 10) >= filters.from) && (!filters.to || item.createdAt.slice(0, 10) <= filters.to));
  }
  async getLead(id: string) { return (await this.listLeads()).find((item) => item.id === id) ?? null; }
  async saveLead(item: Lead) { const saved = { ...item, updatedAt: now() } as Lead; writeStore("leads", [saved, ...(await this.listLeads()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async updateLeadStatus(id: string, status: LeadStatus, note?: string) { const list = await this.listLeads(); const existing = list.find((item) => item.id === id); if (!existing) throw new Error("线索不存在"); const saved = { ...existing, status, statusHistory: [...existing.statusHistory, { status, operator: "当前用户", time: now(), note }] }; writeStore("leads", [saved, ...list.filter((item) => item.id !== id)]); return saved; }
  async exportLeads(filters: { exhibitionId?: string; keyword?: string; status?: string; from?: string; to?: string } = {}) { const rows = await this.listLeads(filters as { exhibitionId?: string; keyword?: string; status?: LeadStatus; from?: string; to?: string }); return [["线索ID", "展会", "单位名称", "联系人", "状态", "创建时间"], ...rows.map((item) => [item.id, item.exhibitionName, item.companyName, item.contactName, item.status, item.createdAt])].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"); }
  async listFeedback(filters: { exhibitionId?: string; keyword?: string; status?: Feedback["status"] } = {}) { const keyword = filters.keyword?.trim().toLowerCase(); return (await readStore<Feedback[]>("feedback", DEFAULT_FEEDBACK)).filter((item) => (!filters.exhibitionId || filters.exhibitionId === "all" || item.exhibitionId === filters.exhibitionId) && (!filters.status || item.status === filters.status) && (!keyword || `${item.content} ${item.type} ${item.traceId}`.toLowerCase().includes(keyword))); }
  async resolveFeedback(id: string, note: string, operator = "当前用户") { const list = await this.listFeedback(); const existing = list.find((item) => item.id === id); if (!existing) throw new Error("反馈不存在"); const saved = { ...existing, status: "handled" as const, note, handledBy: operator, handledAt: now() }; writeStore("feedback", [saved, ...list.filter((item) => item.id !== id)]); return saved; }
  async listAdminUsers(filters: { keyword?: string; status?: AdminUserRecord["status"] } = {}) { const keyword = filters.keyword?.trim().toLowerCase(); return (await readStore<AdminUserRecord[]>("admin-users", DEFAULT_ADMIN_USERS)).filter((item) => (!filters.status || item.status === filters.status) && (!keyword || [item.username, item.displayName, item.email].some((value) => value.toLowerCase().includes(keyword)))); }
  async saveAdminUser(item: AdminUserRecord) { const saved = { ...item, updatedAt: now() } as AdminUserRecord; writeStore("admin-users", [saved, ...(await this.listAdminUsers()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteAdminUser(id: string) { writeStore("admin-users", (await this.listAdminUsers()).filter((item) => item.id !== id)); }
  async resetAdminPassword(_id: string) { return undefined; }
  async exportAdminUsers(filters: { keyword?: string; status?: AdminUserRecord["status"] } = {}) { const rows = await this.listAdminUsers(filters); return [["用户名", "昵称", "邮箱", "部门", "状态", "创建日期"], ...rows.map((item) => [item.username, item.displayName, item.email, item.department, item.status, item.createdAt])].map((row) => row.join(",")).join("\n"); }
  async listRoles() { const stored = readStore<RoleRecord[]>("roles", DEFAULT_ROLES); if (stored.some((role) => role.permissionIds.some((permission) => permission.startsWith("permission-")))) { writeStore("roles", DEFAULT_ROLES); return DEFAULT_ROLES; } return stored; }
  async saveRole(item: RoleRecord) { const saved = { ...item, updatedAt: now() } as RoleRecord; writeStore("roles", [saved, ...(await this.listRoles()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteRole(id: string) { writeStore("roles", (await this.listRoles()).filter((item) => item.id !== id)); }
  async listPermissionTree() { const stored = readStore<PermissionNode[]>("permissions", DEFAULT_PERMISSION_TREE); const base = stored.some((item) => item.type !== "menu" || item.code === "system:permission" || item.id.startsWith("permission-")) ? DEFAULT_PERMISSION_TREE : stored; const flat = normalizeMenuPermissionNodes(base); if (flat !== stored) writeStore("permissions", flat); const children = (parentId: string | null): PermissionNode[] => flat.filter((item) => item.parentId === parentId).map((item) => ({ ...item, children: children(item.id) })); return children(null); }
  async savePermissionNode(item: PermissionNode) { const flat = flattenPermissionNodes(await this.listPermissionTree()); const saved = { ...item, updatedAt: now() } as PermissionNode; writeStore("permissions", [saved, ...flat.filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deletePermissionNode(id: string) { const flat = flattenPermissionNodes(await this.listPermissionTree()); const ids = new Set([id]); let changed = true; while (changed) { changed = false; flat.forEach((item) => { if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; } }); } writeStore("permissions", flat.filter((item) => !ids.has(item.id))); }
  async listAuditLogs(filters: { username?: string; ip?: string; keyword?: string; from?: string; to?: string } = {}) { const keyword = filters.keyword?.trim().toLowerCase(); return (await readStore<AuditLog[]>("audit-logs", DEFAULT_AUDIT_LOGS)).filter((item) => (!filters.username || item.username.includes(filters.username)) && (!filters.ip || item.ip.includes(filters.ip)) && (!keyword || `${item.description} ${item.traceId}`.toLowerCase().includes(keyword)) && (!filters.from || item.createdAt.slice(0, 10) >= filters.from) && (!filters.to || item.createdAt.slice(0, 10) <= filters.to)); }
  async getTraceRecord(id: string) { const list = await this.listAuditLogs(); return list.find((item) => item.id === id || item.traceId === id) ?? null; }
  async exportAuditLogs(filters: { username?: string; ip?: string; keyword?: string; from?: string; to?: string } = {}) { const rows = await this.listAuditLogs(filters); return [["Trace ID", "用户名", "IP", "描述", "请求耗时", "创建日期"], ...rows.map((item) => [item.traceId, item.username, item.ip, item.description, `${item.durationMs}ms`, item.createdAt])].map((row) => row.join(",")).join("\n"); }
  async clearAuditLogs() { writeStore("audit-logs", []); }
  async getSystemMonitor() { const monitor = readStore<SystemMonitor>("system-monitor", DEFAULT_MONITOR); const refreshed = { ...monitor, refreshedAt: now() }; writeStore("system-monitor", refreshed); return refreshed; }
  async listAlerts() { return readStore<AlertEvent[]>("alerts", DEFAULT_ALERTS); }
  async acknowledgeAlert(id: string, operator = "当前用户") { const list = await this.listAlerts(); const existing = list.find((item) => item.id === id); if (!existing) throw new Error("告警不存在"); const saved = { ...existing, status: "acknowledged" as const, acknowledgedBy: operator, acknowledgedAt: now() }; writeStore("alerts", [saved, ...list.filter((item) => item.id !== id)]); return saved; }
  async getGatewayPolicy() { return readStore<GatewayPolicy>("gateway-policy", { id: "gateway-policy", name: "默认网关策略", whitelist: [], rateLimitPerMinute: 120, timeoutMs: 15000, fallbackMode: "text", enabled: true, updatedAt: now() }); }
  async saveGatewayPolicy(policy: GatewayPolicy) { const saved = { ...policy, updatedAt: now() }; writeStore("gateway-policy", saved); return saved; }
}

function normalizeMenuPermissionNodes(nodes: PermissionNode[]): PermissionNode[] {
  if (nodes.some((node) => node.id === "menu-event-core")) return nodes;
  const groups: Array<[string, string, string, string, string[]]> = [
    ["menu-event-core", "menu-event", "展会管理", "event:group:core", ["event:exhibition"]],
    ["menu-event-content", "menu-event", "参展内容", "event:group:content", ["event:exhibitor", "event:exhibit", "event:schedule"]],
    ["menu-event-space", "menu-event", "空间导览", "event:group:space", ["event:venue", "event:point", "event:route"]],
    ["menu-event-live", "menu-event", "现场运营", "event:group:live", ["event:broadcast", "lead:view"]],
  ];
  const eventCodes = new Set(groups.flatMap((group) => group[4]));
  const children = groups.map(([id, parentId, name, code]) => ({ id, parentId, name, code, type: "menu" as const, path: "", apiPattern: "" }));
  const reassigned = nodes.map((node) => {
    const group = groups.find((candidate) => candidate[4].includes(node.code));
    return group ? { ...node, parentId: group[0] } : node;
  });
  return [...reassigned.filter((node) => !(node.parentId === "menu-event" && eventCodes.has(node.code))), ...children];
}

function flattenPermissionNodes(nodes: PermissionNode[]): PermissionNode[] {
  return nodes.flatMap((node) => [{ ...node, children: undefined }, ...(node.children ? flattenPermissionNodes(node.children) : [])]);
}

type AdminPage<T> = { items?: T[]; total?: number; page?: number; page_size?: number };
type JsonRecord = Record<string, any>;

function queryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== "all") query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly traceId: string,
    readonly detail: string,
  ) {
    super(detail || `Admin API ${status}`);
    this.name = "AdminApiError";
  }
}

function isClientDraftId(value: unknown): boolean {
  const id = String(value || "");
  return /^(?:new|user|role|welcome-config|explain-flow|shopping-strategy|voice-local|idle|doc|qa|script|package|gif|lead)-\d+$/.test(id);
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string") return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeWelcomeTrigger(value: unknown): string[] {
  if (Array.isArray(value)) return stringArray(value);
  const trigger = String(value || "");
  if (trigger === "terminal_start") return ["终端启动"];
  if (trigger === "user_nearby") return ["用户靠近"];
  if (trigger === "wake_word") return ["唤醒词"];
  return trigger ? [trigger] : [];
}

function normalizeReportBucket(value: unknown): ReportOperations["interaction"]["byScene"][number] {
  const item = value && typeof value === "object" ? value as JsonRecord : {};
  return {
    key: String(item.key ?? item.id ?? item.label ?? ""),
    count: Number(item.count ?? item.total ?? 0),
    averageDurationMs: item.averageDurationMs == null ? undefined : Number(item.averageDurationMs),
    totalDurationMs: item.totalDurationMs == null ? undefined : Number(item.totalDurationMs),
  };
}

function normalizeReportBuckets(value: unknown): ReportOperations["interaction"]["byScene"] {
  if (Array.isArray(value)) return value.map(normalizeReportBucket);
  if (value && typeof value === "object") {
    return Object.entries(value as JsonRecord).map(([key, count]) => ({ key, count: Number(count || 0) }));
  }
  return [];
}

function normalizeReportOperations(raw: JsonRecord): ReportOperations {
  const interaction = raw.interaction && typeof raw.interaction === "object" ? raw.interaction as JsonRecord : {};
  const hotspot = raw.hotspot && typeof raw.hotspot === "object" ? raw.hotspot as JsonRecord : {};
  const hit = raw.hit && typeof raw.hit === "object" ? raw.hit as JsonRecord : {};
  const lead = raw.lead && typeof raw.lead === "object" ? raw.lead as JsonRecord : {};
  const resource = raw.resource && typeof raw.resource === "object" ? raw.resource as JsonRecord : {};
  const dimensions = raw.dimensions && typeof raw.dimensions === "object" ? raw.dimensions as JsonRecord : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary as JsonRecord : {};
  const interactionDimension = dimensions.interaction ?? interaction.byScene;
  const leadDimension = dimensions.lead ?? lead.byStatus;
  return {
    generatedAt: String(raw.generatedAt || raw.generated_at || now()),
    filters: (raw.filters && typeof raw.filters === "object" ? raw.filters : {}) as Record<string, string | null | undefined>,
    interaction: {
      total: Number(interaction.total ?? summary.interaction_count ?? 0),
      averageDurationMs: Number(interaction.averageDurationMs ?? 0),
      byScene: normalizeReportBuckets(interactionDimension),
      byTerminal: normalizeReportBuckets(dimensions.terminal ?? interaction.byTerminal),
      byHour: normalizeReportBuckets(interaction.byHour),
    },
    hotspot: { items: normalizeReportBuckets(hotspot.items ?? dimensions.hotspot) },
    hit: {
      total: Number(hit.total ?? dimensions.hit?.total ?? 0),
      hit: Number(hit.hit ?? dimensions.hit?.hit ?? 0),
      miss: Number(hit.miss ?? dimensions.hit?.miss ?? 0),
      hitRate: Number(hit.hitRate ?? 0),
      strongQaHit: Number(hit.strongQaHit ?? 0),
      ragHit: Number(hit.ragHit ?? 0),
    },
    lead: {
      total: Number(lead.total ?? summary.new_leads ?? 0),
      converted: Number(lead.converted ?? 0),
      conversionRate: Number(lead.conversionRate ?? 0),
      byStatus: normalizeReportBuckets(leadDimension),
    },
    resource: { items: normalizeReportBuckets(resource.items ?? dimensions.resource) },
  };
}

function normalizeOperationsReport(raw: JsonRecord): OperationsReport {
  const report = normalizeReportOperations(raw);
  const rawSummary = raw.summary && typeof raw.summary === "object" ? raw.summary as JsonRecord : {};
  const rawFilters = raw.filters && typeof raw.filters === "object" ? raw.filters as JsonRecord : {};
  const summary = {
    exhibition_id: String(rawSummary.exhibition_id ?? rawFilters.exhibition_id ?? ""),
    interaction_count: Number(rawSummary.interaction_count ?? report.interaction.total),
    online_terminals: Number(rawSummary.online_terminals ?? 0),
    pending_knowledge: Number(rawSummary.pending_knowledge ?? 0),
    new_leads: Number(rawSummary.new_leads ?? report.lead.total),
    alerts: Number(rawSummary.alerts ?? 0),
    todo: Array.isArray(rawSummary.todo) ? rawSummary.todo as DashboardData["todos"] : [],
  };
  const rawSeries = Array.isArray(raw.series) ? raw.series : [];
  const dimensionItems = (items: ReportOperations["interaction"]["byScene"]) => items.map((item) => ({ label: item.key, count: item.count }));
  return {
    summary,
    series: rawSeries.map((item) => {
      const value = item && typeof item === "object" ? item as JsonRecord : {};
      return { date: String(value.date || value.key || ""), interactions: Number(value.interactions ?? value.count ?? 0), leads: Number(value.leads ?? 0), misses: Number(value.misses ?? 0) };
    }),
    dimensions: {
      interaction: dimensionItems(report.interaction.byScene),
      hotspot: dimensionItems(report.hotspot.items),
      hit: dimensionItems(normalizeReportBuckets((raw.dimensions as JsonRecord | undefined)?.hit)),
      lead: dimensionItems(report.lead.byStatus),
      resource: dimensionItems(report.resource.items),
    },
  };
}

export class FetchAdminApiClient implements AdminApiClient {
  private token(): string {
    return window.localStorage.getItem(`${STORAGE_PREFIX}token`) || readStoredSessionToken();
  }

  private assetToken(): string {
    return window.localStorage.getItem(`${STORAGE_PREFIX}asset-token`)
      || runtimeEnv.VITE_ADMIN_ASSET_TOKEN
      || this.token();
  }

  private backendForPath(path: string): AdminBackend {
    return path.startsWith("/admin/report/") || path === "/admin/assets" || path.startsWith("/admin/assets/")
      ? "assets"
      : "business";
  }

  private tokenForBackend(backend: AdminBackend): string {
    return backend === "assets" ? this.assetToken() : this.token();
  }

  private async request<T>(path: string, init: RequestInit = {}, tokenOverride?: string, backendOverride?: AdminBackend): Promise<T> {
    const backend = backendOverride ?? this.backendForPath(path);
    const token = tokenOverride ?? this.tokenForBackend(backend);
    const response = await fetch(buildAdminFetchUrl(`/v1${path}`, backend), {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    if (response.status === 401 && path !== "/auth/login" && backend === "business") {
      window.localStorage.removeItem(`${STORAGE_PREFIX}token`);
      window.localStorage.removeItem("opentalking-admin-session");
      window.dispatchEvent(new CustomEvent("opentalking-admin-auth-expired"));
    }
    if (!response.ok) {
      let code = `HTTP_${response.status}`;
      let traceId = "";
      let detail = `Admin API ${response.status}`;
      try {
        const payload = await response.json() as JsonRecord;
        const body = payload.detail ?? payload;
        code = String(payload.code || (typeof body === "object" && body ? body.code : "") || code);
        traceId = String(payload.trace_id || payload.traceId || (typeof body === "object" && body ? body.trace_id || body.traceId : "") || "");
        detail = typeof body === "string" ? body : body?.detail || body?.message || code || detail;
      } catch { /* keep status fallback */ }
      throw new AdminApiError(response.status, code, traceId, detail);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async download(path: string): Promise<string> {
    const backend = this.backendForPath(path);
    const token = this.tokenForBackend(backend);
    const response = await fetch(buildAdminFetchUrl(`/v1${path}`, backend), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error(`Admin API ${response.status}`);
    return response.text();
  }

  private async downloadFile(path: string): Promise<Blob> {
    const backend = this.backendForPath(path);
    const token = this.tokenForBackend(backend);
    const response = await fetch(buildAdminFetchUrl(`/v1${path}`, backend), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error(`Admin API ${response.status}`);
    return response.blob();
  }

  private async list<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> {
    const payload = await this.request<AdminPage<T> | T[]>(`${path}${queryString(params)}`);
    return Array.isArray(payload) ? payload : payload.items ?? [];
  }

  private data<T>(payload: T): string { return JSON.stringify({ data: payload }); }

  private async collection<T>(domain: string, resource: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> {
    return this.list<T>(`/admin/${domain}/${resource}`, { page: 1, page_size: 100, ...params });
  }

  private async saveCollection<T>(domain: string, resource: string, item: JsonRecord): Promise<T> {
    const existing = Boolean(item.id) && !isClientDraftId(item.id);
    const path = existing ? `/admin/${domain}/${resource}/${encodeURIComponent(String(item.id))}` : `/admin/${domain}/${resource}`;
    return this.request<T>(path, { method: existing ? "PATCH" : "POST", body: this.data(item) });
  }

  private exhibition(item: JsonRecord): Exhibition {
    return { mainVenueId: null, hostUnit: "", organizerUnit: "", coOrganizerUnits: "", boundAvatarId: null, boundModel: "mock", boundVoiceId: null, boundVoiceProvider: null, boundVoiceModel: null, boundSttProvider: null, boundSttModel: null, boundScene: null, knowledgeBaseIds: [], lifecycleHistory: [], status: "preparing", description: "", ...item, id: String(item.id), name: String(item.name || item.code || item.id), code: String(item.code || item.id), startDate: String(item.startDate || ""), endDate: String(item.endDate || ""), createdAt: String(item.createdAt || item.created_at || ""), updatedAt: String(item.updatedAt || item.updated_at || "") } as Exhibition;
  }

  private welcomeConfig(item: JsonRecord, exhibitions: Exhibition[]): WelcomeConfig {
    return {
      id: String(item.id || ""),
      exhibitionId: String(item.exhibitionId || ""),
      exhibitionName: String(item.exhibitionName || exhibitions.find((exhibition) => exhibition.id === item.exhibitionId)?.name || ""),
      triggers: normalizeWelcomeTrigger(item.triggers ?? item.trigger),
      scriptId: String(item.scriptId || item.script_id || ""),
      highlights: stringArray(item.highlights),
      checkInGuide: String(item.checkInGuide || item.check_in_guide || ""),
      notices: String(item.notices || ""),
      routingStrategy: String(item.routingStrategy || item.routing_strategy || ""),
      status: item.status === "inactive" ? "inactive" : "active",
      updatedAt: String(item.updatedAt || item.updated_at || ""),
    };
  }

  private explainFlow(item: JsonRecord, exhibitions: Exhibition[]): ExplainFlow {
    return {
      id: String(item.id || ""),
      exhibitionId: String(item.exhibitionId || ""),
      exhibitionName: String(item.exhibitionName || exhibitions.find((exhibition) => exhibition.id === item.exhibitionId)?.name || ""),
      name: String(item.name || "未命名讲解流程"),
      keywords: stringArray(item.keywords),
      knowledgeCategories: stringArray(item.knowledgeCategories || item.knowledge_categories),
      interruptionPolicy: (item.interruptionPolicy || item.interruptPolicy || "allow") as ExplainFlow["interruptionPolicy"],
      scriptId: String(item.scriptId || item.script_id || ""),
      status: item.status === "inactive" ? "inactive" : "active",
      updatedAt: String(item.updatedAt || item.updated_at || ""),
    };
  }

  private shoppingStrategy(item: JsonRecord, exhibitions: Exhibition[], exhibitIds: string[] = []): ShoppingStrategy {
    const weights = item.weights && typeof item.weights === "object" ? item.weights as JsonRecord : {};
    return {
      id: String(item.id || ""),
      exhibitionId: String(item.exhibitionId || ""),
      exhibitionName: String(item.exhibitionName || exhibitions.find((exhibition) => exhibition.id === item.exhibitionId)?.name || ""),
      name: String(item.name || "未命名导购策略"),
      tags: stringArray(item.tags),
      tagWeight: Number(item.tagWeight ?? weights.tag ?? 0),
      compareDimensions: stringArray(item.compareDimensions || item.compare_dimensions),
      intentThreshold: Number(item.intentThreshold ?? item.intent_threshold ?? 0),
      exhibitCategories: stringArray(item.exhibitCategories || item.exhibit_categories),
      exhibitIds: exhibitIds.length ? exhibitIds : stringArray(item.exhibitIds || item.exhibit_ids),
      status: item.status === "inactive" ? "inactive" : "active",
      updatedAt: String(item.updatedAt || item.updated_at || ""),
    };
  }

  async login(username: string, password: string): Promise<{ token: string; user: AdminUser }> {
    const response = await this.request<JsonRecord>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    const token = String(response.token || response.access_token || "");
    window.localStorage.setItem(`${STORAGE_PREFIX}token`, token);
    const permissions = await this.request<JsonRecord>("/auth/permissions", {}, token);
    if (runtimeEnv.VITE_ASSET_BACKEND_URL) {
      try {
        const assetResponse = await this.request<JsonRecord>("/admin/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }, undefined, "assets");
        const assetToken = String(assetResponse.token || assetResponse.access_token || "");
        if (assetToken) window.localStorage.setItem(`${STORAGE_PREFIX}asset-token`, assetToken);
      } catch {
        // Asset authentication is isolated from the primary session until the
        // second backend confirms whether it accepts the same credentials.
        window.localStorage.removeItem(`${STORAGE_PREFIX}asset-token`);
      }
    }
    const roleCode = String(response.user?.roles?.[0] || "sys_admin") as AdminUser["role"];
    const role = (ROLE_PERMISSIONS[roleCode] ? roleCode : "readonly") as AdminUser["role"];
    return {
      token,
      user: {
        id: String(response.user?.id || ""),
        username: String(response.user?.username || username),
        displayName: String(response.user?.displayName || response.user?.display_name || username),
        role,
        permissions: (permissions.codes || ROLE_PERMISSIONS[role]) as AdminUser["permissions"],
        buttonPermissions: ROLE_BUTTON_PERMISSIONS[role],
      },
    };
  }

  async getDashboard(): Promise<DashboardData> {
    const report = await this.request<JsonRecord>("/admin/report");
    const summary = report.summary && typeof report.summary === "object" ? report.summary as JsonRecord : report;
    const metric = (id: string, label: string, value: unknown, trend: string, tone: DashboardData["metrics"][number]["tone"]) => ({ id, label, value: String(value ?? 0), trend, tone });
    return {
      metrics: [
        metric("interactions", "今日交互量", summary.interaction_count, "来自审计快照", "cyan"),
        metric("terminals", "在线终端", summary.online_terminals, "当前快照", "green"),
        metric("pending", "待审知识", summary.pending_knowledge, "需要处理", "amber"),
        metric("leads", "新增线索", summary.new_leads, "当前展会", "violet"),
        metric("alerts", "未确认告警", summary.alerts, "当前快照", summary.alerts ? "rose" : "green"),
      ],
      todos: Array.isArray(summary.todo) ? summary.todo as DashboardData["todos"] : [],
    };
  }

  private sceneBinding(item: JsonRecord): SceneBinding {
    const assets = Array.isArray(item.assets) ? item.assets : [];
    const nullableString = (value: unknown): string | null => value == null ? null : String(value);
    return {
      scene: String(item.scene || ""),
      assets: assets.map((asset) => {
        const value = asset as JsonRecord;
        return { assetId: String(value.assetId || value.asset_id || ""), isPrimary: Boolean(value.isPrimary ?? value.is_primary), order: Number(value.order || 0) };
      }),
      waitingGifId: nullableString(item.waitingGifId ?? item.waiting_gif_id),
      speakingGifId: nullableString(item.speakingGifId ?? item.speaking_gif_id),
      voiceConfigId: nullableString(item.voiceConfigId ?? item.voice_config_id),
      idleContentId: nullableString(item.idleContentId ?? item.idle_content_id),
      status: String(item.status || "active"),
    };
  }

  async getOperationsReport(filters: { exhibitionId?: string; from?: string; to?: string; groupBy?: "day" | "terminal" | "scene" | "intent" } = {}): Promise<OperationsReport> {
    const raw = await this.request<JsonRecord>(`/admin/report/operations${queryString({ exhibition_id: filters.exhibitionId, from: filters.from, to: filters.to, group_by: filters.groupBy })}`);
    return normalizeOperationsReport(raw);
  }

  async getReport(filters: ReportFilters = {}) {
    const raw = await this.request<JsonRecord>(`/admin/report/operations${queryString(filters as Record<string, string | undefined>)}`);
    return normalizeReportOperations(raw);
  }

  async exportReport(exhibitionId?: string, format: "xlsx" | "csv" = "xlsx", filters: { from?: string; to?: string; groupBy?: "day" | "terminal" | "scene" | "intent" } = {}): Promise<DownloadData> {
    const path = `/admin/report/export${queryString({ exhibition_id: exhibitionId, format, from: filters.from, to: filters.to, group_by: filters.groupBy })}`;
    return format === "csv" ? this.download(path) : this.downloadFile(path);
  }

  async listGifs() {
    const items = await this.collection<JsonRecord>("assets", "gifs");
    return items.map((item) => ({
      id: String(item.id || ""),
      name: String(item.name || "未命名动图"),
      kind: "gif" as const,
      previewUrl: String(item.previewUrl || item.url || ""),
      scene: String(item.scene || "idle"),
      tags: stringArray(item.tags),
      status: item.status === "inactive" ? "inactive" as const : "active" as const,
      width: Number(item.width || 0),
      height: Number(item.height || 0),
      frames: Number(item.frames || 0),
      durationMs: Number(item.durationMs || item.duration_ms || 0),
      fileName: String(item.fileName || item.filename || ""),
      sizeBytes: Number(item.sizeBytes || item.size_bytes || 0),
      createdAt: String(item.createdAt || item.created_at || ""),
    }));
  }
  async createGif(input: GifCreateInput) {
    if (input.file) {
      const { file, ...metadata } = input;
      return this.uploadGif(file, { name: metadata.name, scene: metadata.scene, tags: metadata.tags, status: metadata.status });
    }
    return this.saveCollection<GifAssetMeta>("assets", "gifs", input as JsonRecord);
  }
  async uploadGif(file: File, input: Pick<GifAssetMeta, "name" | "scene" | "tags" | "status">) {
    const form = new FormData();
    form.set("file", file, file.name);
    form.set("name", input.name);
    form.set("scene", input.scene);
    form.set("tags", input.tags.join(","));
    const saved = await this.request<JsonRecord>("/admin/assets/gifs", { method: "POST", body: form });
    return {
      id: String(saved.id || ""),
      name: String(saved.name || input.name),
      kind: "gif" as const,
      previewUrl: String(saved.previewUrl || saved.url || ""),
      scene: String(saved.scene || input.scene),
      tags: stringArray(saved.tags || input.tags),
      status: saved.status === "inactive" ? "inactive" as const : input.status,
      width: Number(saved.width || 0),
      height: Number(saved.height || 0),
      frames: Number(saved.frames || 0),
      durationMs: Number(saved.durationMs || 0),
      fileName: String(saved.fileName || saved.filename || file.name),
      sizeBytes: Number(saved.sizeBytes || file.size),
      createdAt: String(saved.createdAt || saved.created_at || now()),
    };
  }
  async updateGif(id: string, patch: Partial<GifAssetMeta>) { return this.saveCollection<GifAssetMeta>("assets", "gifs", { ...patch, id }); }
  async deleteGif(id: string) { await this.request(`/admin/assets/gifs/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  async listVoiceConfigs() { return this.collection<VoiceAsset>("assets", "voice-configs"); }
  async saveVoiceConfig(item: VoiceAsset) { return this.saveCollection<VoiceAsset>("assets", "voice-configs", item as JsonRecord); }
  async deleteVoiceConfig(id: string) { await this.request(`/admin/assets/voice-configs/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listSceneBindings() { const items = await this.collection<JsonRecord>("assets", "scene-bindings"); return items.map((item) => this.sceneBinding(item)); }
  async saveSceneBindings(bindings: SceneBinding[]) { await Promise.all(bindings.map((item) => this.saveSceneBinding(item))); return bindings; }
  async getSceneBinding(scene: string) {
    try {
      return this.sceneBinding(await this.request<JsonRecord>(`/admin/assets/scene-bindings/${encodeURIComponent(scene)}`));
    } catch (error) {
      if (!(error instanceof AdminApiError) || ![404, 405].includes(error.status)) throw error;
      const items = await this.collection<JsonRecord>("assets", "scene-bindings");
      const matching = items.find((item) => String(item.scene || "") === scene);
      return matching ? this.sceneBinding(matching) : { scene, assets: [] };
    }
  }
  async saveSceneBinding(binding: SceneBinding) {
    return this.sceneBinding(await this.request<JsonRecord>(`/admin/assets/scene-bindings/${encodeURIComponent(binding.scene)}`, {
      method: "PUT",
      body: JSON.stringify({
        scene: binding.scene,
        assets: binding.assets.map((item) => ({ asset_id: item.assetId, is_primary: item.isPrimary, order: item.order })),
        waiting_gif_id: binding.waitingGifId ?? null,
        speaking_gif_id: binding.speakingGifId ?? null,
        voice_config_id: binding.voiceConfigId ?? null,
        idle_content_id: binding.idleContentId ?? null,
        status: binding.status || "active",
      }),
    }));
  }
  async listIdle() { return this.collection<IdleContent>("assets", "idle-contents"); }
  async saveIdle(item: IdleContent) { return this.saveCollection<IdleContent>("assets", "idle-contents", item as JsonRecord); }
  async deleteIdle(id: string) { await this.request(`/admin/assets/idle-contents/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  async listDocuments() { return this.collection<KnowledgeDocument>("knowledge", "documents"); }
  async uploadDocument(input: Pick<KnowledgeDocument, "title" | "fileName" | "type" | "exhibition">) { return this.saveCollection<KnowledgeDocument>("knowledge", "documents", input as JsonRecord); }
  async updateDocument(id: string, patch: Partial<KnowledgeDocument>) { return this.saveCollection<KnowledgeDocument>("knowledge", "documents", { ...patch, id }); }
  async deleteDocument(id: string) { await this.request(`/admin/knowledge/documents/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listQa() { return this.collection<KnowledgeQa>("knowledge", "qa"); }
  async saveQa(item: KnowledgeQa) { return this.saveCollection<KnowledgeQa>("knowledge", "qa", item as JsonRecord); }
  async transitionQa(id: string, status: KnowledgeQa["status"]) { return this.request<KnowledgeQa>(`/admin/knowledge/qa/${encodeURIComponent(id)}/transition`, { method: "POST", body: JSON.stringify({ status }) }); }
  async listQaVersions(id: string) { const response = await this.request<{ items?: Array<Record<string, unknown>> }>(`/admin/knowledge/qa/${encodeURIComponent(id)}/versions`); return response.items ?? []; }
  async rollbackQa(id: string, version: number, reason: string) { return this.request<KnowledgeQa>(`/admin/knowledge/qa/${encodeURIComponent(id)}/rollback`, { method: "POST", body: JSON.stringify({ version, reason }) }); }
  async deleteQa(id: string) { await this.request(`/admin/knowledge/qa/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listScripts() { return this.collection<ScriptTemplate>("knowledge", "scripts"); }
  async saveScript(item: ScriptTemplate) { return this.saveCollection<ScriptTemplate>("knowledge", "scripts", item as JsonRecord); }
  async deleteScript(id: string) { await this.request(`/admin/knowledge/scripts/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listPackages() { return this.collection<PublishPackage>("knowledge", "packages"); }
  async createPackage(input: Pick<PublishPackage, "name" | "exhibition" | "qaCount" | "documentCount">) { return this.saveCollection<PublishPackage>("knowledge", "packages", input as JsonRecord); }
  async transitionPackage(id: string, status: PublishPackage["status"]) {
    if (status === "pending_review") return this.submitPackage(id);
    if (status === "published") return this.publishPackage(id);
    if (status === "rolled_back") return this.rollbackPackage(id);
    return this.saveCollection<PublishPackage>("knowledge", "packages", { id, status });
  }
  async submitPackage(id: string, reason?: string) { return this.request<PublishPackage>(`/admin/knowledge/packages/${encodeURIComponent(id)}/submit`, { method: "POST", body: JSON.stringify({ reason }) }); }
  async publishPackage(id: string, reason?: string) { return this.request<PublishPackage>(`/admin/knowledge/packages/${encodeURIComponent(id)}/publish`, { method: "POST", body: JSON.stringify({ reason }) }); }
  async rollbackPackage(id: string, targetPackageId?: string, reason?: string) { return this.request<PublishPackage>(`/admin/knowledge/packages/${encodeURIComponent(id)}/rollback`, { method: "POST", body: JSON.stringify({ target_package_id: targetPackageId, reason }) }); }
  async listMissPool() { return this.collection<MissPoolItem>("knowledge", "miss-pool"); }
  async resolveMiss(id: string, status: MissPoolItem["status"]) { return this.resolveMissAction(id, status === "ignored" ? "ignore" : status === "converted_qa" ? "create_qa" : "handled"); }
  async resolveMissAction(id: string, action: "ignore" | "handled" | "create_qa", reason?: string, qa?: Record<string, unknown>) { return this.request<MissPoolItem>(`/admin/knowledge/miss-pool/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify({ action, reason, qa }) }); }

  async listWelcomeConfigs(exhibitionId?: string) {
    const [items, exhibitions] = await Promise.all([this.collection<JsonRecord>("interaction", "welcome-configs", { exhibition_id: exhibitionId }), this.listExhibitions()]);
    return items.map((item) => this.welcomeConfig(item, exhibitions));
  }
  async saveWelcomeConfig(item: WelcomeConfig) { const exhibitions = await this.listExhibitions(); return this.welcomeConfig(await this.saveCollection<JsonRecord>("interaction", "welcome-configs", item as JsonRecord), exhibitions); }
  async listExplainFlows(exhibitionId?: string) {
    const [items, exhibitions] = await Promise.all([this.collection<JsonRecord>("interaction", "explain-flows", { exhibition_id: exhibitionId }), this.listExhibitions()]);
    return items.map((item) => this.explainFlow(item, exhibitions));
  }
  async saveExplainFlow(item: ExplainFlow) { const exhibitions = await this.listExhibitions(); return this.explainFlow(await this.saveCollection<JsonRecord>("interaction", "explain-flows", item as JsonRecord), exhibitions); }
  async deleteExplainFlow(id: string) { await this.request(`/admin/interaction/explain-flows/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listShoppingStrategies(exhibitionId?: string) {
    const [items, exhibitions] = await Promise.all([this.collection<JsonRecord>("interaction", "shopping-strategies", { exhibition_id: exhibitionId }), this.listExhibitions()]);
    return Promise.all(items.map(async (item) => {
      const links = await this.request<JsonRecord>(`/admin/interaction/shopping-strategies/${encodeURIComponent(String(item.id))}/exhibits?page=1&page_size=100`);
      return this.shoppingStrategy(item, exhibitions, links.selected_ids || []);
    }));
  }
  async saveShoppingStrategy(item: ShoppingStrategy) {
    const exhibitions = await this.listExhibitions();
    const saved = await this.saveCollection<JsonRecord>("interaction", "shopping-strategies", item as JsonRecord);
    const exhibitIds = item.exhibitIds || [];
    await this.request(`/admin/interaction/shopping-strategies/${encodeURIComponent(String(saved.id))}/exhibits`, { method: "PUT", body: JSON.stringify({ ids: exhibitIds }) });
    return this.shoppingStrategy(saved, exhibitions, exhibitIds);
  }
  async deleteShoppingStrategy(id: string) { await this.request(`/admin/interaction/shopping-strategies/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  async listExhibitions() { return (await this.collection<JsonRecord>("event", "exhibitions")).map((item) => this.exhibition(item)); }
  async saveExhibition(item: Exhibition) { return this.exhibition(await this.saveCollection<JsonRecord>("event", "exhibitions", item as JsonRecord)); }
  async saveExhibitionRuntimeConfig(item: Exhibition) { return this.exhibition(await this.request<JsonRecord>(`/admin/event/exhibitions/${encodeURIComponent(item.id)}/runtime-config`, { method: "PUT", body: JSON.stringify(item) })); }
  async deleteExhibition(id: string) { await this.request(`/admin/event/exhibitions/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async transitionExhibition(id: string, status: ExhibitionStatus) { return this.exhibition(await this.request<JsonRecord>(`/admin/event/exhibitions/${encodeURIComponent(id)}/lifecycle`, { method: "POST", body: JSON.stringify({ status }) })); }
  async listVenues() { return this.collection<EventVenue>("event", "venues"); }
  async saveVenue(item: EventVenue) { return this.saveCollection<EventVenue>("event", "venues", item as JsonRecord); }
  async deleteVenue(id: string) { await this.request(`/admin/event/venues/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listPoints() { return this.collection<EventPoint>("event", "points"); }
  async savePoint(item: EventPoint) { return this.saveCollection<EventPoint>("event", "points", item as JsonRecord); }
  async deletePoint(id: string) { await this.request(`/admin/event/points/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listExhibitors() { return this.collection<Exhibitor>("event", "exhibitors"); }
  async saveExhibitor(item: Exhibitor) { return this.saveCollection<Exhibitor>("event", "exhibitors", item as JsonRecord); }
  async deleteExhibitor(id: string) { await this.request(`/admin/event/exhibitors/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listExhibits() { return this.collection<Exhibit>("event", "exhibits"); }
  async saveExhibit(item: Exhibit) { return this.saveCollection<Exhibit>("event", "exhibits", item as JsonRecord); }
  async deleteExhibit(id: string) { await this.request(`/admin/event/exhibits/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listRoutes() { return this.collection<ExhibitionRoute>("event", "routes"); }
  async saveRoute(item: ExhibitionRoute) { return this.saveCollection<ExhibitionRoute>("event", "routes", item as JsonRecord); }
  async deleteRoute(id: string) { await this.request(`/admin/event/routes/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listBroadcasts() { return this.collection<EmergencyBroadcast>("event", "broadcasts"); }
  async saveBroadcast(item: EmergencyBroadcast) { return this.saveCollection<EmergencyBroadcast>("event", "broadcasts", item as JsonRecord); }
  async transitionBroadcast(id: string, status: EmergencyBroadcast["status"]) { return this.saveCollection<EmergencyBroadcast>("event", "broadcasts", { id, status }); }
  async deleteBroadcast(id: string) { await this.request(`/admin/event/broadcasts/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listSchedules() { return this.collection<EventSchedule>("event", "schedules"); }
  async saveSchedule(item: EventSchedule) { return this.saveCollection<EventSchedule>("event", "schedules", item as JsonRecord); }
  async deleteSchedule(id: string) { await this.request(`/admin/event/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  async listLeads(filters: { exhibitionId?: string; keyword?: string; status?: LeadStatus | ""; from?: string; to?: string } = {}) {
    return this.list<Lead>("/admin/lead", { page: 1, page_size: 100, exhibition_id: filters.exhibitionId && filters.exhibitionId !== "all" ? filters.exhibitionId : undefined, keyword: filters.keyword, status: filters.status, from: filters.from, to: filters.to });
  }
  async getLead(id: string) { try { return await this.request<Lead>(`/admin/lead/${encodeURIComponent(id)}`); } catch (error) { if (error instanceof Error && error.message.includes("404")) return null; throw error; } }
  async saveLead(item: Lead) {
    const existing = Boolean(item.id) && !isClientDraftId(item.id);
    return this.request<Lead>(existing ? `/admin/lead/${encodeURIComponent(item.id)}` : "/admin/lead", { method: existing ? "PATCH" : "POST", body: this.data(item) });
  }
  async updateLeadStatus(id: string, status: LeadStatus, note?: string) { return this.request<Lead>(`/admin/lead/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status, note }) }); }
  async exportLeads(filters: { exhibitionId?: string; keyword?: string; status?: string; from?: string; to?: string } = {}, format: "xlsx" | "csv" = "xlsx"): Promise<DownloadData> {
    const path = `/admin/lead/export${queryString({ exhibition_id: filters.exhibitionId && filters.exhibitionId !== "all" ? filters.exhibitionId : undefined, keyword: filters.keyword, status: filters.status, from: filters.from, to: filters.to, format })}`;
    return format === "csv" ? this.download(path) : this.downloadFile(path);
  }
  async listFeedback(filters: { exhibitionId?: string; keyword?: string; status?: Feedback["status"] } = {}) { return this.list<Feedback>("/admin/feedback", { page: 1, page_size: 100, exhibition_id: filters.exhibitionId, keyword: filters.keyword, status: filters.status }); }
  async resolveFeedback(id: string, note: string) { return this.request<Feedback>(`/admin/feedback/${encodeURIComponent(id)}/resolve`, { method: "POST", body: this.data({ note }) }); }

  private userRecord(raw: JsonRecord, roles: RoleRecord[]): AdminUserRecord {
    const roleCodes = Array.isArray(raw.roles) ? raw.roles : [];
    const roleIds = roleCodes.map((code: string) => roles.find((role) => role.code === code)?.id || code);
    return { id: String(raw.id), username: String(raw.username || ""), displayName: String(raw.displayName || raw.display_name || raw.username || ""), gender: raw.gender === "男" || raw.gender === "女" ? raw.gender : "未设置", phone: String(raw.phone || ""), email: String(raw.email || ""), department: String(raw.department || ""), status: raw.status === "inactive" ? "inactive" : "active", roleIds, createdAt: String(raw.createdAt || raw.created_at || ""), lastLoginAt: String(raw.lastLoginAt || raw.last_login_at || "-"), lastLoginIp: String(raw.lastLoginIp || raw.last_login_ip || "-") };
  }
  async listAdminUsers(filters: { keyword?: string; status?: AdminUserRecord["status"] } = {}) { const [items, roles] = await Promise.all([this.list<JsonRecord>("/admin/users", { page: 1, page_size: 100, keyword: filters.keyword, status: filters.status }), this.listRoles()]); return items.map((item) => this.userRecord(item, roles)); }
  async saveAdminUser(item: AdminUserRecord) {
    const roles = await this.listRoles();
    const roleCodes = item.roleIds.map((id) => roles.find((role) => role.id === id)?.code || id);
    const existing = (await this.listAdminUsers()).some((user) => user.id === item.id);
    const payload = { ...item, displayName: item.displayName, roleCodes, password: existing ? undefined : "Admin@123456" };
    const saved = await this.request<JsonRecord>(existing ? `/admin/users/${encodeURIComponent(item.id)}` : "/admin/users", { method: existing ? "PATCH" : "POST", body: this.data(payload) });
    return this.userRecord(saved, roles);
  }
  async deleteAdminUser(id: string) { await this.request(`/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async resetAdminPassword(id: string) { await this.request(`/admin/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: this.data({ password: "Admin@123456" }) }); }
  async exportAdminUsers(filters: { keyword?: string; status?: AdminUserRecord["status"] } = {}) { return this.download(`/admin/users/export${queryString(filters)}`); }
  async listRoles() {
    const items = await this.list<JsonRecord>("/admin/roles", { page: 1, page_size: 100 });
    return items.map((item) => ({ ...item, id: String(item.id), code: String(item.code || ""), name: String(item.name || ""), dataScope: item.dataScope || item.data_scope || "自定义", level: Number(item.level || 1), description: String(item.description || ""), permissionIds: Array.isArray(item.permissionIds) ? item.permissionIds : [], createdAt: String(item.createdAt || item.created_at || "") })) as RoleRecord[];
  }
  async saveRole(item: RoleRecord) {
    const existing = (await this.listRoles()).some((role) => role.id === item.id);
    const saved = await this.request<JsonRecord>(existing ? `/admin/roles/${encodeURIComponent(item.id)}` : "/admin/roles", { method: existing ? "PATCH" : "POST", body: this.data(item) });
    const roleId = String(saved.id || item.id);
    if (item.permissionIds) await this.request(`/admin/roles/${encodeURIComponent(roleId)}/permissions`, { method: "PUT", body: JSON.stringify({ ids: item.permissionIds }) });
    const roles = await this.listRoles();
    return roles.find((role) => role.id === roleId) || ({ ...item, id: roleId } as RoleRecord);
  }
  async deleteRole(id: string) { await this.request(`/admin/roles/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async listPermissionTree() {
    const payload = await this.request<{ items: JsonRecord[] }>("/admin/permission-tree");
    const flat = (payload.items || []).map((item) => ({ id: String(item.id), parentId: item.parentId ?? item.parent_id ?? null, name: String(item.name || ""), code: String(item.code || ""), type: (item.type ?? item.kind ?? "menu") as PermissionNode["type"], path: String(item.path || ""), apiPattern: String(item.apiPattern ?? item.api_pattern ?? ""), children: [] as PermissionNode[] }));
    const byParent = new Map<string | null, PermissionNode[]>();
    flat.forEach((item) => byParent.set(item.parentId, [...(byParent.get(item.parentId) || []), item]));
    const build = (parent: string | null): PermissionNode[] => (byParent.get(parent) || []).map((item) => ({ ...item, children: build(item.id) }));
    return build(null);
  }
  async savePermissionNode(item: PermissionNode): Promise<PermissionNode> { void item; throw new Error("权限节点由角色权限树统一维护，当前版本不支持独立修改。"); }
  async deletePermissionNode(_id: string) { throw new Error("权限节点由角色权限树统一维护，当前版本不支持独立删除。"); }
  async listAuditLogs(filters: { username?: string; ip?: string; keyword?: string; from?: string; to?: string } = {}) {
    const items = await this.list<JsonRecord>("/admin/audit-logs", { page: 1, page_size: 100, username: filters.username, ip: filters.ip, keyword: filters.keyword, from: filters.from, to: filters.to });
    return items.map((item) => ({ id: String(item.id), traceId: String(item.trace_id || item.traceId || ""), username: String(item.username || ""), ip: String(item.ip || ""), ipLocation: String(item.ipLocation || "-"), description: String(item.description || item.action || ""), browser: String(item.browser || item.user_agent || "-"), durationMs: Number(item.duration_ms || item.durationMs || 0), createdAt: String(item.created_at || item.createdAt || ""), resource: String(item.resource_type || item.resource || ""), action: String(item.action || ""), before: item.before_json ? JSON.parse(item.before_json) : item.before, after: item.after_json ? JSON.parse(item.after_json) : item.after, spans: Array.isArray(item.spans) ? item.spans : [] })) as AuditLog[];
  }
  async getTraceRecord(id: string) {
    const payload = await this.request<JsonRecord>(`/admin/audit/trace/${encodeURIComponent(id)}`);
    const rows = Array.isArray(payload.logs) ? payload.logs : [];
    const first = rows[0] || {};
    const item = (await this.listAuditLogs()).find((candidate) => candidate.traceId === id) || ({ id: String(first.id || id), traceId: id, username: String(first.username || ""), ip: String(first.ip || ""), ipLocation: "-", description: String(first.action || "Trace"), browser: String(first.user_agent || "-"), durationMs: Number(first.duration_ms || 0), createdAt: String(first.created_at || ""), resource: String(first.resource_type || ""), action: String(first.action || ""), spans: [] } as AuditLog);
    return { ...item, spans: (payload.spans || []).map((span: JsonRecord) => ({ id: String(span.id), parentId: span.parent_id || null, service: String(span.service || "api"), operation: String(span.operation || ""), startAt: String(span.start_at || span.startAt || item.createdAt), durationMs: Number(span.duration_ms || span.durationMs || 0), status: span.status === "error" ? "error" : "ok", attributes: span.attributes || {} })) } as AuditLog;
  }
  async exportAuditLogs(filters: { username?: string; ip?: string; keyword?: string; from?: string; to?: string } = {}) { return this.download(`/admin/audit-logs/export${queryString(filters)}`); }
  async clearAuditLogs() { await this.request("/admin/audit-logs", { method: "DELETE" }); }
  async getSystemMonitor() {
    const raw = await this.request<JsonRecord>("/admin/ops/system");
    const mapService = (item: JsonRecord) => ({ id: String(item.id), name: String(item.name || item.service || item.id), status: item.status || "unknown", latencyMs: Number(item.latencyMs ?? item.latency_ms ?? 0), checkedAt: String(item.checkedAt || item.checked_at || ""), description: String(item.description || "") });
    const mapTerminal = (item: JsonRecord) => ({ id: String(item.id), name: String(item.name || item.id), exhibitionId: String(item.exhibitionId || item.exhibition_id || ""), location: String(item.location || ""), status: item.status || "offline", lastHeartbeatAt: String(item.lastHeartbeatAt || item.last_heartbeat_at || ""), version: String(item.version || ""), cpuPercent: Number(item.cpuPercent ?? item.cpu ?? 0), memoryPercent: Number(item.memoryPercent ?? item.memory ?? 0) });
    return { ...raw, cpuPercent: Number(raw.cpuPercent ?? raw.cpu ?? 0), memoryPercent: Number(raw.memoryPercent ?? raw.memory ?? 0), swapPercent: Number(raw.swapPercent ?? raw.swap ?? 0), diskPercent: Number(raw.diskPercent ?? raw.disk ?? 0), cpuHistory: Array.isArray(raw.cpuHistory) ? raw.cpuHistory : [], memoryHistory: Array.isArray(raw.memoryHistory) ? raw.memoryHistory : [], services: (raw.services || []).map(mapService), terminals: (raw.terminals || []).map(mapTerminal), alerts: (raw.alerts || []).map((item: JsonRecord) => ({ ...item, target: item.target || item.object || "", occurredAt: item.occurredAt || item.createdAt || "" })) } as unknown as SystemMonitor;
  }
  async listAlerts() {
    const items = await this.list<JsonRecord>("/admin/alerts", { page: 1, page_size: 100 });
    return items.map((item) => ({ ...item, id: String(item.id), type: String(item.type || ""), severity: item.severity === "warning" ? "normal" : item.severity, target: String(item.target || item.object || ""), content: String(item.content || ""), status: item.status === "open" ? "active" : item.status, occurredAt: String(item.occurredAt || item.createdAt || item.created_at || "") })) as AlertEvent[];
  }
  async acknowledgeAlert(id: string, _operator?: string) { return this.request<AlertEvent>(`/admin/alerts/${encodeURIComponent(id)}/acknowledge`, { method: "POST" }); }
  async getGatewayPolicy() { return this.request<GatewayPolicy>("/admin/ops/gateway-policy"); }
  async saveGatewayPolicy(policy: GatewayPolicy) { return this.request<GatewayPolicy>("/admin/ops/gateway-policy", { method: "PUT", body: JSON.stringify(policy) }); }
}

export function createAdminApi(mode?: "real" | "mock"): AdminApiClient {
  const resolved = mode ?? "real";
  return resolved === "real" ? new FetchAdminApiClient() : new MockAdminApiClient();
}

export const adminApi: AdminApiClient = createAdminApi(runtimeEnv.VITE_ADMIN_API_MODE === "mock" ? "mock" : "real");

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
