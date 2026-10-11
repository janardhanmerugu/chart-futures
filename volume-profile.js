const VP = (() => {
  const MAX_TICKS = 250000;
  const VALUE_AREA_FRACTION = 0.70;
  const DEFAULT_TICK_SIZE = 0.05;
  let canvas = null;
  let ctx = null;
  let ticks = [];
  let seen = new Set();
  let previousVolumeByDay = new Map();
  let selectionMode = false;
  let dragStart = null;
  let dragCurrent = null;
  let profile = null;

  function dateKey(timestamp) {
    const date = new Date(timestamp * 1000 + IST_OFFSET_MS);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function tickIdentity(timestamp, volume, price) {
    return `${timestamp}:${volume ?? ''}:${price}`;
  }

  function exactPriceLevel(price) {
    return Number(price.toFixed(6));
  }

  function priceTickSize(prices) {
    const values = [...new Set(prices.map(price => Math.round(price * 1e6)))].sort((a, b) => a - b);
    let increment = 0;
    for (let index = 1; index < values.length; index++) {
      let difference = values[index] - values[index - 1];
      while (difference) {
        [increment, difference] = [difference, increment % difference];
      }
    }
    const inferred = increment / 1e6;
    return inferred > 0 && inferred <= DEFAULT_TICK_SIZE ? inferred : DEFAULT_TICK_SIZE;
  }

  function addTick(timestamp, price, contracts, vtt) {
    if (!Number.isFinite(timestamp) || !Number.isFinite(price) || price <= 0) return;
    const key = dateKey(timestamp);
    let volume = Number(contracts);
    if (!Number.isFinite(volume)) {
      const currentVtt = Number(vtt);
      const previous = previousVolumeByDay.get(key);
      volume = Number.isFinite(currentVtt) && previous != null && currentVtt >= previous
        ? currentVtt - previous
        : 0;
    }

    const currentVtt = Number(vtt);
    if (Number.isFinite(currentVtt)) previousVolumeByDay.set(key, currentVtt);
    if (volume <= 0) return;

    const identity = tickIdentity(timestamp, Number.isFinite(currentVtt) ? currentVtt : volume, price);
    if (seen.has(identity)) return;
    seen.add(identity);
    ticks.push({time: timestamp, price, volume, identity});
    if (ticks.length > MAX_TICKS) {
      const removed = ticks.shift();
      seen.delete(removed.identity);
    }

    if (profile && timestamp >= profile.start && timestamp <= profile.end) {
      const level = exactPriceLevel(price);
      profile.levels.set(level, (profile.levels.get(level) || 0) + volume);
      profile.tickCount++;
      updateProfileSummary(profile);
      updateStatus();
      draw();
    }
  }

  function setTicks(historyTicks) {
    ticks = [];
    seen = new Set();
    previousVolumeByDay = new Map();
    profile = null;
    selectionMode = false;
    dragStart = null;
    dragCurrent = null;

    for (const tick of historyTicks || []) {
      const timestamp = Number(tick.timestamp) / 1000;
      const price = Number(tick.ltp);
      const contracts = tick.contracts == null ? NaN : Number(tick.contracts);
      addTick(timestamp, price, contracts, tick.vtt);
    }
    updateStatus();
    updateSelectionMode();
    draw();
  }

  function addLiveTick(message) {
    if (!message || message.ltt == null) return;
    addTick(
      Number(message.ltt) / 1000,
      Number(message.ltp),
      NaN,
      message.vtt,
    );
  }

  function buildProfile(start, end) {
    const selected = ticks.filter(tick => tick.time >= start && tick.time <= end);
    if (!selected.length) return null;

    const step = priceTickSize(selected.map(tick => tick.price));
    const levels = new Map();
    for (const tick of selected) {
      const level = exactPriceLevel(tick.price);
      levels.set(level, (levels.get(level) || 0) + tick.volume);
    }

    const result = {
      start,
      end,
      levels,
      step,
      tickCount: selected.length,
      rows: [...levels]
        .map(([price, volume]) => ({price, volume}))
        .sort((a, b) => a.price - b.price),
    };
    updateProfileSummary(result);
    return result;
  }

  function updateProfileSummary(result) {
    result.rows = [...result.levels]
      .map(([price, volume]) => ({price, volume}))
      .sort((a, b) => a.price - b.price);
    const rows = result.rows;
    const totalVolume = rows.reduce((sum, row) => sum + row.volume, 0);
    const pocIndex = rows.reduce(
      (best, row, index) => row.volume > rows[best].volume ? index : best,
      0,
    );
    let valueAreaLow = pocIndex;
    let valueAreaHigh = pocIndex;
    let valueAreaVolume = rows[pocIndex].volume;
    const targetVolume = totalVolume * VALUE_AREA_FRACTION;
    while (valueAreaVolume < targetVolume &&
           (valueAreaLow > 0 || valueAreaHigh < rows.length - 1)) {
      const below = valueAreaLow > 0 ? rows[valueAreaLow - 1].volume : -1;
      const above = valueAreaHigh < rows.length - 1 ? rows[valueAreaHigh + 1].volume : -1;
      if (above > below) {
        valueAreaHigh++;
        valueAreaVolume += rows[valueAreaHigh].volume;
      } else {
        valueAreaLow--;
        valueAreaVolume += rows[valueAreaLow].volume;
      }
    }
    result.totalVolume = totalVolume;
    result.poc = rows[pocIndex].price;
    result.valueAreaLow = rows[valueAreaLow].price;
    result.valueAreaHigh = rows[valueAreaHigh].price;
    result.maxVolume = Math.max(...rows.map(row => row.volume));
  }

  function formatPrice(price) {
    return Number(price).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatVolume(volume) {
    return Math.round(volume).toLocaleString('en-IN');
  }

  function formatDateTime(timestamp) {
    const date = new Date(timestamp * 1000 + IST_OFFSET_MS);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    return `${day}/${month} ${hour}:${minute}`;
  }

  function statusElement() {
    return document.getElementById('vp-status');
  }

  function updateStatus(message = null) {
    const status = statusElement();
    if (!status) return;
    if (message) {
      status.textContent = message;
      status.title = message;
      return;
    }
    if (!profile) {
      status.textContent = selectionMode
        ? 'Drag across chart to select a range'
        : 'Drag across chart to select a range';
      status.title = status.textContent;
      return;
    }
    status.textContent =
      `${formatDateTime(profile.start)}–${formatDateTime(profile.end)} · ` +
      `POC ${formatPrice(profile.poc)} · Vol ${formatVolume(profile.totalVolume)}`;
    status.title =
      `${profile.tickCount.toLocaleString('en-IN')} trades · ` +
      `POC ${formatPrice(profile.poc)} · ` +
      `VA ${formatPrice(profile.valueAreaLow)}–${formatPrice(profile.valueAreaHigh)} · ` +
      `Volume ${formatVolume(profile.totalVolume)}`;
  }

  function updateSelectionMode() {
    if (!canvas) return;
    canvas.classList.toggle('selecting', selectionMode);
    const button = document.getElementById('vp-range-btn');
    if (button) {
      button.classList.toggle('active', selectionMode);
      button.textContent = selectionMode ? 'Drag range…' : 'Volume Profile';
    }
  }

  function pointerX(event) {
    const rect = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  }

  function chartTimeAt(x) {
    if (!lwChart) return null;
    const time = lwChart.timeScale().coordinateToTime(x);
    if (time == null) return null;
    return typeof time === 'number'
      ? time
      : Date.UTC(time.year, time.month - 1, time.day) / 1000;
  }

  function sourceTimeAt(chartTime) {
    return originalChartTime(chartTime) - IST_OFFSET_S;
  }

  function beginDrag(event) {
    if (!selectionMode || event.button !== 0) return;
    event.preventDefault();
    dragStart = pointerX(event);
    dragCurrent = dragStart;
    canvas.setPointerCapture(event.pointerId);
    draw();
  }

  function moveDrag(event) {
    if (dragStart == null) return;
    dragCurrent = pointerX(event);
    draw();
  }

  function finishDrag(event) {
    if (dragStart == null) return;
    dragCurrent = pointerX(event);
    const chartStart = chartTimeAt(Math.min(dragStart, dragCurrent));
    const chartEnd = chartTimeAt(Math.max(dragStart, dragCurrent));
    const first = chartStart == null ? null : sourceTimeAt(chartStart);
    const last = chartEnd == null ? null : sourceTimeAt(chartEnd);
    dragStart = null;
    dragCurrent = null;
    selectionMode = false;
    updateSelectionMode();

    if (first == null || last == null || ticks.length === 0) {
      profile = null;
      updateStatus(ticks.length ? 'Could not read selected chart range' : 'No tick-volume data loaded');
      draw();
      return;
    }
    profile = buildProfile(Math.min(first, last), Math.max(first, last));
    if (!profile) {
      updateStatus('No tick-volume data in selected range');
      draw();
      return;
    }
    profile.chartStart = chartStart;
    profile.chartEnd = chartEnd;
    updateStatus();
    draw();
  }

  function drawSelection() {
    if (dragStart == null || dragCurrent == null || !ctx) return;
    const left = Math.min(dragStart, dragCurrent);
    const width = Math.abs(dragCurrent - dragStart);
    ctx.fillStyle = 'rgba(0, 212, 255, 0.10)';
    ctx.fillRect(left, 0, width, canvas.height);
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.85)';
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(left, 0, width, canvas.height);
    ctx.setLineDash([]);
  }

  function drawProfile() {
    if (!profile || !lwChart || !cSeries || !ctx) return;
    const scale = window.devicePixelRatio || 1;
    const plotRight = Math.min(lwChart.timeScale().width(), canvas.clientWidth);
    const startChartTime = profile.chartStart ?? mapChartTime(profile.start + IST_OFFSET_S);
    const endChartTime = profile.chartEnd ?? mapChartTime(profile.end + IST_OFFSET_S);
    const startX = lwChart.timeScale().timeToCoordinate(startChartTime);
    const endX = lwChart.timeScale().timeToCoordinate(endChartTime);
    if (startX == null || endX == null) return;
    const rangeLeft = Math.max(0, Math.min(plotRight, Math.min(startX, endX)));
    const rangeRight = Math.max(0, Math.min(plotRight, Math.max(startX, endX)));
    const profileWidth = Math.min(150, (rangeRight - rangeLeft) * 0.3);
    if (profileWidth < 1) return;
    const barLeft = rangeLeft;
    const barRight = barLeft + profileWidth;
    const yTop = 0;
    const yBottom = canvas.clientHeight - 22;

    for (const row of profile.rows) {
      const y = cSeries.priceToCoordinate(row.price);
      const yAbove = cSeries.priceToCoordinate(row.price + profile.step / 2);
      const yBelow = cSeries.priceToCoordinate(row.price - profile.step / 2);
      if (y == null || y < yTop - 2 || y > yBottom + 2) continue;
      const height = Math.max(1, Math.abs((yBelow ?? y) - (yAbove ?? y)));
      const width = Math.max(1, profileWidth * row.volume / profile.maxVolume);
      const inValueArea = row.price >= profile.valueAreaLow &&
        row.price <= profile.valueAreaHigh;
      ctx.fillStyle = inValueArea ? 'rgba(0, 212, 255, 0.24)' : 'rgba(90, 122, 154, 0.18)';
      ctx.fillRect(barLeft, y - height / 2, width, height);
    }

    for (const price of [profile.valueAreaLow, profile.valueAreaHigh]) {
      if (price === profile.poc) continue;
      const y = cSeries.priceToCoordinate(price);
      if (y == null || y < yTop || y > yBottom) continue;
      ctx.strokeStyle = 'rgba(0, 230, 118, 0.75)';
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.moveTo(barLeft, y);
      ctx.lineTo(barRight, y);
      ctx.stroke();
    }

    const pocY = cSeries.priceToCoordinate(profile.poc);
    if (pocY != null && pocY >= yTop && pocY <= yBottom) {
      ctx.strokeStyle = 'rgba(255, 224, 51, 0.95)';
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.moveTo(barLeft, pocY);
      ctx.lineTo(barRight, pocY);
      ctx.stroke();
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffe033';
      ctx.fillText(`POC ${formatPrice(profile.poc)}`, barLeft + 3, pocY - 2);
    }
  }

  function draw() {
    if (!canvas || !ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * scale) ||
        canvas.height !== Math.round(height * scale)) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawProfile();
    drawSelection();
  }

  function startSelection() {
    if (!lwChart || !cSeries) {
      updateStatus('Load a chart before selecting a range');
      return;
    }
    setLiveMode(false);
    selectionMode = true;
    profile = null;
    updateSelectionMode();
    updateStatus();
    draw();
  }

  function clear() {
    profile = null;
    selectionMode = false;
    dragStart = null;
    dragCurrent = null;
    updateSelectionMode();
    updateStatus();
    draw();
  }

  function init() {
    canvas = document.getElementById('vp-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', beginDrag);
    canvas.addEventListener('pointermove', moveDrag);
    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', finishDrag);
    window.addEventListener('resize', draw);
    draw();
  }

  return {init, setTicks, addLiveTick, startSelection, clear, draw};
})();

window.addEventListener('DOMContentLoaded', VP.init);
