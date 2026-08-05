from __future__ import annotations

import json
from typing import Any

import httpx
from fastapi import APIRouter, Body, File, Form, HTTPException, Query, UploadFile

from apps.api.core.config import get_settings
from apps.api.services.dify_knowledge import (
    DifyKnowledgeClient,
    DifyNotConfiguredError,
    DifyUpstreamError,
)

router = APIRouter(
    prefix="/api/v1/admin/knowledge/dify",
    tags=["admin-knowledge-dify"],
)


def _client() -> DifyKnowledgeClient:
    return DifyKnowledgeClient(get_settings())


async def _call(method: str, path: str, **kwargs: Any) -> Any:
    try:
        return await _client().request(method, path, **kwargs)
    except DifyNotConfiguredError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "DIFY_NOT_CONFIGURED", "message": str(exc)},
        ) from exc
    except DifyUpstreamError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.payload) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "DIFY_UNAVAILABLE", "message": str(exc)},
        ) from exc


@router.get("/status")
async def dify_status() -> dict[str, bool]:
    return {"configured": _client().configured}


@router.get("/datasets")
async def list_datasets(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    keyword: str | None = None,
    tag_ids: list[str] | None = Query(default=None),
) -> Any:
    return await _call(
        "GET",
        "/datasets",
        params={"page": page, "limit": limit, "keyword": keyword, "tag_ids": tag_ids},
    )


@router.post("/datasets")
async def create_dataset(payload: dict[str, Any] = Body(...)) -> Any:
    return await _call("POST", "/datasets", json=payload)


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str) -> Any:
    return await _call("GET", f"/datasets/{dataset_id}")


@router.patch("/datasets/{dataset_id}")
async def update_dataset(dataset_id: str, payload: dict[str, Any] = Body(...)) -> Any:
    return await _call("PATCH", f"/datasets/{dataset_id}", json=payload)


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str) -> Any:
    return await _call("DELETE", f"/datasets/{dataset_id}")


@router.post("/datasets/{dataset_id}/retrieve")
async def retrieve_dataset(dataset_id: str, payload: dict[str, Any] = Body(...)) -> Any:
    return await _call("POST", f"/datasets/{dataset_id}/retrieve", json=payload)


@router.get("/datasets/{dataset_id}/documents")
async def list_documents(
    dataset_id: str,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
) -> Any:
    return await _call(
        "GET",
        f"/datasets/{dataset_id}/documents",
        params={"page": page, "limit": limit, "keyword": keyword, "status": status},
    )


@router.post("/datasets/{dataset_id}/documents/text")
async def create_document_by_text(
    dataset_id: str, payload: dict[str, Any] = Body(...)
) -> Any:
    return await _call(
        "POST", f"/datasets/{dataset_id}/document/create-by-text", json=payload
    )


@router.post("/datasets/{dataset_id}/documents/file")
async def create_document_by_file(
    dataset_id: str,
    file: UploadFile = File(...),
    data: str = Form(...),
) -> Any:
    try:
        json.loads(data)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="data must be valid JSON") from exc
    content = await file.read()
    return await _call(
        "POST",
        f"/datasets/{dataset_id}/document/create-by-file",
        files={
            "file": (file.filename or "document", content, file.content_type),
            "data": (None, data, "application/json"),
        },
    )


@router.get("/datasets/{dataset_id}/documents/indexing-status/{batch}")
async def get_indexing_status(dataset_id: str, batch: str) -> Any:
    return await _call(
        "GET", f"/datasets/{dataset_id}/documents/{batch}/indexing-status"
    )


@router.get("/datasets/{dataset_id}/documents/{document_id}/segments")
async def list_segments(
    dataset_id: str,
    document_id: str,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
) -> Any:
    return await _call(
        "GET",
        f"/datasets/{dataset_id}/documents/{document_id}/segments",
        params={"page": page, "limit": limit, "keyword": keyword, "status": status},
    )


@router.post("/datasets/{dataset_id}/documents/{document_id}/segments")
async def create_segments(
    dataset_id: str,
    document_id: str,
    payload: dict[str, Any] = Body(...),
) -> Any:
    return await _call(
        "POST",
        f"/datasets/{dataset_id}/documents/{document_id}/segments",
        json=payload,
    )
