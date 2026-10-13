import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WeatherAdapter} from '../electron/plugins/weather-adapter.mjs';
import {activate} from '../examples/weather-plugin/provider.js';
import {validateSnapshot,validatePayload,sanitizeConfig} from '../electron/plugins/contracts.mjs';
import {inspectPluginZip} from '../electron/plugins/packages.mjs';
import {createZip} from '../electron/plugins/zip.mjs';
import {PluginHost} from '../electron/plugins/host.mjs';
import {createTestOptions} from './plugin-fixture.mjs';
const manifest=JSON.parse(await readFile(new URL('../examples/weather-plugin/plugin.json',import.meta.url),'utf8'));
import {rawWeather,city,fakeWeatherAdapter} from './weather-fixture.mjs';
const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn) {for(let i=0;i<100;i++){if(fn()) return;await pause(10);}assert.fail('Timed out waiting for weather job');}
async function fixture(t,{stored=null,weather=fakeWeatherAdapter(),failWrite=false,settings={}}={}) {
  const backing=new Map(stored === null ? [] : [['state',structuredClone(stored)]]),snapshots=[],controller=new AbortController(),config=sanitizeConfig(manifest,settings),cleanups=[];
  const context={signal:controller.signal,getConfig:()=>config,weather,storage:{get:async key=>structuredClone(backing.get(key)??null),set:async(key,value)=>{if(failWrite) throw new Error('Disk full');backing.set(key,structuredClone(value));}},publish:s=>snapshots.push(validateSnapshot(s)),onCleanup:fn=>cleanups.push(fn)};
  const instance=await activate(context);t.after(()=>{controller.abort();cleanups.forEach(fn=>fn());instance.dispose();});return {instance,backing,snapshots,config,controller};
}

test('weather ZIP validates, uses only supported components, and declares all form/button commands',async t=>{
  const source=await readFile(new URL('../examples/weather-plugin/provider.js',import.meta.url),'utf8');
  const bundle=inspectPluginZip(createZip({'plugin.json':JSON.stringify(manifest),'provider.js':source}));assert.equal(bundle.manifest.id,manifest.id);assert.doesNotMatch(source,/\bfetch\s*\(|\bimport\s/);
  const {instance}=await fixture(t);const snapshot=validateSnapshot(instance.getSnapshot());assert.equal(snapshot.pages.length,4);
  for(const page of snapshot.pages) for(const block of page.blocks) if(['form','button'].includes(block.type)){const command=manifest.commands.find(c=>c.id === block.commandId);assert.ok(command);if(block.type === 'button') validatePayload(command,block.payload);else for(const field of block.fields) assert.equal(command.fields[field.key].type,'string');}
});

test('adapter fixes destinations and options, normalizes data and caches without aliasing',async()=>{
  const calls=[];const adapter=new WeatherAdapter({fetchImpl:async(url,opts)=>{calls.push({url,opts});return response(url.hostname.startsWith('geocoding') ? {results:[{...city,id:123,admin1:city.region}]} : rawWeather());}});
  const found=await adapter.search({name:'上海'});assert.equal(found[0].region,'上海');found[0].name='changed';assert.equal((await adapter.search({name:'上海'}))[0].name,'上海');
  const weather=await adapter.forecast({latitude:31.23,longitude:121.47});assert.equal(weather.current.temperature,22);assert.equal(weather.hourly[1].temperature,null);assert.equal(weather.daily.length,2);assert.ok(weather.current.time.endsWith('Z'));
  await adapter.forecast({latitude:31.23,longitude:121.47});assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>c.url.hostname),['geocoding-api.open-meteo.com','api.open-meteo.com']);assert.equal(calls[1].url.searchParams.get('forecast_hours'),'24');assert.equal(calls[1].opts.redirect,'error');assert.equal(calls[1].opts.credentials,'omit');
  for(const params of [{latitude:NaN,longitude:1},{latitude:91,longitude:1},{latitude:0,longitude:null},{latitude:0,longitude:0,url:'http://localhost'},{latitude:[1],longitude:0}]) assert.throws(()=>adapter.forecast(params));
  for(const params of [{name:'a'},{name:'上海',url:'http://localhost'},{name:'a\n'},{name:99}]) assert.throws(()=>adapter.search(params));
});

