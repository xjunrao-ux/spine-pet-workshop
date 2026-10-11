import "./settings.css";
import { initializeFeatureSettings } from "./features/settings";
import { createParameterEditor } from "./parameter-editor";
import { CharacterPreview, VoiceAudition } from "./character-preview";
import { normalizeParameters } from "../electron/character-parameters.mjs";

type ActionName = "idle" | "walk" | "sit" | "sleep" | "touch" | "special";

interface AudioRow {
  path: string;
  name: string;
  subtitle: string;
}

type VoiceConfigKind = "metadata" | "subtitles";

const previewPage = new URLSearchParams(window.location.search).get("preview");
if (previewPage) {
  document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.page === previewPage));
  document.querySelectorAll<HTMLElement>(".page").forEach((page) => page.classList.toggle("active", page.id === `page-${previewPage}`));
}

if (!window.petSettings) throw new Error("角色管理器只能在桌宠应用中运行");
const api = window.petSettings;
const audition = new VoiceAudition();
const importPreview = new CharacterPreview(document.querySelector<HTMLElement>("#import-preview")!);
const libraryPreview = new CharacterPreview(document.querySelector<HTMLElement>("#library-preview")!);
const importParameters = createParameterEditor(document.querySelector<HTMLElement>("#import-parameters")!, undefined, value => {
  importPreview.setParameters(value); audition.stop();
}, document.querySelector<HTMLElement>('#import-history')!);
const libraryParameters = createParameterEditor(document.querySelector<HTMLElement>("#library-parameters")!, undefined, value => {
  libraryPreview.setParameters(value); audition.stop();
  document.querySelector<HTMLElement>("#parameters-status")!.textContent = "有未保存的修改；试听和预览使用当前参数";
}, document.querySelector<HTMLElement>('#library-history')!);
let editingCharacterId: string | undefined;
let settingsGeneration = 0;
let modelPreviewGeneration = 0;
let voicePreviewGeneration = 0;

function renderVoiceControls(host: HTMLElement, lines: PetVoiceLine[], audioUrl: (line: PetVoiceLine) => string, getParameters: () => PetParameters) {
  host.replaceChildren(); audition.stop();
  const status = document.createElement("p"); status.setAttribute("role", "status");
  if (!lines.length) { status.textContent = "此角色没有可试听的语音"; host.append(status); return; }
  const select = document.createElement("select"); select.setAttribute("aria-label", "试听语音分句");
  lines.forEach((line, index) => select.add(new Option(`${line.title ?? line.id} · ${line.subtitle.slice(0, 35)}`, String(index))));
  const play = document.createElement("button"); play.type = "button"; play.className = "ghost-button"; play.textContent = "试听当前分句";
  play.addEventListener("click", () => {
    const line = lines[Number(select.value)]; void audition.play(line, audioUrl(line), getParameters(), status);
  });
  const stop = document.createElement("button"); stop.type = "button"; stop.className = "ghost-button"; stop.textContent = "停止";
  stop.addEventListener("click", () => { audition.stop(); status.textContent = "已停止"; });
  select.addEventListener("change", () => audition.stop());
  status.textContent = "选择分句试听，调整偏移后再次试听确认";
  host.append(select, play, stop, status);
}

