"""СтройКонтроль API: точка входа."""

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api import admin, alerts, analyze, audit, auth, cameras, catalog, ingest, reports, snapshots, tracks
from app.api import video as video_api
from app.config import ASSETS_DIR, get_settings
from app.db import SessionLocal, engine, utcnow
from app.schemas import ApiModel
from app.seed import prepare_database
from app.services import video
from app.services.analysis import get_analyzer
from app.services.pipeline import get_pipeline
from app.services.tracks import get_relay

VERSION = "0.10.0"
settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("stroykontrol")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if problems := settings.insecure_defaults():
        raise RuntimeError("Боевой запуск (SK_DEMO_MODE=false) с небезопасными настройками:\n- " + "\n- ".join(problems))
    settings.frames_dir.mkdir(parents=True, exist_ok=True)
    await prepare_database()
    log.info(
        "Анализ кадров: %s, кадр с камеры раз в %.0f с, сверка раз в %d с",
        get_analyzer().name,
        settings.frame_interval_s,
        settings.check_interval_s,
    )
    feeds, pipeline = video.DemoFeeds(), get_pipeline()
    if settings.video_enabled:
        feeds.start()  # демо-ролики → шлюз
        pipeline.start()  # потоки камер в шлюзе, кадры на анализ, сверка объектов
    relay = get_relay()
    relay.start()  # рамки в реальном времени — если подключён сервис разметки (SK_TRACKER_URL)
    yield
    await relay.stop()
    await pipeline.stop()
    await feeds.stop()
    await engine.dispose()


app = FastAPI(
    title="СтройКонтроль API",
    version=VERSION,
    description="Мониторинг строительных площадок по видео с камер: кадры → техника → сверка с графиком → отклонения.",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_methods=["*"], allow_headers=["*"])


class VideoOut(ApiModel):
    enabled: bool
    webrtc_url: str  # браузер смотрит поток камеры по адресу {webrtcUrl}/{streamPath}/whep
    frame_interval_s: float
    check_interval_s: int


class TrackerOut(ApiModel):
    """Рамки в реальном времени от сервиса разметки (WebSocket /api/tracks)."""

    enabled: bool
    connected: bool  # сервер сейчас получает рамки от сервиса
    video_delay_ms: int  # на столько придержать видео, чтобы рамки совпадали с картинкой
    last_message_at: str | None  # когда пришло последнее сообщение — видно, идут ли рамки вообще
    problem: str | None  # последняя ошибка формата от сервиса (рамка в долях 0–1, нет track_id…) — для отладки интеграции
    problem_at: str | None


class DemoFeedOut(ApiModel):
    """Демо-ролик как RTSP-адрес — для быстрой настройки в форме «Добавить камеру»."""

    clip: str
    title: str
    host: str
    port: int
    path: str


class MetaOut(ApiModel):
    version: str
    demo_mode: bool
    analysis_provider: str
    timezone: str
    server_time: str
    database: str
    auth_mode: str  # local | keycloak
    keycloak: dict | None  # {url, realm, clientId} — когда включён Keycloak
    video: VideoOut
    tracker: TrackerOut
    demo_feeds: list[DemoFeedOut]


api = APIRouter(prefix="/api")


@api.get("/meta", response_model=MetaOut, tags=["Служебное"], summary="Состояние сервера и режимы работы")
async def meta() -> MetaOut:
    relay = get_relay()
    async with SessionLocal() as session:
        await session.execute(text("SELECT 1"))
    keycloak = None
    if settings.keycloak_issuer:
        keycloak = {"url": settings.keycloak_url, "realm": settings.keycloak_realm, "clientId": settings.keycloak_client_id}
    feeds = []
    if settings.demo_mode:
        for clip in video.available_clips():
            addr = video.demo_feed_address(clip)
            feeds.append(
                DemoFeedOut(clip=clip, title=video.CLIP_TITLES.get(clip, clip), host=addr.host, port=addr.port, path=addr.path)
            )
    return MetaOut(
        version=VERSION,
        demo_mode=settings.demo_mode,
        analysis_provider=settings.analysis_provider,
        timezone=settings.timezone,
        server_time=utcnow().isoformat(),
        database="sqlite" if settings.is_sqlite else "postgresql",
        auth_mode=settings.auth_mode,
        keycloak=keycloak,
        video=VideoOut(
            enabled=settings.video_enabled,
            webrtc_url=settings.video_webrtc_url.rstrip("/"),
            frame_interval_s=settings.frame_interval_s,
            check_interval_s=settings.check_interval_s,
        ),
        tracker=TrackerOut(
            enabled=relay.enabled,
            connected=relay.connected,
            video_delay_ms=settings.tracker_video_delay_ms,
            last_message_at=relay.last_message_at.isoformat() if relay.last_message_at else None,
            problem=relay.problem,
            problem_at=relay.problem_at.isoformat() if relay.problem_at else None,
        ),
        demo_feeds=feeds,
    )


for module in (auth, catalog, cameras, snapshots, alerts, analyze, reports, ingest, video_api, tracks, audit, admin):
    api.include_router(module.router)
app.include_router(api)

app.mount("/media/seed", StaticFiles(directory=ASSETS_DIR / "seed"), name="seed-media")
app.mount("/media/frames", StaticFiles(directory=settings.frames_dir, check_dir=False), name="frames")
