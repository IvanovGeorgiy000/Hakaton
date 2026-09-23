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

    # --- анализ кадров ---
    analysis_provider: Literal["mock", "http"] = "mock"
    analysis_api_url: str | None = None  # полный адрес метода, например http://ml:8200/analyze
    analysis_api_key: str | None = None
    analysis_timeout_s: float = 20.0
    ingest_api_key: str | None = None  # ключ для приёма готовых детекций от внешнего сервиса (push-режим)

    # --- камеры ---
    capture_interval_s: int = 300  # период автоматического опроса камер, 0 — выключить
    camera_timeout_s: float = 6.0
    allow_loopback_cameras: bool = True  # разрешить 127.0.0.1 (нужно для встроенной демо-камеры)
    max_frame_bytes: int = 12 * 1024 * 1024
    keep_frames_per_camera: int = 200  # сколько сохранённых кадров держать на камеру (доказательства не удаляются)
    self_url: str = "http://127.0.0.1:8100"  # адрес, по которому сервер виден сам себе — для встроенной демо-камеры
    mock_camera_user: str = "demo"
    mock_camera_password: str = "demo"

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
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
