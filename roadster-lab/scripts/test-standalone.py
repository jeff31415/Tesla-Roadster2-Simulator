"""Offline file:// smoke test of the single-HTML deliverable; no HTTP server.

From any directory: python3 /path/to/roadster-lab/scripts/test-standalone.py
Optional test dependency: python3 -m pip install playwright
Install the browser once: python3 -m playwright install chromium
Build first with: npm --prefix roadster-lab run build:single
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BINDINGS = {
    'forward': 'KeyW', 'back': 'KeyS', 'left': 'KeyA', 'right': 'KeyD',
    'pitchDown': 'KeyW', 'pitchUp': 'KeyS', 'rollLeft': 'KeyQ', 'rollRight': 'KeyE',
    'lift': 'Space', 'boost': 'ShiftLeft', 'reset': 'KeyR', 'camera': 'KeyC',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path,
                        default=ROOT / 'dist' / 'roadster-rocket-standalone.html',
                        help='built standalone HTML (default: %(default)s)')
    args = parser.parse_args()
    source = args.html.expanduser().resolve()
    if not source.is_file():
        parser.error(f'HTML not found: {source}\nBuild it with: npm --prefix "{ROOT}" run build:single')
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        parser.error('Optional test dependency missing. Run: python3 -m pip install playwright\n'
                     'Then: python3 -m playwright install chromium')

    started = time.monotonic()
    checks, errors, failed, secondary, http_requests, blocked = [], [], [], [], [], []
    # Copy exactly one artifact: no source modules, assets, or neighboring dist files.
    with tempfile.TemporaryDirectory(prefix='roadster offline 雪 ') as directory:
        target = Path(directory) / 'roadster rocket 独立.html'
        shutil.copyfile(source, target)
        assert list(Path(directory).iterdir()) == [target], 'fixture must contain only the HTML'
        modules = re.findall(r'^// ([\w./-]+\.js)$', target.read_text(encoding='utf-8'), re.MULTILINE)
        url = target.as_uri()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
            context = browser.new_context(
                viewport={'width': 1280, 'height': 900}, offline=True, service_workers='block')
            context.set_default_timeout(8000)
            context.on('pageerror', lambda error: errors.append(str(error)))
            context.on('requestfailed', lambda request: failed.append({
                'url': request.url, 'failure': request.failure}))

            def record_request(request):
                if request.url.startswith(('http://', 'https://')):
                    http_requests.append(request.url)
                if request.url != url and not request.url.startswith(('data:', 'blob:')):
                    secondary.append(request.url)

            def abort_http(route):
                blocked.append(route.request.url)
                route.abort()

            context.on('request', record_request)
            context.route(re.compile(r'^https?://', re.IGNORECASE), abort_http)
            page = context.new_page()
            # Gate only RAF during replay assertions, so a .3 s take cannot finish between
            # protocol round trips. Normal simulation uses the browser's real frame clock.
            page.add_init_script('''(() => {
                const raf = window.requestAnimationFrame.bind(window);
                window.__pauseFrames = false;
                window.requestAnimationFrame = callback => {
                    if (window.__pauseFrames) { window.__pendingFrame = callback; return 0; }
                    return raf(now => {
                        window.__frameNow = now;
                        if (window.__pauseFrames) window.__pendingFrame = callback;
                        else callback(now);
                    });
                };
                window.__stepFrame = () => {
                    const callback = window.__pendingFrame;
                    if (!callback) throw new Error('No pending animation frame');
                    window.__pendingFrame = null;
                    window.__frameNow += 100;
                    callback(window.__frameNow);
                };
            })()''')

            def check(name, expression, prerequisite=True):
                assert prerequisite and page.evaluate(expression), name
                checks.append(name)
                print(f'PASS: {name}', flush=True)

            def focus_viewport():
                page.evaluate("document.querySelector('#viewport').focus()")

            def click(selector):
                # Real, hit-tested mouse input without locator compositor waits on SwiftShader.
                point = page.evaluate('''selector => {
                    const node = document.querySelector(selector);
                    if (!node || node.disabled) throw new Error(`Missing/disabled control: ${selector}`);
                    const r = node.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2;
                    if (!r.width || !r.height || !node.contains(document.elementFromPoint(x,y)))
                        throw new Error(`UI control hidden/obscured: ${selector}`);
                    return {x,y};
                }''', selector)
                page.mouse.click(point['x'], point['y'])

            def wait_sim(seconds):
                # Software WebGL can be slow: wait on the fixed-step clock, not wall time.
                end = page.evaluate('rocketLab.time') + seconds
                page.wait_for_function('end => rocketLab.time >= end', arg=end)

            def close_keybinds():
                click('#sim-keybind-done')
                page.wait_for_function('''!document.querySelector('#sim-keybind-dialog').open &&
                    document.activeElement.id === 'viewport' ''')

            try:
                print(f'Opening offline, isolated artifact: {url}', flush=True)
                page.goto(url, wait_until='load')
                page.wait_for_function('!!window.rocketLab', timeout=30000)
                # Keep real WebGL and CSS layout; reduce software rendering cost, not simulation.
                page.evaluate('''() => { rocketLab.scene.onBeforeRender = renderer => {
                    renderer.shadowMap.enabled = false;
                    if (renderer.getPixelRatio() !== .25) renderer.setPixelRatio(.25);
                }; }''')
                page.wait_for_function('''rocketLab.frame > 2 &&
                    document.querySelector('#viewport canvas').width === innerWidth / 4''', timeout=30000)
                check('isolated file URL renders a live WebGL canvas', '''() => {
                    const canvas = document.querySelector('#viewport canvas');
                    return location.protocol === 'file:' && document.body.contains(canvas) &&
                        canvas.width > 0 && canvas.height > 0 && rocketLab.frame > 2;
                }''')
                check('21 bundled modules initialize physics, world, UI, camera, time scale, playback and gamepad', '''() => {
                    const lab = rocketLab;
                    return !!(lab.body && lab.controller && lab.model.car && lab.scene && lab.world &&
                        lab.npcs && lab.audio && lab.ui && lab.keybindPanel && lab.pitchLock) &&
                        lab.body.throttles.length === 10 && Number.isFinite(lab.body.mass) &&
                        ['cycle','update','rotate','zoom'].every(key => typeof lab.cameraRig?.[key] === 'function') &&
                        ['startRecording','record','onReset','start','advance','exit'].every(
                            key => typeof lab.playback?.[key] === 'function') &&
                        typeof lab.pad?.poll === 'function' && typeof lab.pad?.start === 'function' &&
                        typeof lab.rumble?.update === 'function' &&
                        typeof lab.exitReplay === 'function' && lab.settings.bulletTime === false &&
                        lab.cameraRig.mode === 0 && !lab.playback.recording && !lab.playback.playing;
                }''', prerequisite=len(modules) == 21 and len(set(modules)) == 21 and
                      {'camera-rig.js', 'time-scale.js', 'playback.js', 'gamepad-input.js', 'gamepad-rumble.js'}.issubset(modules))
                check('initial telemetry reports ground and 80 MPa', '''
                    rocketLab.body.mode === 'GROUND' && rocketLab.body.pressure === 80000000 &&
                    document.querySelector('#sim-pressure').textContent === '80.0' &&
                    document.querySelector('#sim-pressure-meter').getAttribute('aria-valuenow') === '80' &&
                    document.querySelectorAll('.sim-thruster').length === 10''')
                check('expanded world has four grid intersections, 25 rendered batches and six NPCs', '''() => {
                    const {world,npcs,scene} = rocketLab;
                    return world.intersections.length === 4 && world.intersections.every((tile,i) =>
                        tile.id === i && tile.x === (i%2)*480 && tile.z === Math.floor(i/2)*480) &&
                        world.batchCount === 25 && world.root.parent === scene &&
                        world.root.children.filter(node => node.isInstancedMesh).length === 25 &&
                        npcs.cars.length === 6 && npcs.group.children.length === 6 &&
                        npcs.group.parent === scene;
                }''')

                focus_viewport()
                page.keyboard.down('w')
                wait_sim(.5)
                page.wait_for_function("Number(document.querySelector('#sim-speed').textContent) > 0")
                check('real W input accelerates the body and speed HUD', '''
                    rocketLab.input().forward && rocketLab.body.v.x > .5 &&
                    Number(document.querySelector('#sim-speed').textContent) > 0''')
                page.keyboard.up('w')
                page.keyboard.down('Shift')
                wait_sim(.25)
                page.wait_for_function("document.querySelectorAll('.sim-thruster.sim-firing').length >= 4")
                check('real Shift fires rear thrusters and consumes pressure', '''
                    rocketLab.input().boost && rocketLab.body.throttles.slice(0,4).every(x => x > .9) &&
                    rocketLab.body.pressure < 80000000 &&
                    Number(document.querySelector('#sim-pressure').textContent) < 80''')
                page.keyboard.up('Shift')
                # Seed an actual pending touchdown to test clearing, not just hiding a report.
                page.evaluate('''() => {
                    const b = rocketLab.body;
                    b.reset(); b.p.y = .79499; b.v.y = -1; b.flightArmed = true; b.mode = 'FLIGHT';
                    b.step(1/60);
                    if (!b.pending) throw new Error('Expected pending touchdown');
                    b.crashed = true; rocketLab.ui.landing({grade:'CRASH'});
                }''')
                page.keyboard.press('r')
                wait_sim(.2)
                check('real R resets pressure, motion, controls and pending crash/report', '''
                    !rocketLab.body.crashed && !rocketLab.body.pending && !rocketLab.body.events.length &&
                    rocketLab.body.mode === 'GROUND' && rocketLab.body.pressure === 80000000 &&
                    Math.abs(rocketLab.body.v.x) < .01 && rocketLab.keys.size === 0 &&
                    !Object.values(rocketLab.input()).some(Boolean) &&
                    document.querySelector('#sim-landing').hidden''')

                # Keyboard camera cycling must reach Orbit, without diagnostic setters.
                for mode in (1, 2, 3):
                    page.keyboard.press('c')
                    assert page.evaluate('rocketLab.cameraRig.mode') == mode, 'C camera cycle order'
                check('three real C presses cycle chase, top-down and Orbit with HUD', '''
                    rocketLab.cameraRig.name === 'ORBIT' &&
                    document.querySelector('#sim-camera-view').textContent === 'VIEW: ORBIT' ''')
                orbit_before = page.evaluate('''({theta:rocketLab.cameraRig.theta,
                    radius:rocketLab.cameraRig.radius})''')
                # The center of the canvas is clear of cockpit panels at this viewport size.
                page.mouse.move(640, 380)
                page.mouse.down()
                page.mouse.move(730, 410)
                page.mouse.up()
                page.mouse.wheel(0, -180)
                page.wait_for_function('''before => Math.abs(rocketLab.cameraRig.theta-before.theta) > .1 &&
                    rocketLab.cameraRig.radius < before.radius''', arg=orbit_before)
                page.keyboard.down('w')
                check('real Orbit drag/wheel change theta/radius while keyboard driving remains active', '''
                    rocketLab.cameraRig.mode === 3 && rocketLab.cameraRig.pointers.size === 0 &&
                    document.activeElement.id === 'viewport' && rocketLab.input().forward''')
                page.keyboard.up('w')
                page.keyboard.press('c')
                page.keyboard.press('r')

                page.keyboard.down('w')
                click('#sim-keybinds')
                check('keybind modal opens with 12 actions and suppresses held controls', '''
                    document.querySelector('#sim-keybind-dialog').matches(':modal') &&
                    document.querySelectorAll('#sim-keybind-dialog button[data-bind]').length === 12 &&
                    rocketLab.keys.size === 0 && !Object.values(rocketLab.input()).some(Boolean)''')
                page.keyboard.up('w')
                click('button[data-bind="forward"]')
                page.keyboard.press('i')
                check('ground I rebind updates panel and HUD without changing flight W', '''
                    rocketLab.keybinds.bindings.forward === 'KeyI' &&
                    rocketLab.keybinds.bindings.pitchDown === 'KeyW' &&
                    document.querySelector('[data-bind="forward"]').textContent === 'I' &&
                    document.querySelector('[data-key-action="forward"]').textContent === 'I' ''')
                close_keybinds()
                page.keyboard.down('w')
                old_w_inactive = page.evaluate('!rocketLab.input().forward')
                page.keyboard.up('w')
                page.keyboard.down('i')
                check('closing modal restores focus; I drives and old W does not', '''
                    document.activeElement.id === 'viewport' && rocketLab.input().forward''',
                    prerequisite=old_w_inactive)
                page.keyboard.up('i')
                click('#sim-keybinds')
                click('#sim-invert-pitch')
                check('pitch inversion swaps flight commands only, never ground throttle', '''() => {
                    const binds = rocketLab.keybinds;
                    const ground = binds.input(new Set(['KeyI']), 'GROUND');
                    const flight = binds.input(new Set(['KeyW']), 'FLIGHT');
                    return binds.inversions.pitch && document.querySelector('#sim-invert-pitch').checked &&
                        ground.forward && !ground.back && flight.back && !flight.forward;
                }''')
                click('#sim-keybind-defaults')
                check('Restore Defaults resets all bindings, inversions and HUD', f'''() => {{
                    const expected = {json.dumps(DEFAULT_BINDINGS)};
                    const label = code => code === 'ShiftLeft' ? 'Shift' : code.replace(/^Key/, '');
                    return Object.entries(expected).every(([action,code]) =>
                        rocketLab.keybinds.bindings[action] === code &&
                        document.querySelector(`[data-bind="${{action}}"]`).textContent === label(code) &&
                        [...document.querySelectorAll(`[data-key-action="${{action}}"]`)]
                            .every(node => node.textContent === label(code))) &&
                        ['pitch','yaw','roll'].every(axis => !rocketLab.keybinds.inversions[axis] &&
                            !document.querySelector(`#sim-invert-${{axis}}`).checked);
                }}''')
                close_keybinds()
                page.keyboard.press('r')
                page.keyboard.down('w')
                page.keyboard.down('Space')
                page.wait_for_function('''rocketLab.body.mode === 'FLIGHT' && rocketLab.pitchLock.locked &&
                    !document.querySelector('#sim-pitch-warning').hidden''')
                check('real Space liftoff with held W locks pitch and names the physical key', '''
                    rocketLab.body.mode === 'FLIGHT' && rocketLab.pitchLock.locked &&
                    rocketLab.input().lift && !rocketLab.input().forward && !rocketLab.input().back &&
                    document.querySelector('#sim-pitch-warning').textContent === 'RELEASE [W] TO ENGAGE PITCH' ''')
                page.keyboard.up('w')
                check('physical W keyup releases takeoff lock and hides warning', '''
                    !rocketLab.pitchLock.locked && document.querySelector('#sim-pitch-warning').hidden''')
                page.keyboard.up('Space')
                # Synthetic descent, real animation/controller/HUD path (not fabricated UI state).
                page.evaluate('''() => {
                    rocketLab.reset();
                    const b = rocketLab.body;
                    b.mode = 'FLIGHT'; b.flightArmed = true; b.p.y = 6.8;
                    b.altitude = 6; b.v.set(0,-3,0);
                }''')
                page.wait_for_function("document.querySelector('#sim-assist-status').textContent === 'LANDING ASSIST'")
                check('simulated descent activates real LANDING controller and HUD', '''
                    rocketLab.controller.mode === 'LANDING' && rocketLab.controller.assistActive &&
                    document.querySelector('#sim-assist-status').textContent === 'LANDING ASSIST' &&
                    document.querySelector('#sim-mode').textContent === 'FLIGHT' ''')
                if page.evaluate('!!(window.AudioContext || window.webkitAudioContext)'):
                    page.wait_for_function("rocketLab.audio.context?.state === 'running'")
                    check('AudioSystem unlocks from real user gestures offline', '''
                        rocketLab.audio.context.state === 'running' && rocketLab.audio.sources.length > 0''')
                else:
                    print('SKIP: Web Audio unavailable in this browser', flush=True)

                click('#sim-bullet-time')
                # Observe the actual physics step without changing it or waiting for a long flight.
                page.evaluate('''() => {
                    rocketLab.reset();
                    const b = rocketLab.body;
                    b.p.y = 30; b.altitude = 29; b.mode = 'FLIGHT'; b.flightArmed = true;
                    b.wheels.forEach(wheel => { wheel.contact = false; });
                    window.__originalStep = b.step;
                    b.step = function(dt,...args) {
                        window.__observedStep = dt;
                        return __originalStep.call(this,dt,...args);
                    };
                    window.__observedStep = null;
                }''')
                page.wait_for_function('''__observedStep !== null &&
                    !document.querySelector('#sim-slow-mo').hidden''')
                check('Bullet Time UI enables airborne half-speed simulation and SLOW-MO HUD', '''
                    rocketLab.settings.bulletTime && rocketLab.body.mode === 'FLIGHT' &&
                    document.querySelector('#sim-bullet-time').checked &&
                    document.querySelector('#sim-slow-mo').textContent === 'SLOW-MO 0.5x' &&
                    !document.querySelector('#sim-slow-mo').hidden &&
                    Math.abs(__observedStep - 1/120) < 1e-10''')
                focus_viewport()
                page.keyboard.press('r')
                page.wait_for_function('''Math.abs(__observedStep - 1/60) < 1e-10 &&
                    document.querySelector('#sim-slow-mo').hidden''')
                check('ground reset restores full-speed simulation and hides SLOW-MO with toggle still on', '''
                    rocketLab.settings.bulletTime && rocketLab.body.mode === 'GROUND' &&
                    document.querySelector('#sim-slow-mo').hidden &&
                    Math.abs(__observedStep - 1/60) < 1e-10''')
                page.evaluate('rocketLab.body.step = __originalStep')
                click('#sim-bullet-time')
                focus_viewport()
                page.keyboard.press('r')

                click('#sim-record')
                page.keyboard.down('w')
                wait_sim(.3)
                page.keyboard.up('w')
                check('Record UI captures a short actual W drive in simulation-time frames', '''() => {
                    const p = rocketLab.playback;
                    return p.recording && p.duration >= .3 && p.frames.length > 2 &&
                        p.frames.at(-1).pos[0] > p.frames[0].pos[0] && rocketLab.body.v.x > .1 &&
                        document.querySelector('#sim-record').getAttribute('aria-pressed') === 'true' &&
                        !document.querySelector('#sim-record-status').hidden;
                }''')
                page.keyboard.press('r')
                page.wait_for_function("!document.querySelector('#sim-replay').disabled")
                check('real R stops recording, parks the body and enables Play Replay', '''
                    !rocketLab.playback.recording && rocketLab.playback.ready &&
                    !rocketLab.playback.playing && rocketLab.body.mode === 'GROUND' &&
                    Math.abs(rocketLab.body.p.x + 38) < .01 && rocketLab.body.v.length() < .01 &&
                    !document.querySelector('#sim-replay').disabled''')

                page.evaluate('window.__pauseFrames = true')
                page.wait_for_function('!!window.__pendingFrame', polling=50)
                click('#sim-replay')
                page.keyboard.down('w')
                page.keyboard.down('Space')
                check('Play Replay UI enters REPLAYING and blocks real drive/lift input', '''
                    rocketLab.playback.playing && !Object.values(rocketLab.input()).some(Boolean) &&
                    rocketLab.keys.size === 0 && document.querySelector('#sim-mode').textContent === 'REPLAYING' &&
                    document.querySelector('#sim-record').disabled &&
                    !document.querySelector('#sim-exit-replay').hidden &&
                    !document.querySelector('#sim-replay-progress').hidden''')
                page.keyboard.up('w')
                page.keyboard.up('Space')
                page.keyboard.press('Escape')
                check('real Esc exits replay and restores the parked body and viewport focus', '''
                    !rocketLab.playback.playing && rocketLab.playback.ready &&
                    Math.abs(rocketLab.body.p.x + 38) < .01 && rocketLab.body.v.length() < .01 &&
                    document.querySelector('#sim-exit-replay').hidden &&
                    document.querySelector('#sim-mode').textContent === 'GROUND' &&
                    document.activeElement.id === 'viewport' ''')
                click('#sim-replay')
                replay_start = page.evaluate('rocketLab.time')
                duration = page.evaluate('rocketLab.playback.duration')
                assert duration < 3, f'Expected a short recording, got {duration:.2f}s'
                replay_moved = False
                # Initial recording frames can be stationary before the W keydown arrives.
                for _ in range(int(duration / .1) + 3):
                    state = page.evaluate('''() => {
                        __stepFrame();
                        return {playing:rocketLab.playback.playing,cursor:rocketLab.playback.cursor,
                            progress:rocketLab.playback.progress,time:rocketLab.time,x:rocketLab.body.p.x,
                            moved:rocketLab.body.p.x > rocketLab.playback.frames[0].pos[0] + .001};
                    }''')
                    replay_moved = replay_moved or (state['playing'] and state['moved'])
                    if not state['playing']:
                        break
                assert replay_moved and not state['playing'] and state['progress'] == 1, (
                    f'Replay failed to advance/end: moved={replay_moved}, {state}')
                check('replay advances recorded motion and ends naturally at the parked body', f'''
                    Math.abs(rocketLab.time - {replay_start}) < 1e-8 &&
                    Math.abs(rocketLab.body.p.x + 38) < .01 && rocketLab.body.v.length() < .01 &&
                    document.querySelector('#sim-exit-replay').hidden &&
                    !document.querySelector('#sim-replay').disabled''')
                check('no HTTP, secondary requests, page errors or request failures', 'true',
                      prerequisite=not (http_requests or blocked or secondary or errors or failed))
            finally:
                # Always expose boundary failures, including when an earlier assertion times out.
                print(json.dumps({'pageerrors': errors, 'requestfailed': failed,
                                  'http_requests': http_requests, 'blocked_http': blocked,
                                  'secondary_requests': secondary}, ensure_ascii=False), flush=True)
                context.close()
                browser.close()
    print(f'{len(checks)} standalone file/offline checks passed in {time.monotonic() - started:.1f}s', flush=True)


if __name__ == '__main__':
    main()
