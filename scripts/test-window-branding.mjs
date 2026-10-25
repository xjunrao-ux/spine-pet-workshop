import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createWindowBranding, WINDOWS_TASKBAR_APP_ID} from '../electron/window-branding.mjs';

const rootDirectory = path.resolve('source checkout');
const resourcesPath = path.resolve('installed app', 'resources');
const executable = path.resolve('installed app', 'SpinePet.exe');
function fixture(isPackaged, extra = {}) {
  const callbacks = new Map(), events = [], windows = [];
  const app = {isPackaged, setAppUserModelId(id) { events.push(['identity', id]); }, on(name, callback) { callbacks.set(name, callback); }};
  const branding = createWindowBranding(app, {rootDirectory, resourcesPath, executable, platform: 'win32', env: {}, ...extra});
  const open = () => {
    const window = {setIcon(icon) { this.icon = icon; }, setAppDetails(details) { this.details = details; }};
    callbacks.get('browser-window-created')?.({}, window); windows.push(window); return window;
  };
  return {branding, events, windows, open};
}

test('source windows use a separate taskbar identity and a relaunch command that opens the checkout', () => {
  const f = fixture(false); f.branding.install(); const window = f.open();
  assert.equal(window.details.appId, 'local.spine.desktop.pet.workshop.development');
  assert.equal(window.icon, path.join(rootDirectory, 'assets', 'spinepet-icon.ico'));
  assert.equal(window.details.relaunchCommand, `"${executable}" "${rootDirectory}"`);
  assert.equal(window.details.relaunchDisplayName, 'SpinePet 开发版');
});

test('installed windows leave the legacy taskbar identity and use a Shell-readable ICO outside ASAR', () => {
  const f = fixture(true); f.branding.install(); const window = f.open();
  assert.deepEqual(f.events, [['identity', WINDOWS_TASKBAR_APP_ID]]);
  assert.notEqual(WINDOWS_TASKBAR_APP_ID, 'local.spine.desktop.pet.workshop');
  assert.equal(window.details.appIconPath, path.join(resourcesPath, 'spinepet-icon.ico'));
  assert.equal(window.details.relaunchCommand, `"${executable}"`);
  assert.equal(window.details.relaunchDisplayName, 'SpinePet');
});

test('portable taskbar icon and relaunch command use the outer launcher instead of temporary resources', () => {
  const portable = path.resolve('portable folder', 'SpinePet.exe');
  const f = fixture(true, {env: {PORTABLE_EXECUTABLE_FILE: portable}}); f.branding.install(); const window = f.open();
  assert.equal(window.details.appIconPath, portable);
  assert.equal(window.details.relaunchCommand, `"${portable}"`);
  assert.equal(window.icon, path.join(resourcesPath, 'spinepet-icon.ico'));
});

test('every created window receives branding, including separate connection dialogs', () => {
  const f = fixture(false); f.branding.install();
  const manager = f.open(), connection = f.open();
  assert.equal(connection.icon, manager.icon);
  assert.deepEqual(connection.details, manager.details);
  assert.equal(connection.details.appIconIndex, 0);
});

test('other platforms do not call Windows taskbar APIs', () => {
  const f = fixture(false, {platform: 'linux'}); f.branding.install(); const window = f.open();
  assert.deepEqual(f.events, []); assert.equal(window.details, undefined);
  assert.equal(f.branding.iconPath, path.join(rootDirectory, 'assets', 'spinepet-icon.png'));
});

test('installer shortcuts and running windows use the same new identity without changing installation identity', async () => {
  const installer = await readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(installer.includes(`!define SPINEPET_TASKBAR_APP_ID "${WINDOWS_TASKBAR_APP_ID}"`));
  assert.equal(config.build.nsis.include, 'build/installer.nsh');
  assert.equal(config.build.appId, 'local.spine.desktop.pet.workshop');
});

test('legacy shortcut migration preserves launch arguments and ignores other executables and applications', () => {
  const shortcuts = new Map([
    ['legacy.lnk', {target: executable, args: '--autostart', cwd: rootDirectory, appUserModelId: 'local.spine.desktop.pet.workshop', icon: executable, iconIndex: 0}],
    ['other-exe.lnk', {target: path.resolve('other.exe'), appUserModelId: 'local.spine.desktop.pet.workshop'}],
    ['other-app.lnk', {target: executable, appUserModelId: 'other.application'}]
  ]);
  const writes = [], backups = [];
  const shell = {
    readShortcutLink(file) { if (!shortcuts.has(file)) throw new Error('Missing'); return {...shortcuts.get(file)}; },
    writeShortcutLink(file, operation, options) { writes.push({file, operation}); shortcuts.set(file, {...shortcuts.get(file), ...options}); return true; }
  };
  const f = fixture(true, {shell, backupShortcut: file => {backups.push(file);}});
  assert.deepEqual(f.branding.migrateShortcuts([...shortcuts.keys(), 'missing.lnk']), [{path: 'legacy.lnk', updated: true}]);
  assert.deepEqual(backups, ['legacy.lnk']);
  assert.deepEqual(writes, [{file: 'legacy.lnk', operation: 'update'}]);
  assert.equal(shortcuts.get('legacy.lnk').args, '--autostart');
  assert.equal(shortcuts.get('legacy.lnk').cwd, rootDirectory);
  assert.equal(shortcuts.get('legacy.lnk').appUserModelId, WINDOWS_TASKBAR_APP_ID);
  assert.equal(shortcuts.get('legacy.lnk').icon, path.join(resourcesPath, 'spinepet-icon.ico'));
  assert.deepEqual(f.branding.migrateShortcuts(['legacy.lnk']), []);
});

test('source, portable and isolated startup never migrate personal installed shortcuts', () => {
  const shell = {readShortcutLink() {throw new Error('Must not inspect personal shortcuts');}};
  for (const f of [fixture(false, {shell}), fixture(true, {shell, env: {PORTABLE_EXECUTABLE_FILE: executable}}), fixture(true, {shell, env: {PET_TEST_PROFILE: 'isolated'}})]) {
    assert.deepEqual(f.branding.migrateShortcuts(), []);
  }
});
