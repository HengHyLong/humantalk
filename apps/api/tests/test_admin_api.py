from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

import apps.api.admin.routes as admin_routes
from apps.api.admin import AdminStore
from apps.api.admin.middleware import AdminTraceMiddleware
from apps.api.admin.routes import public_router, router
from apps.api.admin.security import password_hasher


def _client(tmp_path) -> TestClient:
    settings = SimpleNamespace(
        admin_sqlite_path=str(tmp_path / "admin.sqlite3"),
        admin_initialize_defaults=True,
        admin_jwt_secret="test-secret-that-is-long-enough-for-hs256",
        admin_access_token_minutes=30,
        admin_refresh_token_days=7,
    )
    app = FastAPI()
    app.state.settings = settings
    store = AdminStore(settings.admin_sqlite_path, True)
    store.save_record("exhibitions", {"id": "expo-test", "name": "测试展会", "status": "operating", "isCurrent": True})
    app.state.admin_store = store
    app.add_middleware(AdminTraceMiddleware)
    app.include_router(router)
    app.include_router(public_router)
    return TestClient(app)


def _login(client: TestClient) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin@123456"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_admin_auth_permissions_and_refresh(tmp_path) -> None:
    with _client(tmp_path) as client:
        login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin@123456"})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        permissions = client.get("/api/v1/auth/permissions", headers=headers)
        assert permissions.status_code == 200
        assert "event:exhibition" in permissions.json()["codes"]
        refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": login.json()["refresh_token"]})
        assert refreshed.status_code == 200
        assert refreshed.json()["token"]
        assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
        assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_exhibition_filter_and_relation_validation(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        response = client.get("/api/v1/admin/event/exhibitions", params={"exhibition_id": "expo-test"}, headers=headers)
        assert response.status_code == 200
        assert response.json()["total"] == 1
        invalid = client.post("/api/v1/admin/event/exhibits", headers=headers, json={"exhibitionId": "expo-test", "exhibitorId": "missing", "name": "bad"})
        assert invalid.status_code == 404


def test_welcome_wake_word_validation_and_public_config(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        store = client.app.state.admin_store
        store.save_record("runtime_configs", {"id": "expo-test", "exhibitionId": "expo-test", "keywords": {"navigation": [], "exhibition_content": []}}, "expo-test")
        store.save_record("scripts", {"id": "script-welcome-test", "scene": "welcome", "content": "您好，欢迎来到测试展会。", "status": "active"}, "expo-test")

        invalid = client.post(
            "/api/v1/admin/interaction/welcome-configs",
            headers=headers,
            json={"id": "welcome-invalid", "exhibitionId": "expo-test", "triggers": ["唤醒词"], "wakeWords": [], "wakeActiveSeconds": 60, "scriptId": "script-welcome-test", "status": "active"},
        )
        assert invalid.status_code == 400
        assert invalid.json()["detail"]["code"] == "WAKE_WORD_REQUIRED"

        invalid_window = client.post(
            "/api/v1/admin/interaction/welcome-configs",
            headers=headers,
            json={"id": "welcome-invalid-window", "exhibitionId": "expo-test", "triggers": ["唤醒词"], "wakeWords": ["你好小展"], "wakeActiveSeconds": 5, "scriptId": "script-welcome-test", "status": "active"},
        )
        assert invalid_window.status_code == 400
        assert invalid_window.json()["detail"]["code"] == "WAKE_WINDOW_INVALID"

        saved = client.post(
            "/api/v1/admin/interaction/welcome-configs",
            headers=headers,
            json={"id": "welcome-valid", "exhibitionId": "expo-test", "triggers": ["唤醒词：你好小展"], "wakeActiveSeconds": 60, "scriptId": "script-welcome-test", "status": "active"},
        )
        assert saved.status_code == 200
        assert saved.json()["triggers"] == ["唤醒词"]
        assert saved.json()["wakeWords"] == ["你好小展"]
        assert saved.json()["wakeActiveSeconds"] == 60

        public = client.get("/exhibitions/expo-test/digital-human-config")
        assert public.status_code == 200
        assert public.json()["supports_deferred_speak"] is True
        assert public.json()["wake_word"] == {"enabled": True, "words": ["你好小展"], "active_window_seconds": 60}
        assert public.json()["welcome"]["text"] == "您好，欢迎来到测试展会。"


def test_lead_masking_navigation_and_trace(tmp_path) -> None:
    with _client(tmp_path) as client:
        store = client.app.state.admin_store
        store.save_record("exhibitors", {"id": "exhibitor-test", "exhibitionId": "expo-test", "name": "测试展商"}, "expo-test")
        store.save_record("exhibits", {"id": "exhibit-test", "exhibitionId": "expo-test", "exhibitorId": "exhibitor-test", "name": "测试展品"}, "expo-test")
        store.save_record("venues", {"id": "venue-test", "exhibitionId": "expo-test", "name": "测试场馆"}, "expo-test")
        store.save_record("points", {"id": "point-test-a", "exhibitionId": "expo-test", "venueId": "venue-test", "name": "入口"}, "expo-test")
        store.save_record("points", {"id": "point-test-b", "exhibitionId": "expo-test", "venueId": "venue-test", "name": "展台"}, "expo-test")
        store.save_record("routes", {"id": "route-test", "exhibitionId": "expo-test", "venueId": "venue-test", "pointIds": ["point-test-a", "point-test-b"]}, "expo-test")
        with store.connect() as conn:
            conn.execute("INSERT INTO admin_users(id,username,display_name,password_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", ("user-viewer", "viewer", "数据查看", password_hasher.hash("Viewer@123456"), "active", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"))
            conn.execute("INSERT INTO admin_user_roles(user_id,role_id) SELECT 'user-viewer',id FROM admin_roles WHERE code='data_viewer'")
        admin_headers = {**_login(client), "X-Trace-Id": "trace-admin-test"}
        created_by_admin = client.post("/api/v1/admin/lead", headers=admin_headers, json={"id": "lead-1", "exhibitionId": "expo-test", "phone": "13800138000", "email": "person@example.com", "status": "new"})
        assert created_by_admin.status_code == 200
        viewer_login = client.post("/api/v1/auth/login", json={"username": "viewer", "password": "Viewer@123456"})
        headers = {"Authorization": f"Bearer {viewer_login.json()['token']}", "X-Trace-Id": "trace-admin-test"}
        created = client.get("/api/v1/admin/lead/lead-1", headers=headers)
        assert created.status_code == 200
        listing = client.get("/api/v1/admin/lead", headers=headers).json()
        item = next(item for item in listing["items"] if item["id"] == "lead-1")
        assert item["phone"] == "138****8000"
        assert item["email"] == "p***@example.com"
        navigation = client.post("/exhibitions/current/navigation/query", json={"text": "怎么去测试展商", "session_id": "s1"})
        assert navigation.status_code == 200
        assert navigation.json()["route"]["to"] == "测试展商"
        trace = client.get("/api/v1/admin/audit/trace/trace-admin-test", headers=admin_headers)
        assert trace.status_code == 200
        assert trace.json()["spans"]


def test_navigation_matches_route_alias_fuzzily_and_returns_database_content(tmp_path) -> None:
    with _client(tmp_path) as client:
        store = client.app.state.admin_store
        headers = _login(client)
        store.save_record("runtime_configs", {"id": "expo-test", "exhibitionId": "expo-test", "keywords": {"navigation": ["怎么走"], "exhibition_content": []}}, "expo-test")
        store.save_record("venues", {"id": "venue-nav", "exhibitionId": "expo-test", "name": "主展馆"}, "expo-test")
        store.save_record("points", {"id": "point-nav-start", "exhibitionId": "expo-test", "venueId": "venue-nav", "name": "一号入口"}, "expo-test")
        store.save_record("points", {"id": "point-nav-a", "exhibitionId": "expo-test", "venueId": "venue-nav", "name": "智能制造展区"}, "expo-test")
        store.save_record("points", {"id": "point-nav-b", "exhibitionId": "expo-test", "venueId": "venue-nav", "name": "中央休息区"}, "expo-test")
        saved_route = client.post(
            "/api/v1/admin/event/routes",
            headers=headers,
            json={
                "id": "route-nav-a",
                "venueId": "venue-nav",
                "name": "入口到智能制造展区",
                "type": "navigation",
                "pointIds": ["point-nav-start", "point-nav-a"],
                "keywords": ["怎么去智能制造展区"],
                "aliases": ["智造馆"],
                "fuzzyMatch": True,
                "spokenText": "请从一号入口沿中央通道直行，看到蓝色指示牌后右转。",
                "directions": ["沿中央通道直行", "蓝色指示牌处右转"],
                "imageUrls": ["/scene-assets/navigation-a.png"],
                "estimatedMinutes": 3,
                "status": "published",
            },
        )
        assert saved_route.status_code == 200
        assert saved_route.json()["exhibitionId"] == "expo-test"
        assert saved_route.json()["aliases"] == ["智造馆"]
        store.save_record(
            "routes",
            {"id": "route-nav-b", "exhibitionId": "expo-test", "venueId": "venue-nav", "name": "入口到休息区", "type": "navigation", "pointIds": ["point-nav-start", "point-nav-b"], "keywords": ["休息区怎么走"], "aliases": ["休息处"], "fuzzyMatch": True, "spokenText": "请沿中央通道前往休息区。", "status": "published"},
            "expo-test",
        )

        config = client.get("/exhibitions/expo-test/digital-human-config")
        assert config.status_code == 200
        assert "智造馆" in config.json()["keywords"]["navigation"]
        assert "智造馆" in config.json()["navigation_fuzzy_keywords"]

        navigation = client.post("/exhibitions/expo-test/navigation/query", json={"text": "请问智照馆怎么走", "session_id": "session-nav"})
        assert navigation.status_code == 200
        payload = navigation.json()
        assert payload["matched"] is True
        assert payload["route_id"] == "route-nav-a"
        assert payload["spoken_text"] == "请从一号入口沿中央通道直行，看到蓝色指示牌后右转。"
        assert payload["subtitle_text"] == payload["spoken_text"]
        assert payload["image_url"] == "/scene-assets/navigation-a.png"
        assert payload["route"] == {"from": "一号入口", "to": "智能制造展区", "directions": ["沿中央通道直行", "蓝色指示牌处右转"], "estimated_minutes": 3}


def test_cross_venue_route_is_valid_and_directions_are_generated(tmp_path) -> None:
    with _client(tmp_path) as client:
        store = client.app.state.admin_store
        headers = _login(client)
        store.save_record("venues", {"id": "venue-route-a", "exhibitionId": "expo-test", "name": "A馆"}, "expo-test")
        store.save_record("venues", {"id": "venue-route-b", "exhibitionId": "expo-test", "name": "B馆"}, "expo-test")
        store.save_record("points", {"id": "point-route-a", "exhibitionId": "expo-test", "venueId": "venue-route-a", "name": "A馆出口", "floor": "1F"}, "expo-test")
        store.save_record("points", {"id": "point-route-b", "exhibitionId": "expo-test", "venueId": "venue-route-b", "name": "机器人展区", "floor": "1F"}, "expo-test")

        response = client.post(
            "/api/v1/admin/event/routes",
            headers=headers,
            json={
                "id": "route-cross-venue",
                "exhibitionId": "expo-test",
                "name": "A馆到B馆机器人展区",
                "type": "navigation",
                "pointIds": ["point-route-a", "point-route-b"],
                "keywords": ["机器人展区怎么走"],
                "aliases": ["机器人馆"],
                "fuzzyMatch": True,
                "directions": [],
                "status": "published",
            },
        )

        assert response.status_code == 200
        assert response.json()["venueId"] == "venue-route-a"
        assert response.json()["directions"] == ["从A馆的A馆出口出发，离馆后前往B馆的机器人展区。"]

        navigation = client.post("/exhibitions/expo-test/navigation/query", json={"text": "机器人馆怎么走", "session_id": "cross-venue"})
        assert navigation.status_code == 200
        assert navigation.json()["route"]["from"] == "A馆出口"
        assert navigation.json()["route"]["to"] == "机器人展区"
        assert navigation.json()["route"]["directions"] == response.json()["directions"]


def test_public_exhibition_entities_include_display_fields_and_image_fallbacks(tmp_path) -> None:
    with _client(tmp_path) as client:
        store = client.app.state.admin_store
        exhibitor = store.save_record(
            "exhibitors",
            {
                "id": "exhibitor-public",
                "exhibitionId": "expo-test",
                "name": "星河科技",
                "boothCode": "A-08",
                "category": "智能制造",
                "contact": "不应公开",
                "phone": "13800138000",
                "description": "## 企业简介\n\n![展厅](/scene-assets/exhibitor.jpg)\n\n专注智能制造。",
                "introductionKeywords": ["介绍星河科技"],
                "aliases": ["星河"],
                "fuzzyMatch": True,
                "spokenText": "星河科技专注智能制造解决方案。",
                "imageUrls": ["/scene-assets/exhibitor.jpg"],
            },
            "expo-test",
        )
        store.save_record(
            "exhibits",
            {"id": "exhibit-public", "exhibitionId": "expo-test", "exhibitorId": exhibitor["id"], "name": "智能导览终端", "modelNo": "DH-01", "description": "支持智能问答。"},
            "expo-test",
        )
        venue = store.save_record("venues", {"id": "venue-public", "exhibitionId": "expo-test", "name": "未来馆"}, "expo-test")
        point = store.save_record("points", {"id": "point-public", "exhibitionId": "expo-test", "venueId": venue["id"], "name": "互动体验区", "code": "P-01"}, "expo-test")
        store.save_record("schedules", {"id": "schedule-public", "exhibitionId": "expo-test", "venueId": venue["id"], "pointId": point["id"], "title": "数字人演示", "startAt": "2026-08-08T10:00", "endAt": "2026-08-08T11:00"}, "expo-test")

        response = client.get("/exhibitions/expo-test/entities")
        assert response.status_code == 200
        items = {item["id"]: item for item in response.json()["items"]}
        assert set(items) == {"expo-test", "exhibitor-public", "exhibit-public", "venue-public", "point-public", "schedule-public"}
        assert items["exhibitor-public"]["description"] == "企业简介 专注智能制造。"
        assert items["exhibitor-public"]["keywords"][:2] == ["星河科技", "A-08"]
        assert "介绍星河科技" in items["exhibitor-public"]["keywords"]
        assert "星河" in items["exhibitor-public"]["fuzzy_keywords"]
        assert items["exhibitor-public"]["spoken_text"] == "星河科技专注智能制造解决方案。"
        assert items["exhibit-public"]["image_urls"] == ["/scene-assets/exhibitor.jpg"]
        assert not any(detail["value"] == "13800138000" for item in items.values() for detail in item["details"])


def test_exhibit_survey_submission_creates_linked_lead(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        store = client.app.state.admin_store
        store.save_record("exhibitors", {"id": "exhibitor-survey", "exhibitionId": "expo-test", "name": "问卷展商"}, "expo-test")
        store.save_record("exhibits", {"id": "exhibit-survey", "exhibitionId": "expo-test", "exhibitorId": "exhibitor-survey", "name": "问卷展品", "description": "测试展品"}, "expo-test")

        created = client.post("/api/v1/admin/event/exhibits/exhibit-survey/survey", headers=headers)
        assert created.status_code == 200
        survey = created.json()
        assert survey["path"] == f"/survey/{survey['token']}"
        assert survey["submissionCount"] == 0

        public_form = client.get(f"/api/v1/public/exhibit-surveys/{survey['token']}")
        assert public_form.status_code == 200
        assert public_form.json()["exhibitName"] == "问卷展品"

        submitted = client.post(
            f"/api/v1/public/exhibit-surveys/{survey['token']}/submissions",
            json={"companyName": "采购单位", "contactName": "张三", "phone": "13800138000", "email": "", "intentSummary": "希望了解合作报价", "consent": True},
        )
        assert submitted.status_code == 200
        lead = store.get_record("leads", submitted.json()["leadId"])
        assert lead is not None
        assert lead["source"] == "exhibit_survey"
        assert lead["interestedExhibitIds"] == ["exhibit-survey"]
        assert lead["interestedExhibitorIds"] == ["exhibitor-survey"]
        assert lead["qrToken"] == survey["token"]

        refreshed = client.post("/api/v1/admin/event/exhibits/exhibit-survey/survey", headers=headers)
        assert refreshed.json()["token"] == survey["token"]
        assert refreshed.json()["submissionCount"] == 1


def test_shopping_strategy_uses_paginated_exhibit_ids(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        store = client.app.state.admin_store
        store.save_record("exhibits", {"id": "exhibit-shopping-test", "exhibitionId": "expo-test", "name": "导购展品"}, "expo-test")
        store.save_record("interaction_shopping", {"id": "shopping-test", "exhibitionId": "expo-test", "name": "导购策略"}, "expo-test")
        store.set_links("interaction_shopping", "shopping-test", "exhibits", ["exhibit-shopping-test"])
        response = client.get("/api/v1/admin/interaction/shopping-strategies/shopping-test/exhibits", params={"page": 1, "page_size": 1}, headers=headers)
        assert response.status_code == 200
        assert response.json()["items"][0]["selected"] is True
        saved = client.put("/api/v1/admin/interaction/shopping-strategies/shopping-test/exhibits", headers=headers, json={"ids": []})
        assert saved.status_code == 200
        assert saved.json()["selected_ids"] == []


def test_public_shopping_keyword_match_and_confirmed_registration(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        store = client.app.state.admin_store
        store.save_record(
            "exhibitors",
            {"id": "exhibitor-shopping-flow", "exhibitionId": "expo-test", "name": "星河智造", "boothCode": "A-08"},
            "expo-test",
        )
        store.save_record(
            "exhibits",
            {
                "id": "exhibit-shopping-flow",
                "exhibitionId": "expo-test",
                "exhibitorId": "exhibitor-shopping-flow",
                "name": "协作机器人工作站",
                "modelNo": "CR-2400",
                "description": "支持柔性生产线快速部署。",
            },
            "expo-test",
        )
        saved_strategy = client.post(
            "/api/v1/admin/interaction/shopping-strategies",
            headers=headers,
            json={
                "id": "shopping-flow",
                "exhibitionId": "expo-test",
                "name": "协作机器人导购",
                "tags": ["协作机器人", "柔性产线"],
                "aliases": ["机器人工作站"],
                "fuzzyMatch": True,
                "spokenText": "这款协作机器人适合柔性生产线。",
                "registrationPrompt": "需要登记获取方案吗？",
                "confirmKeywords": ["需要", "登记"],
                "declineKeywords": ["不需要", "暂不"],
                "status": "active",
            },
        )
        assert saved_strategy.status_code == 200
        assert saved_strategy.json()["aliases"] == ["机器人工作站"]
        linked = client.put(
            "/api/v1/admin/interaction/shopping-strategies/shopping-flow/exhibits",
            headers=headers,
            json={"ids": ["exhibit-shopping-flow"]},
        )
        assert linked.status_code == 200

        matched = client.post(
            "/exhibitions/expo-test/shopping/query",
            json={"text": "我想了解协作机器仁", "session_id": "session-shopping"},
        )
        assert matched.status_code == 200
        payload = matched.json()
        assert payload["matched"] is True
        assert payload["strategy_id"] == "shopping-flow"
        assert payload["spoken_text"] == "这款协作机器人适合柔性生产线。"
        assert payload["registration_prompt"] == "需要登记获取方案吗？"
        assert payload["related_entity_ids"] == ["exhibit-shopping-flow"]
        assert not store.get_record("exhibits", "exhibit-shopping-flow").get("surveyToken")

        rejected = client.post(
            "/exhibitions/expo-test/shopping/registration",
            json={"strategy_id": "shopping-flow", "session_id": "session-shopping", "confirmation_text": "我不需要登记"},
        )
        assert rejected.status_code == 409
        assert not store.get_record("exhibits", "exhibit-shopping-flow").get("surveyToken")

        registration = client.post(
            "/exhibitions/expo-test/shopping/registration",
            json={"strategy_id": "shopping-flow", "session_id": "session-shopping", "confirmation_text": "好的，需要登记"},
        )
        assert registration.status_code == 200
        assert registration.json()["path"].startswith("/survey/")
        assert store.get_record("exhibits", "exhibit-shopping-flow").get("surveyToken")

        unmatched = client.post(
            "/exhibitions/expo-test/shopping/query",
            json={"text": "卫生间在哪里", "session_id": "session-shopping"},
        )
        assert unmatched.json() == {"matched": False}


def test_admin_reads_and_failed_requests_are_audited(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        listed = client.get("/api/v1/admin/event/exhibitions", headers=headers)
        assert listed.status_code == 200
        missing = client.get("/api/v1/admin/event/exhibitions/missing", headers=headers)
        assert missing.status_code == 404
        audit = client.get("/api/v1/admin/audit-logs", params={"page": 1, "page_size": 100}, headers=headers)
        assert audit.status_code == 200
        paths = {item["path"] for item in audit.json()["items"]}
        assert "/api/v1/admin/event/exhibitions" in paths
        assert "/api/v1/admin/event/exhibitions/missing" in paths


def test_admin_monitor_reads_runtime_state(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        response = client.get("/api/v1/admin/ops/system", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["pid"] > 0
        assert payload["configuration"]["adminDatabase"] == str(tmp_path / "admin.sqlite3")
        assert any(item["id"] == "service-admin-db" for item in payload["services"])
        assert isinstance(payload["cpuPercent"], (int, float))


def test_llm_config_crud_masks_secret_and_activation_updates_runtime(tmp_path, monkeypatch) -> None:
    applied: list[dict[str, object]] = []

    async def fake_apply(_request, item):
        applied.append(item)
        return {"live_runners_refreshed": 2}

    monkeypatch.setattr(admin_routes, "_apply_llm_config", fake_apply)
    with _client(tmp_path) as client:
        headers = _login(client)
        permissions = client.get("/api/v1/auth/permissions", headers=headers).json()["codes"]
        assert "system:llm" in permissions
        assert "system:llm:write" in permissions

        created = client.post(
            "/api/v1/admin/llm-configs",
            headers=headers,
            json={
                "name": "测试百炼",
                "provider": "dashscope",
                "baseUrl": "https://dashscope.example.test/v1/",
                "model": "qwen-test",
                "apiKey": "secret-key",
                "systemPrompt": "测试提示词",
            },
        )
        assert created.status_code == 200
        created_payload = created.json()
        assert created_payload["apiKey"] == ""
        assert created_payload["apiKeyConfigured"] is True
        assert created_payload["baseUrl"] == "https://dashscope.example.test/v1"

        record_id = created_payload["id"]
        updated = client.patch(
            f"/api/v1/admin/llm-configs/{record_id}",
            headers=headers,
            json={
                "name": "测试百炼已更新",
                "provider": "dashscope",
                "baseUrl": "https://dashscope.example.test/v1",
                "model": "qwen-plus",
                "systemPrompt": "更新后的提示词",
            },
        )
        assert updated.status_code == 200
        stored = client.app.state.admin_store.get_record("llm_configs", record_id)
        assert stored["apiKey"] == "secret-key"

        activated = client.post(f"/api/v1/admin/llm-configs/{record_id}/activate", headers=headers)
        assert activated.status_code == 200
        assert activated.json()["isActive"] is True
        assert activated.json()["liveRunnersRefreshed"] == 2
        assert applied[0]["model"] == "qwen-plus"

        listed = client.get("/api/v1/admin/llm-configs", headers=headers)
        assert listed.status_code == 200
        assert listed.json()["items"][0]["apiKey"] == ""
        assert listed.json()["items"][0]["isActive"] is True
        assert client.delete(f"/api/v1/admin/llm-configs/{record_id}", headers=headers).status_code == 409


def test_llm_config_list_includes_effective_file_configuration_and_masks_keys(tmp_path) -> None:
    with _client(tmp_path) as client:
        settings = client.app.state.settings
        settings.llm_provider = "openai_compatible"
        settings.llm_base_url = "https://conversation.example.test/v1"
        settings.llm_api_key = "conversation-secret"
        settings.llm_model = "conversation-model"
        settings.llm_system_prompt = "主对话提示词"
        settings.agent_lightrag_llm_base_url = ""
        settings.agent_lightrag_llm_api_key = ""
        settings.agent_lightrag_llm_model = ""
        settings.memory_enabled = True
        settings.memory_mem0_llm_provider = "openai"
        settings.memory_mem0_llm_base_url = "https://memory.example.test/v1"
        settings.memory_mem0_llm_api_key = "memory-secret"
        settings.memory_mem0_llm_model = "memory-model"

        response = client.get("/api/v1/admin/llm-configs", headers=_login(client))
        assert response.status_code == 200
        payload = response.json()
        items = {item["id"]: item for item in payload["items"]}

        conversation = items["configured-conversation-llm"]
        assert conversation["usage"] == "conversation"
        assert conversation["source"] == "config"
        assert conversation["readOnly"] is True
        assert conversation["apiKey"] == ""
        assert conversation["apiKeyConfigured"] is True
        assert conversation["systemPrompt"] == "主对话提示词"

        knowledge = items["configured-knowledge-llm"]
        assert knowledge["usage"] == "knowledge"
        assert knowledge["baseUrl"] == conversation["baseUrl"]
        assert knowledge["model"] == conversation["model"]
        assert knowledge["apiKeyConfigured"] is True

        memory = items["configured-memory-llm"]
        assert memory["usage"] == "memory"
        assert memory["model"] == "memory-model"
        assert memory["apiKeyConfigured"] is True
        assert "conversation-secret" not in response.text
        assert "memory-secret" not in response.text


def test_llm_config_list_deduplicates_managed_record_matching_runtime(tmp_path) -> None:
    with _client(tmp_path) as client:
        settings = client.app.state.settings
        settings.llm_provider = "OpenAI_Compatible"
        settings.llm_base_url = "https://conversation.example.test/v1/"
        settings.llm_api_key = "conversation-secret"
        settings.llm_model = "Conversation-Model"
        store = client.app.state.admin_store
        store.save_record(
            "llm_configs",
            {
                "id": "llm-runtime-copy",
                "name": "数据库中的主模型",
                "provider": "openai_compatible",
                "baseUrl": "https://CONVERSATION.example.test/v1",
                "model": "conversation-model",
                "apiKey": "conversation-secret",
                "systemPrompt": "",
                "isActive": True,
            },
        )

        response = client.get("/api/v1/admin/llm-configs", headers=_login(client))
        assert response.status_code == 200
        items = response.json()["items"]
        conversation = [item for item in items if item["usage"] == "conversation"]
        assert len(conversation) == 1
        assert conversation[0]["id"] == "llm-runtime-copy"
        assert response.json()["total"] == len(items)
