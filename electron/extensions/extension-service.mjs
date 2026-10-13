import { PluginHost } from '../plugins/host.mjs';
import { CapabilityBroker } from '../plugins/capabilities.mjs';
import { BUILTIN_PLUGINS } from '../plugins/registry.mjs';

// The app bootstrap keeps its facade name; all features use the same registry.
export class ExtensionService extends PluginHost {
  constructor({directory,userData,onUpdate,onEvent,definitions=BUILTIN_PLUGINS,broker}) {
    super({definitions,broker:broker??new CapabilityBroker({directory}),userData,onUpdate,onEvent});
  }
  get state() {return {settings:this.settings,locked:this.locked};}
}
