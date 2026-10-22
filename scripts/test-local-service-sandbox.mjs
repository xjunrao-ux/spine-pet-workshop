import {app,protocol,BrowserWindow,ipcMain,safeStorage} from 'electron';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SANDBOX_SCHEME,createSandboxProvider} from '../electron/plugins/sandbox-runtime.mjs';
import {PluginPackages,inspectPluginZip} from '../electron/plugins/packages.mjs';
import {createZip} from '../electron/plugins/zip.mjs';
import {ExtensionService} from '../electron/extensions/extension-service.mjs';
import {LocalConnectionStore,LocalService} from '../electron/plugins/local-service.mjs';
import {createLocalServiceDialog} from '../electron/plugins/local-service-dialog.mjs';
import {createTestOptions} from './plugin-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(root,'.local','local-service-validation');
await mkdir(directory,{recursive:true});const userData=await mkdtemp(path.join(directory,'profile-'));app.setPath('userData',userData);
protocol.registerSchemesAsPrivileged([SANDBOX_SCHEME]);app.on('window-all-closed',()=>{});
app.on('browser-window-created',(_event,window)=>window.setOpacity(0));
const watchdog=setTimeout(()=>{console.error('Local service sandbox watchdog expired');app.exit(1);},60000);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await delay(40);}throw new Error('Timeout: '+label);}
const id='test.local-service',token='fixture-sandbox-connection-only',checks=[],check=name=>{checks.push(name);console.log('PASS',name);};

