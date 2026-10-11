const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("featureSettings", {
  get: () => ipcRenderer.invoke("features:get"),
  set: settings => ipcRenderer.invoke("features:set", settings),
  startup: () => ipcRenderer.invoke("settings:startup-get"),
  setStartup: enabled => ipcRenderer.invoke("settings:startup-set", enabled),
  permission: () => ipcRenderer.invoke("features:permission"),
  preview: () => ipcRenderer.send("features:preview"),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("features:state", listener);
    return () => ipcRenderer.removeListener("features:state", listener);
  }
});

contextBridge.exposeInMainWorld("petSettings", {
  getCharacterConfig: (id) => ipcRenderer.invoke("settings:get-character-config", id),
  saveParameters: (id, parameters) => ipcRenderer.invoke("settings:save-parameters", id, parameters),
  previewModel: (payload) => ipcRenderer.invoke("settings:preview-model", payload),
  previewVoice: (payload) => ipcRenderer.invoke("settings:preview-voice", payload),
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
