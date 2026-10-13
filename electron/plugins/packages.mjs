import { readFile,stat,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readZip,safeZipPath } from './zip.mjs';
import { validateManifest,API_VERSION } from './contracts.mjs';
import { atomicWrite } from './settings-store.mjs';
export const EXTERNAL_PERMISSIONS=new Set(['storage.own','ui.reminders','weather.read','codex.read']);
const hashBundle=bundle=>createHash('sha256').update(JSON.stringify({manifest:bundle.manifest,code:bundle.code})).digest('hex');
function validateBundle(bundle){
  const manifest=validateManifest(bundle.manifest);
  if(manifest.id.startsWith('workshop.')||manifest.apiVersion!==API_VERSION||manifest.packageVersion!==1||manifest.packageType!=='spine-pet-plugin') throw new Error('插件标识、包格式或接口版本不兼容');
  if(manifest.permissions.some(permission=>!EXTERNAL_PERMISSIONS.has(permission))) throw new Error('当前 ZIP 插件仅开放独立存储、角色提醒、受控天气与 Codex 只读权限');
  safeZipPath(manifest.entry);if(!/\.(?:js|mjs)$/.test(manifest.entry)||typeof bundle.code!=='string'||Buffer.byteLength(bundle.code)>512*1024||!bundle.code.trim()) throw new Error('插件入口必须是小于 512 KB 的打包 JavaScript 模块');
  return {manifest,code:bundle.code};
}
export function inspectPluginZip(bytes){
  const files=readZip(bytes),manifestBytes=files.get('plugin.json');if(!manifestBytes||manifestBytes.length>64*1024) throw new Error('ZIP 根目录需要 plugin.json');
  let manifest;try{manifest=JSON.parse(manifestBytes.toString('utf8'));}catch{throw new Error('plugin.json 不是有效 JSON');}
  const code=files.get(manifest.entry);if(!code) throw new Error('ZIP 缺少声明的插件入口');
  const bundle=validateBundle({manifest,code:code.toString('utf8')});return {...bundle,hash:hashBundle(bundle)};
}
export class PluginPackages {
  constructor({userData,makeProvider}){this.directory=path.join(userData,'plugins','packages');this.index=path.join(userData,'plugins','installed.json');this.makeProvider=makeProvider;this.installed=[];this.queue=Promise.resolve();}
  file(hash){if(!/^[a-f0-9]{64}$/.test(hash)) throw new Error('无效的插件校验码');return path.join(this.directory,hash+'.json');}
  async load({builtinIds=[]}={}){
    try{const data=JSON.parse(await readFile(this.index,'utf8'));if(data.schemaVersion!==1||!Array.isArray(data.installed)||data.installed.length>32) throw new Error('插件安装记录版本不兼容');this.installed=data.installed;}
    catch(error){if(error.code!=='ENOENT'){this.readOnly=true;throw error;}}
    const definitions=[],ids=new Set(),builtins=new Set(builtinIds);
    for(const entry of this.installed){
      if(!entry||typeof entry.id!=='string'||!/^[a-z][a-z0-9.-]{2,99}$/.test(entry.id)||entry.id.startsWith('workshop.')||ids.has(entry.id)){this.readOnly=true;throw new Error('插件安装记录重复或损坏');}ids.add(entry.id);
      if(builtins.has(entry.id))continue;
      try{
        const file=this.file(entry.hash);if((await stat(file)).size>2*1024*1024)throw new Error('插件包缓存过大');
        const bundle=validateBundle(JSON.parse(await readFile(file,'utf8')));
        if(hashBundle(bundle)!==entry.hash||bundle.manifest.id!==entry.id||!Array.isArray(entry.grants)||bundle.manifest.permissions.some(p=>!entry.grants.includes(p)))throw new Error('插件包校验或授权记录不匹配');
        definitions.push(this.definition(bundle,entry.grants));
      }catch{
        // A bad package stays visible for removal, but cannot execute or poison
        // otherwise valid packages. Its original cache and task data are kept.
        definitions.push({origin:'external',grantedPermissions:[],manifest:{id:entry.id,name:entry.id,version:'0.0.0',apiVersion:1,configVersion:1,icon:'note',entryVisibility:'when-enabled',permissions:[],description:'插件包校验失败或接口不兼容，请重新导入或卸载。',compatibilityNotes:['原包与独立数据均保留，未执行包内代码。'],commands:[],settingsSchema:[]},activate(){throw new Error('Quarantined package');}});
      }
    }
    const retained=this.installed.filter(entry=>!builtins.has(entry.id));
    if(retained.length!==this.installed.length){
      try{await writeFile(this.index+'.before-builtin.bak',JSON.stringify({schemaVersion:1,installed:this.installed},null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
      await atomicWrite(this.index,{schemaVersion:1,installed:retained});this.installed=retained;
    }
    return definitions;
  }
  definition(bundle,grants=bundle.manifest.permissions){return {...this.makeProvider(bundle),manifest:bundle.manifest,origin:'external',grantedPermissions:[...grants],defaultEnabled:true};}
  async inspect(file){const info=await stat(file);if(!info.isFile()||info.size>8*1024*1024) throw new Error('请选择小于 8 MB 的插件 ZIP');return inspectPluginZip(await readFile(file));}
  async install(bundle,host){
    const operation=this.queue.then(async()=>{
      const safe=validateBundle(bundle),hash=hashBundle(safe),old=[...this.installed],entry={id:safe.manifest.id,hash,grants:safe.manifest.permissions};
      if(this.readOnly)throw new Error('插件安装记录不可写，已保留原文件');
      if(host.readOnly) throw new Error('当前设置不可写，请先修复设置');
      if(host.records.get(safe.manifest.id)?.origin==='builtin')throw new Error('该插件已经内置，不能通过 ZIP 替换；请在管理器启用或禁用');
      const next=old.filter(item=>item.id!==entry.id);if(next.length>=32) throw new Error('外部插件安装数量已达上限');next.push(entry);
      await atomicWrite(this.file(hash),safe);await atomicWrite(this.index,{schemaVersion:1,installed:next});
      try{await host.installDefinition(this.definition(safe),{enabled:true});this.installed=next;return host.snapshot();}
      catch(error){await atomicWrite(this.index,{schemaVersion:1,installed:old});throw error;}
    });this.queue=operation.catch(()=>{});return operation;
  }
  async uninstall(id,host){
    const operation=this.queue.then(async()=>{if(this.readOnly)throw new Error('插件安装记录不可写');const old=[...this.installed];if(!old.some(item=>item.id===id)) throw new Error('只能卸载通过 ZIP 安装的插件');const next=old.filter(item=>item.id!==id);await atomicWrite(this.index,{schemaVersion:1,installed:next});
      try{await host.uninstallDefinition(id);this.installed=next;return host.snapshot();}catch(error){await atomicWrite(this.index,{schemaVersion:1,installed:old});throw error;}
    });this.queue=operation.catch(()=>{});return operation;
  }
}
