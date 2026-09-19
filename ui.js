// ─────────────────────────────────────────────────────────────────────────────
// UI CONTROLS & BUTTONS
// ─────────────────────────────────────────────────────────────────────────────

// ──── Bubble Control ────
function setCandlesVisible(visible) {
  candlesOn = Boolean(visible);
  if (cSeries) cSeries.applyOptions({visible: candlesOn});
  if (vSeries) vSeries.applyOptions({visible: candlesOn});
  const checkbox = document.getElementById('candles-toggle');
  if (checkbox) checkbox.checked = candlesOn;
}

function toggleCandles() {
  setCandlesVisible(!candlesOn);
}

function setBubblesVisible(visible) {
  bubOn = Boolean(visible);
  const checkbox = document.getElementById('bubbles-toggle');
  if (checkbox) checkbox.checked = bubOn;
  const btn = document.getElementById('bubBtn');
  if (btn) {
    btn.textContent = bubOn ? '● ON' : '○ OFF';
    btn.classList.toggle('off', !bubOn);
  }
  AGBUB.draw();
}

function toggleBubbles() {
  setBubblesVisible(!bubOn);
}

// ──── Crosshair Mode ────
let crosshairMagnet = false;
function toggleCrosshair() {
  crosshairMagnet = !crosshairMagnet;
  const btn = document.getElementById('xhair-btn');
  if (lwChart) lwChart.applyOptions({ crosshair: { mode: crosshairMagnet ? 1 : 0 } });
  btn.textContent  = crosshairMagnet ? '🧲 Magnet' : '✥ Free';
  btn.style.borderColor = crosshairMagnet ? 'var(--accent)' : 'var(--muted)';
  btn.style.color       = crosshairMagnet ? 'var(--accent)' : 'var(--muted)';
}

// ──── Horizontal Lines ────
let hLines = [];

function addHLine(price) {
  if (!cSeries) return;
  const pl = cSeries.createPriceLine({
    price,
    color: '#ffe033cc',
    lineWidth: 1,
    lineStyle: 2,
    axisLabelVisible: true,
    title: '',
  });
  hLines.push({ priceLine: pl, price, type: 'H-Line' });
  updateSRLineCount();
}

function removeNearestHLine(clientY, rect) {
  if (!cSeries || hLines.length === 0) return false;
  const SNAP_PX = 6;
  let closest = null, minDiff = Infinity, idx = -1;
  hLines.forEach((h, i) => {
    const lineY = cSeries.priceToCoordinate(h.price);
    if (lineY == null) return;
    const diff = Math.abs((clientY - rect.top) - lineY);
    if (diff <= SNAP_PX && diff < minDiff) { minDiff = diff; closest = h; idx = i; }
  });
  if (closest) {
    cSeries.removePriceLine(closest.priceLine);
    hLines.splice(idx, 1);
    updateSRLineCount();
    return true;
  }
  return false;
}

function clearAllLines() {
  if (!cSeries) {
    updateSRLineCount();
    return;
  }
  hLines.forEach(h => cSeries.removePriceLine(h.priceLine));
  hLines = [];
  updateSRLineCount();
}

function addSupportLevel() {
  addSRLevel('Support', 'support-price', '#00e676');
}

function addResistanceLevel() {
  addSRLevel('Resistance', 'resistance-price', '#ff3d5a');
}

function addSRLevel(type, inputId, color) {
  const input = document.getElementById(inputId);
  const price = Number(input?.value);
  if (!Number.isFinite(price) || price <= 0) {
    showAlert('warn', `⚠ Enter a valid ${type.toLowerCase()} price.`);
    input?.focus();
    return;
  }
  if (!cSeries) {
    showAlert('warn', '⚠ Load a chart before adding levels.');
    return;
  }
  const priceLine = cSeries.createPriceLine({
    price,
    color,
    lineWidth: 2,
    lineStyle: 0,
    axisLabelVisible: true,
    title: type === 'Support' ? 'S' : 'R',
  });
  hLines.push({ priceLine, price, type });
  input.value = '';
  updateSRLineCount();
}

function updateSRLineCount() {
  const count = document.getElementById('sr-line-count');
  if (count) count.textContent = hLines.length;
}

function toggleRightDrawer() {
  const drawer = document.getElementById('right-drawer');
  const toggle = document.getElementById('right-drawer-toggle');
  const open = drawer.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed', open);
  toggle.textContent = open ? '‹' : '›';
  setTimeout(() => {
    if (lwChart) {
      const con = document.getElementById('chart-con');
      lwChart.resize(Math.max(con.clientWidth, 200), Math.max(con.clientHeight, 200));
      if (typeof AGBUB !== 'undefined') AGBUB.draw();
    }
  }, 280);
}