async function openCharacterSettings(id: string) {
  const generation = ++settingsGeneration;
  editingCharacterId = id; audition.stop(); libraryPreview.clear();
  const panel = document.querySelector<HTMLElement>("#character-settings")!;
  const status = document.querySelector<HTMLElement>("#parameters-status")!;
  const save = document.querySelector<HTMLButtonElement>("#save-character-parameters")!;
  const controls = document.querySelector<HTMLElement>("#library-voice-controls")!;
  controls.replaceChildren(); panel.classList.remove("hidden"); save.disabled = true;
  status.textContent = "正在读取角色设置…";
  panel.scrollIntoView({behavior: "smooth", block: "start"});
  try {
    const config = await api.getCharacterConfig(id);
    if (generation !== settingsGeneration) return;
    document.querySelector<HTMLElement>("#character-settings-title")!.textContent = `${config.name} · 角色设置`;
    libraryParameters.set(config.parameters, true);
    status.textContent = "调整后点击保存；仅修改此角色"; save.disabled = false;
    void libraryPreview.load(config);
    if (config.voiceManifestUrl) {
      const url = new URL(config.voiceManifestUrl, window.location.href);
      const response = await fetch(url);
      if (!response.ok) throw new Error("语音配置读取失败");
      const manifest = await response.json() as {lines: PetVoiceLine[]};
      if (generation !== settingsGeneration) return;
      renderVoiceControls(controls, manifest.lines, line => new URL(line.audio, url).href, libraryParameters.get);
    } else renderVoiceControls(controls, [], () => "", libraryParameters.get);
  } catch (error) {
    if (generation === settingsGeneration) status.textContent = `读取失败：${String(error)}`;
  }
}

document.querySelector("#close-character-settings")!.addEventListener("click", () => {
  settingsGeneration++; editingCharacterId = undefined; audition.stop(); libraryPreview.clear();
  document.querySelector("#character-settings")!.classList.add("hidden");
});
document.querySelector("#reset-character-parameters")!.addEventListener("click", () => {
  libraryParameters.set({ ...libraryParameters.get(), ...normalizeParameters() });
});
document.querySelector<HTMLButtonElement>("#save-character-parameters")!.addEventListener("click", async (event) => {
  if (!editingCharacterId) return;
  const generation = settingsGeneration;
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  const snapshot = libraryParameters.get();
  const result = await api.saveParameters(editingCharacterId, snapshot);
  if (generation !== settingsGeneration) return;
  const changedWhileSaving = libraryParameters.get() !== snapshot;
  if (result.ok && !changedWhileSaving) libraryParameters.set(result.parameters);
  document.querySelector<HTMLElement>("#parameters-status")!.textContent = result.ok
    ? changedWhileSaving ? "本次设置已保存；后续修改尚未保存" : "已保存，当前角色立即生效（音频从下一次播放应用）"
    : `保存失败：${result.error}`;
  button.disabled = false;
});

async function updateImportPreview() {
  const generation = ++modelPreviewGeneration;
  importPreview.clear();
  if (!selectedModelFolder || !modelFile.value || !atlasFile.value) return;
  try {
    const config = await api.previewModel({modelFolder: selectedModelFolder, modelFile: modelFile.value, atlasFile: atlasFile.value});
    if (generation !== modelPreviewGeneration) return;
    config.parameters = importParameters.get();
    config.animations = {idle: document.querySelector<HTMLInputElement>("#anim-idle")!.value.trim()};
    await importPreview.load(config);
  } catch (error) { if (generation === modelPreviewGeneration) importPreview.showError(String(error)); }
}

function invalidateVoicePreview() {
  voicePreviewGeneration++; audition.stop();
  document.querySelector("#import-voice-controls")!.replaceChildren();
}

document.querySelector<HTMLButtonElement>("#prepare-voice-preview")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const host = document.querySelector<HTMLElement>("#import-voice-controls")!;
  const generation = ++voicePreviewGeneration;
  if (!longVoiceFile || !bundleCharacterId.value.trim()) { host.textContent = "请先选择长音频并填写角色 ID"; return; }
  button.disabled = true; host.textContent = "正在读取分句…";
  try {
    const result = await api.previewVoice({audioPath: longVoiceFile.path, characterId: bundleCharacterId.value.trim(), language: bundleLanguage.value,
      metadataPath: customVoiceConfig.metadata?.path, subtitlePath: customVoiceConfig.subtitles?.path});
    if (generation === voicePreviewGeneration) renderVoiceControls(host, result.lines, () => result.audioUrl, importParameters.get);
  } catch (error) { if (generation === voicePreviewGeneration) host.textContent = `试听准备失败：${String(error)}`; }
  finally { button.disabled = false; }
});

