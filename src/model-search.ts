export interface VoiceOption {
  key: string;
  characterId: string;
  language: string;
  label: string;
  bytes: number;
  clipCount: number;
  shared: boolean;
  skin: boolean;
}

export interface ModelSearchEntry {
  key: string;
  id: string;
  name: string;
  englishName: string;
  category: string;
  categoryLabel: string;
  group: string;
  form: string;
  nameSource: string;
  bytes: number;
  fileCount: number;
  voices: VoiceOption[];
}

export interface ModelSearchResults {
  total: number;
  offset: number;
  limit: number;
  updatedAt: string;
  revision: string;
  counts: {operator: number; enemy: number; illustration: number};
  voiceError?: string;
  entries: ModelSearchEntry[];
}

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function voiceControls(entry: ModelSearchEntry) {
  const voices = entry.voices ?? [];
  if (!voices.length) return `<p class="model-voice-unavailable">${entry.category === 'enemy' ? '此模型没有可导入的干员语音' : '语音库暂未收录可导入的配音'}</p>`;
  return `<div class="model-voice-actions"><label>角色语音<select data-model-voice aria-label="${escape(entry.name)}的配音语种">${voices.map(voice => `<option value="${escape(voice.key)}">${escape(voice.label)}${voice.skin ? ' · 皮肤专属' : voice.shared ? ' · 共用语音' : ''} · ${voice.clipCount} 句 · ${size(voice.bytes)}</option>`).join('')}</select></label><button type="button" class="ghost-button" data-open-voice="${escape(entry.key)}">语音下载页</button><button type="button" class="primary-button" data-download-voice="${escape(entry.key)}">下载语音并填入</button></div>`;
}

