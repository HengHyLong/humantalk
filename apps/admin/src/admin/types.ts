export type AdminRole = "sys_admin" | "content_ops" | "data_viewer" | "security_audit" | "readonly";

export type PermissionCode =
  | "dashboard:view"
  | "asset:avatar"
  | "asset:gif"
  | "asset:voice"
  | "asset:scene"
  | "asset:idle"
  | "knowledge:document"
  | "knowledge:base"
  | "knowledge:memory"
  | "knowledge:qa"
  | "knowledge:script"
  | "knowledge:publish"
  | "interact:test"
  | "interact:welcome"
  | "interact:explain"
  | "interact:shopping"
  | "event:exhibition"
  | "event:exhibitor"
  | "event:exhibit"
  | "event:venue"
  | "event:point"
  | "event:route"
  | "event:schedule"
  | "event:broadcast"
  | "lead:view"
  | "lead:view_sensitive"
  | "lead:export"
  | "lead:feedback"
  | "report:interaction"
  | "system:user"
  | "system:role"
  | "system:audit"
  | "system:ops"
  | "audit:trace"
  | "ops:failover";

export type ButtonPermission =
  | "event:exhibition:write"
  | "event:exhibitor:write"
  | "event:exhibit:write"
  | "event:venue:write"
  | "event:point:write"
  | "event:route:write"
  | "event:schedule:write"
  | "event:broadcast:write"
  | "asset:gif:write"
  | "asset:scene:write"
  | "knowledge:qa:write"
  | "knowledge:publish:approve"
  | "knowledge:rollback"
  | "report:export"
  | "lead:write"
  | "lead:feedback:write"
  | "system:user:write"
  | "system:role:write"
  | "interact:welcome:write"
  | "interact:explain:write"
  | "interact:shopping:write"
  | "audit:trace"
  | "ops:failover";

export type AuthSession = {
  token: string;
  user: AdminUser;
  expiresAt: number;
};

export type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  permissions: PermissionCode[];
  buttonPermissions: ButtonPermission[];
};

export type MenuItem = {
  id: string;
  label: string;
  path?: string;
  permission?: PermissionCode;
  enabled?: boolean;
  children?: MenuItem[];
};

export type DashboardData = {
  metrics: Array<{ id: string; label: string; value: string; trend: string; tone: "cyan" | "green" | "amber" | "violet" | "rose" }>;
  todos: Array<{ id: string; type: string; title: string; owner: string; time: string; path: string }>;
};

export type OperationsReport = {
  summary: {
    exhibition_id: string;
    interaction_count: number;
    online_terminals: number;
    pending_knowledge: number;
    new_leads: number;
    alerts: number;
    todo: DashboardData["todos"];
  };
  series: Array<{ date: string; interactions: number; leads: number; misses: number }>;
  dimensions: Record<string, Array<{ label: string; count: number }>>;
};

export type ReportFilters = { exhibitionId?: string; scene?: string; terminalId?: string; from?: string; to?: string };
export type ReportBucket = { key: string; count: number; averageDurationMs?: number; totalDurationMs?: number };
export type ReportOperations = {
  generatedAt: string;
  filters: Record<string, string | null | undefined>;
  interaction: { total: number; averageDurationMs: number; byScene: ReportBucket[]; byTerminal: ReportBucket[]; byHour: ReportBucket[] };
  hotspot: { items: ReportBucket[] };
  hit: { total: number; hit: number; miss: number; hitRate: number; strongQaHit: number; ragHit: number };
  lead: { total: number; converted: number; conversionRate: number; byStatus: ReportBucket[] };
  resource: { items: ReportBucket[] };
};

export type AdminAsset = {
  id: string;
  name: string;
  kind: "avatar" | "gif" | "image" | "video";
  previewUrl: string;
  scene: string;
  tags: string[];
  status: "active" | "inactive";
  description?: string;
  createdAt: string;
};

export type GifAssetMeta = AdminAsset & {
  kind: "gif";
  width: number;
  height: number;
  frames: number;
  durationMs: number;
  fileName: string;
  sizeBytes: number;
};

export type SceneBinding = {
  scene: string;
  assets: Array<{ assetId: string; isPrimary: boolean; order: number }>;
};

export type VoiceAsset = {
  id: string;
  backendId?: number;
  provider: string;
  targetModel?: string | null;
  voiceId: string;
  name: string;
  previewText: string;
  status: "active" | "inactive";
  source?: "system" | "clone" | string;
};

export type KnowledgeDocument = {
  id: string;
  title: string;
  fileName: string;
  type: string;
  exhibition: string;
  parseStatus: "pending" | "parsing" | "parsed" | "failed";
  vectorStatus: "pending" | "indexing" | "indexed" | "failed";
  chunks: number;
  uploader: string;
  uploadedAt: string;
};