const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
const pages = [...document.querySelectorAll<HTMLElement>(".page")];
const characterList = document.querySelector<HTMLElement>("#character-list")!;
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-characters")!;
const form = document.querySelector<HTMLFormElement>("#import-form")!;
const characterName = document.querySelector<HTMLInputElement>("#character-name")!;
const modelButton = document.querySelector<HTMLButtonElement>("#choose-model-folder")!;
const modelSummary = document.querySelector<HTMLElement>("#model-summary")!;
const modelFileLabel = document.querySelector<HTMLElement>("#model-file-label")!;
const modelFile = document.querySelector<HTMLSelectElement>("#model-file")!;
const atlasFileLabel = document.querySelector<HTMLElement>("#atlas-file-label")!;
const atlasFile = document.querySelector<HTMLSelectElement>("#atlas-file")!;
const audioButton = document.querySelector<HTMLButtonElement>("#choose-audio-files")!;
const audioList = document.querySelector<HTMLElement>("#audio-list")!;
const longVoiceButton = document.querySelector<HTMLButtonElement>("#choose-long-voice")!;
const longVoiceSummary = document.querySelector<HTMLElement>("#bundle-audio-summary")!;
const bundleCharacterId = document.querySelector<HTMLInputElement>("#bundle-character-id")!;
const bundleLanguage = document.querySelector<HTMLSelectElement>("#bundle-language")!;
const importStatus = document.querySelector<HTMLElement>("#import-status")!;
const importSubmit = document.querySelector<HTMLButtonElement>("#import-submit")!;

let selectedModelFolder = "";
let audioRows: AudioRow[] = [];
let longVoiceFile: { path: string; name: string } | undefined;
const customVoiceConfig: Record<VoiceConfigKind, { path: string; name: string } | undefined> = {
  metadata: undefined,
  subtitles: undefined
};

function switchPage(name: string) {
  document.body.classList.toggle('utility-page', name === 'features' || name === 'extensions');
  audition.stop();
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.page === name));
  pages.forEach((page) => page.classList.toggle("active", page.id === `page-${name}`));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

tabs.forEach((tab) => tab.addEventListener("click", () => switchPage(tab.dataset.page ?? "characters")));

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character] ?? character);
}

async function loadCharacters() {
  characterList.innerHTML = '<div class="empty-state">正在读取角色库…</div>';
  try {
    const characters = await api.listCharacters();
    characterList.innerHTML = characters.map((character) => `
      <article class="character-card ${character.active ? "active" : ""}">
        <div class="character-mark">${escapeHtml(character.name.slice(0, 1).toUpperCase())}</div>
        <div class="character-meta">
          <div class="character-title"><h3>${escapeHtml(character.name)}</h3>${character.active ? '<span>使用中</span>' : ""}</div>
          <p>${character.builtin ? "内置示例角色" : escapeHtml(character.modelFile)} · ${character.voiceCount} 条语音</p>
        </div>
        <div class="character-actions">
          <button data-settings="${character.id}">设置</button>
          ${character.active ? "" : `<button data-activate="${character.id}">应用</button>`}
          ${character.builtin ? "" : `<button class="danger" data-delete="${character.id}" data-name="${escapeHtml(character.name)}">删除</button>`}
        </div>
      </article>
    `).join("");
    characterList.querySelectorAll<HTMLButtonElement>("[data-settings]").forEach(button => {
      button.addEventListener("click", () => void openCharacterSettings(button.dataset.settings!));
    });

    characterList.querySelectorAll<HTMLButtonElement>("[data-activate]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        const result = await api.activateCharacter(button.dataset.activate!);
        if (!result.ok) window.alert(result.error ?? "切换失败");
        await loadCharacters();
      });
    });
    characterList.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm(`确定删除角色“${button.dataset.name}”及其已导入素材吗？`)) return;
        const result = await api.deleteCharacter(button.dataset.delete!);
        if (!result.ok) window.alert(result.error ?? "删除失败");
        if (result.ok && editingCharacterId === button.dataset.delete) document.querySelector<HTMLButtonElement>("#close-character-settings")!.click();
        await loadCharacters();
      });
    });
  } catch (error) {
    characterList.innerHTML = `<div class="empty-state error">读取失败：${escapeHtml(String(error))}</div>`;
  }
}

