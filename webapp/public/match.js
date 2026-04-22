(function (global) {
  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatMoscowDateTime(value) {
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) {
      return String(value || '');
    }

    const moscowDate = new Date(ts + (3 * 60 * 60 * 1000));
    const yyyy = moscowDate.getUTCFullYear();
    const mm = String(moscowDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(moscowDate.getUTCDate()).padStart(2, '0');
    const hh = String(moscowDate.getUTCHours()).padStart(2, '0');
    const min = String(moscowDate.getUTCMinutes()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  function createMatchPageApp(deps = {}) {
    const doc = deps.document || global.document;
    const location = deps.location || global.window?.location || { search: '' };
    const fetchFn = deps.fetch || global.fetch?.bind(global);

    const detailsEl = doc?.getElementById('match-details');
    const externalEl = doc?.getElementById('match-external-link');

    function getMatchId() {
      const params = new URLSearchParams(location.search || '');
      return params.get('id');
    }

    async function init() {
      if (!detailsEl || !fetchFn) {
        return;
      }

      const id = getMatchId();
      if (!id) {
        detailsEl.textContent = 'Не указан id матча';
        return;
      }

      try {
        const response = await fetchFn(`/api/webapp/match/${encodeURIComponent(id)}`);
        if (response && response.ok === false) {
          throw new Error('not found');
        }

        const item = await response.json();
        detailsEl.innerHTML = `
          <article class="recommendation-card">
            <h3>${escapeHtml(item.match || 'Матч')}</h3>
            <div class="recommendation-meta">${escapeHtml(item.league || '')} · ${escapeHtml(formatMoscowDateTime(item.starts_at || ''))}</div>
            <p>${escapeHtml(item.main_thought || '')}</p>
            <div class="recommendation-confidence">Уверенность: ${escapeHtml(item.confidence ?? '—')}%</div>
            <p><strong>Основание:</strong> ${escapeHtml(item.basis || '')}</p>
          </article>
        `;

        if (externalEl) {
          externalEl.innerHTML = `<a href="${escapeHtml(item.source_url || '#')}" target="_blank" rel="noopener noreferrer">Открыть источник</a>`;
        }
      } catch {
        detailsEl.textContent = 'Матч не найден';
        if (externalEl) {
          externalEl.innerHTML = '';
        }
      }
    }

    return { init };
  }

  global.__matchPage_createApp = createMatchPageApp;

  if (global.document) {
    const app = createMatchPageApp();
    app.init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
