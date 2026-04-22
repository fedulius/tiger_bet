(function () {
  const refreshBtn = document.getElementById('refresh-btn');
  const recommendationsList = document.getElementById('recommendations-list');
  const refreshStatus = document.getElementById('refresh-status');

  function setRefreshStatus(text) {
    if (refreshStatus) {
      refreshStatus.textContent = text;
    }
  }

  async function refreshRecommendations() {
    recommendationsList.textContent = 'Обновлено: ' + new Date().toLocaleTimeString();
    setRefreshStatus('Данные обновлены');
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
