export interface AppUpdateState {
  currentVersion: string; latestVersion: string; phase: string; supported: boolean; reason: string;
  autoCheck: boolean; autoDownload: boolean; progress: number; notes: string; message: string; lastChecked: string; settingsError: string;
}
interface PluginUpdate {
  id: string; name: string; currentVersion: string; version: string; minHostVersion: string; compatible: boolean; busy: boolean;
}
export interface PluginUpdateState {phase: string; message: string; lastChecked: string; updates: PluginUpdate[]}
interface UpdateSnapshot {app: AppUpdateState; plugins: PluginUpdateState}
export interface UpdatesBridge {
  get(): Promise<UpdateSnapshot>; check(): Promise<AppUpdateState>; download(): Promise<AppUpdateState>;
  install(): Promise<{ok: boolean; error?: string}>;
  preferences(patch: {autoCheck?: boolean; autoDownload?: boolean}): Promise<{ok: boolean; error?: string; state?: AppUpdateState}>;
  checkPlugins(): Promise<PluginUpdateState>; installPlugin(id: string): Promise<{ok: boolean; cancelled?: boolean; error?: string}>;
  onState(callback: (state: UpdateSnapshot) => void): () => void;
}

export function initializeUpdates(api: UpdatesBridge | undefined, navigate: () => void) {
  const element = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
  const check = element<HTMLButtonElement>('app-update-check'), download = element<HTMLButtonElement>('app-update-download');
  const install = element<HTMLButtonElement>('app-update-install'), pluginCheck = element<HTMLButtonElement>('plugin-update-check');
  const autoCheck = element<HTMLInputElement>('update-auto-check'), autoDownload = element<HTMLInputElement>('update-auto-download');
  let revision = 0, preferencesBusy = false, latestApp: AppUpdateState | undefined, latestPlugins: PluginUpdateState | undefined;
  function badge() {
    const hasApp = latestApp?.latestVersion && !['current', 'checking'].includes(latestApp.phase);
    element('update-badge').classList.toggle('hidden', !hasApp && !latestPlugins?.updates.length);
  }
  function renderApp(state: AppUpdateState) {
    if (!state) return;
    latestApp = state;
    element('brand-version').textContent = `v${state.currentVersion}`;
    element('update-current-version').textContent = `当前版本 v${state.currentVersion}`;
    element('app-update-status').textContent = state.message;
    element('app-update-reason').textContent = state.reason;
    check.disabled = ['checking', 'downloading', 'installing'].includes(state.phase);
    download.classList.toggle('hidden', !state.supported || !state.latestVersion || !['available', 'error'].includes(state.phase));
    install.classList.toggle('hidden', state.phase !== 'downloaded');
    const progress = element<HTMLProgressElement>('app-update-progress');
    progress.classList.toggle('hidden', !['downloading', 'downloaded'].includes(state.phase)); progress.value = state.progress;
    progress.setAttribute('aria-label', `新版下载进度 ${Math.round(state.progress)}%`);
    autoCheck.checked = state.autoCheck; autoDownload.checked = state.autoDownload;
    autoCheck.disabled = preferencesBusy || Boolean(state.settingsError);
    autoDownload.disabled = preferencesBusy || !state.supported || Boolean(state.settingsError);
    element('update-preferences-status').textContent = state.settingsError;
    element('app-update-last-checked').textContent = state.lastChecked ? `上次检查：${new Date(state.lastChecked).toLocaleString('zh-CN')}` : '';
    element('app-update-notes-panel').classList.toggle('hidden', !state.notes);
    element('app-update-notes').textContent = state.notes;
    badge();
  }
  function renderPlugins(state: PluginUpdateState) {
    if (!state) return;
    latestPlugins = state; pluginCheck.disabled = state.phase === 'checking' || state.updates.some(e => e.busy);
    element('plugin-update-status').textContent = state.message;
    const list = element('plugin-update-list'); list.replaceChildren();
    for (const update of state.updates) {
      const row = document.createElement('div'); row.className = 'plugin-update-row';
      const copy = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('p');
      title.textContent = update.name; detail.className = 'hint';
      detail.textContent = `v${update.currentVersion} → v${update.version}` + (update.compatible ? ' · 配置与数据保留' : ` · 请先升级主程序至 v${update.minHostVersion}`);
      copy.append(title, detail);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost-button'; button.dataset.pluginUpdate = update.id;
      button.textContent = update.busy ? '正在更新…' : update.compatible ? '更新插件' : '需升级主程序'; button.disabled = !update.compatible || update.busy;
      button.addEventListener('click', () => {void run(async () => {
        const result = await api!.installPlugin(update.id);
        if (!result.ok && result.error) element('plugin-update-status').textContent = result.error;
      }, 'plugin-update-status');});
      row.append(copy, button); list.append(row);
    }
    badge();
  }
  async function run(action: () => Promise<unknown>, status = 'app-update-status') {
    try {await action();} catch {element(status).textContent = '操作未完成，请稍后重试。当前版本仍可继续使用。';}
  }
  element('plugin-update-shortcut').addEventListener('click', () => {navigate(); if (api) void run(async () => renderPlugins(await api.checkPlugins()), 'plugin-update-status');});
  if (!api) {element('app-update-status').textContent = '请使用包含更新功能的桌宠版本'; return;}
  api.onState(state => {revision++; renderApp(state.app); renderPlugins(state.plugins);});
  const initialRevision = revision;
  void run(async () => {const state = await api.get(); if (revision === initialRevision) {renderApp(state.app); renderPlugins(state.plugins);}});
  check.addEventListener('click', () => void run(async () => renderApp(await api.check())));
  download.addEventListener('click', () => void run(async () => renderApp(await api.download())));
  install.addEventListener('click', () => void run(async () => {const result = await api.install(); if (!result.ok) element('app-update-status').textContent = result.error ?? '安装未完成';}));
  pluginCheck.addEventListener('click', () => void run(async () => renderPlugins(await api.checkPlugins()), 'plugin-update-status'));
  for (const [input, key] of [[autoCheck, 'autoCheck'], [autoDownload, 'autoDownload']] as const) input.addEventListener('change', () => {
    const patch = {[key]: input.checked}; preferencesBusy = true; if (latestApp) renderApp(latestApp);
    void run(async () => {
      try {const result = await api.preferences(patch); if (!result.ok) throw new Error(result.error); if (result.state) latestApp = result.state;}
      finally {preferencesBusy = false; if (latestApp) renderApp(latestApp);}
    }, 'update-preferences-status');
  });
}
