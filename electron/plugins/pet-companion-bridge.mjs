import {settingsHaveFocus} from '../ui-focus.mjs';
import {BrowserWindow,ipcMain,screen} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {companionState,executeCompanion} from './companion.mjs';
const COMPOSER_WIDTH=340,COMPOSER_HEIGHT=76,MIN_WIDTH=240,MAX_WIDTH=720;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function createPetCompanionBridge({service,getPet,setInteraction}) {
 let appliedBounds=null,window,ready=false,petHovered=false,held=false,suppressed=false,lastInside=0,dragStart=null,resizeStart=null,clickActivated=false;
 let trigger=service.settings.companionTrigger??'hover';
 const petSender=e=>{const pet=getPet();return pet&&!pet.isDestroyed()&&e.sender===pet.webContents&&e.senderFrame===pet.webContents.mainFrame;};
 const composerSender=e=>window&&!window.isDestroyed()&&e.sender===window.webContents&&e.senderFrame===window.webContents.mainFrame;
 const trusted=e=>petSender(e)||composerSender(e);
 const send=state=>{if(ready&&window&&!window.isDestroyed())window.webContents.send('companion:state',state);};
 const width=()=>service.settings.companionWidth??COMPOSER_WIDTH;
 const clamp=(x,y,requestedWidth)=>{
  const area=screen.getDisplayMatching({x:Math.round(x),y:Math.round(y),width:Math.round(requestedWidth),height:COMPOSER_HEIGHT}).workArea;
  const w=Math.min(area.width,Math.round(Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,requestedWidth))));
  return {x:Math.round(Math.max(area.x,Math.min(area.x+area.width-w,x))),y:Math.round(Math.max(area.y,Math.min(area.y+area.height-COMPOSER_HEIGHT,y))),width:w,height:COMPOSER_HEIGHT};
 };
 function applyBounds(bounds){
  if(!window||window.isDestroyed())return;
  const actual=window.getBounds();
  // Keep requested dimensions separate from native measurements to avoid DPI rounding growth.
  if(!appliedBounds||bounds.x!==appliedBounds.x||bounds.y!==appliedBounds.y||bounds.width!==appliedBounds.width||Math.abs(actual.width-bounds.width)>4||Math.abs(actual.height-COMPOSER_HEIGHT)>4){
   appliedBounds={...bounds};window.setBounds(bounds,false);
  }
 }
 function position(){
  if(!window||window.isDestroyed()||dragStart||resizeStart)return;
  const pet=getPet();if(!pet||pet.isDestroyed())return;
  const p=pet.getBounds(),saved=service.settings.companionPosition,w=width();
  applyBounds(clamp(saved?.x??(p.x+p.width/2-w/2),saved?.y??(p.y+p.height-COMPOSER_HEIGHT-4),w));
 }
 function hide(){
  clickActivated=false;
  if(!window||window.isDestroyed())return;
  const visible=window.isVisible();window.hide();held=false;dragStart=null;resizeStart=null;setInteraction(false);
  if(ready&&visible)window.webContents.send('companion:closed');
 }
 function ensureWindow(){
  if(window&&!window.isDestroyed())return;
  const pet=getPet();if(!pet||pet.isDestroyed())return;
  window=new BrowserWindow({width:width(),height:COMPOSER_HEIGHT,parent:pet,show:false,frame:false,transparent:true,backgroundColor:'#00000000',skipTaskbar:true,resizable:false,hasShadow:false,title:'SpinePet · 聊天',
   webPreferences:{preload:path.join(root,'electron/plugins/companion-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  window.setAlwaysOnTop(true,'screen-saver');window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  window.webContents.once('did-finish-load',()=>{ready=true;position();send(companionState(service.snapshot()));});
  window.on('blur',()=>{held=false;lastInside=Date.now();setInteraction(false);});
  window.on('closed',()=>{ready=false;window=null;appliedBounds=null;});
  const url=process.env.VITE_DEV_SERVER_URL;if(url)void window.loadURL(url+'/companion.html');else void window.loadFile(path.join(root,'dist/companion.html'));
 }
 ipcMain.handle('pet:companion-get',e=>{if(!trusted(e))throw Error('Invalid sender');const state=companionState(service.snapshot());if(state.companion)ensureWindow();return state;});
 ipcMain.handle('pet:companion-execute',(e,id,epoch,command,text)=>{if(!composerSender(e))throw Error('Invalid sender');return executeCompanion(service,id,epoch,command,text);});
 ipcMain.on('pet:companion-hover',(e,value)=>{if(!petSender(e))return;if(value!==true)suppressed=false;petHovered=value===true;if(petHovered&&trigger==='hover')lastInside=Date.now();});
 ipcMain.on('pet:companion-click',e=>{
  const pet=getPet();
  if(!petSender(e)||trigger!=='click'||!pet.isVisible()||settingsHaveFocus()||!companionState(service.snapshot()).companion)return;
  clickActivated=true;suppressed=false;lastInside=Date.now();
 });
 ipcMain.on('pet:companion-interaction',(e,value)=>{if(composerSender(e)){held=value===true&&!service.snapshot().locked;setInteraction(held);}});
 ipcMain.on('pet:companion-close',e=>{if(composerSender(e)){suppressed=true;lastInside=0;hide();}});
 ipcMain.handle('pet:companion-move',async(e,dx,dy,phase)=>{
  if(!composerSender(e)||!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>100000||Math.abs(dy)>100000||!['start','move','end'].includes(phase))return {ok:false};
  if(phase==='start'){if(resizeStart||!window.isVisible())return {ok:false};dragStart={...appliedBounds};held=true;setInteraction(true);return {ok:true};}
  if(!dragStart)return {ok:false};
  const bounds=clamp(dragStart.x+dx,dragStart.y+dy,dragStart.width);applyBounds(bounds);
  if(phase==='end'){lastInside=Date.now();try{await service.setSettings({global:{companionPosition:{x:bounds.x,y:bounds.y}}});}catch{position();return {ok:false};}finally{dragStart=null;position();}}
  return {ok:true};
 });
 ipcMain.handle('pet:companion-resize',async(e,dx,edge,phase)=>{
  if(!composerSender(e)||!Number.isFinite(dx)||Math.abs(dx)>100000||!['left','right'].includes(edge)||!['start','move','end'].includes(phase))return {ok:false};
  if(phase==='start'){if(dragStart||!window.isVisible())return {ok:false};resizeStart={...appliedBounds,edge};held=true;setInteraction(true);return {ok:true};}
  if(!resizeStart||resizeStart.edge!==edge)return {ok:false};
  const start=resizeStart,w=Math.round(Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,start.width+(edge==='left'?-dx:dx))));
  const bounds=clamp(edge==='left'?start.x+start.width-w:start.x,start.y,w);applyBounds(bounds);
  if(phase==='end'){
   lastInside=Date.now();
   try{await service.setSettings({global:{companionWidth:bounds.width,companionPosition:{x:bounds.x,y:bounds.y}}});}
   catch{return {ok:false};}
   finally{resizeStart=null;position();}
  }
  return {ok:true};
 });
 const contains=(p,b)=>p.x>=b.x&&p.x<=b.x+b.width&&p.y>=b.y&&p.y<=b.y+b.height;
 const timer=setInterval(()=>{
  const pet=getPet(),state=companionState(service.snapshot());
  if(!state.companion||!pet||pet.isDestroyed()||!pet.isVisible()||settingsHaveFocus()){petHovered=false;suppressed=false;hide();return;}
  ensureWindow();if(!ready)return;position();
  const now=Date.now(),inside=window.isVisible()&&contains(screen.getCursorScreenPoint(),window.getBounds()),activated=trigger==='hover'||clickActivated;
  if(activated&&(petHovered||inside||held||dragStart||resizeStart))lastInside=now;
  const visible=!suppressed&&activated&&(petHovered||inside||held||Boolean(dragStart)||Boolean(resizeStart)||now-lastInside<1200);
  if(visible){if(!window.isVisible()){send(state);window.showInactive();}setInteraction(held||inside||Boolean(dragStart)||Boolean(resizeStart));}else if(window.isVisible())hide();
 },50);
 return {
  get window(){return window;},
  update(snapshot){
   const nextTrigger=service.settings.companionTrigger??'hover';
   if(nextTrigger!==trigger){trigger=nextTrigger;lastInside=0;suppressed=false;hide();}
   const state=companionState(snapshot),pet=getPet();if(state.companion){ensureWindow();position();}else{petHovered=false;suppressed=false;hide();}
   if(pet&&!pet.isDestroyed())pet.webContents.send('pet:companion-state',state);send(state);
  },
  stop(){clearInterval(timer);hide();if(window&&!window.isDestroyed())window.destroy();}
 };
}
