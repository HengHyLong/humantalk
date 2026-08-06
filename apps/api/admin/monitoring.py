from __future__ import annotations

import os
import platform
import socket
import time
from pathlib import Path
from typing import Any

import psutil
from fastapi import Request

from .store import AdminStore, utc_now


def _percent(value: float) -> float:
    return round(float(value), 2)


def _duration(seconds: float) -> str:
    total = max(0, int(seconds))
    days, total = divmod(total, 86400)
    hours, total = divmod(total, 3600)
    minutes, _ = divmod(total, 60)
    if days:
        return f"{days}天{hours}小时"
    if hours:
        return f"{hours}小时{minutes}分钟"
    return f"{minutes}分钟"


def _local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return str(sock.getsockname()[0])
    except OSError:
        return "127.0.0.1"


def _path_service(service_id: str, name: str, path: str, description: str) -> dict[str, Any]:
    target = Path(path).expanduser()
    exists = target.exists()
    return {
        "id": service_id,
        "name": name,
        "status": "ok" if exists else "error",
        "latencyMs": 0,
        "checkedAt": utc_now(),
        "description": f"{description}：{target}",
        "configuredPath": str(target),
    }


def _provider_service(service_id: str, name: str, provider: str, config: dict[str, Any]) -> dict[str, Any]:
    key_set = bool(config.get("key_set"))
    service_url_set = bool(config.get("service_url_set"))
    local_provider = provider in {"edge", "local_cosyvoice", "indextts", "local_f5_tts", "sensevoice"}
    ready = local_provider or key_set or service_url_set
    status = "ok" if ready else "warn"
    return {
        "id": service_id,
        "name": name,
        "status": status,
        "latencyMs": 0,
        "checkedAt": utc_now(),
        "description": f"provider={provider} model={config.get('model', '') or '-'} key_set={key_set} service_url_set={service_url_set}",
        "provider": provider,
        "model": config.get("model", ""),
        "keySet": key_set,
        "serviceUrlSet": service_url_set,
    }


def _runtime_alert(service: dict[str, Any]) -> dict[str, Any] | None:
    if service.get("status") not in {"warn", "error"}:
        return None
    severity = "high" if service["status"] == "error" else "normal"
    return {
        "id": f"runtime-{service['id']}",
        "type": "service",
        "severity": severity,
        "target": service["name"],
        "object": service["name"],
        "content": service["description"],
        "status": "active",
        "createdAt": service["checkedAt"],
        "source": "runtime-monitor",
    }


