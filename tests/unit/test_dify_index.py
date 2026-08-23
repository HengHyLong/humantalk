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


def test_discovery_includes_datasets_created_in_dify_console(tmp_path, monkeypatch):
    def fake_request(method: str, url: str, **kwargs: object) -> httpx.Response:
        assert method == "GET"
        assert url == "http://dify.test/v1/datasets"
        assert kwargs["params"] == {"page": 1, "limit": 100}
        return _response(
            {
                "data": [
                    {"id": "dataset-001", "name": "已登记知识库"},
                    {"id": "c0393c81-cce3-4ec4-8d1e-96a0ffdf9ed7", "name": "Dify 网页知识库"},
                ],
                "has_more": False,
            }
        )

    monkeypatch.setattr(httpx, "request", fake_request)
    records = _index(tmp_path).discover_knowledge_base_records()

    assert records["kb-001"]["name"] == "已登记知识库"
    discovered_id = "kb_c0393c81cce34ec48d1e96a0ffdf9ed7"
    assert records[discovered_id] == {
        "knowledge_base_id": discovered_id,
        "name": "Dify 网页知识库",
        "exhibition_id": "",
        "namespace_id": "default",
        "dify_dataset_id": "c0393c81-cce3-4ec4-8d1e-96a0ffdf9ed7",
        "status": "active",
    }


def test_sync_exhibition_bindings_supports_many_and_unbinds_removed(tmp_path):
    index = DifyKnowledgeIndex(
        root=tmp_path,
        base_url="http://dify.test/v1",
        api_key="server-only-key",
        default_namespace_id="namespace-cncc-2026",
        registry={
            "kb-old": {
                "name": "旧知识库",
                "exhibition_id": "expo-cncc",
                "namespace_id": "namespace-cncc-2026",
                "dify_dataset_id": "dataset-old",
                "status": "active",
            },
            "kb-a": {
                "name": "知识库 A",
                "exhibition_id": "other-expo",
                "namespace_id": "namespace-cncc-2026",
                "dify_dataset_id": "dataset-a",
                "status": "active",
            },
            "kb-b": {
                "name": "知识库 B",
                "exhibition_id": "",
                "namespace_id": "namespace-cncc-2026",
                "dify_dataset_id": "dataset-b",
                "status": "active",
            },
        },
    )

    bound = index.sync_exhibition_bindings(
        exhibition_id="expo-cncc",
        knowledge_base_ids=["kb-a", "kb-b", "kb-a"],
        previous_knowledge_base_ids=["kb-old"],
    )

    assert [record["knowledge_base_id"] for record in bound] == ["kb-a", "kb-b"]
    records = index.knowledge_base_records()
    assert records["kb-a"]["exhibition_id"] == "expo-cncc"
    assert records["kb-b"]["exhibition_id"] == "expo-cncc"
    assert records["kb-old"]["exhibition_id"] == ""
    with pytest.raises(DifyKnowledgeError) as caught:
        index.validate_scope(kb_id="kb-old", exhibition_id="expo-cncc")
    assert caught.value.code == "KNOWLEDGE_BASE_EXHIBITION_MISMATCH"
