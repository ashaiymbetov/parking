# Parking — сервис платной парковки

Тестовое задание №8: водитель бронирует место, заезжает через шлагбаум (симулятор) и платит по факту по дневному/ночному поминутному тарифу. Текст задания — [`docs/TASK.md`](docs/TASK.md).

## Статус

**Каркас.** Предметной логики (брони, визиты, тарифы, шлагбаум, письма) пока нет — только инфраструктура, на которую она ляжет.

| Что | Состояние |
|---|---|
| `docker compose up --build` поднимает postgres, backend, worker, frontend, mailpit | работает |
| Миграции применяются автоматически при старте backend | работает (пока одна: расширения `btree_gist`, `citext`) |
| `GET /api/health` проверяет соединение с БД (200 / 503) | работает, покрыт e2e-тестом |
| Фронтенд показывает ответ `/api/health` | работает |
| Worker опрашивает БД в цикле, корректно останавливается по SIGTERM | работает (задач пока нет) |
| Брони, схема мест, шлагбаум, тарификация, письма, realtime | не сделано — план в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

## Требования

- Docker с Docker Compose v2.
- Свободные порты: 8080, 3000, 8025, 1025, 5433.
- Для запуска тестов и разработки без Docker: Node.js 22, npm.

## Запуск

```bash
docker compose up --build
```

| Сервис | Адрес |
|---|---|
| Фронтенд | http://localhost:8080 |
| API | http://localhost:3000/api/health |
| Mailpit (письма) | http://localhost:8025 |
| PostgreSQL | `localhost:5433`, БД/пользователь/пароль `parking` |

Сбросить данные: `docker compose down -v`.

## Тесты

```bash
cd backend
npm ci
npm test            # юнит-тесты
npm run test:e2e    # e2e на реальном PostgreSQL (testcontainers, нужен Docker)
```

С БД из compose вместо testcontainers: `DATABASE_URL=postgres://parking:parking@localhost:5433/parking npm run test:e2e`.

## Доказательства

| Требование | Чем подтверждается | Статус |
|---|---|---|
| Быстрое локальное развёртывание (общие требования 8–9) | `docker compose up --build`, healthcheck'и в `docker-compose.yml` | работает |
| Хранилище — PostgreSQL, схема только миграциями | `backend/test/health.e2e-spec.ts` (миграция применена, `synchronize = false`), `backend/src/database/data-source-options.spec.ts` | работает |
| Почта эмулируется | Mailpit в compose | сервис поднят, писем ещё нет |
| Остальные требования задания | план тестов — [`docs/ARCHITECTURE.md` §7](docs/ARCHITECTURE.md#7-план-доказательства) | не сделано |

## Документы

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — архитектура, модель данных, API, тарификация, план доказательства.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — журнал решений (в т.ч. использованные генераторы — D-016).
- [`docs/DEVLOG.md`](docs/DEVLOG.md) — ход работы по времени.

## Чем делали

Claude Code, модель opus 5.5. Генераторы: Nest CLI 11 (backend), шаблон Vite `react-ts` (frontend) — см. D-016.
