// Persist only palette IDs and sanitized RGB hex values, never plugin-supplied CSS.
export const DEFAULT_THEME='graphite';
export const DEFAULT_CUSTOM_THEME={accent:'#aebdce',background:'#1b2028',surface:'#242a33',ink:'#edf1f6',muted:'#a6b1c0'};
export function sanitizeCustomTheme(input) {
 const result={...DEFAULT_CUSTOM_THEME};
 if(input&&typeof input==='object'&&!Array.isArray(input))for(const key of Object.keys(result))
  if(typeof input[key]==='string'&&/^#[0-9a-f]{6}$/i.test(input[key]))result[key]=input[key].toLowerCase();
 return result;
}
export const THEME_PRESETS=[
 {id:'graphite',name:'石墨黑',accent:'#aebdce',surface:'36,42,51',background:'#1b2028',ink:'#edf1f6',muted:'#a6b1c0',dark:true},
 {id:'ocean',name:'海盐蓝',accent:'#327c9c',surface:'244,251,253',background:'#eaf3f6',ink:'#243c48',muted:'#637e8a',dark:false},
 {id:'forest',name:'苔原绿',accent:'#537f6e',surface:'247,251,248',background:'#edf3ef',ink:'#293e35',muted:'#6b7f74',dark:false},
 {id:'sand',name:'暖沙金',accent:'#937340',surface:'253,250,244',background:'#f4f0e7',ink:'#433b2e',muted:'#867b68',dark:false},
 {id:'rose',name:'浅玫瑰',accent:'#a36c7d',surface:'253,248,250',background:'#f6eef1',ink:'#49353e',muted:'#8a737e',dark:false},
 {id:'custom',name:'自定义',accent:DEFAULT_CUSTOM_THEME.accent,surface:'36,42,51',background:DEFAULT_CUSTOM_THEME.background,ink:DEFAULT_CUSTOM_THEME.ink,muted:DEFAULT_CUSTOM_THEME.muted,dark:true}
];
export const normalizeTheme=id=>THEME_PRESETS.some(t=>t.id===id)?id:DEFAULT_THEME;
const rgb=hex=>[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16));
const luminance=hex=>rgb(hex).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
export function themeVariables(id,customTheme) {
 const theme=normalizeTheme(id),custom=sanitizeCustomTheme(customTheme);
 const t=theme==='custom'?{...custom,surface:rgb(custom.surface).join(','),dark:luminance(custom.background)<.18}:THEME_PRESETS.find(t=>t.id===theme);
 const accentLight=luminance(t.accent);
 return {'color-scheme':t.dark?'dark':'light','--accent':t.accent,'--surface-rgb':t.surface,'--page-bg':t.background,'--ink':t.ink,'--muted':t.muted,'--on-accent':accentLight>.179?'#17202b':'#ffffff'};
}
