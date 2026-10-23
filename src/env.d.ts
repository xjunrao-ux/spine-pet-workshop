type PetActionName = "idle" | "walk" | "sit" | "sleep" | "touch" | "special";
type PetParameters = import("../electron/character-parameters.mjs").CharacterParameters;

type PetCommand =
  | { type: "action"; action: PetActionName }
  | { type: "scale"; value: number }
  | { type: "open-size-dialog"; current: number }
  | { type: "voice-enabled"; enabled: boolean }
  | { type: "parameters"; parameters: PetParameters };

interface PetDisplayStatus {
  name: string;
  visible: boolean;
  state: "loading" | "ready" | "hidden" | "error";
  message: string;
}

interface DesktopPetBridge {
  reportStatus?(state: "loading" | "ready" | "error", message?: string): void;
  companion?:{
    get():Promise<import('../electron/plugins/companion.mjs').CompanionState>;
    hover(value:boolean):void;
    click():void;
    onState(callback:(state:import('../electron/plugins/companion.mjs').CompanionState)=>void):()=>void;
  };
  isElectron: boolean;
  getCharacterConfig(): Promise<PetCharacterConfig>;
  showContextMenu(): void;
  beginDrag(): void;
  endDrag(): void;
  setWalking(enabled: boolean, direction: -1 | 1): void;
  setSupportRatio(ratio: number): void;
  setCustomScale(scale: number): void;
  onCommand(callback: (command: PetCommand) => void): () => void;
  onDirectionChanged(callback: (direction: -1 | 1) => void): () => void;
}

interface PetVoiceLine {
  id: string;
  audio: string;
  subtitle: string;
  title?: string;
  start?: number;
  end?: number;
}

interface PetCharacterConfig {
  parameters?: PetParameters;
  id: string;
  name: string;
  builtin: boolean;
  modelUrl: string;
  atlasUrl?: string;
  atlasText?: string;
  textureUrls?: Record<string, string>;
  voiceManifestUrl?: string;
  animations?: Partial<Record<PetActionName, string>>;
}

interface CharacterListItem {
  id: string;
  name: string;
  builtin: boolean;
  active: boolean;
  voiceCount: number;
  modelFile: string;
  atlasFile?: string;
  createdAt?: string;
}

interface ModelFolderSelection {
  canceled: boolean;
  folderPath?: string;
  folderName?: string;
  modelFiles?: string[];
  atlasFiles?: string[];
  textureCount?: number;
  error?: string;
}

interface SelectedAudioFile {
  path: string;
  name: string;
}

interface AudioFileSelection {
  canceled: boolean;
  files: SelectedAudioFile[];
}

interface SingleFileSelection {
  canceled: boolean;
  path?: string;
  name?: string;
}

interface CharacterImportPayload {
  parameters?: PetParameters;
  name: string;
  modelFolder: string;
  modelFile: string;
  atlasFile: string;
  animations: Partial<Record<PetActionName, string>>;
  voices: Array<{ sourcePath: string; subtitle: string }>;
  voiceBundle?: {
    audioPath: string;
    characterId: string;
    language: string;
    metadataPath?: string;
    subtitlePath?: string;
  };
}

interface PetSettingsBridge {
  getPetStatus?(): Promise<PetDisplayStatus>;
  onPetStatus?(callback: (status: PetDisplayStatus) => void): () => void;
  getCharacterConfig(id: string): Promise<PetCharacterConfig>;
  saveParameters(id: string, parameters: PetParameters): Promise<{ok: boolean; parameters?: PetParameters; error?: string}>;
  previewModel(payload: {modelFolder: string; modelFile: string; atlasFile: string}): Promise<PetCharacterConfig>;
  previewVoice(payload: NonNullable<CharacterImportPayload["voiceBundle"]>): Promise<{lines: PetVoiceLine[]; audioUrl: string}>;
  listCharacters(): Promise<CharacterListItem[]>;
  chooseModelFolder(): Promise<ModelFolderSelection>;
  chooseAudioFiles(): Promise<AudioFileSelection>;
  chooseLongVoiceFile(): Promise<SingleFileSelection>;
  chooseVoiceConfigFile(kind: "metadata" | "subtitles"): Promise<SingleFileSelection>;
  importCharacter(payload: CharacterImportPayload): Promise<{ ok: boolean; id?: string; error?: string }>;
  activateCharacter(id: string): Promise<{ ok: boolean; error?: string }>;
  deleteCharacter(id: string): Promise<{ ok: boolean; error?: string }>;
  openExternal(url: string): Promise<boolean>;
}

interface ComposerBridge {
 get():Promise<import('../electron/plugins/companion.mjs').CompanionState>;
 execute(id:string,epoch:number,command:string,text?:string):Promise<import('./plugins/types').CommandResult>;
 interaction(value:boolean):void;close():void;
 move(dx:number,dy:number,phase:'start'|'move'|'end'):Promise<{ok:boolean}>;
 resize(dx:number,edge:'left'|'right',phase:'start'|'move'|'end'):Promise<{ok:boolean}>;
 onState(callback:(state:import('../electron/plugins/companion.mjs').CompanionState)=>void):()=>void;
 onClose(callback:()=>void):()=>void;
}
interface Window {
  petCompanion?:ComposerBridge;
  petFeatures?: import("./features/types").FeatureBridge;
  desktopPet?: DesktopPetBridge;
  petSettings?: PetSettingsBridge;
}
