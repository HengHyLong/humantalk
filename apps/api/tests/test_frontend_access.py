from types import SimpleNamespace

import jwt
import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient

from apps.api.admin import AdminStore
from apps.api.admin.routes import router as existing_admin_router
from apps.api.services.frontend_access import COOKIE, FrontendAccessMiddleware, access_record, admin_router, router


def client_for(tmp_path):
    app = FastAPI()
    app.state.settings = SimpleNamespace(admin_jwt_secret="frontend-test-secret-long-enough", admin_access_token_minutes=30, admin_refresh_token_days=7)
    app.state.admin_store = AdminStore(tmp_path / "access.sqlite3")
    app.add_middleware(FrontendAccessMiddleware)
    app.include_router(router)
    app.include_router(admin_router)
    app.include_router(existing_admin_router)

    @app.get("/models")
    def models():
        return {"ok": True}

    @app.get("/api/v1/public/exhibit-surveys/test")
    def survey():
        return {"public": True}

    @app.get("/remote-questions/test")
    def remote_question_info():
        return {"public": True}

    @app.post("/remote-questions/test/questions")
    def remote_question_submit():
        return {"public": True}

    @app.post("/remote-questions/pair")
    def remote_question_pair():
        return {"private": True}

    @app.post("/remote-questions/test/next")
    def remote_question_next():
        return {"private": True}

    @app.websocket("/sessions/test/stt")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_text("ok")
        await websocket.close()

    return TestClient(app)


def admin_headers(client):
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin@123456"})
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.json()["token"]}


def test_default_password_server_guard_and_private_cookie(tmp_path):
    with client_for(tmp_path) as client:
        assert client.get("/models").status_code == 401
        assert client.get("/docs").status_code == 401
        assert client.get("/frontend-access/status").json() == {"authenticated": False}
        assert client.post("/frontend-access/login", json={"password": "wrong"}).status_code == 401
        response = client.post("/frontend-access/login", json={"password": "10528"})
        assert response.status_code == 200
        assert "HttpOnly" in response.headers["set-cookie"]
        assert "max-age" not in response.headers["set-cookie"].lower()
        assert "expires=" not in response.headers["set-cookie"].lower()
        assert "samesite=lax" in response.headers["set-cookie"].lower()
        assert "10528" not in response.text and "10528" not in response.headers["set-cookie"]
        assert client.get("/models").status_code == 200
        assert client.get("/frontend-access/status").json()["authenticated"]
        client.post("/frontend-access/logout")
        assert client.get("/models").status_code == 401


def test_admin_rotation_revokes_old_sessions_and_persists(tmp_path):
    with client_for(tmp_path) as client:
        headers = admin_headers(client)
        assert client.get("/models", headers=headers).status_code == 200
        assert client.get("/api/v1/admin/frontend-access", headers=headers).status_code == 200
        cookie = client.cookies.get(COOKIE)
        assert client.put("/api/v1/admin/frontend-access", json={"password": "new-password"}).status_code == 401
        response = client.put("/api/v1/admin/frontend-access", json={"password": "new-password"}, headers=headers)
        assert response.status_code == 200 and "password_hash" not in response.text
        client.cookies.set(COOKIE, cookie)
        assert client.get("/models").status_code == 401
        assert client.post("/frontend-access/login", json={"password": "10528"}).status_code == 401
        assert client.post("/frontend-access/login", json={"password": "new-password"}).status_code == 200
    with client_for(tmp_path) as client:
        assert client.post("/frontend-access/login", json={"password": "new-password"}).status_code == 200


def test_rate_limit_surveys_and_websocket_guard(tmp_path):
    with client_for(tmp_path) as client:
        assert client.get("/api/v1/public/exhibit-surveys/test").status_code == 200
        assert client.get("/remote-questions/test").status_code == 200
        assert client.post("/remote-questions/test/questions").status_code == 200
        assert client.post("/remote-questions/pair").status_code == 401
        assert client.post("/remote-questions/test/next").status_code == 401
        from starlette.websockets import WebSocketDisconnect
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect("/sessions/test/stt"):
                pass
        assert exc.value.code == 4401
        for _ in range(5):
            assert client.post("/frontend-access/login", json={"password": "wrong"}).status_code == 401
        assert client.post("/frontend-access/login", json={"password": "10528"}).status_code == 429


def test_expired_forged_tokens_and_read_only_admin(tmp_path):
    with client_for(tmp_path) as client:
        client.post("/frontend-access/login", json={"password": "10528"})
        record = access_record(SimpleNamespace(app=client.app))
        assert record["password_hash"].startswith("$argon2")
        expired = jwt.encode({"type": "frontend-access", "iat": 1, "exp": 2}, record["password_hash"], algorithm="HS256")
        client.cookies.clear()
        client.cookies.set(COOKIE, expired)
        assert client.get("/models").status_code == 401
        client.cookies.set(COOKIE, "forged")
        assert client.get("/models").status_code == 401
        headers = admin_headers(client)
        with client.app.state.admin_store.connect() as conn:
            conn.execute("DELETE FROM admin_role_permissions WHERE permission_id IN (SELECT id FROM admin_permissions WHERE code='system:llm:write')")
        assert client.put("/api/v1/admin/frontend-access", json={"password": "cannot-change"}, headers=headers).status_code == 403


def test_browser_session_has_no_time_limit_and_legacy_cookie_is_rejected(tmp_path):
    with client_for(tmp_path) as client:
        client.post("/frontend-access/login", json={"password": "10528"})
        record = access_record(SimpleNamespace(app=client.app))
        payload = jwt.decode(client.cookies.get(COOKIE), record["password_hash"], algorithms=["HS256"])
        assert "exp" not in payload
        payload["iat"] = 1
        client.cookies.clear()
        client.cookies.set(COOKIE, jwt.encode(payload, record["password_hash"], algorithm="HS256"))
        assert client.get("/models").status_code == 200
        assert client.get("/frontend-access/status").json()["authenticated"]
        client.cookies.jar.clear_session_cookies()
        assert client.get("/models").status_code == 401
        legacy = jwt.encode({"type": "frontend-access", "iat": 1, "exp": 9999999999}, record["password_hash"], algorithm="HS256")
        client.cookies.set(COOKIE, legacy)
        assert client.get("/models").status_code == 401