modelButton.addEventListener("click", async () => {
  const result = await api.chooseModelFolder();
  if (result.canceled) return;
  if (result.error || !result.folderPath || !result.modelFiles?.length) {
    modelSummary.textContent = result.error ?? "没有找到骨骼文件";
    modelSummary.className = "selection-summary error";
    selectedModelFolder = "";
    modelPreviewGeneration++; importPreview.clear();
    return;
  }
  selectedModelFolder = result.folderPath;
  modelSummary.textContent = `${result.folderName} · ${result.modelFiles.length} 个骨骼 · ${result.atlasFiles?.length ?? 0} 个图集 · ${result.textureCount ?? 0} 张贴图`;
  modelSummary.className = "selection-summary success";
  modelFile.innerHTML = result.modelFiles.map((file) => `<option value="${escapeHtml(file)}">${escapeHtml(file)}</option>`).join("");
  atlasFile.innerHTML = (result.atlasFiles ?? []).map((file) => `<option value="${escapeHtml(file)}">${escapeHtml(file)}</option>`).join("");
  const matchingAtlas = (result.atlasFiles ?? []).find((file) => file.replace(/\.atlas$/i, "") === modelFile.value.replace(/\.(skel|json)$/i, ""));
  if (matchingAtlas) atlasFile.value = matchingAtlas;
  modelFileLabel.classList.remove("hidden");
  atlasFileLabel.classList.remove("hidden");
  void updateImportPreview();
});

modelFile.addEventListener("change", () => {
  const matchingAtlas = [...atlasFile.options].find((option) =>
    option.value.replace(/\.atlas$/i, "") === modelFile.value.replace(/\.(skel|json)$/i, "")
  );
  if (matchingAtlas) atlasFile.value = matchingAtlas.value;
  void updateImportPreview();
});
atlasFile.addEventListener("change", () => void updateImportPreview());
document.querySelector("#anim-idle")!.addEventListener("change", () => void updateImportPreview());
bundleCharacterId.addEventListener("input", invalidateVoicePreview);
bundleLanguage.addEventListener("change", invalidateVoicePreview);

function renderAudioRows() {
  audioList.innerHTML = audioRows.map((row, index) => `
    <div class="audio-row">
      <div><strong>${escapeHtml(row.name)}</strong><small>语音 ${String(index + 1).padStart(2, "0")}</small></div>
      <input data-subtitle="${index}" value="${escapeHtml(row.subtitle)}" placeholder="输入这条语音的字幕" />
      <button type="button" data-remove-audio="${index}" aria-label="删除">×</button>
    </div>
  `).join("");
  audioList.querySelectorAll<HTMLInputElement>("[data-subtitle]").forEach((input) => {
    input.addEventListener("input", () => { audioRows[Number(input.dataset.subtitle)].subtitle = input.value; });
  });
  audioList.querySelectorAll<HTMLButtonElement>("[data-remove-audio]").forEach((button) => {
    button.addEventListener("click", () => {
      audioRows.splice(Number(button.dataset.removeAudio), 1);
      renderAudioRows();
    });
  });
}

audioButton.addEventListener("click", async () => {
  const result = await api.chooseAudioFiles();
  if (result.canceled) return;
  const known = new Set(audioRows.map((row) => row.path));
  for (const file of result.files) {
    if (known.has(file.path)) continue;
    audioRows.push({ path: file.path, name: file.name, subtitle: file.name.replace(/\.[^.]+$/, "") });
  }
  renderAudioRows();
});

longVoiceButton.addEventListener("click", async () => {
  const result = await api.chooseLongVoiceFile();
  if (result.canceled || !result.path || !result.name) return;
  longVoiceFile = { path: result.path, name: result.name };
  invalidateVoicePreview();
  if (!bundleCharacterId.value.trim()) {
    const inferredId = result.name.match(/char_\d+_[a-z0-9]+/i)?.[0];
    if (inferredId) bundleCharacterId.value = inferredId;
  }
  longVoiceSummary.textContent = result.name;
  longVoiceSummary.title = result.path;
  longVoiceSummary.classList.add("selected");
});

