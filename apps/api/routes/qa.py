from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from apps.api.admin.security import get_store
from apps.api.services import session_service
from apps.api.services.vidu_service import ViduServiceError, ViduSessionManager
from apps.api.services.exhibition_qa import (
    DifyKnowledgeTarget,
    KnowledgeRetrievalError,
    RetrievalResult,
    parse_dataset_map,
    parse_dataset_ids_map,
)
from opentalking.runtime.bus import publish_event
from apps.api.services.dify_chat import DifyChatClient, DifyChatError, turns_for, turn_key, same_turn, save_context
from apps.api.services.exhibition_lookup import lookup, database_answer, service_answer


router = APIRouter(prefix="/exhibitions", tags=["exhibition-qa"])
log = logging.getLogger(__name__)

_VIDU_HISTORY_TTL_SEC = 24 * 60 * 60
_VIDU_HISTORY_MAX_MESSAGES = 12


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
    selected_entity_id: str | None = Field(default=None, max_length=128)
    origin_point_id: str | None = Field(default=None, max_length=128)


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
    status: Literal["queued", "cancelled"] = "queued"
    match_type: Literal[
        "official_qa", "rag", "clarification", "fallback", "retrieval_error", "blocked", "database", "dify"
    ]
    speak_mode: Literal["direct", "agent"]
    answer: str | None = None
    need_clarification: bool = False
    clarification_question: str | None = None
    sources: list[QaSourceResponse] = Field(default_factory=list)
    score: float | None = None
    error_code: str | None = None
    related_entities: list[dict] = Field(default_factory=list)
    navigation: dict | None = None
    retrieval_status: str | None = None
    routing_reason: str | None = None
    registration: dict | None = None


def _setting(settings: object, name: str, default: object) -> object:
    return getattr(settings, name, default)


def _vidu_history_key(session_id: str) -> str:
    return f"opentalking:vidu:dialogue:{session_id}"


