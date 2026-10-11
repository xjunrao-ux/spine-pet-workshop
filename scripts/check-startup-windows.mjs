// Read-only: set PET_STARTUP_CHECK_PATH and isolated PET_TEST_PROFILE, then
// pnpm exec electron scripts/check-startup-windows.mjs
import { app } from 'electron';
import assert from 'node:assert/strict';
import { createStartupSettings } from '../electron/startup.mjs';
if (process.platform !== 'win32' || !process.env.PET_STARTUP_CHECK_PATH || !process.env.PET_TEST_PROFILE) {
  console.error('Windows, PET_STARTUP_CHECK_PATH and an isolated PET_TEST_PROFILE are required.'); app.exit(1);
} else {
  app.setPath('userData', process.env.PET_TEST_PROFILE);
  const watchdog=setTimeout(()=>{console.error('Startup read-only check timed out');app.exit(1);},15000);
  void app.whenReady().then(()=>{
  app.setAppUserModelId('local.spine.desktop.pet.workshop');
  try {
    const executable=process.env.PET_STARTUP_CHECK_PATH;
    const login=app.getLoginItemSettings({path:'"'+executable+'"',args:['--autostart']});
    const own=login.launchItems.find(item=>item.name==='SpinePetWorkshop' && item.scope==='user');
    const api=createStartupSettings({isPackaged:true,getLoginItemSettings:options=>app.getLoginItemSettings(options),
      setLoginItemSettings:()=>{throw new Error('Read-only diagnostic');}},{env:{},executable});
    const state=api.get(); assert.equal(state.supported,true);
    assert.equal(state.enabled,Boolean(own?.enabled));
    console.log(JSON.stringify({ok:true,defaultOpenAtLogin:login.openAtLogin,ownEntryPresent:Boolean(own),ownEntryEnabled:Boolean(own?.enabled),reportedArgs:own?.args,correctedState:state.enabled,registryWrites:0})); app.quit();
  } catch(error){console.error(error);app.exit(1);} finally{clearTimeout(watchdog);}
  });
}
