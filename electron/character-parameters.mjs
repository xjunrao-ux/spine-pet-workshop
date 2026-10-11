// Shared, versioned parameter contract. UI, persistence and playback use this registry.
export const PARAMETER_FIELDS = [
  { key: "audioStartOffsetMs", label: "语音起点校准", unit: "毫秒", min: -30000, max: 30000, step: 10, default: 0,
    hint: "负值提前开始、正值延后开始；只调整长音频分句的起点。" },
  { key: "audioEndOffsetMs", label: "语音终点校准", unit: "毫秒", min: -30000, max: 30000, step: 10, default: 0,
    hint: "负值提前结束、正值延后结束；可与起点分别调整，原始时间轴不变。" },
  { key: "modelScalePercent", label: "角色大小", unit: "%", min: 30, max: 120, step: 1, default: 60,
    hint: "调整桌宠整体大小；字体自动跟随缩放，设置仅影响此角色。" },
  { key: "fontSizePx", label: "字幕基准字号", unit: "像素", min: 8, max: 24, step: 1, default: 13,
    hint: "角色大小为 60% 时的基准字号；小角色适当缩小，大角色适当放大，长句更紧凑。" },
  { key: "bubbleOffsetY", label: "语音气泡高度偏移", unit: "像素", min: -250, max: 250, step: 1, default: 0, reverse: true,
    hint: "负值向上，正值向下；超出窗口时自动限制在可见区域。" },
  { key: "bubbleTransparency", label: "气泡背景透明度", unit: "%", min: 0, max: 100, step: 1, default: 24,
    hint: "0% 不透明、100% 完全透明；只调整背景，字幕保持清晰。" }
];

export function normalizeParameters(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = { ...input, schemaVersion: 2 };
  // Retired preference: old profiles must not silently override random walking.
  delete output.walkDirection;
  const legacyOffset = typeof input.audioOffsetMs === "number" && Number.isFinite(input.audioOffsetMs) ? input.audioOffsetMs : 0;
  for (const field of PARAMETER_FIELDS) {
    const candidate = input[field.key] ?? (field.key === "audioStartOffsetMs" || field.key === "audioEndOffsetMs" ? legacyOffset : undefined);
    if (field.options) output[field.key] = field.options.some(option => option.value === candidate) ? candidate : field.default;
    else output[field.key] = typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(field.min, Math.min(field.max, candidate)) : field.default;
  }
  return output;
}

export function mergeParameters(existing, patch) {
  const update = { ...patch };
  if (Object.hasOwn(update, "audioOffsetMs") && !Object.hasOwn(update, "audioStartOffsetMs") && !Object.hasOwn(update, "audioEndOffsetMs")) {
    update.audioStartOffsetMs = update.audioOffsetMs; update.audioEndOffsetMs = update.audioOffsetMs;
  }
  return normalizeParameters({ ...normalizeParameters(existing), ...update });
}

export function speechMetrics(parameters, scale, long = false) {
  const config = normalizeParameters(parameters);
  const effectiveScale = Number.isFinite(scale) ? Math.max(0.3, Math.min(1.2, scale)) : config.modelScalePercent / 100;
  const factor = Math.pow(effectiveScale / 0.6, 0.6);
  const fontSize = Math.max(8, Math.min(30, config.fontSizePx * factor * (long ? 0.88 : 1)));
  return { fontSize: Math.round(fontSize * 100) / 100, paddingY: Math.round(6 * factor), paddingX: Math.round(10 * factor),
    backgroundAlpha: 1 - config.bubbleTransparency / 100 };
}

export function chooseWalkDirection(parameters, random = Math.random) {
  return random() < 0.5 ? -1 : 1;
}

export function modelLayout(bounds, width, height) {
  const scale = Math.min(width * .72 / Math.max(bounds.width, 1), height * .72 / Math.max(bounds.height, 1));
  return { scale, x: width / 2 - (bounds.x + bounds.width / 2) * scale, y: height - 6 - (bounds.y + bounds.height) * scale };
}
export function bubbleTop(parameters, height, bubbleHeight, headTop, long = false) {
  const offset = normalizeParameters(parameters).bubbleOffsetY;
  let top = (long ? 3 : 18) + offset;
  if (offset === 0 && Number.isFinite(headTop)) top = Math.min(top, headTop - bubbleHeight - 4);
  return Math.max(0, Math.min(height - bubbleHeight - 4, top));
}

export function calibratedSegment(line, parameters, duration = Infinity) {
  if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.end <= line.start) return undefined;
  const config = normalizeParameters(parameters);
  const limit = Number.isFinite(duration) && duration >= 0 ? duration : Infinity;
  const start = Math.max(0, Math.min(limit, line.start + config.audioStartOffsetMs / 1000));
  const end = Math.max(0, Math.min(limit, line.end + config.audioEndOffsetMs / 1000));
  return { start, end, playable: end > start };
}
