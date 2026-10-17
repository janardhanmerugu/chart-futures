const RD = (() => {
  let canvas = null;
  let ctx = null;
  let drawingEnabled = false;
  let dragStart = null;
  let dragCurrent = null;
  let rectangles = [];
  let selectedRectangleId = null;
  let nextRectangleId = 1;
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
    const selected = rectangles.find(rectangle => rectangle.id === selectedRectangleId);
    if (selected) drawRectangle(selected, false, true);
    if (dragStart && dragCurrent) {
      drawRectangle({
        startLogical: dragStart.logical,
        endLogical: dragCurrent.logical,
        startPrice: dragStart.price,
        endPrice: dragCurrent.price,
      }, true);
    }
  }

  function updateDrawingMode() {
    if (canvas) canvas.classList.toggle('drawing', drawingEnabled);
    const button = document.getElementById('draw-rectangle-btn');
    if (button) {
      button.classList.toggle('active', drawingEnabled);
      button.setAttribute('aria-pressed', String(drawingEnabled));
      button.textContent = drawingEnabled ? 'Drag one rectangle…' : 'Draw one rectangle (R)';
    }
  }

  function toggleDrawing() {
    drawingEnabled = !drawingEnabled;
    dragStart = null;
    dragCurrent = null;
    updateDrawingMode();
    draw();
  }

  function stopDrawing() {
    drawingEnabled = false;
    dragStart = null;
    dragCurrent = null;
    updateDrawingMode();
    draw();
  }

  function clear() {
    rectangles = [];
    selectedRectangleId = null;
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
    if (drawingEnabled || !lwChart || !cSeries) return null;
    if (suppressNextClick) {
      suppressNextClick = false;
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || x > Math.min(lwChart.timeScale().width(), rect.width) ||
        y < 0 || y > rect.height - 22) return null;
    for (let index = rectangles.length - 1; index >= 0; index--) {
      const rectangle = rectangles[index];
      const bounds = rectangleBounds(rectangle);
      if (bounds && x >= bounds.left && x <= bounds.right &&
          y >= bounds.top && y <= bounds.bottom) {
        selectedRectangleId = rectangle.id;
        draw();
        return rectangle;
      }
    }
    selectedRectangleId = null;
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
    if (event.ctrlKey || event.metaKey || event.altKey || drawingEnabled) return;
    const rectangle = selectRectangleAt(event);
    if (!rectangle) return;
    const index = rectangles.findIndex(item => item.id === selectedRectangleId);
    if (index < 0) return;
    rectangles.splice(index, 1);
    selectedRectangleId = null;
    event.preventDefault();
    event.stopPropagation();
    draw();
  }

  function beginDrag(event) {
    if (!drawingEnabled || event.button !== 0 || !lwChart || !cSeries) return;
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
    if (event.type === 'pointerup' && point &&
        Math.abs(point.x - dragStart.x) >= 4 &&
        Math.abs(point.y - dragStart.y) >= 4) {
      const rectangle = {
        id: nextRectangleId++,
        startLogical: dragStart.logical,
        endLogical: point.logical,
        startPrice: dragStart.price,
        endPrice: point.price,
        color: selectedColor,
      };
      rectangles.push(rectangle);
      selectedRectangleId = rectangle.id;
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
      if (event.key === 'Escape' && drawingEnabled) {
        event.preventDefault();
        stopDrawing();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        toggleDrawing();
      }
    });
    window.addEventListener('resize', draw);
    draw();
  }

  return {
    init, draw, toggleDrawing, stopDrawing, clear, setColor,
    isDrawing: () => drawingEnabled,
  };
})();
