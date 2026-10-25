import path from 'node:path';
import {copyFileSync, mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const INSTALL_APP_ID = 'local.spine.desktop.pet.workshop';
export const WINDOWS_TASKBAR_APP_ID = `${INSTALL_APP_ID}.SpinePet`;

// A source checkout must not inherit the installed application's Shell shortcut.
export function createWindowBranding(app, {rootDirectory, shell, platform = process.platform, resourcesPath = process.resourcesPath, executable = process.execPath, env = process.env, backupShortcut} = {}) {
  const appId = app.isPackaged ? WINDOWS_TASKBAR_APP_ID : `${INSTALL_APP_ID}.development`;
  const iconPath = platform === 'win32'
    ? path.join(app.isPackaged ? resourcesPath : path.join(rootDirectory, 'assets'), 'spinepet-icon.ico')
    : path.join(rootDirectory, 'assets', 'spinepet-icon.png');
  const portableExecutable = app.isPackaged && env.PORTABLE_EXECUTABLE_FILE;
  const launcher = portableExecutable || executable;
  const details = {
    appId,
    appIconPath: portableExecutable || iconPath,
    appIconIndex: 0,
    relaunchCommand: `"${launcher}"` + (app.isPackaged ? '' : ` "${rootDirectory}"`),
    relaunchDisplayName: app.isPackaged ? 'SpinePet' : 'SpinePet 开发版'
  };
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
    app.setAppUserModelId(appId);
    app.on('browser-window-created', (_event, window) => apply(window));
    if (shell && app.isPackaged && !portableExecutable && !env.PET_TEST_PROFILE) {
      void app.whenReady().then(() => migrateShortcuts()).catch(() => {});
    }
  }
  return {appId, iconPath, apply, install, migrateShortcuts};
}
