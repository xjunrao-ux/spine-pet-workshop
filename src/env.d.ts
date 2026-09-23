type PetActionName = "idle" | "walk" | "sit" | "sleep" | "touch" | "special";

type PetCommand =
  | { type: "action"; action: PetActionName }
  | { type: "scale"; value: number }
  | { type: "open-size-dialog"; current: number }
  | { type: "voice-enabled"; enabled: boolean };

interface DesktopPetBridge {
  isElectron: boolean;
  showContextMenu(): void;
  beginDrag(): void;
  endDrag(): void;
  setWalking(enabled: boolean, direction: -1 | 1): void;
  setSupportRatio(ratio: number): void;
  setCustomScale(scale: number): void;
  onCommand(callback: (command: PetCommand) => void): () => void;
  onDirectionChanged(callback: (direction: -1 | 1) => void): () => void;
}

interface Window {
  desktopPet?: DesktopPetBridge;
}
