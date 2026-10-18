// Run from any directory: node --test /path/to/roadster-lab/scripts/test-gamepad.mjs
// Gamepad merge semantics, sign conventions, interlock, rumble throttling and
// analog/keyboard equivalence against the real physics and controller - no DOM.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  STICK_DEADZONE, TRIGGER_DEADZONE, PITCH_HOLD_THRESHOLD, PAD_BUTTONS,
  applyDeadzone, buttonValue, buttonPressed, computePadState, padEdges,
  mergeControls, GamepadInput
} from '../dist/gamepad-input.js';
import {GamepadRumble} from '../dist/gamepad-rumble.js';
import {Keybinds} from '../dist/keybinds.js';
import {TakeoffPitchLock} from '../dist/takeoff-lock.js';
import {FlightController} from '../dist/controller.js';
import {VehiclePhysics, STEP} from '../dist/physics.js';

const noStorage = () => ({getItem: () => null, setItem: () => {}});
const button = (pressed, value = pressed ? 1 : 0) => ({pressed, value});
/** Standard-layout Gamepad stub: axes [lsX, lsY, rsX, rsY]. */
function fakePad({axes = [0, 0, 0, 0], buttons = {}, id = 'STANDARD TEST PAD'} = {}) {
  const list = [];
  for (let i = 0; i < 18; i++) {
    const raw = buttons[i];
    const value = typeof raw === 'number' ? Math.min(1, Math.max(0, raw)) : raw ? 1 : 0;
    list.push({pressed: value > .5, value});
  }
  return {id, index: 0, connected: true, mapping: 'standard', axes, buttons: list};
}
const base = over => ({
  forward: false, back: false, left: false, right: false,
  rollLeft: false, rollRight: false, lift: false, boost: false, ...over
});

test('deadzone collapses noise and rescales the remainder to full range', () => {
  assert.equal(applyDeadzone(0), 0);
  assert.equal(applyDeadzone(STICK_DEADZONE), 0);
  assert.equal(applyDeadzone(-STICK_DEADZONE), 0);
  assert.equal(applyDeadzone(0.07), 0);
  assert.equal(applyDeadzone(1), 1);
  assert.equal(applyDeadzone(-1), -1);
  assert.equal(applyDeadzone(Number.NaN), 0);
  nearAxis(applyDeadzone((1 + STICK_DEADZONE) / 2), .5, 'midpoint rescales to half');
  nearAxis(applyDeadzone(-.5), -(0.5 - STICK_DEADZONE) / (1 - STICK_DEADZONE), 'sign preserved');
  assert(applyDeadzone(.12, TRIGGER_DEADZONE) > 0, 'trigger deadzone still opens');
  assert.equal(applyDeadzone(.02, TRIGGER_DEADZONE), 0);
  assert(STICK_DEADZONE > 0 && STICK_DEADZONE < 1 && TRIGGER_DEADZONE < STICK_DEADZONE);
});
function nearAxis(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-12, `${message}: expected ${expected}, got ${actual}`);
}

test('standard layout axes follow the keyboard sign conventions', () => {
  const left = computePadState(fakePad({axes: [-1, 0, 0, 0]}));
  const right = computePadState(fakePad({axes: [1, 0, 0, 0]}));
  assert.equal(left.steerAxis, 1, 'stick left ≡ A (positive steer)');
  assert.equal(right.steerAxis, -1, 'stick right ≡ D');
  assert.equal(left.yawAxis, 1, 'stick left ≡ yaw left (+Y body)');
  const back = computePadState(fakePad({axes: [0, 0, 0, 1]}));
  const forward = computePadState(fakePad({axes: [0, 0, 0, -1]}));
  assert.equal(back.pitchAxis, 1, 'stick back ≡ S (pitch up, +Z)');
  assert.equal(forward.pitchAxis, -1, 'stick forward ≡ W (pitch down)');
  assert.equal(back.pitchHeld, true, 'stick beyond threshold counts as held');
  assert.equal(forward.pitchHeld, true);
  const centred = computePadState(fakePad());
  assert.equal(centred.pitchHeld, false);
  assert.equal(computePadState(fakePad({axes: [0, 0, 1, 0]})).rollAxis, 1, 'stick right ≡ E');
  assert.equal(computePadState(fakePad()).rollAxis, 0);
  assert.equal(computePadState(null), null, 'missing pad is not an error');
});

