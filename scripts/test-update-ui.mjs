import {app, BrowserWindow, dialog, ipcMain, net, shell} from 'electron';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createZip} from '../electron/plugins/zip.mjs';
import {AppUpdates, REPOSITORY, CATALOG_URL} from '../electron/updates.mjs';

const output = path.resolve('.local/update-ui'); await mkdir(output, {recursive: true});
const profile = await mkdtemp(path.join(output, 'profile-'));
app.setPath('userData', profile); process.env.PET_TEST_PROFILE = profile;
delete process.env.VITE_DEV_SERVER_URL;
await writeFile(path.join(profile, 'feature-settings.json'), JSON.stringify({schemaVersion: 2, global: {theme: 'graphite', defaultVoiceEnabled: false}, plugins: {
  'workshop.music': {enabled: false, configVersion: 1, config: {}}, 'workshop.notifications': {enabled: false, configVersion: 1, config: {}}
}}));
const manifest = JSON.parse(await readFile('examples/hello-counter-plugin/plugin.json', 'utf8'));
const source = await readFile('examples/hello-counter-plugin/provider.js', 'utf8');
const oldZip = createZip({'plugin.json': JSON.stringify(manifest), [manifest.entry]: source});
const newZip = createZip({'plugin.json': JSON.stringify({...manifest, version: '1.1.0'}), [manifest.entry]: source});
const fixtureFile = path.join(output, 'counter.zip'); await writeFile(fixtureFile, oldZip);
const downloadUrl = 'https://github.com/example/plugins/releases/download/v1.1.0/counter.zip';
const catalog = {schemaVersion: 1, plugins: [{id: manifest.id, name: manifest.name, version: '1.1.0', apiVersion: 1, minHostVersion: '5.1.3',
  permissions: [], downloadUrl, sha256: createHash('sha256').update(newZip).digest('hex')}]};
