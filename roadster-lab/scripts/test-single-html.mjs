// Run from any directory: node --test /path/to/roadster-lab/scripts/test-single-html.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Script} from 'node:vm';
import {buildSingleHTML} from './build-single-html.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const builder = path.join(root, 'scripts/build-single-html.mjs');
const run = promisify(execFile);
const expectedFiles = [
  'vendor/three.module.js', 'data.js', 'model.js', 'controller.js', 'physics.js',
  'world.js', 'npc.js', 'ui.js', 'audio.js', 'effects.js', 'keybinds.js',
  'keybind-panel.js', 'takeoff-lock.js', 'camera-rig.js', 'time-scale.js', 'playback.js',
  'vendor/gamecontroller.js', 'vendor/joypad.js', 'gamepad-input.js', 'gamepad-rumble.js', 'simulator.js'
];

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'roadster-single-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  return directory;
}

function classicScript(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(scripts.length, 1, 'exactly one inline script');
  assert.equal(scripts[0][1].trim(), '', 'classic script without src or module type');
  new Script(scripts[0][2], {filename: 'standalone-test.js'});
  return scripts[0][2];
}

test('real build is self-contained, complete, deterministic, and leaves inputs intact', async t => {
  const directory = await temporary(t);
  const inputs = ['index.html', 'simulator.css', 'vendor/LICENSE.three', 'vendor/LICENSE.gamecontroller', 'vendor/LICENSE.joypad', ...expectedFiles];
  const before = await Promise.all(inputs.map(file => fs.readFile(path.join(dist, file))));
  const output = path.join(directory, 'nested/standalone.html');
  const result = await buildSingleHTML({output});
  const html = await fs.readFile(output, 'utf8');
  assert.equal(result.output, output);
  assert.equal(result.entry, 'simulator.js');
  assert.equal(result.modules, 21);
  assert.deepEqual([...result.files].sort(), [...expectedFiles].sort());
  assert.equal(result.bytes, Buffer.byteLength(html));
  assert(result.bytes > 1_000_000 && result.bytes < 3_000_000, `unexpected size: ${result.bytes}`);
  assert(result.bytes > (await fs.stat(path.join(dist, 'vendor/three.module.js'))).size);
  assert.match(html, /<title>Roadster \/ Rocket Lab — Physics Playground<\/title>/);
  assert.match(html, /<meta\b[^>]*name=["']viewport["'][^>]*content=["']width=device-width,initial-scale=1["']/i);
  assert.match(html, /<div\b[^>]*id=["']viewport["']/i);
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)];
  assert.equal(styles.length, 1);
  assert.equal(styles[0][1].trim(), before[1].toString().trim());
  assert(!/<link\b[^>]*\brel\s*=\s*["']stylesheet["']/i.test(html));
  assert(!/<script\b[^>]*\b(?:src\s*=|type\s*=\s*["'](?:module|importmap)["'])/i.test(html));
  assert(html.includes(`<!-- Three.js license\n${before[2].toString()}\n-->`));
  const script = classicScript(html);
  assert.match(script, /^\s*\(function\(\)\s*\{/);
  assert.match(script, /\}\)\(\);\s*$/);
  assert(!/^[\t ]*import\s+(?:\*|\{|[A-Za-z_$]).*\bfrom\s*["']\.{1,2}\//m.test(script));
  assert(!/\bviewer\.html\b/.test(script), 'no asset-viewer dependency');
  assert.deepEqual([...script.matchAll(/^\/\/ (.+\.js)$/gm)].map(match => match[1]).sort(), [...expectedFiles].sort());
  for (const name of ['VehiclePhysics', 'FlightController', 'NPCManager', 'AudioSystem', 'VehicleEffects', 'Keybinds', 'TakeoffPitchLock']) {
    assert.match(script, new RegExp(`\\bclass ${name}\\b`));
  }
  for (const name of ['THRUSTERS', 'G0', 'DRY_MASS', 'TANK_VOLUME', 'INITIAL_GAS', 'STEP', 'MAX_PRESSURE', 'MAX_THRUST', 'DEFAULT_BINDINGS', 'ACTIONS']) {
    assert.match(script, new RegExp(`\\b${name}\\s*=`));
  }
  const second = await buildSingleHTML({output: path.join(directory, 'second.html')});
  assert.deepEqual(await fs.readFile(second.output), Buffer.from(html));
  assert.equal(second.bytes, result.bytes);
  assert.deepEqual(second.files, result.files);
  for (let i = 0; i < inputs.length; i++) {
    assert.deepEqual(await fs.readFile(path.join(dist, inputs[i])), before[i], `${inputs[i]} was changed`);
  }
});

test('package build aliases and CLI work independently of cwd; retain default deliverable', async t => {
  const directory = await temporary(t);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  for (const name of ['build', 'build:single']) {
    assert.equal(pkg.scripts[name], 'node scripts/build-single-html.mjs', `npm run ${name}`);
  }
  const {stdout, stderr} = await run(process.execPath, [builder], {cwd: directory, timeout: 8000});
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.output, path.join(dist, 'roadster-rocket-standalone.html'));
  assert.equal(result.modules, 21);
  const html = await fs.readFile(result.output, 'utf8');
  assert.equal(result.bytes, Buffer.byteLength(html));
  classicScript(html);
  assert.deepEqual(await fs.readdir(directory), [], 'CLI did not write into its cwd');
  // The default dist artifact is intentional; only temporary outputs are removed.
});

// Isolated minimal workspace: negative tests must never mutate shared dist inputs.
async function fixture(t, files = {}) {
  const directory = await temporary(t);
  const defaults = {
    'dist/index.html': '<!doctype html><html><head><title>Fixture</title><link rel="stylesheet" href="style.css"></head><body><script type="module" src="entry.js"></script></body></html>',
    'dist/style.css': 'body { color: red; }',
    'dist/vendor/LICENSE.three': 'The MIT License\nCopyright fixture\n',
    'dist/entry.js': 'globalThis.answer = 42;\n'
  };
  for (const [name, content] of Object.entries({...defaults, ...files})) {
    const filename = path.join(directory, name);
    await fs.mkdir(path.dirname(filename), {recursive: true});
    await fs.writeFile(filename, content);
  }
  const script = path.join(directory, 'scripts/build-single-html.mjs');
  await fs.mkdir(path.dirname(script), {recursive: true});
  await fs.copyFile(builder, script);
  const {buildSingleHTML: build} = await import(pathToFileURL(script).href);
  return {directory, build, output: path.join(directory, 'output.html')};
}

test('supported named/namespace imports, aliases, multiline const and shader-like strings', async t => {
  const shader = 'import ghost from "./missing.js"; export default ghost; </script> uniform float x;';
  const {build, output} = await fixture(t, {
    'dist/entry.js': `import {\n  value as renamed,\n  Box, twice, shader\n} from './dep.js';\nimport * as namespace from './dep.js';\nglobalThis.answer = [renamed, namespace.alias, new Box().value, twice(3), shader, namespace.pattern.test('export')];\n`,
    'dist/dep.js': `// import never from './missing.js';\n/* export default ignored; */\nexport const\n  value = ({a: [20, 22]}).a.reduce((a, b) => a + b, 0),\n  shader = \`${shader}\`,\n  pattern = /import|export/;\nexport class Box { constructor() { this.value = value; } }\nexport function twice(n) { return n * 2; }\nexport {value as alias};\n`
  });
  const result = await build({output});
  assert.equal(result.modules, 2);
  const html = await fs.readFile(output, 'utf8');
  const script = classicScript(html);
  assert(!/<\/script/i.test(script), 'embedded closing script must be escaped');
  const context = {};
  new Script(script).runInNewContext(context, {timeout: 1000});
  assert.deepEqual(Array.from(context.answer), [42, 42, 42, 6, shader, true]);
});

const rejected = [
  ['default import', "import value from './dep.js';\n", /only named and namespace imports/],
  ['side-effect import', "import './dep.js';\n", /only named and namespace imports/],
  ['dynamic import', "const value = import('./dep.js');\n", /unsupported import/],
  ['bare import', "import {value} from 'unknown-package';\n", /unsupported local specifier/],
  ['remote import', "import {value} from 'https://example.invalid/dep.js';\n", /unsupported local specifier/],
  ['query import', "import {value} from './dep.js?v=1';\n", /unsupported local specifier/],
  ['missing module', "import {value} from './missing.js';\n", /cannot resolve.*missing\.js/],
  ['outside dist', "import {value} from '../outside.js';\n", /must stay inside dist/],
  ['missing export', "import {missing} from './dep.js';\n", /missing export missing/],
  ['cycle', "import {value} from './dep.js';\n", /module cycle/, "import * as entry from './entry.js';\nexport const value = 1;\n"],
  ['default export', 'export default 42;\n', /unsupported export default/],
  ['re-export', "export {value} from './dep.js';\n", /re-exports/]
];

for (const [name, source, message, dependency = 'export const value = 1;\n'] of rejected) {
  test(`rejects ${name} without creating output`, async t => {
    const {build, output} = await fixture(t, {
      'dist/entry.js': source,
      'dist/dep.js': dependency,
      'outside.js': 'export const value = 99;\n'
    });
    await assert.rejects(build({output}), message);
    await assert.rejects(fs.access(output), {code: 'ENOENT'});
  });
}

test('refuses to overwrite HTML, entry module, dependency module, stylesheet or license', async t => {
  const {directory, build} = await fixture(t, {
    'dist/entry.js': "import {value} from './dep.js';\nglobalThis.answer = value;\n",
    'dist/dep.js': 'export const value = 42;\n'
  });
  for (const name of ['index.html', 'entry.js', 'dep.js', 'style.css', 'vendor/LICENSE.three']) {
    const output = path.join(directory, 'dist', name);
    const before = await fs.readFile(output);
    await assert.rejects(build({output}), /output would overwrite an input/);
    assert.deepEqual(await fs.readFile(output), before, `${name} must remain unchanged`);
  }
});

test('rejects final-file and parent-directory symlinks to every protected input', async t => {
  const {directory, build} = await fixture(t, {
    'dist/entry.js': "import {value} from './dep.js';\nglobalThis.answer = value;\n",
    'dist/dep.js': 'export const value = 42;\n'
  });
  const alias = path.join(directory,'alias');
  await fs.symlink(path.join(directory,'dist'),alias,'dir');
  for (const [index,name] of ['index.html','entry.js','dep.js','style.css','vendor/LICENSE.three'].entries()) {
    const input = path.join(directory,'dist',name), before = await fs.readFile(input);
    const link = path.join(directory,`output-${index}.html`);
    await fs.symlink(input,link);
    for (const output of [link,path.join(alias,name)]) {
      await assert.rejects(build({output}), /output would overwrite an input/);
      assert.deepEqual(await fs.readFile(input),before,`${name} must survive aliases`);
    }
  }
});