function toggleRightPanel(panelId) {
  const panel = document.getElementById(panelId);
  const body = panel?.querySelector('.right-panel-body');
  const title = panel?.querySelector('.right-panel-title');
  if (!panel || !body || !title) return;
  const collapsed = panel.classList.toggle('panel-collapsed');
  title.setAttribute('aria-expanded', String(!collapsed));
  body.hidden = collapsed;
  const chevron = title.querySelector('.panel-chevron');
  if (chevron) chevron.textContent = collapsed ? '+' : '−';
}

// ──── Token Management ────
function toggleTokenVis() {
  const i=document.getElementById('token-input'), b=document.getElementById('showHideBtn');
  i.type = i.type==='password' ? 'text' : 'password';
  b.textContent = i.type==='password' ? 'Show' : 'Hide';
}

function saveToken() {
  const t=document.getElementById('token-input').value.trim();
  if(!t){setTok(false,'Token cannot be empty.');return;}
  if(!ws||ws.readyState!==WebSocket.OPEN){showAlert('err','⚠ Connect to server first.');return;}
  safeCall(() => {
    ws.send(JSON.stringify({type:'auth',token:t}));
  });
}

function clearToken() {
  document.getElementById('token-input').value='';
  document.getElementById('token-input').className='';
  sessionStorage.removeItem('upstox_token');
  tokSaved=false; setTok(null,'Token cleared.');
  document.getElementById('loadBtn').disabled=true;
  document.getElementById('clearTokenBtn').disabled=true;
}

function setTok(ok, msg) {
  const dot=document.getElementById('tok-dot'), txt=document.getElementById('tok-msg'), inp=document.getElementById('token-input');
  txt.textContent=msg;
  if(ok===true) {
    dot.className='ok'; inp.className='tok-ok'; tokSaved=true;
    sessionStorage.setItem('upstox_token', inp.value.trim());
    document.getElementById('loadBtn').disabled=false;
    document.getElementById('clearTokenBtn').disabled=false;
  }
  else if(ok===false) {
    dot.className='fail'; inp.className='tok-fail'; tokSaved=false;
    sessionStorage.removeItem('upstox_token');
    document.getElementById('loadBtn').disabled=true;
  }
  else { dot.className=''; inp.className=''; }
}

// ──── Futures ────
const futKeys = { nf: null, bnf: null };

function loadFutures() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  setFutBtn('nf',  null, 'loading…');
  setFutBtn('bnf', null, 'loading…');
  document.getElementById('fbtn-nf').disabled  = true;
  document.getElementById('fbtn-bnf').disabled = true;
  ws.send(JSON.stringify({ type: 'get_futures' }));
}

function setFutBtn(pfx, key, expLabel) {
  const btn = document.getElementById('fbtn-' + pfx);
  const fe  = document.getElementById('fe-' + pfx);
  if (!btn || !fe) return;
  fe.textContent = expLabel || '—';
  if (key) {
    futKeys[pfx]    = key;
    btn.disabled    = false;
    btn.title       = key;
  } else {
    btn.disabled    = !key && expLabel !== 'loading…' ? false : true;
  }
}

function pickFut(pfx) {
  const key = futKeys[pfx];
  if (!key) return;
  document.querySelectorAll('.fbtn,.sbtn').forEach(b => b.classList.remove('active'));
  document.getElementById('fbtn-' + pfx).classList.add('active');
  document.getElementById('custom-sym').value = '';
  selSym = key;
  applyLotSizeForSelection(pfx);
}

function renderFutures(data) {
  const map = { nifty: 'nf', banknifty: 'bnf' };
  let anyOk = false;
  for (const [key, info] of Object.entries(data)) {
    const pfx = map[key];
    if (!pfx) continue;
    const cur = info.contracts && info.contracts[0];
    if (cur) {
      setFutBtn(pfx, cur.instrument_key, cur.expiry_str);
      anyOk = true;
    } else {
      setFutBtn(pfx, null, '⚠ none');
      document.getElementById('fbtn-' + pfx).disabled = true;
    }
  }
  document.getElementById('fut-reload-btn').disabled = false;
}

function onFuturesError(msg) {
  setFutBtn('nf',  null, '⚠ error');
  setFutBtn('bnf', null, '⚠ error');
  document.getElementById('fbtn-nf').disabled  = true;
  document.getElementById('fbtn-bnf').disabled = true;
  document.getElementById('fut-reload-btn').disabled = false;
  showAlert('err', '⚠ Futures fetch failed: ' + (msg || 'unknown'), false);
}

