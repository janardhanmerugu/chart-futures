// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION & EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // Initialize history dates

  // ── Restore token from sessionStorage (survives refresh, clears on tab close) ──
  const defaultToken = 'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiJCTTY3OTIiLCJqdGkiOiI2YTMwYzU3ZmY4NWUzZTY2MTgwNmM4N2UiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzgxNTgxMTgzLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MTMxODMyMDB9.XujS7CgYRW1uCm_zhdhHza9rrCD1BBE4vG03lPglqz8';
  const savedToken = sessionStorage.getItem('upstox_token') || defaultToken;
  if (savedToken) {
    const inp = document.getElementById('token-input');
    inp.value = savedToken;
    document.getElementById('tok-msg').textContent = 'Token restored — save when connected';
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

  connectWS();
});
