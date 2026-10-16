const VP = (() => {
  const VALUE_AREA_FRACTION = 0.70;
  const DEFAULT_BIN_SIZE = 1;
  const DEFAULT_PROFILE_WIDTH = 150;
  let canvas = null;
  let ctx = null;
  let selectionMode = false;
  let dragStart = null;
  let dragCurrent = null;
  let profiles = [];
  let binSize = DEFAULT_BIN_SIZE;
  let profileWidth = DEFAULT_PROFILE_WIDTH;
  let instrumentKey = null;
  let historicalTicks = [];

  function reset() {
    profiles = [];
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
    historicalTicks = [];
    reset();
  }

  function setHistoricalTicks(value, ticks) {
    if (value !== instrumentKey) return;
    historicalTicks = Array.isArray(ticks)
      ? ticks.map(tick => ({
        timestamp: Number(tick.timestamp),
        price: Number(tick.ltp),
        cumulativeVolume: tick.vtt == null ? null : Number(tick.vtt),
        volume: Number(tick.contracts),
      })).filter(tick =>
        Number.isFinite(tick.timestamp) &&
        Number.isFinite(tick.price) && tick.price > 0 &&
        (tick.cumulativeVolume === null || Number.isFinite(tick.cumulativeVolume)) &&
        Number.isFinite(tick.volume) && tick.volume >= 0)
        .sort((a, b) => a.timestamp - b.timestamp)
      : [];
    updateStatus();
  }

  function buildProfile(start, end, rawLevels, tickCount) {
    if (!rawLevels.length) return null;
    const levels = new Map();
    let weightedPriceVolume = 0;
    let totalVolume = 0;
    for (const item of rawLevels) {
      const index = Math.round(item.price / binSize);
      levels.set(index, (levels.get(index) || 0) + item.volume);
      weightedPriceVolume += item.price * item.volume;
      totalVolume += item.volume;
    }
    if (!totalVolume) return null;

    const rows = [...levels]
      .map(([index, volume]) => ({index, price: priceAt(index), volume}))
      .sort((a, b) => a.index - b.index);
    const pocRowIndex = rows.reduce(
      (best, row, index) => row.volume > rows[best].volume ? index : best,
      0,
    );
    let lowIndex = pocRowIndex;
    let highIndex = pocRowIndex;
    let valueAreaVolume = rows[pocRowIndex].volume;
    const targetVolume = totalVolume * VALUE_AREA_FRACTION;
    while (valueAreaVolume < targetVolume &&
           (lowIndex > 0 || highIndex < rows.length - 1)) {
      const below = lowIndex > 0 ? rows[lowIndex - 1].volume : -1;
      const above = highIndex < rows.length - 1 ? rows[highIndex + 1].volume : -1;
      if (above > below) {
        highIndex++;
        valueAreaVolume += rows[highIndex].volume;
      } else {
        lowIndex--;
        valueAreaVolume += rows[lowIndex].volume;
      }
    }

    return {
      start,
      end,
      rawLevels,
      tickCount,
      levels,
      rows,
      totalVolume,
      maxVolume: rows.reduce((maximum, row) => Math.max(maximum, row.volume), 0),
      poc: priceAt(rows[pocRowIndex].index),
      valueAreaLow: rows[lowIndex].price,
      valueAreaHigh: rows[highIndex].price,
      vwap: weightedPriceVolume / totalVolume,
    };
  }

  function requestProfile(start, end, chartStart, chartEnd) {
    if (!instrumentKey) {
      updateStatus('Load a symbol before selecting a historical range');
      return;
    }
    if (!historicalTicks.length) {
      updateStatus('Load chart history with tick data before selecting a range');
      return;
    }

    const startMs = start * 1000;
    const endMs = end * 1000;
    const rawLevels = [];
    let previousVolume = null;
    let previousDay = null;
    let tickCount = 0;
    for (const tick of historicalTicks) {
      const tickDate = new Date(tick.timestamp + IST_OFFSET_MS);
      const tradingDay = `${tickDate.getUTCFullYear()}-${tickDate.getUTCMonth()}-${tickDate.getUTCDate()}`;
      let volume;
      if (tick.cumulativeVolume === null) {
        volume = tick.volume;
        previousVolume = null;
      } else if (tradingDay !== previousDay || previousVolume === null ||
                 tick.cumulativeVolume < previousVolume) {
        volume = 0;
        previousVolume = tick.cumulativeVolume;
      } else {
        volume = tick.cumulativeVolume - previousVolume;
        previousVolume = tick.cumulativeVolume;
      }
      previousDay = tradingDay;

      if (tick.timestamp >= startMs && tick.timestamp <= endMs && volume > 0) {
        rawLevels.push({price: tick.price, volume});
        tickCount++;
      }
    }

    const profile = buildProfile(start, end, rawLevels, tickCount);
    if (!profile) {
      updateStatus('No loaded tick-volume data in selected range');
      return;
    }
    profile.chartStart = chartStart;
    profile.chartEnd = chartEnd;
    profiles.push(profile);
    updateStatus();
    draw();
  }

  function priceAt(index) {
    return Number((index * binSize).toFixed(6));
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

  function updateStatus(message = null) {
    const status = document.getElementById('vp-status');
    if (!status) return;
    if (message) {
      status.textContent = message;
      status.title = message;
      return;
    }
    if (selectionMode) {
      status.textContent = 'Drag across chart to select a historical range';
      status.title = status.textContent;
      return;
    }
    if (!profiles.length) {
      status.textContent = historicalTicks.length
        ? 'Select a chart range to profile loaded historical ticks'
        : 'Load chart history to get historical ticks';
      status.title = status.textContent;
      return;
    }
    const profile = profiles[profiles.length - 1];
    status.textContent =
      `${profiles.length} historical profile${profiles.length === 1 ? '' : 's'} · ` +
      `POC ${formatPrice(profile.poc)} · VWAP ${formatPrice(profile.vwap)}`;
    status.title =
      `${profiles.length} historical profile${profiles.length === 1 ? '' : 's'} · ` +
      `${formatDateTime(profile.start)}–${formatDateTime(profile.end)} · ` +
      `${profile.tickCount.toLocaleString('en-IN')} tick updates · ` +
      `POC ${formatPrice(profile.poc)} · ` +
      `VA ${formatPrice(profile.valueAreaLow)}–${formatPrice(profile.valueAreaHigh)} · ` +
      `VWAP ${formatPrice(profile.vwap)} · Volume ${formatVolume(profile.totalVolume)}`;
  }

  function updateSelectionMode() {
    if (!canvas) return;
    canvas.classList.toggle('selecting', selectionMode);
    const button = document.getElementById('vp-range-btn');
    if (button) {
      button.classList.toggle('active', selectionMode);
      button.textContent = selectionMode ? 'Drag range…' : 'Select Range';
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
    const startChartTime = chartTimeAt(Math.min(dragStart, dragCurrent));
    const endChartTime = chartTimeAt(Math.max(dragStart, dragCurrent));
    const first = startChartTime == null ? null : sourceTimeAt(startChartTime);
    const last = endChartTime == null ? null : sourceTimeAt(endChartTime);
    dragStart = null;
    dragCurrent = null;
    selectionMode = false;
    updateSelectionMode();

    if (first == null || last == null) {
      updateStatus('Could not read selected chart range');
      draw();
      return;
    }
    requestProfile(Math.min(first, last), Math.max(first, last),
      startChartTime, endChartTime);
    draw();
  }

  function drawRangeRectangle(startX, endX, chartStart, chartEnd, preview = false) {
    if (!ctx || !cSeries || !lwChart) return;
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

  function chartPositionForProfile(profile) {
    const startTime = profile.chartStart ?? mapChartTime(profile.start + IST_OFFSET_S);
    const endTime = profile.chartEnd ?? mapChartTime(profile.end + IST_OFFSET_S);
    return {
      startTime,
      endTime,
      startX: lwChart.timeScale().timeToCoordinate(startTime),
      endX: lwChart.timeScale().timeToCoordinate(endTime),
    };
  }

  function drawSavedRange(profile) {
    const position = chartPositionForProfile(profile);
    if (position.startX == null || position.endX == null) return;
    drawRangeRectangle(position.startX, position.endX,
      position.startTime, position.endTime);
  }

  function drawSelection() {
    if (dragStart == null || dragCurrent == null || !ctx) return;
    const startChartTime = chartTimeAt(Math.min(dragStart, dragCurrent));
    const endChartTime = chartTimeAt(Math.max(dragStart, dragCurrent));
    if (startChartTime == null || endChartTime == null) return;
    drawRangeRectangle(dragStart, dragCurrent,
      startChartTime, endChartTime, true);
  }

  function drawProfile(profile) {
    if (!lwChart || !cSeries || !ctx) return;
    const scale = window.devicePixelRatio || 1;
    const plotRight = Math.min(lwChart.timeScale().width(), canvas.clientWidth);
    const position = chartPositionForProfile(profile);
    if (position.startX == null || position.endX == null) return;
    const rangeLeft = Math.max(0,
      Math.min(plotRight, Math.min(position.startX, position.endX)));
    const rangeRight = Math.max(0,
      Math.min(plotRight, Math.max(position.startX, position.endX)));
    const drawnProfileWidth = Math.min(profileWidth, rangeRight - rangeLeft);
    if (drawnProfileWidth < 1) return;
    const barLeft = rangeLeft;
    const barRight = barLeft + drawnProfileWidth;
    const yTop = 0;
    const yBottom = canvas.clientHeight - 22;

    for (const row of profile.rows) {
      const y = cSeries.priceToCoordinate(row.price);
      const yAbove = cSeries.priceToCoordinate(row.price + binSize / 2);
      const yBelow = cSeries.priceToCoordinate(row.price - binSize / 2);
      if (y == null || yAbove == null || yBelow == null ||
          y < yTop - 2 || y > yBottom + 2) continue;
      const height = Math.max(1, Math.abs(yBelow - yAbove));
      const width = drawnProfileWidth * row.volume / profile.maxVolume;
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
      const vwapY = cSeries.priceToCoordinate(profile.vwap);
      if (vwapY != null && vwapY >= yTop && vwapY <= yBottom) {
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.95)';
        ctx.lineWidth = Math.max(1, scale);
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(barLeft, vwapY);
        ctx.lineTo(barRight, vwapY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0, 212, 255, 0.95)';
        ctx.fillText(`VWAP ${formatPrice(profile.vwap)}`, barLeft + 3, vwapY - 2);
      }
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
    selectionMode = false;
    dragStart = null;
    dragCurrent = null;
    updateSelectionMode();
    updateStatus();
    draw();
  }

  function setBinSize(value) {
    const nextSize = Number(value);
    if (![0.05, 0.1, 0.25, 0.5, 1, 2, 5].includes(nextSize)) return;
    binSize = nextSize;
    const input = document.getElementById('vp-bin-size');
    if (input) input.value = String(binSize);
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
    }
    updateStatus();
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
    const binSizeInput = document.getElementById('vp-bin-size');
    if (binSizeInput) binSizeInput.value = String(binSize);
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
    init, reset, setInstrument, setHistoricalTicks,
    startSelection, clear, draw, setBinSize, setWidth,
  };
})();

window.addEventListener('DOMContentLoaded', VP.init);
