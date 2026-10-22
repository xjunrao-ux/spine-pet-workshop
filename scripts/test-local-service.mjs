import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalConnectionStore,LocalService,LocalSSEParser,validateLocalEndpoint,localRequestURL } from '../electron/plugins/local-service.mjs';
import { CapabilityBroker } from '../electron/plugins/capabilities.mjs';
import { inspectPluginZip,EXTERNAL_PERMISSIONS } from '../electron/plugins/packages.mjs';
import { PERMISSIONS } from '../electron/plugins/contracts.mjs';

const token='fixture-connection-token-only';
const encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from([...value].reverse().join('')),decryptString:bytes=>[...bytes.toString()].reverse().join('')};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await delay(5);}throw new Error('Fixture timeout');}
async function fixture(t,handler){
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return 'http://127.0.0.1:'+server.address().port+'/bridge/';
}
function serviceFor(endpoint,options={}){return new LocalService({connections:{read:async()=>({endpoint,token})},...options});}
async function settled(service,owner='test.first'){await Promise.all([...service.jobs.get(owner)?.values()??[]].map(job=>job.promise));}

test('endpoints require literal loopback and paths cannot escape the authorized prefix',()=>{
  assert.equal(validateLocalEndpoint('http://127.0.0.1:3080/bridge'),'http://127.0.0.1:3080/bridge/');
  assert.equal(validateLocalEndpoint('http://[::1]:3080/'),'http://[::1]:3080/');
  assert.equal(validateLocalEndpoint('http://127.0.0.1:80/'),'http://127.0.0.1:80/');
  for(const value of ['http://localhost:3080/','https://127.0.0.1:3080/','http://127.1:3080/','http://2130706433:3080/','http://127.0.0.2:3080/','http://0.0.0.0:3080/','http://example.com:3080/','http://user@127.0.0.1:3080/','http://127.0.0.1:3080/a/../','http://127.0.0.1:3080/a//','http://127.0.0.1:3080/?token=x','file:///x','http://127.0.0.1:65536/'])assert.throws(()=>validateLocalEndpoint(value),value);
  for(const value of ['https://evil.test','//evil.test','/../admin','/%2e%2e/admin','/a/./b','/a\\b','/info?secret=x','/info#x'])assert.throws(()=>localRequestURL('http://127.0.0.1:3080/bridge/',value),value);
  assert.equal(localRequestURL('http://127.0.0.1:3080/bridge/','/events',{sessionId:'a/b ?'}),'http://127.0.0.1:3080/bridge/events?sessionId=a%2Fb+%3F');
});

test('encrypted connection storage is per plugin, validates records and fails closed',async()=>{
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-local-')),store=new LocalConnectionStore({userData,encryption});
  assert.equal(await store.read('test.first'),null);await store.write('test.first',{endpoint:'http://127.0.0.1:3080/bridge/',token});
  assert.equal((await store.read('test.first')).token,token);assert.equal(await store.read('test.other'),null);
  assert.ok(!(await readFile(store.file('test.first'),'utf8')).includes(token));assert.throws(()=>store.file('../escape'));
  await assert.rejects(()=>new LocalConnectionStore({userData,encryption:{isEncryptionAvailable:()=>false}}).write('test.other',{endpoint:'http://127.0.0.1:3080/',token}),/ENCRYPTION/);
  await store.write('test.first',null);assert.equal(await store.read('test.first'),null);
});

test('SSE parsing handles byte-split UTF-8, CR/LF, comments, IDs, multiline data and incomplete EOF',()=>{
  const parser=new LocalSSEParser(),events=[];
  const bytes=Buffer.from('\ufeff: keepalive\r\nid: event-1\revent: update\ndata: 你好\r\ndata: 世界\r\nretry: 1000\r\n\r\nid:\ndata: next\n\ndata: incomplete');
  for(const byte of bytes)events.push(...parser.push(Uint8Array.of(byte)));
  assert.deepEqual(events,[{event:'update',data:'你好\n世界',lastEventId:'event-1',retry:1000},{event:'message',data:'next',lastEventId:'',retry:1000}]);
  const mixed=new LocalSSEParser(),mixedEvents=[];for(const byte of Buffer.from('data: mixed\r\n\n'))mixedEvents.push(...mixed.push(Uint8Array.of(byte)));assert.equal(mixedEvents[0].data,'mixed');
  assert.throws(()=>new LocalSSEParser().push(Buffer.from('data: '+'x'.repeat(65537))),/EVENT_LIMIT/);
});

