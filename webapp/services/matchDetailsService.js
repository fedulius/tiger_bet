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
    bets: [
      { forecast: 'Обе забьют', coeff: 1.72, probability: 58, confidence: 'средняя', description: 'Обе команды регулярно создают моменты.' },
      { forecast: 'Победа Arsenal', coeff: 2.05, probability: 49, confidence: 'средняя', description: 'Домашний фактор и форма последних туров.' },
      { forecast: 'Точный счет 2:1', coeff: 7.2, probability: 14, confidence: 'высокий риск', description: 'Сценарий через обмен голами.' },
    ],
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
    bets: [
      { forecast: 'Победа Real Madrid', coeff: 1.83, probability: 55, confidence: 'средняя', description: 'Преимущество в классе и глубине состава.' },
      { forecast: 'Фора Real Madrid (-1)', coeff: 2.12, probability: 47, confidence: 'средняя', description: 'Сценарий победы в 1-2 мяча.' },
      { forecast: 'Точный счет 2:0', coeff: 7.8, probability: 13, confidence: 'высокий риск', description: 'Сухая победа хозяев при контроле темпа.' },
    ],
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
    bets: [
      { forecast: 'Победа G2', coeff: 1.79, probability: 56, confidence: 'средняя', description: 'Стабильнее map pool и форма по последним bo3.' },
      { forecast: 'Тотал карт больше 2.5', coeff: 2.18, probability: 45, confidence: 'средняя', description: 'Ожидается плотная серия из трех карт.' },
      { forecast: 'Точный счет 1:2', coeff: 7.4, probability: 14, confidence: 'высокий риск', description: 'Сценарий камбэка фаворита.' },
    ],
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
    bets: [
      { forecast: 'Победа NAVI', coeff: 1.86, probability: 54, confidence: 'средняя', description: 'Лучше закрывают клатчи в концовках.' },
      { forecast: 'Тотал раундов больше 26.5', coeff: 2.06, probability: 48, confidence: 'средняя', description: 'Ожидается плотный матч без разгрома.' },
      { forecast: 'Точный счет 2:1', coeff: 6.9, probability: 15, confidence: 'высокий риск', description: 'Серия через размен по картам.' },
    ],
  },
};

function getMatchDetailsById(id) {
  return MATCH_DETAILS[id] || null;
}

module.exports = {
  getMatchDetailsById,
};
