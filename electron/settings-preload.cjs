const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("featureSettings", {
  get: () => ipcRenderer.invoke("features:get"),
  set: settings => ipcRenderer.invoke("features:set", settings),
  startup: () => ipcRenderer.invoke("settings:startup-get"),
  setStartup: enabled => ipcRenderer.invoke("settings:startup-set", enabled),
  execute: (id,command,payload) => ipcRenderer.invoke("features:execute",id,command,payload),
  restart: id => ipcRenderer.invoke("features:restart",id),
  installPlugin: () => ipcRenderer.invoke("features:install-plugin"),
  uninstallPlugin: id => ipcRenderer.invoke("features:uninstall-plugin",id),
  preview: () => ipcRenderer.send("features:preview"),
  onNavigate: callback => { const listener=(_event,id)=>callback(id);ipcRenderer.on('features:navigate',listener);return ()=>ipcRenderer.removeListener('features:navigate',listener); },
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("features:state", listener);
    return () => ipcRenderer.removeListener("features:state", listener);
  }
});

contextBridge.exposeInMainWorld("petSettings", {
  updates: {
    get: () => ipcRenderer.invoke('updates:get'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    preferences: patch => ipcRenderer.invoke('updates:preferences', patch),
    checkPlugins: () => ipcRenderer.invoke('updates:plugins-check'),
    installPlugin: id => ipcRenderer.invoke('updates:plugin-install', id),
    onState: callback => {const listener = (_event, value) => callback(value); ipcRenderer.on('updates:state', listener); return () => ipcRenderer.removeListener('updates:state', listener);}
  },
  onNavigate: callback => {const listener = (_event, page) => callback(page); ipcRenderer.on('settings:navigate', listener); return () => ipcRenderer.removeListener('settings:navigate', listener);},
  getPetStatus: () => ipcRenderer.invoke("settings:pet-status"),
  onPetStatus: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on("settings:pet-status", listener); return () => ipcRenderer.removeListener("settings:pet-status", listener); },
  getCharacterConfig: (id) => ipcRenderer.invoke("settings:get-character-config", id),
  saveParameters: (id, parameters) => ipcRenderer.invoke("settings:save-parameters", id, parameters),
  previewModel: (payload) => ipcRenderer.invoke("settings:preview-model", payload),
  previewVoice: (payload) => ipcRenderer.invoke("settings:preview-voice", payload),
  listCharacters: () => ipcRenderer.invoke("settings:list-characters"),
  chooseModelFolder: () => ipcRenderer.invoke("settings:choose-model-folder"),
  searchModels: query => ipcRenderer.invoke('settings:search-models', query),
  openModelPage: key => ipcRenderer.invoke('settings:open-model-page', key),
  downloadModel: key => ipcRenderer.invoke('settings:download-model', key),
  downloadVoice: key => ipcRenderer.invoke('settings:download-voice', key),
  openVoicePage: key => ipcRenderer.invoke('settings:open-voice-page', key),
  cancelModelDownload: () => ipcRenderer.invoke('settings:cancel-model-download'),
  onModelDownloadProgress: callback => { const listener = (_event, progress) => callback(progress); ipcRenderer.on('settings:model-download-progress', listener); return () => ipcRenderer.removeListener('settings:model-download-progress', listener); },
  chooseAudioFiles: () => ipcRenderer.invoke("settings:choose-audio-files"),
  chooseLongVoiceFile: () => ipcRenderer.invoke("settings:choose-long-voice-file"),
  chooseVoiceConfigFile: (kind) => ipcRenderer.invoke("settings:choose-voice-config-file", kind),
  importCharacter: (payload) => ipcRenderer.invoke("settings:import-character", payload),
  activateCharacter: (id) => ipcRenderer.invoke("settings:activate-character", id),
  deleteCharacter: (id) => ipcRenderer.invoke("settings:delete-character", id),
  openExternal: (url) => ipcRenderer.invoke("settings:open-external", url)
});
