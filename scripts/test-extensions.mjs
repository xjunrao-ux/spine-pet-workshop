import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExtensionService, sanitizeSettings } from '../electron/extensions/extension-service.mjs';
import { CodexService, normalizeLimit, resolveCodexExecutable } from '../electron/extensions/codex-service.mjs';
import { normalizeMediaState, notificationChannels } from '../electron/extensions/media-state.mjs';

test('pet voice sessions are filtered, external players and NetEase fallback remain',()=>{
  const result=normalizeMediaState({currentId:'local.spine.desktop.pet.workshop',sessions:[
    {id:'local.spine.desktop.pet.workshop'}, {id:'SpinePetWorkshop.exe'},
    {id:'QQMusic.exe',status:'Playing'},{id:'app-command:cloudmusic',fallback:true},{id:'MSEdge'}]});
  assert.equal(result.sessions.length,3);assert.equal(result.currentId,'QQMusic.exe');
  assert.equal(result.sessions[1].name,'网易云音乐');
});
test('QQ and WeCom channels report actual system notifications, not assumed chat access',()=>{
  const channels=notificationChannels({runningApps:['QQ','WXWork'],items:[{app:'QQ',appId:'QQ'}]});
  assert.equal(channels[0].observed,true);assert.equal(channels[1].running,true);assert.equal(channels[1].observed,false);
  assert.equal(notificationChannels({items:[{app:'企业微信',appId:'WXWork'}]})[1].observed,true);
});

test('settings whitelist strips unexpected fields and constrains hover delay',()=>{
  const result=sanitizeSettings({music:false,details:'yes',command:'whoami',hoverDelay:-3,blockedApps:['QQ','QQ',2]});
  assert.equal(result.music,false); assert.equal(result.details,false); assert.equal(result.command,undefined);
  assert.equal(result.hoverDelay,150); assert.deepEqual(result.blockedApps,['QQ']);
});
test('missing quota remains unknown; remaining quota is clamped',()=>{
  assert.equal(normalizeLimit(null),null); assert.equal(normalizeLimit({}),null);
  assert.equal(normalizeLimit({usedPercent:105}).remaining,0);
  assert.equal(normalizeLimit({usedPercent:23}).remaining,77);
});
test('missing bundled Codex binary falls back to CLI on PATH',async()=>{
  assert.equal(await resolveCodexExecutable(path.join(os.tmpdir(),'pet-missing-codex-directory')), 'codex.exe');
});
test('disabled / quiet / lock-screen states suppress subtitles',()=>{
  const events=[]; const service=new ExtensionService({directory:'.',userData:'.',onUpdate:()=>{},onEvent:e=>events.push(e)});
  service.active=true;
  service.emitEvent({module:'notifications'}); assert.equal(events.length,1);
  service.state.settings={...service.state.settings,quiet:true};service.emitEvent({module:'notifications'});
  service.state.settings={...service.state.settings,quiet:false,notifications:false};service.emitEvent({module:'notifications'});
  service.state.settings={...service.state.settings,notifications:true};service.state.locked=true;service.emitEvent({module:'notifications'});
  assert.equal(events.length,1);
});
test('dismiss only affects desktop pet; replacement notification remains visible',async()=>{
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-read-test-'));
  const service=new ExtensionService({directory:'.',userData,onUpdate:()=>{},onEvent:()=>{}});
  service.state.notifications.items=[{id:'1',appId:'QQ',createdAt:'a'}];
  await service.dismiss('1');assert.equal(service.snapshot().notifications.items.length,0);
  service.state.notifications.items[0].createdAt='b';assert.equal(service.snapshot().notifications.items.length,1);
});

