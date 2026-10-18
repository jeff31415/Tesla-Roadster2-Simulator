import {vibratePulse} from './gamepad-input.js';

const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Throttled dual-rumble scheduler. Every trigger has its own cooldown so boost
 *  pulses never starve touchdown feedback. Injectable clock/vibrate for tests. */
export class GamepadRumble {
  constructor({vibrate = vibratePulse, now = () => Date.now()} = {}) {
    this._vibrate = vibrate;
    this._now = now;
    this._last = new Map();
  }

  /** kind: impact | boost | crash | launch. intensity 0..1 scales magnitude. */
  pulse(gamepad, kind, intensity = 1, {duration, weak, strong} = {}) {
    if (!gamepad) return false;
    const level = clamp01(intensity);
    if (level <= 0) return false;
    const settings = {
      impact: {duration: 140, weak: .5, strong: .9, cooldown: 160},
      boost: {duration: 180, weak: .45, strong: .25, cooldown: 220},
      crash: {duration: 520, weak: 1, strong: 1, cooldown: 900},
      launch: {duration: 260, weak: .6, strong: .9, cooldown: 900}
    }[kind];
    if (!settings) return false;
    const time = this._now();
    if (time - (this._last.get(kind) ?? -Infinity) < settings.cooldown) return false;
    this._last.set(kind, time);
    return this._vibrate(gamepad, {
      duration: duration ?? settings.duration,
      weakMagnitude: (weak ?? settings.weak) * level,
      strongMagnitude: (strong ?? settings.strong) * level
    });
  }

  /** Drive rumble once per frame from simulation events and state. */
  update(gamepad, {mode, previousMode, boosting = false, crashed = false, previousCrashed = false, events = null} = {}) {
    if (!gamepad) return;
    if (crashed && !previousCrashed) this.pulse(gamepad, 'crash', 1);
    if (mode === 'FLIGHT' && previousMode === 'GROUND') this.pulse(gamepad, 'launch', 1);
    if (events) for (const event of events) this.pulse(gamepad, 'impact', clamp01((Number(event?.g) || 0) / 6));
    if (boosting && mode !== 'CRASHED') this.pulse(gamepad, 'boost', 1);
  }

  reset() { this._last.clear(); }
}