test('HTTP uses only the saved prefix, injects credentials, keeps HTTP failures structured and redacts echoes',async t=>{
  const calls=[],endpoint=await fixture(t,(req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{calls.push({url:req.url,auth:req.headers.authorization,body,method:req.method});res.writeHead(req.url.endsWith('/denied')?403:200,{'content-type':'application/json','set-cookie':'ignored=true'});res.end(JSON.stringify({echo:token,body:body?JSON.parse(body):null}));});});
  const service=serviceFor(endpoint),events=[];service.subscribe('test.first',event=>events.push(event));
  assert.deepEqual(service.request('test.first',{requestId:'one',method:'POST',path:'/commands',body:{text:'你好'}}),{requestId:'one',accepted:true});
  await settled(service);assert.equal(calls[0].url,'/bridge/commands');assert.equal(calls[0].auth,'Bearer '+token);assert.equal(calls[0].method,'POST');
  assert.equal(events[0].data.echo,'[redacted]');assert.equal(events[0].data.body.text,'你好');assert.ok(!JSON.stringify(events).includes(token));
  service.request('test.first',{requestId:'two',method:'GET',path:'/denied'});await settled(service);assert.equal(events.at(-1).status,403);assert.equal(events.at(-1).ok,false);service.stop();
});

test('redirects are not followed, and response type/size failures never echo private server errors',async t=>{
  let otherHits=0;
  const endpoint=await fixture(t,(req,res)=>{
    if(req.url.endsWith('/redirect')){res.writeHead(302,{location:'/other'});res.end();}
    else if(req.url.endsWith('/huge')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify('x'.repeat(270000)));}
    else if(req.url.endsWith('/html')){res.writeHead(500,{'content-type':'text/html'});res.end(token);}
    else {otherHits++;res.end();}
  });
  const service=serviceFor(endpoint),events=[];service.subscribe('test.first',event=>events.push(event));
  for(const name of ['redirect','huge','html']){service.request('test.first',{requestId:name,method:'GET',path:'/'+name});await settled(service);assert.equal(events.at(-1).type,'request.error');}
  assert.equal(otherHits,0);assert.deepEqual(events.map(e=>e.code),['NETWORK_ERROR','RESPONSE_LIMIT','INVALID_CONTENT_TYPE']);assert.ok(!JSON.stringify(events).includes(token));service.stop();
});

test('request schema, concurrency and identities are bounded before network access',async()=>{
  const service=serviceFor('http://127.0.0.1:1/'),base={requestId:'one',method:'GET',path:'/info'};
  for(const extra of [{url:'http://evil/'},{headers:{Authorization:'x'}},{method:'CONNECT'},{body:{}},{query:{x:3}},{requestId:'../x'}])assert.throws(()=>service.request('test.first',{...base,...extra}));
  assert.throws(()=>service.request('test.first',{requestId:'big',method:'POST',path:'/x',body:'x'.repeat(65537)}),/BODY_LIMIT/);
  for(let i=0;i<4;i++)service.request('test.first',{...base,requestId:'r'+i});
  assert.throws(()=>service.request('test.first',{...base,requestId:'fifth'}),/BUSY/);assert.throws(()=>service.request('test.first',{...base,requestId:'r0'}),/DUPLICATE/);
  service.cancelAll('test.first');await settled(service);service.stop();
});

test('rejected response headers release bodies, and pre-network revocation prevents a late connection',async()=>{
  let cancelled=0;
  const service=serviceFor('http://127.0.0.1:1/',{fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'text/html'}})});
  service.request('test.first',{requestId:'wrong-type',method:'GET',path:'/info'});await settled(service);assert.equal(cancelled,1);
  let resolveConfig,calls=0;const events=[];
  const pending=new LocalService({connections:{read:()=>new Promise(resolve=>{resolveConfig=resolve;})},fetchImpl:async()=>{calls++;return new Response('{}',{headers:{'content-type':'application/json'}});}});
  pending.subscribe('test.first',event=>events.push(event));const controller=new AbortController();
  pending.request('test.first',{requestId:'late-config',method:'GET',path:'/info'},{signal:controller.signal});controller.abort();resolveConfig({endpoint:'http://127.0.0.1:1/',token});await settled(pending);
  assert.equal(calls,0);assert.equal(events.length,0);service.stop();pending.stop();
});

