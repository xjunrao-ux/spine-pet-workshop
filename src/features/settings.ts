import { featureIcon } from './icons';
import { escapeHTML as esc } from '../plugins/renderer';
import type { PluginSnapshot, PluginState, SettingField, SettingsPatch, CommandResult } from '../plugins/types';
interface PackageResult {ok:boolean;cancelled?:boolean;snapshot?:PluginSnapshot;error?:string}
interface StartupState { supported:boolean;enabled:boolean;reason:string;ok?:boolean;error?:string }
interface SettingsAPI {
  get():Promise<PluginSnapshot>;set(settings:SettingsPatch):Promise<{ok:boolean;snapshot?:PluginSnapshot;error?:string}>;
  execute(id:string,command:string,payload:Record<string,unknown>):Promise<CommandResult>;restart(id:string):Promise<CommandResult>;
  installPlugin():Promise<PackageResult>;uninstallPlugin(id:string):Promise<PackageResult>;
  preview():void;startup():Promise<StartupState>;setStartup(enabled:boolean):Promise<StartupState>;onState(callback:(state:PluginSnapshot)=>void):()=>void;
}
const runtimeNames:Record<string,string>={disabled:'已禁用',starting:'正在启动',active:'运行中',stopping:'正在停止',failed:'启动失败',incompatible:'版本不兼容'};
const capabilityNames:Record<string,string>={'media.read':'读取系统媒体','media.control':'控制播放器','notifications.read':'读取系统通知','codex.read':'读取本机 Codex 状态','ui.reminders':'角色字幕提醒','storage.own':'本插件独立存储','weather.read':'受控天气查询（Open-Meteo）'};
function fieldHTML(plugin:PluginState,field:SettingField) {
  const value=plugin.config[field.key],attrs=' data-plugin-id="'+esc(plugin.id)+'" data-plugin-config="'+esc(field.key)+'"';
  let input='';
  if(field.type==='boolean') input='<input type="checkbox"'+attrs+(value?' checked':'')+' />';
  if(field.type==='number') input='<input type="number"'+attrs+' value="'+esc(value)+'" min="'+esc(field.min)+'" max="'+esc(field.max)+'" />';
  if(field.type==='enum') input='<select'+attrs+'>'+(field.options??[]).map(option=>'<option '+(option===value?'selected':'')+'>'+esc(option)+'</option>').join('')+'</select>';
  if(field.type==='stringList') input='<textarea class="plugin-config-list"'+attrs+' rows="3" aria-label="'+esc(field.label)+'">'+esc(Array.isArray(value)?value.join('\n'):'')+'</textarea>';
  return '<label class="feature-setting"><span><strong>'+esc(field.label)+'</strong><small>'+esc(field.description??'')+'</small></span>'+input+'</label>';
}
function mergePatch(left:SettingsPatch,right:SettingsPatch):SettingsPatch {
  const result={...left};
  if(right.global) result.global={...left.global,...right.global};
  if(right.plugins){
    result.plugins={...left.plugins};
    for(const [id,patch] of Object.entries(right.plugins)){
      const previous=result.plugins[id]??{};
      result.plugins[id]={...previous,...patch,...(patch.config?{config:{...previous.config,...patch.config}}:{})};
    }
  }
  return result;
}
export function initializeFeatureSettings() {
  const api=(window as Window & {featureSettings?:SettingsAPI}).featureSettings;if(!api) return;
  let state:PluginSnapshot,saving=false,queued:SettingsPatch={};
  const status=document.querySelector<HTMLElement>('#feature-save-status')!;
  const packageStatus=document.querySelector<HTMLElement>('#plugin-package-status')!;
  const startup=document.querySelector<HTMLInputElement>('#startup-enabled')!,startupStatus=document.querySelector<HTMLElement>('#startup-status')!;
  let startupBusy=false,lastStartup:StartupState={supported:false,enabled:false,reason:''};
  const renderStartup=(value:StartupState)=>{lastStartup=value;startup.checked=value.enabled;startup.disabled=!value.supported||startupBusy;startupStatus.textContent=value.error||value.reason||(value.enabled?'已开启 · 登录后自动启动桌宠':'已关闭 · 不会自动启动');};
  startup.addEventListener('change',async()=>{
    if(startupBusy) return;startupBusy=true;startup.disabled=true;startupStatus.textContent='正在保存…';
    try{const result=await api.setStartup(startup.checked);startupBusy=false;renderStartup(result);}catch{startupBusy=false;renderStartup(lastStartup);startupStatus.textContent='启动设置保存失败，请重新打开功能页后重试。';}
  });
  const refreshStartup=()=>{if(!startupBusy) void api.startup().then(value=>{if(!startupBusy) renderStartup(value);}).catch(()=>{if(!startupBusy){startupStatus.textContent='无法读取启动设置';startup.disabled=true;}});};
  window.addEventListener('focus',refreshStartup);refreshStartup();document.querySelector('[data-page=features]')?.addEventListener('click',refreshStartup);
  function setHTML(selector:string,html:string){
    const target=document.querySelector(selector)!;
    // Live polling must not discard text that the user is still editing.
    if(target.contains(document.activeElement) && document.activeElement?.matches('textarea,input[type=number]')) return;
    const expanded=new Set([...target.querySelectorAll<HTMLDetailsElement>('details[data-plugin-details][open]')].map(details=>details.dataset.pluginDetails));
    target.innerHTML=html;
    target.querySelectorAll<HTMLDetailsElement>('details[data-plugin-details]').forEach(details=>{details.open=expanded.has(details.dataset.pluginDetails);});
  }
  function render(snapshot:PluginSnapshot){
    state=snapshot;
    setHTML('#feature-modules',state.plugins.map(p=>'<article class="feature-module"><div class="module-symbol">'+featureIcon(p.manifest.icon)+'</div><div><h3>'+esc(p.manifest.name)+'</h3><p>'+esc(p.manifest.description)+'</p><small>'+esc(p.enabled?(p.error??p.message??runtimeNames[p.runtime]):'已关闭')+'</small></div><input type="checkbox" data-plugin-id="'+esc(p.id)+'" data-plugin-enabled aria-label="启用'+esc(p.manifest.name)+'" '+(p.enabled?'checked':'')+' /></article>').join(''));
    setHTML('#extension-registry',state.plugins.map(p=>'<article class="feature-options plugin-registry-item"><div class="plugin-registry-heading"><div class="module-symbol">'+featureIcon(p.manifest.icon)+'</div><div><h3>'+esc(p.manifest.name)+' <span class="module-tag">'+(p.origin==='external'?'ZIP':'内置')+' · '+esc(p.manifest.version)+'</span></h3><p class="hint">API v'+p.manifest.apiVersion+' · '+esc(runtimeNames[p.runtime])+'</p></div><input type="checkbox" data-plugin-id="'+esc(p.id)+'" data-plugin-enabled aria-label="启用'+esc(p.manifest.name)+'" '+(p.enabled?'checked':'')+' /></div><p class="hint">'+esc(p.manifest.description)+'</p><p class="hint" role="status">'+esc(p.error??p.message??'')+'</p><details data-plugin-details="'+esc(p.id)+'"><summary>设置、权限与兼容说明</summary><p class="hint">权限：'+p.manifest.permissions.map(permission=>esc(capabilityNames[permission]??permission)).join('、')+'</p>'+p.manifest.settingsSchema.map(field=>fieldHTML(p,field)).join('')+p.manifest.compatibilityNotes.map(note=>'<p class="hint">'+esc(note)+'</p>').join('')+'</details><div class="feature-buttons"><button class="ghost-button" data-plugin-restart data-plugin-id="'+esc(p.id)+'" '+(!p.enabled?'disabled':'')+'>重启插件</button>'+p.manifest.commands.filter(command=>command.managerOnly&&command.label).map(command=>'<button class="ghost-button" data-plugin-command="'+esc(command.id)+'" data-plugin-id="'+esc(p.id)+'" '+(!p.enabled?'disabled':'')+'>'+esc(command.label)+'</button>').join('')+(p.origin==='external'?'<button class="ghost-button" data-plugin-uninstall data-plugin-id="'+esc(p.id)+'">卸载（保留数据）</button>':'')+'</div></article>').join(''));
    setHTML('#plugin-compatibility-notes',state.plugins.map(p=>'<div><strong>'+esc(p.manifest.name)+'</strong>'+p.manifest.compatibilityNotes.map(note=>'<p class="hint">'+esc(note)+'</p>').join('')+'</div>').join(''));
    document.querySelectorAll<HTMLInputElement>('[data-feature-setting]').forEach(input=>{input.checked=Boolean(state.settings[input.dataset.featureSetting as keyof typeof state.settings]);});
    (document.querySelector('#feature-hover-delay') as HTMLSelectElement).value=String(state.settings.hoverDelay);
    setHTML('#feature-apps',state.plugins.filter(p=>p.grantedPermissions.includes('notifications.read')).flatMap(p=>p.manifest.settingsSchema.filter(field=>field.optionSource==='sources').map(field=>{
      const blocked=Array.isArray(p.config[field.key])?p.config[field.key] as string[]:[],apps=new Map((p.diagnostics?.sources??[]).map(item=>[item.id,item.name]));
      for(const id of blocked) if(!apps.has(id)) apps.set(id,id);
      return [...apps].map(([id,name])=>'<label class="feature-setting"><span><strong>'+esc(name)+'</strong></span><input type="checkbox" data-plugin-id="'+esc(p.id)+'" data-source-setting="'+esc(field.key)+'" data-source-id="'+esc(id)+'" aria-label="接收'+esc(name)+'通知" '+(blocked.includes(id)?'':'checked')+' /></label>').join('');
    })).join('')||'<p class="hint">收到系统通知后，应用会显示在这里。</p>');
    setHTML('#notification-channels',state.plugins.filter(p=>p.grantedPermissions.includes('notifications.read')).flatMap(p=>(p.diagnostics?.channels??[]).map(channel=>'<p class="hint"><strong>'+esc(channel.name)+'</strong> · '+esc(channel.message)+'</p>')).join(''));
    setHTML('#plugin-actions',state.plugins.flatMap(p=>p.manifest.commands.filter(command=>command.managerOnly&&command.label).map(command=>'<button class="ghost-button" data-plugin-command="'+esc(command.id)+'" data-plugin-id="'+esc(p.id)+'" '+(!p.enabled?'disabled':'')+'>'+esc(command.label)+'</button>')).join(''));
    if(state.settingsError) status.textContent=state.settingsError;
    if(state.packageError) packageStatus.textContent=state.packageError;
  }
  async function save(patch:SettingsPatch){
    queued=mergePatch(queued,patch);if(saving) return;saving=true;status.textContent='正在保存…';
    try{while(Object.keys(queued).length){const next=queued;queued={};const result=await api!.set(next);if(!result.ok||!result.snapshot) throw new Error(result.error??'保存失败');render(result.snapshot);}status.textContent='已保存';}
    catch(error){status.textContent=String(error);void api!.get().then(render);}finally{saving=false;}
  }
  document.addEventListener('change',event=>{
    const input=event.target as HTMLInputElement;
    if(!input.closest('#page-features,#page-extensions')) return;
    const id=input.dataset.pluginId;
    if(input.hasAttribute('data-plugin-enabled')&&id) void save({plugins:{[id]:{enabled:input.checked}}});
    if(input.dataset.featureSetting) void save({global:{[input.dataset.featureSetting]:input.checked}});
    if(input.id==='feature-hover-delay') void save({global:{hoverDelay:Number(input.value)}});
    if(input.dataset.sourceId&&input.dataset.sourceSetting&&id){
      const key=input.dataset.sourceSetting,p=state.plugins.find(p=>p.id===id),blocked=new Set((p?.config[key]??[]) as string[]);
      input.checked?blocked.delete(input.dataset.sourceId):blocked.add(input.dataset.sourceId);void save({plugins:{[id]:{config:{[key]:[...blocked]}}}});
    }
    if(input.dataset.pluginConfig&&id){
      const key=input.dataset.pluginConfig,field=state.plugins.find(p=>p.id===id)?.manifest.settingsSchema.find(field=>field.key===key);if(!field) return;
      const value=field.type==='boolean'?input.checked:field.type==='number'?Number(input.value):field.type==='stringList'?input.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean):input.value;
      void save({plugins:{[id]:{config:{[key]:value}}}});
    }
  });
  document.addEventListener('click',async event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-plugin-command],[data-plugin-restart]');if(!button||!button.dataset.pluginId) return;
    button.disabled=true;status.textContent='正在执行…';
    try{const result=button.dataset.pluginCommand?await api.execute(button.dataset.pluginId,button.dataset.pluginCommand,{}):await api.restart(button.dataset.pluginId);status.textContent=result.ok?'操作完成':result.error?.message??'操作失败';}
    catch{status.textContent='插件服务暂不可用';}finally{button.disabled=false;}
  });
  async function packageAction(button:HTMLButtonElement,action:()=>Promise<PackageResult>,success:string){
    button.disabled=true;packageStatus.textContent='正在处理…';
    try{const result=await action();if(result.cancelled){packageStatus.textContent='已取消，没有修改插件。';return;}if(!result.ok)throw new Error(result.error??'插件操作失败');if(result.snapshot)render(result.snapshot);packageStatus.textContent=success;}
    catch(error){packageStatus.textContent=String(error);}finally{button.disabled=false;}
  }
  document.querySelector<HTMLButtonElement>('#plugin-import')!.addEventListener('click',event=>void packageAction(event.currentTarget as HTMLButtonElement,()=>api.installPlugin(),'插件已导入；如启动失败，可在下方查看状态并重启或卸载。'));
  document.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-plugin-uninstall]');if(button?.dataset.pluginId)void packageAction(button,()=>api.uninstallPlugin(button.dataset.pluginId!),'插件已卸载，数据保留。重新导入相同 ID 可继续使用。');});
  document.querySelector('#feature-preview')!.addEventListener('click',()=>api.preview());
  api.onState(value=>{if(!saving) render(value);});void api.get().then(render).catch(()=>{status.textContent='功能服务暂不可用';});
}
