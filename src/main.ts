import { Application, Assets, Container, FederatedPointerEvent, Point, Rectangle } from "pixi.js";
import { Spine } from "@pixi-spine/all-3.8";
import "@pixi-spine/all-3.8";
import "./style.css";

type SemanticAction = "idle" | "walk" | "sit" | "sleep" | "touch" | "special";

interface VoiceLine {
  id: string;
  audio: string;
  subtitle: string;
}

interface VoicePackManifest {
  id: string;
  voiceLocale: string;
  subtitleLocale: string;
  lines: VoiceLine[];
}

const MODEL_URL = "./models/amiya/build_char_002_amiya.skel";
const VOICE_PACK_URL = "./voicepacks/amiya-base/ja-JP/manifest.json";
const CLICK_VOICE_IDS = new Set(["assistant", "talk-1", "talk-2", "trust-talk-2", "idle"]);
const ACTION_CANDIDATES: Record<SemanticAction, string[]> = {
  idle: ["Relax", "Idle", "Default"],
  walk: ["Move", "Walk"],
  sit: ["Sit"],
  sleep: ["Sleep", "Lie"],
  touch: ["Interact", "Touch"],
  special: ["Special", "SpecialIdle", "IdleSpecial"]
};

const ACTION_LINES: Record<SemanticAction, string[]> = {
  idle: ["博士，工作告一段落后，也要记得休息。", "今天也请多指教，博士。"],
  walk: ["我去那边看看。", "请跟紧我，博士。"],
  sit: ["稍微休息一下吧。"],
  sleep: ["只休息一小会儿……"],
  touch: ["博士？", "有什么安排吗？", "我一直都在，博士。"],
  special: ["我会继续努力的。"]
};

const ACTION_DWELL: Record<SemanticAction, [number, number]> = {
  idle: [24_000, 42_000],
  walk: [2_800, 4_800],
  sit: [18_000, 30_000],
  sleep: [28_000, 48_000],
  touch: [24_000, 40_000],
  special: [16_000, 28_000]
};

const stageElement = document.querySelector<HTMLElement>("#stage")!;
const speechBubble = document.querySelector<HTMLElement>("#speech-bubble")!;
const loadingStatus = document.querySelector<HTMLElement>("#loading-status")!;
const sizeDialog = document.querySelector<HTMLElement>("#size-dialog")!;
const sizeRange = document.querySelector<HTMLInputElement>("#size-range")!;
const sizeValue = document.querySelector<HTMLElement>("#size-value")!;
const sizeCancel = document.querySelector<HTMLButtonElement>("#size-cancel")!;
const sizeApply = document.querySelector<HTMLButtonElement>("#size-apply")!;

let spine: Spine | undefined;
let modelContainer: Container | undefined;
let availableAnimations: string[] = [];
let activeAction: SemanticAction = "idle";
let facingDirection: -1 | 1 = -1;
let behaviorTimer: number | undefined;
let bubbleTimer: number | undefined;
let pointerDownAt = 0;
let pointerStartedOnModel = false;
let referenceBounds: { x: number; y: number; width: number; height: number } | undefined;
let pixiApplication: Application | undefined;
let modelScale = 1;
let targetSpineY = 0;
let poseAlignmentTimers: number[] = [];
let lastSupportRatio = 1;
let lastSupportUpdate = 0;
const hipPosition = new Point();
let voiceLines: VoiceLine[] = [];
let voiceTimer: number | undefined;
let activeVoice: HTMLAudioElement | undefined;
let lastVoiceId: string | undefined;
let voiceEnabled = true;
let voiceSubtitleVisible = false;

function findAnimation(action: SemanticAction): string | undefined {
  const lowerCaseMap = new Map(availableAnimations.map((name) => [name.toLowerCase(), name]));
  for (const candidate of ACTION_CANDIDATES[action]) {
    const exactMatch = lowerCaseMap.get(candidate.toLowerCase());
    if (exactMatch) return exactMatch;
  }

  return availableAnimations.find((name) =>
    ACTION_CANDIDATES[action].some((candidate) => name.toLowerCase().includes(candidate.toLowerCase()))
  );
}

