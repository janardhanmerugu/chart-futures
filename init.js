// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION & EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // Initialize history dates

  // ── Restore token from sessionStorage (survives refresh, clears on tab close) ──
  const savedToken = sessionStorage.getItem('upstox_token');
  if (savedToken) {
    const inp = document.getElementById('token-input');
    inp.value = savedToken;
    document.getElementById('tok-msg').textContent = 'Token restored — click Connect then Save Token';
  }

  // Ctrl + Left-click → add / remove nearest horizontal line
  document.getElementById('chart-con').addEventListener('click', e => {
    if (!e.ctrlKey || !lwChart || !cSeries) return;
    const rect  = document.getElementById('lw-chart').getBoundingClientRect();
    const y     = e.clientY - rect.top;
    const price = cSeries.coordinateToPrice(y);
    if (price == null) return;
    if (!removeNearestHLine(e.clientY, rect)) addHLine(price);
  });

  // Ctrl + C → clear all horizontal lines
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'c') {
      if (hLines.length === 0) return;
      e.preventDefault();
      clearAllLines();
    }
  });
});
