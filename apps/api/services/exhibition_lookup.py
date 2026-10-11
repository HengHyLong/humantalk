"""Deterministic, exhibition-scoped lookup of available business facts."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

from apps.api.services.dify_chat import spoken_answer


def normalize(value: Any) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]", "", str(value or "").lower())


def values(value: Any) -> list[str]:
    return [str(v) for v in value] if isinstance(value, list) else [str(value)] if value else []


def published(record: dict[str, Any]) -> bool:
    # Public entity/navigation APIs already expose draft records. Preserve that
    # availability rather than introducing a new publication gate in v2.6.
    return record.get("status") not in {"inactive", "offline", "deleted", "cancelled"}


def terms(record: dict[str, Any]) -> list[str]:
    result = [record.get("name"), record.get("boothCode"), record.get("modelNo"), record.get("code")]
    for key in ("aliases", "keywords", "introductionKeywords", "introduction_keywords"):
        result.extend(values(record.get(key)))
    return list(dict.fromkeys(normalize(term) for term in result if len(normalize(term)) >= 2))


def rank(query: str, record: dict[str, Any], extra: list[str] | None = None) -> tuple[float, int]:
    candidates = terms(record) + [normalize(v) for v in (extra or []) if len(normalize(v)) >= 2]
    exact = [v for v in candidates if v in query]
    if exact:
        return 1.0, max(map(len, exact))
    if record.get("fuzzyMatch", record.get("fuzzy_match", True)) is False:
        return 0.0, 0
    # Avoid matching a single generic Chinese character against an entire query.
    needle = re.sub(r"请问|请|介绍一下|介绍|在哪里|在哪|怎么走|如何到|怎么去|告诉我|的展位|展位|展商|展品|了解一下|了解|是什么|什么|在哪儿", "", query)
    best = max((SequenceMatcher(None, needle, v).ratio() for v in candidates if len(v) >= 3), default=0.0)
    return (best, 0) if best >= 0.78 else (0.0, 0)


def fact(record: dict[str, Any], kind: str) -> dict[str, Any]:
    # Whitelist public facts: never send contacts, phone numbers or survey tokens.
    mapping = {"id": "id", "name": "name", "boothCode": "booth_code", "modelNo": "model_no",
               "category": "category", "exhibitorId": "exhibitor_id", "address": "address",
               "floor": "floor", "code": "code", "startDate": "start_date", "endDate": "end_date"}
    result = {target: record[source] for source, target in mapping.items() if record.get(source) not in (None, "")}
    result["type"] = kind
    for source, target in (("description", "description"), ("spokenText", "spoken_text")):
        if record.get(source):
            result[target] = spoken_answer(str(record[source]))[:4000]
    return result


@dataclass
class LookupResult:
    status: str = "not_found"
    intent: str = "content"
    items: list[dict[str, Any]] = field(default_factory=list)
    entity_ids: list[str] = field(default_factory=list)
    route: dict[str, Any] | None = None
    total: int = 0
    exact_hit: bool = False

    def context(self) -> dict[str, Any]:
        return {"intent": self.intent, "items": self.items, "total_matches": self.total}


def lookup(store: Any, exhibition_id: str, question: str, *, selected_entity_id: str | None = None,
           previous_ids: list[str] | None = None, top_k: int = 5) -> LookupResult:
    top_k = max(1, min(top_k, 8))
    query = normalize(question)
    raw = {kind: [r for r in store.list_records(kind, exhibition_id=exhibition_id) if published(r)]
           for kind in ("exhibitors", "exhibits", "points", "venues", "routes")}
    exhibitors = {str(r["id"]): r for r in raw["exhibitors"]}
    points = {str(r["id"]): r for r in raw["points"]}
    content = [(kind.rstrip("s"), r) for kind in ("exhibitors", "exhibits", "venues", "points") for r in raw[kind]]
    by_id = {str(r["id"]): (kind, r) for kind, r in content}
    route_intent = bool(re.search(r"怎么走|怎么去|如何到|路线|导航|带我去|前往|去.+展位|how.*(?:get|go)|directions|route to", question, re.I))
    route_intent = route_intent or any(
        term in query for route in raw["routes"] for term in terms(route)
        if route.get("type", "navigation") in {"navigation", "tour"})
    selected = by_id.get(selected_entity_id or "")
    if selected_entity_id and not selected:
        # Explicit card selection must belong to this exhibition and be visible.
        raise ValueError("entity not found in exhibition")
    followup = bool(re.search(r"^(它|他|她|这[个件家]|那[个件家]|上述|刚才)|^(where is it|tell me more|its |their )", question, re.I))
    if not selected and previous_ids:
        ordinal = re.search(r"第([一二三四五六七八1-8])个", question)
        if ordinal:
            index = "一二三四五六七八".find(ordinal[1]) if not ordinal[1].isdigit() else int(ordinal[1]) - 1
            if 0 <= index < len(previous_ids):
                selected = by_id.get(previous_ids[index])
        elif followup and len(previous_ids) == 1:
            selected = by_id.get(previous_ids[0])
    ranked = sorted([(rank(query, r), kind, r) for kind, r in content], key=lambda item: item[0], reverse=True)
    ranked = [item for item in ranked if item[0][0] > 0]
    if selected:
        candidates = [selected]
    elif ranked:
        best = ranked[0][0]
        candidates = [(kind, r) for score, kind, r in ranked if score == best or (best[0] < 1 and score[0] >= best[0] - 0.03)]
        # A point associated with a named exhibitor is supporting location data.
        non_points = [(kind, r) for kind, r in candidates if kind != "point"]
        if non_points:
            candidates = non_points
    else:
        candidates = []
    listing = bool(re.search(r"有哪些|有什么|列出|list|which exhibitors|what exhibitors|what exhibits", question, re.I))
    if not candidates and listing:
        kind = "exhibitor" if "展商" in question or "exhibitor" in question.lower() else "exhibit" if "展品" in question or "exhibit" in question.lower() else "venue" if "场馆" in question else ""
        candidates = [(k, r) for k, r in content if k == kind]
    result = LookupResult(intent="route" if route_intent else "content", total=len(candidates),
                          exact_hit=bool(selected or (ranked and ranked[0][0][0] == 1)))
    candidates = candidates[:top_k]
    result.entity_ids = [str(r["id"]) for _, r in candidates]
    for kind, record in candidates:
        item = fact(record, kind)
        if kind == "exhibit":
            parent = exhibitors.get(str(record.get("exhibitorId") or ""))
            if parent:
                item["exhibitor"] = fact(parent, "exhibitor")
        if kind == "exhibitor" and re.search(r"展品|产品|products|exhibits", question, re.I):
            item["exhibits"] = [fact(e, "exhibit") for e in raw["exhibits"] if str(e.get("exhibitorId")) == str(record["id"])][:top_k]
        result.items.append(item)
    if route_intent:
        ranked_routes = []
        for route in raw["routes"]:
            if route.get("type", "navigation") not in {"navigation", "tour"}:
                continue
            route_points = [points[p] for p in map(str, route.get("pointIds", [])) if p in points]
            # Only the destination point identifies the destination. Matching any
            # intermediate point can send a visitor to an unrelated endpoint.
            destination = route_points[-1] if route_points else {}
            destination_terms = terms(destination)
            for entity_id in (destination.get("exhibitorId"), destination.get("exhibitId")):
                if str(entity_id or "") in by_id:
                    destination_terms += terms(by_id[str(entity_id)][1])
            destination_exhibit = by_id.get(str(destination.get("exhibitId") or ""))
            if destination_exhibit:
                parent = exhibitors.get(str(destination_exhibit[1].get("exhibitorId") or ""))
                if parent:
                    destination_terms += terms(parent)
            score = rank(query, route, destination_terms)
            if selected and str(selected[1]["id"]) in {str(destination.get("exhibitorId")), str(destination.get("exhibitId"))}:
                score = (1.0, len(normalize(selected[1].get("name"))))
            if score[0]:
                ranked_routes.append((score, route, route_points))
        ranked_routes.sort(key=lambda item: item[0], reverse=True)
        route_matches = [r for r in ranked_routes if r[0] == ranked_routes[0][0]] if ranked_routes else []
        if route_matches:
            result.exact_hit = route_matches[0][0][0] == 1
            result.items = []
            result.total = len(route_matches)
            for _, route, route_points in route_matches[:top_k]:
                item = fact(route, "route")
                item["points"] = [fact(p, "point") for p in route_points]
                item["directions"] = values(route.get("directions"))
                item["estimated_minutes"] = route.get("estimatedMinutes")
                result.items.append(item)
            if len(route_matches) == 1:
                _, route, route_points = route_matches[0]
                result.route = {"matched": True, "route_id": route["id"], "title": route.get("name", ""),
                                "image_urls": values(route.get("imageUrls") or route.get("image_urls")),
                                "spoken_text": "", "subtitle_text": "", "route": {
                                    "from": route_points[0].get("name", "") if route_points else "",
                                    "to": route_points[-1].get("name", "") if route_points else "",
                                    "directions": values(route.get("directions")), "estimated_minutes": route.get("estimatedMinutes")}}
        else:
            result.status = "not_found"
            # Preserve destination facts while making missing route explicit.
            result.items.append({"type": "route", "available": False})
            return result
    if result.total:
        result.status = "multiple" if result.total > 1 and not listing else "matched"
    elif re.search(r"展会|大会|会议|exhibition|conference", question, re.I) and not route_intent:
        exhibition = store.get_record("exhibitions", exhibition_id)
        if exhibition:
            result.items = [fact(exhibition, "exhibition")]
            result.entity_ids = [exhibition_id]
            result.status = "matched"
    return result


def database_answer(result: LookupResult, question: str, locale: str) -> str:
    """Render an unambiguous keyword hit using only stored public content."""
    if result.status != "matched" or not result.exact_hit or len(result.items) != 1:
        return ""
    item = result.items[0]
    english = locale == "en-US"
    name = str(item.get("name") or "")
    if result.intent == "route":
        text = item.get("spoken_text") or item.get("description") or " ".join(item.get("directions") or [])
        return spoken_answer(str(text or ""))
    location = bool(re.search(r"在哪|展位|位置|地址|where|location|booth|address", question, re.I))
    parent = item.get("exhibitor") or {}
    booth = item.get("booth_code") or parent.get("booth_code")
    if location:
        if booth:
            return f"{name} is at booth {booth}." if english else f"{name}位于{booth}展位。"
        address = item.get("address")
        if address:
            return f"{name}: {address}." if english else f"{name}位于{address}。"
        return ""
    if "exhibits" in item:
        products = item["exhibits"]
        if not products:
            return ""
        names = ", ".join(p.get("name", "") for p in products)
        return f"{name}: {names}." if english else f"{name}的展品有：{names}。"
    text = item.get("spoken_text") or item.get("description")
    if text:
        return spoken_answer(str(text))
    if booth:
        return f"{name} is at booth {booth}." if english else f"{name}位于{booth}展位。"
    return ""