test('SSE resumes with Last-Event-ID, leaves business JSON opaque, and cancellation releases stream',async t=>{
  let lastId;
  const endpoint=await fixture(t,(req,res)=>{lastId=req.headers['last-event-id'];res.writeHead(200,{'content-type':'text/event-stream'});res.write('id: 12\nevent: arbitrary\ndata: {"anything":"你好"}\n\n');});
  const service=serviceFor(endpoint),events=[];service.subscribe('test.first',event=>events.push(event));
  service.stream('test.first',{streamId:'updates',path:'/events',lastEventId:'11'});await until(()=>events.some(event=>event.type==='stream.event'));
  assert.equal(lastId,'11');assert.equal(events.at(-1).data,'{"anything":"你好"}');assert.equal(events.at(-1).event,'arbitrary');
  assert.throws(()=>service.stream('test.first',{streamId:'another',path:'/events'}),/BUSY/);
  service.cancel('test.first',{streamId:'updates'});await settled(service);assert.equal(events.at(-1).code,'CANCELLED');assert.equal(service.jobs.size,0);service.stop();
});

test('request timeout, stream idle timeout and configuration changes stop local transports',async t=>{
  const endpoint=await fixture(t,(req,res)=>{if(req.url.endsWith('/events')){res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();}});
  const service=serviceFor(endpoint,{timeoutMs:60,idleMs:50}),events=[];service.subscribe('test.first',event=>events.push(event));
  service.request('test.first',{requestId:'timeout',method:'GET',path:'/slow'});await settled(service);assert.equal(events.at(-1).code,'TIMEOUT');
  service.stream('test.first',{streamId:'idle',path:'/events'});await settled(service);assert.equal(events.at(-1).code,'TIMEOUT');
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-local-save-')),store=new LocalConnectionStore({userData,encryption});await store.write('test.first',{endpoint,token});
  const other=new LocalService({connections:store}),seen=[];other.subscribe('test.first',event=>seen.push(event));other.stream('test.first',{streamId:'save',path:'/events'});await until(()=>seen.some(e=>e.type==='stream.open'));
  await other.save('test.first',null);await settled(other);assert.equal((await other.status('test.first')).configured,false);assert.ok(!seen.some(e=>e.type==='stream.error'));service.stop();other.stop();
});

test('capability authorization and revocation isolate plugins and suppress late results',async t=>{
  const endpoint=await fixture(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();});
  const service=serviceFor(endpoint),broker=new CapabilityBroker({localService:service,windows:{stop(){}}}),cleanups=[],seen=[];let live=true;
  const denied=broker.scope([],{live:()=>true,register:()=>{},pluginId:'test.denied'});await assert.rejects(()=>denied.localService.status(),/denied/);
  const allowed=broker.scope(['net.local'],{live:()=>live,register:fn=>cleanups.push(fn),pluginId:'test.first'}).localService;
  allowed.subscribe(event=>seen.push(event));assert.equal((await allowed.status()).configured,true);
  allowed.stream({streamId:'first',path:'/events'});await until(()=>seen.length>0);const count=seen.length;
  assert.equal(service.cancel('test.other',{streamId:'first'}).cancelled,false);live=false;cleanups.reverse().forEach(fn=>fn());await settled(service);
  assert.equal(seen.length,count);assert.equal(service.jobs.size,0);assert.throws(()=>allowed.request({requestId:'late',method:'GET',path:'/x'}),/denied/);broker.stop();
});

test('net.local is additive and existing external ZIP packages still validate',async()=>{
  assert.ok(PERMISSIONS.has('net.local'));assert.ok(EXTERNAL_PERMISSIONS.has('net.local'));
  for(const name of ['DeepSeek-Plugin-v1.0.0.zip','Weather-Plugin-v1.1.0.zip','Codex-Plugin-v1.1.0.zip']){const bundle=inspectPluginZip(await readFile(new URL('../release/plugins/'+name,import.meta.url)));assert.equal(bundle.manifest.apiVersion,1);}
});
