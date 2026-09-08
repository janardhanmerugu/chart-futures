// ─────────────────────────────────────────────────────────────────────────────
// TICK REPLAY
// ws.js routes replay_* messages here directly. Uses global `ws` from config.js.
// ─────────────────────────────────────────────────────────────────────────────

// ── State ──────────────────────────────────────────────────────────────────
var _rpDatasets = [];
var _rpPending = null;

// ── Sidebar controls ───────────────────────────────────────────────────────
function rpListSaved() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showAlert('warn', '⚠ Connect to server first.');
    return;
  }
  const date = document.getElementById('rp-date').value;
  if (!date) {
    showAlert('warn', '⚠ Pick a date first.');
    return;
  }
  ws.send(JSON.stringify({ type: 'list_saved', date, source: 'replay' }));
}

function rpSetSpeed(v) {
  document.getElementById('rp-speed').value = v;
  document.getElementById('rp-speed-val').textContent =
    (v % 1 === 0 ? v : parseFloat(v).toFixed(1)) + '×';
}

// ── Populate dropdown (called from ws.js on sqlite_list) ───────────────────
function rpPopulateDropdown(datasets) {
  _rpDatasets = datasets || [];
  const sel = document.getElementById('rp-instrument');
  sel.innerHTML = '<option value="">— pick instrument —</option>';
  let count = 0;
  _rpDatasets.forEach((d, i) => {
    if (!d.has_ticks) return;
    const name = d.instrument.split('/').pop();
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = name + ' · ' + d.date;
    sel.appendChild(opt);
    count++;
  });
  document.getElementById('rp-start-btn').disabled = count === 0;
  if (count === 0) showAlert('warn', '⚠ No tick data found for this date.');
}

// ── Start ──────────────────────────────────────────────────────────────────
function rpStart() {
  const sel = document.getElementById('rp-instrument');
  if (sel.value === '') {
    showAlert('warn', '⚠ Pick an instrument.');
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showAlert('err', '⚠ Not connected.');
    return;
  }
  const ds = _rpDatasets[+sel.value];
  const speed = parseFloat(document.getElementById('rp-speed').value);
  _rpPending = { ds, speed };
  // Map selIv (1,5,30,60,300,900) to closest seconds-candle interval the server accepts.
  const rpIv = selIv >= 30 ? 30 : selIv >= 5 ? 5 : 1;
  ws.send(JSON.stringify({
    type: 'replay_subscribe',
    symbol: ds.instrument_key || ds.instrument,
    interval: rpIv,
  }));
}

// Called by ws.js when replay_ready arrives
function rpOnReplayReady() {
  if (!_rpPending) return;
  const { ds, speed } = _rpPending;
  _rpPending = null;
  document.getElementById('rp-prog-label').textContent =
    ds.instrument.split('/').pop() + ' · loading…';
  ws.send(JSON.stringify({
    type: 'replay_start',
    date: ds.date,
    instrument: ds.instrument,
    speed,
  }));
}

function rpPause() {
  if (ws) ws.send(JSON.stringify({ type: 'replay_pause' }));
}

function rpResume() {
  if (ws) ws.send(JSON.stringify({ type: 'replay_resume' }));
}

function rpStop() {
  if (ws) ws.send(JSON.stringify({ type: 'replay_stop' }));
}

// ── Callbacks from ws.js ──────────────────────────────────────────────────
function rpOnMeta(msg) {
  rpSetStatus('playing');
  const name = msg.instrument ? msg.instrument.split('/').pop() : '?';
  document.getElementById('rp-prog-label').textContent =
    name + ' · ' + msg.total.toLocaleString() + ' ticks @ ' + msg.speed + '×';
}

function rpOnProgress(msg) {
  const pct = msg.total > 0 ? Math.round((msg.index / msg.total) * 100) : 0;
  document.getElementById('rp-prog-fill').style.width = pct + '%';
  document.getElementById('rp-prog-pct').textContent = pct + '%';
  if (msg.ltt_ms) {
    const d = new Date(msg.ltt_ms + IST_OFFSET_MS);
    const hms = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
    document.getElementById('rp-prog-time').textContent =
      hms + ' IST · ' + msg.index.toLocaleString() + ' / ' + msg.total.toLocaleString();
  }
}

function rpOnDone(msg) {
  rpSetStatus('done');
  document.getElementById('rp-prog-fill').style.width = '100%';
  document.getElementById('rp-prog-pct').textContent = '100%';
  document.getElementById('rp-prog-time').textContent =
    'Complete · ' + (msg.total || 0).toLocaleString() + ' ticks';
  showAlert('ok', '✅ Replay complete — ' + (msg.total || 0).toLocaleString() + ' ticks');
}

function rpOnStopped() {
  rpSetStatus('idle');
  document.getElementById('rp-prog-fill').style.width = '0%';
  document.getElementById('rp-prog-pct').textContent = '—';
  document.getElementById('rp-prog-time').textContent = '—';
  document.getElementById('rp-prog-label').textContent = 'No replay active';
}

// ── Status pill ────────────────────────────────────────────────────────────
function rpSetStatus(state) {
  const pill = document.getElementById('rp-status-pill');
  const txt = document.getElementById('rp-status-txt');
  const dot = document.getElementById('rp-status-dot');
  txt.textContent = state.toUpperCase();
  dot.style.animation = 'none';
  const s = {
    idle: ['var(--border)', 'var(--muted)'],
    playing: ['var(--accent)', 'var(--accent)'],
    paused: ['var(--warn)', 'var(--warn)'],
    done: ['var(--green)', 'var(--green)'],
  }[state] || ['var(--border)', 'var(--muted)'];
  pill.style.borderColor = s[0];
  pill.style.color = s[1];
  if (state === 'playing') dot.style.animation = 'rp-blink .8s ease-in-out infinite';
  document.getElementById('rp-start-btn').disabled = state === 'playing' || state === 'paused';
  document.getElementById('rp-pause-btn').disabled = state !== 'playing';
  document.getElementById('rp-resume-btn').disabled = state !== 'paused';
  document.getElementById('rp-stop-btn').disabled = state === 'idle' || state === 'done';
}

// ── Init ───────────────────────────────────────────────────────────────────
document.getElementById('rp-date').value = new Date().toISOString().slice(0, 10);
