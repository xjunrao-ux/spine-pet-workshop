import { app,BrowserWindow,ipcMain,session } from 'electron';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { codexCapabilityValue } from './codex-contract.mjs';
const SCHEME='pet-plugin-runtime',runtimes=new Map();let registered=false;
export const SANDBOX_SCHEME={scheme:SCHEME,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}};
function registerIPC(){
  if(registered)return;registered=true;
  const actor=event=>{const runtime=runtimes.get(event.sender.id);if(!runtime||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==runtime.url||runtime.stopped)throw new Error('无效的插件运行来源');return runtime;};
  ipcMain.handle('plugin-runtime:init',event=>actor(event).initial());
  ipcMain.handle('plugin-runtime:message',async(event,message)=>{try{return {ok:true,data:await actor(event).message(message)};}catch{return {ok:false};}});
}
const empty=()=>({available:true,status:'waiting',pages:[]});
class SandboxRuntime {
  constructor({root,bundle,context}){
    Object.assign(this,{root,bundle,context});this.snapshot=empty();this.pending=new Map();this.subscriptions=new Map();this.sequence=0;this.stopped=false;this.messageCount=0;this.period=Date.now();this.rpcCount=0;
  }
  inputs(){return {config:this.context.getConfig(),preferences:this.context.getPreferences(),readKeys:this.context.getReadKeys(),permissions:this.context.getPermissions(),startedAt:this.context.startedAt};}
  initial(){return {code:this.bundle.code,inputs:this.inputs()};}
  async start(){
    registerIPC();const token=randomUUID(),partition=session.fromPartition('plugin-'+token);this.session=partition;
    this.url=SCHEME+'://'+token+'/index.html';const routes=new Map([['/index.html','index.html'],['/runner.mjs','runner.mjs'],['/worker-code.mjs','worker-code.mjs']]);
    partition.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));partition.setPermissionCheckHandler(()=>false);
    partition.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;try{const url=new URL(details.url);allowed=(url.protocol===SCHEME+':'&&url.hostname===token&&routes.has(url.pathname)&&!url.search)||details.url.startsWith('blob:'+SCHEME+'://'+token+'/');}catch{}callback({cancel:!allowed});});
    partition.on('will-download',event=>event.preventDefault());
    partition.protocol.handle(SCHEME,async request=>{
      const url=new URL(request.url),file=routes.get(url.pathname);if(url.hostname!==token||!file||url.search)return new Response('Not found',{status:404});
      const bytes=await readFile(path.join(this.root,'electron','plugins','runtime',file));
      return new Response(bytes,{headers:{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8',
        'Content-Security-Policy':"default-src 'none'; script-src 'self' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"}});
    });
    const window=new BrowserWindow({show:false,width:1,height:1,skipTaskbar:true,webPreferences:{preload:path.join(this.root,'electron','plugins','runtime','preload.cjs'),session:partition,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,webSecurity:true,backgroundThrottling:false,webviewTag:false,devTools:false}});
    this.window=window;runtimes.set(window.webContents.id,this);this.context.onCleanup(()=>this.stop());
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.on('will-attach-webview',event=>event.preventDefault());
    window.webContents.on('render-process-gone',()=>this.crash());window.on('closed',()=>{if(!this.stopped)this.crash();});
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;this.startTimer=setTimeout(()=>{reject(new Error('插件启动超时'));this.crash();},4500);});
    this.ready.catch(()=>{});
    await window.loadURL(this.url);await this.ready;
    this.heartbeat=setInterval(async()=>{
      if(this.stopped||this.checking)return;this.checking=true;
      try{const metric=app.getAppMetrics().find(item=>item.pid===window.webContents.getOSProcessId());if(metric?.memory?.workingSetSize>384*1024)throw new Error('插件内存超限');await this.invoke('heartbeat',{},2000);}catch{this.crash();}finally{this.checking=false;}
    },5000);
    return {getSnapshot:()=>this.snapshot,execute:async(commandId,payload)=>this.invoke('execute',{commandId,payload}),
      onSettingsChanged:async()=>this.invoke('settings',{inputs:this.inputs()}),onRead:async()=>this.invoke('read',{inputs:this.inputs()}),dispose:()=>this.stop()};
  }
  async message(serialized){
    if(typeof serialized!=='string'||serialized.length>1024*1024){this.crash();throw new Error('插件消息超限');}
    if(Date.now()-this.period>1000){this.period=Date.now();this.messageCount=0;}if(++this.messageCount>120){this.crash();throw new Error('插件消息过于频繁');}
    let message;try{message=JSON.parse(serialized);}catch{this.crash();throw new Error('无效插件消息');}
    if(!message||typeof message!=='object')throw new Error('无效插件消息');
    if(message.kind==='ready'){this.snapshot=message.snapshot;this.context.publish(this.snapshot);clearTimeout(this.startTimer);this.resolveReady?.();return null;}
    if(message.kind==='reply'){
      const pending=this.pending.get(message.id);if(!pending)return null;clearTimeout(pending.timer);this.pending.delete(message.id);
      if(message.ok===true){if(message.snapshot){this.snapshot=message.snapshot;this.context.publish(this.snapshot);}pending.resolve(message.data??null);}else pending.reject(new Error('插件操作失败'));return null;
    }
    if(message.kind==='publish'){this.snapshot=message.snapshot;this.context.publish(this.snapshot);return null;}
    if(message.kind==='failed'){this.crash();throw new Error('插件执行失败');}
    if(message.kind!=='rpc'||!Number.isInteger(message.id)||this.rpcCount>=32)throw new Error('无效或过多的插件请求');
    ++this.rpcCount;
    try{
      if(message.method==='weather.search')return await this.context.weather.search(message.params);
      if(message.method==='weather.forecast')return await this.context.weather.forecast(message.params);
      if(message.method==='storage.get')return await this.context.storage.get(message.key);
      if(message.method==='storage.set'){await this.context.storage.set(message.key,message.value);return null;}
      if(message.method==='emit'){this.context.emit(message.event);return null;}
      if(message.method==='codex.subscribe'){
        const id=message.subscriptionId;if(typeof id!=='string'||!/^[a-zA-Z][a-zA-Z0-9.-]{0,60}$/.test(id)||this.subscriptions.size>=1)throw new Error('无效或重复的 Codex 订阅');
        const notify=channel=>value=>{if(this.stopped)return;const safe=codexCapabilityValue(channel,value);if(safe)this.window.webContents.send('plugin-runtime:request',{method:'capability',subscriptionId:id,channel,value:safe});};
        const release=this.context.capabilities.codex.subscribe(notify('state'),notify('event'));this.subscriptions.set(id,release);return null;
      }
      if(message.method==='codex.unsubscribe'){
        const release=this.subscriptions.get(message.subscriptionId);this.subscriptions.delete(message.subscriptionId);release?.();return null;
      }
      throw new Error('插件请求未授权的能力');
    }finally{--this.rpcCount;}
  }
  invoke(method,payload={},timeout=7000){
    if(this.stopped||this.window?.isDestroyed())return Promise.reject(new Error('插件已停止'));
    return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('插件响应超时'));this.crash();},timeout);this.pending.set(id,{resolve,reject,timer});this.window.webContents.send('plugin-runtime:request',{id,method,...payload});});
  }
  crash(){if(this.stopped)return;this.context.fail();this.stop();}
  stop(){
    if(this.stopped)return this.stopPromise;this.stopped=true;clearInterval(this.heartbeat);clearTimeout(this.startTimer);this.rejectReady?.(new Error('插件已停止'));
    for(const release of this.subscriptions.values())try{release();}catch{}this.subscriptions.clear();
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('插件已停止'));}this.pending.clear();
    if(this.window&&!this.window.isDestroyed()){runtimes.delete(this.window.webContents.id);this.window.webContents.send('plugin-runtime:request',{id:0,method:'dispose'});}
    this.stopPromise=new Promise(resolve=>setTimeout(()=>{
      try{if(this.window&&!this.window.isDestroyed()){this.window.webContents.forcefullyCrashRenderer();this.window.destroy();}}catch{}
      this.session?.protocol.unhandle(SCHEME);this.session?.webRequest.onBeforeRequest(null);resolve();
    },60));return this.stopPromise;
  }
}
export function createSandboxProvider({root,bundle}){return {activate:context=>new SandboxRuntime({root,bundle,context}).start()};}