async def _load_vidu_history(redis_client: object, session_id: str) -> list[dict[str, str]]:
    getter = getattr(redis_client, "get", None)
    if not callable(getter):
        return []
    try:
        raw = await getter(_vidu_history_key(session_id))
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        payload = json.loads(str(raw)) if raw else []
    except Exception:  # noqa: BLE001
        log.warning("Failed to load Vidu dialogue history: session=%s", session_id, exc_info=True)
        return []
    if not isinstance(payload, list):
        return []
    history: list[dict[str, str]] = []
    for item in payload[-_VIDU_HISTORY_MAX_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            history.append({"role": role, "content": content})
    return history


async def _save_vidu_history(
    redis_client: object,
    session_id: str,
    history: list[dict[str, str]],
) -> None:
    setter = getattr(redis_client, "set", None)
    if not callable(setter):
        return
    try:
        await setter(
            _vidu_history_key(session_id),
            json.dumps(history[-_VIDU_HISTORY_MAX_MESSAGES:], ensure_ascii=False),
            ex=_VIDU_HISTORY_TTL_SEC,
        )
    except Exception:  # noqa: BLE001
        log.warning("Failed to save Vidu dialogue history: session=%s", session_id, exc_info=True)


def _get_vidu_manager(request: Request) -> ViduSessionManager:
    manager = getattr(request.app.state, "vidu_sessions", None)
    if not isinstance(manager, ViduSessionManager):
        manager = ViduSessionManager(request.app.state.settings)
        request.app.state.vidu_sessions = manager
    return manager


async def _finish_vidu_answer(redis_client: object, session_id: str, text: str, turn_token: str | None = None) -> None:
    duration = min(30.0, max(2.5, len(text.strip()) / 5.5 + 1.2))
    await asyncio.sleep(duration)
    if turn_token and not await same_turn(redis_client, session_id, turn_token):
        return
    record = await session_service.get_session(redis_client, session_id)
    if not record or str(record.get("state") or "") in {"closed", "closing", "error"}:
        return
    await session_service.update_session_state(redis_client, session_id, "ready")
    await publish_event(redis_client, session_id, "speech.ended", {"text": text})


async def _speak_vidu_answer(
    *,
    request: Request,
    redis_client: object,
    session_id: str,
    text: str,
    turn_token: str | None = None,
) -> None:
    if turn_token and not await same_turn(redis_client, session_id, turn_token):
        return
    await session_service.update_session_state(redis_client, session_id, "speaking")
    await publish_event(redis_client, session_id, "speech.started", {"text": text, "direct": True})
    await publish_event(redis_client, session_id, "subtitle.chunk", {"text": text})
    try:
        await _get_vidu_manager(request).send_text(session_id, text)
    except ViduServiceError:
        await session_service.update_session_state(redis_client, session_id, "error")
        await publish_event(
            redis_client,
            session_id,
            "error",
            {"code": "VIDU_SEND_FAILED", "message": "数字人播报暂时不可用"},
        )
        raise
    asyncio.create_task(_finish_vidu_answer(redis_client, session_id, text, turn_token))


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


_EVENT_NOUN = r"(?:博览会|展览会|大会|展会|会议|会展|论坛|展览|活动)"
_EVENT_REFERENCE = re.compile(
    rf"(?:这|那)(?:一)?(?:个|场|届|次)?{_EVENT_NOUN}"
    r"|(?:这|那)(?:一)?(?:个|场|届|次)会"
    rf"|(?:本|当)届(?:的)?(?:{_EVENT_NOUN}|会)?"
    rf"|(?:本|当)(?:次|场)(?:的)?(?:{_EVENT_NOUN}|会)"
    rf"|(?:当前|今年的?|你们(?:现在)?的?|咱们(?:现在)?的?"
    rf"|我们(?:现在)?的?|贵)(?:{_EVENT_NOUN})"
    rf"|(?:^|[，,。？?\s]|介绍(?:一下|下)?|说说|讲讲|聊聊|了解(?:一下)?"
    rf"|请问|关于|咨询(?:一下)?|问问)(?:{_EVENT_NOUN})"
)
_EVENT_QUESTION = re.compile(
    r"举办|举行|召开|开幕|闭幕|会期|议程|主办|承办|参会|参展|报名|门票|展馆|会场"
    r"|(?:几号|何时|什么时候|啥时候)开(?:始|展|幕|会|办|[？?。]|$)"
    r"|(?:几号|几点|什么时候|啥时候)(?:开始|结束)|(?:在哪|哪里|哪儿)办"
    r"|开几天|持续几天|从.{0,8}开到|从几号到几号|几号到几号"
)
_EVENT_PRONOUN = re.compile(r"(?:本届|这届|本次|这次|此次|这场|它|这个|那场)")
_EVENT_DETAIL_QUESTION = re.compile(r"主题|看点|亮点|日程|嘉宾|规模|参会人数")
_NAMED_CODE = re.compile(r"(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9_-]*")
_OTHER_ENTITY_REFERENCE = re.compile(
    r"(?:这|那)(?:个|款|台|家|位)?"
    r"(?:公司|企业|展商|展品|产品|设备|机器人|品牌|酒店|餐厅|学校|模型)"
)
_NON_EVENT_SUBJECT = re.compile(
    r"天气|酒店|机票|航班|车次|火车|餐厅|商场|课程|电影|公司|企业|产品|展品|机器人"
)
_NON_CURRENT_REFERENCE = re.compile(
    r"去年|前年|明年|往届|历届|上一届|上届|前一届|下一届|下届|"
    r"过去|以前|历史|首届|第一届|其他(?:的)?(?:大会|展会|会议|活动)|别的(?:大会|展会|会议|活动)"
)


def _current_exhibition_terms(exhibition: dict[str, object]) -> list[str]:
    name = _record_value(exhibition, "name", "title")
    code = _record_value(exhibition, "code", "shortName", "short_name")
    aliases = _clean_ids(exhibition.get("aliases"))
    terms = list(dict.fromkeys(value for value in (name, code, *aliases) if value))
    # The official Chinese name often has a shorter spoken form that is not
    # explicitly listed in Admin (e.g. 中国计算机大会 -> 计算机大会).
    if name.startswith("中国") and len(name[2:]) >= 4:
        terms.append(name[2:])
    return list(dict.fromkeys(terms))


def _known_exhibition_codes(terms: list[str]) -> set[str]:
    codes: set[str] = set()
    for term in terms:
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", term):
            continue
        normalized = re.sub(r"[-_]", "", term).casefold()
        codes.add(normalized)
        root = re.sub(r"20\d{2}$", "", normalized)
        if root.isalpha() and len(root) >= 3:
            codes.add(root)
    return codes


def _mentions_current_exhibition(question: str, terms: list[str]) -> bool:
    compact = re.sub(r"\s+", "", question).casefold()
    for term in terms:
        if re.search(r"[\u4e00-\u9fff]", term) and len(term) >= 4 and term.casefold() in compact:
            return True
    latin_terms = _known_exhibition_codes(terms)
    return any(
        re.sub(r"[-_]", "", token).casefold() in latin_terms
        for token in _NAMED_CODE.findall(question)
    )


def _build_dify_retrieval_query(
    store: object,
    exhibition_id: str,
    question: str,
) -> str | None:
    """Resolve current-event references without changing the user's actual question."""
    exhibition = getattr(store, "get_record")("exhibitions", exhibition_id) or {}
    terms = _current_exhibition_terms(exhibition)
    if not terms:
        return None
    current_years = set(re.findall(r"(?<!\d)20\d{2}(?!\d)", " ".join(terms)))
    question_years = set(re.findall(r"(?<!\d)20\d{2}(?!\d)", question))
    if question_years - current_years or _NON_CURRENT_REFERENCE.search(question):
        return None
    known_latin = _known_exhibition_codes(terms)
    mentions_current = _mentions_current_exhibition(question, terms)
    if any(
        re.sub(r"[-_]", "", token).casefold() not in known_latin
        and (not mentions_current or bool(re.search(r"\d", token)))
        for token in _NAMED_CODE.findall(question)
    ):
        return None
    if _OTHER_ENTITY_REFERENCE.search(question):
        return None
    event_reference = _EVENT_REFERENCE.search(question)
    if not mentions_current and not event_reference and _NON_EVENT_SUBJECT.search(question):
        return None
    if not (
        mentions_current
        or event_reference
        or re.search(r"(?:本届|这届)", question)
        or (
            _EVENT_PRONOUN.search(question)
            and (_EVENT_QUESTION.search(question) or _EVENT_DETAIL_QUESTION.search(question))
        )
        or (_EVENT_QUESTION.search(question) and len(question.strip()) <= 30)
    ):
        return None

    name = _record_value(exhibition, "name", "title")
    code = _record_value(exhibition, "code", "shortName", "short_name")
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", code):
        code = re.sub(r"[-_\s]", "", code)
    subject = name or code or terms[0]
    if code and code.casefold() not in re.sub(r"[-_\s]", "", subject).casefold():
        subject = f"{subject}（{code}）"

    if (
        name
        and name in question
        and code
        and code.casefold() in re.sub(r"[-_\s]", "", question).casefold()
    ):
        return question
    for term in sorted(terms, key=len, reverse=True):
        if len(term) < 4 or not re.search(r"[\u4e00-\u9fff]", term):
            continue
        if match := re.search(re.escape(term), question):
            return question[: match.start()] + subject + question[match.end() :]
    for match in _NAMED_CODE.finditer(question):
        if re.sub(r"[-_]", "", match.group()).casefold() in known_latin:
            return question[: match.start()] + subject + question[match.end() :]
    if match := event_reference:
        if re.match(r"(?:这|那|本|当|当前|今年|你们|咱们|我们|贵)", match.group()):
            return question[: match.start()] + subject + question[match.end() :]
        if noun := re.search(_EVENT_NOUN, match.group()):
            start = match.start() + noun.start()
            end = match.start() + noun.end()
            return question[:start] + subject + question[end:]
        return question[: match.start()] + subject + question[match.end() :]
    if match := _EVENT_PRONOUN.search(question):
        return question[: match.start()] + subject + question[match.end() :]
    return subject + question


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
async def query_exhibition_qa(exhibition_id: str, body: QaQueryRequest, request: Request) -> QaQueryResponse:
    """v2.6: exact database hit -> speech; other questions -> Dify -> speech."""
    from apps.api.admin.routes import public_exhibition_entities

    store = get_store(request)
    exhibition_id = _resolve_exhibition_id(store, exhibition_id)
    if not store.get_record("exhibitions", exhibition_id):
        raise HTTPException(status_code=404, detail="exhibition not found")
    r = request.app.state.redis
    session = await session_service.get_session(r, body.session_id)
    if not session or session.get("state") in {"closed", "closing", "error"}:
        raise HTTPException(status_code=404, detail="session not found")
    settings = request.app.state.settings
    trace_id = str(getattr(request.state, "trace_id", "") or f"trace-{uuid.uuid4().hex[:16]}")
    token = uuid.uuid4().hex
    manager = turns_for(request.app)
    await r.set(turn_key(body.session_id), token, ex=3600)
    await manager.cancel(body.session_id)
    if str(session.get("model") or "").lower() != "vidu":
        await session_service.interrupt(r, body.session_id)
    client = DifyChatClient(str(getattr(settings, "dify_chat_base_url", "")),
                            str(getattr(settings, "dify_chat_api_key", "")),
                            float(getattr(settings, "dify_chat_timeout_sec", 60)))
    if not await same_turn(r, body.session_id, token):
        return QaQueryResponse(session_id=body.session_id, exhibition_id=exhibition_id, turn_id=body.turn_id,
                               trace_id=trace_id, status="cancelled", match_type="dify", speak_mode="direct")
    scope = f"opentalking:dify:context:{body.session_id}:{exhibition_id}:{client.identity}"
    cached = await r.get(scope)
    try:
        previous = json.loads(cached) if cached else {}
    except (ValueError, TypeError):
        previous = {}
    started = time.perf_counter()
    try:
        result = lookup(store, exhibition_id, body.question, selected_entity_id=body.selected_entity_id,
                        previous_ids=previous.get("entity_ids", []), top_k=int(getattr(settings, "dify_chat_top_k", 5)),
                        origin_point_id=body.origin_point_id, previous_route_ids=previous.get("route_ids", []),
                        previous_origin_id=previous.get("destination_id", ""),
                        pending_destination_id=previous.get("destination_id", "") if previous.get("routing_reason") == "route_origin_required" else "")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="entity not found in exhibition") from exc
    except Exception:
        log.exception("Database lookup failed: trace=%s", trace_id)
        from apps.api.services.exhibition_lookup import LookupResult
        result = LookupResult(status="error", reason="database_error")
    lookup_ms = round((time.perf_counter() - started) * 1000)
    from apps.api.services.exhibition_lookup import fact
    def retrieval_context() -> str:
        return json.dumps({**result.context(), "current_exhibition": fact(store.get_record("exhibitions", exhibition_id) or {}, "exhibition")}, ensure_ascii=False)
    context = retrieval_context()
    if len(context) > 16000:
        # Drop trailing candidates as whole records; never truncate JSON.
        while len(context) > 16000 and result.items:
            result.items.pop()
            retained = {str(i.get("id")) for i in result.items}
            result.entity_ids = [eid for eid in result.entity_ids if eid in retained]
            result.route_ids = [rid for rid in result.route_ids if rid in retained]
            result.truncated = True
            result.reason = "incomplete_results"
            context = retrieval_context()
    error_code = None
    user = f"humantalk-{body.session_id}"
    async def is_current() -> bool:
        return await same_turn(r, body.session_id, token)

    visible = public_exhibition_entities(exhibition_id, request)["items"]
    related = [item for entity_id in result.entity_ids for item in visible if item["id"] == entity_id]
    registration = None
    answer = service_answer(result, body.locale)
    used_service = bool(answer)
    if result.reason == "registration_request":
        card = related[0] if len(related) == 1 else {}
        if card.get("survey_path"):
            registration = {"strategy_id": "exhibit-survey", "exhibit_id": card["id"], "title": card["name"],
                            "path": card["survey_path"], "spoken_text": "Please scan the QR code to register." if body.locale == "en-US" else "请使用手机扫码完成登记。"}
            answer = registration["spoken_text"]
        else:
            answer = "Registration is not configured for this exhibit. Please ask the staff." if body.locale == "en-US" else "该展品暂未配置登记入口，请咨询现场工作人员。"
            result.reason = "registration_unavailable"
        used_service = True
    if not answer:
        answer = database_answer(result, body.question, body.locale)
        if not answer and result.reason == "exact_match":
            result.reason = "translation_required" if body.locale == "en-US" else "answer_field_missing"
            context = retrieval_context()
    used_database = bool(answer)
    reply = None
    try:
        if not used_database:
            reply = await manager.run(body.session_id, client.chat(
                question=body.question,
                inputs={"exhibition_id": exhibition_id, "locale": body.locale,
                        "retrieval_status": result.status, "retrieval_context": context},
                user=user, conversation_id=previous.get("conversation_id", ""), is_current=is_current))
            answer = reply.answer
    except asyncio.CancelledError:
        return QaQueryResponse(session_id=body.session_id, exhibition_id=exhibition_id, turn_id=body.turn_id,
                               trace_id=trace_id, status="cancelled", match_type="dify", speak_mode="direct")
    except DifyChatError as exc:
        error_code = exc.code
        answer = ("The Q&A service is temporarily unavailable. Please try again later or ask the staff."
                  if body.locale == "en-US" else "问答服务暂时不可用，请稍后重试或咨询现场工作人员。")
        reply = None
    if not await same_turn(r, body.session_id, token):
        return QaQueryResponse(session_id=body.session_id, exhibition_id=exhibition_id, turn_id=body.turn_id,
                               trace_id=trace_id, status="cancelled", match_type="dify", speak_mode="direct")
    if reply or used_database:
        await save_context(r, body.session_id, token, scope,
                           json.dumps({"conversation_id": reply.conversation_id if reply else previous.get("conversation_id", ""),
                                       "entity_ids": result.entity_ids, "route_ids": result.route_ids,
                                       "destination_id": result.destination_id, "routing_reason": result.reason}, ensure_ascii=False))
    navigation = result.route if not error_code and result.reason == "route_valid" else None
    if navigation:
        navigation.update(language=body.locale, spoken_text=answer, subtitle_text=answer)
        related = []
    if str(session.get("model") or "").lower() == "vidu":
        await _speak_vidu_answer(request=request, redis_client=r, session_id=body.session_id, text=answer, turn_token=token)
    else:
        await session_service.speak(r, body.session_id, answer, language=body.locale,
                                    voice=body.voice, tts_provider=body.tts_provider, tts_model=body.tts_model,
                                    direct=True, turn_id=body.turn_id, trace_id=trace_id,
                                    interrupt_first=False, turn_token=token)
    clarification = result.status == "multiple" or (used_service and registration is None)
    match_type = "retrieval_error" if error_code else "clarification" if clarification else "database" if used_database else "dify"
    store.save_record("knowledge_hits", {"id": f"hit-{uuid.uuid4().hex}", "exhibitionId": exhibition_id,
                      "question": body.question, "answer": answer, "turnId": body.turn_id, "traceId": trace_id,
                      "provider": "database" if used_database else "dify_chat", "matchType": match_type, "retrievalStatus": result.status,
                      "sourceIds": result.entity_ids, "lookupMs": lookup_ms,
                      "routingReason": result.reason, "intent": result.intent, "matches": result.matches,
                      "originId": result.origin_id, "destinationId": result.destination_id, "routeIds": result.route_ids,
                      "truncated": result.truncated, "decisionSource": "rule" if used_service else "database" if used_database else "dify",
                      "totalMs": round((time.perf_counter() - started) * 1000), "errorCode": error_code}, exhibition_id)
    return QaQueryResponse(session_id=body.session_id, exhibition_id=exhibition_id, turn_id=body.turn_id,
                           trace_id=trace_id, match_type=match_type, speak_mode="direct", answer=answer,
                           error_code=error_code, need_clarification=clarification,
                           clarification_question=answer if clarification else None,
                           related_entities=related if not error_code else [], navigation=navigation,
                           retrieval_status=result.status, routing_reason=result.reason, registration=registration)
