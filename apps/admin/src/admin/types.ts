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
  | "event:route"
  | "event:schedule"
  | "lead:view"
  | "report:interaction"
  | "system:user";

export type ButtonPermission =
  | "event:exhibition:write"
  | "event:exhibitor:write"
  | "event:exhibit:write"
  | "event:venue:write"
  | "event:route:write"
  | "event:schedule:write"
  | "asset:gif:write"
  | "asset:scene:write"
  | "knowledge:qa:write"
  | "knowledge:publish:approve"
  | "knowledge:rollback"
  | "report:export";

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
  venue: string;
  hostUnit: string;
  organizerUnit: string;
  coOrganizerUnits: string;
  startDate: string;
  endDate: string;
  status: ExhibitionStatus;
  description: string;
  boundAvatarId: string | null;
  knowledgeBaseIds: string[];
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

export type RouteStatus = "draft" | "published" | "offline";

export type ExhibitionRoute = {
  id: string;
  venueId: string;
  /** Legacy UI compatibility; new records use venueId as the source of truth. */
  exhibitionId: string;
  name: string;
  from: string;
  to: string;
  distance: string;
  estimatedMinutes: number;
  description: string;
  status: RouteStatus;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleStatus = "draft" | "scheduled" | "finished" | "cancelled";

export type EventSchedule = {
  id: string;
  exhibitionId: string;
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
