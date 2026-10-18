import {gameControl} from './vendor/gamecontroller.js';
import {joypad} from './vendor/joypad.js';

export const STICK_DEADZONE = .14;
export const TRIGGER_DEADZONE = .05;
export const PITCH_HOLD_THRESHOLD = .5;

/** Standard gamepad button indices (W3C standard mapping). */
export const PAD_BUTTONS = Object.freeze({
  lift: 0, boost: 2, camera: 3, triggerL: 6, triggerR: 7, reset: 8, zoomIn: 12, zoomOut: 13
});

export const PAD_LABELS = Object.freeze([
  {input: 'LS', action: 'Steer / yaw (analog)'},
  {input: 'RS', action: 'Pitch + roll in flight, orbit camera on the ground'},
  {input: 'RT', action: 'Throttle / boost (analog)'},
  {input: 'LT', action: 'Brake / lift (analog)'},
  {input: 'A / LB', action: 'Lift'},
  {input: 'X', action: 'Boost'},
  {input: 'Y', action: 'Cycle camera'},
  {input: 'View', action: 'Reset'},
  {input: 'D-pad ↑/↓', action: 'Zoom orbit camera'}
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = value => clamp(value, 0, 1);
const NO_EDGES = Object.freeze({camera: false, reset: false, zoomIn: false, zoomOut: false, any: false});

/** Radial-safe per-axis deadzone: values inside collapse to 0, outside rescale to full range. */
export function applyDeadzone(value, deadzone = STICK_DEADZONE) {
  const axis = Number.isFinite(value) ? value : 0;
  const magnitude = Math.abs(axis);
  if (magnitude <= deadzone) return 0;
  return Math.sign(axis) * (magnitude - deadzone) / (1 - deadzone);
}

export function buttonValue(button) {
  if (typeof button === 'object' && button !== null) {
    if (Number.isFinite(button.value)) return clamp01(button.value);
    return button.pressed ? 1 : 0;
  }
  return button ? 1 : 0;
}

export function buttonPressed(button) {
  if (typeof button === 'object' && button !== null) return !!button.pressed || buttonValue(button) > .5;
  return !!button;
}

/** Normalize a raw Gamepad into simulator-facing axes. Sign rules match the keyboard:
 *  stick left ≡ A (positive steer/yaw), stick back ≡ S (positive pitch), stick right ≡ E. */
export function computePadState(gamepad) {
  if (!gamepad || !Array.isArray(gamepad.axes)) return null;
  const axes = gamepad.axes;
  const buttons = gamepad.buttons || [];
  const axis = index => Number.isFinite(axes[index]) ? axes[index] : 0;
  const value = index => buttonValue(buttons[index]);
  const lsX = applyDeadzone(axis(0)), lsY = applyDeadzone(axis(1));
  const rsX = applyDeadzone(axis(2)), rsY = applyDeadzone(axis(3));
  return {
    gamepad,
    id: String(gamepad.id || 'GAMEPAD'),
    lsX, lsY, rsX, rsY,
    steerAxis: -lsX,
    yawAxis: -lsX,
    pitchAxis: rsY,
    rollAxis: rsX,
    triggerL: applyDeadzone(value(PAD_BUTTONS.triggerL), TRIGGER_DEADZONE),
    triggerR: applyDeadzone(value(PAD_BUTTONS.triggerR), TRIGGER_DEADZONE),
    buttonLift: value(PAD_BUTTONS.lift),
    buttonBoost: value(PAD_BUTTONS.boost),
    pitchHeld: Math.abs(axis(3)) > PITCH_HOLD_THRESHOLD,
    buttons: buttons.map(buttonPressed)
  };
}

/** Rising edges between the previous and current frame's pressed buttons. */
export function padEdges(previous, current) {
  if (!current) return NO_EDGES;
  const rise = index => !!current[index] && !previous?.[index];
  const edges = {
    camera: rise(PAD_BUTTONS.camera),
    reset: rise(PAD_BUTTONS.reset),
    zoomIn: rise(PAD_BUTTONS.zoomIn),
    zoomOut: rise(PAD_BUTTONS.zoomOut),
    any: false
  };
  edges.any = edges.camera || edges.reset || edges.zoomIn || edges.zoomOut ||
    current.some((pressed, index) => pressed && !previous?.[index]);
  return edges;
}

const invert = (flag, axis) => flag && axis !== 0 ? -axis : axis;

/** Merge keyboard controls (already inversion-aware from Keybinds.input) with pad axes.
 *  Axis fields are always finite so physics/controllers can prefer them; values are
 *  bit-identical to the boolean keyboard path when no pad is connected.
 *  Flight inversions apply to pad axes exactly once, only in FLIGHT - never ground. */
export function mergeControls(base, pad, inversions = {}, mode = 'GROUND') {
  const flight = mode === 'FLIGHT';
  let steerAxis = (base.left ? 1 : 0) - (base.right ? 1 : 0);
  let yawAxis = (base.left ? 1 : 0) - (base.right ? 1 : 0);
  let pitchAxis = (base.back ? 1 : 0) - (base.forward ? 1 : 0);
  let rollAxis = (base.rollRight ? 1 : 0) - (base.rollLeft ? 1: 0);
  let driveAxis = base.forward ? 1 : 0;
  let brakeAxis = base.back ? 1 : 0;
  let liftAxis = base.lift ? 1 : 0;
  let boostAxis = base.boost ? 1 : 0;
  if (pad) {
    liftAxis += pad.buttonLift;
    boostAxis += pad.buttonBoost;
    if (flight) {
      pitchAxis += invert(inversions.pitch, pad.pitchAxis);
      yawAxis += invert(inversions.yaw, pad.yawAxis);
      rollAxis += invert(inversions.roll, pad.rollAxis);
      liftAxis += pad.triggerL;
      boostAxis += pad.triggerR;
    } else {
      steerAxis += pad.steerAxis;
      yawAxis += pad.yawAxis;
      driveAxis += pad.triggerR;
      brakeAxis += pad.triggerL;
    }
  }
  return {
    ...base,
    steerAxis: clamp(steerAxis, -1, 1),
    driveAxis: clamp01(driveAxis),
    brakeAxis: clamp01(brakeAxis),
    pitchAxis: clamp(pitchAxis, -1, 1),
    yawAxis: clamp(yawAxis, -1, 1),
    rollAxis: clamp(rollAxis, -1, 1),
    liftAxis: clamp01(liftAxis),
    boostAxis: clamp01(boostAxis)
  };
}

function safeGetGamepads() {
  try {
    const pads = globalThis.navigator?.getGamepads?.();
    return Array.isArray(pads) ? pads : null;
  } catch { return null; }
}

const firstPad = () => safeGetGamepads()?.find?.(pad => pad && pad.connected !== false) || null;

/** Connection lifecycle via gamecontroller.js; per-frame state via raw polling
 *  (event-driven libraries are too coarse for analog driving axes). */
export class GamepadInput {
  constructor({onStatus = null} = {}) {
    this.onStatus = onStatus;
    this.state = null;
    this.connected = false;
    this._previousButtons = [];
  }

  start() {
    try {
      gameControl?.on?.('connect', gamepad => {
        this.connected = true;
        this.onStatus?.({connected: true, id: String(gamepad?.id || 'GAMEPAD')});
      });
      gameControl?.on?.('disconnect', () => {
        this.connected = false;
        this.state = null;
        this._previousButtons = [];
        this.onStatus?.({connected: false});
      });
    } catch { /* A missing library degrades to raw polling only. */ }
    const existing = firstPad();
    if (existing) {
      this.connected = true;
      this.onStatus?.({connected: true, id: String(existing.id || 'GAMEPAD')});
    }
    return this;
  }

  /** Call exactly once per animation frame; returns {state, edges}. */
  poll() {
    const gamepad = firstPad();
    if (!gamepad) {
      if (this.connected) {
        this.connected = false;
        this.onStatus?.({connected: false});
      }
      this.state = null;
      const hadButtons = this._previousButtons.length > 0;
      this._previousButtons = [];
      return {state: null, edges: hadButtons ? {...NO_EDGES, any: false} : NO_EDGES};
    }
    const state = computePadState(gamepad);
    if (!state) return {state: null, edges: NO_EDGES};
    const edges = padEdges(this._previousButtons, state.buttons);
    this._previousButtons = state.buttons;
    this.state = state;
    this.connected = true;
    return {state, edges};
  }
}

/** Rumble helper on top of joypad.js; silently degrades where unsupported. */
export function vibratePulse(gamepad, {duration = 120, weakMagnitude = .4, strongMagnitude = .6} = {}) {
  if (!gamepad) return false;
  try {
    joypad?.vibrate?.(gamepad, {startDelay: 0, duration, weakMagnitude, strongMagnitude});
    return true;
  } catch { return false; }
}
