"""Анализ кадров: демо-анализатор, клиент внешнего сервиса, приём готовых детекций, разбор загруженного фото."""

import io
import json

import httpx
import pytest
from PIL import Image

from app.config import ASSETS_DIR
from app.services.analysis import AnalysisError, get_mock
from app.services.analysis.http import HttpAnalyzer
from tests.conftest import login_as

pytestmark = pytest.mark.anyio
SEED = ASSETS_DIR / "seed"


async def test_mock_recognises_recompressed_frames_and_refuses_unknown():
    mock = get_mock()
    with Image.open(SEED / "road-roller-a.jpg") as img:
        out = io.BytesIO()
        img.resize((800, 450)).save(out, "JPEG", quality=55)
    result = await mock.analyze(out.getvalue(), camera_id="t1")
    assert result.supported and [d.type for d in result.detections] == ["roller"]

    noise = io.BytesIO()
    Image.effect_noise((640, 360), 70).convert("RGB").save(noise, "JPEG")
    unknown = await mock.analyze(noise.getvalue())
    assert unknown.supported is False and unknown.detections == [] and "SK_ANALYSIS_PROVIDER" in unknown.note


async def test_http_analyzer_follows_the_contract():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["multipart"] = request.headers["content-type"].startswith("multipart/form-data")
        seen["has_camera"] = b'name="camera_id"' in request.content
        return httpx.Response(
            200,
            json={
                "model": "yolo-test",
                "detections": [
                    {"type": "excavator", "confidence": 0.91, "box": {"x": 10, "y": 20, "w": 30, "h": 40}},
                    {
                        "type": "tower_crane",
                        "confidence": 0.8,
                        "box": {"x": 0, "y": 0, "w": 10, "h": 10},
                    },  # класса нет в справочнике
                    {"type": "truck", "confidence": 0.7, "box": {"x": 90, "y": 95, "w": 30, "h": 30}},  # рамка вылезает за кадр
                ],
            },
        )

    analyzer = HttpAnalyzer("http://ml.local/analyze", "secret-key", 5, transport=httpx.MockTransport(handler))
    result = await analyzer.analyze(b"jpeg-bytes", camera_id="c1")
    assert seen == {"auth": "Bearer secret-key", "multipart": True, "has_camera": True}
    assert result.provider == "http" and result.model == "yolo-test"
    assert [d.type for d in result.detections] == ["excavator", "truck"] and "tower_crane" in result.note
    truck = result.detections[1]
    assert truck.x + truck.w <= 100 and truck.y + truck.h <= 100

    broken = HttpAnalyzer("http://ml.local/analyze", None, 5, transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    with pytest.raises(AnalysisError):
        await broken.analyze(b"x")


async def test_analyze_sample_and_upload(client):
    manager = await login_as(client, "manager")
    sample = (await client.post("/api/analyze", headers=manager, data={"sample": "pit-loading", "siteId": "s1"})).json()
    assert [r["state"] for r in sample["rows"]] == ["ok", "low"]
    assert (
        sample["deviations"][0]["title"] == "Мало самосвалов: 1 из 2"
        and "не меньше 2 самосвалов" in sample["deviations"][0]["why"]
    )

    crane = (await client.post("/api/public/analyze", data={"sample": "gate-crane", "ruleKey": "excavation"})).json()
    assert {d["kind"] for d in crane["deviations"]} == {"missing", "unexpected"}

    upload = await client.post(
        "/api/public/analyze",
        data={"ruleKey": "asphalt"},
        files={"image": ("own.jpg", (SEED / "road-roller-b.jpg").read_bytes(), "image/jpeg")},
    )
    assert upload.json()["supported"] and upload.json()["imageUrl"].startswith("data:image/jpeg")
    junk = await client.post(
        "/api/public/analyze", data={"ruleKey": "asphalt"}, files={"image": ("a.txt", b"hello", "text/plain")}
    )
    assert junk.status_code == 422
    demo = (await client.get("/api/public/demo")).json()
    assert len(demo["rules"]) == 9 and len(demo["samples"]) == 5


async def test_push_mode_ingest(client):
    """Внешний сервис сам разобрал кадр и прислал детекции: два самосвала приехали на котлован."""
    manager = await login_as(client, "manager")
    detections = json.dumps(
        [
            {"type": "excavator", "confidence": 0.9, "box": {"x": 30, "y": 40, "w": 30, "h": 40}},
            {"type": "dump_truck", "confidence": 0.88, "box": {"x": 5, "y": 50, "w": 20, "h": 20}},
            {"type": "dump_truck", "confidence": 0.86, "box": {"x": 70, "y": 50, "w": 20, "h": 20}},
        ]
    )
    files = {"image": ("frame.jpg", (SEED / "pit-loading.jpg").read_bytes(), "image/jpeg")}
    form = {"camera_id": "c1", "detections": detections, "model": "yolo-test"}
    assert (await client.post("/api/ingest/snapshots", data=form, files=files)).status_code == 401
    accepted = await client.post("/api/ingest/snapshots", data=form, files=files, headers={"X-API-Key": "ingest-test-key"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["snapshots"][0]["provider"] == "yolo-test"

    shortage = next(
        a
        for a in (await client.get("/api/alerts?siteId=s1", headers=manager)).json()
        if a["equipment"] == "dump_truck" and a["code"] >= "ОТК-26-0138"
    )
    assert shortage["status"] == "resolved" and "снято автоматически" in shortage["history"][-1]["text"]
