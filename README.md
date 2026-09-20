# BowieLaser - Pan & Tilt Cat Laser Controller

A standalone Single Page Application (SPA) and WebSocket server designed to control a 2-servo (Pan and Tilt) laser pointer mechanism mounted to an **Adafruit 16-channel PWM/Servo Shield (PCA9685)** on a **Raspberry Pi 5**.

---

## Hardware Configuration

- **Platform:** Raspberry Pi 5 SBC
- **Servo Board:** Adafruit 16-channel PCA9685 I2C Board (Address: `0x40`)
- **Pan Servo:** **Channel 5** (Horizontal azimuth control, 0° Right to 162° Left)
- **Tilt Servo:** **Channel 6** (Vertical elevation control, 0° Down to 162° Up)
- **Pulse Width Range:** Configurable in `server/config.json` (Default: `500 - 2500 µs`)
- **Mechanical Hard Limits:** Strictly clamped in hardware driver to `[0.0°, 162.0°]` to protect gears.

---

## Protection Against Gear Stripping

Physical servos have internal mechanical stops. Driving them beyond these limits binds the motor and strips the internal plastic/metal gears. BowieLaser protects your servos with:

1. **Hardware Driver Clamping:** Hard-clamped to `[0.0°, 162.0°]` at the lowest driver level (`server/hardware.py`).
2. **Floor Play Area Constraint:** Constrains automated patterns inside a calibrated 4-corner floor quadrilateral, preventing the laser from shining behind itself or onto walls and furniture.
3. **Emergency Stop / Torque Release:** Instantly disables the PWM duty cycle (`PWM=0`) on both channels. When released, the servos relax and do not buzz or strain against stops.
4. **Smooth S-Curve Interpolation:** Acceleration and deceleration curves avoid jerky step impulses that stress gears.

---

## Floor Calibration (Independent 4-Corner Quadrilateral)

On an elevated mount, a rectangular floor area forms a perspective trapezoid/quadrilateral in angular space. BowieLaser records all 4 corners independently:

1. Open the BowieLaser interface in your browser:
   - Via Apache: `http://<your-pi-ip>/dev/bowielaser/`
   - Directly: `http://<your-pi-ip>:8765/`
2. Aim the laser using the D-Pad, red sliders, or by clicking/dragging on the 2D Scope.
3. **Record Each Corner:**
   - Aim to the far-left floor extreme & click **"Set Top Left"**
   - Aim to the far-right floor extreme & click **"Set Top Right"**
   - Aim to the near-left floor extreme & click **"Set Bottom Left"**
   - Aim to the near-right floor extreme & click **"Set Bottom Right"**
4. **Test & Verify:**
   - Click the `Go →` buttons on any corner to verify aim.
   - Click **"Trace Floor Perimeter"** to watch the laser trace the 4 boundaries of your play area. Click **"■ Stop Trace"** when done.
   - Settings are automatically persisted to `server/calibration.json`.

---

## Controls & Features

### Manual D-Pad Controls
- **Mouse / Touch:** Directional D-Pad (Up, Down, Left, Right) + 4 Diagonals (NW, NE, SW, SE).
- **Step Sizes:** 1° (Fine), 2°, 5°, 10°.
- **Bidirectional Slider Sync:** Red Pan & Tilt sliders and readouts stay in sync at 60fps with canvas interaction.
- **Keyboard Shortcuts:**
  - `W` / `↑`: Tilt Up
  - `S` / `↓`: Tilt Down
  - `A` / `←`: Pan Left
  - `D` / `→`: Pan Right
  - `Q`, `E`, `Z`, `C`: Diagonals (NW, NE, SW, SE)
  - `Space` / `Home`: Center Laser
  - `Esc`: Emergency Release Servos (Torque Off)
  - `1`, `2`, `3`, `4`: Select Step Size (1°, 2°, 5°, 10°)
- **Gamepad Support:** Standard USB/Bluetooth gamepads supported out-of-the-box. D-pad & analog sticks move the laser; Button A centers; Button B releases torque.

### 2D Visual Floor Play Area & Scope
- Plots the true 4-sided floor quadrilateral in real time.
- Renders prohibited/behind-robot crosshatching outside your floor area.
- Shows live pulsing laser dot with coordinates.
- **Click or drag anywhere on the canvas** to aim directly.

### Cat Fascination Play Modes
1. **Random Dart:** Unpredictable leaps across the floor with stalking dwell pauses, simulating bug/prey behavior.
2. **Smooth Glide:** Cross between Random Dart and Smooth Wander. Glides along curved ease-in-out trajectories with sinusoidal arcs and lifelike micro-prey twitches during pauses.
3. **Smooth Wander:** Flowing continuous Lissajous stalking curves inside the floor quadrilateral.
4. **Perimeter Patrol:** Sweeps around the 4 calibrated corners of the floor play area.
- **Movement Speed Slider:** Adjustable from `0.3x` up to **`10.0x`** with dynamic acceleration scaling.
- **Pounce Pause (Dwell) Slider:** Adjustable from `0.2s` to `3.0s`.

---

## Managing the Service

### Start / Stop / Restart Scripts
```bash
cd /var/www/html/dev/bowielaser

# Start server in background
./start.sh

# Stop server
./stop.sh

# Restart server
./restart.sh
```

### Diagnostics
```bash
python3 /var/www/html/dev/bowielaser/server/test_laser.py
```

### Optional: Autostart on Boot (systemd)
```bash
sudo cp /var/www/html/dev/bowielaser/bowielaser.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bowielaser.service
```

---

## Project Structure

```
/var/www/html/dev/bowielaser/
├── index.html                  # Single Page Application
├── css/
│   └── styles.css              # Responsive UI & layout styling
├── js/
│   ├── app.js                  # Master application coordinator
│   ├── dpad-controller.js      # D-pad, hold-repeat, keyboard, gamepad handler
│   ├── calibration-manager.js  # 4-corner calibration & settings manager
│   ├── visual-square.js        # 2D canvas scope & quadrilateral renderer
│   ├── cat-laser-mode.js       # Play modes controller & speed sliders
│   └── websocket-client.js     # WebSocket client with auto-reconnect
├── server/
│   ├── config.json             # Servo channel & pulse width config
│   ├── calibration.json        # Persisted 4-corner floor calibration
│   ├── hardware.py             # PCA9685 driver with hardware clamping
│   ├── laser_server.py         # FastAPI backend & WebSocket server
│   ├── test_laser.py           # Hardware test script
│   └── test_websocket.py       # Integration test script
├── bowielaser.service          # systemd unit template
├── start.sh                    # Start script
├── stop.sh                     # Stop script
├── restart.sh                  # Restart script
├── .gitignore                  # Git ignore rules
└── README.md                   # Documentation
```
