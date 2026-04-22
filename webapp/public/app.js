(function () {
  const refreshBtn = document.getElementById('refresh-btn');
  const recommendationsList = document.getElementById('recommendations-list');

  async function refreshRecommendations() {
    recommendationsList.textContent = 'Обновлено: ' + new Date().toLocaleTimeString();
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshRecommendations);
  }

  refreshRecommendations();
})();
