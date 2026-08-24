from __future__ import annotations

import json
from pathlib import Path
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from apps.api.admin.security import get_store
from apps.api.services import session_service
from apps.api.services.exhibition_qa import (
    DifyKnowledgeRetriever,
    AdminKnowledgeRetriever,
    DifyKnowledgeTarget,
    ExhibitionQaService,
    LocalKnowledgeRetriever,
    KnowledgeRetrievalError,
    RetrievalResult,
    parse_dataset_map,
    parse_dataset_ids_map,
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
    knowledge_base_ids: list[str] | None = Field(default=None, max_length=16)


class QaSourceResponse(BaseModel):
    id: str
    title: str
    excerpt: str
    score: float
    document_id: str | None = None
    knowledge_base_id: str | None = None
    namespace_id: str | None = None


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


def _resolve_dify_connection(settings: object) -> tuple[str, str]:
    """Prefer the Agent Dify pair used by knowledge management and direct RAG."""

    agent_base_url = str(_setting(settings, "agent_dify_base_url", "") or "").strip()
    agent_api_key = str(_setting(settings, "agent_dify_api_key", "") or "").strip()
    legacy_base_url = str(_setting(settings, "dify_base_url", "") or "").strip()
    legacy_api_key = str(_setting(settings, "dify_api_key", "") or "").strip()
    return (
        agent_base_url or legacy_base_url or "https://api.dify.ai/v1",
        agent_api_key or legacy_api_key,
    )


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


def _clean_ids(value: object) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        values = value
    elif value is None:
        values = []
    else:
        values = [value]
    result: list[str] = []
    for item in values:
        clean = str(item or "").strip()
        if clean and clean not in result:
            result.append(clean)
    return result


def _session_knowledge_base_ids(session: dict[str, object]) -> list[str]:
    raw = session.get("knowledge_base_ids")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = []
    ids = _clean_ids(raw)
    if ids:
        return ids
    return _clean_ids(session.get("knowledge_base_id"))


def _record_value(record: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = str(record.get(key, "") or "").strip()
        if value:
            return value
    return ""


def _record_exhibition_ids(record: dict[str, object]) -> list[str]:
    raw = record.get("exhibition_ids", record.get("exhibitionIds"))
    result = _clean_ids(raw)
    legacy = _record_value(record, "exhibition_id", "exhibitionId")
    if legacy and legacy not in result:
        result.insert(0, legacy)
    return result


def _load_dify_registry(settings: object) -> dict[str, dict[str, object]]:
    raw = str(_setting(settings, "agent_dify_knowledge_base_registry", "") or "").strip()
    registry_path = str(_setting(settings, "agent_dify_registry_path", "") or "").strip()
    if not registry_path and hasattr(settings, "agent_knowledge_root"):
        knowledge_root = str(
            _setting(settings, "agent_knowledge_root", "./data/knowledge")
            or "./data/knowledge"
        ).strip()
        registry_path = str(Path(knowledge_root) / "knowledge_base_registry.json")
    if not raw and registry_path:
        try:
            raw = Path(registry_path).read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            raw = ""
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    result: dict[str, dict[str, object]] = {}
    for key, value in payload.items():
        if not isinstance(value, dict):
            continue
        kb_id = _record_value(value, "knowledge_base_id", "knowledgeBaseId") or str(key).strip()
        dataset_id = _record_value(value, "dify_dataset_id", "dataset_id", "datasetId")
        if not kb_id or not dataset_id:
            continue
        result[kb_id] = {
            "knowledge_base_id": kb_id,
            "dify_dataset_id": dataset_id,
            "exhibition_id": _record_value(value, "exhibition_id", "exhibitionId"),
            "exhibition_ids": _record_exhibition_ids(value),
            "namespace_id": _record_value(value, "namespace_id", "namespaceId"),
        }
    return result


def _resolve_dify_targets(
    settings: object,
    store: object,
    exhibition_id: str,
    requested_kb_ids: list[str],
) -> list[DifyKnowledgeTarget]:
    """Resolve logical KB IDs to server-side Dify datasets for one exhibition."""
    known: dict[str, DifyKnowledgeTarget] = {}
    mismatched: set[str] = set()

    def add_record(record: dict[str, object], *, require_exhibition: bool = False) -> None:
        kb_id = _record_value(record, "knowledge_base_id", "knowledgeBaseId", "id")
        dataset_id = _record_value(record, "dify_dataset_id", "difyDatasetId", "dataset_id", "datasetId")
        if not kb_id or not dataset_id:
            return
        record_exhibition_ids = _record_exhibition_ids(record)
        if record_exhibition_ids and exhibition_id not in record_exhibition_ids:
            if kb_id in requested_kb_ids:
                mismatched.add(kb_id)
            return
        if require_exhibition and not record_exhibition_ids:
            return
        known.setdefault(
            kb_id,
            DifyKnowledgeTarget(
                dataset_id=dataset_id,
                knowledge_base_id=kb_id,
                namespace_id=_record_value(record, "namespace_id", "namespaceId") or None,
            ),
        )

    for record in getattr(store, "list_records")("knowledge_bases", exhibition_id=exhibition_id):
        if isinstance(record, dict):
            add_record(record)

    for record in _load_dify_registry(settings).values():
        add_record(record, require_exhibition=not bool(requested_kb_ids))

    configured_exhibition_id = str(
        _setting(settings, "agent_dify_default_exhibition_id", "") or ""
    ).strip()
    agent_map = parse_dataset_ids_map(
        str(_setting(settings, "agent_dify_dataset_map", "") or "")
    )
    if configured_exhibition_id == exhibition_id:
        for kb_id, dataset_ids in agent_map.items():
            for dataset_id in dataset_ids:
                known.setdefault(
                    kb_id,
                    DifyKnowledgeTarget(dataset_id=dataset_id, knowledge_base_id=kb_id),
                )
                break

    default_kb_id = str(_setting(settings, "agent_dify_knowledge_base_id", "") or "").strip()
    default_dataset_id = str(_setting(settings, "agent_dify_dataset_id", "") or "").strip()
    if (
        default_kb_id
        and default_dataset_id
        and (default_kb_id in requested_kb_ids or configured_exhibition_id == exhibition_id)
    ):
        known.setdefault(
            default_kb_id,
            DifyKnowledgeTarget(dataset_id=default_dataset_id, knowledge_base_id=default_kb_id),
        )

    if requested_kb_ids:
        if mismatched:
            raise HTTPException(
                status_code=409,
                detail=f"知识库不属于当前展会: {', '.join(sorted(mismatched))}",
            )
        missing = [kb_id for kb_id in requested_kb_ids if kb_id not in known]
        if missing:
            raise HTTPException(status_code=404, detail=f"知识库不存在: {', '.join(missing)}")
        return [known[kb_id] for kb_id in requested_kb_ids]

    targets = list(known.values())
    exhibition_map = parse_dataset_ids_map(
        str(_setting(settings, "dify_dataset_map", "") or "")
    )
    targets.extend(
        DifyKnowledgeTarget(dataset_id=dataset_id)
        for dataset_id in exhibition_map.get(exhibition_id, [])
    )
    if not targets:
        fallback_dataset_id = _resolve_dataset_id(settings, store, exhibition_id)
        if fallback_dataset_id:
            targets.append(DifyKnowledgeTarget(dataset_id=fallback_dataset_id))

    unique: list[DifyKnowledgeTarget] = []
    seen: set[tuple[str, str | None]] = set()
    for target in targets:
        key = (target.dataset_id, target.knowledge_base_id)
        if key not in seen:
            unique.append(target)
            seen.add(key)
    return unique


def _resolve_query_dify_targets(
    settings: object,
    store: object,
    exhibition_id: str,
    explicit_kb_ids: list[str],
    session: dict[str, object] | None,
) -> list[DifyKnowledgeTarget]:
    """Resolve QA targets without leaking a previous exhibition's session state.

    Browser sessions and avatar preferences can outlive an exhibition switch. An
    explicit request remains strict, while implicit session selections are only
    applied when they belong to the current exhibition. If none of the stored
    IDs are in scope, all knowledge bases bound to the exhibition are used.
    """

    if explicit_kb_ids:
        return _resolve_dify_targets(settings, store, exhibition_id, explicit_kb_ids)

    exhibition_targets = _resolve_dify_targets(settings, store, exhibition_id, [])
    if session is None:
        return exhibition_targets

    session_ids = _session_knowledge_base_ids(session)
    if not session_ids:
        return exhibition_targets
    targets_by_id = {
        target.knowledge_base_id: target
        for target in exhibition_targets
        if target.knowledge_base_id
    }
    scoped_targets = [targets_by_id[item] for item in session_ids if item in targets_by_id]
    return scoped_targets or exhibition_targets


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
    session: dict[str, object] | None = None
    if redis_client is not None:
        session = await session_service.get_session(redis_client, body.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="session not found")

    settings = getattr(request.app.state, "settings", object())
    explicit_kb_ids = list(body.knowledge_base_ids or [])
    dify_targets = _resolve_query_dify_targets(
        settings,
        store,
        resolved_exhibition_id,
        explicit_kb_ids,
        session,
    )
    dify_base_url, dify_key = _resolve_dify_connection(settings)
    if bool(dify_targets) != bool(dify_key):
        retriever = _MisconfiguredRetriever()
    elif dify_targets and dify_key:
        retriever = DifyKnowledgeRetriever(
            base_url=dify_base_url,
            api_key=dify_key,
            targets=dify_targets,
            timeout_sec=float(_setting(settings, "dify_timeout_sec", 12.0)),
            top_k=int(_setting(settings, "qa_retrieval_top_k", 3)),
            score_threshold=float(_setting(settings, "qa_retrieval_score_threshold", 0.45)),
        )
    else:
        local_kb_ids = _resolve_local_kb_ids(store, resolved_exhibition_id)
        imported_documents = store.list_records("documents", exhibition_id=resolved_exhibition_id)
        # Event-import packages may contain published document text but no
        # separately built vector index. Prefer that deterministic local
        # fallback whenever such documents are present; otherwise retain the
        # existing KnowledgeStore behavior for explicitly bound local KBs.
        retriever = (
            AdminKnowledgeRetriever(store)
            if imported_documents
            else LocalKnowledgeRetriever(default_knowledge_store(), local_kb_ids)
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
                knowledge_base_id=source.knowledge_base_id,
                namespace_id=source.namespace_id,
            )
            for source in decision.sources
        ],
        score=decision.score,
        error_code=decision.error_code,
    )
