import {BrowserWindow} from 'electron';
// Floating pet controls yield while a trusted settings window is being used.
export function settingsHaveFocus() {
 const window=BrowserWindow.getFocusedWindow();
 if(!window||window.isDestroyed())return false;
 return /\/(?:settings|deepseek-settings|local-service-settings)\.html(?:[?#]|$)/.test(window.webContents.getURL());
}
