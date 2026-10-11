// Run after pnpm build: pnpm exec electron scripts/smoke-v231.mjs
// Uses disposable local profiles and source fixtures, never the user's pet library.
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".local", "smoke-v231");
await mkdir(output, {recursive: true});
const profile = await mkdtemp(path.join(output, "profile-"));
app.setPath("userData", profile);
process.env.PET_TEST_PROFILE = profile;
await writeFile(path.join(profile, "feature-settings.json"), JSON.stringify({music: false, notifications: false, codex: false}));
delete process.env.VITE_DEV_SERVER_URL;
app.commandLine.appendSwitch("mute-audio");
app.on("browser-window-created", (_, win) => {
  win.setOpacity(0);
  win.webContents.on("console-message", event => { if (event.level >= 2) console.log("renderer:", event.message); });
});
let chosenPath = path.join(root, "public", "models", "amiya");
dialog.showOpenDialog = async () => ({canceled: false, filePaths: [chosenPath]});
const directions = [];
ipcMain.on("pet:set-walking", (_, enabled, direction) => { if (enabled) directions.push(direction); });
await import("../electron/main.mjs");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (probe, label) => {
  console.log('wait:',label);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { try { if (await probe()) return; } catch {} await pause(150); }
  throw new Error(`Timed out: ${label}`);
};
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => { console.error("Smoke test watchdog timed out"); app.exit(1); }, 90000);
  try {
    let settings, pet;
    await wait(() => {
      settings = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("settings.html"));
      pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("index.html"));
      return settings && pet && !settings.webContents.isLoading() && !pet.webContents.isLoading();
    }, "windows");
    const run = async script => {
      try { return await settings.webContents.executeJavaScript(script); }
      catch (error) { throw new Error(`Renderer call failed: ${script.slice(0, 220)}; ${error}`); }
    };
    const bridge = async (method, ...args) => {
      console.log("check:", method);
      const result = await run(`window.petSettings.${method}(...${JSON.stringify(args)})`);
      console.log("done:", method); return result;
    };
    await wait(() => pet.webContents.executeJavaScript('document.querySelector("#loading-status").classList.contains("hidden")'), "pet model");
    await wait(() => run("!!document.querySelector('[data-settings]')"), "character cards");
    await run("document.querySelector('[data-settings]').click()");
    await wait(() => run('!document.querySelector("#save-character-parameters").disabled && !document.querySelector("#library-preview .preview-status").textContent'), "library preview");
    assert.equal(await run("document.querySelectorAll('[data-parameter=walkDirection]').length"),0);
    const previewSize=await run("(()=>{const s=document.querySelector('#library-preview .preview-stage'),c=s.querySelector('canvas');return {width:s.clientWidth,height:s.clientHeight,canvasWidth:c.clientWidth}})()");
    assert.equal(previewSize.width,252);assert.equal(previewSize.height,300);assert.equal(previewSize.canvasWidth,252);
    assert.ok(Math.abs(previewSize.width-pet.getBounds().width)<=1);
    assert.equal(await run("getComputedStyle(document.querySelector('#library-parameters [type=range][data-parameter=bubbleOffsetY]')).direction"),'ltr');
    await run("{const r=document.querySelector('#library-parameters [type=range][data-parameter=bubbleOffsetY]');r.value='50';r.dispatchEvent(new Event('input',{bubbles:true}));}");
    assert.equal(await run("document.querySelector('#library-parameters [type=number][data-parameter=bubbleOffsetY]').value"),'-50');
    assert.ok(await run("document.querySelector('#library-history').getBoundingClientRect().top>=document.querySelector('#library-preview').getBoundingClientRect().bottom"));
    assert.ok(await run("!!document.querySelector('#library-history [data-history=undo] svg')"));
    await run("document.querySelector('#library-history [data-history=undo]').click()");
    await run("{const r=document.querySelector('#library-parameters [type=range][data-parameter=modelScalePercent]');r.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));r.value='70';r.dispatchEvent(new Event('input',{bubbles:true}));r.value='80';r.dispatchEvent(new Event('input',{bubbles:true}));window.dispatchEvent(new PointerEvent('pointerup'));document.querySelector('#library-history [data-history=undo]').click();}");
    assert.equal(await run("document.querySelector('#library-preview .preview-stage').clientWidth"),252);
    await run("document.querySelector('#library-history [data-history=redo]').click()");
    assert.equal(await run("document.querySelector('#library-preview .preview-stage').clientWidth"),336);
    await run("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))");
    assert.equal(await run("document.querySelector('#library-parameters [type=number][data-parameter=modelScalePercent]').value"),'60');
    await run("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true}))");
    assert.equal(await run("document.querySelector('#library-parameters [type=number][data-parameter=modelScalePercent]').value"),'80');
    await run("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))");
    assert.deepEqual(await run("Array.from(document.querySelectorAll('.tab')).slice(0,3).map(tab => tab.dataset.page)"), ["characters", "help", "import"]);
    await run(`(() => { const input = document.querySelector('#library-parameters input[type=number][data-parameter=audioStartOffsetMs]'); input.value = '250'; input.dispatchEvent(new Event('input', {bubbles: true})); })()`);
    assert.equal(await run("document.querySelector('#library-parameters input[type=range][data-parameter=audioStartOffsetMs]').value"), "250");
    const saved = await bridge("saveParameters", "builtin-amiya", {schemaVersion: 1, audioOffsetMs: 250, bubbleOffsetY: 55, walkDirection: "random", extensions: {future: "preserved"}});
    assert.equal(saved.ok, true);
    assert.equal(saved.parameters.audioStartOffsetMs, 250); assert.equal(saved.parameters.audioEndOffsetMs, 250);
    await wait(async () => (await pet.webContents.executeJavaScript('parseFloat(document.querySelector("#speech-bubble").style.top)')) === 73, "live bubble update");
    await run('document.querySelector("[data-page=import]").click(); document.querySelector("#choose-model-folder").click()');
    await wait(() => run('!!document.querySelector("#model-file").value && !document.querySelector("#import-preview .preview-status").textContent'), "import preview");
    await run("{const i=document.querySelector('#import-parameters [type=number][data-parameter=fontSizePx]');i.focus();i.value='18';i.dispatchEvent(new Event('input',{bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));}");
    assert.equal(await run("document.querySelector('#import-parameters [type=number][data-parameter=fontSizePx]').value"),'13');
    await run("window.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true}))");
    assert.equal(await run("document.querySelector('#import-parameters [type=number][data-parameter=fontSizePx]').value"),'18');
    await run("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))");
    const folder = await bridge("chooseModelFolder");
    const model = folder.modelFiles.find(file => file.endsWith(".skel"));
    const atlas = folder.atlasFiles.find(file => file.replace(/\.atlas$/i, "") === model.replace(/\.skel$/i, "")) ?? folder.atlasFiles[0];
    await assert.rejects(() => bridge("previewModel", {modelFolder: root, modelFile: "package.json", atlasFile: atlas}));
    const preview = await bridge("previewModel", {modelFolder: folder.folderPath, modelFile: model, atlasFile: atlas});
    assert.equal(await run(`fetch(${JSON.stringify(preview.modelUrl)}).then(r => r.status)`), 200);
    assert.equal(await run(`fetch(${JSON.stringify(new URL("/999", preview.modelUrl).href)}).then(r => r.status)`), 404);
    await writeFile(path.join(output, "import-preview.png"), (await settings.webContents.capturePage()).toPNG());
    const manifestRoot = path.join(root, "public", "voicepacks", "amiya-base", "ja-JP");
    const manifest = JSON.parse(await readFile(path.join(manifestRoot, "manifest.json"), "utf8"));
    const voice = manifest.lines[0];
    const imported = await bridge("importCharacter", {name: "校准测试角色", modelFolder: folder.folderPath, modelFile: model, atlasFile: atlas, animations: {},
      parameters: {audioOffsetMs: -120, bubbleOffsetY: 40, walkDirection: "right"}, voices: [{sourcePath: path.join(manifestRoot, voice.audio), subtitle: voice.subtitle}]});
    assert.equal(imported.ok, true);
    assert.equal((await bridge("getCharacterConfig", imported.id)).parameters.audioOffsetMs, -120);
    await bridge("activateCharacter", "builtin-amiya");
    const builtin = await bridge("getCharacterConfig", "builtin-amiya");
    assert.equal(builtin.parameters.audioOffsetMs, 250); assert.equal(builtin.parameters.extensions.future, "preserved");
    const characterPath = path.join(profile, "characters", imported.id, "character.json");
    const legacy = JSON.parse(await readFile(characterPath, "utf8")); delete legacy.parameters;
    await writeFile(characterPath, JSON.stringify(legacy), "utf8");
    assert.equal((await bridge("getCharacterConfig", imported.id)).parameters.walkDirection, undefined);
    await bridge("saveParameters", imported.id, {audioOffsetMs: 100, bubbleOffsetY: 30, walkDirection: "left"});
    assert.equal(JSON.parse(await readFile(characterPath, "utf8")).parameters.bubbleOffsetY, 30);
    const subtitleConfig = path.join(profile, "subtitles.json");
    await writeFile(subtitleConfig, JSON.stringify({charWords: {char_test_CN_001: {voiceText: "试听测试", voiceTitle: "测试分句"}}}));
    const timingConfig = path.join(profile, "timings.json");
    await writeFile(timingConfig, JSON.stringify({data: {char_test: {variations: {JP: {duration: 3, clips: [{name: "CN_001", start: 0.2}]}}}}}));
    chosenPath = path.join(manifestRoot, voice.audio); await bridge("chooseLongVoiceFile");
    chosenPath = timingConfig; await bridge("chooseVoiceConfigFile", "metadata");
    chosenPath = subtitleConfig; await bridge("chooseVoiceConfigFile", "subtitles");
    const audition = await bridge("previewVoice", {audioPath: path.join(manifestRoot, voice.audio), characterId: "char_test", language: "JP", metadataPath: timingConfig, subtitlePath: subtitleConfig});
    assert.equal(audition.lines[0].start, 0.2);
    assert.equal(await run(`fetch(${JSON.stringify(audition.audioUrl)}).then(r => r.status)`), 200);
    chosenPath = path.join(manifestRoot, voice.audio);
    await run("document.querySelector('#choose-long-voice').click()");
    await wait(() => run("document.querySelector('#bundle-audio-summary').classList.contains('selected')"), "audio selection");
    chosenPath = timingConfig;
    await run("document.querySelector('[data-config-kind=metadata]').click()");
    await wait(() => run("document.querySelector('#config-metadata-summary').textContent === 'timings.json'"), "timing selection");
    chosenPath = subtitleConfig;
    await run("document.querySelector('[data-config-kind=subtitles]').click()");
    await wait(() => run("document.querySelector('#config-subtitles-summary').textContent === 'subtitles.json'"), "subtitle selection");
    await run(`(() => {
      const NativeAudio = window.Audio;
      window.Audio = function(...args) { const audio = new NativeAudio(...args); window.testAudio = audio; return audio; };
      document.querySelector('#bundle-character-id').value = 'char_test';
      const offset = document.querySelector('#import-parameters input[type=number][data-parameter=audioStartOffsetMs]');
      offset.value = '500'; offset.dispatchEvent(new Event('input', {bubbles: true}));
      const end = document.querySelector('#import-parameters input[type=number][data-parameter=audioEndOffsetMs]');
      end.value = '-1800'; end.dispatchEvent(new Event('input', {bubbles: true}));
      document.querySelector('#prepare-voice-preview').click();
    })()`);
    await wait(() => run("!!document.querySelector('#import-voice-controls select')"), "audition controls");
    await run("document.querySelector('#import-voice-controls button').click()");
    await wait(() => run("window.testAudio && !window.testAudio.paused && window.testAudio.currentTime >= 0.7"), "calibrated audition playback");
    await wait(() => run("window.testAudio.paused"), "independent audition end boundary");
    assert.ok(await run("window.testAudio.currentTime <= 1.25"));
    await run("document.querySelector('#import-voice-controls button:nth-of-type(2)').click()");
    await run("document.querySelector('#import-preview').scrollIntoView({block:'center',behavior:'instant'})");
    await pause(100);
    await writeFile(path.join(output, "import-preview.png"), (await settings.webContents.capturePage()).toPNG());
    await wait(() => pet.webContents.executeJavaScript('document.querySelector("#loading-status").classList.contains("hidden")'), "reactivated model");
    await pet.webContents.executeJavaScript("Math.random = () => 0.1; void 0");
    pet.webContents.send("pet:command", {type: "action", action: "walk"}); await pause(100);
    await pet.webContents.executeJavaScript("Math.random = () => 0.9; void 0");
    pet.webContents.send("pet:command", {type: "action", action: "walk"}); await pause(100);
    assert.deepEqual(directions.slice(-2), [-1, 1]);
    await pet.webContents.executeJavaScript("Math.random = () => 0.1; void 0");
    pet.webContents.send("pet:command", {type: "action", action: "walk"}); await pause(100);
    const beforeAutonomous = directions.length;
    const names = await run("Array.from(document.querySelector('#library-preview .preview-animations').options).map(option => option.value.toLowerCase())");
    const candidates = {idle: ["relax", "idle", "default"], walk: ["move", "walk"], sit: ["sit"], sleep: ["sleep", "lie"], special: ["special"]};
    const weighted = ["idle", "idle", "idle", "idle", "idle", "walk", "sit", "sit", "sleep", "special"]
      .filter(action => names.some(name => candidates[action].some(candidate => name.includes(candidate))));
    const selectWalk = (weighted.indexOf("walk") + 0.5) / weighted.length;
    assert.ok(selectWalk > 0.5);
    await pet.webContents.executeJavaScript(`(() => {
      const nativeTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay >= 24000 && delay <= 48000 ? 30 : delay, ...args);
      Math.random = () => ${selectWalk};
    })()`);
    pet.webContents.send("pet:command", {type: "action", action: "idle"});
    await wait(() => directions.length > beforeAutonomous, "autonomous walking");
    assert.equal(directions[beforeAutonomous], 1);
    const resizeResult = await bridge("saveParameters", "builtin-amiya", {modelScalePercent: 30, fontSizePx: 13, bubbleTransparency: 65, walkDirection: "none"});
    assert.equal(resizeResult.ok, true);
    // Windows fractional display scaling can round a logical width by one pixel.
    await wait(() => Math.abs(pet.getBounds().width - 126) <= 1, "small per-character pet");
    await pause(300);
    const smallFont = await pet.webContents.executeJavaScript("parseFloat(getComputedStyle(document.querySelector('#speech-bubble')).fontSize)");
    assert.ok(smallFont < 13);
    assert.equal(await pet.webContents.executeJavaScript("document.querySelector('#speech-bubble').style.getPropertyValue('--bubble-alpha')"), "0.35");
    const countBeforeLegacyWalk = directions.length;
    pet.webContents.send("pet:command", {type: "action", action: "walk"});
    await pause(300);assert.ok(directions.length>countBeforeLegacyWalk);
    await bridge("saveParameters", "builtin-amiya", {modelScalePercent: 120, fontSizePx: 17});
    await wait(() => Math.abs(pet.getBounds().width - 504) <= 1, "large per-character pet"); await pause(200);
    const largeFont = await pet.webContents.executeJavaScript("parseFloat(getComputedStyle(document.querySelector('#speech-bubble')).fontSize)");
    assert.ok(largeFont > smallFont);
    await bridge("activateCharacter", imported.id);
    await wait(() => Math.abs(pet.getBounds().width - 252) <= 1, "other character keeps own size");
    await wait(() => !pet.webContents.isLoading() && pet.webContents.executeJavaScript('document.querySelector("#loading-status")?.classList.contains("hidden")'), "other character model after resize");
    await bridge("activateCharacter", "builtin-amiya");
    await wait(() => Math.abs(pet.getBounds().width - 504) <= 1, "size restored after character switch");
    await wait(() => !pet.webContents.isLoading() && pet.webContents.executeJavaScript('document.querySelector("#loading-status")?.classList.contains("hidden")'), "resized model");
    await run("document.querySelector('[data-page=characters]').click(); document.querySelector('[data-settings]').click()");
    await wait(() => run('!document.querySelector("#library-preview .preview-status").textContent'), "final preview");
    await writeFile(path.join(output, "character-settings.png"), (await settings.webContents.capturePage()).toPNG());
    await bridge("deleteCharacter", imported.id);
    console.log(JSON.stringify({ok: true, checks: ["native-size preview", "grouped undo and redo", "Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y in both editors", "reversed bubble slider", "retired direction parameter", "settings sliders", "navigation order", "live bubble", "import preview", "restricted asset access", "per-character persistence", "legacy migration", "future fields", "calibrated audition playback", "manual and autonomous left/right walking", "scaling fonts and opacity", "per-character size persistence"], profile}));
    clearTimeout(watchdog); app.exit(0);
  } catch (error) {
    console.error(error);
    const settings = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("settings.html"));
    if (settings) console.error(await settings.webContents.executeJavaScript('({model: document.querySelector("#model-summary").textContent, preview: document.querySelector("#import-preview .preview-status").textContent, parameters: document.querySelector("#parameters-status").textContent})'));
    const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("index.html"));
    if (pet) console.error("pet-bounds", pet.getBounds());
    clearTimeout(watchdog); app.exit(1);
  }
});