test('only new GPT messages notify; display mode includes brief content; privacy omits it',async()=>{
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-notice-test-')),events=[];
  const service=new ExtensionService({directory:'.',userData,onUpdate:()=>{},onEvent:e=>events.push(e)});
  service.active=true;service.startedAt=Date.now();service.state.settings={...service.state.settings,details:true};
  const old={id:'old',app:'ChatGPT',appId:'gpt',createdAt:new Date(Date.now()-10000).toISOString(),title:'历史标题',body:'历史正文'};
  service.ingestNotifications({permission:'Allowed',items:[old]});assert.equal(events.length,0);assert.equal(service.snapshot().notifications.items.length,0);
  const fresh={...old,id:'new',createdAt:new Date().toISOString(),title:'任务完成',body:'这是新消息摘要'};
  service.ingestNotifications({permission:'Allowed',items:[old,fresh]});assert.equal(events.length,1);assert.match(events[0].text,/这是新消息摘要/);
  await service.dismiss('new');service.ingestNotifications({permission:'Allowed',items:[old,fresh]});assert.equal(events.length,1);
  const persisted=await readFile(path.join(userData,'notification-read.json'),'utf8');assert.ok(!persisted.includes('正文'));assert.ok(!persisted.includes('摘要'));
  const restarted=new ExtensionService({directory:'.',userData,onUpdate:()=>{},onEvent:()=>{}});
  restarted.syncBridge=()=>{};await restarted.start();assert.equal(restarted.dismissed.get('new'),fresh.createdAt);restarted.stop();
  service.state.settings={...service.state.settings,details:false};
  service.ingestNotifications({permission:'Allowed',items:[{...fresh,id:'private'}]});assert.equal(events.length,2);assert.ok(!events[1].text.includes('任务完成'));assert.equal(service.snapshot().notifications.items[0].body,'');
  service.stop();
});
test('panel dimensions are finite, bounded, and persist alongside switches',()=>{
  assert.equal(sanitizeSettings({cardWidth:Infinity}).cardWidth,282);
  assert.equal(sanitizeSettings({cardWidth:999,cardHeight:1}).cardWidth,560);
  assert.equal(sanitizeSettings({cardHeight:1}).cardHeight,230);
});
test('turn completion uses explicit terminal status and ignores startup history',()=>{
  const events=[];const service=new CodexService(()=>{},event=>events.push(event),()=>{});
  service.tasks.set('thread',{name:'task'});
  service.recordTurn('thread',{id:'old',status:'completed'},true);assert.equal(events.length,0);
  service.recordTurn('thread',{id:'new',status:'inProgress'},false);assert.equal(events.length,0);
  service.recordTurn('thread',{id:'new',status:'failed'},false);assert.match(events[0].text,/执行失败/);
  service.recordTurn('thread',{id:'new',status:'failed'},false);assert.equal(events.length,1);
});
test('new tasks completed between polls still notify, while startup history does not',async()=>{
  const events=[];const service=new CodexService(()=>{},event=>events.push(event),()=>{});
  service.running=true;service.watchStartedAt=Date.now();service.state={connected:true,tasks:[]};
  let thread={id:'old',name:'history',status:{type:'notLoaded'},updatedAt:(service.watchStartedAt-10000)/1000};
  service.request=async method=>method==='thread/list'?{data:[thread]}:method==='thread/turns/list'?{data:[{id:'turn',status:'completed'}]}:{};
  await service.refresh();assert.equal(events.length,0);
  thread={...thread,id:'new',name:'new task',updatedAt:(service.watchStartedAt+1000)/1000};
  await service.refresh();assert.equal(events.length,1);assert.match(events[0].text,/已完成/);
  await service.refresh();assert.equal(events.length,1);
});
test('all modules disabled stops processes and persists without replacing character preferences',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'pet-v311-test-'));
  const service=new ExtensionService({directory,userData:directory,onUpdate:()=>{},onEvent:()=>{}});
  await service.setSettings({music:false,notifications:false,codex:false});
  assert.equal(service.child,null);assert.equal(service.codex.running,false);
  const saved=JSON.parse(await readFile(path.join(directory,'feature-settings.json'),'utf8'));
  assert.equal(saved.music,false);
});
