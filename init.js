// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION & EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

// Initialize on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  // Initialize history dates
  initHistoryDates();

  // Setup horizontal line drawing on chart
  document.getElementById('lw-chart').addEventListener('click', e => {
    if (!drawLineMode || !lwChart || !cSeries) return;
    const rect  = e.currentTarget.getBoundingClientRect();
    const y     = e.clientY - rect.top;
    const price = cSeries.coordinateToPrice(y);
    if (price == null) return;
    if (!removeNearestHLine(e.clientY, rect)) addHLine(price);
  });
});
