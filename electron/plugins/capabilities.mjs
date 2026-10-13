import { WeatherAdapter } from './weather-adapter.mjs';
import { WindowsAdapter } from './windows-adapter.mjs';
import { CodexService } from '../extensions/codex-service.mjs';
export class CapabilityBroker {
  constructor({directory,windows,codexFactory,weather}={}) {
    this.weather=weather??new WeatherAdapter();
    this.windows=windows??new WindowsAdapter({directory});this.windows.onLock=value=>this.onLock?.(value);
    this.codexFactory=codexFactory??((state,event,pid)=>new CodexService(state,event,pid));this.codexSubscribers=new Set();this.codexState={running:false,connected:false,tasks:[]};
  }
  configure(globals) {this.windows.configure({details:globals.details});}
  subscribeCodex(onState,onEvent) {
    const entry={onState,onEvent};this.codexSubscribers.add(entry);
    if(!this.codex) {
      this.codex=this.codexFactory(state=>{this.codexState=state;for(const item of [...this.codexSubscribers]) item.onState(structuredClone(state));},event=>{for(const item of [...this.codexSubscribers]) item.onEvent(structuredClone(event));},pid=>this.windows.setExcludedPid(pid));
      this.releaseProbe=this.windows.acquire('codexProbe',running=>{if(running && !this.codex.running) void this.codex.start();else if(!running && this.codex.running) this.codex.stop();});
    }
    onState(structuredClone(this.codexState));
    return ()=>{this.codexSubscribers.delete(entry);if(!this.codexSubscribers.size) {this.releaseProbe?.();this.releaseProbe=null;this.codex?.stop();this.codex=null;this.codexState={running:false,connected:false,tasks:[]};}};
  }
  scope(permissions,{live,register,onError}) {
    const allowed=new Set(permissions),check=permission=>{if(!live() || !allowed.has(permission)) throw new Error('Capability denied');};
    const weatherController=new AbortController();register(()=>weatherController.abort());
    const weatherCall=async(method,params)=>{check('weather.read');const value=await this.weather[method](params,weatherController.signal);check('weather.read');return value;};
    const guarded=callback=>value=>{if(!live()) return;try{callback(value);}catch{onError?.();}};
    const scopedSubscribe=(permission,kind,callback)=>{check(permission);const release=this.windows.acquire(kind,guarded(callback));register(release);return release;};
    return Object.freeze({
      weather:Object.freeze({search:params=>weatherCall('search',params),forecast:params=>weatherCall('forecast',params)}),
      media:Object.freeze({subscribe:callback=>scopedSubscribe('media.read','media',callback),control:(action,sessionId,signal)=>{
        check('media.control');if(!['play','pause','toggle','next','previous'].includes(action)) throw new Error('Invalid media operation');
        const song=this.windows.cache.media?.sessions.find(item=>item.id===sessionId);if(!song) throw new Error('Player closed');
        const capability=action==='toggle'?(song.status==='Playing'?'pause':'play'):action;
        if(!song.capabilities?.[capability] && !(action==='toggle' && song.fallback && (song.capabilities?.play || song.capabilities?.pause))) throw new Error('Unsupported media operation');
        return this.windows.request('media',{action,sessionId},signal);
      }}),
      notifications:Object.freeze({subscribe:callback=>scopedSubscribe('notifications.read','notifications',callback),requestPermission:signal=>{check('notifications.read');return this.windows.request('permission',{},signal);}}),
      codex:Object.freeze({subscribe:(state,event)=>{check('codex.read');const release=this.subscribeCodex(guarded(state),guarded(event));register(release);return release;}})
    });
  }
  stop() {this.codexSubscribers.clear();this.releaseProbe?.();this.releaseProbe=null;this.codex?.stop();this.codex=null;this.windows.stop();}
}
