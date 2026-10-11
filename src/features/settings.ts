import { MODULES } from './types';
import { featureIcon } from './icons';
import type { FeatureSettings, FeatureSnapshot } from './types';
interface StartupState { supported: boolean; enabled: boolean; reason: string; ok?: boolean; error?: string }
interface SettingsAPI {
  get(): Promise<FeatureSnapshot>;
  set(settings: Partial<FeatureSettings>): Promise<{ok: boolean; snapshot?: FeatureSnapshot; error?: string}>;
  permission(): Promise<{ok: boolean; permission?: string; error?: string}>;
  preview(): void;
  startup(): Promise<StartupState>;
  setStartup(enabled: boolean): Promise<StartupState>;
  onState(callback: (state: FeatureSnapshot) => void): () => void;
}
export function initializeFeatureSettings() {
  const api = (window as Window & { featureSettings?: SettingsAPI }).featureSettings;
  if (!api) return;
  let state: FeatureSnapshot;
  let saving = false;
  let queued: Partial<FeatureSettings> = {};
  const status = document.querySelector<HTMLElement>('#feature-save-status')!;
  const startup = document.querySelector<HTMLInputElement>('#startup-enabled')!;
  const startupStatus = document.querySelector<HTMLElement>('#startup-status')!;
  let startupBusy = false;
  let lastStartup: StartupState = { supported: false, enabled: false, reason: '' };
  const renderStartup = (value: StartupState) => {
    lastStartup = value;
    startup.checked = value.enabled; startup.disabled = !value.supported || startupBusy;
    startupStatus.textContent = value.error || value.reason || (value.enabled ? '已开启 · 登录后自动启动桌宠' : '已关闭 · 不会自动启动');
  };
  startup.addEventListener('change', async () => {
    if (startupBusy) return;
    startupBusy = true; startup.disabled = true; startupStatus.textContent = '正在保存…';
    try { const result = await api.setStartup(startup.checked); startupBusy = false; renderStartup(result); }
    catch { startupBusy = false; renderStartup(lastStartup); startupStatus.textContent = '启动设置保存失败，请重新打开功能页后重试。'; }
  });
  const refreshStartup = () => { if (!startupBusy) void api.startup().then(value => { if (!startupBusy) renderStartup(value); }).catch(() => { if (!startupBusy) { startupStatus.textContent = '无法读取启动设置'; startup.disabled = true; } }); };
  window.addEventListener('focus', refreshStartup); refreshStartup();
  document.querySelector('[data-page=features]')?.addEventListener('click', refreshStartup);
  const esc = (value: string) => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  function render(snapshot: FeatureSnapshot) {
    state=snapshot;
    const statuses = {
      music: snapshot.media.error ?? (snapshot.media.sessions.length ? `已检测到 ${snapshot.media.sessions.length} 个播放器`:'等待播放器'),
      notifications: snapshot.notifications.error ?? (snapshot.notifications.permission==='Allowed'?`已连接 · ${snapshot.notifications.items.length} 条通知`:'需要通知访问权限'),
      codex: snapshot.codex.error ?? (snapshot.codex.connected?'已连接':snapshot.codex.running?'正在连接':'等待 Codex 启动')
    };
    document.querySelector('#feature-modules')!.innerHTML=MODULES.map(module=>`<article class="feature-module"><div class="module-symbol">${featureIcon(module.id)}</div><div><h3>${module.name}</h3><p>${module.description}</p><small>${state.settings[module.id]?esc(statuses[module.id]):'已关闭'}</small></div><input type="checkbox" data-feature-setting="${module.id}" aria-label="启用${module.name}" ${state.settings[module.id]?'checked':''} /></article>`).join('');
    document.querySelector('#extension-registry')!.innerHTML=MODULES.map(module=>`<article class="feature-module"><div><h3>${module.name} <span class="module-tag">内置 · 1.0</span></h3><p>${module.permission}</p><small>${state.settings[module.id]?'已启用':'已禁用'} · API v1</small></div></article>`).join('');
    document.querySelectorAll<HTMLInputElement>('[data-feature-setting]').forEach(input=> { const key=input.dataset.featureSetting as keyof FeatureSettings; input.checked=Boolean(state.settings[key]); });
    (document.querySelector('#feature-hover-delay') as HTMLSelectElement).value=String(state.settings.hoverDelay);
    const apps=new Map<string,string>();
    for(const item of state.notifications.items) apps.set(item.appId,item.app);
    for(const id of state.settings.blockedApps) if(!apps.has(id)) apps.set(id,id);
    document.querySelector('#feature-apps')!.innerHTML=[...apps].map(([id,name])=>`<label class="feature-setting"><span><strong>${esc(name)}</strong></span><input type="checkbox" data-app-id="${esc(id)}" aria-label="接收${esc(name)}通知" ${state.settings.blockedApps.includes(id)?'':'checked'} /></label>`).join('')||'<p class="hint">收到系统通知后，应用会显示在这里。</p>';
    document.querySelector('#notification-channels')!.innerHTML=(state.notifications.channels??[]).map(channel=>`<p class="hint"><strong>${esc(channel.name)}</strong> · ${channel.id==='wechat'||channel.id==='wecom'?'暂不支持 · 当前客户端不走系统通知':channel.observed?'已检测到系统通知':channel.running?'正在运行，尚未检测到系统通知':'未运行且暂无系统通知'}</p>`).join('');
  }
  async function save(patch: Partial<FeatureSettings>) {
    queued={...queued,...patch};
    if(saving) return;
    saving=true; status.textContent='正在保存…';
    try {
      while(Object.keys(queued).length) {
        const next=queued; queued={}; const result=await api!.set(next);
        if(!result.ok || !result.snapshot) throw new Error(result.error??'保存失败');
        render(result.snapshot);
      }
      status.textContent='已保存';
    } catch(error) { status.textContent=String(error); }
    finally {saving=false;}
  }
  document.querySelector('#page-features')!.addEventListener('change',event=> {
    const input=event.target as HTMLInputElement;
    if(input.dataset.featureSetting) void save({[input.dataset.featureSetting]:input.checked});
    if(input.id==='feature-hover-delay') void save({hoverDelay:Number(input.value)});
    if(input.dataset.appId) {
      const blocked=new Set(state.settings.blockedApps); input.checked?blocked.delete(input.dataset.appId):blocked.add(input.dataset.appId);
      void save({blockedApps:[...blocked]});
    }
  });
  document.querySelector('#notification-permission')!.addEventListener('click',async()=> {
    const result=await api.permission(); status.textContent=result.ok?`通知权限：${result.permission}`:result.error??'无法请求权限';
  });
  document.querySelector('#feature-preview')!.addEventListener('click',()=>api.preview());
  api.onState(value=> {if(!saving) render(value);});
  void api.get().then(render).catch(()=>{status.textContent='功能服务暂不可用';});
}
