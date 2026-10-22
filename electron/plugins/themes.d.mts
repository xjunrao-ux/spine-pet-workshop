export interface CustomTheme {accent:string;background:string;surface:string;ink:string;muted:string}
export interface ThemePreset {id:string;name:string;accent:string;surface:string;background:string;ink:string;muted:string;dark:boolean}
export const DEFAULT_THEME:string;
export const DEFAULT_CUSTOM_THEME:CustomTheme;
export const THEME_PRESETS:ThemePreset[];
export function sanitizeCustomTheme(input:unknown):CustomTheme;
export function normalizeTheme(id:unknown):string;
export function themeVariables(id:unknown,customTheme?:unknown):Record<string,string>;
