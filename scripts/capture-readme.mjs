// pnpm build && pnpm exec electron scripts/capture-readme.mjs
// Captures real UI with a disposable library and synthetic feature data.
// Requires the local public/models/amiya fixture; never reads the user's profile.
import { app, BrowserWindow, dialog } from 'electron';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs', 'images');
const local = path.join(root, '.local', 'readme-capture');
await mkdir(local, { recursive: true });
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(local, 'profile-'));
app.setPath('userData', profile);
process.env.PET_TEST_PROFILE = profile;
for (const key of ['VITE_DEV_SERVER_URL', 'V311_SMOKE_DIR', 'SETTINGS_CAPTURE_PATH', 'PET_CAPTURE_PATH', 'PET_CAPTURE_SERIES_DIR']) delete process.env[key];
await writeFile(path.join(profile, 'feature-settings.json'), JSON.stringify({ music: false, notifications: false, codex: false }));
app.commandLine.appendSwitch('mute-audio');
app.on('browser-window-created', (_, window) => window.setOpacity(0));
dialog.showOpenDialog = async (_window,options) => ({ canceled: false, filePaths: [options?.title==='导入插件 ZIP'?path.join(root,'release','plugins','Weather-Plugin-v1.1.0.zip'):path.join(root, 'public', 'models', 'amiya')] });
dialog.showMessageBox=async()=>({response:0});
await import('../electron/main.mjs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(150); }
  throw new Error(`Timed out: ${label}`);
}
void app.whenReady().then(async () => {
  const watchdog = setTimeout(() => app.exit(1), 90000);
  try {
    let manager;
    await waitFor(() => {
      manager = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('settings.html'));
      return manager && !manager.webContents.isLoading();
    }, 'manager');
    manager.setContentSize(980, 1000);
    const run = code => manager.webContents.executeJavaScript(code);
    const scrollTo = selector => run(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      const nav = document.querySelector('.tabs').getBoundingClientRect().height;
      window.scrollTo({top:scrollY + target.getBoundingClientRect().top - nav - 24,behavior:'instant'});
    })()`);
    await waitFor(() => run("!!document.querySelector('[data-settings]')"), 'library');
    const capture = async (name, endSelector, startSelector) => {
      await delay(350);
      const rect = endSelector ? await run(`(() => {
        const end = document.querySelector(${JSON.stringify(endSelector)}).getBoundingClientRect().bottom;
        const start = ${startSelector ? `document.querySelector(${JSON.stringify(startSelector)}).getBoundingClientRect().top - 12` : '0'};
        const y = Math.max(0,Math.floor(start));
        return {x:0,y,width:innerWidth,height:Math.min(innerHeight,Math.ceil(end + 20)) - y};
      })()`) : undefined;
      const png = await manager.webContents.capturePage(rect);
      await writeFile(path.join(output, name + '.png'), png.toPNG());
      console.log('Captured', name);
    };
    await run("document.querySelector('[data-page=import]').click(); document.querySelector('#character-name').value='阿米娅 · 导入示例'; document.querySelector('#choose-model-folder').click()");
    await waitFor(() => run("!!document.querySelector('#model-file').value && !document.querySelector('#import-preview .preview-status').textContent"), 'model preview');
    await scrollTo('#page-import .section-heading');
    await capture('v3-import-model');
    await scrollTo('#import-form .form-card:nth-child(4)');
    await capture('v3-import-voice', '#audio-list');
    await scrollTo('#import-form .form-card:nth-child(5)');
    await capture('v3-import-preview');
    await run("document.querySelector('#import-submit').click()");
    await waitFor(() => run("document.querySelectorAll('[data-settings]').length===2"), 'imported library');
    await run("document.querySelector('[data-page=characters]').click()");
    await capture('v3-character-library', '#character-list');
    await run("document.querySelector('[data-settings]').click()");
    await waitFor(() => run("!document.querySelector('#save-character-parameters').disabled && !document.querySelector('#library-preview .preview-status').textContent"), 'parameter preview');
    await scrollTo('#character-settings');
    await capture('v3-character-settings', '#character-settings');

    await run("document.querySelector('[data-page=features]').click()");
    // Read the disabled, disposable host's registry. Do not start real adapters.
    const demo = await run('window.featureSettings.get()');
    demo.plugins = demo.plugins.map(plugin => ({ ...plugin, enabled: true, runtime: 'active',
      message: plugin.manifest.icon === 'music' ? '等待播放器' : plugin.manifest.icon === 'codex' ? '等待 Codex 启动' : '等待新通知' }));
    manager.webContents.send('features:state', demo);
    await capture('v3-feature-settings', '#feature-compatibility');
    await scrollTo('#page-features .feature-options:nth-of-type(3)');
    await capture('v3-reminder-settings', '#feature-apps', '#page-features .feature-options:nth-of-type(3)');
    assert.equal(await run("document.querySelectorAll('[data-feature-setting]').length + document.querySelectorAll('#feature-modules [data-plugin-enabled]').length"), 7);
    await run("document.querySelector('[data-page=extensions]').click()");
    await run("document.querySelector('#plugin-import').click()");
    await waitFor(()=>run("document.querySelector('[data-plugin-details=\"local.spine-weather\"]')!==null"),'weather plugin installed');
    await run("window.scrollTo({top:0,behavior:'instant'})");
    await capture('v322-plugin-import');
    await run("document.querySelector('[data-plugin-details=\"local.spine-weather\"]').open=true");
    await scrollTo('[data-plugin-details="local.spine-weather"]');
    await capture('v322-weather-settings',undefined,'[data-plugin-details="local.spine-weather"]');
    console.log('README UI screenshots complete; disposable profile only.');
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
  finally { clearTimeout(watchdog); }
});
