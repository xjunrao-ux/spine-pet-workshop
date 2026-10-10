type PetActionName = "idle" | "walk" | "sit" | "sleep" | "touch" | "special";

type PetCommand =
  | { type: "action"; action: PetActionName }
  | { type: "scale"; value: number }
  | { type: "open-size-dialog"; current: number }
  | { type: "voice-enabled"; enabled: boolean };

interface DesktopPetBridge {
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

interface Window {
  desktopPet?: DesktopPetBridge;
  petSettings?: PetSettingsBridge;
}
