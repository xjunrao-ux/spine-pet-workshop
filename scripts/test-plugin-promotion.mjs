import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PluginPackages,inspectPluginZip} from '../electron/plugins/packages.mjs';
import {PluginStorage} from '../electron/plugins/storage.mjs';
import {createZip} from '../electron/plugins/zip.mjs';
import {ExtensionService} from '../electron/extensions/extension-service.mjs';
import {createTestOptions} from './plugin-fixture.mjs';
import {activate} from '../plugins/todo/provider.js';
const manifest=JSON.parse(await readFile(new URL('../plugins/todo/plugin.json',import.meta.url),'utf8'));
const code=await readFile(new URL('../plugins/todo/provider.js',import.meta.url),'utf8');
const fake=()=>({activate(){return {getSnapshot:()=>({available:true,status:'ready',pages:[]}),dispose(){}};}});
test('production defaults are music, notifications and Todo, with no Codex subscription',async t=>{
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-defaults-')),host=new ExtensionService({directory:'.',userData,...createTestOptions(),onUpdate:()=>{},onEvent:()=>{}});t.after(()=>host.stop());await host.start();
  assert.deepEqual(host.snapshot().plugins.map(p=>p.id),['workshop.music','workshop.notifications','example.todo']);assert.equal(host.broker.codexSubscribers.size,0);assert.equal(host.broker.codex,undefined);assert.equal(host.broker.windows.leases.size,2);
});
async function prepare(t){
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-promote-')),old=new ExtensionService({directory:'.',userData,...createTestOptions(),definitions:createTestOptions().definitions.filter(def=>def.manifest.id!==manifest.id),onUpdate:()=>{},onEvent:()=>{}}),packages=new PluginPackages({userData,makeProvider:fake});
  await old.start();t.after(()=>old.stop());await packages.install(inspectPluginZip(createZip({'plugin.json':JSON.stringify(manifest),'provider.js':code})),old);
  const state={schemaVersion:1,items:[{id:'saved',title:'旧 ZIP 待办',notes:'保留备注',done:false,dueAt:null,createdAt:new Date().toISOString(),remindedFor:null}],trash:[],sequence:0,latestReminder:null};
  await old.storage.set(manifest.id,'state',state);await old.setSettings({plugins:{[manifest.id]:{enabled:false,config:{reminders:false,intervalSeconds:21}}}});await old.stop();
  return {userData,packages,state};
}

test('promotion removes only the old ZIP registration, backs up its index and never executes its provider',async t=>{
  const {userData,packages,state}=await prepare(t);let executions=0;const loader=new PluginPackages({userData,makeProvider:()=>{executions++;throw new Error('must not execute promoted ZIP');}});
  assert.deepEqual(await loader.load({builtinIds:[manifest.id]}),[]);assert.equal(executions,0);
  assert.equal(JSON.parse(await readFile(packages.index,'utf8')).installed.length,0);assert.equal(JSON.parse(await readFile(packages.index+'.before-builtin.bak','utf8')).installed[0].id,manifest.id);
  assert.deepEqual(await new PluginStorage(userData).get(manifest.id,'state'),state);assert.ok((await readFile(packages.file(inspectPluginZip(createZip({'plugin.json':JSON.stringify(manifest),'provider.js':code})).hash),'utf8')).includes('manifest'));
});

test('same-ID builtin preserves disable/config/data, enables once and refuses ZIP replacement or uninstall',async t=>{
  const {userData,state}=await prepare(t),options=createTestOptions();const host=new ExtensionService({directory:'.',userData,...options,definitions:[...options.definitions.filter(def=>def.manifest.id!==manifest.id),{manifest,activate}],onUpdate:()=>{},onEvent:()=>{}});t.after(()=>host.stop());
  const loader=new PluginPackages({userData,makeProvider:fake});for(const def of await loader.load({builtinIds:[...host.records.keys()]}))host.addDefinition(def);await host.start();
  assert.equal(host.snapshot().plugins.filter(p=>p.id===manifest.id).length,1);assert.equal(host.records.get(manifest.id).origin,'builtin');assert.equal(host.records.get(manifest.id).enabled,false);assert.equal(host.store.data.plugins[manifest.id].config.intervalSeconds,21);
  await host.setSettings({plugins:{[manifest.id]:{enabled:true}}});assert.equal(host.records.get(manifest.id).snapshot.pages[0].blocks.find(b=>b.appearance==='task-row').children.find(b=>b.appearance==='task-content').children[0].text,state.items[0].title);
  await assert.rejects(loader.install(inspectPluginZip(createZip({'plugin.json':JSON.stringify(manifest),'provider.js':code})),host),/内置/);await assert.rejects(host.uninstallDefinition(manifest.id),/内置/);
  assert.equal(host.records.get(manifest.id).runtime,'active');assert.equal(JSON.parse(await readFile(loader.index,'utf8')).installed.length,0);
});

test('future or duplicate install indexes fail closed before promotion and keep original bytes',async t=>{
  const {userData,packages}=await prepare(t);
  for(const data of [{schemaVersion:99,installed:packages.installed},{schemaVersion:1,installed:[...packages.installed,...packages.installed]}]){
    const raw=JSON.stringify(data);await writeFile(packages.index,raw);await assert.rejects(new PluginPackages({userData,makeProvider:fake}).load({builtinIds:[manifest.id]}));assert.equal(await readFile(packages.index,'utf8'),raw);
  }
});

test('former builtin Codex config and read/event identities survive as external aliases',async t=>{
  const userData=await mkdtemp(path.join(os.tmpdir(),'pet-codex-alias-')),old={enabled:false,configVersion:1,config:{futureKey:'keep'}};
  await writeFile(path.join(userData,'feature-settings.json'),JSON.stringify({schemaVersion:2,global:{},plugins:{'workshop.codex':old}}));
  await writeFile(path.join(userData,'plugin-read-state.json'),JSON.stringify({schemaVersion:1,reads:[['workshop.codex\u001fcompleted-old',Date.now()]],events:[['workshop.codex\u001fcompleted-old',Date.now()]]}));
  const host=new ExtensionService({directory:'.',userData,...createTestOptions(),onUpdate:()=>{},onEvent:()=>{}});t.after(()=>host.stop());await host.start();
  assert.deepEqual(host.store.data.plugins['io.spine-workshop.codex'],old);assert.deepEqual(host.store.data.plugins['workshop.codex'],old);
  assert.equal(host.store.isRead('io.spine-workshop.codex','completed-old'),true);assert.equal(host.store.seenEvent('io.spine-workshop.codex','completed-old'),true);assert.equal(host.records.has('workshop.codex'),false);
});
