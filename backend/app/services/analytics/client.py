"""HTTP-клиент одного сервиса аналитики (контракт frame-analysis-v1, разделы 3, 11 и 13).

POST {адрес}/v1/analyze/frame — multipart ровно из двух частей: metadata (JSON) и image (кадр); заголовки
Idempotency-Key = request_id, Authorization: Bearer <токен>, Accept: application/json.
Повторы — только явно повторяемых отказов (busy, not_ready, dependency_unavailable с retryable=true): не больше двух,
через 1 и 2 секунды или по Retry-After. Если запрос ушёл, а ответ потерялся (обрыв, тайм-аут), анализ заново не
запускаем — это может быть платный вызов модели: спрашиваем результат по GET /v1/analyses/by-request/{request_id}.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.services.analytics.catalog import CatalogError

RESULT_SCHEMA = "frame-analysis-result-v1"
RETRY_DELAYS_S = (1.0, 2.0)
RETRY_CODES = {"busy", "not_ready", "dependency_unavailable"}
CONNECT_TIMEOUT_S = 10.0
LOOKUP_WAIT_S = (5.0, 60.0)  # сервис ещё считает (429 на запрос результата): ждём Retry-After в этих пределах
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


@dataclass
class Reply:
    """Итог вызова: done — анализ выполнен (result — ответ целиком); error — отказ или нет связи;
    unknown — неизвестно, выполнен ли анализ (повторять автоматически нельзя)."""

    state: str
    http_status: int | None = None
    result: dict | None = None
    code: str | None = None
    message: str | None = None
    retryable: bool | None = None


def _retry_after(response: httpx.Response) -> float:
    try:
        return max(float(response.headers.get("retry-after", "0")), 0.0)
    except ValueError:
        return 0.0


def _error_text(payload: dict) -> str:
    """message и details ошибки — одной строкой для администратора."""
    text = str(payload.get("message") or "").strip()
    details = [d for d in payload.get("details") or [] if isinstance(d, dict)]
    parts = [f"{d.get('path') or 'запрос'}: {d.get('message') or d.get('code')}" for d in details[:5]]
    if parts:
        text = f"{text} ({'; '.join(parts)})" if text else "; ".join(parts)
    return text[:1000]


class ServiceClient:
    def __init__(
        self,
        service: str,
        base_url: str,
        token: str | None,
        timeout_s: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.service, self.base_url, self.timeout_s = service, base_url, timeout_s
        self._http = httpx.AsyncClient(
            base_url=base_url,
            headers=headers,
            timeout=httpx.Timeout(timeout_s, connect=CONNECT_TIMEOUT_S),
            transport=transport,
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def get_json(self, path: str) -> Any:
        """Служебные маршруты: справочник, возможности, готовность."""
        try:
            response = await self._http.get(path)
        except httpx.HTTPError as exc:
            raise CatalogError(f"{self.base_url}{path}: {self._transport_error(exc)}") from None
        if response.status_code != 200:
            reply = self._reply(response)
            raise CatalogError(f"{self.base_url}{path}: {response.status_code} {reply.code or ''} {reply.message or ''}".strip())
        try:
            return response.json()
        except ValueError:
            raise CatalogError(f"{self.base_url}{path}: ответ — не JSON") from None

    async def analyze(self, *, request_id: str, site_id: str, metadata: bytes, image: bytes, media_type: str) -> Reply:
        files = [
            ("metadata", ("metadata.json", metadata, "application/json; charset=utf-8")),
            ("image", (f"frame.{EXTENSIONS.get(media_type, 'jpg')}", image, media_type)),
        ]
        headers = {"Idempotency-Key": request_id}
        for attempt in range(len(RETRY_DELAYS_S) + 1):
            try:
                response = await self._http.post("/v1/analyze/frame", files=files, headers=headers)
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:  # запрос не ушёл
                return Reply("error", code="unreachable", message=self._transport_error(exc), retryable=True)
            except httpx.HTTPError as exc:  # ушёл, но ответа нет: выполнен ли анализ — неизвестно
                return await self._lookup(request_id, site_id, self._transport_error(exc))
            reply = self._reply(response)
            if reply.state == "error" and reply.retryable and reply.code in RETRY_CODES and attempt < len(RETRY_DELAYS_S):
                await asyncio.sleep(max(RETRY_DELAYS_S[attempt], _retry_after(response)))
                continue
            return reply
        raise AssertionError("unreachable")

    async def _lookup(self, request_id: str, site_id: str, reason: str) -> Reply:
        """Ответ на анализ потерялся — узнать у сервиса, чем кончилось (раздел 11)."""
        path = f"/v1/analyses/by-request/{quote(request_id, safe='')}"
        deadline = time.monotonic() + self.timeout_s
        while True:
            try:
                response = await self._http.get(path, params={"site_id": site_id})
            except httpx.HTTPError as exc:
                return Reply(
                    "unknown",
                    code="response_lost",
                    message=f"{reason}; узнать результат не удалось: {self._transport_error(exc)}",
                )
            if response.status_code == 429:  # ещё считает
                wait = min(max(_retry_after(response), LOOKUP_WAIT_S[0]), LOOKUP_WAIT_S[1])
                if time.monotonic() + wait < deadline:
                    await asyncio.sleep(wait)
                    continue
                return Reply("unknown", 429, code="busy", message=f"{reason}; сервис всё ещё считает — ответ не дождались")
            reply = self._reply(response)  # 200 — сохранённый результат; 409 execution_uncertain — «неизвестно»
            if response.status_code == 404:
                reply.state, reply.message = (
                    "unknown",
                    (f"{reason}; в журнале сервиса запроса нет — мог не дойти, но потрачен ли вызов модели, неизвестно"),
                )
            return reply

    def _reply(self, response: httpx.Response) -> Reply:
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if response.status_code == 200:
            if not isinstance(payload, dict):
                return Reply("error", 200, code="invalid_result", message="ответ сервиса — не JSON-объект")
            return Reply("done", 200, result=payload)
        if not isinstance(payload, dict):  # не ответ сервиса, а, например, страница прокси
            text = response.text.strip()[:300]
            return Reply("error", response.status_code, code=f"http_{response.status_code}", message=text or None)
        unknown = payload.get("execution_state") == "unknown" or payload.get("code") == "execution_uncertain"
        return Reply(
            "unknown" if unknown else "error",
            response.status_code,
            code=str(payload.get("code") or f"http_{response.status_code}")[:40],
            message=_error_text(payload) or None,
            retryable=payload.get("retryable") if isinstance(payload.get("retryable"), bool) else None,
        )

    def _transport_error(self, exc: httpx.HTTPError) -> str:
        if isinstance(exc, httpx.ConnectError | httpx.ConnectTimeout):
            return f"нет связи с сервисом ({self.base_url}): он не запущен или адрес неверный"
        if isinstance(exc, httpx.TimeoutException):
            return f"сервис не ответил за {self.timeout_s:g} с"
        return f"связь с сервисом оборвалась: {type(exc).__name__}"
