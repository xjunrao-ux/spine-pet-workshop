import { Assets } from "pixi.js";
import { AtlasAttachmentLoader, SkeletonBinary, SkeletonJson, TextureAtlas } from "@pixi-spine/all-3.8";
import "@pixi-spine/all-3.8";

export async function loadCharacterSpine(config: PetCharacterConfig) {
  if (config.builtin) return (await Assets.load(config.modelUrl))?.spineData;
  if (!config.atlasText || !config.textureUrls) throw new Error("角色缺少图集数据");
  const atlas = await new Promise<TextureAtlas>((resolve, reject) => {
    new TextureAtlas(config.atlasText!, (pageName, loaded) => {
      const url = config.textureUrls?.[pageName];
      if (!url) return reject(new Error(`没有找到贴图：${pageName}`));
      void Assets.load(url).then(texture => {
        if (!texture?.baseTexture) throw new Error(`贴图无法读取：${pageName}`);
        loaded(texture.baseTexture);
      }).catch(reject);
    }, resolve);
  });
  const response = await fetch(config.modelUrl);
  if (!response.ok) throw new Error(`骨骼读取失败：${response.status}`);
  const loader = new AtlasAttachmentLoader(atlas);
  const url = new URL(config.modelUrl, window.location.href);
  return url.pathname.toLowerCase().endsWith(".json") || url.searchParams.get("format") === "json"
    ? new SkeletonJson(loader).readSkeletonData(await response.json())
    : new SkeletonBinary(loader).readSkeletonData(new Uint8Array(await response.arrayBuffer()));
}
