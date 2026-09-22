"""Клиент внешнего сервиса анализа кадров (будущая модель распознавания).

Контракт (его должен реализовать сервис анализа):

    POST {SK_ANALYSIS_API_URL}
    Content-Type: multipart/form-data
        image      — кадр JPEG 1280×720
        camera_id  — идентификатор камеры (необязательно)
        taken_at   — время кадра в ISO 8601 (необязательно)
    Authorization: Bearer {SK_ANALYSIS_API_KEY}   (если ключ задан)

    200 OK, application/json:
    {
      "model": "yolo11m-construction-v1",
      "detections": [
        {"type": "excavator", "confidence": 0.94, "box": {"x": 24.5, "y": 41.5, "w": 46.5, "h": 57.0}}
      ]
    }

    type — один из: excavator, dump_truck, roller, manipulator, mixer, bulldozer, truck, crane.
    box  — проценты от кадра (0..100), x и y — левый верхний угол.
"""

import time
from datetime import datetime

import httpx

from app.equipment import EQUIPMENT_TYPES
from app.services.analysis.base import AnalysisError, AnalysisResult, DetectedObject, clamp_box


class HttpAnalyzer:
    name = "http"

    def __init__(
        self, url: str, api_key: str | None, timeout_s: float, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.url = url
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.AsyncClient(timeout=timeout_s, headers=headers, transport=transport)

    async def analyze(self, image: bytes, *, camera_id: str | None = None, taken_at: datetime | None = None) -> AnalysisResult:
        started = time.perf_counter()
        data = {k: v for k, v in {"camera_id": camera_id, "taken_at": taken_at and taken_at.isoformat()}.items() if v}
        try:
            response = await self._client.post(self.url, files={"image": ("frame.jpg", image, "image/jpeg")}, data=data)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AnalysisError(f"Сервис анализа недоступен: {exc}") from exc

        detections, skipped = [], set()
        for item in payload.get("detections", []):
            try:
                kind, box = item["type"], item["box"]
                if kind not in EQUIPMENT_TYPES:
                    skipped.add(str(kind))
                    continue
                x, y, w, h = clamp_box(float(box["x"]), float(box["y"]), float(box["w"]), float(box["h"]))
                detections.append(DetectedObject(kind, round(float(item.get("confidence", 0)), 3), x, y, w, h))
            except (KeyError, TypeError, ValueError) as exc:
                raise AnalysisError(f"Непонятный ответ сервиса анализа: {item!r}") from exc
        note = f"Пропущены неизвестные типы техники: {', '.join(sorted(skipped))}" if skipped else None
        return AnalysisResult(
            provider=self.name,
            detections=detections,
            model=payload.get("model"),
            note=note,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
        )
