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
let drawLineMode = false;
let hLines = [];

function toggleDrawLine() {
  drawLineMode = !drawLineMode;
  const btn = document.getElementById('drawline-btn');
  btn.textContent       = drawLineMode ? '✖ Exit Draw' : '✏ Draw Line';
  btn.style.borderColor = drawLineMode ? 'var(--warn)'  : '';
  btn.style.color       = drawLineMode ? 'var(--warn)'  : '';
  document.getElementById('lw-chart').style.cursor = drawLineMode ? 'crosshair' : '';
}

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
    const screenY = lineY;
    const diff = Math.abs((clientY - rect.top) - screenY);
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
  tokSaved=false; setTok(null,'Token cleared.');
  document.getElementById('loadBtn').disabled=true;
  document.getElementById('clearTokenBtn').disabled=true;
}

function setTok(ok, msg) {
  const dot=document.getElementById('tok-dot'), txt=document.getElementById('tok-msg'), inp=document.getElementById('token-input');
  txt.textContent=msg;
  if(ok===true) { dot.className='ok'; inp.className='tok-ok'; tokSaved=true; document.getElementById('loadBtn').disabled=false; document.getElementById('clearTokenBtn').disabled=false; }
  else if(ok===false) { dot.className='fail'; inp.className='tok-fail'; tokSaved=false; document.getElementById('loadBtn').disabled=true; }
  else { dot.className=''; inp.className=''; }
}

// ──── History ────
function initHistoryDates() {
  const today = new Date();
  const yyyy  = today.getFullYear();
  const mm    = String(today.getMonth()+1).padStart(2,'0');
  const dd    = String(today.getDate()).padStart(2,'0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const weekAgo = new Date(today); weekAgo.setDate(today.getDate()-7);
  const wy = weekAgo.getFullYear(), wm = String(weekAgo.getMonth()+1).padStart(2,'0'), wd = String(weekAgo.getDate()).padStart(2,'0');
  const fromStr = `${wy}-${wm}-${wd}`;

  document.getElementById('hist-from').value = fromStr;
  document.getElementById('hist-to').value   = todayStr;
  document.getElementById('hist-from').max   = todayStr;
  document.getElementById('hist-to').max     = todayStr;
}

function loadHistory() {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showAlert('err','⚠ Connect first.'); return; }
  if (!selSym) { showAlert('warn','⚠ Pick a symbol first (Nifty Fut / BankNifty Fut above).'); return; }
  const unit     = document.getElementById('hist-unit').value;
  const fromDate = document.getElementById('hist-from').value;
  const toDate   = document.getElementById('hist-to').value;
  if (!fromDate || !toDate) { showAlert('warn','⚠ Set from/to dates.'); return; }

  document.getElementById('hist-status').textContent = '⏳ Loading…';
  document.getElementById('hist-btn').disabled = true;
  ws.send(JSON.stringify({ type:'get_history', symbol:selSym, unit, from_date:fromDate, to_date:toDate }));
}

function renderHistory(candles, symbol, unit) {
  if (!candles || candles.length === 0) {
    showAlert('warn','⚠ No candles returned. Market may have been closed or date range invalid.', false);
    document.getElementById('hist-status').textContent = '0 candles';
    document.getElementById('hist-btn').disabled = false;
    return;
  }
  if (!lwChart && !initCharts()) return;

  cData=[]; vData=[]; cMap={};
  AGBUB.clear();
  candles.forEach(c => upsertCandle(c, true));

  setTimeout(() => {
    lwChart.timeScale().fitContent();
    requestAnimationFrame(() => AGBUB.draw());
  }, 100);

  updateTicker(candles[candles.length-1], symbol);
  document.getElementById('s-sym').textContent = symbol;
  document.getElementById('s-iv').textContent  = unit;
  document.getElementById('sym-disp').textContent = symbol;
  document.getElementById('hist-status').textContent = `✅ ${candles.length} candles`;
  document.getElementById('hist-btn').disabled = false;
  showAlert('ok', `✅ Loaded ${candles.length} ${unit} candles for ${symbol}`);
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
  const ratEl = document.getElementById('t-rat'); if(c.volume>0 && ratEl) ratEl.textContent=(Math.abs(chg)*1000/c.volume).toFixed(4)+'×10⁻³';
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