const requests = [], opened = [], errors = [];
const originalFetch = net.fetch.bind(net);
net.fetch = async (url, options) => {
  if (/^pet-|^file:/.test(String(url))) return originalFetch(url, options);
  requests.push(String(url));
  if (url === CATALOG_URL) return new Response(JSON.stringify(catalog));
  if (url === downloadUrl) return new Response(newZip);
  if (String(url).endsWith('/releases/latest')) return new Response(JSON.stringify({tag_name: 'v99.0.0', body: 'Update notes <img src=x onerror=alert(1)>'}));
  throw new Error('Unexpected network request in isolated UI test');
};
shell.openExternal = async url => {opened.push(url);};
dialog.showOpenDialog = async () => ({canceled: false, filePaths: [fixtureFile]});
dialog.showMessageBox = async () => ({response: 0});
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('mute-audio');
app.on('browser-window-created', (_event, window) => {
  window.setOpacity(0);
  window.webContents.on('console-message', event => {if (event.level === 'error' && window.webContents.getURL().endsWith('/settings.html')) errors.push(event.message);});
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {for (let i = 0; i < 200; i++) {if (await fn()) return; await delay(50);} throw new Error('Timeout: ' + label);}
const watchdog = setTimeout(() => {console.error('Update UI validation timed out'); app.exit(1);}, 90_000);
const checks = [], pass = message => {checks.push(message); console.log('PASS', message);};
await import('../electron/main.mjs');
void (async () => {
  let failure;
  try {
    await until(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('/settings.html') && !w.webContents.isLoading()), 'real settings window');
    const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html'));
    const js = code => window.webContents.executeJavaScript(code);
    const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    const petJS = code => pet.webContents.executeJavaScript(code);
    const click = async selector => {await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(40);};
    await until(() => js('!document.querySelector("#app-update-check").disabled'), 'updates bridge initialized');
    assert.deepEqual(requests, []); pass('development and isolated tests do not contact GitHub on startup');
    assert.equal((await petJS('window.desktopPet.getCharacterConfig()')).voiceEnabled, false);
    await click('[data-page="features"]');
    await until(() => js('document.querySelector("#default-voice-enabled").checked===false'), 'saved voice preference');
    await click('#default-voice-enabled');
    await until(async () => (await petJS('window.desktopPet.getCharacterConfig()')).voiceEnabled === true, 'voice setting applies to running pet');
    await click('#default-voice-enabled');
    await until(async () => (await petJS('window.desktopPet.getCharacterConfig()')).voiceEnabled === false, 'voice muted again');
    pet.webContents.reload();
    await until(() => !pet.webContents.isLoading(), 'pet reload');
    assert.equal((await petJS('window.desktopPet.getCharacterConfig()')).voiceEnabled, false);
    assert.equal(JSON.parse(await readFile(path.join(profile, 'feature-settings.json'), 'utf8')).global.defaultVoiceEnabled, false);
    pass('saved startup voice defaults apply before rendering, settings toggle immediately, and muted state survives reload');
    await click('[data-page="updates"]');
    assert.equal(await js('document.body.dataset.settingsPage'), 'updates');
    assert.equal(await js('document.querySelector("#plugin-release-guide").textContent.includes("Assets")'), true);
    await click('[data-url="' + REPOSITORY + '"]'); assert.equal(opened.at(-1), REPOSITORY);
    assert.equal(await js('window.petSettings.openExternal("https://evil.test/")'), false);
    pass('repository entry opens the verified project URL and rejects unapproved external URLs');
    await click('#app-update-check');
    await until(() => js('document.querySelector("#app-update-status").textContent.includes("99.0.0")'), 'manual GitHub release check');
    assert.equal(await js('document.querySelector("#app-update-notes img")'), null);
    assert.equal(await js('document.querySelector("#app-update-download").classList.contains("hidden")'), true);
    assert.equal(await js('document.querySelector("#app-update-install").classList.contains("hidden")'), true);
    pass('development checks show newer release and text-only notes without offering in-place installation');
    await js('window.featureSettings.installPlugin()');
    await click('[data-page="extensions"]'); await click('#plugin-update-shortcut');
    await until(() => js('!!document.querySelector("[data-plugin-update]")'), 'installed plugin update found');
    assert.equal(await js('document.body.dataset.settingsPage'), 'updates');
    await click('[data-plugin-update]');
    await until(() => js('document.querySelector("#plugin-update-status").textContent.includes("已更新到 v1.1.0")'), 'real online ZIP update');
    const snapshot = await js('window.featureSettings.get()');
    assert.equal(snapshot.plugins.find(p => p.id === manifest.id).manifest.version, '1.1.0');
    assert.equal(snapshot.plugins.find(p => p.id === manifest.id).runtime, 'active');
    pass('actual IPC downloads, verifies and replaces an installed sandbox plugin after confirmation');

    // Exercise installed-build controls without launching a real installer or
    // overwriting any installed application. Network/plugin IPC above is real.
    const fakeUpdater = new EventEmitter(); let installCalls = 0;
    fakeUpdater.checkForUpdates = async () => {fakeUpdater.emit('update-available', {version: '5.2.0', releaseNotes: 'A new release\n保留角色与插件数据'}); return {};};
    fakeUpdater.downloadUpdate = async () => {fakeUpdater.emit('download-progress', {percent: 42}); await delay(80); fakeUpdater.emit('update-downloaded'); return ['test-only.exe'];};
    fakeUpdater.quitAndInstall = () => {installCalls++;};
    const service = new AppUpdates({version: '5.1.3', userData: profile, updater: fakeUpdater,
      onChange: state => window.webContents.send('updates:state', {app: state})});
    await service.load(); await service.setPreferences({autoDownload: false});
    for (const [channel, handler] of [
      ['updates:check', () => service.check()], ['updates:download', () => service.download()], ['updates:install', () => service.install()],
      ['updates:preferences', async (_event, patch) => ({ok: true, state: await service.setPreferences(patch)})]
    ]) {ipcMain.removeHandler(channel); ipcMain.handle(channel, handler);}
    await click('#app-update-check');
    await until(() => js('!document.querySelector("#app-update-download").classList.contains("hidden")'), 'download action available');
    await click('#app-update-download');
    await until(() => js('!document.querySelector("#app-update-install").classList.contains("hidden")'), 'download complete');
    assert.equal(installCalls, 0); pass('installed-build controls download and wait for an explicit restart/install click');
    for (const [width, height, filename] of [[1280, 800, 'updates-wide.png'], [760, 620, 'updates-compact.png']]) {
      window.setContentSize(width, height); await delay(120);
      assert.equal(await js('document.scrollingElement.scrollWidth<=innerWidth'), true);
      assert.equal(await js('document.querySelector("#page-updates").scrollWidth<=document.querySelector("#page-updates").clientWidth'), true);
      await writeFile(path.join(output, filename), (await window.webContents.capturePage()).toPNG());
    }
    await js('document.querySelector("#page-updates").scrollTop=10000');
    await delay(80); await writeFile(path.join(output, 'developer-links.png'), (await window.webContents.capturePage()).toPNG());
    pass('wide and compact layouts keep update controls and developer links reachable without horizontal overflow');
    await js('document.querySelector("#update-auto-check").click()');
    await until(() => !service.snapshot().autoCheck, 'update preference saved');
    assert.equal(JSON.parse(await readFile(service.file, 'utf8')).autoCheck, false);
    await click('#app-update-install'); assert.equal(installCalls, 1); service.stop();
    pass('automatic-check preference persists and installation runs only on the explicit button');
    assert.deepEqual(errors, []);
  } catch (error) {failure = String(error.stack ?? error); console.error(failure);}
  finally {await writeFile(path.join(output, 'checks.json'), JSON.stringify({ok: !failure, checks, error: failure ?? null}, null, 2)); clearTimeout(watchdog); app.exit(failure ? 1 : 0);}
})();
