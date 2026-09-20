/**
 * BowieLaser Calibration & Floor Play Area Manager
 * Manages active floor play area boundaries and corners:
 * "Set Top Left", "Set Top Right", "Set Bottom Left", "Set Bottom Right"
 * Allows unconstrained manual motion to set corner extremes,
 * and constrains automated play modes strictly to the floor area.
 */

class CalibrationManager {
  constructor(wsClient) {
    this.wsClient = wsClient;
    this.calibration = {
      limits: { pan_min: 35.0, pan_max: 127.0, tilt_min: 15.0, tilt_max: 65.0 },
      center: { pan: 81.0, tilt: 40.0 },
      corners: {
        top_left: { pan: 127.0, tilt: 65.0 },
        top_right: { pan: 35.0, tilt: 65.0 },
        bottom_left: { pan: 127.0, tilt: 15.0 },
        bottom_right: { pan: 35.0, tilt: 15.0 }
      },
      enforce_limits: true,
      lock_manual: false,
      invert_pan: false,
      invert_tilt: false
    };

    this.calibrationMode = false;
    this.activePattern = null;
    this.currentPan = 81.0;
    this.currentTilt = 40.0;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    // Mode toggles
    this.calibrationModeToggle = document.getElementById('toggle-calibration-mode');
    this.lockManualToggle = document.getElementById('toggle-lock-manual');
    this.invertPanToggle = document.getElementById('toggle-invert-pan');
    this.invertTiltToggle = document.getElementById('toggle-invert-tilt');
    this.calibrationBanner = document.getElementById('calibration-warning-banner');

    // 4 Corner Set & Go buttons
    this.btnSetTL = document.getElementById('btn-set-tl');
    this.btnSetTR = document.getElementById('btn-set-tr');
    this.btnSetBL = document.getElementById('btn-set-bl');
    this.btnSetBR = document.getElementById('btn-set-br');

    this.btnGoTL = document.getElementById('btn-go-tl');
    this.btnGoTR = document.getElementById('btn-go-tr');
    this.btnGoBL = document.getElementById('btn-go-bl');
    this.btnGoBR = document.getElementById('btn-go-br');

    // Corner coordinate displays
    this.valCornerTL = document.getElementById('val-corner-tl');
    this.valCornerTR = document.getElementById('val-corner-tr');
    this.valCornerBL = document.getElementById('val-corner-bl');
    this.valCornerBR = document.getElementById('val-corner-br');

    // Center and Trace buttons
    this.btnCornerCenter = document.getElementById('btn-corner-center');
    this.btnTraceSquare = document.getElementById('btn-trace-square');

    // Save & Reload buttons
    this.btnSaveCalibration = document.getElementById('btn-save-calibration');
    this.btnReloadCalibration = document.getElementById('btn-reload-calibration');
  }

