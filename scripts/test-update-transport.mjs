// Run with Electron. Serves the built installer over loopback to exercise the
// actual updater's metadata, HTTP download and SHA-512 verification. Never installs.
import {app} from 'electron';
import electronUpdater from 'electron-updater';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {AppUpdates} from '../electron/updates.mjs';

const output = path.resolve('.local/update-transport'); await mkdir(output, {recursive: true});
const profile = await mkdtemp(path.join(output, 'profile-')); app.setPath('userData', profile);
const build = path.resolve(process.argv[2] ?? '.local/update-build');
const manifest = await readFile(path.join(build, 'latest.yml'), 'utf8');
const filename = manifest.match(/^path: (.+)$/m)[1].trim();
const version = manifest.match(/^version: (.+)$/m)[1].trim();
const installer = path.join(build, filename), digest = createHash('sha512').update(await readFile(installer)).digest('base64');
assert.ok(manifest.includes(digest), 'built manifest must match actual installer');
let corrupt = false, installs = 0; const requests = [];
const server = createServer((request, response) => {
  const route = new URL(request.url, 'http://localhost').pathname; requests.push(route);
  if (route === '/latest.yml') {response.end(manifest); return;}
  if (route === '/' + filename) {
    if (corrupt) response.end('corrupt installer bytes'); else createReadStream(installer).pipe(response);
    return;
  }
  response.writeHead(404); response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const watchdog = setTimeout(() => {console.error('Updater transport timed out'); app.exit(1);}, 90_000);
void app.whenReady().then(async () => {
let failure;
try {
  const baseVersion = '0.0.1';
  const executor = new electronUpdater.NsisUpdater().httpExecutor;
  async function service(name) {
    const dir = path.join(profile, name); await mkdir(dir, {recursive: true});
    const adapter = {version: baseVersion, name: 'SpinePet Update Test', isPackaged: true,
      appUpdateConfigPath: path.join(build, 'win-unpacked/resources/app-update.yml'), userDataPath: dir, baseCachePath: path.join(dir, 'cache'),
      whenReady: () => app.whenReady(), onQuit() {throw new Error('Unexpected automatic installation registration');},
      quit() {installs++;}, relaunch() {installs++;}};
    const updater = new electronUpdater.NsisUpdater(null, adapter); updater.httpExecutor = executor;
    updater.setFeedURL({provider: 'generic', url});
    updater.disableDifferentialDownload = true;
    updater.logger = {info() {}, warn() {}, debug() {}, error() {}};
    updater.doInstall = () => {installs++; throw new Error('Test must never launch an installer');};
    const updates = new AppUpdates({version: baseVersion, userData: dir, updater}); await updates.load();
    return {updates, updater};
  }
  const valid = await service('valid'); await valid.updates.check();
  assert.equal(valid.updates.snapshot().latestVersion, version); assert.equal(valid.updates.snapshot().phase, 'downloaded');
  assert.equal(createHash('sha512').update(await readFile(valid.updater.installerPath)).digest('base64'), digest);
  assert.equal(installs, 0); valid.updates.stop();
  console.log('PASS real NSIS updater downloads built installer and verifies SHA-512 without installing');
  corrupt = true;
  const invalid = await service('corrupt'); await invalid.updates.check();
  assert.equal(invalid.updates.snapshot().phase, 'error'); assert.equal(invalid.updates.install().ok, false);
  assert.equal(installs, 0); invalid.updates.stop();
  console.log('PASS real updater rejects corrupted bytes and never enables installation');
  await writeFile(path.join(output, 'checks.json'), JSON.stringify({ok: true, version, digest, requests, actualInstallations: installs}, null, 2));
} catch (error) {failure = error; console.error(error);}
finally {clearTimeout(watchdog); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); app.exit(failure ? 1 : 0);}
});