export type KnowledgeQaStatus = "draft" | "pending_review" | "published" | "archived";

export type KnowledgeQa = {
  id: string;
  question: string;
  keywords: string[];
  answer: string;
  category: string;
  exhibition: string;
  status: KnowledgeQaStatus;
  version: number;
  creator: string;
  reviewer?: string;
  updatedAt: string;
  history: Array<{ version: number; answer: string; editor: string; time: string; reason: string }>;
};

export type ScriptTemplate = {
  id: string;
  name: string;
  scene: "welcome" | "explain" | "shopping" | "emergency";
  content: string;
  exhibition: string;
  status: "active" | "inactive";
  updatedAt: string;
};

export type PublishPackage = {
  id: string;
  name: string;
  exhibition: string;
  status: "draft" | "pending_review" | "published" | "rolled_back";
  version: number;
  qaCount: number;
  documentCount: number;
  creator: string;
  reviewer?: string;
  updatedAt: string;
};

export type MissPoolItem = {
  id: string;
  question: string;
  count: number;
  firstAskedAt: string;
  lastAskedAt: string;
  status: "pending" | "supplemented" | "converted_qa" | "ignored";
};

export type TraceRecord = {
  traceId: string;
  action: string;
  resource: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};

export type IdleContent = {
  id: string;
  type: "宣传片" | "标语轮播" | "活动主题";
  title: string;
  content: string;
  interval: number;
  exhibition: string;
  enabled: boolean;
};

export type ExhibitionStatus = "preparing" | "setup" | "operating" | "teardown";

export type Exhibition = {
  id: string;
  name: string;
  code: string;
  mainVenueId: string | null;
  hostUnit: string;
  organizerUnit: string;
  coOrganizerUnits: string;
  startDate: string;
  endDate: string;
  status: ExhibitionStatus;
  description: string;
  boundAvatarId: string | null;
  boundModel: string;
  boundVoiceId: string | null;
  boundVoiceProvider?: string | null;
  boundVoiceModel?: string | null;
  boundSttProvider?: string | null;
  boundSttModel?: string | null;
  boundScene: string | null;
  knowledgeBaseIds: string[];
  lifecycleHistory: Array<{ from: ExhibitionStatus | null; to: ExhibitionStatus; operator: string; time: string }>;
  createdAt: string;
  updatedAt: string;
};

export type ExhibitorStatus = "pending" | "active" | "inactive";

