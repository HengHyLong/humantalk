from __future__ import annotations

import os
from typing import Any

import httpx

from opentalking.core.config import Settings


class DifyNotConfiguredError(RuntimeError):
    """Raised when the optional Dify integration has no server-side config."""


class DifyUpstreamError(RuntimeError):
    def __init__(self, status_code: int, payload: Any) -> None:
        super().__init__("Dify knowledge API request failed")
        self.status_code = status_code
        self.payload = payload


class DifyKnowledgeClient:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (
            settings.dify_api_base_url or os.getenv("DIFY_API_BASE_URL", "")
        ).strip().rstrip("/")
        self.api_key = (
            settings.dify_dataset_api_key
            or os.getenv("DIFY_DATASET_API_KEY", "")
        ).strip()
        self.timeout = settings.dify_timeout_sec
        self.transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _require_config(self) -> None:
        if not self.configured:
            raise DifyNotConfiguredError(
                "Set OPENTALKING_DIFY_API_BASE_URL and "
                "OPENTALKING_DIFY_DATASET_API_KEY on the API server"
            )

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        files: Any = None,
        data: Any = None,
    ) -> Any:
        self._require_config()
        headers = {"Authorization": f"Bearer {self.api_key}"}
        clean_params = (
            {key: value for key, value in params.items() if value is not None}
            if params
            else None
        )
        async with httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=self.timeout,
            transport=self.transport,
        ) as client:
            response = await client.request(
                method,
                path,
                params=clean_params,
                json=json,
                files=files,
                data=data,
            )
        if response.status_code >= 400:
            try:
                payload: Any = response.json()
            except ValueError:
                payload = {"message": response.text}
            raise DifyUpstreamError(response.status_code, payload)
        if response.status_code == 204 or not response.content:
            return {"success": True}
        return response.json()
