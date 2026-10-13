import {app,protocol} from 'electron';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SANDBOX_SCHEME,createSandboxProvider} from '../electron/plugins/sandbox-runtime.mjs';
import {PluginPackages,inspectPluginZip} from '../electron/plugins/packages.mjs';
import {createZip} from '../electron/plugins/zip.mjs';
import {ExtensionService} from '../electron/extensions/extension-service.mjs';
import {createTestOptions} from './plugin-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(root,'.local','codex-gateway-tests');
await mkdir(directory,{recursive:true});app.setPath('userData',await mkdtemp(path.join(directory,'profile-')));
protocol.registerSchemesAsPrivileged([SANDBOX_SCHEME]);app.on('window-all-closed',()=>{});
const watchdog=setTimeout(()=>{console.error('Codex gateway watchdog expired');app.exit(1);},60000);
void app.whenReady().then(async()=>{
  const options=createTestOptions();
  if(process.env.PLUGIN_SANDBOX_RUNTIME_ROOT){const packed=await import(pathToFileURL(path.join(process.env.PLUGIN_SANDBOX_RUNTIME_ROOT,'electron','plugins','registry.mjs')).href);assert.deepEqual(packed.BUILTIN_PLUGINS.map(def=>def.manifest.id),['workshop.music','workshop.notifications','example.todo']);options.definitions=packed.BUILTIN_PLUGINS;console.log('PASS packaged registry imports Todo JSON and has no Codex provider');}
  const host=new ExtensionService({directory:'.',userData:app.getPath('userData'),...options,onUpdate:()=>{},onEvent:()=>{}});
  const packages=new PluginPackages({userData:app.getPath('userData'),makeProvider:bundle=>createSandboxProvider({root:process.env.PLUGIN_SANDBOX_RUNTIME_ROOT||root,bundle})});
  const checks=[],check=name=>{checks.push(name);console.log('PASS',name);},waitFor=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Gateway wait expired');};
  const manifest={packageType:'spine-pet-plugin',packageVersion:1,id:'test.codex-gateway',name:'只读订阅验证',version:'1.0.0',apiVersion:1,configVersion:1,entry:'provider.js',icon:'codex',entryVisibility:'when-enabled',permissions:['codex.read'],commands:[],settingsSchema:[]};
  const code='export async function activate(c){let state={},event=null;const snapshot=()=>({available:true,status:"ready",pages:[{id:"probe",title:"只读验证",icon:"codex",blocks:[{type:"text",text:JSON.stringify({state,event})}]}]});const release=await c.codex.subscribe(value=>{state=value;c.publish(snapshot())},value=>{event=value;c.publish(snapshot())});return {getSnapshot:snapshot,dispose:release};}';
  const bundle=(m,source=code)=>inspectPluginZip(createZip({'plugin.json':JSON.stringify(m),'provider.js':source}));
  try{
    await host.start();const previous=options.broker.codexSubscribers.size;
    await packages.install(bundle(manifest),host);assert.equal(host.records.get(manifest.id).runtime,'active');assert.equal(options.broker.codexSubscribers.size,previous+1);check('authorized ZIP starts a real sandboxed Codex readonly subscription');
    options.broker.windows.ingest({codexRunning:true});
    options.broker.codex.push({running:true,connected:true,primary:{remaining:79,minutes:300,resetsAt:null},tasks:[{id:'demo',name:'演示任务',status:'idle',turnStatus:'completed',token:'not-exposed'}],credentials:'not-exposed',raw:'not-exposed'});
    await waitFor(()=>host.records.get(manifest.id).snapshot.pages[0]?.blocks[0].text.includes('79'));
    const state=JSON.parse(host.records.get(manifest.id).snapshot.pages[0].blocks[0].text).state;assert.equal(state.primary.remaining,79);assert.equal(state.tasks[0].name,'演示任务');assert.ok(!JSON.stringify(state).includes('not-exposed'));check('gateway forwards bounded quota/task fields and strips unknown backend fields');
    options.broker.codex.emit({id:'demo-event',createdAt:new Date().toISOString(),text:'演示任务已完成',raw:'not-exposed'});
    await waitFor(()=>host.records.get(manifest.id).snapshot.pages[0].blocks[0].text.includes('demo-event'));check('readonly event callbacks cross the sandbox gateway');
    const denied={...manifest,id:'test.codex-denied',permissions:[]};await packages.install(bundle(denied,'export function activate(c){return {getSnapshot:()=>({available:true,status:"ready",pages:[{id:"deny",title:"权限验证",icon:"note",blocks:[{type:"text",text:typeof c.codex}]}]}),dispose(){}}}'),host);
    assert.equal(host.records.get(denied.id).snapshot.pages[0].blocks[0].text,'undefined');assert.equal(options.broker.codexSubscribers.size,previous+1);check('a ZIP without codex.read receives no Codex API or subscription');
    await host.setSettings({plugins:{[manifest.id]:{enabled:false}}});assert.equal(options.broker.codexSubscribers.size,previous);await host.setSettings({plugins:{[manifest.id]:{enabled:true}}});assert.equal(options.broker.codexSubscribers.size,previous+1);
    await packages.uninstall(manifest.id,host);assert.equal(options.broker.codexSubscribers.size,previous);check('disable and uninstall revoke external Codex leases without affecting other subscribers');
    console.log(JSON.stringify({ok:true,checks}));
  }catch(error){console.error('CODEX ZIP FAIL',error);process.exitCode=1;}
  finally{await host.stop();clearTimeout(watchdog);app.exit(process.exitCode??0);}
});
