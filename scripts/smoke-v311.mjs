import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const waitFor=async predicate=>{for(let i=0;i<120;i++){if(await predicate()) return;await delay(100);}throw new Error('UI did not become ready');};
export async function runSmoke({app,mainWindow,overlay,service,createSettingsWindow,getSettingsWindow}){
  const directory=path.resolve(process.env.V311_SMOKE_DIR);await mkdir(directory,{recursive:true});
  const checks=[],js=code=>overlay.window.webContents.executeJavaScript(code);
  const outside={x:-10000,y:-10000};
  try{
    overlay.setTestCursor(outside);
    await waitFor(()=>!overlay.window.webContents.isLoading());await delay(14000);
    const live=service.snapshot();
    checks.push({name:'live Windows bridge',mediaError:live.media.error,
      media:live.media.sessions.map(x=>({id:x.id,cover:Boolean(x.cover),fallback:Boolean(x.fallback)})),
      notificationPermission:live.notifications.permission,channels:live.notifications.channels,
      codexConnected:live.codex.connected,codexHasQuota:Boolean(live.codex.primary)});
    assert.equal(live.media.error,null);assert.notEqual(live.notifications.permission,'Unknown');
    assert.ok(!live.media.sessions.some(x=>/spine.*workshop/i.test(x.id)));
    if(live.media.sessions.some(x=>x.id==='QQMusic.exe')) assert.ok(live.media.sessions.find(x=>x.id==='QQMusic.exe').cover);
    service.stop();getSettingsWindow()?.close();
    const readIds=[],originalDismiss=service.dismiss.bind(service);
    service.dismiss=id=>{readIds.push(id);return originalDismiss(id);};
    const cover='data:image/png;base64,'+(await readFile(path.join(process.cwd(),'assets','amiya-app-icon.png'))).toString('base64');
    const fixture={settings:{...live.settings,music:true,notifications:true,codex:true,details:true,subtitles:true,quiet:false,reducedMotion:false,cardWidth:282,cardHeight:285},locked:false,
      media:{sessions:[{id:'QQMusic.exe',name:'QQ 音乐',title:'示例曲目 · 界面测试',artist:'演示数据',album:'专辑封面显示测试',status:'Paused',position:84,duration:269,cover,coverStatus:'available',
        capabilities:{play:true,pause:true,next:true,previous:true}},
        {id:'cloudmusic.exe',name:'网易云音乐',title:'SMTC 兼容测试',artist:'演示数据',album:'',status:'Paused',position:84,duration:269,cover:null,capabilities:{play:true,pause:true,next:true,previous:true}}],error:null},
      notifications:{permission:'Allowed',error:null,items:Array.from({length:10},(_,i)=>({id:'sample-'+i,app:i<5?'ChatGPT':'系统通知',appId:i<5?'gpt':'system',createdAt:new Date().toISOString(),
        title:'界面测试通知 '+(i+1),body:'这是一条用于检查两行摘要和省略号的演示消息。'.repeat(15)}))},
      codex:{running:true,connected:true,allowed:true,updatedAt:new Date().toISOString(),primary:{remaining:82,minutes:300,resetsAt:new Date(Date.now()+7200000).toISOString()},
        secondary:{remaining:64,minutes:10080,resetsAt:new Date(Date.now()+172800000).toISOString()},tasks:Array.from({length:8},(_,i)=>({id:'task-'+i,name:'界面测试任务 '+(i+1),status:'idle',turnStatus:'completed',updatedAt:Date.now()/1000}))}
    };
    const send=async value=>{overlay.window.webContents.send('extensions:state',value??fixture);await delay(100);};
    const enter=async()=>{
      overlay.setTestCursor(outside);await delay(750);
      const p=mainWindow.getBounds();overlay.setTestCursor({x:p.x+p.width/2,y:p.y+p.height/2});
      await waitFor(()=>overlay.inspect().hovered);await delay(220);
    };
    const pointAt=async selector=>{
      const r=await js("(()=>{const r=document.querySelector("+JSON.stringify(selector)+").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
      const w=overlay.window.getBounds();overlay.setTestCursor({x:w.x+r.x,y:w.y+r.y});await delay(80);
    };
    const capture=async name=>{await delay(250);await writeFile(path.join(directory,name+'.png'),(await overlay.window.webContents.capturePage()).toPNG());};
    await js("window.petFeatures.resize(282,285,true)");await send();await enter();
    assert.equal(overlay.window.getParentWindow(),mainWindow);
    await js("window.savedSettingsButton=document.querySelector('[data-settings]');window.savedMusicButton=document.querySelector('[data-module=music]')");
    await send();
    assert.ok(await js("window.savedSettingsButton===document.querySelector('[data-settings]') && window.savedMusicButton===document.querySelector('[data-module=music]')"));
    checks.push({name:'owned overlay above voice; stable button identity across refresh',passed:true});
    await pointAt('[data-module=music]');
    await js("document.querySelector('[data-module=music]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))");await delay(220);
    assert.equal(await js("document.querySelector('#feature-card').classList.contains('hidden')"),false);
    assert.equal(overlay.inspect().pinned,false);
    assert.ok(await js("document.querySelector('.cover').complete && document.querySelector('.cover').naturalWidth>0"));
    await js("document.querySelector('[data-module=music]').click()");await delay(70);
    assert.equal(overlay.inspect().pinned,true);
    await js("document.querySelector('[data-module=notifications]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))");await delay(220);
    assert.equal(await js("document.querySelector('.card-heading strong').textContent"),'QQ 音乐');
    checks.push({name:'hover preview; click pins; hover does not replace pinned card',passed:true});
    await js("document.querySelector('[data-module=music]').click()");
    await js("{const b=document.querySelector('#card-body');for(let i=0;i<2;i++)b.dispatchEvent(new WheelEvent('wheel',{deltaY:70,bubbles:true,cancelable:true}));}");await delay(60);
    assert.ok(await js("{const b=document.querySelector('#card-body');b.scrollTop>0 && b.scrollTop<b.clientHeight && getComputedStyle(b).scrollSnapType==='none'}"));
    await delay(650);
    assert.equal(await js("document.querySelector('#page-counter').textContent"),'2 / 2',JSON.stringify(await js("[...document.querySelectorAll('.page-content')].map(x=>({height:x.clientHeight,scroll:x.scrollHeight,top:x.scrollTop}))")));
    assert.equal(await js("document.querySelectorAll('[data-position]')[1].textContent"),'--:--');
    assert.equal(await js("document.querySelectorAll('.feature-page')[1].querySelectorAll('.compatibility-note').length"),0);
    checks.push({name:'continuous wheel motion then snap; rapid input is retained; NetEase unknown timeline without UI clutter',passed:true});
    for(const module of ['music','notifications','codex']){
      await js("document.querySelector('[data-module="+module+"]').click()");
      await capture(module);
    }
    await js("document.querySelector('[data-module=notifications]').click()");await delay(80);
    const notificationMetrics=await js("(()=>{const body=document.querySelector('#card-body'),head=document.querySelector('.card-heading'),inner=document.querySelector('.page-content');const y=head.getBoundingClientRect().y;inner.scrollTop=90;return {y,snap:getComputedStyle(body).scrollSnapType,outer:body.scrollTop,inner:inner.scrollTop,overflow:inner.scrollHeight>inner.clientHeight,pages:body.querySelectorAll('.feature-page').length}})()");
    assert.equal(notificationMetrics.pages,10);assert.ok(notificationMetrics.overflow);assert.ok(notificationMetrics.inner>0);assert.equal(notificationMetrics.outer,0);
    assert.equal(await js("document.querySelector('.card-heading').getBoundingClientRect().y"),notificationMetrics.y);
    assert.match(notificationMetrics.snap,/^y(?: proximity)?$/); // Chromium may omit the default proximity keyword.
    await js("{const c=document.querySelector('.page-content');c.scrollTop=c.scrollHeight;document.querySelector('#card-body').dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}));}");await delay(600);
    assert.equal(await js("document.querySelector('#page-counter').textContent"),'2 / 10');
    await js("{const b=document.querySelector('#card-body');document.querySelectorAll('.page-content')[1].scrollTop=100000;for(let i=0;i<3;i++)b.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}));}");await delay(700);
    assert.equal(await js("document.querySelector('#page-counter').textContent"),'4 / 10');
    await js("document.querySelector('#card-body').scrollTo({top:5*document.querySelector('#card-body').clientHeight,behavior:'instant'})");await delay(200);
    assert.equal(await js("document.querySelector('.card-heading strong').textContent"),'系统通知');
    await delay(700);
    checks.push({name:'each notification has a fixed source heading, inner content scroll, boundary snaps to next message',passed:true});
    await js("document.querySelector('[data-module=codex]').click()");await delay(100);
    assert.ok(readIds.includes('sample-5'));assert.ok(!await js("[...document.querySelectorAll('[data-notice]')].some(x=>x.dataset.notice==='sample-5')"));
    checks.push({name:'viewed notification is marked on leaving the panel',passed:true});
    await js("document.querySelector('#card-body').dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}))");await delay(600);
    assert.equal(await js("document.querySelector('#page-counter').textContent"),'2 / 2');
    await capture('codex-tasks');
    checks.push({name:'one wheel gesture switches quotas to recent messages',passed:true});
    const initialWidth=await js("document.querySelector('#feature-card').getBoundingClientRect().width");
    const edge=await js("(()=>{const r=document.querySelector('.edge-e').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    const frame=overlay.window.getBounds(),globalX=frame.x+edge.x,globalY=frame.y+edge.y;
    overlay.setTestCursor({x:globalX,y:globalY});overlay.window.focus();await delay(100);
    await js("window.resizeEvents=[];document.querySelector('#feature-card').addEventListener('pointerdown',e=>window.resizeEvents.push({edge:e.target.dataset.resize,x:e.screenX,y:e.screenY}));window.addEventListener('pointermove',e=>{if(e.buttons)window.resizeEvents.push({move:e.screenX,y:e.screenY})})");
    overlay.window.webContents.sendInputEvent({type:'mouseMove',...edge,globalX,globalY});overlay.window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...edge,globalX,globalY});await delay(60);
    overlay.window.webContents.sendInputEvent({type:'mouseMove',x:edge.x+12,y:edge.y,globalX:globalX+12,globalY,modifiers:['leftButtonDown']});await delay(100);
    overlay.window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:edge.x+12,y:edge.y,globalX:globalX+12,globalY});await delay(250);
    assert.ok(await js("document.querySelector('#feature-card').getBoundingClientRect().width")>initialWidth+5,JSON.stringify(await js('window.resizeEvents')));
    const size=await js("window.petFeatures.resize(360,340,true)");assert.equal(size.width,360);assert.equal(size.height,340);
    await send({...fixture,settings:{...fixture.settings,cardWidth:360,cardHeight:340}});
    const prefs=JSON.parse(await readFile(path.join(app.getPath('userData'),'feature-settings.json'),'utf8'));assert.equal(prefs.cardWidth,360);assert.equal(prefs.cardHeight,340);
    assert.ok(Math.abs(overlay.window.getBounds().width-398)<=1);await capture('resized');
    await js("window.petFeatures.resize(282,285,true)");await send();
    checks.push({name:'edge pointer drag resizes panel; bounded size persists; native window expands',passed:true});
    const before=await js("document.querySelector('[data-settings]').getBoundingClientRect().x");
    await js("{const t=document.querySelector('#capsule-track');for(let i=0;i<6;i++){const n=t.firstElementChild.cloneNode(true);n.removeAttribute('data-module');t.append(n);}t.dispatchEvent(new WheelEvent('wheel',{deltaY:180,bubbles:true,cancelable:true}));}");
    await delay(500);
    assert.ok(await js("document.querySelector('#capsule-track').scrollLeft>0"));
    assert.equal(await js("document.querySelector('[data-settings]').getBoundingClientRect().x"),before);
    checks.push({name:'wheel-scroll modules, settings stays stationary',passed:true});
    await capture('capsule-scroll');
    const empty={...fixture,media:{sessions:[],error:null},codex:{running:false,connected:false,tasks:[]},notifications:{permission:'Allowed',error:null,items:[]}};
    await send(empty);await enter();
    assert.equal(await js("document.querySelectorAll('[data-module]').length"),1);
    assert.ok(await js("document.querySelector('[data-module=notifications] .badge').classList.contains('hidden')"));
    await js("window.notificationEntry=document.querySelector('[data-module=notifications]');window.notificationEntry.click()");await delay(100);
    assert.ok(await js("document.querySelector('#card-body').textContent.includes('暂无新通知')"));
    await send({...empty,notifications:{...empty.notifications,items:[{...fixture.notifications.items[0],id:'unread-test',createdAt:new Date().toISOString()}]}});
    assert.ok(await js("window.notificationEntry===document.querySelector('[data-module=notifications]') && !window.notificationEntry.querySelector('.badge').classList.contains('hidden')"));
    await delay(750);
    assert.ok(await js("window.notificationEntry.querySelector('.badge').classList.contains('hidden') && !document.querySelector('#feature-card').classList.contains('hidden')"));
    await js("document.querySelector('[data-close]').click()");await delay(350);await enter();
    assert.ok(await js("window.notificationEntry===document.querySelector('[data-module=notifications]')"));
    await js("document.querySelector('[data-module=notifications]').click()");await delay(100);
    assert.ok(await js("document.querySelector('#card-body').textContent.includes('暂无新通知')"));
    await capture('notifications-empty');
    await send({...empty,settings:{...empty.settings,notifications:false}});await delay(300);
    assert.equal(await js("document.querySelectorAll('[data-module]').length"),0);
    assert.ok(await js("document.querySelector('#feature-card').classList.contains('hidden')"));
    checks.push({name:'enabled notification entry persists when empty; arrivals show dot, reading clears dot, disabling alone hides entry',passed:true});
    await send();await enter();await js("document.querySelector('[data-module=music]').click()");await delay(100);
    await js("document.querySelector('[data-close]').click()");await delay(70);
    assert.equal(await js("document.querySelector('#capsule').classList.contains('leaving')"),true);
    await delay(270);assert.equal(overlay.inspect().visible,false);assert.equal(overlay.inspect().capturing,false);
    await send({...fixture,settings:{...fixture.settings,music:false,notifications:false,codex:false}});await enter();
    assert.equal(await js("document.querySelectorAll('[data-module]').length"),0);
    checks.push({name:'fade-out completes before native hide; disabled modules disappear',passed:true});
    await send();
    for(let i=0;i<3;i++){
      await enter();await pointAt('[data-settings]');await js("document.querySelector('[data-settings]').click()");
      await waitFor(()=>Boolean(getSettingsWindow()?.isVisible()));
      const settings=getSettingsWindow();await waitFor(()=>!settings.webContents.isLoading());await delay(250);
      if(i===0){
        settings.minimize();await enter();await pointAt('[data-settings]');await js("document.querySelector('[data-settings]').click()");
        await waitFor(()=>!settings.isMinimized());assert.equal(settings.isVisible(),true);
      }
      settings.show();settings.focus();await delay(400);
      await settings.webContents.executeJavaScript("document.querySelector('[data-page=features]').click()");
      if(i===2){
        assert.ok(await settings.webContents.executeJavaScript("document.querySelector('#feature-compatibility').textContent.includes('网易云') && document.querySelector('#feature-compatibility').textContent.includes('SMTC')"));
        assert.ok(await settings.webContents.executeJavaScript("document.querySelector('#startup-enabled').disabled && document.querySelector('#startup-status').textContent.includes('开发运行')"));
        const startup=await settings.webContents.executeJavaScript("window.featureSettings.startup()");
        assert.equal(startup.supported,false);assert.equal(startup.enabled,false);
        const denied=await settings.webContents.executeJavaScript("window.featureSettings.setStartup(true)");
        assert.equal(denied.ok,false);
        await delay(500);await writeFile(path.join(directory,'settings.png'),(await settings.webContents.capturePage()).toPNG());
        const result=await settings.webContents.executeJavaScript("window.featureSettings.set({music:false})");
        assert.equal(result.ok,true);assert.equal(result.snapshot.settings.music,false);
        await settings.webContents.executeJavaScript("window.featureSettings.set({music:true})");
      }
      settings.close();await delay(220);
    }
    checks.push({name:'settings opens three times after close; minimized settings restores; persistence',passed:true});
    checks.push({name:'manager compatibility notes and startup switch; development run cannot register Electron as startup',passed:true});
    for(let i=0;i<3;i++){
      await enter();await pointAt('[data-module=music]');await js("document.querySelector('[data-module=music]').click()");await delay(60);
      await js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");await delay(300);
      assert.equal(overlay.inspect().pinned,false);assert.equal(overlay.inspect().capturing,false);
    }
    checks.push({name:'menu opens repeatedly after Escape/close',passed:true});
    const bounds=mainWindow.getBounds();assert.ok(Math.abs(bounds.width-252)<=1);assert.ok(Math.abs(bounds.height-300)<=1);
    await writeFile(path.join(directory,'results.json'),JSON.stringify({ok:true,checks},null,2));
    console.log('[v'+app.getVersion()+'] PASS',JSON.stringify(checks));
  }catch(error){
    const settings=getSettingsWindow();
    await writeFile(path.join(directory,'results.json'),JSON.stringify({ok:false,error:error.stack,native:overlay.inspect(),settings:settings?{destroyed:settings.isDestroyed(),visible:!settings.isDestroyed()&&settings.isVisible(),minimized:!settings.isDestroyed()&&settings.isMinimized()}:null,checks},null,2));
    console.error('[v'+app.getVersion()+'] FAIL',error);process.exitCode=1;
  }finally{if(process.exitCode) app.exit(process.exitCode);else app.quit();}
}
