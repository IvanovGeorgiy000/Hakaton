"""Общий интерфейс анализа кадров.

Сейчас используется демо-анализатор (mock). Позже его заменит внешний сервис распознавания:
достаточно выставить SK_ANALYSIS_PROVIDER=http и SK_ANALYSIS_API_URL — остальной код не меняется.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass
class DetectedObject:
    type: str  # один из app.equipment.EQUIPMENT_TYPES
    confidence: float  # 0..1
    x: float  # рамка в процентах от кадра, начало координат слева сверху
    y: float
    w: float
    h: float


@dataclass
class AnalysisResult:
    provider: str
    detections: list[DetectedObject] = field(default_factory=list)
    supported: bool = True  # False — анализатор не смог обработать кадр; сверку по такому кадру не проводим
    model: str | None = None
    note: str | None = None
    elapsed_ms: int = 0


class AnalysisError(Exception):
    """Сервис анализа недоступен или вернул непонятный ответ."""


class AnalysisProvider(Protocol):
    name: str

    async def analyze(
        self, image: bytes, *, camera_id: str | None = None, taken_at: datetime | None = None
    ) -> AnalysisResult: ...


def clamp_box(x: float, y: float, w: float, h: float) -> tuple[float, float, float, float]:
    """Рамка не должна выходить за кадр."""
    w = min(max(w, 0.5), 100.0)
    h = min(max(h, 0.5), 100.0)
    x = min(max(x, 0.0), 100.0 - w)
    y = min(max(y, 0.0), 100.0 - h)
    return round(x, 2), round(y, 2), round(w, 2), round(h, 2)
