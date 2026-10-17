import {app,protocol,BrowserWindow,ipcMain} from 'electron';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SANDBOX_SCHEME,createSandboxProvider} from '../electron/plugins/sandbox-runtime.mjs';
import {PluginPackages} from '../electron/plugins/packages.mjs';
import {ExtensionService} from '../electron/extensions/extension-service.mjs';
import {createTestOptions} from './plugin-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),directory=path.join(root,'.local/hello-counter-validation');
app.disableHardwareAcceleration();
await mkdir(directory,{recursive:true});
const userData=await mkdtemp(path.join(directory,'profile-'));app.setPath('userData',userData);
protocol.registerSchemesAsPrivileged([SANDBOX_SCHEME]);app.on('window-all-closed',()=>{});
const timeout=setTimeout(()=>{console.error('Counter sandbox watchdog expired');app.exit(1);},45000);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await delay(75);}throw new Error('Counter test timeout: '+label);}

void app.whenReady().then(async()=>{
  let host,view;const checks=[],check=name=>{checks.push(name);console.log('PASS',name);};
  try{
    host=new ExtensionService({directory:'.',userData,...createTestOptions(),onUpdate:state=>{if(view&&!view.isDestroyed())view.webContents.send('extensions:state',state);}});
    const packages=new PluginPackages({userData,makeProvider:bundle=>createSandboxProvider({root:process.env.PLUGIN_SANDBOX_RUNTIME_ROOT||root,bundle})});
    await host.start();await packages.install(await packages.inspect(path.join(root,'release/plugins/Hello-Counter-v1.0.0.zip')),host);
    const id='com.example.hello-counter',record=()=>host.snapshot().plugins.find(p=>p.id===id);
    assert.equal(record().runtime,'active');assert.deepEqual(record().grantedPermissions,[]);check('release ZIP activates in the real zero-permission sandbox');
    view=new BrowserWindow({show:false,width:380,height:580,frame:false,transparent:true,webPreferences:{preload:path.join(root,'electron/extensions/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
    const sender=event=>assert.equal(event.sender,view.webContents);
    ipcMain.handle('extensions:snapshot',event=>{sender(event);return host.snapshot();});
    ipcMain.handle('extensions:execute',(event,plugin,command,payload)=>{sender(event);return host.execute(plugin,command,payload);});
    ipcMain.handle('extensions:acknowledge',(event,plugin,items)=>{sender(event);return host.acknowledge(plugin,items);});
    ipcMain.handle('extensions:resize',(event,width,height)=>{sender(event);return {width,height};});
    ipcMain.on('extensions:regions',()=>{});ipcMain.on('extensions:pinned',()=>{});
    await host.setSettings({global:{cardWidth:320,cardHeight:300,reducedMotion:true}});
    await view.loadFile(path.join(root,'dist/extensions.html'));view.setOpacity(0);view.showInactive();
    const js=code=>view.webContents.executeJavaScript(code);
    await until(()=>js(`!!document.querySelector('[data-module="${id}"]')`),'menu');view.webContents.send('extensions:hover',true);
    await js(`document.querySelector('[data-module="${id}"]').click()`);
    await until(()=>js("document.querySelector('#card-body').textContent.includes('你已经点击了 0 次。')"),'initial count');
    await js("document.querySelector('[data-command=increment]').click()");
    await until(()=>js("document.querySelector('#card-body').textContent.includes('你已经点击了 1 次。')"),'increment');check('common menu button routes through IPC and refreshes the page');
    await delay(150);
    await writeFile(path.join(directory,'counter.png'),(await view.webContents.capturePage()).toPNG());
    await js("document.querySelector('[data-command=reset]').click()");
    await until(()=>js("document.querySelector('#card-body').textContent.includes('你已经点击了 0 次。')"),'reset');check('reset button updates the rendered text');
    await host.setSettings({plugins:{[id]:{enabled:false}}});assert.equal(record().runtime,'disabled');
    await until(()=>js(`!document.querySelector('[data-module="${id}"]')`),'disabled menu');
    await host.setSettings({plugins:{[id]:{enabled:true}}});assert.equal(record().runtime,'active');assert.equal(record().pages[0].blocks[0].text,'你已经点击了 0 次。');check('disable removes the menu and reenable starts with zero');
    await packages.uninstall(id,host);assert.equal(record(),undefined);check('external demo uninstalls without affecting builtins');
    await writeFile(path.join(directory,'results.json'),JSON.stringify({ok:true,checks},null,2));
  }catch(error){console.error(error);process.exitCode=1;}
  finally{if(view&&!view.isDestroyed())view.destroy();await host?.stop();clearTimeout(timeout);app.exit(process.exitCode??0);}
});
