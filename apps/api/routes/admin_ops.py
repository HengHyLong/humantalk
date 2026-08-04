from __future__ import annotations

import io
import csv
import platform
import secrets
import socket
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from apps.api.routes.admin_auth import (
    authorize_admin_request,
    current_admin_user,
    issue_admin_token,
    revoke_admin_token,
    verify_admin_credentials,
)
from apps.api.routes.admin_assets import AdminContentStore
from apps.api.routes.health import _runtime_status_payload
from opentalking.core.queue_status import get_flashtalk_queue_status

try:
    import psutil
except ImportError:  # pragma: no cover - optional fallback for minimal deployments
    psutil = None  # type: ignore[assignment]


router = APIRouter(
    prefix="/admin",
    tags=["admin-ops"],
    dependencies=[Depends(authorize_admin_request)],
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _admin_store(request: Request) -> AdminContentStore:
    settings = getattr(request.app.state, "settings", None)
    from pathlib import Path

    return AdminContentStore(Path(getattr(settings, "admin_data_dir", "./data/admin")))


def _metrics_snapshot() -> dict[str, float]:
    if psutil is None:
        return {"cpu": 0.0, "memory": 0.0, "swap": 0.0, "disk": 0.0}
    try:
        memory = psutil.virtual_memory()
        swap = psutil.swap_memory()
        disk = psutil.disk_usage("/")
        return {
            "cpu": float(psutil.cpu_percent(interval=None)),
            "memory": float(memory.percent),
            "swap": float(swap.percent),
            "disk": float(disk.percent),
        }
    except (OSError, RuntimeError, ValueError):
        return {"cpu": 0.0, "memory": 0.0, "swap": 0.0, "disk": 0.0}


def _history(request: Request, metrics: dict[str, float]) -> tuple[list[float], list[float]]:
    history = getattr(request.app.state, "admin_monitor_history", None)
    if history is None:
        history = {"cpu": [], "memory": []}
        request.app.state.admin_monitor_history = history
    history["cpu"] = [*history["cpu"], round(metrics["cpu"], 2)][-12:]
    history["memory"] = [*history["memory"], round(metrics["memory"], 2)][-12:]
    return history["cpu"], history["memory"]


async def _monitor(request: Request) -> dict[str, Any]:
    runtime = _runtime_status_payload(request)
    try:
        queue = await get_flashtalk_queue_status(request.app.state.redis)
        queue_error = ""
    except Exception as exc:  # pragma: no cover - depends on external Redis failure
        queue = {"slot_occupied": False, "queue_size": 0}
        queue_error = str(exc)
    request.app.state.admin_queue_snapshot = queue
    metrics = _metrics_snapshot()
    cpu_history, memory_history = _history(request, metrics)
    refreshed = _now()
    services: list[dict[str, Any]] = [
        {
            "id": "svc-api",
            "name": "OpenTalking API",
            "status": "ok",
            "latencyMs": 0,
            "checkedAt": refreshed,
            "description": "Admin API 与实时会话接口",
        },
        {
            "id": "svc-redis",
            "name": "Redis 队列",
            "status": "error" if queue_error else "warn" if queue.get("queue_size", 0) else "ok",
            "latencyMs": 0,
            "checkedAt": refreshed,
            "description": queue_error or f"队列 {queue.get('queue_size', 0)}，占槽 {bool(queue.get('slot_occupied'))}",
        },
    ]
    for key, label in (("stt_provider", "STT"), ("tts_provider", "TTS")):
        provider = str(runtime.get(key) or "unknown")
        provider_status = runtime.get(f"{key[:-9]}_providers", {}).get(provider, {}) if key.endswith("_provider") else {}
        configured = bool(provider_status.get("configured", provider_status.get("key_set", True)))
        services.append(
            {
                "id": f"svc-{label.lower()}",
                "name": label,
                "status": "ok" if configured else "warn",
                "latencyMs": 0,
                "checkedAt": refreshed,
                "description": f"{provider} · {'已配置' if configured else '未配置'}",
            }
        )
    return {
        "os": platform.platform(),
        "ip": socket.gethostbyname(socket.gethostname()),
        "uptime": _uptime(request),
        "refreshedAt": refreshed,
        "cpuPercent": metrics["cpu"],
        "memoryPercent": metrics["memory"],
        "swapPercent": metrics["swap"],
        "diskPercent": metrics["disk"],
        "cpuHistory": cpu_history,
        "memoryHistory": memory_history,
        "services": services,
        "terminals": [],
        "runtime": runtime,
        "queue": queue,
    }


def _uptime(request: Request) -> str:
    started = getattr(request.app.state, "admin_started_at", None)
    if started is None:
        started = time.monotonic()
        request.app.state.admin_started_at = started
    total_seconds = max(0, int(time.monotonic() - started))
    days, remainder = divmod(total_seconds, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{days}d {hours:02d}:{minutes:02d}:{seconds:02d}"


def _alerts(request: Request, monitor: dict[str, Any]) -> list[dict[str, Any]]:
    store = _admin_store(request)
    persisted = {str(item.get("id")): item for item in store.list_collection("alerts")}
    generated: list[dict[str, Any]] = []
    queue = monitor.get("queue", {})
    if queue.get("queue_size", 0):
        generated.append({"id": "alert-queue", "type": "会话排队", "severity": "normal", "target": "Redis 队列", "content": f"当前有 {queue['queue_size']} 个会话等待运行时槽位", "status": "active", "occurredAt": _now()})
    for service in monitor.get("services", []):
        if service.get("status") in {"warn", "error"}:
            generated.append({"id": f"alert-{service['id']}", "type": "服务状态", "severity": "high" if service["status"] == "error" else "normal", "target": service["name"], "content": service["description"], "status": "active", "occurredAt": service["checkedAt"]})
    merged: list[dict[str, Any]] = []
    for item in [*generated, *persisted.values()]:
        existing = persisted.get(str(item.get("id")))
        merged.append({**item, **existing} if existing else item)
    deduped = {str(item.get("id")): item for item in merged}
    result = list(deduped.values())
    store.write_collection("alerts", result)
    return result


def _report_events(
    request: Request,
    *,
    exhibition_id: str | None = None,
    scene: str | None = None,
    terminal_id: str | None = None,
    from_value: str | None = None,
    to_value: str | None = None,
) -> list[dict[str, Any]]:
    items = _admin_store(request).list_collection("report_events")
    result: list[dict[str, Any]] = []
    for item in items:
        if exhibition_id and exhibition_id != "all" and str(item.get("exhibitionId") or "") != exhibition_id:
            continue
        if scene and str(item.get("scene") or "") != scene:
            continue
        if terminal_id and str(item.get("terminalId") or "") != terminal_id:
            continue
        created_at = str(item.get("createdAt") or "")
        if from_value and created_at < from_value:
            continue
        if to_value and created_at > to_value:
            continue
        result.append(item)
    return result


def _duration(item: dict[str, Any]) -> float:
    try:
        value = float(item.get("durationMs", 0))
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, value)


def _bucket(items: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        key = str(item.get(field) or "unknown")
        grouped.setdefault(key, []).append(item)
    return [
        {"key": key, "count": len(group), "averageDurationMs": round(sum(_duration(item) for item in group) / len(group), 2)}
        for key, group in sorted(grouped.items(), key=lambda pair: (-len(pair[1]), pair[0]))
    ]


def _interaction_report(items: list[dict[str, Any]]) -> dict[str, Any]:
    total_duration = sum(_duration(item) for item in items)
    return {
        "total": len(items),
        "averageDurationMs": round(total_duration / len(items), 2) if items else 0,
        "byScene": _bucket(items, "scene"),
        "byTerminal": _bucket(items, "terminalId"),
        "byHour": _bucket(items, "hour"),
    }


def _hotspot_report(items: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, int] = {}
    for item in items:
        question = str(item.get("question") or item.get("exhibit") or item.get("exhibitor") or "unknown")
        if question == "unknown":
            continue
        grouped[question] = grouped.get(question, 0) + 1
    return {"items": [{"key": key, "count": count} for key, count in sorted(grouped.items(), key=lambda pair: (-pair[1], pair[0]))[:20]]}


def _hit_report(items: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(items)
    hits = [item for item in items if item.get("hit") is True or item.get("outcome") in {"hit", "answered"}]
    strong_qa = [item for item in items if item.get("strongQaHit") is True]
    rag = [item for item in items if item.get("ragHit") is True]
    return {
        "total": total,
        "hit": len(hits),
        "miss": max(0, total - len(hits)),
        "hitRate": round(len(hits) / total, 4) if total else 0,
        "strongQaHit": len(strong_qa),
        "ragHit": len(rag),
    }


def _lead_report(items: list[dict[str, Any]]) -> dict[str, Any]:
    leads = [item for item in items if item.get("eventType") == "lead" or item.get("leadStatus")]
    grouped: dict[str, int] = {}
    for item in leads:
        status = str(item.get("leadStatus") or item.get("status") or "new")
        grouped[status] = grouped.get(status, 0) + 1
    converted = grouped.get("converted", 0)
    return {"total": len(leads), "converted": converted, "conversionRate": round(converted / len(leads), 4) if leads else 0, "byStatus": [{"key": key, "count": value} for key, value in sorted(grouped.items())]}


def _resource_report(items: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        key = f"{item.get('provider') or 'unknown'}/{item.get('model') or 'unknown'}"
        grouped.setdefault(key, []).append(item)
    return {"items": [{"key": key, "count": len(group), "totalDurationMs": round(sum(_duration(item) for item in group), 2), "averageDurationMs": round(sum(_duration(item) for item in group) / len(group), 2)} for key, group in sorted(grouped.items(), key=lambda pair: (-len(pair[1]), pair[0]))]}


@router.post("/auth/login", response_model=None)
async def login(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    username, _password, role = verify_admin_credentials(request, payload)
    token, expires_at, user = issue_admin_token(request, username, role)
    return {"token": token, "expires_at": expires_at, "user": user}


@router.get("/auth/me", response_model=None)
async def me(request: Request) -> dict[str, Any]:
    return current_admin_user(request)


@router.post("/auth/logout", response_model=None)
async def logout(request: Request) -> dict[str, bool]:
    revoke_admin_token(request)
    return {"ok": True}


@router.get("/health", response_model=None)
async def admin_health(request: Request) -> dict[str, Any]:
    return _runtime_status_payload(request)


@router.get("/runtime/status", response_model=None)
async def admin_runtime_status(request: Request) -> dict[str, Any]:
    return _runtime_status_payload(request)


@router.get("/queue/status", response_model=None)
async def admin_queue_status(request: Request) -> dict[str, Any]:
    try:
        return await get_flashtalk_queue_status(request.app.state.redis)
    except Exception:
        return {"slot_occupied": False, "queue_size": 0, "status": "unavailable"}


@router.get("/ops/monitor", response_model=None)
async def admin_monitor(request: Request) -> dict[str, Any]:
    return await _monitor(request)


@router.get("/alerts", response_model=None)
async def list_alerts(request: Request) -> list[dict[str, Any]]:
    return _alerts(request, await _monitor(request))


@router.post("/alerts/{alert_id}/acknowledge", response_model=None)
async def acknowledge_alert(alert_id: str, request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    monitor = await _monitor(request)
    alerts = _alerts(request, monitor)
    item = next((entry for entry in alerts if entry.get("id") == alert_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="alert not found")
    saved = {**item, "status": "acknowledged", "acknowledgedBy": str((payload or {}).get("operator") or "current-user"), "acknowledgedAt": _now()}
    store = _admin_store(request)
    store.save_item("alerts", saved)
    return saved


@router.get("/report", response_model=None)
async def admin_report(request: Request) -> dict[str, Any]:
    monitor = await _monitor(request)
    queue = monitor["queue"]
    runtime = monitor["runtime"]
    healthy_services = sum(item.get("status") == "ok" for item in monitor["services"])
    return {
        "metrics": [
            {"id": "runtime", "label": "运行时服务", "value": f"{healthy_services}/{len(monitor['services'])}", "trend": "来自实时健康检查", "tone": "green" if healthy_services == len(monitor["services"]) else "amber"},
            {"id": "queue", "label": "会话队列", "value": str(queue.get("queue_size", 0)), "trend": "Redis 实时队列", "tone": "cyan"},
            {"id": "tts", "label": "TTS Provider", "value": str(runtime.get("tts_provider") or "未配置"), "trend": "当前运行时配置", "tone": "violet"},
            {"id": "stt", "label": "STT Provider", "value": str(runtime.get("stt_provider") or "未配置"), "trend": "当前运行时配置", "tone": "cyan"},
            {"id": "host", "label": "主机内存", "value": f"{monitor['memoryPercent']:.1f}%", "trend": "psutil 实时采集", "tone": "amber"},
        ],
        "todos": [
            {"id": "todo-queue", "type": "运行时队列", "title": f"{queue.get('queue_size', 0)} 个会话排队", "owner": "运行时", "time": monitor["refreshedAt"], "path": "/system/ops"}
        ] if queue.get("queue_size", 0) else [],
    }


@router.post("/report/events", response_model=None)
async def ingest_report_event(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="report event must be an object")
    item = dict(payload)
    item["id"] = str(item.get("id") or f"event-{secrets.token_hex(8)}")
    item["eventType"] = str(item.get("eventType") or "interaction")
    item["createdAt"] = str(item.get("createdAt") or _now())
    item.setdefault("hour", item["createdAt"][:13])
    store = _admin_store(request)
    events = [item, *store.list_collection("report_events")]
    store.write_collection("report_events", events[:10000])
    return {"accepted": True, "id": item["id"], "createdAt": item["createdAt"]}


def _report_filter_args(
    exhibition_id: str | None,
    scene: str | None,
    terminal_id: str | None,
    from_value: str | None,
    to_value: str | None,
) -> dict[str, str | None]:
    return {"exhibition_id": exhibition_id, "scene": scene, "terminal_id": terminal_id, "from_value": from_value, "to_value": to_value}


@router.get("/report/interaction", response_model=None)
async def report_interaction(
    request: Request,
    exhibition_id: str | None = Query(default=None),
    scene: str | None = Query(default=None),
    terminal_id: str | None = Query(default=None),
    from_value: str | None = Query(default=None, alias="from"),
    to_value: str | None = Query(default=None, alias="to"),
) -> dict[str, Any]:
    items = _report_events(request, **_report_filter_args(exhibition_id, scene, terminal_id, from_value, to_value))
    return {"filters": _report_filter_args(exhibition_id, scene, terminal_id, from_value, to_value), **_interaction_report(items)}


@router.get("/report/hotspot", response_model=None)
async def report_hotspot(
    request: Request,
    exhibition_id: str | None = Query(default=None),
    scene: str | None = Query(default=None),
    terminal_id: str | None = Query(default=None),
    from_value: str | None = Query(default=None, alias="from"),
    to_value: str | None = Query(default=None, alias="to"),
) -> dict[str, Any]:
    items = _report_events(request, **_report_filter_args(exhibition_id, scene, terminal_id, from_value, to_value))
    return _hotspot_report(items)


@router.get("/report/hit", response_model=None)
async def report_hit(
    request: Request,
    exhibition_id: str | None = Query(default=None),
    scene: str | None = Query(default=None),
    terminal_id: str | None = Query(default=None),
    from_value: str | None = Query(default=None, alias="from"),
    to_value: str | None = Query(default=None, alias="to"),
) -> dict[str, Any]:
    items = _report_events(request, **_report_filter_args(exhibition_id, scene, terminal_id, from_value, to_value))
    return _hit_report(items)


@router.get("/report/lead", response_model=None)
async def report_lead(
    request: Request,
    exhibition_id: str | None = Query(default=None),
    scene: str | None = Query(default=None),
    terminal_id: str | None = Query(default=None),
    from_value: str | None = Query(default=None, alias="from"),
    to_value: str | None = Query(default=None, alias="to"),
) -> dict[str, Any]:
    items = _report_events(request, **_report_filter_args(exhibition_id, scene, terminal_id, from_value, to_value))
    return _lead_report(items)


@router.get("/report/resource", response_model=None)
async def report_resource(
    request: Request,
    exhibition_id: str | None = Query(default=None),
    scene: str | None = Query(default=None),
    terminal_id: str | None = Query(default=None),
    from_value: str | None = Query(default=None, alias="from"),
    to_value: str | None = Query(default=None, alias="to"),
) -> dict[str, Any]:
    items = _report_events(request, **_report_filter_args(exhibition_id, scene, terminal_id, from_value, to_value))
    return _resource_report(items)


@router.get("/report/operations", response_model=None)
async def report_operations(
    request: Request,
    exhibition_id: str | None = Query(default=None),
    scene: str | None = Query(default=None),
    terminal_id: str | None = Query(default=None),
    from_value: str | None = Query(default=None, alias="from"),
    to_value: str | None = Query(default=None, alias="to"),
) -> dict[str, Any]:
    items = _report_events(request, **_report_filter_args(exhibition_id, scene, terminal_id, from_value, to_value))
    return {
        "generatedAt": _now(),
        "filters": _report_filter_args(exhibition_id, scene, terminal_id, from_value, to_value),
        "interaction": _interaction_report(items),
        "hotspot": _hotspot_report(items),
        "hit": _hit_report(items),
        "lead": _lead_report(items),
        "resource": _resource_report(items),
    }


@router.get("/report/export", response_class=PlainTextResponse)
async def export_report(
    request: Request,
    format_value: str = Query(default="csv", alias="format"),
    exhibition_id: str | None = Query(default=None),
    scene: str | None = Query(default=None),
    terminal_id: str | None = Query(default=None),
    from_value: str | None = Query(default=None, alias="from"),
    to_value: str | None = Query(default=None, alias="to"),
) -> PlainTextResponse:
    del format_value
    items = _report_events(request, **_report_filter_args(exhibition_id, scene, terminal_id, from_value, to_value))
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["id", "eventType", "exhibitionId", "terminalId", "scene", "question", "outcome", "durationMs", "createdAt"])
    writer.writeheader()
    for item in items:
        writer.writerow({field: item.get(field, "") for field in writer.fieldnames})
    return PlainTextResponse(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=interaction-report.csv"})
