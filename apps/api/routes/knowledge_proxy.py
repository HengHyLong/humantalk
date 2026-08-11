from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from apps.api.admin.security import current_user
from opentalking.agent.context_builder import default_knowledge_store
from opentalking.agent.dify_index import DifyKnowledgeError, DifyKnowledgeIndex


router = APIRouter(prefix="/api/v1/admin/knowledge", tags=["admin-knowledge"])
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024


class KnowledgeBaseCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=200)
    exhibition_id: str = Field(
        default="current",
        validation_alias=AliasChoices("exhibition_id", "exhibitionId"),
    )
    namespace_id: str = Field(
        default="default",
        validation_alias=AliasChoices("namespace_id", "namespaceId"),
    )
    knowledge_base_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("knowledge_base_id", "knowledgeBaseId"),
    )
    description: str = ""


class KnowledgeRetrieveRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    query: str = Field(min_length=1, max_length=4000)
    exhibition_id: str = Field(
        default="",
        validation_alias=AliasChoices("exhibition_id", "exhibitionId"),
    )
    namespace_id: str = Field(
        default="",
        validation_alias=AliasChoices("namespace_id", "namespaceId"),
    )
    knowledge_base_id: str = Field(
        validation_alias=AliasChoices("knowledge_base_id", "knowledgeBaseId"),
    )
    limit: int = Field(default=3, ge=1, le=20)


def _trace_id() -> str:
    return f"trace_{uuid.uuid4().hex[:12]}"


def _error(status_code: int, code: str, detail: str, trace_id: str | None = None) -> JSONResponse:
    trace = trace_id or _trace_id()
    return JSONResponse(
        status_code=status_code,
        headers={"X-Trace-Id": trace},
        content={"code": code, "detail": detail, "trace_id": trace},
    )


def _dify_index() -> DifyKnowledgeIndex:
    store = default_knowledge_store()
    index = store.knowledge_index
    if not isinstance(index, DifyKnowledgeIndex):
        raise DifyKnowledgeError("当前知识库提供方不是 Dify")
    return index


def _scope_value(snake: str | None, camel: str | None) -> str:
    return (snake or camel or "").strip()


def _handle_error(exc: DifyKnowledgeError, trace_id: str) -> JSONResponse:
    return _error(exc.status_code, exc.code, str(exc), trace_id)


def _record_response(record: dict[str, str]) -> dict[str, Any]:
    # dify_dataset_id is deliberately not returned to browser clients.
    return {
        "id": record["knowledge_base_id"],
        "knowledge_base_id": record["knowledge_base_id"],
        "name": record["name"],
        "exhibition_id": record["exhibition_id"],
        "namespace_id": record["namespace_id"],
        "status": record["status"],
    }


def _document_id_from_response(payload: dict[str, Any]) -> str:
    candidates: list[Any] = [payload.get("document"), payload.get("data")]
    for candidate in list(candidates):
        if isinstance(candidate, dict):
            candidates.append(candidate.get("document"))
    for candidate in candidates:
        if isinstance(candidate, dict) and str(candidate.get("id", "") or "").strip():
            return str(candidate["id"]).strip()
    return ""


