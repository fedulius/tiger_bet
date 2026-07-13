Сгенерируй краткий AI brief для карточки ставки.

## Контекст продукта
- Это предвычисленный текст для UI.
- Пользователь должен быстро понять идею выбранных рынков.
- Важнее точность и дисциплина формулировки, чем креативность.

## Инструкция
1. Используй только данные из payload ниже.
2. Если в payload есть `market_fit.selected_bets`, НЕ выбирай ставки сам: эти ставки уже выбрал аналитический слой Tiger Bet.
3. Для analytics-first payload верни `bet_explanations`: по одному объяснению на `market_key` из `market_fit.selected_bets`.
4. Не меняй `type`, `outcome`, `label`, `rate`, `risk_label` и количество ставок.
5. В `headline`, `brief`, `risk_note` опирайся только на `analytics_features`, `match_analytics`, `market_fit` и разрешённые факты payload.
6. Для analytics-first payload контракт всегда writer-only: не возвращай `recommended_bets`; runtime сам сохраняет выбранные ставки.
7. Не ссылайся на H2H, Glicko, травмы или погоду, если в payload нет явных данных.
8. Верни только JSON по контракту.

## Payload
```json
{{SOURCE_PAYLOAD_JSON}}
```
