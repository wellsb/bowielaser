/**
 * BowieLaser D-Pad Directional Controller
 * Supports: Touch / Click, Press-and-Hold repeat, Keyboard (WASD/Arrows), and Gamepad API.
 */

class DPadController {
  constructor(wsClient) {
    this.wsClient = wsClient;
    this.currentStep = 2.0; // default 2°
    this.repeatTimer = null;
    this.repeatInterval = 90; // ms between repeats
    this.initialRepeatDelay = 260; // ms before hold starts repeating
    this.activeDirection = null;

    // Gamepad state
    this.gamepadIndex = null;
    this.gamepadPollActive = false;
    this.lastGamepadCommandTime = 0;
    this.gamepadThrottleMs = 100;

    this.initElements();
    this.bindEvents();
    this.initGamepad();
  }

  initElements() {
    this.dpadButtons = document.querySelectorAll('.dpad-btn');
    this.stepPills = document.querySelectorAll('.step-pill');
  }

  setStep(step) {
    this.currentStep = parseFloat(step);
    this.stepPills.forEach(pill => {
      const pStep = parseFloat(pill.dataset.step);
      pill.classList.toggle('active', pStep === this.currentStep);
    });
  }

  bindEvents() {
    // Step selection pills
    this.stepPills.forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        this.setStep(pill.dataset.step);
      });
    });

    // D-Pad buttons: touch/mouse press and hold
    this.dpadButtons.forEach(btn => {
      const dir = btn.dataset.direction;

      const handlePressStart = (e) => {
        e.preventDefault();
        this.startDirection(dir, btn);
      };

      const handlePressEnd = (e) => {
        e.preventDefault();
        this.stopDirection();
      };

      btn.addEventListener('pointerdown', handlePressStart);
      btn.addEventListener('pointerup', handlePressEnd);
      btn.addEventListener('pointercancel', handlePressEnd);
      btn.addEventListener('pointerleave', handlePressEnd);
    });

    // Keyboard bindings
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input field
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      const key = e.key;

      if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        e.preventDefault();
        this.sendDirection('N');
      } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
        e.preventDefault();
        this.sendDirection('S');
      } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
        e.preventDefault();
        this.sendDirection('W');
      } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        e.preventDefault();
        this.sendDirection('E');
      } else if (key === 'q' || key === 'Q') {
        e.preventDefault();
        this.sendDirection('NW');
      } else if (key === 'e' || key === 'E') {
        e.preventDefault();
        this.sendDirection('NE');
      } else if (key === 'z' || key === 'Z') {
        e.preventDefault();
        this.sendDirection('SW');
      } else if (key === 'c' || key === 'C') {
        e.preventDefault();
        this.sendDirection('SE');
      } else if (key === ' ' || key === 'Home') {
        e.preventDefault();
        this.sendDirection('CENTER');
      } else if (key === 'Escape') {
        e.preventDefault();
        this.wsClient.send({ type: 'release' });
      } else if (['1', '2', '3', '4'].includes(key)) {
        const stepMap = { '1': 1.0, '2': 2.0, '3': 5.0, '4': 10.0 };
        this.setStep(stepMap[key]);
      }
    });
  }

  startDirection(dir, btnElement = null) {
    this.stopDirection();
    this.activeDirection = dir;
    if (btnElement) btnElement.classList.add('active');

    // Immediate initial step
    this.sendDirection(dir);

    // If center, don't repeat on hold
    if (dir === 'CENTER' || dir === 'C') return;

    // Delay before repeating
    this.repeatTimer = setTimeout(() => {
      this.repeatTimer = setInterval(() => {
        if (this.activeDirection) {
          this.sendDirection(this.activeDirection);
        }
      }, this.repeatInterval);
    }, this.initialRepeatDelay);
  }

  stopDirection() {
    if (this.repeatTimer) {
      clearTimeout(this.repeatTimer);
      clearInterval(this.repeatTimer);
      this.repeatTimer = null;
    }
    this.activeDirection = null;
    this.dpadButtons.forEach(btn => btn.classList.remove('active'));
  }

  sendDirection(dir) {
    if (dir === 'CENTER' || dir === 'C') {
      this.wsClient.send({ type: 'center' });
    } else {
      this.wsClient.send({
        type: 'dpad',
        direction: dir,
        step: this.currentStep
      });
    }
  }

  // --- Gamepad Support ---
  initGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
      console.log(`[Gamepad] Connected: ${e.gamepad.id} at index ${e.gamepad.index}`);
      this.gamepadIndex = e.gamepad.index;
      if (!this.gamepadPollActive) {
        this.gamepadPollActive = true;
        this.pollGamepad();
      }
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      console.log(`[Gamepad] Disconnected at index ${e.gamepad.index}`);
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
        this.gamepadPollActive = false;
      }
    });
  }

  pollGamepad() {
    if (!this.gamepadPollActive) return;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[this.gamepadIndex];

    if (gp && gp.connected) {
      const now = performance.now();
      if (now - this.lastGamepadCommandTime >= this.gamepadThrottleMs) {
        const deadzone = 0.25;
        let axisX = gp.axes[0] || 0;
        let axisY = gp.axes[1] || 0;

        // Standard D-pad buttons: 12=Up, 13=Down, 14=Left, 15=Right
        const up = gp.buttons[12]?.pressed || axisY < -deadzone;
        const down = gp.buttons[13]?.pressed || axisY > deadzone;
        const left = gp.buttons[14]?.pressed || axisX < -deadzone;
        const right = gp.buttons[15]?.pressed || axisX > deadzone;

        let dir = null;
        if (up && left) dir = 'NW';
        else if (up && right) dir = 'NE';
        else if (down && left) dir = 'SW';
        else if (down && right) dir = 'SE';
        else if (up) dir = 'N';
        else if (down) dir = 'S';
        else if (left) dir = 'W';
        else if (right) dir = 'E';

        // Button 0 (A / Cross) = Center
        if (gp.buttons[0]?.pressed) {
          dir = 'CENTER';
        }
        // Button 1 (B / Circle) = Release
        if (gp.buttons[1]?.pressed) {
          this.wsClient.send({ type: 'release' });
          this.lastGamepadCommandTime = now + 200;
        }

        if (dir) {
          this.sendDirection(dir);
          this.lastGamepadCommandTime = now;
        }
      }
    }

    requestAnimationFrame(() => this.pollGamepad());
  }
}

window.DPadController = DPadController;