test('buttons map to lift, boost, camera, reset and zoom with value ranges', () => {
  const state = computePadState(fakePad({buttons: {
    [PAD_BUTTONS.lift]: 1, [PAD_BUTTONS.boost]: 1,
    [PAD_BUTTONS.triggerL]: .8, [PAD_BUTTONS.triggerR]: .3
  }}));
  assert.equal(state.buttonLift, 1);
  assert.equal(state.buttonBoost, 1);
  nearAxis(state.triggerL, (.8 - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE), 'LT opens linearly');
  nearAxis(state.triggerR, (.3 - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE), 'RT opens linearly');
  assert.equal(state.triggerL > state.triggerR, true);
  assert.equal(buttonValue(button(false, .4)), .4);
  assert.equal(buttonPressed(button(false, .9)), true, 'analog-heavy press counts as pressed');
  assert.equal(buttonPressed(button(false, .1)), false);
  assert.equal(computePadState(fakePad()).buttons.length, 18);
});

test('edges fire once per physical press and vanish without a pad', () => {
  const pressed = index => Array.from({length: 18}, (_, i) => i === index);
  assert.deepEqual(padEdges(null, null).any, false);
  const first = padEdges([], pressed(PAD_BUTTONS.camera));
  assert.equal(first.camera, true);
  assert.equal(first.reset, false);
  assert.equal(first.any, true);
  const held = padEdges(pressed(PAD_BUTTONS.camera), pressed(PAD_BUTTONS.camera));
  assert.equal(held.camera, false, 'no repeat while held');
  assert.equal(held.any, false);
  const both = padEdges(pressed(PAD_BUTTONS.camera), pressed(PAD_BUTTONS.camera).map((v, i) => i === PAD_BUTTONS.reset || v));
  assert.equal(both.camera, false);
  assert.equal(both.reset, true);
  assert.equal(padEdges([], pressed(PAD_BUTTONS.zoomIn)).zoomIn, true);
  assert.equal(padEdges([], pressed(PAD_BUTTONS.zoomOut)).zoomOut, true);
});

test('keyboard-only merge is bit-identical to the legacy boolean controls', () => {
  for (const mode of ['GROUND', 'FLIGHT']) {
    for (const flags of [{}, {forward: true}, {back: true, left: true}, {right: true, rollLeft: true, rollRight: true, lift: true, boost: true}]) {
      const merged = mergeControls(base(flags), null, {}, mode);
      assert.equal(merged.steerAxis, (flags.left ? 1 : 0) - (flags.right ? 1 : 0), `steer ${mode} ${JSON.stringify(flags)}`);
      assert.equal(merged.driveAxis, flags.forward ? 1 : 0);
      assert.equal(merged.brakeAxis, flags.back ? 1 : 0);
      assert.equal(merged.pitchAxis, (flags.back ? 1 : 0) - (flags.forward ? 1 : 0));
      assert.equal(merged.yawAxis, (flags.left ? 1 : 0) - (flags.right ? 1 : 0));
      assert.equal(merged.rollAxis, (flags.rollRight ? 1 : 0) - (flags.rollLeft ? 1 : 0));
      assert.equal(merged.liftAxis, flags.lift ? 1 : 0);
      assert.equal(merged.boostAxis, flags.boost ? 1 : 0);
      for (const key of Object.keys(flags)) assert.equal(merged[key], flags[key]);
    }
  }
});

test('pad and keyboard combine and clamp; buttons add lift and boost anywhere', () => {
  const pad = computePadState(fakePad({axes: [-1, 0, 0, 1], buttons: {[PAD_BUTTONS.lift]: 1, [PAD_BUTTONS.boost]: 1}}));
  const merged = mergeControls(base({left: true, lift: true}), pad, {}, 'GROUND');
  assert.equal(merged.steerAxis, 1, 'same-direction inputs clamp to full');
  assert.equal(merged.liftAxis, 1, 'keyboard Space + pad A clamp to 1');
  assert.equal(merged.boostAxis, 1);
  const partial = mergeControls(base(), computePadState(fakePad({axes: [-.5, 0, 0, 0]})), {}, 'GROUND');
  nearAxis(partial.steerAxis, (0.5 - STICK_DEADZONE) / (1 - STICK_DEADZONE), 'partial stick stays partial');
});

