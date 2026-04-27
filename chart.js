// ─────────────────────────────────────────────────────────────────────────────
// CHART INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────
function initCharts() {
  if(typeof LightweightCharts==='undefined'){showAlert('err','Chart library not loaded.');return false;}
  document.getElementById('placeholder').style.display='none';
  if(lwChart){try{lwChart.remove();}catch(_){} lwChart=null;}
  cData=[]; vData=[]; cMap={};
  _atRealTime = true;

  // Upstox sends TRUE Unix epoch seconds (UTC-based).
  // 15:22:25 IST = 09:52:25 UTC epoch. LightweightCharts displays as UTC → shows 09:52.
  // Fix: shift ts by +19800s (5h30m) before display so chart axis shows IST wall-clock time.

  const theme = {
    layout:          {background:{color:'#111826'}, textColor:'#5a7a9a'},
    grid:            {vertLines:{color:'#1a2535'}, horzLines:{color:'#1a2535'}},
    timeScale:       {borderColor:'#1e2d42', timeVisible:true, secondsVisible:true,
                      shiftVisibleRangeOnNewBar: false,
                      lockVisibleTimeRangeOnResize: true},
    rightPriceScale: {borderColor:'#1e2d42'},
    crosshair:       {mode:0},
    localization: {
      timeFormatter: (ts) => {
        // ts is already IST-shifted (we added +19800s when feeding data in)
        // so just read as UTC to get the correct IST wall-clock display
        const d = new Date(ts * 1000);
        const hh = String(d.getUTCHours()).padStart(2,'0');
        const mm = String(d.getUTCMinutes()).padStart(2,'0');
        const ss = String(d.getUTCSeconds()).padStart(2,'0');
        const dd = d.getUTCDate(), mo = d.getUTCMonth()+1, yy = d.getUTCFullYear();
        return `${dd}/${mo}/${yy} ${hh}:${mm}:${ss} IST`;
      },
    },
  };

  const cc  = document.getElementById('lw-chart');
  const con = document.getElementById('chart-con');

  // Read dimensions from the container AFTER CSS layout has resolved
  const mainW = Math.max(con.clientWidth,  200);
  const mainH = Math.max(con.clientHeight, 200);

  lwChart  = LightweightCharts.createChart(cc, {...theme, width: mainW, height: mainH});
  cSeries  = lwChart.addCandlestickSeries({
    upColor:'#26a69a', downColor:'#7b5ea7',
    borderUpColor:'#26a69a', borderDownColor:'#7b5ea7',
    wickUpColor:'#26a69a', wickDownColor:'#7b5ea7',
    priceScaleId: 'right',
  });

  // Volume as overlay histogram at the bottom of the main chart (like TradingView)
  vSeries = lwChart.addHistogramSeries({
    color: '#00d4ff44',
    priceFormat: {type:'volume'},
    priceScaleId: 'vol',   // separate hidden scale so it doesn't interfere with price
  });
  lwChart.priceScale('vol').applyOptions({
    scaleMargins: {top: 0.80, bottom: 0},   // volume occupies bottom 20% of chart
    visible: false,                           // hide the volume price axis
  });
  // Push candles up so they don't overlap volume bars
  cSeries.priceScale().applyOptions({
    scaleMargins: {top: 0.05, bottom: 0.22},
  });

  // Redraw bubbles on pan/zoom
  // Also detect if user manually scrolled away from live edge
  lwChart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    AGBUB.draw();
  });

  // Redraw bubbles on price scale change (vertical zoom)
  lwChart.priceScale('right').applyOptions({});
  lwChart.subscribeCrosshairMove(() => AGBUB.draw());

  // Mount bubble overlay canvas
  AGBUB.mount();

  // Detect user drag — set _atRealTime=false so ticks don't chase them back
  cc.addEventListener('mousedown', () => { setLiveMode(false); });
  cc.addEventListener('touchstart', () => { setLiveMode(false); }, {passive:true});

  // Resize observer — watches chart-con only
  const wrap = document.getElementById('chart-wrap');
  if (!wrap._ro) {
    wrap._ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const el = entry.target;
        const w  = Math.floor(el.clientWidth);
        const h  = Math.floor(el.clientHeight);
        if (el.id === 'chart-con' && lwChart) lwChart.resize(Math.max(w,200), Math.max(h,100));
      }
      AGBUB.sync(); AGBUB.draw();
    });
    wrap._ro.observe(con);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT-SIDE CANDLE AGGREGATOR (chart display only — bubbles use raw 1s candles)
