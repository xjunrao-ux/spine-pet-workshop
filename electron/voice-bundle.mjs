export function parseArkVoiceBundle(voiceData, subtitleData, characterId, language, audioRelativePath) {
  const normalizedCharacterId = String(characterId ?? "").trim();
  const normalizedLanguage = String(language ?? "JP").trim().toUpperCase();
  const characterVoiceData = voiceData?.data?.[normalizedCharacterId];
  const variation = characterVoiceData?.variations?.[normalizedLanguage];
  const clips = Array.isArray(variation?.clips) ? variation.clips : [];
  if (clips.length === 0) {
    const available = Object.keys(characterVoiceData?.variations ?? {}).join("、") || "无";
    const characterIds = Object.keys(voiceData?.data ?? {});
    const numberPart = normalizedCharacterId.match(/char_(\d+)/i)?.[1];
    const similarIds = characterIds
      .filter((id) => id.toLowerCase().includes(normalizedCharacterId.toLowerCase()) || (numberPart && id.includes(`char_${numberPart}_`)))
      .slice(0, 5);
    const suggestion = similarIds.length > 0 ? `；相近角色 ID：${similarIds.join("、")}` : "";
    throw new Error(`voice_data.json 中找不到 ${normalizedCharacterId} 的 ${normalizedLanguage} 语音；可用语种：${available}${suggestion}`);
  }

  const charWords = subtitleData?.charWords ?? subtitleData;
  const lines = [];
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const clipName = String(clip?.name ?? "").trim();
    const start = Number(clip?.start);
    const end = index + 1 < clips.length ? Number(clips[index + 1]?.start) : Number(variation?.duration);
    if (!clipName || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const subtitleEntry = charWords?.[`${normalizedCharacterId}_${clipName}`];
    const subtitle = String(subtitleEntry?.voiceText ?? "").replace(/<[^>]+>/g, "").trim();
    if (!subtitle) continue;
    lines.push({
      id: clipName,
      audio: audioRelativePath,
      subtitle: subtitle.slice(0, 500),
      title: String(subtitleEntry?.voiceTitle ?? "").trim().slice(0, 100),
      start: Math.max(0, start),
      end
    });
  }

  if (lines.length === 0) {
    throw new Error(`没有匹配到中文字幕。请确认角色 ID“${normalizedCharacterId}”正确，并使用简中 charword_table.json`);
  }
  return lines;
}