function showSpeech(action: SemanticAction, customText?: string) {
  if (activeVoice && !activeVoice.paused) return;
  const lines = ACTION_LINES[action];
  speechBubble.textContent = customText ?? lines[Math.floor(Math.random() * lines.length)];
  speechBubble.classList.remove("long");
  speechBubble.classList.remove("hidden");
  window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => speechBubble.classList.add("hidden"), 3200);
}

function showVoiceSubtitle(text: string) {
  window.clearTimeout(bubbleTimer);
  voiceSubtitleVisible = true;
  speechBubble.textContent = text;
  speechBubble.classList.toggle("long", text.length >= 38);
  speechBubble.classList.remove("hidden");
}

function hideVoiceSubtitleSoon() {
  window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => {
    voiceSubtitleVisible = false;
    speechBubble.classList.add("hidden");
    speechBubble.classList.remove("long");
  }, 650);
}

function scheduleVoiceRotation(delay = 50_000 + Math.random() * 40_000) {
  window.clearTimeout(voiceTimer);
  if (!voiceEnabled) return;
  voiceTimer = window.setTimeout(() => {
    if (!voiceEnabled) return;
    if (document.hidden || voiceLines.length === 0) {
      scheduleVoiceRotation(15_000);
      return;
    }
    playRandomVoice();
  }, delay);
}

function playRandomVoice(fromClick = false) {
  if (!voiceEnabled || voiceLines.length === 0) return;
  const pool = fromClick ? voiceLines.filter((line) => CLICK_VOICE_IDS.has(line.id)) : voiceLines;
  const candidates = pool.filter((line) => line.id !== lastVoiceId);
  const line = candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
  if (line) void playVoiceLine(line);
}

function setVoiceEnabled(enabled: boolean) {
  voiceEnabled = enabled;
  window.clearTimeout(voiceTimer);
  if (!enabled) {
    activeVoice?.pause();
    activeVoice = undefined;
    if (voiceSubtitleVisible) {
      voiceSubtitleVisible = false;
      speechBubble.classList.add("hidden");
      speechBubble.classList.remove("long");
    }
    return;
  }
  if (voiceLines.length > 0) scheduleVoiceRotation(1_200);
}

async function playVoiceLine(line: VoiceLine) {
  if (!voiceEnabled) return;
  window.clearTimeout(voiceTimer);
  activeVoice?.pause();
  const manifestUrl = new URL(VOICE_PACK_URL, window.location.href);
  const audio = new Audio(new URL(line.audio, manifestUrl).href);
  activeVoice = audio;
  lastVoiceId = line.id;
  audio.volume = 0.78;

  const finish = () => {
    if (activeVoice !== audio) return;
    activeVoice = undefined;
    hideVoiceSubtitleSoon();
    if (voiceEnabled) scheduleVoiceRotation();
  };
  audio.addEventListener("ended", finish, { once: true });
  audio.addEventListener("error", finish, { once: true });

  showVoiceSubtitle(line.subtitle);
  try {
    await audio.play();
  } catch (error) {
    console.warn("语音播放失败", error);
    finish();
  }
}

async function initializeVoiceRotation() {
  try {
    const response = await fetch(VOICE_PACK_URL);
    if (!response.ok) throw new Error(`语言包载入失败：${response.status}`);
    const manifest = (await response.json()) as VoicePackManifest;
    voiceLines = manifest.lines.filter((line) => Boolean(line.audio && line.subtitle));
    if (voiceLines.length === 0) throw new Error("语言包中没有可播放的语音");
    scheduleVoiceRotation(4_500);
  } catch (error) {
    console.warn("日语语言包不可用，将继续使用文字气泡。", error);
  }
}

function randomDuration(action: SemanticAction) {
  const [minimum, maximum] = ACTION_DWELL[action];
  return minimum + Math.random() * (maximum - minimum);
}

function chooseAutonomousAction(): SemanticAction {
  const weighted: SemanticAction[] = [
    "idle", "idle", "idle", "idle", "idle", "walk", "sit", "sit", "sleep", "special"
  ];
  const valid = weighted.filter((action) => Boolean(findAnimation(action)));
  return valid[Math.floor(Math.random() * valid.length)] ?? "idle";
}

function scheduleNextBehavior(fromAction: SemanticAction) {
  window.clearTimeout(behaviorTimer);
  behaviorTimer = window.setTimeout(() => {
    const nextAction = chooseAutonomousAction();
    playAction(nextAction, { speak: Math.random() < 0.22, autonomous: true });
  }, randomDuration(fromAction));
}

