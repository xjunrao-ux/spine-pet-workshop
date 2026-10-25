import {createHash} from 'node:crypto';
import {CATALOG_URL, compareVersions, fetchBytes} from '../updates.mjs';
import {EXTERNAL_PERMISSIONS, inspectPluginZip} from './packages.mjs';

export function validateCatalog(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.plugins) || data.plugins.length > 1000) throw new Error('插件目录格式不兼容');
  const ids = new Set();
  for (const e of data.plugins) {
    if (!e || typeof e.id !== 'string' || !/^[a-z][a-z0-9.-]{2,99}$/.test(e.id) || e.id.startsWith('workshop.') || ids.has(e.id)) throw new Error('插件目录 ID 无效或重复');
    ids.add(e.id); compareVersions(e.version, e.minHostVersion);
    if (e.apiVersion !== 1 || typeof e.name !== 'string' || !e.name || e.name.length > 100 || !/^[a-f0-9]{64}$/.test(e.sha256) ||
      !Array.isArray(e.permissions) || e.permissions.length > 6 || new Set(e.permissions).size !== e.permissions.length || e.permissions.some(p => !EXTERNAL_PERMISSIONS.has(p))) throw new Error('插件目录校验信息无效');
    const u = new URL(e.downloadUrl);
    if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.port || u.search || u.hash || u.href !== e.downloadUrl ||
      !/^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[^/]+\/[^/]+\.zip$/.test(u.pathname) || u.pathname.includes('/latest/')) throw new Error('插件必须使用固定版本的 GitHub Release ZIP');
  }
  return data.plugins;
}
export class PluginUpdates {
  constructor({version, packages, host, fetcher, confirm, onChange = () => {}}) {
    Object.assign(this, {version, packages, host, fetcher, confirm, onChange}); this.entries = new Map(); this.pending = new Map();
    this.state = {phase: 'idle', message: '检查已安装插件在社区目录中的新版本', lastChecked: '', updates: []};
  }
  snapshot() {return structuredClone(this.state);}
  patch(patch) {Object.assign(this.state, patch); this.onChange(this.snapshot()); return this.snapshot();}
  list() {
    return [...this.entries.values()].flatMap(e => {
      const record = this.host.records.get(e.id);
      if (!this.packages.installed.some(p => p.id === e.id) || record?.origin !== 'external') return [];
      // Older ZIP APIs allowed arbitrary author version strings. Such plugins
      // remain usable and can still be updated manually, without breaking checks.
      try {if (compareVersions(e.version, record.manifest.version) <= 0) return [];} catch {return [];}
      return [{id: e.id, name: e.name, currentVersion: record.manifest.version, version: e.version, minHostVersion: e.minHostVersion,
        compatible: compareVersions(this.version, e.minHostVersion) >= 0, permissions: e.permissions, busy: this.pending.has(e.id)}];
    });
  }
  check() {
    if (this.checking) return this.checking;
    if (this.pending.size) return Promise.resolve(this.snapshot());
    this.checking = (async () => {
      this.patch({phase: 'checking', message: '正在检查社区插件更新…'});
      try {
        const bytes = await fetchBytes(CATALOG_URL, {fetcher: this.fetcher});
        const entries = validateCatalog(JSON.parse(bytes.toString('utf8')));
        this.entries = new Map(entries.map(e => [e.id, e]));
        const updates = this.list();
        this.patch({phase: 'ready', updates, lastChecked: new Date().toISOString(), message: updates.length ? `发现 ${updates.length} 个插件新版本` : '已收录的已安装插件暂无更新；未收录插件请向作者获取新版 ZIP'});
      } catch {this.patch({phase: 'error', message: '插件更新目录暂不可用，请检查网络或稍后重试。已安装插件仍可使用。'});}
      return this.snapshot();
    })().finally(() => {this.checking = undefined;}); return this.checking;
  }
  install(id) {
    if (this.pending.has(id)) return this.pending.get(id);
    // Set the lock before executing async work or publishing its busy state.
    const operation = Promise.resolve().then(() => this.runInstall(id)).finally(() => {this.pending.delete(id); this.patch({updates: this.list()});});
    this.pending.set(id, operation); this.patch({updates: this.list()}); return operation;
  }
  async runInstall(id) {
    try {
      const entry = this.entries.get(id), current = this.host.records.get(id);
      if (!entry || !this.list().some(e => e.id === id && e.compatible)) throw new Error('该插件没有兼容的可用更新，请先检查更新或升级主程序');
      const oldVersion = current.manifest.version;
      const bytes = await fetchBytes(entry.downloadUrl, {fetcher: this.fetcher, maxBytes: 8 * 1024 * 1024});
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('插件下载校验失败，未替换旧版');
      const bundle = inspectPluginZip(bytes);
      for (const key of ['id', 'name', 'version', 'apiVersion']) if (bundle.manifest[key] !== entry[key]) throw new Error('插件包与更新目录不一致，未替换旧版');
      if (JSON.stringify([...bundle.manifest.permissions].sort()) !== JSON.stringify([...entry.permissions].sort())) throw new Error('插件权限与目录不一致');
      if (bundle.manifest.configVersion !== current.manifest.configVersion) throw new Error('新版插件配置格式不兼容，请按作者说明迁移，旧版已保留');
      if (!await this.confirm({entry, oldVersion, addedPermissions: entry.permissions.filter(p => !current.allowed.includes(p))})) return {ok: false, cancelled: true};
      if (this.host.records.get(id) !== current || !this.packages.installed.some(e => e.id === id)) throw new Error('插件已发生变化，请重新检查更新');
      await this.packages.install(bundle, this.host, {preserveEnabled: true, requireHealthy: true});
      this.patch({phase: 'ready', updates: this.list(), message: `${entry.name} 已更新到 v${entry.version}，配置与数据已保留`});
      return {ok: true};
    } catch (error) {this.patch({message: String(error.message).slice(0, 250)}); return {ok: false, error: this.state.message};}
  }
}
