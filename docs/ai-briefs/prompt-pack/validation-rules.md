# Validation rules for `aiBriefGenerator`

## Hard checks
- JSON parse succeeds.
- Present keys: `headline`, `brief`, `risk_note`.
- `headline` and `brief` are non-empty trimmed strings.
- Length limits are respected.
- `risk_note` is either `string` or `null`.
- `bet_explanations` is an array with one `{ market_key, reason }` object per deterministic selected market.
- Analytics output must not contain `recommended_bets`; runtime owns the selected bets.

## Soft quality checks
Если проваливаются, можно делать один retry с более жёсткой инструкцией.

- `headline` не выглядит общим шаблоном вроде `Хороший вариант на матч`.
- `brief` не содержит гарантий: `100%`, `желез`, `без риска`, `обязан`, `точно зайд`.
- `brief` не противоречит `primary_signal.label`.
- `brief` не повторяет дословно `headline`.
- `risk_note`, если строка, не дублирует `brief` почти полностью.
- `brief` должен содержать хотя бы одну привязку к payload: коэффициент, основной исход, source mode, summary snippet, top/risk bets.

## Retry policy v1
Разрешён 1 автоматический retry, если:
- invalid JSON;
- missing fields;
- banned phrases;
- obvious contradiction to `primary_signal`.

На retry усилить инструкцию:
- не добавляй новые факты;
- не противоречь `primary_signal`;
- верни только JSON;
- убери категоричные формулировки.
