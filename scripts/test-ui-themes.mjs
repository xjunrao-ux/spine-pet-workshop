import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {sanitizeGlobals,SettingsStore} from '../electron/plugins/settings-store.mjs';
import {THEME_PRESETS,themeVariables,sanitizeCustomTheme,DEFAULT_CUSTOM_THEME} from '../electron/plugins/themes.mjs';
import {companionState,executeCompanion} from '../electron/plugins/companion.mjs';
import {ExtensionService} from '../electron/extensions/extension-service.mjs';
import {createTestOptions,testPlugin} from './plugin-fixture.mjs';
test('theme allowlist and saved order survive reload without corrupting older settings',async()=>{
 const original=sanitizeGlobals({cardWidth:300});assert.equal(original.theme,'graphite');assert.deepEqual(original.pluginOrder,[]);
 const state=sanitizeGlobals({theme:'forest',pluginOrder:['test.a','test.a','../escape',null,'test.b']});
 assert.equal(state.theme,'forest');assert.deepEqual(state.pluginOrder,['test.a','test.b']);
 assert.equal(sanitizeGlobals({theme:'url(script)'}).theme,'graphite');
 for(const t of THEME_PRESETS){assert.equal(themeVariables(t.id)['--accent'],t.accent);assert.equal(themeVariables(t.id)['--ink'],t.ink);}
 const dir=await mkdtemp(path.join(os.tmpdir(),'pet-theme-')),store=new SettingsStore(dir,[]);
 await store.save({schemaVersion:2,global:state,plugins:{}});const restored=new SettingsStore(dir,[]);await restored.load();
 assert.deepEqual(restored.data.global,state);
});
test('theme and order updates change snapshots without reactivating or reconfiguring plugins',async t=>{
 let settingsCalls=0;
 const options=createTestOptions({fourth:true}),definition={...testPlugin,activate:async context=>{const instance=await testPlugin.activate(context);return {...instance,onSettingsChanged(){settingsCalls++;}};}};
 const userData=await mkdtemp(path.join(os.tmpdir(),'pet-order-'));
 const host=new ExtensionService({directory:'.',userData,...options,definitions:[...options.definitions.filter(d=>d.manifest.id!==testPlugin.manifest.id),definition],onUpdate:()=>{},onEvent:()=>{}});
 t.after(()=>host.stop());await host.start();
 const epoch=host.snapshot().plugins.find(p=>p.id===testPlugin.manifest.id).epoch;
 const ids=host.snapshot().plugins.map(p=>p.id).reverse();await host.setSettings({global:{theme:'graphite',pluginOrder:ids,companionTrigger:'click',companionWidth:480}});
 assert.deepEqual(host.snapshot().plugins.map(p=>p.id),ids);assert.equal(settingsCalls,0);assert.equal(host.snapshot().plugins.find(p=>p.id===testPlugin.manifest.id).epoch,epoch);
 const saved=JSON.parse(await readFile(path.join(userData,'feature-settings.json'),'utf8'));assert.deepEqual(saved.global.pluginOrder,ids);
});
const fixture=()=>({settings:{theme:'graphite'},locked:false,plugins:[{id:'ai.test',epoch:2,enabled:true,runtime:'active',manifest:{name:'AI',icon:'chat',presentation:{panel:'bubble'}},settingsPages:[{blocks:[{type:'text',text:'private memory'}]}],pages:[{blocks:[{type:'chat',messages:[{id:'u',role:'user',content:'private history'},{id:'a',role:'assistant',content:'你好',state:'complete'}]}],footer:[{type:'form',variant:'composer',commandId:'send',enabled:true,fields:[{key:'text',type:'text',maxLength:10}],pending:false,stopAction:{commandId:'stop',enabled:true}}]}]}]});
test('pet projection excludes history and settings, hides disabled and locked companions',()=>{
 const snap=fixture(),value=companionState(snap);assert.equal(value.companion.assistant.content,'你好');
 assert.ok(!JSON.stringify(value).includes('private'));
 snap.locked=true;assert.equal(companionState(snap).companion,null);snap.locked=false;snap.plugins[0].enabled=false;assert.equal(companionState(snap).companion,null);
});
test('pet execution permits only the current composer/stop, with bounded text and matching epoch',async()=>{
 const snap=fixture(),calls=[],service={snapshot:()=>snap,execute:async(...args)=>{calls.push(args);return {ok:true,data:{resetForm:true,secret:'never returned'}};}};
 for(const args of [['ai.other',2,'send','hi'],['ai.test',1,'send','hi'],['ai.test',2,'configure','hi'],['ai.test',2,'send','x'.repeat(11)],['ai.test',2,'send','  ']])assert.equal((await executeCompanion(service,...args)).ok,false);
 assert.equal(calls.length,0);const r=await executeCompanion(service,'ai.test',2,'send','hi');assert.deepEqual(r,{ok:true,data:{resetForm:true}});
 snap.plugins[0].pages[0].footer[0].pending=true;assert.equal((await executeCompanion(service,'ai.test',2,'send','hi')).ok,false);
 assert.equal((await executeCompanion(service,'ai.test',2,'stop')).ok,true);assert.equal(calls.length,2);
});

test('custom colors reject CSS injection, survive partial updates and do not call providers',async t=>{
 const c=sanitizeCustomTheme({accent:'#ABCDEF',surface:'url(evil)',ink:'#111111; color:red',unknown:'#123456'});
 assert.equal(c.accent,'#abcdef');assert.equal(c.surface,DEFAULT_CUSTOM_THEME.surface);assert.equal(c.ink,DEFAULT_CUSTOM_THEME.ink);
 assert.equal(sanitizeGlobals({theme:'slate'}).theme,'graphite');assert.ok(!THEME_PRESETS.some(t=>t.id==='slate'));
 const options=createTestOptions(),userData=await mkdtemp(path.join(os.tmpdir(),'pet-custom-')),host=new ExtensionService({directory:'.',userData,...options,onUpdate:()=>{},onEvent:()=>{}});t.after(()=>host.stop());await host.start();
 await host.setSettings({global:{theme:'custom',customTheme:{accent:'#12abcd',ink:'#eeeeee'}}});
 await host.setSettings({global:{customTheme:{surface:'#123456'},companionOpacity:20,companionWidth:480,companionTrigger:'click',companionPosition:{x:-1400,y:350}}});
 assert.equal(host.settings.customTheme.accent,'#12abcd');assert.equal(host.settings.customTheme.surface,'#123456');
 assert.equal(themeVariables('custom',host.settings.customTheme)['--surface-rgb'],'18,52,86');
 const restored=new SettingsStore(userData,options.definitions);await restored.load();assert.deepEqual(restored.data.global.customTheme,host.settings.customTheme);
 assert.equal(restored.data.global.companionWidth,480);assert.equal(restored.data.global.companionTrigger,'click');
 assert.equal(sanitizeGlobals().companionTrigger,'hover');assert.equal(sanitizeGlobals({companionTrigger:'bad'}).companionTrigger,'hover');
 assert.equal(sanitizeGlobals({companionWidth:-1}).companionWidth,240);assert.equal(sanitizeGlobals({companionWidth:9999}).companionWidth,720);assert.equal(sanitizeGlobals({companionWidth:Infinity}).companionWidth,340);
 assert.equal(restored.data.global.companionOpacity,20);assert.deepEqual(restored.data.global.companionPosition,{x:-1400,y:350});
 assert.equal(sanitizeGlobals({companionOpacity:999}).companionOpacity,100);assert.equal(sanitizeGlobals({companionPosition:{x:Infinity,y:0}}).companionPosition,null);
});
