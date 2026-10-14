"""Short-lived, anonymous phone-to-display question pairing."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from apps.api.admin.security import get_store
from apps.api.services import session_service

router = APIRouter(prefix="/remote-questions", tags=["remote-questions"])

PAIR_TTL_SECONDS = 12 * 60 * 60
MAX_QUEUED_QUESTIONS = 20
MAX_QUESTIONS_PER_MINUTE = 12


class PairRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    exhibition_id: str = Field(min_length=1, max_length=128)


class QuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class NextQuestionRequest(BaseModel):
    display_key: str = Field(min_length=64, max_length=64)


def _pair_key(token: str) -> str:
    return f"opentalking:remote-question:pair:{token}"


def _queue_key(token: str) -> str:
    return f"opentalking:remote-question:queue:{token}"


def _decode(value: bytes | str) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else value


async def _active_pair(request: Request, token: str) -> dict[str, str]:
    if len(token) != 32 or any(char not in "0123456789abcdef" for char in token):
        raise HTTPException(status_code=404, detail="二维码无效或已过期")
    raw = await request.app.state.redis.get(_pair_key(token))
    if not raw:
        raise HTTPException(status_code=404, detail="二维码无效或已过期")
    pair = json.loads(_decode(raw))
    session = await session_service.get_session(request.app.state.redis, pair["session_id"])
    if not session or session.get("state") in {"closed", "closing", "error"}:
        raise HTTPException(status_code=410, detail="数字人会话已结束，请重新扫码")
    return pair


@router.post("/pair")
async def create_pair(body: PairRequest, request: Request) -> dict[str, str | int]:
    store = get_store(request)
    if not store.get_record("exhibitions", body.exhibition_id):
        raise HTTPException(status_code=404, detail="展会不存在")
    session = await session_service.get_session(request.app.state.redis, body.session_id)
    if not session or session.get("state") in {"closed", "closing", "error"}:
        raise HTTPException(status_code=404, detail="数字人会话不存在")
    token = secrets.token_hex(16)
    display_key = secrets.token_hex(32)
    pair = {
        "session_id": body.session_id,
        "exhibition_id": body.exhibition_id,
        "display_key_sha256": hashlib.sha256(display_key.encode("ascii")).hexdigest(),
    }
    await request.app.state.redis.set(_pair_key(token), json.dumps(pair), ex=PAIR_TTL_SECONDS)
    return {"token": token, "display_key": display_key, "expires_in": PAIR_TTL_SECONDS}


@router.get("/{token}")
async def get_pair(token: str, request: Request) -> dict[str, str | bool]:
    pair = await _active_pair(request, token)
    exhibition = get_store(request).get_record("exhibitions", pair["exhibition_id"])
    return {"exhibition_name": str((exhibition or {}).get("name") or "展会数字人"), "online": True}


@router.post("/{token}/questions")
async def submit_question(token: str, body: QuestionRequest, request: Request) -> dict[str, str | int]:
    await _active_pair(request, token)
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="请输入问题")
    redis_client = request.app.state.redis
    rate_key = f"opentalking:remote-question:rate:{token}"
    count = await redis_client.incr(rate_key)
    if count == 1:
        await redis_client.expire(rate_key, 60)
    if count > MAX_QUESTIONS_PER_MINUTE:
        raise HTTPException(status_code=429, detail="提问太频繁，请稍后再试")
    queue_key = _queue_key(token)
    if await redis_client.llen(queue_key) >= MAX_QUEUED_QUESTIONS:
        raise HTTPException(status_code=429, detail="当前提问较多，请稍后再试")
    position = await redis_client.rpush(queue_key, question)
    await redis_client.expire(queue_key, PAIR_TTL_SECONDS)
    return {"status": "queued", "position": position}


@router.post("/{token}/next")
async def next_question(token: str, body: NextQuestionRequest, request: Request) -> dict[str, str | None]:
    pair = await _active_pair(request, token)
    supplied_hash = hashlib.sha256(body.display_key.encode("ascii", errors="ignore")).hexdigest()
    if not hmac.compare_digest(supplied_hash, pair["display_key_sha256"]):
        raise HTTPException(status_code=403, detail="无权读取提问")
    raw = await request.app.state.redis.lpop(_queue_key(token))
    return {"question": _decode(raw) if raw else None}
