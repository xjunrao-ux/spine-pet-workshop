import * as music from './providers/music.mjs';
import * as notifications from './providers/notifications.mjs';
import * as todo from '../../plugins/todo/provider.js';
import todoManifest from '../../plugins/todo/plugin.json' with {type:'json'};
export const BUILTIN_PLUGINS=[music,notifications,{manifest:todoManifest,activate:todo.activate}];
