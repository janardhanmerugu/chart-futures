const VP = (() => {
  const VALUE_AREA_FRACTION = 0.70;
  const DEFAULT_BIN_SIZE = 1;
  const DEFAULT_PROFILE_WIDTH = 150;
  const DELTA_COLUMN_MAX_WIDTH = 64;
  let canvas = null;
  let ctx = null;
  let selectionMode = false;
  let dragStart = null;
  let dragCurrent = null;
  let deselectTimer = null;
  let profiles = [];
  let selectedProfileId = null;
  let nextProfileId = 1;
  let binSize = DEFAULT_BIN_SIZE;
  let profileWidth = DEFAULT_PROFILE_WIDTH;
  let showDelta = true;
  let instrumentKey = null;
  let historicalTicks = [];
  let pendingRequests = new Map();
  let nextRequestId = 1;

  function reset() {
    if (deselectTimer !== null) {
      clearTimeout(deselectTimer);
      deselectTimer = null;
    }
    profiles = [];
    pendingRequests.clear();
    selectedProfileId = null;
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
      const level = levels.get(index) || {volume: 0, bidVolume: 0, askVolume: 0};
      level.volume += item.volume;
      level.bidVolume += item.bidVolume;
      level.askVolume += item.askVolume;
      levels.set(index, level);
      weightedPriceVolume += item.price * item.volume;
      totalVolume += item.volume;
    }
    if (!totalVolume) return null;

    const rows = [...levels]
      .map(([index, level]) => ({
        index,
        price: priceAt(index),
        volume: level.volume,
        bidVolume: level.bidVolume,
        askVolume: level.askVolume,
        delta: level.askVolume - level.bidVolume,
      }))
      .sort((a, b) => a.index - b.index);
    const pocRowIndex = rows.reduce(
      (best, row, index) => row.volume > rows[best].volume ? index : best,
      0,
    );
    let lowIndex = rows[pocRowIndex].index;
    let highIndex = rows[pocRowIndex].index;
    let valueAreaVolume = rows[pocRowIndex].volume;
    const minIndex = rows[0].index;
    const maxIndex = rows[rows.length - 1].index;
    const targetVolume = totalVolume * VALUE_AREA_FRACTION;
    while (valueAreaVolume < targetVolume &&
           (lowIndex > minIndex || highIndex < maxIndex)) {
      const below = lowIndex > minIndex ? levels.get(lowIndex - 1)?.volume || 0 : -1;
      const above = highIndex < maxIndex ? levels.get(highIndex + 1)?.volume || 0 : -1;
      if (above > below) {
        highIndex++;
        valueAreaVolume += levels.get(highIndex)?.volume || 0;
      } else {
        lowIndex--;
        valueAreaVolume += levels.get(lowIndex)?.volume || 0;
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
      maxAbsDelta: rows.reduce((maximum, row) => Math.max(maximum, Math.abs(row.delta)), 0),
      poc: priceAt(rows[pocRowIndex].index),
      valueAreaLow: priceAt(lowIndex),
      valueAreaHigh: priceAt(highIndex),
      vwap: weightedPriceVolume / totalVolume,
    };
  }

  function applyDeltaLevels(profile, deltaLevels) {
    const sidesByBin = new Map();
    for (const level of deltaLevels) {
      const index = Math.round(level.price / binSize);
      const sides = sidesByBin.get(index) || {bidVolume: 0, askVolume: 0};
      sides.bidVolume += level.bidVolume;
      sides.askVolume += level.askVolume;
      sidesByBin.set(index, sides);
    }
    for (const row of profile.rows) {
      const sides = sidesByBin.get(row.index);
      if (!sides) continue;
      row.bidVolume = sides.bidVolume;
      row.askVolume = sides.askVolume;
      row.delta = sides.askVolume - sides.bidVolume;
    }
    profile.maxAbsDelta = profile.rows.reduce(
      (maximum, row) => Math.max(maximum, Math.abs(row.delta)), 0,
    );
    profile.deltaLevels = deltaLevels;
    return profile;
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
        volume = tick.volume;
        previousVolume = tick.cumulativeVolume;
      } else {
        volume = tick.cumulativeVolume - previousVolume;
        previousVolume = tick.cumulativeVolume;
      }
      previousDay = tradingDay;

      if (tick.timestamp >= startMs && tick.timestamp <= endMs && volume > 0) {
        rawLevels.push({
          price: tick.price,
          volume,
          bidVolume: 0,
          askVolume: 0,
        });
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
    profile.id = nextProfileId++;
    profile.deltaReady = false;
    profiles.push(profile);
    draw();

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      updateStatus('Volume profile loaded locally; connect to load estimated delta');
      return;
    }
    const requestId = `vp-${Date.now()}-${nextRequestId++}`;
    pendingRequests.set(requestId, {instrumentKey, profileId: profile.id});
    updateStatus('Volume profile loaded locally; loading estimated delta…');
    ws.send(JSON.stringify({
      type: 'load_volume_profile',
      request_id: requestId,
      instrument: instrumentKey,
      start_time_ms: Math.round(startMs),
      end_time_ms: Math.round(endMs),
    }));
  }

  function handleProfileData(message) {
    const request = pendingRequests.get(message.request_id);
    if (!request) return;
    pendingRequests.delete(message.request_id);
    if (request.instrumentKey !== instrumentKey || message.instrument !== instrumentKey) return;

    const currentProfile = profiles.find(profile => profile.id === request.profileId);
    if (!currentProfile) return;
    const sideVolumes = new Map();
    for (const level of Array.isArray(message.levels) ? message.levels : []) {
      const price = Number(level.price);
      const bidVolume = Number(level.bid_volume);
      const askVolume = Number(level.ask_volume);
      if (!Number.isFinite(price) ||
          !Number.isFinite(bidVolume) || bidVolume < 0 ||
          !Number.isFinite(askVolume) || askVolume < 0) continue;
      sideVolumes.set(price, {bidVolume, askVolume});
    }
    const deltaLevels = [...sideVolumes].map(([price, sides]) => ({
      price,
      ...sides,
    }));
    const updatedProfile = buildProfile(
      currentProfile.start,
      currentProfile.end,
      currentProfile.rawLevels,
      currentProfile.tickCount,
    );
    if (!updatedProfile) return;
    applyDeltaLevels(updatedProfile, deltaLevels);
    updatedProfile.chartStart = currentProfile.chartStart;
    updatedProfile.chartEnd = currentProfile.chartEnd;
    updatedProfile.id = currentProfile.id;
    updatedProfile.deltaReady = true;
    profiles = profiles.map(profile =>
      profile.id === request.profileId ? updatedProfile : profile);
    updateStatus();
    draw();
  }

  function handleProfileError(message) {
    const request = pendingRequests.get(message.request_id);
    if (!request) return;
    pendingRequests.delete(message.request_id);
    const profile = profiles.find(item => item.id === request.profileId);
    if (profile) profile.deltaError = message.message || 'Could not load historical delta';
    updateStatus(profile?.deltaError || 'Could not load historical delta');
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
        ? 'Select a chart range to load estimated historical delta'
        : 'Load chart history to get historical ticks';
      status.title = status.textContent;
      return;
    }
    const profile = profiles[profiles.length - 1];
    const selectedProfile = profiles.find(item => item.id === selectedProfileId);
    const statusProfile = selectedProfile || profile;
    status.textContent =
      `${selectedProfile ? 'Selected profile · ' : ''}` +
      `${profiles.length} historical profile${profiles.length === 1 ? '' : 's'} · ` +
      `POC ${formatPrice(statusProfile.poc)} · VWAP ${formatPrice(statusProfile.vwap)} · ` +
      `${statusProfile.deltaReady ? 'Estimated Δ' : 'Δ pending'} · ` +
      'double-click to select; click to deselect; D to delete';
    status.title =
      `${profiles.length} historical profile${profiles.length === 1 ? '' : 's'} · ` +
      `${formatDateTime(statusProfile.start)}–${formatDateTime(statusProfile.end)} · ` +
      `${statusProfile.tickCount.toLocaleString('en-IN')} tick updates · ` +
      `POC ${formatPrice(statusProfile.poc)} · ` +
      `VA ${formatPrice(statusProfile.valueAreaLow)}–${formatPrice(statusProfile.valueAreaHigh)} · ` +
      `VWAP ${formatPrice(statusProfile.vwap)} · Volume ${formatVolume(statusProfile.totalVolume)} · ` +
      `Estimated delta range ${formatVolume(statusProfile.maxAbsDelta)}`;
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

  function selectProfileAt(event) {
    if (deselectTimer !== null) {
      clearTimeout(deselectTimer);
      deselectTimer = null;
    }
    const rect = canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) return;
    const x = event.clientX - rect.left;
    for (let index = profiles.length - 1; index >= 0; index--) {
      const profile = profiles[index];
      const {startX, endX} = chartPositionForProfile(profile);
      if (startX == null || endX == null) continue;
      if (x >= Math.min(startX, endX) && x <= Math.max(startX, endX)) {
        selectedProfileId = profile.id;
        updateStatus();
        draw();
        return;
      }
    }
  }

  function deselectProfileOnClick(event) {
    if (event.detail !== 1 || selectedProfileId === null) return;
    if (deselectTimer !== null) clearTimeout(deselectTimer);
    deselectTimer = setTimeout(() => {
      deselectTimer = null;
      selectedProfileId = null;
      updateStatus();
      draw();
    }, 350);
  }

  function drawRangeRectangle(startX, endX, chartStart, chartEnd, preview = false,
                              selected = false) {
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
    if (!selected) {
      ctx.fillStyle = preview ? 'rgba(0, 212, 255, 0.10)' : 'rgba(0, 212, 255, 0.045)';
      ctx.fillRect(left, top, width, bottom - top);
    }
    ctx.strokeStyle = selected ? 'rgba(255, 255, 255, 0.95)' :
      preview ? 'rgba(0, 212, 255, 0.9)' : 'rgba(0, 212, 255, 0.55)';
    ctx.lineWidth = selected ? 2 : preview ? 1.5 : 1;
    ctx.setLineDash(selected ? [6, 4] : preview ? [5, 4] : []);
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

  function drawSelectedRange() {
    const profile = profiles.find(item => item.id === selectedProfileId);
    if (!profile) return;
    const position = chartPositionForProfile(profile);
    if (position.startX == null || position.endX == null) return;
    drawRangeRectangle(position.startX, position.endX,
      position.startTime, position.endTime, false, true);
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
    const rangeWidth = rangeRight - rangeLeft;
    const deltaColumnWidth = showDelta
      ? Math.min(DELTA_COLUMN_MAX_WIDTH, rangeWidth * 0.3)
      : 0;
    const drawnProfileWidth = Math.min(profileWidth, rangeWidth - deltaColumnWidth);
    if (drawnProfileWidth < 1) return;
    const barLeft = rangeLeft + deltaColumnWidth;
    const barRight = barLeft + drawnProfileWidth;
    const yTop = 0;
    const yBottom = canvas.clientHeight - 22;
    const deltaBaselineX = rangeLeft + deltaColumnWidth;
    const deltaMaxWidth = deltaColumnWidth - 4;

    if (showDelta) {
      ctx.strokeStyle = 'rgba(190, 205, 220, 0.42)';
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.moveTo(deltaBaselineX, yTop);
      ctx.lineTo(deltaBaselineX, yBottom);
      ctx.stroke();
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(190, 205, 220, 0.8)';
      ctx.fillText('Δ', rangeLeft + deltaColumnWidth / 2, yTop + 2);
    }

    for (const row of profile.rows) {
      const y = cSeries.priceToCoordinate(row.price);
      const yAbove = cSeries.priceToCoordinate(row.price + binSize / 2);
      const yBelow = cSeries.priceToCoordinate(row.price - binSize / 2);
      if (y == null || yAbove == null || yBelow == null ||
          y < yTop - 2 || y > yBottom + 2) continue;
      const height = Math.max(1, Math.abs(yBelow - yAbove));
      if (showDelta && profile.maxAbsDelta > 0 &&
          deltaMaxWidth > 0 && row.delta !== 0) {
        const deltaWidth = deltaMaxWidth * Math.abs(row.delta) / profile.maxAbsDelta;
        ctx.fillStyle = row.delta > 0
          ? 'rgba(0, 220, 130, 0.9)'
          : 'rgba(255, 61, 90, 0.9)';
        ctx.fillRect(
          deltaBaselineX - deltaWidth,
          y - height / 2,
          deltaWidth,
          height,
        );
      }
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
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = Math.max(1, scale);
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(barLeft, vwapY);
        ctx.lineTo(barRight, vwapY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
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
    drawSelectedRange();
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
    if (deselectTimer !== null) {
      clearTimeout(deselectTimer);
      deselectTimer = null;
    }
    profiles = [];
    pendingRequests.clear();
    selectedProfileId = null;
    selectionMode = false;
    dragStart = null;
    dragCurrent = null;
    updateSelectionMode();
    updateStatus();
    draw();
  }

  function deleteSelectedProfile() {
    if (selectedProfileId === null) return;
    profiles = profiles.filter(profile => profile.id !== selectedProfileId);
    selectedProfileId = null;
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
          if (profile.deltaReady && profile.deltaLevels) {
            applyDeltaLevels(updated, profile.deltaLevels);
          }
          updated.chartStart = profile.chartStart;
          updated.chartEnd = profile.chartEnd;
          updated.id = profile.id;
          updated.deltaReady = profile.deltaReady;
          updated.deltaError = profile.deltaError;
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

  function setShowDelta(value) {
    showDelta = Boolean(value);
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
    const deltaInput = document.getElementById('vp-show-delta');
    if (deltaInput) showDelta = deltaInput.checked;
    setWidth(profileWidth);
    canvas.addEventListener('pointerdown', beginDrag);
    canvas.addEventListener('pointermove', moveDrag);
    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', finishDrag);
    const chart = document.getElementById('chart-con');
    if (chart) {
      chart.addEventListener('click', deselectProfileOnClick);
      chart.addEventListener('dblclick', selectProfileAt);
    }
    document.addEventListener('keydown', event => {
      const target = event.target;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
          (target && (target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))) return;
      if (event.key.toLowerCase() === 'q') {
        event.preventDefault();
        startSelection();
      } else if (event.key.toLowerCase() === 'd' &&
                 profiles.some(profile => profile.id === selectedProfileId)) {
        event.preventDefault();
        deleteSelectedProfile();
      }
    });
    window.addEventListener('resize', draw);
    draw();
  }

  return {
    init, reset, setInstrument, setHistoricalTicks, handleProfileData, handleProfileError,
    startSelection, clear, draw, setBinSize, setWidth, setShowDelta,
  };
})();

window.addEventListener('DOMContentLoaded', VP.init);
