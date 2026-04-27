// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET CONNECTION & MESSAGE HANDLING
// ─────────────────────────────────────────────────────────────────────────────

function connectWS() {
  clearAlerts();
  if(ws) ws.close();
  setStatus('connecting','CONNECTING…');
  
  try {
    ws = new WebSocket(CONFIG.WEBSOCKET_URL);
  } catch(e) {
    showAlert('err','⚠ WebSocket creation failed: ' + e.message, false);
    setStatus('err','ERROR');
    return;
  }

  ws.onopen = () => {
    safeCall(() => {
      setStatus('authed','● CONNECTED');
      document.getElementById('connectBtn').disabled    = true;
      document.getElementById('disconnectBtn').disabled = false;
      document.getElementById('saveTokenBtn').disabled  = false;
      showAlert('info','✅ Connected! Paste your token and click Save Token.');
      if (tpsTmr) clearInterval(tpsTmr);
      tpsTmr = setInterval(() => {
        const el = document.getElementById('s-tps');
        if (el) el.textContent = tickCnt;
        tickCnt=0;
      }, CONFIG.TPS_INTERVAL_MS);
      loadFutures();
    });
  };

  ws.onmessage = e => {
    try {
      let msg; try{msg=JSON.parse(e.data);}catch(_){return;}
      tickCnt++;
      const t = msg.type;

    if (t === 'auth_ok') {
      setTok(true,'✅ Token accepted!'); setStatus('live','● READY');
      showAlert('ok','✅ Token saved! Pick symbol and click ▶ Load');
      document.getElementById('hist-btn').disabled = false;
    }
    else if (t === 'auth_fail') { setTok(false,'❌ '+msg.message); showAlert('err','⚠ '+msg.message,false); }
    else if (t === 'init') {
      if (msg.candles && msg.candles.length > 0) {
        if (!lwChart && !initCharts()) return;
        aggBucket = null;
        AGBUB.clear();
        msg.candles.forEach(c => upsertCandle(aggCandle(c), true));
        setTimeout(() => {
          AGBUB.clear();
          lwChart.timeScale().fitContent();
          requestAnimationFrame(() => AGBUB.draw());
        }, 120);
        updateTicker(msg.candles[msg.candles.length-1], msg.symbol||'');
        document.getElementById('s-iv').textContent = ivLabel(selIv);
      }
    }
    else if (t === 'switching') {
      clearAlerts();
      if (!initCharts()) return;
      AGBUB.clear();
      aggBucket = null;
      showAlert('info',`🔄 Switching to ${msg.symbol} @ ${ivLabel(selIv)}…`);
      document.getElementById('s-sym').textContent  = msg.symbol;
      document.getElementById('s-iv').textContent   = ivLabel(selIv);
      document.getElementById('sym-disp').textContent = msg.symbol;
    }
    else if (t === 'status') {
      if (msg.status==='connected') {
        clearAlerts();
        showAlert('ok',`✅ Live: ${msg.symbol} @ ${ivLabel(selIv)}`);
        document.getElementById('s-sym').textContent = msg.symbol;
        document.getElementById('s-iv').textContent  = ivLabel(selIv);
        setStatus('live','● LIVE');
      } else if (msg.status==='error') { showAlert('err','⚠ Feed error: '+msg.message,false); }
      else if (msg.status==='auth_error') {
        setStatus('err','⚠ TOKEN EXPIRED');
        setTok(false,'❌ Token expired — get a new token from developer.upstox.com');
        showAlert('err','🔑 Token rejected (403). Get a fresh token from developer.upstox.com → Save Token again.',false);
      }
      else if (msg.status==='reconnecting') {
        setStatus('connecting','RECONNECTING…');
        showAlert('warn','🔄 '+msg.message,false);
      }
    }
    else if (t === 'candle') {
      if (!lwChart && !initCharts()) return;
      const chartCandle = aggCandle(msg.candle);
      upsertCandle(chartCandle, false);
      updateTicker(chartCandle, msg.instrument);
      if (_atRealTime) lwChart.timeScale().scrollToRealTime();
      requestAnimationFrame(() => AGBUB.draw());
    }
    else if (t === 'tick') {
      if (!lwChart && !initCharts()) return;
      updateLTP(msg.ltp);
      document.getElementById('s-last').textContent = fT(msg.ltt);
      if (msg.ltp != null && msg.vtt != null && msg.ltt != null) {
        const bestAsk = (msg.best_ask != null) ? msg.best_ask : null;
        const bestBid = (msg.best_bid != null) ? msg.best_bid : null;
        AGBUB.push(+msg.ltp, bestAsk, bestBid, +msg.vtt, +msg.ltt);
      }
      if (msg.current_candle) {
        const chartCandle = aggCandle(msg.current_candle);
        upsertCandle(chartCandle, false);
        updateTicker(chartCandle, msg.instrument);
      }
    }
    else if (t === 'history_loading') {
      clearAlerts();
      if (!initCharts()) return;
      AGBUB.clear();
      document.getElementById('hist-status').textContent = '⏳ Fetching…';
      showAlert('info', `🔄 Loading history: ${msg.symbol} @ ${msg.unit}…`);
    }
    else if (t === 'history_data')  { renderHistory(msg.candles, msg.symbol, msg.unit); }
    else if (t === 'history_error') {
      document.getElementById('hist-status').textContent = '⚠ Error';
      document.getElementById('hist-btn').disabled = false;
      showAlert('err', '⚠ ' + msg.message, false);
    }
    else if (t === 'futures_loading') {
      // spinner already shown by loadFutures(), nothing to do
    }
    else if (t === 'futures_data') { renderFutures(msg.data); }
    else if (t === 'futures_error') { onFuturesError(msg.message); }
    else if (t === 'error') { showAlert('err','⚠ '+msg.message,false); }
    } catch(e) {
      console.error('Message handler error:', e);
    }
  };

  ws.onerror = () => {
    setStatus('err','ERROR');
    showAlert('err',`⚠ Cannot connect to ${CONFIG.WEBSOCKET_URL}\n→ Double-click START_SERVER.bat first, then retry.`,false);
  };
  
  ws.onclose = () => {
    try {
      setStatus('idle','DISCONNECTED');
      document.getElementById('connectBtn').disabled    = false;
      document.getElementById('disconnectBtn').disabled = true;
      document.getElementById('saveTokenBtn').disabled  = true;
      document.getElementById('loadBtn').disabled       = true;
      if(tpsTmr){clearInterval(tpsTmr);tpsTmr=null;}
      const tpsEl = document.getElementById('s-tps'); if (tpsEl) tpsEl.textContent = '—';
      tokSaved=false; setTok(null,'Disconnected.');
    } catch(e) {
      console.error('Disconnect handler error:', e);
    }
  };
}

function disconnectWS(){
  if(ws){ws.close();ws=null;}
}
