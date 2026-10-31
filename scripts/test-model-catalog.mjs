import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ModelCatalog, ModelDownloads} from '../electron/model-catalog.mjs';

const data = JSON.parse(await readFile(new URL('../electron/data/ark-model-catalog.json', import.meta.url), 'utf8'));
const catalog = new ModelCatalog(data);
const hash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const root = path.resolve('.local/model-catalog-tests');
await mkdir(root, {recursive: true});

async function fixture(options = {}) {
  const id = '002_amiya_winter#1';
  const files = {'test.atlas': Buffer.from('test.png\nsize: 1,1\n'), 'test.png': Buffer.from('texture fixture'),
    [options.extensionless ? 'test' : 'test.skel']: Buffer.from(options.extensionless ? JSON.stringify({skeleton:{spine:'3.8.99'},bones:[{name:'root'}]}) : 'skeleton fixture')};
  const entry = {key:`models/${id}`,id,category:'operator',name:'阿米娅',englishName:'Amiya',group:'默认服装',nameSource:'repository',files:Object.entries(files).map(([name,bytes])=>({name,size:bytes.length,sha:hash(bytes)}))};
  const c = new ModelCatalog({...data,entries:[entry]});
  const directory = await mkdtemp(path.join(root,'download-'));
  const requests = [];
  const fetcher = async (url,init) => {
    requests.push(url);
    assert.equal(init.redirect,'error');
    assert.equal(new URL(url).hash,'');
    assert.match(new URL(url).pathname,/%231/);
    const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    return new Response(files[name]);
  };
  return {directory,entry,files,c,requests,downloads:new ModelDownloads({catalog:c,directory,fetch:options.fetch||fetcher,timeoutMs:options.timeoutMs||5000})};
}

test('bundled catalog covers every actual model directory and keeps missing names explicit', () => {
  assert.equal(catalog.entries.size,3112);
  assert.deepEqual(catalog.search().counts,{operator:953,enemy:2063,illustration:96});
  assert.equal(data.entries.filter(e=>!e.name).length,13);
  assert.equal(data.entries.filter(e=>e.nameSource==='game-data').length,8);
  assert.equal(data.entries.reduce((n,e)=>n+e.files.length,0),9365);
  for(const entry of data.entries) assert.ok(entry.files.some(f=>f.name.endsWith('.atlas')) && entry.files.some(f=>f.name.endsWith('.png')));
});

test('search finds Chinese/English names, profession forms, skin groups and full variant IDs', () => {
  assert.equal(catalog.search({query:'阿米娅'}).total,13);
  const skadi=catalog.search({query:'sKaDi',category:'illustration'});assert.ok(skadi.total>0 && skadi.entries.every(e=>e.name.includes('斯卡蒂')));
  const amiya=catalog.search({query:'阿米娅 近卫'});assert.ok(amiya.total>0 && amiya.entries.every(e=>e.id.includes('1001_amiya2')));
  assert.equal(catalog.search({query:'1003_ncbow_3'}).entries[0].name,'名称待核实');
  assert.ok(catalog.search({query:'风情街',category:'enemy'}).entries.some(e=>e.key==='models_enemies/17001_wmshp'));
  const page1=catalog.search({category:'enemy'}),page2=catalog.search({category:'enemy',offset:24});
  assert.equal(page1.total,2063); assert.equal(page1.entries.length,24);
  assert.equal(new Set([...page1.entries,...page2.entries].map(e=>e.key)).size,48);
  assert.equal(catalog.search({query:'不存在的角色名字'}).total,0);
});

test('source pages encode hash characters and reject arbitrary URLs/paths', () => {
  const key='models/002_amiya_epoque#4',url=new URL(catalog.pageUrl(key));
  assert.equal(url.hostname,'github.com'); assert.equal(url.hash,''); assert.match(url.pathname,/%234$/);
  for(const invalid of ['../../outside','https://example.com','models/does-not-exist']) assert.throws(()=>catalog.get(invalid));
  assert.throws(()=>catalog.search({category:'other'}));
  const bad=structuredClone(data);bad.entries[0].files[0].name='../outside.png';assert.throws(()=>new ModelCatalog(bad));
});

test('download saves complete verified models, reports progress and reuses verified cached files', async () => {
  const f=await fixture(),events=[];
  const result=await f.downloads.download(f.entry.key,p=>events.push(p));
  assert.equal(result.canceled,false);assert.equal(result.cached,false);assert.equal(result.textureCount,1);
  assert.deepEqual(result.modelFiles,['test.skel']);assert.deepEqual(result.atlasFiles,['test.atlas']);
  for(const [name,bytes]of Object.entries(f.files))assert.deepEqual(await readFile(path.join(result.folderPath,name)),bytes);
  assert.equal(events.at(-1).received,events.at(-1).total);
  const count=f.requests.length;assert.equal((await f.downloads.download(f.entry.key)).cached,true);assert.equal(f.requests.length,count);
  await writeFile(path.join(result.folderPath,'test.png'),'corrupt cache');
  assert.equal((await f.downloads.download(f.entry.key)).cached,false);assert.equal(f.requests.length,count*2);
});

test('extensionless JSON skeletons are recognized and importable without changing verified bytes', async () => {
  const f=await fixture({extensionless:true});const result=await f.downloads.download(f.entry.key);
  assert.deepEqual(result.modelFiles,['test.json']);
  assert.deepEqual(await readFile(path.join(result.folderPath,'test.json')),f.files.test);
  assert.equal((await f.downloads.download(f.entry.key)).cached,true);
});

test('integrity failures leave no partial model and a subsequent retry succeeds', async () => {
  const f=await fixture();const normal=f.downloads.fetch;
  f.downloads.fetch=async()=>new Response('bad');
  await assert.rejects(f.downloads.download(f.entry.key),/校验失败|大小/);
  const parent=path.join(f.directory,f.c.revision,'models');assert.deepEqual(await readdir(parent),[]);
  f.downloads.fetch=normal;assert.equal((await f.downloads.download(f.entry.key)).canceled,false);
});

test('HTTP failures do not create a selectable model', async () => {
  const f=await fixture({fetch:async()=>new Response('',{status:404})});
  await assert.rejects(f.downloads.download(f.entry.key),/HTTP 404/);
  assert.deepEqual(await readdir(path.join(f.directory,f.c.revision,'models')),[]);
});

test('cancellation interrupts transfer, cleans partial files and releases the download lock', async () => {
  let connected;const ready=new Promise(r=>connected=r);
  const f=await fixture({fetch:(_url,{signal})=>new Promise((_resolve,reject)=>{connected();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})});
  const downloading=f.downloads.download(f.entry.key);await ready;
  await assert.rejects(f.downloads.download(f.entry.key),/正在下载/);
  f.downloads.cancel();assert.deepEqual(await downloading,{canceled:true});
  assert.equal(f.downloads.active,undefined);assert.deepEqual(await readdir(path.join(f.directory,f.c.revision,'models')),[]);
});

test('network timeouts release partial files and remain retryable', async () => {
  const keepAlive=setTimeout(()=>{},1000);
  try {
    const f=await fixture({timeoutMs:30,fetch:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
    await assert.rejects(f.downloads.download(f.entry.key),/超时/);
    assert.equal(f.downloads.active,undefined);assert.deepEqual(await readdir(path.join(f.directory,f.c.revision,'models')),[]);
  } finally {clearTimeout(keepAlive);}
});
