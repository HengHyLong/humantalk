"""Deterministic, exhibition-scoped lookup of available business facts."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

from apps.api.services.dify_chat import spoken_answer
from apps.api.services.exhibition_matching import classify, occurrences, route_issues


def normalize(value: Any) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]", "", str(value or "").lower())


def values(value: Any) -> list[str]:
    return [str(v) for v in value] if isinstance(value, list) else [str(value)] if value else []


def published(record: dict[str, Any]) -> bool:
    # Public entity/navigation APIs already expose draft records. Preserve that
    # availability rather than introducing a new publication gate in v2.6.
    return record.get("status") not in {"inactive", "offline", "deleted", "cancelled"}


def clean_copy(value: Any) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", str(value or ""))
    text = re.sub(r"<img\b[^>]*>", "", text, flags=re.I)
    return spoken_answer(text)


def prune_nested(question: str, candidates: list[tuple[str, dict]]) -> list[tuple[str, dict]]:
    spans = {str(r["id"]): [span for key, term in term_fields(r)
                            for span in occurrences(question, term, code=key in {"boothCode", "modelNo", "code"})]
             for _, r in candidates}
    # Suppress only an alias entirely covered by a longer name at the SAME place.
    return [(kind, r) for kind, r in candidates if any(
        not any(a <= start and end <= b and b - a > end - start
                for other_id, others in spans.items() if other_id != str(r["id"]) for a, b in others)
        for start, end in spans[str(r["id"])])]


def resolve_origin(question: str, points: dict[str, dict], explicit: str | None,
                   config: dict, previous: str) -> tuple[str, str]:
    source = re.search(r"从(.+?)(?:到|去|前往)(.+)|\bfrom\s+(.+?)\s+to\s+(.+)", question, re.I)
    if source:
        origin_text, destination = (source[1], source[2]) if source[1] else (source[3], source[4])
        origin_text = re.sub(r"(?:出发|开始)\s*$", "", origin_text.strip())
        if re.fullmatch(r"(?:这里|此处|当前位置|(?:当前|数字人|这个)?终端|here|terminal)", origin_text.strip(), re.I):
            origin = str(config.get("terminalPointId") or "")
            if not origin:
                # Resolve this against a validated, destination-specific route
                # explicitly labelled as starting at the terminal.
                return "@terminal", destination
        else:
            matches = [pid for pid, p in points.items() if rank(origin_text, p)[0] == 1]
            origin = matches[0] if len(matches) == 1 else ""
        return (origin if origin in points else "!route_origin_unknown"), destination
    if explicit:
        return (explicit if explicit in points else "!route_origin_unknown"), question
    origin = str(config.get("terminalPointId") or "")
    if re.search(r"继续|接着|下一站|continue|next stop", question, re.I):
        origin = previous or origin
    return (origin if origin in points else "!route_origin_unknown" if origin else ""), question


def terms(record: dict[str, Any]) -> list[str]:
    result = [record.get("name"), record.get("title"), record.get("boothCode"), record.get("modelNo"), record.get("code")]
    for key in ("aliases", "keywords", "introductionKeywords", "introduction_keywords"):
        result.extend(values(record.get(key)))
    return list(dict.fromkeys(normalize(term) for term in result if len(normalize(term)) >= 2))


def term_fields(record: dict[str, Any]) -> list[tuple[str, str]]:
    pairs = [(key, str(record[key])) for key in ("name", "title", "boothCode", "modelNo", "code") if record.get(key)]
    for key in ("aliases", "keywords", "introductionKeywords", "introduction_keywords"):
        pairs.extend((key, value) for value in values(record.get(key)))
    return [(key, value.strip()) for key, value in pairs if len(normalize(value)) >= 2]


def rank(query: str, record: dict[str, Any], extra: list[str] | None = None) -> tuple[float, int]:
    candidates = [normalize(v) for key, v in term_fields(record)
                  if key not in {"boothCode", "modelNo", "code"} and not normalize(v).isdigit()]
    exact = [normalize(v) for key, v in term_fields(record)
             if occurrences(query, v, code=key in {"boothCode", "modelNo", "code"})]
    exact.extend(normalize(v) for v in extra or [] if occurrences(query, v))
    if exact:
        return 1.0, max(map(len, exact))
    if record.get("fuzzyMatch", record.get("fuzzy_match", True)) is False:
        return 0.0, 0
    # Avoid matching a single generic Chinese character against an entire query.
    needle = re.sub(r"请问|请|介绍一下|介绍|在哪里|在哪儿|在哪|怎么走|如何到|怎么去|告诉我|的展位|展位|展商|展品|了解一下|了解|是什么|什么", "", normalize(query))
    best = max((SequenceMatcher(None, needle, v).ratio() for v in candidates if len(v) >= 3), default=0.0)
    return (best, 0) if best >= 0.78 else (0.0, 0)


def fact(record: dict[str, Any], kind: str) -> dict[str, Any]:
    # Whitelist public facts: never send contacts, phone numbers or survey tokens.
    mapping = {"id": "id", "name": "name", "boothCode": "booth_code", "modelNo": "model_no",
               "category": "category", "exhibitorId": "exhibitor_id", "address": "address",
               "floor": "floor", "code": "code", "startDate": "start_date", "endDate": "end_date",
               "title": "title", "startAt": "start_at", "endAt": "end_at", "location": "location"}
    result = {target: record[source] for source, target in mapping.items() if record.get(source) not in (None, "")}
    result["type"] = kind
    for source, target in (("description", "description"), ("spokenText", "spoken_text")):
        if record.get(source):
            result[target] = clean_copy(record[source])[:4000]
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
    reason: str = "no_match"
    matches: list[dict[str, Any]] = field(default_factory=list)
    truncated: bool = False
    origin_id: str = ""
    destination_id: str = ""
    route_ids: list[str] = field(default_factory=list)

    def context(self) -> dict[str, Any]:
        return {"intent": self.intent, "items": self.items, "total_matches": self.total,
                "routing_reason": self.reason, "truncated": self.truncated,
                "origin_id": self.origin_id, "destination_id": self.destination_id}


def lookup(store: Any, exhibition_id: str, question: str, *, selected_entity_id: str | None = None,
           previous_ids: list[str] | None = None, top_k: int = 5, origin_point_id: str | None = None,
           previous_route_ids: list[str] | None = None, previous_origin_id: str = "",
           pending_destination_id: str = "") -> LookupResult:
    top_k = max(1, min(top_k, 8))
    query = normalize(question)
    raw = {kind: [r for r in store.list_records(kind, exhibition_id=exhibition_id) if published(r)]
           for kind in ("exhibitors", "exhibits", "points", "venues", "routes", "schedules")}
    exhibitors = {str(r["id"]): r for r in raw["exhibitors"]}
    points = {str(r["id"]): r for r in raw["points"]}
    content = [(kind.rstrip("s"), r) for kind in ("exhibitors", "exhibits", "venues", "points", "schedules") for r in raw[kind]]
    by_id = {str(r["id"]): (kind, r) for kind, r in content}
    by_id.update({str(r["id"]): ("route", r) for r in raw["routes"]})
    intent = classify(question)
    destination_override = ""
    config = store.get_record("runtime_configs", exhibition_id) or {}
    if intent == "unknown" and pending_destination_id in points:
        # A short answer to "where are you starting?" continues the pending route.
        origin_answers = [p for p in points.values() if rank(question, p)[0] == 1]
        terminal_answer = re.fullmatch(r"(?:我)?(?:从|在)?(?:当前|数字人|这个)?(?:终端|这里|此处|当前位置)(?:出发|开始)?[。！!\s]*", question.strip())
        if terminal_answer:
            origin_point_id = str(config.get("terminalPointId") or "") or None
            destination_override = str(points[pending_destination_id].get("name") or "")
            intent = "route"
        elif len(origin_answers) == 1:
            point = origin_answers[0]
            short = re.sub(r"我现在在|我在|现在在|这里是|从|出发|在", "", query)
            if short in terms(point):
                origin_point_id = str(point["id"])
                destination_override = str(points[pending_destination_id].get("name") or "")
                intent = "route"
    if intent == "unknown" and any(occurrences(question, str(word)) for word in (config.get("keywords") or {}).get("navigation", [])):
        intent = "route"
    if intent == "unknown" and any(occurrences(question, str(word)) for word in (config.get("keywords") or {}).get("exhibition_content", [])):
        intent = "exhibition"
    if intent == "unknown" and any(occurrences(question, str(r.get("name") or "")) for r in raw["routes"]):
        intent = "route"
    route_intent = intent == "route"
    selected = by_id.get(selected_entity_id or "")
    if selected_entity_id and not selected:
        # Explicit card selection must belong to this exhibition and be visible.
        raise ValueError("entity not found in exhibition")
    followup = bool(re.search(r"^(它|他|她|这[个件家]|那[个件家]|上述|刚才)|^(where is it|tell me more|its |their )", question, re.I))
    explicit = any(rank(question, r)[0] == 1 for _, r in content)
    if explicit:
        selected = None  # Explicit current-turn objects override old selections.
    corrected = bool(re.search(r"不是|不要|不选|换成|改成|not|instead", question, re.I))
    if corrected:
        selected = None
    previous = previous_route_ids if re.search(r"第.+条|路线", question) else previous_ids
    if not selected and previous and not explicit and not corrected:
        ordinal = re.search(r"第([一二三四五六七八1-8])(?:个|家|件|条)", question)
        if ordinal:
            index = "一二三四五六七八".find(ordinal[1]) if not ordinal[1].isdigit() else int(ordinal[1]) - 1
            if 0 <= index < len(previous):
                selected = by_id.get(previous[index])
        elif followup and len(previous) == 1:
            selected = by_id.get(previous[0])
    if selected and selected[0] == "route":
        intent, route_intent = "route", True
    ranked = sorted([(rank(question, r), kind, r) for kind, r in content], key=lambda item: item[0], reverse=True)
    ranked = [item for item in ranked if item[0][0] > 0]
    if selected:
        candidates = [selected]
    elif ranked:
        best = ranked[0][0]
        candidates = [(kind, r) for score, kind, r in ranked if (best[0] == 1 and score[0] == 1) or (best[0] < 1 and score[0] >= best[0] - 0.03)]
        if best[0] == 1:
            candidates = prune_nested(question, candidates)
    else:
        candidates = []
    listing = intent == "list"
    generic = bool(re.fullmatch(r"(?:当前展会|本展会|展会|请|请问|都|全部|所有|有|哪些|什么|列出|展商|展品|产品|场馆|的|？|\?|。|\s)+", question))
    generic = generic or bool(re.fullmatch(r"(?:what|which|list|all|the|current|this|at|are|available|exhibition|exhibitors|exhibits|products|venues|please|[?!.\s])+", question, re.I))
    if not candidates and listing and generic:
        kind = "exhibitor" if "展商" in question or "exhibitor" in question.lower() else "exhibit" if "展品" in question or "产品" in question or re.search(r"exhibit|product", question, re.I) else "venue" if "场馆" in question or "venue" in question.lower() else ""
        candidates = [(k, r) for k, r in content if k == kind]
    if intent == "unknown" and (selected or any(query in terms(r) for _, r in candidates)):
        intent = "intro"
    result = LookupResult(intent=intent, total=len(candidates),
                          exact_hit=bool(selected or (ranked and ranked[0][0][0] == 1) or (listing and generic)),
                          truncated=len(candidates) > top_k)
    result.matches = [{"id": str(r["id"]), "type": kind, "field": key, "keyword": value, "score": 1.0}
                      for kind, r in candidates for key, value in term_fields(r)
                      if occurrences(question, value, code=key in {"boothCode", "modelNo", "code"})]
    expo_hits = [r for r in store.list_records("exhibitions") if rank(question, r)[0] == 1]
    foreign = [r for r in expo_hits if str(r["id"]) != exhibition_id]
    if foreign:
        result.reason = "exhibition_scope_mismatch"
        result.items = [fact(r, "exhibition") for r in foreign[:top_k]]
        result.status = "multiple"
        return result
    if expo_hits and not candidates:
        result.items = [fact(r, "exhibition") for r in expo_hits[:top_k]]
        result.status = "matched" if len(expo_hits) == 1 else "multiple"
        result.total = len(expo_hits)
        result.reason = "exhibition_question" if len(expo_hits) != 1 or str(expo_hits[0]["id"]) == exhibition_id else "exhibition_scope_mismatch"
        return result
    candidates = candidates[:top_k]
    result.entity_ids = [str(r["id"]) for _, r in candidates]
    for kind, record in candidates:
        item = fact(record, kind)
        if kind == "exhibit":
            parent = exhibitors.get(str(record.get("exhibitorId") or ""))
            if parent:
                item["exhibitor"] = fact(parent, "exhibitor")
        if kind == "exhibitor" and re.search(r"展品|产品|products|exhibits", question, re.I):
            products = [e for e in raw["exhibits"] if str(e.get("exhibitorId")) == str(record["id"])]
            item["exhibits"] = [fact(e, "exhibit") for e in products[:top_k]]
            item["exhibits_total"] = len(products)
            result.truncated = result.truncated or len(products) > top_k
        result.items.append(item)
    if route_intent:
        origin, destination_question = resolve_origin(question, points, origin_point_id,
                                                     config, previous_origin_id)
        terminal_requested = origin == "@terminal"
        if terminal_requested:
            origin = ""
        destination_question = destination_override or destination_question
        if origin.startswith("!"):
            result.reason = origin[1:]
            return result
        # Remove origin-only entities before counting requested destinations.
        destination_candidates = prune_nested(destination_question, [(k, r) for k, r in content if rank(destination_question, r)[0] == 1])
        named_route = any(occurrences(question, str(r.get("name") or "")) for r in raw["routes"])
        if len(destination_candidates) > 1 and not named_route:
            result.reason = "route_multiple_destinations"
            result.status = "multiple"
            return result
        result.origin_id = origin
        ranked_routes = []
        conflicts = []
        for route in raw["routes"]:
            if route.get("type", "navigation") not in {"navigation", "tour"}:
                continue
            route_points = [points[p] for p in map(str, route.get("pointIds", [])) if p in points]
            # Only the destination point identifies the destination. Matching any
            # intermediate point can send a visitor to an unrelated endpoint.
            destination = route_points[-1] if route_points else {}
            destination_terms = [term for _, term in term_fields(destination)]
            for entity_id in (destination.get("exhibitorId"), destination.get("exhibitId")):
                if str(entity_id or "") in by_id:
                    destination_terms += [term for _, term in term_fields(by_id[str(entity_id)][1])]
            destination_exhibit = by_id.get(str(destination.get("exhibitId") or ""))
            if destination_exhibit:
                parent = exhibitors.get(str(destination_exhibit[1].get("exhibitorId") or ""))
                if parent:
                    destination_terms += [term for _, term in term_fields(parent)]
            score = rank(destination_question, route, destination_terms)
            title_target = re.search(r"(?:终端至|到|至|\bto\s+)(.+)$", str(route.get("name", "")), re.I)
            if title_target and occurrences(destination_question, title_target[1]):
                score = (1.0, len(normalize(title_target[1])))
            if selected and str(selected[1]["id"]) in {str(destination.get("exhibitorId")), str(destination.get("exhibitId"))}:
                score = (1.0, len(normalize(selected[1].get("name"))))
            if selected and selected[0] == "route" and str(selected[1]["id"]) == str(route["id"]):
                score = (1.0, len(normalize(route.get("name"))))
            if score[0] == 1:
                if route_issues(route, points):
                    conflicts.append(str(route["id"]))
                    continue
                ranked_routes.append((score, route, route_points))
        if not origin:
            named = [r for r in ranked_routes if occurrences(question, str(r[1].get("name") or ""))
                     and (not terminal_requested or re.match(r"^(?:从)?(?:当前|数字人)?终端(?:出发)?(?:至|到|去)", str(r[1].get("name") or "")))]
            if len(named) == 1:
                origin = str(named[0][1]["pointIds"][0])
                result.origin_id = origin
                ranked_routes = named
            else:
                terminal_routes = [row for row in ranked_routes if re.match(r"^(?:从)?(?:当前|数字人)?终端(?:出发)?(?:至|到|去)", str(row[1].get("name") or ""))]
                starts = {str(row[1]["pointIds"][0]) for row in terminal_routes}
                if len(starts) == 1:
                    origin = next(iter(starts))
                    result.origin_id = origin
                    ranked_routes = terminal_routes
            if not origin and ranked_routes:
                result.reason = "route_origin_required"
                result.route_ids = [str(row[1]["id"]) for row in ranked_routes[:top_k]]
                destinations = {str(row[1]["pointIds"][-1]) for row in ranked_routes}
                result.destination_id = next(iter(destinations)) if len(destinations) == 1 else ""
                return result
        had_routes = bool(ranked_routes)
        if origin:
            ranked_routes = [row for row in ranked_routes if str(row[1]["pointIds"][0]) == origin]
        ranked_routes.sort(key=lambda item: item[0], reverse=True)
        route_matches = ranked_routes  # Multiple destinations never disappear by name length.
        defaults = [row for row in route_matches if row[1].get("isDefault") is True]
        if len(defaults) == 1 and len({str(row[1]["pointIds"][-1]) for row in route_matches}) == 1:
            route_matches = defaults
        if route_matches:
            result.exact_hit = route_matches[0][0][0] == 1
            result.items = []
            result.total = len(route_matches)
            result.truncated = result.total > top_k
            result.route_ids = [str(row[1]["id"]) for row in route_matches[:top_k]]
            result.entity_ids = result.route_ids.copy()
            result.reason = "route_valid" if len(route_matches) == 1 else "route_ambiguous"
            for _, route, route_points in route_matches[:top_k]:
                item = fact(route, "route")
                item["points"] = [fact(p, "point") for p in route_points]
                item["directions"] = values(route.get("directions"))
                item["estimated_minutes"] = route.get("estimatedMinutes")
                result.items.append(item)
            if len(route_matches) == 1:
                _, route, route_points = route_matches[0]
                result.destination_id = str(route["pointIds"][-1])
                result.route = {"matched": True, "route_id": route["id"], "title": route.get("name", ""),
                                "image_url": next(iter(values(route.get("imageUrls") or route.get("image_urls"))), None),
                                "image_urls": values(route.get("imageUrls") or route.get("image_urls")),
                                "spoken_text": "", "subtitle_text": "", "route": {
                                    "from": route_points[0].get("name", "") if route_points else "",
                                    "to": route_points[-1].get("name", "") if route_points else "",
                                    "directions": values(route.get("directions")), "estimated_minutes": route.get("estimatedMinutes")}}
        else:
            result.status = "not_found"
            result.reason = "route_config_conflict" if conflicts and not had_routes else "route_missing_from_origin" if had_routes else "route_missing"
            # Preserve destination facts while making missing route explicit.
            result.items.append({"type": "route", "available": False})
            return result
    if result.total:
        result.status = "multiple" if result.total > 1 and not listing and intent not in {"comparison", "compound"} else "matched"
        if not route_intent:
            result.reason = "exact_match" if result.exact_hit else "fuzzy_match"
            if result.truncated:
                result.reason = "incomplete_results"
            elif result.status == "multiple":
                result.reason = "ambiguous_entity"
            elif result.total > 1 and not listing:
                result.reason = "multiple_entities"
            elif any(i["type"] == "schedule" for i in result.items):
                result.reason = "schedule_question"
            elif intent in {"knowledge", "comparison", "compound", "unknown"}:
                result.reason = "unsupported_intent"
            elif intent == "registration":
                result.reason = "registration_request" if result.exact_hit and result.items[0]["type"] == "exhibit" else "registration_ambiguous"
    elif (intent == "exhibition" or re.search(r"展会|大会|会议|exhibition|conference", question, re.I)) and not route_intent:
        exhibition = store.get_record("exhibitions", exhibition_id)
        if exhibition:
            result.items = [fact(exhibition, "exhibition")]
            result.entity_ids = [exhibition_id]
            result.status = "matched"
            result.total = 1
            result.reason = "exhibition_question"
    return result


def database_answer(result: LookupResult, question: str, locale: str) -> str:
    """Render an unambiguous keyword hit using only stored public content."""
    if result.status != "matched" or not result.exact_hit or result.truncated:
        return ""
    if result.reason not in {"exact_match", "route_valid"} or result.intent not in {"intro", "location", "list", "route"}:
        return ""
    if result.intent == "list" and len(result.items) > 1:
        if locale == "en-US" and any(re.search(r"[\u4e00-\u9fff]", str(i.get("name", ""))) for i in result.items):
            return ""
        names = [str(i.get("name", "")) for i in result.items]
        return "Available at this exhibition: " + ", ".join(names) + "." if locale == "en-US" else "当前展会有：" + "、".join(names) + "。"
    if len(result.items) != 1:
        return ""
    item = result.items[0]
    english = locale == "en-US"
    name = str(item.get("name") or "")
    if english and re.search(r"[\u4e00-\u9fff]", json_public(item)):
        return ""  # Dify translates validated facts rather than speaking Chinese.
    if result.intent == "route":
        text = item.get("spoken_text") or item.get("description") or " ".join(item.get("directions") or [])
        return spoken_answer(str(text or ""))
    location = result.intent == "location"
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
    return ""


def json_public(item: dict) -> str:
    import json
    return json.dumps(item, ensure_ascii=False)


def service_answer(result: LookupResult, locale: str) -> str:
    prompts = {
        "route_origin_unknown": ("没有识别到有效的起点，请告诉我您当前所在的入口或展台。", "Please specify a known entrance or booth as your starting point."),
        "route_origin_required": ("请告诉我您从哪个入口或展台出发。", "Which entrance or booth are you starting from?"),
        "route_multiple_destinations": ("您提到了多个目的地，请先选择一个目的地。", "Please select one destination first."),
        "exhibition_scope_mismatch": ("您提到的展会与当前展会不同，请先切换展会或确认要查询的展会。", "Please switch exhibitions or confirm which exhibition you want to ask about."),
    }
    prompt = prompts.get(result.reason)
    return prompt[locale == "en-US"] if prompt else ""
