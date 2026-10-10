const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petSettings", {
  listCharacters: () => ipcRenderer.invoke("settings:list-characters"),
  chooseModelFolder: () => ipcRenderer.invoke("settings:choose-model-folder"),
  chooseAudioFiles: () => ipcRenderer.invoke("settings:choose-audio-files"),
  chooseLongVoiceFile: () => ipcRenderer.invoke("settings:choose-long-voice-file"),
  chooseVoiceConfigFile: (kind) => ipcRenderer.invoke("settings:choose-voice-config-file", kind),
  importCharacter: (payload) => ipcRenderer.invoke("settings:import-character", payload),
  activateCharacter: (id) => ipcRenderer.invoke("settings:activate-character", id),
  deleteCharacter: (id) => ipcRenderer.invoke("settings:delete-character", id),
  openExternal: (url) => ipcRenderer.invoke("settings:open-external", url)
});
