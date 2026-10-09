# BowieLaser Project Memory

This document maintains essential context, hardware specifications, architectural decisions, and critical safety rules for agents working on the **BowieLaser** codebase.

---

## 1. Project Overview & Hardware Environment

- **Project Name:** BowieLaser (Interactive Pan & Tilt Cat Laser Controller for Bowie the cat)
- **Primary Working Directory:** `/var/www/html/dev/bowielaser`
- **GitHub Repository:** `https://github.com/wellsb/bowielaser` (`origin/main`)
- **Host System:** Raspberry Pi 5 / Linux host (`192.168.0.40`)
- **PWM Controller:** Adafruit PCA9685 16-channel I2C servo driver (Address `0x40`)
  - **Pan Servo:** Channel 5 (Horizontal azimuth: `0.0°` Right to `155.0°` Left)
  - **Tilt Servo:** Channel 6 (Vertical elevation: `0.0°` Down to `155.0°` Up)
  - **Absolute Hardware Limit:** Strictly clamped to `[0.0°, 155.0°]` at driver level to prevent physical binding and gear stripping.
- **Service Endpoints:**
  - Apache Reverse Proxy: `http://192.168.0.40/dev/bowielaser/`
  - Direct Backend Port: `http://192.168.0.40:8765/` (FastAPI + WebSocket at `ws://192.168.0.40:8765/ws`)

---

## 2. CRITICAL Hardware Calibration Rules

> [!CAUTION]
> **NEVER OVERWRITE OR RESET `server/calibration.json`**
> The physical floor area was carefully calibrated on real carpet/floor with active hardware. Overwriting it causes the laser to shoot out of bounds or blind spots.

- **Active Calibration File:** `server/calibration.json`
- **Persistent Safety Backup:** `server/calibration.user_backup.json`
- **Physical Calibration Corner Values:**
  - `top_left`: Pan `100.8°`, Tilt `45.6°`
  - `top_right`: Pan `74.4°`, Tilt `44.0°`
  - `bottom_left`: Pan `105.8°`, Tilt `0.0°`
  - `bottom_right`: Pan `48.8°`, Tilt `9.2°`
  - `center`: Pan `82.5°`, Tilt `24.7°`
  - `limits`: Pan `[48.8°, 105.8°]`, Tilt `[0.0°, 45.6°]`
- **Coordinate Mapping:** The play area is mapped via bilinear quad interpolation (`_interpolate_quad(u, v)`) over the quadrilateral corners.
- **Manual Steering:** `lock_manual` is `false` by default to permit full exploration up to mechanical hardware limits (`0.0° - 155.0°`). When running automated modes or when `lock_manual` is enabled, movement is constrained inside the calibrated floor quad.

---

## 3. UI Layout & Styling Guidelines

- **Viewport Constraint:** The entire interface is vertically budgeted to fit `100%` of the viewport height (`height: calc(100vh - 48px)`) without vertical page scrolling.
- **Grid Layout:** 2-column grid (`1fr 1fr`).
  - **Left Column:** 3 balanced panels sharing vertical space:
    1. **D-Pad:** Directional buttons, diagonal controls, step-size selector (1°, 2°, 5°, 10°).
    2. **Servos:** Direct Pan & Tilt angle sliders and fine nudge buttons (-10°, -1°, +1°, +10°).
    3. **Modes:** Automated play modes grid, Stop Play button, and Timing & Randomness sliders/spinners.
  - **Right Column:** 1 full-height panel matching the left column:
    - **Area:** 2D interactive canvas scope showing the quadrilateral floor area, live laser position, and 4 corner calibration setters.
- **Naming Conventions:**
  - Panels: "D-Pad", "Servos", "Modes", "Area".
  - Area Canvas Legend: "Active", "Blocked", "Laser".

---

## 4. Automation Modes & Configurable Randomness

