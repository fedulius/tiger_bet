(function () {
  const refreshBtn = document.getElementById('refresh-btn');
  const recommendationsList = document.getElementById('recommendations-list');
  const refreshStatus = document.getElementById('refresh-status');

  function setRefreshStatus(text) {
    if (refreshStatus) {
      refreshStatus.textContent = text;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatRelativeUpdatedAt(updatedAtIso) {
    const nowMs = Date.now();
    const updatedMs = new Date(updatedAtIso).getTime();
    if (!Number.isFinite(updatedMs)) {
      return 'Обновлено 0 сек назад';
    }

    const diffSeconds = Math.max(0, Math.floor((nowMs - updatedMs) / 1000));
    return `Обновлено ${diffSeconds} сек назад`;
  }

  function renderRecommendations(items) {
    if (!recommendationsList) {
      return;
    }

    const top3 = Array.isArray(items) ? items.slice(0, 3) : [];

    if (top3.length === 0) {
      recommendationsList.innerHTML = '<div class="recommendations-empty">Нет рекомендаций</div>';
      return;
    }

    recommendationsList.innerHTML = top3
      .map((item) => {
        const badge = item.is_new ? '<span class="recommendation-badge">Новые</span>' : '';
        return `
          <article class="recommendation-card" data-id="${escapeHtml(item.id || '')}">
            <div class="recommendation-head">
              <h3>${escapeHtml(item.match || 'Матч')}</h3>
              ${badge}
            </div>
            <div class="recommendation-meta">${escapeHtml(item.league || '')} · ${escapeHtml(item.starts_at || '')}</div>
            <p>${escapeHtml(item.main_thought || '')}</p>
            <div class="recommendation-confidence">Уверенность: ${escapeHtml(item.confidence ?? '—')}%</div>
          </article>
        `;
      })
      .join('');
  }

  async function refreshRecommendations() {
    try {
      setRefreshStatus('Обновляем...');
      const response = await fetch('/api/webapp/recommendations');
      if (response && response.ok === false) {
        throw new Error('Request failed');
      }

      const payload = await response.json();
      renderRecommendations(payload?.items || []);
      setRefreshStatus(formatRelativeUpdatedAt(payload?.updated_at || new Date().toISOString()));
    } catch {
      if (recommendationsList) {
        recommendationsList.innerHTML = '<div class="recommendations-empty">Не удалось загрузить рекомендации</div>';
      }
      setRefreshStatus('Ошибка обновления');
    }
  }

  function bindAnchorScroll() {
    const links = document.querySelectorAll('.anchors a[href^="#"]');

    for (const link of links) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshRecommendations);
  }

  bindAnchorScroll();
  refreshRecommendations();
})();
