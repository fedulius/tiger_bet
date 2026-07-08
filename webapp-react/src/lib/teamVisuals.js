import { TEAM_LOCALE } from './locale.js';

function normalizeValue(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function stripNationalSuffixes(name) {
  return String(name || '')
    .replace(/\s+W$/i, '')
    .replace(/\s+Women$/i, '')
    .replace(/\s+U\d{1,2}$/i, '')
    .replace(/\s+U-\d{1,2}$/i, '')
    .replace(/\s+Olympic(?:\s+Team)?$/i, '')
    .trim();
}

export function resolveFlagCode(team) {
  const localeCode = TEAM_LOCALE[team?.name || '']?.code;
  const rawCode = localeCode || team?.country?.code || '';
  if (!rawCode || rawCode === 'WW') return null;
  return rawCode;
}

export function isNationalTeam(team) {
  const baseName = stripNationalSuffixes(team?.name || '');
  const teamName = normalizeValue(baseName);
  if (!teamName) return false;

  const countryName = normalizeValue(team?.country?.name || '');
  if (countryName && teamName === countryName) return true;

  for (const [englishName, meta] of Object.entries(TEAM_LOCALE)) {
    if (teamName === normalizeValue(englishName)) return true;
    if (teamName === normalizeValue(meta?.ru || '')) return true;
  }

  return false;
}

export function getTeamLogoUrl(team) {
  const id = Number(team?.id);
  if (!Number.isFinite(id) || isNationalTeam(team)) return null;
  return `https://sstats.net/assets/logos/${id}.png`;
}

export function getTeamBadge(team) {
  const flagCode = resolveFlagCode(team);
  const logoUrl = getTeamLogoUrl(team);
  return {
    isNationalTeam: isNationalTeam(team),
    flagCode,
    logoUrl,
  };
}
