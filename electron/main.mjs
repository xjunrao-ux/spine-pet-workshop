import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, screen, shell, Tray } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import readline from "node:readline";
import { parseArkVoiceBundle } from "./voice-bundle.mjs";
import { ExtensionService } from "./extensions/extension-service.mjs";
import { createExtensionOverlay } from "./extensions/overlay.mjs";
import { normalizeParameters, mergeParameters } from "./character-parameters.mjs";
import { createStartupSettings } from "./startup.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.PET_TEST_PROFILE) app.setPath("userData", path.resolve(process.env.PET_TEST_PROFILE));
const APP_ICON_PATH = path.join(rootDirectory, "assets", "amiya-app-icon.png");
const BASE_WIDTH = 420;
const BASE_HEIGHT = 500;
const GRAVITY = 1850;
const WALK_SPEED = 34;
const WALK_ACCELERATION = 5.5;
const WINDOW_SNAP_ABOVE = 20;
const WINDOW_SNAP_BELOW = 48;
const SIT_SURFACE_LIFT_RATIO = 0.02;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
protocol.registerSchemesAsPrivileged([
  { scheme: "pet-preview", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  {
    scheme: "pet-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
]);

let mainWindow;
let settingsWindow;
let tray;
let monitorProcess;
let desktopWindows = [];
let physicsTimer;
let dragTimer;
let floatingPosition = { x: 0, y: 0 };
let verticalVelocity = 0;
let horizontalVelocity = 0;
let walking = false;
let direction = -1;
let dragging = false;
let gravityEnabled = true;
let edgeSnapEnabled = true;
let alwaysOnTop = true;
let voiceEnabled = true;
let petScale = 0.6;
let activeCharacterParameters = normalizeParameters();
let supportRatio = 1;
let groundedWindow;
let lastPhysicsTime = performance.now();
let monitorSampleLogged = false;
let activeCharacterName = "阿米娅";
let extensionService;
let extensionOverlay;
let featureInteraction = false;
const previewAssets = new Map();
const selectedPreviewFolders = new Set();
const selectedPreviewFiles = new Set();

function grantPreviewAssets(kind, files) {
  for (const [token, grant] of previewAssets) if (grant.kind === kind) previewAssets.delete(token);
  const token = randomUUID();
  previewAssets.set(token, { kind, files });
  return (index) => `pet-preview://${token}/${index}${path.extname(files[index]).toLowerCase()}`;
}

function requireSettingsSender(event) {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) throw new Error("无效的设置窗口请求");
}

async function previewModel(payload) {
  const root = path.resolve(String(payload?.modelFolder ?? ""));
  if (!selectedPreviewFolders.has(root)) throw new Error("请先选择模型文件夹");
  const files = await walkFiles(root);
  const model = String(payload.modelFile).split("/").join(path.sep);
  const atlas = String(payload.atlasFile).split("/").join(path.sep);
  if (!files.includes(model) || !SKELETON_EXTENSIONS.has(path.extname(model).toLowerCase()) ||
      !files.includes(atlas) || path.extname(atlas).toLowerCase() !== ".atlas") throw new Error("请选择有效的骨骼和图集文件");
  const atlasText = await readFile(path.join(root, atlas), "utf8");
  const textures = files.filter(file => TEXTURE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const paths = [path.join(root, model)];
  const mapping = {};
  for (const page of atlasPageNames(atlasText)) {
    const texture = resolveAtlasTexture(atlas, page, textures);
    if (!texture) throw new Error(`无法唯一匹配贴图：${page}`);
    mapping[page] = paths.push(path.join(root, texture)) - 1;
  }
  if (!selectedPreviewFolders.has(root) || !settingsWindow) throw new Error("模型预览已取消");
  const url = grantPreviewAssets("model", paths);
  return { id: "preview", name: "导入预览", builtin: false, modelUrl: `${url(0)}?format=${path.extname(model).slice(1).toLowerCase()}`, atlasText,
    textureUrls: Object.fromEntries(Object.entries(mapping).map(([page, index]) => [page, url(index)])) };
}

async function previewVoice(payload) {
  const audioPath = path.resolve(String(payload?.audioPath ?? ""));
  if (!selectedPreviewFiles.has(audioPath) || !AUDIO_EXTENSIONS.has(path.extname(audioPath).toLowerCase())) throw new Error("请先选择长音频");
  const dataFile = (file, fallback) => {
    if (!file) return bundledArkDataPath(fallback);
    const resolved = path.resolve(String(file));
    if (!selectedPreviewFiles.has(resolved)) throw new Error("请先选择配置文件");
    return resolved;
  };
  const voiceData = await readJson(dataFile(payload.metadataPath, "voice_data.json"), undefined);
  const subtitles = await readJson(dataFile(payload.subtitlePath, "charword_table.json"), undefined);
  const lines = parseArkVoiceBundle(voiceData, subtitles, payload.characterId, payload.language, "audio");
  if (!selectedPreviewFiles.has(audioPath) || !settingsWindow) throw new Error("语音预览已取消");
  const audioUrl = grantPreviewAssets("voice", [audioPath])(0);
  return { lines, audioUrl };
}

async function saveCharacterParameters(id, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("参数格式不正确");
  if (JSON.stringify(patch).length > 16384) throw new Error("参数数据过大");
  const preferences = await readPreferences();
  let parameters;
  if (id === BUILTIN_CHARACTER.id) {
    parameters = mergeParameters(preferences.characterParameters?.[id], patch);
    await writeFile(preferencesPath(), JSON.stringify({ ...preferences,
      characterParameters: { ...preferences.characterParameters, [id]: parameters } }, null, 2), "utf8");
  } else {
    const profile = await readCustomCharacter(id);
    if (!profile) throw new Error("没有找到该角色");
    parameters = mergeParameters(profile.parameters, patch);
    await writeFile(path.join(charactersDirectory(), id, "character.json"), JSON.stringify({ ...profile, parameters }, null, 2), "utf8");
  }
  if (preferences.activeCharacterId === id && mainWindow && !mainWindow.isDestroyed()) {
    applyCharacterParameters(parameters);
  }
  return parameters;
}

function applyCharacterParameters(value) {
  activeCharacterParameters = normalizeParameters(value);
  const nextScale = activeCharacterParameters.modelScalePercent / 100;
  if (nextScale !== petScale) setPetScale(nextScale);
  sendCommand({ type: "parameters", parameters: activeCharacterParameters });
}

async function setCharacterScale(nextScale) {
  try {
    const preferences = await readPreferences();
    await saveCharacterParameters(preferences.activeCharacterId, {modelScalePercent: Math.round(nextScale * 100)});
  } catch (error) { dialog.showErrorBox("角色大小保存失败", String(error.message ?? error)); }
}

const BUILTIN_CHARACTER = {
  id: "builtin-amiya",
  name: "阿米娅",
  builtin: true,
  modelFile: "build_char_002_amiya.skel",
  modelUrl: "./models/amiya/build_char_002_amiya.skel",
  voiceManifestUrl: "./voicepacks/amiya-base/ja-JP/manifest.json",
  animations: {}
};
const MODEL_EXTENSIONS = new Set([".skel", ".json", ".atlas", ".png", ".jpg", ".jpeg", ".webp"]);
const SKELETON_EXTENSIONS = new Set([".skel", ".json"]);
const TEXTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
const ACTION_NAMES = new Set(["idle", "walk", "sit", "sleep", "touch", "special"]);

function charactersDirectory() {
  return path.join(app.getPath("userData"), "characters");
}

function preferencesPath() {
  return path.join(app.getPath("userData"), "workshop-settings.json");
}

function bundledArkDataPath(fileName) {
  const dataRoot = app.isPackaged
    ? path.join(rootDirectory, "dist", "ark-data")
    : path.join(rootDirectory, "public", "ark-data");
  return path.join(dataRoot, fileName);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readPreferences() {
  return readJson(preferencesPath(), { activeCharacterId: BUILTIN_CHARACTER.id });
}

async function writePreferences(activeCharacterId) {
  await writeFile(preferencesPath(), JSON.stringify({ ...await readPreferences(), activeCharacterId }, null, 2), "utf8");
}

async function walkFiles(root, relativeDirectory = "") {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function petAssetUrl(characterId, relativePath) {
  const encodedPath = toPortablePath(relativePath).split("/").map(encodeURIComponent).join("/");
  return `pet-asset://${characterId}/${encodedPath}`;
}

function atlasPageNames(atlasText) {
  const lines = atlasText.replace(/\r\n?/g, "\n").split("\n");
  const pages = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const name = lines[index].trim();
    const nextLine = lines[index + 1].trim().toLowerCase();
    if (name && nextLine.startsWith("size:")) pages.push(name);
  }
  return [...new Set(pages)];
}

function comparableStem(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/[#?%].*$/, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function resolveAtlasTexture(atlasFile, pageName, textureFiles) {
  const atlasDirectory = path.dirname(atlasFile);
  const normalizedPage = pageName.replace(/[\\/]+/g, path.sep);
  const expected = path.normalize(path.join(atlasDirectory, normalizedPage));
  const exact = textureFiles.find((file) => file.toLowerCase() === expected.toLowerCase());
  if (exact) return exact;

  const sameDirectory = textureFiles.filter((file) =>
    path.dirname(file).toLowerCase() === atlasDirectory.toLowerCase()
  );
  const pageStem = comparableStem(pageName);
  const atlasStem = comparableStem(atlasFile);
  const stemMatches = sameDirectory.filter((file) => {
    const candidateStem = comparableStem(file);
    return candidateStem === pageStem || candidateStem === atlasStem ||
      (candidateStem.length >= 5 && (pageStem.startsWith(candidateStem) || candidateStem.startsWith(pageStem)));
  });
  if (stemMatches.length === 1) return stemMatches[0];
  if (sameDirectory.length === 1) return sameDirectory[0];
  return undefined;
}

async function getCustomAtlasBundle(profile) {
  const modelRoot = path.join(charactersDirectory(), profile.id, "model");
  const atlasFile = String(profile.atlasFile).split("/").join(path.sep);
  const atlasText = await readFile(path.join(modelRoot, atlasFile), "utf8");
  const modelFiles = await walkFiles(modelRoot);
  const textureFiles = modelFiles.filter((file) => TEXTURE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const textureUrls = {};
  for (const pageName of atlasPageNames(atlasText)) {
    const textureFile = resolveAtlasTexture(atlasFile, pageName, textureFiles);
    if (!textureFile) {
      throw new Error(`atlas 引用的贴图“${pageName}”无法在模型目录中唯一匹配`);
    }
    textureUrls[pageName] = petAssetUrl(profile.id, path.join("model", textureFile));
  }
  return { atlasText, textureUrls };
}

async function readCustomCharacter(characterId) {
  if (!/^[a-z0-9-]+$/i.test(characterId)) return undefined;
  const profilePath = path.join(charactersDirectory(), characterId, "character.json");
  const profile = await readJson(profilePath, undefined);
  if (!profile || profile.id !== characterId) return undefined;
  return profile;
}

async function getCharacterRuntimeConfig(characterId) {
  if (!characterId || characterId === BUILTIN_CHARACTER.id) {
    const preferences = await readPreferences();
    return { ...BUILTIN_CHARACTER, parameters: normalizeParameters(preferences.characterParameters?.[BUILTIN_CHARACTER.id]) };
  }
  const profile = await readCustomCharacter(characterId);
  if (!profile) return BUILTIN_CHARACTER;
  const atlasBundle = await getCustomAtlasBundle(profile);
  return {
    id: profile.id,
    name: profile.name,
    builtin: false,
    modelUrl: petAssetUrl(profile.id, path.join("model", profile.modelFile)),
    atlasUrl: petAssetUrl(profile.id, path.join("model", profile.atlasFile)),
    atlasText: atlasBundle.atlasText,
    textureUrls: atlasBundle.textureUrls,
    voiceManifestUrl: profile.voiceCount > 0 ? petAssetUrl(profile.id, path.join("voice", "manifest.json")) : undefined,
    animations: profile.animations ?? {},
    parameters: normalizeParameters(profile.parameters)
  };
}

async function getActiveCharacterConfig() {
  const preferences = await readPreferences();
  return getCharacterRuntimeConfig(preferences.activeCharacterId);
}

async function listCharacters() {
  const preferences = await readPreferences();
  const items = [{
    id: BUILTIN_CHARACTER.id,
    name: BUILTIN_CHARACTER.name,
    builtin: true,
    active: preferences.activeCharacterId === BUILTIN_CHARACTER.id,
    voiceCount: 10,
    modelFile: BUILTIN_CHARACTER.modelFile
  }];
  let entries = [];
  try {
    entries = await readdir(charactersDirectory(), { withFileTypes: true });
  } catch {
    return items;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profile = await readCustomCharacter(entry.name);
    if (!profile) continue;
    items.push({
      id: profile.id,
      name: profile.name,
      builtin: false,
      active: preferences.activeCharacterId === profile.id,
      voiceCount: profile.voiceCount ?? 0,
      modelFile: profile.modelFile,
      createdAt: profile.createdAt
    });
  }
  return items;
}

async function copyModelFolder(sourceRoot, destinationRoot) {
  const files = await walkFiles(sourceRoot);
  for (const relativePath of files) {
    if (!MODEL_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
    const destination = path.join(destinationRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(sourceRoot, relativePath), destination);
  }
}

function safeAudioName(index, originalName) {
  const extension = path.extname(originalName).toLowerCase();
  const stem = path.basename(originalName, extension).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "voice";
  return `${String(index + 1).padStart(3, "0")}-${stem}${extension}`;
}

async function importCharacter(payload) {
  const name = String(payload?.name ?? "").trim().slice(0, 40);
  const sourceRoot = path.resolve(String(payload?.modelFolder ?? ""));
  const selectedModel = String(payload?.modelFile ?? "");
  const selectedAtlas = String(payload?.atlasFile ?? "");
  const selectedModelNative = selectedModel.split("/").join(path.sep);
  const selectedAtlasNative = selectedAtlas.split("/").join(path.sep);
  if (!name) throw new Error("请输入角色名称");

  const modelFiles = await walkFiles(sourceRoot);
  if (!modelFiles.includes(selectedModelNative) || !SKELETON_EXTENSIONS.has(path.extname(selectedModelNative).toLowerCase())) {
    throw new Error("主骨骼文件不在所选模型文件夹中");
  }
  if (!modelFiles.includes(selectedAtlasNative) || path.extname(selectedAtlasNative).toLowerCase() !== ".atlas") {
    throw new Error("请选择有效的 .atlas 图集文件");
  }
  if (!modelFiles.some((file) => path.extname(file).toLowerCase() === ".atlas")) throw new Error("模型文件夹缺少 .atlas 文件");
  if (!modelFiles.some((file) => TEXTURE_EXTENSIONS.has(path.extname(file).toLowerCase()))) throw new Error("模型文件夹缺少贴图文件");

  const id = `character-${randomUUID()}`;
  const characterRoot = path.join(charactersDirectory(), id);
  const modelRoot = path.join(characterRoot, "model");
  const voiceRoot = path.join(characterRoot, "voice");
  try {
    await mkdir(modelRoot, { recursive: true });
    await copyModelFolder(sourceRoot, modelRoot);

    const voiceLines = [];
    const voices = Array.isArray(payload.voices) ? payload.voices.slice(0, 200) : [];
    if (voices.length > 0) await mkdir(path.join(voiceRoot, "audio"), { recursive: true });
    for (let index = 0; index < voices.length; index += 1) {
      const sourcePath = path.resolve(String(voices[index]?.sourcePath ?? ""));
      const extension = path.extname(sourcePath).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(extension)) throw new Error(`不支持的音频格式：${path.basename(sourcePath)}`);
      const fileName = safeAudioName(index, path.basename(sourcePath));
      await copyFile(sourcePath, path.join(voiceRoot, "audio", fileName));
      voiceLines.push({
        id: `voice-${String(index + 1).padStart(3, "0")}`,
        audio: `audio/${fileName}`,
        subtitle: String(voices[index]?.subtitle ?? path.basename(sourcePath, extension)).trim().slice(0, 300)
      });
    }

    const voiceBundle = payload?.voiceBundle;
    const hasVoiceBundleSelection = voiceBundle && Object.values(voiceBundle).some((value) => String(value ?? "").trim());
    if (hasVoiceBundleSelection) {
      const audioPath = path.resolve(String(voiceBundle.audioPath ?? ""));
      const characterId = String(voiceBundle.characterId ?? "").trim();
      const language = String(voiceBundle.language ?? "JP").trim().toUpperCase();
      const metadataPath = String(voiceBundle.metadataPath ?? "").trim();
      const subtitlePath = String(voiceBundle.subtitlePath ?? "").trim();
      if (!voiceBundle.audioPath || !characterId) {
        throw new Error("明日方舟自动分句需要：角色长音频和角色 ID");
      }
      const audioExtension = path.extname(audioPath).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(audioExtension)) throw new Error("Ark-Voice 整合音频格式不受支持");
      const voiceData = await readJson(
        metadataPath ? path.resolve(metadataPath) : bundledArkDataPath("voice_data.json"),
        undefined
      );
      const subtitleData = await readJson(
        subtitlePath ? path.resolve(subtitlePath) : bundledArkDataPath("charword_table.json"),
        undefined
      );
      if (!voiceData) throw new Error(metadataPath ? "自定义 voice_data.json 无法读取或格式不正确" : "内置 voice_data.json 损坏，请重新安装应用");
      if (!subtitleData) throw new Error(subtitlePath ? "自定义 charword_table.json 无法读取或格式不正确" : "内置 charword_table.json 损坏，请重新安装应用");
      const mergedFileName = `ark-voice${audioExtension}`;
      const parsedVoiceLines = parseArkVoiceBundle(
        voiceData,
        subtitleData,
        characterId,
        language,
        `audio/${mergedFileName}`
      );
      await mkdir(path.join(voiceRoot, "audio"), { recursive: true });
      await copyFile(audioPath, path.join(voiceRoot, "audio", mergedFileName));
      voiceLines.push(...parsedVoiceLines);
    }

    if (voiceLines.length > 0) {
      await writeFile(path.join(voiceRoot, "manifest.json"), JSON.stringify({
        id: `${id}-voice`, voiceLocale: "custom", subtitleLocale: "custom", lines: voiceLines
      }, null, 2), "utf8");
    }

    const animations = {};
    for (const [action, value] of Object.entries(payload.animations ?? {})) {
      const animationName = String(value ?? "").trim().slice(0, 100);
      if (ACTION_NAMES.has(action) && animationName) animations[action] = animationName;
    }
    const profile = {
      parameters: normalizeParameters(payload.parameters),
      version: 1,
      id,
      name,
      modelFile: toPortablePath(selectedModelNative),
      atlasFile: toPortablePath(selectedAtlasNative),
      voiceCount: voiceLines.length,
      animations,
      createdAt: new Date().toISOString()
    };
    await writeFile(path.join(characterRoot, "character.json"), JSON.stringify(profile, null, 2), "utf8");
    await writePreferences(id);
    activeCharacterName = name;
    applyCharacterParameters(profile.parameters);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    return id;
  } catch (error) {
    await rm(characterRoot, { recursive: true, force: true });
    throw error;
  }
}

async function activateCharacter(characterId) {
  const config = await getCharacterRuntimeConfig(characterId);
  if (config.id !== characterId) throw new Error("没有找到该角色");
  await writePreferences(characterId);
  activeCharacterName = config.name;
  applyCharacterParameters(config.parameters);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
}

async function deleteCharacter(characterId) {
  if (characterId === BUILTIN_CHARACTER.id || !/^[a-z0-9-]+$/i.test(characterId)) throw new Error("内置角色不能删除");
  const profile = await readCustomCharacter(characterId);
  if (!profile) throw new Error("没有找到该角色");
  const preferences = await readPreferences();
  if (preferences.activeCharacterId === characterId) {
    await writePreferences(BUILTIN_CHARACTER.id);
    activeCharacterName = BUILTIN_CHARACTER.name;
    applyCharacterParameters((await getCharacterRuntimeConfig(BUILTIN_CHARACTER.id)).parameters);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  }
  await rm(path.join(charactersDirectory(), characterId), { recursive: true, force: true });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.moveTop();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    show: false,
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: "#f5f2ec",
    title: "Spine 桌宠工坊",
    autoHideMenuBar: true,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(rootDirectory, "electron", "settings-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const openedSettingsWindow = settingsWindow;
  openedSettingsWindow.once("ready-to-show", () => {
    if (!openedSettingsWindow.isDestroyed()) {
      openedSettingsWindow.show();
      openedSettingsWindow.moveTop();
      openedSettingsWindow.focus();
    }
  });
  settingsWindow.webContents.once("did-finish-load", () => {
    if (!process.env.SETTINGS_CAPTURE_PATH) return;
    setTimeout(async () => {
      if (!settingsWindow || settingsWindow.isDestroyed()) return;
      const image = await settingsWindow.webContents.capturePage();
      await writeFile(process.env.SETTINGS_CAPTURE_PATH, image.toPNG());
      app.quit();
    }, 1600);
  });
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void settingsWindow.loadURL(`${developmentUrl}/settings.html`);
  else void settingsWindow.loadFile(path.join(rootDirectory, "dist", "settings.html"));
  settingsWindow.on("closed", () => {
    if (settingsWindow === openedSettingsWindow) {
      settingsWindow = undefined; previewAssets.clear(); selectedPreviewFolders.clear(); selectedPreviewFiles.clear();
    }
  });
}

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pet:command", command);
}

function getPetDimensions() {
  return {
    width: Math.round(BASE_WIDTH * petScale),
    height: Math.round(BASE_HEIGHT * petScale)
  };
}

function applyPetBounds(x, y) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = getPetDimensions();
  mainWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, false);
}

function createTrayIcon() {
  const appIcon = nativeImage.createFromPath(APP_ICON_PATH);
  if (!appIcon.isEmpty()) return appIcon.resize({ width: 32, height: 32 });

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill="#202638"/>
      <path d="M8 25 14.1 7h3.8L24 25h-4l-1.2-4H13l-1.2 4H8Zm6-7h4l-2-6.5L14 18Z" fill="#f2bace"/>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function setPetScale(nextScale) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  petScale = nextScale;
  const oldBounds = mainWindow.getBounds();
  const { width: nextWidth, height: nextHeight } = getPetDimensions();
  const centerX = oldBounds.x + oldBounds.width / 2;
  const bottom = oldBounds.y + oldBounds.height;
  const nextX = Math.round(centerX - nextWidth / 2);
  const nextY = Math.round(
    groundedWindow ? groundedWindow.Y - getSurfaceSupportOffset(nextHeight) : bottom - nextHeight
  );
  applyPetBounds(nextX, nextY);
  floatingPosition = { x: nextX, y: nextY };
  sendCommand({ type: "scale", value: petScale });
}

function buildMenu() {
  const visible = Boolean(mainWindow?.isVisible());
  return Menu.buildFromTemplate([
    {
      label: "打开角色管理器…",
      click: createSettingsWindow
    },
    { type: "separator" },
    {
      label: visible ? `隐藏${activeCharacterName}` : `显示${activeCharacterName}`,
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: "separator" },
    {
      label: "更改动作",
      submenu: [
        { label: "待机", click: () => sendCommand({ type: "action", action: "idle" }) },
        { label: "行走", click: () => sendCommand({ type: "action", action: "walk" }) },
        { label: "坐下", click: () => sendCommand({ type: "action", action: "sit" }) },
        { label: "躺下", click: () => sendCommand({ type: "action", action: "sleep" }) },
        { label: "戳一戳", click: () => sendCommand({ type: "action", action: "touch" }) }
      ]
    },
    {
      label: "大小",
      submenu: [
        [0.4, "40%（很小）"],
        [0.5, "50%"],
        [0.6, "60%（默认）"],
        [0.7, "70%"],
        [0.8, "80%"],
        { type: "separator" },
        {
          label: "自定义大小…",
          click: () => sendCommand({ type: "open-size-dialog", current: petScale })
        }
      ].map((item) => {
        if (!Array.isArray(item)) return item;
        const [scale, label] = item;
        return {
          label,
          type: "radio",
          checked: petScale === scale,
          click: () => void setCharacterScale(scale)
        };
      })
    },
    {
      label: "语音与字幕",
      type: "checkbox",
      checked: voiceEnabled,
      click: (item) => {
        voiceEnabled = item.checked;
        sendCommand({ type: "voice-enabled", enabled: voiceEnabled });
      }
    },
    { type: "separator" },
    {
      label: "重力系统",
      type: "checkbox",
      checked: gravityEnabled,
      click: (item) => {
        gravityEnabled = item.checked;
        verticalVelocity = 0;
      }
    },
    {
      label: "吸附软件窗口上沿",
      type: "checkbox",
      checked: edgeSnapEnabled,
      click: (item) => {
        edgeSnapEnabled = item.checked;
      }
    },
    {
      label: "始终置顶",
      type: "checkbox",
      checked: alwaysOnTop,
      click: (item) => {
        alwaysOnTop = item.checked;
        mainWindow?.setAlwaysOnTop(alwaysOnTop, "screen-saver");
      }
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);
}

function showPetMenu() {
  buildMenu().popup({ window: mainWindow });
}

function startWindowMonitor() {
  if (process.platform !== "win32") return;
  const resourceRoot = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked")
    : rootDirectory;
  const scriptPath = path.join(resourceRoot, "electron", "window-monitor.ps1");
  monitorProcess = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-ExcludePid", String(process.pid)],
    { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
  );

  const lines = readline.createInterface({ input: monitorProcess.stdout });
  lines.on("line", (line) => {
    try {
      const parsed = JSON.parse(line);
      desktopWindows = Array.isArray(parsed) ? parsed : [];
      if (process.env.PET_CAPTURE_PATH && !monitorSampleLogged) {
        monitorSampleLogged = true;
        console.log(`[pet] window monitor found ${desktopWindows.length} candidate windows`);
      }
    } catch {
      // Ignore a partial monitor sample; the next sample replaces it.
    }
  });
}

function horizontalOverlap(left, width, rect) {
  return Math.max(0, Math.min(left + width, rect.X + rect.Width) - Math.max(left, rect.X));
}

function getSurfaceSupportOffset(height) {
  if (supportRatio >= 0.98) return height;
  return Math.min(height, height * (supportRatio + SIT_SURFACE_LIFT_RATIO));
}

function findLandingWindow(bounds, previousSupport, proposedSupport, workArea) {
  let bestWindow;
  if (!edgeSnapEnabled) return undefined;

  for (const rect of desktopWindows) {
    if (rect.Width <= 0 || rect.Height <= 0) continue;
    if (horizontalOverlap(floatingPosition.x, bounds.width, rect) < Math.min(70, bounds.width * 0.22)) continue;
    const top = rect.Y;
    if (top <= workArea.y + 35 || top >= workArea.y + workArea.height) continue;

    const crossingSurface = previousSupport <= top && proposedSupport >= top;
    const insideSnapBand =
      previousSupport >= top - WINDOW_SNAP_ABOVE && previousSupport <= top + WINDOW_SNAP_BELOW;
    if ((crossingSurface || insideSnapBand) && (!bestWindow || top < bestWindow.Y)) bestWindow = rect;
  }

  return bestWindow;
}

function reverseDirection() {
  direction = direction === 1 ? -1 : 1;
  mainWindow?.webContents.send("pet:direction", direction);
}

function updatePhysics() {
  if (!mainWindow || mainWindow.isDestroyed() || dragging || !mainWindow.isVisible()) {
    lastPhysicsTime = performance.now();
    return;
  }

  const now = performance.now();
  const deltaTime = Math.min((now - lastPhysicsTime) / 1000, 0.05);
  lastPhysicsTime = now;
  const currentBounds = mainWindow.getBounds();
  const dimensions = getPetDimensions();
  const bounds = { ...currentBounds, ...dimensions };
  const workArea = screen.getDisplayMatching(bounds).workArea;

  if (groundedWindow) {
    groundedWindow =
      desktopWindows.find(
        (candidate) => candidate.Pid === groundedWindow.Pid && candidate.Title === groundedWindow.Title
      ) ?? groundedWindow;
    const groundedOverlap = horizontalOverlap(floatingPosition.x, bounds.width, groundedWindow);
    if (groundedOverlap >= Math.min(70, bounds.width * 0.22)) {
      floatingPosition.y = groundedWindow.Y - getSurfaceSupportOffset(bounds.height);
      verticalVelocity = 0;
    } else {
      groundedWindow = undefined;
    }
  }

  if (groundedWindow) {
    const centerX = floatingPosition.x + bounds.width / 2;
    const edgeMargin = Math.max(18, bounds.width * 0.16);
    if (walking && direction < 0 && centerX <= groundedWindow.X + edgeMargin) reverseDirection();
    if (walking && direction > 0 && centerX >= groundedWindow.X + groundedWindow.Width - edgeMargin) reverseDirection();
  }

  const targetHorizontalVelocity = walking && !featureInteraction ? WALK_SPEED * direction : 0;
  const velocityBlend = Math.min(1, WALK_ACCELERATION * deltaTime);
  horizontalVelocity += (targetHorizontalVelocity - horizontalVelocity) * velocityBlend;
  if (!walking && Math.abs(horizontalVelocity) < 0.35) horizontalVelocity = 0;
  floatingPosition.x += horizontalVelocity * deltaTime;

  const minimumX = workArea.x;
  const maximumX = workArea.x + workArea.width - bounds.width;
  if (floatingPosition.x <= minimumX) {
    floatingPosition.x = minimumX;
    horizontalVelocity = 0;
    if (walking && direction < 0) reverseDirection();
  } else if (floatingPosition.x >= maximumX) {
    floatingPosition.x = maximumX;
    horizontalVelocity = 0;
    if (walking && direction > 0) reverseDirection();
  }

  if (gravityEnabled) {
    verticalVelocity += GRAVITY * deltaTime;
    const supportOffset = getSurfaceSupportOffset(bounds.height);
    const previousSupport = floatingPosition.y + supportOffset;
    const proposedY = floatingPosition.y + verticalVelocity * deltaTime;
    const proposedSupport = proposedY + supportOffset;
    const landingWindow = findLandingWindow(bounds, previousSupport, proposedSupport, workArea);
    const floorTop = workArea.y + workArea.height;
    const floorSupportOffset = supportOffset;
    const proposedFloorSupport = proposedY + floorSupportOffset;

    if (landingWindow) {
      floatingPosition.y = landingWindow.Y - supportOffset;
      groundedWindow = landingWindow;
      verticalVelocity = 0;
    } else if (proposedFloorSupport >= floorTop) {
      floatingPosition.y = floorTop - floorSupportOffset;
      groundedWindow = undefined;
      verticalVelocity = 0;
    } else {
      floatingPosition.y = proposedY;
      groundedWindow = undefined;
    }
  }

  const floorSupportOffset = gravityEnabled ? getSurfaceSupportOffset(bounds.height) : bounds.height;
  const maximumY = workArea.y + workArea.height - floorSupportOffset;
  const visibleHeightAtTop = gravityEnabled
    ? Math.min(24, bounds.height * 0.1)
    : bounds.height * 0.4;
  const minimumY = workArea.y - bounds.height + visibleHeightAtTop;
  floatingPosition.y = Math.max(minimumY, Math.min(maximumY, floatingPosition.y));
  applyPetBounds(floatingPosition.x, floatingPosition.y);
}

function startDragging() {
  if (!mainWindow || dragging) return;
  dragging = true;
  walking = false;
  verticalVelocity = 0;
  horizontalVelocity = 0;
  const cursor = screen.getCursorScreenPoint();
  let previousCursorX = cursor.x;
  const bounds = mainWindow.getBounds();
  const offset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };

  dragTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const horizontalDelta = point.x - previousCursorX;
    if (Math.abs(horizontalDelta) >= 2) {
      direction = horizontalDelta < 0 ? -1 : 1;
      mainWindow.webContents.send("pet:direction", direction);
    }
    previousCursorX = point.x;
    floatingPosition = { x: point.x - offset.x, y: point.y - offset.y };
    applyPetBounds(floatingPosition.x, floatingPosition.y);
  }, 16);
}

function stopDragging() {
  if (!dragging) return;
  dragging = false;
  clearInterval(dragTimer);
  dragTimer = undefined;
  verticalVelocity = 0;
  groundedWindow = undefined;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    floatingPosition = { x: bounds.x, y: bounds.y };
  }
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const { width, height } = getPetDimensions();

  mainWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 30,
    y: workArea.y + workArea.height - height,
    minWidth: Math.round(BASE_WIDTH * 0.3),
    minHeight: Math.round(BASE_HEIGHT * 0.3),
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    title: `${activeCharacterName}桌宠`,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(rootDirectory, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  floatingPosition = { x: mainWindow.getBounds().x, y: mainWindow.getBounds().y };
  mainWindow.setAlwaysOnTop(alwaysOnTop, "screen-saver");

  mainWindow.on("show", () => {
    const bounds = mainWindow.getBounds();
    floatingPosition = { x: bounds.x, y: bounds.y };
  });

  mainWindow.webContents.once("did-finish-load", () => {
    if (!process.env.PET_CAPTURE_PATH && !process.env.PET_CAPTURE_SERIES_DIR) return;
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (process.env.PET_CAPTURE_SERIES_DIR) {
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(process.env.PET_CAPTURE_SERIES_DIR, { recursive: true });
        for (let index = 0; index < 4; index += 1) {
          if (index > 0) await new Promise((resolve) => setTimeout(resolve, 5000));
          const image = await mainWindow.webContents.capturePage();
          await writeFile(path.join(process.env.PET_CAPTURE_SERIES_DIR, `idle-${index}.png`), image.toPNG());
          const bounds = mainWindow.getBounds();
          const display = screen.getDisplayMatching(bounds);
          const pageMetrics = await mainWindow.webContents.executeJavaScript(
            "({ dpr: window.devicePixelRatio, width: window.innerWidth, height: window.innerHeight, canvasWidth: document.querySelector('canvas')?.width, canvasHeight: document.querySelector('canvas')?.height })"
          );
          console.log(
            `[pet] sample ${index}: position=${bounds.x},${bounds.y}, bounds=${bounds.width}x${bounds.height}, display=${display.id}, scale=${display.scaleFactor}, dpr=${pageMetrics.dpr}, page=${pageMetrics.width}x${pageMetrics.height}, canvas=${pageMetrics.canvasWidth}x${pageMetrics.canvasHeight}`
          );
        }
        app.quit();
        return;
      }
      if (process.env.PET_CAPTURE_ACTION) {
        const positionBeforeAction = mainWindow.getPosition();
        const bridgeStatus = await mainWindow.webContents.executeJavaScript("typeof window.desktopPet");
        console.log(`[pet] preload bridge is ${bridgeStatus}`);
        sendCommand({ type: "action", action: process.env.PET_CAPTURE_ACTION });
        if (process.env.PET_CAPTURE_SCALE) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          setPetScale(Math.max(0.3, Math.min(1.2, Number(process.env.PET_CAPTURE_SCALE))));
        }
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.PET_CAPTURE_ACTION_DELAY) || 850));
        const positionAfterAction = mainWindow.getPosition();
        console.log(
          `[pet] window delta after action: ${positionAfterAction[0] - positionBeforeAction[0]}, ${positionAfterAction[1] - positionBeforeAction[1]}`
        );
      }
      const image = await mainWindow.webContents.capturePage();
      const { writeFile } = await import("node:fs/promises");
      await writeFile(process.env.PET_CAPTURE_PATH, image.toPNG());
      app.quit();
    }, 4000);
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void mainWindow.loadURL(developmentUrl);
  else void mainWindow.loadFile(path.join(rootDirectory, "dist", "index.html"));
}

