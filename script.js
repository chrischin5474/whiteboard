document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('drawing-canvas');
  const ctx = canvas.getContext('2d');
  const wrapper = document.getElementById('canvas-wrapper');

  // Disable default touch action to prevent scrolling while drawing
  canvas.style.touchAction = 'none';

  // State variables
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let points = []; // Store points for smooth line rendering
  let currentStrokeStyle = '#1e293b'; // Default: Slate 800
  let currentLineWidth = 6;
  let isEraserMode = false;

  // History system (Undo / Redo)
  const historyLimit = 30;
  let undoStack = [];
  let redoStack = [];

  // DOM Elements - Toolbars
  const bgBtns = document.querySelectorAll('.bg-btn');
  const colorDots = document.querySelectorAll('.color-dot');
  const customColorPicker = document.getElementById('custom-color-picker');
  const customColorIndicator = document.querySelector('.custom-color-indicator');
  const sizeBtns = document.querySelectorAll('.size-btn');
  const eraserBtn = document.getElementById('eraser-btn');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const clearBtn = document.getElementById('clear-btn');
  const saveBtn = document.getElementById('save-btn');

  // DOM Elements - Physical Tray Items
  const trayMarkers = document.querySelectorAll('.tray-item:not(.board-eraser)');
  const trayEraser = document.getElementById('tray-eraser');

  // --- Initial Setup ---
  initCanvas();
  saveHistoryState(); // Initial empty canvas state

  // Event Listeners: Canvas Drawing (PointerEvents covers Mouse, Touch, Stylus)
  canvas.addEventListener('pointerdown', startDrawing);
  canvas.addEventListener('pointermove', draw);
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);
  canvas.addEventListener('pointerout', stopDrawing);

  // Event Listeners: Window Resize
  window.addEventListener('resize', handleResize);

  // Event Listeners: Background Patterns
  bgBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      bgBtns.forEach(b => b.classList.remove('active'));
      const newBg = btn.getAttribute('data-bg');
      btn.classList.add('active');
      
      // Update wrapper background class
      wrapper.className = 'whiteboard-canvas-wrapper'; // reset
      wrapper.classList.add(`bg-${newBg}`);
    });
  });

  // Event Listeners: Toolbar Colors
  colorDots.forEach(dot => {
    dot.addEventListener('click', () => {
      deactivateEraser();
      colorDots.forEach(d => d.classList.remove('active'));
      document.querySelector('.custom-color-container').classList.remove('active');
      dot.classList.add('active');

      const color = dot.getAttribute('data-color');
      currentStrokeStyle = color;
      
      // Sync with tray
      syncColorToTray(color);
    });
  });

  // Event Listeners: Custom Color Picker
  customColorPicker.addEventListener('input', (e) => {
    deactivateEraser();
    colorDots.forEach(d => d.classList.remove('active'));
    document.querySelector('.custom-color-container').classList.add('active');
    
    const color = e.target.value;
    currentStrokeStyle = color;
    customColorIndicator.style.backgroundColor = color;
    
    // Deactivate active status on tray since custom color is used
    clearTrayActive();
  });

  customColorPicker.addEventListener('change', (e) => {
    // Save color selection & select
    const color = e.target.value;
    currentStrokeStyle = color;
    customColorIndicator.style.backgroundColor = color;
  });

  // Event Listeners: Brush Size
  sizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sizeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLineWidth = parseInt(btn.getAttribute('data-size'), 10);
    });
  });

  // Event Listeners: Toolbar Eraser
  eraserBtn.addEventListener('click', toggleEraser);

  // Event Listeners: Operations
  clearBtn.addEventListener('click', confirmClear);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  saveBtn.addEventListener('click', saveImage);

  // Event Listeners: Bottom Tray Markers
  trayMarkers.forEach(marker => {
    marker.addEventListener('click', () => {
      const color = marker.getAttribute('data-tray-color');
      
      // Sync color selection back to toolbar color dots
      deactivateEraser();
      document.querySelector('.custom-color-container').classList.remove('active');
      colorDots.forEach(dot => {
        dot.classList.remove('active');
        if (dot.getAttribute('data-color') === color) {
          dot.classList.add('active');
        }
      });

      currentStrokeStyle = color;
      
      // Sync visual tray elevation
      trayMarkers.forEach(m => m.classList.remove('active-marker'));
      trayEraser.classList.remove('active-marker');
      marker.classList.add('active-marker');
    });
  });

  // Event Listeners: Bottom Tray Eraser
  trayEraser.addEventListener('click', () => {
    activateEraser();
  });

  // Keyboard Shortcuts (Ctrl+Z, Ctrl+Y)
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      undo();
    } else if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      redo();
    }
  });

  // --- Functions ---

  function initCanvas() {
    const rect = wrapper.getBoundingClientRect();
    const dpi = window.devicePixelRatio || 1;
    
    canvas.width = rect.width * dpi;
    canvas.height = rect.height * dpi;
    
    // Scale drawings so that 1 coordinate unit corresponds to 1 device pixel
    ctx.scale(dpi, dpi);
    
    // Canvas rendering styling details for premium look
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 0.5; // Smooths lines slightly
    ctx.shadowColor = currentStrokeStyle;
  }

  function handleResize() {
    // Preserve drawings on window resizing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0);

    const rect = wrapper.getBoundingClientRect();
    const dpi = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpi;
    canvas.height = rect.height * dpi;

    ctx.scale(dpi, dpi);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw back old content scaled
    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, rect.width, rect.height);
  }

  function startDrawing(e) {
    isDrawing = true;
    const { x, y } = getCoordinates(e);
    lastX = x;
    lastY = y;
    points = [{ x, y }];

    // Draw starting point (allows tapping to make a dot)
    ctx.beginPath();
    ctx.arc(x, y, (isEraserMode ? 24 : currentLineWidth) / 2, 0, Math.PI * 2);
    
    if (isEraserMode) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = currentStrokeStyle;
    }
    
    ctx.fill();
    ctx.beginPath(); // Reset path
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();

    const { x, y } = getCoordinates(e);
    points.push({ x, y });

    if (points.length < 3) {
      // Connect line to first point
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      setupStrokeStyle();
      ctx.stroke();
      lastX = x;
      lastY = y;
      return;
    }

    // Midpoint quadratic curve line-smoothing algorithm
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 2; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }

    // Curve through the last two points
    ctx.quadraticCurveTo(
      points[points.length - 2].x,
      points[points.length - 2].y,
      points[points.length - 1].x,
      points[points.length - 1].y
    );

    setupStrokeStyle();
    ctx.stroke();

    // Shift coordinates array for smooth continuous rendering
    points.shift();
    lastX = x;
    lastY = y;
  }

  function setupStrokeStyle() {
    if (isEraserMode) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 24; // Eraser is thicker
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentStrokeStyle;
      ctx.lineWidth = currentLineWidth;
    }
  }

  function stopDrawing() {
    if (isDrawing) {
      isDrawing = false;
      points = [];
      saveHistoryState();
    }
  }

  function getCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  // --- Mode Toggles ---

  function toggleEraser() {
    if (isEraserMode) {
      deactivateEraser();
    } else {
      activateEraser();
    }
  }

  function activateEraser() {
    isEraserMode = true;
    eraserBtn.classList.add('active');
    
    // Style tray eraser
    trayMarkers.forEach(m => m.classList.remove('active-marker'));
    trayEraser.classList.add('active-marker');
  }

  function deactivateEraser() {
    isEraserMode = false;
    eraserBtn.classList.remove('active');
    trayEraser.classList.remove('active-marker');
    
    // Restore visual highlight to current color dot / tray item
    syncColorToTray(currentStrokeStyle);
  }

  function syncColorToTray(color) {
    let found = false;
    trayMarkers.forEach(marker => {
      if (marker.getAttribute('data-tray-color') === color) {
        marker.classList.add('active-marker');
        found = true;
      } else {
        marker.classList.remove('active-marker');
      }
    });
    
    // If it's a custom color, none of the preset markers on the tray will match
    if (!found) {
      clearTrayActive();
    }
  }

  function clearTrayActive() {
    trayMarkers.forEach(m => m.classList.remove('active-marker'));
    trayEraser.classList.remove('active-marker');
  }

  // --- Operations (Clear, Undo, Redo) ---

  function confirmClear() {
    if (confirm('確定要清除所有繪圖內容嗎？')) {
      const dpi = window.devicePixelRatio || 1;
      const rect = wrapper.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      saveHistoryState();
    }
  }

  // --- History Mechanism ---

  function saveHistoryState() {
    // If index is not at the end of the stack (which happens after some undos followed by a new drawing action), slice the redo stack off.
    if (undoStack.length >= historyLimit) {
      undoStack.shift();
    }
    
    const snapshot = canvas.toDataURL();
    undoStack.push(snapshot);
    redoStack = []; // Reset redo stack on new action
    
    updateHistoryButtons();
  }

  function undo() {
    if (undoStack.length > 1) {
      const current = undoStack.pop();
      redoStack.push(current);
      
      const previousState = undoStack[undoStack.length - 1];
      restoreCanvasState(previousState);
    }
  }

  function redo() {
    if (redoStack.length > 0) {
      const nextState = redoStack.pop();
      undoStack.push(nextState);
      
      restoreCanvasState(nextState);
    }
  }

  function restoreCanvasState(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      // Clear current canvas
      const dpi = window.devicePixelRatio || 1;
      const rect = wrapper.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      
      // Draw back snapshot
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      updateHistoryButtons();
    };
  }

  function updateHistoryButtons() {
    undoBtn.disabled = undoStack.length <= 1;
    redoBtn.disabled = redoStack.length === 0;
  }

  function saveImage() {
    // Create export canvas matching original canvas physical pixel size
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    
    const dpi = window.devicePixelRatio || 1;
    const rect = wrapper.getBoundingClientRect();
    
    // 1. Draw the background on export canvas at logical scale
    exportCtx.scale(dpi, dpi);
    
    const activeBgBtn = document.querySelector('.bg-btn.active');
    const bgType = activeBgBtn ? activeBgBtn.getAttribute('data-bg') : 'white';
    
    drawBackgroundToContext(exportCtx, bgType, rect.width, rect.height);
    
    // 2. Draw user drawings on top at 1:1 pixel scale
    exportCtx.setTransform(1, 0, 0, 1, 0, 0); // reset scale
    exportCtx.drawImage(canvas, 0, 0);
    
    // 3. Trigger download
    const dataUrl = exportCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    
    const now = new Date();
    const timestamp = now.getFullYear() + 
                      String(now.getMonth() + 1).padStart(2, '0') + 
                      String(now.getDate()).padStart(2, '0') + '_' + 
                      String(now.getHours()).padStart(2, '0') + 
                      String(now.getMinutes()).padStart(2, '0') + 
                      String(now.getSeconds()).padStart(2, '0');
                      
    link.download = `whiteboard_${timestamp}.png`;
    link.href = dataUrl;
    link.click();
  }

  function drawBackgroundToContext(exportCtx, bgType, width, height) {
    if (bgType === 'white') {
      exportCtx.fillStyle = '#ffffff';
      exportCtx.fillRect(0, 0, width, height);
    } else {
      exportCtx.fillStyle = '#fafaf9';
      exportCtx.fillRect(0, 0, width, height);
      
      exportCtx.lineWidth = 1.2;
      
      if (bgType === 'lined') {
        exportCtx.strokeStyle = '#cbd5e1';
        exportCtx.beginPath();
        for (let y = 39.5; y < height; y += 40) {
          exportCtx.moveTo(0, y);
          exportCtx.lineTo(width, y);
        }
        exportCtx.stroke();
      } else if (bgType === 'grid') {
        exportCtx.strokeStyle = '#cbd5e1';
        exportCtx.beginPath();
        for (let y = 39.5; y < height; y += 40) {
          exportCtx.moveTo(0, y);
          exportCtx.lineTo(width, y);
        }
        for (let x = 39.5; x < width; x += 40) {
          exportCtx.moveTo(x, 0);
          exportCtx.lineTo(x, height);
        }
        exportCtx.stroke();
      } else if (bgType === 'english') {
        for (let yOffset = 0; yOffset < height; yOffset += 80) {
          // Line 1: blue
          exportCtx.strokeStyle = 'rgba(59, 130, 246, 0.45)';
          exportCtx.beginPath();
          exportCtx.moveTo(0, yOffset + 15);
          exportCtx.lineTo(width, yOffset + 15);
          exportCtx.stroke();
          
          // Line 2: dashed gray
          exportCtx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
          exportCtx.beginPath();
          exportCtx.setLineDash([3, 3]);
          exportCtx.moveTo(0, yOffset + 35);
          exportCtx.lineTo(width, yOffset + 35);
          exportCtx.stroke();
          exportCtx.setLineDash([]); // Reset
          
          // Line 3: red
          exportCtx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
          exportCtx.beginPath();
          exportCtx.moveTo(0, yOffset + 55);
          exportCtx.lineTo(width, yOffset + 55);
          exportCtx.stroke();
          
          // Line 4: blue
          exportCtx.strokeStyle = 'rgba(59, 130, 246, 0.45)';
          exportCtx.beginPath();
          exportCtx.moveTo(0, yOffset + 75);
          exportCtx.lineTo(width, yOffset + 75);
          exportCtx.stroke();
        }
      } else if (bgType === 'music') {
        exportCtx.strokeStyle = 'rgba(71, 85, 105, 0.5)';
        exportCtx.beginPath();
        for (let yOffset = 0; yOffset < height; yOffset += 100) {
          for (let i = 0; i < 5; i++) {
            const y = yOffset + 20 + i * 10;
            exportCtx.moveTo(0, y);
            exportCtx.lineTo(width, y);
          }
        }
        exportCtx.stroke();
      }
    }
  }
});
