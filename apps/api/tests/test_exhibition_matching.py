from __future__ import annotations

import pytest

from apps.api.services.exhibition_matching import occurrences, route_issues
from apps.api.services.exhibition_lookup import lookup, database_answer, service_answer
from apps.api.services.exhibition_audit import audit_configuration


class Store:
    def __init__(self):
        self.data = {
            "exhibitions": [{"id": "expo", "name": "中国计算机大会", "code": "CNCC-2026"}, {"id": "other", "name": "农博会", "code": "N2026"}],
            "exhibitors": [{"id": "v", "name": "具身科学有限公司", "aliases": ["具身科学"], "boothCode": "02", "description": "具身科学简介。![展商图片](https://example.test/a.png)"}],
            "exhibits": [{"id": "p", "name": "机器人", "modelNo": "S-01", "description": "机器人简介。", "exhibitorId": "v"}, {"id": "p2", "name": "智能机器人", "modelNo": "S-010", "description": "智能机器人简介。", "exhibitorId": "v"}],
            "points": [{"id": "east", "name": "东门"}, {"id": "west", "name": "西门"}, {"id": "booth", "name": "科技展台", "exhibitorId": "v"}],
            "venues": [], "schedules": [{"id": "s", "title": "数字人演示", "startAt": "2026-10-21T09:00:00"}],
            "routes": [{"id": "r", "name": "终端至科技展台", "pointIds": ["east", "booth"], "spokenText": "从东门前往科技展台。", "status": "draft"}],
            "runtime_configs": [],
        }

    def list_records(self, kind, exhibition_id=None):
        return self.data.get(kind, []) if exhibition_id in (None, "expo") else []

    def get_record(self, kind, rid):
        return next((r for r in self.data.get(kind, []) if r["id"] == rid), None)


@pytest.mark.parametrize("question,value,code,hit", [
    ("介绍CNCC2026", "02", True, False), ("102展位", "02", True, False),
    ("2026年", "02", True, False), ("02", "02", True, True), ("02展位", "02", True, True),
    ("今天02点", "02", True, False), ("S010", "S-01", True, False),
    ("介绍S01", "S-01", True, True), ("介绍S_01", "S-01", True, True),
    ("XS01", "S-01", True, False), ("CNCC2026", "CNCC-2026", True, True),
    ("不要介绍具身科学", "具身科学", False, False),
])
def test_identifier_boundaries(question, value, code, hit):
    assert bool(occurrences(question, value, code=code)) is hit


@pytest.mark.parametrize("question", ["具身科学多少钱", "具身科学什么时候成立", "比较机器人和智能机器人", "具身科学有什么优缺点", "介绍科技展台并告诉我怎么去", "具身科学为什么好"])
def test_exact_entity_does_not_answer_unsupported_questions(question):
    result = lookup(Store(), "expo", question)
    assert database_answer(result, question, "zh-CN") == ""


def test_exhibition_code_and_nested_names():
    store = Store()
    expo = lookup(store, "expo", "介绍CNCC2026")
    assert expo.reason == "exhibition_question" and expo.items[0]["type"] == "exhibition"
    assert lookup(store, "expo", "介绍智能机器人").entity_ids == ["p2"]
    both = lookup(store, "expo", "比较机器人和智能机器人")
    assert set(both.entity_ids) == {"p", "p2"}
    assert lookup(store, "expo", "介绍农博会").reason == "exhibition_scope_mismatch"


def test_corrections_take_priority_over_cached_entity_and_ordinal():
    store = Store()
    result = lookup(store, "expo", "它不是机器人，介绍具身科学", previous_ids=["p"], selected_entity_id="p")
    assert result.entity_ids == ["v"]
    assert lookup(store, "expo", "介绍具身科学", previous_ids=["p2"], selected_entity_id="p2").entity_ids == ["v"]
    assert lookup(store, "expo", "第二个", previous_ids=["p2", "p"]).entity_ids == ["p"]
    assert not lookup(store, "expo", "它在哪", previous_ids=["p2", "p"]).exact_hit


def test_route_origin_destination_and_conflicts():
    store = Store()
    assert lookup(store, "expo", "怎么去科技展台").reason == "route_origin_required"
    valid = lookup(store, "expo", "从东门到科技展台")
    assert valid.reason == "route_valid" and valid.origin_id == "east" and valid.destination_id == "booth"
    assert database_answer(valid, "从东门到科技展台", "zh-CN")
    assert lookup(store, "expo", "从西门到科技展台").reason == "route_missing_from_origin"
    unknown = lookup(store, "expo", "从酒店到科技展台")
    assert unknown.reason == "route_origin_unknown" and service_answer(unknown, "zh-CN")
    assert lookup(store, "expo", "怎么去科技展台和西门").reason == "route_multiple_destinations"
    store.data["routes"][0]["pointIds"] = ["east", "west"]
    assert lookup(store, "expo", "从东门到科技展台").reason == "route_config_conflict"
    assert any(i["code"] == "route_title_conflict" for i in audit_configuration(store, "expo"))


def test_route_followup_keeps_route_id_and_checks_origin_again():
    store = Store()
    result = lookup(store, "expo", "第二条路线", previous_route_ids=["absent", "r"], origin_point_id="east")
    assert result.route_ids == ["r"] and result.route["route_id"] == "r"
    assert lookup(store, "expo", "怎么去具身科学", origin_point_id="west").route is None


def test_listing_truncation_translation_and_image_cleanup():
    store = Store()
    full = lookup(store, "expo", "有哪些展品")
    assert full.total == 2 and database_answer(full, "有哪些展品", "zh-CN")
    limited = lookup(store, "expo", "有哪些展品", top_k=1)
    assert limited.total == 2 and limited.truncated and not database_answer(limited, "有哪些展品", "zh-CN")
    intro = lookup(store, "expo", "介绍具身科学")
    assert database_answer(intro, "介绍具身科学", "zh-CN") == "具身科学简介。"
    assert not database_answer(intro, "介绍具身科学", "en-US")
    assert lookup(store, "expo", "数字人演示几点开始").reason == "schedule_question"


def test_invalid_route_points_are_rejected():
    store = Store()
    points = {p["id"]: p for p in store.data["points"]}
    for ids in (["east"], ["east", "missing"], ["east", "east"]):
        assert route_issues({"pointIds": ids}, points)
    assert route_issues({"pointIds": ["east", "west"], "spokenText": "从此处直走50米，到东门。然后前往西门。"}, points) == ["route_speech_origin_conflict"]
