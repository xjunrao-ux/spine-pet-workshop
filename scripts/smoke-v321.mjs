import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaFixture } from './plugin-fixture.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const waitFor=async(predicate,label)=>{for(let i=0;i<100;i++){if(await predicate()) return;await delay(100);}throw new Error('UI did not become ready: '+label);};
export async function runSmoke({app,mainWindow,overlay,service,createSettingsWindow,getSettingsWindow}) {
  const directory=path.resolve(process.env.V321_SMOKE_DIR??process.env.V311_SMOKE_DIR);await mkdir(directory,{recursive:true});
  const checks=[],js=code=>overlay.window.webContents.executeJavaScript(code),outside={x:-10000,y:-10000};
  const windows=service.broker.windows;
  const capture=async(name,window=overlay.window)=>{await delay(220);await writeFile(path.join(directory,name+'.png'),(await window.webContents.capturePage()).toPNG());};
  const enter=async()=>{overlay.setTestCursor(outside);await delay(650);const p=mainWindow.getBounds();overlay.setTestCursor({x:p.x+p.width/2,y:p.y+p.height/2});await waitFor(()=>overlay.inspect().hovered,'hover');await delay(240);};
  const open=async id=>{await js('document.querySelector('+JSON.stringify('[data-module="'+id+'"]')+').click()');await delay(120);};
  const check=name=>{checks.push({name,passed:true});console.log('PASS',name);};
  try {
    overlay.setTestCursor(outside);await waitFor(()=>!overlay.window.webContents.isLoading(),'overlay');await delay(1200);
    getSettingsWindow()?.close();
    const cover='data:image/png;base64,'+(await readFile(path.join(process.cwd(),'assets','amiya-app-icon.png'))).toString('base64');
    const stamp=new Date(Date.now()+100).toISOString();
    const items=Array.from({length:10},(_,i)=>({id:'sample-'+i,app:i<5?'ChatGPT':'系统通知',appId:i<5?'gpt':'system',createdAt:stamp,title:'界面测试通知 '+(i+1),body:'这是一条用于验证滚动和来源标题吸顶的演示消息。'.repeat(15)}));
    windows.ingest({media:mediaFixture(cover),notifications:{permission:'Allowed',items},codexRunning:true});
    service.broker.codex.push({running:true,connected:true,allowed:true,updatedAt:stamp,primary:{remaining:82,minutes:300,resetsAt:new Date(Date.now()+7200000).toISOString()},secondary:{remaining:64,minutes:10080,resetsAt:new Date(Date.now()+172800000).toISOString()},tasks:Array.from({length:8},(_,i)=>({id:'task-'+i,name:'界面测试任务 '+(i+1),status:'idle',turnStatus:'completed',updatedAt:Date.now()/1000}))});
    await delay(120);await enter();assert.equal(overlay.window.getParentWindow(),mainWindow);
    assert.equal(await js("document.querySelectorAll('[data-module]').length"),4);check('registry creates fourth menu entry without a renderer branch');
    await js("window.savedEntry=document.querySelector('[data-module=\"workshop.music\"]')");service.publish();await delay(80);assert.ok(await js("window.savedEntry===document.querySelector('[data-module=\"workshop.music\"]')"));check('menu button identity survives refresh');
    await js("document.querySelector('[data-module=\"workshop.music\"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))");await delay(240);
    assert.equal(await js("document.querySelector('#feature-card').classList.contains('hidden')"),false);assert.equal(overlay.inspect().pinned,false);
    await open('workshop.music');assert.equal(overlay.inspect().pinned,true);assert.ok(await js("document.querySelector('.cover').naturalWidth>0"));await capture('music');check('hover previews, click pins, album asset renders');
    await js("document.querySelector('[data-module=\"workshop.notifications\"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))");await delay(230);assert.equal(await js("document.querySelector('.card-heading strong').textContent"),'QQ 音乐');check('hover does not replace a pinned panel');
    await js("document.querySelector('[data-page-step=\"1\"]').click()");await delay(150);
    assert.equal(await js("document.querySelector('#page-counter').textContent"),'2 / 2');assert.equal(await js("document.querySelectorAll('[data-position]')[1].textContent"),'--:--');check('arrow paging selects each player; NetEase has unknown timeline');
    for(const action of ['play','pause','toggle','next','previous']) {const result=await js('window.petFeatures.execute("workshop.music",'+JSON.stringify(action)+',{sessionId:"QQMusic.exe"})');assert.equal(result.ok,true);}
    assert.equal(windows.calls.filter(call=>call.method==='media').length,5);assert.equal((await js('window.petFeatures.execute("workshop.music","shell",{})')).error.code,'UNKNOWN_COMMAND');check('five media commands use validated generic IPC');
    await open('workshop.notifications');await capture('notifications');
    const metrics=await js("(()=>{const inner=document.querySelector('.page-content'),head=document.querySelector('.card-heading'),body=document.querySelector('#card-body');inner.scrollTop=90;return {y:head.getBoundingClientRect().y,inner:inner.scrollTop,outer:body.scrollTop}})()");
    assert.ok(metrics.inner>0);assert.equal(metrics.outer,0);assert.equal(await js("document.querySelector('.card-heading').getBoundingClientRect().y"),metrics.y);
    await js("{for(let i=0;i<4;i++)document.querySelector('[data-page-step=\"1\"]').click();}");await delay(120);
    await js("{const c=document.querySelectorAll('.page-content')[4];c.scrollTop=c.scrollHeight;c.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}));}");await delay(120);
    assert.equal(await js("document.querySelector('#page-counter').textContent"),'5 / 10');
    await js("document.querySelector('[data-page-step=\"1\"]').click()");await delay(120);
    assert.equal(await js("document.querySelector('.card-heading strong').textContent"),'系统通知');check('long content stays in its page; next arrow changes the sticky source heading');
    await open('workshop.codex');await capture('codex');await js("document.querySelector('[data-page-step=\"1\"]').click()");await delay(150);
    assert.equal(await js("document.querySelector('#page-counter').textContent"),'2 / 2');assert.equal(await js("document.querySelector('.card-heading strong').textContent"),'最近消息');await capture('codex-tasks');check('Codex quotas and tasks use common arrow pagination');
    await open('workshop.test');assert.ok(await js("document.querySelector('#card-body').textContent.includes('第四插件无需修改菜单')"));await js("document.querySelector('[data-command=echo]').click()");await delay(150);assert.ok(await js("document.querySelector('#card-body').textContent.includes('统一命令调用成功')"));check('fourth plugin renders and executes without UI special cases');
    const settingsX=await js("document.querySelector('[data-settings]').getBoundingClientRect().x");await js("document.querySelector('#capsule-track').dispatchEvent(new WheelEvent('wheel',{deltaY:200,bubbles:true,cancelable:true}))");await delay(400);
    assert.ok(await js("document.querySelector('#capsule-track').scrollLeft>0"));assert.equal(await js("document.querySelector('[data-settings]').getBoundingClientRect().x"),settingsX);check('menu entries scroll while settings stays fixed');
    await js('window.petFeatures.resize(360,340,true)');await delay(150);assert.ok(Math.abs(overlay.window.getBounds().width-398)<=1);
    const saved=JSON.parse(await readFile(path.join(app.getPath('userData'),'feature-settings.json'),'utf8'));assert.equal(saved.global.cardWidth,360);assert.equal(saved.global.cardHeight,340);await capture('resized');await js('window.petFeatures.resize(282,285,true)');check('bounded resizing persists in migrated global settings');
    await service.setSettings({plugins:{'workshop.test':{enabled:false}}});windows.ingest({media:{sessions:[],error:null},notifications:{permission:'Allowed',items:[]},codexRunning:false});await delay(120);await enter();assert.equal(await js("document.querySelectorAll('[data-module]').length"),1);
    await open('workshop.notifications');assert.ok(await js("document.querySelector('#card-body').textContent.includes('暂无新通知')"));
    windows.ingest({notifications:{permission:'Allowed',items:[{...items[0],id:'unread-check',createdAt:new Date(Date.now()+100).toISOString()}]}});await delay(120);
    assert.ok(await js("!document.querySelector('[data-module=\"workshop.notifications\"] .badge').classList.contains('hidden')"));await delay(850);
    assert.ok(await js("document.querySelector('[data-module=\"workshop.notifications\"] .badge').classList.contains('hidden')"));
    await js("document.querySelector('[data-close]').click()");await delay(350);await enter();await open('workshop.notifications');assert.ok(await js("document.querySelector('#card-body').textContent.includes('暂无新通知')"));await capture('notifications-empty');check('reading clears dot and reminders, notification entry remains when empty');
    await service.setSettings({plugins:{'workshop.notifications':{enabled:false}}});await delay(280);assert.equal(await js("document.querySelectorAll('[data-module]').length"),0);check('only disabling the plugin hides the notification entry');
    await service.setSettings({plugins:{'workshop.notifications':{enabled:true}}});
    for(let i=0;i<3;i++){
      await enter();await js("document.querySelector('[data-settings]').click()");await waitFor(()=>getSettingsWindow()?.isVisible(),'settings');
      const manager=getSettingsWindow(),run=code=>manager.webContents.executeJavaScript(code);await waitFor(()=>!manager.webContents.isLoading(),'manager load');await delay(280);
      await run("document.querySelector('[data-page=extensions]').click()");assert.equal(await run("document.querySelectorAll('.plugin-registry-item').length"),4);
      if(i===0){manager.minimize();createSettingsWindow();await waitFor(()=>!manager.isMinimized(),'restore minimized manager');}
      if(i===2){
        await run("document.querySelector('[data-plugin-details=\"workshop.notifications\"]').open=true");service.publish();await delay(80);
        assert.equal(await run("document.querySelector('[data-plugin-details=\"workshop.notifications\"]').open"),true);
        await run("{const input=document.querySelector('[data-plugin-config=blockedApps]');input.focus();input.value='draft-source';}");service.publish();await delay(80);
        assert.equal(await run("document.querySelector('[data-plugin-config=blockedApps]').value"),'draft-source');
        await run("document.activeElement.blur();document.querySelector('[data-plugin-details=\"workshop.notifications\"]').open=false");
        manager.setContentSize(980,1000);await run("window.scrollTo({top:0,behavior:'instant'})");await capture('plugins',manager);
        await run("document.querySelector('[data-page=features]').click()");assert.ok(await run("document.querySelector('#feature-compatibility').textContent.includes('SMTC')"));
        const result=await run("window.featureSettings.set({plugins:{'workshop.music':{enabled:false}}})");assert.equal(result.ok,true);
        assert.equal(await run("document.querySelector('#page-extensions [data-plugin-id=\"workshop.music\"][data-plugin-enabled]').checked"),false);
        await run("window.featureSettings.set({plugins:{'workshop.music':{enabled:true}}})");await capture('features',manager);
        assert.equal((await run('window.featureSettings.startup()')).supported,false);
        assert.equal((await run('window.featureSettings.execute("workshop.notifications","requestPermission",{})')).ok,true);
      }
      manager.close();await delay(220);
    }
    check('manager opens repeatedly, registry toggles synchronize, compatibility notes and startup remain intact');
    windows.ingest({media:mediaFixture(cover)});await delay(120);
    for(let i=0;i<3;i++){await enter();await open('workshop.music');await js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");await delay(300);assert.equal(overlay.inspect().pinned,false);assert.equal(overlay.inspect().capturing,false);}
    check('menu reopens after Escape and native capture is released');
    const metadata=JSON.parse(await readFile(path.join(process.cwd(),'package.json'),'utf8'));
    await writeFile(path.join(directory,'results.json'),JSON.stringify({ok:true,version:metadata.version,electronVersion:process.versions.electron,checks},null,2));console.log('[v3.2.1] UI PASS',checks.length);
  } catch(error){await writeFile(path.join(directory,'results.json'),JSON.stringify({ok:false,error:error.stack,native:overlay.inspect(),checks},null,2));console.error('[v3.2.1] UI FAIL',error);process.exitCode=1;}
  finally {await service.stop();if(process.exitCode) app.exit(process.exitCode);else app.quit();}
}