test('ground mapping: RT throttles, LT brakes, stick steers; flight mapping: RT boosts, LT lifts', () => {
  const triggers = computePadState(fakePad({buttons: {[PAD_BUTTONS.triggerR]: 1, [PAD_BUTTONS.triggerL]: .5}}));
  const ground = mergeControls(base(), triggers, {}, 'GROUND');
  assert.equal(ground.driveAxis, 1, 'RT is throttle on the ground');
  nearAxis(ground.brakeAxis, (.5 - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE));
  assert.equal(ground.boostAxis, 0, 'RT is not boost on the ground');
  const flight = mergeControls(base(), triggers, {}, 'FLIGHT');
  assert.equal(flight.boostAxis, 1, 'RT is boost in flight');
  assert(flight.liftAxis > .4 && flight.liftAxis < .6, `LT is lift in flight: ${flight.liftAxis}`);
  assert.equal(flight.driveAxis, 0, 'triggers never drive wheels in flight');
});

test('flight inversions apply to pad axes exactly once and never touch ground steering', () => {
  const inversions = {pitch: true, yaw: true, roll: true};
  // Right stick down/right; left stick slightly right so the inverted pad yaw
  // and the inverted keyboard yaw do not saturate the +/-1 clamp.
  const pad = computePadState(fakePad({axes: [.6, 0, .4, .7]}));
  const flight = mergeControls(base(), pad, inversions, 'FLIGHT');
  nearAxis(flight.pitchAxis, -pad.pitchAxis, 'pitch inverted in FLIGHT');
  nearAxis(flight.yawAxis, -pad.yawAxis, 'yaw inverted in FLIGHT');
  nearAxis(flight.rollAxis, -pad.rollAxis, 'roll inverted in FLIGHT');
  const ground = mergeControls(base(), pad, inversions, 'GROUND');
  nearAxis(ground.steerAxis, pad.steerAxis, 'ground steering never inverts');
  // Keyboard inversions come from Keybinds.input; both sources share one result.
  const keybinds = new Keybinds(noStorage());
  keybinds.setInversion('pitch', true);
  keybinds.setInversion('yaw', true);
  const keyboard = keybinds.input(new Set(['KeyW', 'KeyA']), 'FLIGHT');
  const both = mergeControls(keyboard, pad, keybinds.inversions, 'FLIGHT');
  nearAxis(both.pitchAxis, 1 - pad.pitchAxis, 'keyboard pitch inversion and pad inversion stack consistently');
  nearAxis(both.yawAxis, -1 - pad.yawAxis, 'yaw stacks as well');
  assert.equal(keybinds.input(new Set(['KeyA']), 'GROUND').left, true, 'ground inputs stay untouched by inversions');
});

test('takeoff interlock blocks a held pad pitch stick until it centres', () => {
  const keybinds = new Keybinds(noStorage());
  const lock = new TakeoffPitchLock();
  assert.equal(lock.update('GROUND', new Set(), keybinds, true), false, 'ground never locks');
  assert.equal(lock.update('FLIGHT', new Set(), keybinds, true), true, 'held stick at transition locks');
  assert.equal(lock.locked, true);
  const filtered = lock.filter({forward: false, back: false, pitchAxis: -.8}, 'FLIGHT');
  assert.equal(filtered.pitchAxis, 0, 'analog pitch is zeroed while locked');
  assert.equal(filtered.forward, false);
  assert.equal(lock.update('FLIGHT', new Set(), keybinds, false), false, 'centre unlocks');
  assert.equal(lock.filter({pitchAxis: -.8}, 'FLIGHT').pitchAxis, -.8, 'pitch returns after centre');
  const late = new TakeoffPitchLock();
  late.update('FLIGHT', new Set(), keybinds, false, 'GROUND');
  late.previousMode = 'GROUND';
  late.update('FLIGHT', new Set(), keybinds, false);
  late.previousMode = 'FLIGHT';
  assert.equal(late.update('FLIGHT', new Set(), keybinds, true), false, 'stick grabbed mid-flight does not lock');
  const keyboardLock = new TakeoffPitchLock();
  keyboardLock.update('GROUND', new Set(), keybinds);
  assert.equal(keyboardLock.update('FLIGHT', new Set(['KeyW']), keybinds, false), true, 'keyboard path unchanged');
  assert.deepEqual([...keyboardLock.blocked], ['KeyW']);
});

