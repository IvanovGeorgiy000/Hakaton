# СтройКонтроль

Сервис поиска отклонений на строительных площадках по снимкам с камер (ЛЦТ 2026, задача Департамента градостроительной
политики Москвы, команда «Работяги»): камера → техника на кадре → сверка с календарным планом → понятное предупреждение.

| Часть | Что внутри | Документация |
|---|---|---|
| [backend/](backend/) | API: FastAPI, движок сверки, камеры по IP, подключаемый анализ кадров | [backend/README.md](backend/README.md) |
| [frontend/](frontend/) | Интерфейс: React + TypeScript, четыре роли, страница `/demo` | [frontend/README.md](frontend/README.md) |
| [design-system/](design-system/) | Решения по дизайну интерфейса | |

## Запуск

**Docker (всё сразу, PostgreSQL):**

```bash
docker compose up --build        # интерфейс: http://localhost:8080 · API и Swagger: http://localhost:8100/docs
```

**Локально (два терминала):**

```bash
cd backend && uv sync && uv run uvicorn app.main:app --port 8100
```

```bash
cd frontend && npm install && npm run dev     # http://localhost:5180
```

Вход: кнопки быстрого входа по ролям на первом экране (демо-режим) или логин `prorab` / `rukovoditel` / `inspektor` / `admin`
с паролем стенда (`SK_DEMO_PASSWORD`, по умолчанию `demo`).
