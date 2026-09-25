"""Рамки техники в реальном времени: приём от сервиса разметки и раздача браузерам.

Сервис разметки (детектор + трекер) сам читает видео камер из шлюза и отдаёт по WebSocket сообщения
«кадр камеры → объекты с track_id». Сервер держит одно подключение к нему и пересылает каждому браузеру
только те камеры, которые тот открыл и которые пользователю разрешено видеть.

Формат сообщения сервиса (одно на обработанный кадр одной камеры):
    {"camera_id": "c1", "ts": "2026-09-25T10:15:03.120+03:00",
     "objects": [{"track_id": 17, "type": "excavator", "confidence": 0.93,
                  "box": {"x": 24.5, "y": 41.5, "w": 46.5, "h": 57.0}}]}
box — проценты от кадра, x и y — левый верхний угол; type — один из app.equipment.EQUIPMENT_TYPES.
"""

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import websockets

from app.config import get_settings
from app.equipment import EQUIPMENT_TYPES
from app.services.analysis.base import clamp_box

log = logging.getLogger("stroykontrol.tracks")
settings = get_settings()

RETRY_MIN_S, RETRY_MAX_S = 1.0, 30.0
QUEUE_SIZE = 32  # браузер не успевает — выбрасываем старые рамки, а не копим очередь


def normalize(raw: Any) -> dict | None:
    """Сообщение сервиса → сообщение браузеру (camelCase, только известная техника, рамки в пределах кадра).
    Непонятное сообщение — None: одно кривое сообщение не должно рвать поток остальных."""
    if not isinstance(raw, dict) or not isinstance(raw.get("camera_id"), str) or not isinstance(raw.get("objects"), list):
        return None
    objects = []
    for item in raw["objects"]:
        try:
            if item["type"] not in EQUIPMENT_TYPES:
                continue
            confidence = float(item.get("confidence", 0))
            if not 0 <= confidence <= 1:  # NaN сюда тоже не проходит
                continue
            x, y, w, h = clamp_box(*(float(item["box"][k]) for k in "xywh"))
            objects.append(
                {
                    "trackId": str(item["track_id"]),
                    "type": item["type"],
                    "confidence": round(confidence, 3),
                    "box": {"x": x, "y": y, "w": w, "h": h},
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    ts = raw.get("ts") if isinstance(raw.get("ts"), str) else None
    return {"cameraId": raw["camera_id"], "ts": ts, "objects": objects}


@dataclass(eq=False)
class Subscriber:
    """Один браузер: какие камеры ему можно (None — все) и какие он сейчас смотрит."""

    allowed: set[str] | None
    wanted: set[str] = field(default_factory=set)
    queue: asyncio.Queue[str] = field(default_factory=lambda: asyncio.Queue(maxsize=QUEUE_SIZE))

    def want(self, camera_ids: list[str]) -> None:
        ids = {c for c in camera_ids if isinstance(c, str)}
        self.wanted = ids if self.allowed is None else ids & self.allowed

    def push(self, camera_id: str, text: str) -> None:
        if camera_id not in self.wanted:
            return
        if self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(text)


class TrackRelay:
    def __init__(self) -> None:
        self.subscribers: set[Subscriber] = set()
        self.connected = False
        self._task: asyncio.Task | None = None

    @property
    def enabled(self) -> bool:
        return bool(settings.tracker_url)

    def start(self) -> None:
        if self.enabled and self._task is None:
            self._task = asyncio.create_task(self._run(), name="track-relay")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    def publish(self, raw: Any) -> None:
        message = normalize(raw)
        if message is None:
            return
        text = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        for subscriber in self.subscribers:
            subscriber.push(message["cameraId"], text)

    async def _run(self) -> None:
        headers = {"Authorization": f"Bearer {settings.tracker_api_key}"} if settings.tracker_api_key else {}
        delay = RETRY_MIN_S
        while True:
            try:
                async with websockets.connect(settings.tracker_url, additional_headers=headers, max_size=2**20) as ws:
                    self.connected, delay = True, RETRY_MIN_S
                    log.info("Сервис разметки подключён: %s", settings.tracker_url)
                    async for text in ws:
                        try:
                            self.publish(json.loads(text))
                        except ValueError:
                            continue
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — сеть, отказ сервиса, неверный адрес: пробуем снова, сервер не падает
                if self.connected or delay == RETRY_MIN_S:
                    log.warning("Сервис разметки недоступен (%s) — переподключение", exc)
            finally:
                self.connected = False
            await asyncio.sleep(delay)
            delay = min(delay * 2, RETRY_MAX_S)


_relay: TrackRelay | None = None


def get_relay() -> TrackRelay:
    global _relay
    if _relay is None:
        _relay = TrackRelay()
    return _relay
