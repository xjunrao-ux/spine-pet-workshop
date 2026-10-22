import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeepSeekCredentials,DeepSeekService,consumeDeepSeekStream,validateDeepSeekRequest } from '../electron/plugins/deepseek-service.mjs';
import { activate } from '../examples/deepseek-plugin/provider.js';
import { CapabilityBroker } from '../electron/plugins/capabilities.mjs';
import { validateManifest,validateSnapshot } from '../electron/plugins/contracts.mjs';

const fixtureKey='sk-test-fixture-only';
const encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from([...value].reverse().join('')),decryptString:bytes=>[...bytes.toString()].reverse().join('')};
const input=id=>({requestId:id,model:'deepseek-flash',messages:[{role:'user',content:'你好'}]});
const frame=text=>'data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})+'\r\n\r\n';
const ending='data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{total_tokens:12}})+'\n\ndata: [DONE]\n\n';
const sse=text=>new Response(frame(text)+ending,{headers:{'content-type':'text/event-stream'}});
async function settled(service,id){const job=service.jobs.get(id);if(job)await job.promise;}

test('credentials are encrypted, isolated by plugin identity, clearable and never fall back to plaintext',async()=>{
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-deepseek-')),store=new DeepSeekCredentials({userData,encryption});
  assert.equal(await store.read('test.first'),null);await store.write('test.first',fixtureKey);
  assert.equal(await store.read('test.first'),fixtureKey);assert.equal(await store.read('test.second'),null);
  assert.ok(!(await readFile(store.file('test.first'),'utf8')).includes(fixtureKey));
  assert.throws(()=>store.file('../escape'));await store.write('test.first','');assert.equal(await store.read('test.first'),null);
  const unavailable=new DeepSeekCredentials({userData,encryption:{isEncryptionAvailable:()=>false}});
  await assert.rejects(()=>unavailable.write('test.second',fixtureKey),/加密不可用/);
});

test('SSE parser handles byte-split Chinese text, CRLF, keepalives and usage; rejects incomplete streams',async()=>{
  const bytes=new TextEncoder().encode(': keepalive\r\n\r\n'+frame('你好 <script>')+frame('世界')+ending);let at=0;
  const response=new Response(new ReadableStream({pull(controller){if(at===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(at,++at));}}));
  const seen=[],result=await consumeDeepSeekStream(response,{signal:new AbortController().signal,onText:text=>seen.push(text)});
  assert.equal(result.text,'你好 <script>世界');assert.equal(result.usage,12);assert.equal(seen.at(-1),result.text);
  await assert.rejects(()=>consumeDeepSeekStream(new Response(frame('partial')),{signal:new AbortController().signal,onText:()=>{}}),/STREAM/);
  await assert.rejects(()=>consumeDeepSeekStream(sse('too long'),{signal:new AbortController().signal,onText:()=>{},maxChars:2}),/OUTPUT_LIMIT/);
});

test('requests have fixed schema, bounded content and no arbitrary endpoint or tool access',()=>{
  assert.deepEqual(validateDeepSeekRequest(input('valid')),input('valid'));
  for(const change of [{url:'http://127.0.0.1'},{model:'unknown'},{messages:[{role:'tool',content:'x'}]},{messages:[{role:'user',content:'x',tool_calls:[]}]},{messages:[{role:'assistant',content:'x'}]}])assert.throws(()=>validateDeepSeekRequest({...input('bad'),...change}));
});

test('gateway sends only to DeepSeek, returns safe events, maps auth failure without echoing server data',async()=>{
  const calls=[],events=[],service=new DeepSeekService({credentials:{read:async()=>fixtureKey},fetchImpl:async(url,options)=>{calls.push({url,options});return sse('你好');}});
  service.subscribe('test.first',value=>events.push(value));service.start('test.first',input('one'));await settled(service,'test.first');
  assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');assert.equal(calls[0].options.redirect,'error');
  const body=JSON.parse(calls[0].options.body);assert.equal(body.thinking.type,'disabled');assert.equal(body.stream,true);assert.equal(body.tools,undefined);
  assert.equal(events.at(-1).type,'done');assert.equal(events.at(-1).text,'你好');assert.ok(!JSON.stringify(events).includes(fixtureKey));
  service.fetchImpl=async()=>new Response(fixtureKey,{status:401});service.start('test.first',input('two'));await settled(service,'test.first');
  assert.match(events.at(-1).message,/Key 无效/);assert.ok(!JSON.stringify(events).includes(fixtureKey));
});

