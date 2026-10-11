import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createStartupSettings } from '../electron/startup.mjs';

function fixture(extra = {}) {
  const writes = [], reads = [];
  let login = { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] };
  const app = { isPackaged: true,
    getLoginItemSettings(options) { reads.push(options); return login; },
    setLoginItemSettings(options) { writes.push(options); login = { openAtLogin: false, executableWillLaunchAtLogin: options.openAtLogin && options.enabled,
      launchItems: options.openAtLogin ? [{name: options.name, scope: 'user', path: options.path.replace(/^"|"$/g, ''), args: options.args.filter(arg => !arg.startsWith('--')), enabled: options.enabled}] : [] }; }
  };
  const executable = path.resolve('release', 'installed.exe');
  const api = createStartupSettings(app, { platform: 'win32', executable, exists: () => true, env: {}, ...extra });
  return { api, app, writes, reads, executable, setLogin(value) { login = value; } };
}

test('startup is off by default and reading never writes Windows settings', () => {
  const f = fixture(); assert.deepEqual(f.api.get(), { supported: true, enabled: false, reason: '' }); assert.equal(f.writes.length, 0);
});
test('enable and disable use matching executable and arguments, verified by OS state', () => {
  const f = fixture(); assert.equal(f.api.set(true).enabled, true); assert.equal(f.api.set(false).enabled, false);
  assert.deepEqual(f.writes.map(x => x.openAtLogin), [true, false]);
  assert.equal(f.writes[0].name, 'SpinePetWorkshop'); assert.equal(f.writes[0].path, '"' + f.executable + '"');
  assert.deepEqual(f.writes[0].args, ['--autostart']); assert.deepEqual(f.reads[0], { path: '"' + f.executable + '"', args: ['--autostart'] });
});
test('portable startup points at the outer portable executable, not temporary Electron', () => {
  const portable = path.resolve('release', 'my portable pet.exe'); const f = fixture({ env: { PORTABLE_EXECUTABLE_FILE: portable } });
  assert.equal(f.api.set(true).ok, true); assert.equal(f.writes[0].path, '"' + portable + '"');
});
test('Windows-disabled launch entry is reflected and can be re-enabled explicitly', () => {
  const f = fixture(); f.setLogin({openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [{name: 'SpinePetWorkshop', scope: 'user', path: f.executable, args: ['--autostart'], enabled: false}]});
  assert.equal(f.api.get().enabled, false); assert.equal(f.api.set(true).enabled, true);
});
test('custom entry remains enabled even when default openAtLogin is false', () => {
  const f = fixture(); assert.equal(f.api.set(true).ok, true);
  assert.equal(f.app.getLoginItemSettings({}).openAtLogin, false); assert.equal(f.api.get().enabled, true);
  assert.deepEqual(f.app.getLoginItemSettings({}).launchItems[0].args, []);
});
test('default or other entries never enable the pet switch', () => {
  const f = fixture();
  const entry = { name: 'SpinePetWorkshop', scope: 'user', path: f.executable, args: ['--autostart'], enabled: true };
  for (const changed of [{name: 'other-app'}, {scope: 'machine'}, {path: path.resolve('other.exe')}]) {
    f.setLogin({openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [{...entry, ...changed}]});
    assert.equal(f.api.get().enabled, false);
  }
  f.setLogin({openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: []}); assert.equal(f.api.get().enabled, false);
});
test('development, unsupported platform and missing executable never write login settings', () => {
  const dev = fixture(); dev.app.isPackaged = false;
  const api = createStartupSettings(dev.app, {platform: 'win32'}); assert.equal(api.set(true).ok, false); assert.equal(dev.writes.length, 0);
  for (const options of [{platform: 'linux'}, {exists: () => false}, {env: {PORTABLE_EXECUTABLE_FILE: 'relative.exe'}}]) {
    const f = fixture(options); assert.equal(f.api.set(true).ok, false); assert.equal(f.writes.length, 0);
  }
});
test('non-boolean input and rejected OS changes return errors', () => {
  const f = fixture(); assert.equal(f.api.set({enabled: true}).ok, false); assert.equal(f.writes.length, 0);
  f.app.setLoginItemSettings = () => {}; assert.equal(f.api.set(true).ok, false);
  f.app.setLoginItemSettings = () => {throw new Error('denied');}; assert.equal(f.api.set(true).ok, false);
});
