import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {SettingsStore, sanitizeGlobals, startupVoiceEnabled} from '../electron/plugins/settings-store.mjs';

test('startup voice keeps legacy behavior and accepts only explicit saved booleans', () => {
  for (const saved of [undefined, null, [], {}, {schemaVersion: 2, global: {}}, {schemaVersion: 99, global: {defaultVoiceEnabled: false}}, {schemaVersion: 2, global: {defaultVoiceEnabled: 'false'}}]) assert.equal(startupVoiceEnabled(saved), true);
  assert.equal(startupVoiceEnabled({schemaVersion: 2, global: {defaultVoiceEnabled: false}}), false);
  assert.equal(startupVoiceEnabled({defaultVoiceEnabled: false}), false);
  assert.equal(sanitizeGlobals({defaultVoiceEnabled: false}).defaultVoiceEnabled, false);
});
test('disabled startup voice persists through settings save and reload without losing existing globals', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'spinepet-voice-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const store = new SettingsStore(directory, []);
  await store.save({schemaVersion: 2, global: sanitizeGlobals({defaultVoiceEnabled: false, theme: 'forest', quiet: true}), plugins: {}});
  const restored = new SettingsStore(directory, []); await restored.load();
  assert.equal(startupVoiceEnabled(restored.data), false);
  assert.equal(restored.data.global.theme, 'forest'); assert.equal(restored.data.global.quiet, true);
});
