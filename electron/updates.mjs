import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {atomicWrite} from './plugins/settings-store.mjs';

export const REPOSITORY = 'https://github.com/xjunrao-ux/spine-pet-workshop';
export const RELEASES_URL = `${REPOSITORY}/releases/latest`;
export const CATALOG_URL = 'https://raw.githubusercontent.com/xjunrao-ux/spine-pet-workshop/main/community/catalog.json';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(left, right) {
  if (!VERSION.test(left) || !VERSION.test(right)) throw new Error('版本号必须为正式版本 X.Y.Z');
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  if (![...a, ...b].every(Number.isSafeInteger)) throw new Error('版本号超出支持范围');
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

// Both catalogs and plugin archives have a byte limit, including chunked responses.
export async function fetchBytes(url, {fetcher = fetch, maxBytes = 1024 * 1024} = {}) {
  const response = await fetcher(url, {signal: AbortSignal.timeout(60_000), headers: {'User-Agent': 'SpinePet-Updater', 'Cache-Control': 'no-cache'}});
  if (!response.ok) {await response.body?.cancel().catch(() => {}); throw new Error(response.status === 404 ? '更新信息尚未发布，请稍后重试' : `更新服务暂不可用（HTTP ${response.status}）`);}
  if (Number(response.headers.get('content-length')) > maxBytes) {await response.body?.cancel().catch(() => {}); throw new Error('更新文件超过大小限制');}
  const chunks = []; let size = 0;
  if (!response.body) throw new Error('更新服务返回了空响应');
  const reader = response.body.getReader();
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('更新文件超过大小限制');
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function latestRelease(fetcher) {
  const release = JSON.parse((await fetchBytes('https://api.github.com/repos/xjunrao-ux/spine-pet-workshop/releases/latest', {fetcher})).toString('utf8'));
  const version = String(release.tag_name ?? '').replace(/^v/, '');
  if (release.draft || release.prerelease || !VERSION.test(version)) throw new Error('未找到有效的正式发布版本');
  return {version, releaseNotes: String(release.body ?? '').slice(0, 12000)};
}
const notes = value => (typeof value === 'string' ? value : Array.isArray(value) ? value.map(n => n.note ?? '').join('\n') : '').slice(0, 12000);
export function updateError(error) {
  if (error?.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') return '此版本尚未上传 latest.yml 更新清单，请到发布页下载或联系维护者';
  return '更新未完成，请检查网络或稍后重试。当前版本仍可继续使用。';
}

export class AppUpdates {
  constructor({version, userData, updater, reason = '', fetchRelease = latestRelease, onChange = () => {}, notify = () => {}}) {
    compareVersions(version, version);
    this.file = path.join(userData, 'update-settings.json'); this.updater = updater; this.fetchRelease = fetchRelease;
    this.onChange = onChange; this.notify = notify; this.queue = Promise.resolve(); this.notified = new Set(); this.listeners = [];
    this.state = {currentVersion: version, latestVersion: '', phase: 'idle', supported: Boolean(updater), reason, autoCheck: true, autoDownload: true,
      progress: 0, notes: '', message: '尚未检查更新', lastChecked: '', settingsError: ''};
    if (!updater) return;
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false; updater.allowDowngrade = false; updater.disableWebInstaller = true;
    const on = (event, handler) => {updater.on(event, handler); this.listeners.push([event, handler]);};
    on('update-available', info => {
      if (compareVersions(info.version, this.state.currentVersion) <= 0) {this.patch({phase: 'current', latestVersion: '', notes: '', message: '当前已是最新正式版'}); return;}
      this.patch({phase: 'available', latestVersion: info.version, notes: notes(info.releaseNotes), progress: 0, message: `发现新版本 v${info.version}`});
      this.announce('available', `发现新版本 v${info.version}，可在角色管理器查看。`);
    });
    on('update-not-available', () => this.patch({phase: 'current', latestVersion: '', notes: '', message: '当前已是最新正式版'}));
    on('download-progress', info => this.patch({phase: 'downloading', progress: Math.min(100, Math.max(0, Number(info.percent) || 0)), message: '正在下载更新…'}));
    on('update-downloaded', () => {
      this.patch({phase: 'downloaded', progress: 100, message: '下载完成，点击“重启并安装”完成升级'});
      this.announce('downloaded', '新版已下载，打开角色管理器重启并安装。');
    });
    on('error', error => this.patch({phase: this.state.phase === 'installing' ? 'downloaded' : 'error', message: updateError(error)}));
  }
  snapshot() {return structuredClone(this.state);}
  patch(patch) {Object.assign(this.state, patch); this.onChange(this.snapshot()); return this.snapshot();}
  announce(kind, message) {
    const key = kind + this.state.latestVersion;
    if (!this.notified.has(key)) {this.notified.add(key); this.notify(message);}
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.schemaVersion !== 1 || typeof saved.autoCheck !== 'boolean' || typeof saved.autoDownload !== 'boolean') throw new Error('invalid settings');
      this.patch({autoCheck: saved.autoCheck, autoDownload: saved.autoDownload});
    } catch (error) {
      if (error.code !== 'ENOENT') {this.readOnly = true; this.patch({autoCheck: false, autoDownload: false, settingsError: '更新设置无法读取，原文件已保留；仍可手动检查更新'});}
    }
    return this.snapshot();
  }
  setPreferences(patch) {
    const operation = this.queue.then(async () => {
      if (this.readOnly) throw new Error(this.state.settingsError);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.entries(patch).some(([k, v]) => !['autoCheck', 'autoDownload'].includes(k) || typeof v !== 'boolean')) throw new Error('无效的更新设置');
      const next = {schemaVersion: 1, autoCheck: this.state.autoCheck, autoDownload: this.state.autoDownload, ...patch};
      await atomicWrite(this.file, next); return this.patch({autoCheck: next.autoCheck, autoDownload: next.autoDownload});
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  check() {
    if (this.checking) return this.checking;
    if (this.downloading || ['downloaded', 'installing'].includes(this.state.phase)) return Promise.resolve(this.snapshot());
    this.checking = this.runCheck().finally(() => {this.checking = undefined;}); return this.checking;
  }
  async runCheck() {
    this.patch({phase: 'checking', message: '正在检查 GitHub 正式版…'});
    try {
      if (this.updater) {
        const result = await this.updater.checkForUpdates();
        if (!result) throw new Error('updater unavailable');
      } else {
        const info = await this.fetchRelease();
        const available = compareVersions(info.version, this.state.currentVersion) > 0;
        this.patch({phase: available ? 'available' : 'current', latestVersion: available ? info.version : '', notes: notes(info.releaseNotes),
          message: available ? `发现新版本 v${info.version}，请到发布页下载` : '当前已是最新正式版'});
        if (available) this.announce('available', `发现新版本 v${info.version}，请到发布页下载。`);
      }
      this.patch({lastChecked: new Date().toISOString()});
      if (this.state.phase === 'available' && this.state.autoDownload && this.updater) await this.download();
    } catch (error) {this.patch({phase: 'error', message: updateError(error)});}
    return this.snapshot();
  }
  download() {
    if (this.downloading) return this.downloading;
    if (!this.updater || !this.state.latestVersion || !['available', 'error'].includes(this.state.phase)) return Promise.resolve(this.snapshot());
    this.patch({phase: 'downloading', progress: 0, message: '正在下载更新…'});
    this.downloading = (async () => {
      try {await this.updater.downloadUpdate();}
      catch (error) {this.patch({phase: 'error', message: updateError(error)});}
      return this.snapshot();
    })().finally(() => {this.downloading = undefined;});
    return this.downloading;
  }
  install() {
    if (!this.updater || this.state.phase !== 'downloaded') return {ok: false, error: '请先下载并校验新版安装包'};
    this.patch({phase: 'installing', message: '正在退出桌宠并安装更新…'});
    try {this.updater.quitAndInstall(false, true); return this.state.phase === 'installing' ? {ok: true} : {ok: false, error: this.state.message};}
    catch (error) {this.patch({phase: 'downloaded', message: updateError(error)}); return {ok: false, error: this.state.message};}
  }
  stop() {for (const [event, handler] of this.listeners) this.updater.removeListener(event, handler);}
}
