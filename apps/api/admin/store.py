from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from argon2 import PasswordHasher


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


PASSWORD_HASHER = PasswordHasher()


class AdminStore:
    """Small repository boundary for the first single-instance Admin deployment.

    Business records are stored as JSON behind a typed ``kind`` key. This keeps the
    first migration additive and lets the route layer enforce domain relationships;
    auth, audit, and relation tables remain relational and indexed.
    """

    def __init__(self, path: str | Path, initialize_defaults: bool = True) -> None:
        self.path = Path(path)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()
        if initialize_defaults:
            self.seed_defaults()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self.path), timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _initialize(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS admin_schema_version (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS admin_users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    email TEXT NOT NULL DEFAULT '',
                    phone TEXT NOT NULL DEFAULT '',
                    gender TEXT NOT NULL DEFAULT 'unknown',
                    department TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login_at TEXT,
                    last_login_ip TEXT
                );
                CREATE TABLE IF NOT EXISTS admin_roles (
                    id TEXT PRIMARY KEY,
                    code TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    data_scope TEXT NOT NULL DEFAULT 'custom',
                    level INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS admin_permissions (
                    id TEXT PRIMARY KEY,
                    parent_id TEXT,
                    code TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    path TEXT NOT NULL DEFAULT '',
                    api_pattern TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(parent_id) REFERENCES admin_permissions(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS admin_user_roles (
                    user_id TEXT NOT NULL,
                    role_id TEXT NOT NULL,
                    PRIMARY KEY(user_id, role_id),
                    FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
                    FOREIGN KEY(role_id) REFERENCES admin_roles(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS admin_role_permissions (
                    role_id TEXT NOT NULL,
                    permission_id TEXT NOT NULL,
                    PRIMARY KEY(role_id, permission_id),
                    FOREIGN KEY(role_id) REFERENCES admin_roles(id) ON DELETE CASCADE,
                    FOREIGN KEY(permission_id) REFERENCES admin_permissions(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS admin_tokens (
                    jti TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token_type TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    revoked_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS admin_audit_logs (
                    id TEXT PRIMARY KEY,
                    trace_id TEXT NOT NULL,
                    user_id TEXT,
                    username TEXT NOT NULL DEFAULT '',
                    method TEXT NOT NULL,
                    path TEXT NOT NULL,
                    action TEXT NOT NULL,
                    resource_type TEXT NOT NULL DEFAULT '',
                    resource_id TEXT NOT NULL DEFAULT '',
                    ip TEXT NOT NULL DEFAULT '',
                    user_agent TEXT NOT NULL DEFAULT '',
                    status_code INTEGER NOT NULL,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    before_json TEXT,
                    after_json TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at);
                CREATE INDEX IF NOT EXISTS idx_admin_audit_trace ON admin_audit_logs(trace_id);
                CREATE TABLE IF NOT EXISTS admin_records (
                    kind TEXT NOT NULL,
                    id TEXT NOT NULL,
                    exhibition_id TEXT,
                    data_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(kind, id)
                );
                CREATE INDEX IF NOT EXISTS idx_admin_records_exhibition ON admin_records(kind, exhibition_id);
                CREATE TABLE IF NOT EXISTS admin_record_links (
                    owner_kind TEXT NOT NULL,
                    owner_id TEXT NOT NULL,
                    link_kind TEXT NOT NULL,
                    link_id TEXT NOT NULL,
                    PRIMARY KEY(owner_kind, owner_id, link_kind, link_id)
                );
                """
            )
            conn.execute("INSERT OR IGNORE INTO admin_schema_version(version, applied_at) VALUES (?, ?)", (1, utc_now()))

    def seed_defaults(self) -> None:
        now = utc_now()
        permissions = [
            ("menu-dashboard", None, "dashboard:view", "首页", "menu", "/dashboard"),
            ("button-report-export", "menu-dashboard", "report:export", "报表导出", "button", ""),
            ("menu-event", None, "event", "展会运营", "menu", ""),
            ("menu-event-exhibition", "menu-event", "event:exhibition", "展会管理", "menu", "/event/exhibition"),
            ("menu-event-exhibitor", "menu-event", "event:exhibitor", "展商管理", "menu", "/event/exhibitor"),
            ("menu-event-exhibit", "menu-event", "event:exhibit", "展品管理", "menu", "/event/exhibit"),
            ("menu-event-route", "menu-event", "event:route", "地图路线", "menu", "/event/route"),
            ("menu-event-schedule", "menu-event", "event:schedule", "活动排期", "menu", "/event/schedule"),
            ("menu-event-venue", "menu-event", "event:venue", "场地管理", "menu", "/event/venue"),
            ("menu-event-point", "menu-event", "event:point", "点位管理", "menu", "/event/point"),
            ("menu-event-broadcast", "menu-event", "event:broadcast", "应急播报", "menu", "/event/broadcast"),
            ("menu-interaction", None, "interaction", "交互管理", "menu", ""),
            ("menu-welcome", "menu-interaction", "interact:welcome", "欢迎配置", "menu", "/interact/welcome"),
            ("menu-explain", "menu-interaction", "interact:explain", "讲解流程", "menu", "/interact/explain"),
            ("menu-shopping", "menu-interaction", "interact:shopping", "导购策略", "menu", "/interact/shopping"),
            ("menu-lead", None, "lead:view", "线索运营", "menu", "/lead"),
            ("menu-assets", None, "asset", "数字人中心", "menu", ""),
            ("menu-asset-avatar", "menu-assets", "asset:avatar", "数字人形象", "menu", "/asset/avatar"),
            ("menu-asset-gif", "menu-assets", "asset:gif", "动作素材", "menu", "/asset/gif"),
            ("menu-asset-voice", "menu-assets", "asset:voice", "声音配置", "menu", "/asset/voice"),
            ("menu-asset-scene", "menu-assets", "asset:scene", "场景绑定", "menu", "/asset/scene"),
            ("menu-asset-idle", "menu-assets", "asset:idle", "待机内容", "menu", "/asset/idle"),
            ("menu-knowledge", None, "knowledge", "知识中心", "menu", ""),
            ("menu-knowledge-document", "menu-knowledge", "knowledge:document", "文档资料", "menu", "/knowledge/document"),
            ("menu-knowledge-qa", "menu-knowledge", "knowledge:qa", "问答知识", "menu", "/knowledge/qa"),
            ("menu-knowledge-script", "menu-knowledge", "knowledge:script", "官方话术", "menu", "/knowledge/script"),
            ("menu-knowledge-publish", "menu-knowledge", "knowledge:publish", "发布审核", "menu", "/knowledge/package"),
            ("menu-knowledge-base", "menu-knowledge", "knowledge:base", "知识库", "menu", "/knowledge/base"),
            ("menu-knowledge-memory", "menu-knowledge", "knowledge:memory", "记忆库", "menu", "/knowledge/memory"),
            ("button-knowledge-miss", "menu-knowledge-publish", "knowledge:miss", "未命中池", "button", ""),
            ("menu-system", None, "system", "系统管理", "menu", ""),
            ("menu-user", "menu-system", "system:user", "用户管理", "menu", "/system/user"),
            ("menu-role", "menu-system", "system:role", "角色管理", "menu", "/system/role"),
            ("menu-audit", "menu-system", "system:audit", "审计日志", "menu", "/system/audit"),
            ("menu-ops", "menu-system", "system:ops", "监控告警", "menu", "/system/ops"),
            ("button-lead-sensitive", "menu-lead", "lead:view_sensitive", "查看敏感联系方式", "button", ""),
            ("button-lead-export", "menu-lead", "lead:export", "导出线索", "button", ""),
            ("button-lead-feedback", "menu-lead", "lead:feedback", "处理反馈", "button", ""),
            ("button-trace", "menu-audit", "audit:trace", "查看 Trace", "button", ""),
            ("button-failover", "menu-ops", "ops:failover", "故障切换", "button", ""),
        ]
        with self.connect() as conn:
            for item in permissions:
                conn.execute(
                    "INSERT OR IGNORE INTO admin_permissions(id,parent_id,code,name,kind,path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    (*item, now, now),
                )
            roles = [
                ("role-admin", "sys_admin", "系统管理员", "全部管理权限"),
                ("role-content", "content_ops", "内容运营", "内容、展会和线索运营"),
                ("role-data", "data_viewer", "数据查看", "数据与线索只读"),
                ("role-audit", "security_audit", "安全审计", "审计和 Trace 查看"),
                ("role-readonly", "readonly", "只读用户", "菜单可见，所有写操作禁用"),
            ]
            for role_id, code, name, description in roles:
                conn.execute(
                    "INSERT OR IGNORE INTO admin_roles(id,code,name,description,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                    (role_id, code, name, description, now, now),
                )
            all_permissions = [row[0] for row in conn.execute("SELECT id FROM admin_permissions")]
            content_codes = {"dashboard:view", "event", "event:exhibition", "event:exhibitor", "event:exhibit", "event:venue", "event:point", "event:route", "event:schedule", "event:broadcast", "interaction", "interact:welcome", "interact:explain", "interact:shopping", "lead:view", "lead:view_sensitive", "lead:export", "lead:feedback", "asset", "asset:avatar", "asset:gif", "asset:voice", "asset:scene", "asset:idle", "knowledge", "knowledge:document", "knowledge:base", "knowledge:memory", "knowledge:qa", "knowledge:script", "knowledge:publish", "knowledge:miss"}
            data_codes = {"dashboard:view", "report:export", "lead:view", "lead:export"}
            audit_codes = {"dashboard:view", "system", "system:audit", "audit:trace"}
            for role_code, codes in (("sys_admin", set(row[1] for row in permissions)), ("content_ops", content_codes), ("data_viewer", data_codes), ("security_audit", audit_codes), ("readonly", set(row[1] for row in permissions))):
                role = conn.execute("SELECT id FROM admin_roles WHERE code=?", (role_code,)).fetchone()
                if not role:
                    continue
                for permission_id, code, *_ in conn.execute("SELECT id,code,name,kind,path FROM admin_permissions"):
                    if code in codes or permission_id in all_permissions and role_code in {"sys_admin", "readonly"}:
                        conn.execute("INSERT OR IGNORE INTO admin_role_permissions(role_id,permission_id) VALUES (?,?)", (role[0], permission_id))
            user = conn.execute("SELECT id FROM admin_users WHERE username='admin'").fetchone()
            if not user:
                user_id = "user-admin"
                conn.execute(
                    "INSERT INTO admin_users(id,username,display_name,password_hash,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    (user_id, "admin", "系统管理员", PASSWORD_HASHER.hash("Admin@123456"), "admin@example.com", "active", now, now),
                )
                role = conn.execute("SELECT id FROM admin_roles WHERE code='sys_admin'").fetchone()
                conn.execute("INSERT INTO admin_user_roles(user_id,role_id) VALUES (?,?)", (user_id, role[0]))
            extra_users = [
                ("user-content", "content.operator", "内容运营", "content@example.com", "13800000002", "role-content"),
                ("user-data", "data.viewer", "数据查看", "data@example.com", "13800000003", "role-data"),
                ("user-audit", "security.audit", "安全审计", "audit@example.com", "13800000004", "role-audit"),
                ("user-readonly", "readonly.viewer", "只读查看", "readonly@example.com", "13800000005", "role-readonly"),
            ]
            for user_id, username, display_name, email, phone, role_id in extra_users:
                conn.execute(
                    "INSERT OR IGNORE INTO admin_users(id,username,display_name,password_hash,email,phone,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (user_id, username, display_name, PASSWORD_HASHER.hash("Admin@123456"), email, phone, "active", now, now),
                )
                conn.execute("INSERT OR IGNORE INTO admin_user_roles(user_id,role_id) VALUES (?,?)", (user_id, role_id))
            self._seed_records(conn, now)

    @staticmethod
    def _seed_records(conn: sqlite3.Connection, now: str) -> None:
        records = [
            ("exhibitions", "expo-2026", None, {"id": "expo-2026", "code": "XBH-2026", "name": "2026 西部博览会", "startDate": "2026-09-01", "endDate": "2026-09-05", "status": "operating", "isCurrent": True, "description": "四川博览集团数字人示范展会"}),
            ("venues", "venue-a", "expo-2026", {"id": "venue-a", "exhibitionId": "expo-2026", "name": "A馆", "address": "成都世纪城会展中心", "status": "active"}),
            ("points", "point-a01", "expo-2026", {"id": "point-a01", "venueId": "venue-a", "exhibitionId": "expo-2026", "name": "A馆入口", "type": "entrance", "x": 0, "y": 0}),
            ("points", "point-a12", "expo-2026", {"id": "point-a12", "venueId": "venue-a", "exhibitionId": "expo-2026", "name": "数字人展台", "type": "booth", "x": 30, "y": 15}),
            ("exhibitors", "exhibitor-001", "expo-2026", {"id": "exhibitor-001", "exhibitionId": "expo-2026", "name": "智联科技", "boothCode": "A12", "category": "人工智能", "status": "active"}),
            ("exhibits", "exhibit-001", "expo-2026", {"id": "exhibit-001", "exhibitionId": "expo-2026", "exhibitorId": "exhibitor-001", "name": "智能导览终端", "category": "数字化展陈", "status": "active", "tags": ["导航", "数字人"]}),
            ("routes", "route-a01-a12", "expo-2026", {"id": "route-a01-a12", "exhibitionId": "expo-2026", "venueId": "venue-a", "name": "入口至数字人展台", "pointIds": ["point-a01", "point-a12"], "directions": ["从A馆入口直行", "沿主通道到达A12展台"], "estimatedMinutes": 3, "status": "published"}),
            ("interaction_welcome", "welcome-001", "expo-2026", {"id": "welcome-001", "exhibitionId": "expo-2026", "trigger": "terminal_start", "scriptId": "script-welcome", "highlights": ["数字人导航", "展品问答"], "status": "active"}),
            ("interaction_explain", "explain-001", "expo-2026", {"id": "explain-001", "exhibitionId": "expo-2026", "name": "展品讲解流程", "keywords": ["介绍一下", "讲解"], "knowledgeCategories": ["exhibit", "exhibitor"], "interruptPolicy": "allow", "status": "active"}),
            ("interaction_shopping", "shopping-001", "expo-2026", {"id": "shopping-001", "exhibitionId": "expo-2026", "name": "智能终端导购策略", "intentThreshold": 70, "weights": {"category": 0.5, "tag": 0.3, "exhibitor": 0.2}, "status": "active"}),
            ("runtime_configs", "expo-2026", "expo-2026", {"id": "expo-2026", "exhibitionId": "expo-2026", "keywords": {"navigation": ["怎么去", "在哪里", "路线"], "exhibition_content": ["展会介绍", "展商信息", "展品介绍"]}, "supports_deferred_speak": True}),
            ("leads", "lead-1001", "expo-2026", {"id": "lead-1001", "exhibitionId": "expo-2026", "exhibitionName": "2026 西部博览会", "terminalId": "terminal-a01", "terminalName": "A馆迎宾终端", "companyName": "成都未来智造有限公司", "contactName": "李明", "phone": "13800138000", "email": "liming@example.com", "intentSummary": "关注智能导览终端，希望安排商务洽谈。", "status": "new", "interestedExhibitorIds": ["exhibitor-001"], "interestedExhibitIds": ["exhibit-001"], "qrToken": "qr-lead-1001", "createdAt": now, "statusHistory": [{"status": "new", "operator": "系统", "time": now}]}),
            ("feedback", "feedback-001", "expo-2026", {"id": "feedback-001", "exhibitionId": "expo-2026", "type": "服务反馈", "score": 5, "content": "数字人导航很方便。", "traceId": "trace-feedback-001", "status": "pending", "createdAt": now}),
            ("documents", "doc-001", "expo-2026", {"id": "doc-001", "title": "2026 西部博览会展商名录", "fileName": "exhibitors.pdf", "type": "展商资料", "exhibition": "2026 西部博览会", "exhibitionId": "expo-2026", "parseStatus": "parsed", "vectorStatus": "indexed", "chunks": 24, "uploader": "系统管理员", "uploadedAt": now}),
            ("qa", "qa-001", "expo-2026", {"id": "qa-001", "question": "本届博览会在哪里举办？", "keywords": ["地点", "场馆"], "answer": "本届博览会将在成都西部国际博览城举办。", "category": "展会", "exhibition": "2026 西部博览会", "exhibitionId": "expo-2026", "status": "published", "version": 1, "creator": "系统管理员", "updatedAt": now, "history": []}),
            ("scripts", "script-001", "expo-2026", {"id": "script-001", "name": "标准迎宾", "scene": "welcome", "content": "您好，欢迎来到{exhibition_name}。", "exhibition": "2026 西部博览会", "exhibitionId": "expo-2026", "status": "active", "updatedAt": now}),
            ("packages", "package-001", "expo-2026", {"id": "package-001", "name": "西博会知识包 v1", "exhibition": "2026 西部博览会", "exhibitionId": "expo-2026", "status": "published", "version": 1, "qaCount": 1, "documentCount": 1, "creator": "系统管理员", "updatedAt": now}),
            ("miss_pool", "miss-001", "expo-2026", {"id": "miss-001", "question": "附近有哪些休息区？", "exhibitionId": "expo-2026", "count": 3, "firstAskedAt": now, "lastAskedAt": now, "status": "pending"}),
            ("services", "service-api", None, {"id": "service-api", "name": "Unified API", "status": "ok", "latencyMs": 12, "checkedAt": now, "description": "OpenTalking API 与 Admin 服务"}),
            ("terminals", "terminal-a01", "expo-2026", {"id": "terminal-a01", "name": "A馆迎宾终端", "exhibitionId": "expo-2026", "location": "A馆入口", "status": "online", "lastHeartbeatAt": now, "version": "dev", "cpuPercent": 8, "memoryPercent": 32}),
            ("gifs", "gif-welcome", "expo-2026", {"id": "gif-welcome", "name": "迎宾微笑", "filename": "welcome.gif", "status": "active", "scene": "welcome", "url": "", "createdAt": now}),
            ("voice_configs", "voice-default", "expo-2026", {"id": "voice-default", "provider": "edge", "voiceId": "zh-CN-XiaoxiaoNeural", "name": "晓晓", "previewText": "您好，欢迎来到展会。", "status": "active", "source": "system"}),
            ("scene_bindings", "scene-welcome", "expo-2026", {"id": "scene-welcome", "scene": "welcome", "assets": [{"assetId": "gif-welcome", "isPrimary": True, "order": 0}]}),
            ("idle_contents", "idle-welcome", "expo-2026", {"id": "idle-welcome", "type": "标语轮播", "title": "西博会欢迎语", "content": "欢迎来到 2026 西部博览会", "interval": 8, "exhibition": "2026 西部博览会", "exhibitionId": "expo-2026", "enabled": True}),
            ("alerts", "alert-001", None, {"id": "alert-001", "type": "service", "severity": "warning", "object": "tts", "content": "外部 TTS 服务尚未配置", "status": "open", "createdAt": now}),
            ("monitor", "system", None, {"id": "system", "os": "OpenTalking API", "ip": "127.0.0.1", "uptime": "运行中", "cpu": 0, "memory": 0, "swap": 0, "disk": 0, "refreshedAt": now}),
        ]
        # Keep the local deployment useful for end-to-end verification. These
        # records are additive and deterministic, so restarting the API does
        # not duplicate them or overwrite data created from the UI.
        records.extend([
            ("exhibitions", "expo-2027", None, {"id": "expo-2027", "code": "XBH-2027", "name": "2027 智慧城市展", "startDate": "2027-04-12", "endDate": "2027-04-15", "status": "preparing", "isCurrent": False, "description": "智慧城市与数字服务专题展。"}),
            ("venues", "venue-b", "expo-2026", {"id": "venue-b", "venueId": "venue-b", "exhibitionId": "expo-2026", "name": "B馆", "address": "成都世纪城会展中心", "status": "active"}),
            ("venues", "venue-2027-main", "expo-2027", {"id": "venue-2027-main", "venueId": "venue-2027-main", "exhibitionId": "expo-2027", "name": "智慧城市主题馆", "address": "成都天府国际会议中心", "status": "active"}),
            ("venues", "venue-2027-forum", "expo-2027", {"id": "venue-2027-forum", "venueId": "venue-2027-forum", "exhibitionId": "expo-2027", "name": "城市论坛馆", "address": "成都天府国际会议中心", "status": "active"}),
            ("points", "point-b01", "expo-2026", {"id": "point-b01", "venueId": "venue-b", "exhibitionId": "expo-2026", "name": "B馆入口", "type": "entrance", "x": 12, "y": 8}),
            ("points", "point-b08", "expo-2026", {"id": "point-b08", "venueId": "venue-b", "exhibitionId": "expo-2026", "name": "机器人展区", "type": "booth", "x": 42, "y": 26}),
            ("points", "point-2027-main", "expo-2027", {"id": "point-2027-main", "venueId": "venue-2027-main", "exhibitionId": "expo-2027", "name": "智慧城市入口", "type": "entrance", "x": 5, "y": 5}),
            ("points", "point-2027-forum", "expo-2027", {"id": "point-2027-forum", "venueId": "venue-2027-forum", "exhibitionId": "expo-2027", "name": "主论坛区", "type": "forum", "x": 28, "y": 18}),
            ("exhibitors", "exhibitor-002", "expo-2026", {"id": "exhibitor-002", "exhibitionId": "expo-2026", "name": "川智机器人", "boothCode": "B08", "category": "智能制造", "status": "active"}),
            ("exhibitors", "exhibitor-2027-001", "expo-2027", {"id": "exhibitor-2027-001", "exhibitionId": "expo-2027", "name": "天府云图", "boothCode": "C01", "category": "城市数字孪生", "status": "active"}),
            ("exhibitors", "exhibitor-2027-002", "expo-2027", {"id": "exhibitor-2027-002", "exhibitionId": "expo-2027", "name": "绿能交通", "boothCode": "C12", "category": "绿色交通", "status": "active"}),
            ("exhibits", "exhibit-002", "expo-2026", {"id": "exhibit-002", "exhibitionId": "expo-2026", "exhibitorId": "exhibitor-002", "name": "协作机器人工作站", "category": "智能制造", "status": "active", "tags": ["机器人", "演示"]}),
            ("exhibits", "exhibit-2027-001", "expo-2027", {"id": "exhibit-2027-001", "exhibitionId": "expo-2027", "exhibitorId": "exhibitor-2027-001", "name": "城市数字孪生平台", "category": "城市治理", "status": "active", "tags": ["城市", "数据", "平台"]}),
            ("exhibits", "exhibit-2027-002", "expo-2027", {"id": "exhibit-2027-002", "exhibitionId": "expo-2027", "exhibitorId": "exhibitor-2027-002", "name": "氢能公交系统", "category": "绿色交通", "status": "active", "tags": ["低碳", "交通"]}),
            ("routes", "route-b01-b08", "expo-2026", {"id": "route-b01-b08", "exhibitionId": "expo-2026", "venueId": "venue-b", "name": "B馆入口至机器人展区", "pointIds": ["point-b01", "point-b08"], "directions": ["进入B馆后沿中央通道前行", "在B08展区右转"], "estimatedMinutes": 4, "status": "published"}),
            ("routes", "route-2027-main-forum", "expo-2027", {"id": "route-2027-main-forum", "exhibitionId": "expo-2027", "venueId": "venue-2027-main", "name": "入口至智慧城市论坛区", "pointIds": ["point-2027-main", "point-2027-forum"], "directions": ["从主题馆入口进入", "沿蓝色导视线步行至论坛馆"], "estimatedMinutes": 5, "status": "draft"}),
            ("schedules", "schedule-2026-opening", "expo-2026", {"id": "schedule-2026-opening", "exhibitionId": "expo-2026", "venueId": "venue-a", "pointId": "point-a01", "title": "开幕式暨主论坛", "type": "论坛", "startAt": "2026-09-01 09:30", "endAt": "2026-09-01 11:30", "location": "A馆主论坛区", "speaker": "四川博览集团", "description": "展会开幕及年度产业趋势分享。", "status": "scheduled"}),
            ("schedules", "schedule-2026-robot", "expo-2026", {"id": "schedule-2026-robot", "exhibitionId": "expo-2026", "venueId": "venue-b", "pointId": "point-b08", "title": "机器人现场演示", "type": "演示", "startAt": "2026-09-02 14:00", "endAt": "2026-09-02 15:00", "location": "B08展区", "speaker": "川智机器人", "description": "协作机器人工作站现场演示。", "status": "draft"}),
            ("schedules", "schedule-2027-forum", "expo-2027", {"id": "schedule-2027-forum", "exhibitionId": "expo-2027", "venueId": "venue-2027-forum", "pointId": "point-2027-forum", "title": "城市治理数据论坛", "type": "论坛", "startAt": "2027-04-13 10:00", "endAt": "2027-04-13 12:00", "location": "城市论坛馆", "speaker": "天府云图", "description": "城市数字孪生应用实践分享。", "status": "scheduled"}),
            ("broadcasts", "broadcast-2026-safety", "expo-2026", {"id": "broadcast-2026-safety", "exhibitionId": "expo-2026", "title": "现场安全提示", "content": "请观众按照现场工作人员指引有序参观。", "priority": "normal", "targetTerminals": "全部终端", "effectiveAt": "2026-09-01 08:00", "status": "published"}),
            ("broadcasts", "broadcast-2026-forum", "expo-2026", {"id": "broadcast-2026-forum", "exhibitionId": "expo-2026", "title": "主论坛即将开始", "content": "主论坛将在A馆论坛区开始，请提前入场。", "priority": "high", "targetTerminals": "terminal-a01", "effectiveAt": "2026-09-01 09:15", "status": "scheduled"}),
            ("broadcasts", "broadcast-2027-welcome", "expo-2027", {"id": "broadcast-2027-welcome", "exhibitionId": "expo-2027", "title": "智慧城市展预告", "content": "欢迎关注2027智慧城市展。", "priority": "normal", "targetTerminals": "全部终端", "effectiveAt": "2027-04-12 08:00", "status": "draft"}),
            ("interaction_welcome", "welcome-2027", "expo-2027", {"id": "welcome-2027", "exhibitionId": "expo-2027", "trigger": "user_nearby", "scriptId": "script-2027-welcome", "highlights": ["城市数字孪生", "绿色交通"], "status": "active"}),
            ("interaction_explain", "explain-2027", "expo-2027", {"id": "explain-2027", "exhibitionId": "expo-2027", "name": "智慧城市展品讲解", "keywords": ["数字孪生", "氢能公交"], "knowledgeCategories": ["exhibit", "service"], "interruptPolicy": "queue", "status": "active"}),
            ("interaction_shopping", "shopping-2027", "expo-2027", {"id": "shopping-2027", "exhibitionId": "expo-2027", "name": "绿色城市导购策略", "intentThreshold": 65, "weights": {"category": 0.4, "tag": 0.35, "exhibitor": 0.25}, "status": "active"}),
            ("runtime_configs", "expo-2027", "expo-2027", {"id": "expo-2027", "exhibitionId": "expo-2027", "keywords": {"navigation": ["怎么去论坛", "在哪里签到"], "exhibition_content": ["智慧城市", "绿色交通"]}, "supports_deferred_speak": True}),
            ("documents", "doc-2026-venue", "expo-2026", {"id": "doc-2026-venue", "title": "展馆服务设施说明", "fileName": "venue-services.pdf", "type": "服务设施", "exhibition": "2026 西部博览会", "exhibitionId": "expo-2026", "parseStatus": "parsed", "vectorStatus": "indexed", "chunks": 18, "uploader": "内容运营", "uploadedAt": now}),
            ("documents", "doc-2027-city", "expo-2027", {"id": "doc-2027-city", "title": "智慧城市展品手册", "fileName": "smart-city.pdf", "type": "展品资料", "exhibition": "2027 智慧城市展", "exhibitionId": "expo-2027", "parseStatus": "parsing", "vectorStatus": "pending", "chunks": 0, "uploader": "内容运营", "uploadedAt": now}),
            ("qa", "qa-2026-route", "expo-2026", {"id": "qa-2026-route", "question": "如何前往机器人展区？", "keywords": ["机器人", "路线"], "answer": "从B馆入口进入后沿中央通道前行约四分钟到达B08展区。", "category": "导览", "exhibition": "2026 西部博览会", "exhibitionId": "expo-2026", "status": "pending_review", "version": 1, "creator": "内容运营", "updatedAt": now, "history": []}),
            ("qa", "qa-2027-city", "expo-2027", {"id": "qa-2027-city", "question": "智慧城市展有哪些内容？", "keywords": ["智慧城市", "展区"], "answer": "本届展会重点展示城市数字孪生、绿色交通和公共服务数字化。", "category": "展会", "exhibition": "2027 智慧城市展", "exhibitionId": "expo-2027", "status": "draft", "version": 1, "creator": "内容运营", "updatedAt": now, "history": []}),
            ("scripts", "script-2027-welcome", "expo-2027", {"id": "script-2027-welcome", "name": "智慧城市迎宾", "scene": "welcome", "content": "您好，欢迎来到{exhibition_name}，我可以为您介绍城市数字化展品。", "exhibition": "2027 智慧城市展", "exhibitionId": "expo-2027", "status": "active", "updatedAt": now}),
            ("scripts", "script-2026-forum", "expo-2026", {"id": "script-2026-forum", "name": "论坛播报话术", "scene": "broadcast", "content": "主论坛将在{location}于{start_at}开始，欢迎各位观众参加。", "exhibition": "2026 西部博览会", "exhibitionId": "expo-2026", "status": "active", "updatedAt": now}),
            ("packages", "package-2026-v2", "expo-2026", {"id": "package-2026-v2", "name": "西博会现场服务包 v2", "exhibition": "2026 西部博览会", "exhibitionId": "expo-2026", "status": "pending_review", "version": 2, "qaCount": 2, "documentCount": 2, "creator": "内容运营", "updatedAt": now}),
            ("packages", "package-2027-v1", "expo-2027", {"id": "package-2027-v1", "name": "智慧城市知识包 v1", "exhibition": "2027 智慧城市展", "exhibitionId": "expo-2027", "status": "draft", "version": 1, "qaCount": 1, "documentCount": 1, "creator": "内容运营", "updatedAt": now}),
            ("miss_pool", "miss-2026-rest", "expo-2026", {"id": "miss-2026-rest", "question": "附近有哪些休息区？", "exhibitionId": "expo-2026", "count": 7, "firstAskedAt": now, "lastAskedAt": now, "status": "pending"}),
            ("miss_pool", "miss-2027-parking", "expo-2027", {"id": "miss-2027-parking", "question": "停车场怎么走？", "exhibitionId": "expo-2027", "count": 2, "firstAskedAt": now, "lastAskedAt": now, "status": "resolved"}),
            ("terminals", "terminal-b01", "expo-2026", {"id": "terminal-b01", "name": "B馆咨询终端", "exhibitionId": "expo-2026", "location": "B馆入口", "status": "online", "lastHeartbeatAt": now, "version": "dev", "cpuPercent": 14, "memoryPercent": 41}),
            ("terminals", "terminal-2027-c01", "expo-2027", {"id": "terminal-2027-c01", "name": "智慧城市展台终端", "exhibitionId": "expo-2027", "location": "C01展台", "status": "offline", "lastHeartbeatAt": now, "version": "0.9.0", "cpuPercent": 0, "memoryPercent": 0}),
            ("services", "service-admin", None, {"id": "service-admin", "name": "Admin API", "status": "ok", "latencyMs": 18, "checkedAt": now, "description": "管理后台业务接口"}),
            ("services", "service-redis", None, {"id": "service-redis", "name": "Session Broker", "status": "ok", "latencyMs": 4, "checkedAt": now, "description": "会话与任务队列"}),
            ("alerts", "alert-002", None, {"id": "alert-002", "type": "terminal", "severity": "critical", "object": "terminal-2027-c01", "content": "智慧城市展台终端超过5分钟未上报心跳。", "status": "open", "createdAt": now}),
            ("alerts", "alert-003", None, {"id": "alert-003", "type": "resource", "severity": "info", "object": "knowledge-index", "content": "知识包 v2 等待审核发布。", "status": "acknowledged", "createdAt": now, "acknowledgedBy": "系统管理员"}),
            ("gifs", "gif-explain", "expo-2026", {"id": "gif-explain", "name": "讲解手势", "filename": "explain.gif", "status": "active", "scene": "explain", "url": "", "createdAt": now}),
            ("gifs", "gif-2027-welcome", "expo-2027", {"id": "gif-2027-welcome", "name": "城市迎宾", "filename": "city-welcome.gif", "status": "draft", "scene": "welcome", "url": "", "createdAt": now}),
            ("scene_bindings", "scene-explain", "expo-2026", {"id": "scene-explain", "scene": "explain", "assets": [{"assetId": "gif-explain", "isPrimary": True, "order": 0}]}),
            ("scene_bindings", "scene-2027-welcome", "expo-2027", {"id": "scene-2027-welcome", "scene": "welcome", "assets": [{"assetId": "gif-2027-welcome", "isPrimary": True, "order": 0}]}),
            ("idle_contents", "idle-2027", "expo-2027", {"id": "idle-2027", "type": "热点轮播", "title": "智慧城市热点", "content": "城市数字孪生 · 绿色交通 · 公共服务", "interval": 10, "exhibition": "2027 智慧城市展", "exhibitionId": "expo-2027", "enabled": True}),
        ])
        for index, (company, contact, status) in enumerate([
            ("天府智造有限公司", "王强", "contacted"),
            ("成都未来实验室", "赵敏", "converted"),
            ("川西展览服务", "陈涛", "invalid"),
        ], start=2):
            records.append(("leads", f"lead-100{index}", "expo-2026", {"id": f"lead-100{index}", "exhibitionId": "expo-2026", "exhibitionName": "2026 西部博览会", "terminalId": "terminal-b01", "terminalName": "B馆咨询终端", "companyName": company, "contactName": contact, "phone": f"1390000000{index}", "email": f"contact{index}@example.com", "intentSummary": "关注展会数字化服务与现场导览。", "status": status, "interestedExhibitorIds": ["exhibitor-002"], "interestedExhibitIds": ["exhibit-002"], "qrToken": f"qr-lead-100{index}", "createdAt": now, "statusHistory": [{"status": "new", "operator": "系统", "time": now}, {"status": status, "operator": "内容运营", "time": now}]}))
        records.extend([
            ("leads", "lead-2001", "expo-2027", {"id": "lead-2001", "exhibitionId": "expo-2027", "exhibitionName": "2027 智慧城市展", "terminalId": "terminal-2027-c01", "terminalName": "智慧城市展台终端", "companyName": "天府城市运营有限公司", "contactName": "周岚", "phone": "13700000021", "email": "zhoulan@example.com", "intentSummary": "希望了解城市数字孪生平台的落地方案。", "status": "contacted", "interestedExhibitorIds": ["exhibitor-2027-001"], "interestedExhibitIds": ["exhibit-2027-001"], "qrToken": "qr-lead-2001", "createdAt": now, "statusHistory": [{"status": "new", "operator": "系统", "time": now}, {"status": "contacted", "operator": "内容运营", "time": now}]}),
            ("leads", "lead-2002", "expo-2027", {"id": "lead-2002", "exhibitionId": "expo-2027", "exhibitionName": "2027 智慧城市展", "terminalId": "terminal-2027-c01", "terminalName": "智慧城市展台终端", "companyName": "锦城绿色交通集团", "contactName": "杨帆", "phone": "13700000022", "email": "yangfan@example.com", "intentSummary": "关注氢能公交系统及绿色交通合作机会。", "status": "new", "interestedExhibitorIds": ["exhibitor-2027-002"], "interestedExhibitIds": ["exhibit-2027-002"], "qrToken": "qr-lead-2002", "createdAt": now, "statusHistory": [{"status": "new", "operator": "系统", "time": now}]}),
        ])
        for index, (score, status, content) in enumerate([(4, "pending", "讲解流程很清晰。"), (3, "resolved", "希望增加更多休息区提示。"), (5, "pending", "导购推荐很有帮助。")], start=2):
            records.append(("feedback", f"feedback-00{index}", "expo-2026", {"id": f"feedback-00{index}", "exhibitionId": "expo-2026", "type": "体验反馈", "score": score, "content": content, "traceId": f"trace-feedback-00{index}", "status": status, "createdAt": now}))
        records.extend([
            ("feedback", "feedback-2027-001", "expo-2027", {"id": "feedback-2027-001", "exhibitionId": "expo-2027", "type": "导购反馈", "score": 5, "content": "希望增加城市数字孪生案例对比。", "traceId": "trace-feedback-2027-001", "status": "pending", "createdAt": now}),
            ("feedback", "feedback-2027-002", "expo-2027", {"id": "feedback-2027-002", "exhibitionId": "expo-2027", "type": "服务反馈", "score": 4, "content": "论坛馆路线提示清晰，期待增加停车指引。", "traceId": "trace-feedback-2027-002", "status": "handled", "createdAt": now}),
        ])
        for kind, record_id, exhibition_id, data in records:
            conn.execute("INSERT OR IGNORE INTO admin_records(kind,id,exhibition_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)", (kind, record_id, exhibition_id, json.dumps(data, ensure_ascii=False), now, now))
        # Older local seeds used ``resolved`` for feedback. Normalize it at
        # startup so existing Admin SQLite files remain compatible with the
        # frontend contract (pending | handled) without losing any rows.
        for row in conn.execute("SELECT id, data_json FROM admin_records WHERE kind='feedback'").fetchall():
            feedback = json.loads(row[1])
            if feedback.get("status") == "resolved":
                feedback["status"] = "handled"
                conn.execute("UPDATE admin_records SET data_json=?, updated_at=? WHERE kind='feedback' AND id=?", (json.dumps(feedback, ensure_ascii=False), now, row[0]))
        conn.execute("INSERT OR IGNORE INTO admin_record_links(owner_kind,owner_id,link_kind,link_id) VALUES ('interaction_shopping','shopping-001','exhibits','exhibit-001')")
        for strategy_id, exhibit_id in (("shopping-001", "exhibit-002"), ("shopping-2027", "exhibit-2027-001"), ("shopping-2027", "exhibit-2027-002")):
            conn.execute("INSERT OR IGNORE INTO admin_record_links(owner_kind,owner_id,link_kind,link_id) VALUES (?,?,?,?)", ("interaction_shopping", strategy_id, "exhibits", exhibit_id))
        audit_rows = [
            ("audit-seed-001", "trace-seed-001", "user-admin", "admin", "GET", "/api/v1/admin/event/exhibitions", "list", "exhibitions", "expo-2026", "127.0.0.1", "Chrome 150", 200, 18, None, None),
            ("audit-seed-002", "trace-seed-002", "user-admin", "admin", "POST", "/api/v1/admin/lead/lead-1001/status", "status", "leads", "lead-1001", "127.0.0.1", "Chrome 150", 200, 42, json.dumps({"status": "new"}, ensure_ascii=False), json.dumps({"status": "contacted"}, ensure_ascii=False)),
            ("audit-seed-003", "trace-seed-003", "user-content", "content.operator", "POST", "/api/v1/admin/interaction/shopping-strategies/shopping-001/exhibits", "save_links", "interaction_shopping", "shopping-001", "127.0.0.1", "Chrome 150", 200, 27, json.dumps({"exhibit_ids": ["exhibit-001"]}), json.dumps({"exhibit_ids": ["exhibit-001", "exhibit-002"]})),
        ]
        conn.executemany("INSERT OR IGNORE INTO admin_audit_logs(id,trace_id,user_id,username,method,path,action,resource_type,resource_id,ip,user_agent,status_code,duration_ms,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [(*row, now) for row in audit_rows])

    def list_records(self, kind: str, *, exhibition_id: str | None = None, keyword: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT data_json FROM admin_records WHERE kind=?"
        params: list[Any] = [kind]
        if exhibition_id and exhibition_id != "all":
            query += " AND id=?" if kind == "exhibitions" else " AND exhibition_id=?"
            params.append(exhibition_id)
        with self.connect() as conn:
            rows = [json.loads(row[0]) for row in conn.execute(query, params)]
        needle = (keyword or "").strip().lower()
        return [item for item in rows if (not status or item.get("status") == status) and (not needle or needle in json.dumps(item, ensure_ascii=False).lower())]

    def get_record(self, kind: str, record_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT data_json FROM admin_records WHERE kind=? AND id=?", (kind, record_id)).fetchone()
        return json.loads(row[0]) if row else None

    def save_record(self, kind: str, data: dict[str, Any], exhibition_id: str | None = None) -> dict[str, Any]:
        now = utc_now()
        record_id = str(data.get("id") or f"{kind}-{uuid.uuid4().hex[:12]}")
        data = {**data, "id": record_id, "createdAt": data.get("createdAt") or now, "updatedAt": now}
        with self.connect() as conn:
            old = conn.execute("SELECT created_at FROM admin_records WHERE kind=? AND id=?", (kind, record_id)).fetchone()
            conn.execute("INSERT INTO admin_records(kind,id,exhibition_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET exhibition_id=excluded.exhibition_id,data_json=excluded.data_json,updated_at=excluded.updated_at", (kind, record_id, exhibition_id or data.get("exhibitionId"), json.dumps(data, ensure_ascii=False), data["createdAt"], now))
        return data

    def delete_record(self, kind: str, record_id: str) -> bool:
        with self.connect() as conn:
            result = conn.execute("DELETE FROM admin_records WHERE kind=? AND id=?", (kind, record_id))
            conn.execute("DELETE FROM admin_record_links WHERE owner_kind=? AND owner_id=?", (kind, record_id))
            return result.rowcount > 0

    def set_links(self, owner_kind: str, owner_id: str, link_kind: str, link_ids: list[str]) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM admin_record_links WHERE owner_kind=? AND owner_id=? AND link_kind=?", (owner_kind, owner_id, link_kind))
            conn.executemany("INSERT INTO admin_record_links(owner_kind,owner_id,link_kind,link_id) VALUES (?,?,?,?)", [(owner_kind, owner_id, link_kind, item) for item in link_ids])

    def get_links(self, owner_kind: str, owner_id: str, link_kind: str) -> list[str]:
        with self.connect() as conn:
            return [row[0] for row in conn.execute("SELECT link_id FROM admin_record_links WHERE owner_kind=? AND owner_id=? AND link_kind=? ORDER BY link_id", (owner_kind, owner_id, link_kind))]

    def user_by_username(self, username: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM admin_users WHERE username=?", (username,)).fetchone()
        return dict(row) if row else None

    def user(self, user_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM admin_users WHERE id=?", (user_id,)).fetchone()
        return dict(row) if row else None

    def roles_for_user(self, user_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT r.* FROM admin_roles r JOIN admin_user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?", (user_id,))]

    def permissions_for_user(self, user_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT DISTINCT p.* FROM admin_permissions p JOIN admin_role_permissions rp ON rp.permission_id=p.id JOIN admin_user_roles ur ON ur.role_id=rp.role_id WHERE ur.user_id=? ORDER BY p.sort_order,p.id", (user_id,))]

    def issue_token(self, user_id: str, token_type: str, expires_at: int, jti: str) -> None:
        with self.connect() as conn:
            conn.execute("INSERT INTO admin_tokens(jti,user_id,token_type,expires_at) VALUES (?,?,?,?)", (jti, user_id, token_type, expires_at))

    def revoke_token(self, jti: str) -> None:
        with self.connect() as conn:
            conn.execute("UPDATE admin_tokens SET revoked_at=? WHERE jti=?", (utc_now(), jti))

    def token_revoked(self, jti: str) -> bool:
        with self.connect() as conn:
            row = conn.execute("SELECT revoked_at FROM admin_tokens WHERE jti=?", (jti,)).fetchone()
        return bool(row and row[0])

    def audit(self, payload: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute("INSERT INTO admin_audit_logs(id,trace_id,user_id,username,method,path,action,resource_type,resource_id,ip,user_agent,status_code,duration_ms,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", tuple(payload.get(key) for key in ("id", "trace_id", "user_id", "username", "method", "path", "action", "resource_type", "resource_id", "ip", "user_agent", "status_code", "duration_ms", "before_json", "after_json", "created_at")))

    def audit_list(self, *, username: str = "", ip: str = "", keyword: str = "", from_date: str = "", to_date: str = "") -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = [dict(row) for row in conn.execute("SELECT * FROM admin_audit_logs ORDER BY created_at DESC")]
        return [row for row in rows if (not username or username.lower() in row["username"].lower()) and (not ip or ip in row["ip"]) and (not keyword or keyword.lower() in f"{row['path']} {row['action']} {row['trace_id']}".lower()) and (not from_date or row["created_at"][:10] >= from_date) and (not to_date or row["created_at"][:10] <= to_date)]
