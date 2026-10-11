export type ModuleId = 'music' | 'notifications' | 'codex';
export interface FeatureSettings {
  music: boolean; notifications: boolean; codex: boolean; details: boolean;
  subtitles: boolean; quiet: boolean; reducedMotion: boolean; blockedApps: string[]; hoverDelay: number;
  cardWidth: number; cardHeight: number;
}
export interface MediaSession {
  id: string; title: string; artist: string; album: string; cover: string | null; status: string;
  position: number; duration: number; timelineUpdatedAt?: string; fallback?: boolean; fallbackReason?: string; name?: string; coverStatus?: string;
  capabilities: { play: boolean; pause: boolean; next: boolean; previous: boolean };
}
export interface Notice { id: string; app: string; appId: string; createdAt: string; title: string; body: string }
export interface LimitWindow { remaining: number; minutes: number | null; resetsAt: string | null }
export interface CodexTask { id: string; name: string; status: string; turnStatus?: string; updatedAt: number }
export interface FeatureSnapshot {
  settings: FeatureSettings; locked: boolean;
  media: { sessions: MediaSession[]; currentId?: string; error: string | null };
  notifications: { permission: string; items: Notice[]; error: string | null;
    channels?: Array<{id: string;name: string;running: boolean;observed: boolean}> };
  codex: { running: boolean; connected: boolean; primary?: LimitWindow | null; secondary?: LimitWindow | null;
    allowed?: boolean | null; updatedAt?: string; tasks: CodexTask[]; error?: string | null; taskError?: string | null };
}
export interface FeatureEvent { id: string; module: ModuleId; text: string; createdAt: string; noticeIds?: string[] }
export interface FeatureBridge {
  snapshot(): Promise<FeatureSnapshot>; media(action: string,id: string): Promise<{ok: boolean; error?: string}>;
  dismiss(id: string): void; settings(): void; regions(regions: Array<{x: number;y: number;width: number;height: number}>): void;
  pin(value: boolean): void; close(): void; onState(callback: (state: FeatureSnapshot) => void): () => void;
  resize(width: number,height: number,save?: boolean,edge?: string): Promise<{width: number;height: number}>;
  onHover(callback: (value: boolean) => void): () => void; onEvent(callback: (event: FeatureEvent) => void): () => void;
  onClose(callback: () => void): () => void;
}
export const MODULES = [
  { id: 'music', name: '音乐控制', description: '按播放器滚动吸附浏览，支持播放、暂停和切歌。兼容条件见下方说明。', permission: '系统媒体会话' },
  { id: 'notifications', name: '系统通知', description: '接收 QQ、手机连接等实际进入 Windows 通知中心的消息。', permission: '系统通知访问' },
  { id: 'codex', name: 'Codex 信息', description: 'Codex 运行时展示额度、重置时间和可读取的任务状态。', permission: '本机 Codex CLI，只读协议' }
] as const;