document.querySelectorAll<HTMLButtonElement>("[data-config-kind]").forEach((button) => {
  button.addEventListener("click", async () => {
    const kind = button.dataset.configKind as VoiceConfigKind;
    const result = await api.chooseVoiceConfigFile(kind);
    if (result.canceled || !result.path || !result.name) return;
    customVoiceConfig[kind] = { path: result.path, name: result.name };
    invalidateVoicePreview();
    const summary = document.querySelector<HTMLElement>(`#config-${kind}-summary`)!;
    summary.textContent = result.name;
    summary.title = result.path;
    summary.classList.add("selected");
  });
});

const actionNames: ActionName[] = ["idle", "walk", "sit", "sleep", "touch", "special"];
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!characterName.value.trim()) return characterName.focus();
  if (!selectedModelFolder || !modelFile.value) {
    importStatus.textContent = "请先选择有效的 Spine 模型文件夹";
    switchPage("import");
    return;
  }

  importSubmit.disabled = true;
  importStatus.textContent = "正在复制并验证素材…";
  const animations = Object.fromEntries(actionNames.map((name) => [
    name,
    document.querySelector<HTMLInputElement>(`#anim-${name}`)!.value.trim()
  ]).filter(([, value]) => Boolean(value)));
  const hasVoiceBundle = Boolean(longVoiceFile) || Boolean(bundleCharacterId.value.trim());

  const result = await api.importCharacter({
    parameters: importParameters.get(),
    name: characterName.value.trim(),
    modelFolder: selectedModelFolder,
    modelFile: modelFile.value,
    atlasFile: atlasFile.value,
    animations,
    voices: audioRows.map((row) => ({ sourcePath: row.path, subtitle: row.subtitle.trim() || row.name.replace(/\.[^.]+$/, "") })),
    voiceBundle: hasVoiceBundle ? {
      audioPath: longVoiceFile?.path ?? "",
      characterId: bundleCharacterId.value.trim(),
      language: bundleLanguage.value,
      metadataPath: customVoiceConfig.metadata?.path,
      subtitlePath: customVoiceConfig.subtitles?.path
    } : undefined
  });
  importSubmit.disabled = false;
  if (!result.ok) {
    importStatus.textContent = `导入失败：${result.error ?? "未知错误"}`;
    return;
  }
  importStatus.textContent = "导入完成，桌宠已切换。";
  form.reset();
  modelPreviewGeneration++; importPreview.clear(); importParameters.set(undefined, true); invalidateVoicePreview();
  selectedModelFolder = "";
  audioRows = [];
  longVoiceFile = undefined;
  longVoiceSummary.textContent = "尚未选择文件";
  longVoiceSummary.removeAttribute("title");
  longVoiceSummary.classList.remove("selected");
  customVoiceConfig.metadata = undefined;
  customVoiceConfig.subtitles = undefined;
  for (const kind of ["metadata", "subtitles"] as VoiceConfigKind[]) {
    const summary = document.querySelector<HTMLElement>(`#config-${kind}-summary`)!;
    summary.textContent = kind === "metadata" ? "使用内置时间轴" : "使用内置简中台词";
    summary.removeAttribute("title");
    summary.classList.remove("selected");
  }
  modelSummary.textContent = "尚未选择";
  modelSummary.className = "selection-summary empty";
  modelFileLabel.classList.add("hidden");
  atlasFileLabel.classList.add("hidden");
  renderAudioRows();
  await loadCharacters();
  switchPage("characters");
});

document.querySelectorAll<HTMLButtonElement>("[data-url]").forEach((button) => {
  button.addEventListener("click", () => void api.openExternal(button.dataset.url!));
});
refreshButton.addEventListener("click", () => void loadCharacters());

void loadCharacters();
initializeFeatureSettings();
window.addEventListener("beforeunload", () => audition.stop());
