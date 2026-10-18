# Tesla Roadster 2 Rocket Simulator

[English](README.md) | [简体中文](README_ZH.md)

A pure browser-based **Tesla Roadster SpaceX Package (cold gas thruster package) low-poly flight physics simulator** built with Three.js.

Zero external runtime npm dependencies. Features a completely self-contained offline `.html` build that can be launched directly by double-clicking (`file://`).

![Tesla Roadster Rocket Simulator](docs/screenshot.png)

## 🎮 Controls & Gameplay Guide

### 1. Ground Driving Mode (Ground Mode)

| Key / Control | Description |
|---|---|
| **W** / **S** | Electric motor acceleration / braking and reverse |
| **A** / **D** | Front-wheel Ackermann steering (Left / Right) |
| **Shift** (Hold) | Fire rear thrusters (R1–R4) for rocket boost acceleration |
| **Space** (Hold) | Fire bottom lift thrusters (L1–L4) for vertical jump into flight |
| **R** | Instant reset vehicle position and attitude to start junction |
| **C** | Cycle camera views (3/4 Chase → Direct Chase → Top-down → Orbit) |

### 2. Flight Control Mode (Flight Mode)

Attitude control automatically engages after 0.15 seconds of being airborne:

| Key / Control | Description |
|---|---|
| **W** / **S** | Pitch control: **W** Pitch down / **S** Pitch up (differential front/rear lift thrusters) |
| **A** / **D** | Yaw control: **A** Yaw left / **D** Yaw right (front lateral Y1/Y2 nozzle firing) |
| **Q** / **E** | Roll control: **Q** Roll left / **E** Roll right (differential left/right lift thrusters) |
| **Space** (Hold) | Lift throttle: provides vertical ascent and hover lift |
| **Shift** (Hold) | Main rear thrusters: provides powerful forward rocket acceleration in flight |

> **Note**: If the throttle (W) is still held when leaving the ground, pitch commands are temporarily locked with a HUD warning (`RELEASE [W] TO ENGAGE PITCH`) to prevent accidental nose-dives. Release the key to engage normal pitch control.

### 3. Gamepad Support (Standard Mapping)

Xbox / DualShock / DualSense style controllers work out of the box — the HUD shows `PAD: <device name>` when connected. Sticks and triggers are fully analog (0.14 stick / 0.05 trigger deadzone, rescaled to full range) and can be combined with the keyboard.

| Gamepad | Ground | Flight |
|---|---|---|
| **Left stick** | Analog steering (left ≡ A) / orbit camera rotate | Yaw (left ≡ A) |
| **Right stick** | Orbit camera (outside flight mode) | Pitch (pull back ≡ S, nose up) / Roll (right ≡ E) |
| **RT** (right trigger) | Analog throttle (≡ W) | Rear rocket boost (≡ Shift) |
| **LT** (left trigger) | Brake / reverse (≡ S) | Analog lift (≡ Space) |
| **A / LB** | Lift thrusters | Request lift |
| **X** | Boost | Boost |
| **Y** | Cycle camera | Cycle camera |
| **View / Select** | Reset vehicle, attitude and tank | Reset |
| **D-pad ↑ / ↓** | Zoom orbit camera (3–35 m) | Zoom orbit camera |

The pad shares the keyboard's physics, takeoff interlock and inversion pipeline: flight axis inversions also apply to pad sticks, and grabbing the pitch stick during liftoff triggers the same pitch lock. Rumble feedback (impact / crash / launch / boost) is on by default via `joypad.js` and degrades silently where unsupported. The mapping is fixed — key remapping applies to the keyboard only.

### 4. Special Gameplay & Cheat Options (HUD / Settings Panel)

- **Orbit Camera**: Switch to Orbit view, then click/touch and drag on the canvas to rotate 360° around the car. Use the mouse wheel to zoom in/out.
- **Bullet Time**: Toggle in the settings panel to enjoy 0.5x slow-motion stunt control while airborne. Ground driving remains 1.0x real-time.
- **Record / Play Replay**:
  1. Click "Record" on the left side of the HUD to start recording;
  2. Perform any maneuvers or aerial stunts, then click "Stop Recording";
  3. Press `R` to reset the vehicle. The HUD will display the "▶ Play Replay" button. Click to play the replay; press `Esc` or click "Exit Replay" to return at any time.
- **Invincible**: Toggle on to disable crash detection from excessive speed, roll/pitch angles, or suspension bottom-out.
- **Infinite Fuel**: Locks tank pressure at 80 MPa, disabling cold gas consumption.
- **KEYBINDS (Key Mapping & Axis Inversion)**: Click the "KEYBINDS" button on the HUD to customize 12 action bindings and independently invert flight Pitch, Yaw, or Roll axes. Configurations persist automatically to `localStorage`.

---

## 🚀 Quick Start & Running

### Option 1: Standalone Single-File Version (No setup or server required)
Open the self-contained HTML file directly in any modern browser:
```text
roadster-lab/dist/roadster-rocket-standalone.html
```
- Approximately 1.56 MB, bundling all 21 runtime modules (including the vendored `gamecontroller.js` / `joypad.js` gamepad libraries), CSS, and Three.js;
- Completely removes browser CORS restrictions under `file://`.

### Option 2: Run with Static HTTP Server
```bash
cd roadster-lab
# Start the built-in HTTP static server (defaults to port 8080)
npm start
# Open in browser: http://127.0.0.1:8080/
```

### Option 3: Rebuild the Standalone Single HTML File
```bash
cd roadster-lab
# Zero external npm dependencies bundle build
npm run build
# Or alias:
npm run build:single
```

---

## 🧪 Testing & Verification

The project includes an automated test suite covering physics, flight control loops, and headless Chromium regression tests:

```bash
cd roadster-lab

# 1. Run 148 physics, dynamics, and flight control unit tests
node --test scripts/test-simulator.mjs

# 2. Run 14 gamepad input / merge / interlock / rumble tests
node --test scripts/test-gamepad.mjs

# 3. Run 17 single-file HTML bundler verification tests
node --test scripts/test-single-html.mjs

# 4. Run DOM state and 3D asset geometry checks
node scripts/check-ui-state.mjs
npm run check

# 5. Run standalone offline Chromium automated tests (requires Python 3 and Playwright)
python3 scripts/test-standalone.py

# 6. Run full browser Chromium regression test suite
python3 scripts/test-browser.py
```

---

## 📄 License

This project is licensed under the MIT License. Embedded Three.js (r170), gamecontroller.js and joypad.js are licensed under their official MIT Licenses.
