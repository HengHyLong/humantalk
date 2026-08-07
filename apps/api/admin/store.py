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
            ("menu-llm", "menu-system", "system:llm", "大模型配置", "menu", "/system/llm"),
            ("button-llm-write", "menu-llm", "system:llm:write", "维护大模型配置", "button", ""),
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
                    if (
                        code in codes
                        or permission_id in all_permissions and role_code == "sys_admin"
                        or permission_id in all_permissions and role_code == "readonly" and not code.endswith(":write")
                    ):
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
