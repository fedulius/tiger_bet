# tiger-bet React WebApp

Стартовый React-каркас для поэтапной миграции Telegram WebApp.

## Команды

```bash
npm install
npm run dev
npm run build
npm run test:utils
```

## Важно

- Базовый URL Vite: `/webapp/`
- В проде сервер отдает `webapp-react/dist` при `WEBAPP_FRONTEND_MODE=react`
- Если `dist/index.html` отсутствует, backend автоматически откатывается на legacy frontend
