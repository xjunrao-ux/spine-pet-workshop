import {settingsHaveFocus} from '../ui-focus.mjs';
import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';

const EXIT_DELAY=400, FADE_OUT=250;
export function createExtensionOverlay({ root, service, getPet, getDragging, setInteraction, openSettings, testing=false }) {
  let WIDTH=320, HEIGHT=380;
  // Owned windows stay above their pet, including its voice bubble.
  const window=new BrowserWindow({width:WIDTH,height:HEIGHT,parent:getPet(),show:false,frame:false,transparent:true,
    backgroundColor:'#00000000',skipTaskbar:true,resizable:false,hasShadow:false,
    webPreferences:{preload:path.join(root,'electron','extensions','preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  window.setAlwaysOnTop(true,'screen-saver'); window.setIgnoreMouseEvents(true,{forward:true});
  const url=process.env.VITE_DEV_SERVER_URL;
  if(url) void window.loadURL(`${url}/extensions.html`); else void window.loadFile(path.join(root,'dist','extensions.html'));
  let regions=[],ready=false,hovered=false,pinned=false,hoverSince=0,lastInside=0,capturing=false;
  let toastUntil=0,hideAt=0,blocked=false,blockedRegions=[],anchor=null,testCursor=null,resizing=false,activeProfile='compact',manualAnchor=false,dragStart=null;
  const trusted=event=>event.sender===window.webContents;
  const send=(name,value)=>{if(ready && !window.isDestroyed()) window.webContents.send(name,value);};
  const capture=(value,force=false)=>{if(capturing===value && !force) return;capturing=value;if(!window.isDestroyed()) window.setIgnoreMouseEvents(!value,{forward:true});};
  const resize=(width,height,edge='')=>{
    const old=window.getBounds(), area=screen.getDisplayMatching(old).workArea;
    const w=Math.round(Math.max(activeProfile==='conversation'?320:240,Math.min(560,area.width-38,width)));
    const h=Math.round(Math.max(activeProfile==='conversation'?360:230,Math.min(640,area.height-170,height)));
    if(WIDTH!==w+38 || HEIGHT!==h+170){
      WIDTH=w+38;HEIGHT=h+170;
      const nextX=old.x+(edge.includes('w')?old.width-WIDTH:edge.includes('e')?0:(old.width-WIDTH)/2);
      const nextY=old.y+(edge.includes('s')?0:old.height-HEIGHT);
      const x=Math.round(Math.max(area.x,Math.min(area.x+area.width-WIDTH,nextX)));
      const y=Math.round(Math.max(area.y,Math.min(area.y+area.height-HEIGHT,nextY)));
      anchor={x,y};window.setBounds({x,y,width:WIDTH,height:HEIGHT},false);
    }
    return {width:w,height:h};
  };
  const showHover=value=>{
    if(hovered===value) return;
    hovered=value;send('extensions:hover',value);
    if(value) hideAt=0;
  };
  const reset=(suppress=true,immediate=false)=>{
    blockedRegions=regions;blocked=suppress;
    resizing=false;
    pinned=false;hovered=false;hoverSince=0;lastInside=0;regions=[];capture(false,true);setInteraction(false);
    // Explicitly synchronize both sides even when native hover already reads false.
    send('extensions:hover',false);send('extensions:close',null);
    hideAt=Date.now()+(immediate?0:FADE_OUT);
    if(immediate && !window.isDestroyed()) {toastUntil=0;window.hide();}
  };
  ipcMain.on('extensions:regions',(event,data)=>{
    if(trusted(event) && Array.isArray(data)) regions=data.slice(0,8).filter(r=>['x','y','width','height'].every(k=>Number.isFinite(r[k])) && r.width>0 && r.height>0);
  });
  ipcMain.on('extensions:pinned',(event,value)=>{if(trusted(event)) pinned=Boolean(value);});
  ipcMain.handle('extensions:resize',async(event,width,height,save,edge='',profile='compact')=>{
    if(!trusted(event) || !Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Invalid size');
    activeProfile=profile==='conversation'?'conversation':'compact';
    resizing=save!==true&&Boolean(edge);
    const size=resize(width,height,/^(?:n|s|e|w|ne|nw|se|sw)$/.test(edge)?edge:'');
    if(save===true) await service.setSettings({global:activeProfile==='conversation'?{aiCardWidth:size.width,aiCardHeight:size.height}:{cardWidth:size.width,cardHeight:size.height}});
    return size;
  });
  ipcMain.on('extensions:move',(event,dx,dy,phase)=>{
    if(!trusted(event)||!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>20000||Math.abs(dy)>20000||!['start','move','end'].includes(phase))return;
    if(phase==='start'){dragStart=window.getBounds();manualAnchor=true;pinned=true;capture(true);return;}
    if(!dragStart)return;
    const area=screen.getDisplayMatching(window.getBounds()).workArea;
    const x=Math.round(Math.max(area.x,Math.min(area.x+area.width-WIDTH,dragStart.x+dx))),y=Math.round(Math.max(area.y,Math.min(area.y+area.height-HEIGHT,dragStart.y+dy)));
    anchor={x,y};window.setBounds({x,y,width:WIDTH,height:HEIGHT},false);
    if(phase==='end')dragStart=null;
  });
  ipcMain.on('extensions:close-menu',event=>{if(trusted(event)) reset();});
  ipcMain.handle('extensions:snapshot',event=>{if(!trusted(event)) throw new Error('Invalid sender');return service.snapshot();});
  ipcMain.handle('extensions:execute',(event,id,command,payload)=>{
    if(!trusted(event)) return {ok:false,error:{code:'INVALID_SENDER',message:'无效的调用来源'}};
    return service.execute(id,command,payload);
  });
  ipcMain.handle('extensions:acknowledge',(event,id,items)=>{
    if(!trusted(event)) return {ok:false,error:{code:'INVALID_SENDER',message:'无效的调用来源'}};
    return service.acknowledge(id,items);
  });
  ipcMain.on('extensions:settings',event=>{if(trusted(event)){reset(true,true);openSettings();}});
  window.webContents.once('did-finish-load',()=>{ready=true;resize(service.state.settings.cardWidth??282,service.state.settings.cardHeight??285);send('extensions:state',service.snapshot());});
  window.on('blur',()=>{if(pinned) reset();});
  const contains=(cursor,bounds)=>cursor.x>=bounds.x && cursor.x<=bounds.x+bounds.width && cursor.y>=bounds.y && cursor.y<=bounds.y+bounds.height;
  const tick=()=>{
    if(!ready || window.isDestroyed()) return;
    const pet=getPet();
    if(!pet || pet.isDestroyed() || !pet.isVisible() || getDragging() || service.state.locked || settingsHaveFocus()){
      if(hovered || pinned || window.isVisible()) reset(false,true);
      anchor=null;return;
    }
    const bounds=pet.getBounds(),area=screen.getDisplayMatching(bounds).workArea,now=Date.now();
    const cursor=testCursor??screen.getCursorScreenPoint(),old=window.getBounds();
    const hit=list=>list.some(r=>contains(cursor,{x:old.x+r.x,y:old.y+r.y,width:r.width,height:r.height}));
    let inSurface=window.isVisible() && hit(regions);
    const inPet=contains(cursor,bounds);
    if(blocked && !inPet && !hit(blockedRegions)){blocked=false;blockedRegions=[];}
    const target={x:Math.max(area.x,Math.min(area.x+area.width-WIDTH,bounds.x+bounds.width/2-WIDTH/2)),
      y:Math.max(area.y,Math.min(area.y+area.height-HEIGHT,bounds.y+bounds.height*.12-HEIGHT))};
    if(!anchor || !window.isVisible()) anchor={...target};
    // Stationary click targets while reading; the pet's gravity is never paused.
    if(!manualAnchor && !dragStart && !inSurface && !pinned && (!hideAt || now>=hideAt)){
      const blend=service.state.settings.reducedMotion?1:.4;
      anchor.x+=(target.x-anchor.x)*blend;anchor.y+=(target.y-anchor.y)*blend;
    }
    const x=Math.round(anchor.x),y=Math.round(anchor.y);
    if(old.x!==x || old.y!==y) window.setBounds({x,y,width:WIDTH,height:HEIGHT},false);
    inSurface=window.isVisible() && regions.some(r=>contains(cursor,{x:x+r.x,y:y+r.y,width:r.width,height:r.height}));
    const inBridge=hovered && contains(cursor,{x:Math.max(bounds.x,x+45),y:Math.min(bounds.y,y+HEIGHT-60),
      width:Math.min(bounds.width,WIDTH-90),height:Math.abs(bounds.y-(y+HEIGHT-60))+65});
    if(!blocked && (inPet || inSurface || inBridge)){
      lastInside=now;if(!hoverSince) hoverSince=now;
      if(inSurface || now-hoverSince>=service.state.settings.hoverDelay) showHover(true);
    }else{
      hoverSince=0;
      if(!pinned && hovered && now-lastInside>EXIT_DELAY){showHover(false);send('extensions:close',null);hideAt=now+FADE_OUT;}
    }
    setInteraction(!blocked && (inSurface || pinned || Boolean(dragStart)));capture(!blocked && (inSurface || Boolean(dragStart)));
    const wanted=hovered || pinned || now<toastUntil;
    if(wanted){hideAt=0;if(!window.isVisible()){window.showInactive();window.moveTop();}}
    else if(window.isVisible()){
      if(!hideAt) hideAt=now+FADE_OUT;
      if(now>=hideAt){capture(false);window.hide();regions=[];anchor=null;}
    }
  };
  const timer=setInterval(tick,32);
  return {window,
    update(snapshot){if(!resizing) resize(activeProfile==='conversation'?(snapshot.settings.aiCardWidth??420):(snapshot.settings.cardWidth??282),activeProfile==='conversation'?(snapshot.settings.aiCardHeight??500):(snapshot.settings.cardHeight??285));send('extensions:state',snapshot);if(!snapshot.settings.subtitles || snapshot.settings.quiet) toastUntil=0;},
    event(event){if(service.snapshot().plugins.find(p=>p.id===event.pluginId)?.manifest.presentation?.panel==='bubble')return;toastUntil=Math.min(Date.now()+22500,Math.max(Date.now(),toastUntil)+4500);send('extensions:event',event);},
    ...(testing?{setTestCursor(cursor){testCursor=cursor;},inspect(){return {hovered,pinned,capturing,blocked,regions:regions.length,visible:window.isVisible()};}}:{}),
    stop(){clearInterval(timer);capture(false);setInteraction(false);if(!window.isDestroyed()) window.destroy();}
  };
}
