import {test} from 'node:test';
import assert from 'node:assert/strict';

const GAMECONTROLLER = '../dist/vendor/gamecontroller.js';
const JOPAD = '../dist/vendor/joypad.js';

test('vendor gamepad libraries stay inert without a window', async () => {
  const gamecontroller = await import(`${GAMECONTROLLER}?env=node`);
  const joypad = await import(`${JOPAD}?env=node`);
  assert.equal(gamecontroller.gameControl, undefined, 'gameControl must not be defined in Node');
  assert.equal(joypad.joypad, undefined, 'joypad must not be defined in Node');
});

test('stubbed browser exposes gameControl and joypad APIs', async () => {
  const listeners = new Map();
  const addEventListener = (type, handler) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  };
  const removeEventListener = (type, handler) => {
    const list = listeners.get(type) || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  };
  globalThis.window = globalThis;
  globalThis.window.addEventListener = addEventListener;
  globalThis.window.removeEventListener = removeEventListener;
  globalThis.window.dispatchEvent = () => true;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis.navigator, 'getGamepads', {value: () => [], configurable: true});

  try {
    const gamecontroller = await import(`${GAMECONTROLLER}?env=browser`);
    const joypad = await import(`${JOPAD}?env=browser`);
    assert.ok(gamecontroller.gameControl, 'gameControl global must be exported');
    assert.equal(typeof gamecontroller.gameControl.on, 'function', 'gameControl.on event API');
    assert.equal(typeof gamecontroller.gameControl.off, 'function', 'gameControl.off event API');
    assert.ok(joypad.joypad, 'joypad global must be exported');
    assert.equal(typeof joypad.joypad.on, 'function', 'joypad.on event API');
    assert.equal(typeof joypad.joypad.vibrate, 'function', 'joypad.vibrate rumble API');
    assert.equal(typeof joypad.joypad.set, 'function', 'joypad.set settings API');
    assert.ok(listeners.size > 0, 'libraries must register connect listeners');
  } finally {
    delete globalThis.window;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
    for (const [type, handlers] of listeners) for (const handler of handlers) removeEventListener(type, handler);
  }
});

test('vendor modules contain no eval and no source map refs', async () => {
  const {readFile} = await import('node:fs/promises');
  const {fileURLToPath} = await import('node:url');
  for (const file of ['../dist/vendor/gamecontroller.js', '../dist/vendor/joypad.js']) {
    const source = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(/, `${file} must not use eval`);
    assert.doesNotMatch(source, /sourceMappingURL/, `${file} must not reference source maps`);
    assert.match(source, /export const (gameControl|joypad) =/, `${file} must expose a named ESM export`);
    assert.match(source, /MIT License|Licence: MIT|MIT Licensed/i, `${file} must carry MIT attribution`);
  }
});
