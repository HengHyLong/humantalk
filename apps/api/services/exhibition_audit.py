"""Read-only audit of exhibition matching and navigation configuration."""
from __future__ import annotations

from apps.api.services.exhibition_lookup import published, term_fields, normalize
from apps.api.services.exhibition_matching import route_issues


def audit_configuration(store, exhibition_id: str, config: dict | None = None) -> list[dict]:
    issues = []
    points = {str(p["id"]): p for p in store.list_records("points", exhibition_id=exhibition_id)}
    config = config if config is not None else store.get_record("runtime_configs", exhibition_id) or {}
    terminal = str(config.get("terminalPointId") or "")
    if not terminal or terminal not in points or not published(points.get(terminal, {})):
        issues.append({"code": "terminal_point_invalid" if terminal else "terminal_point_missing", "severity": "error" if terminal else "warning", "id": exhibition_id,
                       "message": "请配置属于本展会且可用的终端起点，否则导航需要用户提供起点。"})
    terms = {}
    for kind in ("exhibitors", "exhibits", "points", "venues", "routes"):
        for record in store.list_records(kind, exhibition_id=exhibition_id):
            if not published(record):
                continue
            rid = str(record["id"])
            if kind == "routes":
                if record.get("status") == "draft":
                    issues.append({"code": "route_draft_visible", "severity": "info", "id": rid,
                                   "message": "草稿路线按原公开规则仍可用；上线前请核对并发布。"})
                for code in route_issues(record, points):
                    issues.append({"code": code, "severity": "error", "id": rid, "name": record.get("name"),
                                   "message": "路线名称、播报终点或点位配置不一致；修复前不提供导航。"})
            elif kind == "points" and not (record.get("exhibitorId") or record.get("exhibitId")):
                issues.append({"code": "point_entity_unlinked", "severity": "warning", "id": rid,
                               "message": "该点位未关联展商或展品，按企业或产品名称无法定位该点位。"})
            if kind != "routes" and not (record.get("spokenText") or record.get("description")):
                issues.append({"code": "introduction_missing", "severity": "warning", "id": rid,
                               "message": "未配置介绍或播报文案，介绍问题将交给 Dify 并限制无依据的补充。"})
            for field, value in term_fields(record):
                terms.setdefault(normalize(value), {})[rid] = {"id": rid, "field": field, "value": value}
            if "![" in str(record.get("description", "")):
                issues.append({"code": "speech_image_markup", "severity": "info", "id": rid,
                               "message": "简介含图片标记；播报已自动清理，原图和原始内容保留。"})
    for term, owners in terms.items():
        if len(owners) > 1:
            issues.append({"code": "duplicate_match_term", "severity": "warning", "term": term,
                           "records": list(owners.values()), "message": "关键词对应多个对象，回答需要澄清或多实体处理。"})
    return issues
