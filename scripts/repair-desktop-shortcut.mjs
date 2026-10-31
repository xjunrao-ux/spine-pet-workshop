import {app,shell} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {access,copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createWindowBranding} from '../electron/window-branding.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const toolRoot=path.join(root,'.local','desktop-shortcut-repair');
app.setPath('userData',path.join(toolRoot,'tool-profile'));
const valueAfter=flag=>{const index=process.argv.indexOf(flag);return index>=0?process.argv[index+1]:undefined;};
const shortcutPath=path.resolve(valueAfter('--shortcut-file')||path.join(app.getPath('desktop'),'SpinePet.lnk'));
const target=path.join(root,'node_modules','electron','dist','electron.exe');
const branding=createWindowBranding(app,{rootDirectory:root,shell,executable:target,iconDirectory:path.join(app.getPath('appData'),'spine-pet-workshop','shell-icons')});
const desired={target,args:`"${root}"`,cwd:root,icon:branding.iconPath,iconIndex:0,appUserModelId:branding.appId,description:'SpinePet 本地启动版'};
const samePath=(a,b)=>path.win32.normalize(a||'').toLowerCase()===path.win32.normalize(b||'').toLowerCase();

void app.whenReady().then(async()=>{try{
  for(const file of [target,desired.icon,path.join(root,'dist','settings.html')])await access(file);
  if(path.extname(shortcutPath).toLowerCase()!=='.lnk')throw new Error('只接受 .lnk 快捷方式');
  const before=shell.readShortcutLink(shortcutPath);
  const owned=path.win32.basename(before.target).toLowerCase()==='spinepet.exe'||
    (path.win32.basename(before.target).toLowerCase()==='electron.exe'&&before.args.includes(root))||
    samePath(before.target,path.join(root,'启动桌宠.cmd'));
  if(!owned)throw new Error('该快捷方式不属于此桌宠，未作修改');
  const needsUpdate=!samePath(before.target,desired.target)||before.args!==desired.args||!samePath(before.cwd,desired.cwd)||!samePath(before.icon,desired.icon)||before.iconIndex!==0||before.appUserModelId!==desired.appUserModelId;
  await mkdir(toolRoot,{recursive:true});
  let backup;
  if(needsUpdate){
    backup=path.join(toolRoot,`SpinePet-before-${randomUUID()}.lnk`);
    await copyFile(shortcutPath,backup);
    try{
      if(!shell.writeShortcutLink(shortcutPath,'update',desired))throw new Error('快捷方式写入失败');
      const verified=shell.readShortcutLink(shortcutPath);
      if(!samePath(verified.target,desired.target)||verified.args!==desired.args||!samePath(verified.cwd,desired.cwd)||!samePath(verified.icon,desired.icon)||verified.iconIndex!==0||verified.appUserModelId!==desired.appUserModelId)throw new Error('快捷方式写入后校验失败');
    }catch(error){await copyFile(backup,shortcutPath);throw error;}
  }
  await promisify(execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','notify-shortcut.ps1'),'-ShortcutPath',shortcutPath],{windowsHide:true,timeout:10000});
  const startMenuShortcut=branding.registerSourceShortcut();
  const after=shell.readShortcutLink(shortcutPath);
  const iconHeader=await readFile(desired.icon);if(iconHeader.readUInt16LE(2)!==1||iconHeader.readUInt16LE(4)<1)throw new Error('图标文件格式无效');
  const report={ok:true,updated:needsUpdate,shortcutPath,startMenuShortcut,backup,before,after,iconImages:iconHeader.readUInt16LE(4)};
  await writeFile(path.join(toolRoot,'repair.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));app.exit(0);
}catch(error){console.error(error);app.exit(1);}});
