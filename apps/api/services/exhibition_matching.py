"""Boundary-aware identifiers and conservative, deterministic question intents."""
from __future__ import annotations

import re
from typing import Any


def normalize(value: Any) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]", "", str(value or "").lower())


def occurrences(question: str, value: str, *, code: bool = False) -> list[tuple[int, int]]:
    def negated(start: int) -> bool:
        return bool(re.search(r"(?:不要|不是|不想|不去|不选|排除|除了|not|don't|do not)\s*(?:介绍|去|选|选择)?\s*$",
                              question[max(0, start - 35):start], re.I))
    compact = re.sub(r"[-_\s]", "", value).lower()
    if code or re.fullmatch(r"[a-z0-9_-]+", compact):
        if compact.isdigit() and normalize(question) != compact and not re.search(
                r"展位|编号|型号|点位|编码|booth|model|code", question, re.I):
            return []
        groups = re.findall(r"[a-z]+|\d+|[^a-z\d]+", compact)
        pattern = r"(?<![a-z0-9])" + r"[-_\s]*".join(re.escape(g) for g in groups) + r"(?![a-z0-9])"
        return [(m.start(), m.end()) for m in re.finditer(pattern, question, re.I) if not negated(m.start())]
    chars, offsets = [], []
    for i, char in enumerate(question):
        n = normalize(char)
        if n:
            chars.append(n)
            offsets.append(i)
    needle = normalize(value)
    if not needle:
        return []
    result = []
    for m in re.finditer(re.escape(needle), "".join(chars)):
        start, end = offsets[m.start()], offsets[m.end() - 1] + 1
        if not negated(start):
            result.append((start, end))
    return result


def classify(question: str) -> str:
    intro = bool(re.search(r"介绍|了解|讲讲|说说|introduce|tell.*about", question, re.I))
    # Negated navigation clauses are not requests to travel.
    positive = re.sub(r"(?:不去|不要去|don't go|do not go)[^，。；,;]*", "", question, flags=re.I)
    route = bool(re.search(r"怎么走|怎么去|如何到|如何去|路线|导航|带我去|前往|(?:^|我想|我要|请)去|从.+(?:到|去)|how.*(?:get|go)|directions|\broute\b|from.+to", positive, re.I))
    if intro and route:
        return "compound"
    if re.search(r"登记|报名|扫码|register|registration|sign up", question, re.I):
        return "registration"
    if route:
        return "route"
    if re.search(r"区别|比较|对比|关系|相比|compare|difference|relationship|versus|\bvs\b", question, re.I):
        return "comparison"
    if re.search(r"价格|多少钱|收费|成立|优点|缺点|推荐|为什么|原因|几个|多少|预约|预订|price|cost|pros|cons|recommend|why|how many|founded|book", question, re.I):
        return "knowledge"
    if re.search(r"有哪些|有什么|列出|\blist\b|(?:which|what) (?:exhibitors|exhibits|products|venues)", question, re.I):
        return "list"
    if re.search(r"在哪|哪里|展位|位置|地址|where|location|booth|address", question, re.I):
        return "location"
    return "intro" if intro else "unknown"


def route_issues(route: dict, points: dict[str, dict]) -> list[str]:
    ids = [str(p) for p in route.get("pointIds", [])]
    if len(ids) < 2 or any(p not in points or points[p].get("status") in {"offline", "inactive", "deleted", "cancelled"} for p in ids):
        return ["route_points_invalid"]
    end = points[ids[-1]]
    if ids[0] == ids[-1]:
        return ["route_endpoints_identical"]
    for key, expected in (("originPointId", ids[0]), ("destinationPointId", ids[-1])):
        if route.get(key) and str(route[key]) != expected:
            return ["route_endpoint_conflict"]
    target = re.search(r"(?:终端至|到|至|\bto\s+)(.+)$", str(route.get("name", "")), re.I)
    if target:
        named = [p for p in points.values() if normalize(p.get("name")) == normalize(target[1])]
        if named and str(named[0]["id"]) != str(end["id"]):
            return ["route_title_conflict"]
    speech = str(route.get("spokenText") or route.get("spoken_text") or "")
    targets = re.findall(r"(?:到达|前往|到|至)([^。.!！\n]+)", speech)
    if targets and normalize(targets[0]) == normalize(points[ids[0]].get("name")) and re.search(r"从此处|从这里|当前位置", speech):
        return ["route_speech_origin_conflict"]
    if targets:
        named = [p for p in points.values() if normalize(p.get("name")) == normalize(targets[-1])]
        if named and str(named[0]["id"]) != str(end["id"]):
            return ["route_speech_conflict"]
    return []
