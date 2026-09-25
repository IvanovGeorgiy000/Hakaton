"""Сколько работала техника — по рамкам сервиса разметки (10–15 сообщений в секунду на камеру).

По каждой камере и типу техники копим за час: сколько секунд тип был в кадре, сколько из них двигался и сколько
машин было одновременно. Раз в минуту накопленное дописывается в базу (таблица equipment_usage).
Это история для сервиса, определяющего этап по кадрам: «экскаватор работал 6 часов, бетоносмесителей не было».

Движение — по центру рамки трека: раз в 5 секунд сравниваем с прошлым положением; сдвинулся больше чем на 1 %
кадра — считаем, что машина двигалась эти 5 секунд. Дрожание рамки детектора (доли процента) движением не считается.
"""

import math
from collections import Counter
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Camera, EquipmentUsage

MAX_GAP_S = 2.0  # сообщений по камере не было дольше — промежуток не засчитываем (сервис или камера молчали)
MOVE_SAMPLE_S = 5.0
MOVE_MIN = 1.0  # % кадра
FORGET_TRACK_S = 60.0


@dataclass
class Cell:
    present_s: float = 0.0
    moving_s: float = 0.0
    max_count: int = 0


@dataclass
class _Track:
    at: float
    cx: float
    cy: float
    moving: bool = False


class UsageMeter:
    def __init__(self) -> None:
        self.cells: dict[tuple[str, datetime, str], Cell] = {}
        self._last: dict[str, float] = {}  # камера → когда пришло прошлое сообщение
        self._tracks: dict[tuple[str, str], _Track] = {}

    def add(self, message: dict, now: float, wall: datetime) -> None:
        """message — сообщение сервиса в нашем виде (tracks.normalize); now — монотонное время, wall — UTC."""
        camera = message["cameraId"]
        dt = min(max(now - self._last.get(camera, now), 0.0), MAX_GAP_S)
        self._last[camera] = now
        hour = wall.replace(minute=0, second=0, microsecond=0)
        counts: Counter[str] = Counter()
        moving: set[str] = set()
        for obj in message["objects"]:
            counts[obj["type"]] += 1
            box = obj["box"]
            cx, cy = box["x"] + box["w"] / 2, box["y"] + box["h"] / 2
            key = (camera, obj["trackId"])
            track = self._tracks.get(key)
            if track is None:
                self._tracks[key] = _Track(now, cx, cy)
            elif now - track.at >= MOVE_SAMPLE_S:
                self._tracks[key] = _Track(now, cx, cy, math.hypot(cx - track.cx, cy - track.cy) >= MOVE_MIN)
            if self._tracks[key].moving:
                moving.add(obj["type"])
        for kind, n in counts.items():
            cell = self.cells.setdefault((camera, hour, kind), Cell())
            cell.present_s += dt
            cell.max_count = max(cell.max_count, n)
            if kind in moving:
                cell.moving_s += dt

    def take(self, now: float) -> dict[tuple[str, datetime, str], Cell]:
        """Забрать накопленное (и забыть давно пропавшие треки)."""
        cells, self.cells = self.cells, {}
        self._tracks = {k: t for k, t in self._tracks.items() if now - t.at < FORGET_TRACK_S}
        return cells


async def save(session: AsyncSession, cells: dict[tuple[str, datetime, str], Cell]) -> int:
    """Дописать накопленное в базу: к строке того же часа, камеры и типа — прибавить. Удалённые камеры пропускаем."""
    if not cells:
        return 0
    camera_ids = {camera_id for camera_id, _, _ in cells}
    cameras = {c.id: c for c in await session.scalars(select(Camera).where(Camera.id.in_(camera_ids)))}
    saved = 0
    for (camera_id, hour, kind), cell in cells.items():
        camera = cameras.get(camera_id)
        if camera is None or cell.present_s <= 0 and cell.max_count == 0:
            continue
        row = await session.scalar(
            select(EquipmentUsage).where(
                EquipmentUsage.camera_id == camera_id, EquipmentUsage.hour == hour, EquipmentUsage.equipment_type == kind
            )
        )
        if row is None:
            row = EquipmentUsage(
                site_id=camera.site_id, camera_id=camera_id, zone_kind=camera.zone.kind, hour=hour, equipment_type=kind,
                max_count=0, present_s=0.0, moving_s=0.0,
            )  # fmt: skip
            session.add(row)
        row.present_s += cell.present_s
        row.moving_s += cell.moving_s
        row.max_count = max(row.max_count, cell.max_count)
        saved += 1
    await session.commit()
    return saved
