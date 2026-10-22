import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activate,validateInfo,validateSessions,validateSnapshot as validateWireSnapshot,validateEvent} from '../examples/dsh-pet-plugin/provider.js';
import {validateManifest,validateSnapshot,validatePayload} from '../electron/plugins/contracts.mjs';
import {LocalService} from '../electron/plugins/local-service.mjs';
import {startBridge} from '../dsh-pet-bridge/test/helpers/bridge-host.js';

export const manifest=validateManifest(JSON.parse(await readFile(new URL('../examples/dsh-pet-plugin/plugin.json',import.meta.url),'utf8')));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function until(fn,label,timeout=5000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await delay(10);}throw new Error('Timeout '+label);}
const baseInfo={protocols:['pet-dsh/1'],instanceId:'bridge-A',serverVersion:'1.0.0',dshVersion:'0.1.1-rc.2',
  capabilities:['sessions.list','session.snapshot','message.send','events.follow','requests.lookup','session.cancel','message.steer'],
  limits:{requestBytes:65536,responseBytes:262144,eventBytes:65536,messageChars:4000}};
const snapshot=(sessionId='session-A')=>({instanceId:'bridge-A',sessionId,cursor:'opaque.cursor',messages:[],activity:null,pendingInteractions:[],pendingPetCalls:[],truncated:false});
const sessions={instanceId:'bridge-A',items:[{sessionId:'session-A',title:null,workspace:null,available:true,status:'idle'},{sessionId:'session-B',title:'另一个项目',workspace:'project-b',available:true,status:'idle'}],nextCursor:null};
const blocks=plugin=>plugin.getSnapshot().pages.flatMap(page=>[...page.blocks,...page.footer??[]]);
function buttons(block){return block.type==='button'?[block]:[...(block.children??[]).flatMap(buttons),...(block.stopAction?[block.stopAction]:[])];}
export const binding=plugin=>blocks(plugin).find(b=>b.type==='form'&&b.commandId==='send')?.payload;
function uiCheck(value){
  validateSnapshot(value);
  function walk(b){
    if(b.type==='button'){const c=manifest.commands.find(c=>c.id===b.commandId);assert.ok(c);validatePayload(c,b.payload??{});}
    if(b.type==='form'){const c=manifest.commands.find(c=>c.id===b.commandId);assert.ok(c);const p={...b.payload};for(const f of b.fields)p[f.key]=f.value||(f.required?'示例消息':'');validatePayload(c,p);}
    for(const child of b.children??[])walk(child);if(b.stopAction)walk(b.stopAction);
  }
  for(const page of value.pages)for(const b of [...page.blocks,...page.footer??[]])walk(b);
}
export async function mockClient(options={}){
  let callback,stored=options.saved??null;
  const h={requests:[],streams:[],cancels:[],reminders:[],config:{autoConnect:false,enableSteer:false,cacheHistory:true,notify:false,...options.config},
    info:structuredClone(baseInfo),sessions:structuredClone(sessions),snapshot:snapshot(),failStorage:false,manualPost:false,lookups:new Map(),configured:options.configured??true};
  h.emit=e=>callback?.(e);
  const local={
    subscribe:async cb=>{callback=cb;return ()=>{callback=null;};},
    status:async()=>({configured:h.configured,endpoint:h.configured?'http://127.0.0.1:39217/pet-bridge/v1/':null,error:null}),
    configure:async()=>({opened:true}),
    request:async p=>{
      h.requests.push(structuredClone(p));
      if(p.method==='POST'&&h.manualPost)return {accepted:true,requestId:p.requestId};
      let status=200,data;
      if(p.path==='/info')data=h.info;
      if(p.path==='/sessions')data=h.sessions;
      if(p.path==='/snapshot')data={...h.snapshot,sessionId:p.query.sessionId};
      if(p.path==='/commands')data={protocol:'pet-dsh/1',instanceId:h.info.instanceId,requestId:p.body.requestId,ok:true,data:p.body.op==='session.cancel'?{status:'cancelling',activityId:p.body.data.activityId}:{status:'accepted',messageId:'user.accepted'}};
      if(p.path==='/requests'){data=h.lookups.get(p.query.requestId);if(!data){status=404;data={protocol:'pet-dsh/1',ok:false,error:{code:'REQUEST_UNKNOWN',message:'没有记录',retryable:false}};}}
      queueMicrotask(()=>h.emit({type:'response',requestId:p.requestId,status,ok:status<400,data:structuredClone(data)}));
      return {accepted:true,requestId:p.requestId};
    },
    stream:async p=>{h.streams.push(structuredClone(p));queueMicrotask(()=>h.emit({type:'stream.open',streamId:p.streamId}));return {accepted:true,streamId:p.streamId};},
    cancel:async p=>{h.cancels.push(p);if(p.streamId)queueMicrotask(()=>h.emit({type:'stream.error',streamId:p.streamId,code:'CANCELLED'}));return {cancelled:true};}
  };
  const controller=new AbortController();
  h.context={signal:controller.signal,getConfig:()=>h.config,getPermissions:()=>manifest.permissions,onCleanup:()=>{},
    storage:{get:async()=>structuredClone(stored),set:async(_key,value)=>{if(h.failStorage)throw new Error('fixture disk failure');stored=structuredClone(value);}},
    localService:local,publish:value=>{uiCheck(value);h.latest=value;},emit:async event=>h.reminders.push(event)};
  h.plugin=await activate(h.context);h.stored=()=>structuredClone(stored);h.close=()=>h.plugin.dispose();
  h.wire=(type,data,extra={})=>{const stream=h.streams.at(-1);h.emit({type:'stream.event',streamId:stream.streamId,event:'bridge',lastEventId:extra.cursor??'event.'+(++h.seq),
    data:JSON.stringify({protocol:'pet-dsh/1',instanceId:h.info.instanceId,sessionId:binding(h.plugin)?.sessionId??'session-A',cursor:extra.cursor??'event.'+h.seq,type,data,...extra})});};
  h.seq=0;
  h.connect=async()=>{await h.plugin.execute('connect');await until(()=>h.plugin.getSnapshot().message==='请选择授权会话','session selection');};
  h.choose=async(sessionId='session-A')=>{
    const b=blocks(h.plugin).flatMap(buttons).find(b=>b.commandId==='selectSession'&&b.payload.sessionId===sessionId);
    assert.ok(b,'select button');await h.plugin.execute('selectSession',b.payload);await h.plugin.execute('confirmSession',b.payload);
    await until(()=>h.plugin.getSnapshot().message==='实时连接就绪','ready');
  };
  return h;
}
test('wire DTO validates nullable titles, opaque cursors and rejects malformed identities',()=>{
  validateInfo(baseInfo);validateSessions(sessions,'bridge-A');validateWireSnapshot(snapshot(),'bridge-A','session-A');
  assert.throws(()=>validateInfo({...baseInfo,capabilities:[]}));
  assert.throws(()=>validateEvent({protocol:'pet-dsh/1',instanceId:'bridge-A',sessionId:'session-A',cursor:'cursor',type:'assistant.delta',data:{activityId:'a',attemptId:'b',index:-1,text:'x'}},'cursor'));
  assert.throws(()=>validateEvent({protocol:'pet-dsh/1',instanceId:'bridge-A',sessionId:'session-A',cursor:'cursor',type:'activity.state',data:{activityId:'a',status:'running'}},'other'));
});
test('unconfigured activation and configure window do not imply connected or start requests',async t=>{
  const h=await mockClient({configured:false});t.after(h.close);uiCheck(h.plugin.getSnapshot());assert.equal(h.requests.length,0);
  await h.plugin.execute('configure');assert.match(JSON.stringify(h.plugin.getSnapshot()),/窗口已打开/);assert.equal(h.requests.length,0);
});
test('handshake requires explicit session selection then snapshot and cursor stream',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();assert.equal(h.streams.length,0);await h.choose();
  assert.equal(h.streams[0].lastEventId,h.snapshot.cursor);assert.equal(binding(h.plugin).sessionId,'session-A');uiCheck(h.plugin.getSnapshot());
});
test('missing required capability disables connection without writes',async t=>{
  const h=await mockClient();t.after(h.close);h.info.capabilities=[];await h.plugin.execute('connect');
  await until(()=>h.plugin.getSnapshot().status==='error','incompatible');assert.equal(h.streams.length,0);assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
});
test('claimed and ended before HTTP acceptance remain terminal; message replaces preview',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();h.manualPost=true;
  const p=binding(h.plugin);const result=await h.plugin.execute('send',{...p,text:'  检查代码缩进\n    return 1;'});
  assert.equal(result.resetForm,true);const request=h.requests.find(x=>x.method==='POST');assert.ok(request.body.requestId!==request.requestId);
  assert.equal(h.stored().outbox[0].text,request.body.data.text);
  h.wire('message.claimed',{requestId:request.body.requestId,messageId:'user.1',activityId:'act.A',turn:2});
  h.wire('assistant.delta',{activityId:'act.A',attemptId:'attempt.A',index:0,text:'部分'});
  h.wire('assistant.delta',{activityId:'act.A',attemptId:'attempt.A',index:1,text:'输出'});
  h.wire('assistant.message',{messageId:'assistant.1',attemptId:'attempt.A',turn:2,text:'完整权威内容'});
  h.wire('activity.ended',{activityId:'act.A',outcome:'completed'});
  h.emit({type:'response',requestId:request.requestId,status:202,ok:true,data:{protocol:'pet-dsh/1',instanceId:'bridge-A',requestId:request.body.requestId,ok:true,data:{status:'accepted',messageId:'user.1'}}});
  await until(()=>h.stored().outbox[0].status==='ended','ended journal');
  const chat=blocks(h.plugin).find(b=>b.type==='chat');assert.equal(chat.messages.filter(m=>m.id==='assistant.1').length,1);assert.ok(!chat.messages.some(m=>m.state==='streaming'));
  assert.equal(h.stored().outbox[0].outcome,'completed');
});
test('send timeout never retries POST, lookup can prove outcome',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();h.manualPost=true;
  await h.plugin.execute('send',{...binding(h.plugin),text:'分析项目'});const request=h.requests.find(x=>x.method==='POST');
  h.emit({type:'request.error',requestId:request.requestId,code:'TIMEOUT'});
  await until(()=>h.stored().outbox[0].status==='unknown','unknown');
  await h.plugin.execute('send',{...binding(h.plugin),text:'不要重复'});assert.equal(h.requests.filter(x=>x.method==='POST').length,1);
  h.lookups.set(request.body.requestId,{protocol:'pet-dsh/1',instanceId:'bridge-A',requestId:request.body.requestId,ok:true,data:{status:'ended',op:'message.send',sessionId:'session-A',activityId:'act.A',outcome:'completed',acceptedInstanceId:'previous-instance'}});
  await h.plugin.execute('lookupRequest',{wireRequestId:request.body.requestId});await until(()=>h.stored().outbox[0].status==='ended','lookup ended');
  assert.equal(h.requests.filter(x=>x.method==='POST').length,1);
});
test('storage failure before submission sends nothing and retains entered text',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();h.failStorage=true;
  const result=await h.plugin.execute('send',{...binding(h.plugin),text:'不得发出'});
  assert.notEqual(result.resetForm,true);assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
  assert.equal(h.plugin.getSnapshot().status,'error');
});
test('session switching drains old SSE and rejects stale button and old event',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();const old=binding(h.plugin),oldStream=h.streams[0];
  await h.choose('session-B');assert.ok(h.cancels.some(x=>x.streamId===oldStream.streamId));
  await h.plugin.execute('send',{...old,text:'错误会话'});assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
  h.emit({type:'stream.event',streamId:oldStream.streamId,event:'bridge',lastEventId:'old',data:JSON.stringify({protocol:'pet-dsh/1',instanceId:'bridge-A',sessionId:'session-A',cursor:'old',type:'activity.ended',data:{activityId:'old',outcome:'completed'}})});
  assert.equal(binding(h.plugin).sessionId,'session-B');assert.ok(!JSON.stringify(h.plugin.getSnapshot()).includes('活动 old'));
});
test('approval remains in DSH; cancellation confirmation never retargets changed activity',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();
  h.wire('activity.state',{activityId:'act.A',status:'waiting-approval'});
  assert.match(JSON.stringify(h.plugin.getSnapshot()),/DSH 界面处理审批/);
  assert.ok(!blocks(h.plugin).flatMap(buttons).some(b=>/approval|interaction/i.test(b.commandId)));
  const cancel={...binding(h.plugin),activityId:'act.A'};
  await h.plugin.execute('requestCancel',cancel);
  h.wire('activity.state',{activityId:'act.B',status:'running'});
  await h.plugin.execute('confirmCancel',cancel);assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
  const current={...binding(h.plugin),activityId:'act.B'};await h.plugin.execute('requestCancel',current);await h.plugin.execute('confirmCancel',current);
  await until(()=>h.requests.some(x=>x.body?.op==='session.cancel'),'remote cancel');
  assert.equal(h.requests.find(x=>x.body?.op==='session.cancel').body.data.activityId,'act.B');
});
test('delta duplicate cursor is ignored and valid cursor gaps are not treated as index gaps',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();
  h.wire('assistant.delta',{activityId:'act.A',attemptId:'attempt.A',index:0,text:'甲'},{cursor:'cursor.100'});
  h.wire('assistant.delta',{activityId:'act.A',attemptId:'attempt.A',index:0,text:'甲'},{cursor:'cursor.100'});
  h.wire('assistant.delta',{activityId:'act.A',attemptId:'attempt.A',index:1,text:'乙'},{cursor:'cursor.999'});
  assert.equal(blocks(h.plugin).find(x=>x.type==='chat').messages.at(-1).content,'甲乙');assert.equal(h.streams.length,1);
});
test('auth failures stop auto reconnect; unknown errors do not crash snapshots',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();
  h.emit({type:'stream.error',streamId:h.streams.at(-1).streamId,code:'HTTP_401'});
  assert.match(h.plugin.getSnapshot().message,/重新授权/);const count=h.requests.length;await delay(1200);assert.equal(h.requests.length,count);
});
test('manual persona never adds remote message and corrupt state is not overwritten',async t=>{
  const h=await mockClient();t.after(h.close);await h.plugin.execute('savePersona',{persona:'角色资料',memory:'中文交流'});
  assert.equal(h.stored().persona.memory,'中文交流');assert.equal(h.requests.length,0);assert.match(JSON.stringify(h.plugin.getSnapshot()),/未发送给 DSH/);
  const broken=await mockClient({saved:{schemaVersion:999,original:'keep'}});t.after(broken.close);
  await broken.plugin.execute('savePersona',{persona:'overwrite',memory:''});assert.equal(broken.stored().original,'keep');assert.equal(broken.plugin.getSnapshot().status,'error');
});
test('configuration changes isolate old pending records and dispose cancels only network',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();h.manualPost=true;
  await h.plugin.execute('send',{...binding(h.plugin),text:'执行中任务'});
  h.emit({type:'configuration.changed',configured:true,endpoint:'http://127.0.0.1:39217/pet-bridge/v1/',error:null});
  await until(()=>h.stored().outbox[0].quarantined,'quarantine');
  h.close();await delay(20);assert.equal(h.requests.filter(x=>x.body?.op==='session.cancel').length,0);
});
test('real bridge HTTP/SSE via generic host transport: send, snapshot, receipts, cancel and cleanup',async t=>{
  const bridge=await startBridge({harnessOptions:{deltaChunks:80,reply:'真实桥接 HTTP/SSE 模拟 Harness 回复。'.repeat(6)}});t.after(()=>bridge.stop());
  const token=bridge.token,owner=manifest.id,calls=[],events=[];
  const service=new LocalService({connections:{read:async()=>({endpoint:bridge.url,token})}});
  const cleanups=[],controller=new AbortController();let saved=null,latest;
  const scoped={
    subscribe:async cb=>service.subscribe(owner,e=>{events.push(e);cb(e);}),
    status:()=>service.status(owner),configure:async()=>({opened:true}),
    request:async p=>{calls.push(structuredClone(p));return service.request(owner,p,{signal:controller.signal});},
    stream:async p=>service.stream(owner,p,{signal:controller.signal}),cancel:async p=>service.cancel(owner,p)
  };
  const plugin=await activate({signal:controller.signal,getConfig:()=>({cacheHistory:true,notify:false,enableSteer:false}),onCleanup:fn=>cleanups.push(fn),
    localService:scoped,storage:{get:async()=>saved,set:async(_key,v)=>{saved=structuredClone(v);}},
    publish:v=>{uiCheck(v);latest=v;},emit:async()=>{}});
  t.after(()=>{plugin.dispose();controller.abort();service.stop();});
  await plugin.execute('connect');await until(()=>plugin.getSnapshot().message==='请选择授权会话','real sessions');
  const select=blocks(plugin).flatMap(buttons).find(b=>b.commandId==='selectSession');
  await plugin.execute('selectSession',select.payload);await plugin.execute('confirmSession',select.payload);
  await until(()=>plugin.getSnapshot().message==='实时连接就绪','real stream');
  await plugin.execute('send',{...binding(plugin),text:'测试真实桥接客户端'});
  await until(()=>saved?.outbox.some(r=>r.status==='ended'&&r.outcome==='completed'),'real completion',8000);
  await until(()=>JSON.stringify(plugin.getSnapshot()).includes('真实桥接 HTTP/SSE'),'real history');
  assert.equal(calls.filter(x=>x.method==='POST').length,1);
  assert.ok(events.some(e=>e.type==='stream.event'));assert.ok(calls.some(c=>c.path==='/requests'));
  // Long synthetic output leaves a deterministic cancellation window.
  await until(()=>bridge.agent.status==='idle','actual agent idle');
  await delay(350);
  await until(()=>plugin.getSnapshot().message==='实时连接就绪','ready after resync');
  await plugin.execute('send',{...binding(plugin),text:'等待我停止'});
  await until(()=>blocks(plugin).flatMap(buttons).some(b=>b.commandId==='requestCancel'&&b.enabled),'cancellable');
  const cancel=blocks(plugin).flatMap(buttons).find(b=>b.commandId==='requestCancel'&&b.enabled);
  await plugin.execute('requestCancel',cancel.payload);await plugin.execute('confirmCancel',cancel.payload);
  await until(()=>saved?.outbox.some(r=>r.op==='message.send'&&r.outcome==='cancelled'),'real cancelled',8000);
  assert.equal(calls.filter(x=>x.body?.op==='session.cancel').length,1);
  plugin.dispose();await until(()=>!service.jobs.has(owner),'transport released');
  assert.ok(!JSON.stringify(latest).includes(token));uiCheck(plugin.getSnapshot());
});


