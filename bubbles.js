// ─────────────────────────────────────────────────────────────────────────────
// AGGRESSIVE ORDER BUBBLE OVERLAY
// Yellow = LTP >= best ask (aggressive buy)
// Red    = LTP <= best bid (aggressive sell)
// Triggered on every tick, not on candles.
// X = tick time mapped to chart, Y = LTP price
// Size = contracts (ltq), filtered by agbubMinContracts
// ─────────────────────────────────────────────────────────────────────────────

const AGBUB = {
  canvas:  null,
  ctx:     null,
  items:   [],       // [{time, ltp, contracts, type:'buy'|'sell'}]
  MAX:     CONFIG.MAX_BUBBLES,
  MIN_R:   CONFIG.MIN_BUBBLE_RADIUS,
  hovered: null,
  prevVtt: null,     // last seen vtt for diff calculation

  mount() {
    const canvas = document.getElementById('agbub-canvas');
    if (!canvas) return;
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    canvas.addEventListener('mousemove',  e => this._onMove(e));
    canvas.addEventListener('mouseleave', () => this._onLeave());
  },

  sync() {
    if (!this.canvas) return;
    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width  = w;
      this.canvas.height = h;
    }
  },

  // Call on every tick that has ltp + best_ask/best_bid + vtt
  push(ltp, bestAsk, bestBid, vtt, timeEpochMs) {
    if (!ltp || vtt == null) return;
    const curVtt = +vtt;

    // Compute vtt diff; skip if first tick or vtt reset (new day)
    let contracts = 0;
    if (this.prevVtt !== null && curVtt >= this.prevVtt) {
      contracts = curVtt - this.prevVtt;
    }
    this.prevVtt = curVtt;

    if (contracts < agbubMinContracts) return;  // also filters 0 (duplicate ticks)

    let type = null;
    if (bestAsk != null && ltp >= bestAsk) type = 'buy';
    else if (bestBid != null && ltp <= bestBid) type = 'sell';
    if (!type) return;

    // Store raw UTC seconds — toXY will add IST_OFFSET_S to match chart coordinates
    const timeSec = Math.floor(+timeEpochMs / 1000);
    const lots = Math.round(contracts / LOT_SIZE); // convert contracts → lots for display & sizing

    this.items.push({ time: timeSec, timeMs: +timeEpochMs, ltp, contracts, lots, type });
    if (this.items.length > this.MAX) this.items.shift();
    const sb = document.getElementById('s-bubs'); if (sb) sb.textContent = this.items.length;
    this.draw();
  },

  _radius(lots) {
    // Radius = lots × scale ÷ 10 × multiplier, clamped to [MIN_R, agbubMaxRadius]
    return Math.min(Math.max(lots * agbubScale / 10 * agbubMultiplier, this.MIN_R), agbubMaxRadius);
  },

  toXY(timeSec, price) {
    if (!lwChart || !cSeries) return null;
    try {
      // Snap tick time to the same bucket interval the chart uses,
      // then add IST_OFFSET_S because upsertCandle shifts all times by +19800s
      const bucketIv = (selIv === 60 || selIv === 300 || selIv === 900) ? selIv : 5;
      const chartT = Math.floor(timeSec / bucketIv) * bucketIv + IST_OFFSET_S;
      const x = lwChart.timeScale().timeToCoordinate(chartT);
      const y = cSeries.priceToCoordinate(price);
      if (x == null || y == null) return null;
      return { x, y };
    } catch(_) { return null; }
  },

  // Get the clipping rect to exclude price labels on the right
  _getClipRect() {
    if (!lwChart || !cSeries) return null;
    try {
      // Get the width of the time scale area (left side where time labels are)
      const timeScaleW = lwChart.timeScale().width();
      // Get the width of the right price scale (where price labels are drawn)
      const rightPriceScaleW = lwChart.priceScale('right').width();
      // Clip region: from left edge to (width - rightPriceScale width)
      // This ensures bubbles don't draw over the price labels on the right
      const clipWidth = this.canvas.width - rightPriceScaleW;
      if (clipWidth <= 0) return null;
      return { x: 0, y: 0, width: clipWidth, height: this.canvas.height };
    } catch(_) { return null; }
  },

  draw() {
    if (!this.ctx || !this.canvas) return;
    this.sync();
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!bubOn || this.items.length === 0) return;

    // Apply clipping to exclude price label area on the right
    ctx.save();
    const clipRect = this._getClipRect();
    if (clipRect) {
      ctx.beginPath();
      ctx.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);
      ctx.clip();
    }

    this.items.forEach(b => {
      if (b.contracts < agbubMinContracts) { b._x = undefined; return; }

      const pt = this.toXY(b.time, b.ltp);
      if (!pt) { b._x = undefined; return; }
      const { x, y } = pt;

      const r     = this._radius(b.lots);
      const isHov = this.hovered === b;
      const rr    = isHov ? r * 1.35 : r;

      b._x = x; b._y = y; b._r = r;
      if (x + rr < 0 || x - rr > W || y + rr < 0 || y - rr > H) return;

      const isBuy = b.type === 'buy';
      const op    = Math.min(agbubOpacity + (isHov ? 0.15 : 0), 1.0);

      // Flat filled circle
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fillStyle = isBuy
        ? `rgba(255,224,51,${op})`
        : `rgba(255,40,40,${op})`;
      ctx.fill();

      // Thin border ring
      ctx.strokeStyle = isBuy
        ? `rgba(255,200,0,${Math.min(op + 0.15, 1.0)})`
        : `rgba(220,0,0,${Math.min(op + 0.15, 1.0)})`;
      ctx.lineWidth = isHov ? 2 : 1;
      ctx.stroke();

      // Lots text inside larger circles
      if (rr >= 12) {
        ctx.save();
        ctx.font         = `bold ${Math.max(Math.min(rr * 0.55, rr * 0.8), 11)}px "JetBrains Mono", monospace`;
        ctx.fillStyle    = isBuy ? 'rgba(30,20,0,0.95)' : 'rgba(255,220,220,0.95)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.lots >= 1000 ? (b.lots/1000).toFixed(1)+'K' : String(b.lots), x, y);
        ctx.restore();
      }
    });

    // Restore canvas context (clipping removed, context properties restored)
    ctx.restore();
  },

  _onMove(e) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let hit = null;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i];
      if (b._x === undefined) continue;
      const dx = b._x - mx, dy = b._y - my;
      if (Math.sqrt(dx*dx + dy*dy) <= (b._r || 0) + 4) { hit = b; break; }
    }
    this.canvas.style.pointerEvents = hit ? 'all' : 'none';
    this.canvas.style.cursor        = hit ? 'crosshair' : '';
    if (hit !== this.hovered) { this.hovered = hit; this.draw(); }
    if (hit) this._showTip(e, hit);
    else     this._hideTip();
  },

  _onLeave() {
    this.canvas.style.pointerEvents = 'none';
    this.hovered = null;
    this._hideTip();
    this.draw();
  },

  _showTip(e, b) {
    const tip   = document.getElementById('bub-tip');
    const title = document.getElementById('btt-title');
    const body  = document.getElementById('btt-body');
    const isBuy = b.type === 'buy';
    const _d = new Date(b.timeMs);
    // Display in IST
    const istD = new Date(b.timeMs + IST_OFFSET_MS);
    const tstr = String(istD.getUTCHours()).padStart(2,'0') + ':' +
                 String(istD.getUTCMinutes()).padStart(2,'0') + ':' +
                 String(istD.getUTCSeconds()).padStart(2,'0') + ' IST';

    title.innerHTML = isBuy
      ? `<span style="color:var(--yellow)">⚡ Aggressive BUY (LTP ≥ Ask)</span>`
      : `<span style="color:#ff4444">⚡ Aggressive SELL (LTP ≤ Bid)</span>`;
    body.innerHTML =
      `Time &nbsp;&nbsp;&nbsp;: ${tstr}<br>` +
      `LTP &nbsp;&nbsp;&nbsp;&nbsp;: ${fN(b.ltp)}<br>` +
      `Lots &nbsp;&nbsp;&nbsp;&nbsp;: <b style="color:${isBuy?'var(--yellow)':'#ff4444'}">${b.lots}</b> lots (${b.contracts} contracts)<br>` +
      `Type &nbsp;&nbsp;&nbsp;: ${isBuy ? '🟡 Buy Aggressor' : '🔴 Sell Aggressor'}`;
    document.getElementById('bub-hover-info').textContent =
      `⚡ ${tstr} · ${isBuy ? 'Buy' : 'Sell'} · LTP ${fN(b.ltp)} · ${b.lots} lots`;

    tip.style.display     = 'block';
    tip.style.borderColor = isBuy ? 'var(--yellow)' : '#ff4444';
    let tx = e.clientX + 14, ty = e.clientY - 20;
    if (tx + 240 > window.innerWidth)  tx = e.clientX - 250;
    if (ty + 130 > window.innerHeight) ty = e.clientY - 135;
    tip.style.left = tx + 'px';
    tip.style.top  = ty + 'px';
  },

  _hideTip() {
    document.getElementById('bub-tip').style.display = 'none';
    document.getElementById('bub-hover-info').textContent = '';
  },

  clear() {
    this.items   = [];
    this.hovered = null;
    this.prevVtt = null;   // reset vtt diff tracker on symbol switch / reconnect
    this._hideTip();
    if (this.ctx && this.canvas)
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const sb = document.getElementById('s-bubs'); if (sb) sb.textContent = '0';
  },
};

function setLiveMode(live) {
  _atRealTime = live;
}