test('adapter rejects invalid arrays, invalid values, non-JSON, oversized responses and HTTP failures',async()=>{
  const variants=[];const bad=rawWeather();bad.hourly.temperature_2m.pop();variants.push(response(bad));const nan=rawWeather();nan.current.relative_humidity_2m=101;variants.push(response(nan));
  variants.push(new Response('oops',{status:503}),new Response('<html/>',{headers:{'content-type':'text/html'}}),new Response(' '.repeat(262145),{headers:{'content-type':'application/json'}}));
  for(const value of variants){const adapter=new WeatherAdapter({fetchImpl:async()=>value});await assert.rejects(adapter.forecast({latitude:0,longitude:0}));assert.equal(adapter.active,0);assert.equal(adapter.cache.size,0);}
});

test('adapter aborts slow fetches and revokes requests on scope shutdown',async()=>{
  const slow=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));
  await assert.rejects(new WeatherAdapter({fetchImpl:slow,timeoutMs:20}).forecast({latitude:0,longitude:0}));
  const controller=new AbortController(),adapter=new WeatherAdapter({fetchImpl:slow});const pending=adapter.forecast({latitude:0,longitude:0},controller.signal);controller.abort();await assert.rejects(pending);assert.equal(adapter.active,0);
});

test('city search, selection, background refresh, units and persistence work independently',async t=>{
  const {instance,backing,config}=await fixture(t);await instance.execute('searchCity',{name:'上海'});await until(()=>instance.getSnapshot().pages[3].blocks.some(b=>b.commandId==='selectCity'));
  assert.deepEqual(await instance.execute('selectCity',{id:'123'}),{navigateTo:'current'});await until(()=>backing.get('state')?.weather);
  let snapshot=validateSnapshot(instance.getSnapshot());assert.match(snapshot.pages[0].blocks[1].text,/22.0 ℃/);assert.equal(snapshot.pages[2].blocks.find(b=>b.type==='list').items.length,2);
  config.unit='℉';instance.onSettingsChanged();assert.match(instance.getSnapshot().pages[0].blocks[1].text,/71.6 ℉/);
  const restored=await fixture(t,{stored:backing.get('state')});assert.equal(restored.instance.getSnapshot().pages[0].subtitle,'上海');
});

test('coordinate entry validates and failed saves retain previous data and recover the queue',async t=>{
  const {instance,backing}=await fixture(t);for(const latitude of ['','abc','91','Infinity','1e3']) await assert.rejects(instance.execute('setCoordinates',{name:'地点',latitude,longitude:'0'}));assert.equal(backing.size,0);
  await instance.execute('setCoordinates',{name:'赤道',latitude:'0',longitude:'0'});await until(()=>backing.get('state')?.weather);
  const failing=await fixture(t,{stored:backing.get('state'),failWrite:true});await assert.rejects(failing.instance.execute('setCoordinates',{name:'新地点',latitude:'1',longitude:'1'}));assert.equal(failing.instance.getSnapshot().pages[0].subtitle,'赤道');
  await assert.rejects(instance.execute('unknown',{}));instance.dispose();instance.dispose();await assert.rejects(instance.execute('refresh',{}));
});

test('offline refresh retains cache and damaged/future data never resets the store',async t=>{
  const weather=await fakeWeatherAdapter().forecast({latitude:0,longitude:0});weather.fetchedAt='2020-01-01T00:00:00Z';
  const stored={schemaVersion:1,sequence:1,location:city,weather};const {instance,backing}=await fixture(t,{stored,weather:{search:async()=>[],forecast:async()=>{throw new Error('Offline');}}});
  await until(()=>/失败/.test(instance.getSnapshot().message));assert.equal(instance.getSnapshot().status,'degraded');assert.deepEqual(backing.get('state'),stored);assert.match(instance.getSnapshot().pages[0].blocks[1].text,/22.0/);
  await assert.rejects(fixture(t,{stored:{...stored,schemaVersion:99}}));await assert.rejects(fixture(t,{stored:{...stored,weather:{}}}));
});

test('switching locations ignores late responses; stopping ignores all late publications',async t=>{
  const data=await fakeWeatherAdapter().forecast({latitude:0,longitude:0}),requests=[];
  const {instance,backing,snapshots}=await fixture(t,{weather:{search:async()=>[],forecast:params=>new Promise(resolve=>requests.push({params,resolve}))}});
  await instance.execute('setCoordinates',{name:'A',latitude:'0',longitude:'0'});await until(()=>requests.length===1);
  await instance.execute('setCoordinates',{name:'B',latitude:'1',longitude:'1'});await until(()=>requests.length===2);
  requests[0].resolve(data);await pause(20);assert.equal(backing.get('state').weather,null);requests[1].resolve(data);await until(()=>backing.get('state').weather);assert.equal(backing.get('state').location.name,'B');
  await pause(2000);await instance.execute('refresh');await until(()=>requests.length===3);instance.dispose();const count=snapshots.length;requests[2].resolve(data);await pause(20);assert.equal(snapshots.length,count);
});

