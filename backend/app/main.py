"""СтройКонтроль API: точка входа."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager, suppress
from urllib.parse import urlsplit

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api import alerts, analyze, auth, cameras, catalog, ingest, mock_camera, reports, snapshots
from app.config import ASSETS_DIR, get_settings
from app.db import Base, SessionLocal, engine, utcnow
from app.schemas import ApiModel
from app.seed import seed_if_empty
from app.services.analysis import get_analyzer
from app.services.engine import all_site_ids, capture_site, cleanup_frames

VERSION = "0.9.0"
settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("stroykontrol")


async def _scheduler() -> None:
    """Фоновый опрос камер. Один процесс — один опросчик: запускайте uvicorn с одним воркером."""
    interval, cycle = settings.capture_interval_s, 0
    await asyncio.sleep(min(interval, 20))
    while True:
        started = time.monotonic()
        try:
            async with SessionLocal() as session:
                site_ids = await all_site_ids(session)
            for site_id in site_ids:
                async with SessionLocal() as session:
                    report = await capture_site(session, site_id, trigger="schedule")
                    log.info(
                        "Проверка %s: кадров %d, ошибок камер %d, отклонений %d",
                        site_id,
                        len(report.snapshots),
                        len(report.errors),
                        len(report.check.violations),
                    )
            if (cycle := cycle + 1) % 12 == 0:
                async with SessionLocal() as session:
                    log.info("Удалено старых кадров: %d", await cleanup_frames(session))
        except Exception:
            log.exception("Сбой фоновой проверки — повторим в следующем цикле")
        await asyncio.sleep(max(5.0, interval - (time.monotonic() - started)))


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.frames_dir.mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    if settings.seed_on_start and await seed_if_empty():
        log.info("Пустая база наполнена демонстрационными данными")
    log.info("Анализ кадров: %s", get_analyzer().name)
    task = asyncio.create_task(_scheduler()) if settings.capture_interval_s > 0 else None
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    await engine.dispose()


app = FastAPI(
    title="СтройКонтроль API",
    version=VERSION,
    description="Мониторинг строительных площадок по камерам: кадры → техника → сверка с графиком → отклонения.",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_methods=["*"], allow_headers=["*"])


class DemoCameraOut(ApiModel):
    title: str
    host: str
    port: int
    path: str


class MetaOut(ApiModel):
    version: str
    demo_mode: bool
    analysis_provider: str
    capture_interval_s: int
    timezone: str
    server_time: str
    database: str
    demo_cameras: list[DemoCameraOut]  # готовые адреса встроенной демо-камеры для формы «Добавить камеру»
    auth_mode: str  # local | keycloak
    keycloak: dict | None  # {url, realm, clientId} — когда включён Keycloak


api = APIRouter(prefix="/api")


@api.get("/meta", response_model=MetaOut, tags=["Служебное"], summary="Состояние сервера и режимы работы")
async def meta() -> MetaOut:
    async with SessionLocal() as session:
        await session.execute(text("SELECT 1"))
    self_url = urlsplit(settings.self_url)
    demo_cameras = (
        [
            DemoCameraOut(
                title=title,
                host=self_url.hostname or "127.0.0.1",
                port=self_url.port or 80,
                path=f"/mock-camera/{scene}/snapshot.jpg",
            )
            for scene, (title, _) in mock_camera.SCENES.items()
        ]
        if settings.demo_mode
        else []
    )
    keycloak = None
    if settings.keycloak_issuer:
        keycloak = {"url": settings.keycloak_url, "realm": settings.keycloak_realm, "clientId": settings.keycloak_client_id}
    return MetaOut(
        demo_cameras=demo_cameras,
        auth_mode=settings.auth_mode,
        keycloak=keycloak,
        version=VERSION,
        demo_mode=settings.demo_mode,
        analysis_provider=get_analyzer().name,
        capture_interval_s=settings.capture_interval_s,
        timezone=settings.timezone,
        server_time=utcnow().isoformat(),
        database="sqlite" if settings.is_sqlite else "postgresql",
    )


for module in (auth, catalog, cameras, snapshots, alerts, analyze, reports, ingest):
    api.include_router(module.router)
app.include_router(api)
app.include_router(mock_camera.router)

app.mount("/media/seed", StaticFiles(directory=ASSETS_DIR / "seed"), name="seed-media")
app.mount("/media/frames", StaticFiles(directory=settings.frames_dir, check_dir=False), name="frames")
