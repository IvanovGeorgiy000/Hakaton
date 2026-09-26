"""Отправка кадров сервисам аналитики и приём ответов — по расписанию и по кнопке.

Раз в analytics_interval_min минут по каждой камере рабочей зоны: свежий кадр (новый с прошлой отправки) уходит обоим
подключённым сервисам — одновременно, с одним request_id. Камеры и объекты — по очереди: сервис по изображению
думает минутами и стоит денег. Пока сервисы думают, соединение с базой не держим. Ответы и отказы хранятся
в analytics_results; оба ответа показываются рядом, «победителя» не выбираем (раздел 12).
"""

import asyncio
import logging
import math
import time
from collections import defaultdict
from datetime import datetime, timedelta

import httpx
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import SessionLocal, utcnow
from app.models import AnalyticsRequest, AnalyticsResult, Camera, Site, Snapshot, Zone, new_id
from app.services.analytics.catalog import CatalogCache, CatalogError
from app.services.analytics.client import Reply, ServiceClient
from app.services.analytics.images import ImageProblem
from app.services.analytics.request import BuiltRequest, RequestProblem, build_request
from app.services.analytics.result import check_result
from app.services.engine import FRESHNESS

log = logging.getLogger("stroykontrol.analytics")

STARTUP_DELAY_S = 30.0  # после запуска сервера — подождать, пока сверка сохранит свежие кадры
ROUND_S = 60.0
CLEANUP_S = 3600.0


async def work_cameras(session: AsyncSession, site_id: str | None = None) -> list[Camera]:
    """Камеры рабочих зон: только их кадры уходят сервисам."""
    query = (
        select(Camera)
        .join(Zone, Camera.zone_id == Zone.id)
        .join(Site, Camera.site_id == Site.id)
        .where(Camera.enabled, Camera.deleted_at.is_(None), Zone.kind == "work")
        .order_by(Site.position, Camera.position)
    )
    if site_id:
        query = query.where(Camera.site_id == site_id)
    return list(await session.scalars(query))


async def fresh_snapshot(session: AsyncSession, camera_id: str, now: datetime) -> Snapshot | None:
    return await session.scalar(
        select(Snapshot)
        .where(Snapshot.camera_id == camera_id, Snapshot.taken_at <= now, Snapshot.taken_at >= now - FRESHNESS)
        .order_by(Snapshot.taken_at.desc())
        .limit(1)
    )


