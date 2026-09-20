/**
 * BowieLaser Interactive 2D Visual Floor Play Area & Calibration "Square"
 * Renders the 0-155° physical servo envelope, the active floor play area,
 * prohibited behind-robot zones, corners, center, and live laser dot.
 * Updates the two red sliders and readouts in real-time when clicked or dragged.
 */

class VisualSquare {
  constructor(canvasId, wsClient, calibrationManager) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.wsClient = wsClient;
    this.calMgr = calibrationManager;

    this.currentPan = 81.0;
    this.currentTilt = 40.0;
    this.targetPan = 81.0;
    this.targetTilt = 40.0;

    this.isDragging = false;
    this.glowPhase = 0;
    this.onPositionChange = null;

    // Cache slider and display references for 60fps synchronous updates
    this.panSlider = document.getElementById('pan-slider');
    this.tiltSlider = document.getElementById('tilt-slider');
    this.panAngleVal = document.getElementById('pan-angle-val');
    this.tiltAngleVal = document.getElementById('tilt-angle-val');

    this.initCanvasSize();
    this.bindEvents();
    this.startRenderLoop();
  }

  initCanvasSize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  bindEvents() {
    window.addEventListener('resize', () => this.initCanvasSize());

    const handlePointerDown = (e) => {
      this.isDragging = true;
      this.handlePointerPos(e);
    };

    const handlePointerMove = (e) => {
      if (!this.isDragging) return;
      this.handlePointerPos(e);
    };

    const handlePointerUp = () => {
      this.isDragging = false;
    };

    this.canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }

  handlePointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const padding = 28;
    const drawW = this.width - padding * 2;
    const drawH = this.height - padding * 2;

    const clampedX = Math.max(padding, Math.min(x, this.width - padding));
    const clampedY = Math.max(padding, Math.min(y, this.height - padding));

    // Left on canvas is Pan Left (155°), Right on canvas is Pan Right (0°)
    let pan = 155.0 - ((clampedX - padding) / drawW) * 155.0;
    // Top on canvas is Tilt Up / Far (155°), Bottom on canvas is Tilt Down / Near (0°)
    let tilt = 155.0 - ((clampedY - padding) / drawH) * 155.0;

    // Only clamp manual canvas drag if lock_manual is explicitly enabled
    const lims = this.calMgr.calibration.limits;
    if (this.calMgr.calibration.lock_manual && !this.calMgr.calibrationMode && lims) {
      pan = Math.max(lims.pan_min, Math.min(pan, lims.pan_max));
      tilt = Math.max(lims.tilt_min, Math.min(tilt, lims.tilt_max));
    }

    pan = Math.round(pan * 10) / 10;
    tilt = Math.round(tilt * 10) / 10;

    // Immediately update local coordinates for instant visual feedback
    this.currentPan = pan;
    this.currentTilt = tilt;

    // 1. UPDATE BOTH RED SLIDERS AND READOUTS IMMEDIATELY
    if (this.panSlider && document.activeElement !== this.panSlider) {
      this.panSlider.value = pan;
    }
    if (this.panAngleVal) {
      this.panAngleVal.textContent = `${pan.toFixed(1)}°`;
    }
    if (this.tiltSlider && document.activeElement !== this.tiltSlider) {
      this.tiltSlider.value = tilt;
    }
    if (this.tiltAngleVal) {
      this.tiltAngleVal.textContent = `${tilt.toFixed(1)}°`;
    }

    if (typeof this.onPositionChange === 'function') {
      this.onPositionChange(pan, tilt);
    }

    // 2. Send move command to hardware
    this.wsClient.send({
      type: 'move',
      pan: pan,
      tilt: tilt,
      smooth: false
    });
  }

  updatePosition(pan, tilt) {
    this.currentPan = pan;
    this.currentTilt = tilt;
  }

  startRenderLoop() {
    const render = () => {
      this.draw();
      this.glowPhase += 0.05;
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const padding = 28;
    const drawW = w - padding * 2;
    const drawH = h - padding * 2;

    ctx.clearRect(0, 0, w, h);

    // Coordinate mapping functions (Left=155, Right=0; Top=155, Bottom=0)
    const angleToX = (angle) => padding + ((155.0 - angle) / 155.0) * drawW;
    const angleToY = (angle) => padding + ((155.0 - angle) / 155.0) * drawH;

    // 1. Draw outer physical boundary (0-155)
    ctx.strokeStyle = '#262d42';
    ctx.lineWidth = 1;
    ctx.strokeRect(padding, padding, drawW, drawH);

    // Subtle grid lines at 38.75°, 77.5°, 116.25°
    ctx.strokeStyle = 'rgba(46, 54, 80, 0.4)';
    ctx.setLineDash([2, 4]);
    [38.75, 77.5, 116.25].forEach(deg => {
      const x = angleToX(deg);
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, padding + drawH);
      ctx.stroke();

      const y = angleToY(deg);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + drawW, y);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // 2. Active Floor Play Area Quadrilateral (4 Independent Corners)
    const corners = this.calMgr.calibration.corners || {
      top_left: { pan: 127, tilt: 65 },
      top_right: { pan: 35, tilt: 65 },
      bottom_left: { pan: 127, tilt: 15 },
      bottom_right: { pan: 35, tilt: 15 }
    };

    const ptTL = { x: angleToX(corners.top_left.pan), y: angleToY(corners.top_left.tilt) };
    const ptTR = { x: angleToX(corners.top_right.pan), y: angleToY(corners.top_right.tilt) };
    const ptBR = { x: angleToX(corners.bottom_right.pan), y: angleToY(corners.bottom_right.tilt) };
    const ptBL = { x: angleToX(corners.bottom_left.pan), y: angleToY(corners.bottom_left.tilt) };

    // 3. Draw Prohibited / Behind-Robot Diagonal Hatching outside the Floor Quadrilateral
    ctx.save();
    ctx.beginPath();
    // Outer canvas boundary
    ctx.rect(padding, padding, drawW, drawH);
    // Floor quadrilateral cutout
    ctx.moveTo(ptTL.x, ptTL.y);
    ctx.lineTo(ptTR.x, ptTR.y);
    ctx.lineTo(ptBR.x, ptBR.y);
    ctx.lineTo(ptBL.x, ptBL.y);
    ctx.closePath();
    // Evenodd fill cuts out the floor quad, shading only out-of-bounds area
    ctx.fillStyle = 'rgba(30, 20, 28, 0.45)';
    ctx.fill('evenodd');

    // Diagonal warning stripes in prohibited zone
    ctx.save();
    ctx.clip('evenodd');
    ctx.strokeStyle = 'rgba(255, 40, 80, 0.08)';
    ctx.lineWidth = 2;
    for (let i = -drawH; i < drawW + drawH; i += 16) {
      ctx.beginPath();
      ctx.moveTo(padding + i, padding);
      ctx.lineTo(padding + i - drawH, padding + drawH);
      ctx.stroke();
    }
    ctx.restore();

    // Out-of-bounds / Behind Robot text labels
    const minQuadY = Math.min(ptTL.y, ptTR.y);
    const maxQuadY = Math.max(ptBL.y, ptBR.y);
    const minQuadX = Math.min(ptTL.x, ptBL.x);
    const maxQuadX = Math.max(ptTR.x, ptBR.x);

    ctx.fillStyle = 'rgba(255, 70, 90, 0.45)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Top prohibited (pointing high / ceiling / backwards)
    if (minQuadY - padding > 18) {
      ctx.fillText('PROHIBITED / BEHIND ROBOT (HIGH/CEILING)', w / 2, padding + (minQuadY - padding) / 2);
    }
    // Left prohibited (pointing backwards left)
    if (minQuadX - padding > 22) {
      ctx.fillText('BEHIND LEFT', padding + (minQuadX - padding) / 2, h / 2);
    }
    // Right prohibited (pointing backwards right)
    if (padding + drawW - maxQuadX > 22) {
      ctx.fillText('BEHIND RIGHT', maxQuadX + (padding + drawW - maxQuadX) / 2, h / 2);
    }
    // Bottom prohibited (under base)
    if (padding + drawH - maxQuadY > 16) {
      ctx.fillText('BASE / UNDER', w / 2, maxQuadY + (padding + drawH - maxQuadY) / 2);
    }
    ctx.restore();

    // 4. Draw Active Floor Play Area Quadrilateral Polygon
    ctx.beginPath();
    ctx.moveTo(ptTL.x, ptTL.y);
    ctx.lineTo(ptTR.x, ptTR.y);
    ctx.lineTo(ptBR.x, ptBR.y);
    ctx.lineTo(ptBL.x, ptBL.y);
    ctx.closePath();

    // Glowing safe fill
    ctx.fillStyle = 'rgba(0, 230, 153, 0.09)';
    ctx.fill();

    // Glowing outline
    ctx.strokeStyle = '#00e699';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Floor area centroid watermark label
    const centerQuadX = (ptTL.x + ptTR.x + ptBR.x + ptBL.x) / 4;
    const centerQuadY = (ptTL.y + ptTR.y + ptBR.y + ptBL.y) / 4;
    ctx.fillStyle = 'rgba(0, 230, 153, 0.22)';
    ctx.font = '700 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ACTIVE FLOOR PLAY AREA', centerQuadX, centerQuadY - 12);

    // 5. Draw Corner Dots & Labels directly at the 4 true corner points
    const cornerDefs = [
      { label: 'Top-Left', pt: ptTL, corner: corners.top_left, align: 'right', baseline: 'bottom', ox: -8, oy: -8 },
      { label: 'Top-Right', pt: ptTR, corner: corners.top_right, align: 'left', baseline: 'bottom', ox: 8, oy: -8 },
      { label: 'Bottom-Left', pt: ptBL, corner: corners.bottom_left, align: 'right', baseline: 'top', ox: -8, oy: 8 },
      { label: 'Bottom-Right', pt: ptBR, corner: corners.bottom_right, align: 'left', baseline: 'top', ox: 8, oy: 8 }
    ];

    ctx.font = '10px Inter, monospace';
    cornerDefs.forEach(c => {
      if (!c.corner) return;
      ctx.fillStyle = '#00e699';
      ctx.beginPath();
      ctx.arc(c.pt.x, c.pt.y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.textAlign = c.align;
      ctx.textBaseline = c.baseline;
      const pStr = (c.corner.pan !== undefined) ? c.corner.pan.toFixed(1) : '0.0';
      const tStr = (c.corner.tilt !== undefined) ? c.corner.tilt.toFixed(1) : '0.0';
      ctx.fillText(`${c.label} (${pStr}°, ${tStr}°)`, c.pt.x + c.ox, c.pt.y + c.oy);
    });

    // 6. Draw Center Marker
    const cntr = this.calMgr.calibration.center || { pan: 81, tilt: 40 };
    const cx = angleToX(cntr.pan);
    const cy = angleToY(cntr.tilt);
    ctx.strokeStyle = 'rgba(0, 230, 153, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0, 230, 153, 0.7)';
    ctx.font = '9px Inter, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Center', cx, cy + 5);

    // 7. Draw Live Laser Dot
    const lx = angleToX(this.currentPan);
    const ly = angleToY(this.currentTilt);

    // Glowing halo pulse
    const pulseRadius = 10 + Math.sin(this.glowPhase) * 3;
    const grad = ctx.createRadialGradient(lx, ly, 2, lx, ly, pulseRadius);
    grad.addColorStop(0, 'rgba(255, 26, 83, 0.85)');
    grad.addColorStop(0.5, 'rgba(255, 26, 83, 0.35)');
    grad.addColorStop(1, 'rgba(255, 26, 83, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lx, ly, pulseRadius, 0, Math.PI * 2);
    ctx.fill();

    // Solid core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff1a53';
    ctx.beginPath();
    ctx.arc(lx, ly, 2, 0, Math.PI * 2);
    ctx.fill();

    // Coordinate tooltip near laser
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.font = '10px Inter, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(this.currentPan * 10) / 10}°, ${Math.round(this.currentTilt * 10) / 10}°`, lx + 12, ly - 8);

    // Axis labels
    ctx.fillStyle = '#64708d';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('155° (Left)', padding, h - 10);
    ctx.fillText('0° (Right)', w - padding, h - 10);
    ctx.fillText('77.5° (Forward)', w / 2, h - 10);

    ctx.textAlign = 'right';
    ctx.fillText('0° (Near/Down)', padding - 6, padding + drawH);
    ctx.fillText('155° (Far/Up)', padding - 6, padding + 4);
    ctx.fillText('77.5°', padding - 6, padding + drawH / 2);
  }
}

window.VisualSquare = VisualSquare;