// ──── Symbol / Interval ────
function applyLotSizeForSelection(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('bank') || v.includes('bnf')) {
    LOT_SIZE = 30;
  } else if (v.includes('nifty') || v.includes('nf')) {
    LOT_SIZE = 65;
  }

  const input = document.getElementById('lot-size-input');
  if (input) input.value = LOT_SIZE;

  agbubMinContracts = Math.max(1, +document.getElementById('bub-min-contracts').value || 1) * LOT_SIZE;
  if (typeof AGBUB?.draw === 'function') AGBUB.draw();
}

function pickSym(k,btn) {
  selSym = k;
  document.getElementById('custom-sym').value = '';
  document.querySelectorAll('.sbtn,.fbtn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  applyLotSizeForSelection(k);
}

function pickIv(v) { selIv=v; document.querySelectorAll('.ivbtn').forEach(b=>b.classList.toggle('active',+b.dataset.iv===v)); }
function loadSym() {
  const c=document.getElementById('custom-sym').value.trim();
  if(c){selSym=c; document.querySelectorAll('.sbtn').forEach(b=>b.classList.remove('active'));}
  if(!selSym){showAlert('warn','⚠ Select or type a symbol first.');return;}
  if(!tokSaved){showAlert('err','⚠ Save your Access Token first.');return;}
  if(!ws||ws.readyState!==WebSocket.OPEN){showAlert('err','⚠ Not connected. Click Connect.');return;}
  clearAlerts();
  aggBucket = null;
  clearLastPriceLine();
  applyLotSizeForSelection(selSym);
  historyReadyForSubscribe = false;
  if (lwChart) {
    cData=[]; vData=[]; cMap={};
    cSeries.setData([]); vSeries.setData([]);
  }
  showAlert('info', `Loading 7 days of ${ivLabel(selIv)} history…`, false);
  ws.send(JSON.stringify({
    type: 'load_symbol_history', instrument: selSym, interval: selIv,
  }));
}

function renderActiveSubscriptions(instruments) {
  const list = document.getElementById('active-subscription-list');
  const count = document.getElementById('active-subscription-count');
  const button = document.getElementById('unsubscribe-all-btn');
  if (!list || !count) return;
  const active = Array.isArray(instruments) ? instruments : [];
  count.textContent = active.length;
  if (button) button.disabled = active.length === 0 || !ws || ws.readyState !== WebSocket.OPEN;
  list.textContent = '';
  if (!active.length) {
    const empty = document.createElement('div');
    empty.className = 'active-subscription-empty';
    empty.textContent = 'No active instruments';
    list.appendChild(empty);
    return;
  }
  active.forEach(instrument => {
    const item = document.createElement('div');
    item.className = 'active-subscription-item';
    const name = typeof instrument === 'string' ? instrument : instrument.name;
    const key = typeof instrument === 'string' ? instrument : instrument.key;
    item.title = key;
    item.innerHTML = '<span class="active-subscription-dot"></span>';
    const label = document.createElement('span');
    label.textContent = name;
    item.appendChild(label);
    list.appendChild(item);
  });
}

function toggleActiveSubscriptions() {
  const panel = document.getElementById('active-subscriptions');
  const toggle = document.getElementById('active-subscriptions-toggle');
  const list = document.getElementById('active-subscription-list');
  if (!panel || !toggle || !list) return;
  const collapsed = panel.classList.toggle('collapsed');
  toggle.setAttribute('aria-expanded', String(!collapsed));
  list.hidden = collapsed;
  sessionStorage.setItem('active_subscriptions_collapsed', String(collapsed));
}

function restoreActiveSubscriptionsState() {
  const panel = document.getElementById('active-subscriptions');
  const toggle = document.getElementById('active-subscriptions-toggle');
  const list = document.getElementById('active-subscription-list');
  if (!panel || !toggle || !list) return;
  const collapsed = sessionStorage.getItem('active_subscriptions_collapsed') === 'true';
  panel.classList.toggle('collapsed', collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  list.hidden = collapsed;
}

function unsubscribeAll() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({type: 'unsubscribe_all'}));
}

let lastPriceLine = null;

function clearLastPriceLine() {
  if (cSeries && lastPriceLine) {
    try { cSeries.removePriceLine(lastPriceLine); } catch (_) {}
    lastPriceLine = null;
  }
}

// ──── Status & Alerts ────
function setStatus(cls,txt){const e=document.getElementById('statusBadge');e.className='badge '+cls;e.textContent=txt;}
function showAlert(type,msg,hide=true){
  const b=document.getElementById('alerts'); b.style.display='block';
  const d=document.createElement('div'); d.className='alert '+type; d.textContent=msg; b.appendChild(d);
  if(hide) setTimeout(()=>{d.remove();if(!b.children.length)b.style.display='none';},6000);
}
function clearAlerts(){const b=document.getElementById('alerts');b.innerHTML='';b.style.display='none';}

