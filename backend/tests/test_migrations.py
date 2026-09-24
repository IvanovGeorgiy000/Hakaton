"""Миграции: строят ту же структуру, что описана в моделях, откатываются, и сервер правильно встречает старые базы."""

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import func, inspect, select, text

from app import dbschema, seed
from app.db import Base, SessionLocal, engine
from app.models import Site, User

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
async def dispose_engine():
    yield
    await engine.dispose()  # у каждого теста свой цикл событий — соединения PostgreSQL между ними не переносим


async def _run(fn, *args):  # noqa: ANN001, ANN202
    async with engine.begin() as conn:
        return await conn.run_sync(fn, *args)


def _schema_diff(connection) -> list:  # noqa: ANN001
    return compare_metadata(MigrationContext.configure(connection, opts={"compare_type": True}), Base.metadata)


def _tables(connection) -> set[str]:  # noqa: ANN001
    return set(inspect(connection).get_table_names())


async def _legacy_database() -> None:
    """База, какую создавала версия 0.10: таблицы без отметки Alembic, версия структуры — в app_meta."""
    await seed._drop_everything()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("CREATE TABLE app_meta (key VARCHAR(40) PRIMARY KEY, value VARCHAR(200))"))
        await conn.execute(text("INSERT INTO app_meta (key, value) VALUES ('schema', '2')"))
        await conn.execute(
            text(
                "INSERT INTO sites (id, name, address, contractor, foreman_name, plan_progress, fact_progress, position) "
                "VALUES ('legacy', 'Старый объект', '', '', '', 0, 0, 0)"
            )
        )


async def test_migrations_build_the_same_schema_as_models():
    await seed._drop_everything()
    await _run(dbschema.upgrade)
    assert await _run(dbschema.current_revision) == dbschema.head_revision()
    assert await _run(_schema_diff) == []  # модели и миграции не разошлись: иначе нужна новая миграция

    await _run(lambda conn: command.downgrade(dbschema.alembic_config(conn), "base"))
    assert await _run(_tables) <= {"alembic_version"}
    await _run(dbschema.upgrade)  # и снова вверх — миграции проходят в обе стороны
    assert await _run(_schema_diff) == []


async def test_start_keeps_existing_data():
    await seed.reset()
    async with SessionLocal() as session:
        site = await session.get(Site, "s1")
        site.name = "Переименован до перезапуска"
        await session.commit()
    await seed.prepare_database()  # перезапуск сервера: база уже по последней миграции
    async with SessionLocal() as session:
        assert (await session.get(Site, "s1")).name == "Переименован до перезапуска"


async def test_demo_database_from_before_migrations_is_recreated():
    await _legacy_database()
    await seed.prepare_database()
    assert await _run(dbschema.current_revision) == dbschema.head_revision()
    assert "app_meta" not in await _run(_tables)
    async with SessionLocal() as session:
        assert await session.get(Site, "legacy") is None  # демо-база пересоздана
        assert await session.scalar(select(func.count()).select_from(User))  # и наполнена заново


async def test_production_database_from_before_migrations_is_left_alone(monkeypatch):
    await _legacy_database()
    monkeypatch.setattr(seed.settings, "demo_mode", False)
    with pytest.raises(RuntimeError, match="alembic stamp 0001"):
        await seed.prepare_database()
    async with SessionLocal() as session:
        assert (await session.get(Site, "legacy")).name == "Старый объект"  # боевые данные не тронуты
