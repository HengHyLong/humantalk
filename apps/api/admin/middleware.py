from __future__ import annotations

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class AdminTraceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if not (request.url.path.startswith("/api/v1/admin") or request.url.path.startswith("/api/v1/ops")):
            return await call_next(request)
        trace_id = request.headers.get("X-Trace-Id") or f"trace-{uuid.uuid4().hex[:16]}"
        request.state.trace_id = trace_id
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Trace-Id"] = trace_id
        response.headers["X-Request-Duration-Ms"] = str(round((time.perf_counter() - started) * 1000))
        return response