export function initializeModelSearch(api: PetSettingsBridge,
  selectModel: (selection: ModelFolderSelection & {name?: string}) => void,
  setImportBusy: (busy: boolean) => void,
  selectVoice: (selection: DownloadedVoiceSelection) => void | Promise<void>) {
  const query = document.querySelector<HTMLInputElement>('#model-search-query')!;
  const category = document.querySelector<HTMLSelectElement>('#model-search-category')!;
  const results = document.querySelector<HTMLElement>('#model-search-results')!;
  const summary = document.querySelector<HTMLElement>('#model-search-summary')!;
  const catalogSummary = document.querySelector<HTMLElement>('#model-catalog-summary')!;
  const voiceStatus = document.querySelector<HTMLElement>('#voice-catalog-status')!;
  const page = document.querySelector<HTMLElement>('#model-search-page')!;
  const prev = document.querySelector<HTMLButtonElement>('#model-search-prev')!;
  const next = document.querySelector<HTMLButtonElement>('#model-search-next')!;
  const panel = document.querySelector<HTMLElement>('#model-download-panel')!;
  const downloadName = document.querySelector<HTMLElement>('#model-download-name')!;
  const status = document.querySelector<HTMLElement>('#model-download-status')!;
  const progress = document.querySelector<HTMLProgressElement>('#model-download-progress')!;
  const cancel = document.querySelector<HTMLButtonElement>('#model-download-cancel')!;
  const drawer = document.querySelector<HTMLElement>('#model-search-drawer')!;
  const toggle = document.querySelector<HTMLButtonElement>('#model-search-toggle')!;
  let generation = 0, offset = 0, limit = 24;
  let submittedQuery = '', submittedCategory = 'all';
  let activeKey: string | undefined;
  let importing = false;
  let entries: ModelSearchEntry[] = [];

  function busy(value: boolean) {
    setImportBusy(value);
    results.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('[data-download-model], [data-download-voice], [data-model-voice]').forEach(button => { button.disabled = value || importing; });
    cancel.hidden = !value;
    cancel.disabled = false;
  }

  async function search() {
    const revision = ++generation;
    results.setAttribute('aria-busy', 'true');
    summary.textContent = '正在检索…';
    prev.disabled = true; next.disabled = true;
    try {
      const data = await api.searchModels({query: submittedQuery, category: submittedCategory, offset});
      if (revision !== generation) return;
      entries = data.entries; offset = data.offset; limit = data.limit;
      voiceStatus.textContent = data.voiceError ?? '';
      voiceStatus.classList.toggle('hidden', !data.voiceError);
      catalogSummary.textContent = `${data.counts.operator + data.counts.enemy + data.counts.illustration} 套模型 · ${data.updatedAt} 更新`;
      const end = Math.min(data.total, offset + entries.length);
      summary.textContent = data.total ? `找到 ${data.total} 套模型，显示第 ${offset + 1}–${end} 套` : '没有找到匹配模型，试试角色名的一部分、英文名或编号。';
      results.innerHTML = entries.map(entry => `
        <article class="model-result" data-model-key="${escape(entry.key)}">
          <div class="model-result-title"><strong>${escape(entry.name)}${entry.form ? ` <small>（${escape(entry.form)}）</small>` : ''}</strong><span>${escape(entry.categoryLabel)}</span></div>
          <p>${escape(entry.group || (entry.nameSource === 'unknown' ? '此变体名称待核实，可按编号下载' : '默认服装'))}${entry.englishName ? ` · ${escape(entry.englishName)}` : ''}</p>
          <code title="${escape(entry.id)}">${escape(entry.id)}</code>
          <div class="model-result-actions"><small>${entry.fileCount} 个文件 · ${size(entry.bytes)}</small><button type="button" class="ghost-button" data-open-model="${escape(entry.key)}">打开下载页</button><button type="button" class="primary-button" data-download-model="${escape(entry.key)}" ${activeKey || importing ? 'disabled' : ''}>下载并填入导入</button></div>
          ${voiceControls(entry)}
        </article>`).join('') || '<div class="model-search-empty">可切换模型分类或换一个关键词。</div>';
      results.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('[data-download-voice], [data-model-voice]').forEach(button => { button.disabled = Boolean(activeKey) || importing; });
      page.textContent = data.total ? `${Math.floor(offset / limit) + 1} / ${Math.ceil(data.total / limit)}` : '0 / 0';
      prev.disabled = offset === 0; next.disabled = end >= data.total;
      results.scrollTop = 0;
    } catch (error) {
      if (revision !== generation) return;
      summary.textContent = `检索失败：${message(error)}`;
      catalogSummary.textContent = '模型目录读取失败';
      results.innerHTML = '<button type="button" class="ghost-button" data-retry-search>重新读取模型目录</button>';
      page.textContent = '';
    } finally { if (revision === generation) results.setAttribute('aria-busy', 'false'); }
  }

  function setDrawerOpen(open: boolean) {
    drawer.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '收起搜索结果' : '展开搜索结果';
  }
  function refresh() {
    submittedQuery = query.value; submittedCategory = category.value; offset = 0;
    toggle.hidden = false; setDrawerOpen(true); void search();
  }
  toggle.addEventListener('click', () => setDrawerOpen(drawer.hidden));
  query.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); refresh(); } });
  document.querySelector('#model-search-submit')!.addEventListener('click', () => refresh());
  prev.addEventListener('click', () => { offset = Math.max(0, offset - limit); void search(); });
  next.addEventListener('click', () => { offset += limit; void search(); });

  api.onModelDownloadProgress(value => {
    if (value.key !== activeKey) return;
    progress.max = Math.max(1, value.total); progress.value = value.received;
    status.textContent = `${size(value.received)} / ${size(value.total)}${value.file ? ` · ${value.file}` : ''}`;
  });
  cancel.addEventListener('click', async () => {
    cancel.disabled = true;
    status.textContent = '正在取消下载…';
    try { await api.cancelModelDownload(); }
    catch (error) { cancel.disabled = false; status.textContent = `取消失败：${message(error)}`; }
  });
  results.addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-retry-search')) { refresh(); return; }
    if (button.dataset.openModel) {
      try { await api.openModelPage(button.dataset.openModel); }
      catch (error) { summary.textContent = `打开下载页失败：${message(error)}`; }
      return;
    }
    const voiceModelKey = button.dataset.downloadVoice || button.dataset.openVoice;
    if (voiceModelKey) {
      const entry = entries.find(item => item.key === voiceModelKey);
      const selected = button.closest('article')?.querySelector<HTMLSelectElement>('[data-model-voice]')?.value;
      const voice = entry?.voices?.find(item => item.key === selected);
      if (!entry || !voice) return;
      if (button.dataset.openVoice) {
        try { await api.openVoicePage(voice.key); }
        catch (error) { summary.textContent = `打开语音下载页失败：${message(error)}`; }
        return;
      }
      if (activeKey || importing) return;
      activeKey = voice.key; busy(true);
      panel.classList.remove('hidden'); panel.dataset.state = 'downloading';
      downloadName.textContent = `${entry.name} · ${voice.label}语音`;
      progress.max = Math.max(1, voice.bytes); progress.value = 0;
      status.textContent = '正在下载角色语音，完成后自动匹配分句和中文字幕…';
      try {
        const selection = await api.downloadVoice(voice.key);
        if (selection.canceled) { status.textContent = '语音下载已取消，原有选择已保留。'; panel.dataset.state = 'canceled'; return; }
        if (selection.error || !selection.path || !selection.characterId || !selection.language) throw new Error(selection.error || '下载的语音不完整');
        await selectVoice(selection);
        progress.value = progress.max; panel.dataset.state = 'complete';
        status.textContent = `语音已填入，匹配 ${selection.clipCount ?? voice.clipCount} 条中文字幕，可在下方试听并随角色一起导入。`;
      } catch (error) {
        panel.dataset.state = 'error';
        status.textContent = `语音下载失败：${message(error)}。可以重试，或点击“语音下载页”手动下载。`;
      } finally { activeKey = undefined; busy(false); }
      return;
    }
    const key = button.dataset.downloadModel;
    if (!key || activeKey || importing) return;
    const entry = entries.find(item => item.key === key);
    if (!entry) return;
    activeKey = key; busy(true);
    panel.classList.remove('hidden'); panel.dataset.state = 'downloading';
    downloadName.textContent = `${entry.name} · ${entry.id}`;
    progress.max = Math.max(1, entry.bytes); progress.value = 0;
    status.textContent = '正在连接 GitHub 并下载整套模型…';
    try {
      const selection = await api.downloadModel(key);
      if (selection.canceled) { status.textContent = '下载已取消，可以重新选择模型。'; panel.dataset.state = 'canceled'; return; }
      if (selection.error || !selection.folderPath || !selection.modelFiles?.length || !selection.atlasFiles?.length) throw new Error(selection.error || '下载的模型不完整');
      selectModel(selection);
      progress.value = progress.max;
      panel.dataset.state = 'complete';
      status.textContent = selection.cached ? '已填入之前下载的完整模型，可在下方预览并导入。' : '下载完成，已填入下方导入表单。预览确认后点击“导入并设为当前桌宠”。';
    } catch (error) {
      panel.dataset.state = 'error';
      status.textContent = `下载失败：${message(error)}。可以重试，或点击“打开下载页”手动下载。`;
    } finally { activeKey = undefined; busy(false); }
  });
  catalogSummary.textContent = '支持中文名、英文名与编号';
  return {setImporting(value: boolean) {
    importing = value;
    results.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('[data-download-model], [data-download-voice], [data-model-voice]').forEach(button => { button.disabled = Boolean(activeKey) || importing; });
  }};
}