test('snapshot in middle of attempt allows marked partial text without resync storm, then detects a real index gap',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();
  h.wire('assistant.delta',{activityId:'act.A',attemptId:'attempt.A',index:17,text:'同步后的内容'});
  assert.match(blocks(h.plugin).find(x=>x.type==='chat').messages.at(-1).content,/仅展示同步后的增量/);
  assert.equal(h.streams.length,1);
  h.wire('assistant.delta',{activityId:'act.A',attemptId:'attempt.A',index:19,text:'缺了一块'});
  assert.equal(h.plugin.getSnapshot().message,'正在同步会话');
});
test('lookup throttling cannot turn an accepted task into a rejected task',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();
  await h.plugin.execute('send',{...binding(h.plugin),text:'仍然执行的任务'});
  await until(()=>h.stored()?.outbox[0].status==='accepted','accepted');
  const id=h.stored().outbox[0].id;
  h.lookups.set(id,{protocol:'pet-dsh/1',ok:false,error:{code:'OVERLOADED',message:'请求过多',retryable:true}});
  await h.plugin.execute('lookupRequest',{wireRequestId:id});await delay(30);
  assert.equal(h.stored().outbox[0].status,'accepted');assert.equal(h.requests.filter(x=>x.method==='POST').length,1);
});
test('new server instance rebuilds snapshot and discards old cursor',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();
  h.info.instanceId='bridge-B';h.sessions.instanceId='bridge-B';h.snapshot={...snapshot(),instanceId:'bridge-B',cursor:'new-opaque-watermark'};
  h.wire('resync.required',{reason:'instance-changed'});
  await until(()=>h.streams.length===2&&h.plugin.getSnapshot().message==='实时连接就绪','new instance');
  assert.equal(h.streams.at(-1).lastEventId,'new-opaque-watermark');assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
});
test('steer requires both setting and handshake and keeps the send action usable',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();
  h.wire('activity.state',{activityId:'external.A',status:'running'});
  await h.plugin.execute('setMode',{...binding(h.plugin),mode:'steer'});
  await h.plugin.execute('send',{...binding(h.plugin),text:'不能偷偷变成追加'});assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
  h.config.enableSteer=true;h.plugin.onSettingsChanged();
  await h.plugin.execute('setMode',{...binding(h.plugin),mode:'steer'});
  const composer=blocks(h.plugin).find(b=>b.type==='form'&&b.commandId==='send');assert.equal(composer.pending,false);assert.equal(composer.stopAction,undefined);
  await h.plugin.execute('send',{...binding(h.plugin),text:'明确的追加指令'});assert.equal(h.requests.find(x=>x.method==='POST').body.data.mode,'steer');
});
test('notifications are deduplicated even before asynchronous persistence completes',async t=>{
  const h=await mockClient({config:{notify:true}});t.after(h.close);await h.connect();await h.choose();
  h.wire('activity.state',{activityId:'act.A',status:'waiting-approval'});
  h.wire('activity.state',{activityId:'act.A',status:'waiting-approval'});
  h.wire('activity.ended',{activityId:'act.A',outcome:'completed'});
  h.wire('activity.ended',{activityId:'act.A',outcome:'completed'});
  await until(()=>h.reminders.length>=2,'reminders');await delay(20);assert.equal(h.reminders.length,2);
});
test('long Unicode snapshot stays within the renderer limit and does not split surrogate pairs',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();h.snapshot.messages=[{messageId:'emoji.A',role:'assistant',text:'😀'.repeat(16000),turn:1}];await h.choose();
  const content=blocks(h.plugin).find(b=>b.type==='chat').messages[0].content;assert.ok(content.length<=16000);assert.ok(!/[\uD800-\uDBFF]$/.test(content));uiCheck(h.plugin.getSnapshot());
});

