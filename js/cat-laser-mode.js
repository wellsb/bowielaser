/**
 * BowieLaser Cat Play Modes Controller
 * Manages automated laser patterns designed to entertain and fascinate a cat
 * while staying strictly within the safe calibrated square of operation.
 */

class CatLaserMode {
  constructor(wsClient) {
    this.wsClient = wsClient;
    this.activePattern = null;
    this.speed = 2.0;
    this.dwell = 1.0;
    this.speedRand = 0.0;
    this.dwellRand = 0.0;

    this.initElements();
    this.bindEvents();
    this.updateRangeHints();
  }

  initElements() {
    this.modeButtons = document.querySelectorAll('.btn-mode');
    this.btnStopPlay = document.getElementById('btn-stop-play');

    this.sliderSpeed = document.getElementById('play-speed-slider');
    this.valSpeed = document.getElementById('play-speed-val');
    this.spinnerSpeedRand = document.getElementById('play-speed-rand');
    this.hintSpeedRange = document.getElementById('play-speed-range');

    this.sliderDwell = document.getElementById('play-dwell-slider');
    this.valDwell = document.getElementById('play-dwell-val');
    this.spinnerDwellRand = document.getElementById('play-dwell-rand');
    this.hintDwellRange = document.getElementById('play-dwell-range');

    if (this.sliderSpeed) this.speed = parseFloat(this.sliderSpeed.value) || 2.0;
    if (this.sliderDwell) this.dwell = parseFloat(this.sliderDwell.value) || 1.0;
    if (this.spinnerSpeedRand) this.speedRand = parseFloat(this.spinnerSpeedRand.value) || 0.0;
    if (this.spinnerDwellRand) this.dwellRand = parseFloat(this.spinnerDwellRand.value) || 0.0;
  }

  updateRangeHints() {
    if (this.hintSpeedRange) {
      if (this.speedRand > 0.001) {
        const minS = Math.max(0.1, this.speed - this.speedRand);
        const maxS = this.speed + this.speedRand;
        this.hintSpeedRange.textContent = `(${minS.toFixed(1)}s – ${maxS.toFixed(1)}s)`;
      } else {
        this.hintSpeedRange.textContent = `(${this.speed.toFixed(1)}s)`;
      }
    }
    if (this.hintDwellRange) {
      if (this.dwellRand > 0.001) {
        const minD = Math.max(0.0, this.dwell - this.dwellRand);
        const maxD = this.dwell + this.dwellRand;
        this.hintDwellRange.textContent = `(${minD.toFixed(1)}s – ${maxD.toFixed(1)}s)`;
      } else {
        this.hintDwellRange.textContent = `(${this.dwell.toFixed(1)}s)`;
      }
    }
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
        if (this.valSpeed) this.valSpeed.textContent = `${this.speed.toFixed(1)}s`;
        this.updateRangeHints();
        if (this.activePattern) {
          this.startPattern(this.activePattern);
        }
      });
    }

    if (this.spinnerSpeedRand) {
      const onSpeedRandChange = (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val) || val < 0) val = 0.0;
        this.speedRand = Math.round(val * 10) / 10;
        this.updateRangeHints();
        if (this.activePattern) {
          this.startPattern(this.activePattern);
        }
      };
      this.spinnerSpeedRand.addEventListener('input', onSpeedRandChange);
      this.spinnerSpeedRand.addEventListener('change', onSpeedRandChange);
    }

    if (this.sliderDwell) {
      this.sliderDwell.addEventListener('input', (e) => {
        this.dwell = parseFloat(e.target.value);
        if (this.valDwell) this.valDwell.textContent = `${this.dwell.toFixed(1)}s`;
        this.updateRangeHints();
        if (this.activePattern) {
          this.startPattern(this.activePattern);
        }
      });
    }

    if (this.spinnerDwellRand) {
      const onDwellRandChange = (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val) || val < 0) val = 0.0;
        this.dwellRand = Math.round(val * 10) / 10;
        this.updateRangeHints();
        if (this.activePattern) {
          this.startPattern(this.activePattern);
        }
      };
      this.spinnerDwellRand.addEventListener('input', onDwellRandChange);
      this.spinnerDwellRand.addEventListener('change', onDwellRandChange);
    }
  }

  startPattern(pattern) {
    this.activePattern = pattern;
    this.updateUI();
    this.wsClient.send({
      type: 'start_pattern',
      pattern: pattern,
      speed: this.speed,
      dwell: this.dwell,
      speed_rand: this.speedRand,
      dwell_rand: this.dwellRand
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
    if (state.pattern_speed !== undefined && this.sliderSpeed && document.activeElement !== this.sliderSpeed) {
      this.speed = state.pattern_speed;
      this.sliderSpeed.value = this.speed;
      if (this.valSpeed) this.valSpeed.textContent = `${this.speed.toFixed(1)}s`;
    }
    if (state.pattern_dwell !== undefined && this.sliderDwell && document.activeElement !== this.sliderDwell) {
      this.dwell = state.pattern_dwell;
      this.sliderDwell.value = this.dwell;
      if (this.valDwell) this.valDwell.textContent = `${this.dwell.toFixed(1)}s`;
    }
    if (state.pattern_speed_rand !== undefined && this.spinnerSpeedRand && document.activeElement !== this.spinnerSpeedRand) {
      this.speedRand = state.pattern_speed_rand;
      this.spinnerSpeedRand.value = this.speedRand.toFixed(1);
    }
    if (state.pattern_dwell_rand !== undefined && this.spinnerDwellRand && document.activeElement !== this.spinnerDwellRand) {
      this.dwellRand = state.pattern_dwell_rand;
      this.spinnerDwellRand.value = this.dwellRand.toFixed(1);
    }
    this.updateRangeHints();
  }
}

window.CatLaserMode = CatLaserMode;
