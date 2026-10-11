import { Application } from "pixi.js";
import { Spine } from "@pixi-spine/all-3.8";
import { normalizeParameters, calibratedSegment, speechMetrics, modelLayout, bubbleTop } from "../electron/character-parameters.mjs";
import { loadCharacterSpine } from "./spine-loader";

export class CharacterPreview {
  private app: Application;
  private spine?: Spine;
  private generation = 0;
  private bubble: HTMLElement;
  private status: HTMLElement;
  private animations: HTMLSelectElement;
  private stage: HTMLElement;
  private parameters = normalizeParameters();
  private bounds?: {x: number; y: number; width: number; height: number};
  constructor(private host: HTMLElement) {
    host.classList.add("character-preview");
    this.app = new Application({ width: 340, height: 330, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio, 2) });
    const viewport = document.createElement('div'); viewport.className = 'preview-viewport';
    this.stage = document.createElement('div'); this.stage.className = 'preview-stage';
    this.stage.append(this.app.view as HTMLCanvasElement); viewport.append(this.stage); host.append(viewport);
    this.bubble = document.createElement("div"); this.bubble.className = "preview-bubble";
    this.bubble.textContent = "这是语音气泡预览";
    this.status = document.createElement("p"); this.status.className = "preview-status";
    this.status.textContent = "选择模型后显示角色预览";
    this.animations = document.createElement("select");
    this.animations.className = "preview-animations"; this.animations.setAttribute("aria-label", "预览动画");
    this.animations.disabled = true;
    this.animations.addEventListener("change", () => { this.spine?.state.setAnimation(0, this.animations.value, true); window.setTimeout(() => this.fit(), 100); });
    this.stage.append(this.bubble); host.append(this.status, this.animations);
    const label = document.createElement('small'); label.className = 'preview-scale'; label.textContent = '与桌宠相同的逻辑像素尺寸 · 大角色可滚动查看'; host.append(label);
    new ResizeObserver(() => this.positionBubble()).observe(this.bubble);
    new ResizeObserver(() => this.fit()).observe(host);
  }
  setParameters(value: unknown) {
    this.parameters = normalizeParameters(value);
    const metrics = speechMetrics(this.parameters);
    this.bubble.style.fontSize = `${metrics.fontSize}px`;
    this.bubble.style.padding = `${metrics.paddingY}px ${metrics.paddingX}px`;
    this.bubble.style.background = `rgba(255,255,255,${metrics.backgroundAlpha})`;
    this.fit();
  }
  showError(message: string) { this.clear(); this.status.textContent = message; }
  clear() {
    this.generation++;
    this.spine?.destroy({children: true}); this.spine = undefined; this.bounds = undefined;
    this.animations.replaceChildren(); this.animations.disabled = true;
    this.status.textContent = "选择模型后显示角色预览";
  }
  async load(config: PetCharacterConfig) {
    this.clear();
    this.setParameters(config.parameters ?? this.parameters);
    const generation = this.generation;
    this.status.textContent = "正在加载预览…";
    try {
      const data = await loadCharacterSpine(config);
      if (generation !== this.generation) return;
      if (!data) throw new Error("没有可用的骨骼数据");
      const spine = new Spine(data); this.spine = spine;
      this.app.stage.addChild(spine);
      const names = spine.spineData.animations.map(animation => animation.name);
      if (!names.length) throw new Error("模型没有动画");
      for (const name of names) this.animations.add(new Option(name, name));
      const idle = config.animations?.idle;
      const candidates = [idle, 'Relax', 'Idle', 'Default'].filter(Boolean) as string[];
      this.animations.value = candidates.map(candidate => names.find(name => name.toLowerCase() === candidate.toLowerCase())).find(Boolean)
        ?? names.find(name => candidates.some(candidate => name.toLowerCase().includes(candidate.toLowerCase()))) ?? names[0];
      this.animations.disabled = false;
      spine.state.setAnimation(0, this.animations.value, true);
      const bounds = spine.getLocalBounds(); this.bounds = {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height};
      this.fit(); this.setParameters(this.parameters);
      this.status.textContent = "";
    } catch (error) {
      if (generation === this.generation) this.showError(`预览失败：${error instanceof Error ? error.message : error}`);
    }
  }
  private fit() {
    const scale = this.parameters.modelScalePercent / 100;
    const width = Math.round(420 * scale), height = Math.round(500 * scale);
    this.app.renderer.resize(width, height);
    this.stage.style.width = `${width}px`; this.stage.style.height = `${height}px`;
    this.bubble.style.maxWidth = `${Math.min(290, width - 32)}px`;
    this.host.style.height = `${Math.max(350, height + 62)}px`;
    if (!this.spine || !this.bounds) return;
    const layout = modelLayout(this.bounds, width, height);
    this.spine.scale.set(layout.scale);
    const pose = this.spine.getLocalBounds();
    this.spine.position.set(layout.x, height - 6 - (pose.y + pose.height) * layout.scale);
    this.positionBubble();
  }
  private positionBubble() {
    this.bubble.style.top = `${bubbleTop(this.parameters, this.app.screen.height, this.bubble.offsetHeight, this.spine?.getBounds().y)}px`;
  }
}

// Independent audition player: never changes the active desktop character.
export class VoiceAudition {
  private audio?: HTMLAudioElement;
  private timer?: number;
  private cancelMetadata?: () => void;
  stop() {
    window.clearTimeout(this.timer); this.audio?.pause(); this.audio = undefined;
    const cancel = this.cancelMetadata; this.cancelMetadata = undefined; cancel?.();
  }
  async play(line: PetVoiceLine, url: string, parameters: PetParameters, status: HTMLElement) {
    this.stop();
    const audio = new Audio(url); this.audio = audio;
    status.textContent = `试听：${line.subtitle}`;
    const finish = () => { if (this.audio === audio) { this.stop(); status.textContent = "试听结束，可调整后再次试听"; } };
    const fail = () => { if (this.audio === audio) { this.stop(); status.textContent = "音频无法播放，请检查文件或校准偏移"; } };
    audio.addEventListener("error", fail, {once: true}); audio.addEventListener("ended", finish, {once: true});
    await new Promise<void>(resolve => {
      this.cancelMetadata = resolve;
      audio.addEventListener("loadedmetadata", () => resolve(), {once: true});
      audio.addEventListener("error", () => resolve(), {once: true});
      this.timer = window.setTimeout(() => { fail(); resolve(); }, 10000);
      audio.load();
    });
    if (this.audio !== audio) return;
    this.cancelMetadata = undefined; window.clearTimeout(this.timer);
    try {
      const segment = calibratedSegment(line, parameters, audio.duration);
      if (segment) {
        if (!segment.playable) { this.stop(); status.textContent = "当前起止校准没有有效音频区间，请保证起点早于终点且在音频范围内"; return; }
        audio.currentTime = segment.start;
        const arm = () => {
          if (this.audio !== audio) return;
          window.clearTimeout(this.timer);
          const remaining = (segment.end - audio.currentTime) * 1000;
          if (remaining <= 0) finish(); else this.timer = window.setTimeout(finish, remaining);
        };
        audio.addEventListener("playing", arm);
        const disarm = () => { if (this.audio === audio) window.clearTimeout(this.timer); };
        audio.addEventListener("waiting", disarm);
        audio.addEventListener("seeking", disarm);
        audio.addEventListener("seeked", () => { if (!audio.paused) arm(); });
        audio.addEventListener("timeupdate", () => { if (audio.currentTime >= segment.end) finish(); });
      }
      await audio.play();
    } catch { fail(); }
  }
}
