import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { OWN_MEDIA_IDS, normalizeMediaState } from '../extensions/media-state.mjs';
export class WindowsAdapter {
  constructor({directory,platform=process.platform,spawnProcess=spawn}) {
    Object.assign(this,{directory,platform,spawnProcess});this.leases=new Map();this.pending=new Map();this.sequence=0;this.child=null;this.cache={};this.options={details:false};this.excludedPid=null;
  }
  configuration() {return {music:[...this.leases.values()].some(x=>x.kind==='media'),notifications:[...this.leases.values()].some(x=>x.kind==='notifications'),codex:[...this.leases.values()].some(x=>x.kind==='codexProbe'),details:this.options.details,excludedMediaIds:OWN_MEDIA_IDS,excludedPids:[this.excludedPid].filter(Boolean)};}
  configure(options) {
    this.options={...this.options,...options};
    if(!this.options.details && this.cache.notifications) this.cache.notifications=this.redact(this.cache.notifications);
    this.sendConfiguration();
  }
  redact(notices) {return {...notices,items:(notices.items??[]).map(item=>({...item,title:this.options.details?String(item.title??''):'',body:this.options.details?String(item.body??'').slice(0,4000):''}))};}
  acquire(kind,callback) {
    if(!['media','notifications','codexProbe'].includes(kind)) throw new Error('Invalid system subscription');
    const token=Symbol(kind);this.leases.set(token,{kind,callback});this.sync();
    if(this.cache[kind]!==undefined) callback(structuredClone(this.cache[kind]));
    return ()=>{this.leases.delete(token);if(![...this.leases.values()].some(x=>x.kind===kind)) delete this.cache[kind];this.sync();};
  }
  deliver(kind,value) {
    this.cache[kind]=value;
    for(const entry of [...this.leases.values()]) if(entry.kind===kind) {try{entry.callback(structuredClone(value));}catch{}}
  }
  ingest(message) {
    this.onLock?.(Boolean(message.locked));const config=this.configuration();
    if(config.music && message.media) this.deliver('media',normalizeMediaState(message.media));
    if(config.notifications && message.notifications) this.deliver('notifications',this.redact(message.notifications));
    if(config.codex) this.deliver('codexProbe',Boolean(message.codexRunning));
  }
  sync() {
    if(!this.leases.size) {this.stopChild();return;}
    if(this.child) {this.sendConfiguration();return;}
    if(this.platform!=='win32') {this.deliver('media',{sessions:[],error:'系统媒体服务仅支持 Windows'});this.deliver('notifications',{permission:'Unsupported',items:[],error:'系统通知仅支持 Windows'});return;}
    const child=this.spawnProcess('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.directory,'windows-bridge.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child=child;child.stdin.on('error',()=>{});child.stderr.resume();this.lines=readline.createInterface({input:child.stdout});
    this.lines.on('line',line=>{
      if(this.child!==child) return;let message;try{message=JSON.parse(line);}catch{return;}
      if(message.type==='reply') {const pending=this.pending.get(message.id);if(!pending) return;pending.cleanup();message.error?pending.reject(new Error('System operation failed')):pending.resolve(message.result);}
      else if(message.type==='snapshot') this.ingest(message);
    });
    const failed=()=>{
      if(this.child!==child) return;this.stopChild();this.deliver('media',{sessions:[],error:'Windows 系统服务暂不可用'});this.deliver('notifications',{permission:'Unknown',items:[],error:'Windows 系统服务暂不可用'});this.deliver('codexProbe',false);
      if(this.leases.size) this.retry=setTimeout(()=>this.sync(),5000);
    };
    child.on('error',failed);child.on('exit',failed);this.sendConfiguration();
  }
  sendConfiguration() {if(this.child && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify({method:'configure',params:this.configuration()})+'\n');}
  setExcludedPid(pid) {this.excludedPid=pid;this.sendConfiguration();}
  request(method,params,signal) {
    if(!this.child || signal?.aborted) return Promise.reject(new Error('System service unavailable'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence,abort=()=>{cleanup();reject(new Error('Cancelled'));},timer=setTimeout(()=>{cleanup();reject(new Error('System operation timed out'));},10000);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id);};
      this.pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});
      try {this.child.stdin.write(JSON.stringify({id,method,params})+'\n');}catch{cleanup();reject(new Error('System service unavailable'));}
    });
  }
  stopChild() {
    clearTimeout(this.retry);const child=this.child;this.child=null;this.lines?.close();this.lines=null;child?.stdin.end();child?.kill();
    for(const entry of [...this.pending.values()]) {entry.cleanup();entry.reject(new Error('System service stopped'));}
  }
  stop() {this.leases.clear();this.cache={};this.stopChild();}
}
