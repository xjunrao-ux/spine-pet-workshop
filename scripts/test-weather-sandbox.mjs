import {app,protocol,BrowserWindow,ipcMain} from 'electron';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SANDBOX_SCHEME,createSandboxProvider} from '../electron/plugins/sandbox-runtime.mjs';
import {PluginPackages,inspectPluginZip} from '../electron/plugins/packages.mjs';
import {createZip} from '../electron/plugins/zip.mjs';
import {ExtensionService} from '../electron/extensions/extension-service.mjs';
import {createTestOptions} from './plugin-fixture.mjs';
import {fakeWeatherAdapter,rawWeather,city} from './weather-fixture.mjs';
import {WeatherAdapter} from '../electron/plugins/weather-adapter.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(root,'.local','weather-validation');await mkdir(directory,{recursive:true});
const userData=await mkdtemp(path.join(directory,'profile-'));app.setPath('userData',userData);protocol.registerSchemesAsPrivileged([SANDBOX_SCHEME]);app.on('window-all-closed',()=>{});
const timeout=setTimeout(()=>{console.error('Weather sandbox watchdog expired');app.exit(1);},60000);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function capture(view,file){
  const rect=await view.webContents.executeJavaScript("(()=>{const boxes=[...document.querySelectorAll('#feature-card,#capsule')].filter(e=>!e.classList.contains('hidden')).map(e=>e.getBoundingClientRect());const x=Math.max(0,Math.floor(Math.min(...boxes.map(r=>r.left))-2)),y=Math.max(0,Math.floor(Math.min(...boxes.map(r=>r.top))-2));return {x,y,width:Math.ceil(Math.max(...boxes.map(r=>r.right))+2-x),height:Math.ceil(Math.max(...boxes.map(r=>r.bottom))+2-y)}})()");
  await writeFile(path.join(directory,file),(await view.webContents.capturePage(rect)).toPNG());
}
async function until(fn,label) {for(let i=0;i<100;i++){if(await fn())return;await delay(100);}throw new Error('Weather test timeout: '+label);}
void app.whenReady().then(async()=>{let host,view;
const checks=[],check=name=>{checks.push(name);console.log('PASS',name);};
try {
  const options=createTestOptions();options.broker.weather=new WeatherAdapter({fetchImpl:async url=>{
    if(url.hostname.startsWith('geocoding'))return new Response(JSON.stringify({results:[{...city,id:123,admin1:city.region}]}),{headers:{'content-type':'application/json'}});
    const raw=rawWeather();
    for(const [key,values] of Object.entries(raw.hourly))raw.hourly[key]=Array.from({length:24},(_,i)=>key==='time'?values[0]+i*3600:values[i%values.length]);
    for(const [key,values] of Object.entries(raw.daily))raw.daily[key]=Array.from({length:7},(_,i)=>key==='time'?values[0]+i*86400:values[i%values.length]);
    return new Response(JSON.stringify(raw),{headers:{'content-type':'application/json'}});
  }});
  host=new ExtensionService({directory:'.',userData,...options,onUpdate:state=>{if(view && !view.isDestroyed())view.webContents.send('extensions:state',state);}});
  const packages=new PluginPackages({userData,makeProvider:bundle=>createSandboxProvider({root:process.env.PLUGIN_SANDBOX_RUNTIME_ROOT||root,bundle})});await host.start();
  await packages.install(await packages.inspect(path.join(root,'release/plugins/Weather-Plugin-v1.1.0.zip')),host);
  const builtinIds=[...host.records.values()].filter(r=>r.origin==='builtin').map(r=>r.manifest.id);
  const weather=()=>host.records.get('local.spine-weather');assert.equal(weather().runtime,'active');assert.equal(weather().snapshot.preferredPageId,'location');check('weather ZIP activates in the actual sandbox with existing builtins active');
  view=new BrowserWindow({show:false,width:380,height:630,frame:false,transparent:true,webPreferences:{preload:path.join(root,'electron/extensions/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  const sender=event=>assert.equal(event.sender,view.webContents);
  ipcMain.handle('extensions:snapshot',event=>{sender(event);return host.snapshot();});
  ipcMain.handle('extensions:execute',(event,id,command,payload)=>{sender(event);return host.execute(id,command,payload);});
  ipcMain.handle('extensions:acknowledge',(event,id,items)=>{sender(event);return host.acknowledge(id,items);});
  ipcMain.handle('extensions:resize',(event,width,height)=>{sender(event);return {width,height};});
  ipcMain.on('extensions:regions',()=>{});ipcMain.on('extensions:pinned',()=>{});
  await host.setSettings({global:{cardWidth:320,cardHeight:420,reducedMotion:true}});
  await view.loadFile(path.join(root,'dist/extensions.html'));view.setOpacity(0);view.showInactive();
  const js=code=>view.webContents.executeJavaScript(code);
  await until(()=>js("!!document.querySelector('[data-module=\"local.spine-weather\"]')"),'menu');view.webContents.send('extensions:hover',true);
  await js("document.querySelector('[data-module=\"local.spine-weather\"]').click()");
  await until(()=>js("document.querySelector('.card-heading strong').textContent==='城市设置'"),'initial location page');
  await js("{const input=document.querySelector('[data-form-id=city-search] [name=name]');input.focus();input.value='上海';}");await weather().instance.onSettingsChanged();await delay(120);assert.equal(await js("document.querySelector('[data-form-id=city-search] [name=name]').value"),'上海');
  await js("document.querySelector('[data-form-id=city-search]').requestSubmit()");await until(()=>js("!!document.querySelector('[data-command=selectCity]')"),'search results');check('generic weather form preserves drafts and searches cities through sandbox RPC');await delay(200);await capture(view,'weather-location.png');
  await js("document.querySelector('[data-command=selectCity]').click()");await until(()=>weather().snapshot.status==='ready','forecast');await until(()=>js("document.querySelector('.card-heading strong').textContent==='当前天气' && document.querySelector('#card-body').textContent.includes('22.0 ℃')"),'current UI');
  assert.equal(await js("document.querySelectorAll('[data-command-form]').length"),2);
  await delay(200);await capture(view,'weather-current.png');check('current weather, hourly and daily lists render through the existing common menu');
  await js("document.querySelector('[data-page-step=\"1\"]').click()");await until(()=>js("document.querySelector('.card-heading strong').textContent==='未来 24 小时'"),'hourly button');
  await js("{const content=document.querySelector('[data-page=hourly] .page-content');content.scrollTop=content.scrollHeight;content.dispatchEvent(new WheelEvent('wheel',{deltaY:1000,bubbles:true,cancelable:true}));}");await delay(200);
  assert.equal(await js("document.querySelector('#page-counter').textContent"),'2 / 4');assert.equal(await js("document.querySelector('#card-body').scrollTop"),0);check('wheel at the bottom of long weather content keeps the same page');
  await js("document.querySelector('[data-page-step=\"1\"]').click()");await until(()=>js("document.querySelector('.card-heading strong').textContent==='7 天天气预报'"),'daily button');
  await capture(view,'weather-forecast.png');
  const result=await host.execute('local.spine-weather','setCoordinates',{name:'北京',latitude:'39.9',longitude:'116.4'});assert.equal(result.ok,true);await until(()=>weather().snapshot.status==='ready','Beijing weather');
  assert.equal(weather().snapshot.pages[1].subtitle,'北京');assert.equal(weather().snapshot.pages[2].subtitle,'北京');assert.equal((await host.storage.get('local.spine-weather','state')).weather.timezone,'Asia/Shanghai');
  await js("document.querySelector('[data-page-step=\"-1\"]').click()");await until(()=>js("document.querySelector('.card-heading strong').textContent==='未来 24 小时'"),'previous weather');
  assert.equal(await js("document.querySelector('#card-mode').textContent"),'北京 · 已固定');await js("document.querySelector('[data-page-step=\"1\"]').click()");await delay(150);await capture(view,'weather-forecast.png');
  assert.equal(await js("document.querySelector('[data-module=\"local.spine-weather\"] svg').innerHTML.includes('a5 5')"),true);check('weather subtitle follows selected Beijing even in Asia/Shanghai timezone, with a cloud icon');

  // Exercise builtin Todo through the same renderer, including the declarative context menu.
  await js("document.querySelector('[data-module=\"example.todo\"]').click()");await js("document.querySelector('[data-command=cancelEdit]').click()");await until(()=>js("document.querySelector('.card-heading strong').textContent==='新增待办'"),'Todo compose');
  await js("{const form=document.querySelector('[data-form-id=add-task]');form.querySelector('[name=title]').value='右键操作待办';form.querySelector('[name=notes]').value='只在右侧显示完成按钮';form.requestSubmit();}");await until(()=>js("document.querySelector('.card-heading strong').textContent==='待办事项' && !!document.querySelector('[data-context-actions]')"),'Todo add');
  assert.deepEqual(await js("[...document.querySelector('[data-page=pending] .plugin-item-actions').querySelectorAll('[data-command]')].map(b=>b.dataset.command)"),['complete']);
  assert.equal(await js("document.querySelector('[data-page=pending] [data-command=edit]')===null"),true);assert.equal(await js("document.querySelector('[data-page=pending] [data-command=delete]')===null"),true);
  await js("{const item=document.querySelector('[data-page=pending] [data-context-actions]'),r=item.getBoundingClientRect();item.dispatchEvent(new MouseEvent('contextmenu',{clientX:r.right-10,clientY:r.bottom-10,bubbles:true,cancelable:true}));}");
  await until(()=>js("!!document.querySelector('[role=menu]')"),'Todo context menu');await delay(200);assert.equal(await js("!!document.querySelector('[role=menu]')"),true);await capture(view,'todo-context-menu.png');
  const menuBounds=await js("(()=>{const menu=document.querySelector('[role=menu]').getBoundingClientRect(),card=document.querySelector('#feature-card').getBoundingClientRect();return {left:menu.left,top:menu.top,right:menu.right,bottom:menu.bottom,cardLeft:card.left,cardTop:card.top,cardRight:card.right,cardBottom:card.bottom}})()");assert.ok(menuBounds.left>=menuBounds.cardLeft && menuBounds.right<=menuBounds.cardRight && menuBounds.top>=menuBounds.cardTop && menuBounds.bottom<=menuBounds.cardBottom);
  await js("document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");assert.equal(await js("document.querySelector('[role=menu]')===null"),true);assert.equal(await js("document.querySelector('#feature-card').classList.contains('hidden')"),false);
  await js("{const item=document.querySelector('[data-page=pending] [data-context-actions]');item.focus();item.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));}");
  await js("document.querySelector('[role=menu] [data-command=edit]').click()");await until(()=>js("document.querySelector('.card-heading strong').textContent==='编辑待办'"),'Todo context edit');
  assert.equal(await js("document.querySelector('[data-command-form] [name=title]').value"),'右键操作待办');
  await js("{const form=document.querySelector('[data-command-form=save]');form.querySelector('[name=title]').value='已修改的待办';form.requestSubmit();}");await until(()=>js("document.querySelector('.card-heading strong').textContent==='待办事项'"),'Todo save');check('Todo has only completion on the right; context-menu edit loads the correct item and saves');
  await js("document.querySelector('[data-page=pending] [data-command=complete]').click()");await until(()=>host.records.get('example.todo').snapshot.pages[1].subtitle.startsWith('1 项'),'Todo complete');
  await js("document.querySelector('[data-page-step=\"1\"]').click()");await until(()=>js("document.querySelector('.card-heading strong').textContent==='已完成'"),'Todo completed page');
  assert.deepEqual(await js("[...document.querySelector('[data-page=completed] .plugin-item-actions').querySelectorAll('[data-command]')].map(b=>b.dataset.command)"),['reopen']);
  await js("document.querySelector('[data-page=completed] [data-command=reopen]').click()");await until(()=>host.records.get('example.todo').snapshot.pages[0].subtitle.startsWith('1 项'),'Todo reopen');
  await js("document.querySelector('[data-page-step=\"-1\"]').click()");await until(()=>js("document.querySelector('.card-heading strong').textContent==='待办事项'"),'Todo pending');
  await js("{const item=document.querySelector('[data-page=pending] [data-context-actions]');item.focus();item.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));}");await until(()=>js("!!document.querySelector('[role=menu]')"),'keyboard context');
  await js("document.querySelector('[role=menu] [data-command=delete]').click()");await until(()=>host.records.get('example.todo').snapshot.pages[0].subtitle.startsWith('0 项'),'Todo delete');
  await js("document.querySelector('[data-page=pending] [data-command=undoDelete]').click()");await until(()=>host.records.get('example.todo').snapshot.pages[0].subtitle.startsWith('1 项'),'Undo deletion');check('completion/retraction, keyboard context delete and undo retain the task');
  await js("{const content=document.querySelector('[data-page=pending] .page-content');content.dispatchEvent(new WheelEvent('wheel',{deltaY:1000,bubbles:true,cancelable:true}));}");await delay(200);assert.equal(await js("document.querySelector('#page-counter').textContent"),'1 / 3');
  await js("document.querySelector('[data-page-step=\"-1\"]').click()");assert.equal(await js("document.querySelector('#page-counter').textContent"),'1 / 3');
  await js("document.querySelector('[data-page-step=\"1\"]').click();document.querySelector('[data-page-step=\"1\"]').click()");await until(()=>js("document.querySelector('#page-counter').textContent==='3 / 3'"),'Todo last page');
  assert.equal(await js("document.querySelector('[data-page-step=\"1\"]').disabled"),true);
  await js("{const input=document.querySelector('[data-page=compose] [name=title]');input.focus();input.value='翻页后保留的草稿';input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));}");assert.equal(await js("document.querySelector('#page-counter').textContent"),'3 / 3');
  await js("document.querySelector('[data-page-step=\"-1\"]').click();document.querySelector('[data-page-step=\"1\"]').click()");assert.equal(await js("document.querySelector('[data-page=compose] [name=title]').value"),'翻页后保留的草稿');
  check('Todo arrows respect page bounds and keep drafts; wheel and input arrow keys never turn pages');
  await js("document.querySelector('[data-page-step=\"-1\"]').click();document.querySelector('[data-page-step=\"-1\"]').click()");await delay(200);await capture(view,'todo-pending.png');
  const manifest=JSON.parse(await readFile(path.join(root,'examples/weather-plugin/plugin.json'),'utf8'));
  const probeManifest={...manifest,id:'test.weather-probe',permissions:[],settingsSchema:[],commands:[{id:'probe',fields:{}}]};
  const code='export function activate(c){return {getSnapshot:()=>({available:true,status:"ready",pages:[]}),async execute(){let direct=false,denied=false;try{await fetch("https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0")}catch{direct=true}try{await c.weather.forecast({latitude:0,longitude:0})}catch{denied=true}return {direct,denied}},dispose(){}}}';
  await packages.install(inspectPluginZip(createZip({'plugin.json':JSON.stringify(probeManifest),'provider.js':code})),host);const probe=await host.execute(probeManifest.id,'probe');assert.equal(probe.ok,true);assert.deepEqual(probe.data,{direct:true,denied:true});check('direct plugin fetch stays blocked and weather RPC without permission is denied');
  const cached=await host.storage.get(manifest.id,'state');await host.setSettings({plugins:{[manifest.id]:{enabled:false}}});assert.equal(weather().runtime,'disabled');await host.setSettings({plugins:{[manifest.id]:{enabled:true}}});assert.equal(weather().runtime,'active');assert.equal(weather().snapshot.status,'ready');check('disable/re-enable restores the stored weather and stops the previous worker');
  await packages.uninstall(manifest.id,host);await packages.install(await packages.inspect(path.join(root,'release/plugins/Weather-Plugin-v1.1.0.zip')),host);assert.deepEqual(await host.storage.get(manifest.id,'state'),cached);assert.equal(weather().runtime,'active');
  for(const id of builtinIds) assert.equal(host.records.get(id).runtime,'active',id);check('reinstall preserves weather and all existing builtins continue running');
  await writeFile(path.join(directory,'results.json'),JSON.stringify({ok:true,checks,userData,screenshots:['weather-current.png','weather-forecast.png','weather-location.png','todo-context-menu.png','todo-pending.png']},null,2));
} catch(error) {console.error(error);process.exitCode=1;await writeFile(path.join(directory,'results.json'),JSON.stringify({ok:false,error:error.stack,checks},null,2));}
finally {if(view && !view.isDestroyed()) view.destroy();await host?.stop();clearTimeout(timeout);app.exit(process.exitCode??0);}

});