// When selIv=60 or 900: groups 1s raw candles into 1m/15m OHLCV buckets.
// Returns the bucket candle to be upserted on chart.
// ─────────────────────────────────────────────────────────────────────────────
function aggCandle(raw) {
  if (selIv !== 60 && selIv !== 300 && selIv !== 900) return raw;   // normal mode — pass through

  const bucketTime = Math.floor(raw.time / selIv) * selIv;

  if (!aggBucket || aggBucket.time !== bucketTime) {
    // New bucket starts — previous is now fully closed
    aggBucket = {
      time:   bucketTime,
      open:   raw.open,
      high:   raw.high,
      low:    raw.low,
      close:  raw.close,
      volume: raw.volume || 0,
    };
  } else {
    // Extend existing bucket with this 1s candle
    aggBucket.high   = Math.max(aggBucket.high,  raw.high);
    aggBucket.low    = Math.min(aggBucket.low,   raw.low);
    aggBucket.close  = raw.close;
    aggBucket.volume = (aggBucket.volume || 0) + (raw.volume || 0);
  }
  return aggBucket;
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSERT CANDLE
// bulk=true  → called during init/history load  → use setData() (full rebuild)
// bulk=false → called on live tick/candle        → use update() (no viewport reset)
// ─────────────────────────────────────────────────────────────────────────────
function upsertCandle(c, bulk) {
  if(!cSeries) return;
  const t  = c.time + IST_OFFSET_S;   // shift to IST so LW axis shows correct time
  const cd = {time:t, open:c.open, high:c.high, low:c.low, close:c.close};
  const vd = {time:t, value:c.volume, color: c.close>=c.open ? '#00e67644':'#ff3d5a44'};
  if(cMap[t] !== undefined) { cData[cMap[t]]=cd; vData[cMap[t]]=vd; }
  else { cMap[t]=cData.length; cData.push(cd); vData.push(vd); }
  if (bulk) {
    // Full rebuild — used by init/history. setData resets viewport (intentional).
    cSeries.setData(cData);
    vSeries.setData(vData);
  } else {
    // Live tick — update() patches only this candle, viewport stays where user dragged.
    cSeries.update(cd);
    vSeries.update(vd);
  }
  document.getElementById('s-bars').textContent = cData.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL FILE PARSING & LOADING
// ─────────────────────────────────────────────────────────────────────────────
function parseCSVText(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
  const rows = lines.slice(1).map(line => {
    const cols = line.split(',');
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || '').trim().replace(/^"|"$/g,''); });
    return obj;
  });
  return { headers, rows };
}