test('same-session resync preserves composer identity while invalidating old command payload',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();
  const composer=blocks(h.plugin).find(b=>b.type==='form'&&b.commandId==='send'),oldBind=binding(h.plugin);
  h.wire('session.changed',{status:'title'});
  await until(()=>h.streams.length===2&&h.plugin.getSnapshot().message==='实时连接就绪','resync');
  const current=blocks(h.plugin).find(b=>b.type==='form'&&b.commandId==='send');
  assert.equal(current.id,composer.id);assert.notEqual(binding(h.plugin).bindingEpoch,oldBind.bindingEpoch);
  await h.plugin.execute('send',{...oldBind,text:'旧页面按钮'});assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
});
test('EOF preserves unknown task outcome and manual disconnect cancels scheduled retries',async t=>{
  const h=await mockClient();t.after(h.close);await h.connect();await h.choose();h.manualPost=true;
  await h.plugin.execute('send',{...binding(h.plugin),text:'未收到终态'});
  h.wire('activity.state',{activityId:'act.A',status:'running'});
  h.emit({type:'stream.end',streamId:h.streams.at(-1).streamId});
  assert.equal(h.plugin.getSnapshot().status,'degraded');assert.match(JSON.stringify(h.plugin.getSnapshot()),/状态未知/);
  await h.plugin.execute('disconnect');const n=h.requests.length;await delay(1300);assert.equal(h.requests.length,n);
  assert.ok(!h.stored().outbox.some(r=>r.status==='ended'));
});

test('service byte ceiling is checked before persisting a pending record or sending',async t=>{
  const h=await mockClient();t.after(h.close);h.info.limits.requestBytes=1024;await h.connect();await h.choose();
  const result=await h.plugin.execute('send',{...binding(h.plugin),text:'汉'.repeat(500)});
  assert.notEqual(result.resetForm,true);assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
  assert.equal(h.stored().outbox.length,0);
  await h.plugin.execute('send',{...binding(h.plugin),text:'短消息'});assert.equal(h.requests.filter(x=>x.method==='POST').length,1);
});
