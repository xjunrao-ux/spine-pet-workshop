import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createZip } from '../electron/plugins/zip.mjs';
import { inspectPluginZip } from '../electron/plugins/packages.mjs';
import { validateSnapshot,validateEvent,validatePayload,sanitizeConfig } from '../electron/plugins/contracts.mjs';

const documentURL=new URL('../docs/PLUGIN_DEVELOPMENT.md',import.meta.url);
const source=await readFile(documentURL,'utf8');
function example(name,language){
  const start='<!-- example:'+name+':start -->',end='<!-- example:'+name+':end -->';
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.ok(from>=0&&to>from,'Missing documentation example: '+name);
  const match=source.slice(from+start.length,to).match(new RegExp('```'+language+'\\r?\\n([\\s\\S]*?)\\r?\\n```'));
  assert.ok(match,'Missing example fence: '+name);return match[1];
}
const manifest=JSON.parse(example('manifest','json')),providerSource=example('provider','js');
// Only our reviewed, repository-owned documentation example is evaluated here.
// Never use Node import as a verifier for untrusted ZIP plugin code.
const {activate}=await import('data:text/javascript;base64,'+Buffer.from(providerSource).toString('base64'));
async function fixture(t,stored=null){
  const backing=new Map(stored===null?[]:[['state',structuredClone(stored)]]),events=[],snapshots=[],cleanups=[],read=new Set(),controller=new AbortController();
  const config=sanitizeConfig(manifest),context=Object.freeze({signal:controller.signal,startedAt:Date.now(),getConfig:()=>structuredClone(config),getPreferences:()=>({details:true}),isRead:key=>read.has(key),
    storage:Object.freeze({get:async key=>backing.has(key)?structuredClone(backing.get(key)):null,set:async(key,value)=>{backing.set(key,structuredClone(value));return null;}}),
    publish:snapshot=>snapshots.push(validateSnapshot(snapshot)),emit:async event=>{events.push(validateEvent(event));return null;},onCleanup:callback=>cleanups.push(callback)});
  const instance=await activate(context);t.after(()=>{controller.abort();for(const cleanup of cleanups)cleanup();instance.dispose();});
  return {instance,backing,events,snapshots,config,read};
}

test('manual complete manifest and entry form a valid external ZIP without host imports',()=>{
  assert.ok(!providerSource.includes('import '));
  const bundle=inspectPluginZip(createZip({'plugin.json':JSON.stringify(manifest),[manifest.entry]:providerSource}));
  assert.equal(bundle.manifest.id,'com.example.quick-note');assert.equal(bundle.manifest.apiVersion,1);
  assert.equal(validateSnapshot(JSON.parse(example('snapshot','json'))).pages[0].id,'overview');
  assert.equal(validateEvent(JSON.parse(example('event','json'))).pageId,'pending');
});

test('manual provider renders valid pages and its form saves, navigates and emits a linked reminder',async t=>{
  const {instance,backing,events}=await fixture(t),initial=validateSnapshot(instance.getSnapshot());
  assert.equal(initial.pages.length,2);assert.equal(initial.pages[0].readKey,null);
  const form=initial.pages[1].blocks[0],command=manifest.commands.find(item=>item.id===form.commandId);
  assert.ok(command);const payload=validatePayload(command,{text:'  文档演示便签  '}),result=await instance.execute(command.id,payload);
  assert.deepEqual(result,{navigateTo:'overview'});assert.equal(backing.get('state').text,'文档演示便签');
  const snapshot=validateSnapshot(instance.getSnapshot());assert.equal(snapshot.pages[0].blocks[0].text,'文档演示便签');
  assert.equal(events.length,1);assert.equal(events[0].readKeys[0],snapshot.pages[0].readKey);assert.equal(events[0].pageId,snapshot.pages[0].id);
});

test('manual provider restores state without startup alerts and respects its reminder setting',async t=>{
  const saved={schemaVersion:1,text:'已保存的便签',sequence:4},{instance,backing,events,config,snapshots}=await fixture(t,saved);
  assert.equal(instance.getSnapshot().pages[0].blocks[0].text,saved.text);assert.equal(events.length,0);
  config.remindOnSave=false;instance.onSettingsChanged();await instance.execute('saveNote',{text:'不提醒的更新'});
  assert.equal(backing.get('state').sequence,5);assert.equal(events.length,0);instance.onRead();assert.ok(snapshots.length>=3);
});

test('manual provider rejects future data and invalid commands without silently replacing saved data',async t=>{
  await assert.rejects(fixture(t,{schemaVersion:99,text:'保留的未来数据',sequence:1}));
  const {instance,backing}=await fixture(t);await assert.rejects(instance.execute('saveNote',{text:'   '}));assert.equal(backing.size,0);
  await assert.rejects(instance.execute('unknown',{text:'便签'}));assert.equal(backing.size,0);
  instance.dispose();instance.dispose();await assert.rejects(instance.execute('saveNote',{text:'停止后禁止保存'}));assert.equal(backing.size,0);
});

test('manual repository links resolve to real files',async()=>{
  const directory=path.dirname(fileURLToPath(documentURL));
  for(const match of source.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)){
    const target=match[1];if(target.startsWith('#')||/^[a-z]+:/i.test(target))continue;
    await access(path.resolve(directory,target.split('#')[0]));
  }
});
