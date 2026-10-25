import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AppUpdates, compareVersions, fetchBytes, latestRelease} from '../electron/updates.mjs';
import {PluginUpdates, validateCatalog} from '../electron/plugins/updates.mjs';
import {PluginPackages, inspectPluginZip} from '../electron/plugins/packages.mjs';
import {createZip} from '../electron/plugins/zip.mjs';
import {PluginHost} from '../electron/plugins/host.mjs';

async function directory(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spinepet-updates-'));
  t.after(() => rm(dir, {recursive: true, force: true})); return dir;
}
class FakeUpdater extends EventEmitter {
  checks = 0; downloads = 0; installs = [];
  async checkForUpdates() {
    this.checks++; await Promise.resolve();
    if (this.checkError) throw this.checkError;
    const info = {version: this.version ?? '5.2.0', releaseNotes: '<script>untrusted notes</script>'};
    this.emit(this.noUpdate ? 'update-not-available' : 'update-available', info); return {updateInfo: info};
  }
  async downloadUpdate() {
    this.downloads++; await Promise.resolve(); this.emit('download-progress', {percent: 35});
    if (this.downloadError) {this.emit('error', this.downloadError); throw this.downloadError;}
    this.emit('update-downloaded', {}); return ['installer.exe'];
  }
  quitAndInstall(...args) {this.installs.push(args);}
}
async function appFixture(t, extra = {}) {
  const updater = new FakeUpdater(), notifications = [], userData = await directory(t);
  const service = new AppUpdates({version: '5.1.3', userData, updater, notify: n => notifications.push(n), ...extra});
  await service.load(); t.after(() => service.stop()); return {service, updater, notifications, userData};
}
test('only newer stable semantic versions are considered upgrades', () => {
  assert.equal(compareVersions('5.10.0', '5.2.9'), 1); assert.equal(compareVersions('5.1.3', '5.1.3'), 0);
  assert.equal(compareVersions('4.9.9', '5.0.0'), -1);
  for (const version of ['5.2.0-beta', 'v5.2.0', '05.2.0', '5.2']) assert.throws(() => compareVersions(version, '5.1.3'));
});
test('automatic download waits for explicit installation and coalesces concurrent checks', async t => {
  const {service, updater, notifications} = await appFixture(t);
  await Promise.all([service.check(), service.check()]);
  assert.equal(updater.checks, 1); assert.equal(updater.downloads, 1); assert.equal(updater.installs.length, 0);
  assert.equal(service.snapshot().phase, 'downloaded'); assert.equal(service.snapshot().progress, 100);
  assert.equal(updater.autoInstallOnAppQuit, false); assert.equal(updater.allowPrerelease, false); assert.equal(updater.allowDowngrade, false);
  assert.equal(notifications.length, 2);
  await service.check(); assert.equal(updater.checks, 1);
  assert.equal(service.install().ok, true); assert.deepEqual(updater.installs, [[false, true]]);
  assert.equal(service.install().ok, false);
});
test('preferences persist and turning automatic download off permits a manual download', async t => {
  const {service, updater, userData} = await appFixture(t);
  await Promise.all([service.setPreferences({autoCheck: false}), service.setPreferences({autoDownload: false})]);
  await service.check(); assert.equal(updater.downloads, 0); assert.equal(service.snapshot().phase, 'available');
  await Promise.all([service.download(), service.download()]); assert.equal(updater.downloads, 1);
  const restored = new AppUpdates({version: '5.1.3', userData}); await restored.load();
  assert.equal(restored.snapshot().autoCheck, false); assert.equal(restored.snapshot().autoDownload, false);
  await assert.rejects(service.setPreferences({repository: 'https://evil.test'}));
  const original = await readFile(service.file, 'utf8'); await assert.rejects(service.setPreferences({autoCheck: 'yes'}));
  assert.equal(await readFile(service.file, 'utf8'), original);
});
test('corrupt or future settings are retained and prevent automatic checks and writes', async t => {
  const userData = await directory(t), file = path.join(userData, 'update-settings.json'), original = '{"schemaVersion":99}';
  await writeFile(file, original); const service = new AppUpdates({version: '5.1.3', userData}); await service.load();
  assert.equal(service.snapshot().autoCheck, false); assert.ok(service.snapshot().settingsError);
  await assert.rejects(service.setPreferences({autoCheck: true})); assert.equal(await readFile(file, 'utf8'), original);
});
test('network, missing manifests and failed checksums do not allow installation; download can retry', async t => {
  const {service, updater} = await appFixture(t);
  updater.checkError = Object.assign(new Error('404'), {code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'});
  await service.check(); assert.match(service.snapshot().message, /latest.yml/); assert.equal(service.install().ok, false);
  updater.checkError = undefined; updater.downloadError = new Error('sha512 mismatch'); await service.check();
  assert.equal(service.snapshot().phase, 'error'); assert.equal(service.install().ok, false); assert.equal(updater.installs.length, 0);
  updater.downloadError = undefined; await service.download(); assert.equal(service.snapshot().phase, 'downloaded');
});
test('current and older releases never download or downgrade', async t => {
  const {service, updater} = await appFixture(t); updater.noUpdate = true;
  await service.check(); assert.equal(service.snapshot().phase, 'current'); assert.equal(updater.downloads, 0);
  updater.noUpdate = false; updater.version = '5.0.0'; await service.check();
  assert.equal(updater.downloads, 0); assert.equal(service.install().ok, false);
});
test('installer launch errors retain the verified download and allow a retry', async t => {
  const {service, updater} = await appFixture(t); await service.check();
  updater.quitAndInstall = () => updater.emit('error', new Error('Installer could not start'));
  assert.equal(service.install().ok, false); assert.equal(service.snapshot().phase, 'downloaded');
  updater.quitAndInstall = () => {}; assert.equal(service.install().ok, true);
});
test('portable/development builds can check releases but never run an installer', async t => {
  const {service} = await appFixture(t, {updater: undefined, reason: '便携版', fetchRelease: async () => ({version: '5.2.0', releaseNotes: 'new'})});
  await service.check(); assert.equal(service.snapshot().supported, false); assert.equal(service.snapshot().phase, 'available');
  await service.download(); assert.equal(service.install().ok, false);
});
test('GitHub latest release parsing ignores prereleases and invalid versions', async () => {
  const response = data => async () => new Response(JSON.stringify(data));
  assert.equal((await latestRelease(response({tag_name: 'v5.2.0', body: 'notes'}))).version, '5.2.0');
  for (const data of [{tag_name: 'v5.2.0', prerelease: true}, {tag_name: 'plugin-v2.0.0'}, {tag_name: 'v5.2.0', draft: true}]) await assert.rejects(latestRelease(response(data)));
});
test('downloads reject HTTP errors, large content lengths and oversized chunked data', async () => {
  await assert.rejects(fetchBytes('https://github.com', {fetcher: async () => new Response('missing', {status: 404})}), /尚未发布/);
  await assert.rejects(fetchBytes('https://github.com', {maxBytes: 5, fetcher: async () => new Response('x', {headers: {'content-length': '100'}})}), /大小限制/);
  await assert.rejects(fetchBytes('https://github.com', {maxBytes: 5, fetcher: async () => new Response('123456')}), /大小限制/);
});

const manifest = JSON.parse(await readFile(new URL('../examples/hello-counter-plugin/plugin.json', import.meta.url), 'utf8'));
const archive = changes => createZip({'plugin.json': JSON.stringify({...manifest, settingsSchema: [{key: 'remember', type: 'boolean', label: '记住设置', default: true}], ...changes}), [manifest.entry]: 'export function activate() {}'});
const newZip = archive({version: '1.1.0'});
const entry = {id: manifest.id, name: manifest.name, apiVersion: 1, version: '1.1.0', minHostVersion: '5.1.3',
  permissions: manifest.permissions, downloadUrl: 'https://github.com/owner/plugins/releases/download/v1.1.0/plugin.zip', sha256: createHash('sha256').update(newZip).digest('hex')};
async function pluginFixture(t, {zip = newZip, catalogEntry = entry, confirm = async () => true, fails = false} = {}) {
  const userData = await directory(t);
  const host = new PluginHost({definitions: [], userData, broker: {configure() {}, scope() {return {};}, stop() {}}}); await host.start(); t.after(() => host.stop());
  const packages = new PluginPackages({userData, makeProvider: bundle => ({activate() {
    if (fails && bundle.manifest.version === '1.1.0') throw new Error('broken update');
    return {getSnapshot: () => ({available: true, status: 'ready', pages: []}), dispose() {}};
  }})});
  await packages.install(inspectPluginZip(archive({version: '1.0.0'})), host);
  const fetcher = async url => new Response(url.endsWith('catalog.json') ? JSON.stringify({schemaVersion: 1, plugins: [catalogEntry]}) : zip);
  const updates = new PluginUpdates({version: '5.1.3', packages, host, fetcher, confirm});
  await updates.check(); return {updates, packages, host, userData};
}
test('reviewed catalog rejects arbitrary URLs, invalid versions, permissions and duplicate IDs', () => {
  assert.equal(validateCatalog({schemaVersion: 1, plugins: [entry]}).length, 1);
  for (const patch of [{downloadUrl: 'https://evil.test/plugin.zip'}, {downloadUrl: entry.downloadUrl + '?secret=x'}, {sha256: '0'}, {permissions: ['media.read']}, {version: '1.1.0-beta'}, {apiVersion: 2}, {id: 'workshop.fake'}]) assert.throws(() => validateCatalog({schemaVersion: 1, plugins: [{...entry, ...patch}]}));
  assert.throws(() => validateCatalog({schemaVersion: 1, plugins: [entry, entry]}));
});
test('plugin update preserves stored data, configuration and disabled status across reloads', async t => {
  const {updates, packages, host, userData} = await pluginFixture(t);
  await host.storage.set(manifest.id, 'example', {value: 'keep me'});
  await host.setSettings({plugins: {[manifest.id]: {enabled: false, config: {remember: false}}}});
  assert.equal(updates.snapshot().updates.length, 1);
  assert.equal((await updates.install(manifest.id)).ok, true);
  assert.equal(host.records.get(manifest.id).manifest.version, '1.1.0'); assert.equal(host.records.get(manifest.id).enabled, false);
  assert.equal(host.store.data.plugins[manifest.id].config.remember, false);
  assert.deepEqual(await host.storage.get(manifest.id, 'example'), {value: 'keep me'});
  assert.equal(updates.snapshot().updates.length, 0);
  const restored = new PluginPackages({userData, makeProvider: () => ({})});
  assert.equal((await restored.load())[0].manifest.version, '1.1.0'); assert.equal(packages.installed.length, 1);
});
test('corrupt ZIP downloads, identity mismatches and incompatible host versions retain the old plugin', async t => {
  for (const options of [{zip: Buffer.from('corrupt')}, {catalogEntry: {...entry, version: '1.2.0'}}, {catalogEntry: {...entry, minHostVersion: '6.0.0'}}]) {
    const {updates, host, packages} = await pluginFixture(t, options), before = structuredClone(packages.installed);
    assert.equal((await updates.install(manifest.id)).ok, false); assert.equal(host.records.get(manifest.id).manifest.version, '1.0.0');
    assert.deepEqual(packages.installed, before);
  }
});
test('cancelled plugin updates and config format changes never replace the installed plugin', async t => {
  const cancelled = await pluginFixture(t, {confirm: async () => false});
  assert.equal((await cancelled.updates.install(manifest.id)).cancelled, true); assert.equal(cancelled.host.records.get(manifest.id).manifest.version, '1.0.0');
  const zip = archive({version: '1.1.0', configVersion: 2});
  const incompatible = await pluginFixture(t, {zip, catalogEntry: {...entry, sha256: createHash('sha256').update(zip).digest('hex')}});
  assert.equal((await incompatible.updates.install(manifest.id)).ok, false); assert.match(incompatible.updates.snapshot().message, /配置格式不兼容/);
});
test('plugin activation failure restores the prior index, configuration and runtime', async t => {
  const {updates, packages, host} = await pluginFixture(t, {fails: true}), before = structuredClone(packages.installed);
  await host.setSettings({plugins: {[manifest.id]: {config: {remember: false}}}});
  await host.storage.set(manifest.id, 'state', {retained: true});
  assert.equal((await updates.install(manifest.id)).ok, false);
  assert.deepEqual(packages.installed, before); assert.equal(host.records.get(manifest.id).manifest.version, '1.0.0');
  assert.equal(host.records.get(manifest.id).runtime, 'active'); assert.deepEqual(await host.storage.get(manifest.id, 'state'), {retained: true});
  assert.equal(host.store.data.plugins[manifest.id].config.remember, false);
  assert.deepEqual(JSON.parse(await readFile(packages.index, 'utf8')).installed, before);
});
test('a plugin cannot update after uninstall or gain unlisted permissions', async t => {
  const {updates, host, packages} = await pluginFixture(t); await packages.uninstall(manifest.id, host);
  assert.equal((await updates.install(manifest.id)).ok, false); assert.equal(host.records.has(manifest.id), false);
  const zip = archive({version: '1.1.0', permissions: ['storage.own']});
  const mismatch = await pluginFixture(t, {zip, catalogEntry: {...entry, sha256: createHash('sha256').update(zip).digest('hex')}});
  assert.equal((await mismatch.updates.install(manifest.id)).ok, false); assert.match(mismatch.updates.snapshot().message, /权限与目录/);
});
