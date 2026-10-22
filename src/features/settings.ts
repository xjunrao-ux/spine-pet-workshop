import {applyTheme,THEME_PRESETS,DEFAULT_CUSTOM_THEME} from './themes';
import { featureIcon } from './icons';
import { renderBlock, escapeHTML as esc } from '../plugins/renderer';
import type { PluginSnapshot, PluginState, SettingField, SettingsPatch, CommandResult } from '../plugins/types';
interface PackageResult {ok:boolean;cancelled?:boolean;snapshot?:PluginSnapshot;error?:string}
interface StartupState { supported:boolean;enabled:boolean;reason:string;ok?:boolean;error?:string }
interface SettingsAPI {
  get():Promise<PluginSnapshot>;set(settings:SettingsPatch):Promise<{ok:boolean;snapshot?:PluginSnapshot;error?:string}>;
  execute(id:string,command:string,payload:Record<string,unknown>):Promise<CommandResult>;restart(id:string):Promise<CommandResult>;
  installPlugin():Promise<PackageResult>;uninstallPlugin(id:string):Promise<PackageResult>;
  onNavigate?(callback:(id?:string)=>void):()=>void;preview():void;startup():Promise<StartupState>;setStartup(enabled:boolean):Promise<StartupState>;onState(callback:(state:PluginSnapshot)=>void):()=>void;
}
const runtimeNames:Record<string,string>={disabled:'已禁用',starting:'正在启动',active:'运行中',stopping:'正在停止',failed:'启动失败',incompatible:'版本不兼容'};
const capabilityNames:Record<string,string>={'net.local':'连接另行授权的本地服务（HTTP / SSE；令牌由宿主保管）','ai.deepseek':'使用已配置的 DeepSeek API（账户计费，插件无法读取密钥）','media.read':'读取系统媒体','media.control':'控制播放器','notifications.read':'读取系统通知','codex.read':'读取本机 Codex 状态','ui.reminders':'角色字幕提醒','storage.own':'本插件独立存储','weather.read':'受控天气查询（Open-Meteo）'};
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
  let state:PluginSnapshot,saving=false,queued:SettingsPatch={},selectedPlugin='',draggedPlugin='';
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
  const managerMessages=new Map<string,string>();
  const renderedMarkup=new WeakMap<Element,string>();
  let pointerTarget:Element|null=null,keyTarget:Element|null=null,renderPending=false,renderedPlugin='';
  const flush=()=>{if(state&&renderPending&&!pointerTarget&&!keyTarget)render(state);};
  document.addEventListener('pointerdown',event=>{keyTarget=null;pointerTarget=event.target instanceof Element?event.target:null;},true);
  const releasePointer=()=>setTimeout(()=>{pointerTarget=null;flush();},0);
  document.addEventListener('pointerup',releasePointer,true);document.addEventListener('pointercancel',releasePointer,true);
  document.addEventListener('keydown',event=>{if(['Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))keyTarget=event.target instanceof Element?event.target:null;},true);
  document.addEventListener('keyup',()=>setTimeout(()=>{keyTarget=null;flush();},0),true);
  document.addEventListener('focusout',event=>{if(keyTarget===event.target)keyTarget=null;setTimeout(flush,0);},true);
  window.addEventListener('blur',()=>{pointerTarget=null;keyTarget=null;setTimeout(flush,0);});

  function companionSettings(p:PluginState){
    if(p.manifest.presentation?.panel!=='bubble')return '';
    return '<section class="companion-appearance"><h4>输入框外观与位置</h4><label for="companion-opacity">输入框不透明度 <output id="companion-opacity-value">'+state.settings.companionOpacity+'%</output></label><input id="companion-opacity" type="range" min="0" max="100" value="'+state.settings.companionOpacity+'" /><p class="hint">0% 为透明背景，100% 为不透明；文字与按钮保持清晰。拖动输入框左侧手柄可移动到桌面任意位置。</p><button type="button" class="ghost-button" data-companion-reset>恢复输入框跟随角色</button></section>';
  }
  function themeIcon(accent:string,background:string,surface:string,ink:string){
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path fill="'+esc(accent)+'" d="M20 3C10.6 3 3 10.2 3 19.2 3 28.8 10.8 37 20 37h2.4c3.5 0 5.2-3.8 3.2-6.5-1.6-2.2-.2-5.3 2.6-5.3h3.5c3.2 0 5.3-2.7 5.3-5.9C37 10.1 29.4 3 20 3Z"/><circle cx="12" cy="16" r="3" fill="'+esc(background)+'"/><circle cx="20" cy="11" r="3" fill="'+esc(surface)+'"/><circle cx="29" cy="16" r="3" fill="'+esc(ink)+'"/><circle cx="11" cy="26" r="2.5" fill="'+esc(surface)+'"/></svg>';
  }
  function managerPages(p:PluginState){return '<div class="plugin-manager-pages" data-plugin-scope="'+esc(p.id)+'">'+(p.settingsPages??[]).map(page=>'<section class="plugin-manager-section"><h4>'+esc(page.title)+'</h4>'+page.blocks.concat(page.footer??[]).map(block=>renderBlock(block,p,p.runtime!=='active')).join('')+'</section>').join('')+'<p class="plugin-manager-status" role="status">'+esc(managerMessages.get(p.id)??'')+'</p></div>';}
  function setHTML(selector:string,html:string,force=false){
    const target=document.querySelector(selector)!;
    // Compare intended markup, since DOM serialization changes boolean attributes and SVG.
    if(renderedMarkup.get(target)===html)return true;
    if((pointerTarget&&target.contains(pointerTarget))||(keyTarget&&target.contains(keyTarget))){renderPending=true;return false;}
    if(!force&&target.contains(document.activeElement)&&document.activeElement?.matches('textarea,input:not([type=checkbox]):not([type=button]):not([type=submit]),select,[contenteditable=true]')){renderPending=true;return false;}
    const expanded=new Set([...target.querySelectorAll<HTMLDetailsElement>('details')].flatMap((details,index)=>details.open?[details.dataset.pluginDetails??String(index)]:[]));
    renderedMarkup.set(target,html);
    const drafts=new Map<string,Record<string,string>>();let focus:{id:string;name:string;start:number|null;end:number|null}|null=null;
    target.querySelectorAll<HTMLFormElement>('[data-command-form]').forEach(form=>{const values:Record<string,string>={};form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[name]').forEach(input=>{values[input.name]=input.value;if(input===document.activeElement)focus={id:form.dataset.formId!,name:input.name,start:input.selectionStart,end:input.selectionEnd};});drafts.set(form.dataset.formId!,values);});
    target.innerHTML=html;
    target.querySelectorAll<HTMLFormElement>('[data-command-form]').forEach(form=>{const values=drafts.get(form.dataset.formId!);if(!values)return;form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[name]').forEach(input=>{if(Object.hasOwn(values,input.name))input.value=values[input.name];const f=focus as {id:string;name:string;start:number|null;end:number|null}|null;if(f&&f.id===form.dataset.formId&&f.name===input.name){input.focus({preventScroll:true});if(f.start!==null&&f.end!==null)try{input.setSelectionRange(f.start,f.end);}catch{}}});});
    target.querySelectorAll<HTMLDetailsElement>('details').forEach((details,index)=>{details.open=expanded.has(details.dataset.pluginDetails??String(index));});
    return true;
  }
  function render(snapshot:PluginSnapshot){
    renderPending=false;state=snapshot;applyTheme(state.settings.theme,state.settings.customTheme);
    document.body.classList.toggle('reduce-motion',state.settings.reducedMotion);
    if(!state.plugins.some(p=>p.id===selectedPlugin))selectedPlugin=(state.plugins.find(p=>p.origin==='external')??state.plugins[0])?.id??'';
    setHTML('#theme-presets',THEME_PRESETS.map(t=>{const c=t.id==='custom'?state.settings.customTheme:{accent:t.accent,background:t.background,surface:'rgb('+t.surface+')',ink:t.ink};return '<button type="button" class="theme-preset" data-theme-choice="'+t.id+'" aria-pressed="'+(state.settings.theme===t.id)+'"><span class="theme-swatch">'+themeIcon(c.accent,c.background,c.surface,c.ink)+'</span><strong>'+t.name+'</strong><small>'+(state.settings.theme===t.id?'使用中':t.id==='custom'?'编辑颜色':'点击应用')+'</small></button>';}).join(''));
    document.querySelector('#custom-theme-controls')!.classList.toggle('hidden',state.settings.theme!=='custom');
    document.querySelectorAll<HTMLInputElement>('[data-custom-color]').forEach(input=>{const key=input.dataset.customColor as keyof typeof state.settings.customTheme;if(document.activeElement!==input)input.value=state.settings.customTheme[key];document.querySelector<HTMLOutputElement>('[data-custom-value="'+key+'"]')!.value=state.settings.customTheme[key];});

    setHTML('#feature-modules',state.plugins.map(p=>'<article class="feature-module"><div class="module-symbol">'+featureIcon(p.manifest.icon)+'</div><div><h3>'+esc(p.manifest.name)+'</h3><p>'+esc(p.manifest.description)+'</p><small>'+esc(p.enabled?(p.error??p.message??runtimeNames[p.runtime]):'已关闭')+'</small></div><input type="checkbox" data-plugin-id="'+esc(p.id)+'" data-plugin-enabled aria-label="启用'+esc(p.manifest.name)+'" '+(p.enabled?'checked':'')+' /></article>').join(''));
    if(!draggedPlugin){
      const p=state.plugins.find(p=>p.id===selectedPlugin);
      const cards=state.plugins.map(item=>'<article class="plugin-sort-card'+(item.id===selectedPlugin?' selected':'')+'" data-sort-plugin="'+esc(item.id)+'" draggable="true"><span class="plugin-sort-grip" title="拖动卡片排序">⠿</span><button type="button" class="plugin-select" data-plugin-select="'+esc(item.id)+'" aria-pressed="'+(item.id===selectedPlugin)+'"><span class="module-symbol">'+featureIcon(item.manifest.icon)+'</span><span><strong>'+esc(item.manifest.name)+'</strong><small>'+(item.origin==='external'?'ZIP':'内置')+' · '+esc(item.manifest.version)+' · '+esc(item.enabled?runtimeNames[item.runtime]:'已关闭')+'</small></span></button></article>').join('');
      const detail=p?'<section class="plugin-settings-detail" aria-label="插件设置"><header class="plugin-detail-heading"><div class="module-symbol">'+featureIcon(p.manifest.icon)+'</div><div><p class="kicker">PLUGIN SETTINGS</p><h3>'+esc(p.manifest.name)+' · 设置</h3></div><label class="plugin-enabled-label">启用<input type="checkbox" data-plugin-enabled data-plugin-id="'+esc(p.id)+'" '+(p.enabled?'checked':'')+' /></label></header><p class="hint">'+esc(p.manifest.description)+'</p><p class="hint" role="status">'+esc(p.error??p.message??'')+'</p>'+p.manifest.settingsSchema.map(field=>fieldHTML(p,field)).join('')+companionSettings(p)+managerPages(p)+'<details class="plugin-permissions"><summary>权限与兼容说明</summary><p class="hint">'+p.manifest.permissions.map(permission=>esc(capabilityNames[permission]??permission)).join('、')+'</p>'+p.manifest.compatibilityNotes.map(note=>'<p class="hint">'+esc(note)+'</p>').join('')+'</details><div class="feature-buttons"><button class="ghost-button" data-plugin-restart data-plugin-id="'+esc(p.id)+'" '+(!p.enabled?'disabled':'')+'>重启插件</button>'+p.manifest.commands.filter(command=>command.managerOnly&&command.label).map(command=>'<button class="ghost-button" data-plugin-command="'+esc(command.id)+'" data-plugin-id="'+esc(p.id)+'" '+(!p.enabled?'disabled':'')+'>'+esc(command.label)+'</button>').join('')+(p.origin==='external'?'<button class="ghost-button" data-plugin-uninstall data-plugin-id="'+esc(p.id)+'">卸载（保留数据）</button>':'')+'</div></section>':'<p class="hint">导入插件后可在这里设置。</p>';
      if(setHTML('#extension-registry','<aside class="plugin-card-list" aria-label="插件列表，可拖动排序">'+cards+'</aside>'+detail,renderedPlugin!==selectedPlugin))renderedPlugin=selectedPlugin;
    }
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
    document.querySelectorAll<HTMLElement>('[data-plugin-scope]').forEach(scope=>{const status=scope.querySelector('.plugin-manager-status');if(status)status.textContent=managerMessages.get(scope.dataset.pluginScope!)??'';});
    if(state.settingsError) status.textContent=state.settingsError;
    if(state.packageError) packageStatus.textContent=state.packageError;
  }
  async function save(patch:SettingsPatch){
    queued=mergePatch(queued,patch);if(saving) return;saving=true;status.textContent='正在保存…';
    try{while(Object.keys(queued).length){const next=queued;queued={};const result=await api!.set(next);if(!result.ok||!result.snapshot) throw new Error(result.error??'保存失败');render(result.snapshot);}status.textContent='已保存';}
    catch(error){status.textContent=String(error);void api!.get().then(render);}finally{saving=false;}
  }
  async function reorder(ids:string[]){
    const unknown=state.settings.pluginOrder.filter(id=>!ids.includes(id));
    await save({global:{pluginOrder:[...ids,...unknown]}});
  }
  document.addEventListener('click',event=>{
    const target=(event.target as Element).closest<HTMLElement>('[data-plugin-select],[data-theme-choice],[data-show-themes],[data-reset-custom-theme],[data-companion-reset]');if(!target)return;
    if(target.hasAttribute('data-reset-custom-theme'))void save({global:{theme:'custom',customTheme:{...DEFAULT_CUSTOM_THEME}}});
    if(target.hasAttribute('data-companion-reset'))void save({global:{companionPosition:null}});
    if(target.dataset.pluginSelect){selectedPlugin=target.dataset.pluginSelect;render(state);}
    if(target.dataset.themeChoice){applyTheme(target.dataset.themeChoice,state.settings.customTheme);void save({global:{theme:target.dataset.themeChoice}});}
    if(target.hasAttribute('data-show-themes')){document.querySelector<HTMLButtonElement>('[data-page=features]')?.click();document.querySelector('#theme-settings')?.scrollIntoView({block:'start'});}
  });
  const registry=document.querySelector<HTMLElement>('#extension-registry')!;
  const clearDrag=()=>{draggedPlugin='';registry.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(el=>el.classList.remove('dragging','drop-before','drop-after'));};
  registry.addEventListener('dragstart',event=>{
    const card=(event.target as Element).closest<HTMLElement>('[data-sort-plugin]');
    if(!card||!event.dataTransfer)return;
    draggedPlugin=card.dataset.sortPlugin!;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',draggedPlugin);card.classList.add('dragging');
  });
  registry.addEventListener('dragover',event=>{
    const card=(event.target as Element).closest<HTMLElement>('[data-sort-plugin]');if(!draggedPlugin||!card||card.dataset.sortPlugin===draggedPlugin)return;
    event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';
    registry.querySelectorAll('.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));
    const box=card.getBoundingClientRect();card.classList.add(event.clientY<box.y+box.height/2?'drop-before':'drop-after');
  });
  registry.addEventListener('drop',event=>{
    const card=(event.target as Element).closest<HTMLElement>('[data-sort-plugin]');if(!draggedPlugin||!card)return;
    event.preventDefault();const id=draggedPlugin,target=card.dataset.sortPlugin!,after=card.classList.contains('drop-after');clearDrag();if(id===target)return;
    const ids=state.plugins.map(p=>p.id).filter(p=>p!==id),index=ids.indexOf(target);if(index<0)return;ids.splice(index+(after?1:0),0,id);void reorder(ids);
  });
  registry.addEventListener('dragend',()=>{clearDrag();render(state);});
  document.addEventListener('input',event=>{
    const input=event.target as HTMLInputElement;
    if(input.dataset.customColor){const key=input.dataset.customColor as keyof typeof state.settings.customTheme;applyTheme('custom',{...state.settings.customTheme,[key]:input.value});document.querySelector<HTMLOutputElement>('[data-custom-value="'+key+'"]')!.value=input.value;}
    if(input.id==='companion-opacity')document.querySelector<HTMLOutputElement>('#companion-opacity-value')!.value=input.value+'%';
  });
  document.addEventListener('change',event=>{
    const input=event.target as HTMLInputElement;
    if(!input.closest('#page-features,#page-extensions')) return;
    const id=input.dataset.pluginId;
    if(input.dataset.customColor){const key=input.dataset.customColor as keyof typeof state.settings.customTheme;void save({global:{theme:'custom',customTheme:{...state.settings.customTheme,[key]:input.value}}});}
    if(input.id==='companion-opacity')void save({global:{companionOpacity:Number(input.value)}});
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
  async function managerExecute(scope:HTMLElement,command:string,payload:Record<string,unknown>,form?:HTMLFormElement){
    const id=scope.dataset.pluginScope!;if(scope.dataset.busy==='true')return;scope.dataset.busy='true';
    try{const result=await api!.execute(id,command,payload);managerMessages.set(id,result.ok?'已保存 / 操作完成':result.error?.message??'操作失败');
      if(result.ok&&(result.data as {resetForm?:boolean}|null)?.resetForm)form?.reset();
    }catch{managerMessages.set(id,'插件服务暂不可用');}finally{delete scope.dataset.busy;render(await api!.get());}
  }
  document.addEventListener('submit',event=>{const form=(event.target as Element).closest<HTMLFormElement>('[data-command-form]'),scope=form?.closest<HTMLElement>('[data-plugin-scope]');if(!form||!scope)return;event.preventDefault();if(!form.reportValidity())return;const payload:Record<string,unknown>=JSON.parse(form.dataset.basePayload??'{}');for(const input of form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[name]'))payload[input.name]=input.dataset.fieldType==='datetime'&&input.value?new Date(input.value).toISOString():input.value;void managerExecute(scope,form.dataset.commandForm!,payload,form);});
  document.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-command]'),scope=button?.closest<HTMLElement>('[data-plugin-scope]');if(!button||!scope||button.disabled)return;void managerExecute(scope,button.dataset.command!,JSON.parse(button.dataset.payload??'{}'));});
  async function packageAction(button:HTMLButtonElement,action:()=>Promise<PackageResult>,success:string){
    button.disabled=true;packageStatus.textContent='正在处理…';
    try{const result=await action();if(result.cancelled){packageStatus.textContent='已取消，没有修改插件。';return;}if(!result.ok)throw new Error(result.error??'插件操作失败');if(result.snapshot)render(result.snapshot);packageStatus.textContent=success;}
    catch(error){packageStatus.textContent=String(error);}finally{button.disabled=false;}
  }
  document.querySelector<HTMLButtonElement>('#plugin-import')!.addEventListener('click',event=>void packageAction(event.currentTarget as HTMLButtonElement,()=>api.installPlugin(),'插件已导入；如启动失败，可在下方查看状态并重启或卸载。'));
  document.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-plugin-uninstall]');if(button?.dataset.pluginId)void packageAction(button,()=>api.uninstallPlugin(button.dataset.pluginId!),'插件已卸载，数据保留。重新导入相同 ID 可继续使用。');});
  document.querySelector('#feature-preview')!.addEventListener('click',()=>api.preview());
  api.onNavigate?.(id=>{if(id)selectedPlugin=id;if(state)render(state);document.querySelector<HTMLButtonElement>('[data-page="extensions"]')?.click();});
  api.onState(value=>{if(!saving) render(value);});void api.get().then(render).catch(()=>{status.textContent='功能服务暂不可用';});
}
