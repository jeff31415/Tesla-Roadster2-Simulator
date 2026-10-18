import {Vector3} from './vendor/three.module.js';

export const MAX_PRESSURE = 80e6;
// Newtons per nozzle at MAX_PRESSURE; the physics integrator must use the same ratings.
export const MAX_THRUST = Object.freeze({rear:20000, lift:20000, yaw:5000});
const DEG = Math.PI / 180;
const INERTIA = [.52, 2.1, 2.05];
const KP = 5, KI = 1.5, KD = .12;
const ANGLE_KP = 3, LANDING_ANGLE = 30 * DEG, LANDING_BLEND_TIME = .2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;

/** Local axes: X roll/front, Y yaw/up, Z pitch/left. No keyboard or body mutation. */
export class FlightController {
  constructor() {
    this.throttles = new Float64Array(10);
    this._integral = new Float64Array(3);
    this._previous = new Float64Array(3);
    this._derivative = new Float64Array(3);
    this._up = new Vector3();
    this._front = new Vector3();
    this._left = new Vector3();
    this._landingRates = new Float64Array(3);
    this.targetRates = new Float64Array(3);
    this.targetAngles = {roll: 0, pitch: 0};
    this.reset();
  }

  reset() {
    this.throttles.fill(0);
    this._integral.fill(0);
    this._previous.fill(0);
    this._derivative.fill(0);
    this._landingRates.fill(0);
    this.targetRates.fill(0);
    this.targetAngles.roll = this.targetAngles.pitch = 0;
    this._landingBlend = 0;
    this._tracking = false;
    this.assistActive = false;
    this.landingActive = false;
    this.mode = 'GROUND';
    this.targetDescent = null;
  }