function _applyCSVCandles(candles, label) {
  // Ensure chart is ready
  if (typeof LightweightCharts === 'undefined') {
    setTimeout(() => _applyCSVCandles(candles, label), 200);
    return;
  }
  if (!lwChart && !initCharts()) {
    setTimeout(() => _applyCSVCandles(candles, label), 200);
    return;
  }

  // Reset all state
  cData=[]; vData=[]; cMap={};
  AGBUB.clear(); aggBucket = null;

  // Aggregate candles into display buckets (1m/5m/15m) and collect into arrays
  const aggCData = [], aggVData = [], aggMap = {};
  candles.forEach(c => {
    const agg = aggCandle(c);
    const t   = agg.time + IST_OFFSET_S;
    const cd  = {time:t, open:agg.open, high:agg.high, low:agg.low, close:agg.close};
    const vd  = {time:t, value:agg.volume, color: agg.close>=agg.open ? '#00e67644':'#ff3d5a44'};
    if (aggMap[t] !== undefined) { aggCData[aggMap[t]]=cd; aggVData[aggMap[t]]=vd; }
    else { aggMap[t]=aggCData.length; aggCData.push(cd); aggVData.push(vd); }
  });

  // Single setData call — fast and correct
  cData = aggCData; vData = aggVData; cMap = aggMap;
  cSeries.setData(cData);
  vSeries.setData(vData);
  document.getElementById('s-bars').textContent = cData.length;

  setTimeout(() => {
    lwChart.timeScale().fitContent();
    requestAnimationFrame(() => AGBUB.draw());
  }, 100);

  const last = candles[candles.length-1];
  updateTicker(last, label);
  document.getElementById('s-sym').textContent    = label;
  document.getElementById('sym-disp').textContent  = label;
  document.getElementById('s-iv').textContent     = ivLabel(selIv);
}

function loadLocalCSV(input) {
  const file = input.files[0]; if (!file) return;
  const st   = document.getElementById('local-file-status');
  st.textContent = '⏳ reading…';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const { rows } = parseCSVText(e.target.result);
      const candles = rows.map(r => {
        // Support both datetime_utc (new format) and datetime (old)
        const dtStr  = r.datetime_utc || r.datetime || '';
        // Handle both "2024-04-15 09:15:00" and ISO formats; treat as UTC
        const parsed = new Date(dtStr.replace(' ','T') + (dtStr.includes('T') ? '' : 'Z'));
        return {
          time:   Math.floor(parsed.getTime() / 1000),
          open:   parseFloat(r.open),
          high:   parseFloat(r.high),
          low:    parseFloat(r.low),
          close:  parseFloat(r.close),
          volume: parseFloat(r.volume || 0),
        };
      }).filter(c => !isNaN(c.time) && !isNaN(c.open) && isFinite(c.time));

      if (candles.length === 0) { st.textContent='⚠ No valid rows'; return; }

      // Sort by time ascending (some CSVs may be unsorted)
      candles.sort((a,b) => a.time - b.time);

      const label = file.name.replace(/\.csv$/i,'');
      clearAlerts();
      _applyCSVCandles(candles, label);
      showAlert('ok', `✅ Loaded ${candles.length} candles from ${file.name}`);
      st.textContent = `✅ ${candles.length} candles`;
    } catch(err) {
      st.textContent = '⚠ parse error';
      showAlert('err','⚠ Could not parse CSV: ' + err.message, false);
    }
    input.value = '';   // allow re-loading same file
  };
  reader.readAsText(file);
}

function loadLocalTicks(input) {
  const file = input.files[0]; if (!file) return;
  const st   = document.getElementById('local-file-status');
  st.textContent = '⏳ reading ticks…';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const { rows } = parseCSVText(e.target.result);
      let pushed = 0;
      AGBUB.clear();
      rows.forEach(r => {
        const ltp      = parseFloat(r.ltp);
        const vtt      = parseInt(r.vtt || '0');
        const best_ask = r.best_ask ? parseFloat(r.best_ask) : null;
        const best_bid = r.best_bid ? parseFloat(r.best_bid) : null;
        const ltt_ms   = parseInt(r.ltt_ms || '0');
        if (!isNaN(ltp) && ltt_ms > 0) {
          AGBUB.push(ltp, best_ask, best_bid, vtt, ltt_ms);
          pushed++;
        }
      });
      setTimeout(() => requestAnimationFrame(() => AGBUB.draw()), 100);
      clearAlerts();
      showAlert('ok', `✅ Replayed ${pushed} ticks → ${AGBUB.items.length} ag bubbles from ${file.name}`);
      st.textContent = `✅ ${pushed} ticks, ${AGBUB.items.length} bubbles`;
    } catch(err) {
      st.textContent = '⚠ parse error';
      showAlert('err','⚠ Could not parse ticks CSV: ' + err.message, false);
    }
    input.value = '';
  };
  reader.readAsText(file);
}
