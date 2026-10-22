import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Explorer launches may not inherit the Codex CLI PATH used by a terminal.
export async function resolveCodexExecutable(localAppData = process.env.LOCALAPPDATA) {
  if (localAppData) {
    const directory=path.join(localAppData,'OpenAI','Codex','bin');
    try {
      const folders=await readdir(directory,{withFileTypes:true});
      const candidates=await Promise.all(folders.filter(folder=>folder.isDirectory()).map(async folder=> {
        const file=path.join(directory,folder.name,'codex.exe');
        try { const info=await stat(file); return info.isFile()?{file,modified:info.mtimeMs}:null; } catch { return null; }
      }));
      const newest=candidates.filter(Boolean).sort((a,b)=>b.modified-a.modified)[0];
      if(newest) return newest.file;
    } catch { /* Fall back to an explicitly installed CLI on PATH. */ }
  }
  return 'codex.exe';
}

export function normalizeLimit(window) {
  if (!window || !Number.isFinite(window.usedPercent)) return null;
  return { remaining: Math.max(0, Math.min(100, 100 - window.usedPercent)), minutes: window.windowDurationMins ?? null,
    resetsAt: Number.isFinite(window.resetsAt) ? new Date(window.resetsAt * 1000).toISOString() : null };
}

export class CodexService {
  constructor(onState, onEvent, onPid) {
    Object.assign(this, { onState, onEvent, onPid });
    this.pending = new Map(); this.sequence = 0; this.tasks = new Map(); this.running = false; this.generation = 0;
  }
  async start() {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    this.watchStartedAt = Date.now();
    this.state = { running: true, connected: false, tasks: [], error: null };
    this.onState(this.state);
    // A shared daemon exposes runtime status; a separate server can still read stored turn metadata.
    try { await this.connect(['app-server', 'proxy']); }
    catch {
      if (generation !== this.generation || !this.running) return;
      this.closeChild();
      if (!this.running) return;
      try { await this.connect(['app-server', '--stdio']); }
      catch { if (generation !== this.generation || !this.running) return; this.state.error = '无法连接本机 Codex，请检查 CLI 和登录状态'; this.onState(this.state); this.scheduleRetry(); return; }
    }
    if (!this.running || generation !== this.generation) return;
    await this.refresh();
    if (this.running && generation === this.generation) this.timer = setInterval(() => void this.refresh(), 15000);
  }
  async connect(args) {
    const generation=this.generation;
    const executable=await resolveCodexExecutable();
    if (!this.running || generation !== this.generation) throw new Error('Connection cancelled');
    this.child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.onPid(this.child.pid);
    this.child.stdin.on('error', () => {});
    this.child.stderr.resume();
    const connectedChild = this.child;
    this.child.on('error', () => { if (this.child === connectedChild) this.rejectPending(); });
    this.child.on('exit', () => {
      if (this.child !== connectedChild) return;
      this.rejectPending();
      if (this.running && this.state.connected) {
        this.state = { ...this.state, connected: false, error: 'Codex 连接已断开' }; this.onState(this.state); this.scheduleRetry();
      }
    });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      if (this.child !== connectedChild || !this.running) return;
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.id != null && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(message.error.message ?? 'RPC error')) : pending.resolve(message.result);
      } else if (message.method === 'account/rateLimits/updated') {
        this.applyLimits(message.params); this.onState(this.state);
      } else if (message.method === 'turn/completed') {
        const turn = message.params?.turn;
        if (turn) this.recordTurn(message.params.threadId, turn, false);
      }
    });
    await this.request('initialize', { clientInfo: { name: 'spine-pet-workshop', title: 'SpinePet', version: '4.3.1' }, capabilities: { experimentalApi: true } });
    if (this.child !== connectedChild || !this.running) throw new Error('Connection cancelled');
    connectedChild.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    this.state.connected = true;
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('RPC timeout')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  applyLimits(result) {
    const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
    if (!limits) return;
    this.state = { ...this.state, primary: normalizeLimit(limits.primary), secondary: normalizeLimit(limits.secondary),
      allowed: result.ordinaryUsageAllowed ?? this.state.allowed ?? null, updatedAt: new Date().toISOString() };
  }
  recordTurn(id, turn, baseline) {
    const previous = this.tasks.get(id);
    if (!previous) return;
    const terminal = ['completed', 'failed', 'interrupted'].includes(turn.status);
    const changed = previous.turnId !== turn.id || previous.turnStatus !== turn.status;
    if (!baseline && changed && terminal) {
      const labels = { completed: '已完成', failed: '执行失败', interrupted: '已中断' };
      this.onEvent({ id: `codex:${id}:${turn.id}:${turn.status}`, module: 'codex', text: `Codex「${previous.name}」${labels[turn.status]}`, createdAt: new Date().toISOString() });
    }
    this.tasks.set(id, { ...previous, turnId: turn.id, turnStatus: turn.status });
  }
  async refresh() {
    if (!this.running || this.busy || !this.state.connected) return;
    this.busy = true;
    const generation = this.generation;
    try {
      try { const limits = await this.request('account/rateLimits/read', { excludeResetCreditDetails: true, supportsLunaReserve: false }); if (generation !== this.generation) return; this.applyLimits(limits); this.state.error = null; }
      catch { if (generation !== this.generation) return; this.state.error = '额度暂不可读取，请检查 Codex 登录状态'; }
      try {
        const result = await this.request('thread/list', { limit: 8, sortKey: 'updated_at', sourceKinds: ['cli','vscode','appServer'], useStateDbOnly: true });
        if (generation !== this.generation) return;
        for (const thread of result.data ?? []) {
          if (!this.running || generation !== this.generation) return;
          const old = this.tasks.get(thread.id);
          this.tasks.set(thread.id, { ...old, id: thread.id, name: String(thread.name || 'Codex 任务').slice(0, 70), status: thread.status?.type ?? 'notLoaded', updatedAt: thread.updatedAt });
          if (!old || old.updatedAt !== thread.updatedAt || old.status === 'active') {
            try {
              const turns = await this.request('thread/turns/list', { threadId: thread.id, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
              if (generation !== this.generation) return;
              const turn = (turns.data ?? turns.turns ?? [])[0];
              if (turn) this.recordTurn(thread.id, turn, !old && thread.updatedAt * 1000 <= this.watchStartedAt);
            } catch { /* Older CLI: runtime status remains visible, no fabricated completion. */ }
          }
        }
        this.state.tasks = [...this.tasks.values()].sort((a,b) => b.updatedAt - a.updatedAt).slice(0, 8);
        this.state.taskError = null;
      } catch { this.state.taskError = '当前 Codex 版本无法提供任务状态'; }
      if (this.running) this.onState({ ...this.state });
    } finally { if (generation === this.generation) this.busy = false; }
  }
  rejectPending() {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Codex disconnected')); }
    this.pending.clear();
  }
  scheduleRetry() {
    clearInterval(this.timer); clearTimeout(this.retry);
    this.retry = setTimeout(() => { if (this.running) { this.closeChild(); this.running = false; void this.start(); } }, 20000);
  }
  closeChild() { const child=this.child; this.child=null; this.lines?.close(); child?.kill(); this.rejectPending(); this.onPid(null); }
  stop() {
    this.running = false; ++this.generation; this.busy = false; clearInterval(this.timer); clearTimeout(this.retry); this.closeChild(); this.tasks.clear();
    this.state = { running: false, connected: false, tasks: [], error: null }; this.onState(this.state);
  }
}
