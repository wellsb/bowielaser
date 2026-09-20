/**
 * BowieLaser Main Application Coordinator
 * Initializes all sub-controllers and synchronizes UI state.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize WebSocket Client
  const wsClient = new LaserWebSocketClient();

  // 2. Initialize Controllers
  const calibrationManager = new CalibrationManager(wsClient);
  const dpadController = new DPadController(wsClient);
  const visualSquare = new VisualSquare('square-canvas', wsClient, calibrationManager);
  const catLaserMode = new CatLaserMode(wsClient);

  // 3. UI Elements
  const statusBadge = document.getElementById('connection-status-badge');
  const statusText = document.getElementById('connection-status-text');
  const hwBadge = document.getElementById('hardware-status-badge');
  const btnEstop = document.getElementById('btn-estop');

  // Sliders & Readouts
  const panSlider = document.getElementById('pan-slider');
  const tiltSlider = document.getElementById('tilt-slider');
  const panAngleVal = document.getElementById('pan-angle-val');
  const tiltAngleVal = document.getElementById('tilt-angle-val');

  // Connection Modal
  const btnSettings = document.getElementById('btn-connection-settings');
  const modalBackdrop = document.getElementById('connection-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnSaveConnect = document.getElementById('btn-save-connect');
  const inputHost = document.getElementById('input-server-host');
  const inputPort = document.getElementById('input-server-port');

  // Slider Nudge Buttons
  const setupNudge = (btnId, axis, delta) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', () => {
        wsClient.send({ type: 'step', axis: axis, delta: delta });
      });
    }
  };

  setupNudge('btn-pan-m10', 'pan', -10);
  setupNudge('btn-pan-m1', 'pan', -1);
  setupNudge('btn-pan-p1', 'pan', 1);
  setupNudge('btn-pan-p10', 'pan', 10);

  setupNudge('btn-tilt-m10', 'tilt', -10);
  setupNudge('btn-tilt-m1', 'tilt', -1);
  setupNudge('btn-tilt-p1', 'tilt', 1);
  setupNudge('btn-tilt-p10', 'tilt', 10);

  // Sliders input (real-time visual update + throttled send)
  let sliderThrottle = null;
  const handleSliderInput = () => {
    const p = parseFloat(panSlider.value);
    const t = parseFloat(tiltSlider.value);
    if (panAngleVal) panAngleVal.textContent = `${p.toFixed(1)}°`;
    if (tiltAngleVal) tiltAngleVal.textContent = `${t.toFixed(1)}°`;
    visualSquare.updatePosition(p, t);

    if (sliderThrottle) return;
    sliderThrottle = setTimeout(() => {
      wsClient.send({ type: 'move', pan: parseFloat(panSlider.value), tilt: parseFloat(tiltSlider.value), smooth: false });
      sliderThrottle = null;
    }, 40);
  };

  if (panSlider) panSlider.addEventListener('input', handleSliderInput);
  if (tiltSlider) tiltSlider.addEventListener('input', handleSliderInput);

  // Wire visualSquare realtime drag callback to sliders
  visualSquare.onPositionChange = (pan, tilt) => {
    if (panSlider && document.activeElement !== panSlider) {
      panSlider.value = pan;
    }
    if (panAngleVal) {
      panAngleVal.textContent = `${pan.toFixed(1)}°`;
    }
    if (tiltSlider && document.activeElement !== tiltSlider) {
      tiltSlider.value = tilt;
    }
    if (tiltAngleVal) {
      tiltAngleVal.textContent = `${tilt.toFixed(1)}°`;
    }
  };

  // Emergency Stop / Release Servos
  if (btnEstop) {
    btnEstop.addEventListener('click', () => {
      wsClient.send({ type: 'release' });
    });
  }

  // Connection settings modal
  if (btnSettings) {
    btnSettings.addEventListener('click', () => {
      inputHost.value = wsClient.host;
      inputPort.value = wsClient.port;
      modalBackdrop.classList.add('open');
    });
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      modalBackdrop.classList.remove('open');
    });
  }

  if (btnSaveConnect) {
    btnSaveConnect.addEventListener('click', () => {
      const host = inputHost.value.trim();
      const port = parseInt(inputPort.value.trim(), 10) || 8765;
      wsClient.connect(host, port);
      modalBackdrop.classList.remove('open');
    });
  }

  // WebSocket Event Listeners
  wsClient.on('status', ({ state, url }) => {
    if (!statusBadge || !statusText) return;
    statusBadge.className = `status-badge ${state}`;
    if (state === 'online') {
      statusText.textContent = `Connected (${wsClient.host}:${wsClient.port})`;
    } else if (state === 'connecting') {
      statusText.textContent = `Connecting to ${wsClient.host}:${wsClient.port}...`;
    } else {
      statusText.textContent = `Offline`;
    }
  });

  wsClient.on('state', (state) => {
    // 1. Update sliders & readouts if not currently dragging the slider element itself
    if (panSlider && panAngleVal && state.pan !== null) {
      panAngleVal.textContent = `${Math.round(state.pan * 10) / 10}°`;
      if (document.activeElement !== panSlider) {
        panSlider.value = state.pan;
      }
    }

    if (tiltSlider && tiltAngleVal && state.tilt !== null) {
      tiltAngleVal.textContent = `${Math.round(state.tilt * 10) / 10}°`;
      if (document.activeElement !== tiltSlider) {
        tiltSlider.value = state.tilt;
      }
    }

    // 2. Update Hardware badge
    if (hwBadge) {
      if (state.is_simulation) {
        hwBadge.textContent = 'Hardware: Simulation';
        hwBadge.style.color = 'var(--accent-warn)';
      } else {
        hwBadge.textContent = 'Hardware: PCA9685 (Ch 5 & 6)';
        hwBadge.style.color = 'var(--accent-safe)';
      }
    }

    // 3. Update E-stop button state / release styling
    if (btnEstop) {
      if (state.is_released) {
        btnEstop.style.filter = 'grayscale(0.6)';
        btnEstop.title = 'Servos currently released (PWM disabled)';
      } else {
        btnEstop.style.filter = 'none';
        btnEstop.title = 'Click to release servo torque and stop motors';
      }
    }

    // 4. Forward state to sub-managers
    calibrationManager.updateFromState(state);
    if (state.pan !== null && state.tilt !== null) {
      visualSquare.updatePosition(state.pan, state.tilt);
    }
    catLaserMode.updateFromState(state);
  });

  // Start initial WebSocket connection
  wsClient.connect();
});
