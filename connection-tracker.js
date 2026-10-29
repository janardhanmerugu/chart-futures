// Browser-side WebSocket diagnostics. Deliberately stores no token or market data.
const connectionTracker = (() => {
  const storageKey = 'upstox_connection_diagnostics_futures';
  const maxEntries = 50;
  let startedAt = 0;
  let lastMessageAt = 0;
  let reconnectAttempt = 0;

  function read() {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); }
    catch (_) { return []; }
  }

  function record(event, details = {}) {
    const entry = {
      at: new Date().toISOString(),
      page: 'futures',
      event,
      online: navigator.onLine,
      visibility: document.visibilityState,
      ...details,
    };
    const entries = [...read(), entry].slice(-maxEntries);
    try { localStorage.setItem(storageKey, JSON.stringify(entries)); }
    catch (_) { /* Diagnostics must never affect chart operation. */ }
    console.info('[WS diagnostics]', entry);
    const el = document.getElementById('connection-diagnostic');
    if (el) el.textContent = `${event}: ${details.reason || details.message || ''}`.trim();
    return entry;
  }

  window.addEventListener('offline', () => record('browser_offline'));
  window.addEventListener('online', () => record('browser_online'));
  document.addEventListener('visibilitychange', () => record('visibility_changed'));

  return {
    attempt(url) {
      startedAt = performance.now();
      reconnectAttempt += 1;
      record('connect_attempt', { url, attempt: reconnectAttempt });
    },
    opened() {
      record('open', { durationMs: Math.round(performance.now() - startedAt), attempt: reconnectAttempt });
    },
    message() { lastMessageAt = performance.now(); },
    error(message) {
      record('error', { message: message || 'WebSocket error event' });
    },
    serverStatus(status, diagnostic) {
      if (diagnostic) record(`server_${status}`, diagnostic);
    },
    closed(event) {
      const lastMessageMs = lastMessageAt ? Math.round(performance.now() - lastMessageAt) : null;
      record('close', {
        code: event.code,
        reason: event.reason || '(no close reason supplied)',
        wasClean: event.wasClean,
        durationMs: Math.round(performance.now() - startedAt),
        sinceLastMessageMs: lastMessageMs,
        reconnectScheduled: wsAutoReconnect,
      });
    },
    reset() { reconnectAttempt = 0; },
    history() { return read(); },
    clear() {
      localStorage.removeItem(storageKey);
      record('history_cleared');
    },
  };
})();

window.connectionDiagnostics = () => connectionTracker.history();
