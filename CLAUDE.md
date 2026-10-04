# Parking — сервис платной парковки (тестовое задание №8)

Полный текст задания и общие требования: `docs/TASK.md`. Перед любой крупной задачей сверяйся с ним.

## Стек
- Backend: Node.js 22, NestJS, TypeScript (strict), TypeORM, валидация DTO через class-validator
- Миграции: TypeORM migrations, написанные вручную на SQL (EXCLUDE-ограничения и частичные индексы ORM сам не генерирует). `synchronize: false` всегда.
- Worker: отдельная точка входа того же NestJS-проекта (`main.worker.ts`, standalone application context). Фоновые задачи — опрос БД, без Redis/очередей.
- БД: PostgreSQL 16 (расширение `btree_gist`)
- Время и часовые пояса: Luxon (никакой ручной арифметики со смещениями)
- Frontend: React + TypeScript + Vite, TanStack Query, socket.io-client
- Realtime: `@nestjs/websockets` + socket.io. События из worker доходят до gateway через PostgreSQL LISTEN/NOTIFY.
- Почта: nodemailer → Mailpit (заглушка, веб-интерфейс на :8025)
- Тесты: Jest + supertest на реальном PostgreSQL (testcontainers или БД из compose), fast-check для property-based тестов, Playwright для E2E
- Структура: `backend/`, `frontend/`, `docker-compose.yml` в корне
- Запуск: `docker compose up` — поднимает всё одной командой

> Если стек меняется — сначала запись в `docs/DECISIONS.md`, потом правка этого файла.

## Команды
- Запуск всего: `docker compose up --build` → фронтенд http://localhost:8080, API http://localhost:3000/api (health: `/api/health`), Mailpit http://localhost:8025, PostgreSQL `localhost:5433` (parking/parking).
- Остановить и стереть данные: `docker compose down -v`
- Тесты backend (в `backend/`):
  - юнит: `npm test`
  - e2e (supertest, реальный PostgreSQL): `npm run test:e2e` — сам поднимает `postgres:16-alpine` через testcontainers (нужен Docker); с БД из compose: `DATABASE_URL=postgres://parking:parking@localhost:5433/parking npm run test:e2e`
- Lint / сборка: `npm run lint`, `npm run build` (и в `backend/`, и в `frontend/`)
- Миграции: применяются автоматически при старте backend (worker их не запускает). Вручную, в `backend/` с заданным `DATABASE_URL`: `npm run migration:run` / `migration:revert` / `migration:show`. Новая: `npm run migration:create -- src/database/migrations/<Name>`, затем добавить класс в `src/database/migrations/index.ts` (список явный).
- Разработка без Docker для приложений: `docker compose up -d postgres mailpit`; `cd backend && cp .env.example .env && npm run start:dev` (API) и `npm run start:worker:dev` (worker); `cd frontend && npm run dev` (Vite проксирует `/api` на :3000).
- Демо-данные: создаются при старте backend, если `SEED_DEMO=true` (в compose включено); вручную — `npm run seed` в `backend/` (нужны `DATABASE_URL` и применённые миграции). Учётки: `operator@parking.local`, `driver1@parking.local`, `driver2@parking.local`, пароль `parking123`.
- E2E (Playwright): ещё нет — появится вместе с UI схемы парковки.

## Архитектурные принципы (не нарушать)
1. **Деньги только целыми копейками.** В БД — `integer` (не `bigint`: драйвер pg отдаёт bigint строкой) или `bigint` с явным трансформером в number. Никаких float, никаких `0.1 + 0.2` в расчётах.
2. **Время хранится в UTC (`timestamptz`)**, отображается в часовом поясе парковки.
3. **Текущее время — только через внедряемый `Clock`-провайдер NestJS.** Никаких прямых `new Date()` / `Date.now()` в доменной логике, чтобы тесты могли управлять временем.
4. **Инварианты защищает БД, а не только код:**
   - непересечение броней — `EXCLUDE USING gist (spot_id WITH =, period WITH &&)` по активным броням;
   - одна машина не может быть внутри дважды — частичный уникальный индекс на открытый визит по номеру;
   - одно место не может быть занято двумя визитами одновременно — аналогично.
5. **Никаких таймеров в памяти.** Все отложенные действия (снятие брони, напоминания) выполняет worker, опрашивая БД (`FOR UPDATE SKIP LOCKED`). Состояние переживает перезапуск.
6. **Любое письмо — через таблицу outbox** с уникальным ключом (например `(booking_id, kind)`). Повторный запуск воркера не создаёт второе письмо.
7. **Операции шлагбаума идемпотентны и устойчивы к мусору:** выезд без заезда, двойной заезд — понятная ошибка + запись в журнал аномалий, учёт не ломается.
8. **Номера машин нормализуются:** верхний регистр, без пробелов, кириллические двойники (А В Е К М Н О Р С Т У Х) приводятся к латинице.
9. **Тарификация — чистая функция без I/O**, покрытая юнит-тестами. Интервал режется по границам тарифов; тариф берётся по периоду действия.
10. Пороги (15 мин no-show, 10 мин напоминание) задаются через env, чтобы было возможно демо с короткими значениями.

## Доменные правила
Зафиксированы в `docs/DECISIONS.md`. Если правило не описано — **не придумывай молча**: предложи вариант и спроси, после подтверждения запиши в DECISIONS.

## Порядок работы (обязательно на каждом этапе)
1. Если задача крупная — сначала план, жди подтверждения.
2. Сначала тесты на критичную логику (конкуренция, деньги, время), потом реализация.
3. Тесты зелёные — только тогда этап считается выполненным. Не отключай и не ослабляй тесты, чтобы они прошли; если тест кажется неверным — скажи об этом.
4. Выполни `date` и добавь запись в `docs/DEVLOG.md` с **реальным** временем из вывода команды (не выдумывай время).
5. Принятые решения — в `docs/DECISIONS.md`.
6. Если затронуто требование из задания — обнови таблицу доказательств в `README.md`.
7. Предложи сообщение коммита (Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`). Один логический шаг — один коммит.

## Чего не делать
- Не добавлять зависимости без короткого обоснования в DECISIONS.md.
- Не трогать файлы вне текущего этапа без необходимости.
- Не использовать моки БД в тестах на инварианты — только реальный PostgreSQL.
- Не переписывать git-историю (никаких squash/force-push).
- Не писать в README то, что не работает. Статус — честный.
