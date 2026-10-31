import path from 'node:path';
import {copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';

const INSTALL_APP_ID = 'local.spine.desktop.pet.workshop';
export const WINDOWS_TASKBAR_APP_ID = `${INSTALL_APP_ID}.SpinePet`;

// A source checkout must not inherit the installed application's Shell shortcut.
export function createWindowBranding(app, {rootDirectory, shell, platform = process.platform, resourcesPath = process.resourcesPath, executable = process.execPath, env = process.env, backupShortcut, iconDirectory} = {}) {
  const identityHash = value => createHash('sha256').update(path.win32.resolve(value).toLowerCase()).digest('hex').slice(0, 16);
  const portableExecutable = app.isPackaged && env.PORTABLE_EXECUTABLE_FILE;
  // A test run must never register Electron's notification shortcut with the
  // identity of a user's installed app or another source checkout.
  const appId = env.PET_TEST_PROFILE ? `${INSTALL_APP_ID}.test.${identityHash(env.PET_TEST_PROFILE)}`
    : portableExecutable ? `${INSTALL_APP_ID}.portable.${identityHash(portableExecutable)}`
    : app.isPackaged ? WINDOWS_TASKBAR_APP_ID : `${INSTALL_APP_ID}.development.${identityHash(rootDirectory)}`;
  let iconPath = platform === 'win32'
    ? path.join(app.isPackaged ? resourcesPath : path.join(rootDirectory, 'assets'), 'spinepet-icon.ico')
    : path.join(rootDirectory, 'assets', 'spinepet-icon.png');
  if (platform === 'win32') {
    // Shell may read this after the window closes or a portable extraction is
    // removed. A content-addressed copy also avoids stale icon-cache entries.
    const directory = iconDirectory ?? (app.getPath && path.join(app.getPath('userData'), 'shell-icons'));
    if (directory) {
      const bytes = readFileSync(iconPath);
      const cached = path.join(directory, `spinepet-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.ico`);
      mkdirSync(directory, {recursive: true});
      try { if (!readFileSync(cached).equals(bytes)) writeFileSync(cached, bytes); }
      catch (error) { if (error.code !== 'ENOENT') throw error; writeFileSync(cached, bytes); }
      iconPath = cached;
    }
  }
  const launcher = portableExecutable || executable;
  const details = {
    appId,
    appIconPath: iconPath,
    appIconIndex: 0,
    relaunchCommand: `"${launcher}"` + (app.isPackaged ? '' : ` "${rootDirectory}"`),
    relaunchDisplayName: app.isPackaged ? 'SpinePet' : 'SpinePet 开发版'
  };
  function registerSourceShortcut() {
    if (platform !== 'win32' || app.isPackaged || env.PET_TEST_PROFILE || !shell) return;
    const directory = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const file = path.join(directory, `SpinePet 本地版 (${identityHash(rootDirectory).slice(0, 8)}).lnk`);
    const options = {target: executable, args: `"${rootDirectory}"`, cwd: rootDirectory, icon: iconPath, iconIndex: 0, appUserModelId: appId, description: 'SpinePet 本地启动版'};
    let original;
    try { original = shell.readShortcutLink(file); } catch {}
    const normalized = value => path.win32.normalize(value).toLowerCase();
    const sameExecutable = target => {
      if (normalized(target) === normalized(executable)) return true;
      // pnpm's electron command resolves junctions; a desktop shortcut can use
      // node_modules/electron instead. Both launch the same executable.
      try { return normalized(realpathSync(target)) === normalized(realpathSync(executable)); } catch { return false; }
    };
    if (original && (!sameExecutable(original.target) || original.args !== options.args)) throw new Error('Local shortcut belongs to a different launcher');
    if (original && original.appUserModelId === appId && original.icon === iconPath && original.iconIndex === 0 && original.cwd === rootDirectory) return file;
    mkdirSync(directory, {recursive: true});
    if (!shell.writeShortcutLink(file, original ? 'update' : 'create', options)) throw new Error('Local taskbar shortcut registration failed');
    const saved = shell.readShortcutLink(file);
    if (saved.appUserModelId !== appId || saved.icon !== iconPath || saved.args !== options.args) throw new Error('Local taskbar shortcut verification failed');
    return file;
  }
  function migrateShortcuts(shortcutPaths) {
    if (platform !== 'win32' || !app.isPackaged || portableExecutable || !shell || (env.PET_TEST_PROFILE && !shortcutPaths)) return [];
    const paths = shortcutPaths ?? [
      path.join(app.getPath('desktop'), 'SpinePet.lnk'),
      path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'SpinePet.lnk'),
      path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'SpinePet.lnk')
    ];
    const results = [];
    const normalized = value => path.win32.normalize(value).toLowerCase();
    for (const file of paths) {
      let original;
      try { original = shell.readShortcutLink(file); } catch { continue; }
      if (normalized(original.target) !== normalized(executable) || ![INSTALL_APP_ID, appId].includes(original.appUserModelId)) continue;
      if (original.appUserModelId === appId && original.icon && normalized(original.icon) === normalized(iconPath) && original.iconIndex === 0) continue;
      let backup;
      try {
        if (backupShortcut) backup = backupShortcut(file);
        else {
          const directory = path.join(app.getPath('userData'), 'shortcut-backups');
          mkdirSync(directory, {recursive: true});
          backup = path.join(directory, `${randomUUID()}.lnk`);
          copyFileSync(file, backup);
        }
        if (!shell.writeShortcutLink(file, 'update', {target: original.target, appUserModelId: appId, icon: iconPath, iconIndex: 0})) throw new Error('Shortcut update failed');
        const saved = shell.readShortcutLink(file);
        if (saved.target !== original.target || saved.args !== original.args || saved.cwd !== original.cwd || saved.appUserModelId !== appId || normalized(saved.icon) !== normalized(iconPath)) throw new Error('Shortcut verification failed');
        results.push({path: file, updated: true});
      } catch {
        if (backup) { try { copyFileSync(backup, file); } catch {} }
        results.push({path: file, updated: false});
      }
    }
    return results;
  }
  function apply(window) {
    if (platform !== 'win32') return;
    window.setIcon(iconPath);
    window.setAppDetails(details);
  }
  function install() {
    if (platform !== 'win32') return;
    // Electron can create Electron.lnk for development notifications without an
    // icon or launch arguments. Keep that identity away from branded windows.
    app.setAppUserModelId(app.isPackaged && !env.PET_TEST_PROFILE ? appId : `${appId}.notifications`);
    app.on('browser-window-created', (_event, window) => apply(window));
    if (shell && !app.isPackaged && !env.PET_TEST_PROFILE) {
      void app.whenReady().then(registerSourceShortcut).catch(error => console.error('SpinePet taskbar shortcut:', error));
    }
    if (shell && app.isPackaged && !portableExecutable && !env.PET_TEST_PROFILE) {
      void app.whenReady().then(() => migrateShortcuts()).catch(() => {});
    }
  }
  return {appId, iconPath, apply, install, migrateShortcuts, registerSourceShortcut};
}
