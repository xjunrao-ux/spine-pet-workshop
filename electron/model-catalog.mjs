import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, open, readFile, readdir, rename, rm} from 'node:fs/promises';
import path from 'node:path';

const ROOTS = {operator: 'models', enemy: 'models_enemies', illustration: 'models_illust'};
const LABELS = {operator: '干员小人', enemy: '敌人战斗模型', illustration: '干员动态立绘'};
const ORDER = {operator: 0, illustration: 1, enemy: 2};
const FORMS = {'002_amiya': '术师', '1001_amiya2': '近卫', '1037_amiya3': '医疗'};
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s’'"·._-]+/g, '');
const component = value => typeof value === 'string' && /^[a-z0-9_#.-]+$/i.test(value) && !/^\.+$/.test(value) && !value.endsWith('.');
const fileComponent = value => typeof value === 'string' && /^[a-z0-9_#.$ -]+$/i.test(value) && value.trim() === value && !/^\.+$/.test(value) && !value.endsWith('.');
const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');

export class ModelCatalog {
  constructor(data) {
    if (data?.schemaVersion !== 1 || data.repository !== 'isHarryh/Ark-Models' || !/^[a-f0-9]{40}$/.test(data.revision) || !Array.isArray(data.entries)) throw new Error('模型检索数据损坏');
    this.revision = data.revision;
    this.updatedAt = data.updatedAt;
    this.entries = new Map();
    for (const entry of data.entries) {
      const root = ROOTS[entry.category];
      if (!root || !component(entry.id) || entry.key !== `${root}/${entry.id}` || this.entries.has(entry.key) || !entry.files?.length) throw new Error('模型目录记录无效');
      const seen = new Set();
      for (const file of entry.files) {
        if (!fileComponent(file.name) || seen.has(file.name.toLowerCase()) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 32 * 1024 * 1024 || !/^[a-f0-9]{40}$/.test(file.sha)) throw new Error('模型文件记录无效');
        seen.add(file.name.toLowerCase());
      }
      const base = entry.id.replace(/^dyn_illust_/, '').split('_').slice(0, 2).join('_');
      const form = FORMS[base] || '';
      const record = {...entry, form, bytes: entry.files.reduce((n, f) => n + f.size, 0)};
      record.searchText = normalize([entry.name, entry.englishName, entry.id, entry.group, form, entry.id.includes('#') ? '皮肤 时装' : '默认'].join(' '));
      this.entries.set(entry.key, record);
    }
    this.sorted = [...this.entries.values()].sort((a, b) => ORDER[a.category] - ORDER[b.category] || a.id.replace(/^dyn_illust_/, '').localeCompare(b.id.replace(/^dyn_illust_/, ''), 'en', {numeric: true}));
  }

  get(key) {
    const entry = typeof key === 'string' && this.entries.get(key);
    if (!entry) throw new Error('没有找到这个模型，请重新检索');
    return entry;
  }

  pageUrl(key) {
    return `https://github.com/isHarryh/Ark-Models/tree/${this.revision}/${encodePath(this.get(key).key)}`;
  }

  fileUrl(entry, file) {
    return `https://raw.githubusercontent.com/isHarryh/Ark-Models/${this.revision}/${encodePath(`${entry.key}/${file.name}`)}`;
  }

  search({query = '', category = 'all', offset = 0} = {}) {
    if (typeof query !== 'string' || query.length > 120 || (category !== 'all' && !ROOTS[category])) throw new Error('请输入有效的名称和模型分类');
    const terms = query.trim().split(/\s+/).filter(Boolean).map(normalize);
    const matches = this.sorted.filter(e => (category === 'all' || e.category === category) && terms.every(term => e.searchText.includes(term)));
    if (terms.length) matches.sort((a, b) => Number(normalize(b.name) === normalize(query)) - Number(normalize(a.name) === normalize(query)));
    const start = Math.max(0, Math.min(matches.length, Number.isSafeInteger(offset) ? offset : 0));
    return {total: matches.length, offset: start, limit: 24, updatedAt: this.updatedAt, revision: this.revision,
      counts: Object.fromEntries(Object.keys(ROOTS).map(k => [k, this.sorted.filter(e => e.category === k).length])),
      entries: matches.slice(start, start + 24).map(e => ({key: e.key, id: e.id, name: e.name || '名称待核实', englishName: e.englishName,
        category: e.category, categoryLabel: LABELS[e.category], group: e.group, form: e.form, nameSource: e.nameSource, bytes: e.bytes, fileCount: e.files.length}))};
  }
}

async function cachedFile(folder, file) {
  const candidates = path.extname(file.name) ? [file.name] : [file.name, `${file.name}.json`, `${file.name}.skel`];
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(path.join(folder, candidate));
      if (bytes.length === file.size && blobHash(bytes) === file.sha) return true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return false;
}

async function prepareFolder(folder, entry) {
  let names = await readdir(folder);
  // Some source skeletons have no extension. Detect their real format for the existing importer.
  for (const name of names.filter(name => !path.extname(name))) {
    const bytes = await readFile(path.join(folder, name));
    let extension;
    try {
      const data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (!Array.isArray(data.bones) || !data.skeleton) throw new Error('无效的 JSON 骨骼');
      extension = '.json';
    } catch {
      if (!bytes.subarray(0, 80).includes(Buffer.from('3.8'))) throw new Error(`无法识别骨骼格式：${name}`);
      extension = '.skel';
    }
    if (names.includes(name + extension)) throw new Error('骨骼文件名重复');
    await rename(path.join(folder, name), path.join(folder, name + extension));
  }
  names = await readdir(folder);
  const stem = (entry.category === 'operator' ? 'build_char_' + entry.id : entry.category === 'enemy' ? 'enemy_' + entry.id : 'dyn_illust_char_' + entry.id.replace(/^dyn_illust_/, '')).toLowerCase();
  const preferred = (a, b) => Number(b.replace(/\.(skel|json|atlas)$/i, '').toLowerCase() === stem) - Number(a.replace(/\.(skel|json|atlas)$/i, '').toLowerCase() === stem) || a.localeCompare(b, 'en', {numeric: true});
  const modelFiles = names.filter(n => /\.(skel|json)$/i.test(n)).sort(preferred);
  const atlasFiles = names.filter(n => /\.atlas$/i.test(n)).sort(preferred);
  const textureCount = names.filter(n => /\.(png|jpg|jpeg|webp)$/i.test(n)).length;
  if (!modelFiles.length || !atlasFiles.length || !textureCount) throw new Error('模型缺少骨骼、图集或贴图，请打开下载页核对');
  return {canceled: false, folderPath: folder, folderName: path.basename(folder), modelFiles, atlasFiles, textureCount};
}

export class AssetDownloads {
  constructor({catalog, directory, fetch: fetcher = globalThis.fetch, timeoutMs = 90000, prepare = prepareFolder, directoryFor = entry => ROOTS[entry.category]}) {
    this.catalog = catalog;
    this.directory = path.resolve(directory);
    this.fetch = fetcher;
    this.timeoutMs = timeoutMs;
    this.prepare = prepare;
    this.directoryFor = directoryFor;
  }

  cancel() { this.active?.abort(); }

  async download(key, onProgress = () => {}) {
    const entry = this.catalog.get(key);
    if (this.active) throw new Error('已有素材正在下载，请等待或取消');
    const controller = new AbortController();
    this.active = controller;
    let staging;
    try {
      const parent = path.join(this.directory, this.catalog.revision, this.directoryFor(entry));
      const target = path.join(parent, entry.id);
      await mkdir(parent, {recursive: true});
      controller.signal.throwIfAborted();
      if ((await Promise.all(entry.files.map(f => cachedFile(target, f)))).every(Boolean)) {
        const selection = await this.prepare(target, entry);
        controller.signal.throwIfAborted();
        return {...selection, name: selection.name || entry.name || entry.id, cached: true};
      }
      staging = await mkdtemp(path.join(parent, '.download-'));
      let received = 0, lastProgress = 0;
      for (let index = 0; index < entry.files.length; index++) {
        const file = entry.files[index];
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]);
        const response = await this.fetch(this.catalog.fileUrl(entry, file), {signal, redirect: 'error'});
        if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）：${file.name}`);
        const reader = response.body.getReader();
        const output = await open(path.join(staging, file.name), 'wx');
        const hash = createHash('sha1').update(`blob ${file.size}\0`);
        let size = 0;
        try {
          while (true) {
            signal.throwIfAborted();
            const {done, value} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > file.size) throw new Error(`下载文件大小与目录不符：${file.name}`);
            hash.update(value);
            await output.writeFile(value);
            received += value.byteLength;
            if (Date.now() - lastProgress > 100) {
              onProgress({key, received, total: entry.bytes, file: file.name, completedFiles: index, fileCount: entry.files.length});
              lastProgress = Date.now();
            }
          }
          if (size !== file.size || hash.digest('hex') !== file.sha) throw new Error(`下载文件校验失败：${file.name}，请重试`);
        } finally {
          await reader.cancel().catch(() => {});
          await output.close();
        }
      }
      await this.prepare(staging, entry);
      controller.signal.throwIfAborted();
      // target is derived only from the validated bundled catalog and stays inside the download cache.
      await rm(target, {recursive: true, force: true});
      await rename(staging, target); staging = undefined;
      const selection = await this.prepare(target, entry);
      onProgress({key, received: entry.bytes, total: entry.bytes, completedFiles: entry.files.length, fileCount: entry.files.length});
      return {...selection, name: selection.name || entry.name || entry.id, cached: false};
    } catch (error) {
      if (controller.signal.aborted) return {canceled: true};
      if (error.name === 'TimeoutError') throw new Error('下载超时，请重试或打开下载页');
      throw error;
    } finally {
      try { if (staging) await rm(staging, {recursive: true, force: true}); }
      finally { this.active = undefined; }
    }
  }
}

export class ModelDownloads extends AssetDownloads {}
