const THRUSTER_IDS = ['R1', 'R2', 'R3', 'R4', 'L1', 'L2', 'L3', 'L4', 'Y1', 'Y2'];
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degrees = value => finite(value) * 180 / Math.PI;
const signed = (value, digits = 1) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

/** Mount the cockpit. Angles are radians, pressure is Pa, and speeds are m/s. */
export function createUI({onReset = () => {}, onRefill = () => {}, onSettings = () => {}, onRecord = () => {}, onReplay = () => {}, onExitReplay = () => {}} = {}) {
  const settings = {assisted: true, rate: 180, invincible: false, infinite: false, bulletTime: false};
  const root = document.createElement('div');
  root.id = 'sim-hud';
  root.innerHTML = `
    <header class="sim-header">
      <div class="sim-brand"><span class="sim-eyebrow">EXPERIMENTAL VEHICLE PROGRAM / 01</span><h1>ROADSTER <span>/ ROCKET LAB</span></h1></div>
      <div class="sim-mission"><span class="sim-status-dot"></span><strong id="sim-mode">GROUND</strong><span id="sim-assist-status">ASSIST READY</span><span id="sim-camera-view">VIEW: 3/4 CHASE</span><span id="sim-gamepad" class="sim-gamepad" hidden></span><span id="sim-record-status" hidden>REC</span><span id="sim-slow-mo" hidden>SLOW-MO 0.5x</span><time id="sim-time">T+ 00:00</time></div>
    </header>
    <div id="sim-pitch-warning" class="sim-pitch-warning" role="alert" aria-live="assertive" hidden></div>
    <aside class="sim-left" aria-label="Vehicle telemetry">
      <section class="sim-panel sim-speed-panel">
        <div class="sim-panel-heading"><h2>VELOCITY</h2><span>01 / INS</span></div>
        <div class="sim-speed"><strong id="sim-speed">000</strong><span>km/h</span></div>
        <div class="sim-speed-secondary"><span><b id="sim-mph">0</b> mph</span><span id="sim-motion">ON THE DECK</span></div>
        <div class="sim-speed-track"><i id="sim-speed-bar"></i></div>
      </section>
      <section class="sim-panel sim-pressure-panel">
        <div class="sim-panel-heading"><h2>COLD GAS</h2><span id="sim-gas-status">NOMINAL</span></div>
        <div class="sim-pressure-value"><strong id="sim-pressure">0.0</strong><span>MPa</span><b id="sim-gas">0.0 <small>kg</small></b></div>
        <div id="sim-pressure-meter" class="sim-pressure-track" role="meter" aria-label="Tank pressure" aria-valuemin="0" aria-valuemax="80" aria-valuenow="0"><i id="sim-pressure-bar"></i></div>
        <div class="sim-scale"><span>0</span><span>40</span><span>80 MPa</span></div>
        <div class="sim-g-row"><span>LOAD FACTOR</span><strong><b id="sim-g">1.00</b> <small>G</small></strong></div>
      </section>
      <div class="sim-test-note"><span class="sim-orange-dot"></span> CLOSED COURSE · PHYSICS SANDBOX</div>
    </aside>
    <aside class="sim-right" aria-label="Flight instruments">
      <section class="sim-panel sim-flight-panel">
        <div class="sim-panel-heading"><h2>ATTITUDE / AGL</h2><span>02 / IMU</span></div>
        <div class="sim-attitude-row">
          <div id="sim-horizon" class="sim-horizon" role="img" aria-label="Artificial horizon: level">
            <div id="sim-horizon-bank" class="sim-horizon-bank"><div id="sim-horizon-pitch" class="sim-horizon-pitch"><div class="sim-horizon-line"></div><div class="sim-pitch-lines"></div></div></div>
            <span class="sim-bank-marker"></span><span class="sim-aircraft"></span><span class="sim-horizon-label">ATT</span>
          </div>
          <div class="sim-flight-values"><div><span>HEIGHT <small>m</small></span><strong id="sim-altitude">0.0</strong></div><div><span>VERTICAL <small>m/s</small></span><strong id="sim-vertical">+0.0</strong></div></div>
        </div>
        <div class="sim-angle-row"><span>PITCH <b id="sim-pitch">+0°</b></span><span>ROLL <b id="sim-roll">+0°</b></span></div>
      </section>
      <section class="sim-panel sim-thruster-panel">
        <div class="sim-panel-heading"><h2>THRUSTER ARRAY</h2><span id="sim-thruster-count">00 / 10</span></div>
        <div class="sim-thrusters">${THRUSTER_IDS.map((id, i) => `<div id="sim-thruster-${id}" class="sim-thruster" role="meter" aria-label="Thruster ${id}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="sim-thruster-track"><i id="sim-throttle-${i}"></i></div><span>${id}</span></div>`).join('')}</div>
        <div class="sim-array-legend"><span>REAR ×4</span><span>LIFT ×4</span><span>YAW ×2</span></div>
      </section>
    </aside>
    <section id="sim-landing" class="sim-landing" role="status" aria-live="polite" aria-atomic="true" hidden>
      <div class="sim-landing-heading"><span id="sim-landing-grade">TOUCHDOWN REPORT</span><button id="sim-landing-close" type="button" aria-label="Dismiss landing report">×</button></div>
      <h2 id="sim-landing-title">Butter Landing</h2><p id="sim-landing-reason"></p>
      <div class="sim-landing-stats"><span>V/S <b id="sim-landing-speed"></b></span><span>LOAD <b id="sim-landing-g"></b></span><span>TILT <b id="sim-landing-tilt"></b></span></div>
    </section>
    <footer class="sim-footer">
      <section class="sim-panel sim-controls" aria-label="Flight settings">
        <div class="sim-control-top"><span class="sim-eyebrow">FLIGHT CONTROL</span><div class="sim-mode-selector" role="group" aria-label="Control mode"><button id="sim-assisted" class="sim-selected" type="button" aria-pressed="true">ASSISTED</button><button id="sim-direct" type="button" aria-pressed="false">DIRECT</button></div></div>
        <div class="sim-rate-row"><label for="sim-rate">ATTITUDE RATE</label><input id="sim-rate" type="range" min="90" max="360" step="10" value="180"><output id="sim-rate-value" for="sim-rate">180°/s</output></div>
        <div class="sim-options"><label><input id="sim-invincible" type="checkbox"><span>Invincible</span></label><label><input id="sim-infinite" type="checkbox"><span>Infinite gas</span></label><label><input id="sim-bullet-time" type="checkbox"><span>Bullet Time</span></label><button id="sim-refill" type="button">REFILL <span>↗</span></button><button id="sim-reset" type="button">RESET <kbd data-key-action="reset">R</kbd></button></div>
        <div class="sim-playback-controls"><button id="sim-record" type="button" aria-pressed="false">● Record</button><button id="sim-replay" type="button" disabled>▶ Play Replay</button><button id="sim-exit-replay" type="button" hidden>Exit Replay / Esc</button><output id="sim-replay-progress" hidden></output></div>
        <button id="sim-keybinds" type="button">KEYBINDS / CUSTOMIZE CONTROLS</button>
      </section>
      <details class="sim-panel sim-help" open>
        <summary>FLIGHT MANUAL <span>ESC TO DRIVE / HIDE −</span></summary>
        <div class="sim-key-grid"><div><kbd data-key-action="forward">W</kbd><kbd data-key-action="back">S</kbd><span>Accelerate / brake <small>Ground</small></span></div><div><kbd data-key-action="pitchDown">W</kbd><kbd data-key-action="pitchUp">S</kbd><span>Nose down / up <small>Flight</small></span></div><div><kbd data-key-action="left">A</kbd><kbd data-key-action="right">D</kbd><span>Steer / yaw</span></div><div><kbd data-key-action="rollLeft">Q</kbd><kbd data-key-action="rollRight">E</kbd><span>Roll left / right</span></div><div><kbd data-key-action="lift">Space</kbd><span>Lift</span><kbd data-key-action="boost">Shift</kbd><span>Boost</span></div><div><kbd data-key-action="camera">C</kbd><span>Camera</span><kbd data-key-action="reset">R</kbd><span>Reset</span></div><div><kbd>LS</kbd><kbd>RT/LT</kbd><span>Steer / throttle / brake <small>Gamepad</small></span></div><div><kbd>RS</kbd><kbd>Y · View</kbd><span>Camera / roll + pitch <small>Gamepad</small></span></div></div>
      </details>
    </footer>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector(`#sim-${id}`);
  const nodes = Object.fromEntries([...root.querySelectorAll('[id]')].map(node => [node.id.slice(4), node]));
  const listeners = [];
  let disposed = false;
  let landingTimer;
  const listen = (node, type, handler) => {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  };
  const text = (id, value) => {
    if (nodes[id].textContent !== String(value)) nodes[id].textContent = value;
  };
  const publish = () => onSettings({...settings});
  const setAssisted = value => {
    settings.assisted = value;
    for (const [id, active] of [['assisted', value], ['direct', !value]]) {
      nodes[id].classList.toggle('sim-selected', active);
      nodes[id].setAttribute('aria-pressed', String(active));
    }
    publish();
  };
  listen($('assisted'), 'click', () => setAssisted(true));
  listen($('direct'), 'click', () => setAssisted(false));
  listen($('rate'), 'input', event => {
    settings.rate = clamp(finite(Number(event.target.value), 180), 90, 360);
    text('rate-value', `${settings.rate}°/s`);
    publish();
  });
  for (const [id,key] of [['invincible','invincible'],['infinite','infinite'],['bullet-time','bulletTime']]) {
    listen($(id), 'change', event => { settings[key] = event.target.checked; publish(); });
  }
  const dismissLanding = () => { clearTimeout(landingTimer); nodes.landing.hidden = true; };
  listen($('landing-close'), 'click', dismissLanding);
  listen($('reset'), 'click', () => { dismissLanding(); onReset(); });
  listen($('refill'), 'click', () => onRefill());
  listen($('record'), 'click', () => onRecord());
  listen($('replay'), 'click', () => onReplay());
  listen($('exit-replay'), 'click', () => onExitReplay());
  // Keep cockpit keyboard interactions from also commanding the vehicle.
  for (const type of ['keydown', 'keyup']) listen(root, type, event => {
    if (event.target.matches('input, button, summary')) event.stopPropagation();
  });

  function update(state = {}) {
    if (disposed) return;
    const speed = Math.abs(finite(state.speed));
    const pressure = Math.max(0, finite(state.pressure)) / 1e6;
    const pitch = degrees(state.pitch);
    const roll = ((degrees(state.roll) + 180) % 360 + 360) % 360 - 180;
    const crashed = Boolean(state.crashed);
    root.classList.toggle('sim-crashed', crashed);
    root.classList.toggle('sim-low-gas', pressure < 5);
    text('camera-view', `VIEW: ${state.cameraView || '3/4 CHASE'}`);
    nodes.gamepad.hidden = !state.gamepad;
    if (state.gamepad) text('gamepad', `PAD: ${state.gamepad}`);
    nodes['slow-mo'].hidden = !state.slowMo;
    text('record-status', state.replaying ? 'REPLAYING' : `● REC ${Math.max(0,finite(state.recordSeconds)).toFixed(1)}s`);
    nodes['record-status'].hidden = !state.recording && !state.replaying;
    nodes.record.disabled = Boolean(state.replaying);
    nodes.record.setAttribute('aria-pressed',String(Boolean(state.recording)));
    text('record', state.recording ? '■ Stop Recording' : '● Record');
    nodes.replay.disabled = !state.replayReady || Boolean(state.replaying) || Boolean(state.recording);
    nodes['exit-replay'].hidden = !state.replaying;
    nodes['replay-progress'].hidden = !state.replaying;
    text('replay-progress', `${Math.round(clamp(finite(state.replayProgress),0,1)*100)}%`);
    text('mode', state.replaying ? 'REPLAYING' : crashed ? 'CRASHED' : state.mode === 'FLIGHT' ? 'FLIGHT' : 'GROUND');
    text('assist-status', settings.assisted ? (state.controlMode === 'LANDING' && state.mode === 'FLIGHT' ? 'LANDING ASSIST' : state.assistActive ? 'ASSIST ACTIVE' : 'ASSIST READY') : 'DIRECT CONTROL');
    nodes['pitch-warning'].hidden = !state.pitchLocked || state.mode !== 'FLIGHT';
    text('pitch-warning', `RELEASE [${state.pitchLockKeys || 'PITCH KEY'}] TO ENGAGE PITCH`);
    nodes['assist-status'].classList.toggle('sim-active', Boolean(state.assistActive));
    const seconds = Math.max(0, Math.floor(finite(state.time)));
    text('time', `T+ ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    text('speed', String(Math.round(speed * 3.6)).padStart(3, '0'));
    text('mph', Math.round(speed * 2.236936));
    text('motion', crashed ? 'TEST TERMINATED' : state.mode === 'FLIGHT' ? 'FREE FLIGHT' : 'ON THE DECK');
    nodes['speed-bar'].style.transform = `scaleX(${clamp(speed * 3.6 / 400, 0, 1)})`;
    text('pressure', pressure.toFixed(1));
    nodes.gas.innerHTML = `${Math.max(0, finite(state.gas)).toFixed(1)} <small>kg</small>`;
    nodes['pressure-bar'].style.transform = `scaleX(${clamp(pressure / 80, 0, 1)})`;
    nodes['pressure-meter'].setAttribute('aria-valuenow', String(clamp(pressure, 0, 80)));
    nodes['pressure-meter'].setAttribute('aria-valuetext', `${pressure.toFixed(1)} megapascals`);
    text('gas-status', settings.infinite ? 'UNLIMITED' : pressure < 0.2 ? 'DEPLETED' : pressure < 5 ? 'LOW PRESSURE' : 'NOMINAL');
    text('g', finite(state.g, 1).toFixed(2));
    nodes.g.classList.toggle('sim-warning', Math.abs(finite(state.g, 1)) > 4);
    text('altitude', Math.max(0, finite(state.altitude)).toFixed(1));
    text('vertical', signed(finite(state.verticalSpeed)));
    text('pitch', `${signed(pitch, 0)}°`);
    text('roll', `${signed(roll, 0)}°`);
    nodes['horizon-bank'].style.transform = `rotate(${-roll}deg)`;
    nodes['horizon-pitch'].style.transform = `translateY(${clamp(pitch, -90, 90) * 0.8}px)`;
    nodes.horizon.setAttribute('aria-label', `Artificial horizon: pitch ${pitch.toFixed(0)} degrees, roll ${roll.toFixed(0)} degrees`);
    let active = 0;
    THRUSTER_IDS.forEach((id, i) => {
      const throttle = clamp(finite(state.throttles?.[i]), 0, 1);
      nodes[`throttle-${i}`].style.transform = `scaleY(${throttle})`;
      nodes[`thruster-${id}`].classList.toggle('sim-firing', throttle > 0.01);
      nodes[`thruster-${id}`].setAttribute('aria-valuenow', String(Math.round(throttle * 100)));
      if (throttle > 0.01) active++;
    });
    text('thruster-count', `${String(active).padStart(2, '0')} / 10`);
  }

  function landing(event = {}) {
    if (disposed) return;
    clearTimeout(landingTimer);
    const crash = /crash|fail|wreck/i.test(`${event.grade || ''} ${event.title || ''}`);
    nodes.landing.classList.toggle('sim-landing-crash', crash);
    text('landing-grade', `${crash ? 'IMPACT REPORT' : 'TOUCHDOWN REPORT'}${event.grade ? ` / ${String(event.grade).toUpperCase()}` : ''}`);
    text('landing-title', event.title || (crash ? 'Crash Landing' : 'Touchdown'));
    text('landing-reason', event.reason || (crash ? 'Reset the vehicle to run another test.' : 'Contact confirmed. Ready for the next flight.'));
    text('landing-speed', `${signed(finite(event.verticalSpeed))} m/s`);
    text('landing-g', `${finite(event.g).toFixed(1)} G`);
    text('landing-tilt', `${Math.abs(degrees(event.tilt)).toFixed(1)}°`);
    nodes.landing.hidden = false;
    if (!crash) landingTimer = setTimeout(dismissLanding, 8500);
  }

  update();
  publish();
  return {update, landing, dismissLanding, dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(landingTimer);
    listeners.forEach(remove => remove());
    root.remove();
  }};
}
