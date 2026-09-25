"""Настройки приложения. Все переменные окружения начинаются с префикса SK_ (см. .env.example)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # каталог backend/
ASSETS_DIR = Path(__file__).resolve().parent / "assets"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SK_", env_file=".env", extra="ignore")

    # --- общее ---
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR / 'data' / 'stroykontrol.db'}"
    data_dir: Path = BASE_DIR / "data"
    timezone: str = "Europe/Moscow"
    cors_origins: str = "http://localhost:5180,http://127.0.0.1:5180"

    # --- доступ ---
    secret_key: str = "dev-only-secret-change-me"  # подпись токенов и шифрование паролей камер
    token_ttl_hours: int = 12
    demo_mode: bool = True  # вход по роли без пароля, публичная страница сверки, встроенная демо-камера
    demo_password: str = "demo"  # пароль учётных записей стенда, задаётся при первом наполнении базы
    seed_on_start: bool = True  # наполнить пустую базу демонстрационными данными

    # --- Keycloak (включается, если задан issuer) ---
    keycloak_issuer: str | None = None  # напр. http://localhost:8080/realms/stroykontrol
    keycloak_client_id: str = "stroykontrol-web"  # клиент, чьи токены принимаем (проверяется azp/aud)
    keycloak_auto_provision: bool = True  # пускать пользователя Keycloak, которого нет в базе (без привязки к объектам)
    # служебный клиент, от имени которого наша админка меняет в Keycloak пользователей, роли и пароли
    keycloak_admin_client_id: str = "stroykontrol-backend"
    keycloak_admin_client_secret: str | None = None

    # --- анализ кадров ---
    # mock — встроенная заглушка; http — каждый кадр (раз в frame_interval_s) уходит во внешний сервис;
    # push — внешний сервис сам присылает детекции в /api/ingest, сервер кадры не разбирает
    analysis_provider: Literal["mock", "http", "push"] = "mock"
    analysis_api_url: str | None = None  # полный адрес метода, например http://ml:8200/analyze
    analysis_api_key: str | None = None
    analysis_timeout_s: float = 20.0
    ingest_api_key: str | None = None  # ключ для приёма готовых детекций от внешнего сервиса (push-режим)

    # --- камеры и видео ---
    # Видео идёт через шлюз mediamtx: он забирает RTSP с камер и отдаёт браузеру WebRTC. Сервер сам заводит в шлюзе
    # по потоку на камеру (через его API), берёт из потоков кадры на анализ и отвечает шлюзу, кому можно смотреть.
    video_enabled: bool = True  # False — без шлюза (тесты): потоки не заводятся, кадры не берутся
    video_api_url: str = "http://127.0.0.1:9997"  # API шлюза
    video_rtsp_url: str = "rtsp://127.0.0.1:8554"  # RTSP шлюза: отсюда сервер берёт кадры и сюда публикует демо-ролики
    video_webrtc_url: str = "http://localhost:8889"  # WebRTC шлюза — этот адрес получает браузер
    frame_interval_s: float = 2.0  # раз во сколько секунд кадр с каждой камеры уходит на анализ
    check_interval_s: int = 60  # раз во сколько секунд объект сверяется с планом; 0 — не сверять в фоне
    camera_timeout_s: float = 6.0
    allow_loopback_cameras: bool = True  # разрешить 127.0.0.1 (демо-ролики крутит шлюз на этом же компьютере)
    max_frame_bytes: int = 12 * 1024 * 1024
    keep_frames_per_camera: int = 200  # сколько сохранённых кадров держать на камеру (доказательства не удаляются)

    # --- рамки техники в реальном времени (внешний сервис разметки: детектор + трекер) ---
    # Сервис сам читает видео из шлюза и отдаёт рамки по WebSocket; сервер пересылает их браузерам (с проверкой прав).
    tracker_url: str | None = (
        None  # WebSocket сервиса, например ws://127.0.0.1:8200/stream; не задан — рамки раз в 2 с из анализа
    )
    tracker_api_key: str | None = None  # ключ сервиса: список камер, чтение видео из шлюза, подключение к его WebSocket
    tracker_video_delay_ms: int = 150  # на столько браузер придерживает видео, чтобы рамки совпадали с картинкой

    def insecure_defaults(self) -> list[str]:
        """Что нельзя оставлять по умолчанию в боевом запуске (демо-режим выключен)."""
        if self.demo_mode:
            return []
        fields = type(self).model_fields
        problems = []
        # оба стандартных ключа (здесь и в docker-compose.yml) открыты в репозитории — по ним любой подпишет себе вход администратора
        if self.secret_key in {fields["secret_key"].default, "change-me-before-real-use"} or len(self.secret_key) < 16:
            problems.append("SK_SECRET_KEY: задайте свой случайный ключ не короче 16 символов (стандартный открыт в репозитории)")
        if self.seed_on_start and self.demo_password == fields["demo_password"].default:
            problems.append("SK_DEMO_PASSWORD не задан: у всех учётных записей из наполнения базы был бы пароль «demo»")
        return problems

    @property
    def auth_mode(self) -> str:
        return "keycloak" if self.keycloak_issuer else "local"

    @property
    def keycloak_url(self) -> str | None:
        """База Keycloak без /realms/<realm> — нужна фронтенду для keycloak-js."""
        return self.keycloak_issuer.split("/realms/")[0] if self.keycloak_issuer else None

    @property
    def keycloak_realm(self) -> str | None:
        return self.keycloak_issuer.rstrip("/").split("/realms/")[-1] if self.keycloak_issuer else None

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def frames_dir(self) -> Path:
        return self.data_dir / "media" / "frames"

    @property
    def clips_dir(self) -> Path:
        """Ролики демо-камер (H.264, крутятся по кругу)."""
        return ASSETS_DIR / "clips"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
