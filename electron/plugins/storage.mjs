import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { atomicWrite } from './settings-store.mjs';
export class PluginStorage {
  constructor(userData){this.directory=path.join(userData,'plugins','data');this.records=new Map();}
  async record(id){
    if(!this.records.has(id)){
      const file=path.join(this.directory,createHash('sha256').update(id).digest('hex')+'.json');
      const pending=(async()=>{let data={schemaVersion:1,values:{}};
        try{const raw=await readFile(file,'utf8');if(Buffer.byteLength(raw)>512*1024) throw new Error('插件数据超过配额');data=JSON.parse(raw);if(data.schemaVersion!==1||!data.values||typeof data.values!=='object'||Array.isArray(data.values)) throw new Error('插件数据版本不兼容');}
        catch(error){if(error.code!=='ENOENT') throw error;}
        return {file,data,queue:Promise.resolve()};})();this.records.set(id,pending);pending.catch(()=>this.records.delete(id));
    }
    return this.records.get(id);
  }
  key(key){if(typeof key!=='string'||!/^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/.test(key)||['constructor','prototype','__proto__'].includes(key)) throw new Error('无效的插件存储键');return key;}
  async get(id,key){this.key(key);const record=await this.record(id);return Object.hasOwn(record.data.values,key)?structuredClone(record.data.values[key]):null;}
  async set(id,key,value,check=()=>{}){
    this.key(key);const raw=JSON.stringify(value);if(raw===undefined||Buffer.byteLength(raw)>512*1024) throw new Error('插件数据超过配额');const safe=JSON.parse(raw),record=await this.record(id);
    const operation=record.queue.then(async()=>{check();const next={schemaVersion:1,values:{...record.data.values,[key]:safe}};if(Object.keys(next.values).length>100||Buffer.byteLength(JSON.stringify(next))>512*1024) throw new Error('插件存储空间已满');await atomicWrite(record.file,next);record.data=next;});record.queue=operation.catch(()=>{});await operation;
  }
  async flush(){await Promise.all([...this.records.values()].map(async promise=>{try{await(await promise).queue;}catch{}}));}
}
