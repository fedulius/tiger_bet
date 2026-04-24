import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TG_INIT_DATA_HEADER,
  extractTgWebAppDataFromLocation,
  getTelegramInitData,
  withTelegramInitDataHeaders,
} from '../src/lib/telegram.js';

test('extractTgWebAppDataFromLocation reads tgWebAppData from hash', () => {
  const value = extractTgWebAppDataFromLocation({
    hash: '#tgWebAppData=user%3D%257B%2522id%2522%253A10%257D%26hash%3Dh',
    search: '',
  });

  assert.equal(value, 'user=%7B%22id%22%3A10%7D&hash=h');
});

test('getTelegramInitData prefers Telegram.WebApp.initData', () => {
  const initData = getTelegramInitData({
    Telegram: { WebApp: { initData: 'user=1&hash=t' } },
  });

  assert.equal(initData, 'user=1&hash=t');
});

test('withTelegramInitDataHeaders injects x-telegram-init-data when available', () => {
  const headers = withTelegramInitDataHeaders({ accept: 'application/json' }, {
    Telegram: { WebApp: { initData: 'user=2&hash=k' } },
  });

  assert.equal(headers.accept, 'application/json');
  assert.equal(headers[TG_INIT_DATA_HEADER], 'user=2&hash=k');
});
