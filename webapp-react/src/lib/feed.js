export function collectAvailableSports(feedResponse = {}, options = {}) {
  const response = feedResponse && typeof feedResponse === 'object' ? feedResponse : {};
  const fallbackSports = Array.isArray(options.fallbackSports)
    ? options.fallbackSports.map((sport) => String(sport || '').trim()).filter(Boolean)
    : [];
  const preserveFallback = options.preserveFallback === true;

  const baseSports = Array.isArray(response.available_sports)
    ? response.available_sports.map((sport) => String(sport || '').trim()).filter(Boolean)
    : [];

  if (baseSports.length > 0) {
    return [...new Set(baseSports)].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  const itemSports = Array.isArray(response.items)
    ? response.items.map((item) => String(item?.sport || '').trim()).filter(Boolean)
    : [];

  const merged = preserveFallback
    ? [...new Set([...fallbackSports, ...itemSports])]
    : [...new Set(itemSports)];

  return merged.sort((a, b) => a.localeCompare(b, 'ru'));
}
