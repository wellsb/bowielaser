/**
 * BowieLaser Cat Play Modes Controller
 * Manages automated laser patterns designed to entertain and fascinate a cat
 * while staying strictly within the safe calibrated square of operation.
 */

class CatLaserMode {
  constructor(wsClient) {
    this.wsClient = wsClient;
    this.activePattern = null;
    this.speed = 1.0;
    this.dwell = 1.0;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.modeButtons = document.querySelectorAll('.btn-mode');
    this.btnStopPlay = document.getElementById('btn-stop-play');
    this.sliderSpeed = document.getElementById('play-speed-slider');
    this.valSpeed = document.getElementById('play-speed-val');
    this.sliderDwell = document.getElementById('play-dwell-slider');
    this.valDwell = document.getElementById('play-dwell-val');
  }

  bindEvents() {
    // Mode selection buttons
    this.modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const pattern = btn.dataset.pattern;
        if (this.activePattern === pattern) {
          // If already active, toggle off
          this.stopPattern();
        } else {
          this.startPattern(pattern);
        }
      });
    });

    if (this.btnStopPlay) {
      this.btnStopPlay.addEventListener('click', () => {
        this.stopPattern();
      });
    }

    if (this.sliderSpeed) {
      this.sliderSpeed.addEventListener('input', (e) => {
        this.speed = parseFloat(e.target.value);
        if (this.valSpeed) this.valSpeed.textContent = `${this.speed.toFixed(1)}x`;
        if (this.activePattern) {
          this.startPattern(this.activePattern);
        }
      });
    }

    if (this.sliderDwell) {
      this.sliderDwell.addEventListener('input', (e) => {
        this.dwell = parseFloat(e.target.value);
        if (this.valDwell) this.valDwell.textContent = `${this.dwell.toFixed(1)}s`;
        if (this.activePattern) {
          this.startPattern(this.activePattern);
        }
      });
    }
  }

  startPattern(pattern) {
    this.activePattern = pattern;
    this.updateUI();
    this.wsClient.send({
      type: 'start_pattern',
      pattern: pattern,
      speed: this.speed,
      dwell: this.dwell
    });
  }

  stopPattern() {
    this.activePattern = null;
    this.updateUI();
    this.wsClient.send({ type: 'stop_pattern' });
  }

  updateUI() {
    this.modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pattern === this.activePattern);
    });
  }

  updateFromState(state) {
    if (state.active_pattern !== undefined) {
      this.activePattern = state.active_pattern;
      this.updateUI();
    }
  }
}

window.CatLaserMode = CatLaserMode;
