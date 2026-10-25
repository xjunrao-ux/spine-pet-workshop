import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeConfig, readKey } from './contracts.mjs';
import { normalizeTheme, sanitizeCustomTheme, DEFAULT_CUSTOM_THEME } from './themes.mjs';

export const DEFAULT_GLOBALS={defaultVoiceEnabled:true,details:false,subtitles:true,quiet:false,reducedMotion:false,hoverDelay:300,cardWidth:282,cardHeight:285,aiCardWidth:420,aiCardHeight:500,theme:'graphite',customTheme:{...DEFAULT_CUSTOM_THEME},companionOpacity:86,companionWidth:340,companionTrigger:'hover',companionPosition:null,pluginOrder:[]};
export function sanitizeGlobals(input={}) {
  const result={...DEFAULT_GLOBALS};
  result.theme=normalizeTheme(input.theme);
  result.customTheme=sanitizeCustomTheme(input.customTheme);
  result.companionTrigger=input.companionTrigger==='click'?'click':'hover';
  result.companionPosition=input.companionPosition&&Number.isFinite(input.companionPosition.x)&&Number.isFinite(input.companionPosition.y)?{x:Math.round(Math.max(-100000,Math.min(100000,input.companionPosition.x))),y:Math.round(Math.max(-100000,Math.min(100000,input.companionPosition.y)))}:null;
  result.pluginOrder=[...new Set((Array.isArray(input.pluginOrder)?input.pluginOrder:[]).filter(id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)))].slice(0,128);
  for (const key of ['defaultVoiceEnabled','details','subtitles','quiet','reducedMotion']) if (typeof input[key]==='boolean') result[key]=input[key];
  for (const [key,min,max] of [['companionOpacity',0,100],['companionWidth',240,720],['hoverDelay',150,1200],['cardWidth',240,560],['cardHeight',230,640],['aiCardWidth',320,560],['aiCardHeight',360,640]]) if (Number.isFinite(input[key])) result[key]=Math.round(Math.max(min,Math.min(max,input[key])));
  return result;
}
export function startupVoiceEnabled(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return DEFAULT_GLOBALS.defaultVoiceEnabled;
  if (saved.schemaVersion === 2) return sanitizeGlobals(saved.global ?? {}).defaultVoiceEnabled;
  return saved.schemaVersion == null ? sanitizeGlobals(saved).defaultVoiceEnabled : DEFAULT_GLOBALS.defaultVoiceEnabled;
}
async function optionalFile(file) { try { return await readFile(file,'utf8'); } catch(error) { if(error.code==='ENOENT') return null;throw error; } }
export async function atomicWrite(file,value) {
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2));await rename(temporary,file);
}
export class SettingsStore {
  constructor(userData, definitions) {
    this.file=path.join(userData,'feature-settings.json');this.readFile=path.join(userData,'plugin-read-state.json');this.legacyReadFile=path.join(userData,'notification-read.json');
    this.definitions=definitions;this.writes=Promise.resolve();this.reads=new Map();this.events=new Map();
    this.data={schemaVersion:2,global:{...DEFAULT_GLOBALS},plugins:{}};
    for (const {manifest,defaultEnabled=true} of definitions) this.data.plugins[manifest.id]={enabled:defaultEnabled,configVersion:manifest.configVersion,config:sanitizeConfig(manifest)};
  }
  async load() {
    const raw=await optionalFile(this.file);
    if(raw!==null) {
      const value=JSON.parse(raw);
      if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid saved settings');
      if(value.schemaVersion!=null && value.schemaVersion!==2) throw new Error('Unsupported settings version');
      if(value.schemaVersion===2) {
        if (!value.plugins || typeof value.plugins!=='object' || Array.isArray(value.plugins)) throw new Error('Invalid plugin settings');
        this.data={...value,schemaVersion:2,global:sanitizeGlobals(value.global),plugins:{...value.plugins}};
        if(!this.data.plugins['io.spine-workshop.codex']&&this.data.plugins['workshop.codex'])this.data.plugins['io.spine-workshop.codex']=structuredClone(this.data.plugins['workshop.codex']);
        for(const {manifest,defaultEnabled=true} of this.definitions) {
          const saved=value.plugins[manifest.id] ?? {};
          this.data.plugins[manifest.id]={...saved,enabled:typeof saved.enabled==='boolean'?saved.enabled:defaultEnabled,configVersion:saved.configVersion ?? manifest.configVersion,config:sanitizeConfig(manifest,saved.config,{preserveUnknown:true})};
        }
      } else {
        this.data.global=sanitizeGlobals(value);
        for(const {manifest} of this.definitions) {
          if (typeof value[manifest.legacyId]==='boolean') this.data.plugins[manifest.id].enabled=value[manifest.legacyId];
          if (manifest.legacyId==='notifications') this.data.plugins[manifest.id].config=sanitizeConfig(manifest,{blockedApps:value.blockedApps});
        }
        try { await writeFile(this.file+'.v1.bak',raw,{flag:'wx'}); } catch(error) { if(error.code!=='EEXIST') throw error; }
        await atomicWrite(this.file,this.data);
      }
    }
    const readRaw=await optionalFile(this.readFile);
    if(readRaw!==null) {
      const saved=JSON.parse(readRaw);if(saved.schemaVersion!==1) throw new Error('Unsupported read-state version');
      this.reads=this.parseEntries(saved.reads);this.events=this.parseEntries(saved.events);
    } else {
      const old=await optionalFile(this.legacyReadFile);
      if(old!==null) {
        const entries=JSON.parse(old);
        if(!Array.isArray(entries)) throw new Error('Invalid legacy read-state');
        for(const entry of entries.slice(-1000)) if(Array.isArray(entry) && entry.length===2 && entry.every(v=>typeof v==='string' && v.length<200)) this.markRead('workshop.notifications',readKey(...entry));
        await this.saveRead();
      }
    }
    for(const entries of [this.reads,this.events])for(const [key,time] of [...entries])if(key.startsWith('workshop.codex\u001f')){const target='io.spine-workshop.codex'+key.slice('workshop.codex'.length);if(!entries.has(target))entries.set(target,time);}
    return this.data;
  }
  parseEntries(entries) { return new Map((Array.isArray(entries)?entries:[]).slice(-2000).filter(x=>Array.isArray(x) && x.length===2 && typeof x[0]==='string' && x[0].length<650 && Number.isFinite(x[1]))); }
  key(pluginId,key) { return pluginId+'\u001f'+key; }
  isRead(pluginId,key) { return this.reads.has(this.key(pluginId,key)); }
  markRead(pluginId,key) { this.reads.set(this.key(pluginId,key),Date.now()); }
  seenEvent(pluginId,key) { return this.events.has(this.key(pluginId,key)); }
  recordEvent(pluginId,key) { this.events.set(this.key(pluginId,key),Date.now()); }
  saveRead() {
    if(this.reads.size>2000) this.reads=new Map([...this.reads].slice(-2000));
    if(this.events.size>2000) this.events=new Map([...this.events].slice(-2000));
    const data={schemaVersion:1,reads:[...this.reads],events:[...this.events]};
    this.writes=this.writes.catch(()=>{}).then(()=>atomicWrite(this.readFile,data));return this.writes;
  }
  async save(data) { await atomicWrite(this.file,data);this.data=data; }
}