export type Exhibitor = {
  id: string;
  exhibitionId: string;
  name: string;
  boothCode: string;
  category: string;
  contact: string;
  phone: string;
  status: ExhibitorStatus;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type ExhibitStatus = "draft" | "published" | "offline";

export type Exhibit = {
  id: string;
  exhibitionId: string;
  exhibitorId: string;
  name: string;
  category: string;
  modelNo: string;
  description: string;
  imageUrls?: string[];
  status: ExhibitStatus;
  createdAt: string;
  updatedAt: string;
};

export type VenueStatus = "draft" | "active" | "inactive";

export type EventVenue = {
  id: string;
  exhibitionId: string;
  name: string;
  address: string;
  description: string;
  status: VenueStatus;
  createdAt: string;
  updatedAt: string;
};

export type PointType = "entrance" | "booth" | "forum" | "facility" | "service" | "other";
export type PointStatus = "draft" | "active" | "inactive";

export type EventPoint = {
  id: string;
  exhibitionId: string;
  venueId: string;
  code: string;
  name: string;
  type: PointType;
  floor: string;
  x: number;
  y: number;
  exhibitorId: string | null;
  exhibitId: string | null;
  description: string;
  status: PointStatus;
  createdAt: string;
  updatedAt: string;
};

export type RouteStatus = "draft" | "published" | "offline";
export type RouteType = "navigation" | "tour" | "emergency";

export type ExhibitionRoute = {
  id: string;
  exhibitionId: string;
  venueId: string;
  name: string;
  type: RouteType;
  pointIds: string[];
  directions: string[];
  estimatedMinutes: number;
  description: string;
  imageUrl?: string | null;
  status: RouteStatus;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleStatus = "draft" | "scheduled" | "finished" | "cancelled";

export type EventSchedule = {
  id: string;
  exhibitionId: string;
  venueId: string | null;
  pointId: string | null;
  title: string;
  type: string;
  startAt: string;
  endAt: string;
  location: string;
  speaker: string;
  description: string;
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
};

export type EmergencyBroadcastPriority = "low" | "normal" | "high" | "urgent";
export type EmergencyBroadcastStatus = "draft" | "active" | "ended";

export type EmergencyBroadcast = {
  id: string;
  exhibitionId: string;
  title: string;
  content: string;
  priority: EmergencyBroadcastPriority;
  targetTerminals: string;
  effectiveAt: string;
  status: EmergencyBroadcastStatus;
  createdAt: string;
  updatedAt: string;
};

export type LeadStatus = "new" | "contacted" | "converted" | "invalid";

export type Lead = {
  id: string;
  exhibitionId: string;
  exhibitionName: string;
  terminalId: string;
  terminalName: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  intentSummary: string;
  status: LeadStatus;
  interestedExhibitorIds: string[];
  interestedExhibitIds: string[];
  qrToken: string;
  materialToken?: string | null;
  createdAt: string;
  statusHistory: Array<{ status: LeadStatus; operator: string; time: string; note?: string }>;
};

export type FeedbackStatus = "pending" | "handled";

export type Feedback = {
  id: string;
  exhibitionId: string;
  type: "体验问题" | "内容建议" | "服务反馈" | "其他";
  score: number;
  content: string;
  traceId: string;
  status: FeedbackStatus;
  createdAt: string;
  handledAt?: string;
  handledBy?: string;
  note?: string;
};

export type AdminUserRecord = {
  id: string;
  username: string;
  displayName: string;
  gender: "男" | "女" | "未设置";
  phone: string;
  email: string;
  department: string;
  status: "active" | "inactive";
  roleIds: string[];
  createdAt: string;
  lastLoginAt: string;
  lastLoginIp: string;
};

export type RoleRecord = {
  id: string;
  code: string;
  name: string;
  dataScope: "全部数据" | "本部门" | "自定义" | "仅本人";
  level: number;
  description: string;
  permissionIds: string[];
  createdAt: string;
};

export type PermissionNode = {
  id: string;
  parentId: string | null;
  name: string;
  code: string;
  type: "menu" | "button" | "api";
  path: string;
  apiPattern: string;
  children?: PermissionNode[];
};

export type TraceSpan = {
  id: string;
  parentId: string | null;
  service: string;
  operation: string;
  startAt: string;
  durationMs: number;
  status: "ok" | "error";
  attributes: Record<string, string>;
};

export type AuditLog = {
  id: string;
  traceId: string;
  username: string;
  ip: string;
  ipLocation: string;
  description: string;
  browser: string;
  durationMs: number;
  createdAt: string;
  resource: string;
  action: string;
  before?: unknown;
  after?: unknown;
  spans: TraceSpan[];
};

export type ServiceHealth = {
  id: string;
  name: string;
  status: "ok" | "warn" | "error";
  latencyMs: number;
  checkedAt: string;
  description: string;
};

export type TerminalStatus = {
  id: string;
  name: string;
  exhibitionId: string;
  location: string;
  status: "online" | "offline" | "disabled";
  lastHeartbeatAt: string;
  version: string;
  cpuPercent: number;
  memoryPercent: number;
};

export type AlertEvent = {
  id: string;
  type: string;
  severity: "low" | "normal" | "high" | "urgent";
  target: string;
  content: string;
  status: "active" | "acknowledged" | "closed";
  occurredAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
};

export type SystemMonitor = {
  os: string;
  ip: string;
  uptime: string;
  refreshedAt: string;
  cpuPercent: number;
  memoryPercent: number;
  swapPercent: number;
  diskPercent: number;
  cpuHistory: number[];
  memoryHistory: number[];
  services: ServiceHealth[];
  terminals: TerminalStatus[];
};

export type InteractionRecord = {
  id: string;
  exhibitionId: string;
  terminalId: string;
  sessionId: string;
  intent: string;
  knowledgeHit: boolean;
  latencyMs: number;
  occurredAt: string;
  traceId: string;
};

export type GatewayPolicy = {
  id: string;
  name: string;
  whitelist: string[];
  rateLimitPerMinute: number;
  timeoutMs: number;
  fallbackMode: "text" | "cached" | "offline";
  enabled: boolean;
  updatedAt: string;
};

export type InteractionStatus = "active" | "inactive";

export type WelcomeConfig = {
  id: string;
  exhibitionId: string;
  exhibitionName: string;
  triggers: string[];
  scriptId: string;
  highlights: string[];
  checkInGuide: string;
  notices: string;
  routingStrategy: string;
  status: InteractionStatus;
  updatedAt: string;
};

export type ExplainFlow = {
  id: string;
  exhibitionId: string;
  exhibitionName: string;
  name: string;
  keywords: string[];
  knowledgeCategories: string[];
  interruptionPolicy: "allow" | "block" | "sensitive_filter";
  scriptId: string;
  status: InteractionStatus;
  updatedAt: string;
};

export type ShoppingStrategy = {
  id: string;
  exhibitionId: string;
  exhibitionName: string;
  name: string;
  tags: string[];
  tagWeight: number;
  compareDimensions: string[];
  intentThreshold: number;
  exhibitCategories: string[];
  exhibitIds?: string[];
  status: InteractionStatus;
  updatedAt: string;
};
