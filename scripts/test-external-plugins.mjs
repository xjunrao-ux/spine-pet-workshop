import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readZip,createZip,safeZipPath } from '../electron/plugins/zip.mjs';
import { inspectPluginZip,PluginPackages } from '../electron/plugins/packages.mjs';
import { PluginStorage } from '../electron/plugins/storage.mjs';
import { validateSnapshot } from '../electron/plugins/contracts.mjs';
import { ExtensionService } from '../electron/extensions/extension-service.mjs';
import { createTestOptions } from './plugin-fixture.mjs';
import { activate as activateTodo } from '../plugins/todo/provider.js';
const manifest={...JSON.parse(await readFile(new URL('../plugins/todo/plugin.json',import.meta.url),'utf8')),id:'test.todo'};
const source=await readFile(new URL('../plugins/todo/provider.js',import.meta.url),'utf8');
const bundle=()=>inspectPluginZip(createZip({'plugin.json':JSON.stringify(manifest),'provider.js':source}));
const provider=()=>({activate(){return {getSnapshot:()=>({available:true,status:'ready',pages:[]}),dispose(){}};}});
async function fixture(t){const userData=await mkdtemp(path.join(os.tmpdir(),'pet-zip-')),host=new ExtensionService({directory:'.',userData,...createTestOptions(),onUpdate:()=>{},onEvent:()=>{}}),packages=new PluginPackages({userData,makeProvider:provider});await host.start();t.after(()=>host.stop());return {userData,host,packages};}
test('the independent ZIP contains manifest and entry and does not evaluate source in Node',()=>{
  const zip=createZip({'plugin.json':JSON.stringify(manifest),'provider.js':'globalThis.unsafeMarker=true; export function activate(){}'});
  assert.equal(readZip(zip).size,2);assert.equal(inspectPluginZip(zip).manifest.id,'test.todo');assert.equal(globalThis.unsafeMarker,undefined);
});
test('ZIP paths reject traversal, absolute/drive paths, alternate streams and Windows special names',()=>{
  for(const name of ['../provider.js','/provider.js','C:/provider.js','dir\\file.js','a.js:stream','NUL.js','x/../y','x./y','x /y','x|y'])assert.throws(()=>safeZipPath(name));
  assert.equal(safeZipPath('src/provider.js'),'src/provider.js');
});
test('ZIP corruption, symlinks and duplicate case-folded paths are rejected',()=>{
  assert.throws(()=>readZip(Buffer.alloc(21)));assert.throws(()=>readZip(createZip({'A.txt':'a','a.txt':'b'})));
  const zip=createZip({'provider.js':'export const value=123;'}),directory=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  const corrupt=Buffer.from(zip);corrupt.writeUInt32LE(1,directory+16);assert.throws(()=>readZip(corrupt));
  const symlink=Buffer.from(zip);symlink.writeUInt32LE(0xa1ff0000,directory+38);assert.throws(()=>readZip(symlink));
});
test('package format, builtin namespace, unsupported API and privileged permissions fail before activation',()=>{
  for(const changes of [{id:'workshop.todo'},{apiVersion:2},{packageVersion:9},{permissions:['media.read']}]){
    assert.throws(()=>inspectPluginZip(createZip({'plugin.json':JSON.stringify({...manifest,...changes}),'provider.js':source})));
  }
  assert.throws(()=>inspectPluginZip(createZip({'readme.txt':'no manifest'})));
});
test('untrusted snapshots cannot replace identity, origin, permissions or runtime metadata',()=>{
  const snapshot=validateSnapshot({available:true,status:'ready',pages:[],id:'workshop.music',origin:'builtin',enabled:true,manifest:{id:'workshop.music'},grantedPermissions:['codex.read'],runtime:'active'});
  for(const key of ['id','origin','enabled','manifest','grantedPermissions','runtime'])assert.equal(snapshot[key],undefined);
});
test('ZIP install/update/uninstall follows dynamic registry and preserves independent data',async t=>{
  const {host,packages,userData}=await fixture(t);assert.equal(host.snapshot().plugins.length,3);await packages.install(bundle(),host);
  assert.equal(host.snapshot().plugins.length,4);assert.equal(host.records.get('test.todo').origin,'external');
  await host.storage.set('test.todo','state',{items:[{title:'保留的演示待办'}]});await packages.install(bundle(),host);assert.equal(host.snapshot().plugins.length,4);
  await packages.uninstall('test.todo',host);assert.equal(host.snapshot().plugins.length,3);assert.equal((await host.storage.get('test.todo','state')).items[0].title,'保留的演示待办');
  await packages.install(bundle(),host);assert.equal(host.records.get('test.todo').runtime,'active');
  const loader=new PluginPackages({userData,makeProvider:provider});assert.equal((await loader.load()).length,1);
  assert.equal(JSON.parse(await readFile(path.join(userData,'plugins','installed.json'),'utf8')).installed[0].id,'test.todo');
});
test('package hash tampering and future install indexes do not execute or overwrite data',async t=>{
  const {host,packages,userData}=await fixture(t);const pack=bundle();await packages.install(pack,host);const cached=packages.file(pack.hash),data=JSON.parse(await readFile(cached,'utf8'));data.code+='\n// tamper';await writeFile(cached,JSON.stringify(data));
  const fresh=new PluginPackages({userData,makeProvider:provider}),quarantined=await fresh.load();assert.equal(quarantined.length,1);assert.deepEqual(quarantined[0].grantedPermissions,[]);assert.throws(()=>quarantined[0].activate());
  const future={schemaVersion:99,installed:[]};await writeFile(packages.index,JSON.stringify(future));const futureLoader=new PluginPackages({userData,makeProvider:provider});await assert.rejects(futureLoader.load());await assert.rejects(futureLoader.install(pack,host));assert.deepEqual(JSON.parse(await readFile(packages.index,'utf8')),future);
});
test('storage is isolated by plugin ID, survives new instances and enforces quota and safe keys',async()=>{
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-store-')),storage=new PluginStorage(userData);
  await storage.set('test.todo','state',{value:'one'});assert.equal(await storage.get('example.other','state'),null);
  assert.deepEqual(await new PluginStorage(userData).get('test.todo','state'),{value:'one'});
  await assert.rejects(storage.set('test.todo','../outside','bad'));await assert.rejects(storage.set('test.todo','state','x'.repeat(600000)));
  await assert.rejects(storage.set('test.todo','state',{value:'changed'},()=>{throw new Error('revoked');}));assert.deepEqual(await storage.get('test.todo','state'),{value:'one'});
});
async function todo(t,backing=new Map(),config={reminders:true,intervalSeconds:120}){
  const events=[],cleanups=[],context={getConfig:()=>config,storage:{get:async key=>backing.has(key)?structuredClone(backing.get(key)):null,set:async(key,value)=>backing.set(key,structuredClone(value))},publish:()=>{},emit:event=>events.push(event),onCleanup:callback=>cleanups.push(callback)};
  const instance=await activateTodo(context);t.after(()=>{instance.dispose();for(const cleanup of cleanups)cleanup();});return {instance,events,backing,config};
}
test('todo source works independently: add/edit/complete/reopen/delete/undo and restart persistence',async t=>{
  const {instance,backing}=await todo(t);await instance.execute('add',{title:'演示待办',notes:'备注',dueAt:''});const id=backing.get('state').items[0].id;
  assert.equal(instance.getSnapshot().pages[0].subtitle,'1 项待完成');assert.equal((await instance.execute('edit',{id})).navigateTo,'compose');
  await instance.execute('save',{id,title:'修改后的待办',notes:'新备注',dueAt:''});await instance.execute('complete',{id});assert.equal(instance.getSnapshot().pages[1].subtitle,'1 项 · 可以恢复');
  await instance.execute('reopen',{id});await instance.execute('delete',{id});assert.equal(backing.get('state').items.length,0);await instance.execute('undoDelete',{});assert.equal(backing.get('state').items[0].title,'修改后的待办');
  const restored=await todo(t,backing);assert.equal(restored.instance.getSnapshot().pages[0].subtitle,'1 项待完成');
});
test('due reminders fire once, survive restart and snooze safely; disabled reminders do not emit',async t=>{
  const {instance,backing,events}=await todo(t);await instance.execute('add',{title:'到期演示',dueAt:new Date(Date.now()-1000).toISOString()});assert.equal(events.length,1);assert.match(events[0].summary.details,/到期演示/);
  await instance.onSettingsChanged();assert.equal(events.length,1);const id=backing.get('state').items[0].id;const restarted=await todo(t,backing);assert.equal(restarted.events.length,0);
  await instance.execute('snooze',{id});assert.ok(Date.parse(backing.get('state').items[0].dueAt)>Date.now()+590000);
  const quiet=await todo(t,new Map(),{reminders:false,intervalSeconds:120});await quiet.instance.execute('add',{title:'暂不提醒',dueAt:new Date(Date.now()-1000).toISOString()});assert.equal(quiet.events.length,0);
});
test('generic form schema validates safe inputs and refuses unknown types and duplicate keys',()=>{
  const base={available:true,status:'ready',pages:[{id:'form',title:'表单',icon:'plus',blocks:[{type:'form',id:'add',commandId:'add',submitLabel:'添加',fields:[{key:'title',type:'text',label:'标题',maxLength:160}]}]}]};
  assert.equal(validateSnapshot(base).pages[0].blocks[0].type,'form');const invalid=structuredClone(base);invalid.pages[0].blocks[0].fields[0].type='html';assert.throws(()=>validateSnapshot(invalid));
});
test('external private reminders cannot display task content supplied as a private summary',async t=>{
  const {host}=await fixture(t);let context;const def={manifest,origin:'external',grantedPermissions:manifest.permissions,activate(ctx){context=ctx;return provider().activate(ctx);}};
  const events=[];host.onEvent=event=>events.push(event);await host.installDefinition(def);
  context.emit({id:'private-test',dedupeKey:'private-test',createdAt:new Date().toISOString(),count:2,summary:{private:'不得显示的任务正文',details:'显示模式的任务正文'}});
  assert.equal(events[0].text,'待办事项 · 2 条新提醒');assert.ok(!events[0].text.includes('任务正文'));
});

test('declarative context menus reject non-button or malformed actions and enforce a bounded list',()=>{
  const action={type:'button',commandId:'edit',label:'编辑',icon:'edit',enabled:true,payload:{id:'task'}};
  const snapshot={available:true,status:'ready',pages:[{id:'items',title:'项目',icon:'cloud',blocks:[{type:'group',layout:'row',children:[],contextActions:[action]}]}]};
  assert.equal(validateSnapshot(snapshot).pages[0].blocks[0].contextActions[0].payload.id,'task');
  for(const actions of ['arbitrary HTML',[{type:'text',text:'unsupported'}],[{...action,icon:'untrusted-svg'}],[{...action,payload:'not JSON object'}],Array.from({length:11},()=>action)]){
    const invalid=structuredClone(snapshot);invalid.pages[0].blocks[0].contextActions=actions;assert.throws(()=>validateSnapshot(invalid));
  }
});
