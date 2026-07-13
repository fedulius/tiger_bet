# Analytics Contract v1

## Purpose

Tiger Bet daily picks must be analytics-first: SStats/statistical features create the forecast signal; Stavka.tv provides only available markets and odds; LLM explains already selected bets.

## Source payload additions

`match_source.source_payload` may include:

```json
{
  "market_catalog": {
    "version": "stavka-market-catalog-v1",
    "catalog_coverage": "partial",
    "markets": []
  },
  "analytics_features": {
    "version": "analytics-features-v1",
    "sport": "soccer",
    "coverage": {},
    "home": {},
    "away": {},
    "lineup": {},
    "h2h": null,
    "ratings": null,
    "availability": { "confirmed_absences": [] }
  },
  "match_analytics": {
    "version": "match-analytics-v1",
    "model_version": "deterministic-v1",
    "eligibility": { "status": "eligible", "reasons": [] },
    "scores": {},
    "confidence": {}
  },
  "market_fit": {
    "version": "market-fit-v1",
    "catalog_coverage": "partial",
    "selected_bets": [],
    "rejected": []
  }
}
```

## Product rules

1. Target output is 3 bets: `low`, `medium`, `high`; fewer only when safe source-backed choices are unavailable.
2. `correct_score` is allowed only with strong analytic basis and a real Stavka market.
3. MVP Stavka catalog is partial: raw `popular-bets.data` plus 1X2 listing odds.
4. If LLM is unavailable, there is no published forecast; no fake deterministic prose fallback.
5. Published ready daily picks are immutable during the day. Reanalysis is targeted/manual only.
6. Minimum analytics confidence starts at `65/100`.
7. H2H/Glicko/injuries are extension points only until stable providers exist.

## LLM contract

For analytics-first payloads, LLM returns:

```json
{
  "headline": "...",
  "brief": "...",
  "risk_note": "...",
  "bet_explanations": [
    { "market_key": "one_x_two:w1", "reason": "..." }
  ]
}
```

Application layer assembles final `recommended_bets` from `market_fit.selected_bets`. LLM cannot mutate market identity, odds, labels, risk labels, or bet count.
