const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

function getMoscowMidnightUTC(utcMs) {
  const moscowMs = utcMs + MOSCOW_OFFSET_MS;
  const d = new Date(moscowMs);
  const moscowMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return moscowMidnight - MOSCOW_OFFSET_MS;
}

function buildTimeWindowBounds(window, nowMs) {
  const todayStart = getMoscowMidnightUTC(nowMs);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const dayAfterStart = tomorrowStart + 24 * 60 * 60 * 1000;

  if (window === 'today') return { start: todayStart, end: tomorrowStart };
  if (window === 'tomorrow') return { start: tomorrowStart, end: dayAfterStart };
  return { start: todayStart, end: dayAfterStart };
}

function normalizePrimaryBet(raw) {
  if (Array.isArray(raw.bets) && raw.bets.length > 0) {
    const primary = raw.bets.find((b) => b.type === 'primary') || raw.bets[0];
    if (primary && primary.forecast) {
      return {
        forecast: String(primary.forecast).trim(),
        coeff: Number(primary.coeff) || null,
        description: String(primary.description || '').trim(),
      };
    }
  }

  if (raw.main_thought) {
    const conf = Math.min(90, Math.max(35, Number(raw.confidence) || 50));
    const coeff = Number((1.5 + (conf % 40) / 100).toFixed(2));
    return {
      forecast: String(raw.main_thought).trim(),
      coeff,
      description: '',
    };
  }

  return null;
}

function normalizeFeedItem(raw) {
  if (!raw || !raw.id || !raw.starts_at) return null;

  const startsAt = new Date(raw.starts_at);
  if (isNaN(startsAt.getTime())) return null;

  const primary_bet = normalizePrimaryBet(raw);
  if (!primary_bet || !primary_bet.forecast) return null;

  return {
    id: String(raw.id),
    match_id: String(raw.match_id || raw.id),
    match: String(raw.match || '').trim(),
    sport: String(raw.sport || raw.sport_name || '').trim(),
    country: String(raw.country || '').trim(),
    league: String(raw.league || '').trim(),
    starts_at: startsAt.toISOString(),
    summary: String(raw.summary || raw.main_thought || '').trim(),
    primary_bet,
  };
}

function filterByWindow(items, window, nowMs) {
  const bounds = buildTimeWindowBounds(window || 'all', nowMs);

  return items.filter((item) => {
    const t = new Date(item.starts_at).getTime();
    return t > nowMs && t >= bounds.start && t < bounds.end;
  });
}

function filterByParams(items, { sport, country, league } = {}) {
  let result = items;

  if (sport) {
    const norm = sport.trim().toLowerCase();
    result = result.filter((item) => item.sport.toLowerCase() === norm);
  }

  if (country) {
    const norm = country.trim().toLowerCase();
    result = result.filter((item) => item.country.toLowerCase() === norm);
  }

  if (league) {
    const norm = league.trim().toLowerCase();
    result = result.filter((item) => item.league.toLowerCase() === norm);
  }

  return result;
}

function buildFeedPayload(rawItems, { window = 'all', sport, country, league, limit, offset, nowMs } = {}) {
  const now = nowMs != null ? Number(nowMs) : Date.now();
  const lim = Math.min(100, Math.max(1, Number(limit) || 10));
  const off = Math.max(0, Number(offset) || 0);

  const normalized = rawItems.map(normalizeFeedItem).filter(Boolean);
  normalized.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  const windowed = filterByWindow(normalized, window, now);
  const filtered = filterByParams(windowed, { sport, country, league });

  const pageItems = filtered.slice(off, off + lim);
  const nextOffset = off + lim;

  return {
    generated_at: new Date(now).toISOString(),
    window: window || 'all',
    filters: {
      sport: sport || null,
      country: country || null,
      league: league || null,
    },
    items: pageItems,
    next_offset: nextOffset,
    has_more: nextOffset < filtered.length,
  };
}

module.exports = {
  normalizeFeedItem,
  buildTimeWindowBounds,
  filterByWindow,
  filterByParams,
  buildFeedPayload,
};
