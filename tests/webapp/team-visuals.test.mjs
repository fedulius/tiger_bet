import test from 'node:test';
import assert from 'node:assert/strict';
import { getTeamBadge, isNationalTeam } from '../../webapp-react/src/lib/teamVisuals.js';

test('isNationalTeam detects national sides and keeps flags for them', () => {
  assert.equal(isNationalTeam({ name: 'France', country: { code: 'FR', name: 'France' } }), true);
  assert.equal(isNationalTeam({ name: 'Франция', country: { code: 'FR', name: '' } }), true);
  assert.deepEqual(getTeamBadge({ id: 2, name: 'France', country: { code: 'FR', name: 'France' } }), {
    isNationalTeam: true,
    flagCode: 'FR',
    logoUrl: null,
  });
});

test('getTeamBadge returns club logo for club teams', () => {
  assert.equal(isNationalTeam({ name: 'Arsenal', country: { code: 'GB-ENG', name: 'England' } }), false);
  assert.deepEqual(getTeamBadge({ id: 42, name: 'Arsenal', country: { code: 'GB-ENG', name: 'England' } }), {
    isNationalTeam: false,
    flagCode: 'GB-ENG',
    logoUrl: 'https://sstats.net/assets/logos/42.png',
  });
});
