import "./settings.css";

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
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.page === name));
  pages.forEach((page) => page.classList.toggle("active", page.id === `page-${name}`));
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
          ${character.active ? "" : `<button data-activate="${character.id}">应用</button>`}
          ${character.builtin ? "" : `<button class="danger" data-delete="${character.id}" data-name="${escapeHtml(character.name)}">删除</button>`}
        </div>
      </article>
    `).join("");

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
});

modelFile.addEventListener("change", () => {
  const matchingAtlas = [...atlasFile.options].find((option) =>
    option.value.replace(/\.atlas$/i, "") === modelFile.value.replace(/\.(skel|json)$/i, "")
  );
  if (matchingAtlas) atlasFile.value = matchingAtlas.value;
});

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
