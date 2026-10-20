const RD = (() => {
  let canvas = null;
  let ctx = null;
  let drawingMode = null;
  let dragStart = null;
  let dragCurrent = null;
  let rectangles = [];
  let trendLines = [];
  let selectedRectangleId = null;
  let selectedTrendLineId = null;
  let nextRectangleId = 1;
  let nextTrendLineId = 1;
  let selectedColor = '#ff3d5a';
  let suppressNextClick = false;

  function chartLogicalAt(x) {
    if (!lwChart) return null;
    const logical = lwChart.timeScale().coordinateToLogical(x);
    return typeof logical === 'number' && Number.isFinite(logical) ? logical : null;
  }

  function priceAt(y) {
    if (!cSeries) return null;
    const price = cSeries.coordinateToPrice(y);
    return price == null ? null : price;
  }

  function chartPointAt(x, y) {
    const logical = chartLogicalAt(x);
    const price = priceAt(y);
    if (logical == null || price == null) return null;
    return {logical, price};
  }

  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const plotRight = Math.min(lwChart.timeScale().width(), rect.width);
    const plotBottom = Math.max(0, rect.height - 22);
    const x = Math.max(0, Math.min(plotRight, event.clientX - rect.left));
    const y = Math.max(0, Math.min(plotBottom, event.clientY - rect.top));
    const chartPoint = chartPointAt(x, y);
    return chartPoint ? {x, y, ...chartPoint} : null;
  }

  function rectangleBounds(rectangle) {
    if (!lwChart || !cSeries) return null;
    const timeScale = lwChart.timeScale();
    const startX = timeScale.logicalToCoordinate(rectangle.startLogical);
    const endX = timeScale.logicalToCoordinate(rectangle.endLogical);
    const startY = cSeries.priceToCoordinate(rectangle.startPrice);
    const endY = cSeries.priceToCoordinate(rectangle.endPrice);
    if (startX == null || endX == null || startY == null || endY == null) return null;

    const left = Math.max(0, Math.min(lwChart.timeScale().width(), Math.min(startX, endX)));
    const right = Math.max(0, Math.min(lwChart.timeScale().width(), Math.max(startX, endX)));
    const top = Math.max(0, Math.min(canvas.clientHeight - 22, Math.min(startY, endY)));
    const bottom = Math.max(0, Math.min(canvas.clientHeight - 22, Math.max(startY, endY)));
    const width = right - left;
    const height = bottom - top;
    if (width < 1 || height < 1) return null;
    return {left, right, top, bottom, width, height};
  }

  function trendLinePoints(line) {
    if (!lwChart || !cSeries) return null;
    const timeScale = lwChart.timeScale();
    const startX = timeScale.logicalToCoordinate(line.startLogical);
    const endX = timeScale.logicalToCoordinate(line.endLogical);
    const startY = cSeries.priceToCoordinate(line.startPrice);
    const endY = cSeries.priceToCoordinate(line.endPrice);
    if ([startX, endX, startY, endY].some(value => value == null || !Number.isFinite(value)))
      return null;
    return {startX, startY, endX, endY};
  }

  function drawTrendLine(line, preview = false, selected = false) {
    if (!ctx) return;
    const points = trendLinePoints(line);
    if (!points) return;
    ctx.beginPath();
    ctx.moveTo(points.startX, points.startY);
    ctx.lineTo(points.endX, points.endY);
    ctx.strokeStyle = selected ? '#ffffff' : preview ? '#00d4ff' : '#ffe033';
    ctx.lineWidth = selected ? 2.5 : 2;
    ctx.setLineDash(preview ? [5, 4] : selected ? [6, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y] of [[points.startX, points.startY], [points.endX, points.endY]]) {
      ctx.beginPath();
      ctx.arc(x, y, selected ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#ffffff' : preview ? '#00d4ff' : '#ffe033';
      ctx.fill();
    }
  }

  function drawRectangle(rectangle, preview = false, selected = false) {
    if (!ctx) return;
    const bounds = rectangleBounds(rectangle);
    if (!bounds) return;
    const color = rectangle.color || selectedColor;
    const colors = color === '#00e676'
      ? {fill: 'rgba(0, 230, 118, 0.12)', stroke: 'rgba(0, 230, 118, 0.85)'}
      : {fill: 'rgba(255, 61, 90, 0.12)', stroke: 'rgba(255, 61, 90, 0.85)'};
    ctx.fillStyle = colors.fill;
    ctx.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
    ctx.strokeStyle = selected ? 'rgba(255, 255, 255, 0.98)' : colors.stroke;
    ctx.lineWidth = selected ? 2 : preview ? 1.5 : 1;
    ctx.setLineDash(preview ? [5, 4] : selected ? [6, 3] : []);
    ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
    ctx.setLineDash([]);
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
    rectangles
      .filter(rectangle => rectangle.id !== selectedRectangleId)
      .forEach(rectangle => drawRectangle(rectangle));
    trendLines
      .filter(line => line.id !== selectedTrendLineId)
      .forEach(line => drawTrendLine(line));
    const selected = rectangles.find(rectangle => rectangle.id === selectedRectangleId);
    if (selected) drawRectangle(selected, false, true);
    const selectedLine = trendLines.find(line => line.id === selectedTrendLineId);
    if (selectedLine) drawTrendLine(selectedLine, false, true);
    if (dragStart && dragCurrent) {
      const preview = {
        startLogical: dragStart.logical,
        endLogical: dragCurrent.logical,
        startPrice: dragStart.price,
        endPrice: dragCurrent.price,
      };
      if (drawingMode === 'trendline') drawTrendLine(preview, true);
      else drawRectangle(preview, true);
    }
  }

  function updateDrawingMode() {
    if (canvas) canvas.classList.toggle('drawing', drawingMode !== null);
    const buttons = [
      {id: 'draw-rectangle-btn', mode: 'rectangle', ready: 'Draw one rectangle (R)', active: 'Drag one rectangle…'},
      {id: 'draw-trendline-btn', mode: 'trendline', ready: 'Draw trend line (T)', active: 'Drag start to end…'},
    ];
    for (const item of buttons) {
      const button = document.getElementById(item.id);
      if (!button) continue;
      const active = drawingMode === item.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.textContent = active ? item.active : item.ready;
    }
  }

  function toggleDrawing(mode = 'rectangle') {
    drawingMode = drawingMode === mode ? null : mode;
    dragStart = null;
    dragCurrent = null;
    updateDrawingMode();
    draw();
  }

  function stopDrawing() {
    drawingMode = null;
    dragStart = null;
    dragCurrent = null;
    updateDrawingMode();
    draw();
  }

  function clear() {
    rectangles = [];
    trendLines = [];
    selectedRectangleId = null;
    selectedTrendLineId = null;
    dragStart = null;
    dragCurrent = null;
    draw();
  }

  function setColor(color) {
    if (color !== '#ff3d5a' && color !== '#00e676') return;
    selectedColor = color;
    document.querySelectorAll('.rect-color-swatch').forEach(button => {
      const selected = button.dataset.color === selectedColor;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function selectRectangleAt(event) {
    if (drawingMode || !lwChart || !cSeries) return null;
    if (suppressNextClick) {
      suppressNextClick = false;
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || x > Math.min(lwChart.timeScale().width(), rect.width) ||
        y < 0 || y > rect.height - 22) return null;
    const lineTolerance = 7;
    for (let index = trendLines.length - 1; index >= 0; index--) {
      const line = trendLines[index];
      const points = trendLinePoints(line);
      if (!points) continue;
      const dx = points.endX - points.startX;
      const dy = points.endY - points.startY;
      const lengthSquared = dx * dx + dy * dy;
      const projection = lengthSquared
        ? Math.max(0, Math.min(1, ((x - points.startX) * dx + (y - points.startY) * dy) / lengthSquared))
        : 0;
      const distance = Math.hypot(
        x - (points.startX + projection * dx),
        y - (points.startY + projection * dy),
      );
      if (distance <= lineTolerance) {
        selectedTrendLineId = line.id;
        selectedRectangleId = null;
        draw();
        return line;
      }
    }
    for (let index = rectangles.length - 1; index >= 0; index--) {
      const rectangle = rectangles[index];
      const bounds = rectangleBounds(rectangle);
      if (bounds && x >= bounds.left && x <= bounds.right &&
          y >= bounds.top && y <= bounds.bottom) {
        selectedRectangleId = rectangle.id;
        selectedTrendLineId = null;
        draw();
        return rectangle;
      }
    }
    selectedRectangleId = null;
    selectedTrendLineId = null;
    draw();
    return null;
  }

  function selectOnClick(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const rectangle = selectRectangleAt(event);
    if (rectangle) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function deleteOnDoubleClick(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || drawingMode) return;
    const drawing = selectRectangleAt(event);
    if (!drawing) return;
    const isTrendLine = selectedTrendLineId != null;
    const items = isTrendLine ? trendLines : rectangles;
    const selectedId = isTrendLine ? selectedTrendLineId : selectedRectangleId;
    const index = items.findIndex(item => item.id === selectedId);
    if (index < 0) return;
    items.splice(index, 1);
    selectedRectangleId = null;
    selectedTrendLineId = null;
    event.preventDefault();
    event.stopPropagation();
    draw();
  }

  function beginDrag(event) {
    if (!drawingMode || event.button !== 0 || !lwChart || !cSeries) return;
    const point = pointerPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    dragStart = point;
    dragCurrent = point;
    canvas.setPointerCapture(event.pointerId);
    draw();
  }

  function moveDrag(event) {
    if (!dragStart) return;
    const point = pointerPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    dragCurrent = point;
    draw();
  }

  function finishDrag(event) {
    if (!dragStart) return;
    const point = pointerPoint(event) || dragCurrent;
    event.preventDefault();
    event.stopPropagation();
    const movedX = point ? Math.abs(point.x - dragStart.x) : 0;
    const movedY = point ? Math.abs(point.y - dragStart.y) : 0;
    const hasDrawingSize = drawingMode === 'trendline'
      ? Math.hypot(movedX, movedY) >= 4
      : movedX >= 4 && movedY >= 4;
    if (event.type === 'pointerup' && point && hasDrawingSize) {
      const drawing = {
        startLogical: dragStart.logical,
        endLogical: point.logical,
        startPrice: dragStart.price,
        endPrice: point.price,
      };
      if (drawingMode === 'trendline') {
        drawing.id = nextTrendLineId++;
        trendLines.push(drawing);
        selectedTrendLineId = drawing.id;
        selectedRectangleId = null;
      } else {
        drawing.id = nextRectangleId++;
        drawing.color = selectedColor;
        rectangles.push(drawing);
        selectedRectangleId = drawing.id;
        selectedTrendLineId = null;
      }
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 0);
    }
    dragStart = null;
    dragCurrent = null;
    stopDrawing();
    draw();
  }

  function init() {
    canvas = document.getElementById('rectangle-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', beginDrag);
    canvas.addEventListener('pointermove', moveDrag);
    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', finishDrag);
    const chart = document.getElementById('chart-con');
    if (chart) {
      chart.addEventListener('click', selectOnClick);
      chart.addEventListener('dblclick', deleteOnDoubleClick);
    }
    setColor(selectedColor);
    document.addEventListener('keydown', event => {
      const target = event.target;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
          (target && (target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))) return;
      if (event.key === 'Escape' && drawingMode) {
        event.preventDefault();
        stopDrawing();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        toggleDrawing('rectangle');
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        toggleDrawing('trendline');
      }
    });
    window.addEventListener('resize', draw);
    draw();
  }

  return {
    init, draw, toggleDrawing, stopDrawing, clear, setColor,
    isDrawing: () => drawingMode !== null,
  };
})();
