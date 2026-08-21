from __future__ import annotations

import os
import logging
from contextlib import asynccontextmanager

import redis.asyncio as redis
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from apps.api.core.config import get_settings
from apps.api.admin import AdminStore
from apps.api.admin.middleware import AdminTraceMiddleware
from apps.api.admin.routes import public_router as admin_public_router
from apps.api.admin.routes import router as admin_router
from apps.api.routes import agent, avatars, events, exports, health, knowledge_proxy, memory, models, personas, qa, runtime_config, scene_assets, sessions, tts_preview, video_clone, video_creation, voices
from opentalking.voice.store import init_voice_store


class AppError(Exception):
    """A safe, user-facing application error with no implementation details."""

    def __init__(self, message: str, code: str = "APP_ERROR", status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


def _trace_id(request: Request) -> str:
    return str(getattr(request.state, "trace_id", "") or f"trace-{os.urandom(8).hex()}")


_SAFE_BUSINESS_MESSAGES = {
    "EMPTY_FILE": "不能上传空文件",
    "FILES_REQUIRED": "至少选择一张图片",
    "TOO_MANY_FILES": "一次最多上传 20 张图片",
    "FILE_TOO_LARGE": "文件不能超过平台限制",
    "UNSUPPORTED_FILE": "文件格式不受支持，请上传平台要求的文件类型",
    "UNSUPPORTED_RESOURCE": "不支持该资源类型",
    "IMPORT_FILE_INVALID": "导入文件无法解析，请检查模板和文件内容后重试",
    "IMPORT_BATCH_NOT_FOUND": "导入批次不存在或已过期",
    "IMPORT_HAS_ERRORS": "导入存在错误，修复后请重新上传",
    "WAKE_WINDOW_INVALID": "休眠时间必须为整数",
}


def _safe_http_message(status_code: int, detail: object) -> tuple[str, str]:
    if status_code == 401:
        return "AUTH_REQUIRED", "登录状态已失效，请重新登录"
    if status_code == 403:
        return "FORBIDDEN", "当前账号没有权限执行此操作"
    if status_code == 404:
        return "NOT_FOUND", "数据不存在或已被删除"
    if status_code == 409:
        return "CONFLICT", "数据已发生变化，请刷新后重试"
    if status_code == 422:
        return "VALIDATION_ERROR", "请求参数不正确，请检查后重试"
    if status_code >= 500:
        return "INTERNAL_ERROR", "系统暂时无法完成操作，请稍后重试"
    if isinstance(detail, dict):
        code = str(detail.get("code") or "REQUEST_ERROR")
        if code in _SAFE_BUSINESS_MESSAGES:
            return code, _SAFE_BUSINESS_MESSAGES[code]
        return code, "请求未完成，请检查输入后重试"
    return "REQUEST_ERROR", "请求未完成，请稍后重试"


async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message, "request_id": _trace_id(request)})


async def _http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    code, message = _safe_http_message(exc.status_code, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"code": code, "message": message, "request_id": _trace_id(request)})


async def _validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"code": "VALIDATION_ERROR", "message": "请求参数不正确，请检查后重试", "request_id": _trace_id(request)})


async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    log = logging.getLogger("opentalking.api")
    log.exception("unhandled request exception trace_id=%s method=%s path=%s", _trace_id(request), request.method, request.url.path)
    return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "系统暂时无法完成操作，请稍后重试", "request_id": _trace_id(request)})


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_voice_store()
    settings = get_settings()
    app.state.settings = settings
    if settings.admin_api_enabled:
        app.state.admin_store = AdminStore(settings.admin_sqlite_path, settings.admin_initialize_defaults)
    r = redis.from_url(settings.redis_url, decode_responses=True)
    app.state.redis = r
    yield
    await r.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="OpenTalking API", lifespan=lifespan)
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(HTTPException, _http_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(Exception, _unhandled_error_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(AdminTraceMiddleware)
    app.include_router(health.router)
    app.include_router(models.router)
    app.include_router(avatars.router)
    app.include_router(memory.router)
    app.include_router(sessions.router)
    app.include_router(qa.router)
    app.include_router(agent.router)
    app.include_router(agent.router, prefix="/api")
    app.include_router(personas.router)
    app.include_router(events.router)
    app.include_router(exports.router)
    app.include_router(scene_assets.router)
    app.include_router(runtime_config.router)
    app.include_router(tts_preview.router)
    app.include_router(video_clone.router)
    app.include_router(video_creation.router)
    app.include_router(voices.router)
    # Register specific knowledge proxy routes before the generic Admin
    # collection routes (which also match /api/v1/admin/knowledge/{resource}).
    app.include_router(knowledge_proxy.router)
    app.include_router(admin_router)
    app.include_router(admin_public_router)
    return app


def main() -> None:
    settings = get_settings()
    host = os.environ.get("OPENTALKING_API_HOST", settings.api_host)
    port = int(os.environ.get("OPENTALKING_API_PORT", str(settings.api_port)))
    uvicorn.run(
        "apps.api.main:create_app",
        host=host,
        port=port,
        factory=True,
    )


if __name__ == "__main__":
    main()
