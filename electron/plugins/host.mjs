import { createHash } from 'node:crypto';
import { API_VERSION, validateManifest, validateSnapshot, validatePayload, validateEvent, sanitizeConfig } from './contracts.mjs';
import { SettingsStore, sanitizeGlobals } from './settings-store.mjs';
import { PluginStorage } from './storage.mjs';
const empty=()=>({available:false,status:'waiting',pages:[]});
const failure=(code,message,retryable=false)=>({ok:false,error:{code,message,retryable}});
export class PluginHost {
  constructor({definitions,broker,userData,onUpdate=()=>{},onEvent=()=>{}}) {
    this.broker=broker;this.onUpdate=onUpdate;this.onEvent=onEvent;this.active=false;this.locked=false;this.records=new Map();this.queue=Promise.resolve();
    this.definitions=definitions.map(def=>({...def,manifest:validateManifest(def.manifest)}));
    for(const definition of this.definitions) {
      const manifest=definition.manifest;if(this.records.has(manifest.id)) throw new Error('Duplicate plugin ID');
      this.records.set(manifest.id,this.makeRecord(definition));
    }
    this.store=new SettingsStore(userData,this.definitions);
    this.storage=new PluginStorage(userData);
    broker.onLock=value=>{this.locked=Boolean(value);this.publish();};
  }
  get settings() { return this.store.data.global; }
  makeRecord(definition){
    const manifest=validateManifest(definition.manifest),origin=definition.origin==='external'?'external':'builtin';
    const allowed=origin==='external'?manifest.permissions.filter(p=>(definition.grantedPermissions??[]).includes(p)):manifest.permissions;
    return {manifest,origin,allowed,activate:definition.activate,enabled:definition.defaultEnabled??true,runtime:'disabled',epoch:0,revision:0,snapshot:empty(),assets:new Map(),cleanups:[],commands:new Set(),pendingCommands:new Set()};
  }
  addDefinition(definition){
    if(this.active) throw new Error('Use installDefinition after startup');const record=this.makeRecord(definition);
    if(this.records.has(record.manifest.id)) throw new Error('Duplicate plugin ID');this.definitions.push({...definition,manifest:record.manifest});this.records.set(record.manifest.id,record);
    this.store.data.plugins[record.manifest.id]={enabled:record.enabled,configVersion:record.manifest.configVersion,config:sanitizeConfig(record.manifest)};
  }
  installDefinition(definition,{enabled=true}={}){
    const operation=this.queue.then(async()=>{
      if(this.readOnly) throw new Error(this.settingsError);const record=this.makeRecord(definition),id=record.manifest.id,old=this.records.get(id);
      if(old?.origin==='builtin') throw new Error('内置插件不能替换');const next=structuredClone(this.store.data),saved=next.plugins[id];
      next.plugins[id]={enabled,configVersion:saved?.configVersion??record.manifest.configVersion,config:sanitizeConfig(record.manifest,saved?.config,{preserveUnknown:true})};
      await this.store.save(next);if(old) await this.deactivate(old);
      const index=this.definitions.findIndex(def=>def.manifest.id===id);if(index>=0)this.definitions.splice(index,1,definition);else this.definitions.push(definition);
      this.records.set(id,record);await this.sync(record);this.publish();return this.snapshot();
    });this.queue=operation.catch(()=>{});return operation;
  }
  uninstallDefinition(id){
    const operation=this.queue.then(async()=>{
      if(this.readOnly) throw new Error(this.settingsError);const record=this.records.get(id);if(record?.origin==='builtin') throw new Error('内置插件不能卸载');
      const next=structuredClone(this.store.data);if(next.plugins[id])next.plugins[id].enabled=false;await this.store.save(next);
      if(record)await this.deactivate(record);this.records.delete(id);const index=this.definitions.findIndex(def=>def.manifest.id===id);if(index>=0)this.definitions.splice(index,1);this.publish();return this.snapshot();
    });this.queue=operation.catch(()=>{});return operation;
  }
  async start() {
    if(this.active) return;this.active=true;
    try { await this.store.load(); }
    catch { this.settingsError='设置或已读记录无法安全迁移，已保留原文件。修复后重新启动；当前禁止覆盖保存。';this.readOnly=true;for(const record of this.records.values()) this.store.data.plugins[record.manifest.id].enabled=false; }
    this.broker.configure(this.settings);
    for(const record of this.records.values()) await this.sync(record);
    this.publish();
  }
  current(record,epoch) { return this.active && record.enabled && record.epoch===epoch && !record.abort?.signal.aborted; }
  async sync(record) {
    const saved=this.store.data.plugins[record.manifest.id];record.enabled=saved.enabled;
    if(!record.enabled || !this.active) { await this.deactivate(record);return; }
    if(record.manifest.apiVersion!==API_VERSION || saved.configVersion!==record.manifest.configVersion) {await this.deactivate(record);record.runtime='incompatible';record.error='插件接口或配置版本不兼容';return;}
    if(record.instance && record.runtime==='active') return;
    const epoch=++record.epoch;record.abort=new AbortController();record.runtime='starting';record.error=null;record.assets.clear();record.cleanups=[];
    const live=()=>this.current(record,epoch);
    const requireLive=()=>{if(!live()) throw new Error('Plugin activation cancelled');};
    const register=dispose=>{if(!live()){dispose();return;}record.cleanups.push(dispose);};
    const context={signal:record.abort.signal,startedAt:Date.now(),
      getConfig:()=>structuredClone(this.store.data.plugins[record.manifest.id].config),
      getPermissions:()=>[...record.allowed],
      getPreferences:()=>({details:this.settings.details}),
      isRead:key=>this.store.isRead(record.manifest.id,key),
      getReadKeys:()=>[...this.store.reads.keys()].filter(key=>key.startsWith(this.store.key(record.manifest.id,''))).map(key=>key.slice(this.store.key(record.manifest.id,'').length)),
      storage:{get:async key=>{requireLive();if(!record.allowed.includes('storage.own'))throw new Error('Storage permission denied');const value=await this.storage.get(record.manifest.id,key);requireLive();return value;},
        set:async(key,value)=>{requireLive();if(!record.allowed.includes('storage.own'))throw new Error('Storage permission denied');await this.storage.set(record.manifest.id,key,value,requireLive);}},
      fail:()=>{if(live())void this.deactivate(record).then(()=>{record.runtime='failed';record.error='外部插件停止响应或运行失败，可重启或卸载';this.publish();});},
      capabilities:this.broker.scope(record.allowed,{live,register,pluginId:record.manifest.id,onError:()=>{
        if(!live()) return;record.error='插件处理平台数据失败，可在角色管理器重启';record.snapshot={available:true,status:'error',message:record.error,pages:[]};this.publish();
      }}),
      assets:{put:(slot,data)=>{
        requireLive();if(typeof slot!=='string' || slot.length>200) throw new Error('Invalid asset slot');
        const ref=record.manifest.id+':'+epoch+':'+createHash('sha256').update(slot).digest('hex');
        if(typeof data!=='string' || data.length>4*1024*1024 || !/^data:image\/(?:png|jpeg|webp|bmp);base64,[A-Za-z0-9+/=\r\n]+$/.test(data)) {record.assets.delete(ref);return null;}
        const total=[...record.assets].reduce((n,[key,value])=>n+(key===ref?0:value.length),data.length);
        if(total>12*1024*1024 || (!record.assets.has(ref) && record.assets.size>=100)) return null;
        record.assets.set(ref,data);return ref;
      },remove:slot=>{requireLive();record.assets.delete(record.manifest.id+':'+epoch+':'+createHash('sha256').update(slot).digest('hex'));}},
      publish:snapshot=>{if(live()) this.accept(record,snapshot);},
      emit:event=>{if(live()){if(!record.allowed.includes('ui.reminders'))throw new Error('Reminder permission denied');this.emit(record,event);}},
      onCleanup:register};
    context.weather=context.capabilities.weather;
    context.deepseek=context.capabilities.deepseek;
    context.localService=context.capabilities.localService;
    try {
      const activation=Promise.resolve().then(()=>record.activate(context));
      activation.then(instance=>{if(!live()) return Promise.resolve().then(()=>instance?.dispose?.()).catch(()=>{});}).catch(()=>{});
      const instance=await this.withTimeout(activation,5000,record.abort.signal);
      if(!live()) {try {await instance?.dispose?.();}catch{}return;}
      if(!instance || typeof instance.getSnapshot!=='function' || typeof instance.dispose!=='function') throw new Error('Invalid plugin lifecycle');
      record.instance=instance;record.runtime='active';this.refresh(record);
    } catch { if(live()) {await this.deactivate(record);record.runtime='failed';record.error='插件启动失败，可在角色管理器重启';} }
  }
  accept(record,snapshot) {
    try {record.snapshot=validateSnapshot(snapshot,record.assets);record.revision++;record.error=null;}
    catch {record.error='插件返回了无效页面数据';record.snapshot={available:true,status:'error',message:record.error,pages:[]};}
    this.publish();
  }
  refresh(record) {if(record.instance && this.active && record.enabled) {try{this.accept(record,record.instance.getSnapshot());}catch{record.error='插件读取状态失败';record.snapshot={available:true,status:'error',message:record.error,pages:[]};this.publish();}}}
  snapshot() {
    const plugins=[...this.records.values()].map(record=>({...record.snapshot,id:record.manifest.id,manifest:record.manifest,origin:record.origin,grantedPermissions:record.allowed,enabled:record.enabled,runtime:record.runtime,epoch:record.epoch,revision:record.revision,error:record.error??null,
      config:structuredClone(this.store.data.plugins[record.manifest.id].config),
      unread:record.snapshot.pages.filter(page=>page.readKey && !this.store.isRead(record.manifest.id,page.readKey)).length,
      pages:record.snapshot.pages.map(page=>({...page,unread:Boolean(page.readKey && !this.store.isRead(record.manifest.id,page.readKey))})),assets:Object.fromEntries(record.assets)}));
    const order=new Map((this.settings.pluginOrder??[]).map((id,index)=>[id,index]));
    plugins.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
    return structuredClone({settings:this.settings,locked:this.locked,settingsError:this.settingsError??null,packageError:this.packageError??null,plugins});
  }
  publish() {
    if(!this.active || this.updateQueued) return;this.updateQueued=true;
    queueMicrotask(()=>{this.updateQueued=false;if(this.active) this.onUpdate(this.snapshot());});
  }
  emit(record,input) {
    if(!record.allowed.includes('ui.reminders')) return;
    let event;try{event=validateEvent(input);}catch{record.error='插件返回了无效提醒事件';this.publish();return;}
    if(this.store.seenEvent(record.manifest.id,event.dedupeKey)) return;
    this.store.recordEvent(record.manifest.id,event.dedupeKey);void this.store.saveRead().catch(()=>{this.settingsError='提醒记录保存失败，下次启动可能重复提示';this.publish();});
    if(!this.settings.subtitles || this.settings.quiet || this.locked || !record.enabled) return;
    if(event.readKeys?.length && event.readKeys.every(key=>this.store.isRead(record.manifest.id,key))) return;
    const content=this.settings.details?(event.summary.details??event.summary.private):event.summary.private;
    const text=record.origin==='external'?(this.settings.details?record.manifest.name+' · '+content:record.manifest.name+' · '+(event.count??1)+' 条新提醒'):content;
    this.onEvent({id:record.manifest.id+':'+event.id,pluginId:record.manifest.id,text,createdAt:event.createdAt,readKeys:event.readKeys,pageId:event.pageId});
  }
  setSettings(input={}) {
    const operation=this.queue.then(async()=>{
      if(this.readOnly) throw new Error(this.settingsError);
      if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Invalid settings');
      const next=structuredClone(this.store.data),globals={...next.global,...input.global};
      if(input.global?.customTheme&&typeof input.global.customTheme==='object'&&!Array.isArray(input.global.customTheme))globals.customTheme={...next.global.customTheme,...input.global.customTheme};
      next.global=sanitizeGlobals(globals);
      if(input.plugins && (typeof input.plugins!=='object' || Array.isArray(input.plugins))) throw new Error('Invalid plugin patch');
      for(const [id,patch] of Object.entries(input.plugins??{})) {
        const record=this.records.get(id);if(!record || !patch || typeof patch!=='object' || Array.isArray(patch)) throw new Error('Unknown plugin');
        const saved=next.plugins[id];
        if(Object.hasOwn(patch,'enabled')) {if(typeof patch.enabled!=='boolean') throw new Error('Invalid enable switch');saved.enabled=patch.enabled;}
        if(patch.config) {
          if(saved.configVersion!==record.manifest.configVersion) throw new Error('Incompatible plugin configuration');
          saved.config={...saved.config,...sanitizeConfig(record.manifest,{...saved.config,...patch.config})};
        }
      }
      await this.store.save(next);
      // Pure presentation changes must not reconfigure providers or touch their state.
      if(!Object.keys(input.plugins??{}).length&&Object.keys(input.global??{}).every(key=>['defaultVoiceEnabled','theme','customTheme','pluginOrder','companionOpacity','companionPosition','companionWidth','companionTrigger'].includes(key))){this.publish();return this.snapshot();}
      this.broker.configure(this.settings);
      for(const record of this.records.values()) {
        await this.sync(record);
        if(record.instance) {try{await record.instance.onSettingsChanged?.(structuredClone(next.plugins[record.manifest.id].config));this.refresh(record);}catch{record.error='插件设置更新失败';}}
      }
      this.publish();return this.snapshot();
    });this.queue=operation.catch(()=>{});return operation;
  }
  async acknowledge(pluginId,items) {
    const record=this.records.get(pluginId);if(!record?.enabled || !Array.isArray(items) || items.length>100) return failure('INVALID_READ','无效的已读请求');
    const pages=record.snapshot.pages;
    for(const item of items) {const page=pages.find(p=>p.id===item?.pageId && p.readKey===item?.readKey);if(page?.readKey) this.store.markRead(pluginId,page.readKey);}
    try {await this.store.saveRead();await record.instance?.onRead?.();this.refresh(record);return {ok:true};}catch{return failure('SAVE_FAILED','已读状态保存失败',true);}
  }
  async execute(pluginId,commandId,payload={}, {source='overlay'}={}) {
    const record=this.records.get(pluginId);
    if(!this.active || !record?.enabled || record.runtime!=='active') return failure('DISABLED','插件未运行');
    const command=record.manifest.commands?.find(item=>item.id===commandId);
    if(!command || !record.instance.execute) return failure('UNKNOWN_COMMAND','未声明的插件操作');
    if(command.managerOnly && source!=='manager') return failure('FORBIDDEN','请在角色管理器中执行此操作');
    if(command.permissions?.some(p=>!record.allowed.includes(p))) return failure('FORBIDDEN','插件没有所需权限');
    let params;try{params=validatePayload(command,payload);}catch{return failure('INVALID_PARAMS','无效的操作参数');}
    const epoch=record.epoch,slot=commandId+':'+(params.sessionId??'');if(record.commands.has(slot)) return failure('BUSY','操作正在进行');
    record.commands.add(slot);
    const controller=new AbortController(),cancel=()=>controller.abort();record.abort.signal.addEventListener('abort',cancel,{once:true});record.pendingCommands.add(controller);
    try {
      const data=await this.withTimeout(Promise.resolve().then(()=>record.instance.execute(commandId,params,{signal:controller.signal})),10000,controller.signal);
      if(!this.current(record,epoch)) return failure('CANCELLED','插件已关闭');
      this.refresh(record);return {ok:true,data:data??null};
    } catch {return failure(this.current(record,epoch)?'COMMAND_FAILED':'CANCELLED',this.current(record,epoch)?'操作失败或超时，请稍后重试':'插件已关闭',true);}
    finally {controller.abort();record.pendingCommands.delete(controller);record.abort?.signal.removeEventListener('abort',cancel);if(record.epoch===epoch) record.commands.delete(slot);}
  }
  withTimeout(promise,ms,signal) {
    return new Promise((resolve,reject)=>{
      const abort=()=>finish(reject,new Error('Cancelled'));const timer=setTimeout(()=>finish(reject,new Error('Timeout')),ms);
      function finish(callback,value){clearTimeout(timer);signal?.removeEventListener('abort',abort);callback(value);}
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted) abort();
      promise.then(value=>finish(resolve,value),error=>finish(reject,error));
    });
  }
  async deactivate(record) {
    ++record.epoch;record.abort?.abort();record.runtime='stopping';const instance=record.instance;record.instance=null;
    for(const dispose of record.cleanups.splice(0).reverse()) {try{dispose();}catch{}}
    record.commands.clear();record.assets.clear();record.snapshot=empty();
    try {if(instance) await this.withTimeout(Promise.resolve().then(()=>instance.dispose()),3000);}catch{}
    record.runtime='disabled';
  }
  restart(id) {const operation=this.queue.then(async()=>{const record=this.records.get(id);if(!record || !record.enabled) return failure('DISABLED','插件已禁用');await this.deactivate(record);await this.sync(record);this.publish();return {ok:record.runtime==='active'};});this.queue=operation.catch(()=>{});return operation;}
  async stop() {
    this.active=false;
    // Revoke every lease synchronously, even when Electron cannot await shutdown.
    const cleanups=[...this.records.values()].map(record=>this.deactivate(record));this.broker.stop();
    await Promise.allSettled(cleanups);await this.store.writes.catch(()=>{});await this.storage.flush();
  }
}