def _sync_runtime_alerts(store: AdminStore, live_alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    live_by_id = {str(item["id"]): item for item in live_alerts}
    existing_runtime = [item for item in store.list_records("alerts") if str(item.get("id", "")).startswith("runtime-")]
    for item in existing_runtime:
        if item["id"] not in live_by_id and item.get("status") == "active":
            store.save_record("alerts", {**item, "status": "resolved", "resolvedAt": utc_now()})
    for item in live_alerts:
        existing = store.get_record("alerts", str(item["id"]))
        if existing and existing.get("status") in {"acknowledged", "resolved"}:
            continue
        store.save_record("alerts", {**item, "createdAt": (existing or {}).get("createdAt") or item["createdAt"]})
    return store.list_records("alerts")


def collect_runtime_monitor(request: Request, store: AdminStore) -> dict[str, Any]:
    settings = request.app.state.settings
    process = psutil.Process(os.getpid())
    cpu = _percent(psutil.cpu_percent(interval=0.05))
    memory = _percent(psutil.virtual_memory().percent)
    try:
        swap = _percent(psutil.swap_memory().percent)
    except (OSError, PermissionError):
        swap = 0.0
    db_path = Path(str(settings.admin_sqlite_path)).expanduser()
    try:
        disk = psutil.disk_usage(str(db_path.parent if db_path.parent.exists() else Path.cwd()))
        disk_percent = _percent(disk.percent)
    except OSError:
        disk_percent = 0.0

    try:
        with store.connect() as conn:
            conn.execute("SELECT 1").fetchone()
        db_status = "ok"
        db_description = f"SQLite 可读写：{db_path}"
    except Exception as exc:  # noqa: BLE001
        db_status = "error"
        db_description = f"SQLite 不可用：{exc.__class__.__name__}"

    from opentalking.providers.stt.factory import stt_provider_config, stt_status
    from opentalking.providers.tts.factory import tts_provider_config, tts_status

    stt = stt_status()
    stt_provider = str(stt.get("provider", ""))
    tts = tts_status()
    tts_provider = str(tts.get("provider", ""))
    services = [
        {
            "id": "service-api",
            "name": "Unified API",
            "status": "ok",
            "latencyMs": 0,
            "checkedAt": utc_now(),
            "description": f"当前进程 {request.url.hostname}:{request.url.port or getattr(settings, 'api_port', 8000)}",
            "pid": process.pid,
        },
        {
            "id": "service-admin-db",
            "name": "Admin SQLite",
            "status": db_status,
            "latencyMs": 0,
            "checkedAt": utc_now(),
            "description": db_description,
            "configuredPath": str(db_path),
        },
        _provider_service("service-llm", "LLM", str(getattr(settings, "llm_provider", "")), {"model": getattr(settings, "llm_model", ""), "key_set": bool(getattr(settings, "llm_api_key", "")), "service_url_set": bool(getattr(settings, "llm_base_url", ""))}),
        _provider_service("service-tts", "TTS", tts_provider, tts_provider_config(tts_provider)),
        _provider_service("service-stt", "STT", stt_provider, stt_provider_config(stt_provider)),
        _path_service("service-knowledge", "Agent Knowledge", str(getattr(settings, "agent_knowledge_root", "")), "知识库目录"),
        _path_service("service-admin-media", "Admin Media", str(getattr(settings, "admin_media_root", "")), "管理端媒体目录"),
    ]
    sample_at = utc_now()
    history = getattr(request.app.state, "admin_monitor_history", None)
    if history is None:
        history = {"cpu": [], "memory": []}
        request.app.state.admin_monitor_history = history
    # Keep enough points for a 24-hour window. The UI filters these points by
    # their actual collection time instead of treating them as fixed slots.
    history["cpu"] = [*history["cpu"], {"at": sample_at, "value": cpu}][-288:]
    history["memory"] = [*history["memory"], {"at": sample_at, "value": memory}][-288:]

    alerts: list[dict[str, Any]] = []
    alerts.extend(item for service in services if (item := _runtime_alert(service)) is not None)
    if cpu >= 85:
        alerts.append({"id": "runtime-host-cpu", "type": "resource", "severity": "high", "target": "CPU", "content": f"CPU 使用率 {cpu}%", "status": "active", "createdAt": utc_now(), "source": "runtime-monitor"})
    if memory >= 85:
        alerts.append({"id": "runtime-host-memory", "type": "resource", "severity": "high", "target": "内存", "content": f"内存使用率 {memory}%", "status": "active", "createdAt": utc_now(), "source": "runtime-monitor"})
    if disk_percent >= 85:
        alerts.append({"id": "runtime-host-disk", "type": "resource", "severity": "high", "target": "磁盘", "content": f"磁盘使用率 {disk_percent}%", "status": "active", "createdAt": utc_now(), "source": "runtime-monitor"})

    try:
        uptime = _duration(time.time() - psutil.boot_time())
    except (OSError, PermissionError):
        uptime = "unknown"
    return {
        "os": platform.platform(),
        "ip": _local_ip(),
        "pid": process.pid,
        "uptime": uptime,
        "refreshedAt": utc_now(),
        "cpuPercent": cpu,
        "memoryPercent": memory,
        "swapPercent": swap,
        "diskPercent": disk_percent,
        "cpuHistory": history["cpu"],
        "memoryHistory": history["memory"],
        "services": services,
        "terminals": store.list_records("terminals"),
        "alerts": _sync_runtime_alerts(store, alerts),
        "configuration": {
            "apiHost": getattr(settings, "api_host", ""),
            "apiPort": getattr(settings, "api_port", 0),
            "defaultModel": getattr(settings, "default_model", ""),
            "ttsProvider": tts_provider,
            "sttProvider": stt_provider,
            "llmProvider": getattr(settings, "llm_provider", ""),
            "adminDatabase": str(db_path),
            "knowledgeRoot": str(getattr(settings, "agent_knowledge_root", "")),
            "mediaRoot": str(getattr(settings, "admin_media_root", "")),
        },
    }
