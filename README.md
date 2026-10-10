# Parking — сервис платной парковки

Тестовое задание №8: водитель бронирует место, заезжает через шлагбаум (симулятор) и платит по факту по дневному/ночному поминутному тарифу. Текст задания — [`docs/TASK.md`](docs/TASK.md).

## Статус

**Каркас, схема БД, тарификация, вход и бронирование.** Работают API входа, профиля водителя и бронирования, расчёт тарифа (чистая функция). Шлагбаума, worker-задач (no-show, письма), realtime и UI пока нет.

| Что | Состояние |
|---|---|
| `docker compose up --build` поднимает postgres, backend, worker, frontend, mailpit | работает |
| Миграции применяются автоматически при старте backend | работает: вся модель данных из ARCHITECTURE §2 |
| Инварианты в БД: непересечение броней, одна машина внутри, одно место — одна машина, одно письмо на (бронь, вид) | работает на уровне БД, покрыто тестами `backend/test/schema/` |
| Справочники: 20 мест, тариф день 2,50 / ночь 1,20 за минуту | работает (миграция) |
| Демо-пользователи | работает (`SEED_DEMO=true` в compose) |
| `GET /api/health` проверяет соединение с БД (200 / 503) | работает, покрыт e2e-тестом |
| Фронтенд показывает ответ `/api/health` | работает |
| Worker опрашивает БД в цикле, корректно останавливается по SIGTERM | работает (задач пока нет) |
| Расчёт счёта: поминутно, день/ночь, версии тарифа, переход на летнее время | работает: чистая функция `backend/src/tariffing/`, покрыта примерами и property-тестами |
| API: вход (JWT, роли), профиль водителя и машины, бронирование и отмена, схема мест с состоянием и `version` | работает, покрыто e2e-тестами `backend/test/api/` |
| API: шлагбаум, выставление счёта, история визитов, письма, realtime; UI | не сделано — план в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

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

Демо-учётки (создаются при старте, пароль `parking123`):

| Email | Роль | Машины |
|---|---|---|
| `operator@parking.local` | оператор | — |
| `driver1@parking.local` | водитель | `A123BC` |
| `driver2@parking.local` | водитель | `B777OP`, `E001KX` |

Входа в UI пока нет — учётки пригодятся со следующих этапов.

## Тесты

```bash
cd backend
npm ci
npm test            # юнит-тесты
npm run test:e2e    # e2e на реальном PostgreSQL (testcontainers, нужен Docker)
```

С БД из compose вместо testcontainers: `DATABASE_URL=postgres://parking:parking@localhost:5433/parking npm run test:e2e` — тесты пересоздают на том же сервере отдельную БД `parking_e2e`, данные в `parking` не трогаются.

## Доказательства

| Требование | Чем подтверждается | Статус |
|---|---|---|
| Быстрое локальное развёртывание (общие требования 8–9) | `docker compose up --build`, healthcheck'и в `docker-compose.yml` | работает |
| Хранилище — PostgreSQL, схема только миграциями | `backend/test/health.e2e-spec.ts` (миграции применены, `synchronize = false`), `backend/test/schema/migrations.e2e-spec.ts` (все миграции откатываются и применяются заново) | работает |
| «Две брони на одно место не пересекаются, даже если оформлены одновременно» | API: `backend/test/api/bookings.e2e-spec.ts` — 20 параллельных `POST /api/bookings` → ровно один 201 и 19× 409 `BOOKING_CONFLICT`, соседние интервалы не конфликтуют, отменённая бронь не мешает, одна машина на два места → 409 `CAR_ALREADY_BOOKED`; свойство (fast-check): `test/api/bookings.property.e2e-spec.ts` — случайный набор интервалов параллельно → принятые попарно не пересекаются, каждый отказ действительно пересекался с принятой (тест нашёл ложный 409 через `40P01`, исправлено — D-024); `src/bookings/booking-errors.spec.ts` (`23P01`/`40P01` → 409); БД: `test/schema/bookings.e2e-spec.ts`, `test/schema/concurrency.e2e-spec.ts` | работает |
| «Двойной заезд по одному номеру не ломает учёт» | на уровне БД: `visits-invoices.e2e-spec.ts` (`visits_one_open_per_plate`), `concurrency.e2e-spec.ts` (10 параллельных заездов → один визит) | БД — работает; шлагбаум — не сделано |
| «За 10 минут до конца брони письмо. Одно.» | на уровне БД: `journals-outbox.e2e-spec.ts` (`UNIQUE (booking_id, kind)`, `ON CONFLICT DO NOTHING` = 0 строк) | БД — работает; worker и отправка — не сделано |
| «Тариф по минутам, дневной и ночной. Визит через границу дня и ночи считается правильно, копейки не теряются» | `backend/src/tariffing/calculate-charge.spec.ts`: целиком день/ночь, через 23:00, 07:00, полночь, больше суток, 0 и 30 секунд, минута через 23:00, смена версии тарифа, переход на летнее/зимнее время; `calculate-charge.property.spec.ts` (fast-check): сумма сегментов = итог, совпадение с поминутным перебором (в том числе вокруг переходов DST), целые копейки, монотонность; `invoices.amount_kop integer` | расчёт — работает (чистая функция); выставление счёта при выезде — не сделано |
| Профиль водителя: почта, номера машин | `test/api/auth.e2e-spec.ts`, `test/api/cars.e2e-spec.ts` («а123вс» и «A123BC» — одна машина, номер у одного профиля), `src/plates/normalize-plate.spec.ts`; БД: `test/schema/users-cars.e2e-spec.ts` | работает |
| Бронь места: интервал, номер машины | `test/api/bookings.e2e-spec.ts`: создание, правила периода (15 мин…24 ч, не в прошлом, ≤ 7 дней), одна машина — одна бронь на время, отмена, чужие брони не видны; `src/bookings/booking-period.spec.ts` | работает |
| Схема парковки с местами и их состоянием: свободно, забронировано, занято | `test/schema/spot-state.e2e-spec.ts` (одна SQL-функция: `occupied` > `booked` > `free`, окно 15 мин, смена `version` только при реальном изменении), `test/api/spots.e2e-spec.ts` (`GET /api/spots` с `state` и `version`, состояние следует за `Clock`, бронь и отмена шлют `spot.updated` через NOTIFY только после COMMIT) | API — работает; рассылка в браузер (socket.io) и UI — не сделано |
| Почта эмулируется | Mailpit в compose | сервис поднят, писем ещё нет |
| Остальные требования задания | план тестов — [`docs/ARCHITECTURE.md` §7](docs/ARCHITECTURE.md#7-план-доказательства) | не сделано |

## Документы

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — архитектура, модель данных, API, тарификация, план доказательства.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — журнал решений (в т.ч. использованные генераторы — D-016).
- [`docs/DEVLOG.md`](docs/DEVLOG.md) — ход работы по времени.

## Чем делали

Claude Code, модель opus 5.5. Генераторы: Nest CLI 11 (backend), шаблон Vite `react-ts` (frontend) — см. D-016.