test('cancel, timeout, per-plugin concurrency and capability revocation terminate requests',async()=>{
  const events=[],signals=[];
  const service=new DeepSeekService({credentials:{read:async()=>fixtureKey},timeoutMs:30,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{signals.push(signal);signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})});
  service.subscribe('test.first',value=>events.push(value));service.start('test.first',input('one'));
  assert.throws(()=>service.start('test.first',input('duplicate')),/正在生成/);await new Promise(resolve=>setTimeout(resolve,1));
  const cancelled=service.jobs.get('test.first').promise;service.cancel('test.first');await cancelled;assert.equal(events.at(-1).type,'cancelled');assert.ok(signals[0].aborted);
  service.start('test.first',input('timeout'));await settled(service,'test.first');assert.match(events.at(-1).message,/超时/);
  const broker=new CapabilityBroker({deepseek:service,windows:{stop(){}}}),cleanups=[];let live=true;
  const denied=broker.scope([],{live:()=>true,register:()=>{},pluginId:'test.denied'});assert.throws(()=>denied.deepseek.start(input('no')),/denied/);
  const allowed=broker.scope(['ai.deepseek'],{live:()=>live,register:fn=>cleanups.push(fn),pluginId:'test.first'});
  allowed.deepseek.start(input('revoke'));await new Promise(resolve=>setTimeout(resolve,1));const job=service.jobs.get('test.first');live=false;cleanups.forEach(fn=>fn());await job.promise;assert.ok(job.controller.signal.aborted);
});

test('plugin persists persona and history, omits partial replies from future context, retries and confirms clear',async()=>{
  const manifest=validateManifest(JSON.parse(await readFile(new URL('../examples/deepseek-plugin/plugin.json',import.meta.url),'utf8')));
  let persisted=null,callback,latest;const requests=[],reminders=[];
  const context={signal:new AbortController().signal,getConfig:()=>({model:'deepseek-flash',notify:true}),onCleanup:()=>{},
    storage:{get:async()=>persisted,set:async(_key,value)=>{persisted=structuredClone(value);}},
    publish:value=>{validateSnapshot(value);latest=value;},emit:async event=>reminders.push(event),
    deepseek:{subscribe:async cb=>{callback=cb;cb({type:'connection',configured:true,error:null});return ()=>{};},start:async params=>requests.push(params),cancel:async()=>{},configure:async()=>{}}
  };
  const plugin=await activate(context);assert.equal(manifest.permissions.includes('ai.deepseek'),true);validateSnapshot(plugin.getSnapshot());
  await plugin.execute('savePersona',{persona:'我是兔子',memory:'用户喜欢蓝色'});await plugin.execute('send',{text:'你好'});
  assert.match(requests[0].messages[0].content,/兔子/);assert.match(requests[0].messages[0].content,/蓝色/);
  await callback({requestId:requests[0].requestId,type:'delta',text:'部分输出'});validateSnapshot(plugin.getSnapshot());
  await callback({requestId:requests[0].requestId,type:'cancelled',text:'部分输出',message:'已停止'});
  assert.equal(persisted.history.at(-1).state,'partial');await plugin.execute('send',{text:'继续说'});
  assert.ok(!JSON.stringify(requests[1].messages).includes('部分输出'));
  await callback({requestId:requests[1].requestId,type:'done',text:'你好呀',finishReason:'stop',usage:12});assert.equal(reminders.length,1);
  await plugin.execute('retry');assert.equal(requests.at(-1).messages.at(-1).content,'继续说');
  await callback({requestId:requests.at(-1).requestId,type:'done',text:'新的回复',finishReason:'length',usage:14});
  assert.match(JSON.stringify(latest),/输出上限/);await plugin.execute('confirmClear');assert.ok(persisted.history.length);
  await plugin.execute('clear');await plugin.execute('confirmClear');assert.equal(persisted.history.length,0);assert.equal(persisted.memory,'用户喜欢蓝色');
  plugin.dispose();const restored=await activate(context);assert.match(JSON.stringify(restored.getSnapshot()),/我是兔子/);restored.dispose();
});
