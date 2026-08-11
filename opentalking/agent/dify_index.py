from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

import httpx

from opentalking.agent.knowledge_index import LightRAGSearchResult, LightRAGStatus


logger = logging.getLogger(__name__)


class DifyKnowledgeError(RuntimeError):
    """A safe, API-facing error from the Dify knowledge provider."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "KNOWLEDGE_PROVIDER_UNAVAILABLE",
        status_code: int = 503,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class DifyKnowledgeIndex:
    """Dify Knowledge API adapter behind the local KnowledgeIndex contract.

    The application exposes stable logical knowledge-base IDs. Only this class
    resolves them to Dify dataset IDs, so the Dify API key and internal dataset
    IDs never need to reach the browser.
    """

    def __init__(
        self,
        *,
        root: str | Path,
        base_url: str,
        api_key: str,
        dataset_id: str = "",
        dataset_map: str | dict[str, str] | None = None,
        default_knowledge_base_id: str = "",
        default_exhibition_id: str = "current",
        default_namespace_id: str = "default",
        registry: str | dict[str, Any] | None = None,
        registry_path: str | Path | None = None,
        timeout_sec: float = 15.0,
        search_method: str = "hybrid_search",
        score_threshold: float = 0.0,
    ) -> None:
        self.root = Path(root)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key.strip()
        self.dataset_id = dataset_id.strip()
        self.dataset_map = self._parse_string_map(dataset_map)
        self._configured_registry = self._parse_registry(registry)
        if self.dataset_id and default_knowledge_base_id.strip():
            self._configured_registry.setdefault(
                default_knowledge_base_id.strip(),
                {
                    "knowledge_base_id": default_knowledge_base_id.strip(),
                    "name": default_knowledge_base_id.strip(),
                    "exhibition_id": default_exhibition_id.strip(),
                    "namespace_id": default_namespace_id.strip(),
                    "dify_dataset_id": self.dataset_id,
                    "status": "active",
                },
            )
        self.registry_path = Path(registry_path) if registry_path else self.root / "knowledge_base_registry.json"
        self.timeout_sec = max(1.0, float(timeout_sec))
        self.search_method = self._normalize_search_method(search_method)
        self.score_threshold = max(0.0, float(score_threshold))
        self._state_path = self.root / "document_refs.json"
        self._state_lock = threading.Lock()
        self.dataset_map.update(self._dataset_map_from_records(self._configured_registry))
        self.dataset_map.update(self._dataset_map_from_records(self._load_registry_file()))

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def index_document(
        self,
        *,
        kb_id: str,
        doc_id: str,
        filename: str,
        text: str,
    ) -> None:
        dataset_id = self._require_dataset(kb_id)
        clean_text = text.strip()
        if not clean_text:
            return
        remote_doc_id = self._document_ref(kb_id, doc_id)
        if remote_doc_id:
            try:
                self._request_json(
                    "POST",
                    f"/datasets/{dataset_id}/documents/{remote_doc_id}/update-by-text",
                    json={"name": filename, "text": clean_text},
                )
                return
            except DifyKnowledgeError as exc:
                if exc.status_code != 404:
                    raise

        response = self._request_json(
            "POST",
            f"/datasets/{dataset_id}/document/create-by-text",
            json={
                "name": filename,
                "text": clean_text,
                "indexing_technique": "high_quality",
                "process_rule": {"mode": "automatic"},
            },
        )
        remote_doc_id = self._document_id_from_response(response)
        if not remote_doc_id:
            raise DifyKnowledgeError("Dify 返回中缺少 document id")
        self._set_document_ref(kb_id, doc_id, remote_doc_id)

    def delete_document(self, *, kb_id: str, doc_id: str) -> None:
        dataset_id = self._dataset_for(kb_id)
        remote_doc_id = self._document_ref(kb_id, doc_id)
        if not dataset_id or not remote_doc_id:
            return
        try:
            self._request_json(
                "DELETE",
                f"/datasets/{dataset_id}/documents/{remote_doc_id}",
            )
        except DifyKnowledgeError as exc:
            if exc.status_code != 404:
                raise
        finally:
            self._delete_document_ref(kb_id, doc_id)

    def clear_knowledge_base(self, kb_id: str) -> None:
        for local_doc_id in list(self._refs_for_kb(kb_id)):
            self.delete_document(kb_id=kb_id, doc_id=local_doc_id)

    def query(self, *, kb_id: str, query: str, limit: int) -> list[LightRAGSearchResult]:
        dataset_id = self._dataset_for(kb_id)
        clean_query = query.strip()
        if not dataset_id or not clean_query or limit <= 0:
            return []
        retrieval_model: dict[str, Any] = {
            "search_method": self.search_method,
            "reranking_enable": False,
            "top_k": max(1, limit),
            "score_threshold_enabled": self.score_threshold > 0,
        }
        if self.score_threshold > 0:
            retrieval_model["score_threshold"] = self.score_threshold
        response = self._request_json(
            "POST",
            f"/datasets/{dataset_id}/retrieve",
            json={"query": clean_query, "retrieval_model": retrieval_model},
        )
        records = response.get("records", [])
        if not isinstance(records, list):
            data = response.get("data")
            records = data.get("records", []) if isinstance(data, dict) else []
        if not isinstance(records, list):
            return []
        refs = self._refs_for_kb(kb_id)
        remote_to_local = {remote: local for local, remote in refs.items()}
        results: list[LightRAGSearchResult] = []
        for record in records[:limit]:
            if not isinstance(record, dict):
                continue
            segment = record.get("segment")
            if not isinstance(segment, dict):
                continue
            content = str(segment.get("content", "") or "").strip()
            if not content:
                continue
            remote_doc_id = str(segment.get("document_id", "") or "").strip()
            results.append(
                LightRAGSearchResult(
                    doc_id=remote_to_local.get(remote_doc_id, remote_doc_id),
                    text=content,
                    score=self._score(record.get("score")),
                )
            )
        return results

    def status(self, *, kb_id: str) -> LightRAGStatus:
        if not self.configured:
            return LightRAGStatus(False, False, "dify_not_configured")
        if not self._dataset_for(kb_id):
            return LightRAGStatus(False, False, "dify_dataset_not_configured")
        try:
            response = self.list_documents(kb_id=kb_id, page=1, limit=100)
        except DifyKnowledgeError:
            logger.warning("Dify document status query failed", exc_info=True)
            return LightRAGStatus(True, False, "dify_status_failed")
        documents = response.get("data", [])
        if not isinstance(documents, list) or not documents:
            return LightRAGStatus(True, False, "index_empty")
        statuses = {
            str(item.get("indexing_status", "") or "").lower()
            for item in documents
            if isinstance(item, dict)
        }
        if statuses & {"completed", "available"}:
            return LightRAGStatus(True, True, "")
        if statuses & {"error", "failed"}:
            return LightRAGStatus(True, False, "index_failed")
        return LightRAGStatus(True, False, "indexing")

    def resolve_dataset_id(self, kb_id: str) -> str:
        return self._dataset_for(kb_id)

    def get_scope_record(self, kb_id: str) -> dict[str, str] | None:
        record = self.knowledge_base_records().get(kb_id.strip())
        if record:
            return record
        dataset_id = self._dataset_for(kb_id)
        if not dataset_id:
            return None
        return {
            "knowledge_base_id": kb_id.strip(),
            "name": kb_id.strip(),
            "exhibition_id": "",
            "namespace_id": "",
            "dify_dataset_id": dataset_id,
            "status": "active",
        }

    def validate_scope(
        self,
        *,
        kb_id: str,
        exhibition_id: str = "",
        namespace_id: str = "",
    ) -> dict[str, str]:
        record = self.get_scope_record(kb_id)
        if record is None:
            raise DifyKnowledgeError(
                "知识库不存在",
                code="KNOWLEDGE_BASE_NOT_FOUND",
                status_code=404,
            )
        if exhibition_id and record["exhibition_id"] and record["exhibition_id"] != exhibition_id:
            raise DifyKnowledgeError(
                "知识库不属于当前展会",
                code="KNOWLEDGE_BASE_EXHIBITION_MISMATCH",
                status_code=409,
            )
        if namespace_id and record["namespace_id"] and record["namespace_id"] != namespace_id:
            raise DifyKnowledgeError(
                "知识库 namespace 不匹配",
                code="KNOWLEDGE_BASE_NAMESPACE_MISMATCH",
                status_code=409,
            )
        return record

    def knowledge_base_records(self) -> dict[str, dict[str, str]]:
        records = dict(self._configured_registry)
        records.update(self._load_registry_file())
        return records

    def set_knowledge_base_record(self, record: dict[str, str]) -> dict[str, str]:
        required = (
            "knowledge_base_id",
            "name",
            "exhibition_id",
            "namespace_id",
            "dify_dataset_id",
        )
        normalized = {key: str(record.get(key, "") or "").strip() for key in required}
        normalized["status"] = str(record.get("status", "active") or "active").strip()
        if not all(normalized[key] for key in required):
            raise ValueError("knowledge-base mapping fields must not be empty")
        with self._state_lock:
            records = self.knowledge_base_records()
            records[normalized["knowledge_base_id"]] = normalized
            self.registry_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.registry_path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(records, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary.replace(self.registry_path)
            self.dataset_map[normalized["knowledge_base_id"]] = normalized["dify_dataset_id"]
        return normalized

    def create_dataset(self, *, name: str, description: str = "") -> dict[str, Any]:
        if not name.strip():
            raise ValueError("knowledge base name must not be empty")
        payload: dict[str, Any] = {"name": name.strip()}
        if description.strip():
            payload["description"] = description.strip()
        return self._request_json("POST", "/datasets", json=payload)

    @staticmethod
    def dataset_id_from_response(payload: dict[str, Any]) -> str:
        candidates: list[Any] = [payload.get("dataset"), payload.get("data")]
        for candidate in list(candidates):
            if isinstance(candidate, dict):
                candidates.append(candidate.get("dataset"))
        for candidate in candidates:
            if isinstance(candidate, dict):
                value = str(candidate.get("id", "") or "").strip()
                if value:
                    return value
        value = str(payload.get("id", "") or "").strip()
        return value

    def create_document_by_file(
        self,
        *,
        kb_id: str,
        filename: str,
        content: bytes,
        mime_type: str,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        dataset_id = self._require_dataset(kb_id)
        if not content:
            raise ValueError("document content is empty")
        payload = data or {
            "indexing_technique": "high_quality",
            "process_rule": {"mode": "automatic"},
        }
        return self._request_json(
            "POST",
            f"/datasets/{dataset_id}/document/create-by-file",
            data={"data": json.dumps(payload, ensure_ascii=False)},
            files={"file": (filename or "document.bin", content, mime_type or "application/octet-stream")},
        )

    def list_documents(
        self,
        *,
        kb_id: str,
        page: int = 1,
        limit: int = 20,
        keyword: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        dataset_id = self._require_dataset(kb_id)
        params: dict[str, Any] = {"page": max(1, page), "limit": min(max(1, limit), 100)}
        if keyword and keyword.strip():
            params["keyword"] = keyword.strip()
        if status and status.strip():
            params["status"] = status.strip()
        return self._request_json(
            "GET",
            f"/datasets/{dataset_id}/documents",
            params=params,
        )

    def get_indexing_status(self, *, kb_id: str, batch_id: str) -> dict[str, Any]:
        dataset_id = self._require_dataset(kb_id)
        return self._request_json(
            "GET",
            f"/datasets/{dataset_id}/documents/{batch_id.strip()}/indexing-status",
        )

    def _require_dataset(self, kb_id: str) -> str:
        if not self.configured:
            raise DifyKnowledgeError("Dify 知识库服务未配置")
        dataset_id = self._dataset_for(kb_id)
        if not dataset_id:
            raise DifyKnowledgeError(
                "知识库不存在",
                code="KNOWLEDGE_BASE_NOT_FOUND",
                status_code=404,
            )
        return dataset_id

    def _dataset_for(self, kb_id: str) -> str:
        clean_id = kb_id.strip()
        if not clean_id:
            return ""
        record = self.knowledge_base_records().get(clean_id)
        if record and record.get("status", "active") not in {"active", "ready", ""}:
            return ""
        if record and record.get("dify_dataset_id"):
            return record["dify_dataset_id"]
        if self.dataset_map.get(clean_id):
            return self.dataset_map[clean_id]
        if clean_id in {"current", "default"}:
            return self.dataset_id
        return ""

    def _request_json(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        if not self.base_url or not self.api_key:
            raise DifyKnowledgeError("Dify RAG requires base URL and API key")
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Authorization", f"Bearer {self.api_key}")
        headers.setdefault("Accept", "application/json")
        try:
            response = httpx.request(
                method,
                f"{self.base_url}{path}",
                headers=headers,
                timeout=self.timeout_sec,
                **kwargs,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            code = "KNOWLEDGE_PROVIDER_UNAVAILABLE"
            if status_code == 404:
                code = "KNOWLEDGE_DOCUMENT_NOT_FOUND"
            raise DifyKnowledgeError(
                f"Dify 请求失败: {method} {path}",
                code=code,
                status_code=503 if status_code >= 500 else status_code,
            ) from exc
        except httpx.HTTPError as exc:
            raise DifyKnowledgeError("Dify 服务不可用") from exc
        if not response.content:
            return {}
        try:
            payload = response.json()
        except ValueError as exc:
            raise DifyKnowledgeError("Dify 返回格式无效") from exc
        if not isinstance(payload, dict):
            raise DifyKnowledgeError("Dify 返回结果必须是对象")
        return payload

    def _load_registry_file(self) -> dict[str, dict[str, str]]:
        try:
            payload = json.loads(self.registry_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}
        return self._parse_registry(payload)

    @classmethod
    def _parse_registry(cls, source: str | dict[str, Any] | None) -> dict[str, dict[str, str]]:
        payload: Any = source
        if isinstance(source, str):
            raw = source.strip()
            if not raw:
                return {}
            path = Path(raw)
            if path.is_file():
                try:
                    payload = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    return {}
            else:
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    return {}
        if not isinstance(payload, dict):
            return {}
        records: dict[str, dict[str, str]] = {}
        for key, value in payload.items():
            if not isinstance(value, dict):
                continue
            record = {
                "knowledge_base_id": str(value.get("knowledge_base_id", key) or key).strip(),
                "name": str(value.get("name", key) or key).strip(),
                "exhibition_id": str(value.get("exhibition_id", value.get("exhibitionId", "")) or "").strip(),
                "namespace_id": str(value.get("namespace_id", value.get("namespaceId", "")) or "").strip(),
                "dify_dataset_id": str(value.get("dify_dataset_id", value.get("dataset_id", "")) or "").strip(),
                "status": str(value.get("status", "active") or "active").strip(),
            }
            if record["knowledge_base_id"] and record["dify_dataset_id"]:
                records[record["knowledge_base_id"]] = record
        return records

    @staticmethod
    def _parse_string_map(source: str | dict[str, str] | None) -> dict[str, str]:
        if isinstance(source, dict):
            return {str(key).strip(): str(value).strip() for key, value in source.items() if str(key).strip() and str(value).strip()}
        raw = str(source or "").strip()
        if not raw:
            return {}
        path = Path(raw)
        if path.is_file():
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError:
                return {}
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        if not isinstance(payload, dict):
            return {}
        return {str(key).strip(): str(value).strip() for key, value in payload.items() if str(key).strip() and str(value).strip()}

    @staticmethod
    def _dataset_map_from_records(records: dict[str, dict[str, str]]) -> dict[str, str]:
        return {
            key: value["dify_dataset_id"]
            for key, value in records.items()
            if value.get("dify_dataset_id")
        }

    @staticmethod
    def _normalize_search_method(value: str) -> str:
        return value.strip() if value.strip() in {"hybrid_search", "semantic_search", "full_text_search"} else "hybrid_search"

    def _refs_for_kb(self, kb_id: str) -> dict[str, str]:
        prefix = f"{kb_id.strip()}:"
        return {
            key[len(prefix):]: value
            for key, value in self._state().items()
            if key.startswith(prefix)
        }

    def _state(self) -> dict[str, str]:
        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}
        return payload if isinstance(payload, dict) else {}

    def _document_ref(self, kb_id: str, doc_id: str) -> str:
        return self._state().get(f"{kb_id.strip()}:{doc_id.strip()}", "")

    def _set_document_ref(self, kb_id: str, doc_id: str, remote_id: str) -> None:
        with self._state_lock:
            state = self._state()
            state[f"{kb_id.strip()}:{doc_id.strip()}"] = remote_id.strip()
            self._state_path.parent.mkdir(parents=True, exist_ok=True)
            self._state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    def _delete_document_ref(self, kb_id: str, doc_id: str) -> None:
        with self._state_lock:
            state = self._state()
            state.pop(f"{kb_id.strip()}:{doc_id.strip()}", None)
            self._state_path.parent.mkdir(parents=True, exist_ok=True)
            self._state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def _document_id_from_response(response: dict[str, Any]) -> str:
        candidates: list[Any] = [response.get("document"), response.get("data")]
        for candidate in list(candidates):
            if isinstance(candidate, dict):
                candidates.append(candidate.get("document"))
        for candidate in candidates:
            if isinstance(candidate, dict):
                value = str(candidate.get("id", "") or "").strip()
                if value:
                    return value
        return ""

    @staticmethod
    def _score(value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0
