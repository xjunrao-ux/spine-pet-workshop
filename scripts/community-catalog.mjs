import {readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectPluginZip} from '../electron/plugins/packages.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const schema=JSON.parse(await readFile(new URL('../community/schema.json',import.meta.url),'utf8'));

// Only the JSON Schema keywords used by our checked-in schema are needed.
function check(value,rule,location){
  const type=Array.isArray(value)?'array':value===null?'null':typeof value;
  if(rule.type==='integer'?!Number.isInteger(value):type!==rule.type)throw new Error(`${location}: expected ${rule.type}`);
  if(Object.hasOwn(rule,'const')&&value!==rule.const)throw new Error(`${location}: unsupported value`);
  if(rule.enum&&!rule.enum.includes(value))throw new Error(`${location}: unsupported value`);
  if(type==='string'&&(value.length<(rule.minLength??0)||value.length>(rule.maxLength??Infinity)||rule.pattern&&!new RegExp(rule.pattern).test(value)))throw new Error(`${location}: invalid string`);
  if(type==='array'){
    if(value.length>(rule.maxItems??Infinity)||rule.uniqueItems&&new Set(value).size!==value.length)throw new Error(`${location}: invalid array`);
    value.forEach((item,index)=>check(item,rule.items,`${location}[${index}]`));
  }
  if(type==='object'){
    for(const key of rule.required??[])if(!Object.hasOwn(value,key))throw new Error(`${location}: missing ${key}`);
    for(const [key,item]of Object.entries(value)){
      if(!Object.hasOwn(rule.properties,key))throw new Error(`${location}: unknown field ${key}`);
      check(item,rule.properties[key],`${location}.${key}`);
    }
  }
}

function githubURL(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash||url.href!==value)throw new Error('Use a canonical HTTPS github.com URL without credentials, query or fragment');
  return url;
}

export function validateEntry(entry){
  check(entry,schema,'entry');
  if(entry.id.startsWith('workshop.'))throw new Error('Reserved builtin ID');
  const source=githubURL(entry.sourceUrl),download=githubURL(entry.downloadUrl);
  if(!/^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+(?:\/(?:tree|blob)\/[^\s]+)?$/.test(source.pathname))throw new Error('Invalid GitHub source URL');
  if(!/^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[^/]+\/[^/]+\.zip$/.test(download.pathname)||download.pathname.includes('/latest/'))throw new Error('Download must point to a fixed GitHub Release ZIP asset');
  return entry;
}

export async function readEntries(directory=path.join(root,'community/plugins')){
  const entries=[],ids=new Set();
  for(const file of (await readdir(directory)).sort()){
    if(!file.endsWith('.json'))throw new Error(`Unexpected catalog file: ${file}`);
    const entry=validateEntry(JSON.parse(await readFile(path.join(directory,file),'utf8')));
    if(file!==entry.id+'.json'||ids.has(entry.id))throw new Error(`Duplicate ID or filename mismatch: ${file}`);
    ids.add(entry.id);entries.push(entry);
  }
  return entries;
}

export function verifyArchive(entry,bytes){
  validateEntry(entry);
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error(`ZIP SHA-256 mismatch: ${entry.id}`);
  const {manifest}=inspectPluginZip(bytes);
  for(const key of ['id','name','version','apiVersion'])if(manifest[key]!==entry[key])throw new Error(`ZIP ${key} mismatch: ${entry.id}`);
  if(JSON.stringify([...manifest.permissions].sort())!==JSON.stringify([...entry.permissions].sort()))throw new Error(`ZIP permissions mismatch: ${entry.id}`);
}

const cell=value=>String(value).replace(/[\\|\[\]<>`*_]/g,char=>'\\'+char).replace(/[\r\n]/g,' ');
export function renderTable(entries){
  return ['| 插件 | 作者 | 分类 | 版本 / 最低宿主 | 权限 | 下载 |','| --- | --- | --- | --- | --- | --- |',
    ...entries.map(e=>`| [${cell(e.name)}](${e.sourceUrl})：${cell(e.description)} | [${cell(e.author)}](https://github.com/${e.author}) | ${cell(e.category)} | ${e.version} / ${e.minHostVersion} | ${e.permissions.map(cell).join('、')||'无'} | [ZIP](${e.downloadUrl}) · [详情](plugins/${e.id}.json) |`)].join('\n');
}

export function renderCatalogDocument(source,entries){
  const normalized=source.replaceAll('\r\n','\n');
  const marker=/<!-- catalog:start -->[\s\S]*?<!-- catalog:end -->/g;
  if([...normalized.matchAll(marker)].length!==1)throw new Error('Catalog README needs exactly one generated table');
  return normalized.replace(marker,()=>`<!-- catalog:start -->\n${renderTable(entries)}\n<!-- catalog:end -->`);
}

export async function catalog({write=false,archives}={}){
  const entries=await readEntries(),file=path.join(root,'community/README.md'),source=await readFile(file,'utf8');
  const output=renderCatalogDocument(source,entries);
  if(write)await writeFile(file,output);else if(output!==source.replaceAll('\r\n','\n'))throw new Error('Catalog table is stale. Run pnpm community:generate');
  if(archives)for(const entry of entries){
    const filename=path.basename(new URL(entry.downloadUrl).pathname);
    verifyArchive(entry,await readFile(path.join(archives,filename)));
  }
  return {ok:true,entries:entries.length,archivesVerified:Boolean(archives)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),index=args.indexOf('--archives');
    if(args.some((arg,i)=>arg!=='--write'&&arg!=='--archives'&&!(index>=0&&i===index+1))||index>=0&&(!args[index+1]||args[index+1].startsWith('--')))throw new Error('Usage: node scripts/community-catalog.mjs [--write] [--archives directory]');
    console.log(JSON.stringify(await catalog({write:args.includes('--write'),archives:index>=0?path.resolve(args[index+1]):undefined})));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
