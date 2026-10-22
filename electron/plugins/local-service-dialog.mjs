import {applyCredentialTheme} from './window-theme.mjs';
import { BrowserWindow,ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export function createLocalServiceDialog({root,service,getTheme=()=> 'graphite'}){
  const owners=new Map(),windows=new Map(),file=path.join(root,'electron','plugins','local-service-settings.html'),url=pathToFileURL(file).href;
  const actor=event=>{
    const owner=owners.get(event.sender.id);
    if(!owner||owner.signal.aborted||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==url)throw new Error('Invalid local service window');
    return owner;
  };
  ipcMain.handle('local-service-settings:status',async event=>{const owner=actor(event);return {pluginId:owner.id,...await service.status(owner.id)};});
  ipcMain.handle('local-service-settings:save',async(event,connection)=>{
    const owner=actor(event);
    try{await service.save(owner.id,connection,()=>actor(event));return {ok:true};}
    catch{return {ok:false,message:'保存失败。请使用明确端口的本机地址和有效连接令牌，并检查系统加密。'};}
  });
  ipcMain.handle('local-service-settings:clear',async event=>{
    const owner=actor(event);
    try{await service.save(owner.id,null,()=>actor(event));return {ok:true};}catch{return {ok:false,message:'移除连接失败，请稍后重试。'};}
  });
  return ({id,signal})=>{
    if(signal.aborted)return;
    const previous=windows.get(id);if(previous&&!previous.isDestroyed()){previous.show();previous.focus();return;}
    const window=new BrowserWindow({show:false,backgroundColor:'#1b2028',width:520,height:650,useContentSize:true,resizable:false,title:'本地服务连接设置',autoHideMenuBar:true,
      webPreferences:{partition:'local-service-settings-'+randomUUID(),preload:path.join(root,'electron','plugins','local-service-settings-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,devTools:false}});
    const owner={id,signal,window};owners.set(window.webContents.id,owner);windows.set(id,window);
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.webContents.once('did-stop-loading',()=>applyCredentialTheme(window,getTheme()));
    const allowed=new Set(['theme.css','local-service-settings.html','local-service-settings.js','local-service-settings.css'].map(name=>pathToFileURL(path.join(root,'electron','plugins',name)).href));
    window.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed.has(details.url)}));
    const close=()=>{if(!window.isDestroyed())window.close();};signal.addEventListener('abort',close,{once:true});const sender=window.webContents.id;
    window.once('closed',()=>{signal.removeEventListener('abort',close);owners.delete(sender);if(windows.get(id)===window)windows.delete(id);});
    window.once('ready-to-show',()=>{if(!signal.aborted)window.show();});void window.loadFile(file).catch(close);
  };
}
