import { existsSync } from 'node:fs';
import path from 'node:path';

// Only the main process chooses the executable. Never accept renderer paths/args.
export function createStartupSettings(app, { platform = process.platform, env = process.env, executable = process.execPath, exists = existsSync } = {}) {
  const name = 'SpinePet', legacyName = 'SpinePetWorkshop';
  const launchPath = env.PORTABLE_EXECUTABLE_FILE || executable;
  const supported = platform === 'win32' && app.isPackaged && path.isAbsolute(launchPath) && /\.exe$/i.test(launchPath) && exists(launchPath);
  // Electron 44 parses the lookup path as a command line: quote paths with spaces.
  const options = { path: '"' + launchPath + '"', args: ['--autostart'] };
  const normalizedPath = value => typeof value === 'string' ? path.normalize(value.replace(/^"|"$/g, '')).toLowerCase() : '';
  const reason = platform !== 'win32' ? '开机启动目前仅支持 Windows。' : !app.isPackaged ? '开发运行不设置开机启动，请使用便携版或安装版。' : !supported ? '无法定位启动文件，请重新打开便携版或安装版。' : '';
  function get() {
    if (!supported) return { supported: false, enabled: false, reason };
    try {
      const login = app.getLoginItemSettings(options);
      const ownItem = login.launchItems?.find(item => [name,legacyName].includes(item.name) && item.scope === 'user' &&
        normalizedPath(item.path) === normalizedPath(launchPath));
      // openAtLogin checks the default AppUserModelId entry, not our custom name.
      // Chromium omits switches such as --autostart from launchItems.args.
      return { supported: true, enabled: ownItem?.enabled === true, reason: '' };
    } catch { return { supported: false, enabled: false, reason: '无法读取 Windows 启动设置，请稍后重试。' }; }
  }
  function set(enabled) {
    if (typeof enabled !== 'boolean') return { ok: false, ...get(), error: '启动设置必须为开关值。' };
    if (!supported) return { ok: false, ...get(), error: reason };
    try {
      const legacy=app.getLoginItemSettings(options).launchItems?.find(item=>item.name===legacyName&&item.scope==='user'&&normalizedPath(item.path)===normalizedPath(launchPath));
      if(legacy)app.setLoginItemSettings({...options,name:legacyName,openAtLogin:false,enabled:false});
      app.setLoginItemSettings({ ...options, name, openAtLogin: enabled, enabled });
      const snapshot = get();
      if (!snapshot.supported || snapshot.enabled !== enabled) return { ok: false, ...snapshot, error: 'Windows 未接受启动设置，请检查系统的“启动应用”。' };
      return { ok: true, ...snapshot };
    } catch { return { ok: false, ...get(), error: '开机启动设置失败，请检查 Windows 权限。' }; }
  }
  return { get, set };
}