test('weather permission is enforced by the host and leases cancel on disable',async t=>{
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-weather-')),options=createTestOptions();options.broker.weather=fakeWeatherAdapter();
  let context;const noGrant={...manifest,id:'test.weather-denied',permissions:[],commands:[]};const host=new PluginHost({...options,userData,definitions:[{manifest:noGrant,activate:c=>{context=c;return {getSnapshot:()=>({available:true,status:'ready',pages:[]}),dispose(){}};}}]});t.after(()=>host.stop());await host.start();await assert.rejects(context.weather.search({name:'上海'}));
  await host.installDefinition({manifest,activate,origin:'external',grantedPermissions:manifest.permissions});assert.equal(host.records.get(manifest.id).runtime,'active');await host.execute(manifest.id,'setCoordinates',{name:'上海',latitude:'31.23',longitude:'121.47'});await until(()=>host.records.get(manifest.id).snapshot.status==='ready');
  await host.setSettings({plugins:{[manifest.id]:{enabled:false}}});assert.equal(host.records.get(manifest.id).runtime,'disabled');await host.setSettings({plugins:{[manifest.id]:{enabled:true}}});assert.equal(host.records.get(manifest.id).runtime,'active');
});

test('adapter bounds concurrent requests and limits fresh requests per minute',async()=>{
  let resolveAll=[];const adapter=new WeatherAdapter({fetchImpl:()=>new Promise(resolve=>resolveAll.push(resolve))});
  const pending=Array.from({length:4},(_,i)=>adapter.forecast({latitude:i,longitude:0}));await assert.rejects(adapter.forecast({latitude:5,longitude:0}),/budget/);assert.equal(adapter.active,4);
  resolveAll.forEach(resolve=>resolve(response(rawWeather())));await Promise.all(pending);assert.equal(adapter.active,0);
  const limited=new WeatherAdapter({fetchImpl:async()=>response({results:[]})});for(let i=0;i<30;i++) await limited.search({name:'city'+i});await assert.rejects(limited.search({name:'new city'}),/budget/);assert.deepEqual(await limited.search({name:'city0'}),[]);
});

test('denying automatic refresh still permits manual queries and revoked leases reject cached calls',async t=>{
  const data=await fakeWeatherAdapter().forecast({latitude:0,longitude:0});data.fetchedAt='2020-01-01T00:00:00Z';
  const stored={schemaVersion:1,sequence:1,location:city,weather:data};let calls=0;
  const f=await fixture(t,{stored,settings:{autoRefresh:false},weather:{search:async()=>[],forecast:async()=>{calls++;return data;}}});
  await pause(10);assert.equal(calls,0);await f.instance.execute('refresh');await until(()=>calls===1);assert.equal(f.backing.get('state').location.name,'上海');
  const adapter=fakeWeatherAdapter(),controller=new AbortController();await adapter.forecast({latitude:0,longitude:0},controller.signal);controller.abort();await assert.rejects(adapter.forecast({latitude:0,longitude:0},controller.signal));
});

test('host disable cancels a real adapter request and the old context cannot reuse cached capability',async t=>{
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-weather-cancel-')),options=createTestOptions();let started=false,aborted=false,context;
  options.broker.weather=new WeatherAdapter({fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{started=true;signal.addEventListener('abort',()=>{aborted=true;reject(new Error('Aborted'));},{once:true});})});
  const host=new PluginHost({...options,userData,definitions:[{manifest,activate:c=>{context=c;return {getSnapshot:()=>({available:true,status:'ready',pages:[]}),dispose(){}};}}]});t.after(()=>host.stop());await host.start();
  const request=context.weather.forecast({latitude:0,longitude:0});const rejection=assert.rejects(request);await until(()=>started);await host.setSettings({plugins:{[manifest.id]:{enabled:false}}});await rejection;assert.equal(aborted,true);await assert.rejects(context.weather.forecast({latitude:0,longitude:0}));assert.equal(options.broker.weather.active,0);
});