  bindEvents() {
    // 1. Lock Manual Controls Toggle
    if (this.lockManualToggle) {
      this.lockManualToggle.addEventListener('change', (e) => {
        this.calibration.lock_manual = e.target.checked;
        this.sendCalibrationUpdate();
      });
    }

    // 2. Calibration Mode Toggle (Temporary Full Travel)
    if (this.calibrationModeToggle) {
      this.calibrationModeToggle.addEventListener('change', (e) => {
        this.calibrationMode = e.target.checked;
        this.updateModeBanner();
        this.wsClient.send({
          type: 'set_calibration_mode',
          enabled: this.calibrationMode
        });
      });
    }

    // 3. Inversion Toggles
    if (this.invertPanToggle) {
      this.invertPanToggle.addEventListener('change', (e) => {
        this.calibration.invert_pan = e.target.checked;
        this.sendCalibrationUpdate();
      });
    }
    if (this.invertTiltToggle) {
      this.invertTiltToggle.addEventListener('change', (e) => {
        this.calibration.invert_tilt = e.target.checked;
        this.sendCalibrationUpdate();
      });
    }

    // 4. "Set Top Left", "Set Top Right", "Set Bottom Left", "Set Bottom Right"
    const bindSetCorner = (btn, cornerTarget) => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        // Immediate local update for instant UI feedback
        if (this.calibration && this.calibration.corners) {
          this.calibration.corners[cornerTarget] = {
            pan: Math.round(this.currentPan * 10) / 10,
            tilt: Math.round(this.currentTilt * 10) / 10
          };
          this.updateBoundaryDisplays();
        }
        this.wsClient.send({
          type: 'record_limit',
          target: cornerTarget
        });
        btn.classList.add('flash-record');
        setTimeout(() => btn.classList.remove('flash-record'), 350);
      });
    };

    bindSetCorner(this.btnSetTL, 'top_left');
    bindSetCorner(this.btnSetTR, 'top_right');
    bindSetCorner(this.btnSetBL, 'bottom_left');
    bindSetCorner(this.btnSetBR, 'bottom_right');

    // 5. "Go to Corner" buttons
    const bindGoCorner = (btn, corner) => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        this.wsClient.send({ type: 'corner', corner: corner });
      });
    };

    bindGoCorner(this.btnGoTL, 'top_left');
    bindGoCorner(this.btnGoTR, 'top_right');
    bindGoCorner(this.btnGoBL, 'bottom_left');
    bindGoCorner(this.btnGoBR, 'bottom_right');

    // 6. Go to Center & Trace Floor Perimeter
    if (this.btnCornerCenter) {
      this.btnCornerCenter.addEventListener('click', () => {
        this.wsClient.send({ type: 'center' });
      });
    }

    if (this.btnTraceSquare) {
      this.btnTraceSquare.addEventListener('click', () => {
        if (this.activePattern === 'perimeter') {
          this.wsClient.send({ type: 'stop_pattern' });
        } else {
          this.wsClient.send({
            type: 'start_pattern',
            pattern: 'perimeter',
            speed: 1.0,
            dwell: 0.8
          });
        }
      });
    }

    // 7. Save & Reload Calibration
    if (this.btnSaveCalibration) {
      this.btnSaveCalibration.addEventListener('click', () => {
        this.sendCalibrationUpdate();
        const origText = this.btnSaveCalibration.textContent;
        this.btnSaveCalibration.textContent = '✓ Saved to Server Storage!';
        this.btnSaveCalibration.style.background = 'var(--accent-safe)';
        this.btnSaveCalibration.style.color = '#000';
        setTimeout(() => {
          this.btnSaveCalibration.textContent = origText;
          this.btnSaveCalibration.style.background = '';
          this.btnSaveCalibration.style.color = '';
        }, 1500);
      });
    }

    if (this.btnReloadCalibration) {
      this.btnReloadCalibration.addEventListener('click', () => {
        fetch('/api/calibration')
          .then(res => res.json())
          .then(cal => {
            this.updateCalibration(cal);
            alert('Floor Play Area reloaded from server storage.');
          })
          .catch(err => console.error('Failed to reload calibration:', err));
      });
    }
  }

  updateModeBanner() {
    if (this.calibrationBanner) {
      this.calibrationBanner.style.display = this.calibrationMode ? 'flex' : 'none';
    }
  }

  updateBoundaryDisplays() {
    const lims = this.calibration.limits || {};
    const cntr = this.calibration.center || {};
    const corners = this.calibration.corners || {
      top_left: { pan: lims.pan_max ?? 127, tilt: lims.tilt_max ?? 65 },
      top_right: { pan: lims.pan_min ?? 35, tilt: lims.tilt_max ?? 65 },
      bottom_left: { pan: lims.pan_max ?? 127, tilt: lims.tilt_min ?? 15 },
      bottom_right: { pan: lims.pan_min ?? 35, tilt: lims.tilt_min ?? 15 }
    };

    // 4 Corner displays
    if (this.valCornerTL && corners.top_left) {
      this.valCornerTL.textContent = `${(corners.top_left.pan).toFixed(1)}°, ${(corners.top_left.tilt).toFixed(1)}°`;
    }
    if (this.valCornerTR && corners.top_right) {
      this.valCornerTR.textContent = `${(corners.top_right.pan).toFixed(1)}°, ${(corners.top_right.tilt).toFixed(1)}°`;
    }
    if (this.valCornerBL && corners.bottom_left) {
      this.valCornerBL.textContent = `${(corners.bottom_left.pan).toFixed(1)}°, ${(corners.bottom_left.tilt).toFixed(1)}°`;
    }
    if (this.valCornerBR && corners.bottom_right) {
      this.valCornerBR.textContent = `${(corners.bottom_right.pan).toFixed(1)}°, ${(corners.bottom_right.tilt).toFixed(1)}°`;
    }
  }

  updateCalibration(cal) {
    if (!cal) return;
    this.calibration = cal;

    this.updateBoundaryDisplays();

    if (this.lockManualToggle) {
      this.lockManualToggle.checked = !!cal.lock_manual;
    }
    if (this.invertPanToggle) {
      this.invertPanToggle.checked = !!cal.invert_pan;
    }
    if (this.invertTiltToggle) {
      this.invertTiltToggle.checked = !!cal.invert_tilt;
    }
  }

  updateFromState(state) {
    this.currentPan = state.pan ?? 81.0;
    this.currentTilt = state.tilt ?? 40.0;

    if (state.calibration) {
      this.updateCalibration(state.calibration);
    }

    if (state.active_pattern !== undefined) {
      this.activePattern = state.active_pattern;
      if (this.btnTraceSquare) {
        if (this.activePattern === 'perimeter') {
          this.btnTraceSquare.textContent = '■ Stop Trace';
          this.btnTraceSquare.classList.add('btn-danger');
          this.btnTraceSquare.classList.remove('btn-safe');
        } else {
          this.btnTraceSquare.textContent = 'Trace Floor Perimeter';
          this.btnTraceSquare.classList.remove('btn-danger');
          this.btnTraceSquare.classList.add('btn-safe');
        }
      }
    }

    if (state.calibration_mode !== undefined) {
      this.calibrationMode = state.calibration_mode;
      if (this.calibrationModeToggle) {
        this.calibrationModeToggle.checked = this.calibrationMode;
      }
      this.updateModeBanner();
    }
  }

  sendCalibrationUpdate() {
    this.wsClient.send({
      type: 'set_calibration',
      calibration: this.calibration
    });
  }
}

window.CalibrationManager = CalibrationManager;
