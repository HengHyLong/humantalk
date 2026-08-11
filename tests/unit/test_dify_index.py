from __future__ import annotations

import httpx
import pytest

from opentalking.agent.dify_index import DifyKnowledgeError, DifyKnowledgeIndex


def _response(payload: dict[str, object], status_code: int = 200) -> httpx.Response:
    request = httpx.Request("POST", "http://dify.test/v1")
    return httpx.Response(status_code, json=payload, request=request)


def _index(tmp_path):
    return DifyKnowledgeIndex(
        root=tmp_path,
        base_url="http://dify.test/v1",
        api_key="server-only-key",
        registry={
            "kb-001": {
                "name": "四川博览集团知识库",
                "exhibition_id": "expo-2026",
                "namespace_id": "namespace-001",
                "dify_dataset_id": "dataset-001",
                "status": "active",
            }
        },
    )


def test_query_resolves_stable_id_and_parses_dify_records(tmp_path, monkeypatch):
    calls: list[tuple[str, str, dict[str, object]]] = []

    def fake_request(method: str, url: str, **kwargs: object) -> httpx.Response:
        calls.append((method, url, kwargs))
        return _response(
            {
                "records": [
                    {
                        "segment": {
                            "document_id": "remote-doc-1",
                            "content": "四川博览集团知识库片段",
                        },
                        "score": 0.91,
                    }
                ]
            }
        )

    monkeypatch.setattr(httpx, "request", fake_request)
    results = _index(tmp_path).query(kb_id="kb-001", query="四川博览集团", limit=2)

    assert results[0].text == "四川博览集团知识库片段"
    assert results[0].score == pytest.approx(0.91)
    assert calls[0][1] == "http://dify.test/v1/datasets/dataset-001/retrieve"
    assert calls[0][2]["json"] == {
        "query": "四川博览集团",
        "retrieval_model": {
            "search_method": "hybrid_search",
            "reranking_enable": False,
            "top_k": 2,
            "score_threshold_enabled": False,
        },
    }


def test_unknown_knowledge_base_does_not_fall_back_to_default_dataset(tmp_path):
    index = _index(tmp_path)
    assert index.resolve_dataset_id("nonexistent") == ""
    with pytest.raises(DifyKnowledgeError) as caught:
        index.validate_scope(kb_id="nonexistent")
    assert caught.value.code == "KNOWLEDGE_BASE_NOT_FOUND"
    assert caught.value.status_code == 404


def test_file_upload_uses_server_side_bearer_key(tmp_path, monkeypatch):
    calls: list[dict[str, object]] = []

    def fake_request(method: str, url: str, **kwargs: object) -> httpx.Response:
        calls.append({"method": method, "url": url, **kwargs})
        return _response({"document": {"id": "remote-doc-1"}, "batch": "batch-1"})

    monkeypatch.setattr(httpx, "request", fake_request)
    payload = _index(tmp_path).create_document_by_file(
        kb_id="kb-001",
        filename="展会资料.docx",
        content=b"docx-bytes",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    assert payload["batch"] == "batch-1"
    assert calls[0]["url"] == "http://dify.test/v1/datasets/dataset-001/document/create-by-file"
    assert calls[0]["headers"] == {
        "Authorization": "Bearer server-only-key",
        "Accept": "application/json",
    }
