import {normalizeTheme,themeVariables} from '../../electron/plugins/themes.mjs';
export {THEME_PRESETS,DEFAULT_CUSTOM_THEME} from '../../electron/plugins/themes.mjs';
export function applyTheme(id:unknown,customTheme?:unknown) {
 document.documentElement.dataset.theme=normalizeTheme(id);
 for(const [key,value] of Object.entries(themeVariables(id,customTheme)))document.documentElement.style.setProperty(key,value);
}
