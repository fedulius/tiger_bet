# AI Brief Prompt Pack

Цель: сохранить качество формулировок, близкое к Hermes, но использовать прямой API-вызов из `aiBriefGenerator`.

## Состав
- `system-prompt.md` — жёсткая роль, стиль, запреты, правила фактичности
- `user-prompt-template.md` — шаблон сообщения с входным payload
- `output-schema.json` — JSON Schema для structured output
- `few-shots.json` — эталонные примеры good output
- `validation-rules.md` — правила локальной пост-проверки

## Как использовать в коде
1. `aiBriefSourceService` готовит компактный `sourcePayload`.
2. `aiBriefGenerator`:
   - загружает `system-prompt.md`
   - подставляет `user-prompt-template.md`
   - отправляет `sourcePayload`
   - требует ответ строго по `output-schema.json`
3. После ответа выполняется локальная валидация из `validation-rules.md`.
4. В БД сохраняются:
   - `prompt_version`
   - `model_name`
   - raw token usage
   - `bet_explanations` (объяснения для выбранных runtime ставок)

## Поле bet_explanations
Массив объяснений, по одному на каждый `market_key` из `market_fit.selected_bets`.
LLM не выбирает и не изменяет ставки: итоговый `recommended_bets` собирается runtime из deterministic analytics.

## Версионирование
Рекомендуемый старт:
- `prompt_version = ai-brief-v1`

При любом заметном изменении tone/style/contract делать новую версию:
- `ai-brief-v2`
- `ai-brief-v3`

## Принципы
- не выдумывать факты;
- не обещать проходимость ставки;
- не противоречить `primary_signal` и входным коэффициентам;
- не писать общий спортивный шум без опоры на payload;
- brief короткий, продуктовый, пригодный для модалки.