app.whenReady().then(async () => {
  app.setAppUserModelId("local.spine.desktop.pet.workshop");
  await mkdir(charactersDirectory(), { recursive: true });
  const firstRun = (await readJson(preferencesPath(), undefined)) === undefined;
  if (firstRun) await writePreferences(BUILTIN_CHARACTER.id);
  const activeConfig = await getActiveCharacterConfig();
  activeCharacterName = activeConfig.name;
  activeCharacterParameters = normalizeParameters(activeConfig.parameters);
  petScale = activeCharacterParameters.modelScalePercent / 100;

  protocol.handle("pet-asset", async (request) => {
    try {
      const assetUrl = new URL(request.url);
      const characterId = assetUrl.hostname;
      if (!/^[a-z0-9-]+$/i.test(characterId)) return new Response("Invalid character", { status: 400 });
      const characterRoot = path.resolve(charactersDirectory(), characterId);
      const relativePath = decodeURIComponent(assetUrl.pathname).replace(/^\/+/, "");
      const assetPath = path.resolve(characterRoot, relativePath);
      if (assetPath !== characterRoot && !assetPath.startsWith(`${characterRoot}${path.sep}`)) {
        return new Response("Invalid asset path", { status: 403 });
      }
      return net.fetch(pathToFileURL(assetPath).toString());
    } catch {
      return new Response("Asset not found", { status: 404 });
    }
  });

  protocol.handle("pet-preview", (request) => {
    try {
      const url = new URL(request.url);
      const grant = previewAssets.get(url.hostname);
      const match = url.pathname.match(/^\/(0|[1-9][0-9]*)(\.[a-z0-9]+)$/);
      const file = match && grant?.files[Number(match[1])];
      if (!file || path.extname(file).toLowerCase() !== match[2]) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    } catch { return new Response("Not found", { status: 404 }); }
  });
  ipcMain.handle("settings:get-character-config", async (event, id) => {
    requireSettingsSender(event);
    const config = await getCharacterRuntimeConfig(String(id));
    if (config.id !== id) throw new Error("没有找到该角色");
    return config;
  });
  ipcMain.handle("settings:save-parameters", async (event, id, parameters) => {
    requireSettingsSender(event);
    try { return { ok: true, parameters: await saveCharacterParameters(String(id), parameters) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("settings:preview-model", (event, payload) => { requireSettingsSender(event); return previewModel(payload); });
  ipcMain.handle("settings:preview-voice", (event, payload) => { requireSettingsSender(event); return previewVoice(payload); });
  ipcMain.handle("pet:get-character-config", getActiveCharacterConfig);
  ipcMain.on("pet:show-context-menu", showPetMenu);
  ipcMain.on("pet:drag-start", startDragging);
  ipcMain.on("pet:drag-end", stopDragging);
  ipcMain.on("pet:set-walking", (_event, enabled, nextDirection) => {
    walking = Boolean(enabled);
    if (nextDirection === -1 || nextDirection === 1) direction = nextDirection;
  });
  ipcMain.on("pet:set-support-ratio", (_event, nextRatio) => {
    supportRatio = Math.max(0.5, Math.min(1, Number(nextRatio) || 1));
    if (groundedWindow && mainWindow && !mainWindow.isDestroyed()) {
      const { height } = getPetDimensions();
      floatingPosition.y = groundedWindow.Y - getSurfaceSupportOffset(height);
      verticalVelocity = 0;
      applyPetBounds(floatingPosition.x, floatingPosition.y);
    }
  });
  ipcMain.on("pet:set-custom-scale", (_event, nextScale) => {
    const normalized = Math.max(0.3, Math.min(1.2, Number(nextScale) || petScale));
    void setCharacterScale(Math.round(normalized * 100) / 100);
  });

  ipcMain.handle("settings:list-characters", listCharacters);
  ipcMain.handle("settings:choose-model-folder", async () => {
    const result = await dialog.showOpenDialog(settingsWindow, {
      title: "选择 Spine 模型文件夹",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const folderPath = result.filePaths[0];
    selectedPreviewFolders.clear();
    selectedPreviewFolders.add(path.resolve(folderPath));
    try {
      const files = await walkFiles(folderPath);
      const modelFiles = files.filter((file) => SKELETON_EXTENSIONS.has(path.extname(file).toLowerCase()));
      const atlasFiles = files.filter((file) => path.extname(file).toLowerCase() === ".atlas");
      const textureCount = files.filter((file) => TEXTURE_EXTENSIONS.has(path.extname(file).toLowerCase())).length;
      if (modelFiles.length === 0) return { canceled: false, error: "文件夹中没有 .skel 或 .json 骨骼文件" };
      if (atlasFiles.length === 0) return { canceled: false, error: "文件夹中没有 .atlas 图集文件" };
      if (textureCount === 0) return { canceled: false, error: "文件夹中没有 PNG/JPG/WebP 贴图" };
      return {
        canceled: false,
        folderPath,
        folderName: path.basename(folderPath),
        modelFiles: modelFiles.map(toPortablePath),
        atlasFiles: atlasFiles.map(toPortablePath),
        textureCount
      };
    } catch (error) {
      return { canceled: false, error: error instanceof Error ? error.message : "无法读取模型文件夹" };
    }
  });
  ipcMain.handle("settings:choose-audio-files", async () => {
    const result = await dialog.showOpenDialog(settingsWindow, {
      title: "选择角色语音",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "音频文件", extensions: ["mp3", "wav", "ogg", "m4a", "aac", "flac"] }]
    });
    return {
      canceled: result.canceled,
      files: result.filePaths.map((filePath) => ({ path: filePath, name: path.basename(filePath) }))
    };
  });
  ipcMain.handle("settings:choose-long-voice-file", async () => {
    const result = await dialog.showOpenDialog(settingsWindow, {
      title: "选择明日方舟角色长音频",
      properties: ["openFile"],
      filters: [{ name: "角色长音频", extensions: ["ogg", "mp3", "wav", "m4a", "aac", "flac"] }]
    });
    const filePath = result.filePaths[0];
    if (filePath) selectedPreviewFiles.add(path.resolve(filePath));
    return { canceled: result.canceled || !filePath, path: filePath, name: filePath ? path.basename(filePath) : undefined };
  });
  ipcMain.handle("settings:choose-voice-config-file", async (_event, kind) => {
    const result = await dialog.showOpenDialog(settingsWindow, {
      title: kind === "metadata" ? "选择自定义 voice_data.json" : "选择自定义 charword_table.json",
      properties: ["openFile"],
      filters: [{ name: "JSON 数据", extensions: ["json"] }]
    });
    const filePath = result.filePaths[0];
    if (filePath) selectedPreviewFiles.add(path.resolve(filePath));
    return { canceled: result.canceled || !filePath, path: filePath, name: filePath ? path.basename(filePath) : undefined };
  });
  ipcMain.handle("settings:import-character", async (_event, payload) => {
    try {
      const id = await importCharacter(payload);
      return { ok: true, id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "导入失败" };
    }
  });
  ipcMain.handle("settings:activate-character", async (_event, id) => {
    try {
      await activateCharacter(String(id));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "切换失败" };
    }
  });
  ipcMain.handle("settings:delete-character", async (_event, id) => {
    try {
      await deleteCharacter(String(id));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "删除失败" };
    }
  });
  ipcMain.handle("settings:open-external", async (_event, rawUrl) => {
    const url = String(rawUrl);
    const allowed = [
      "https://github.com/isHarryh/Ark-Models",
      "https://github.com/isHarryh/Ark-Voice",
      "https://github.com/isHarryh/Ark-Voice/blob/main/voice_data.json",
      "https://github.com/Kengxxiao/ArknightsGameData",
      "https://github.com/Kengxxiao/ArknightsGameData/blob/master/zh_CN/gamedata/excel/charword_table.json",
      "https://esotericsoftware.com/spine-runtimes"
    ];
    if (!allowed.includes(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  createWindow();
  extensionService = new ExtensionService({
    directory: path.join(app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : rootDirectory, "electron", "extensions"),
    userData: app.getPath("userData"),
    onUpdate: snapshot => {
      extensionOverlay?.update(snapshot);
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send("features:state", snapshot);
    },
    onEvent: event => extensionOverlay?.event(event)
  });
  extensionOverlay = createExtensionOverlay({ root: rootDirectory, service: extensionService,
    getPet: () => mainWindow, getDragging: () => dragging,
    setInteraction: value => { featureInteraction = value; }, openSettings: createSettingsWindow,
    testing: !app.isPackaged && Boolean(process.env.V311_SMOKE_DIR) });
  const settingsSender = event => settingsWindow && event.sender === settingsWindow.webContents;
  const startupSettings = createStartupSettings(app);
  ipcMain.handle("settings:startup-get", event => {
    if (!settingsSender(event)) throw new Error("Invalid sender");
    return startupSettings.get();
  });
  ipcMain.handle("settings:startup-set", (event, enabled) => {
    if (!settingsSender(event)) throw new Error("Invalid sender");
    return startupSettings.set(enabled);
  });
  ipcMain.handle("features:get", event => { if (!settingsSender(event)) throw new Error("Invalid sender"); return extensionService.snapshot(); });
  ipcMain.handle("features:set", async (event, settings) => {
    if (!settingsSender(event)) throw new Error("Invalid sender");
    try { return { ok: true, snapshot: await extensionService.setSettings(settings) }; }
    catch { return { ok: false, error: "设置保存失败，请稍后重试" }; }
  });
  ipcMain.handle("features:permission", async event => {
    if (!settingsSender(event)) throw new Error("Invalid sender");
    try { return { ok: true, permission: await extensionService.request("permission", {}) }; }
    catch { return { ok: false, error: "无法请求通知权限，请在 Windows 设置中检查通知访问" }; }
  });
  ipcMain.on("features:preview", event => {
    if (settingsSender(event)) extensionOverlay.event({ id: "preview", module: "notifications", text: "桌宠工坊 · 新消息会在这里轻轻提醒", createdAt: new Date().toISOString() });
  });
  await extensionService.start();
  if (!app.isPackaged && process.env.V311_SMOKE_DIR) {
    const { runSmoke } = await import("../scripts/smoke-v311.mjs");
    void runSmoke({ app, mainWindow, overlay: extensionOverlay, service: extensionService, createSettingsWindow, getSettingsWindow: () => settingsWindow });
  }
  if (firstRun && !process.argv.includes('--autostart') && !process.env.PET_CAPTURE_PATH && !process.env.PET_CAPTURE_SERIES_DIR) createSettingsWindow();
  startWindowMonitor();
  physicsTimer = setInterval(updatePhysics, 16);

  tray = new Tray(createTrayIcon());
  tray.setToolTip("Spine 桌宠工坊");
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on("before-quit", () => {
  extensionService?.stop();
  extensionOverlay?.stop();
  clearInterval(physicsTimer);
  clearInterval(dragTimer);
  monitorProcess?.kill();
});

app.on("window-all-closed", () => app.quit());
