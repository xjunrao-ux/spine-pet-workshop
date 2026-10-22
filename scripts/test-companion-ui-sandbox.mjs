import {applyCredentialTheme} from '../electron/plugins/window-theme.mjs';
import {createPetCompanionBridge} from '../electron/plugins/pet-companion-bridge.mjs';
import {app,protocol,BrowserWindow,ipcMain,safeStorage,nativeImage} from 'electron';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ExtensionService} from '../electron/extensions/extension-service.mjs';
import {createExtensionOverlay} from '../electron/extensions/overlay.mjs';
import {SANDBOX_SCHEME,createSandboxProvider} from '../electron/plugins/sandbox-runtime.mjs';
import {PluginPackages} from '../electron/plugins/packages.mjs';
import {DeepSeekCredentials,DeepSeekService} from '../electron/plugins/deepseek-service.mjs';
import {createDeepSeekDialog} from '../electron/plugins/deepseek-dialog.mjs';
import {LocalConnectionStore,LocalService} from '../electron/plugins/local-service.mjs';
import {createLocalServiceDialog} from '../electron/plugins/local-service-dialog.mjs';
import {createTestOptions,mediaFixture} from './plugin-fixture.mjs';
import {fakeWeatherAdapter} from './weather-fixture.mjs';
import {startBridge} from '../dsh-pet-bridge/test/helpers/bridge-host.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(root,'.local/v4.3.1-hotfix-validation');
await mkdir(directory,{recursive:true});const userData=await mkdtemp(path.join(directory,'profile-'));app.setPath('userData',userData);
app.disableHardwareAcceleration();protocol.registerSchemesAsPrivileged([SANDBOX_SCHEME]);
app.on('window-all-closed',()=>{});app.on('browser-window-created',(_event,w)=>w.setOpacity(0));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=10000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await delay(40);}throw Error('Timeout: '+label);}
const checks=[],check=name=>{checks.push(name);console.log('PASS',name);};
const watchdog=setTimeout(()=>{console.error('UI validation watchdog');app.exit(1);},90000);
void app.whenReady().then(async()=>{
 let host,overlay,pet,manager,bridge,deepseek,local,petBridge;let failure=null;
 const ai='io.spine-workshop.deepseek',dsh='io.spine-workshop.dsh-pet',weather='local.spine-weather';
 let modelCalls=0;
 try{
  const icon=nativeImage.createFromPath(path.join(root,'assets/spinepet-icon.png')),pixels=icon.toBitmap(),dimensions=icon.getSize();
  assert.ok(dimensions.width>=256&&dimensions.height>=256);
  for(const index of [0,dimensions.width-1,dimensions.width*(dimensions.height-1),dimensions.width*dimensions.height-1])assert.equal(pixels[index*4+3],0);
  let transparent=0,opaque=0;for(let at=3;at<pixels.length;at+=4){if(pixels[at]===0)transparent++;if(pixels[at]===255)opaque++;}assert.ok(transparent>dimensions.width*dimensions.height*.2);assert.ok(opaque>1000);
  const ico=await readFile(path.join(root,'assets/spinepet-icon.ico'));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
  check('SpinePet PNG and multi-size ICO preserve transparent backgrounds');
  bridge=await startBridge();
  const credentials=new DeepSeekCredentials({userData,encryption:safeStorage});
  await credentials.write(ai,'sk-ui-fixture-only');
  deepseek=new DeepSeekService({credentials,fetchImpl:async(url,options)=>{
   if(url.endsWith('/models'))return new Response('{"data":[]}');
   modelCalls++;const encoder=new TextEncoder();let timer;
   return new Response(new ReadableStream({start(controller){
    options.signal.addEventListener('abort',()=>{clearTimeout(timer);controller.error(new Error('fixture stopped'));},{once:true});
    controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'嗯，今天也辛苦啦。'},finish_reason:null}]})+'\n\n'));
    timer=setTimeout(()=>{controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'我们慢慢来。'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));controller.close();},650);
   },cancel(){clearTimeout(timer);}}),{headers:{'content-type':'text/event-stream'}});
  }});
  deepseek.openSettings=createDeepSeekDialog({root,credentials,service:deepseek,getTheme:()=>host?.settings});
  const connections=new LocalConnectionStore({userData,encryption:safeStorage});await connections.write(dsh,{endpoint:bridge.url,token:bridge.token});
  local=new LocalService({connections});local.openSettings=createLocalServiceDialog({root,service:local,getTheme:()=>host?.settings});
  const options=createTestOptions();options.broker.deepseek=deepseek;options.broker.localService=local;options.broker.weather=fakeWeatherAdapter();
  host=new ExtensionService({directory:'.',userData,...options,onUpdate:state=>{overlay?.update(state);petBridge?.update(state);for(const w of BrowserWindow.getAllWindows())if(/\/(?:deepseek|local-service)-settings\.html$/.test(w.webContents.getURL()))applyCredentialTheme(w,state.settings);if(manager&&!manager.isDestroyed())manager.webContents.send('features:state',state);}});
  await host.start();
  const packages=new PluginPackages({userData,makeProvider:bundle=>createSandboxProvider({root,bundle})});
  for(const file of ['DeepSeek-Plugin-v1.1.0.zip','DSH-Pet-Plugin-v1.1.0.zip','Weather-Plugin-v1.2.0.zip'])await packages.install(await packages.inspect(path.join(root,'release/plugins',file)),host);
  const plugin=id=>host.snapshot().plugins.find(p=>p.id===id);
  assert.ok([ai,dsh,weather].every(id=>plugin(id)?.runtime==='active'));
  assert.deepEqual(plugin(dsh).pages.map(p=>p.id),['chat','sessions']);
  assert.deepEqual(plugin(ai).pages.map(p=>p.id),['chat']);assert.equal(plugin(weather).pages.length,3);
  assert.equal(plugin(ai).settingsPages.length,2);assert.equal(plugin(dsh).settingsPages.length,2);assert.equal(plugin(weather).settingsPages.length,1);
  check('updated ZIPs activate in real Workers and separate manager configuration from pet surfaces');
  options.broker.windows.ingest({media:mediaFixture()});
  pet=new BrowserWindow({show:false,width:252,height:300,x:650,y:600,frame:false,transparent:true,webPreferences:{preload:path.join(root,'electron/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  ipcMain.handle('pet:get-character-config',()=>({id:'builtin-amiya',name:'阿米娅',builtin:true,modelUrl:'./models/amiya/build_char_002_amiya.skel',animations:{}}));
  petBridge=createPetCompanionBridge({service:host,getPet:()=>pet,openSettings:id=>{manager?.show();manager?.focus();manager?.webContents.send('features:navigate',id);},setInteraction:()=>{}});
  await pet.loadFile(path.join(root,'dist/index.html'));pet.showInactive();
  const pj=code=>pet.webContents.executeJavaScript(code);
  await until(()=>petBridge.window&&!petBridge.window.webContents.isLoading(),'composer loaded');
  const cv=petBridge.window,cj=code=>cv.webContents.executeJavaScript(code);
  await until(()=>pj("document.querySelector('#loading-status').classList.contains('hidden')"),'real Spine model loaded');
  // Native renderer input events hit the actual model, not a plugin/menu hover flag.
  for(let y=120;y<285;y+=25){pet.webContents.sendInputEvent({type:'mouseMove',x:126,y});await delay(40);if(await cj("!document.querySelector('#pet-chat').classList.contains('hidden')"))break;}
  await until(()=>cv.isVisible(),'character hover input');
  assert.equal(await cj("!document.querySelector('#pet-chat').classList.contains('hidden')"),true);
  assert.equal(await cj("document.querySelector('#pet-chat-hint').textContent"),'');
  assert.equal(modelCalls,0);check('real character hover opens its own composer before any menu exists');
  overlay=createExtensionOverlay({root,service:host,getPet:()=>pet,getDragging:()=>false,setInteraction:()=>{},openSettings:()=>manager?.showInactive(),testing:true});
  const view=overlay.window,js=code=>view.webContents.executeJavaScript(code);
  const pb=pet.getBounds();overlay.setTestCursor({x:pb.x+70,y:pb.y+50});
  await until(()=>view.webContents.getURL().includes('extensions.html')&&!view.webContents.isLoading(),'overlay loaded');
  await until(()=>js("!!document.querySelector('#capsule.visible')"),'automatic hover menu');
  assert.equal(await js("!!document.querySelector('#companion-input,#companion-reply')"),false);
  assert.equal(modelCalls,0);check('hovering the pet reveals the API companion input without requesting a model');
  const open=async id=>{await js("document.querySelector('[data-module="+JSON.stringify(id)+"]').click()");await delay(150);};
  await open('workshop.music');
  await until(()=>js("Math.round(document.querySelector('#feature-card').getBoundingClientRect().width)===282"),'compact music');
  await open(dsh);await until(()=>js("Math.round(document.querySelector('#feature-card').getBoundingClientRect().width)===420"),'larger DSH');
  assert.equal(await js("document.querySelector('[data-module=\"io.spine-workshop.dsh-pet\"] .deepseek-icon')!==null"),true);
  await host.execute(dsh,'connect');await until(()=>plugin(dsh).message==='请选择授权会话','DSH sessions');
  const select=plugin(dsh).pages[1].blocks.flatMap(b=>b.children??[]).find(b=>b.commandId==='selectSession'&&b.enabled);
  await host.execute(dsh,'selectSession',select.payload);await host.execute(dsh,'confirmSession',select.payload);await until(()=>plugin(dsh).message==='实时连接就绪','DSH ready');
  await until(()=>js("!!document.querySelector('.task-strip')"),'task ticker');
  assert.equal(await js("document.querySelector('.task-strip').getBoundingClientRect().height<=25"),true);
  assert.equal(await js("document.querySelectorAll('.feature-page').length"),2);
  await delay(220);
  await writeFile(path.join(directory,'dsh.png'),(await view.webContents.capturePage()).toPNG());
  await js("window.petFeatures.resize(460,520,true,'se','conversation')");
  await until(()=>host.settings.aiCardWidth===460,'AI size saved');assert.equal(host.settings.cardWidth,282);
  await open(weather);await until(()=>js("Math.round(document.querySelector('#feature-card').getBoundingClientRect().width)===282"),'weather stays compact');
  await open(dsh);await until(()=>js("Math.round(document.querySelector('#feature-card').getBoundingClientRect().width)===460"),'AI size restored');
  check('official whale icon, two DSH pages, inline task strip and independent AI panel sizes work');

  const before=view.getBounds(),relative=await js("(()=>{const a=document.querySelector('#feature-card').getBoundingClientRect(),b=document.querySelector('#capsule').getBoundingClientRect();return {x:a.x-b.x,y:a.y-b.y}})()");
  await js("window.petFeatures.move(0,0,'start');window.petFeatures.move(20,20,'move');window.petFeatures.move(20,20,'end')");
  await until(()=>view.getBounds().x!==before.x||view.getBounds().y!==before.y,'unified drag');
  const afterRelative=await js("(()=>{const a=document.querySelector('#feature-card').getBoundingClientRect(),b=document.querySelector('#capsule').getBoundingClientRect();return {x:a.x-b.x,y:a.y-b.y}})()");
  assert.deepEqual(afterRelative,relative);check('native dragging moves the panel and capsule as one clamped window');

  await host.execute('example.todo','add',{title:'整理今天的项目',notes:'把重要的事情记下来'});
  await host.execute('example.todo','add',{title:'给自己留一点休息时间'});
  const item=(await host.storage.get('example.todo','state')).items[0];await host.execute('example.todo','complete',{id:item.id});
  await open('example.todo');await until(()=>js("!!document.querySelector('.todo-row')"),'todo rows');
  assert.equal(await js("document.querySelectorAll('.plugin-tabs button').length"),2);
  assert.equal(await js("document.querySelector('.todo-progress').textContent.includes('1/2')"),true);
  assert.equal(await js("!!document.querySelector('.page-footer .todo-create')"),true);
  assert.equal(await js("document.querySelector('.todo-row').firstElementChild.classList.contains('todo-toggle')"),true);
  await delay(220);
  await writeFile(path.join(directory,'todo.png'),(await view.webContents.capturePage()).toPNG());
  await js("document.querySelector('[data-page=pending] .todo-actions [data-command=edit]').click()");
  await until(()=>js("!!document.querySelector('[data-page=compose]:not([aria-hidden=true])')"),'edit navigation');
  check('reference-inspired todo progress, category tabs, left checks, row actions and fixed add button work');

  manager=new BrowserWindow({show:false,width:1060,height:820,webPreferences:{preload:path.join(root,'electron/settings-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  ipcMain.handle('features:get',()=>host.snapshot());
  ipcMain.handle('features:set',async(_e,patch)=>({ok:true,snapshot:await host.setSettings(patch)}));
  ipcMain.handle('features:execute',(_e,id,command,payload)=>host.execute(id,command,payload,{source:'manager'}));
  ipcMain.handle('features:restart',(_e,id)=>host.restart(id));
  ipcMain.handle('settings:startup-get',()=>({supported:false,enabled:false,reason:'隔离测试'}));
  ipcMain.handle('settings:pet-status',()=>({name:'阿米娅',visible:pet.isVisible(),state:pet.isVisible()?'ready':'hidden',message:pet.isVisible()?'正常显示中':'桌宠已隐藏'}));
  ipcMain.handle('settings:list-characters',()=>[]);
  await manager.loadFile(path.join(root,'dist/settings.html'));manager.showInactive();
  const mj=code=>manager.webContents.executeJavaScript(code);
  async function nativeClick(window,selector,fraction=.5){
    const at=await window.webContents.executeJavaScript("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width*"+fraction+"),y:Math.round(r.y+r.height/2)}})()");
    window.webContents.sendInputEvent({type:'mouseMove',...at});
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...at});
    await delay(120);
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...at});
    await delay(80);
  }

  await until(()=>mj("!!document.querySelector('[data-plugin-select=\"local.spine-weather\"]')"),'manager settings');

  await mj("document.querySelector('[data-page=extensions]').click();window.weatherButtonBeforePoll=document.querySelector('[data-plugin-select=\"local.spine-weather\"]')");
  host.publish();await delay(70);
  assert.equal(await mj("window.weatherButtonBeforePoll===document.querySelector('[data-plugin-select=\"local.spine-weather\"]')"),true);
  manager.show();manager.focus();await until(()=>manager.isFocused(),'settings focus');
  const oldMessages=new Map([ai,weather].map(id=>[id,host.records.get(id).snapshot.message]));
  let generation=0;
  const polling=setInterval(()=>{for(const id of [ai,weather])host.records.get(id).snapshot.message='后台状态更新 '+(++generation);host.publish();},16);
  try{
    await nativeClick(manager,'[data-plugin-select="local.spine-weather"]');
    await until(()=>mj("document.querySelector('[data-plugin-scope]')?.dataset.pluginScope==='local.spine-weather'"),'native plugin selection during updates');
    await nativeClick(manager,'[data-plugin-select="io.spine-workshop.deepseek"]');
    await until(()=>mj("document.querySelector('[data-plugin-scope]')?.dataset.pluginScope==='io.spine-workshop.deepseek'"),'native AI selection during updates');
    await nativeClick(manager,'#companion-opacity',.3);
    await until(()=>host.settings.companionOpacity<50,'native opacity slider saves');
    await nativeClick(manager,'[data-plugin-config=model]');
    manager.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});manager.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});
    manager.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});manager.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    await until(()=>plugin(ai).config.model==='deepseek-v4-pro','native model dropdown saves');
  }finally{clearInterval(polling);for(const[id,message]of oldMessages)host.records.get(id).snapshot.message=message;host.publish();}
  await host.setSettings({global:{companionOpacity:86},plugins:{[ai]:{config:{model:'deepseek-flash'}}}});
  check('real mouse selection, opacity dragging and keyboard dropdown work while plugin states refresh');
  await mj("document.querySelector('[data-page=extensions]').click();document.querySelector('[data-plugin-select=\"local.spine-weather\"]').click()");
  await mj("{const form=document.querySelector('[data-plugin-scope=\"local.spine-weather\"] [data-command-form=searchCity]');form.querySelector('[name=name]').value='上海';form.requestSubmit();}");
  await until(()=>mj("!!document.querySelector('[data-plugin-scope=\"local.spine-weather\"] [data-command=selectCity]')"),'manager city result');
  await mj("document.querySelector('[data-plugin-scope=\"local.spine-weather\"] [data-command=selectCity]').click()");
  await until(()=>plugin(weather).pages[0].subtitle==='上海','manager city selection');
  await mj("document.querySelector('[data-plugin-select=\"io.spine-workshop.deepseek\"]').click()");
  await mj("{const form=document.querySelector('[data-plugin-scope=\"io.spine-workshop.deepseek\"] [data-command-form=savePersona]');form.querySelector('[name=persona]').value='温柔、简短地陪我聊天';form.querySelector('[name=memory]').value='喜欢中文和安静的晚上';form.requestSubmit();}");
  await until(async()=>(await host.storage.get(ai,'state'))?.memory==='喜欢中文和安静的晚上','manager persona');
  assert.equal(modelCalls,0);
  await nativeClick(manager,'[data-plugin-scope="io.spine-workshop.deepseek"] [data-command=configure]');
  await until(()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/deepseek-settings.html')),'manager API credentials');
  await until(()=>!cv.isVisible()&&!view.isVisible(),'floating controls yield to connection settings');
  BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/deepseek-settings.html')).close();
  await mj("document.querySelector('[data-plugin-select=\"io.spine-workshop.dsh-pet\"]').click();document.querySelector('.plugin-settings-detail').scrollIntoView()");
  await delay(220);
  await writeFile(path.join(directory,'manager.png'),(await manager.webContents.capturePage()).toPNG());
  check('manager forms can set weather city, edit AI persona/memory, and open trusted API settings');
  manager.hide();
  await pj("window.desktopPet.companion.hover(true)");
  await until(()=>cv.isVisible(),'composer returns after manager closes');
  cv.focus();await delay(100);
  const basePet=pet.getBounds(),samples=[];
  await cj("document.querySelector('#pet-chat-text').value='x'.repeat(1000)");
  for(let i=0;i<160;i++){
    pet.setBounds({...basePet,x:basePet.x+i%10*3,y:basePet.y+i%2});host.publish();await delay(40);
    const bounds=cv.getBounds();samples.push({width:bounds.width,height:bounds.height});
  }
  await writeFile(path.join(directory,'composer-size-regression.json'),JSON.stringify({samples,dpr:await cj('devicePixelRatio')},null,2));
  assert.ok(samples.every(size=>size.width<=344&&size.height<=80),JSON.stringify(samples));
  assert.ok(Math.max(...samples.map(s=>s.width))-Math.min(...samples.map(s=>s.width))<=2);
  assert.ok(Math.max(...samples.map(s=>s.height))-Math.min(...samples.map(s=>s.height))<=2);
  await cj("window.petCompanion.move(0,0,'start')");
  for(let i=0;i<30;i++){await cj("window.petCompanion.move("+i*2+",-"+i+",'move')");await delay(10);}
  await cj("window.petCompanion.move(60,-30,'end')");
  assert.ok(cv.getBounds().width<=344&&cv.getBounds().height<=80);
  await host.setSettings({global:{companionPosition:null}});pet.setBounds(basePet);
  await cj("document.querySelector('#pet-chat-text').value=''");
  check('composer dimensions stay bounded through sustained state updates, long drafts, pet movement and dragging');

  await nativeClick(cv,'#pet-chat-settings');
  await until(()=>manager.isFocused()&&!cv.isVisible()&&!view.isVisible(),'chat settings gear focuses usable manager');
  await until(()=>mj("document.querySelector('#page-extensions').classList.contains('active')&&document.querySelector('[data-plugin-scope]')?.dataset.pluginScope==='io.spine-workshop.deepseek'"),'gear selects AI settings');
  manager.hide();await pj("window.desktopPet.companion.hover(true)");await until(()=>cv.isVisible(),'return from settings gear');
  check('chat settings gear opens the AI panel and floating windows cannot cover it');

  assert.equal(await js("!!document.querySelector('[data-module=\"io.spine-workshop.deepseek\"]')"),false);
  await cj("{const input=document.querySelector('#pet-chat-text');input.focus();input.value='晚上好';input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('#pet-chat').requestSubmit();}");
  await delay(80);assert.equal(modelCalls,0);
  await cj("document.querySelector('#pet-chat-text').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));document.querySelector('#pet-chat').requestSubmit()");
  await until(()=>pj("!document.querySelector('#speech-bubble').classList.contains('hidden')&&document.querySelector('#speech-bubble').textContent.includes('辛苦啦')"),'original character speech bubble streams');
  await until(()=>!deepseek.jobs.has(ai),'AI finished');
  await delay(100);assert.equal(await js("document.querySelector('#event-toast').classList.contains('hidden')"),true);
  await cj("{const input=document.querySelector('#pet-chat-text');input.focus();input.value='下一句话的草稿';input.setSelectionRange(3,3);}");
  await host.setSettings({plugins:{[ai]:{config:{notify:false}}}});await delay(100);
  assert.equal(await cj("document.querySelector('#pet-chat-text').value"),'下一句话的草稿');assert.equal(await cj("document.querySelector('#pet-chat-text').selectionStart"),3);
  assert.equal(await pj("document.querySelector('#speech-bubble').textContent"),'嗯，今天也辛苦啦。我们慢慢来。');assert.equal(modelCalls,1);
  await delay(220);
  await writeFile(path.join(directory,'companion.png'),(await pet.webContents.capturePage()).toPNG());
  await writeFile(path.join(directory,'composer.png'),(await cv.webContents.capturePage()).toPNG());
  check('IME-safe chat streams through the original calibrated pet speech bubble and preserves drafts');

  manager.showInactive();
  await mj("document.querySelector('[data-page=features]').click();document.querySelector('[data-theme-choice=forest]').click()");
  await until(()=>host.settings.theme==='forest','theme saved');
  await until(()=>pj("document.documentElement.dataset.theme==='forest'"),'pet theme synchronized');
  await until(()=>js("document.documentElement.dataset.theme==='forest'"),'menu theme synchronized');
  assert.equal(await mj("document.querySelectorAll('.theme-preset').length"),6);
  await delay(220);
  await writeFile(path.join(directory,'themes.png'),(await manager.webContents.capturePage()).toPNG());
  await mj("document.querySelector('[data-theme-choice=graphite]').click()");
  await until(()=>host.settings.theme==='graphite','dark theme saved');
  await until(()=>mj("document.documentElement.dataset.theme==='graphite'"),'manager theme applied');
  await mj("document.querySelector('[data-page=extensions]').click();document.querySelector('[data-plugin-select=\"io.spine-workshop.deepseek\"]').click()");
  assert.equal(await mj("document.querySelector('.plugin-manager-section h4').getBoundingClientRect().height>20"),true);
  assert.equal(await mj("document.querySelector('.plugin-form textarea').getBoundingClientRect().height>=140"),true);
  await delay(220);
  await writeFile(path.join(directory,'manager-dark.png'),(await manager.webContents.capturePage()).toPNG());
  // Keep a trusted API settings dialog open across a palette change.
  await mj("document.querySelector('[data-plugin-scope=\"io.spine-workshop.deepseek\"] [data-command=configure]').click()");
  await until(()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/deepseek-settings.html')),'themed credentials window');
  const credentialsWindow=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/deepseek-settings.html'));
  await delay(500);
  await until(()=>credentialsWindow.webContents.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#aebdce'"),'credential selected theme');
  await host.setSettings({global:{theme:'forest'}});
  await until(()=>credentialsWindow.webContents.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#537f6e'"),'credential live theme');
  await delay(150);await writeFile(path.join(directory,'credentials.png'),(await credentialsWindow.webContents.capturePage()).toPNG());
  credentialsWindow.close();

  await mj("document.querySelector('[data-page=features]').click();document.querySelector('[data-theme-choice=custom]').click()");
  await until(()=>host.settings.theme==='custom','custom selected');
  await mj("{const i=document.querySelector('[data-custom-color=accent]');i.value='#40b8a8';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}");
  await until(()=>host.settings.customTheme.accent==='#40b8a8','custom accent saved');
  await until(()=>cj("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#40b8a8'"),'composer custom theme live');
  assert.equal(await mj("!!document.querySelector('[data-theme-choice=slate]')"),false);
  assert.equal(await mj("getComputedStyle(document.querySelector('.theme-swatch')).backgroundImage"),'none');
  assert.equal(await mj("getComputedStyle(document.querySelector('.theme-swatch')).backgroundColor"),'rgba(0, 0, 0, 0)');
  await delay(180);await writeFile(path.join(directory,'custom-theme.png'),(await manager.webContents.capturePage()).toPNG());
  await mj("document.querySelector('[data-page=extensions]').click();document.querySelector('[data-plugin-select=\"io.spine-workshop.deepseek\"]').click()");
  await mj("{const i=document.querySelector('#companion-opacity');i.value='35';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}");
  await until(()=>host.settings.companionOpacity===35,'opacity saved');
  await until(()=>cj("document.querySelector('#pet-chat').style.getPropertyValue('--chat-opacity')==='0.35'"),'opacity applied');
  assert.equal(await cj("getComputedStyle(document.querySelector('#pet-chat')).opacity"),'1');
  check('custom colors, clean palette icons and input opacity synchronize without model calls');

  await cj("document.querySelector('#pet-chat-text').focus()");
  const original=cv.getBounds();
  await cj("{const h=document.querySelector('#pet-chat-drag');h.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,screenX:100,screenY:100}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,screenX:180,screenY:45}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,screenX:180,screenY:45}));}");
  await until(()=>host.settings.companionPosition!==null,'drag persisted');
  assert.notDeepEqual(cv.getBounds(),original);
  assert.deepEqual(host.settings.companionPosition,{x:cv.getBounds().x,y:cv.getBounds().y});
  await mj("document.querySelector('[data-companion-reset]').click()");await until(()=>host.settings.companionPosition===null,'position reset');
  check('the input window moves independently across the desktop and can return to following the pet');

  assert.equal(await mj("document.querySelectorAll('[data-plugin-shift],.plugin-sort-buttons').length"),0);
  const beforeOrder=host.snapshot().plugins.map(p=>p.id),moving=beforeOrder.at(-1),target=beforeOrder[0];
  await mj("(()=>{const a=document.querySelector('[data-sort-plugin="+JSON.stringify(moving)+"]'),b=document.querySelector('[data-sort-plugin="+JSON.stringify(target)+"]'),d=new DataTransfer();a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:d}));const r=b.getBoundingClientRect();b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:d,clientY:r.y+1}));b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d,clientY:r.y+1}));})()");
  await until(()=>host.snapshot().plugins[0].id===moving,'drag order saved');
  assert.equal(host.settings.pluginOrder[0],moving);
  await until(async()=>await js("document.querySelector('#capsule-track button').dataset.module")===(moving===ai?beforeOrder[0]:moving),'capsule order synchronized');
  assert.equal(modelCalls,1);
  check('dragging a plugin card persists its order and updates the function menu without model calls');

  pet.setContentSize(126,150);await delay(180);await cj("document.querySelector('#pet-chat-text').focus()");
  assert.equal(await cj("document.querySelector('#pet-chat-text').getBoundingClientRect().width>75"),true);
  pet.setContentSize(252,300);await delay(100);
  check('the composer stays usable at the minimum pet size');
  const foreign=new BrowserWindow({show:false,webPreferences:{preload:path.join(root,'electron/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await foreign.loadURL('data:text/html,<body></body>');
  assert.equal(await foreign.webContents.executeJavaScript("window.desktopPet.companion.get().then(()=>false,()=>true)"),true);foreign.destroy();
  check('a second renderer cannot use the pet chat IPC');

  await cj("{const i=document.querySelector('#pet-chat-text');i.focus();i.value='再聊一句';document.querySelector('#pet-chat').requestSubmit();}");
  await until(()=>cj("!document.querySelector('#pet-chat-stop').classList.contains('hidden')&&!document.querySelector('#pet-chat-stop').disabled"),'stop button');
  await cj("document.querySelector('#pet-chat-stop').click()");
  await until(()=>!deepseek.jobs.has(ai),'stop generation');
  assert.equal(modelCalls,2);check('the character composer can stop an active reply');

  await host.setSettings({plugins:{[ai]:{enabled:false}}});
  await until(async()=>!cv.isVisible()&&await pj("document.querySelector('#speech-bubble').classList.contains('hidden')"),'chat disabled cleanup');
  await host.setSettings({plugins:{[ai]:{enabled:true}}});await delay(200);assert.equal(modelCalls,2);
  assert.equal(await pj("document.querySelector('#speech-bubble').classList.contains('hidden')"),true);
  host.locked=true;host.publish();await delay(100);assert.equal(cv.isVisible(),false);
  host.locked=false;host.publish();
  check('disable, reenable and screen lock clear chat surfaces without replaying old replies');

 }catch(error){failure=String(error.stack??error);console.error('UI REFRESH FAIL',error);process.exitCode=1;}
 finally{
  await delay(220);
  await writeFile(path.join(directory,'checks.json'),JSON.stringify({ok:!failure,checks,error:failure,scope:'Real Electron overlays and Worker ZIPs; fake model/weather/Harness only'},null,2));
  manager?.destroy();overlay?.stop();petBridge?.stop();pet?.destroy();await host?.stop();deepseek?.stop();local?.stop();await bridge?.stop();clearTimeout(watchdog);app.exit(process.exitCode??0);
 }
});
