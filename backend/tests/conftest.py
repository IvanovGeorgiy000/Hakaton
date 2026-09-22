"""Тесты работают на отдельной временной базе и без сети: «камеры» и сервис анализа подменяются транспортом httpx."""

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="stroykontrol-tests-"))
os.environ.update(
    {
        # по умолчанию — временный SQLite; чтобы прогнать те же тесты на PostgreSQL, задайте SK_TEST_DATABASE_URL
        "SK_DATABASE_URL": os.environ.get("SK_TEST_DATABASE_URL", f"sqlite+aiosqlite:///{_TMP / 'test.db'}"),
        "SK_DATA_DIR": str(_TMP),
        "SK_CAPTURE_INTERVAL_S": "0",
        "SK_INGEST_API_KEY": "ingest-test-key",
        "SK_DEMO_PASSWORD": "stand-password",
        "SK_ANALYSIS_PROVIDER": "mock",
    }
)

import httpx  # noqa: E402
import pytest  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import reset  # noqa: E402
from app.services import camera_client  # noqa: E402


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client():
    """Свежая демонстрационная база + HTTP-клиент, подключённый к приложению напрямую (без сокетов)."""
    await reset()
    transport = httpx.ASGITransport(app=app)
    camera_client.TRANSPORT = transport  # встроенная демо-камера «отвечает» из того же приложения
    async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8100") as http:
        yield http
    camera_client.TRANSPORT = None
    await engine.dispose()  # у каждого теста свой цикл событий — соединения PostgreSQL между ними не переносим


async def login_as(http: httpx.AsyncClient, role: str) -> dict[str, str]:
    response = await http.post("/api/auth/demo-login", json={"role": role})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}
