# tiger_bet

tiger_bet — прототип сервиса для сбора матчей со stavka.tv, выбора категорий через Telegram-бота и дальнейшей аналитики/прогнозирования.

Сейчас проект находится в MVP-состоянии: основной активный контур — scheduler, который собирает данные по категориям из БД и парсит страницы матчей.

## Что делает проект сейчас

- Читает категории спорта из `public.prediction_category`.
- Для каждой категории запрашивает страницу `https://stavka.tv/matches/{category}`.
- Парсит лиги и активные матчи (исключает завершённые/отменённые).
- Логирует распарсенные данные в консоль.

## Текущая точка входа

Файл: `index.js`

Сейчас в коде включено:
- `scheduler.matches(pg).main();`

Сейчас отключено (закомментировано):
- `fastify.listen(PORT, DOMAIN);`
- `bot.run(pg);`

Это означает, что при запуске работает именно сбор/парсинг, а не HTTP API и не Telegram polling.

## Структура проекта

- `index.js` — bootstrap приложения.
- `scheduler/Matches.js` — сбор и парсинг матчей по категориям.
- `bot/` — Telegram-бот, контроллеры, роутинг callback-команд.
- `DataBase/Postgres.js` — обёртка для SQL-запросов к PostgreSQL.
- `lib/categoryEndpoint.js` — маппинг `prediction_category_id -> endpoint`.
- `docs/plans/` — проектные планы и чеклисты развития.

## Требования

- Node.js 18+
- npm
- PostgreSQL

## Установка и запуск

1. Установить зависимости:

```bash
npm install
```

2. Проверить настройки БД в `DataBase/Postgres.js` / конфиге подключения.

3. Запустить проект:

```bash
node index.js
```

## Используемые таблицы БД (ядро)

- `public.prediction_category`
  - справочник категорий спорта и URL-slug.
- `public.url`
  - сохранённые ссылки матчей, флаг верификации (`url_verified`).
- `public.user`, `public.language`, `external.public_user`, `external.system`
  - контур пользователей/привязки внешних систем (Telegram и т.д.).

## Важные замечания

- Это рабочий прототип, а не production-ready версия.
- В коде есть технический долг (часть контуров не активирована, есть незавершённые места в bot flow).
- Рекомендуется вынести все секреты в `.env` и не хранить их в коде.

## Планы развития

Документы с планом лежат в `docs/plans/`:

- `stage-0-start-checklist.md`
- `stavka-match-most-probable-outcome-plan.md`
- `test-matches-template.csv`

Ближайший функциональный шаг: добавить кэширование результатов парсинга/прогнозов в БД, чтобы не ходить на stavka.tv при каждом запросе.
