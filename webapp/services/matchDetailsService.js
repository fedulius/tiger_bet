const MATCH_DETAILS = {
  'fallback-1': {
    id: 'fallback-1',
    match: 'Arsenal vs Chelsea',
    league: 'Premier League',
    starts_at: '2026-04-22T17:30:00.000Z',
    main_thought: 'Обе забьют, но Arsenal выглядит сильнее',
    confidence: 68,
    basis: 'Последние 5 матчей, xG-тренд и преимущество домашнего поля Arsenal.',
    source_url: 'https://www.premierleague.com/match/arsenal-chelsea',
  },
  'fallback-2': {
    id: 'fallback-2',
    match: 'Real Madrid vs Sevilla',
    league: 'La Liga',
    starts_at: '2026-04-22T19:00:00.000Z',
    main_thought: 'Победа Real Madrid с контролем темпа',
    confidence: 74,
    basis: 'Доминирование Real Madrid по владению и глубине состава на дистанции.',
    source_url: 'https://www.laliga.com/en-GB/match/real-madrid-sevilla',
  },
  'fallback-3': {
    id: 'fallback-3',
    match: 'Fnatic vs G2',
    league: 'ESL Pro League',
    starts_at: '2026-04-22T20:00:00.000Z',
    main_thought: 'Победа G2 по текущей форме',
    confidence: 70,
    basis: 'Стабильность в последних bo3 и преимущество по map pool у G2.',
    source_url: 'https://pro.eslgaming.com/tour/match/fnatic-vs-g2/',
  },
  'fallback-4': {
    id: 'fallback-4',
    match: 'NAVI vs Spirit',
    league: 'BLAST Premier',
    starts_at: '2026-04-22T22:15:00.000Z',
    main_thought: 'NAVI через плотный матч',
    confidence: 64,
    basis: 'Равный матчап, но NAVI чаще закрывают концовки на решающих картах.',
    source_url: 'https://blast.tv/match/navi-vs-spirit',
  },
};

function getMatchDetailsById(id) {
  return MATCH_DETAILS[id] || null;
}

module.exports = {
  getMatchDetailsById,
};
