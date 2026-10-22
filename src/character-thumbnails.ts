import { Application } from "pixi.js";
import { Spine } from "@pixi-spine/all-3.8";
import { loadCharacterSpine } from "./spine-loader";

// One offscreen renderer produces static portraits only for visible cards.
// It never changes the desktop character, parameters, or shared texture ownership.
export class CharacterThumbnails {
  private app?: Application;
  private observer?: IntersectionObserver;
  private queue: Array<{host: HTMLElement; generation: number}> = [];
  private generation = 0;
  private busy = false;
  private disposed = false;

  constructor(private root: HTMLElement, private api: PetSettingsBridge) {
    window.addEventListener("beforeunload", () => {
      this.disposed = true;
      this.clear();
      this.app?.destroy(true, {children: true, texture: false, baseTexture: false});
      this.app = undefined;
    }, {once: true});
  }

  clear() {
    this.generation++;
    this.observer?.disconnect();
    this.queue = [];
  }

  observe() {
    const generation = this.generation;
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.observer?.unobserve(entry.target);
        this.queue.push({host: entry.target as HTMLElement, generation});
      }
      void this.drain();
    }, {root: this.root.closest(".page"), rootMargin: "120px"});
    this.root.querySelectorAll<HTMLElement>("[data-thumbnail]").forEach(host => this.observer!.observe(host));
  }

  private async drain() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      while (this.queue.length && !this.disposed) {
        const {host, generation} = this.queue.shift()!;
        if (generation !== this.generation || !host.isConnected) continue;
        let spine: Spine | undefined;
        try {
          const config = await this.api.getCharacterConfig(host.dataset.thumbnail!);
          const data = await loadCharacterSpine(config);
          if (generation !== this.generation || !host.isConnected || this.disposed) continue;
          if (!data) throw new Error("没有可用的模型");
          this.app ??= new Application({width: 360, height: 360, autoStart: false, backgroundAlpha: 0, antialias: true, resolution: 1});
          spine = new Spine(data);
          spine.autoUpdate = false;
          this.app.stage.addChild(spine);
          const names = spine.spineData.animations.map(animation => animation.name);
          const candidates = [config.animations?.idle, "Relax", "Idle", "Default"].filter(Boolean) as string[];
          const animation = candidates.map(candidate => names.find(name => name.toLowerCase() === candidate.toLowerCase())).find(Boolean) ?? names[0];
          if (animation) { spine.state.setAnimation(0, animation, true); spine.update(.2); }
          const bounds = spine.getLocalBounds();
          const scale = Math.min(300 / Math.max(1, bounds.width), 308 / Math.max(1, bounds.height));
          spine.scale.set(scale);
          spine.position.set(180 - (bounds.x + bounds.width / 2) * scale, 334 - (bounds.y + bounds.height) * scale);
          this.app.renderer.render(this.app.stage);
          const image = new Image();
          image.className = "character-thumbnail"; image.alt = "";
          const canvas = this.app.renderer.extract.canvas() as HTMLCanvasElement;
          image.src = canvas.toDataURL("image/png");
          host.querySelector(".character-mark")?.remove();
          host.querySelector(".thumbnail-status")?.remove();
          host.append(image);
        } catch {
          if (generation === this.generation && host.isConnected) {
            const status = host.querySelector(".thumbnail-status");
            if (status) status.textContent = "预览暂不可用";
          }
        } finally {
          spine?.destroy({children: true, texture: false, baseTexture: false});
        }
      }
    } finally { this.busy = false; }
  }
}
