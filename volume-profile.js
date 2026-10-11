const VP = (() => {
  const VALUE_AREA_FRACTION = 0.70;
  const DEFAULT_TICK_SIZE = 0.05;
  const DEFAULT_GROUPING = 1;
  const DEFAULT_PROFILE_WIDTH = 150;
  let canvas = null;
  let ctx = null;
  let selectionMode = false;
  let dragStart = null;
  let dragCurrent = null;
  let profiles = [];
  let grouping = DEFAULT_GROUPING;
  let profileWidth = DEFAULT_PROFILE_WIDTH;
  let instrumentKey = null;
  let nextRequestId = 1;
  const pendingRequests = new Map();

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

  function reset() {
    profiles = [];
    pendingRequests.clear();
    selectionMode = false;
    dragStart = null;
    dragCurrent = null;
    updateStatus();
    updateSelectionMode();
    draw();
  }

  function setInstrument(value) {
    const nextInstrumentKey = typeof value === 'string' ? value.trim() : '';
    if (instrumentKey === nextInstrumentKey) return;
    instrumentKey = nextInstrumentKey || null;
    reset();
  }

  function buildProfile(start, end, rawLevels, tickCount) {
    if (!rawLevels.length) return null;
    const step = priceTickSize(rawLevels.map(level => level.price)) * grouping;
    const levels = new Map();
    for (const item of rawLevels) {
      const level = groupedPriceLevel(item.price, step);
      levels.set(level, (levels.get(level) || 0) + item.volume);
    }

    const result = {
      start,
      end,
      rawLevels,
      levels,
      step,
      tickCount,
      rows: [...levels]
        .map(([price, volume]) => ({price, volume}))
        .sort((a, b) => a.price - b.price),
    };
    updateProfileSummary(result);
    return result;
  }

  function requestProfile(start, end, chartStart, chartEnd) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      updateStatus('Cannot load profile: server is disconnected');
      return;
    }
    const requestId = String(nextRequestId++);
    pendingRequests.set(requestId, {chartStart, chartEnd});
    updateStatus('Loading selected range from historical tick data…');
    ws.send(JSON.stringify({
      type: 'load_volume_profile',
      request_id: requestId,
      instrument: instrumentKey,
      start_time_ms: Math.floor(start * 1000),
      end_time_ms: Math.ceil(end * 1000),
    }));
  }

  function receiveProfileData(message) {
    const pending = pendingRequests.get(String(message.request_id));
    if (!pending) return;
    pendingRequests.delete(String(message.request_id));
    if (message.instrument !== instrumentKey) return;

    const levels = Array.isArray(message.levels)
      ? message.levels.map(level => ({
        price: Number(level.price),
        volume: Number(level.volume),
      })).filter(level =>
        Number.isFinite(level.price) && level.price > 0 &&
        Number.isFinite(level.volume) && level.volume > 0)
      : [];
    const profile = buildProfile(
      Number(message.start_time_ms) / 1000,
      Number(message.end_time_ms) / 1000,
      levels,
      Number(message.tick_count) || 0,
    );
    if (!profile) {
      updateStatus('No historical tick-volume data in selected range');
      return;
    }
    profile.chartStart = pending.chartStart;
    profile.chartEnd = pending.chartEnd;
    profiles.push(profile);
    updateStatus();
    draw();
  }

  function receiveProfileError(message) {
    const requestId = String(message.request_id);
    if (!pendingRequests.has(requestId)) return;
    pendingRequests.delete(requestId);
    updateStatus(`Volume profile failed: ${message.message || 'server error'}`);
  }

  function groupedPriceLevel(price, step) {
    return exactPriceLevel(Math.round(price / step) * step);
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
    if (selectionMode) {
      status.textContent = 'Drag across chart to select a range';
      status.title = status.textContent;
      return;
    }
    if (!profiles.length) {
      status.textContent = 'Drag across chart to select a range';
      status.title = status.textContent;
      return;
    }
    const profile = profiles[profiles.length - 1];
    status.textContent =
      `${profiles.length} profile${profiles.length === 1 ? '' : 's'} · ` +
      `${formatDateTime(profile.start)}–${formatDateTime(profile.end)} · ` +
      `POC ${formatPrice(profile.poc)} · Vol ${formatVolume(profile.totalVolume)}`;
    status.title =
      `${profiles.length} profile${profiles.length === 1 ? '' : 's'} · ` +
      `${profile.tickCount.toLocaleString('en-IN')} tick updates · ` +
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

    if (first == null || last == null) {
      updateStatus('Could not read selected chart range');
      draw();
      return;
    }
    requestProfile(Math.min(first, last), Math.max(first, last), chartStart, chartEnd);
  }

  function drawRangeRectangle(startX, endX, chartStart, chartEnd, preview = false) {
    if (!ctx || !cSeries) return;
    const plotRight = Math.min(lwChart.timeScale().width(), canvas.clientWidth);
    const left = Math.max(0, Math.min(plotRight, Math.min(startX, endX)));
    const right = Math.max(0, Math.min(plotRight, Math.max(startX, endX)));
    const width = right - left;
    if (width < 1) return;
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (const candle of cData) {
      if (candle.open == null || candle.time < chartStart || candle.time > chartEnd) continue;
      minPrice = Math.min(minPrice, candle.low);
      maxPrice = Math.max(maxPrice, candle.high);
    }
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return;
    const plotBottom = canvas.clientHeight - 22;
    const highY = cSeries.priceToCoordinate(maxPrice);
    const lowY = cSeries.priceToCoordinate(minPrice);
    if (highY == null || lowY == null) return;
    const top = Math.max(0, Math.min(plotBottom, highY));
    const bottom = Math.max(0, Math.min(plotBottom, lowY));
    if (bottom - top < 1) return;
    ctx.fillStyle = preview ? 'rgba(0, 212, 255, 0.10)' : 'rgba(0, 212, 255, 0.045)';
    ctx.fillRect(left, top, width, bottom - top);
    ctx.strokeStyle = preview ? 'rgba(0, 212, 255, 0.9)' : 'rgba(0, 212, 255, 0.55)';
    ctx.lineWidth = preview ? 1.5 : 1;
    ctx.setLineDash(preview ? [5, 4] : []);
    ctx.strokeRect(left, top, width, bottom - top);
    ctx.setLineDash([]);
  }

  function drawSavedRange(profile) {
    if (!lwChart) return;
    const startChartTime = profile.chartStart ?? mapChartTime(profile.start + IST_OFFSET_S);
    const endChartTime = profile.chartEnd ?? mapChartTime(profile.end + IST_OFFSET_S);
    const startX = lwChart.timeScale().timeToCoordinate(startChartTime);
    const endX = lwChart.timeScale().timeToCoordinate(endChartTime);
    if (startX == null || endX == null) return;
    drawRangeRectangle(startX, endX, startChartTime, endChartTime);
  }

  function drawSelection() {
    if (dragStart == null || dragCurrent == null || !ctx) return;
    const startChartTime = chartTimeAt(Math.min(dragStart, dragCurrent));
    const endChartTime = chartTimeAt(Math.max(dragStart, dragCurrent));
    if (startChartTime == null || endChartTime == null) return;
    drawRangeRectangle(dragStart, dragCurrent, startChartTime, endChartTime, true);
  }

  function drawProfile(profile) {
    if (!lwChart || !cSeries || !ctx) return;
    const scale = window.devicePixelRatio || 1;
    const plotRight = Math.min(lwChart.timeScale().width(), canvas.clientWidth);
    const startChartTime = profile.chartStart ?? mapChartTime(profile.start + IST_OFFSET_S);
    const endChartTime = profile.chartEnd ?? mapChartTime(profile.end + IST_OFFSET_S);
    const startX = lwChart.timeScale().timeToCoordinate(startChartTime);
    const endX = lwChart.timeScale().timeToCoordinate(endChartTime);
    if (startX == null || endX == null) return;
    const rangeLeft = Math.max(0, Math.min(plotRight, Math.min(startX, endX)));
    const rangeRight = Math.max(0, Math.min(plotRight, Math.max(startX, endX)));
    const drawnProfileWidth = Math.min(profileWidth, rangeRight - rangeLeft);
    if (drawnProfileWidth < 1) return;
    const barLeft = rangeLeft;
    const barRight = barLeft + drawnProfileWidth;
    const yTop = 0;
    const yBottom = canvas.clientHeight - 22;

    for (const row of profile.rows) {
      const y = cSeries.priceToCoordinate(row.price);
      const yAbove = cSeries.priceToCoordinate(row.price + profile.step / 2);
      const yBelow = cSeries.priceToCoordinate(row.price - profile.step / 2);
      if (y == null || y < yTop - 2 || y > yBottom + 2) continue;
      const height = Math.max(3, Math.abs((yBelow ?? y) - (yAbove ?? y)));
      const width = Math.max(1, drawnProfileWidth * row.volume / profile.maxVolume);
      const inValueArea = row.price >= profile.valueAreaLow &&
        row.price <= profile.valueAreaHigh;
      ctx.fillStyle = inValueArea ? 'rgba(255, 145, 0, 0.92)' : 'rgba(66, 165, 245, 0.88)';
      ctx.fillRect(barLeft, y - height / 2, width, height);
    }

    for (const price of [profile.valueAreaLow, profile.valueAreaHigh]) {
      if (price === profile.poc) continue;
      const y = cSeries.priceToCoordinate(price);
      if (y == null || y < yTop || y > yBottom) continue;
      ctx.strokeStyle = 'rgba(255, 183, 77, 0.95)';
      ctx.lineWidth = Math.max(1.5, scale);
      ctx.beginPath();
      ctx.moveTo(barLeft, y);
      ctx.lineTo(barRight, y);
      ctx.stroke();
    }

    const pocY = cSeries.priceToCoordinate(profile.poc);
    if (pocY != null && pocY >= yTop && pocY <= yBottom) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
      ctx.lineWidth = Math.max(2, scale * 1.5);
      ctx.beginPath();
      ctx.moveTo(barLeft, pocY);
      ctx.lineTo(barRight, pocY);
      ctx.stroke();
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffffff';
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
    profiles.forEach(drawSavedRange);
    profiles.forEach(drawProfile);
    drawSelection();
  }

  function startSelection() {
    if (!lwChart || !cSeries) {
      updateStatus('Load a chart before selecting a range');
      return;
    }
    setLiveMode(false);
    selectionMode = true;
    updateSelectionMode();
    updateStatus();
    draw();
  }

  function clear() {
    profiles = [];
    pendingRequests.clear();
    selectionMode = false;
    dragStart = null;
    dragCurrent = null;
    updateSelectionMode();
    updateStatus();
    draw();
  }

  function setGrouping(value) {
    const nextGrouping = Number(value);
    if (![1, 2, 5, 10].includes(nextGrouping)) return;
    grouping = nextGrouping;
    if (profiles.length) {
      profiles = profiles.map(profile => {
        const updated = buildProfile(
          profile.start,
          profile.end,
          profile.rawLevels,
          profile.tickCount,
        );
        if (updated) {
          updated.chartStart = profile.chartStart;
          updated.chartEnd = profile.chartEnd;
        }
        return updated;
      }).filter(Boolean);
      updateStatus(profiles.length ? null : 'No tick-volume data in selected ranges');
    }
    draw();
  }

  function setWidth(value) {
    const nextWidth = Number(value);
    if (!Number.isFinite(nextWidth)) return;
    profileWidth = Math.max(60, Math.min(280, nextWidth));
    const output = document.getElementById('vp-width-value');
    if (output) output.textContent = `${profileWidth} px`;
    draw();
  }

  function init() {
    canvas = document.getElementById('vp-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    const groupingInput = document.getElementById('vp-grouping');
    if (groupingInput) groupingInput.value = String(grouping);
    const widthInput = document.getElementById('vp-width');
    if (widthInput) widthInput.value = String(profileWidth);
    setWidth(profileWidth);
    canvas.addEventListener('pointerdown', beginDrag);
    canvas.addEventListener('pointermove', moveDrag);
    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', finishDrag);
    window.addEventListener('resize', draw);
    draw();
  }

  return {
    init, reset, setInstrument, receiveProfileData, receiveProfileError,
    startSelection, clear, draw, setGrouping, setWidth,
  };
})();

window.addEventListener('DOMContentLoaded', VP.init);
