// ─────────────────────────────────────────────────────────────────────────────
// UI CONTROLS & BUTTONS
// ─────────────────────────────────────────────────────────────────────────────

// ──── Bubble Control ────
function toggleBubbles() {
  bubOn = !bubOn;
  const btn = document.getElementById('bubBtn');
  btn.textContent = bubOn ? '● ON' : '○ OFF';
  btn.classList.toggle('off', !bubOn);
  AGBUB.draw();
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
  hLines.push({ priceLine: pl, price });
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
    return true;
  }
  return false;
}

function clearAllLines() {
  if (!cSeries) return;
  hLines.forEach(h => cSeries.removePriceLine(h.priceLine));
  hLines = [];
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
function pickSym(k,btn) { selSym=k; document.getElementById('custom-sym').value=''; document.querySelectorAll('.sbtn,.fbtn').forEach(b=>b.classList.remove('active')); if(btn)btn.classList.add('active'); }
function pickIv(v) { selIv=v; document.querySelectorAll('.ivbtn').forEach(b=>b.classList.toggle('active',+b.dataset.iv===v)); }
function loadSym() {
  const c=document.getElementById('custom-sym').value.trim();
  if(c){selSym=c; document.querySelectorAll('.sbtn').forEach(b=>b.classList.remove('active'));}
  if(!selSym){showAlert('warn','⚠ Select or type a symbol first.');return;}
  if(!tokSaved){showAlert('err','⚠ Save your Access Token first.');return;}
  if(!ws||ws.readyState!==WebSocket.OPEN){showAlert('err','⚠ Not connected. Click Connect.');return;}
  clearAlerts();
  aggBucket = null;
  const backendIv = (selIv === 60 || selIv === 300 || selIv === 900) ? 1 : selIv;
  ws.send(JSON.stringify({type:'subscribe', symbol:selSym, interval:backendIv, display_interval:selIv}));
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

// ──── SQLite DB Loader ────

let _savedDatasets = [];   // cache of last sqlite_list response

function dbListSaved() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showAlert('err', '⚠ Connect to server first.'); return;
  }
  const dateVal = document.getElementById('db-date-filter').value.trim();
  document.getElementById('db-list-status').textContent = '⏳ loading…';
  document.getElementById('db-dataset-list').innerHTML  = '';
  ws.send(JSON.stringify({ type: 'list_saved', date: dateVal, source: 'db' }));
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
      `<span class="db-row-info"><b>${d.instrument}</b></span>` +
      `<span class="db-row-btns">` +
        (d.has_candles ? `<button class="db-load-btn" onclick="dbLoad(${i},'candles')">Candles</button>` : '') +
        (d.has_ticks   ? `<button class="db-load-btn tick" onclick="dbLoad(${i},'ticks')">Ticks</button>` : '') +
        (d.has_candles && d.has_ticks ? `<button class="db-load-btn both" onclick="dbLoad(${i},'both')">Both</button>` : '') +
      `</span>`;
    el.appendChild(row);
  });
}

function dbLoad(idx, what) {
  const d = _savedDatasets[idx];
  if (!d || !ws || ws.readyState !== WebSocket.OPEN) return;
  document.getElementById('db-list-status').textContent = `⏳ loading ${what}…`;
  ws.send(JSON.stringify({
    type:       'load_sqlite',
    date:       d.date,
    instrument: d.instrument_key || d.instrument,
    load:       what,
  }));
}

function applySQLiteData(msg) {
  const st = document.getElementById('db-list-status');
  const candles = msg.candles || [];
  const ticks   = msg.ticks   || [];
  const label   = msg.label   || msg.instrument || '?';

  if (candles.length > 0) {
    clearAlerts();
    _applyCandles(candles, label);
    showAlert('ok', `✅ Loaded ${candles.length} candles — ${label}`);
  }
  if (ticks.length > 0) {
    let pushed = 0;
    if (candles.length === 0) AGBUB.clear();   // only reset bubbles if no candles loaded
    ticks.forEach(r => {
      if (r.ltp != null && r.ltt_ms > 0) {
        AGBUB.push(+r.ltp, r.best_ask ?? null, r.best_bid ?? null, +r.vtt, +r.ltt_ms);
        pushed++;
      }
    });
    setTimeout(() => requestAnimationFrame(() => AGBUB.draw()), 100);
    if (candles.length === 0) showAlert('ok', `✅ Replayed ${pushed} ticks → ${AGBUB.items.length} bubbles — ${label}`);
    else showAlert('ok', `✅ ${candles.length} candles + ${AGBUB.items.length} bubbles — ${label}`);
  }
  if (!candles.length && !ticks.length) showAlert('warn', `⚠ No data found for ${label}`);
  st.textContent = candles.length || ticks.length
    ? `✅ ${candles.length} candles, ${ticks.length} ticks`
    : '⚠ empty';
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
