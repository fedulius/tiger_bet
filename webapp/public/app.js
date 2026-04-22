(function (global) {
  function createWebApp(deps = {}) {
    const doc = deps.document || global.document;
    const fetchFn = deps.fetch || global.fetch?.bind(global);
    const setIntervalFn = deps.setIntervalFn || global.setInterval?.bind(global);
    const clearIntervalFn = deps.clearIntervalFn || global.clearInterval?.bind(global);
    const now = deps.now || (() => Date.now());

    const elements = {
      refreshBtn: doc?.getElementById('refresh-btn'),
      recommendationsList: doc?.getElementById('recommendations-list'),
      recommendationsError: doc?.getElementById('recommendations-error'),
      refreshStatus: doc?.getElementById('refresh-status'),
      addSportsBtn: doc?.getElementById('add-sports-btn'),
      addLeaguesBtn: doc?.getElementById('add-leagues-btn'),
      favoritesModal: doc?.getElementById('favorites-modal'),
      favoritesSearch: doc?.getElementById('favorites-search'),
      favoritesOptions: doc?.getElementById('favorites-options'),
      favoritesApplyBtn: doc?.getElementById('favorites-apply-btn'),
      favoritesCloseBtn: doc?.getElementById('favorites-close-btn'),
      sportsChips: doc?.getElementById('sports-chips'),
      leaguesChips: doc?.getElementById('leagues-chips'),
      historyList: doc?.getElementById('history-list'),
    };

    const CATALOG = {
      sports: ['football', 'tennis', 'basketball', 'hockey', 'esports'],
      leagues: ['Premier League', 'ATP', 'NBA', 'KHL', 'ESL Pro League', 'La Liga'],
    };

    const state = {
      recommendations: {
        updatedAt: null,
        pollingTimerId: null,
      },
      favorites: {
        sports: [],
        leagues: [],
      },
      modal: {
        openedFor: 'sports',
        query: '',
        pending: {
          sports: [],
          leagues: [],
        },
      },
    };

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function uniqTrimmed(arr) {
      return [...new Set((Array.isArray(arr) ? arr : []).map((v) => String(v || '').trim()).filter(Boolean))];
    }

    function setRefreshStatus(text) {
      if (elements.refreshStatus) {
        elements.refreshStatus.textContent = text;
      }
    }

    function setRecommendationsError(text, { asHtml = false } = {}) {
      if (!elements.recommendationsError) {
        return;
      }

      if (asHtml) {
        elements.recommendationsError.innerHTML = text || '';
      } else {
        elements.recommendationsError.textContent = text || '';
      }
    }

    function formatRelativeUpdatedAt(updatedAtIso) {
      const updatedMs = new Date(updatedAtIso).getTime();
      if (!Number.isFinite(updatedMs)) {
        return 'Обновлено 0 сек назад';
      }

      const diffSeconds = Math.max(0, Math.floor((now() - updatedMs) / 1000));
      return `Обновлено ${diffSeconds} сек назад`;
    }

    function renderRecommendations(items) {
      if (!elements.recommendationsList) {
        return;
      }

      const top3 = Array.isArray(items) ? items.slice(0, 3) : [];

      if (top3.length === 0) {
        elements.recommendationsList.innerHTML = '<div class="recommendations-empty">Нет рекомендаций</div>';
        return;
      }

      elements.recommendationsList.innerHTML = top3.map((item) => {
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
            <div class="recommendation-actions"><a href="/webapp/match.html?id=${encodeURIComponent(item.id || '')}">Подробнее</a></div>
          </article>
        `;
      }).join('');
    }

    async function refreshRecommendations() {
      if (!fetchFn) {
        return;
      }

      try {
        setRefreshStatus('Обновляем...');
        setRecommendationsError('');

        const response = await fetchFn('/api/webapp/recommendations');
        if (response && response.ok === false) {
          throw new Error('Request failed');
        }

        const payload = await response.json();
        renderRecommendations(payload?.items || []);

        state.recommendations.updatedAt = payload?.updated_at || new Date().toISOString();
        setRefreshStatus(formatRelativeUpdatedAt(state.recommendations.updatedAt));
      } catch {
        if (elements.recommendationsList && !elements.recommendationsList.innerHTML.trim()) {
          elements.recommendationsList.innerHTML = '<div class="recommendations-empty">Не удалось загрузить рекомендации</div>';
        }
        setRecommendationsError('<span>Не удалось обновить рекомендации.</span> <button type="button" data-action="retry-recommendations">Повторить</button>', { asHtml: true });
        setRefreshStatus('Ошибка обновления');
      }
    }

    function renderChips(target, values, type) {
      if (!target) {
        return;
      }

      if (!values.length) {
        target.innerHTML = '<span class="recommendations-empty">Пока пусто</span>';
        return;
      }

      target.innerHTML = values.map((value) => (
        `<span class="chip">${escapeHtml(value)}<button type="button" data-remove-type="${type}" data-remove-value="${escapeHtml(value)}">×</button></span>`
      )).join('');
    }

    function renderFavoritesChips() {
      renderChips(elements.sportsChips, state.favorites.sports, 'sports');
      renderChips(elements.leaguesChips, state.favorites.leagues, 'leagues');
    }

    async function saveFavorites() {
      if (!fetchFn) {
        return;
      }

      await fetchFn('/api/webapp/favorites', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sports: state.favorites.sports,
          leagues: state.favorites.leagues,
        }),
      });
    }

    async function loadFavorites() {
      if (!fetchFn) {
        return;
      }

      try {
        const response = await fetchFn('/api/webapp/favorites');
        if (response && response.ok === false) {
          throw new Error('Request failed');
        }

        const payload = await response.json();
        state.favorites.sports = uniqTrimmed(payload?.sports);
        state.favorites.leagues = uniqTrimmed(payload?.leagues);
        renderFavoritesChips();
      } catch {
        state.favorites.sports = [];
        state.favorites.leagues = [];
        renderFavoritesChips();
      }
    }

    function closeFavoritesModal() {
      if (!elements.favoritesModal) {
        return;
      }
      elements.favoritesModal.style.display = 'none';
    }

    function openFavoritesModal(kind = 'sports') {
      state.modal.openedFor = kind === 'leagues' ? 'leagues' : 'sports';
      state.modal.pending = {
        sports: [...state.favorites.sports],
        leagues: [...state.favorites.leagues],
      };
      state.modal.query = '';

      if (elements.favoritesSearch) {
        elements.favoritesSearch.value = '';
      }

      if (elements.favoritesModal) {
        elements.favoritesModal.style.display = 'flex';
      }

      renderFavoritesOptions();
    }

    function currentOptions() {
      const kind = state.modal.openedFor;
      const options = CATALOG[kind] || [];
      const query = (elements.favoritesSearch?.value || state.modal.query || '').toLowerCase().trim();
      if (!query) {
        return options;
      }

      return options.filter((name) => name.toLowerCase().includes(query));
    }

    function renderFavoritesOptions() {
      if (!elements.favoritesOptions) {
        return;
      }

      const kind = state.modal.openedFor;
      const selected = new Set(state.modal.pending[kind] || []);
      const options = currentOptions();

      if (!options.length) {
        elements.favoritesOptions.innerHTML = '<div class="recommendations-empty">Ничего не найдено</div>';
        return;
      }

      elements.favoritesOptions.innerHTML = options.map((value) => {
        const checked = selected.has(value) ? 'checked' : '';
        return `<label class="favorite-option"><input type="checkbox" data-kind="${kind}" data-value="${escapeHtml(value)}" ${checked}>${escapeHtml(value)}</label>`;
      }).join('');
    }

    function toggleOption(kind, value, checked) {
      const allowedKind = kind === 'leagues' ? 'leagues' : 'sports';
      const next = new Set(state.modal.pending[allowedKind] || []);
      if (checked) {
        next.add(value);
      } else {
        next.delete(value);
      }
      state.modal.pending[allowedKind] = [...next];
    }

    async function applyFavorites() {
      state.favorites.sports = uniqTrimmed(state.modal.pending.sports);
      state.favorites.leagues = uniqTrimmed(state.modal.pending.leagues);
      renderFavoritesChips();
      closeFavoritesModal();
      await saveFavorites();
    }

    async function removeFavorite(type, value) {
      if (type === 'leagues') {
        state.favorites.leagues = state.favorites.leagues.filter((item) => item !== value);
      } else {
        state.favorites.sports = state.favorites.sports.filter((item) => item !== value);
      }

      renderFavoritesChips();
      await saveFavorites();
    }

    function bindFavoritesEvents() {
      elements.addSportsBtn?.addEventListener('click', () => openFavoritesModal('sports'));
      elements.addLeaguesBtn?.addEventListener('click', () => openFavoritesModal('leagues'));
      elements.favoritesCloseBtn?.addEventListener('click', closeFavoritesModal);
      elements.favoritesApplyBtn?.addEventListener('click', applyFavorites);

      elements.favoritesSearch?.addEventListener('input', () => {
        state.modal.query = elements.favoritesSearch.value || '';
        renderFavoritesOptions();
      });

      elements.favoritesOptions?.addEventListener('change', (event) => {
        const target = event?.target;
        if (!target || target.type !== 'checkbox') {
          return;
        }

        toggleOption(target.dataset.kind, target.dataset.value, target.checked);
      });

      elements.sportsChips?.addEventListener('click', (event) => {
        const target = event?.target;
        if (!target?.dataset?.removeValue) {
          return;
        }
        removeFavorite(target.dataset.removeType, target.dataset.removeValue);
      });

      elements.leaguesChips?.addEventListener('click', (event) => {
        const target = event?.target;
        if (!target?.dataset?.removeValue) {
          return;
        }
        removeFavorite(target.dataset.removeType, target.dataset.removeValue);
      });
    }

    async function loadHistory() {
      if (!fetchFn || !elements.historyList) {
        return;
      }

      try {
        const response = await fetchFn('/api/webapp/history');
        if (response && response.ok === false) {
          throw new Error('Request failed');
        }

        const payload = await response.json();
        if (!Array.isArray(payload?.items) || payload.items.length === 0) {
          const message = payload?.empty_state?.message || 'История пока пустая';
          const ctaLabel = payload?.empty_state?.cta?.label;
          const ctaTarget = payload?.empty_state?.cta?.target;
          if (ctaLabel && ctaTarget) {
            elements.historyList.innerHTML = `${escapeHtml(message)} <a href="${escapeHtml(ctaTarget)}">${escapeHtml(ctaLabel)}</a>`;
          } else {
            elements.historyList.textContent = message;
          }
          return;
        }

        elements.historyList.innerHTML = payload.items.map((item) => `
          <article class="recommendation-card">
            <h3>${escapeHtml(item.match || 'Матч')}</h3>
            <div class="recommendation-meta">${escapeHtml(item.league || '')} · ${escapeHtml(item.starts_at || '')}</div>
            <p>${escapeHtml(item.main_thought || '')}</p>
            <div class="recommendation-confidence">Уверенность: ${escapeHtml(item.confidence ?? '—')}%</div>
          </article>
        `).join('');
      } catch {
        elements.historyList.textContent = 'Не удалось загрузить историю';
      }
    }

    function bindAnchorScroll() {
      const links = doc?.querySelectorAll?.('.anchors a[href^="#"]') || [];
      for (const link of links) {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          const target = doc.querySelector(link.getAttribute('href'));
          if (target && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }
    }

    function bindCoreEvents() {
      elements.refreshBtn?.addEventListener('click', refreshRecommendations);
      elements.recommendationsError?.addEventListener('click', (event) => {
        const target = event?.target;
        if (target?.dataset?.action === 'retry-recommendations') {
          refreshRecommendations();
        }
      });
      bindAnchorScroll();
      bindFavoritesEvents();
    }

    async function init() {
      bindCoreEvents();
      await Promise.allSettled([
        refreshRecommendations(),
        loadFavorites(),
        loadHistory(),
      ]);
      this.startPolling(180000);
    }

    function getState() {
      return {
        favorites: {
          sports: [...state.favorites.sports],
          leagues: [...state.favorites.leagues],
        },
        modal: {
          openedFor: state.modal.openedFor,
          query: state.modal.query,
          pending: {
            sports: [...state.modal.pending.sports],
            leagues: [...state.modal.pending.leagues],
          },
        },
      };
    }

    return {
      init,
      refreshRecommendations,
      renderFavoritesOptions,
      openFavoritesModal,
      closeFavoritesModal,
      toggleOption,
      applyFavorites,
      removeFavorite,
      loadFavorites,
      loadHistory,
      getState,
      clearPolling() {
        if (state.recommendations.pollingTimerId && clearIntervalFn) {
          clearIntervalFn(state.recommendations.pollingTimerId);
          state.recommendations.pollingTimerId = null;
        }
      },
      startPolling(intervalMs = 180000) {
        if (!setIntervalFn) {
          return;
        }
        this.clearPolling();
        state.recommendations.pollingTimerId = setIntervalFn(() => {
          refreshRecommendations();
        }, intervalMs);
      },
    };
  }

  global.__webapp_createApp = createWebApp;

  if (global.document) {
    const app = createWebApp();
    global.__webapp_app = app;
    app.init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