class Analytics:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        settings = get_settings()
        self.clients = {
            name: ServiceClient(name, url, settings.analytics_service_token, settings.analytics_http_timeout_seconds, transport)
            for name, url in settings.analytics_services.items()
        }
        # сохранённый справочник — только при подключённых сервисах: без них выбирать вид работ не из чего
        self.catalog = CatalogCache(self._fetch_catalog, settings.data_dir / "analytics-catalog.json" if self.clients else None)
        self.problems: dict[str, tuple[datetime, str]] = {}  # объект → почему последний запрос не ушёл
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._manual: dict[str, asyncio.Task] = {}
        self._task: asyncio.Task | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.clients)

    def running(self, site_id: str) -> bool:
        task = self._manual.get(site_id)
        return bool(task and not task.done()) or self._locks[site_id].locked()

    async def _fetch_catalog(self) -> dict:
        if not self.clients:
            raise CatalogError("сервисы аналитики не подключены")
        errors = []
        for client in self.clients.values():  # справочник у сервисов общий: берём у первого ответившего
            try:
                return await client.get_json("/v1/catalog")
            except CatalogError as exc:
                errors.append(str(exc))
        raise CatalogError("; ".join(errors))

    # ---------- один кадр ----------
    async def analyze_camera(self, camera_id: str, *, trigger: str, only_new: bool = True) -> AnalyticsRequest | None:
        """Отправить свежий кадр камеры обоим сервисам и сохранить ответы. None — отправлять нечего или нельзя
        (причина — в problems по объекту)."""
        async with SessionLocal() as session:
            camera = await session.get(Camera, camera_id)
        if camera is None or not self.clients:
            return None
        async with self._locks[camera.site_id]:  # по объекту — по очереди: кнопка во время планового подождёт его
            built = await self._prepare(camera_id, trigger=trigger, only_new=only_new)
            if built is None:
                return None
            replies = await asyncio.gather(*(self._ask(name, built) for name in self.clients))
            async with SessionLocal() as session:
                rows = {
                    r.service: r
                    for r in await session.scalars(select(AnalyticsResult).where(AnalyticsResult.request_id == built.request_id))
                }
                for name, (reply, elapsed_ms) in zip(self.clients, replies, strict=True):
                    if row := rows.get(name):
                        _apply(row, reply, elapsed_ms)
                await session.commit()
                return await session.get(AnalyticsRequest, built.request_id, populate_existing=True)

    async def _prepare(self, camera_id: str, *, trigger: str, only_new: bool) -> BuiltRequest | None:
        async with SessionLocal() as session:
            camera = await session.get(Camera, camera_id)
            site = await session.get(Site, camera.site_id) if camera else None
            if site is None or not camera.enabled or camera.deleted_at is not None or camera.zone.kind != "work":
                return None
            now = utcnow()
            snapshot = await fresh_snapshot(session, camera.id, now)
            if snapshot is None:
                return None
            if only_new:
                last = await session.scalar(
                    select(AnalyticsRequest.snapshot_id)
                    .where(AnalyticsRequest.camera_id == camera.id)
                    .order_by(AnalyticsRequest.at.desc())
                    .limit(1)
                )
                if last == snapshot.id:
                    return None  # этот кадр уже отправляли
            try:
                catalog = await self.catalog.get()
                built = await build_request(
                    session, request_id=new_id("fa"), site=site, camera=camera, snapshot=snapshot, catalog=catalog
                )
            except (CatalogError, RequestProblem, ImageProblem) as exc:
                self.problems[site.id] = (now, f"{camera.name}: {exc}")
                log.warning("Кадр камеры %s не отправлен сервисам аналитики: %s", camera.id, exc)
                return None
            self.problems.pop(site.id, None)
            session.add(
                AnalyticsRequest(
                    id=built.request_id,
                    site_id=site.id,
                    camera_id=camera.id,
                    snapshot_id=snapshot.id,
                    at=now,
                    trigger=trigger,
                    observed_at=snapshot.taken_at,
                    image_sha256=built.image.sha256,
                    input_sha256=built.input_sha256,
                    catalog_version=catalog.version,
                    plan_revision_id=built.plan_revision_id,
                    plan_note=built.plan_note,
                    notes=built.notes,
                    metadata_json=built.body.decode("utf-8"),
                    results=[AnalyticsResult(service=name, state="pending") for name in self.clients],
                )
            )
            await session.commit()
            return built

    async def _ask(self, service: str, built: BuiltRequest) -> tuple[Reply, int]:
        started = time.perf_counter()
        try:
            reply = await self.clients[service].analyze(
                request_id=built.request_id,
                site_id=built.metadata["site_id"],
                metadata=built.body,
                image=built.image.data,
                media_type=built.image.media_type,
            )
        except Exception as exc:  # noqa: BLE001 — сбой клиента не должен оставить запрос «в ожидании» навсегда
            log.exception("Сбой при обращении к сервису %s", service)
            reply = Reply("unknown", code="client_failure", message=f"сбой на нашей стороне: {type(exc).__name__}")
        if reply.state == "done" and (problem := check_result(reply.result, service=service, metadata=built.metadata,
                                                              input_sha256=built.input_sha256)):  # fmt: skip
            log.warning("Ответ сервиса %s на %s не принят: %s", service, built.request_id, problem)
            reply = Reply("error", reply.http_status, result=reply.result, code="invalid_result", message=problem)
        return reply, int((time.perf_counter() - started) * 1000)

    # ---------- объект целиком ----------
    async def analyze_site(self, site_id: str, *, trigger: str, only_new: bool = False) -> list[AnalyticsRequest]:
        async with SessionLocal() as session:
            camera_ids = [c.id for c in await work_cameras(session, site_id)]
        done = []
        for camera_id in camera_ids:  # по очереди: сервис по изображению тяжёлый
            if request := await self.analyze_camera(camera_id, trigger=trigger, only_new=only_new):
                done.append(request)
        return done

    def start_site(self, site_id: str) -> bool:
        """«Определить сейчас»: все камеры рабочих зон объекта в фоне. False — уже идёт."""
        if self.running(site_id):
            return False
        self._manual[site_id] = asyncio.create_task(self.analyze_site(site_id, trigger="manual"), name=f"analytics-{site_id}")
        return True

    # ---------- по расписанию ----------
    async def start(self) -> None:
        async with SessionLocal() as session:
            await interrupt_pending(session)
        if self.clients and self._task is None:
            self._task = asyncio.create_task(self._loop(), name="analytics")

    async def stop(self) -> None:
        tasks = [t for t in (self._task, *self._manual.values()) if t and not t.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._task = None
        for client in self.clients.values():
            await client.close()

    async def _loop(self) -> None:
        loop = asyncio.get_running_loop()
        await asyncio.sleep(STARTUP_DELAY_S)
        cleaned = -math.inf
        while True:
            try:
                await self.round()
                if loop.time() - cleaned >= CLEANUP_S:
                    cleaned = loop.time()
                    async with SessionLocal() as session:
                        await cleanup(session)
            except Exception:  # noqa: BLE001 — сбой одного круга не останавливает расписание
                log.exception("Сбой планового круга аналитики")
            await asyncio.sleep(ROUND_S)

    async def round(self) -> None:
        """Отправить камеры, по которым последняя отправка старше интервала (или её не было)."""
        async with SessionLocal() as session:
            cameras = await work_cameras(session)
            last = dict(
                (
                    await session.execute(
                        select(AnalyticsRequest.camera_id, func.max(AnalyticsRequest.at)).group_by(AnalyticsRequest.camera_id)
                    )
                ).all()
            )
        due_before = utcnow() - timedelta(minutes=get_settings().analytics_interval_min)
        for camera in cameras:
            if last.get(camera.id) is None or last[camera.id] <= due_before:
                await self.analyze_camera(camera.id, trigger="schedule")


def _apply(row: AnalyticsResult, reply: Reply, elapsed_ms: int) -> None:
    row.state, row.finished_at, row.elapsed_ms, row.http_status = reply.state, utcnow(), elapsed_ms, reply.http_status
    row.result, row.error_code, row.error, row.retryable = reply.result, reply.code, reply.message, reply.retryable
    if reply.state == "done" and reply.result:
        row.analysis_id = str(reply.result.get("analysis_id") or "")[:100] or None
        row.outcome = reply.result["current_work"]["status"]


async def interrupt_pending(session: AsyncSession) -> None:
    """После перезапуска сервера ответы, которых ждали, уже не придут: выполнен ли анализ — неизвестно."""
    await session.execute(
        update(AnalyticsResult)
        .where(AnalyticsResult.state == "pending")
        .values(state="unknown", error_code="interrupted", error="сервер перезапустился, пока ждал ответ", finished_at=utcnow())
    )
    await session.commit()


async def cleanup(session: AsyncSession) -> None:
    """Запросы старше keep_usage_days — удалить; metadata (сотни килобайт) оставить только у последнего запроса
    каждой камеры. Журнал наблюдений чистит общая уборка кадров (engine.cleanup_frames) — он ведётся и без сервисов."""
    settings = get_settings()
    await session.execute(
        delete(AnalyticsRequest).where(AnalyticsRequest.at < utcnow() - timedelta(days=settings.keep_usage_days))
    )
    latest = (
        select(AnalyticsRequest.camera_id, func.max(AnalyticsRequest.at).label("at"))
        .group_by(AnalyticsRequest.camera_id)
        .subquery()
    )
    keep = select(AnalyticsRequest.id).join(
        latest, (AnalyticsRequest.camera_id == latest.c.camera_id) & (AnalyticsRequest.at == latest.c.at)
    )
    await session.execute(
        update(AnalyticsRequest)
        .where(AnalyticsRequest.metadata_json.is_not(None), AnalyticsRequest.id.not_in(keep))
        .values(metadata_json=None)
    )
    await session.commit()


_analytics: Analytics | None = None


def get_analytics() -> Analytics:
    global _analytics
    if _analytics is None:
        _analytics = Analytics()
    return _analytics
