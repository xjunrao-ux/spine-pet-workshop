import {app,BrowserWindow,dialog} from 'electron';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';import assert from 'node:assert/strict';
const directory=path.resolve('.local/v4.3.1-main-smoke');await mkdir(directory,{recursive:true});
const profile=await mkdtemp(path.join(directory,'profile-'));app.setPath('userData',profile);process.env.PET_TEST_PROFILE=profile;
delete process.env.VITE_DEV_SERVER_URL;
await writeFile(path.join(profile,'feature-settings.json'),JSON.stringify({schemaVersion:2,global:{theme:'graphite'},plugins:{'workshop.music':{enabled:false,configVersion:1,config:{}},'workshop.notifications':{enabled:false,configVersion:1,config:{}}}}));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('mute-audio');
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.resolve('release/plugins/DeepSeek-Plugin-v1.1.1.zip')]});
dialog.showMessageBox=async()=>({response:0});
app.on('browser-window-created',(_e,w)=>w.setOpacity(0));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let n=0;n<150;n++){if(await fn())return;await delay(60);}throw Error('Timeout: '+label);}
const watchdog=setTimeout(()=>app.exit(1),45000);
await import('../electron/main.mjs');
void (async()=>{let error=null;const checks=[];
try{
 await until(()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/settings.html')&&!w.webContents.isLoading()),'real manager');
 const manager=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/settings.html')),pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));
 const mj=s=>manager.webContents.executeJavaScript(s),pj=s=>pet.webContents.executeJavaScript(s);
 assert.equal(app.getName(),'SpinePet');assert.equal(app.getPath('userData'),profile);
 await until(()=>pj("document.documentElement.dataset.theme==='graphite'"),'saved theme sent to real pet');
 assert.equal((await pj('window.desktopPet.companion.get()')).companion,null);checks.push('real main bootstrap exposes bounded companion IPC and restores theme');
 const installed=await mj('window.featureSettings.installPlugin()');assert.equal(installed.ok,true);
 await until(async()=>(await pj('window.desktopPet.companion.get()')).companion?.id==='io.spine-workshop.deepseek','installed AI companion');
 await until(()=>pj("document.querySelector('#loading-status').classList.contains('hidden')"),'real model loaded');
 await until(()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/companion.html')&&!w.webContents.isLoading()),'composer loaded');
 const composer=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/companion.html')),cj=s=>composer.webContents.executeJavaScript(s);
 for(let y=70;y<290;y+=20){pet.webContents.sendInputEvent({type:'mouseMove',x:126,y});await delay(30);if(await cj("!document.querySelector('#pet-chat').classList.contains('hidden')"))break;}
 assert.equal(await cj("!document.querySelector('#pet-chat').classList.contains('hidden')"),true);checks.push('actual app installs ZIP and opens the character composer on native model hover');
 await mj("window.featureSettings.set({global:{theme:'forest',pluginOrder:['io.spine-workshop.deepseek','example.todo','workshop.music','workshop.notifications']}})");
 await until(()=>pj("document.documentElement.dataset.theme==='forest'"),'theme synchronized through real bootstrap');
 const value=await mj('window.featureSettings.get()');assert.equal(value.plugins[0].id,'io.spine-workshop.deepseek');checks.push('actual manager settings persist and update pet theme and plugin order');
 await mj("window.featureSettings.set({plugins:{'io.spine-workshop.deepseek':{enabled:false}}})");await until(()=>!composer.isVisible(),'disabled cleanup');
}catch(e){error=String(e.stack??e);console.error(error);}
finally{await writeFile(path.join(directory,'checks.json'),JSON.stringify({ok:!error,checks,error},null,2));console.log('MAIN SMOKE',error?'FAIL':'PASS',checks.length);clearTimeout(watchdog);app.exit(error?1:0);}
})();
