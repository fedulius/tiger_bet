const MOSCOW_LOCALE = 'sv-SE';
const MOSCOW_TZ = 'Europe/Moscow';

export function formatMoscowDateTime(value) {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat(MOSCOW_LOCALE, {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const byType = Object.create(null);
  for (const part of parts) {
    byType[part.type] = part.value;
  }

  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}`;
}