test('analog-1 inputs reproduce the keyboard trajectories exactly; partial inputs fall between', () => {
  const scenarios = [
    ['accelerate', {forward: true}, {driveAxis: 1}],
    ['brake', {back: true}, {brakeAxis: 1}],
    ['steer', {left: true}, {steerAxis: 1}]
  ];
  for (const [name, keyboard, analog] of scenarios) {
    const a = new VehiclePhysics(), b = new VehiclePhysics(), c = new VehiclePhysics();
    for (let i = 0; i < 90; i++) { a.step(STEP, keyboard, [], {}); b.step(STEP, analog, [], {}); }
    for (let i = 0; i < 90; i++) c.step(STEP, name === 'accelerate' ? {driveAxis: .5} : analog, [], {});
    for (const axis of ['x', 'y', 'z']) {
      assert(Math.abs(a.p[axis] - b.p[axis]) < 1e-12, `${name}: position.${axis} must match the keyboard run`);
      assert(Math.abs(a.omega[axis] - b.omega[axis]) < 1e-12, `${name}: omega.${axis} must match`);
    }
    assert(Math.abs(a.q.dot(b.q) - 1) < 1e-12, `${name}: orientation must match`);
    if (name === 'accelerate') {
      assert(c.v.length() < a.v.length(), 'half throttle must reach less speed than full');
      assert(c.v.length() > 1, 'half throttle still accelerates');
    }
  }
  const half = new VehiclePhysics();
  for (let i = 0; i < 120; i++) half.step(STEP, {steerAxis: .5}, [], {});
  const full = new VehiclePhysics();
  for (let i = 0; i < 120; i++) full.step(STEP, {steerAxis: 1}, [], {});
  assert(Math.abs(half.steer) < Math.abs(full.steer), 'partial steer commands a smaller angle');
  nearValue(full.steer, .49, .01, 'full steer converges to the keyboard angle');
});
function nearValue(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

test('controller consumes analog axes: linear boost/lift and scaled attitude rates', () => {
  const controller = new FlightController();
  const groundBody = {mode: 'GROUND'};
  const out = controller.update(STEP, groundBody, {boostAxis: .4, liftAxis: .75}, {});
  for (let i = 0; i < 4; i++) assert.equal(out[i], .4, 'rear boost scales linearly');
  for (let i = 4; i < 8; i++) assert.equal(out[i], .75, 'lift pads scale linearly');
  assert.equal(out[8], 0);
  const flightBody = {
    mode: 'FLIGHT', pressure: MAX_PRESSURE_FOR_TEST, q: {x: 0, y: 0, z: 0, w: 1},
    omega: {x: 0, y: 0, z: 0}, v: {x: 0, y: 0, z: 0}, altitude: 40, mass: 2100, comLocal: {x: 0, y: .65, z: 0}
  };
  const rate = 180 * Math.PI / 180;
  controller.update(STEP, flightBody, {rollAxis: .5, yawAxis: 0, pitchAxis: 0, liftAxis: .3, boostAxis: .25}, {assisted: false, rate: 180});
  nearValue(controller.targetRates[0], .5 * rate, 1e-9, 'roll axis scales the commanded rate');
  nearValue(controller.targetRates[1], 0, 1e-9, 'yaw centred');
  nearValue(controller.targetRates[2], 0, 1e-9, 'pitch centred');
  assert.equal(controller.throttles[0], .25, 'partial boost reaches the rear nozzles in flight');
  // Boolean-only callers keep the legacy full-deflection behaviour.
  controller.reset();
  const boolOut = controller.update(STEP, groundBody, {boost: true, lift: true}, {});
  assert.equal(boolOut[0], 1);
  assert.equal(boolOut[4], 1);
});
const MAX_PRESSURE_FOR_TEST = 80e6;

test('rumble pulses are cooldown-throttled, intensity-scaled and null-safe', () => {
  let clock = 0;
  const pulses = [];
  const rumble = new GamepadRumble({now: () => clock, vibrate: (gamepad, options) => { pulses.push({gamepad, ...options}); return true; }});
  const pad = fakePad();
  assert.equal(rumble.pulse(null, 'impact', 1), false, 'no pad, no pulse');
  assert.equal(rumble.pulse(pad, 'unknown-kind', 1), false);
  assert.equal(rumble.pulse(pad, 'impact', 0), false, 'zero intensity never fires');
  assert.equal(rumble.pulse(pad, 'impact', 1), true);
  assert.equal(rumble.pulse(pad, 'impact', 1), false, 'cooldown blocks immediate repeat');
  clock += 500;
  assert.equal(rumble.pulse(pad, 'impact', .5), true, 'cooldown expires');
  nearValue(pulses.at(-1).strongMagnitude, .9 * .5, 1e-9, 'intensity scales the strong motor');
  clock += 500;
  assert.equal(rumble.pulse(pad, 'crash', 1), true);
  const crashPulse = pulses.at(-1);
  assert.equal(crashPulse.duration, 520);
  assert.equal(crashPulse.strongMagnitude, 1);
  assert.equal(rumble.pulse(pad, 'crash', 1), false, 'crash cooldown is long');
  rumble.reset();
  assert.equal(rumble.pulse(pad, 'crash', 1), true, 'reset clears cooldowns');
});

test('rumble update derives crash, launch, touchdown and boost pulses from sim state', () => {
  let clock = 0;
  const kinds = [];
  const rumble = new GamepadRumble({now: () => clock, vibrate: () => { kinds.push('pulse'); return true; }});
  const pad = fakePad();
  rumble.update(null, {mode: 'FLIGHT', previousMode: 'GROUND', events: [{g: 3}]});
  assert.equal(kinds.length, 0, 'disconnected pad stays silent');
  rumble.update(pad, {mode: 'GROUND', previousMode: 'GROUND'});
  assert.equal(kinds.length, 0, 'steady ground state is silent');
  rumble.update(pad, {mode: 'FLIGHT', previousMode: 'GROUND'});
  assert.equal(kinds.length, 1, 'takeoff launch pulse');
  rumble.update(pad, {mode: 'FLIGHT', previousMode: 'FLIGHT'});
  assert.equal(kinds.length, 1, 'launch fires once per transition');
  clock += 1000;
  rumble.update(pad, {mode: 'FLIGHT', previousMode: 'FLIGHT', events: [{g: 2}, {g: 9}]});
  assert.equal(kinds.length, 2, 'first touchdown event pulses within its cooldown window');
  clock += 1000;
  rumble.update(pad, {mode: 'FLIGHT', previousMode: 'FLIGHT', events: [{g: 0}]});
  assert.equal(kinds.length, 2, 'a zero-g event never rattles the pad');
  rumble.update(pad, {mode: 'FLIGHT', previousMode: 'FLIGHT', events: [{g: 3}]});
  assert.equal(kinds.length, 3, 'second impact window opens');
  clock += 1000;
  rumble.update(pad, {mode: 'GROUND', previousMode: 'GROUND', crashed: true, previousCrashed: false});
  assert.equal(kinds.length, 4, 'crash edge pulses');
  rumble.update(pad, {mode: 'GROUND', previousMode: 'GROUND', crashed: true, previousCrashed: true});
  assert.equal(kinds.length, 4, 'held crash state does not repeat');
  clock += 1000;
  rumble.update(pad, {mode: 'GROUND', previousMode: 'GROUND', boosting: true});
  assert.equal(kinds.length, 5, 'boost pulses');
  rumble.update(pad, {mode: 'GROUND', previousMode: 'GROUND', boosting: true});
  assert.equal(kinds.length, 5, 'boost respects its cooldown');
  clock += 500;
  rumble.update(pad, {mode: 'GROUND', previousMode: 'GROUND', boosting: true});
  assert.equal(kinds.length, 6, 'boost keeps pulsing while held');
});

test('GamepadInput polls, reports edges once and tracks connect/disconnect', async () => {
  const statuses = [];
  const input = new GamepadInput({onStatus: status => statuses.push(status)});
  let pads = [];
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'getGamepads');
  Object.defineProperty(globalThis.navigator, 'getGamepads', {value: () => pads, configurable: true});
  try {
    input.start();
    assert.equal(input.connected, false);
    assert.equal(statuses.length, 0, 'no pad at start is not an event');
    pads = [fakePad({buttons: {[PAD_BUTTONS.camera]: 1}})];
    const first = input.poll();
    assert.equal(input.connected, true);
    assert.equal(first.state.id, 'STANDARD TEST PAD');
    assert.equal(first.edges.camera, true, 'first poll reports the held press as an edge');
    const second = input.poll();
    assert.equal(second.edges.camera, false, 'held button does not re-fire');
    pads = [];
    const gone = input.poll();
    assert.equal(gone.state, null);
    assert.equal(input.connected, false);
    assert.equal(statuses.at(-1).connected, false, 'poll detects a silent disconnect');
    pads = [fakePad()];
    input.start();
    assert.equal(statuses.at(-1).connected, true, 'start() adopts an already-connected pad');
    assert.equal(statuses.at(-1).id, 'STANDARD TEST PAD');
  } finally {
    if (original) Object.defineProperty(globalThis.navigator, 'getGamepads', original);
    else delete globalThis.navigator.getGamepads;
  }
});