  /**
   * dt: seconds; body.omega: local rad/s; body.q: local-to-world quaternion;
   * body.v: world m/s; pressure: Pa; altitude: wheel clearance in metres.
   * settings.rate: 90..360 deg/s. Returns a reused R1..R4,L1..L4,Y1,Y2 array.
   * targetAngles: landing roll/pitch radians; targetRates: blended local rad/s.
   */
  update(dt, body, input = {}, settings = {}) {
    const out = this.throttles;
    out.fill(0);
    this.assistActive = false;
    this.targetDescent = null;
    dt = clamp(finite(dt), 0, .1);
    if (body.mode !== 'FLIGHT') {
      this.reset();
      // Ground steering and drive belong to the wheel controller, not the jets.
      // Axis fields (always finite from the input merge) scale the jets linearly;
      // boolean-only callers (tests) fall back to full deflection.
      const boost = Number.isFinite(input.boostAxis) ? clamp(input.boostAxis, 0, 1) : Number(!!input.boost);
      const lift = Number.isFinite(input.liftAxis) ? clamp(input.liftAxis, 0, 1) : Number(!!input.lift);
      if (boost > 0) out.fill(boost, 0, 4);
      if (lift > 0) out.fill(lift, 4, 8);
      return out;
    }

    const pressure = clamp(finite(body.pressure), 0, MAX_PRESSURE) / MAX_PRESSURE;
    const liftForce = MAX_THRUST.lift * pressure;
    const rearForce = MAX_THRUST.rear * pressure;
    const yawForce = MAX_THRUST.yaw * pressure;
    const mass = Math.max(1, finite(body.mass, 2100));
    const cx = clamp(finite(body.comLocal?.x), -1.9, 1.9);
    const cy = finite(body.comLocal?.y, .65);
    const frontArm = 1.93 - cx, rearArm = 1.97 + cx;
    const yawArm = 1.98 - cx;
    // At zero pitch torque, front/rear lift forces must not be equal.
    const frontWeight = rearArm / Math.max(frontArm, rearArm);
    const rearWeight = frontArm / Math.max(frontArm, rearArm);
    const weights = [frontWeight, frontWeight, rearWeight, rearWeight];
    const omega = [finite(body.omega?.x), finite(body.omega?.y), finite(body.omega?.z)];
    // Pilot-facing roll convention: Q/rollLeft commands negative body-X,
    // E/rollRight positive. Flight yaw now shares ground's D=-Y/A=+Y baseline.
    // Finite axis fields come from the gamepad merge; booleans remain the fallback.
    const command = (axisValue, positive, negative) => Number.isFinite(axisValue)
      ? clamp(axisValue, -1, 1)
      : Number(!!positive) - Number(!!negative);
    const axes = [command(input.rollAxis, input.rollRight, input.rollLeft),
      command(input.yawAxis, input.left, input.right),
      command(input.pitchAxis, input.back, input.forward)];
    const rate = clamp(finite(settings.rate, 180), 90, 360) * DEG;
    let requestedLift = Number.isFinite(input.liftAxis) ? clamp(input.liftAxis, 0, 1) : Number(!!input.lift);
    const assisted = !!settings.assisted;
    const wasLanding = this.landingActive;
    this.landingActive = false;
    this.targetAngles.roll = this.targetAngles.pitch = 0;
    for (let i = 0; i < 3; i++) this.targetRates[i] = axes[i] * rate;

    if (assisted && body.q) {
      const up = this._up.set(0, 1, 0).applyQuaternion(body.q).y;
      const descent = -finite(body.v?.y);
      const height = finite(body.altitude, Infinity);
      // Enter on the original braking envelope. Stay through small vertical
      // reversals; leave on >.25 m/s ascent, >8.5 m height or up <= .60.
      // Ground contact and disabling assist bypass this hysteresis immediately.
      this.landingActive = height >= 0 && (wasLanding
        ? up > .60 && height <= 8.5 && descent > -.25
        : up > .65 && height <= 8 && descent > .05);
      if (this.landingActive && up > .65 && height <= 8 && pressure > 1e-9) {
        // Track a firm descent, not a zero-speed stopping point. Continue the
        // feedback at hover/small ascent after entry: negative error cuts lift.
        this.targetDescent = clamp(1.5 + .4375 * height, 1.5, 5);
        const acceleration = 9.80665 / up + 3 * (descent - this.targetDescent);
        const capacity = 2 * liftForce * (frontWeight + rearWeight);
        requestedLift = Math.max(requestedLift, clamp(mass * acceleration / capacity, 0, 1));
        this.assistActive = true;
      }
      if (this.landingActive || (this._landingBlend > 0 && up > .5)) {
        // Same heading-invariant angles as VehiclePhysics.getAttitude().
        const front = this._front.set(1, 0, 0).applyQuaternion(body.q);
        const left = this._left.set(0, 0, 1).applyQuaternion(body.q);
        const roll = Math.atan2(-left.y, up);
        const pitch = Math.asin(clamp(front.y, -1, 1));
        this.targetAngles.roll = axes[0] * LANDING_ANGLE;
        this.targetAngles.pitch = axes[2] * LANDING_ANGLE;
        const rollRate = ANGLE_KP * (this.targetAngles.roll - roll);
        const pitchRate = ANGLE_KP * (this.targetAngles.pitch - pitch);
        const yawRate = this.targetRates[1];
        // Invert the Euler-rate kinematics for BODY rates. In particular,
        // body-Y yaw at a bank must not turn a level-pitch request into a climb.
        const pitchBodyRate = (pitchRate - Math.sin(roll) * yawRate) / Math.cos(roll);
        this._landingRates[0] = clamp(rollRate + Math.tan(pitch) *
          (Math.cos(roll) * yawRate - Math.sin(roll) * pitchBodyRate), -rate, rate);
        this._landingRates[2] = clamp(pitchBodyRate, -rate, rate);
      }
    }
    this.mode = assisted ? (this.landingActive ? 'LANDING' : 'RATE') : 'DIRECT';
    // Blend only the angle outer loop, never initial RATE input or the inner PID.
    // Keep the PID history on transitions to avoid derivative/integral kicks.
    this._landingBlend = assisted ? clamp(this._landingBlend +
      (this.landingActive ? 1 : -1) * dt / LANDING_BLEND_TIME, 0, 1) : 0;
    for (const i of [0, 2]) {
      this.targetRates[i] += (this._landingRates[i] - this.targetRates[i]) * this._landingBlend;
    }
    if (pressure <= 1e-9) {
      this._integral.fill(0);
      this._tracking = false;
      return out;
    }

    const torque = [0, 0, 0];
    const error = [0, 0, 0];
    if (assisted) {
      for (let i = 0; i < 3; i++) {
        error[i] = this.targetRates[i] - omega[i];
        const derivative = this._tracking && dt > 0 ? (omega[i] - this._previous[i]) / dt : 0;
        this._derivative[i] += (derivative - this._derivative[i]) * (dt / (.04 + dt));
        torque[i] = mass * INERTIA[i] *
          (KP * error[i] + KI * this._integral[i] - KD * this._derivative[i]);
        this._previous[i] = omega[i];
      }
      this._tracking = true;
    } else {
      this._integral.fill(0);
      this._tracking = false;
      // A single-axis direct input fires the active lift pair at about .65.
      torque[0] = axes[0] * .325 * 4 * .87 * liftForce;
      torque[1] = axes[1] * .65 * yawArm * yawForce;
      torque[2] = axes[2] * .325 * 2 * (frontArm + rearArm) * liftForce;
    }

    const boostCommand = Number.isFinite(input.boostAxis) ? clamp(input.boostAxis, 0, 1) : Number(!!input.boost);
    if (boostCommand > 0) out.fill(boostCommand, 0, 4);
    const yaw = clamp(torque[1] / (yawArm * yawForce), -1, 1);
    out[8] = Math.max(0, yaw);
    out[9] = Math.max(0, -yaw);
    // r x F: rear +X thrust at y=.66 produces NEGATIVE pitch;
    // Y1's -Z force at y=.61 produces POSITIVE roll about a .65-high COM.
    const rearPitch = -( .66 - cy) * rearForce * (out[0] + out[1] + out[2] + out[3]);
    const yawRoll = -( .61 - cy) * yawForce * yaw;
    const roll = (torque[0] - yawRoll) / (4 * .87 * liftForce);
    const pitch = (torque[2] - rearPitch) / (2 * (frontArm + rearArm) * liftForce);
    const differential = [pitch - roll, pitch + roll, -pitch - roll, -pitch + roll];

    // Find the smallest nonnegative common mode needed by the signed command.
    // Scale only infeasible attitude commands; never invent negative lift jets.
    let minimum = 0;
    for (let i = 0; i < 4; i++) minimum = Math.max(minimum, -differential[i] / weights[i]);
    let peak = 1;
    for (let i = 0; i < 4; i++) peak = Math.max(peak, weights[i] * minimum + differential[i]);
    const scale = 1 / peak;
    minimum *= scale;
    let maximum = Infinity;
    for (let i = 0; i < 4; i++) {
      differential[i] *= scale;
      maximum = Math.min(maximum, (1 - differential[i]) / weights[i]);
    }
    // Preserve pilot/landing lift wherever compatible with the requested torque.
    const common = clamp(requestedLift, minimum, Math.max(minimum, maximum));
    for (let i = 0; i < 4; i++) out[4 + i] = clamp(common * weights[i] + differential[i], 0, 1);

    if (assisted) {
      const achieved = [
        .87 * liftForce * (-out[4] + out[5] - out[6] + out[7]) + yawRoll,
        yawArm * yawForce * yaw,
        liftForce * (frontArm * (out[4] + out[5]) - rearArm * (out[6] + out[7])) + rearPitch
      ];
      // Conditional integration prevents windup from either pressure or allocator
      // saturation, while allowing an existing integral to unwind immediately.
      for (let i = 0; i < 3; i++) {
        if ((torque[i] - achieved[i]) * error[i] <= 1e-6 || this._integral[i] * error[i] < 0) {
          this._integral[i] = clamp(this._integral[i] + error[i] * dt, -rate, rate);
        }
      }
    }
    return out;
  }
}
