import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { CodexService } from './codex-service.mjs';
import { OWN_MEDIA_IDS, normalizeMediaState, notificationChannels } from './media-state.mjs';

export const DEFAULT_SETTINGS = { music: true, notifications: true, codex: true, details: false,
  subtitles: true, quiet: false, reducedMotion: false, blockedApps: [], hoverDelay: 300, cardWidth: 282, cardHeight: 285 };
export function sanitizeSettings(input = {}) {
  const result = { ...DEFAULT_SETTINGS };
  for (const key of ['music','notifications','codex','details','subtitles','quiet','reducedMotion']) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  result.blockedApps = Array.isArray(input.blockedApps) ? [...new Set(input.blockedApps.filter(x => typeof x === 'string').map(x => x.slice(0,150)))].slice(0,100) : [];
  result.hoverDelay = Math.max(150, Math.min(1200, Number(input.hoverDelay) || 300));
  for (const [key, min, max] of [['cardWidth',240,560],['cardHeight',230,640]]) {
    result[key] = Number.isFinite(input[key]) ? Math.round(Math.max(min, Math.min(max, input[key]))) : DEFAULT_SETTINGS[key];
  }
  return result;
}
export class ExtensionService {
  constructor({ directory, userData, onUpdate, onEvent }) {
    Object.assign(this, { directory, userData, onUpdate, onEvent });
    this.pending = new Map(); this.sequence = 0; this.seen = new Map(); this.dismissed = new Map();
    this.readWrites = Promise.resolve();
    this.state = { settings: DEFAULT_SETTINGS, media: { sessions: [], error: null }, notifications: { permission: 'Unknown', items: [], error: null }, codex: { running: false, connected: false, tasks: [] }, locked: false };
    this.codex = new CodexService(state => { this.state.codex = state; this.publish(); }, event => this.emitEvent(event), pid => {
      this.codexPid = pid; this.configure();
    });
  }
  async start() {
    this.active = true;
    this.startedAt = Date.now();
    try { this.state.settings = sanitizeSettings(JSON.parse(await readFile(path.join(this.userData, 'feature-settings.json'), 'utf8'))); } catch {}
    try {
      const entries = JSON.parse(await readFile(path.join(this.userData,'notification-read.json'),'utf8'));
      this.dismissed = new Map(Array.isArray(entries) ? entries.slice(-1000).filter(x => Array.isArray(x) && x.length === 2 && x.every(v => typeof v === 'string' && v.length < 200)) : []);
    } catch {}
    this.syncBridge(); this.publish();
  }
  publish() { if (this.active) this.onUpdate(this.snapshot()); }
  snapshot() {
    const blocked = new Set(this.state.settings.blockedApps);
    return { ...this.state, notifications: { ...this.state.notifications,
      items: this.state.notifications.items.filter(item => !blocked.has(item.appId) && this.dismissed.get(item.id) !== item.createdAt) } };
  }
  emitEvent(event) {
    if (this.active && this.state.settings[event.module] && this.state.settings.subtitles && !this.state.settings.quiet && !this.state.locked) this.onEvent(event);
  }
  configure() {
    this.child?.stdin.write(JSON.stringify({ method: 'configure', params: { ...this.state.settings, excludedMediaIds: OWN_MEDIA_IDS, excludedPids: [this.codexPid].filter(Boolean) } }) + '\n');
  }
  syncBridge() {
    const settings = this.state.settings;
    if (!settings.music) this.state.media = { sessions: [], error: null };
    if (!settings.notifications) { this.state.notifications = { permission: 'Disabled', items: [], error: null }; this.seen.clear(); this.baseline = false; }
    if (!settings.codex) this.codex.stop();
    if (!settings.music && !settings.notifications && !settings.codex) { this.stopBridge(); return; }
    if (this.child) { this.configure(); return; }
    if (process.platform !== 'win32') return;
    const child = spawn('powershell.exe', ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.directory,'windows-bridge.ps1')], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    this.child = child; child.stdin.on('error', () => {}); child.stderr.resume();
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'reply') {
        const pending = this.pending.get(message.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); return;
      }
      if (message.type !== 'snapshot' || !this.active) return;
      this.state.locked = Boolean(message.locked);
      if (this.state.settings.music && message.media) this.state.media = normalizeMediaState(message.media);
      if (this.state.settings.notifications && message.notifications) {
        this.ingestNotifications(message.notifications);
      }
      if (this.state.settings.codex) {
        if (message.codexRunning && !this.codex.running) void this.codex.start();
        if (!message.codexRunning && this.codex.running) this.codex.stop();
      }
      this.publish();
    });
    const failed = () => {
      if (this.child !== child) return;
      this.child = null;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Windows Bridge disconnected')); }
      this.pending.clear();
      this.state.media.error = 'Windows 系统服务暂不可用'; this.state.notifications.error = 'Windows 系统服务暂不可用'; this.publish();
      if (this.active) this.retry = setTimeout(() => this.syncBridge(), 5000);
    };
    child.on('error', failed); child.on('exit', failed); this.configure();
  }
  ingestNotifications(input) {
    const notices = { ...input, items: (input.items ?? []).map(item => ({
      ...item, app: item.app || '系统通知', appId: item.appId || 'windows.system',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      title: this.state.settings.details ? String(item.title ?? '') : '',
      body: this.state.settings.details ? String(item.body ?? '').slice(0,4000) : ''
    })) };
    const groups = new Map(); let changedRead = false;
    for (const item of notices.items) {
      const fresh = this.seen.get(item.id) !== item.createdAt;
      const afterStart = Date.parse(item.createdAt) >= (this.startedAt ?? Infinity);
      // Only new GPT messages: notification-center history is not an unread inbox.
      if (!this.baseline && !afterStart && /chatgpt|openai/i.test(item.app+' '+item.appId)) {
        this.dismissed.set(item.id,item.createdAt); changedRead = true;
      }
      if ((this.baseline || afterStart) && fresh && this.dismissed.get(item.id) !== item.createdAt && !this.state.settings.blockedApps.includes(item.appId)) {
        const group = groups.get(item.app) ?? []; group.push(item); groups.set(item.app,group);
      }
      this.seen.set(item.id,item.createdAt);
    }
    if (notices.permission === 'Allowed') this.baseline = true;
    this.state.notifications = { ...notices, channels: notificationChannels(notices), items: notices.items.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,100) };
    this.publish();
    for (const [app, items] of groups) {
      const latest = items.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
      const summary = [latest.title,latest.body].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,160);
      this.emitEvent({id:`notice:${Date.now()}:${app}`,module:'notifications',noticeIds:items.map(x=>x.id),
        text:this.state.settings.details && summary ? `${app} · ${items.length} 条新消息\n${summary}` : `${app} 收到 ${items.length} 条新消息`,createdAt:new Date().toISOString()});
    }
    if (changedRead) this.persistRead();
    if (this.seen.size > 1000) this.seen = new Map(this.state.notifications.items.map(item => [item.id,item.createdAt]));
  }
  persistRead() {
    if (this.dismissed.size > 1000) this.dismissed = new Map([...this.dismissed].slice(-1000));
    const text = JSON.stringify([...this.dismissed]);
    this.readWrites = this.readWrites.catch(()=>{}).then(async()=>{
      await mkdir(this.userData,{recursive:true}); await writeFile(path.join(this.userData,'notification-read.json'),text);
    }).catch(()=>{});
    return this.readWrites;
  }
  async setSettings(input) {
    const next = sanitizeSettings({ ...this.state.settings, ...input });
    await mkdir(this.userData, { recursive: true });
    await writeFile(path.join(this.userData,'feature-settings.json'), JSON.stringify(next,null,2));
    this.state.settings = next;
    if (!next.details) this.state.notifications.items = this.state.notifications.items.map(x => ({ ...x, title: '', body: '' }));
    this.syncBridge(); this.publish(); return this.snapshot();
  }
  request(method, params) {
    if (!this.child) return Promise.reject(new Error('系统服务未启动'));
    return new Promise((resolve,reject) => {
      const id = ++this.sequence; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('系统操作超时')); },10000);
      this.pending.set(id,{resolve,reject,timer}); this.child.stdin.write(JSON.stringify({id,method,params}) + '\n');
    });
  }
  async mediaCommand(action, sessionId) {
    if (!this.state.settings.music || !['play','pause','toggle','next','previous'].includes(action)) throw new Error('无效的音乐操作');
    if (!this.state.media.sessions.some(item => item.id === sessionId)) throw new Error('播放器已关闭');
    return this.request('media',{action,sessionId});
  }
  dismiss(id) {
    for (const item of this.state.notifications.items) if (id === 'all' || item.id === id) this.dismissed.set(item.id,item.createdAt);
    this.publish(); return this.persistRead();
  }
  stopBridge() {
    clearTimeout(this.retry); const child = this.child; this.child = null; child?.stdin.end(); child?.kill();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('服务已关闭')); }
    this.pending.clear();
  }
  stop() { this.active = false; this.codex.stop(); this.stopBridge(); }
}
