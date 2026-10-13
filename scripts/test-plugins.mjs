import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ExtensionService } from '../electron/extensions/extension-service.mjs';
import { readKey } from '../electron/plugins/contracts.mjs';
import { sanitizeGlobals } from '../electron/plugins/settings-store.mjs';
import { createTestOptions,mediaFixture,testPlugin } from './plugin-fixture.mjs';
import { WindowsAdapter } from '../electron/plugins/windows-adapter.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const notice=(extra={})=>({id:'new',app:'QQ',appId:'QQ',createdAt:new Date(Date.now()+100).toISOString(),title:'测试标题',body:'测试正文不应持久化',...extra});
const plugin=(host,id)=>host.snapshot().plugins.find(p=>p.id===id);
async function fixture(t,{definitions,legacy,reads,fourth=false}={}) {
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-plugins-')),options=createTestOptions({fourth,legacyCodex:true}),events=[];
  if(legacy) await writeFile(path.join(userData,'feature-settings.json'),JSON.stringify(legacy));
  if(reads) await writeFile(path.join(userData,'notification-read.json'),JSON.stringify(reads));
  const host=new ExtensionService({directory:'.',userData,...options,...(definitions?{definitions}:{}),onEvent:event=>events.push(event),onUpdate:()=>{}});
  t.after(()=>host.stop());await host.start();return {host,windows:options.broker.windows,broker:options.broker,events,userData};
}
test('historical three-provider fixture uses one lifecycle and three shared leases',async t=>{
  const {host,windows}=await fixture(t);assert.equal(host.snapshot().plugins.length,3);assert.equal(windows.leases.size,3);
  assert.deepEqual(host.snapshot().plugins.map(p=>p.runtime),['active','active','active']);
  await host.setSettings({plugins:{'workshop.notifications':{enabled:false}}});assert.equal(windows.leases.size,2);assert.equal(windows.configuration().music,true);assert.equal(windows.configuration().codex,true);
  await host.setSettings({plugins:{'workshop.music':{enabled:false},'workshop.codex':{enabled:false}}});assert.equal(windows.leases.size,0);assert.equal(windows.child,null);
});
test('music filters pet audio, publishes per-player pages and controlled album assets',async t=>{
  const {host,windows}=await fixture(t);windows.ingest({media:mediaFixture('data:image/png;base64,aGVsbG8=')});
  const music=plugin(host,'workshop.music');assert.equal(music.pages.length,2);assert.equal(music.pages[0].title,'QQ 音乐');
  assert.equal(Object.keys(music.assets).length,1);assert.equal(music.pages[0].blocks[2].positionMs,84000);assert.equal(music.pages[1].blocks[2].durationMs,null);
  windows.ingest({media:mediaFixture('https://untrusted.example/cover.svg')});assert.equal(Object.keys(plugin(host,'workshop.music').assets).length,0);
});
test('commands validate IDs, schema, permissions, current session and capability',async t=>{
  const {host,windows}=await fixture(t);windows.ingest({media:mediaFixture()});
  for(const action of ['play','pause','toggle','next','previous']) assert.equal((await host.execute('workshop.music',action,{sessionId:'QQMusic.exe'})).ok,true);
  assert.equal(windows.calls.length,5);
  assert.equal((await host.execute('workshop.music','shell',{})).error.code,'UNKNOWN_COMMAND');
  assert.equal((await host.execute('workshop.music','play',{sessionId:'QQMusic.exe',shell:'bad'})).error.code,'INVALID_PARAMS');
  assert.equal((await host.execute('workshop.music','play',{sessionId:'closed'})).ok,false);
  windows.cache.media.sessions[0].capabilities.play=false;assert.equal((await host.execute('workshop.music','play',{sessionId:'QQMusic.exe'})).ok,false);
  assert.equal((await host.execute('workshop.notifications','requestPermission',{})).error.code,'FORBIDDEN');
  assert.equal((await host.execute('workshop.notifications','requestPermission',{},{source:'manager'})).data,'Allowed');
});
test('notification display summaries, historical GPT suppression and persistent read keys',async t=>{
  const {host,windows,events,userData}=await fixture(t);await host.setSettings({global:{details:true}});
  const old=notice({id:'old',app:'ChatGPT',appId:'gpt',createdAt:new Date(Date.now()-10000).toISOString()});
  windows.ingest({notifications:{permission:'Allowed',items:[old]}});assert.equal(events.length,0);assert.equal(plugin(host,'workshop.notifications').pages[0].id,'empty');
  const fresh=notice();windows.ingest({notifications:{permission:'Allowed',items:[old,fresh]}});assert.equal(events.length,1);assert.match(events[0].text,/测试正文/);
  const page=plugin(host,'workshop.notifications').pages[0];await host.acknowledge('workshop.notifications',[{pageId:page.id,readKey:page.readKey}]);
  assert.equal(plugin(host,'workshop.notifications').pages[0].id,'empty');assert.equal(plugin(host,'workshop.notifications').enabled,true);
  windows.ingest({notifications:{permission:'Allowed',items:[old,fresh]}});assert.equal(events.length,1);
  await host.store.writes;const raw=await readFile(path.join(userData,'plugin-read-state.json'),'utf8');assert.ok(!raw.includes('正文'));assert.ok(!raw.includes('标题'));
  const options=createTestOptions({legacyCodex:true}),restarted=new ExtensionService({directory:'.',userData,...options,onUpdate:()=>{},onEvent:()=>{}});t.after(()=>restarted.stop());await restarted.start();
  assert.equal(restarted.store.isRead('workshop.notifications',readKey(fresh.id,fresh.createdAt)),true);
  const replacement=notice({id:fresh.id,createdAt:new Date(Date.now()+200).toISOString()});windows.ingest({notifications:{permission:'Allowed',items:[replacement]}});assert.equal(plugin(host,'workshop.notifications').pages[0].id,fresh.id);assert.equal(events.length,2);
});
test('privacy redacts at adapter boundary, on mode change and in persisted records',async t=>{
  const {host,windows,events}=await fixture(t);const first=notice();windows.ingest({notifications:{permission:'Allowed',items:[first]}});
  assert.equal(windows.cache.notifications.items[0].body,'');assert.ok(!JSON.stringify(host.snapshot()).includes('测试正文'));assert.ok(!events[0].text.includes('测试标题'));
  await host.setSettings({global:{details:true}});windows.ingest({notifications:{permission:'Allowed',items:[{...first,id:'second'}]}});assert.ok(JSON.stringify(host.snapshot()).includes('测试正文'));
  await host.setSettings({global:{details:false}});assert.ok(!JSON.stringify(host.snapshot()).includes('测试正文'));assert.equal(windows.cache.notifications.items[0].body,'');
});
test('disabled, quiet and locked plugins suppress reminders and source blocking filters pages',async t=>{
  const {host,windows,events}=await fixture(t);
  await host.setSettings({global:{quiet:true}});windows.ingest({notifications:{permission:'Allowed',items:[notice()]}});assert.equal(events.length,0);
  await host.setSettings({global:{quiet:false}});windows.ingest({locked:true,notifications:{permission:'Allowed',items:[notice({id:'locked'})]}});assert.equal(events.length,0);
  await host.setSettings({plugins:{'workshop.notifications':{config:{blockedApps:['QQ']}}}});assert.equal(plugin(host,'workshop.notifications').pages[0].id,'empty');
  await host.setSettings({plugins:{'workshop.notifications':{enabled:false}}});windows.ingest({notifications:{permission:'Allowed',items:[notice({id:'disabled'})]}});assert.equal(plugin(host,'workshop.notifications').pages.length,0);
});
test('Codex produces common metric/list pages, unknown quotas and deduplicated task events',async t=>{
  const {host,windows,broker,events}=await fixture(t);windows.ingest({codexRunning:true});
  assert.equal(plugin(host,'workshop.codex').available,true);assert.equal(plugin(host,'workshop.codex').pages[0].blocks[0].value,null);
  broker.codex.push({running:true,connected:true,primary:{remaining:77,minutes:300,resetsAt:null},tasks:[{id:'t',name:'任务',status:'idle',turnStatus:'completed'}]});
  assert.equal(plugin(host,'workshop.codex').pages[0].blocks[0].value,77);assert.equal(plugin(host,'workshop.codex').pages[1].blocks[0].items[0].status,'已完成');assert.equal(events.length,0);
  const event={id:'codex:t:turn:completed',text:'Codex 任务完成',createdAt:new Date().toISOString()};broker.codex.emit(event);broker.codex.emit(event);assert.equal(events.length,1);
  const page=plugin(host,'workshop.codex').pages[1];await host.acknowledge('workshop.codex',[{pageId:page.id,readKey:page.readKey}]);assert.equal(plugin(host,'workshop.codex').unread,0);assert.equal(plugin(host,'workshop.codex').pages.length,2);
});
test('legacy settings/read records migrate without losing switches, dimensions or blocked origins',async t=>{
  const legacy={music:false,notifications:true,codex:false,details:true,cardWidth:360,cardHeight:340,blockedApps:['QQ']};
  const {host,userData}=await fixture(t,{legacy,reads:[['read-id','date']]});
  assert.equal(plugin(host,'workshop.music').enabled,false);assert.equal(host.settings.cardWidth,360);assert.deepEqual(plugin(host,'workshop.notifications').config.blockedApps,['QQ']);
  assert.equal(host.store.isRead('workshop.notifications',readKey('read-id','date')),true);
  assert.deepEqual(JSON.parse(await readFile(path.join(userData,'feature-settings.json.v1.bak'),'utf8')),legacy);
  await host.setSettings({plugins:{'workshop.music':{enabled:true}}});const saved=JSON.parse(await readFile(path.join(userData,'feature-settings.json'),'utf8'));assert.equal(saved.schemaVersion,2);assert.equal(saved.plugins['workshop.music'].enabled,true);
});
test('unsupported schema fails closed and never overwrites existing settings',async t=>{
  const legacy={schemaVersion:99,secret:'preserved'};const {host,userData}=await fixture(t,{legacy});assert.ok(host.settingsError);assert.equal(host.snapshot().plugins.every(p=>!p.enabled),true);
  await assert.rejects(host.setSettings({global:{quiet:true}}));assert.deepEqual(JSON.parse(await readFile(path.join(userData,'feature-settings.json'),'utf8')),legacy);
});
test('fourth plugin registers through the same contract and settings, without a menu branch',async t=>{
  const {host}=await fixture(t,{fourth:true});assert.equal(host.snapshot().plugins.length,4);assert.equal(plugin(host,'workshop.test').pages[0].title,'第四插件');
  assert.equal((await host.execute('workshop.test','echo',{value:'成功'})).data,'成功');assert.equal(plugin(host,'workshop.test').pages[0].blocks[0].text,'成功');
  await host.setSettings({plugins:{'workshop.test':{config:{enabledText:false}}}});assert.equal(plugin(host,'workshop.test').pages[0].blocks[0].text,'文字已关闭');
});
test('late publishes, events and capabilities are revoked when a plugin is disabled',async t=>{
  let context;const def={...testPlugin,manifest:{...testPlugin.manifest,permissions:['media.read','ui.reminders']},activate(ctx){context=ctx;return testPlugin.activate(ctx);}};
  const {host,events}=await fixture(t,{definitions:[def]});await host.setSettings({plugins:{'workshop.test':{enabled:false}}});
  context.publish({available:true,status:'ready',pages:[]});context.emit({id:'late',dedupeKey:'late',createdAt:new Date().toISOString(),summary:{private:'late'}});
  assert.equal(plugin(host,'workshop.test').available,false);assert.equal(events.length,0);assert.throws(()=>context.capabilities.media.subscribe(()=>{}));assert.equal((await host.execute('workshop.test','echo',{value:'late'})).error.code,'DISABLED');
});
test('one invalid plugin fails locally; others remain active and can restart',async t=>{
  const bad={...testPlugin,activate(){throw new Error('unsafe raw diagnostic');}};const {host,windows}=await fixture(t,{definitions:[...createTestOptions({legacyCodex:true}).definitions,bad]});
  assert.equal(plugin(host,'workshop.test').runtime,'failed');assert.equal(plugin(host,'workshop.music').runtime,'active');assert.equal(windows.leases.size,3);
  assert.ok(!JSON.stringify(host.snapshot()).includes('unsafe raw diagnostic'));const old=plugin(host,'workshop.music').epoch;assert.equal((await host.restart('workshop.music')).ok,true);assert.ok(plugin(host,'workshop.music').epoch>old);assert.equal(windows.leases.size,3);
});
test('invalid declarative data is rejected without replacing other plugin pages',async t=>{
  let context;const def={...testPlugin,activate(ctx){context=ctx;return testPlugin.activate(ctx);}};const {host}=await fixture(t,{definitions:[def]});
  context.publish({available:true,status:'ready',pages:[{id:'bad',title:'bad',icon:'clock',blocks:[{type:'html',html:'<script>bad()</script>'}]}]});assert.equal(plugin(host,'workshop.test').status,'error');
});
test('concurrent commands are bounded and disable cancels in-flight operations',async t=>{
  let resolve;const def={...testPlugin,activate(ctx){return {...testPlugin.activate(ctx),execute:()=>new Promise(r=>{resolve=r;})};}};
  const {host}=await fixture(t,{definitions:[def]});const pending=host.execute('workshop.test','echo',{value:'a'});await Promise.resolve();
  assert.equal((await host.execute('workshop.test','echo',{value:'b'})).error.code,'BUSY');await host.setSettings({plugins:{'workshop.test':{enabled:false}}});assert.equal((await pending).error.code,'CANCELLED');resolve('late');
});
test('global dimensions and delay reject non-finite values and enforce bounds',()=>{
  assert.equal(sanitizeGlobals({cardWidth:Infinity}).cardWidth,282);assert.equal(sanitizeGlobals({cardWidth:999}).cardWidth,560);assert.equal(sanitizeGlobals({cardHeight:1}).cardHeight,230);assert.equal(sanitizeGlobals({hoverDelay:-3}).hoverDelay,150);
});
test('the real adapter orchestration shares one child, aborts requests and drops stale children',async()=>{
  const children=[],spawnProcess=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;child.emit('exit',0);};children.push(child);return child;};
  const adapter=new WindowsAdapter({directory:'.',platform:'win32',spawnProcess}),media=[],notices=[];
  const releaseMedia=adapter.acquire('media',value=>media.push(value));const releaseNotices=adapter.acquire('notifications',value=>notices.push(value));assert.equal(children.length,1);
  children[0].stdout.write(JSON.stringify({type:'snapshot',media:mediaFixture(),notifications:{permission:'Allowed',items:[notice()]}})+'\n');assert.equal(media[0].sessions.length,2);assert.equal(notices[0].items[0].body,'');
  const controller=new AbortController(),request=adapter.request('media',{action:'play'},controller.signal);controller.abort();await assert.rejects(request);assert.equal(adapter.pending.size,0);
  releaseMedia();assert.ok(!children[0].killed);assert.equal(adapter.configuration().notifications,true);releaseNotices();assert.equal(children[0].killed,true);
  const releaseAgain=adapter.acquire('media',value=>media.push(value));assert.equal(children.length,2);const count=media.length;children[0].stdout.write(JSON.stringify({type:'snapshot',media:mediaFixture()})+'\n');assert.equal(media.length,count);releaseAgain();adapter.stop();
});
test('unknown installed configuration survives edits to known plugins',async t=>{
  const {host,userData}=await fixture(t);await host.setSettings({global:{quiet:true}});
  const saved=JSON.parse(await readFile(path.join(userData,'feature-settings.json'),'utf8'));saved.plugins['future.notes']={enabled:false,configVersion:4,config:{future:'preserve'}};saved.plugins['workshop.music'].config.futureField='keep';await writeFile(path.join(userData,'feature-settings.json'),JSON.stringify(saved));
  const options=createTestOptions({legacyCodex:true}),next=new ExtensionService({directory:'.',userData,...options,onUpdate:()=>{},onEvent:()=>{}});t.after(()=>next.stop());await next.start();await next.setSettings({plugins:{'workshop.music':{enabled:false}}});
  assert.equal(next.store.data.plugins['future.notes'].config.future,'preserve');assert.equal(next.store.data.plugins['workshop.music'].config.futureField,'keep');
});
test('incompatible plugin API is visible as incompatible but cannot execute',async t=>{
  const def={...testPlugin,manifest:{...testPlugin.manifest,apiVersion:2}};const {host}=await fixture(t,{definitions:[def]});assert.equal(plugin(host,'workshop.test').runtime,'incompatible');assert.equal((await host.execute('workshop.test','echo',{value:'no'})).ok,false);
});
test('future plugin configuration cannot be overwritten by the old settings schema',async t=>{
  const saved={schemaVersion:2,global:{},plugins:{'workshop.music':{enabled:true,configVersion:99,config:{future:'keep'}}}};
  const {host}=await fixture(t,{legacy:saved});assert.equal(plugin(host,'workshop.music').runtime,'incompatible');await assert.rejects(host.setSettings({plugins:{'workshop.music':{config:{}}}}));assert.equal(host.store.data.plugins['workshop.music'].config.future,'keep');
});
test('subscriber exceptions produce local diagnostics and do not interrupt other subscribers',async t=>{
  const def={...testPlugin,manifest:{...testPlugin.manifest,permissions:['media.read']},activate(context){context.capabilities.media.subscribe(()=>{throw new Error('private raw error');});return testPlugin.activate(context);}};
  const {host,windows}=await fixture(t,{definitions:[...createTestOptions({legacyCodex:true}).definitions,def]});windows.ingest({media:mediaFixture()});
  assert.equal(plugin(host,'workshop.test').status,'error');assert.equal(plugin(host,'workshop.music').pages.length,2);assert.ok(!JSON.stringify(host.snapshot()).includes('private raw error'));
});
