// Captures final documentation from real UI with an isolated profile and local model.
import {app,BrowserWindow,dialog} from 'electron';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('.'),output=path.join(root,'docs/images'),local=path.join(root,'.local/v5.1.2-docs');
await mkdir(local,{recursive:true});await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(local,'profile-'));process.env.PET_TEST_PROFILE=profile;
for(const key of ['VITE_DEV_SERVER_URL','V311_SMOKE_DIR','SETTINGS_CAPTURE_PATH','PET_CAPTURE_PATH','PET_CAPTURE_SERIES_DIR'])delete process.env[key];
await writeFile(path.join(profile,'feature-settings.json'),JSON.stringify({schemaVersion:2,global:{theme:'graphite'},plugins:{'workshop.music':{enabled:false,configVersion:1,config:{}},'workshop.notifications':{enabled:false,configVersion:1,config:{}}}}));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('mute-audio');app.on('browser-window-created',(_event,w)=>w.setOpacity(0));
let selection=path.join(root,'public/models/amiya');
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selection]});dialog.showMessageBox=async()=>({response:0});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<200;i++){if(await fn())return;await delay(60);}throw Error('Timeout: '+label);}
const watchdog=setTimeout(()=>app.exit(1),90000);await import('../electron/main.mjs');
void(async()=>{const captures=[];try{
 await until(()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/settings.html')&&!w.webContents.isLoading()),'manager');
 const manager=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/settings.html')),js=s=>manager.webContents.executeJavaScript(s);
 manager.setContentSize(1280,800);
 async function capture(name){await js('document.querySelector(".brand-header").style.transform="translateZ(0)"');await delay(240);await writeFile(path.join(output,name+'.png'),(await manager.webContents.capturePage()).resize({width:1440}).toPNG());captures.push(name);console.log('CAPTURE',name);}
 await js('document.querySelector("[data-page=import]").click();document.querySelector("#character-name").value="阿米娅 · 导入示例";document.querySelector("#choose-model-folder").click()');
 await until(()=>js('document.querySelector("#model-file").value.length>0'),'model selection');
 await js('document.querySelector("#import-form").requestSubmit()');
 await until(()=>js('document.querySelectorAll(".character-thumbnail").length===2'),'real portraits');
 await js('document.querySelector("[data-settings=builtin-amiya]").click()');
 await until(()=>js('!document.querySelector("#library-preview .preview-animations").disabled'),'inspector');
 await capture('v512-library');
 await js('document.querySelector(".drawer-content").scrollTop=270');await capture('v512-parameters');
 await js('document.querySelector("#close-character-settings").click();document.querySelector("[data-page=import]").click()');
 await js('document.querySelector("#import-status").textContent="准备就绪"');await capture('v512-materials');await js('document.querySelector("#import-guide").open=true');await capture('v512-materials-expanded');
 await js('document.querySelector("[data-page=features]").click()');await capture('v512-features');
 for(const file of ['Weather-Plugin-v1.2.0.zip','DeepSeek-Plugin-v1.1.0.zip','DSH-Pet-Plugin-v1.1.0.zip']){selection=path.join(root,'release/plugins',file);const result=await js('window.featureSettings.installPlugin()');assert.equal(result.ok,true);}
 await js('document.querySelector("[data-page=extensions]").click();[...document.querySelectorAll("[data-plugin-select]")].find(e=>e.dataset.pluginSelect==="io.spine-workshop.deepseek").click()');await capture('v512-plugins');
 await writeFile(path.join(local,'captures.json'),JSON.stringify({ok:true,version:'5.1.2',isolatedProfile:true,paidModelCalls:0,captures},null,2));
 clearTimeout(watchdog);app.exit(0);
}catch(error){console.error(error);clearTimeout(watchdog);app.exit(1);}})();