### Available Modes
1. **Random Dart (`random`):** Unpredictable jumps across the floor area with stalking dwell pauses.
2. **Smooth Glide (`smooth_random`):** Fluid curved arcs with sinusoidal deflection and micro-prey twitches during pauses.
3. **Smooth Wander (`wander`):** Continuous Lissajous / parametric stalking curves.
4. **Perimeter Patrol (`perimeter`):** Sweeps the perimeter of the 4 calibrated floor corners.

### Timing & Randomness Mechanics
- **Base Duration Sliders:**
  - Movement Speed: `0.3s – 10.0s` (base travel time per move).
  - Pounce Pause (Dwell): `0.0s – 10.0s` (base stalking pause between moves).
- **Randomness Spinners (`±`):**
  - Numeric spinner controls (`<input type="number" step="0.1">`) with 1 decimal place of precision (`0.0s – 10.0s`).
  - Real-time range preview badge: e.g. Speed `4.0s` ± `2.0s` displays `(2.0s – 6.0s)`; with `0.0s` randomness displays `(4.0s)`.
- **Backend Calculation:**
  - Move Duration: $T \sim \text{Uniform}(\max(0.1, \text{speed} - \text{speed\_rand}), \text{speed} + \text{speed\_rand})$
  - Dwell Duration: $D \sim \text{Uniform}(\max(0.0, \text{dwell} - \text{dwell\_rand}), \text{dwell} + \text{dwell\_rand})$
  - Servos smoothly interpolate at 50 Hz ($T / 0.02$ steps).

### Decoupled Hardware Timing & Focus Immunity
- Physical servo loops must **never** block on client WebSocket network I/O.
- Each connected WebSocket client has an independent writer task fed by a non-blocking queue (`asyncio.Queue(maxsize=1)`).
- When a client browser window loses focus, Chromium/browser task throttling causes TCP socket receive delays. The server drops stale unread telemetry frames in the queue rather than pausing the motor loop with TCP backpressure.
- The physical laser on the floor runs at 100% full speed regardless of whether browser tabs are focused, unfocused, minimized, or backgrounded.
- The client-side canvas in `js/visual-square.js` triggers an immediate render upon state reception if `document.hidden` or `!document.hasFocus()`, keeping the display live even if the browser throttles `requestAnimationFrame`.

---

## 5. Repository File Structure

```text
/var/www/html/dev/bowielaser/
├── MEMORY.md                 # This persistent memory guide
├── README.md                 # Public documentation
├── index.html                # Frontend single-page app
├── css/
│   └── styles.css            # Dark mode responsive stylesheet
├── js/
│   ├── app.js                # App coordinator & event binding
│   ├── ws-client.js          # WebSocket client with auto-reconnect
│   ├── cat-laser-mode.js     # Automations, timings, spinners & live range hints
│   ├── visual-square.js      # 2D Canvas scope, drawing & click/drag steering
│   ├── calibration-manager.js# Calibration & 4-corner setter controls
│   └── dpad-controller.js    # D-pad & keyboard/gamepad navigation
├── server/
│   ├── laser_server.py       # FastAPI backend, WebSocket server & pattern loops
│   ├── hardware.py           # PCA9685 driver with smooth interpolation & simulation
│   ├── calibration.json      # ACTIVE physical floor calibration
│   ├── calibration.user_backup.json # Safety backup of physical calibration
│   ├── config.json           # Hardware channels and PWM pulse settings
│   ├── test_laser.py         # Hardware sanity test
│   └── test_websocket.py     # Automated WebSocket & API integration test suite
├── start.sh                  # Start background daemon
├── stop.sh                   # Stop server process
└── restart.sh                # Restart server process
```

---

## 6. Service Management & Testing Commands

- **Restart Server:**
  ```bash
  ./restart.sh
  ```
- **Run WebSocket & Integration Tests:**
  ```bash
  python3 server/test_websocket.py
  ```
  *(Note: `test_websocket.py` saves and restores user calibration automatically).*
- **Verify Calibration Integrity:**
  ```bash
  md5sum server/calibration.json server/calibration.user_backup.json
  ```
- **Check Server Status:**
  ```bash
  curl -s http://127.0.0.1:8765/api/status
  ```
