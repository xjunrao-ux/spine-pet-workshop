import {themeVariables,normalizeTheme} from './themes.mjs';
const windows=new WeakMap();
export function applyCredentialTheme(window,id) {
 if(!window||window.isDestroyed()||window.webContents.isLoadingMainFrame())return;
 const settings=id&&typeof id==='object'?id:{theme:id};
 const theme=normalizeTheme(settings.theme),variables=themeVariables(theme,settings.customTheme),signature=JSON.stringify(variables),previous=windows.get(window);
 if(previous?.signature===signature)return;
 window.setBackgroundColor(variables['--page-bg']);
 const entry={signature,key:null};windows.set(window,entry);
 const css=':root{'+Object.entries(variables).map(([k,v])=>k+':'+v+'!important').join(';')+'}';
 void (async()=>{
  try{const key=await window.webContents.insertCSS(css);if(window.isDestroyed())return;
   if(windows.get(window)!==entry){await window.webContents.removeInsertedCSS(key);return;}
   entry.key=key;if(previous?.key)await window.webContents.removeInsertedCSS(previous.key);
  }catch(error){console.warn('Theme stylesheet could not be applied:',error.message);}
 })();
}