void app.whenReady().then(async()=>{
  let host,view,settings,attacker;const calls=[];let forbidden=0,streamClosed=0;
  const server=createServer((req,res)=>{
    if(req.url==='/forbidden'){forbidden++;res.end();return;}
    calls.push({url:req.url,authorization:req.headers.authorization});
    if(req.headers.authorization!=='Bearer '+token){res.writeHead(401,{'content-type':'application/json'});res.end('{"error":"unauthorized"}');return;}
    if(req.url==='/fixture/events'){
      res.writeHead(200,{'content-type':'text/event-stream'});res.write('id: 1\nevent: fixture\ndata: 你好，本地流\n\n');res.once('close',()=>streamClosed++);return;
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({text:'本地响应 <script>window.leaked=true</script>',echo:token}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint='http://127.0.0.1:'+server.address().port+'/fixture/';
  const connections=new LocalConnectionStore({userData,encryption:safeStorage}),service=new LocalService({connections});service.openSettings=createLocalServiceDialog({root,service});
  const manifest={packageType:'spine-pet-plugin',packageVersion:1,id,name:'本地服务验证',version:'1.0.0',apiVersion:1,configVersion:1,entry:'provider.js',icon:'note',entryVisibility:'when-enabled',permissions:['net.local'],settingsSchema:[],commands:['configure','http','stream','stop'].map(command=>({id:command,...(command==='configure'?{managerOnly:true,label:'配置本地服务'}:{}),permissions:['net.local'],fields:{}}))};
  const code=`export async function activate(c){
    let events=[],status=await c.localService.status(),direct='unknown';
    try{await fetch('http://127.0.0.1:${server.address().port}/forbidden');direct='allowed';}catch{direct='blocked';}
    const snapshot=()=>({available:true,status:'ready',pages:[{id:'probe',title:'本地服务验证',icon:'note',blocks:[{type:'text',text:JSON.stringify({events:events.slice(-8),status,direct,node:typeof process})},{type:'button',commandId:'http',label:'请求',icon:'play',enabled:true,payload:{}}]}]});
    const release=await c.localService.subscribe(e=>{events.push(e);c.publish(snapshot());});
    return {getSnapshot:snapshot,execute(command){
      if(command==='configure')return c.localService.configure();
      if(command==='http')return c.localService.request({requestId:'one',method:'POST',path:'/echo',body:{text:'hello'}});
      if(command==='stream')return c.localService.stream({streamId:'updates',path:'/events'});
      if(command==='stop')return c.localService.cancel({streamId:'updates'});
    },dispose:release};
  }`;
  try{
    const options=createTestOptions();options.broker.localService=service;
    host=new ExtensionService({directory:'.',userData,...options,onUpdate:state=>{if(view&&!view.isDestroyed())view.webContents.send('extensions:state',state);}});
    const packages=new PluginPackages({userData,makeProvider:bundle=>createSandboxProvider({root,bundle})});await host.start();
    await packages.install(inspectPluginZip(createZip({'plugin.json':JSON.stringify(manifest),'provider.js':code})),host);
    const plugin=()=>host.snapshot().plugins.find(p=>p.id===id),state=()=>JSON.parse(plugin().pages[0].blocks[0].text);
    assert.equal(plugin().runtime,'active',JSON.stringify(plugin()));assert.equal(state().direct,'blocked');assert.equal(state().node,'undefined');assert.equal(forbidden,0);assert.equal(calls.length,0);
    check('authorized ZIP has a generic capability while direct fetch and Node remain blocked');
    assert.equal((await host.execute(id,'configure',{}, {source:'manager'})).ok,true);
    await until(()=>{settings=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('/local-service-settings.html'));return settings;},'host settings window');
    await until(()=>settings.webContents.executeJavaScript("document.querySelector('#plugin-owner').textContent.includes('test.local-service')"),'window ready');
    assert.equal(await settings.webContents.executeJavaScript("typeof window.localServiceSettings.request"),'undefined');
    const before=calls.length;
    await settings.webContents.executeJavaScript(`document.querySelector('#endpoint').value=${JSON.stringify(endpoint)};document.querySelector('#token').value=${JSON.stringify(token)};document.querySelector('#connection-form').requestSubmit()`);
    await until(async()=>Boolean(await connections.read(id)),'encrypted save');await until(()=>state().events.some(e=>e.type==='configuration.changed'),'configuration callback');
    assert.equal(calls.length,before);assert.ok(!(await readFile(connections.file(id),'utf8')).includes(token));assert.equal(await connections.read('test.other'),null);
    await writeFile(path.join(directory,'connection.png'),(await settings.webContents.capturePage()).toPNG());
    check('trusted window saves per-plugin encrypted credentials without initiating a connection or exposing the token');
    attacker=new BrowserWindow({show:false,webPreferences:{preload:path.join(root,'electron/plugins/local-service-settings-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await attacker.loadURL('data:text/html,untrusted');await assert.rejects(()=>attacker.webContents.executeJavaScript('window.localServiceSettings.status()'));
    attacker.destroy();attacker=null;check('credential IPC rejects a different window even with the same preload');
    assert.equal((await host.execute(id,'http')).ok,true);await until(()=>state().events.some(e=>e.type==='response'),'HTTP callback');
    const response=state().events.find(e=>e.type==='response');assert.equal(response.data.echo,'[redacted]');assert.equal(calls.at(-1).url,'/fixture/echo');
    assert.ok(!JSON.stringify(plugin()).includes(token));check('HTTP request and safe JSON response cross the real Worker RPC');
    await host.execute(id,'stream');await until(()=>state().events.some(e=>e.type==='stream.event'),'SSE callback');assert.equal(state().events.find(e=>e.type==='stream.event').data,'你好，本地流');
    await host.execute(id,'stop');await until(()=>!service.jobs.has(id),'explicit stream cancellation');await until(()=>state().events.some(e=>e.code==='CANCELLED'),'cancel callback');
    check('SSE events and cancellation cross the sandbox without holding a long command');
    const denied={...manifest,id:'test.local-denied',permissions:[],commands:[]};
    await packages.install(inspectPluginZip(createZip({'plugin.json':JSON.stringify(denied),'provider.js':"export function activate(c){return {getSnapshot:()=>({available:true,status:'ready',pages:[{id:'deny',title:'权限验证',icon:'note',blocks:[{type:'text',text:typeof c.localService}]}]}),dispose(){}}}"})),host);
    assert.equal(host.records.get(denied.id).snapshot.pages[0].blocks[0].text,'undefined');check('ZIP without net.local receives no local service API');
    view=new BrowserWindow({show:false,width:510,height:620,webPreferences:{preload:path.join(root,'electron/extensions/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    const sender=event=>assert.equal(event.sender,view.webContents);
    ipcMain.handle('extensions:snapshot',event=>{sender(event);return host.snapshot();});ipcMain.handle('extensions:execute',(event,pluginId,command,payload)=>{sender(event);return host.execute(pluginId,command,payload);});
    ipcMain.handle('extensions:acknowledge',(event,pluginId,items)=>{sender(event);return host.acknowledge(pluginId,items);});ipcMain.handle('extensions:resize',(_event,width,height)=>({width,height}));ipcMain.on('extensions:regions',()=>{});ipcMain.on('extensions:pinned',()=>{});
    await host.setSettings({global:{cardWidth:440,cardHeight:480,reducedMotion:true}});await view.loadFile(path.join(root,'dist/extensions.html'));view.showInactive();
    const js=code=>view.webContents.executeJavaScript(code);await until(()=>js("!!document.querySelector('[data-module=\"test.local-service\"]')"),'UI entry');
    await js("document.querySelector('[data-module=\"test.local-service\"]').click()");await until(()=>js("document.querySelector('#card-body').textContent.includes('本地响应')"),'UI response');
    assert.equal(await js("window.leaked===undefined&&document.querySelector('#card-body script')===null"),true);
    await writeFile(path.join(directory,'plugin.png'),(await view.webContents.capturePage()).toPNG());check('existing declarative UI renders service output as escaped text');
    await host.execute(id,'stream');await until(()=>service.jobs.has(id),'second stream');await until(()=>calls.filter(c=>c.url==='/fixture/events').length===2,'second stream reached server');
    await host.setSettings({plugins:{[id]:{enabled:false}}});await until(()=>!service.jobs.has(id),'disable cleanup');await until(()=>streamClosed>=2,'server socket closed');
    await until(()=>!BrowserWindow.getAllWindows().some(window=>window.webContents.getURL().endsWith('/local-service-settings.html')),'settings close');settings=null;
    assert.equal(service.listeners.has(id),false);assert.ok((await connections.read(id)).token===token);
    check('disable aborts sockets, closes the trusted window and releases listeners while retaining encrypted configuration');
    await host.setSettings({plugins:{[id]:{enabled:true}}});assert.equal(plugin().runtime,'active');await packages.uninstall(id,host);assert.equal(service.listeners.has(id),false);
    check('reenable and uninstall preserve lifecycle isolation');
    await writeFile(path.join(directory,'checks.json'),JSON.stringify({ok:true,checks},null,2));
  }catch(error){console.error('LOCAL SERVICE SANDBOX FAIL',error);process.exitCode=1;}
  finally{attacker?.destroy();view?.destroy();settings?.destroy();await host?.stop();service.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));clearTimeout(watchdog);app.exit(process.exitCode??0);}
});