// ──── Ticker Display ────
function updateLTP(ltp) {
  const el=document.getElementById('t-ltp'), prev=parseFloat(el.dataset.p||ltp);
  el.textContent=fN(ltp); el.className='tv '+(ltp>=prev?'up':'dn'); el.dataset.p=ltp;
}
function updateTicker(c, sym) {
  if(sym){document.getElementById('sym-disp').textContent=sym; document.getElementById('s-sym').textContent=sym;}
  document.getElementById('t-o').textContent=fN(c.open);
  document.getElementById('t-h').textContent=fN(c.high);
  document.getElementById('t-l').textContent=fN(c.low);
  document.getElementById('t-c').textContent=fN(c.close);
  document.getElementById('t-v').textContent=fV(c.volume);
  const chg=c.close-c.open, pct=((chg/c.open)*100).toFixed(2);
  const el=document.getElementById('t-chg');
  el.textContent=`${chg>=0?'+':''}${fN(chg)} (${pct}%)`; el.className='tv '+(chg>=0?'up':'dn');
}

// ──── PostgreSQL history loader for saved datasets ────

let _savedDatasets = [];

function dbListSaved() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showAlert('err', '⚠ Connect to server first.'); return;
  }
  const dateVal = document.getElementById('db-date-filter').value.trim();
  document.getElementById('db-list-status').textContent = '⏳ loading…';
  document.getElementById('db-dataset-list').innerHTML  = '';
  ws.send(JSON.stringify({ type: 'list_history', date: dateVal }));
}

function renderSavedList(datasets) {
  _savedDatasets = datasets || [];
  const el  = document.getElementById('db-dataset-list');
  const st  = document.getElementById('db-list-status');
  el.innerHTML = '';
  if (!_savedDatasets.length) {
    st.textContent = 'No data found.'; return;
  }
  st.textContent = `${_savedDatasets.length} dataset(s) found`;
  _savedDatasets.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'db-row';
    row.innerHTML =
      `<span class="db-row-info"><b>${d.instrument}</b><small>${d.candle_count} candles</small></span>` +
      `<span class="db-row-btns">` +
        `<button class="db-load-btn" onclick="dbLoad(${i})">Load</button>` +
      `</span>`;
    el.appendChild(row);
  });
}

function dbLoad(idx) {
  const d = _savedDatasets[idx];
  if (!d || !ws || ws.readyState !== WebSocket.OPEN) return;
  document.getElementById('db-list-status').textContent = '⏳ loading history…';
  ws.send(JSON.stringify({
    type:       'load_history',
    date:       d.date,
    instrument: d.instrument_key || d.instrument,
  }));
}

function applyHistoryData(msg) {
  const st = document.getElementById('db-list-status');
  const candles = msg.candles || [];
  const ticks   = msg.ticks || [];
  const label   = msg.label   || msg.instrument || '?';

  if (candles.length > 0) {
    clearAlerts();
    _applyCandles(candles, label);
    ticks.forEach(t => AGBUB.push(
      t.ltp, t.best_ask, t.best_bid, t.vtt, t.timestamp, false, t.contracts));
    AGBUB.draw();
    showAlert('ok', `✅ Loaded ${candles.length} candles + ${AGBUB.items.length} bubbles — ${label}`);
  }
  if (!candles.length) showAlert('warn', `⚠ No candles found for ${label}`);
  st.textContent = candles.length
    ? `✅ ${candles.length} candles + ${ticks.length} ticks loaded`
    : '⚠ empty';
}

function applySymbolHistory(msg) {
  const candles = msg.candles || [];
  const ticks = msg.ticks || [];
  const label = msg.instrument || selSym || '?';
  aggBucket = null;
  if (candles.length) {
    _applyCandles(candles, label, true);
    ticks.forEach(t => AGBUB.push(
      t.ltp, t.best_ask, t.best_bid, t.vtt, t.timestamp, false, t.contracts));
    AGBUB.draw();
    showAlert('ok', `✅ Loaded ${candles.length} candles for ${label}`);
  } else {
    showAlert('warn', `⚠ No historical ticks found for ${label}`);
  }
}

// ──── Drawer Toggle ────
function toggleDrawer(){
  const drawer = document.getElementById('side-drawer');
  const toggle = document.getElementById('drawer-toggle');
  const isOpen = !drawer.classList.contains('collapsed');
  drawer.classList.toggle('collapsed', isOpen);
  toggle.classList.toggle('collapsed', isOpen);
  toggle.textContent = isOpen ? '›' : '‹';
  setTimeout(() => {
    const con = document.getElementById('chart-con');
    if(lwChart) lwChart.resize(Math.max(con.clientWidth,200), Math.max(con.clientHeight,100));
    requestAnimationFrame(()=>AGBUB.draw());
  }, 280);
}
