"""Демо-анализатор: заменяет модель распознавания, пока её нет.

Узнаёт демонстрационные кадры по «отпечатку» изображения (average hash 16×16), поэтому работает и с кадрами,
пришедшими по сети от встроенной демо-камеры, и с теми же фото, загруженными вручную.
Незнакомый кадр честно помечается как необработанный — выдуманных рамок на чужих фото не рисуем.
"""

import io
import json
import time
from collections import defaultdict
from datetime import datetime

from PIL import Image

from app.config import ASSETS_DIR
from app.services.analysis.base import AnalysisResult, DetectedObject, clamp_box

SEED_DIR = ASSETS_DIR / "seed"
_HASH_SIDE = 16
_MATCH_DISTANCE = 12  # из 256 бит: пересжатый тот же кадр отличается на ≤3, разные кадры — на ≥32
# Работающая техника смещается: четыре положения по кругу, соседние отличаются на 8% размера рамки (IoU ≈ 0.85)
_JITTER = [(0.04, 0.04), (-0.04, 0.04), (-0.04, -0.04), (0.04, -0.04)]


def fingerprint(image_bytes: bytes) -> int:
    with Image.open(io.BytesIO(image_bytes)) as img:
        small = img.convert("L").resize((_HASH_SIDE, _HASH_SIDE), Image.Resampling.BILINEAR)
        pixels = small.tobytes()  # режим «L»: один байт на пиксель
    mean = sum(pixels) / len(pixels)
    bits = 0
    for p in pixels:
        bits = (bits << 1) | (p > mean)
    return bits


class MockAnalyzer:
    name = "mock"

    def __init__(self) -> None:
        raw = json.loads((SEED_DIR / "annotations.json").read_text(encoding="utf-8"))
        self.annotations: dict[str, list[dict]] = {k: v for k, v in raw.items() if not k.startswith("_")}
        self.fingerprints: dict[str, int] = {
            name: fingerprint((SEED_DIR / f"{name}.jpg").read_bytes()) for name in self.annotations
        }
        self._tick: dict[str, int] = defaultdict(int)  # счётчик кадров по камерам — для смещения рамок

    def identify(self, image: bytes) -> str | None:
        fp = fingerprint(image)
        name, distance = min(((n, (fp ^ h).bit_count()) for n, h in self.fingerprints.items()), key=lambda t: t[1])
        return name if distance <= _MATCH_DISTANCE else None

    async def analyze(self, image: bytes, *, camera_id: str | None = None, taken_at: datetime | None = None) -> AnalysisResult:
        started = time.perf_counter()
        try:
            name = self.identify(image)
        except OSError:
            name = None
        if name is None:
            return AnalysisResult(
                provider=self.name,
                supported=False,
                note="Демо-анализатор распознаёт только демонстрационные кадры. "
                "Для своих камер и фото подключите сервис анализа (SK_ANALYSIS_PROVIDER=http).",
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )

        key = camera_id or "-"
        step = self._tick[key]
        self._tick[key] += 1
        dx, dy = _JITTER[step % len(_JITTER)]
        wobble = ((step * 7) % 5 - 2) / 100  # уверенность слегка «дышит»: ±0.02

        detections = []
        for item in self.annotations[name]:
            x, y, w, h = item["box"]
            if item.get("moving"):
                x, y = x + dx * w, y + dy * h
            x, y, w, h = clamp_box(x, y, w, h)
            confidence = round(min(max(item["confidence"] + wobble, 0.5), 0.99), 2)
            detections.append(DetectedObject(item["type"], confidence, x, y, w, h))
        return AnalysisResult(
            provider=self.name,
            detections=detections,
            model=f"mock:{name}",
            elapsed_ms=int((time.perf_counter() - started) * 1000),
        )