function setFacingDirection(nextDirection: -1 | 1) {
  facingDirection = nextDirection;
  if (modelContainer) modelContainer.scale.x = facingDirection;
}

function updateSitSupportPoint() {
  if (!spine || !pixiApplication || activeAction !== "sit") return;
  const now = performance.now();
  if (now - lastSupportUpdate < 80) return;
  lastSupportUpdate = now;

  const hipBone = spine.skeleton.findBone("F_Hip");
  if (!hipBone) return;
  hipPosition.set(hipBone.worldX, hipBone.worldY);
  spine.toGlobal(hipPosition, hipPosition);
  const nextRatio = Math.max(0.5, Math.min(0.92, hipPosition.y / pixiApplication.screen.height));
  if (Math.abs(nextRatio - lastSupportRatio) < 0.004) return;
  lastSupportRatio = nextRatio;
  window.desktopPet?.setSupportRatio(nextRatio);
}

function closeSizeDialog() {
  sizeDialog.classList.add("hidden");
}

function openSizeDialog(currentScale: number) {
  const percent = Math.round(currentScale * 100);
  sizeRange.value = String(percent);
  sizeValue.textContent = String(percent);
  sizeDialog.classList.remove("hidden");
  sizeRange.focus();
}

function alignCurrentPoseToBottom() {
  if (!spine || !pixiApplication) return;
  const poseBounds = spine.getLocalBounds();
  targetSpineY = -(poseBounds.y + poseBounds.height) * modelScale;
}

function schedulePoseAlignment() {
  for (const timer of poseAlignmentTimers) window.clearTimeout(timer);
  poseAlignmentTimers = [80, 460, 900].map((delay) =>
    window.setTimeout(() => alignCurrentPoseToBottom(), delay)
  );
}

function playAction(
  action: SemanticAction,
  options: { speak?: boolean; autonomous?: boolean; schedule?: boolean } = {}
) {
  if (!spine) return;
  const animationName = findAnimation(action);
  if (!animationName) return;

  activeAction = action;
  lastSupportRatio = action === "sit" ? 0.72 : 1;
  window.desktopPet?.setSupportRatio(lastSupportRatio);
  const looping = action === "idle" || action === "walk" || action === "sit" || action === "sleep";
  spine.state.setAnimation(0, animationName, looping);
  schedulePoseAlignment();

  if (action === "walk") {
    if (!options.autonomous) setFacingDirection(Math.random() > 0.5 ? 1 : -1);
    window.desktopPet?.setWalking(true, facingDirection);
  } else {
    window.desktopPet?.setWalking(false, facingDirection);
  }

  if (options.speak) showSpeech(action);

  if (!looping) {
    const idleName = findAnimation("idle") ?? animationName;
    spine.state.addAnimation(0, idleName, true, 0);
    window.setTimeout(() => {
      if (activeAction !== action) return;
      activeAction = "idle";
      schedulePoseAlignment();
      if (options.schedule !== false) scheduleNextBehavior("idle");
    }, 1650);
  } else if (options.schedule !== false) {
    scheduleNextBehavior(action);
  }
}

function fitModel(application: Application) {
  if (!spine || !modelContainer || !referenceBounds) return;

  const bounds = referenceBounds;
  const usableWidth = application.screen.width * 0.72;
  const usableHeight = application.screen.height * 0.72;
  const scale = Math.min(usableWidth / Math.max(bounds.width, 1), usableHeight / Math.max(bounds.height, 1));

  modelScale = scale;
  spine.scale.set(scale);
  spine.x = -(bounds.x + bounds.width / 2) * scale;
  const poseBounds = spine.getLocalBounds();
  targetSpineY = -(poseBounds.y + poseBounds.height) * scale;
  spine.y = targetSpineY;
  modelContainer.x = application.screen.width / 2;
  modelContainer.y = application.screen.height - 6;
  modelContainer.scale.x = facingDirection;
}

function handleModelPointerDown(event: FederatedPointerEvent) {
  if (event.button === 2) {
    event.preventDefault();
    window.desktopPet?.showContextMenu();
    return;
  }
  if (event.button !== 0) return;

  pointerDownAt = performance.now();
  pointerStartedOnModel = true;
  window.clearTimeout(behaviorTimer);
  window.desktopPet?.setWalking(false, facingDirection);
  window.desktopPet?.beginDrag();
}

