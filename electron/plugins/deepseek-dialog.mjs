import {applyCredentialTheme} from './window-theme.mjs';
import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// Only this trusted, local window can submit a credential. ZIP workers never see it.
export function createDeepSeekDialog({root,credentials,service,getTheme=()=> 'graphite'}) {
  const windows=new Map(),owners=new Map();
  const file=path.join(root,'electron','plugins','deepseek-settings.html'),url=pathToFileURL(file).href;
  const actor=event=>{
    const owner=owners.get(event.sender.id);
    if(!owner||owner.signal.aborted||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==url)throw new Error('Invalid credential window');
    return owner;
  };
  ipcMain.handle('deepseek-settings:status',event=>service.status(actor(event).id));
  ipcMain.handle('deepseek-settings:save',async(event,key)=>{
    const owner=actor(event);
    try {
      if(typeof key!=='string'||!key.trim())throw new Error('请输入 API Key。');
      service.cancel(owner.id);
      await credentials.write(owner.id,key.trim(),()=>actor(event));await service.changed(owner.id);
      return {ok:true};
    }catch{return {ok:false,message:'密钥保存失败。请检查格式及系统加密是否可用。'};}
  });
  ipcMain.handle('deepseek-settings:clear',async event=>{
    const owner=actor(event);
    try{service.cancel(owner.id);await credentials.write(owner.id,'',()=>actor(event));await service.changed(owner.id);return {ok:true};}
    catch{return {ok:false,message:'移除密钥失败，请稍后重试。'};}
  });
  ipcMain.handle('deepseek-settings:test',async event=>{
    const owner=actor(event),controller=new AbortController(),abort=()=>controller.abort();
    owner.signal.addEventListener('abort',abort,{once:true});owner.window.once('closed',abort);
    const timeout=setTimeout(abort,15000);
    try {
      const key=await credentials.read(owner.id);if(!key)return {ok:false,message:'请先保存 API Key。'};
      const response=await service.fetchImpl('https://api.deepseek.com/models',{headers:{Authorization:'Bearer '+key},redirect:'error',signal:controller.signal});
      await response.body?.cancel().catch(()=>{});
      return response.ok?{ok:true,message:'连接成功，密钥已通过验证。'}:{ok:false,message:response.status===401?'API Key 无效，请重新填写。':'连接验证失败（HTTP '+response.status+'）。'};
    }catch{return {ok:false,message:'无法连接 DeepSeek，请检查网络后重试。'};}
    finally{clearTimeout(timeout);owner.signal.removeEventListener('abort',abort);owner.window.removeListener('closed',abort);}
  });
  return ({id,signal})=>{
    if(signal.aborted)return;
    const previous=windows.get(id);if(previous&&!previous.isDestroyed()){previous.show();previous.focus();return;}
    const window=new BrowserWindow({show:false,backgroundColor:'#1b2028',width:470,height:540,useContentSize:true,resizable:false,title:'DeepSeek 连接设置',autoHideMenuBar:true,
      webPreferences:{partition:'deepseek-settings-'+randomUUID(),preload:path.join(root,'electron','plugins','deepseek-settings-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,devTools:false}});
    const owner={id,signal,window};windows.set(id,window);owners.set(window.webContents.id,owner);
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.webContents.once('did-stop-loading',()=>applyCredentialTheme(window,getTheme()));
    const allowed=new Set(['theme.css','deepseek-settings.html','deepseek-settings.css','deepseek-settings.js'].map(name=>pathToFileURL(path.join(root,'electron','plugins',name)).href));
    window.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed.has(details.url)}));
    const close=()=>{if(!window.isDestroyed())window.close();};signal.addEventListener('abort',close,{once:true});
    const senderId=window.webContents.id;
    window.once('closed',()=>{signal.removeEventListener('abort',close);windows.delete(id);owners.delete(senderId);});
    window.once('ready-to-show',()=>{if(!signal.aborted)window.show();});
    void window.loadFile(file).catch(close);
  };
}
