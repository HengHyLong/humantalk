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
  Lead,
  LeadStatus,
  Feedback,
  AdminUserRecord,
  RoleRecord,
  PermissionNode,
  AuditLog,
  SystemMonitor,
  TerminalStatus,
  InteractionRecord,
  GatewayPolicy,
  AlertEvent,
  WelcomeConfig,
  ExplainFlow,
  ShoppingStrategy,
  ReportFilters,
  ReportOperations,
  AuthSession,
  AdminRole,
  PermissionCode,
  ButtonPermission,
} from "./types";

export type GifCreateInput = Omit<GifAssetMeta, "id" | "createdAt"> & { file?: File };

const STORAGE_PREFIX = "opentalking-admin-";
const AUTH_TOKEN_KEY = `${STORAGE_PREFIX}token`;
const AUTH_REFRESH_TOKEN_KEY = `${STORAGE_PREFIX}refresh-token`;
const now = () => new Date().toISOString();

function buildAdminFetchUrl(path: string): string {
  const base = typeof window === "undefined" ? "http://127.0.0.1:5173/" : window.location.href;
  return new URL(`/api${path}`, base).toString();
}

function withQuery(path: string, params?: Record<string, string | undefined>): string {
  const query = new URLSearchParams(Object.entries(params ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return query.size ? `${path}?${query.toString()}` : path;
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
  login(username: string, password: string): Promise<AuthSession>;
  getCurrentUser(): Promise<AdminUser>;
  refreshAuth(): Promise<AuthSession>;
  logout(): Promise<void>;
  getPermissions(): Promise<{ permissions: PermissionCode[]; buttonPermissions: ButtonPermission[] }>;
  getDashboard(): Promise<DashboardData>;
  getReport(filters?: ReportFilters): Promise<ReportOperations>;
  listGifs(): Promise<GifAssetMeta[]>;
  createGif(input: GifCreateInput): Promise<GifAssetMeta>;
  updateGif(id: string, patch: Partial<GifAssetMeta>): Promise<GifAssetMeta>;
  deleteGif(id: string): Promise<void>;
  listVoiceConfigs(): Promise<VoiceAsset[]>;
  saveVoiceConfig(item: VoiceAsset): Promise<VoiceAsset>;
  deleteVoiceConfig(id: string): Promise<void>;
  listSceneBindings(): Promise<SceneBinding[]>;
  saveSceneBindings(bindings: SceneBinding[]): Promise<SceneBinding[]>;
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
  listMissPool(): Promise<MissPoolItem[]>;
  resolveMiss(id: string, status: MissPoolItem["status"]): Promise<MissPoolItem>;
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
  uploadExhibitImage(id: string, file: File): Promise<{ url: string }>;
  listRoutes(): Promise<ExhibitionRoute[]>;
  saveRoute(item: ExhibitionRoute): Promise<ExhibitionRoute>;
  deleteRoute(id: string): Promise<void>;
  uploadRouteImage(id: string, file: File): Promise<{ url: string }>;
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
  exportLeads(filters?: { exhibitionId?: string; keyword?: string; status?: string; from?: string; to?: string }): Promise<string>;
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
  listTerminals(filters?: { exhibitionId?: string; status?: TerminalStatus["status"] }): Promise<TerminalStatus[]>;
  listInteractionRecords(filters?: { exhibitionId?: string; terminalId?: string; from?: string; to?: string }): Promise<InteractionRecord[]>;
  exportInteractionRecords(filters?: { exhibitionId?: string; terminalId?: string; from?: string; to?: string }): Promise<string>;
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
    const session = { token: `mock-jwt-${Date.now()}`, user: buildUser(username, "sys_admin"), expiresAt: Date.now() + 60 * 60 * 1000 };
    writeStore("token", session.token);
    return session;
  }

  async getCurrentUser() { return buildUser("admin", "sys_admin"); }
  async refreshAuth() { return this.login("admin", "Admin@123456"); }
  async logout() { try { window.localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* best effort */ } }
  async getPermissions() { const user = await this.getCurrentUser(); return { permissions: user.permissions, buttonPermissions: user.buttonPermissions }; }

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

  async getReport(): Promise<ReportOperations> {
    return {
      generatedAt: now(),
      filters: {},
      interaction: { total: 0, averageDurationMs: 0, byScene: [], byTerminal: [], byHour: [] },
      hotspot: { items: [] },
      hit: { total: 0, hit: 0, miss: 0, hitRate: 0, strongQaHit: 0, ragHit: 0 },
      lead: { total: 0, converted: 0, conversionRate: 0, byStatus: [] },
      resource: { items: [] },
    };
  }

  async listGifs() { return readStore("gifs", DEFAULT_GIFS); }
  async createGif(input: GifCreateInput) { const { file: _file, ...metadata } = input; const item = { ...metadata, id: `gif-${Date.now()}`, createdAt: now() }; writeStore("gifs", [item, ...await this.listGifs()]); return item; }
  async updateGif(id: string, patch: Partial<GifAssetMeta>) { const items = await this.listGifs(); const next = items.map((item) => item.id === id ? { ...item, ...patch } : item); writeStore("gifs", next); return next.find((item) => item.id === id) ?? items[0]; }
  async deleteGif(id: string) { writeStore("gifs", (await this.listGifs()).filter((item) => item.id !== id)); }
  async listVoiceConfigs() { return readStore<VoiceAsset[]>("voice-configs", []); }
  async saveVoiceConfig(item: VoiceAsset) { const saved = { ...item, id: item.id || `voice-config-${Date.now()}` }; writeStore("voice-configs", [saved, ...(await this.listVoiceConfigs()).filter((candidate) => candidate.id !== saved.id)]); return saved; }
  async deleteVoiceConfig(id: string) { writeStore("voice-configs", (await this.listVoiceConfigs()).filter((item) => item.id !== id)); }
  async listSceneBindings() { return readStore<SceneBinding[]>("scene-bindings", [{ scene: "welcome", assets: [{ assetId: "gif-welcome", isPrimary: true, order: 0 }] }, { scene: "explain", assets: [{ assetId: "gif-explain", isPrimary: true, order: 0 }] }, { scene: "idle", assets: [{ assetId: "gif-idle", isPrimary: true, order: 0 }] }]); }
  async saveSceneBindings(bindings: SceneBinding[]) { writeStore("scene-bindings", bindings); return bindings; }
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
  async deleteQa(id: string) { await this.transitionQa(id, "archived"); }
  async listScripts() { migrateInteractionMockData(); return readStore("scripts", DEFAULT_SCRIPTS); }
  async saveScript(item: ScriptTemplate) { const next = [item, ...(await this.listScripts()).filter((candidate) => candidate.id !== item.id)]; writeStore("scripts", next); return item; }
  async deleteScript(id: string) { writeStore("scripts", (await this.listScripts()).filter((item) => item.id !== id)); }
  async listWelcomeConfigs(exhibitionId?: string) { migrateInteractionMockData(); return (await readStore<WelcomeConfig[]>("welcome-configs", DEFAULT_WELCOME_CONFIGS)).filter((item) => !exhibitionId || exhibitionId === "all" || item.exhibitionId === exhibitionId); }
  async saveWelcomeConfig(item: WelcomeConfig) { const exhibition = (await this.listExhibitions()).find((candidate) => candidate.id === item.exhibitionId); if (!exhibition) throw new Error("欢迎配置所属展会不存在"); const scripts = await this.listScripts(); if (!scripts.some((script) => script.id === item.scriptId && script.scene === "welcome")) throw new Error("欢迎配置必须关联迎宾话术"); const saved = { ...item, exhibitionName: exhibition.name, updatedAt: now() }; writeStore("welcome-configs", [saved, ...(await this.listWelcomeConfigs()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async listExplainFlows(exhibitionId?: string) { migrateInteractionMockData(); return (await readStore<ExplainFlow[]>("explain-flows", DEFAULT_EXPLAIN_FLOWS)).filter((item) => !exhibitionId || exhibitionId === "all" || item.exhibitionId === exhibitionId); }
  async saveExplainFlow(item: ExplainFlow) { const exhibition = (await this.listExhibitions()).find((candidate) => candidate.id === item.exhibitionId); if (!exhibition) throw new Error("讲解流程所属展会不存在"); const scripts = await this.listScripts(); if (!scripts.some((script) => script.id === item.scriptId && script.scene === "explain")) throw new Error("讲解流程必须关联讲解话术"); const saved = { ...item, exhibitionName: exhibition.name, updatedAt: now() }; writeStore("explain-flows", [saved, ...(await this.listExplainFlows()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteExplainFlow(id: string) { writeStore("explain-flows", (await this.listExplainFlows()).filter((item) => item.id !== id)); }
  async listShoppingStrategies(exhibitionId?: string): Promise<ShoppingStrategy[]> { migrateInteractionMockData(); return (await readStore<ShoppingStrategy[]>("shopping-strategies", DEFAULT_SHOPPING_STRATEGIES)).map((item) => ({ ...item, exhibitIds: item.exhibitIds ?? [] })).filter((item) => !exhibitionId || exhibitionId === "all" || item.exhibitionId === exhibitionId); }
  async saveShoppingStrategy(item: ShoppingStrategy): Promise<ShoppingStrategy> { const exhibition = (await this.listExhibitions()).find((candidate) => candidate.id === item.exhibitionId); if (!exhibition) throw new Error("导购策略所属展会不存在"); const exhibits = await this.listExhibits(); const exhibitIds = (item.exhibitIds || []).filter((id) => exhibits.some((exhibit) => exhibit.id === id && exhibit.exhibitionId === item.exhibitionId)); if (exhibitIds.length !== (item.exhibitIds || []).length) throw new Error("导购策略关联的展品必须属于所选展会"); const saved = { ...item, exhibitionName: exhibition.name, exhibitIds, updatedAt: now() }; writeStore("shopping-strategies", [saved, ...(await this.listShoppingStrategies()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteShoppingStrategy(id: string) { writeStore("shopping-strategies", (await this.listShoppingStrategies()).filter((item) => item.id !== id)); }
  async listPackages() { return readStore("packages", DEFAULT_PACKAGES); }
  async createPackage(input: Pick<PublishPackage, "name" | "exhibition" | "qaCount" | "documentCount">) { const item: PublishPackage = { ...input, id: `pkg-${Date.now()}`, status: "draft", version: 1, creator: "当前用户", updatedAt: now() }; writeStore("packages", [item, ...await this.listPackages()]); return item; }
  async transitionPackage(id: string, status: PublishPackage["status"]) { const list = await this.listPackages(); const next = list.map((item) => item.id === id ? { ...item, status, reviewer: status === "published" ? "当前用户" : item.reviewer, updatedAt: now() } : item); writeStore("packages", next); return next.find((item) => item.id === id) ?? list[0]; }
  async listMissPool() { return readStore("miss-pool", DEFAULT_MISS); }
  async resolveMiss(id: string, status: MissPoolItem["status"]) { const list = await this.listMissPool(); const next = list.map((item) => item.id === id ? { ...item, status } : item); writeStore("miss-pool", next); return next.find((item) => item.id === id) ?? list[0]; }
  async listExhibitions(): Promise<Exhibition[]> {
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
  async transitionExhibition(id: string, status: Exhibition["status"]): Promise<Exhibition> {
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
  async uploadExhibitImage(_id: string, file: File) { return { url: URL.createObjectURL(file) }; }
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
  async uploadRouteImage(_id: string, file: File) { return { url: URL.createObjectURL(file) }; }
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
  async resolveFeedback(id: string, note: string, operator = "当前用户"): Promise<Feedback> { const list = await this.listFeedback(); const existing = list.find((item) => item.id === id); if (!existing) throw new Error("反馈不存在"); const saved: Feedback = { ...existing, status: "handled", note, handledBy: operator, handledAt: now() }; writeStore("feedback", [saved, ...list.filter((item) => item.id !== id)]); return saved; }
  async listAdminUsers(filters: { keyword?: string; status?: AdminUserRecord["status"] } = {}) { const keyword = filters.keyword?.trim().toLowerCase(); return (await readStore<AdminUserRecord[]>("admin-users", DEFAULT_ADMIN_USERS)).filter((item) => (!filters.status || item.status === filters.status) && (!keyword || [item.username, item.displayName, item.email].some((value) => value.toLowerCase().includes(keyword)))); }
  async saveAdminUser(item: AdminUserRecord) { const saved = { ...item, updatedAt: now() } as AdminUserRecord; writeStore("admin-users", [saved, ...(await this.listAdminUsers()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteAdminUser(id: string) { writeStore("admin-users", (await this.listAdminUsers()).filter((item) => item.id !== id)); }
  async resetAdminPassword(_id: string): Promise<void> { return undefined; }
  async exportAdminUsers(filters: { keyword?: string; status?: AdminUserRecord["status"] } = {}) { const rows = await this.listAdminUsers(filters); return [["用户名", "昵称", "邮箱", "部门", "状态", "创建日期"], ...rows.map((item) => [item.username, item.displayName, item.email, item.department, item.status, item.createdAt])].map((row) => row.join(",")).join("\n"); }
  async listRoles() { const stored = readStore<RoleRecord[]>("roles", DEFAULT_ROLES); if (stored.some((role) => role.permissionIds.some((permission) => permission.startsWith("permission-")))) { writeStore("roles", DEFAULT_ROLES); return DEFAULT_ROLES; } return stored; }
  async saveRole(item: RoleRecord) { const saved = { ...item, updatedAt: now() } as RoleRecord; writeStore("roles", [saved, ...(await this.listRoles()).filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deleteRole(id: string) { writeStore("roles", (await this.listRoles()).filter((item) => item.id !== id)); }
  async listPermissionTree() { const stored = readStore<PermissionNode[]>("permissions", DEFAULT_PERMISSION_TREE); const base = stored.some((item) => item.type !== "menu" || item.code === "system:permission" || item.id.startsWith("permission-")) ? DEFAULT_PERMISSION_TREE : stored; const flat = normalizeMenuPermissionNodes(base); if (flat !== stored) writeStore("permissions", flat); const children = (parentId: string | null): PermissionNode[] => flat.filter((item) => item.parentId === parentId).map((item) => ({ ...item, children: children(item.id) })); return children(null); }
  async savePermissionNode(item: PermissionNode) { const flat = flattenPermissionNodes(await this.listPermissionTree()); const saved = { ...item, updatedAt: now() } as PermissionNode; writeStore("permissions", [saved, ...flat.filter((candidate) => candidate.id !== item.id)]); return saved; }
  async deletePermissionNode(id: string) { const flat = flattenPermissionNodes(await this.listPermissionTree()); const ids = new Set([id]); let changed = true; while (changed) { changed = false; flat.forEach((item) => { if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; } }); } writeStore("permissions", flat.filter((item) => !ids.has(item.id))); }
  async listAuditLogs(filters: { username?: string; ip?: string; keyword?: string; from?: string; to?: string } = {}) { const keyword = filters.keyword?.trim().toLowerCase(); return (await readStore<AuditLog[]>("audit-logs", DEFAULT_AUDIT_LOGS)).filter((item) => (!filters.username || item.username.includes(filters.username)) && (!filters.ip || item.ip.includes(filters.ip)) && (!keyword || `${item.description} ${item.traceId}`.toLowerCase().includes(keyword)) && (!filters.from || item.createdAt.slice(0, 10) >= filters.from) && (!filters.to || item.createdAt.slice(0, 10) <= filters.to)); }
  async getTraceRecord(id: string) { const list = await this.listAuditLogs(); return list.find((item) => item.id === id || item.traceId === id) ?? null; }
  async exportAuditLogs(filters: { username?: string; ip?: string; keyword?: string; from?: string; to?: string } = {}) {
    // The existing user-management page historically called this method with only `keyword`.
    // Preserve that UI contract while routing it to the correct user export dataset.
    if (Object.keys(filters).every((key) => key === "keyword")) return this.exportAdminUsers({ keyword: filters.keyword });
    const rows = await this.listAuditLogs(filters);
    return [["Trace ID", "用户名", "IP", "描述", "请求耗时", "创建日期"], ...rows.map((item) => [item.traceId, item.username, item.ip, item.description, `${item.durationMs}ms`, item.createdAt])].map((row) => row.join(",")).join("\n");
  }
  async clearAuditLogs() { writeStore("audit-logs", []); }
  async getSystemMonitor() { const monitor = readStore<SystemMonitor>("system-monitor", DEFAULT_MONITOR); const refreshed = { ...monitor, refreshedAt: now() }; writeStore("system-monitor", refreshed); return refreshed; }
  async listAlerts() { return readStore<AlertEvent[]>("alerts", DEFAULT_ALERTS); }
  async acknowledgeAlert(id: string, operator = "当前用户"): Promise<AlertEvent> { const list = await this.listAlerts(); const existing = list.find((item) => item.id === id); if (!existing) throw new Error("告警不存在"); const saved = { ...existing, status: "acknowledged" as const, acknowledgedBy: operator, acknowledgedAt: now() }; writeStore("alerts", [saved, ...list.filter((item) => item.id !== id)]); return saved; }
  async listTerminals(filters: { exhibitionId?: string; status?: TerminalStatus["status"] } = {}) { const items = (await this.getSystemMonitor()).terminals; return items.filter((item) => (!filters.exhibitionId || item.exhibitionId === filters.exhibitionId) && (!filters.status || item.status === filters.status)); }
  async listInteractionRecords(_filters: { exhibitionId?: string; terminalId?: string; from?: string; to?: string } = {}) { return readStore<InteractionRecord[]>("interaction-records", []); }
  async exportInteractionRecords(filters: { exhibitionId?: string; terminalId?: string; from?: string; to?: string } = {}) { const rows = await this.listInteractionRecords(filters); return [["记录ID", "展会", "终端", "会话", "意图", "知识命中", "耗时", "时间", "Trace ID"], ...rows.map((item) => [item.id, item.exhibitionId, item.terminalId, item.sessionId, item.intent, item.knowledgeHit ? "是" : "否", item.latencyMs, item.occurredAt, item.traceId])].map((row) => row.join(",")).join("\n"); }
  async getGatewayPolicy() { return readStore<GatewayPolicy>("gateway-policy", { id: "default", name: "默认网关策略", whitelist: [], rateLimitPerMinute: 60, timeoutMs: 15000, fallbackMode: "text", enabled: true, updatedAt: now() }); }
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

export class AdminApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public traceId?: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

export class FetchAdminApiClient extends MockAdminApiClient {
  private normalizeUser(payload: Partial<AdminUser> & { roles?: string[]; display_name?: string }): AdminUser {
    const role = (payload.role || payload.roles?.[0] || "readonly") as AdminRole;
    return {
      id: String(payload.id || `user-${payload.username || "admin"}`),
      username: String(payload.username || "admin"),
      displayName: String(payload.displayName || payload.display_name || payload.username || "管理员"),
      role,
      permissions: (payload.permissions as PermissionCode[] | undefined) ?? ROLE_PERMISSIONS[role] ?? [],
      buttonPermissions: (payload.buttonPermissions as ButtonPermission[] | undefined) ?? ROLE_BUTTON_PERMISSIONS[role] ?? [],
    };
  }

  private expiresAt(payload: { expiresAt?: number; expires_at?: string | number; expires_in?: number }): number {
    if (payload.expiresAt) return payload.expiresAt;
    if (typeof payload.expires_at === "string") return Date.parse(payload.expires_at);
    if (typeof payload.expires_at === "number") return payload.expires_at < 1_000_000_000_000 ? payload.expires_at * 1000 : payload.expires_at;
    return Date.now() + (payload.expires_in ?? 3600) * 1000;
  }

  private async request<T>(path: string, init?: RequestInit, retryAuth = true): Promise<T> {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    const isMultipart = typeof FormData !== "undefined" && init?.body instanceof FormData;
    const response = await fetch(buildAdminFetchUrl(`/v1${path}`), { ...init, headers: { ...(!isMultipart ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } });
    if (response.status === 401 && retryAuth && path !== "/auth/login" && path !== "/auth/refresh") {
      try {
        await this.refreshAuth();
        return this.request<T>(path, init, false);
      } catch {
        window.localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    }
    if (!response.ok) {
      const traceId = response.headers.get("X-Trace-ID") ?? undefined;
      let detail: { code?: string; detail?: string; message?: string; trace_id?: string } = {};
      try { detail = await response.json() as typeof detail; } catch { /* non-JSON error */ }
      throw new AdminApiError(detail.detail || detail.message || `请求失败（HTTP ${response.status}）`, response.status, detail.code, detail.trace_id || traceId);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  override async login(username: string, password: string) {
    const payload = await this.request<AuthSession & { access_token?: string; refresh_token?: string; expires_at?: string | number; expires_in?: number }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }, false);
    const token = payload.token || payload.access_token || "";
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    if (payload.refresh_token) window.localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, payload.refresh_token);
    const session: AuthSession = { token, user: this.normalizeUser(payload.user), expiresAt: this.expiresAt(payload) };
    return session;
  }

  override async getCurrentUser() {
    const payload = await this.request<Partial<AdminUser> & { roles?: string[]; display_name?: string }>("/auth/me");
    return this.normalizeUser(payload);
  }
  override async refreshAuth() {
    const refreshToken = window.localStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
    const payload = await this.request<Omit<AuthSession, "user"> & { access_token?: string; refresh_token?: string; expires_at?: string | number; expires_in?: number; user?: AdminUser }>("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }, false);
    const token = payload.token || payload.access_token || "";
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    if (payload.refresh_token) window.localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, payload.refresh_token);
    const user = payload.user ? this.normalizeUser(payload.user) : await this.getCurrentUser();
    const session: AuthSession = { token, user, expiresAt: this.expiresAt(payload) };
    return session;
  }
  override async logout() {
    try { await this.request<void>("/auth/logout", { method: "POST" }, false); }
    finally { window.localStorage.removeItem(AUTH_TOKEN_KEY); window.localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY); }
  }
  override async getPermissions() {
    const payload = await this.request<{ permissions?: PermissionCode[]; buttonPermissions?: ButtonPermission[]; codes?: PermissionCode[]; roles?: string[] }>("/auth/permissions");
    const role = (payload.roles?.[0] || "readonly") as AdminRole;
    return {
      permissions: payload.permissions ?? payload.codes ?? ROLE_PERMISSIONS[role] ?? [],
      buttonPermissions: payload.buttonPermissions ?? ROLE_BUTTON_PERMISSIONS[role] ?? [],
    };
  }

  override async getDashboard() { return this.request<DashboardData>("/admin/report"); }
  override async getReport(filters: ReportFilters = {}) {
    const query = new URLSearchParams();
    if (filters.exhibitionId) query.set("exhibition_id", filters.exhibitionId);
    if (filters.scene) query.set("scene", filters.scene);
    if (filters.terminalId) query.set("terminal_id", filters.terminalId);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.request<ReportOperations>(`/admin/report/operations${suffix}`);
  }

  private async requestList<T>(path: string): Promise<T[]> {
    const payload = await this.request<T[] | { items: T[] }>(path);
    return Array.isArray(payload) ? payload : payload.items;
  }

  private requestEventList<T>(resource: "exhibitions" | "exhibitors" | "exhibits" | "venues" | "points" | "routes" | "schedules" | "broadcasts"): Promise<T[]> {
    return this.requestList<T>(withQuery(`/admin/event/${resource}`, { page: "1", page_size: "9" }));
  }

  private async requestText(path: string, retryAuth = true): Promise<string> {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    const response = await fetch(buildAdminFetchUrl(`/v1${path}`), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (response.status === 401 && retryAuth) {
      await this.refreshAuth();
      return this.requestText(path, false);
    }
    if (!response.ok) throw new AdminApiError(`请求失败（HTTP ${response.status}）`, response.status, undefined, response.headers.get("X-Trace-ID") ?? undefined);
    return response.text();
  }

  private saveResource<T extends { id: string }>(item: T, collectionPath: string, createPath = collectionPath): Promise<T> {
    const isNew = !item.id || item.id.startsWith("new-") || /^(user|role|permission|welcome|explain|shopping)-\d{10,}$/.test(item.id);
    const { id: _clientId, ...createBody } = item;
    const body = isNew ? createBody : item;
    return this.request<T>(isNew ? createPath : `${collectionPath}/${encodeURIComponent(item.id)}`, {
      method: isNew ? "POST" : "PATCH",
      body: JSON.stringify(body),
    });
  }

  override async listExhibitions() { return this.requestEventList<Exhibition>("exhibitions"); }
  override async saveExhibition(item: Exhibition) { return this.saveResource(item, "/admin/event/exhibitions"); }
  override async saveExhibitionRuntimeConfig(item: Exhibition) {
    return this.request<Exhibition>(`/admin/event/exhibitions/${encodeURIComponent(item.id)}/runtime-config`, {
      method: "PUT",
      body: JSON.stringify({
        boundAvatarId: item.boundAvatarId,
        boundModel: item.boundModel,
        boundVoiceId: item.boundVoiceId,
        boundVoiceProvider: item.boundVoiceProvider,
        boundVoiceModel: item.boundVoiceModel,
        boundSttProvider: item.boundSttProvider,
        boundSttModel: item.boundSttModel,
        boundScene: item.boundScene,
        knowledgeBaseIds: item.knowledgeBaseIds,
      }),
    });
  }
  override async deleteExhibition(id: string) { await this.request(`/admin/event/exhibitions/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  override async transitionExhibition(id: string, status: ExhibitionStatus) { return this.request<Exhibition>(`/admin/event/exhibitions/${encodeURIComponent(id)}/lifecycle`, { method: "POST", body: JSON.stringify({ status }) }); }

  override async listVenues() { return this.requestEventList<EventVenue>("venues"); }
  override async saveVenue(item: EventVenue) { return this.saveResource(item, "/admin/event/venues", `/admin/event/exhibitions/${encodeURIComponent(item.exhibitionId)}/venues`); }
  override async deleteVenue(id: string) { await this.request(`/admin/event/venues/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  override async listPoints() { return this.requestEventList<EventPoint>("points"); }
  override async savePoint(item: EventPoint) { return this.saveResource(item, "/admin/event/points", `/admin/event/venues/${encodeURIComponent(item.venueId)}/points`); }
  override async deletePoint(id: string) { await this.request(`/admin/event/points/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  override async listRoutes() { return this.requestEventList<ExhibitionRoute>("routes"); }
  override async saveRoute(item: ExhibitionRoute) { return this.saveResource(item, "/admin/event/routes", `/admin/event/venues/${encodeURIComponent(item.venueId)}/routes`); }
  override async deleteRoute(id: string) { await this.request(`/admin/event/routes/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  override async uploadRouteImage(id: string, file: File) { const body = new FormData(); body.append("file", file); return this.request<{ url: string }>(`/admin/event/routes/${encodeURIComponent(id)}/image`, { method: "POST", body }); }

  override async listExhibitors() { return this.requestEventList<Exhibitor>("exhibitors"); }
  override async saveExhibitor(item: Exhibitor) { return this.saveResource(item, "/admin/event/exhibitors", `/admin/event/exhibitions/${encodeURIComponent(item.exhibitionId)}/exhibitors`); }
  override async deleteExhibitor(id: string) { await this.request(`/admin/event/exhibitors/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  override async listExhibits() { return this.requestEventList<Exhibit>("exhibits"); }
  override async saveExhibit(item: Exhibit) { return this.saveResource(item, "/admin/event/exhibits", `/admin/event/exhibitions/${encodeURIComponent(item.exhibitionId)}/exhibits`); }
  override async deleteExhibit(id: string) { await this.request(`/admin/event/exhibits/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  override async uploadExhibitImage(id: string, file: File) { const body = new FormData(); body.append("file", file); return this.request<{ url: string }>(`/admin/event/exhibits/${encodeURIComponent(id)}/images`, { method: "POST", body }); }

  override async listSchedules() { return this.requestEventList<EventSchedule>("schedules"); }
  override async saveSchedule(item: EventSchedule) { return this.saveResource(item, "/admin/event/schedules", `/admin/event/exhibitions/${encodeURIComponent(item.exhibitionId)}/schedules`); }
  override async deleteSchedule(id: string) { await this.request(`/admin/event/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  override async listBroadcasts() { return this.requestEventList<EmergencyBroadcast>("broadcasts"); }
  override async saveBroadcast(item: EmergencyBroadcast) { return this.saveResource(item, "/admin/event/broadcasts"); }
  override async transitionBroadcast(id: string, status: EmergencyBroadcast["status"]) {
    const action = status === "active" ? "activate" : status === "ended" ? "end" : "transition";
    return this.request<EmergencyBroadcast>(`/admin/event/broadcasts/${encodeURIComponent(id)}/${action}`, { method: "POST", body: action === "transition" ? JSON.stringify({ status }) : undefined });
  }
  override async deleteBroadcast(id: string) { await this.request(`/admin/event/broadcasts/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  override async listAdminUsers(filters?: { keyword?: string; status?: AdminUserRecord["status"] }) {
    return this.requestList<AdminUserRecord>(withQuery("/admin/rbac/user", filters));
  }
  override async saveAdminUser(item: AdminUserRecord) { return this.saveResource(item, "/admin/rbac/user"); }
  override async deleteAdminUser(id: string) { await this.request(`/admin/rbac/user/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  override async resetAdminPassword(id: string) { await this.request(`/admin/rbac/user/${encodeURIComponent(id)}/reset-password`, { method: "POST" }); }
  override async exportAdminUsers(filters?: { keyword?: string; status?: AdminUserRecord["status"] }) {
    return this.requestText(withQuery("/admin/rbac/user/export", filters));
  }

  override async listRoles() { return this.requestList<RoleRecord>("/admin/rbac/role"); }
  override async saveRole(item: RoleRecord) { return this.saveResource(item, "/admin/rbac/role"); }
  override async deleteRole(id: string) { await this.request(`/admin/rbac/role/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  override async listPermissionTree() { return this.requestList<PermissionNode>("/admin/rbac/permission"); }
  override async savePermissionNode(item: PermissionNode) { return this.saveResource(item, "/admin/rbac/permission"); }
  override async deletePermissionNode(id: string) { await this.request(`/admin/rbac/permission/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  override async listAuditLogs(filters?: { username?: string; ip?: string; keyword?: string; from?: string; to?: string }) {
    return this.requestList<AuditLog>(withQuery("/admin/audit-logs", filters));
  }
  override async getTraceRecord(id: string) { return this.request<AuditLog | null>(`/admin/audit/trace/${encodeURIComponent(id)}`); }
  override async exportAuditLogs(filters?: { username?: string; ip?: string; keyword?: string; from?: string; to?: string }) {
    if (filters && Object.keys(filters).every((key) => key === "keyword")) return this.exportAdminUsers({ keyword: filters.keyword });
    return this.requestText(withQuery("/admin/audit-logs/export", filters));
  }
  override async clearAuditLogs() { await this.request("/admin/audit-logs", { method: "DELETE" }); }

  override async getSystemMonitor() { return this.request<SystemMonitor>("/admin/ops/monitor"); }
  override async listAlerts() { return this.requestList<AlertEvent>("/admin/alerts"); }
  override async acknowledgeAlert(id: string, operator = "当前用户") {
    return this.request<AlertEvent>(`/admin/alerts/${encodeURIComponent(id)}/acknowledge`, { method: "POST", body: JSON.stringify({ operator }) });
  }
  override async listTerminals(filters?: { exhibitionId?: string; status?: TerminalStatus["status"] }) {
    return this.requestList<TerminalStatus>(withQuery("/admin/terminals", { exhibition_id: filters?.exhibitionId, status: filters?.status }));
  }
  override async listInteractionRecords(filters?: { exhibitionId?: string; terminalId?: string; from?: string; to?: string }) {
    return this.requestList<InteractionRecord>(withQuery("/admin/data/interactions", { exhibition_id: filters?.exhibitionId, terminal_id: filters?.terminalId, from: filters?.from, to: filters?.to }));
  }
  override async exportInteractionRecords(filters?: { exhibitionId?: string; terminalId?: string; from?: string; to?: string }) {
    return this.requestText(withQuery("/admin/data/interactions/export", { exhibition_id: filters?.exhibitionId, terminal_id: filters?.terminalId, from: filters?.from, to: filters?.to }));
  }
  override async getGatewayPolicy() { return this.request<GatewayPolicy>("/admin/ops/gateway-policy"); }
  override async saveGatewayPolicy(policy: GatewayPolicy) { return this.request<GatewayPolicy>("/admin/ops/gateway-policy", { method: "PUT", body: JSON.stringify(policy) }); }

  override async listLeads(filters?: { exhibitionId?: string; keyword?: string; status?: LeadStatus | ""; from?: string; to?: string }) {
    return this.requestList<Lead>(withQuery("/admin/leads", { exhibition_id: filters?.exhibitionId, keyword: filters?.keyword, status: filters?.status, from: filters?.from, to: filters?.to }));
  }
  override async getLead(id: string) { return this.request<Lead | null>(`/admin/leads/${encodeURIComponent(id)}`); }
  override async saveLead(item: Lead) { return this.saveResource(item, "/admin/leads"); }
  override async updateLeadStatus(id: string, status: LeadStatus, note?: string) { return this.request<Lead>(`/admin/leads/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status, note }) }); }
  override async exportLeads(filters?: { exhibitionId?: string; keyword?: string; status?: string; from?: string; to?: string }) { return this.requestText(withQuery("/admin/leads/export", { exhibition_id: filters?.exhibitionId, keyword: filters?.keyword, status: filters?.status, from: filters?.from, to: filters?.to })); }
  override async listFeedback(filters?: { exhibitionId?: string; keyword?: string; status?: Feedback["status"] }) { return this.requestList<Feedback>(withQuery("/admin/feedback", { exhibition_id: filters?.exhibitionId, keyword: filters?.keyword, status: filters?.status })); }
  override async resolveFeedback(id: string, note: string, operator = "当前用户") { return this.request<Feedback>(`/admin/feedback/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify({ note, operator }) }); }

  override async listWelcomeConfigs(exhibitionId?: string) {
    return this.requestList<WelcomeConfig>(withQuery("/admin/interactions/welcome-configs", { exhibition_id: exhibitionId }));
  }
  override async saveWelcomeConfig(item: WelcomeConfig) {
    return this.saveResource(item, "/admin/interactions/welcome-configs");
  }
  override async listExplainFlows(exhibitionId?: string) {
    return this.requestList<ExplainFlow>(withQuery("/admin/interactions/explain-flows", { exhibition_id: exhibitionId }));
  }
  override async saveExplainFlow(item: ExplainFlow) {
    return this.saveResource(item, "/admin/interactions/explain-flows");
  }
  override async deleteExplainFlow(id: string) {
    await this.request(`/admin/interactions/explain-flows/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  override async listShoppingStrategies(exhibitionId?: string) {
    return (await this.requestList<ShoppingStrategy>(withQuery("/admin/interactions/shopping-strategies", { exhibition_id: exhibitionId })))
      .map((item) => ({ ...item, exhibitIds: item.exhibitIds ?? [] }));
  }
  override async saveShoppingStrategy(item: ShoppingStrategy) {
    const saved = await this.saveResource(item, "/admin/interactions/shopping-strategies");
    return { ...saved, exhibitIds: saved.exhibitIds ?? [] };
  }
  override async deleteShoppingStrategy(id: string) {
    await this.request(`/admin/interactions/shopping-strategies/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  override async listDocuments() { return this.requestList<KnowledgeDocument>("/admin/knowledge/documents"); }
  override async uploadDocument(input: Pick<KnowledgeDocument, "title" | "fileName" | "type" | "exhibition">) { return this.request<KnowledgeDocument>("/admin/knowledge/documents", { method: "POST", body: JSON.stringify(input) }); }
  override async updateDocument(id: string, patch: Partial<KnowledgeDocument>) { return this.request<KnowledgeDocument>(`/admin/knowledge/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }); }
  override async deleteDocument(id: string) { await this.request(`/admin/knowledge/documents/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  override async listQa() { return this.requestList<KnowledgeQa>("/admin/knowledge/qa"); }
  override async saveQa(item: KnowledgeQa) { return this.saveResource(item, "/admin/knowledge/qa"); }
  override async transitionQa(id: string, status: KnowledgeQa["status"]) { return this.request<KnowledgeQa>(`/admin/knowledge/qa/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) }); }
  override async deleteQa(id: string) { await this.request(`/admin/knowledge/qa/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  override async listScripts() { return this.requestList<ScriptTemplate>("/admin/knowledge/scripts"); }
  override async saveScript(item: ScriptTemplate) { return this.saveResource(item, "/admin/knowledge/scripts"); }
  override async deleteScript(id: string) { await this.request(`/admin/knowledge/scripts/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  override async listPackages() { return this.requestList<PublishPackage>("/admin/knowledge/packages"); }
  override async createPackage(input: Pick<PublishPackage, "name" | "exhibition" | "qaCount" | "documentCount">) { return this.request<PublishPackage>("/admin/knowledge/packages", { method: "POST", body: JSON.stringify(input) }); }
  override async transitionPackage(id: string, status: PublishPackage["status"]) { return this.request<PublishPackage>(`/admin/knowledge/packages/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) }); }
  override async listMissPool() { return this.requestList<MissPoolItem>("/admin/knowledge/miss-pool"); }
  override async resolveMiss(id: string, status: MissPoolItem["status"]) { return this.request<MissPoolItem>(`/admin/knowledge/miss-pool/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) }); }

  override async listGifs() { return this.requestList<GifAssetMeta>("/admin/assets?kind=gif"); }
  override async createGif(input: Omit<GifAssetMeta, "id" | "createdAt">) { return this.request<GifAssetMeta>("/admin/assets", { method: "POST", body: JSON.stringify(input) }); }
  override async updateGif(id: string, patch: Partial<GifAssetMeta>) { return this.request<GifAssetMeta>(`/admin/assets/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }); }
  override async deleteGif(id: string) { await this.request(`/admin/assets/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  override async listVoiceConfigs() { return this.requestList<VoiceAsset>("/admin/voice-configs"); }
  override async saveVoiceConfig(item: VoiceAsset) { return this.saveResource(item, "/admin/voice-configs"); }
  override async deleteVoiceConfig(id: string) { await this.request(`/admin/voice-configs/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  override async listSceneBindings() { return this.requestList<SceneBinding>("/admin/scene-bindings"); }
  override async saveSceneBindings(bindings: SceneBinding[]) { return this.request<SceneBinding[]>("/admin/scene-bindings", { method: "PUT", body: JSON.stringify({ bindings }) }); }
  override async listIdle() { return this.requestList<IdleContent>("/admin/idle-content"); }
  override async saveIdle(item: IdleContent) { return this.saveResource(item, "/admin/idle-content"); }
}

const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
export function createAdminApi(mode?: string): AdminApiClient {
  return mode === "mock" ? new MockAdminApiClient() : new FetchAdminApiClient();
}
export const adminApi: AdminApiClient = createAdminApi(runtimeEnv.VITE_ADMIN_API_MODE);

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