function handlePointerUp() {
  if (!pointerStartedOnModel) return;
  pointerStartedOnModel = false;
  window.desktopPet?.endDrag();

  const heldFor = performance.now() - pointerDownAt;
  if (heldFor < 230) {
    playAction("touch", { speak: !voiceEnabled, schedule: true });
    playRandomVoice(true);
  }
  else scheduleNextBehavior(activeAction === "walk" ? "idle" : activeAction);
}

async function initialize() {
  const application = new Application({
    resizeTo: stageElement,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio, 2)
  });
  pixiApplication = application;

  stageElement.appendChild(application.view as HTMLCanvasElement);
  application.stage.eventMode = "static";
  application.stage.hitArea = new Rectangle(0, 0, application.screen.width, application.screen.height);

  try {
    const resource = await Assets.load(MODEL_URL);
    if (!resource?.spineData) throw new Error("Spine loader did not return spineData");

    spine = new Spine(resource.spineData);
    spine.autoUpdate = true;
    spine.eventMode = "static";
    spine.cursor = "grab";
    spine.stateData.defaultMix = 0.42;
    spine.on("pointerdown", handleModelPointerDown);

    modelContainer = new Container();
    modelContainer.alpha = 0;
    modelContainer.addChild(spine);
    application.stage.addChild(modelContainer);

    availableAnimations = spine.spineData.animations.map((animation) => animation.name);
    const initialAnimation = findAnimation("idle") ?? availableAnimations[0];
    if (!initialAnimation) throw new Error("模型中没有可播放的动画");

    spine.state.setAnimation(0, initialAnimation, true);
    spine.scale.set(1);
    spine.position.set(0, 0);
    const initialBounds = spine.getLocalBounds();
    referenceBounds = {
      x: initialBounds.x,
      y: initialBounds.y,
      width: initialBounds.width,
      height: initialBounds.height
    };
    fitModel(application);
    activeAction = "idle";
    loadingStatus.classList.add("hidden");

    application.ticker.add(() => {
      if (modelContainer && modelContainer.alpha < 1) {
        modelContainer.alpha = Math.min(1, modelContainer.alpha + 0.045);
      }
      if (spine) spine.y += (targetSpineY - spine.y) * 0.16;
      updateSitSupportPoint();
    });

    const resizeObserver = new ResizeObserver(() => {
      application.stage.hitArea = new Rectangle(0, 0, application.screen.width, application.screen.height);
      fitModel(application);
      schedulePoseAlignment();
    });
    resizeObserver.observe(stageElement);

    showSpeech("idle", "左键拖动我，右键可以打开菜单。 ");
    scheduleNextBehavior("idle");
    await initializeVoiceRotation();
  } catch (error) {
    console.error(error);
    loadingStatus.textContent = error instanceof Error ? `模型加载失败：${error.message}` : "模型加载失败";
  }
}

window.addEventListener("pointerup", handlePointerUp);
window.addEventListener("blur", () => {
  if (pointerStartedOnModel) handlePointerUp();
});
window.addEventListener("beforeunload", () => {
  window.clearTimeout(voiceTimer);
  activeVoice?.pause();
});
document.addEventListener("contextmenu", (event) => event.preventDefault());
sizeRange.addEventListener("input", () => {
  sizeValue.textContent = sizeRange.value;
});
sizeCancel.addEventListener("click", closeSizeDialog);
sizeApply.addEventListener("click", () => {
  window.desktopPet?.setCustomScale(Number(sizeRange.value) / 100);
  closeSizeDialog();
});
sizeDialog.addEventListener("pointerdown", (event) => {
  if (event.target === sizeDialog) closeSizeDialog();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSizeDialog();
});

window.desktopPet?.onCommand((command) => {
  if (command.type === "action") playAction(command.action, { speak: true, schedule: true });
  if (command.type === "scale") {
    window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      if (pixiApplication) {
        fitModel(pixiApplication);
        schedulePoseAlignment();
      }
    }, 0);
  }
  if (command.type === "open-size-dialog") openSizeDialog(command.current);
  if (command.type === "voice-enabled") setVoiceEnabled(command.enabled);
});

window.desktopPet?.onDirectionChanged((nextDirection) => setFacingDirection(nextDirection));

void initialize();
