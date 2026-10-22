import {app,protocol,BrowserWindow,ipcMain,safeStorage} from 'electron';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SANDBOX_SCHEME,createSandboxProvider} from '../electron/plugins/sandbox-runtime.mjs';
import {PluginPackages} from '../electron/plugins/packages.mjs';
import {ExtensionService} from '../electron/extensions/extension-service.mjs';
import {LocalConnectionStore,LocalService} from '../electron/plugins/local-service.mjs';
import {createLocalServiceDialog} from '../electron/plugins/local-service-dialog.mjs';
import {createTestOptions} from './plugin-fixture.mjs';
import {startBridge} from '../dsh-pet-bridge/test/helpers/bridge-host.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(root,'.local/dsh-pet-validation');
await mkdir(directory,{recursive:true});const userData=await mkdtemp(path.join(directory,'profile-'));app.setPath('userData',userData);
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([SANDBOX_SCHEME]);app.on('window-all-closed',()=>{});
app.on('browser-window-created',(_event,window)=>window.setOpacity(0));
const watchdog=setTimeout(()=>{console.error('DSH sandbox watchdog expired');app.exit(1);},90000);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,timeout=10000){const started=Date.now();while(Date.now()-started<timeout){if(await fn())return;await delay(40);}throw new Error('Timeout '+label);}
const id='io.spine-workshop.dsh-pet',checks=[],check=name=>{checks.push(name);console.log('PASS',name);};
void app.whenReady().then(async()=>{
  let host,view,settings,bridge,service;let errorResult=null;
  try{
    bridge=await startBridge({harnessOptions:{deltaChunks:160,reply:('模拟 Harness 的项目分析 <script>window.injected=true</script>\n').repeat(30)}});
    const connections=new LocalConnectionStore({userData,encryption:safeStorage});service=new LocalService({connections});
    service.openSettings=createLocalServiceDialog({root,service});
    const options=createTestOptions();options.broker.localService=service;
    host=new ExtensionService({directory:'.',userData,...options,onUpdate:state=>{if(view&&!view.isDestroyed())view.webContents.send('extensions:state',state);}});
    const packages=new PluginPackages({userData,makeProvider:bundle=>createSandboxProvider({root,bundle})});await host.start();
    await packages.install(await packages.inspect(path.join(root,'release/plugins/DSH-Pet-Plugin-v1.1.0.zip')),host);
    const plugin=()=>host.snapshot().plugins.find(p=>p.id===id);
    const state=()=>JSON.stringify(plugin());
    const composer=()=>plugin().pages.find(p=>p.id==='chat').footer?.find(b=>b.commandId==='send');
    assert.equal(plugin().runtime,'active',state());assert.equal(service.jobs.has(id),false);
    check('installable ZIP activates in a real Worker sandbox without starting DSH tasks');
    assert.equal((await host.execute(id,'configureManager',{}, {source:'manager'})).ok,true);
    await until(()=>{settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/local-service-settings.html'));return settings;},'trusted settings');
    await until(()=>settings.webContents.executeJavaScript("document.querySelector('#status').textContent.includes('尚未')"),'settings ready');
    // Only generated test credentials, never the user's actual DSH configuration.
    await settings.webContents.executeJavaScript("document.querySelector('#endpoint').value="+JSON.stringify(bridge.url)+";document.querySelector('#token').value="+JSON.stringify(bridge.token)+";document.querySelector('#connection-form').requestSubmit()");
    await until(()=>settings.webContents.executeJavaScript("document.querySelector('#status').textContent.includes('已保存')"),'encrypted save');
    assert.ok(!(await readFile(connections.file(id),'utf8')).includes(bridge.token));assert.ok(!state().includes(bridge.token));
    await writeFile(path.join(directory,'connection.png'),(await settings.webContents.capturePage()).toPNG());settings.close();settings=null;
    check('trusted host window saves isolated encrypted connection credentials');
    await host.execute(id,'connect');await until(()=>plugin().message==='请选择授权会话','session list');
    const select=plugin().pages.find(p=>p.id==='sessions').blocks.flatMap(b=>b.children??[]).find(b=>b.commandId==='selectSession'&&b.enabled);
    assert.ok(select);await host.execute(id,'selectSession',select.payload);await host.execute(id,'confirmSession',select.payload);
    await until(()=>plugin().message==='实时连接就绪','ready');
    check('handshake, explicit session selection and snapshot-to-SSE cursor pairing cross real RPC');
    view=new BrowserWindow({show:false,width:510,height:720,frame:false,webPreferences:{preload:path.join(root,'electron/extensions/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
    const sender=event=>assert.equal(event.sender,view.webContents);
    ipcMain.handle('extensions:snapshot',event=>{sender(event);return host.snapshot();});
    ipcMain.handle('extensions:execute',(event,pid,command,payload)=>{sender(event);return host.execute(pid,command,payload);});
    ipcMain.handle('extensions:acknowledge',(event,pid,items)=>{sender(event);return host.acknowledge(pid,items);});
    ipcMain.handle('extensions:resize',(_event,width,height)=>({width,height}));ipcMain.on('extensions:regions',()=>{});ipcMain.on('extensions:pinned',()=>{});
    await host.setSettings({global:{cardWidth:440,cardHeight:560,reducedMotion:true}});
    await view.loadFile(path.join(root,'dist/extensions.html'));view.showInactive();
    const js=code=>view.webContents.executeJavaScript(code);
    await until(()=>js("!!document.querySelector('[data-module=\"io.spine-workshop.dsh-pet\"]')"),'menu');
    await js("document.querySelector('[data-module=\"io.spine-workshop.dsh-pet\"]').click()");
    await until(()=>js("!!document.querySelector('[data-command-form=send] input:not(:disabled)')"),'composer');
    await js("document.querySelector('[data-command-form=send] input').value='检查项目的测试结构';document.querySelector('[data-command-form=send]').requestSubmit()");
    await until(()=>js("document.querySelector('.chat-log')?.textContent.includes('模拟 Harness')"),'streamed UI');
    await until(()=>plugin().message==='实时连接就绪','resync ready');
    await js("{const input=document.querySelector('.chat-composer input');input.focus({preventScroll:true});input.value='下一条消息的草稿';input.setSelectionRange(3,3);}");
    // Render-only settings update must not lose draft or caret in the same binding.
    await host.records.get(id).instance.onSettingsChanged();await delay(100);
    assert.equal(await js("document.querySelector('.chat-composer input').value"),'下一条消息的草稿');
    assert.equal(await js("document.querySelector('.chat-composer input').selectionStart"),3);
    assert.equal(await js("window.injected===undefined && document.querySelector('.chat-log script')===null"),true);
    await writeFile(path.join(directory,'chat.png'),(await view.webContents.capturePage()).toPNG());
    check('actual chat UI renders streaming text safely and preserves editable drafts and caret');
    await until(async()=>(await host.storage.get(id,'state'))?.outbox.some(r=>r.op==='message.send'&&r.outcome==='completed'),'completed receipt',12000);
    await until(()=>plugin().message==='实时连接就绪','after completion');
    check('only confirmed activity outcomes complete persisted task records');
    await host.execute(id,'savePersona',{persona:'本机保存的角色资料',memory:'偏好中文'});
    assert.match(state(),/本机保存的角色资料/);
    assert.equal(bridge.session.events.filter(e=>e.type==='user/message').length,1);
    check('persona and manual memory save locally without injecting DSH messages');
    // Start a second long synthetic task, then stop through the plugin confirmation flow.
    await until(()=>bridge.agent.status==='idle','idle');await delay(350);
    await host.execute(id,'send',{...composer().payload,text:'请开始另一条可取消的模拟任务'});
    await until(()=>plugin().message==='实时连接就绪'&&composer()?.stopAction?.enabled,'stop action');
    const cancel=composer().stopAction.payload;
    await host.execute(id,'requestCancel',cancel);await host.execute(id,'confirmCancel',cancel);
    await until(async()=>(await host.storage.get(id,'state'))?.outbox.some(r=>r.op==='message.send'&&r.outcome==='cancelled'),'cancelled receipt',12000);
    check('confirmed stop sends a DSH activity cancellation and observes its real terminal event');
    await host.setSettings({plugins:{[id]:{enabled:false}}});await until(()=>!service.jobs.has(id),'revocation cleanup');
    assert.equal(service.listeners.has(id),false);assert.ok((await connections.read(id)).token===bridge.token);
    await host.setSettings({plugins:{[id]:{enabled:true}}});assert.equal(plugin().runtime,'active');assert.equal(service.jobs.has(id),false);
    assert.equal((await host.storage.get(id,'state')).persona.memory,'偏好中文');
    check('disable and reenable release network and subscriptions while preserving data without auto sending');
    await packages.uninstall(id,host);assert.equal(service.listeners.has(id),false);
    check('uninstall releases the sandbox and leaves DSH session ownership intact');
    assert.equal(bridge.harness.ctx.agents.get(bridge.session.id),bridge.agent);
  }catch(error){errorResult=String(error.stack??error);console.error('DSH PET SANDBOX FAIL',error);process.exitCode=1;}
  finally{
    await writeFile(path.join(directory,'checks.json'),JSON.stringify({ok:!errorResult,checks,error:errorResult,scope:'Real Electron + real bridge HTTP/SSE + fake Harness; no user DSH or paid model'},null,2));
    settings?.destroy();view?.destroy();await host?.stop();service?.stop();await bridge?.stop();clearTimeout(watchdog);app.exit(process.exitCode??0);
  }
});
