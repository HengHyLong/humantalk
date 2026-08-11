from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from apps.api.admin.security import get_store
from apps.api.services import session_service
from apps.api.services.exhibition_qa import (
    DifyKnowledgeRetriever,
    ExhibitionQaService,
    LocalKnowledgeRetriever,
    KnowledgeRetrievalError,
    RetrievalResult,
    parse_dataset_map,
)
from opentalking.agent.context_builder import default_knowledge_store


router = APIRouter(prefix="/exhibitions", tags=["exhibition-qa"])


class _MisconfiguredRetriever:
    async def retrieve(self, *, exhibition_id: str, question: str) -> RetrievalResult:
        del exhibition_id, question
        raise KnowledgeRetrievalError("Dify dataset and API key must be configured together")


class QaQueryRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    turn_id: str = Field(min_length=1, max_length=128)
    question: str = Field(min_length=1, max_length=500)
    locale: str = Field(default="zh-CN", max_length=32)
    voice: str | None = None
    tts_provider: str | None = None
    tts_model: str | None = None


class QaSourceResponse(BaseModel):
    id: str
    title: str
    excerpt: str
    score: float
    document_id: str | None = None


class QaQueryResponse(BaseModel):
    session_id: str
    exhibition_id: str
    turn_id: str
    trace_id: str
    status: Literal["queued"] = "queued"
    match_type: Literal[
        "official_qa", "rag", "clarification", "fallback", "retrieval_error", "blocked"
    ]
    speak_mode: Literal["direct", "agent"]
    answer: str | None = None
    need_clarification: bool = False
    clarification_question: str | None = None
    sources: list[QaSourceResponse] = Field(default_factory=list)
    score: float | None = None
    error_code: str | None = None


def _setting(settings: object, name: str, default: object) -> object:
    return getattr(settings, name, default)


def _resolve_exhibition_id(store: object, exhibition_id: str) -> str:
    if exhibition_id != "current":
        return exhibition_id
    items = getattr(store, "list_records")("exhibitions")
    current = next(
        (
            item
            for item in items
            if item.get("isCurrent") or item.get("is_current") or item.get("status") == "operating"
        ),
        None,
    )
    if current is None:
        raise HTTPException(status_code=404, detail="current exhibition not found")
    return str(current["id"])


def _resolve_dataset_id(settings: object, store: object, exhibition_id: str) -> str:
    mapping = parse_dataset_map(str(_setting(settings, "dify_dataset_map", "{}") or "{}"))
    if mapping.get(exhibition_id):
        return mapping[exhibition_id]
    exhibition = getattr(store, "get_record")("exhibitions", exhibition_id) or {}
    for key in ("difyDatasetId", "dify_dataset_id", "datasetId", "dataset_id"):
        if exhibition.get(key):
            return str(exhibition[key])
    for knowledge_base in getattr(store, "list_records")(
        "knowledge_bases", exhibition_id=exhibition_id
    ):
        for key in ("difyDatasetId", "dify_dataset_id", "datasetId", "dataset_id"):
            if knowledge_base.get(key):
                return str(knowledge_base[key])
    return str(_setting(settings, "dify_default_dataset_id", "") or "").strip()


def _resolve_local_kb_ids(store: object, exhibition_id: str) -> list[str]:
    ids: list[str] = []
    for item in getattr(store, "list_records")("knowledge_bases", exhibition_id=exhibition_id):
        value = str(item.get("localKnowledgeBaseId") or item.get("id") or "").strip()
        if value and value not in ids:
            ids.append(value)
    return ids


@router.post("/{exhibition_id}/qa/query", response_model=QaQueryResponse)
async def query_exhibition_qa(
    exhibition_id: str,
    body: QaQueryRequest,
    request: Request,
) -> QaQueryResponse:
    store = get_store(request)
    resolved_exhibition_id = _resolve_exhibition_id(store, exhibition_id)
    if not store.get_record("exhibitions", resolved_exhibition_id):
        raise HTTPException(status_code=404, detail="exhibition not found")

    redis_client = getattr(request.app.state, "redis", None)
    if redis_client is not None:
        session = await session_service.get_session(redis_client, body.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="session not found")

    settings = getattr(request.app.state, "settings", object())
    dataset_id = _resolve_dataset_id(settings, store, resolved_exhibition_id)
    dify_key = str(_setting(settings, "dify_api_key", "") or "").strip()
    if bool(dataset_id) != bool(dify_key):
        retriever = _MisconfiguredRetriever()
    elif dataset_id and dify_key:
        retriever = DifyKnowledgeRetriever(
            base_url=str(_setting(settings, "dify_base_url", "https://api.dify.ai/v1")),
            api_key=dify_key,
            dataset_id=dataset_id,
            timeout_sec=float(_setting(settings, "dify_timeout_sec", 12.0)),
            top_k=int(_setting(settings, "qa_retrieval_top_k", 3)),
            score_threshold=float(_setting(settings, "qa_retrieval_score_threshold", 0.45)),
        )
    else:
        retriever = LocalKnowledgeRetriever(
            default_knowledge_store(),
            _resolve_local_kb_ids(store, resolved_exhibition_id),
        )

    trace_id = str(getattr(request.state, "trace_id", "") or f"trace-{uuid.uuid4().hex[:16]}")
    service = ExhibitionQaService(
        store=store,
        retriever=retriever,
        fuzzy_threshold=float(_setting(settings, "qa_fuzzy_threshold", 0.74)),
        human_channel=str(
            _setting(
                settings,
                "qa_human_channel",
                "请前往现场服务台或咨询工作人员获取帮助。",
            )
        ),
    )
    decision = await service.query(
        exhibition_id=resolved_exhibition_id,
        question=body.question,
        turn_id=body.turn_id,
        trace_id=trace_id,
    )

    speech_text = decision.answer if decision.speak_mode == "direct" else body.question
    if redis_client is not None and speech_text:
        await session_service.speak(
            redis_client,
            body.session_id,
            speech_text,
            voice=body.voice,
            tts_provider=body.tts_provider,
            tts_model=body.tts_model,
            direct=decision.speak_mode == "direct",
            knowledge_context=decision.knowledge_context,
            turn_id=body.turn_id,
            trace_id=trace_id,
        )

    return QaQueryResponse(
        session_id=body.session_id,
        exhibition_id=resolved_exhibition_id,
        turn_id=body.turn_id,
        trace_id=trace_id,
        match_type=decision.match_type,  # type: ignore[arg-type]
        speak_mode=decision.speak_mode,  # type: ignore[arg-type]
        answer=decision.answer,
        need_clarification=decision.need_clarification,
        clarification_question=decision.clarification_question,
        sources=[
            QaSourceResponse(
                id=source.id,
                title=source.title,
                excerpt=source.content[:300],
                score=source.score,
                document_id=source.document_id,
            )
            for source in decision.sources
        ],
        score=decision.score,
        error_code=decision.error_code,
    )