def _batch_id_from_response(payload: dict[str, Any]) -> str:
    for key in ("batch", "batch_id", "batchId"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("batch", "batch_id", "batchId"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


@router.get("/bases", response_model=None)
async def list_knowledge_bases(
    exhibition_id: str | None = Query(default=None),
    namespace_id: str | None = Query(default=None),
    _auth: dict[str, Any] = Depends(current_user),
) -> dict[str, Any] | JSONResponse:
    trace_id = _trace_id()
    try:
        index = _dify_index()
        records = index.knowledge_base_records().values()
        items = [
            _record_response(record)
            for record in records
            if (not exhibition_id or record["exhibition_id"] == exhibition_id)
            and (not namespace_id or record["namespace_id"] == namespace_id)
        ]
    except DifyKnowledgeError as exc:
        return _handle_error(exc, trace_id)
    return {"items": items, "total": len(items), "page": 1, "page_size": len(items), "trace_id": trace_id}


@router.post("/bases", response_model=None)
async def create_knowledge_base(
    request: KnowledgeBaseCreateRequest,
    _auth: dict[str, Any] = Depends(current_user),
) -> dict[str, Any] | JSONResponse:
    trace_id = _trace_id()
    try:
        index = _dify_index()
        payload = index.create_dataset(name=request.name, description=request.description)
        dataset_id = _document_id_from_response(payload)
        if not dataset_id:
            dataset = payload.get("dataset") or payload.get("data")
            if isinstance(dataset, dict):
                dataset_id = str(dataset.get("id", "") or "").strip()
        if not dataset_id:
            raise DifyKnowledgeError("Dify 创建知识库响应中缺少 dataset id")
        record = index.set_knowledge_base_record(
            {
                "knowledge_base_id": request.knowledge_base_id or f"kb-{uuid.uuid4().hex[:12]}",
                "name": request.name,
                "exhibition_id": request.exhibition_id,
                "namespace_id": request.namespace_id,
                "dify_dataset_id": dataset_id,
                "status": "active",
            }
        )
    except DifyKnowledgeError as exc:
        return _handle_error(exc, trace_id)
    except ValueError as exc:
        return _error(422, "KNOWLEDGE_BASE_VALIDATION_ERROR", str(exc), trace_id)
    return {**_record_response(record), "trace_id": trace_id}


@router.get("/documents", response_model=None)
async def list_knowledge_documents(
    knowledge_base_id: str | None = Query(default=None),
    knowledgeBaseId: str | None = Query(default=None),
    exhibition_id: str | None = Query(default=None),
    exhibitionId: str | None = Query(default=None),
    namespace_id: str | None = Query(default=None),
    namespaceId: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    _auth: dict[str, Any] = Depends(current_user),
) -> dict[str, Any] | JSONResponse:
    trace_id = _trace_id()
    kb_id = _scope_value(knowledge_base_id, knowledgeBaseId)
    try:
        index = _dify_index()
        record = index.validate_scope(
            kb_id=kb_id,
            exhibition_id=_scope_value(exhibition_id, exhibitionId),
            namespace_id=_scope_value(namespace_id, namespaceId),
        )
        payload = index.list_documents(kb_id=kb_id, page=page, limit=limit)
    except DifyKnowledgeError as exc:
        return _handle_error(exc, trace_id)
    return {
        "items": payload.get("data", []) if isinstance(payload.get("data"), list) else [],
        "total": int(payload.get("total", 0) or 0),
        "page": page,
        "page_size": limit,
        "knowledge_base_id": record["knowledge_base_id"],
        "exhibition_id": record["exhibition_id"],
        "namespace_id": record["namespace_id"],
        "trace_id": trace_id,
    }


@router.post("/documents/upload", response_model=None)
async def upload_knowledge_document(
    file: UploadFile = File(...),
    knowledge_base_id: str | None = Form(default=None),
    knowledgeBaseId: str | None = Form(default=None),
    exhibition_id: str | None = Form(default=None),
    exhibitionId: str | None = Form(default=None),
    namespace_id: str | None = Form(default=None),
    namespaceId: str | None = Form(default=None),
    _auth: dict[str, Any] = Depends(current_user),
) -> dict[str, Any] | JSONResponse:
    trace_id = _trace_id()
    kb_id = _scope_value(knowledge_base_id, knowledgeBaseId)
    try:
        index = _dify_index()
        record = index.validate_scope(
            kb_id=kb_id,
            exhibition_id=_scope_value(exhibition_id, exhibitionId),
            namespace_id=_scope_value(namespace_id, namespaceId),
        )
        content = await file.read(MAX_DOCUMENT_BYTES + 1)
        if len(content) > MAX_DOCUMENT_BYTES:
            return _error(413, "KNOWLEDGE_DOCUMENT_TOO_LARGE", "文档不能超过 20MB", trace_id)
        payload = index.create_document_by_file(
            kb_id=kb_id,
            filename=file.filename or "document.bin",
            content=content,
            mime_type=file.content_type or "application/octet-stream",
        )
    except DifyKnowledgeError as exc:
        return _handle_error(exc, trace_id)
    except ValueError as exc:
        return _error(422, "KNOWLEDGE_DOCUMENT_VALIDATION_ERROR", str(exc), trace_id)
    return {
        "document_id": _document_id_from_response(payload),
        "batch_id": _batch_id_from_response(payload),
        "filename": file.filename or "document.bin",
        "knowledge_base_id": record["knowledge_base_id"],
        "exhibition_id": record["exhibition_id"],
        "namespace_id": record["namespace_id"],
        "status": "indexing",
        "trace_id": trace_id,
    }


@router.get("/documents/batches/{batch_id}/indexing-status", response_model=None)
async def get_indexing_status(
    batch_id: str,
    knowledge_base_id: str | None = Query(default=None),
    knowledgeBaseId: str | None = Query(default=None),
    exhibition_id: str | None = Query(default=None),
    exhibitionId: str | None = Query(default=None),
    namespace_id: str | None = Query(default=None),
    namespaceId: str | None = Query(default=None),
    _auth: dict[str, Any] = Depends(current_user),
) -> dict[str, Any] | JSONResponse:
    trace_id = _trace_id()
    kb_id = _scope_value(knowledge_base_id, knowledgeBaseId)
    try:
        index = _dify_index()
        record = index.validate_scope(
            kb_id=kb_id,
            exhibition_id=_scope_value(exhibition_id, exhibitionId),
            namespace_id=_scope_value(namespace_id, namespaceId),
        )
        payload = index.get_indexing_status(kb_id=kb_id, batch_id=batch_id)
    except DifyKnowledgeError as exc:
        return _handle_error(exc, trace_id)
    data = payload.get("data", payload)
    status = "indexing"
    if isinstance(data, list):
        statuses = {str(item.get("indexing_status", "") or "").lower() for item in data if isinstance(item, dict)}
        status = "completed" if statuses & {"completed", "available"} else "error" if statuses & {"error", "failed"} else "indexing"
    elif isinstance(data, dict):
        raw_status = str(data.get("indexing_status", data.get("status", "indexing")) or "indexing").lower()
        status = "completed" if raw_status in {"completed", "available", "ready"} else "error" if raw_status in {"error", "failed"} else "indexing"
    return {
        "batch_id": batch_id,
        "status": status,
        "data": data,
        "knowledge_base_id": record["knowledge_base_id"],
        "exhibition_id": record["exhibition_id"],
        "namespace_id": record["namespace_id"],
        "trace_id": trace_id,
    }


@router.post("/retrieve", response_model=None)
async def retrieve_knowledge(
    request: KnowledgeRetrieveRequest,
    _auth: dict[str, Any] = Depends(current_user),
) -> dict[str, Any] | JSONResponse:
    trace_id = _trace_id()
    try:
        index = _dify_index()
        record = index.validate_scope(
            kb_id=request.knowledge_base_id,
            exhibition_id=request.exhibition_id,
            namespace_id=request.namespace_id,
        )
        results = index.query(
            kb_id=request.knowledge_base_id,
            query=request.query,
            limit=request.limit,
        )
    except DifyKnowledgeError as exc:
        return _handle_error(exc, trace_id)
    return {
        "query": request.query,
        "exhibition_id": record["exhibition_id"] or request.exhibition_id,
        "knowledge_base_id": record["knowledge_base_id"],
        "namespace_id": record["namespace_id"] or request.namespace_id,
        "results": [
            {
                "document_id": result.doc_id,
                "content": result.text,
                "text": result.text,
                "score": result.score,
                "metadata": {},
            }
            for result in results
        ],
        "trace_id": trace_id,
    }
