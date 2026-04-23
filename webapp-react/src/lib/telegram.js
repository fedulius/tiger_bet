const TG_INIT_DATA_HEADER = 'x-telegram-init-data';

export function extractTgWebAppDataFromLocation(locationLike) {
  if (!locationLike) {
    return '';
  }

  const search = String(locationLike.search || '').replace(/^\?/, '');
  const hash = String(locationLike.hash || '').replace(/^#/, '');

  const readFrom = (raw) => {
    if (!raw) return '';
    const params = new URLSearchParams(raw);
    return params.get('tgWebAppData') || '';
  };

  return readFrom(search) || readFrom(hash) || '';
}

export function getTelegramInitData(globalRef = globalThis) {
  const fromTelegram =
    globalRef?.Telegram?.WebApp?.initData ||
    globalRef?.window?.Telegram?.WebApp?.initData ||
    '';

  if (fromTelegram) {
    return String(fromTelegram);
  }

  const fallbackLocation =
    globalRef?.location ||
    globalRef?.window?.location ||
    null;

  return extractTgWebAppDataFromLocation(fallbackLocation);
}

export function withTelegramInitDataHeaders(headers = {}, globalRef = globalThis) {
  const initData = getTelegramInitData(globalRef);

  if (!initData) {
    return { ...headers };
  }

  return {
    ...headers,
    [TG_INIT_DATA_HEADER]: initData,
  };
}

export { TG_INIT_DATA_HEADER };
