import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { sanitizeGlobals as sanitizeSettings } from '../electron/plugins/settings-store.mjs';
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
  assert.equal(result.music,undefined); assert.equal(result.details,false); assert.equal(result.command,undefined);
  assert.equal(result.hoverDelay,150); assert.equal(result.blockedApps,undefined);
});
test('missing quota remains unknown; remaining quota is clamped',()=>{
  assert.equal(normalizeLimit(null),null); assert.equal(normalizeLimit({}),null);
  assert.equal(normalizeLimit({usedPercent:105}).remaining,0);
  assert.equal(normalizeLimit({usedPercent:23}).remaining,77);
});
test('missing bundled Codex binary falls back to CLI on PATH',async()=>{
  assert.equal(await resolveCodexExecutable(path.join(os.tmpdir(),'pet-missing-codex-directory')), 'codex.exe');
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
